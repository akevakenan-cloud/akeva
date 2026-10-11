"""Append-only audit trail of every staff action and sensitive data access."""

from __future__ import annotations

from typing import Any

from ..core.db import get_db, new_id, utcnow


async def record(
    actor: dict | None,
    action: str,
    target_type: str,
    target_id: str | None,
    *,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
    meta: dict[str, Any] | None = None,
    ip: str | None = None,
) -> None:
    await get_db().audit_logs.insert_one({
        "_id": new_id(),
        "actor_id": actor["_id"] if actor else None,
        "actor_role": actor["role"] if actor else "system",
        "actor_name": actor.get("full_name") if actor else "system",
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "before": before,
        "after": after,
        "reason": reason,
        "meta": meta or {},
        "ip": ip,
        "created_at": utcnow(),
    })
