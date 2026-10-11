"""Encryption at rest for identity documents and selfies (AES-256-GCM).

Blob layout: b"AKV1" | key_id (1 byte) | nonce (12 bytes) | ciphertext+tag.
The key id lets us rotate keys: new uploads use the current key, while old
blobs stay readable with the previous keys until re-encrypted.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"AKV1"
NONCE_LEN = 12


class DecryptionError(Exception):
    pass


def generate_key() -> str:
    """Return a new base64-encoded 256-bit key (for .env / secret manager)."""
    return base64.b64encode(AESGCM.generate_key(bit_length=256)).decode()


def _decode_key(key_b64: str) -> bytes:
    key = base64.b64decode(key_b64)
    if len(key) != 32:
        raise ValueError("encryption key must be 32 bytes (base64-encoded)")
    return key


class Encryptor:
    def __init__(self, keys: dict[int, str], current_key_id: int):
        if current_key_id not in keys:
            raise ValueError("current key id not present in keyring")
        if not all(0 <= k <= 255 for k in keys):
            raise ValueError("key ids must fit in one byte")
        self._keys = {k: AESGCM(_decode_key(v)) for k, v in keys.items()}
        self._current = current_key_id

    def encrypt(self, data: bytes, associated_data: bytes = b"") -> bytes:
        nonce = os.urandom(NONCE_LEN)
        ct = self._keys[self._current].encrypt(nonce, data, associated_data or None)
        return MAGIC + bytes([self._current]) + nonce + ct

    def decrypt(self, blob: bytes, associated_data: bytes = b"") -> bytes:
        if len(blob) < len(MAGIC) + 1 + NONCE_LEN + 16 or not blob.startswith(MAGIC):
            raise DecryptionError("not an Akeva encrypted blob")
        key_id = blob[len(MAGIC)]
        aes = self._keys.get(key_id)
        if aes is None:
            raise DecryptionError(f"unknown key id {key_id}")
        nonce = blob[len(MAGIC) + 1: len(MAGIC) + 1 + NONCE_LEN]
        try:
            return aes.decrypt(nonce, blob[len(MAGIC) + 1 + NONCE_LEN:], associated_data or None)
        except Exception as exc:  # InvalidTag
            raise DecryptionError("blob failed authentication") from exc


# --- OTP / secret hashing -------------------------------------------------

def generate_otp(length: int = 6) -> str:
    return "".join(secrets.choice("0123456789") for _ in range(length))


def hash_secret(value: str, pepper: str) -> str:
    """Keyed hash for OTP codes and lookup tokens (never store them in clear)."""
    return hmac.new(pepper.encode(), value.encode(), hashlib.sha256).hexdigest()


def verify_secret(value: str, digest: str, pepper: str) -> bool:
    return hmac.compare_digest(hash_secret(value, pepper), digest)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
