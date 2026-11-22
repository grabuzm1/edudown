import io
import zipfile
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Teacher, Lesson, Task, StudentSession, Submission, Grade, AIReview
from auth import hash_password, verify_password, create_access_token, get_current_teacher, generate_access_code

router = APIRouter(prefix="/api/teacher", tags=["teacher"])


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
    score: int = Field(ge=0, le=100)
    comment: str = ""


def lesson_dict(l: Lesson, task_count: int = 0, student_count: int = 0) -> dict:
    return {
        "id": l.id, "title": l.title, "description": l.description or "",
        "access_code": l.access_code, "is_published": bool(l.is_published),
        "deadline": l.deadline.isoformat() if l.deadline else None,
        "created_at": l.created_at.isoformat() if l.created_at else None,
        "task_count": task_count, "student_count": student_count,
    }


def task_dict(t: Task) -> dict:
    return {
        "id": t.id, "lesson_id": t.lesson_id, "order_index": t.order_index,
        "title": t.title, "description": t.description or "",
        "starter_code": t.starter_code or "", "ai_criteria": t.ai_criteria or "",
        "ai_system_prompt": t.ai_system_prompt or "",
    }


async def _own_lesson(lesson_id: str, teacher: Teacher, db: AsyncSession) -> Lesson:
    l = (await db.execute(select(Lesson).where(Lesson.id == lesson_id))).scalar_one_or_none()
    if not l or l.teacher_id != teacher.id:
        raise HTTPException(404, "Урок не найден")
    return l


@router.post("/register")
async def register(data: RegisterIn, db: AsyncSession = Depends(get_db)):
    exists = (await db.execute(select(Teacher).where(Teacher.email == data.email.lower()))).scalar_one_or_none()
    if exists:
        raise HTTPException(400, "Учитель с таким email уже существует")
    t = Teacher(email=data.email.lower(), password_hash=hash_password(data.password), full_name=data.full_name)
    db.add(t)
    await db.flush()
    return {"access_token": create_access_token(t.id), "token_type": "bearer", "full_name": t.full_name}


@router.post("/login")
async def login(data: LoginIn, db: AsyncSession = Depends(get_db)):
    t = (await db.execute(select(Teacher).where(Teacher.email == data.email.lower()))).scalar_one_or_none()
    if not t or not verify_password(data.password, t.password_hash):
        raise HTTPException(401, "Неверный email или пароль")
    return {"access_token": create_access_token(t.id), "token_type": "bearer", "full_name": t.full_name}


@router.get("/me")
async def me(teacher: Teacher = Depends(get_current_teacher)):
    return {"id": teacher.id, "email": teacher.email, "full_name": teacher.full_name}


@router.get("/lessons")
async def list_lessons(teacher: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    lessons = (await db.execute(select(Lesson).where(Lesson.teacher_id == teacher.id).order_by(Lesson.created_at.desc()))).scalars().all()
    out = []
    for l in lessons:
        tc = (await db.execute(select(func.count(Task.id)).where(Task.lesson_id == l.id))).scalar() or 0
        sc = (await db.execute(select(func.count(StudentSession.id)).where(StudentSession.lesson_id == l.id))).scalar() or 0
        out.append(lesson_dict(l, tc, sc))
    return out


@router.post("/lessons")
async def create_lesson(data: LessonIn, teacher: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    code = generate_access_code()
    while (await db.execute(select(Lesson).where(Lesson.access_code == code))).scalar_one_or_none():
        code = generate_access_code()
    l = Lesson(teacher_id=teacher.id, title=data.title, description=data.description, deadline=data.deadline, access_code=code)
    db.add(l)
    await db.flush()
    return lesson_dict(l)


@router.get("/lessons/{lesson_id}")
async def get_lesson(lesson_id: str, teacher: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    l = await _own_lesson(lesson_id, teacher, db)
    tasks = (await db.execute(select(Task).where(Task.lesson_id == l.id).order_by(Task.order_index))).scalars().all()
    sessions = (await db.execute(select(StudentSession).where(StudentSession.lesson_id == l.id).order_by(StudentSession.created_at))).scalars().all()
    students = []
    for s in sessions:
        g = (await db.execute(select(Grade).where(Grade.session_id == s.id))).scalar_one_or_none()
        name = (s.guest_surname or "") + " " + (s.guest_name or "")
        students.append({
            "session_id": s.id,
            "display_name": name.strip() or s.down_user_id or "Ученик",
            "group": s.guest_group or "",
            "current_task_index": s.current_task_index or 0,
            "is_completed": bool(s.is_completed),
            "ai_score": g.ai_final_score if g else None,
            "teacher_score": g.teacher_override_score if g else None,
            "teacher_comment": g.teacher_comment if g else "",
        })
    return {**lesson_dict(l, len(tasks), len(sessions)), "tasks": [task_dict(t) for t in tasks], "students": students}


@router.patch("/lessons/{lesson_id}")
async def patch_lesson(lesson_id: str, data: LessonPatch, teacher: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    l = await _own_lesson(lesson_id, teacher, db)
    if data.title is not None: l.title = data.title
    if data.description is not None: l.description = data.description
    if data.is_published is not None: l.is_published = data.is_published
    await db.flush()
    return lesson_dict(l)


@router.patch("/lessons/{lesson_id}/publish")
async def publish_lesson(lesson_id: str, data: LessonPatch, teacher: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    l = await _own_lesson(lesson_id, teacher, db)
    l.is_published = True if data.is_published is None else data.is_published
    await db.flush()
    return lesson_dict(l)


@router.delete("/lessons/{lesson_id}")
async def delete_lesson(lesson_id: str, teacher: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    l = await _own_lesson(lesson_id, teacher, db)
    await db.execute(delete(Task).where(Task.lesson_id == l.id))
    await db.delete(l)
    return {"ok": True}


@router.post("/lessons/{lesson_id}/tasks")
async def create_task(lesson_id: str, data: TaskIn, teacher: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    await _own_lesson(lesson_id, teacher, db)
    t = Task(lesson_id=lesson_id, order_index=data.order_index, title=data.title, description=data.description,
             starter_code=data.starter_code, ai_criteria=data.ai_criteria, ai_system_prompt=data.ai_system_prompt)
    db.add(t)
    await db.flush()
    return task_dict(t)


@router.patch("/tasks/{task_id}")
async def patch_task(task_id: str, data: TaskPatch, teacher: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    t = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if not t: raise HTTPException(404, "Задание не найдено")
    await _own_lesson(t.lesson_id, teacher, db)
    for field in ("title", "description", "starter_code", "ai_criteria", "ai_system_prompt", "order_index"):
        v = getattr(data, field)
        if v is not None: setattr(t, field, v)
    await db.flush()
    return task_dict(t)


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, teacher: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    t = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if not t: raise HTTPException(404, "Задание не найдено")
    await _own_lesson(t.lesson_id, teacher, db)
    await db.delete(t)
    return {"ok": True}


@router.patch("/sessions/{session_id}/grade")
async def override_grade(session_id: str, data: GradeIn, teacher: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    s = (await db.execute(select(StudentSession).where(StudentSession.id == session_id))).scalar_one_or_none()
    if not s: raise HTTPException(404, "Сессия не найдена")
    await _own_lesson(s.lesson_id, teacher, db)
    g = (await db.execute(select(Grade).where(Grade.session_id == s.id))).scalar_one_or_none()
    if not g:
        g = Grade(session_id=s.id)
        db.add(g)
    g.teacher_override_score = data.score
    g.teacher_comment = data.comment
    g.status = "reviewed"
    g.updated_at = datetime.utcnow()
    await db.flush()
    return {"ok": True, "score": data.score}


@router.get("/lessons/{lesson_id}/export")
async def export_lesson(lesson_id: str, teacher: Teacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    l = await _own_lesson(lesson_id, teacher, db)
    sessions = (await db.execute(select(StudentSession).where(StudentSession.lesson_id == l.id))).scalars().all()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for s in sessions:
            subs = (await db.execute(select(Submission).where(Submission.session_id == s.id).order_by(Submission.created_at))).scalars().all()
            name = ((s.guest_surname or "student") + "_" + (s.guest_name or "")).strip("_") or s.id[:8]
            for i, sub in enumerate(subs, 1):
                z.writestr(f"{name}/task_{i:02d}.py", sub.code or "")
            g = (await db.execute(select(Grade).where(Grade.session_id == s.id))).scalar_one_or_none()
            score = (g.teacher_override_score if g and g.teacher_override_score is not None else (g.ai_final_score if g else None))
            z.writestr(f"{name}/info.txt", f"Ученик: {name}\nГруппа: {s.guest_group or '-'}\nОценка: {score if score is not None else '-'}\nЗавершён: {bool(s.is_completed)}\n")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{l.access_code}_solutions.zip"'})