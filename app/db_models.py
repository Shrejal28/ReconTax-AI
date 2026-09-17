"""
app/db_models.py
--------------------
SQLAlchemy ORM models for the SQLite persistence layer (app/db.py).

Multi-tenant model, in brief:
  - Tenant: one business, created when an admin approves a
    TenantAccessRequest. Every business's pipeline data is scoped to
    its own tenant_id — see app/deps.py's get_current_user and the
    per-tenant app.state storage in app/api/v1/endpoints/{ingest,score,
    reconcile,ocr}.py.
  - User: a login. A platform ADMIN has tenant_id=None (administers all
    businesses, isn't scoped to one). A business user (ANALYST/AUDITOR)
    always has a tenant_id and only ever sees that tenant's data.
  - Session: an opaque bearer token issued at login, checked on every
    authenticated request (see app/services/security.py's module
    docstring for why this isn't a JWT).
  - TenantAccessRequest: a business's request to get onto the platform,
    submitted via the public POST /api/v1/tenants/request endpoint,
    sitting PENDING until an admin approves or rejects it.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PipelineRun(Base):
    """One persisted record of a completed /ingest, /score, or /reconcile
    call: the request payload, the full response payload, and when it
    happened. A row is written only after the endpoint has already built
    a successful response — a failed/erroring call never leaves a row
    behind, so this table is a log of real outcomes, not attempts.
    """

    __tablename__ = "pipeline_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_type: Mapped[str] = mapped_column(String(16), index=True)  # "INGEST" | "SCORE" | "RECONCILE"
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)
    # Which tenant this run belongs to. NULL is reserved for the platform
    # admin's own sandbox use (see app/deps.py's PLATFORM_ADMIN_TENANT_KEY)
    # and is stored as -1 (SQLite-friendly sentinel) rather than NULL so
    # it still indexes and filters cleanly.
    tenant_id: Mapped[int] = mapped_column(Integer, index=True, default=-1)
    request_payload: Mapped[dict] = mapped_column(JSON)
    response_payload: Mapped[dict] = mapped_column(JSON)


class OcrStagingCommit(Base):
    """One reviewer-committed OCR staging record: the extracted (and
    possibly hand-corrected) fields for a single uploaded invoice
    document, plus whether the reviewer had to override a low-confidence
    warning to commit it. This is a real, separate persisted record —
    NOT merged into app.state.master_frame or the fraud-scoring
    pipeline: a scanned invoice can't supply the full behavioural/label
    feature set the model was trained on, so pretending otherwise would
    be misleading. This table is its own audit-visible staging ledger,
    scoped per tenant like everything else pipeline-related.
    """

    __tablename__ = "ocr_staging_commits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)
    tenant_id: Mapped[int] = mapped_column(Integer, index=True, default=-1)
    filename: Mapped[str] = mapped_column(String(255))
    file_hash: Mapped[str] = mapped_column(String(64), index=True)
    supplier_gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    fields_payload: Mapped[dict] = mapped_column(JSON)
    low_confidence_overridden: Mapped[bool] = mapped_column(default=False)


class Tenant(Base):
    """One approved business. Created only by
    app.api.v1.endpoints.tenants.approve_tenant_request — there is no
    direct "create a tenant" endpoint, only the request-then-approve
    flow, so every tenant traces back to a real admin decision."""

    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    company_name: Mapped[str] = mapped_column(String(255))
    gstin: Mapped[str] = mapped_column(String(15))
    contact_email: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class TenantAccessRequest(Base):
    """A business's request for platform access, submitted publicly
    (POST /api/v1/tenants/request, no auth required — a prospective
    business owner doesn't have credentials yet). Sits PENDING until an
    admin approves (creates the Tenant + issues a User + credentials) or
    rejects it."""

    __tablename__ = "tenant_access_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    company_name: Mapped[str] = mapped_column(String(255))
    gstin: Mapped[str] = mapped_column(String(15))
    contact_email: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="PENDING")  # PENDING | APPROVED | REJECTED
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)
    resolved_tenant_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class User(Base):
    """One login. tenant_id is NULL for a platform ADMIN (administers
    all businesses, not scoped to one) and always set for a business
    user (ANALYST/AUDITOR), created at tenant-approval time by
    app/services/security.py's generate_username/generate_temp_password.
    password_hash is always a real bcrypt hash — see
    app/services/security.py, never stored or compared in plaintext."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16))  # "ADMIN" | "ANALYST" | "AUDITOR"
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)


class Session(Base):
    """An issued login session. Deleting the row (see
    app/services/auth.py's invalidate_session) is a real, immediate
    logout — there's no signed-token window where a revoked session
    still validates, unlike a bare JWT without a revocation list."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime, index=True)
