"""Fixed-endpoint, no-retry image adapters; never fetch provider-supplied URLs."""

import base64
import json
import math
from dataclasses import dataclass

import httpx

# Deliberately separate from the text/vision model registry. Masks are not exposed.
MODELS = {
    "openai": {"gpt-image-2": {"reference": True, "max_n": 4}},
    "openrouter": {"bytedance-seed/seedream-4.5": {"reference": True, "max_n": 4}},
}


@dataclass(frozen=True)
class ImageResult:
    images: tuple[tuple[bytes, str], ...]
    model: str
    usage: dict


class ImageExecutionPending(Exception):
    """Remote acceptance or completion is uncertain; retain the physical slot."""


class ImageProviderError(Exception):
    pass


def safe_usage(data):
    # Do not retain raw upstream metadata, headers, errors or text in usage/audit.
    return {
        key: value
        for key, value in (data or {}).items()
        if key
        in (
            "input_tokens",
            "output_tokens",
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
            "cost",
        )
        and type(value) in (int, float)
        and math.isfinite(value)
        and value >= 0
    }


class ImageProvider:
    def __init__(self, settings):
        self.settings = settings

    @property
    def available(self):
        key = getattr(self.settings, self.settings.image_provider + "_api_key", None)
        return bool(key and key.get_secret_value().strip())

    async def generate(self, prompt, model, quality, ratio, n, reference=None):
        settings = self.settings
        provider = settings.image_provider
        key = getattr(settings, provider + "_api_key").get_secret_value()
        payload = {
            "model": model,
            "prompt": prompt,
            "n": n,
            "quality": quality,
            "output_format": "png",
        }
        if provider == "openai":
            payload["size"] = {
                "1:1": "1024x1024",
                "16:9": "1536x864",
                "9:16": "864x1536",
            }[ratio]
            url = "https://api.openai.com/v1/images/" + (
                "edits" if reference else "generations"
            )
            kwargs = (
                {"json": payload}
                if not reference
                else {
                    "data": {k: str(v) for k, v in payload.items()},
                    "files": {
                        "image": (
                            "reference." + reference[1].split("/")[1],
                            reference[0],
                            reference[1],
                        )
                    },
                }
            )
        else:
            url = "https://openrouter.ai/api/v1/images"
            payload["aspect_ratio"] = ratio
            if reference:
                payload["input_references"] = [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:"
                            + reference[1]
                            + ";base64,"
                            + base64.b64encode(reference[0]).decode()
                        },
                    }
                ]
            kwargs = {"json": payload}
        try:
            # Bound JSON/base64 bytes while streaming, before response.json can allocate them.
            async with httpx.AsyncClient(
                timeout=settings.image_timeout_seconds, follow_redirects=False
            ) as client:
                async with client.stream(
                    "POST",
                    url,
                    headers={
                        "Authorization": "Bearer " + key,
                        "Accept-Encoding": "identity",
                    },
                    **kwargs,
                ) as response:
                    if response.status_code in (400, 403, 422):
                        raise ImageProviderError(
                            "Image request refused or unsupported by provider; review the prompt and model settings"
                        )
                    response.raise_for_status()
                    if (
                        response.headers.get("Content-Encoding", "identity")
                        != "identity"
                    ):
                        raise ValueError("Unexpected response encoding")
                    raw = bytearray()
                    async for part in response.aiter_bytes():
                        if (
                            len(raw) + len(part)
                            > settings.image_max_output_bytes * 4 // 3 + 65536
                        ):
                            raise ValueError("Output budget")
                        raw.extend(part)
            data = json.loads(raw)
            items = data["data"]
            if not isinstance(items, list) or not 1 <= len(items) <= n:
                raise ValueError("Image count")
            result = []
            size = 0
            for item in items:
                content = base64.b64decode(item["b64_json"], validate=True)
                size += len(content)
                mime = item.get("media_type") or (
                    "image/png"
                    if content.startswith(b"\x89PNG")
                    else "image/jpeg"
                    if content.startswith(b"\xff\xd8")
                    else "image/webp"
                )
                if (
                    not content
                    or size > settings.image_max_output_bytes
                    or mime not in ("image/png", "image/jpeg", "image/webp")
                ):
                    raise ValueError("Invalid image")
                result.append((content, mime))
            return ImageResult(tuple(result), model, safe_usage(data.get("usage")))
        except ImageProviderError:
            raise
        except Exception:
            raise ImageProviderError(
                "Image provider request failed; no automatic retry was made"
            ) from None
