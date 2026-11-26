from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).parent / ".env", extra="ignore")

    DEBUG: bool = False
    SECRET_KEY: str = "dev-secret-change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24
    DATABASE_URL: str = "sqlite+aiosqlite:///./edu_platform.db"

    AI_PROVIDER: str = "auto"
    AI_TIMEOUT: int = 60
    AITUNNEL_TIMEOUT: int = 30
    AITUNNEL_REASONING_EFFORT: str = "minimal"

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com"

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"

    GIGACHAT_AUTH_KEY: str = ""
    GIGACHAT_SCOPE: str = "GIGACHAT_API_PERS"
    GIGACHAT_MODEL: str = "GigaChat-3-Ultra"
    GIGACHAT_BASE_URL: str = "https://api.giga.chat/v1"
    GIGACHAT_OAUTH_URL: str = "https://api.giga.chat/api/v2/oauth"
    GIGACHAT_VERIFY_SSL: bool = False

    AITUNNEL_API_KEY: str = ""
    AITUNNEL_BASE_URL: str = "https://api.aitunnel.ru/v1"
    AITUNNEL_MODEL: str = "gpt-6-luna-pro"

    SANDBOX_TIMEOUT: int = 10
    SANDBOX_MAX_OUTPUT: int = 20000
    DOWN_API_URL: str = "https://imdown.pro"


def get_settings() -> Settings:
    return Settings()