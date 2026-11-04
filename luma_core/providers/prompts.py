"""Shared message serialization and configured-secret redaction."""
import json

from luma_core.agents.prompts import TaskPrompt
from luma_core.config import Settings


def redact_secrets(text: str, settings: Settings) -> str:
    secrets = [getattr(settings, name) for name in (
        'openai_api_key', 'openrouter_api_key', 'anthropic_api_key', 'local_owner_token',
    )]
    values = {secret.get_secret_value() for secret in secrets
              if secret and secret.get_secret_value().strip()}
    # Also redact JSON-escaped forms inside structured task content.
    values |= {json.dumps(value, ensure_ascii=False)[1:-1] for value in values}
    for value in sorted(values, key=len, reverse=True):
        text = text.replace(value, '[REDACTED]')
    return text


def provider_messages(prompt: TaskPrompt | str, settings: Settings) -> list[dict[str, str]]:
    # Preserve the original string calling convention for existing integrations.
    if isinstance(prompt, str):
        prompt = TaskPrompt(prompt)
    if not isinstance(prompt, TaskPrompt):
        raise TypeError('Expected TaskPrompt or string')
    return [{'role': message['role'], 'content': (message['content'] if message['role'] == 'system'
                                               else redact_secrets(message['content'], settings))}
            for message in prompt.messages()]
