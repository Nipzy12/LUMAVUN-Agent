"""Text-only OpenAI adapter. No tools, execution, or automatic retries."""
import httpx

from luma_core.providers.base import BaseModelProvider, ProviderResponse
from luma_core.agents.prompts import TaskPrompt
from luma_core.providers.prompts import provider_messages, redact_secrets


class OpenAIProvider(BaseModelProvider):
    @property
    def is_available(self) -> bool:
        return bool(self.settings.openai_api_key and self.settings.openai_api_key.get_secret_value().strip())

    async def chat(self, prompt: TaskPrompt | str, **kwargs: object) -> ProviderResponse:
        if not self.is_available:
            raise RuntimeError("Cloud provider is not configured")
        model = kwargs.get("model", self.settings.openai_model)
        try:
            async with httpx.AsyncClient(timeout=self.settings.ai_timeout_seconds) as client:
                response = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {self.settings.openai_api_key.get_secret_value()}"},
                    json={"model": model,
                          "messages": provider_messages(prompt, self.settings),
                          "max_completion_tokens": kwargs.get("max_tokens", self.settings.ai_max_output_tokens)},
                )
                response.raise_for_status()
                data = response.json()
                text = data["choices"][0]["message"]["content"]
                if not isinstance(text, str) or not text.strip():
                    raise ValueError("Empty response")
                text = redact_secrets(text, self.settings)
                return ProviderResponse(text=text, model=redact_secrets(str(model), self.settings))
        except Exception:
            # Never expose response bodies, headers, keys, or raw transport errors.
            raise RuntimeError("Cloud provider request failed") from None
