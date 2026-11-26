# backend/models.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Boolean, Text, DateTime, ForeignKey, JSON
from database import Base

def new_uuid() -> str:
    return str(uuid.uuid4())

class Teacher(Base):
    __tablename__ = "teachers"
    id = Column(String(36), primary_key=True, default=new_uuid)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    plus_until = Column(DateTime, nullable=True)

class StudentAccount(Base):
    __tablename__ = "student_accounts"
    id = Column(String(36), primary_key=True, default=new_uuid)
    login = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    surname = Column(String(100), nullable=False)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    down_id = Column(String(100), unique=True, index=True, nullable=True)
    plus_until = Column(DateTime, nullable=True)

class Class(Base):
    __tablename__ = "classes"
    id = Column(String(36), primary_key=True, default=new_uuid)
    teacher_id = Column(String(36), ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False)
    number = Column(Integer, nullable=False)
    letter = Column(String(5), nullable=False)
    custom_name = Column(String(100), nullable=True)
    note = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

class ClassStudent(Base):
    __tablename__ = "class_students"
    id = Column(String(36), primary_key=True, default=new_uuid)
    class_id = Column(String(36), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    surname = Column(String(100), nullable=False)
    name = Column(String(100), nullable=False)
    student_code = Column(String(20), unique=True, index=True, nullable=False)
    account_id = Column(String(36), ForeignKey("student_accounts.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Lesson(Base):
    __tablename__ = "lessons"
    id = Column(String(36), primary_key=True, default=new_uuid)
    teacher_id = Column(String(36), ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False)
    class_id = Column(String(36), ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    access_code = Column(String(50), unique=True, index=True, nullable=False)
    deadline = Column(DateTime, nullable=True)
    is_published = Column(Boolean, default=False)
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Task(Base):
    __tablename__ = "tasks"
    id = Column(String(36), primary_key=True, default=new_uuid)
    lesson_id = Column(String(36), ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False)
    order_index = Column(Integer, nullable=False, default=1)
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    starter_code = Column(Text, default="")
    ai_criteria = Column(Text, default="")
    ai_system_prompt = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

class FavoriteLesson(Base):
    __tablename__ = "favorite_lessons"
    id = Column(String(36), primary_key=True, default=new_uuid)
    teacher_id = Column(String(36), ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    tasks_json = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class StudentSession(Base):
    __tablename__ = "student_sessions"
    id = Column(String(36), primary_key=True, default=new_uuid)
    lesson_id = Column(String(36), ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(String(36), ForeignKey("class_students.id", ondelete="SET NULL"), nullable=True)
    account_id = Column(String(36), ForeignKey("student_accounts.id", ondelete="SET NULL"), nullable=True)
    down_user_id = Column(String(100), index=True, nullable=True)
    guest_surname = Column(String(100), default="")
    guest_name = Column(String(100), default="")
    guest_group = Column(String(50), default="")
    session_token = Column(String(255), unique=True, index=True, nullable=False)
    current_task_index = Column(Integer, default=0)
    is_completed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Submission(Base):
    __tablename__ = "submissions"
    id = Column(String(36), primary_key=True, default=new_uuid)
    session_id = Column(String(36), ForeignKey("student_sessions.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    code = Column(Text, nullable=False)
    stdout = Column(Text, default="")
    stderr = Column(Text, default="")
    execution_time_ms = Column(Integer, default=0)
    status = Column(String(50), default="checking")
    created_at = Column(DateTime, default=datetime.utcnow)

class AIReview(Base):
    __tablename__ = "ai_reviews"
    id = Column(String(36), primary_key=True, default=new_uuid)
    submission_id = Column(String(36), ForeignKey("submissions.id", ondelete="CASCADE"), unique=True, nullable=False)
    is_correct = Column(Boolean, nullable=False)
    score = Column(Integer, nullable=False)
    feedback = Column(Text, nullable=False)
    reasoning = Column(Text, default="")
    raw_llm_response = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Grade(Base):
    __tablename__ = "grades"
    id = Column(String(36), primary_key=True, default=new_uuid)
    session_id = Column(String(36), ForeignKey("student_sessions.id", ondelete="CASCADE"), unique=True, nullable=False)
    ai_final_score = Column(Integer, nullable=True)          # теперь: количество плюсов
    teacher_override_score = Column(Integer, nullable=True)  # legacy, не используется
    teacher_grade = Column(Integer, nullable=True)           # ручная оценка в журнал 2..5
    teacher_comment = Column(Text, default="")
    status = Column(String(50), default="pending")
    updated_at = Column(DateTime, default=datetime.utcnow)