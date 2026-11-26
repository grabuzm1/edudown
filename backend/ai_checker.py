import asyncio
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
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


def _atkey():
    return (getattr(settings, "AITUNNEL_API_KEY", "") or "").strip()


def _debug_env():
    here = Path(__file__).parent
    return {
        "cwd": os.getcwd(), "config_dir": str(here), "env_exists": (here / ".env").exists(),
        "aitunnel_key_len": len(_atkey()),
        "aitunnel_model": getattr(settings, "AITUNNEL_MODEL", ""),
        "reasoning_effort": getattr(settings, "AITUNNEL_REASONING_EFFORT", ""),
    }


def _parse(text):
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
    i_brace, i_sq = text.find("{"), text.find("[")
    if i_brace >= 0 or i_sq >= 0:
        start = min(x for x in (i_brace, i_sq) if x >= 0)
        src = text[start:]
        stack, in_str, esc = [], False, False
        for ch in src:
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch in ("{", "["):
                stack.append(ch)
            elif ch == "}" and stack and stack[-1] == "{":
                stack.pop()
            elif ch == "]" and stack and stack[-1] == "[":
                stack.pop()
        if stack:
            close = "".join("}" if s == "{" else "]" for s in reversed(stack))
            fixed = src.rstrip()
            cut = max(fixed.rfind(","), fixed.rfind("{"), fixed.rfind("["))
            if cut > 0:
                fixed = fixed[:cut]
            try:
                return json.JSONDecoder().raw_decode(fixed.rstrip() + close)[0]
            except Exception:
                pass
    raise RuntimeError("модель вернула не-JSON: " + text[:160])


# ═══ CHATGPT через AITunnel — основная модель для всех (сайт бесплатный) ═══
async def _aitunnel(prompt, temp, json_mode):
    key = _atkey()
    if not key:
        raise RuntimeError("AITUNNEL_API_KEY не задан")
    base = (getattr(settings, "AITUNNEL_BASE_URL", "") or "").rstrip("/")
    model = getattr(settings, "AITUNNEL_MODEL", "gpt-6-luna")
    eff = (getattr(settings, "AITUNNEL_REASONING_EFFORT", "") or "").strip()
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": temp, "max_tokens": 4096}
    if eff:
        body["reasoning_effort"] = eff
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    timeout = float(getattr(settings, "AITUNNEL_TIMEOUT", 45))
    async with httpx.AsyncClient(timeout=timeout) as c:
        r = await c.post(base + "/chat/completions", headers=headers, json=body)
        # если шлюз не принимает reasoning_effort — повторим без него
        if r.status_code == 400 and "reasoning_effort" in r.text and "reasoning_effort" in body:
            body.pop("reasoning_effort", None)
            r = await c.post(base + "/chat/completions", headers=headers, json=body)
        if r.status_code != 200:
            msg = r.text[:200]
            try:
                msg = r.json().get("error", {}).get("message", msg)
            except Exception:
                pass
            raise RuntimeError("AITunnel HTTP " + str(r.status_code) + " (model=" + model + "): " + msg)
        text = r.json()["choices"][0]["message"]["content"] or ""
        if not text.strip():
            raise RuntimeError("AITunnel пустой ответ")
        return text, "aitunnel:" + model


# ═══ GIGACHAT (ЗАКОММЕНТИРОВАНО — сайт сейчас бесплатный, но код сохранён) ═══
# _gc_client = None
#
#
# def _get_gc():
#     global _gc_client
#     if _gc_client is None:
#         from gigachat import GigaChat
#         _gc_client = GigaChat(
#             base_url=getattr(settings, "GIGACHAT_BASE_URL", "https://api.giga.chat/v1"),
#             credentials=(getattr(settings, "GIGACHAT_AUTH_KEY", "") or "").strip(),
#             scope=getattr(settings, "GIGACHAT_SCOPE", "GIGACHAT_API_PERS"),
#             verify_ssl_certs=bool(getattr(settings, "GIGACHAT_VERIFY_SSL", False)),
#         )
#     return _gc_client
#
#
# def _gigachat_sync(prompt, temp):
#     from gigachat.models import Chat, Messages, MessagesRole
#     chat = Chat(model=getattr(settings, "GIGACHAT_MODEL", "GigaChat-3-Ultra"),
#                 messages=[Messages(role=MessagesRole.USER, content=prompt)],
#                 temperature=temp, max_tokens=4096)
#     resp = _get_gc().chat(chat)
#     return resp.choices[0].message.content or ""
#
#
# async def _gigachat(prompt, temp, json_mode):
#     if not (getattr(settings, "GIGACHAT_AUTH_KEY", "") or "").strip():
#         raise RuntimeError("GIGACHAT_AUTH_KEY не задан")
#     text = await asyncio.to_thread(_gigachat_sync, prompt, temp)
#     if not text.strip():
#         raise RuntimeError("GigaChat пустой ответ")
#     return text, "gigachat:" + getattr(settings, "GIGACHAT_MODEL", "GigaChat-3-Ultra")


# ═══ МАРШРУТИЗАТОР: всегда идём в ChatGPT (AITunnel) ═══
async def ask(prompt, temp=0.4, json_mode=True, tier="free"):
    # Сайт полностью бесплатный: используем только ChatGPT через AITunnel.
    order = [_aitunnel]
    errs = []
    for fn in order:
        try:
            return await fn(prompt, temp, json_mode)
        except Exception as e:
            errs.append(str(e))
    raise RuntimeError(" | ".join(errs))


# ═══ ПРОВЕРКА РЕШЕНИЯ ═══
_CHECK_JSON = '{"is_correct": true или false, "score": число 0-100, "feedback": "2-3 предложения ученику", "reasoning": "обоснование для учителя"}'


async def check_with_ai(task_description, task_criteria, ai_system_prompt, student_code, stdout, stderr, tier="free"):
    persona = (ai_system_prompt or "").strip() or "Ты строгий, но справедливый учитель информатики. Пиши по-русски на «ты»."
    prompt = (
        persona + "\n\nТВОЯ ЕДИНСТВЕННАЯ ЗАДАЧА: проверить, выполнил ли ученик задание.\n\n"
        "ЗАДАНИЕ:\n" + (task_description or "") + "\n\n"
        "КРИТЕРИИ:\n" + (task_criteria or "Программа должна работать без ошибок и выполнять условие.") + "\n\n"
        "КОД УЧЕНИКА:\n" + (student_code or "") + "\n\n"
        "stdout:\n" + (stdout or "(пусто)") + "\n\nstderr:\n" + (stderr or "(нет)") + "\n\n"
        "ПРАВИЛА:\n"
        "1. Если stdout соответствует заданию — ВЕРНО, независимо от способа (print(7)/x=7;print(x)/print(\"7\") для «выведи 7» — верно; любое имя для «введи своё имя» — верно).\n"
        "2. Если требуется число/арифметика — обязателен int(input())/float(input()); строковая склейка вместо математики (2+2=22) — НЕ засчитывай. Обязательная конструкция (for/def/int) без неё score 60-80, не 0.\n"
        "3. stderr не пустой — НЕВЕРНО 0-20. stdout пустой при требовании вывода — НЕВЕРНО 0-30.\n"
        "4. Шкала: 100 верно; 80-90 пропущена необязательная конструкция; 60-70 частично; 30-50 вывод неверный; 0-20 упало/пусто.\n"
        "5. Если в КОДЕ нет `def` или `return`, но в критериях или задании НЕТ прямого требования их использовать — это НЕ ОШИБКА. Не снижай балл и не пиши \"создай функцию\", если в критериях написано только \"вывод: 25\". Оценка ставится строго по выводу (stdout) и тем конструкциям, которые ПРЯМО указаны в критериях.\n"
        "ЗАПРЕЩЕНО искать «вывод содержит»/expected_output, снижать за стиль, требовать лишнее.\n\n"
        "ВЕРНИ СТРОГО JSON-объект без markdown:\n" + _CHECK_JSON
    )
    try:
        text, provider = await ask(prompt, 0.1, True)
        v = _parse(text)
        if not isinstance(v, dict):
            raise RuntimeError("AI вернул не объект")
        return {
            "is_correct": bool(v.get("is_correct", False)),
            "score": max(0, min(100, int(v.get("score", 0)))),
            "feedback": str(v.get("feedback", "")),
            "reasoning": (str(v.get("reasoning", "")) + " [" + provider + "]").strip(),
        }
    except Exception as e:
        return {
            "is_correct": False, "score": 0,
            "feedback": "Нейросеть временно недоступна. Учитель проверит вручную.",
            "reasoning": "AI недоступен: " + type(e).__name__ + ": " + str(e),
        }


# ═══ ПРОГРАММА КЛАССОВ ═══
def curriculum_hint(grade):
    if not grade:
        return ""
    g = max(1, min(11, int(grade)))
    if g <= 4:
        prog, forb = "только print, переменные, арифметика, строки, input.", "циклы, if, def, списки, словари."
        beg, mid, adv = "1 действие: print(5+3).", "2-3 действия с input.", "несколько input, f-строка."
    elif g <= 7:
        prog, forb = "if/elif/else, for по range, while, input, списки базово.", "def, словари, срезы, ООП."
        beg, mid, adv = "простое if: чётное или нет.", "for с if: чётные от 1 до N.", "while + вложенные условия."
    elif g <= 8:
        prog, forb = "def с return, списки и методы, словари, строковые методы, вложенные циклы, срезы, f-строки.", "ООП, рекурсия, генераторы."
        beg, mid, adv = "def square(x): return x*x.", "функция возвращает список/словарь.", "вложенные циклы, словари-счётчики."
    elif g == 9:
        prog, forb = "ОГЭ: последовательности, строки/файлы, try/except, перебор, делимость.", "ООП, рекурсия, ДП."
        beg, mid, adv = "сумма чисел > 0, минимум.", "ОГЭ: фильтрация+агрегация.", "перебор с условиями, делимость."
    elif g == 10:
        prog, forb = "ЕГЭ: двумерные массивы, сортировки, рекурсия basics, комбинаторика (2/5/6/8/12/14).", "сложное ДП, теория игр."
        beg, mid, adv = "сортировка + k-й элемент.", "двумерный массив, простая рекурсия.", "комбинаторика ЕГЭ, перебор с возвратом."
    else:
        prog, forb = "ЕГЭ 11: ООП class, рекурсия, ДП basics, теория игр 19-21, обработка строк/файлов 24-27.", "задачи 1-8 класса (выведи 7) НЕДОПУСТИМЫ."
        beg, mid, adv = "простой класс Point с distance_to; подсчёт символов.", "класс с методами; ДП 1D; игра с кучей.", "ЕГЭ 19-21 или 24-27 полностью."
    return (
        "\n\nСТРОГО ПО ПРОГРАММЕ " + str(g) + " КЛАССА:\nПрограмма: " + prog + "\nЗАПРЕЩЕНО: " + forb +
        "\nУровни ВНУТРИ программы " + str(g) + " класса:\n- начинающий = " + beg + "\n- средний = " + mid + "\n- опытный = " + adv +
        "\nВАЖНО: класс=ТЕМА, уровень=СЛОЖНОСТЬ внутри темы. Для 11 класса даже начинающий — задача 11 класса, не 5-го."
    )


# ═══ ПРОМПТ ДЛЯ ГЕНЕРАЦИИ (оставлен как был — хороший) ═══
_GEN_JSON = """{
"tasks": [
{
"title": "Краткое название (до 50 символов)",
"description": "Что нужно сделать (1-2 предложения). Обязательно укажи пример: 'Ввод: 5 -> Вывод: 25'.",
"starter_code": "Код-заготовка (только если нужно, иначе пустая строка)",
"ai_criteria": "Конкретные факты для проверки (например: 'вывод=25; print; input')"
}
]
}"""


async def generate_tasks(brief, count=3, level="начинающий", class_number=None, grade=None, tier="free"):
    count = max(1, min(6, int(count)))
    hint = curriculum_hint(grade or class_number)
    prompt = (
        "Ты — опытный методист по Python. Твоя задача: сгенерировать ровно " + str(count) + " заданий для школьников.\n\n"
        "ОГРАНИЧЕНИЯ КЛАССА (ЖЕСТКО):\n" + hint + "\n"
        "Если в описании учителя есть противоречие с программой класса (например, просят словари для 5 класса) — ИГНОРИРУЙ описание и делай строго по программе класса.\n\n"
        "ФОРМАТ ОТВЕТА:\n"
        "Верни СТРОГО валидный JSON-объект без markdown-разметки, без приветствий и без мыслей вслух.\n"
        "Схема:\n" + _GEN_JSON + "\n\n"
        "ЖЕСТКИЕ ПРАВИЛА:\n"
        "1. Ровно " + str(count) + " заданий. Больше или меньше — ЗАПРЕЩЕНО.\n"
        "2. В description НЕЛЬЗЯ писать код или многострочные куски. Только текст условия с примером ввода/вывода.\n"
        "3. В ai_criteria пиши только конкретные проверяемые факты: что должно быть в stdout (число/строка) и какие конструкции обязательны (input, print, for, def и т.д.).\n"
        "4. Не пиши решения задач в самом задании.\n"
        "5. Ответ должен быть ТОЛЬКО JSON. Любой другой текст (даже 'Вот ваши задания') вызовет ошибку парсинга.\n"
        "6. ВНИМАНИЕ: Для классов 1-7 слово \"функция\" и требование \"напиши функцию\" ЗАПРЕЩЕНО. Пиши \"Напиши программу\", \"Вычисли\", \"Реализуй алгоритм\". Задания на `def` разрешены только с 8 класса.\n"
        "\n"
        "ЗАПРОС УЧИТЕЛЯ: «" + brief + "». Уровень: " + level + "."
    )
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
                "title": str(it.get("title", "Задание " + str(i)))[:120],
                "description": str(it.get("description", "")),
                "starter_code": str(it.get("starter_code", "")),
                "ai_criteria": str(it.get("ai_criteria", "")),
                "order_index": i,
            })
    if not out:
        raise RuntimeError("модель вернула пустые задания")
    return out


async def practice_generate(grade, level, custom, prompt_text, count=3, tier="free"):
    count = max(1, min(6, int(count)))
    brief = prompt_text.strip() if (custom and prompt_text.strip()) else (
        "Подбери тренировочные задачи по программе " + str(grade) + " класса, уровень " + level
    )
    return await generate_tasks(brief, count, level, grade=grade, tier=tier)


async def practice_check(description, criteria, code, stdout, stderr, tier="free"):
    v = await check_with_ai(description, criteria, "", code, stdout, stderr, tier)
    return {"is_correct": bool(v.get("is_correct")), "feedback": str(v.get("feedback", ""))}


_cache = {"ts": 0.0, "ok": False, "provider": None, "error": None}


async def status(tier="free"):
    now = time.time()
    debug = _debug_env()
    if now - _cache["ts"] < 5:
        return {
            "configured": bool(_atkey()),
            "ok": _cache["ok"], "provider": _cache["provider"],
            "error": _cache["error"], "debug": debug,
        }
    ok, provider, error = False, None, None
    try:
        _t, provider = await ask("Ответь одним словом: OK", 0.0, False)
        ok = True
    except Exception as e:
        error = str(e)
    _cache.update(ts=now, ok=ok, provider=provider, error=error)
    return {"configured": bool(_atkey()), "ok": ok, "provider": provider, "error": error, "debug": debug}


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


@router.get("/ai-models")
async def ai_models(t: Teacher = Depends(_teacher)):
    key = _atkey()
    if not key:
        return {"models": [], "error": "AITUNNEL_API_KEY не задан"}
    base = (getattr(settings, "AITUNNEL_BASE_URL", "") or "").rstrip("/")
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(base + "/models", headers={"Authorization": "Bearer " + key})
    if r.status_code != 200:
        return {"models": [], "error": "HTTP " + str(r.status_code)}
    return {
        "models": [m.get("id") for m in r.json().get("data", [])],
        "current": getattr(settings, "AITUNNEL_MODEL", ""),
    }


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
        raise HTTPException(502, "AI не смог сгенерировать задания: " + str(e))


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
        raise HTTPException(502, "AI не смог сгенерировать задания: " + str(e))
    mx = (await db.execute(select(func.max(Task.order_index)).where(Task.lesson_id == l.id))).scalar() or 0
    created = []
    for i, dr in enumerate(drafts, 1):
        tk = Task(lesson_id=l.id, order_index=mx + i, title=dr["title"], description=dr["description"],
                  starter_code=dr["starter_code"], ai_criteria=dr["ai_criteria"])
        db.add(tk)
        await db.flush()
        created.append({
            "id": tk.id, "order_index": tk.order_index, "title": tk.title,
            "description": tk.description, "starter_code": tk.starter_code, "ai_criteria": tk.ai_criteria,
        })
    return {"tasks": created}