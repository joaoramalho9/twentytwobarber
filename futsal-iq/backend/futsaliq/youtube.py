"""Optional YouTube import via yt-dlp.

Legal note shown to the user: the YouTube Terms of Service only allow downloading
when YouTube offers a download button/link or with the rights holder's permission.
This import is therefore OFF unless the user explicitly confirms they own the video
or have permission (e.g. their club's own footage, or Creative Commons).
The always-available, ToS-compliant path is the official embedded player
(IFrame API) used by the frontend for viewing + manual tagging.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

YOUTUBE_RE = re.compile(r"^(https?://)?(www\.|m\.)?(youtube\.com/(watch\?v=|shorts/|live/|embed/)|youtu\.be/)[\w-]{6,}")


def parse_video_id(url: str) -> str | None:
    m = re.search(r"(?:v=|youtu\.be/|shorts/|live/|embed/)([\w-]{11})", url or "")
    return m.group(1) if m else None


def is_youtube_url(url: str) -> bool:
    return bool(YOUTUBE_RE.match((url or "").strip()))


def available() -> bool:
    try:
        import yt_dlp  # noqa: F401
        return True
    except Exception:
        return False


class YouTubeError(Exception):
    pass


def download(url: str, out_dir: Path, progress: Callable[[float, str], None], cancelled: Callable[[], bool]) -> Path:
    try:
        import yt_dlp
    except ImportError as e:
        raise YouTubeError("yt-dlp não está instalado no servidor (pip install yt-dlp).") from e

    def hook(d):
        if cancelled():
            raise YouTubeError("Importação cancelada pelo utilizador.")
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            progress((done / total) if total else 0.0, "A descarregar do YouTube")

    opts = {
        # 720p is plenty for analysis and keeps CPU cost sane. Prefer mp4/h264.
        "format": "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": str(out_dir / "video.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [hook],
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            fn = Path(ydl.prepare_filename(info))
    except YouTubeError:
        raise
    except Exception as e:  # yt_dlp raises DownloadError with useful text
        msg = str(e)
        if "Sign in" in msg or "age" in msg.lower():
            raise YouTubeError("O YouTube exige sessão iniciada/confirmação de idade para este vídeo. Use a importação de ficheiro.")
        if "unavailable" in msg.lower() or "private" in msg.lower():
            raise YouTubeError("Vídeo indisponível ou privado.")
        raise YouTubeError(f"Não foi possível obter o vídeo do YouTube ({msg[:240]}). Use a importação de ficheiro.")
    candidates = sorted(out_dir.glob("video.*"), key=lambda p: p.stat().st_size, reverse=True)
    candidates = [c for c in candidates if c.suffix not in (".part", ".ytdl", ".json")]
    if fn.exists():
        return fn
    if candidates:
        return candidates[0]
    raise YouTubeError("Download terminou sem ficheiro de vídeo.")
