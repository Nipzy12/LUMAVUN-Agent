"""Optional trusted ComfyUI adapter. Templates are code, never browser workflow JSON."""

import asyncio
import hashlib
import ipaddress
import json
import re
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from pydantic import BaseModel, ConfigDict, Field

from luma_core.providers.images import ImageProviderError, ImageResult
from luma_core.providers.prompts import redact_secrets


class ComfyRejected(ImageProviderError):
    pass


_hash_cache = {}

NODES = {
    "CheckpointLoaderSimple",
    "CLIPTextEncode",
    "KSampler",
    "VAEDecode",
    "SaveImage",
    "EmptyLatentImage",
    "LoadImage",
    "ImageScale",
    "VAEEncode",
    "InpaintModelConditioning",
    "ImageToMask",
    "LoraLoader",
}


class LoraSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-zA-Z0-9_.-]{1,80}$")
    strength: float = Field(default=1, ge=-1, le=1.5, allow_inf_nan=False)


def safe_relative(value):
    if (
        not isinstance(value, str)
        or not value
        or "\\" in value
        or ":" in value
        or "%" in value
        or "?" in value
        or "#" in value
        or "\x00" in value
    ):
        raise ValueError("Invalid backend filename")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in (".", "..") for part in value.split("/")):
        raise ValueError("Invalid backend filename")
    return value


def endpoint(settings, engine):
    if not settings.comfyui_enabled:
        raise ImageProviderError("ComfyUI is disabled")
    url = (
        settings.comfyui_local_url
        if engine == "comfy_local"
        else settings.comfyui_remote_url
        if engine == "comfy_remote"
        else None
    )
    parsed = urlsplit(url or "")
    trusted = {
        x.strip().rstrip("/")
        for x in settings.comfyui_trusted_origins.split(",")
        if x.strip()
    }
    if (
        not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
        or parsed.scheme not in ("http", "https")
        or (url or "").rstrip("/") not in trusted
    ):
        raise ImageProviderError("ComfyUI endpoint is not trusted")
    try:
        address = ipaddress.ip_address(parsed.hostname)
        if address.is_link_local or address.is_unspecified or address.is_multicast:
            raise ImageProviderError("ComfyUI endpoint is not trusted")
        loopback = address.is_loopback
    except ValueError:
        loopback = parsed.hostname == "localhost"
    if parsed.scheme == "http" and not loopback:
        raise ImageProviderError("Remote ComfyUI requires HTTPS")
    return (url or "").rstrip("/") + "/"


class ComfyUI:
    def __init__(self, settings, engine):
        self.settings = settings
        self.engine = engine
        self.url = endpoint(settings, engine)
        self.headers = {"Accept-Encoding": "identity"}
        if settings.comfyui_token:
            self.headers["Authorization"] = (
                "Bearer " + settings.comfyui_token.get_secret_value()
            )

    async def request(self, method, path, *, limit=8 * 1024 * 1024, **kwargs):
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                async with client.stream(
                    method, self.url + path, headers=self.headers, **kwargs
                ) as response:
                    if (
                        method == "POST"
                        and path == "prompt"
                        and response.status_code in (400, 401, 403, 404, 422)
                    ):
                        raise ComfyRejected("ComfyUI rejected the workflow")
                    response.raise_for_status()
                    if (
                        response.headers.get("content-encoding", "identity")
                        != "identity"
                    ):
                        raise ValueError()
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(body) + len(chunk) > limit:
                            raise ValueError()
                        body.extend(chunk)
            return bytes(body)
        except ComfyRejected:
            raise
        except Exception:
            raise ImageProviderError(
                "ComfyUI request unavailable or rejected"
            ) from None

    async def json(self, method, path, **kwargs):
        try:
            return json.loads(await self.request(method, path, **kwargs))
        except ComfyRejected:
            raise
        except Exception:
            raise ImageProviderError("Invalid ComfyUI response") from None

    async def catalog(self):
        await self.json("GET", "system_stats", limit=256 * 1024)
        info = await self.json("GET", "object_info")
        if not isinstance(info, dict):
            raise ImageProviderError("Invalid ComfyUI catalog")
        try:
            files = info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
            loras = (
                info.get("LoraLoader", {})
                .get("input", {})
                .get("required", {})
                .get("lora_name", [[]])[0]
            )
            if not isinstance(files, list) or not isinstance(loras, list):
                raise ValueError()
        except Exception:
            raise ImageProviderError("Required ComfyUI nodes missing") from None
        manifest = {"models": [], "loras": []}
        if self.settings.comfyui_manifest:
            path = Path(self.settings.comfyui_manifest)
            if path.stat().st_size > 256 * 1024:
                raise ImageProviderError("Model manifest too large")
            manifest = json.loads(path.read_text(encoding="utf-8"))
        result = {"models": [], "loras": [], "nodes": set(info), "internal": {}}
        for kind, available in [("models", files), ("loras", loras)]:
            available_map = {}
            for choice in available:
                key = safe_relative(choice.replace("\\", "/"))
                if key in available_map and available_map[key] != choice:
                    raise ImageProviderError("Ambiguous model catalog")
                available_map[key] = choice
            records = manifest.get(kind, [])
            if not isinstance(records, list) or len(records) > 200:
                raise ImageProviderError("Invalid model manifest")
            for record in records:
                if not isinstance(record, dict):
                    raise ImageProviderError("Invalid model manifest")
                identifier = record.get("id", "")
                if not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", identifier):
                    raise ImageProviderError("Invalid manifest identifier")
                if redact_secrets(identifier, self.settings) != identifier:
                    raise ImageProviderError(
                        "Manifest identifiers must not contain configured secrets"
                    )
                filename = safe_relative(record.get("file", "").replace("\\", "/"))
                family = record.get("family", "unknown")
                trusted = (
                    re.fullmatch(r"[a-f0-9]{64}", record.get("sha256", "")) is not None
                    and record.get("verified_by_operator") is True
                    and bool(record.get("license"))
                    and bool(record.get("source"))
                )
                verified = "operator-attested" if trusted else "unverified"
                if trusted and self.settings.comfyui_model_root:
                    base = (
                        Path(self.settings.comfyui_model_root)
                        / ("checkpoints" if kind == "models" else "loras")
                    ).resolve()
                    path = (base / filename).resolve()
                    try:
                        path.relative_to(base)
                    except ValueError:
                        trusted = False
                    else:

                        def digest():
                            before = path.stat()
                            cache_key = (str(path), before.st_size, before.st_mtime_ns)
                            if cache_key in _hash_cache:
                                return _hash_cache[cache_key]
                            sha = hashlib.sha256()
                            if before.st_size > 16 * 1024**3:
                                return ""
                            with path.open("rb") as file:
                                while block := file.read(1024 * 1024):
                                    sha.update(block)
                            after = path.stat()
                            if (before.st_size, before.st_mtime_ns) != (
                                after.st_size,
                                after.st_mtime_ns,
                            ):
                                return ""
                            if len(_hash_cache) >= 64:
                                _hash_cache.clear()
                            _hash_cache[cache_key] = sha.hexdigest()
                            return sha.hexdigest()

                        try:
                            trusted = (
                                await asyncio.to_thread(digest) == record["sha256"]
                            )
                        except OSError:
                            trusted = False
                    verified = "hash-verified" if trusted else "hash-mismatch"
                compatible = (
                    family in ("sd15", "sdxl")
                    and filename.lower().endswith(".safetensors")
                    and trusted
                )
                available_now = filename in available_map
                ready = compatible and available_now
                result[kind].append(
                    {
                        "id": identifier,
                        "display_name": str(record.get("display_name", identifier))[
                            :128
                        ],
                        "version": str(record.get("version", "unspecified"))[:64],
                        "family": family,
                        "available": available_now,
                        "compatible": compatible,
                        "ready": ready,
                        "verification": verified,
                        "sha256": record.get("sha256", ""),
                        "license": str(record.get("license", "unknown"))[:512],
                        "source": str(record.get("source", ""))[:1024],
                        "private_only": record.get("private_only") is True,
                        "compatible_models": record.get("compatible_models", []),
                        "adult_content_permitted": record.get("adult_content_permitted")
                        is True,
                        "inpaint": record.get("inpaint") is True,
                        "requirements": "Approx. 4–6 GB VRAM"
                        if family == "sd15"
                        else "Approx. 8–12 GB VRAM; workflow dependent",
                        "reason": None
                        if ready
                        else "Missing model, unsupported family/extension, or unverified metadata",
                    }
                )
                result["internal"][(kind, identifier)] = {
                    **record,
                    "file": available_map.get(filename, filename),
                    "canonical_file": filename,
                    "ready": ready,
                }
        # Unknown catalog entries are discoverable but never executable without reviewed metadata.
        known = {
            r["canonical_file"]
            for k, r in result["internal"].items()
            if k[0] == "models"
        }
        for filename in [
            safe_relative(name.replace("\\", "/")) for name in files[:200]
        ]:
            if filename not in known:
                result["models"].append(
                    {
                        "id": "unmanaged-"
                        + hashlib.sha256(str(filename).encode()).hexdigest()[:16],
                        "display_name": PurePosixPath(str(filename)).name,
                        "family": "unknown",
                        "available": True,
                        "compatible": False,
                        "ready": False,
                        "reason": "Operator manifest and verified model metadata required",
                        "private_only": False,
                        "version": "unknown",
                        "license": "unknown",
                        "source": "",
                        "verification": "unverified",
                        "inpaint": False,
                        "requirements": "Unknown",
                    }
                )
        return result

    async def upload(self, content, mime):
        filename = (
            str(uuid4())
            + "."
            + {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime]
        )
        data = await self.json(
            "POST",
            "upload/image",
            files={"image": (filename, content, mime)},
            data={"type": "input", "subfolder": "luma", "overwrite": "false"},
        )
        if (
            data.get("name") != filename
            or data.get("subfolder") != "luma"
            or data.get("type") != "input"
        ):
            raise ImageProviderError("Invalid ComfyUI upload result")
        return "luma/" + filename

    async def submit(self, graph, job_id):
        result = await self.json(
            "POST",
            "prompt",
            json={
                "prompt": graph,
                "client_id": job_id,
                "extra_data": {"luma_execution": job_id},
            },
        )
        if result.get("node_errors") and not result.get("prompt_id"):
            raise ComfyRejected("ComfyUI rejected the workflow")
        try:
            return str(UUID(result["prompt_id"]))
        except Exception:
            raise ImageProviderError("ComfyUI submission uncertain") from None

    async def history(self, prompt_id):
        return (await self.json("GET", "history/" + str(UUID(prompt_id)))).get(
            prompt_id
        )

    async def outputs(self, history, model):
        try:
            if history.get("status", {}).get("status_str") == "error":
                raise ValueError()
            images = history["outputs"]["save"]["images"]
            if (
                not isinstance(images, list)
                or not 1 <= len(images) <= self.settings.image_max_per_generation
            ):
                raise ValueError()
            result = []
            total = 0
            for image in images:
                filename = safe_relative(image["filename"])
                folder = image.get("subfolder", "")
                if (
                    "/" in filename
                    or (folder and safe_relative(folder) != folder)
                    or image.get("type") != "output"
                ):
                    raise ValueError()
                if not filename.lower().endswith(".png"):
                    raise ValueError()
                blob = await self.request(
                    "GET",
                    "view",
                    limit=self.settings.image_max_output_bytes,
                    params={
                        "filename": filename,
                        "subfolder": folder,
                        "type": "output",
                    },
                )
                total += len(blob)
                if total > self.settings.image_max_output_bytes:
                    raise ValueError()
                from io import BytesIO
                from PIL import Image

                with Image.open(BytesIO(blob)) as decoded:
                    if decoded.width * decoded.height > self.settings.studio_max_pixels:
                        raise ValueError()
                result.append((blob, "image/png"))
            return ImageResult(tuple(result), model, {})
        except Exception:
            raise ImageProviderError("Invalid or failed ComfyUI output") from None

    async def active(self, prompt_id):
        data = await self.json("GET", "queue")
        try:
            running, pending = data["queue_running"], data["queue_pending"]
            if not isinstance(running, list) or not isinstance(pending, list):
                raise ValueError()
            if any(
                not isinstance(item, list)
                or len(item) < 2
                or not isinstance(item[1], str)
                for item in running + pending
            ):
                raise ValueError("Malformed queue entry")
            return any(item[1] == prompt_id for item in running + pending)
        except Exception:
            raise ImageProviderError("ComfyUI queue state unavailable") from None

    async def interrupt(self, prompt_id):
        # Never call legacy global /interrupt or clear the shared queue.
        try:
            return bool(
                (
                    await self.json(
                        "POST", "api/jobs/" + str(UUID(prompt_id)) + "/cancel"
                    )
                ).get("cancelled")
            )
        except ImageProviderError:
            return False

    async def websocket_progress(self, job_id, prompt_id, queue):
        # Optional dependency and best-effort progress only. Binary previews are never relayed.
        try:
            from websockets.asyncio.client import connect

            url = (
                self.url.replace("https://", "wss://").replace("http://", "ws://")
                + "ws?clientId="
                + str(UUID(job_id))
            )
            connection = connect(
                url, additional_headers=self.headers, max_size=65536, open_timeout=5
            )
            # websockets follows handshake redirects by default. Never let a
            # configured origin redirect progress requests to another endpoint.
            connection.process_redirect = lambda error: error
            async with connection as socket:
                async for message in socket:
                    if not isinstance(message, str):
                        continue
                    event = json.loads(message)
                    data = event.get("data", {})
                    if (
                        event.get("type") == "progress"
                        and data.get("prompt_id") == prompt_id
                    ):
                        value = int(
                            100 * float(data["value"]) / max(1, float(data["max"]))
                        )
                        if not queue.full():
                            queue.put_nowait(max(0, min(99, value)))
        except Exception:
            return  # Polling remains authoritative; no raw remote errors are logged.


def workflow(parameters, record, loras, source=None, mask=None, job_id=None):
    """The only executable graph builder. No node/filename fields come from the browser."""
    nodes = {
        "loader": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": record["file"]},
        }
    }
    model = ["loader", 0]
    clip = ["loader", 1]
    for index, (lora, strength) in enumerate(loras):
        key = "lora" + str(index)
        nodes[key] = {
            "class_type": "LoraLoader",
            "inputs": {
                "model": model,
                "clip": clip,
                "lora_name": lora["file"],
                "strength_model": strength,
                "strength_clip": strength,
            },
        }
        model = [key, 0]
        clip = [key, 1]
    nodes["positive"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": parameters.prompt, "clip": clip},
    }
    nodes["negative"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": parameters.negative_prompt, "clip": clip},
    }
    positive = ["positive", 0]
    negative = ["negative", 0]
    if source:
        nodes["source"] = {"class_type": "LoadImage", "inputs": {"image": source}}
        nodes["scale"] = {
            "class_type": "ImageScale",
            "inputs": {
                "image": ["source", 0],
                "upscale_method": "lanczos",
                "width": parameters.width,
                "height": parameters.height,
                "crop": "disabled",
            },
        }
        if mask:
            nodes["mask"] = {"class_type": "LoadImage", "inputs": {"image": mask}}
            nodes["mask_scale"] = {
                "class_type": "ImageScale",
                "inputs": {
                    "image": ["mask", 0],
                    "upscale_method": "nearest-exact",
                    "width": parameters.width,
                    "height": parameters.height,
                    "crop": "disabled",
                },
            }
            nodes["mask_red"] = {
                "class_type": "ImageToMask",
                "inputs": {"image": ["mask_scale", 0], "channel": "red"},
            }
            nodes["latent"] = {
                "class_type": "InpaintModelConditioning",
                "inputs": {
                    "positive": positive,
                    "negative": negative,
                    "vae": ["loader", 2],
                    "pixels": ["scale", 0],
                    "mask": ["mask_red", 0],
                    "noise_mask": True,
                },
            }
            positive = ["latent", 0]
            negative = ["latent", 1]
            latent = ["latent", 2]
        else:
            nodes["latent"] = {
                "class_type": "VAEEncode",
                "inputs": {"pixels": ["scale", 0], "vae": ["loader", 2]},
            }
            latent = ["latent", 0]
    else:
        nodes["latent"] = {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": parameters.width,
                "height": parameters.height,
                "batch_size": parameters.n,
            },
        }
        latent = ["latent", 0]
    nodes["sample"] = {
        "class_type": "KSampler",
        "inputs": {
            "model": model,
            "positive": positive,
            "negative": negative,
            "latent_image": latent,
            "seed": parameters.seed,
            "steps": parameters.steps,
            "cfg": parameters.cfg,
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": parameters.denoise if source else 1,
        },
    }
    nodes["decode"] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["sample", 0], "vae": ["loader", 2]},
    }
    nodes["save"] = {
        "class_type": "SaveImage",
        "inputs": {
            "images": ["decode", 0],
            "filename_prefix": "luma_" + str(UUID(job_id)),
        },
    }
    return nodes
