import asyncio
import subprocess
import sys
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, async_session
from models import Lesson, Task, StudentSession, Submission, AIReview, Grade
from auth import generate_session_token, verify_down_token
from config import get_settings

router = APIRouter(prefix="/api/student", tags=["student"])
settings = get_settings()


class JoinIn(BaseModel):
    access_code: str
    surname: str = ""
    name: str = ""
    group: str = ""
    down_token: str | None = None


class CodeIn(BaseModel):
    code: str


def _token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(401, "Требуется токен сессии")
    parts = authorization.split()
    return parts[1] if len(parts) == 2 and parts[0].lower() == "bearer" else authorization.strip()


async def _session(token: str, db: AsyncSession) -> StudentSession:
    s = (await db.execute(select(StudentSession).where(StudentSession.session_token == token))).scalar_one_or_none()
    if not s:
        raise HTTPException(401, "Сессия не найдена. Войди на урок заново.")
    return s


async def _tasks(lesson_id: str, db: AsyncSession) -> list[Task]:
    return (await db.execute(select(Task).where(Task.lesson_id == lesson_id).order_by(Task.order_index))).scalars().all()


def _run_code(code: str) -> tuple[str, str, int]:
    started = time.perf_counter()
    try:
        p = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True,
                           timeout=settings.SANDBOX_TIMEOUT, errors="replace")
        ms = int((time.perf_counter() - started) * 1000)
        return (p.stdout or "")[:20000], (p.stderr or "")[:20000], ms
    except subprocess.TimeoutExpired:
        return "", f"Превышено время выполнения ({settings.SANDBOX_TIMEOUT} с). Проверь циклы.", int((time.perf_counter() - started) * 1000)
    except Exception as e:
        return "", f"Ошибка запуска: {e}", 0


async def _ai_review(task: Task, code: str, stdout: str, stderr: str) -> dict:
    try:
        from ai_checker import check_with_ai
        r = await check_with_ai(
            task_description=task.description or task.title,
            task_criteria=task.ai_criteria or "",
            ai_system_prompt=task.ai_system_prompt or "",
            student_code=code, stdout=stdout, stderr=stderr,
        )
        get = (lambda k, d=None: r.get(k, d)) if isinstance(r, dict) else (lambda k, d=None: getattr(r, k, d))
        return {"is_correct": bool(get("is_correct", False)), "score": int(get("score", 0)),
                "feedback": str(get("feedback", "")), "reasoning": str(get("reasoning", ""))}
    except Exception as e:
        ok = not stderr.strip()
        return {
            "is_correct": ok,
            "score": 90 if ok else 35,
            "feedback": ("Отлично! Программа работает без ошибок. Продолжай в том же духе."
                         if ok else f"Программа завершилась с ошибкой. Посмотри консоль: {stderr.strip().splitlines()[-1] if stderr.strip() else 'ошибка'}"),
            "reasoning": f"Локальная проверка (AI недоступен: {type(e).__name__})",
        }


async def _review_background(submission_id: str):
    try:
        async with async_session() as db:
            sub = (await db.execute(select(Submission).where(Submission.id == submission_id))).scalar_one_or_none()
            if not sub: return
            task = (await db.execute(select(Task).where(Task.id == sub.task_id))).scalar_one_or_none()
            sess = (await db.execute(select(StudentSession).where(StudentSession.id == sub.session_id))).scalar_one_or_none()
            verdict = await _ai_review(task, sub.code, sub.stdout or "", sub.stderr or "") if task else {"is_correct": False, "score": 0, "feedback": "Задание удалено.", "reasoning": ""}
            db.add(AIReview(submission_id=sub.id, is_correct=verdict["is_correct"], score=verdict["score"],
                            feedback=verdict["feedback"], reasoning=verdict["reasoning"], raw_llm_response=verdict))
            sub.status = "completed"
            if sess:
                g = (await db.execute(select(Grade).where(Grade.session_id == sess.id))).scalar_one_or_none()
                if not g:
                    g = Grade(session_id=sess.id)
                    db.add(g)
                g.ai_final_score = verdict["score"]
                g.updated_at = datetime.utcnow()
                if verdict["is_correct"]:
                    tasks = await _tasks(sess.lesson_id, db)
                    idx = sess.current_task_index or 0
                    if idx < len(tasks) - 1:
                        sess.current_task_index = idx + 1
                    else:
                        sess.is_completed = True
            await db.commit()
    except Exception:
        import traceback; traceback.print_exc()
        try:
            async with async_session() as db:
                sub = (await db.execute(select(Submission).where(Submission.id == submission_id))).scalar_one_or_none()
                if sub:
                    sub.status = "completed"
                    db.add(AIReview(submission_id=sub.id, is_correct=False, score=0, feedback="Не удалось проверить решение. Попробуй ещё раз.", reasoning="internal error"))
                    await db.commit()
        except Exception:
            pass


@router.post("/join")
async def join(data: JoinIn, db: AsyncSession = Depends(get_db)):
    lesson = (await db.execute(select(Lesson).where(Lesson.access_code == data.access_code.strip().upper()))).scalar_one_or_none()
    if not lesson:
        raise HTTPException(404, "Урок не найден. Проверь код.")
    if not lesson.is_published:
        raise HTTPException(403, "Урок ещё не опубликован учителем.")
    down = await verify_down_token(data.down_token) if data.down_token else None
    token = generate_session_token()
    s = StudentSession(
        lesson_id=lesson.id,
        down_user_id=down["user_id"] if down else None,
        guest_surname=(down["surname"] if down else data.surname) or data.surname,
        guest_name=(down["name"] if down else data.name) or data.name,
        guest_group=(down["group"] if down else data.group) or data.group,
        session_token=token, current_task_index=0,
    )
    db.add(s)
    await db.flush()
    display = f"{s.guest_surname or ''} {s.guest_name or ''}".strip() or "Ученик"
    return {"session_token": token, "lesson_title": lesson.title, "current_task_index": 0,
            "is_guest": down is None, "student_display_name": display}


@router.get("/current-task")
async def current_task(authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    s = await _session(_token(authorization), db)
    tasks = await _tasks(s.lesson_id, db)
    if not tasks:
        raise HTTPException(404, "В уроке пока нет заданий. Учитель добавит их в панели урока.")
    idx = min(s.current_task_index or 0, len(tasks) - 1)
    t = tasks[idx]
    return {"id": t.id, "order_index": t.order_index, "title": t.title, "description": t.description or "",
            "starter_code": t.starter_code or "", "total_tasks": len(tasks), "index": idx,
            "completed": bool(s.is_completed)}


@router.get("/tasks")
async def student_tasks(authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    """Список заданий урока и последние результаты ученика."""
    s = await _session(_token(authorization), db)
    tasks = await _tasks(s.lesson_id, db)
    submissions = (await db.execute(
        select(Submission, AIReview)
        .outerjoin(AIReview, AIReview.submission_id == Submission.id)
        .where(Submission.session_id == s.id)
        .order_by(Submission.created_at.desc())
    )).all()
    latest: dict[str, dict] = {}
    for sub, review in submissions:
        if sub.task_id not in latest and review:
            latest[sub.task_id] = {"accepted": bool(review.is_correct), "score": review.score}
    return [{
        "id": t.id, "order_index": t.order_index, "title": t.title,
        "description": t.description or "", "starter_code": t.starter_code or "",
        "index": i, "total_tasks": len(tasks),
        "accepted": latest.get(t.id, {}).get("accepted", False),
        "score": latest.get(t.id, {}).get("score"),
    } for i, t in enumerate(tasks)]


@router.post("/select-task")
async def select_task(data: SelectTaskIn, authorization: str | None = Header(None),
                      db: AsyncSession = Depends(get_db)):
    """Выбирает задание, которое ученик сейчас открывает в редакторе."""
    s = await _session(_token(authorization), db)
    tasks = await _tasks(s.lesson_id, db)
    if data.index < 0 or data.index >= len(tasks):
        raise HTTPException(404, "Задание не найдено")
    s.current_task_index = data.index
    await db.commit()
    t = tasks[data.index]
    return {
        "id": t.id, "order_index": t.order_index, "title": t.title,
        "description": t.description or "", "starter_code": t.starter_code or "",
        "total_tasks": len(tasks), "index": data.index,
        "completed": bool(s.is_completed),
    }


@router.post("/execute")
async def execute(data: CodeIn, authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    await _session(_token(authorization), db)
    stdout, stderr, ms = _run_code(data.code)
    return {"stdout": stdout, "stderr": stderr, "execution_time_ms": ms}


@router.post("/submit")
async def submit(data: CodeIn, authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    s = await _session(_token(authorization), db)
    tasks = await _tasks(s.lesson_id, db)
    if not tasks:
        raise HTTPException(404, "В уроке нет заданий.")
    idx = min(s.current_task_index or 0, len(tasks) - 1)
    stdout, stderr, ms = _run_code(data.code)
    sub = Submission(session_id=s.id, task_id=tasks[idx].id, code=data.code, stdout=stdout, stderr=stderr,
                     execution_time_ms=ms, status="checking")
    db.add(sub)
    await db.flush()
    sub_id = sub.id
    await db.commit()
    asyncio.create_task(_review_background(sub_id))
    return {"submission_id": sub_id, "status": "checking"}


@router.get("/submission/{submission_id}")
async def submission_status(submission_id: str, authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    s = await _session(_token(authorization), db)
    sub = (await db.execute(select(Submission).where(Submission.id == submission_id, Submission.session_id == s.id))).scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Отправка не найдена")
    rev = (await db.execute(select(AIReview).where(AIReview.submission_id == sub.id))).scalar_one_or_none()
    return {"id": sub.id, "status": sub.status, "stdout": sub.stdout or "", "stderr": sub.stderr or "",
            "execution_time_ms": sub.execution_time_ms or 0,
            "review": {"is_correct": bool(rev.is_correct), "score": rev.score, "feedback": rev.feedback, "reasoning": rev.reasoning or ""} if rev else None}