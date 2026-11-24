import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from database import get_db
from models import Class, Lesson, Task, Teacher

settings = get_settings()
_bearer = HTTPBearer(auto_error=False)

GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest", "gemini-1.5-flash"]


# ═══════════════ КЛЮЧИ / ДИАГНОСТИКА ═══════════════
def _gkey(): return (settings.GEMINI_API_KEY or "").strip()
def _okey(): return (settings.OPENAI_API_KEY or "").strip()
def _gigakey(): return (getattr(settings, "GIGACHAT_AUTH_KEY", "") or "").strip()
def _giga(name, default): return getattr(settings, name, default)


def _debug_env():
    here = Path(__file__).parent
    env_path = here / ".env"
    return {
        "cwd": os.getcwd(),
        "config_dir": str(here),
        "env_exists": env_path.exists(),
        "env_path": str(env_path),
        "gemini_key_len": len(_gkey()),
        "openai_key_len": len(_okey()),
        "gigachat_key_len": len(_gigakey()),
        "provider": settings.AI_PROVIDER,
    }


def _parse(text: str):
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:
        pass
    for op in ("[", "{"):
        i = text.find(op)
        if i >= 0:
            try:
                return json.JSONDecoder().raw_decode(text[i:])[0]
            except Exception:
                continue
    raise RuntimeError(f"модель вернула не-JSON: {text[:160]}")


# ═══════════════ GIGACHAT ═══════════════
async def _gigachat_token() -> str:
    key = _gigakey()
    if not key:
        raise RuntimeError("GIGACHAT_AUTH_KEY не задан (проверь backend/.env)")
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "RqUID": str(uuid.uuid4()),
        "Authorization": f"Bearer {key}",
    }
    data = {"scope": _giga("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")}
    async with httpx.AsyncClient(verify=_giga("GIGACHAT_VERIFY_SSL", False), timeout=30) as c:
        r = await c.post(_giga("GIGACHAT_OAUTH_URL", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"),
                         headers=headers, data=data)
        if r.status_code != 200:
            raise RuntimeError(f"GigaChat OAuth {r.status_code}: {r.text[:200]}")
        return r.json()["access_token"]


async def _gigachat(prompt: str, temp: float, json_mode: bool):
    token = await _gigachat_token()
    model = _giga("GIGACHAT_MODEL", "GigaChat")
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": temp}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    base = _giga("GIGACHAT_BASE_URL", "https://gigachat.devices.sberbank.ru/api/v1")
    async with httpx.AsyncClient(verify=_giga("GIGACHAT_VERIFY_SSL", False), timeout=float(settings.AI_TIMEOUT)) as c:
        r = await c.post(f"{base}/chat/completions", headers=headers, json=body)
        if r.status_code != 200:
            msg = r.text[:200]
            try:
                msg = r.json().get("error", {}).get("message", msg)
            except Exception:
                pass
            raise RuntimeError(f"GigaChat HTTP {r.status_code}: {msg}")
        text = r.json()["choices"][0]["message"]["content"] or ""
        if not text.strip():
            raise RuntimeError("GigaChat вернул пустой ответ")
        return text, f"gigachat:{model}"


# ═══════════════ GEMINI ═══════════════
async def _gemini(prompt: str, temp: float, json_mode: bool):
    key = _gkey()
    if not key:
        raise RuntimeError("GEMINI_API_KEY не задан (проверь backend/.env)")
    base = (settings.GEMINI_BASE_URL or "https://generativelanguage.googleapis.com").rstrip("/")
    models = [m for m in dict.fromkeys([settings.GEMINI_MODEL, *GEMINI_MODELS]) if m]
    errs = []
    async with httpx.AsyncClient(timeout=float(settings.AI_TIMEOUT)) as c:
        for ver in ("v1beta", "v1"):
            for m in models:
                body = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": temp}}
                if json_mode:
                    body["generationConfig"]["responseMimeType"] = "application/json"
                try:
                    r = await c.post(f"{base}/{ver}/models/{m}:generateContent",
                                     headers={"x-goog-api-key": key, "Content-Type": "application/json"}, json=body)
                except Exception as e:
                    errs.append(f"{type(e).__name__}: {e}"); continue
                if r.status_code == 404:
                    errs.append(f"{m}: 404"); continue
                if r.status_code != 200:
                    msg = r.text[:200]
                    try:
                        msg = r.json().get("error", {}).get("message", msg)
                    except Exception:
                        pass
                    errs.append(f"{m}: HTTP {r.status_code} {msg}"); continue
                parts = r.json().get("candidates", [{}])[0].get("content", {}).get("parts", [])
                text = "".join(p.get("text", "") for p in parts)
                if not text.strip():
                    errs.append(f"{m}: пустой ответ"); continue
                return text, f"gemini:{m}"
    raise RuntimeError("Gemini недоступен → " + " | ".join(errs[-3:]))


# ═══════════════ OPENAI ═══════════════
async def _openai(prompt: str, temp: float, json_mode: bool):
    key = _okey()
    if not key:
        raise RuntimeError("OPENAI_API_KEY не задан")
    body = {"model": settings.OPENAI_MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": temp}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    async with httpx.AsyncClient(timeout=float(settings.AI_TIMEOUT)) as c:
        r = await c.post(f"{settings.OPENAI_BASE_URL.rstrip('/')}/chat/completions",
                         headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json=body)
        if r.status_code != 200:
            msg = r.text[:200]
            try:
                msg = r.json().get("error", {}).get("message", msg)
            except Exception:
                pass
            raise RuntimeError(f"шлюз HTTP {r.status_code}: {msg}")
        text = r.json()["choices"][0]["message"]["content"] or ""
        if not text.strip():
            raise RuntimeError("шлюз вернул пустой ответ")
        return text, f"openai:{settings.OPENAI_MODEL}"


# ═══════════════ МАРШРУТИЗАТОР ═══════════════
async def ask(prompt: str, temp=0.4, json_mode=True):
    order = {
        "gemini": [_gemini],
        "openai": [_openai],
        "gigachat": [_gigachat],
        "local": [],
        "auto": [_gigachat, _gemini, _openai],
    }.get(settings.AI_PROVIDER.lower(), [_gigachat])
    if not order:
        raise RuntimeError("AI_PROVIDER=local — нейросеть отключена")
    errs = []
    for fn in order:
        try:
            return await fn(prompt, temp, json_mode)
        except Exception as e:
            errs.append(str(e))
    raise RuntimeError(" | ".join(errs))


# ═══════════════ ПРОВЕРКА РЕШЕНИЯ (ТОЛЬКО AI) ═══════════════
async def check_with_ai(task_description: str, task_criteria: str, ai_system_prompt: str,
                        student_code: str, stdout: str, stderr: str) -> dict:
    persona = (ai_system_prompt or "").strip() or "Ты строгий, но справедливый учитель информатики. Пиши по-русски на «ты»."
    prompt = f"""{persona}

ТВОЯ ЕДИНСТВЕННАЯ ЗАДАЧА: проверить, выполнил ли ученик задание.

ЗАДАНИЕ:
{task_description}

КРИТЕРИИ ПРАВИЛЬНОСТИ:
{task_criteria or 'Программа должна работать без ошибок и выполнять условие задания.'}

КОД УЧЕНИКА:
{student_code}

ВЫВОД ПРОГРАММЫ (stdout):
{stdout or '(пусто)'}

ОШИБКИ ПРОГРАММЫ (stderr):
{stderr or '(нет ошибок)'}

ПРАВИЛА ОЦЕНКИ (СЛЕДУЙ СТРОГО):

1. ГЛАВНОЕ: если stdout соответствует тому, что просит задание — решение ВЕРНОЕ, независимо от способа.
   Примеры: "выведи 7" + print(7) / x=7;print(x) / print("7") → ВЕРНО.
   "введи своё имя и поздоровайся" + name=input(); print("Привет, "+name) → ВЕРНО при ЛЮБОМ имени, не только из примера.

2. ТИПЫ ДАННЫХ: если задание/критерии требуют число или арифметику, ученик ОБЯЗАН преобразовать ввод: int(input()) / float(input()).
   Если он читает input() как строку и клеит строки вместо математики (например "2"+"2"="22" вместо 4) — НЕ засчитывай, даже если вывод похож.
   Если требуется конкретная конструкция (цикл for, def, int) — она обязательна; без неё снижай score до 60-80, но не ставь 0, если вывод верный.

3. Если stderr не пустой (программа упала) — НЕВЕРНО, score 0-20.

4. Если stdout пустой, а задание требует вывод — НЕВЕРНО, score 0-30.

5. ШКАЛА: 100 всё верно; 80-90 верно, но пропущена необязательная конструкция; 60-70 частично; 30-50 вывод неверный, но запустилось; 0-20 упало/пусто.

ЗАПРЕЩЕНО:
- искать в stdout слова "вывод содержит", "expected_output", "required_construction";
- снижать оценку за стиль кода, если вывод и типы верные;
- требовать конструкции, которые задание не упоминает;
- требовать конкретные имена/значения из примера, если задание говорит "введи своё".

ВЕРНИ СТРОГО JSON-ОБЪЕКТ (без markdown):
{{"is_correct": true или false, "score": число 0-100, "feedback": "2-3 предложения ученику", "reasoning": "краткое обоснование для учителя"}}"""
    try:
        text, provider = await ask(prompt, 0.1, True)
        v = _parse(text)
        if not isinstance(v, dict):
            raise RuntimeError("AI вернул не объект")
        return {
            "is_correct": bool(v.get("is_correct", False)),
            "score": max(0, min(100, int(v.get("score", 0)))),
            "feedback": str(v.get("feedback", "")),
            "reasoning": (str(v.get("reasoning", "")) + f" [провайдер: {provider}]").strip(),
        }
    except Exception as e:
        return {
            "is_correct": False,
            "score": 0,
            "feedback": "Нейросеть временно недоступна. Учитель проверит твоё решение вручную.",
            "reasoning": f"AI недоступен: {type(e).__name__}: {e}",
        }


# ═══════════════ ПРОГРАММА КЛАССОВ ═══════════════
def curriculum_hint(grade: int | None) -> str:
    if not grade:
        return ""
    g = max(1, min(11, int(grade)))
    # Что такое "уровень" для конкретного класса.
    # КЛАСС = программа (какие темы вообще можно трогать).
    # УРОВЕНЬ = сложность ВНУТРИ этой программы.
    # Для 11 класса даже "начинающий" — это задачи 11 класса, не 5-го.
    bands = {
        (1, 4): {
            "программа": "только print, переменные (int/str), арифметика +−×÷, простые строки, input().",
            "запрещено": "циклы, if, функции def, списки, словари — ничего из этого.",
            "начинающий": "1 действие: print(5+3), x = 7; print(x).",
            "средний": "2-3 действия с input: введи число, выведи удвоенное.",
            "опытный": "несколько input, арифметика в 3-4 строки, форматирование f-строкой.",
        },
        (5, 6): {
            "программа": "if/elif/else, for по range, while, input, числа/строки, списки базово (создание, len, индекс).",
            "запрещено": "def, словари, срезы, list comprehension, ООП.",
            "начинающий": "простое if-условие: введи число, скажи чётное или нет.",
            "средний": "for по range с if внутри: вывести чётные от 1 до N.",
            "опытный": "while + вложенные условия, обработка последовательности чисел.",
        },
        (7, 8): {
            "программа": "функции def с return, списки и их методы (append, sort, min/max), словари, строковые методы (split/join/lower), вложенные циклы, срезы, f-строки.",
            "запрещено": "ООП, рекурсия, генераторы, декораторы — это 9+ класс.",
            "начинающий": "простая функция с 1 аргументом: def square(x): return x*x, вызов.",
            "средний": "функция возвращает список/словарь, обработка входных данных.",
            "опытный": "вложенные циклы по списку списков, несколько функций, словари-счётчики.",
        },
        (9,): {
            "программа": "программа РФ 9 класса и ОГЭ: обработка последовательностей чисел, чтение из файла/строк, try/except, алгоритмы перебора, делимость, задачи с исполнителями.",
            "запрещено": "ООП class, рекурсия, ДП — это 10-11 класс.",
            "начинающий": "простая задача на последовательность: посчитать сумму чисел > 0, найти минимум.",
            "средний": "задача ОГЭ-стиль: фильтрация + агрегация + вывод результата по условию.",
            "опытный": "перебор с условиями, делимость, задачи с 2-3 вложенными условиями в формате ОГЭ.",
        },
        (10,): {
            "программа": "программа РФ 10 класса и ЕГЭ: двумерные массивы, сортировки (пузырьком/выбором/встроенная), рекурсия basics, комбинаторика, задачи формата ЕГЭ №2/5/6/8/12/14.",
            "запрещено": "сложное ДП, теория игр — это 11 класс.",
            "начинающий": "простая сортировка списка и вывод k-го элемента; или перебор цифр числа.",
            "средний": "двумерный массив: найти максимум в строке/столбце; простая рекурсия (факториал/Фибоначчи).",
            "опытный": "комбинаторная задача ЕГЭ, перебор с возвратом, базовая рекурсия с ветвлением.",
        },
        (11,): {
            "программа": "программа РФ 11 класса и ЕГЭ: ООП class (поля, методы, конструктор), рекурсия, основы ДП, теория игр (ЕГЭ 19-21), обработка строк/файлов (ЕГЭ 24-27).",
            "запрещено": "задачи уровня 1-8 класса (типа 'выведи 7', 'сумма двух') — НЕДОПУСТИМО. Даже для новичка задача должна быть по программе 11 класса.",
            "начинающий": "простой класс с 2-3 методами (Point с distance_to); или простая обработка строки (подсчёт символов); или базовая игра с 2 позициями.",
            "средний": "класс с несколькими методами и взаимодействием; ДП на 1D-массиве (лестница/кузнечик простой); игра с кучей камней (один ход).",
            "опытный": "полная задача ЕГЭ 19-21 (теория игр, дерево позиций) или 24-27 (обработка большого файла с оптимизацией).",
        },
    }
    for (lo, *hi), info in bands.items():
        if hi:
            if lo <= g <= hi[0]:
                return _format_hint(g, info)
        else:
            if g == lo:
                return _format_hint(g, info)
    return ""


def _format_hint(g: int, info: dict) -> str:
    return f"""

╔══ СТРОГО ПО ПРОГРАММЕ {g} КЛАССА ══╗
Программа: {info['программа']}
ЗАПРЕЩЕНО: {info['запрещено']}

Значения уровня сложности — ВНУТРИ программы {g} класса:
• начинающий = {info['начинающий']}
• средний = {info['средний']}
• опытный = {info['опытный']}

ВАЖНО: класс определяет ТЕМУ, а не сложность.
• 11 класс + "начинающий" → простая задача по программе 11 класса (ООП/рекурсия/ЕГЭ), НЕ "выведи 7".
• 11 класс + "опытный" → сложная задача ЕГЭ 19-27.
• 5 класс + "опытный" → сложная задача по программе 5 класса (while+условия), НЕ функции и НЕ списки- comprehensions.
Никогда не выходи за программу класса ни вверх, ни вниз.
╚════════════════════════════════════╝"""


# ═══════════════ ГЕНЕРАЦИЯ ЗАДАНИЙ ═══════════════
async def generate_tasks(brief: str, count: int = 3, level: str = "начинающий",
                         class_number: int | None = None, grade: int | None = None) -> list[dict]:
    count = max(1, min(6, int(count)))
    hint = curriculum_hint(grade or class_number)
    prompt = f"""Ты методист по Python для школьников. Учитель просит: «{brief}». Уровень: {level}.{hint}

    ТВОЯ ГЛАВНАЯ ЗАДАЧА — строго соблюдать программу класса и уровень сложности:
    1. КЛАСС определяет какие ТЕМЫ можно использовать (смотри "Программа" и "ЗАПРЕЩЕНО" выше).
    2. УРОВЕНЬ (начинающий/средний/опытный) определяет СЛОЖНОСТЬ внутри этой программы.
    3. Запрещено:
       - давать задачу ниже программы класса (для 11 класса НЕЛЬЗЯ "выведи 7" или "сумма двух");
       - давать задачу выше программы класса (для 5 класса НЕЛЬЗЯ функции def и словари);
       - использовать темы из "ЗАПРЕЩЕНО" для этого класса.

    Сгенерируй ровно {count} заданий, от более простого к более сложному, все в рамках программы класса и уровня.

    ФОРМАТ ОТВЕТА — СТРОГО JSON-объект (без markdown, без ```):
    {{"tasks": [{{"title": "до 60 символов, конкретно", "description": "текст задания 2-4 предложения с примером ввода-вывода", "starter_code": "начальный код для ученика или пустая строка", "ai_criteria": "короткие критерии проверки: ожидаемый ответ; ключевые конструкции"}}]}}

    КРИТЕРИИ ДЛЯ ai_criteria:
    - Короткие факты через точку с запятой: "12; print" или "чётное; if; % 2 == 0".
    - Если задача требует конкретную конструкцию (def, class, for, рекурсия) — укажи её.
    - НЕ перефразируй задание, НЕ пиши сюда подсказки по решению.

    Все тексты на русском. Решения — 5-20 строк кода."""
    text, _ = await ask(prompt, 0.7, True)
    data = _parse(text)
    arr = None6
    if isinstance(data, list):
        arr = data
    elif isinstance(data, dict):
        if isinstance(data.get("tasks"), list):
            arr = data["tasks"]
        else:
            for v in data.values():
                if isinstance(v, list) and v and isinstance(v[0], dict):
                    arr = v
                    break
            if arr is None and "title" in data:
                arr = [data]
    if not arr:
        raise RuntimeError("модель не вернула список заданий")
    out = []
    for i, it in enumerate(arr[:count], 1):
        if isinstance(it, dict):
            out.append({
                "title": str(it.get("title", f"Задание {i}"))[:120],
                "description": str(it.get("description", "")),
                "starter_code": str(it.get("starter_code", "")),
                "ai_criteria": str(it.get("ai_criteria", "")),
                "order_index": i,
            })
    if not out:
        raise RuntimeError("модель вернула пустые задания")
    return out


async def practice_generate(grade: int, level: str, custom: bool, prompt_text: str, count: int = 3) -> list[dict]:
    count = max(1, min(6, int(count)))
    brief = prompt_text.strip() if (custom and prompt_text.strip()) else f"Подбери тренировочные задачи по школьной программе {grade} класса, уровень {level}"
    return await generate_tasks(brief, count, level, grade=grade)


async def practice_check(description: str, criteria: str, code: str, stdout: str, stderr: str) -> dict:
    v = await check_with_ai(description, criteria, "", code, stdout, stderr)
    return {"is_correct": bool(v.get("is_correct")), "feedback": str(v.get("feedback", ""))}


# ═══════════════ СТАТУС ═══════════════
_cache = {"ts": 0.0, "ok": False, "provider": None, "error": None}


async def status() -> dict:
    now = time.time()
    debug = _debug_env()
    if now - _cache["ts"] < 5:
        return {"configured": bool(_gigakey() or _gkey() or _okey()),
                "ok": _cache["ok"], "provider": _cache["provider"],
                "error": _cache["error"], "debug": debug}
    ok, provider, error = False, None, None
    try:
        _t, provider = await ask("Ответь одним словом: OK", 0.0, False)
        ok = True
    except Exception as e:
        error = str(e)
    _cache.update(ts=now, ok=ok, provider=provider, error=error)
    return {"configured": bool(_gigakey() or _gkey() or _okey()),
            "ok": ok, "provider": provider, "error": error, "debug": debug}


# ═══════════════ HTTP-РОУТЫ ═══════════════
class AiIn(BaseModel):
    brief: str
    count: int = 3
    level: str = "начинающий"
    class_number: int | None = None
    grade: int | None = None


class SelfTestIn(BaseModel):
    task_id: str = ""
    code: str = "print('Привет, мир!')"


async def _teacher(cr: HTTPAuthorizationCredentials | None = Depends(_bearer),
                   db: AsyncSession = Depends(get_db)) -> Teacher:
    if cr is None:
        raise HTTPException(401, "Требуется авторизация учителя")
    try:
        p = jwt.decode(cr.credentials, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        tid = p.get("sub")
        if not tid or p.get("type") != "teacher":
            raise HTTPException(401, "Невалидный токен")
    except JWTError:
        raise HTTPException(401, "Невалидный токен")
    t = (await db.execute(select(Teacher).where(Teacher.id == tid))).scalar_one_or_none()
    if not t:
        raise HTTPException(401, "Учитель не найден")
    return t


router = APIRouter(prefix="/api/teacher", tags=["teacher-ai"])


@router.get("/ai-status")
async def ai_status(t: Teacher = Depends(_teacher)):
    return await status()


@router.post("/ai-selftest")
async def ai_selftest(d: SelfTestIn, t: Teacher = Depends(_teacher), db: AsyncSession = Depends(get_db)):
    task = (await db.execute(select(Task).where(Task.id == d.task_id))).scalar_one_or_none() if d.task_id else None
    desc = task.description if task else "Выведи на экран строку: Привет, мир!"
    crit = task.ai_criteria if task else "Привет, мир!; print"
    try:
        p = subprocess.run([sys.executable, "-I", "-c", d.code], capture_output=True, text=True,
                           timeout=settings.SANDBOX_TIMEOUT, errors="replace")
        out, err = p.stdout or "", p.stderr or ""
    except Exception as e:
        out, err = "", str(e)
    verdict = await check_with_ai(desc, crit, task.ai_system_prompt if task else "", d.code, out, err)
    return {"stdout": out, "stderr": err, "verdict": verdict, "status": await status()}


@router.post("/ai-preview")
async def ai_preview(d: AiIn, t: Teacher = Depends(_teacher)):
    if not d.brief.strip():
        raise HTTPException(400, "Опиши, какие задания нужны")
    try:
        return {"tasks": await generate_tasks(d.brief, d.count, d.level, d.class_number, d.grade)}
    except Exception as e:
        raise HTTPException(502, f"AI не смог сгенерировать задания: {e}")


@router.post("/lessons/{lid}/ai-tasks")
async def ai_tasks(lid: str, d: AiIn, t: Teacher = Depends(_teacher), db: AsyncSession = Depends(get_db)):
    l = (await db.execute(select(Lesson).where(Lesson.id == lid))).scalar_one_or_none()
    if not l or l.teacher_id != t.id:
        raise HTTPException(404, "Урок не найден")
    if not d.brief.strip():
        raise HTTPException(400, "Опиши, какие задания нужны")
    grade = d.grade
    if grade is None and l.class_id:
        c = (await db.execute(select(Class).where(Class.id == l.class_id))).scalar_one_or_none()
        if c:
            grade = c.number
    try:
        drafts = await generate_tasks(d.brief, d.count, d.level, d.class_number, grade)
    except Exception as e:
        raise HTTPException(502, f"AI не смог сгенерировать задания: {e}")
    mx = (await db.execute(select(func.max(Task.order_index)).where(Task.lesson_id == l.id))).scalar() or 0
    created = []
    for i, dr in enumerate(drafts, 1):
        tk = Task(lesson_id=l.id, order_index=mx + i, title=dr["title"],
                  description=dr["description"], starter_code=dr["starter_code"],
                  ai_criteria=dr["ai_criteria"])
        db.add(tk)
        await db.flush()
        created.append({"id": tk.id, "order_index": tk.order_index, "title": tk.title,
                        "description": tk.description, "starter_code": tk.starter_code,
                        "ai_criteria": tk.ai_criteria})
    return {"tasks": created}