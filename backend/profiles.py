"""User profile pictures: validated, re-encoded and stored on disk; the users DB maps user -> file."""
import hashlib
import io
import re
import time
from contextlib import contextmanager

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError

import config
import users
from auth import require_user

router = APIRouter(prefix="/api", tags=["profile"])

AVATAR_DIR = config.DATA_DIR / "avatars"
AVATAR_DIR.mkdir(exist_ok=True)
MAX_BYTES = 5 * 1024 * 1024
ALLOWED = {"image/png", "image/jpeg", "image/webp", "image/gif"}
SIZE = 256
Image.MAX_IMAGE_PIXELS = 40_000_000  # refuse decompression bombs


@contextmanager
def _db():
    with users._lock, users._conn() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, avatar_file TEXT, updated_at REAL)")
        yield conn


def custom_avatar(user_id: str) -> str | None:
    with _db() as conn:
        row = conn.execute("SELECT avatar_file FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    return f"/api/avatars/{row[0]}" if row and row[0] else None


def with_avatar(user: dict) -> dict:
    """Session user with their uploaded picture (if any) taking precedence over the OAuth one."""
    custom = custom_avatar(user["id"])
    return {**user, "avatar": custom or user.get("avatar"), "has_custom_avatar": bool(custom)}


def _process(raw: bytes) -> bytes:
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise HTTPException(400, "That file isn't a valid image.") from e
    img = ImageOps.exif_transpose(img)  # honour phone camera rotation, then EXIF is dropped on re-encode
    img = img.convert("RGBA") if img.mode in ("RGBA", "LA", "P") else img.convert("RGB")
    img = ImageOps.fit(img, (SIZE, SIZE), method=Image.LANCZOS, centering=(0.5, 0.5))
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=88, method=4)  # fresh encode: no metadata, no embedded payloads
    return out.getvalue()


def _remove_file(name: str | None) -> None:
    if name:
        (AVATAR_DIR / name).unlink(missing_ok=True)


@router.post("/profile/avatar")
async def upload_avatar(file: UploadFile = File(...), user=Depends(require_user)):
    if file.content_type not in ALLOWED:
        raise HTTPException(400, "Please upload a PNG, JPEG, WebP or GIF image.")
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "Image is larger than 5 MB.")
    data = _process(raw)
    uid_slug = re.sub(r"[^A-Za-z0-9]", "_", user["id"])[:40]
    name = f"{uid_slug}_{hashlib.sha256(data).hexdigest()[:16]}.webp"  # content hash: new URL on every change
    (AVATAR_DIR / name).write_bytes(data)
    with _db() as conn:
        old = conn.execute("SELECT avatar_file FROM profiles WHERE user_id = ?", (user["id"],)).fetchone()
        conn.execute("INSERT INTO profiles (user_id, avatar_file, updated_at) VALUES (?, ?, ?) "
                     "ON CONFLICT(user_id) DO UPDATE SET avatar_file = excluded.avatar_file, updated_at = excluded.updated_at",
                     (user["id"], name, time.time()))
    if old and old[0] != name:
        _remove_file(old[0])
    return with_avatar(user)


@router.delete("/profile/avatar")
def delete_avatar(user=Depends(require_user)):
    with _db() as conn:
        old = conn.execute("SELECT avatar_file FROM profiles WHERE user_id = ?", (user["id"],)).fetchone()
        conn.execute("UPDATE profiles SET avatar_file = NULL, updated_at = ? WHERE user_id = ?", (time.time(), user["id"]))
    _remove_file(old[0] if old else None)
    return with_avatar(user)


@router.get("/avatars/{name}")
def avatar_file(name: str, _user=Depends(require_user)):
    if not re.fullmatch(r"[A-Za-z0-9_]+_[0-9a-f]{16}\.webp", name):
        raise HTTPException(404)
    path = AVATAR_DIR / name
    if not path.exists():
        raise HTTPException(404)
    # Content-hashed file names never change, so they can be cached for a long time.
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, max-age=31536000, immutable"})
