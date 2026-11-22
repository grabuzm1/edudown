import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from database import get_db
from models import Teacher

settings = get_settings()
security = HTTPBearer(auto_error=False)

PBKDF2_ITERATIONS = 200_000
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${base64.b64encode(salt).decode('ascii')}${base64.b64encode(dk).decode('ascii')}"


def verify_password(plain: str, hashed: str) -> bool:
    try:
        if hashed.startswith("pbkdf2_sha256$"):
            _algo, salt_b64, hash_b64 = hashed.split("$")
            salt = base64.b64decode(salt_b64)
            stored = base64.b64decode(hash_b64)
            dk = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), salt, PBKDF2_ITERATIONS)
            return hmac.compare_digest(dk, stored)
        if hashed.startswith(("$2b$", "$2a$", "$2y$")):
            import bcrypt
            return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False
    return False


def create_access_token(teacher_id: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=getattr(settings, "ACCESS_TOKEN_EXPIRE_MINUTES", 1440))
    payload = {"sub": teacher_id, "exp": expire, "type": "teacher"}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=getattr(settings, "ALGORITHM", "HS256"))


async def get_current_teacher(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> Teacher:
    if credentials is None:
        raise HTTPException(401, "Требуется авторизация учителя")
    try:
        payload = jwt.decode(credentials.credentials, settings.SECRET_KEY,
                             algorithms=[getattr(settings, "ALGORITHM", "HS256")])
        teacher_id = payload.get("sub")
        if not teacher_id or payload.get("type") != "teacher":
            raise HTTPException(401, "Невалидный токен")
    except JWTError:
        raise HTTPException(401, "Невалидный токен")
    teacher = (await db.execute(select(Teacher).where(Teacher.id == teacher_id))).scalar_one_or_none()
    if teacher is None:
        raise HTTPException(401, "Учитель не найден")
    return teacher


async def verify_down_token(token: str) -> dict | None:
    if not token:
        return None
    try:
        import httpx
        base = getattr(settings, "DOWN_API_URL", "https://imdown.pro")
        secret = getattr(settings, "DOWN_SHARED_SECRET", "")
        async with httpx.AsyncClient(timeout=3.0) as client:
            if secret:
                r = await client.post(f"{base}/api/verify-token", json={"token": token, "secret": secret})
            else:
                r = await client.get(f"{base}/api/walldown/me", headers={"Authorization": f"Bearer {token}"})
            if r.status_code == 200:
                d = r.json()
                return {"user_id": str(d.get("id") or d.get("user_id")), "name": d.get("name", ""),
                        "surname": d.get("surname", ""), "group": d.get("group", "")}
    except Exception as e:
        print(f"[Down ID] Ошибка проверки токена: {e}")
    return None


def generate_access_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))


def generate_session_token() -> str:
    return secrets.token_urlsafe(32)