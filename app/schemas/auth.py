"""
app/schemas/auth.py
-----------------------
Pydantic v2 models for POST /api/v1/auth/login, /logout, GET /me, and the
tenant-request/approval flow (app/api/v1/endpoints/{auth,tenants}.py).
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["ADMIN", "ANALYST", "AUDITOR"]


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    role: Role
    tenant_id: int | None
    tenant_name: str | None = None
    must_change_password: bool


class LoginResponse(BaseModel):
    token: str
    user: UserOut


class TenantAccessRequestIn(BaseModel):
    company_name: str = Field(min_length=1, max_length=255)
    gstin: str = Field(min_length=15, max_length=15)
    contact_email: str = Field(min_length=3, max_length=255)


class TenantAccessRequestOut(BaseModel):
    id: int
    company_name: str
    gstin: str
    contact_email: str
    status: Literal["PENDING", "APPROVED", "REJECTED"]
    created_at: dt.datetime
    resolved_tenant_id: int | None

    model_config = {"from_attributes": True}


class ApproveTenantResponse(BaseModel):
    tenant_id: int
    company_name: str
    username: str
    temporary_password: str = Field(
        description="Shown exactly once, at approval time. Not recoverable afterward — "
        "only a new password reset would produce another one."
    )
