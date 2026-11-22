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
    bands = [
        (1, 4, "Начальная школа: только print, переменные, арифметика, строки, input. ЗАПРЕЩЕНЫ циклы, условия, функции, списки."),
        (5, 6, "5-6 класс: if/else, for по range, while, input, списки базово (len, индекс). ЗАПРЕЩЕНЫ def, словари, срезы."),
        (7, 8, "7-8 класс: функции def с return, списки и методы, словари, строковые методы, вложенные циклы, срезы, f-строки. Потолок нашей системы уроков."),
        (9, 9, "9 класс (программа РФ, ОГЭ): последовательности, файлы, try/except, перебор/делимость/исполнители. БЕЗ ООП и рекурсии."),
        (10, 10, "10 класс (программа РФ, ЕГЭ): двумерные массивы, сортировки, рекурсия basics, комбинаторика, задачи ЕГЭ 2/5/6/8/12/14."),
        (11, 11, "11 класс (программа РФ, ЕГЭ): ООП class, рекурсия, ДП basics, теория игр 19-21, обработка строк/файлов 24-27."),
    ]
    for a, b, txt in bands:
        if a <= g <= b:
            return f"\n\nПРОГРАММА {g} КЛАССА: {txt} Строго не выходи за эти темы."
    return ""


# ═══════════════ ГЕНЕРАЦИЯ ЗАДАНИЙ ═══════════════
async def generate_tasks(brief: str, count: int = 3, level: str = "начинающий",
                         class_number: int | None = None, grade: int | None = None) -> list[dict]:
    count = max(1, min(6, int(count)))
    hint = curriculum_hint(grade or class_number)
    prompt = f"""Ты методист по Python для школьников. Учитель просит: «{brief}». Уровень: {level}.{hint}

Сгенерируй ровно {count} заданий от простого к сложному.

ПРАВИЛА ДЛЯ description: простое требование + пример вывода. Не пиши слово «функция», если не требуется def.
ПРАВИЛА ДЛЯ ai_criteria: конкретные факты через точку с запятой, например "7; print" или "2 4 6 8 10; for; print".
Если нужна арифметика со вводом — добавь "int" или "float" в критерии.
ЗАПРЕЩЕНЫ заглушки expected_output / required_construction и перефраз задания.

Верни СТРОГО JSON-ОБЪЕКТ (не массив):
{{"tasks": [{{"title": "до 60 символов", "description": "текст", "starter_code": "код или пусто", "ai_criteria": "7; print"}}]}}
Все тексты на русском. Решения в 5-15 строк."""
    text, _ = await ask(prompt, 0.7, True)
    data = _parse(text)
    arr = None
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