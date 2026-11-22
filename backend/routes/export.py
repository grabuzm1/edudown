import io
import zipfile
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models import Teacher, Lesson, StudentSession, Submission
from auth import get_current_teacher
from app_utils import generate_filename, get_student_display_name, transliterate
from fastapi import APIRouter, Depends, HTTPException, Header

router = APIRouter(prefix="/api/teacher", tags=["export"])


@router.get("/lessons/{lesson_id}/export/zip")
async def export_lesson_zip(
        lesson_id: str,
        teacher: Teacher = Depends(get_current_teacher),
        db: AsyncSession = Depends(get_db)
):
    # Проверка, что урок принадлежит учителю
    result = await db.execute(
        select(Lesson).where(Lesson.id == lesson_id, Lesson.teacher_id == teacher.id)
    )
    lesson = result.scalar_one_or_none()
    if not lesson:
        raise HTTPException(status_code=404, detail="Урок не найден")

    # Получаем все сессии с сабмишенами
    sessions_result = await db.execute(
        select(StudentSession)
        .where(StudentSession.lesson_id == lesson_id)
        .options(
            selectinload(StudentSession.submissions).selectinload(Submission.task)
        )
    )
    sessions = sessions_result.scalars().all()

    zip_buffer = io.BytesIO()
    used_filenames = {}  # Для обработки коллизий

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for session in sessions:
            display_name = get_student_display_name(session)
            parts = display_name.split(" ", 1)
            surname = parts[0] if len(parts) > 0 else "Unknown"
            name = parts[1] if len(parts) > 1 else ""

            # Группируем сабмишены по задаче, берем последний (успешный)
            submissions_by_task = {}
            for sub in session.submissions:
                task_key = sub.task_id
                if task_key not in submissions_by_task:
                    submissions_by_task[task_key] = sub
                else:
                    # Берем последний по времени
                    if sub.created_at > submissions_by_task[task_key].created_at:
                        submissions_by_task[task_key] = sub

            for task_id, submission in submissions_by_task.items():
                date_str = submission.created_at.strftime("%Y-%m-%d")
                base_filename = generate_filename(
                    surname, name, submission.task.order_index, date_str
                )

                # Обработка коллизий
                filename = base_filename
                counter = 1
                while filename in used_filenames:
                    name_without_ext = base_filename[:-3]
                    filename = f"{name_without_ext}_v{counter}.py"
                    counter += 1

                used_filenames[filename] = True

                # Кладем в подпапку по имени ученика
                student_folder = transliterate(f"{surname}_{name}")
                path_in_zip = f"{student_folder}/{filename}"

                zip_file.writestr(path_in_zip, submission.code)

    zip_buffer.seek(0)

    lesson_name_safe = transliterate(lesson.title)[:30]
    archive_name = f"{datetime.utcnow().strftime('%Y-%m-%d')}_{lesson_name_safe}.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f'attachment; filename="{archive_name}"'}
    )


@router.get("/lessons/{lesson_id}/sessions/{session_id}/file")
async def export_single_file(
        lesson_id: str,
        session_id: str,
        task_order: int = 1,
        teacher: Teacher = Depends(get_current_teacher),
        db: AsyncSession = Depends(get_db)
):
    # Проверка прав
    result = await db.execute(
        select(Lesson).where(Lesson.id == lesson_id, Lesson.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Урок не найден")

    # Получаем сессию с сабмишенами
    result = await db.execute(
        select(StudentSession)
        .where(StudentSession.id == session_id, StudentSession.lesson_id == lesson_id)
        .options(selectinload(StudentSession.submissions).selectinload(Submission.task))
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")

    # Ищем последний сабмишен для нужной задачи
    target_submission = None
    for sub in session.submissions:
        if sub.task.order_index == task_order:
            if target_submission is None or sub.created_at > target_submission.created_at:
                target_submission = sub

    if not target_submission:
        raise HTTPException(status_code=404, detail="Решение для этого задания не найдено")

    display_name = get_student_display_name(session)
    parts = display_name.split(" ", 1)
    surname = parts[0] if len(parts) > 0 else "Unknown"
    name = parts[1] if len(parts) > 1 else ""

    date_str = target_submission.created_at.strftime("%Y-%m-%d")
    filename = generate_filename(surname, name, task_order, date_str)

    return StreamingResponse(
        io.BytesIO(target_submission.code.encode("utf-8")),
        media_type="text/x-python",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )