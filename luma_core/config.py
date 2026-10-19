from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_env: str = "development"
    app_debug: bool = False
    app_host: str = "127.0.0.1"
    app_port: int = 8000

    database_url: str = "sqlite:///./luma.db"

    # AI provider keys are optional and never defaulted to real values.
    ollama_base_url: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None

    # Local owner token for the self-hosted MVP owner-authentication flow.
    # In production this must be overridden via environment variable.
    local_owner_token: SecretStr | None = None

    @property
    def is_debug(self) -> bool:
        return self.app_env == "development" and self.app_debug

    @property
    def database_url_echo(self) -> bool:
        return self.is_debug


@lru_cache
def get_settings() -> Settings:
    return Settings()
