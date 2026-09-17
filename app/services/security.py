"""
app/services/security.py
----------------------------
Password hashing (real bcrypt, via the `bcrypt` package directly — not
passlib, which has a known incompatibility with recent bcrypt releases)
and opaque session-token generation for the auth system.

No JWT here on purpose: sessions are a random opaque token looked up
against a server-side Session table (see app/db_models.py). That's
simpler to reason about and revoke (delete the row = immediate logout
everywhere) than verifying/rotating signed tokens, at the cost of a DB
lookup per authenticated request — a fine trade for this app's scale.
"""

from __future__ import annotations

import secrets

import bcrypt

SESSION_TOKEN_BYTES = 32
SESSION_TTL_HOURS = 24 * 7  # 7 days


def hash_password(plain: str) -> str:
    """Bcrypt-hash a password for storage. bcrypt truncates input at 72
    bytes internally; we don't pre-truncate so a caller relying on more
    than that gets bcrypt's own ValueError rather than silent truncation."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        # Malformed stored hash — never a match, never a crash.
        return False


def generate_session_token() -> str:
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def generate_temp_password() -> str:
    """A human-typeable one-time credential issued when a business is
    approved: readable (no ambiguous 0/O/l/1), 12 characters."""
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(12))


def generate_username(company_name: str, tenant_id: int) -> str:
    """A stable, predictable username derived from the company name plus
    the tenant id (guarantees uniqueness without a lookup loop)."""
    slug = "".join(ch for ch in company_name.lower() if ch.isalnum())[:20] or "tenant"
    return f"{slug}{tenant_id}"
