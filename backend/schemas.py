from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# ====== Teacher Auth ======
class TeacherLogin(BaseModel):
    email: str
    password: str


class TeacherRegister(BaseModel):
    email: str
    password: str
    full_name: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ====== Lesson / Task ======
class TaskCreate(BaseModel):
    title: str
    description: str
    starter_code: str = ""
    ai_criteria: str
    ai_system_prompt: str = "Ты строгий, но доброжелательный учитель информатики."
    order_index: int


class TaskOut(TaskCreate):
    id: str
    lesson_id: str
    created_at: datetime


class LessonCreate(BaseModel):
    title: str
    description: str = ""
    deadline: Optional[datetime] = None


class LessonOut(BaseModel):
    id: str
    title: str
    description: str
    access_code: str
    deadline: Optional[datetime]
    is_published: bool
    created_at: datetime
    tasks: list[TaskOut] = []


class LessonPublish(BaseModel):
    is_published: bool


# ====== Student ======
class StudentJoinRequest(BaseModel):
    access_code: str
    surname: Optional[str] = None
    name: Optional[str] = None
    group: Optional[str] = None
    down_token: Optional[str] = None


class StudentJoinResponse(BaseModel):
    session_token: str
    current_task_index: int
    is_guest: bool
    student_display_name: str


class TaskForStudent(BaseModel):
    id: str
    order_index: int
    title: str
    description: str
    starter_code: str
    total_tasks: int


class ExecuteRequest(BaseModel):
    code: str


class ExecuteResponse(BaseModel):
    stdout: str
    stderr: str
    execution_time_ms: int
    timed_out: bool = False


class SubmitRequest(BaseModel):
    code: str


class SubmitResponse(BaseModel):
    submission_id: str
    status: str


class AIReviewOut(BaseModel):
    is_correct: bool
    score: int
    feedback: str
    reasoning: str


class SubmissionStatus(BaseModel):
    submission_id: str
    status: str
    stdout: str = ""
    stderr: str = ""
    review: Optional[AIReviewOut] = None


# ====== Teacher Dashboard ======
class StudentProgress(BaseModel):
    session_id: str
    display_name: str
    group: Optional[str]
    current_task_index: int
    total_tasks: int
    is_completed: bool
    ai_score: Optional[int]
    teacher_score: Optional[int]
    status: str


class GradeUpdate(BaseModel):
    score: Optional[int] = None
    comment: Optional[str] = None


# ====== LLM Schema ======
class AIReviewSchema(BaseModel):
    """Схема ответа LLM (используется в Groq structured output)."""
    is_correct: bool = Field(description="Правильно ли решено задание")
    score: int = Field(ge=0, le=100, description="Оценка от 0 до 100")
    feedback: str = Field(description="Обратная связь для ученика на 'ты'")
    reasoning: str = Field(description="Краткое обоснование для учителя")