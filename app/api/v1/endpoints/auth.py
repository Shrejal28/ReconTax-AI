"""
app/api/v1/endpoints/auth.py
--------------------------------
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me

Real authentication: bcrypt password verification against app/db_models.User,
an opaque server-side session token (app/services/auth.py) — no client-side
mock, no "any password works" fallback.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.db_models import Tenant, User
from app.deps import get_current_user
from app.schemas.auth import LoginRequest, LoginResponse, UserOut
from app.services.auth import create_session, invalidate_session
from app.services.security import verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _user_out(db: DbSession, user: User) -> UserOut:
    tenant_name = None
    if user.tenant_id is not None:
        tenant = db.get(Tenant, user.tenant_id)
        tenant_name = tenant.company_name if tenant else None
    return UserOut(
        id=user.id,
        username=user.username,
        email=user.email,
        role=user.role,  # type: ignore[arg-type]
        tenant_id=user.tenant_id,
        tenant_name=tenant_name,
        must_change_password=user.must_change_password,
    )


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: DbSession = Depends(get_db)) -> LoginResponse:
    stmt = select(User).where(User.username == payload.username)
    user = db.execute(stmt).scalars().first()
    if user is None or not verify_password(payload.password, user.password_hash):
        # Same error for "no such user" and "wrong password" — doesn't
        # let a caller enumerate valid usernames by the error message.
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    token = create_session(db, user)
    return LoginResponse(token=token, user=_user_out(db, user))


@router.post("/logout")
def logout(authorization: str | None = Header(default=None), db: DbSession = Depends(get_db)) -> dict:
    if authorization and authorization.startswith("Bearer "):
        invalidate_session(db, authorization.removeprefix("Bearer ").strip())
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> UserOut:
    return _user_out(db, user)
