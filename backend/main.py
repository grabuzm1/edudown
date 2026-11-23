import asyncio
import io
import secrets
import subprocess
import sys
import time
import traceback
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime
from urllib.parse import unquote, urlparse, parse_qs

import httpx
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from config import get_settings
from database import async_session, get_db, init_db
from auth import (
    create_access_token, generate_access_code, generate_session_token,
    get_current_teacher, hash_password, verify_password,
)
from models import (
    AIReview, Class, ClassStudent, FavoriteLesson, Grade, Lesson,
    StudentAccount, StudentSession, Submission, Task, Teacher,
)
from ai_checker import router as ai_router, check_with_ai

settings = get_settings()


# ═══════════════ ПЛЮСЫ / МИНУСЫ / ЖУРНАЛ ═══════════════
def journal_grade(plus: int, total: int) -> int | None:
    if total <= 0:
        return None
    r = plus / total
    if r >= 0.9: return 5
    if r >= 0.7: return 4
    if r >= 0.5: return 3
    return 2


def gen_student_code() -> str:
    return "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))


def class_display_name(c: Class) -> str:
    d = f"{c.number}{c.letter}"
    if c.custom_name: d += f" «{c.custom_name}»"
    return d


async def session_progress(sess: StudentSession, db: AsyncSession):
    tasks = await lesson_tasks(sess.lesson_id, db)
    rows = (await db.execute(
        select(Submission.task_id, AIReview.is_correct)
        .join(AIReview, AIReview.submission_id == Submission.id)
        .where(Submission.session_id == sess.id)
        .order_by(Submission.created_at)
    )).all()
    last: dict[str, bool] = {}
    for tid, ok in rows:
        last[tid] = bool(ok)
    plus = sum(1 for t in tasks if last.get(t.id))
    total = len(tasks)
    return plus, total - plus, total, last


async def latest_codes(sess: StudentSession, db: AsyncSession) -> dict[str, str]:
    rows = (await db.execute(
        select(Submission.task_id, Submission.code)
        .where(Submission.session_id == sess.id)
        .order_by(Submission.created_at)
    )).all()
    out: dict[str, str] = {}
    for tid, code in rows:
        out[tid] = code or ""
    return out


async def find_existing_session(db, lesson_id, student_id=None, account_id=None, surname="", name=""):
    q = select(StudentSession).where(StudentSession.lesson_id == lesson_id)
    if student_id:
        q = q.where(StudentSession.student_id == student_id)
    elif account_id:
        q = q.where(StudentSession.account_id == account_id)
    else:
        q = q.where(
            StudentSession.student_id == None,
            StudentSession.account_id == None,
            func.lower(StudentSession.guest_surname) == surname.strip().lower(),
            func.lower(StudentSession.guest_name) == name.strip().lower(),
        )
    return (await db.execute(q.order_by(StudentSession.created_at))).scalars().first()


# ═══════════════ СХЕМЫ (все на уровне модуля!) ═══════════════
class RegisterIn(BaseModel):
    email: str
    password: str
    full_name: str


class LoginIn(BaseModel):
    email: str
    password: str


class LessonIn(BaseModel):
    title: str
    description: str = ""
    deadline: datetime | None = None
    class_id: str | None = None
    level: str = "начинающий"
    favorite_id: str | None = None


class LessonPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    is_published: bool | None = None


class TaskIn(BaseModel):
    title: str
    description: str = ""
    starter_code: str = ""
    ai_criteria: str = ""
    ai_system_prompt: str = ""
    order_index: int = 1


class TaskPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    starter_code: str | None = None
    ai_criteria: str | None = None
    ai_system_prompt: str | None = None
    order_index: int | None = None


class GradeIn(BaseModel):
    grade: int | None = Field(default=None, ge=2, le=5)
    comment: str = ""


class JoinIn(BaseModel):
    access_code: str
    surname: str = ""
    name: str = ""
    group: str = ""
    account_id: str | None = None


class JoinWithCodes(BaseModel):
    access_code: str
    student_code: str


class CodeIn(BaseModel):
    code: str
    stdout: str | None = None
    stderr: str | None = None


class SelectTaskIn(BaseModel):
    index: int = Field(ge=0)


class ClassIn(BaseModel):
    number: int = Field(ge=1, le=11)
    letter: str
    custom_name: str | None = None
    note: str = ""
    students: list[dict] = []


class ClassPatch(BaseModel):
    number: int | None = None
    letter: str | None = None
    custom_name: str | None = None
    note: str | None = None
    students: list[dict] | None = None


class FavoriteIn(BaseModel):
    title: str
    description: str = ""
    tasks: list[dict]


class RepublishIn(BaseModel):
    new_title: str | None = None


class StudentRegisterIn(BaseModel):
    surname: str
    name: str
    login: str
    password: str


class StudentLoginIn(BaseModel):
    login: str
    password: str


class DownRegisterIn(BaseModel):
    login: str
    password: str
    surname: str = ""
    name: str = ""


class DownLoginIn(BaseModel):
    login: str
    password: str


class DownTokenIn(BaseModel):
    token: str


class PracticeGenIn(BaseModel):
    grade: int = 7
    level: str = "начинающий"
    custom: bool = False
    prompt: str = ""
    count: int = 3


class PracticeCheckIn(BaseModel):
    description: str = ""
    criteria: str = ""
    code: str = ""
    stdout: str = ""
    stderr: str = ""


# ═══════════════ СЕРИАЛИЗАЦИЯ ═══════════════
def lesson_dict(l: Lesson, tc=0, sc=0) -> dict:
    return {
        "id": l.id, "title": l.title, "description": l.description or "",
        "access_code": l.access_code, "is_published": bool(l.is_published),
        "is_archived": bool(l.is_archived),
        "deadline": l.deadline.isoformat() if l.deadline else None,
        "created_at": l.created_at.isoformat() if l.created_at else None,
        "task_count": tc, "student_count": sc, "class_id": l.class_id,
    }


def task_dict(t: Task) -> dict:
    return {
        "id": t.id, "lesson_id": t.lesson_id, "order_index": t.order_index,
        "title": t.title, "description": t.description or "",
        "starter_code": t.starter_code or "", "ai_criteria": t.ai_criteria or "",
        "ai_system_prompt": t.ai_system_prompt or "",
    }


def class_dict(c: Class, sc=0) -> dict:
    return {
        "id": c.id, "number": c.number, "letter": c.letter,
        "custom_name": c.custom_name or "", "note": c.note or "",
        "display_name": class_display_name(c), "student_count": sc,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


async def own_lesson(lesson_id, teacher, db) -> Lesson:
    l = (await db.execute(select(Lesson).where(Lesson.id == lesson_id))).scalar_one_or_none()
    if not l or l.teacher_id != teacher.id:
        raise HTTPException(404, "Урок не найден")
    return l


async def lesson_tasks(lesson_id, db) -> list[Task]:
    return (await db.execute(select(Task).where(Task.lesson_id == lesson_id).order_by(Task.order_index))).scalars().all()


# ═══════════════ ПЕСОЧНИЦА ═══════════════
def run_code(code: str) -> tuple[str, str, int]:
    started = time.perf_counter()
    try:
        p = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True,
                           timeout=settings.SANDBOX_TIMEOUT, errors="replace")
        return ((p.stdout or "")[:settings.SANDBOX_MAX_OUTPUT],
                (p.stderr or "")[:settings.SANDBOX_MAX_OUTPUT],
                int((time.perf_counter() - started) * 1000))
    except subprocess.TimeoutExpired:
        return "", f"Превышено время выполнения ({settings.SANDBOX_TIMEOUT} с). Проверь циклы.", int((time.perf_counter() - started) * 1000)
    except Exception as e:
        return "", f"Ошибка запуска: {e}", 0


async def review_background(submission_id: str):
    try:
        async with async_session() as db:
            sub = (await db.execute(select(Submission).where(Submission.id == submission_id))).scalar_one_or_none()
            if not sub:
                return
            task = (await db.execute(select(Task).where(Task.id == sub.task_id))).scalar_one_or_none()
            sess = (await db.execute(select(StudentSession).where(StudentSession.id == sub.session_id))).scalar_one_or_none()
            if task:
                try:
                    v = await check_with_ai(task.description or task.title, task.ai_criteria or "",
                                            task.ai_system_prompt or "", sub.code, sub.stdout or "", sub.stderr or "")
                except Exception as e:
                    v = {"is_correct": False, "score": 0,
                         "feedback": "Нейросеть недоступна — учитель проверит вручную.",
                         "reasoning": f"AI error: {e}"}
            else:
                v = {"is_correct": False, "score": 0, "feedback": "Задание удалено.", "reasoning": ""}
            db.add(AIReview(submission_id=sub.id, is_correct=v["is_correct"], score=v["score"],
                            feedback=v["feedback"], reasoning=v["reasoning"], raw_llm_response=v))
            sub.status = "completed"
            if sess:
                plus, minus, total, _ = await session_progress(sess, db)
                if v["is_correct"]:
                    rows = (await db.execute(
                        select(Submission.task_id, AIReview.is_correct)
                        .join(AIReview, AIReview.submission_id == Submission.id)
                        .where(Submission.session_id == sess.id, Submission.task_id == sub.task_id)
                        .order_by(Submission.created_at))).all()
                    prev_ok = bool(rows[-2][1]) if len(rows) > 1 else False
                    if not prev_ok:
                        plus += 1
                        minus -= 1
                sess.is_completed = total > 0 and plus == total
                g = (await db.execute(select(Grade).where(Grade.session_id == sess.id))).scalar_one_or_none()
                if not g:
                    g = Grade(session_id=sess.id)
                    db.add(g)
                g.ai_final_score = plus
                g.updated_at = datetime.utcnow()
            await db.commit()
    except Exception:
        traceback.print_exc()
        try:
            async with async_session() as db:
                sub = (await db.execute(select(Submission).where(Submission.id == submission_id))).scalar_one_or_none()
                if sub:
                    sub.status = "completed"
                    db.add(AIReview(submission_id=sub.id, is_correct=False, score=0,
                                    feedback="Не удалось проверить решение. Попробуй ещё раз.", reasoning="internal error"))
                    await db.commit()
        except Exception:
            pass


# ═══════════════ УЧИТЕЛЬ ═══════════════
teacher = APIRouter(prefix="/api/teacher", tags=["teacher"])


@teacher.post("/register")
async def register(data: RegisterIn, db: AsyncSession = Depends(get_db)):
    if (await db.execute(select(Teacher).where(Teacher.email == data.email.lower()))).scalar_one_or_none():
        raise HTTPException(400, "Учитель с таким email уже существует")
    t = Teacher(email=data.email.lower(), password_hash=hash_password(data.password), full_name=data.full_name)
    db.add(t)
    await db.flush()
    return {"access_token": create_access_token(t.id), "token_type": "bearer", "full_name": t.full_name}


@teacher.post("/login")
async def login(data: LoginIn, db: AsyncSession = Depends(get_db)):
    t = (await db.execute(select(Teacher).where(Teacher.email == data.email.lower()))).scalar_one_or_none()
    if not t or not verify_password(data.password, t.password_hash):
        raise HTTPException(401, "Неверный email или пароль")
    return {"access_token": create_access_token(t.id), "token_type": "bearer", "full_name": t.full_name}


@teacher.get("/me")
async def me(t: Teacher = Depends(get_current_teacher)):
    return {"id": t.id, "email": t.email, "full_name": t.full_name}


@teacher.get("/lessons")
async def list_lessons(t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    lessons = (await db.execute(select(Lesson).where(Lesson.teacher_id == t.id, Lesson.is_archived == False).order_by(Lesson.created_at.desc()))).scalars().all()
    out = []
    for l in lessons:
        tc = (await db.execute(select(func.count(Task.id)).where(Task.lesson_id == l.id))).scalar() or 0
        sc = (await db.execute(select(func.count(StudentSession.id)).where(StudentSession.lesson_id == l.id))).scalar() or 0
        out.append(lesson_dict(l, tc, sc))
    return out


@teacher.get("/lessons/archived")
async def list_archived(t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    lessons = (await db.execute(select(Lesson).where(Lesson.teacher_id == t.id, Lesson.is_archived == True, Lesson.class_id != None).order_by(Lesson.created_at.desc()))).scalars().all()
    out = []
    for l in lessons:
        tc = (await db.execute(select(func.count(Task.id)).where(Task.lesson_id == l.id))).scalar() or 0
        sc = (await db.execute(select(func.count(StudentSession.id)).where(StudentSession.lesson_id == l.id))).scalar() or 0
        out.append(lesson_dict(l, tc, sc))
    return out


@teacher.post("/lessons")
async def create_lesson(data: LessonIn, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    if data.favorite_id:
        fav = (await db.execute(select(FavoriteLesson).where(FavoriteLesson.id == data.favorite_id, FavoriteLesson.teacher_id == t.id))).scalar_one_or_none()
        if not fav:
            raise HTTPException(404, "Шаблон не найден")
        code = generate_access_code()
        while (await db.execute(select(Lesson).where(Lesson.access_code == code))).scalar_one_or_none():
            code = generate_access_code()
        l = Lesson(teacher_id=t.id, class_id=data.class_id, title=data.title or fav.title,
                   description=data.description or fav.description, access_code=code)
        db.add(l)
        await db.flush()
        for i, td in enumerate(fav.tasks_json, 1):
            db.add(Task(lesson_id=l.id, order_index=i, title=td.get("title", ""), description=td.get("description", ""),
                        starter_code=td.get("starter_code", ""), ai_criteria=td.get("ai_criteria", "")))
        await db.flush()
        return lesson_dict(l)
    if data.class_id:
        c = (await db.execute(select(Class).where(Class.id == data.class_id, Class.teacher_id == t.id))).scalar_one_or_none()
        if not c:
            raise HTTPException(404, "Класс не найден")
    code = generate_access_code()
    while (await db.execute(select(Lesson).where(Lesson.access_code == code))).scalar_one_or_none():
        code = generate_access_code()
    l = Lesson(teacher_id=t.id, class_id=data.class_id, title=data.title, description=data.description,
               deadline=data.deadline, access_code=code)
    db.add(l)
    await db.flush()
    return lesson_dict(l)


@teacher.get("/lessons/{lesson_id}")
async def get_lesson(lesson_id: str, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    l = await own_lesson(lesson_id, t, db)
    tasks = await lesson_tasks(l.id, db)
    sessions = (await db.execute(select(StudentSession).where(StudentSession.lesson_id == l.id).order_by(StudentSession.created_at))).scalars().all()
    students = []
    for s in sessions:
        plus, minus, total, _ = await session_progress(s, db)
        g = (await db.execute(select(Grade).where(Grade.session_id == s.id))).scalar_one_or_none()
        auto = journal_grade(plus, total)
        students.append({
            "session_id": s.id,
            "display_name": f"{s.guest_surname or ''} {s.guest_name or ''}".strip() or "Ученик",
            "group": s.guest_group or "",
            "current_task_index": s.current_task_index or 0,
            "is_completed": total > 0 and plus == total,
            "plus": plus, "minus": minus, "total_tasks": total,
            "journal_grade": auto,
            "teacher_grade": g.teacher_grade if g else None,
            "final_grade": (g.teacher_grade if g and g.teacher_grade else auto),
            "teacher_comment": g.teacher_comment if g else "",
        })
    return {**lesson_dict(l, len(tasks), len(sessions)), "tasks": [task_dict(x) for x in tasks], "students": students}


@teacher.patch("/lessons/{lesson_id}")
async def patch_lesson(lesson_id: str, data: LessonPatch, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    l = await own_lesson(lesson_id, t, db)
    if data.title is not None: l.title = data.title
    if data.description is not None: l.description = data.description
    if data.is_published is not None: l.is_published = data.is_published
    await db.flush()
    return lesson_dict(l)


@teacher.patch("/lessons/{lesson_id}/publish")
async def publish_lesson(lesson_id: str, data: LessonPatch, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    l = await own_lesson(lesson_id, t, db)
    l.is_published = True if data.is_published is None else data.is_published
    await db.flush()
    return lesson_dict(l)


@teacher.post("/lessons/{lesson_id}/archive")
async def archive_lesson(lesson_id: str, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    l = await own_lesson(lesson_id, t, db)
    l.is_archived = True
    l.is_published = False
    await db.flush()
    return {"ok": True}


@teacher.post("/lessons/{lesson_id}/republish")
async def republish_lesson(lesson_id: str, data: RepublishIn, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    old = await own_lesson(lesson_id, t, db)
    tasks = await lesson_tasks(old.id, db)
    code = generate_access_code()
    while (await db.execute(select(Lesson).where(Lesson.access_code == code))).scalar_one_or_none():
        code = generate_access_code()
    l = Lesson(teacher_id=t.id, class_id=old.class_id, title=data.new_title or old.title,
               description=old.description, access_code=code, is_published=True)
    db.add(l)
    await db.flush()
    for i, tk in enumerate(tasks, 1):
        db.add(Task(lesson_id=l.id, order_index=i, title=tk.title, description=tk.description,
                    starter_code=tk.starter_code, ai_criteria=tk.ai_criteria, ai_system_prompt=tk.ai_system_prompt))
    await db.flush()
    return lesson_dict(l)


@teacher.delete("/lessons/{lesson_id}")
async def delete_lesson(lesson_id: str, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    l = await own_lesson(lesson_id, t, db)
    await db.execute(delete(Task).where(Task.lesson_id == l.id))
    await db.delete(l)
    return {"ok": True}


@teacher.post("/lessons/{lesson_id}/tasks")
async def create_task(lesson_id: str, data: TaskIn, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    await own_lesson(lesson_id, t, db)
    mx = (await db.execute(select(func.max(Task.order_index)).where(Task.lesson_id == lesson_id))).scalar() or 0
    task = Task(lesson_id=lesson_id, order_index=data.order_index if data.order_index != 99 else mx + 1,
                title=data.title, description=data.description, starter_code=data.starter_code,
                ai_criteria=data.ai_criteria, ai_system_prompt=data.ai_system_prompt)
    db.add(task)
    await db.flush()
    return task_dict(task)


@teacher.patch("/tasks/{task_id}")
async def patch_task(task_id: str, data: TaskPatch, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Задание не найдено")
    await own_lesson(task.lesson_id, t, db)
    for f in ("title", "description", "starter_code", "ai_criteria", "ai_system_prompt", "order_index"):
        v = getattr(data, f)
        if v is not None:
            setattr(task, f, v)
    await db.flush()
    return task_dict(task)


@teacher.delete("/tasks/{task_id}")
async def delete_task(task_id: str, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Задание не найдено")
    await own_lesson(task.lesson_id, t, db)
    await db.delete(task)
    return {"ok": True}


@teacher.patch("/sessions/{session_id}/grade")
async def set_journal_grade(session_id: str, data: GradeIn, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    s = (await db.execute(select(StudentSession).where(StudentSession.id == session_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Сессия не найдена")
    await own_lesson(s.lesson_id, t, db)
    plus, minus, total, _ = await session_progress(s, db)
    g = (await db.execute(select(Grade).where(Grade.session_id == s.id))).scalar_one_or_none()
    if not g:
        g = Grade(session_id=s.id)
        db.add(g)
    g.teacher_grade = data.grade
    g.teacher_comment = data.comment
    g.ai_final_score = plus
    g.status = "reviewed"
    g.updated_at = datetime.utcnow()
    await db.flush()
    return {"ok": True, "plus": plus, "minus": minus, "journal_grade": journal_grade(plus, total),
            "final_grade": data.grade or journal_grade(plus, total)}


@teacher.get("/sessions/{session_id}/submissions")
async def teacher_student_work(session_id: str, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    s = (await db.execute(select(StudentSession).where(StudentSession.id == session_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Сессия не найдена")
    await own_lesson(s.lesson_id, t, db)
    tasks = await lesson_tasks(s.lesson_id, db)
    plus, minus, total, last = await session_progress(s, db)
    subs = (await db.execute(select(Submission).where(Submission.session_id == s.id).order_by(Submission.created_at))).scalars().all()
    latest: dict[str, Submission] = {}
    for sub in subs:
        latest[sub.task_id] = sub
    reviews: dict[str, AIReview] = {}
    if latest:
        revs = (await db.execute(select(AIReview).where(AIReview.submission_id.in_([x.id for x in latest.values()])))).scalars().all()
        for r in revs:
            reviews[r.submission_id] = r
    items = []
    for idx, tsk in enumerate(tasks):
        sub = latest.get(tsk.id)
        rev = reviews.get(sub.id) if sub else None
        items.append({
            "task_id": tsk.id, "task_order": tsk.order_index, "task_index": idx, "task_title": tsk.title,
            "task_description": tsk.description or "", "task_criteria": tsk.ai_criteria or "",
            "starter_code": tsk.starter_code or "", "code": sub.code if sub else "",
            "stdout": (sub.stdout or "") if sub else "", "stderr": (sub.stderr or "") if sub else "",
            "submitted": bool(sub), "submitted_at": sub.created_at.isoformat() if sub and sub.created_at else None,
            "accepted": bool(last.get(tsk.id)),
            "ai": ({"is_correct": bool(rev.is_correct), "score": rev.score, "feedback": rev.feedback, "reasoning": rev.reasoning or ""} if rev else None),
        })
    g = (await db.execute(select(Grade).where(Grade.session_id == s.id))).scalar_one_or_none()
    auto = journal_grade(plus, total)
    return {
        "session_id": s.id, "display_name": f"{s.guest_surname or ''} {s.guest_name or ''}".strip() or "Ученик",
        "group": s.guest_group or "", "is_completed": total > 0 and plus == total,
        "current_task_index": s.current_task_index or 0,
        "plus": plus, "minus": minus, "total_tasks": total,
        "journal_grade": auto, "teacher_grade": g.teacher_grade if g else None,
        "final_grade": (g.teacher_grade if g and g.teacher_grade else auto),
        "teacher_comment": g.teacher_comment if g else "", "items": items,
    }


@teacher.get("/lessons/{lesson_id}/export")
async def export_lesson(lesson_id: str, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    l = await own_lesson(lesson_id, t, db)
    sessions = (await db.execute(select(StudentSession).where(StudentSession.lesson_id == l.id))).scalars().all()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for s in sessions:
            subs = (await db.execute(select(Submission).where(Submission.session_id == s.id).order_by(Submission.created_at))).scalars().all()
            name = (f"{s.guest_surname or 'student'}_{s.guest_name or ''}").strip("_") or s.id[:8]
            for i, sub in enumerate(subs, 1):
                z.writestr(f"{name}/task_{i:02d}.py", sub.code or "")
            plus, minus, total, _ = await session_progress(s, db)
            g = (await db.execute(select(Grade).where(Grade.session_id == s.id))).scalar_one_or_none()
            grade = (g.teacher_grade if g and g.teacher_grade else journal_grade(plus, total))
            z.writestr(f"{name}/info.txt", f"Ученик: {name}\nПлюсы: {plus}\nМинусы: {minus}\nОценка в журнал: {grade or '-'}\n")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{l.access_code}_solutions.zip"'})


# ═══════════════ КЛАССЫ ═══════════════
classes_router = APIRouter(prefix="/api/teacher/classes", tags=["classes"])


@classes_router.get("")
async def list_classes(t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    classes = (await db.execute(select(Class).where(Class.teacher_id == t.id).order_by(Class.number, Class.letter))).scalars().all()
    out = []
    for c in classes:
        sc = (await db.execute(select(func.count(ClassStudent.id)).where(ClassStudent.class_id == c.id))).scalar() or 0
        out.append(class_dict(c, sc))
    return out


@classes_router.post("")
async def create_class(data: ClassIn, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    c = Class(teacher_id=t.id, number=data.number, letter=data.letter.upper(), custom_name=data.custom_name, note=data.note)
    db.add(c)
    await db.flush()
    created = []
    for s in data.students:
        sn = str(s.get("surname", "")).strip()
        nm = str(s.get("name", "")).strip()
        if not sn or not nm:
            continue
        sc = gen_student_code()
        while (await db.execute(select(ClassStudent).where(ClassStudent.student_code == sc))).scalar_one_or_none():
            sc = gen_student_code()
        st = ClassStudent(class_id=c.id, surname=sn, name=nm, student_code=sc)
        db.add(st)
        await db.flush()
        created.append({"id": st.id, "surname": st.surname, "name": st.name, "student_code": st.student_code, "has_account": False})
    return {**class_dict(c, len(created)), "students": created}


@classes_router.get("/{class_id}")
async def get_class(class_id: str, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    c = (await db.execute(select(Class).where(Class.id == class_id))).scalar_one_or_none()
    if not c or c.teacher_id != t.id:
        raise HTTPException(404, "Класс не найден")
    students = (await db.execute(select(ClassStudent).where(ClassStudent.class_id == c.id).order_by(ClassStudent.surname, ClassStudent.name))).scalars().all()
    return {**class_dict(c, len(students)),
            "students": [{"id": s.id, "surname": s.surname, "name": s.name, "student_code": s.student_code, "has_account": s.account_id is not None} for s in students]}


@classes_router.patch("/{class_id}")
async def patch_class(class_id: str, data: ClassPatch, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    c = (await db.execute(select(Class).where(Class.id == class_id))).scalar_one_or_none()
    if not c or c.teacher_id != t.id:
        raise HTTPException(404, "Класс не найден")
    if data.number is not None: c.number = data.number
    if data.letter is not None: c.letter = data.letter.upper()
    if data.custom_name is not None: c.custom_name = data.custom_name
    if data.note is not None: c.note = data.note
    if data.students is not None:
        existing = (await db.execute(select(ClassStudent).where(ClassStudent.class_id == c.id))).scalars().all()
        by_name = {(s.surname.lower(), s.name.lower()): s for s in existing}
        keep = set()
        for s in data.students:
            sn = str(s.get("surname", "")).strip()
            nm = str(s.get("name", "")).strip()
            if not sn or not nm:
                continue
            key = (sn.lower(), nm.lower())
            if key in by_name:
                keep.add(by_name[key].id)
            else:
                sc = gen_student_code()
                while (await db.execute(select(ClassStudent).where(ClassStudent.student_code == sc))).scalar_one_or_none():
                    sc = gen_student_code()
                st = ClassStudent(class_id=c.id, surname=sn, name=nm, student_code=sc)
                db.add(st)
                await db.flush()
                keep.add(st.id)
        for s in existing:
            if s.id not in keep:
                await db.delete(s)
    await db.flush()
    students = (await db.execute(select(ClassStudent).where(ClassStudent.class_id == c.id).order_by(ClassStudent.surname, ClassStudent.name))).scalars().all()
    return {**class_dict(c, len(students)),
            "students": [{"id": s.id, "surname": s.surname, "name": s.name, "student_code": s.student_code, "has_account": s.account_id is not None} for s in students]}


@classes_router.delete("/{class_id}")
async def delete_class(class_id: str, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    c = (await db.execute(select(Class).where(Class.id == class_id))).scalar_one_or_none()
    if not c or c.teacher_id != t.id:
        raise HTTPException(404, "Класс не найден")
    await db.delete(c)
    return {"ok": True}


# ═══════════════ ИЗБРАННОЕ (шаблоны, API остаётся) ═══════════════
favorites_router = APIRouter(prefix="/api/teacher/favorites", tags=["favorites"])


@favorites_router.get("")
async def list_favorites(t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    favs = (await db.execute(select(FavoriteLesson).where(FavoriteLesson.teacher_id == t.id).order_by(FavoriteLesson.created_at.desc()))).scalars().all()
    return [{"id": f.id, "title": f.title, "description": f.description or "", "task_count": len(f.tasks_json or []),
             "created_at": f.created_at.isoformat() if f.created_at else None} for f in favs]


@favorites_router.post("")
async def create_favorite(data: FavoriteIn, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    f = FavoriteLesson(teacher_id=t.id, title=data.title, description=data.description, tasks_json=data.tasks)
    db.add(f)
    await db.flush()
    return {"id": f.id, "title": f.title, "task_count": len(data.tasks)}


@favorites_router.delete("/{fav_id}")
async def delete_favorite(fav_id: str, t: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    f = (await db.execute(select(FavoriteLesson).where(FavoriteLesson.id == fav_id, FavoriteLesson.teacher_id == t.id))).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Не найдено")
    await db.delete(f)
    return {"ok": True}


# ═══════════════ АККАУНТЫ УЧЕНИКОВ / DOWN ID ═══════════════
student_auth_router = APIRouter(prefix="/api/student-auth", tags=["student-auth"])


async def _downid_form(path: str, fields: dict) -> None:
    url = settings.DOWN_API_URL.rstrip("/") + path
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as c:
        r = await c.post(url, data=fields)
    loc = r.headers.get("location", "")
    if loc:
        q = parse_qs(urlparse(loc).query)
        if "error" in q:
            raise HTTPException(400, unquote(q["error"][0]))
    if r.status_code == 422:
        raise HTTPException(400, "Проверь логин и пароль (слишком короткие или пустые)")
    if r.status_code >= 400:
        raise HTTPException(502, f"Down ID недоступен (HTTP {r.status_code})")


async def _link_down_account(db: AsyncSession, login: str, surname: str, name: str) -> StudentAccount:
    down_id = login.strip().lower()
    acc = (await db.execute(select(StudentAccount).where(StudentAccount.down_id == down_id))).scalar_one_or_none()
    if not acc:
        acc = (await db.execute(select(StudentAccount).where(StudentAccount.login == down_id))).scalar_one_or_none()
    if not acc:
        acc = StudentAccount(login=down_id, password_hash="downid",
                             surname=surname.strip(), name=name.strip(), down_id=down_id)
        db.add(acc)
        await db.flush()
    else:
        acc.down_id = down_id
        if surname.strip(): acc.surname = surname.strip()
        if name.strip(): acc.name = name.strip()
    matches = (await db.execute(select(ClassStudent).where(
        func.lower(ClassStudent.surname) == acc.surname.lower(),
        func.lower(ClassStudent.name) == acc.name.lower(),
        ClassStudent.account_id == None))).scalars().all()
    for m in matches:
        m.account_id = acc.id
    await db.flush()
    return acc


@student_auth_router.post("/down-register")
async def down_register(data: DownRegisterIn, db: AsyncSession = Depends(get_db)):
    if not data.login.strip() or not data.password:
        raise HTTPException(400, "Логин и пароль обязательны")
    await _downid_form("/register_user", {
        "u_login": data.login.strip(), "u_pass": data.password,
        "u_pass2": data.password, "next": "/account",
    })
    acc = await _link_down_account(db, data.login, data.surname, data.name)
    return {"id": acc.id, "login": acc.login, "surname": acc.surname, "name": acc.name, "down_id": acc.down_id}


@student_auth_router.post("/down-login")
async def down_login(data: DownLoginIn, db: AsyncSession = Depends(get_db)):
    await _downid_form("/login_user", {"u_login": data.login.strip(), "u_pass": data.password, "next": "/account"})
    down_id = data.login.strip().lower()
    existing = (await db.execute(select(StudentAccount).where(StudentAccount.down_id == down_id))).scalar_one_or_none()
    acc = await _link_down_account(db, data.login,
                                   existing.surname if existing else "",
                                   existing.name if existing else "")
    return {"id": acc.id, "login": acc.login, "surname": acc.surname, "name": acc.name, "down_id": acc.down_id}


@student_auth_router.post("/down-token")
async def down_token(data: DownTokenIn, db: AsyncSession = Depends(get_db)):
    url = settings.DOWN_API_URL.rstrip("/") + "/api/walldown/me"
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(url, headers={"Authorization": f"Bearer {data.token}"})
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if not body.get("ok"):
        raise HTTPException(401, "Down ID не подтвердил токен. Войди заново.")
    pid = str(body.get("id") or body.get("user_id") or body.get("login") or "")
    login = (body.get("login") or body.get("username") or pid).strip().lower()
    surname = (body.get("surname") or body.get("last_name") or "").strip()
    name = (body.get("name") or body.get("first_name") or "").strip()
    if not surname and not name:
        full = (body.get("full_name") or body.get("display_name") or "").split()
        if full:
            surname, name = full[0], " ".join(full[1:])
    acc = await _link_down_account(db, login, surname, name)
    return {"id": acc.id, "login": acc.login, "surname": acc.surname, "name": acc.name, "down_id": acc.down_id}


@student_auth_router.post("/register")
async def student_register(data: StudentRegisterIn, db: AsyncSession = Depends(get_db)):
    if (await db.execute(select(StudentAccount).where(StudentAccount.login == data.login.lower()))).scalar_one_or_none():
        raise HTTPException(400, "Логин уже занят")
    acc = StudentAccount(login=data.login.lower(), password_hash=hash_password(data.password),
                         surname=data.surname.strip(), name=data.name.strip())
    db.add(acc)
    await db.flush()
    matches = (await db.execute(select(ClassStudent).where(
        func.lower(ClassStudent.surname) == data.surname.strip().lower(),
        func.lower(ClassStudent.name) == data.name.strip().lower(),
        ClassStudent.account_id == None))).scalars().all()
    for m in matches:
        m.account_id = acc.id
    await db.flush()
    return {"id": acc.id, "login": acc.login, "surname": acc.surname, "name": acc.name}


@student_auth_router.post("/login")
async def student_login(data: StudentLoginIn, db: AsyncSession = Depends(get_db)):
    acc = (await db.execute(select(StudentAccount).where(StudentAccount.login == data.login.lower()))).scalar_one_or_none()
    if not acc or acc.password_hash == "downid" or not verify_password(data.password, acc.password_hash):
        raise HTTPException(401, "Неверный логин или пароль")
    return {"id": acc.id, "login": acc.login, "surname": acc.surname, "name": acc.name}


# ═══════════════ УЧЕНИК ═══════════════
student = APIRouter(prefix="/api/student", tags=["student"])


def bearer(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(401, "Требуется токен сессии")
    p = authorization.split()
    return p[1] if len(p) == 2 and p[0].lower() == "bearer" else authorization.strip()


async def session_by_token(token: str, db: AsyncSession) -> StudentSession:
    s = (await db.execute(select(StudentSession).where(StudentSession.session_token == token))).scalar_one_or_none()
    if not s:
        raise HTTPException(401, "Сессия не найдена. Войди на урок заново.")
    return s


def task_payload(t: Task, idx: int, total: int, sess: StudentSession, plus: int, minus: int) -> dict:
    return {"id": t.id, "order_index": t.order_index, "title": t.title, "description": t.description or "",
            "starter_code": t.starter_code or "", "total_tasks": total, "index": idx,
            "completed": bool(sess.is_completed), "plus": plus, "minus": minus}


@student.post("/join")
async def join(data: JoinIn, db: AsyncSession = Depends(get_db)):
    lesson = (await db.execute(select(Lesson).where(Lesson.access_code == data.access_code.strip().upper()))).scalar_one_or_none()
    if not lesson:
        raise HTTPException(404, "Урок не найден. Проверь код.")
    if not lesson.is_published:
        raise HTTPException(403, "Урок ещё не опубликован учителем.")
    if lesson.class_id:
        raise HTTPException(400, "Этот урок привязан к классу. Входи по коду ученика.")
    acc = None
    if data.account_id:
        acc = (await db.execute(select(StudentAccount).where(StudentAccount.id == data.account_id))).scalar_one_or_none()
    sn = acc.surname if acc else data.surname
    nm = acc.name if acc else data.name
    existing = await find_existing_session(db, lesson.id, account_id=acc.id if acc else None, surname=sn, name=nm)
    if existing:
        return {"session_token": existing.session_token, "lesson_title": lesson.title,
                "student_display_name": f"{existing.guest_surname} {existing.guest_name}".strip() or "Ученик",
                "is_class_lesson": False}
    token = generate_session_token()
    s = StudentSession(lesson_id=lesson.id, account_id=acc.id if acc else None,
                       guest_surname=sn, guest_name=nm, guest_group=data.group,
                       session_token=token, current_task_index=0)
    db.add(s)
    await db.flush()
    return {"session_token": token, "lesson_title": lesson.title,
            "student_display_name": f"{sn} {nm}".strip() or "Ученик", "is_class_lesson": False}


@student.post("/join-class")
async def join_class(data: JoinWithCodes, db: AsyncSession = Depends(get_db)):
    lesson = (await db.execute(select(Lesson).where(Lesson.access_code == data.access_code.strip().upper()))).scalar_one_or_none()
    if not lesson:
        raise HTTPException(404, "Урок не найден. Проверь код.")
    if not lesson.is_published:
        raise HTTPException(403, "Урок ещё не опубликован учителем.")
    if not lesson.class_id:
        raise HTTPException(400, "Это обычный урок. Вводи код урока и имя.")
    st = (await db.execute(select(ClassStudent).where(ClassStudent.student_code == data.student_code.strip().upper()))).scalar_one_or_none()
    if not st or st.class_id != lesson.class_id:
        raise HTTPException(404, "Ученик не найден в классе этого урока. Проверь код.")
    existing = await find_existing_session(db, lesson.id, student_id=st.id)
    if existing:
        return {"session_token": existing.session_token, "lesson_title": lesson.title,
                "student_display_name": f"{st.surname} {st.name}", "is_class_lesson": True}
    token = generate_session_token()
    s = StudentSession(lesson_id=lesson.id, student_id=st.id, account_id=st.account_id,
                       guest_surname=st.surname, guest_name=st.name, session_token=token, current_task_index=0)
    db.add(s)
    await db.flush()
    return {"session_token": token, "lesson_title": lesson.title,
            "student_display_name": f"{st.surname} {st.name}", "is_class_lesson": True}


@student.get("/lessons-by-code/{student_code}")
async def lessons_by_code(student_code: str, db: AsyncSession = Depends(get_db)):
    st = (await db.execute(select(ClassStudent).where(ClassStudent.student_code == student_code.strip().upper()))).scalar_one_or_none()
    if not st:
        raise HTTPException(404, "Ученик с таким кодом не найден. Проверь код у учителя.")
    cls = (await db.execute(select(Class).where(Class.id == st.class_id))).scalar_one_or_none()
    rows = (await db.execute(
        select(Lesson, Teacher.full_name).join(Teacher, Teacher.id == Lesson.teacher_id)
        .where(Lesson.class_id == st.class_id, Lesson.is_published == True, Lesson.is_archived == False)
        .order_by(Lesson.created_at.desc()))).all()
    lessons = []
    for l, tname in rows:
        tc = (await db.execute(select(func.count(Task.id)).where(Task.lesson_id == l.id))).scalar() or 0
        lessons.append({"id": l.id, "title": l.title, "description": l.description or "",
                        "access_code": l.access_code, "task_count": tc,
                        "class_display": class_display_name(cls) if cls else "", "teacher_name": tname})
    return {"student": {"surname": st.surname, "name": st.name, "student_code": st.student_code},
            "class_display": class_display_name(cls) if cls else "", "lessons": lessons}


@student.get("/current-task")
async def current_task(authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    s = await session_by_token(bearer(authorization), db)
    tasks = await lesson_tasks(s.lesson_id, db)
    if not tasks:
        raise HTTPException(404, "В уроке пока нет заданий.")
    plus, minus, total, _ = await session_progress(s, db)
    idx = min(s.current_task_index or 0, len(tasks) - 1)
    return task_payload(tasks[idx], idx, len(tasks), s, plus, minus)


@student.get("/tasks")
async def student_tasks(authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    s = await session_by_token(bearer(authorization), db)
    tasks = await lesson_tasks(s.lesson_id, db)
    plus, minus, total, last = await session_progress(s, db)
    codes = await latest_codes(s, db)
    submitted = set(codes.keys())
    return [{"id": t.id, "order_index": t.order_index, "title": t.title, "description": t.description or "",
             "starter_code": t.starter_code or "", "ai_criteria": t.ai_criteria or "", "index": i,
             "accepted": bool(last.get(t.id)), "submitted": t.id in submitted,
             "code": codes.get(t.id, "")} for i, t in enumerate(tasks)]


@student.post("/select-task")
async def select_task(data: SelectTaskIn, authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    s = await session_by_token(bearer(authorization), db)
    tasks = await lesson_tasks(s.lesson_id, db)
    if not tasks:
        raise HTTPException(404, "В уроке нет заданий")
    if data.index < 0 or data.index >= len(tasks):
        raise HTTPException(400, "Нет такого задания")
    s.current_task_index = data.index
    await db.flush()
    plus, minus, total, _ = await session_progress(s, db)
    return task_payload(tasks[data.index], data.index, len(tasks), s, plus, minus)


@student.post("/execute")
async def execute(data: CodeIn, authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    await session_by_token(bearer(authorization), db)
    stdout, stderr, ms = run_code(data.code)
    return {"stdout": stdout, "stderr": stderr, "execution_time_ms": ms}


@student.post("/submit")
async def submit(data: CodeIn, authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    s = await session_by_token(bearer(authorization), db)
    tasks = await lesson_tasks(s.lesson_id, db)
    if not tasks:
        raise HTTPException(404, "В уроке нет заданий.")
    idx = min(s.current_task_index or 0, len(tasks) - 1)
    if data.stdout is not None or data.stderr is not None:
        stdout = (data.stdout or "")[:settings.SANDBOX_MAX_OUTPUT]
        stderr = (data.stderr or "")[:settings.SANDBOX_MAX_OUTPUT]
        ms = 0
    else:
        stdout, stderr, ms = run_code(data.code)
    sub = Submission(session_id=s.id, task_id=tasks[idx].id, code=data.code, stdout=stdout, stderr=stderr,
                     execution_time_ms=ms, status="checking")
    db.add(sub)
    await db.flush()
    sub_id = sub.id
    await db.commit()
    asyncio.create_task(review_background(sub_id))
    return {"submission_id": sub_id, "status": "checking"}


@student.get("/submission/{submission_id}")
async def submission_status(submission_id: str, authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    s = await session_by_token(bearer(authorization), db)
    sub = (await db.execute(select(Submission).where(Submission.id == submission_id, Submission.session_id == s.id))).scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Отправка не найдена")
    rev = (await db.execute(select(AIReview).where(AIReview.submission_id == sub.id))).scalar_one_or_none()
    plus, minus, total, _ = await session_progress(s, db)
    return {"id": sub.id, "status": sub.status, "stdout": sub.stdout or "", "stderr": sub.stderr or "",
            "execution_time_ms": sub.execution_time_ms or 0,
            "plus": plus, "minus": minus, "completed": total > 0 and plus == total,
            "review": ({"is_correct": bool(rev.is_correct), "score": rev.score, "feedback": rev.feedback, "reasoning": rev.reasoning or ""} if rev else None)}


# ═══════════════ ТРЕНИРОВКА (публично, без БД) ═══════════════
practice = APIRouter(prefix="/api/student/practice", tags=["practice"])


@practice.post("/generate")
async def practice_gen(data: PracticeGenIn | None = None):
    from ai_checker import practice_generate
    d = data or PracticeGenIn()
    grade = max(1, min(11, int(d.grade or 7)))
    count = max(1, min(6, int(d.count or 3)))
    try:
        tasks = await practice_generate(grade, d.level or "начинающий", bool(d.custom), d.prompt or "", count)
    except Exception as e:
        raise HTTPException(502, f"AI не смог сгенерировать задачи: {e}")
    return {"tasks": tasks}


@practice.post("/check")
async def practice_chk(data: PracticeCheckIn | None = None):
    from ai_checker import practice_check
    d = data or PracticeCheckIn()
    return await practice_check(d.description, d.criteria, d.code, d.stdout, d.stderr)


# ═══════════════ МИГРАЦИИ + ДЕДУП СЕССИЙ ═══════════════
async def migrate_and_dedupe():
    async with async_session() as db:
        for stmt in (
            "ALTER TABLE grades ADD COLUMN teacher_grade INTEGER",
            "ALTER TABLE student_accounts ADD COLUMN down_id VARCHAR(100)",
        ):
            try:
                await db.execute(text(stmt))
                await db.commit()
            except Exception:
                await db.rollback()
    async with async_session() as db:
        sessions = (await db.execute(select(StudentSession).order_by(StudentSession.created_at))).scalars().all()
        groups: dict[tuple, list[StudentSession]] = {}
        for s in sessions:
            if s.student_id:
                key = (s.lesson_id, "cs", s.student_id)
            elif s.account_id:
                key = (s.lesson_id, "acc", s.account_id)
            else:
                key = (s.lesson_id, "g", (s.guest_surname or "").lower(), (s.guest_name or "").lower())
            groups.setdefault(key, []).append(s)
        for key, grp in groups.items():
            if len(grp) < 2:
                continue
            keep = grp[0]
            for extra in grp[1:]:
                await db.execute(text("UPDATE submissions SET session_id=:k WHERE session_id=:e"), {"k": keep.id, "e": extra.id})
                gk = (await db.execute(select(Grade).where(Grade.session_id == keep.id))).scalar_one_or_none()
                ge = (await db.execute(select(Grade).where(Grade.session_id == extra.id))).scalar_one_or_none()
                if ge and not gk:
                    ge.session_id = keep.id
                elif ge:
                    await db.delete(ge)
                await db.delete(extra)
        await db.commit()



@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await migrate_and_dedupe()
    print("[EduDown] Запущено.")
    yield


app = FastAPI(title="EduDown Pro API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware,
                   allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "https://edu.imdown.pro"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    traceback.print_exc()
    headers = {}
    origin = request.headers.get("origin")
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"}, headers=headers)


app.include_router(teacher)
app.include_router(student)
app.include_router(ai_router)
app.include_router(classes_router)
app.include_router(favorites_router)
app.include_router(student_auth_router)
app.include_router(practice)


@app.get("/")
async def root():
    return {"service": "EduDown Pro", "docs": "/docs"}


@app.get("/health")
async def health():
    return {"status": "ok"}


# Подключаем папку с готовым фронтендом
import os as _os
_assets_dir = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "public", "assets")
_os.makedirs(_assets_dir, exist_ok=True)
app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets"),

# Отдаем index.html для всех остальных путей (чтобы работал React Router)
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    return FileResponse("public/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8001, reload=True, log_level="info")