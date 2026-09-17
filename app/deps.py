"""
app/deps.py
--------------
FastAPI dependencies shared across endpoints: current-user extraction
from a Bearer session token, admin-only gating, and the tenant-scoping
key every pipeline endpoint uses to keep businesses' data separate.
"""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.db_models import User
from app.services.auth import get_user_from_token

# Platform ADMIN users have tenant_id=None in the database (they
# administer all businesses, aren't scoped to one) but still need SOME
# key to store their own sandbox pipeline runs under — this sentinel
# fills that role so "no tenant" isn't a special-cased None everywhere
# app.state / PipelineRun.tenant_id is touched.
PLATFORM_ADMIN_TENANT_KEY = -1


def get_current_user(
    authorization: str | None = Header(default=None),
    db: DbSession = Depends(get_db),
) -> User:
    """Requires 'Authorization: Bearer <token>'. 401s on anything else —
    missing header, malformed header, unknown/expired token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    token = authorization.removeprefix("Bearer ").strip()
    user = get_user_from_token(db, token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="ADMIN role required.")
    return user


def tenant_key_for(user: User) -> int:
    """The key used to scope app.state pipeline storage and to filter
    PipelineRun/OcrStagingCommit rows: the user's real tenant_id for a
    business user, or PLATFORM_ADMIN_TENANT_KEY for a platform admin."""
    return user.tenant_id if user.tenant_id is not None else PLATFORM_ADMIN_TENANT_KEY
