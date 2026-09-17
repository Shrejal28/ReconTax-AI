"""
app/services/auth.py
------------------------
Session lifecycle: create on login, look up on every authenticated
request, invalidate on logout. See app/db_models.Session and
app/services/security.py's module docstrings for the design (opaque
server-side token, not a JWT).
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from app.db_models import Session as SessionModel
from app.db_models import User
from app.services.security import SESSION_TTL_HOURS, generate_session_token


def create_session(db: DbSession, user: User) -> str:
    token = generate_session_token()
    expires_at = dt.datetime.utcnow() + dt.timedelta(hours=SESSION_TTL_HOURS)
    db.add(SessionModel(token=token, user_id=user.id, expires_at=expires_at))
    db.commit()
    return token


def get_user_from_token(db: DbSession, token: str) -> User | None:
    if not token:
        return None
    stmt = select(SessionModel).where(SessionModel.token == token)
    session = db.execute(stmt).scalars().first()
    if session is None:
        return None
    if session.expires_at < dt.datetime.utcnow():
        # Expired: clean it up as we find it rather than waiting on a
        # separate sweep job.
        db.execute(delete(SessionModel).where(SessionModel.id == session.id))
        db.commit()
        return None
    return db.get(User, session.user_id)


def invalidate_session(db: DbSession, token: str) -> None:
    db.execute(delete(SessionModel).where(SessionModel.token == token))
    db.commit()
