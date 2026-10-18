from abc import ABC, abstractmethod
from dataclasses import dataclass

from luma_core.config import Settings


@dataclass
class ProviderResponse:
    text: str
    model: str | None = None
    usage: dict[str, int] | None = None


class BaseModelProvider(ABC):
    """Provider-agnostic interface for cloud and offline AI providers.

    Phase 1 defines the contract. Concrete providers are wired later.
    """

    settings: Settings

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    @abstractmethod
    def is_available(self) -> bool:
        ...

    @abstractmethod
    async def chat(self, prompt: str, **kwargs: object) -> ProviderResponse:
        ...


class UnavailableProvider(BaseModelProvider):
    """A provider that is not configured yet.

    This is the default so the system starts without any model backend.
    """

    @property
    def is_available(self) -> bool:
        return False

    async def chat(self, prompt: str, **kwargs: object) -> ProviderResponse:
        raise RuntimeError("No AI provider is configured")
