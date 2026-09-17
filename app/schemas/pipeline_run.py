"""
app/schemas/pipeline_run.py
-------------------------------
Pydantic v2 models for the read-only pipeline-history endpoints
(app/api/v1/endpoints/pipeline_runs.py), backed by app/db_models.PipelineRun.
"""

from __future__ import annotations

import datetime as dt
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

RunType = Literal["INGEST", "SCORE", "RECONCILE"]


class PipelineRunOut(BaseModel):
    """One persisted pipeline-run row."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    run_type: RunType
    created_at: dt.datetime
    request_payload: dict[str, Any]
    response_payload: dict[str, Any]
