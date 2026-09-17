"""
app/db.py
-----------
SQLite persistence layer via SQLAlchemy 2.0. This stores a durable
history of pipeline runs (ingest/score/reconcile) so they survive an
app restart — a real gap the earlier all-in-memory app.state design had.

Important scope note, so this isn't mistaken for more than it is: this
does NOT replace app.state as the live working set for a running
process. The pipeline endpoints still read/write the in-memory
DataFrame/trained model between requests exactly as before (see
app/api/v1/endpoints/{ingest,score,reconcile}.py) — that's what actually
makes /score or /reconcile work without re-reading parquet or retraining
every call. What this module adds is a durable, queryable log of what
each successful call actually returned, so:
  - the values from past runs aren't silently lost when uvicorn restarts
  - GET /api/v1/pipeline/runs can show "here's what the last Ingest/
    Score/Reconcile returned" even in a fresh process
A restarted process still needs POST /api/v1/ingest called again before
/score or /reconcile will work — this module doesn't reconstruct the
in-memory DataFrame/model from the database, only the historical record
of what past responses contained.

DB location: the RECONTAX_DB_PATH env var, defaulting to "recontax.db"
in the process's working directory (so it lives next to wherever you
run `uvicorn app.main:app` from). A single global engine + session
factory is created at import time, the standard SQLAlchemy pattern for
a small single-process app.
"""

from __future__ import annotations

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DB_PATH = os.environ.get("RECONTAX_DB_PATH", "recontax.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    # Each request's blocking DB write runs inside run_in_threadpool
    # (same pattern as the pandas/LightGBM work elsewhere in this app),
    # so a given SQLite connection can be touched from a thread other
    # than the one that created it — hence check_same_thread=False.
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """Create tables if they don't exist yet. Called once at app startup
    (see app/main.py's startup event) — safe to call repeatedly, since
    create_all() no-ops on tables that already exist."""
    from app import db_models  # noqa: F401  (import registers models on Base.metadata)

    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a Session, closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
