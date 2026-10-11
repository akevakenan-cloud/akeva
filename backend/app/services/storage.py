"""Encrypted storage for identity documents, selfies and vehicle photos.

Every blob is encrypted with AES-256-GCM before it reaches disk (or object
storage), bound to its file id so blobs can't be swapped between records.
Metadata lives in the ``files`` collection; access control is enforced by the
API routes, and every staff view is written to the audit log.
"""

from __future__ import annotations

import asyncio
import base64
import os
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from ..core.config import get_settings
from ..core.db import get_db, new_id, utcnow
from ..domain.crypto import Encryptor, sha256_hex
from ..domain.enums import DocumentType
from ..domain.onboarding import validate_upload


class BlobStore(Protocol):
    async def put(self, key: str, data: bytes) -> None: ...
    async def get(self, key: str) -> bytes: ...
    async def delete(self, key: str) -> None: ...


class LocalBlobStore:
    """Files on a local (ideally encrypted, backed-up) volume.

    For multi-instance deployments, implement the same three methods against
    S3-compatible storage (e.g. with aioboto3) and select it via
    AKEVA_STORAGE_BACKEND.
    """

    def __init__(self, root: str):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        if not key.replace("/", "").isalnum():
            raise ValueError("invalid storage key")
        p = (self.root / key).resolve()
        if self.root not in p.parents:
            raise ValueError("invalid storage key")
        return p

    async def put(self, key: str, data: bytes) -> None:
        p = self._path(key)

        def _write() -> None:
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, p)

        await asyncio.to_thread(_write)

    async def get(self, key: str) -> bytes:
        return await asyncio.to_thread(self._path(key).read_bytes)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._path(key).unlink, True)


@lru_cache
def get_store() -> BlobStore:
    s = get_settings()
    if s.storage_backend != "local":
        raise RuntimeError(f"storage backend {s.storage_backend!r} is not configured")
    return LocalBlobStore(s.storage_dir)


@lru_cache
def get_encryptor() -> Encryptor:
    s = get_settings()
    return Encryptor(s.keyring(), s.storage_current_key_id)


async def save_document(owner: dict, doc_type: DocumentType, data: bytes,
                        original_name: str | None = None) -> dict:
    content_type = validate_upload(doc_type, data)
    file_id = new_id()
    key = f"{owner['_id']}/{file_id}"
    await get_store().put(key, get_encryptor().encrypt(data, file_id.encode()))
    doc = {
        "_id": file_id,
        "owner_id": owner["_id"],
        "owner_role": owner["role"],
        "doc_type": doc_type.value,
        "content_type": content_type,
        "size": len(data),
        "sha256": sha256_hex(data),
        "original_name": (original_name or "")[:120],
        "storage_key": key,
        "created_at": utcnow(),
        "deleted_at": None,
    }
    db = get_db()
    # Single-instance document types replace the previous upload.
    if doc_type not in (DocumentType.VEHICLE_EXTRA, DocumentType.OTHER):
        await db.files.update_many(
            {"owner_id": owner["_id"], "doc_type": doc_type.value, "deleted_at": None},
            {"$set": {"deleted_at": utcnow(), "superseded_by": file_id}},
        )
    await db.files.insert_one(doc)
    return doc


async def read_document(file_doc: dict) -> bytes:
    blob = await get_store().get(file_doc["storage_key"])
    return get_encryptor().decrypt(blob, file_doc["_id"].encode())


async def purge_owner_files(owner_id: str) -> int:
    """Hard-delete every blob of a user (right to be forgotten)."""
    db = get_db()
    count = 0
    async for f in db.files.find({"owner_id": owner_id}):
        await get_store().delete(f["storage_key"])
        count += 1
    await db.files.delete_many({"owner_id": owner_id})
    return count


# --- field-level encryption for ID numbers and payout accounts ------------

_FIELD_PREFIX = "enc:v1:"


def encrypt_field(value: str | None, context: str) -> str | None:
    if value is None or value == "":
        return value
    blob = get_encryptor().encrypt(value.encode(), context.encode())
    return _FIELD_PREFIX + base64.b64encode(blob).decode()


def decrypt_field(value: str | None, context: str) -> str | None:
    if not value or not value.startswith(_FIELD_PREFIX):
        return value
    blob = base64.b64decode(value[len(_FIELD_PREFIX):])
    return get_encryptor().decrypt(blob, context.encode()).decode()


def mask(value: str | None, keep: int = 4) -> str | None:
    if not value:
        return value
    return "•" * max(0, len(value) - keep) + value[-keep:]
