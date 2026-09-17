"""
app/services/bootstrap.py
-----------------------------
Seeds the one platform ADMIN account that has to exist before anyone can
use the admin-provisioning flow at all (there's no other way to create
the first ADMIN — every other user is created by an ADMIN approving a
tenant request). Runs once at app startup; idempotent — does nothing if
an ADMIN already exists.

The seeded credentials are deliberately the same email/password this
project used for its earlier CLIENT-SIDE-ONLY demo login
(admin@recontax.ai / admin_2026), so nothing changes for whoever was
already using that to log in — the difference is this is now a REAL
bcrypt-hashed row in the database, checked server-side, not a hardcoded
string shipped in the JS bundle. Change this password after first login
in anything beyond local/demo use — there is currently no
change-password endpoint, only the User.must_change_password flag
reflecting that this one was never rotated.
"""

from __future__ import annotations

import logging
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db_models import User
from app.services.security import hash_password

logger = logging.getLogger(__name__)

BOOTSTRAP_ADMIN_USERNAME = "admin"
BOOTSTRAP_ADMIN_EMAIL = "admin@recontax.ai"
BOOTSTRAP_ADMIN_PASSWORD = os.environ.get("RECONTAX_BOOTSTRAP_ADMIN_PASSWORD", "admin_2026")


def seed_bootstrap_admin(db: Session) -> None:
    existing = db.execute(select(User).where(User.role == "ADMIN")).scalars().first()
    if existing is not None:
        return

    db.add(
        User(
            tenant_id=None,
            username=BOOTSTRAP_ADMIN_USERNAME,
            email=BOOTSTRAP_ADMIN_EMAIL,
            password_hash=hash_password(BOOTSTRAP_ADMIN_PASSWORD),
            role="ADMIN",
            must_change_password=True,
        )
    )
    db.commit()
    logger.info(
        "Seeded bootstrap ADMIN user (username=%r). Set RECONTAX_BOOTSTRAP_ADMIN_PASSWORD "
        "before first run to avoid the default password.",
        BOOTSTRAP_ADMIN_USERNAME,
    )
