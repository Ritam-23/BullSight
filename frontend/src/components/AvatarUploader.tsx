"use client";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { api, ApiError, type User } from "@/lib/api";

// The backend serves uploaded pictures from /api/avatars/… ; anything else (an OAuth photo)
// isn't ours to delete.
function isCustom(avatar: string | null | undefined): boolean {
  return Boolean(avatar && avatar.startsWith("/api/avatars/"));
}

/**
 * Avatar with an inline uploader. Clicking the picture (or the camera badge) opens a file
 * picker; the image is validated + re-encoded server-side and the fresh user object is handed
 * back to `onChange` so the page updates without a reload.
 */
export default function AvatarUploader({
  name, avatar, onChange, size = 56,
}: {
  name: string; avatar: string | null; onChange: (user: User) => void; size?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      // Don't set Content-Type — the browser adds the multipart boundary itself.
      const user = await api<User>("/profile/avatar", { method: "POST", body: form });
      onChange(user);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed. Try a different image.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      onChange(await api<User>("/profile/avatar", { method: "DELETE" }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't remove the picture.");
    } finally {
      setBusy(false);
    }
  }

  const dim = { width: size, height: size };

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="group relative" style={dim}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label="Change profile picture"
          className="relative block overflow-hidden rounded-full ring-1 ring-line transition hover:ring-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={dim}
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" style={dim} />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-surface-2 font-semibold text-ink" style={{ fontSize: size * 0.36 }}>
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
            {busy ? <Loader2 size={size * 0.32} className="animate-spin text-white" /> : <Camera size={size * 0.32} className="text-white" />}
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />
      </div>
      {isCustom(avatar) && !busy && (
        <button type="button" onClick={remove} className="flex items-center gap-1 text-xs text-muted hover:text-down">
          <Trash2 size={12} aria-hidden /> Remove
        </button>
      )}
      {error && <p role="alert" className="max-w-[180px] text-xs text-down">{error}</p>}
    </div>
  );
}
