"""
app/api/v1/endpoints/tenants.py
------------------------------------
POST /api/v1/tenants/request        — public, no auth: a business asks for
                                       platform access.
GET  /api/v1/admin/tenants/requests — ADMIN only: list requests.
POST /api/v1/admin/tenants/requests/{id}/approve — ADMIN only: creates the
                                       Tenant + a real User with a bcrypt-
                                       hashed password, returns the
                                       plaintext temporary password ONCE.
POST /api/v1/admin/tenants/requests/{id}/reject  — ADMIN only.

This is the real version of what AdminProvisioningPage used to fake
client-side with crypto.randomUUID(). Every credential issued here is a
real bcrypt hash in the database; the plaintext temp password is
returned exactly once in the approve response and never stored or
retrievable again — the admin must relay it to the business owner
out-of-band (email, phone), which is standard practice for one-time
credential issuance.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.db_models import Tenant, TenantAccessRequest, User
from app.deps import get_current_admin
from app.schemas.auth import ApproveTenantResponse, TenantAccessRequestIn, TenantAccessRequestOut
from app.services.security import generate_temp_password, generate_username, hash_password

router = APIRouter(prefix="/api/v1", tags=["tenants"])


@router.post("/tenants/request", response_model=TenantAccessRequestOut)
def request_tenant_access(payload: TenantAccessRequestIn, db: DbSession = Depends(get_db)) -> TenantAccessRequest:
    """Public — no auth required. A prospective business owner doesn't
    have credentials yet, that's the entire point of this endpoint."""
    record = TenantAccessRequest(
        company_name=payload.company_name,
        gstin=payload.gstin.upper(),
        contact_email=payload.contact_email,
        status="PENDING",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/admin/tenants/requests", response_model=list[TenantAccessRequestOut])
def list_tenant_requests(
    _admin: User = Depends(get_current_admin), db: DbSession = Depends(get_db)
) -> list[TenantAccessRequest]:
    stmt = select(TenantAccessRequest).order_by(TenantAccessRequest.created_at.desc())
    return list(db.execute(stmt).scalars().all())


@router.post("/admin/tenants/requests/{request_id}/approve", response_model=ApproveTenantResponse)
def approve_tenant_request(
    request_id: int, _admin: User = Depends(get_current_admin), db: DbSession = Depends(get_db)
) -> ApproveTenantResponse:
    record = db.get(TenantAccessRequest, request_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Tenant access request not found.")
    if record.status != "PENDING":
        raise HTTPException(status_code=409, detail=f"Request is already {record.status}, not PENDING.")

    tenant = Tenant(company_name=record.company_name, gstin=record.gstin, contact_email=record.contact_email)
    db.add(tenant)
    db.flush()  # assigns tenant.id without committing yet

    temp_password = generate_temp_password()
    username = generate_username(record.company_name, tenant.id)
    user = User(
        tenant_id=tenant.id,
        username=username,
        email=record.contact_email,
        password_hash=hash_password(temp_password),
        role="ANALYST",  # business owners get full pipeline access, not platform admin
        must_change_password=True,
    )
    db.add(user)

    record.status = "APPROVED"
    record.resolved_tenant_id = tenant.id
    db.commit()

    return ApproveTenantResponse(
        tenant_id=tenant.id,
        company_name=tenant.company_name,
        username=username,
        temporary_password=temp_password,
    )


@router.post("/admin/tenants/requests/{request_id}/reject", response_model=TenantAccessRequestOut)
def reject_tenant_request(
    request_id: int, _admin: User = Depends(get_current_admin), db: DbSession = Depends(get_db)
) -> TenantAccessRequest:
    record = db.get(TenantAccessRequest, request_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Tenant access request not found.")
    if record.status != "PENDING":
        raise HTTPException(status_code=409, detail=f"Request is already {record.status}, not PENDING.")
    record.status = "REJECTED"
    db.commit()
    db.refresh(record)
    return record
