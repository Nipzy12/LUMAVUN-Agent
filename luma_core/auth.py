"""Lightweight local-owner authentication for the self-hosted MVP.

This is intentionally minimal: a single shared secret (``LOCAL_OWNER_TOKEN``)
grants access as the local owner. It is suitable for a single-operator
self-hosted deployment and is *not* a multi-user SSO solution.

The token is read from the environment / app settings and verified on each
request that requires owner privileges. Unauthenticated requests to public
endpoints (health, list endpoints) are still allowed.
"""

from fastapi import Header, HTTPException
from pydantic import SecretStr

from luma_core.config import get_settings

SHARED_TOKEN_HEADER = "X-Luma-Owner-Token"


def get_owner_token(x_luma_owner_token: str | None = Header(default=None)) -> str:
    """Extract and validate the local owner token from request headers.

    Raises 401 when the header is missing or does not match the configured
    secret. Intended to be called from dependencies that require owner access.
    """
    settings = get_settings()
    expected = settings.local_owner_token.get_secret_value() if settings.local_owner_token else ""
    provided = x_luma_owner_token or ""
    if not expected or not provided or provided != expected:
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid owner token. Provide X-Luma-Owner-Token.",
        )
    return provided


def current_owner_id(
    token: str = Header(default=None, include_in_schema=False),
) -> int | None:
    """Placeholder for resolving the authenticated owner's identity.

    In this MVP the owner is a single local account. Real multi-user identity
    is deferred to a later phase. For now we return a fixed owner id once the
    token is validated; callers that need an owner agent record should look it
    up by name/role rather than by a hardcoded id.
    """
    # The owner is the dedicated "System Owner" agent created during bootstrap.
    return None
