import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

load_dotenv(BASE_DIR / ".env")

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")

# Demo login lets you try the app locally before registering OAuth apps.
# It is off automatically once any OAuth provider is configured, unless forced on.
_demo_env = os.getenv("ALLOW_DEMO_LOGIN", "auto").lower()
_any_oauth = bool(GOOGLE_CLIENT_ID or GITHUB_CLIENT_ID)
ALLOW_DEMO_LOGIN = _demo_env == "true" or (_demo_env == "auto" and not _any_oauth)


def _session_secret() -> str:
    secret = os.getenv("SESSION_SECRET")
    if secret:
        return secret
    # Persist a generated secret so sessions survive restarts in local dev.
    path = DATA_DIR / ".session_secret"
    if path.exists():
        return path.read_text().strip()
    secret = secrets.token_urlsafe(48)
    path.write_text(secret)
    return secret


SESSION_SECRET = _session_secret()
SESSION_COOKIE = "session"
SESSION_MAX_AGE = 60 * 60 * 24 * 7
COOKIE_SECURE = FRONTEND_URL.startswith("https://")

# Stripe (test mode only: the wallet is for paper trading). https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")

HTTP_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BullSight/1.0"}
