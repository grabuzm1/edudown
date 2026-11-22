from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Отладка ────────────────────────────────────────
    DEBUG: bool = True

    # ── AI ─────────────────────────────────────────────
    AI_PROVIDER: str = "gigachat"        # gemini | openai | gigachat | auto | local
    AI_TIMEOUT: float = 30.0

    GEMINI_API_KEY: str = ""
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com"
    GEMINI_MODEL: str = "gemini-2.0-flash"

    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o-mini"

    # ── GigaChat ───────────────────────────────────────
    GIGACHAT_AUTH_KEY: str = ""
    GIGACHAT_SCOPE: str = "GIGACHAT_API_PERS"
    GIGACHAT_BASE_URL: str = "https://gigachat.devices.sberbank.ru/api/v1"
    GIGACHAT_OAUTH_URL: str = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
    GIGACHAT_MODEL: str = "GigaChat"
    GIGACHAT_VERIFY_SSL: bool = False

    # ── Безопасность ───────────────────────────────────
    SECRET_KEY: str = "change-me-in-prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    # ── Песочница ──────────────────────────────────────
    SANDBOX_TIMEOUT: float = 10.0        # Увеличено с 5.0 до 10.0 для стабильности
    SANDBOX_MAX_OUTPUT: int = 20000

    # ── БД ─────────────────────────────────────────────
    DATABASE_URL: str = "sqlite+aiosqlite:///./edudown.db"

    # ── Прочее ─────────────────────────────────────────
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

_settings: Settings | None = None

def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
        # ── Down ID (imdown.pro) ───────────────────────────
        DOWN_API_URL: str = "https://imdown.pro"
        DOWNID_BRIDGE_SECRET: str = ""
    return _settings