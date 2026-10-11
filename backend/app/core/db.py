from __future__ import annotations

import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, GEOSPHERE, IndexModel

from .config import get_settings

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


def new_id() -> str:
    """String UUIDs keep ids JSON-friendly across the API and mobile apps."""
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(dt: datetime) -> datetime:
    """Mongo returns naive UTC datetimes unless tz_aware is set; normalise them."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("database not initialised")
    return _db


def set_db(db: AsyncIOMotorDatabase) -> None:
    """Used by tests to inject an in-memory database."""
    global _db
    _db = db


async def connect() -> AsyncIOMotorDatabase:
    global _client, _db
    s = get_settings()
    _client = AsyncIOMotorClient(s.mongo_uri, tz_aware=True, uuidRepresentation="standard")
    _db = _client[s.mongo_db]
    await ensure_indexes(_db)
    return _db


async def disconnect() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None


INDEXES: dict[str, list[IndexModel]] = {
    "users": [
        # One account per phone per role (a person may be both a rider and a driver).
        # Deleted accounts get their phone replaced, so they don't block re-registration.
        IndexModel([("phone", ASCENDING), ("role", ASCENDING)], unique=True),
        IndexModel([("role", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("country", ASCENDING), ("city", ASCENDING)]),
        IndexModel([("driver.category", ASCENDING), ("driver.online", ASCENDING)]),
        IndexModel([("driver.location", GEOSPHERE)], sparse=True),
    ],
    "otp_codes": [
        IndexModel([("phone", ASCENDING), ("role", ASCENDING)]),
        IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),
    ],
    "refresh_tokens": [
        IndexModel([("user_id", ASCENDING)]),
        IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),
    ],
    "rate_limits": [IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0)],
    "files": [IndexModel([("owner_id", ASCENDING), ("doc_type", ASCENDING)])],
    "audit_logs": [
        IndexModel([("created_at", DESCENDING)]),
        IndexModel([("target_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("actor_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("action", ASCENDING)]),
    ],
    "cities": [IndexModel([("country", ASCENDING), ("name", ASCENDING)], unique=True)],
    "pricing_rules": [
        IndexModel([("country", ASCENDING), ("city_id", ASCENDING), ("category", ASCENDING)],
                   unique=True),
    ],
    "rides": [
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("rider_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("driver_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("country", ASCENDING), ("city_id", ASCENDING)]),
    ],
    "disputes": [IndexModel([("status", ASCENDING), ("created_at", DESCENDING)])],
    "deletion_requests": [IndexModel([("status", ASCENDING), ("created_at", DESCENDING)])],
}


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    settings = get_settings()
    for coll, models in INDEXES.items():
        for model in models:
            try:
                await db[coll].create_indexes([model])
            except Exception:
                # In-memory test databases don't support every index type (e.g. 2dsphere).
                if settings.env != "test":
                    raise
