"""
app/services/tenant_state.py
--------------------------------
Per-tenant in-memory pipeline state. Before multi-tenancy, the pipeline
endpoints stored the working DataFrame/model directly on app.state
(app.state.master_frame, app.state.model, ...) — a single shared bucket
for the whole process. Now every business's data has to stay separate,
so app.state instead holds ONE dict of per-tenant buckets:

    app.state.tenant_pipelines: dict[int, dict[str, Any]]

keyed by the tenant_key from app/deps.py's tenant_key_for() (a real
tenant_id for a business user, or PLATFORM_ADMIN_TENANT_KEY for a
platform admin's own sandbox use). Each bucket holds the same
"master_frame" / "model" / "scored_frame" / "reconciled_frame" keys the
single global bucket used to hold directly on app.state.

This is still in-memory only, same as before multi-tenancy — it resets
on restart exactly like the old app.state.master_frame did (the SQLite
PipelineRun history in app/db.py is what survives a restart, per that
module's docstring; this module is unrelated to that and only holds the
live working set for the current process).
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI


def get_tenant_bucket(app: FastAPI, tenant_key: int) -> dict[str, Any]:
    """Returns (creating if needed) the given tenant's in-memory pipeline
    state bucket. Never returns another tenant's bucket — that's the
    entire point of keying by tenant_key."""
    if not hasattr(app.state, "tenant_pipelines"):
        app.state.tenant_pipelines = {}
    return app.state.tenant_pipelines.setdefault(tenant_key, {})
