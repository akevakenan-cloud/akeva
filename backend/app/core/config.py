from __future__ import annotations

from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All configuration comes from environment variables prefixed AKEVA_."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="AKEVA_", extra="ignore")

    env: str = "development"  # development | test | production
    app_name: str = "Akeva API"

    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "akeva"

    jwt_secret: str = "dev-only-change-me-dev-only-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 30
    admin_refresh_token_hours: int = 12

    # Keyed hash for OTP codes ("pepper"); must differ from jwt_secret in production.
    otp_pepper: str = "dev-only-otp-pepper"
    otp_length: int = 6
    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5
    otp_resend_seconds: int = 60
    sms_provider: str = "console"  # console | africastalking | twilio
    sms_sender_id: str = "AKEVA"
    africastalking_username: str = ""
    africastalking_api_key: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""

    # Rate limits (requests per window)
    otp_requests_per_phone_per_hour: int = 5
    otp_requests_per_ip_per_hour: int = 30
    upload_requests_per_user_per_hour: int = 60

    # Encrypted document storage. Keys are base64 32-byte AES keys: "1:<key>,2:<key>"
    storage_backend: str = "local"  # local | s3 (s3 adapter: see app/services/storage.py)
    storage_dir: str = "./storage"
    storage_keys: str = ""
    storage_current_key_id: int = 1

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    trust_proxy_headers: bool = False

    mapbox_public_token: str = ""

    @model_validator(mode="after")
    def _check_production(self) -> "Settings":
        if self.env == "production":
            problems = []
            if "dev-only" in self.jwt_secret or len(self.jwt_secret) < 32:
                problems.append("AKEVA_JWT_SECRET must be a random string of 32+ characters")
            if "dev-only" in self.otp_pepper or self.otp_pepper == self.jwt_secret:
                problems.append("AKEVA_OTP_PEPPER must be set and differ from the JWT secret")
            if not self.storage_keys:
                problems.append("AKEVA_STORAGE_KEYS must be set")
            if self.sms_provider == "console":
                problems.append("AKEVA_SMS_PROVIDER cannot be 'console' in production")
            if problems:
                raise ValueError("; ".join(problems))
        return self

    @property
    def is_dev(self) -> bool:
        return self.env in ("development", "test")

    def keyring(self) -> dict[int, str]:
        if not self.storage_keys:
            if not self.is_dev:
                raise RuntimeError("AKEVA_STORAGE_KEYS is not configured")
            # Deterministic dev key so local files survive restarts. Never used in production.
            return {1: "ZGV2LW9ubHkta2V5LWRldi1vbmx5LWtleS0xMjM0NTY="}
        ring = {}
        for part in self.storage_keys.split(","):
            kid, _, key = part.strip().partition(":")
            ring[int(kid)] = key
        return ring


@lru_cache
def get_settings() -> Settings:
    return Settings()
