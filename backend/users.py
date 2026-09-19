"""Email + password accounts, stored in SQLite with scrypt password hashes."""
import hashlib
import hmac
from contextlib import contextmanager
import re
import secrets
import sqlite3
import threading
import time

import config

DB_FILE = config.DATA_DIR / "users.db"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_lock = threading.Lock()

# scrypt parameters (OWASP-recommended minimum: N=2^17 is stronger but slow on small machines).
_N, _R, _P, _DKLEN = 2**14, 8, 1, 64


@contextmanager
def _conn():
    """Connection that commits on success, rolls back on error, and is always closed."""
    conn = sqlite3.connect(DB_FILE)
    try:
        with conn:
            _ensure_schema(conn)
            yield conn
    finally:
        conn.close()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS users (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               email TEXT NOT NULL UNIQUE COLLATE NOCASE,
               name TEXT NOT NULL,
               password_hash TEXT NOT NULL,
               created_at REAL NOT NULL
           )"""
    )


def _hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"scrypt${salt.hex()}${dk.hex()}"


def _verify(password: str, stored: str) -> bool:
    try:
        _, salt_hex, dk_hex = stored.split("$")
    except ValueError:
        return False
    candidate = _hash(password, bytes.fromhex(salt_hex)).split("$")[2]
    return hmac.compare_digest(candidate, dk_hex)


# A real hash to compare against when the email doesn't exist, so response time doesn't reveal
# which emails are registered.
_DUMMY_HASH = _hash(secrets.token_urlsafe(16))


class AuthError(ValueError):
    pass


def validate(name: str, email: str, password: str) -> tuple[str, str]:
    name, email = name.strip(), email.strip().lower()
    if not 1 <= len(name) <= 80:
        raise AuthError("Please enter your name.")
    if not EMAIL_RE.match(email) or len(email) > 254:
        raise AuthError("Please enter a valid email address.")
    if len(password) < 8:
        raise AuthError("Password must be at least 8 characters.")
    if len(password) > 256:
        raise AuthError("Password is too long.")
    if password.lower() == password or password.upper() == password or not re.search(r"\d", password):
        raise AuthError("Use a mix of upper- and lowercase letters and at least one number.")
    return name, email


def create(name: str, email: str, password: str) -> dict:
    name, email = validate(name, email, password)
    with _lock, _conn() as conn:
        try:
            cur = conn.execute("INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
                               (email, name, _hash(password), time.time()))
        except sqlite3.IntegrityError:
            raise AuthError("An account with this email already exists. Try signing in.") from None
    return {"id": f"local:{cur.lastrowid}", "name": name, "email": email, "avatar": None, "provider": "password"}


def authenticate(email: str, password: str) -> dict | None:
    email = email.strip().lower()
    with _lock, _conn() as conn:
        row = conn.execute("SELECT id, name, email, password_hash FROM users WHERE email = ?", (email,)).fetchone()
    if not row:
        _verify(password, _DUMMY_HASH)
        return None
    if not _verify(password, row[3]):
        return None
    return {"id": f"local:{row[0]}", "name": row[1], "email": row[2], "avatar": None, "provider": "password"}


# Simple in-memory brute-force protection: 5 failures per email or IP -> 5 minute lockout.
_failures: dict[str, list[float]] = {}
_FAIL_WINDOW, _FAIL_LIMIT = 300, 5


def throttled(*keys: str) -> bool:
    now = time.time()
    with _lock:
        for k in keys:
            recent = [t for t in _failures.get(k, []) if now - t < _FAIL_WINDOW]
            _failures[k] = recent
            if len(recent) >= _FAIL_LIMIT:
                return True
    return False


def record_failure(*keys: str) -> None:
    with _lock:
        for k in keys:
            _failures.setdefault(k, []).append(time.time())


def clear_failures(*keys: str) -> None:
    with _lock:
        for k in keys:
            _failures.pop(k, None)
