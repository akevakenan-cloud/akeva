from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core import db
from .core.config import get_settings
from .routers import admin, auth, drivers, me, public, ws

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if db._db is None:
        await db.connect()
    else:  # tests inject their own database
        await db.ensure_indexes(db._db)
    yield
    await db.disconnect()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title=s.app_name,
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None if s.env == "production" else "/docs",
        redoc_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Accept-Language"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]}
                  for e in exc.errors()]
        return JSONResponse(status_code=422,
                            content={"detail": {"code": "validation_error", "errors": errors}})

    api_prefix = "/api/v1"
    for r in (public.router, auth.router, me.router, drivers.router, admin.router):
        app.include_router(r, prefix=api_prefix)
    app.include_router(ws.router, prefix=api_prefix)
    return app


app = create_app()
