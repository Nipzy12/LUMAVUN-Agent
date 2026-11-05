from functools import lru_cache

from typing import Literal

from pydantic import SecretStr, Field
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
    openai_api_key: SecretStr | None = None
    ai_provider: Literal["unavailable", "openai", "openrouter"] = "unavailable"
    openai_model: str = "gpt-4o-mini"
    openrouter_api_key: SecretStr | None = None
    openrouter_model: str = "openai/gpt-4o-mini"
    ai_timeout_seconds: float = Field(default=60, gt=0, le=300)
    ai_max_output_tokens: int = Field(default=1024, ge=1, le=8192)
    anthropic_api_key: SecretStr | None = None

    # Local owner token for the self-hosted MVP owner-authentication flow.
    # In production this must be overridden via environment variable.
    local_owner_token: SecretStr | None = None
    # Stable identity, independent of token rotation. Never accepted from clients.
    local_owner_id: str = Field(default="local-owner", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.-]+$")
    conversation_context_max_messages: int = Field(default=20, ge=0, le=100)
    conversation_context_max_chars: int = Field(default=12000, ge=0, le=100000)

    # Text chat presets are server-controlled; no client endpoints or credentials.
    openai_chat_low_model: str | None = None
    openai_chat_medium_model: str | None = None
    openai_chat_high_model: str | None = None
    openrouter_chat_low_model: str | None = None
    openrouter_chat_medium_model: str | None = None
    openrouter_chat_high_model: str | None = None
    chat_low_tokens: int = Field(default=256, ge=1, le=8192)
    chat_medium_tokens: int = Field(default=1024, ge=1, le=8192)
    chat_high_tokens: int = Field(default=2048, ge=1, le=8192)
    chat_image_models: str = "gpt-4o-mini,openai/gpt-4o-mini"
    chat_attachment_ttl_hours: int = Field(default=24, ge=1, le=8760)
    chat_attachment_dir: str = "./private_uploads"

    @property
    def is_debug(self) -> bool:
        return self.app_env == "development" and self.app_debug

    @property
    def database_url_echo(self) -> bool:
        return self.is_debug


@lru_cache
def get_settings() -> Settings:
    return Settings()
