"""Fixed-window rate limiting stored in MongoDB, so it holds across API instances."""

from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import HTTPException, Request, status
from pymongo import ReturnDocument

from .config import get_settings
from .db import get_db


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy_headers:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def hit(bucket: str, identity: str, limit: int, window_seconds: int) -> None:
    """Count one request; raise 429 when ``limit`` is exceeded within the window."""
    now = int(time.time())
    window_start = now - now % window_seconds
    key = f"{bucket}:{identity}:{window_start}"
    doc = await get_db().rate_limits.find_one_and_update(
        {"_id": key},
        {
            "$inc": {"count": 1},
            "$setOnInsert": {
                "expires_at": datetime.fromtimestamp(window_start + window_seconds, timezone.utc),
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if doc["count"] > limit:
        retry_after = window_start + window_seconds - now
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "rate_limited", "retry_after": retry_after},
            headers={"Retry-After": str(retry_after)},
        )
