from typing import Type

from luma_core.config import Settings
from luma_core.providers.base import BaseModelProvider, UnavailableProvider


class ProviderRegistry:
    """Registers and resolves model providers by name.

    Phase 1: only the unavailable default is registered. Future phases add
    Ollama, OpenAI, Anthropic, and any other provider without coupling the
    core to their SDKs.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._providers: dict[str, type[BaseModelProvider]] = {
            "unavailable": UnavailableProvider,
        }

    def register(self, name: str, provider_cls: type[BaseModelProvider]) -> None:
        self._providers[name] = provider_cls

    def get(self, name: str | None = None) -> BaseModelProvider:
        if name is None:
            name = "unavailable"
        provider_cls = self._providers.get(name, UnavailableProvider)
        return provider_cls(self._settings)


def create_registry(settings: Settings) -> ProviderRegistry:
    return ProviderRegistry(settings)
