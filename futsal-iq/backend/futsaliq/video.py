"""FFmpeg / OpenCV helpers: probing, frame grabbing, audio energy, clip export."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

from .config import FFMPEG, FFPROBE


class VideoError(Exception):
    pass


def probe(path: Path) -> dict:
    """Return duration/fps/size. Uses ffprobe when available, OpenCV otherwise."""
    if FFPROBE:
        try:
            out = subprocess.run(
                [FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
                capture_output=True, text=True, timeout=60, check=True,
            ).stdout
            info = json.loads(out)
            vstreams = [s for s in info.get("streams", []) if s.get("codec_type") == "video"]
            astreams = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
            if not vstreams:
                raise VideoError("O ficheiro não contém uma faixa de vídeo.")
            v = vstreams[0]
            num, den = (v.get("avg_frame_rate") or v.get("r_frame_rate") or "0/1").split("/")
            fps = float(num) / float(den) if float(den) else 0.0
            duration = float(info.get("format", {}).get("duration") or v.get("duration") or 0)
            return {
                "duration": duration,
                "fps": fps,
                "width": int(v.get("width", 0)),
                "height": int(v.get("height", 0)),
                "codec": v.get("codec_name"),
                "hasAudio": bool(astreams),
            }
        except subprocess.CalledProcessError as e:
            raise VideoError(f"ffprobe não conseguiu ler o vídeo: {e.stderr.strip()[:300]}")
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise VideoError("Não foi possível abrir o vídeo.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    n = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    info = {
        "duration": n / fps if fps else 0,
        "fps": fps,
        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "codec": None,
        "hasAudio": False,
    }
    cap.release()
    return info


def grab_frame_jpeg(path: Path, t: float, max_width: int = 1280) -> tuple[bytes, int, int]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise VideoError("Não foi possível abrir o vídeo.")
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000.0)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise VideoError("Não foi possível ler o frame pedido.")
    h, w = frame.shape[:2]
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return buf.tobytes(), w, h


def audio_energy(path: Path, step_s: float = 0.5) -> dict | None:
    """RMS loudness envelope (dBFS) per `step_s` window, via ffmpeg PCM decode."""
    if not FFMPEG:
        return None
    sr = 8000
    proc = subprocess.run(
        [FFMPEG, "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
        capture_output=True, timeout=3600,
    )
    if proc.returncode != 0 or not proc.stdout:
        return None
    pcm = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    win = int(sr * step_s)
    n = len(pcm) // win
    if n == 0:
        return None
    rms = np.sqrt(np.mean(pcm[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    return {"step": step_s, "db": [round(float(x), 1) for x in db]}


def export_clip(src: Path, dst: Path, start: float, end: float, reencode: bool = True) -> Path:
    if not FFMPEG:
        raise VideoError("FFmpeg não está instalado no servidor; não é possível exportar MP4.")
    if end <= start:
        raise VideoError("O timestamp final tem de ser posterior ao inicial.")
    dst.parent.mkdir(parents=True, exist_ok=True)
    if reencode:
        cmd = [FFMPEG, "-y", "-v", "error", "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{end - start:.3f}",
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dst)]
    else:
        cmd = [FFMPEG, "-y", "-v", "error", "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{end - start:.3f}",
               "-c", "copy", "-movflags", "+faststart", str(dst)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0 or not dst.exists():
        raise VideoError(f"FFmpeg falhou: {proc.stderr.strip()[:400]}")
    return dst


BROWSER_CODECS = {"h264", "vp8", "vp9", "av1"}
BROWSER_EXT = {".mp4", ".m4v", ".webm", ".mov"}


def browser_playable(path: Path, info: dict) -> bool:
    return (info.get("codec") or "").lower() in BROWSER_CODECS and path.suffix.lower() in BROWSER_EXT


def transcode_h264(src: Path, dst: Path, duration: float, progress, cancelled) -> Path:
    """Re-encode to H.264/AAC MP4 keeping every frame (frame indices stay valid)."""
    if not FFMPEG:
        raise VideoError("FFmpeg não está instalado: não é possível converter o vídeo.")
    ver = subprocess.run([FFMPEG, "-hide_banner", "-h", "full"], capture_output=True, text=True).stdout
    keep_frames = ["-fps_mode", "passthrough"] if "fps_mode" in ver else ["-vsync", "0"]  # ffmpeg < 5.1
    cmd = [FFMPEG, "-y", "-v", "error", "-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264",
           "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", *keep_frames,
           "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(dst)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        for line in proc.stdout:
            if cancelled():
                proc.kill()
                dst.unlink(missing_ok=True)
                from .detect import Cancelled
                raise Cancelled()
            if line.startswith("out_time_us=") and duration > 0:
                try:
                    progress(min(0.999, int(line.split("=")[1]) / 1e6 / duration))
                except ValueError:
                    pass
        proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()
    if proc.returncode != 0 or not dst.exists():
        err = proc.stderr.read() if proc.stderr else ""
        raise VideoError(f"Conversão falhou: {err.strip()[:300]}")
    return dst
