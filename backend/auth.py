"""OAuth 2.0 login (Google, GitHub) with signed, HTTP-only session cookies."""
import secrets
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, Cookie, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

import config
import users

router = APIRouter(prefix="/api/auth", tags=["auth"])
_serializer = URLSafeTimedSerializer(config.SESSION_SECRET, salt="session")
_state_serializer = URLSafeTimedSerializer(config.SESSION_SECRET, salt="oauth-state")

PROVIDERS = {
    "google": {
        "client_id": config.GOOGLE_CLIENT_ID,
        "client_secret": config.GOOGLE_CLIENT_SECRET,
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scope": "openid email profile",
    },
    "github": {
        "client_id": config.GITHUB_CLIENT_ID,
        "client_secret": config.GITHUB_CLIENT_SECRET,
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "scope": "read:user user:email",
    },
}


def _redirect_uri(provider: str) -> str:
    # Callbacks go through the frontend origin (Next.js rewrites /api to this server),
    # so the session cookie is set on the same origin the browser uses.
    return f"{config.FRONTEND_URL}/api/auth/callback/{provider}"


def _provider(name: str) -> dict:
    p = PROVIDERS.get(name)
    if not p or not p["client_id"] or not p["client_secret"]:
        raise HTTPException(404, f"OAuth provider '{name}' is not configured")
    return p


def _set_session(resp, user: dict):
    resp.set_cookie(
        config.SESSION_COOKIE,
        _serializer.dumps(user),
        max_age=config.SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=config.COOKIE_SECURE,
        path="/",
    )
    # A short-lived, JS-readable marker so the frontend can tell "this page load is a
    # fresh sign-in" (covers both the JSON password login and the OAuth redirect) and
    # email the purchase receipt exactly once. Not security-sensitive: the httponly
    # session cookie above is the actual credential.
    resp.set_cookie(
        "fresh_login",
        "1",
        max_age=120,
        httponly=False,
        samesite="lax",
        secure=config.COOKIE_SECURE,
        path="/",
    )


def read_session(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        return _serializer.loads(token, max_age=config.SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None


def require_user(session: str | None = Cookie(default=None)) -> dict:
    user = read_session(session)
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user


@router.get("/providers")
def providers():
    return {
        "providers": [n for n, p in PROVIDERS.items() if p["client_id"] and p["client_secret"]],
        "demo": config.ALLOW_DEMO_LOGIN,
        "password": True,
    }


def _client_ip(request: Request) -> str:
    # Requests arrive via the Next.js rewrite proxy, which forwards the browser's address.
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else "?")


class RegisterBody(BaseModel):
    name: str
    email: str
    password: str


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/register")
def register(body: RegisterBody, request: Request):
    ip = _client_ip(request)
    if users.throttled(f"reg-ip:{ip}"):
        raise HTTPException(429, "Too many attempts. Please wait a few minutes.")
    try:
        user = users.create(body.name, body.email, body.password)
    except users.AuthError as e:
        users.record_failure(f"reg-ip:{ip}")
        raise HTTPException(400, str(e)) from e
    resp = JSONResponse({"ok": True, "user": user})
    _set_session(resp, user)
    return resp


@router.post("/login")
def password_login(body: LoginBody, request: Request):
    ip = _client_ip(request)
    keys = (f"ip:{ip}", f"email:{body.email.strip().lower()}")
    if users.throttled(*keys):
        raise HTTPException(429, "Too many failed attempts. Please wait a few minutes and try again.")
    user = users.authenticate(body.email, body.password)
    if not user:
        users.record_failure(*keys)
        raise HTTPException(401, "Incorrect email or password.")
    users.clear_failures(*keys)
    resp = JSONResponse({"ok": True, "user": user})
    _set_session(resp, user)
    return resp


@router.get("/login/{provider}")
def login(provider: str):
    p = _provider(provider)
    nonce = secrets.token_urlsafe(16)
    params = {
        "client_id": p["client_id"],
        "redirect_uri": _redirect_uri(provider),
        "response_type": "code",
        "scope": p["scope"],
        "state": nonce,
    }
    if provider == "google":
        params["prompt"] = "select_account"
    resp = RedirectResponse(f"{p['authorize_url']}?{urlencode(params)}", status_code=302)
    resp.set_cookie("oauth_state", _state_serializer.dumps(nonce), max_age=600,
                    httponly=True, samesite="lax", secure=config.COOKIE_SECURE, path="/")
    return resp


def _fetch_profile(provider: str, access_token: str) -> dict:
    auth = {"Authorization": f"Bearer {access_token}"}
    if provider == "google":
        info = requests.get("https://openidconnect.googleapis.com/v1/userinfo", headers=auth, timeout=15).json()
        return {"id": f"google:{info['sub']}", "name": info.get("name") or info.get("email"),
                "email": info.get("email"), "avatar": info.get("picture"), "provider": "google"}
    gh = {**auth, "Accept": "application/vnd.github+json"}
    info = requests.get("https://api.github.com/user", headers=gh, timeout=15).json()
    email = info.get("email")
    if not email:
        emails = requests.get("https://api.github.com/user/emails", headers=gh, timeout=15).json()
        primary = next((e for e in emails if isinstance(e, dict) and e.get("primary")), None)
        email = primary["email"] if primary else None
    return {"id": f"github:{info['id']}", "name": info.get("name") or info.get("login"),
            "email": email, "avatar": info.get("avatar_url"), "provider": "github"}


@router.get("/callback/{provider}")
def callback(provider: str, request: Request, code: str | None = None, state: str | None = None,
             error: str | None = None):
    p = _provider(provider)
    fail = RedirectResponse(f"{config.FRONTEND_URL}/?error=oauth", status_code=302)
    if error or not code or not state:
        return fail
    try:
        expected = _state_serializer.loads(request.cookies.get("oauth_state", ""), max_age=600)
    except (BadSignature, SignatureExpired):
        return fail
    if not secrets.compare_digest(expected, state):
        return fail

    token_resp = requests.post(
        p["token_url"],
        data={
            "client_id": p["client_id"],
            "client_secret": p["client_secret"],
            "code": code,
            "redirect_uri": _redirect_uri(provider),
            "grant_type": "authorization_code",
        },
        headers={"Accept": "application/json"},
        timeout=15,
    )
    access_token = token_resp.json().get("access_token") if token_resp.ok else None
    if not access_token:
        return fail

    user = _fetch_profile(provider, access_token)
    resp = RedirectResponse(f"{config.FRONTEND_URL}/", status_code=302)
    resp.delete_cookie("oauth_state", path="/")
    _set_session(resp, user)
    return resp


@router.post("/demo")
def demo_login():
    if not config.ALLOW_DEMO_LOGIN:
        raise HTTPException(403, "Demo login is disabled")
    resp = JSONResponse({"ok": True})
    _set_session(resp, {"id": "demo", "name": "Demo User", "email": None, "avatar": None, "provider": "demo"})
    return resp


@router.get("/me")
def me(session: str | None = Cookie(default=None)):
    user = read_session(session)
    if not user:
        raise HTTPException(401, "Not authenticated")
    from profiles import with_avatar  # local import: profiles depends on this module
    return with_avatar(user)


@router.post("/logout")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(config.SESSION_COOKIE, path="/")
    return resp
