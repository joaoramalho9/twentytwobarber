"""FUTSAL IQ — HTTP API (FastAPI)."""
from __future__ import annotations

import bisect
import io
import json
import re
import shutil
import threading
import zipfile
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import court, detect, storage, video, youtube
from .config import ALLOWED_VIDEO_EXT, BASE_DIR, DEFAULT_ANALYSIS, FFMPEG, MODELS_DIR
from .jobs import jobs

app = FastAPI(title="FUTSAL IQ API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["X-Frame-Width", "X-Frame-Height", "Content-Disposition"])


@app.exception_handler(storage.NotFound)
async def _nf(_req: Request, _exc: storage.NotFound):
    return JSONResponse({"detail": "Projeto não encontrado."}, status_code=404)


@app.exception_handler(video.VideoError)
async def _ve(_req: Request, exc: video.VideoError):
    return JSONResponse({"detail": str(exc)}, status_code=422)


# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    try:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        torch_v = torch.__version__
    except Exception:
        device, torch_v = None, None
    try:
        import ultralytics
        ul = ultralytics.__version__
    except Exception:
        ul = None
    return {
        "ok": True,
        "ffmpeg": bool(FFMPEG),
        "ytdlp": youtube.available(),
        "ultralytics": ul,
        "torch": torch_v,
        "device": device,
        "models": sorted(p.name for p in MODELS_DIR.glob("*.pt")),
        "defaults": DEFAULT_ANALYSIS,
    }


# ---------------------------------------------------------------------------
class ProjectIn(BaseModel):
    name: str = Field("", max_length=120)
    competition: str = Field("", max_length=120)
    date: str = Field("", max_length=40)
    teamA: str = Field("", max_length=60)
    teamB: str = Field("", max_length=60)
    teamAColor: str | None = None
    teamBColor: str | None = None
    youtubeUrl: str | None = None
    court: dict | None = None


HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _check_court(c: dict | None):
    if c is None:
        return None
    L, W = float(c.get("length", 40)), float(c.get("width", 20))
    if not (25 <= L <= 45 and 14 <= W <= 25):
        raise HTTPException(422, "Dimensões do campo fora dos limites (comprimento 25–45 m, largura 14–25 m).")
    return {"length": L, "width": W}


@app.get("/api/projects")
def list_projects():
    out = []
    for p in storage.list_projects():
        d = storage.project_dir(p["id"])
        p["hasAnalysis"] = (d / "analysis.json").exists()
        p["job"] = jobs.status(p["id"])
        out.append(p)
    return out


@app.post("/api/projects")
def create_project(body: ProjectIn):
    if body.youtubeUrl and not youtube.is_youtube_url(body.youtubeUrl):
        raise HTTPException(422, "O link não parece ser um URL válido do YouTube.")
    for c in (body.teamAColor, body.teamBColor):
        if c and not HEX.match(c):
            raise HTTPException(422, "Cor inválida (use #rrggbb).")
    data = body.model_dump()
    data["court"] = _check_court(body.court) or {"length": 40.0, "width": 20.0}
    p = storage.create_project(data)
    if body.youtubeUrl:
        p["youtubeId"] = youtube.parse_video_id(body.youtubeUrl)
        storage.save_project(p)
    return p


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    p = storage.load_project(pid)
    p["hasAnalysis"] = (storage.project_dir(pid) / "analysis.json").exists()
    p["job"] = jobs.status(pid)
    return p


class ProjectPatch(BaseModel):
    name: str | None = None
    competition: str | None = None
    date: str | None = None
    teamA: dict | None = None
    teamB: dict | None = None
    court: dict | None = None
    halfTimeS: float | None = None
    clearHalfTime: bool = False


@app.patch("/api/projects/{pid}")
def patch_project(pid: str, body: ProjectPatch):
    p = storage.load_project(pid)
    for k in ("name", "competition", "date"):
        v = getattr(body, k)
        if v is not None:
            p[k] = v[:120]
    for k in ("teamA", "teamB"):
        v = getattr(body, k)
        if v is not None:
            col = v.get("color")
            if col and not HEX.match(col):
                raise HTTPException(422, "Cor inválida (use #rrggbb).")
            p[k] = {"name": (v.get("name") or p[k]["name"])[:60], "color": col or None}
    if body.court is not None:
        p["court"] = _check_court(body.court)
    if body.halfTimeS is not None:
        p["halfTimeS"] = max(0.0, float(body.halfTimeS))
    if body.clearHalfTime:
        p["halfTimeS"] = None
    return storage.save_project(p)


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    st = jobs.status(pid)
    if st.get("status") in ("queued", "running"):
        raise HTTPException(409, "Interrompa o processamento antes de apagar o projeto.")
    d = storage.project_dir(pid)
    if not d.exists():
        raise storage.NotFound(pid)
    shutil.rmtree(d)
    return {"ok": True}


# ---------------------------------------------------------------------------
@app.post("/api/projects/{pid}/upload")
async def upload_video(pid: str, file: UploadFile = File(...)):
    p = storage.load_project(pid)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_VIDEO_EXT:
        raise HTTPException(422, f"Formato não suportado ({ext or 'sem extensão'}). Use MP4, MOV, MKV, AVI ou WEBM.")
    if jobs.status(pid).get("status") in ("queued", "running"):
        raise HTTPException(409, "Há um processamento em curso para este projeto.")
    d = storage.project_dir(pid)
    for old in d.glob("video.*"):
        old.unlink()
    for f in ("frames.jsonl", "progress.json", "camera.pkl", "analysis.json", "audio.json"):
        (d / f).unlink(missing_ok=True)
    dst = d / f"video{ext}"
    with open(dst, "wb") as out:
        while chunk := await file.read(8 * 1024 * 1024):
            out.write(chunk)
    try:
        info = video.probe(dst)
    except video.VideoError:
        dst.unlink(missing_ok=True)
        raise
    if info["duration"] <= 0 or info["width"] <= 0:
        dst.unlink(missing_ok=True)
        raise HTTPException(422, "Não foi possível ler a duração/resolução do vídeo.")
    p["video"] = {"file": dst.name, "info": info, "source": "upload", "originalName": file.filename}
    p["calibrations"] = []
    storage.save_project(p)
    if not video.browser_playable(dst, info):
        # e.g. AVI/MPEG-4 Part 2/HEVC: convert so the browser can play it (frames are preserved)
        jobs.submit(pid, "transcode")
    return p


class YouTubeIn(BaseModel):
    url: str
    confirmRights: bool = False


@app.post("/api/projects/{pid}/youtube")
def import_youtube(pid: str, body: YouTubeIn):
    storage.load_project(pid)
    if not youtube.is_youtube_url(body.url):
        raise HTTPException(422, "URL do YouTube inválido.")
    if not body.confirmRights:
        raise HTTPException(422, "É necessário confirmar que tem direitos ou autorização para descarregar este vídeo.")
    if not youtube.available():
        raise HTTPException(501, "yt-dlp não está instalado no servidor.")
    try:
        return jobs.submit(pid, "youtube", {"url": body.url})
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@app.get("/api/projects/{pid}/video")
def get_video(pid: str):
    vp = storage.video_path(pid)
    if not vp:
        raise HTTPException(404, "Este projeto não tem vídeo local.")
    media = {".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
             ".mkv": "video/x-matroska", ".avi": "video/x-msvideo"}.get(vp.suffix.lower(), "application/octet-stream")
    return FileResponse(vp, media_type=media)


@app.get("/api/projects/{pid}/frame")
def get_frame(pid: str, t: float = Query(0.0, ge=0)):
    vp = storage.video_path(pid)
    if not vp:
        raise HTTPException(404, "Este projeto não tem vídeo local.")
    jpg, w, h = video.grab_frame_jpeg(vp, t)
    return Response(jpg, media_type="image/jpeg", headers={"X-Frame-Width": str(w), "X-Frame-Height": str(h)})


# ---------------------------------------------------------------------------
class AnalyzeIn(BaseModel):
    sample_fps: float = Field(DEFAULT_ANALYSIS["sample_fps"], ge=1, le=15)
    model: str = DEFAULT_ANALYSIS["model"]
    imgsz: int = Field(DEFAULT_ANALYSIS["imgsz"], ge=320, le=1920)
    person_conf: float = Field(DEFAULT_ANALYSIS["person_conf"], ge=0.05, le=0.9)
    ball_conf: float = Field(DEFAULT_ANALYSIS["ball_conf"], ge=0.03, le=0.9)
    camera_mode: str = DEFAULT_ANALYSIS["camera_mode"]
    start_s: float = Field(0.0, ge=0)
    end_s: float | None = None
    restart: bool = False


ALLOWED_MODELS = {"yolo11n.pt", "yolo11s.pt", "yolo11m.pt", "yolov8n.pt", "yolov8s.pt", "yolov8m.pt"}


@app.post("/api/projects/{pid}/analyze")
def start_analysis(pid: str, body: AnalyzeIn):
    if not storage.video_path(pid):
        raise HTTPException(422, "O projeto não tem vídeo. Carregue um ficheiro ou importe do YouTube.")
    if body.model not in ALLOWED_MODELS:
        raise HTTPException(422, "Modelo não suportado.")
    if body.camera_mode not in ("static", "moving"):
        raise HTTPException(422, "Modo de câmara inválido.")
    params = body.model_dump()
    restart = params.pop("restart")
    if restart:
        detect.reset(pid)
        (storage.project_dir(pid) / "analysis.json").unlink(missing_ok=True)
    try:
        return jobs.submit(pid, "full", params)
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@app.post("/api/projects/{pid}/reanalyze")
def reanalyze(pid: str):
    if not detect.checkpoint(pid):
        raise HTTPException(422, "Ainda não existem dados de deteção. Execute primeiro a análise do vídeo.")
    try:
        return jobs.submit(pid, "analyze")
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@app.post("/api/projects/{pid}/cancel")
def cancel(pid: str):
    return {"ok": jobs.cancel(pid)}


@app.get("/api/projects/{pid}/job")
def job_status(pid: str):
    storage.load_project(pid)
    return jobs.status(pid)


@app.get("/api/projects/{pid}/analysis")
def get_analysis(pid: str):
    a = storage.read_json(storage.project_dir(pid) / "analysis.json")
    if a is None:
        raise HTTPException(404, "Ainda não há análise para este projeto.")
    return a


# ---------------------------------------------------------------------------
@app.get("/api/court/landmarks")
def get_landmarks(length: float = 40.0, width: float = 20.0):
    lm = court.landmarks(length, width)
    return [{"id": k, "label": v[0], "x": v[1], "y": v[2]} for k, v in lm.items()]


class CalibIn(BaseModel):
    t: float = 0.0
    points: list[dict]
    imageWidth: int | None = None
    imageHeight: int | None = None


@app.post("/api/projects/{pid}/calibration/preview")
def calib_preview(pid: str, body: CalibIn):
    p = storage.load_project(pid)
    L, W = p["court"]["length"], p["court"]["width"]
    try:
        sol = court.solve_homography(body.points, L, W)
    except ValueError as e:
        raise HTTPException(422, str(e))
    sol["lines"] = court.project_lines(np.array(sol["H"]), L, W)
    return sol


@app.post("/api/projects/{pid}/calibrations")
def add_calibration(pid: str, body: CalibIn):
    p = storage.load_project(pid)
    L, W = p["court"]["length"], p["court"]["width"]
    try:
        sol = court.solve_homography(body.points, L, W)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if sol["errorM"] > 1.5:
        raise HTTPException(422, f"Erro de reprojeção elevado ({sol['errorM']:.2f} m). Verifique os pontos marcados.")
    cal = {"t": float(body.t), "points": body.points, "H": sol["H"], "errorM": sol["errorM"]}
    p.setdefault("calibrations", []).append(cal)
    p["calibrations"].sort(key=lambda c: c["t"])
    storage.save_project(p)
    return p


@app.delete("/api/projects/{pid}/calibrations/{idx}")
def del_calibration(pid: str, idx: int):
    p = storage.load_project(pid)
    if not (0 <= idx < len(p.get("calibrations", []))):
        raise HTTPException(404, "Calibração inexistente.")
    p["calibrations"].pop(idx)
    return storage.save_project(p)


class CorrectionsIn(BaseModel):
    merge: list[list[str]] = []
    names: dict[str, str] = {}
    team: dict[str, str] = {}
    role: dict[str, str] = {}
    hidden: list[str] = []
    swapTeams: bool = False


@app.put("/api/projects/{pid}/corrections")
def put_corrections(pid: str, body: CorrectionsIn):
    p = storage.load_project(pid)
    p["corrections"] = body.model_dump()
    return storage.save_project(p)


# ---------------------------------------------------------------------------
# Overlay data (boxes / court positions) for synchronised playback
# ---------------------------------------------------------------------------
_cache_lock = threading.Lock()
_frame_cache: dict[str, tuple[float, list, list]] = {}


def _frames_cached(pid: str):
    fp = storage.project_dir(pid) / "frames.jsonl"
    if not fp.exists():
        return [], []
    mt = fp.stat().st_mtime
    with _cache_lock:
        c = _frame_cache.get(pid)
        if c and c[0] == mt:
            return c[1], c[2]
    frames = detect.load_frames(pid)
    times = [f["t"] for f in frames]
    with _cache_lock:
        if len(_frame_cache) > 2:
            _frame_cache.pop(next(iter(_frame_cache)))
        _frame_cache[pid] = (mt, frames, times)
    return frames, times


@app.get("/api/projects/{pid}/overlay")
def overlay(pid: str, start: float = 0.0, end: float = 10.0):
    if end - start > 120:
        end = start + 120
    frames, times = _frames_cached(pid)
    a = storage.read_json(storage.project_dir(pid) / "analysis.json") or {}
    tmap = a.get("trackMap", {})
    teams = {pl["id"]: (pl["team"], pl["name"], pl["role"]) for pl in a.get("players", [])}
    p = storage.load_project(pid)
    from .analytics.world import frame_homographies
    i0, i1 = bisect.bisect_left(times, start), bisect.bisect_right(times, end)
    sub = frames[i0:i1]
    params = (detect.checkpoint(pid) or {}).get("params", {})
    # homographies need the full frame list for the reference keyframe lookup
    Hs_all = frame_homographies(frames, p.get("calibrations") or [], params.get("camera_mode", "moving")) if p.get("calibrations") else None
    out = []
    for k, fr in enumerate(sub):
        H = Hs_all[i0 + k] if Hs_all else None
        persons = []
        for q in fr["p"]:
            pid_ = tmap.get(str(q[0]))
            team, name, role = teams.get(pid_, ("?", None, None))
            xy = None
            if H is not None:
                c = court.to_court(H, np.array([[(q[2] + q[4]) / 2, q[5]]]))[0]
                xy = [round(float(c[0]), 2), round(float(c[1]), 2)]
            persons.append({"tid": q[0], "pid": pid_, "team": team, "name": name, "role": role,
                            "box": q[2:6], "xy": xy})
        ball = None
        if fr["b"]:
            b = fr["b"][0]
            bxy = None
            if H is not None:
                c = court.to_court(H, np.array([[(b[1] + b[3]) / 2, b[4]]]))[0]
                bxy = [round(float(c[0]), 2), round(float(c[1]), 2)]
            ball = {"box": b[1:5], "conf": b[0], "xy": bxy}
        out.append({"t": fr["t"], "persons": persons, "ball": ball})
    return {"frames": out}


# ---------------------------------------------------------------------------
# Clips
# ---------------------------------------------------------------------------
class ClipIn(BaseModel):
    start: float = Field(..., ge=0)
    end: float = Field(..., gt=0)
    title: str = "clip"


def _safe(name: str) -> str:
    s = re.sub(r"[^\w\-]+", "_", name, flags=re.UNICODE).strip("_")
    return (s or "clip")[:60]


@app.post("/api/projects/{pid}/clips/export")
def export_clip(pid: str, body: ClipIn):
    vp = storage.video_path(pid)
    if not vp:
        raise HTTPException(404, "Este projeto não tem vídeo local (clips de vídeos só no YouTube não podem ser exportados).")
    if body.end - body.start > 600:
        raise HTTPException(422, "Clip demasiado longo (máx. 10 min).")
    name = f"{_safe(body.title)}_{int(body.start)}-{int(body.end)}.mp4"
    dst = storage.project_dir(pid) / "clips" / name
    video.export_clip(vp, dst, body.start, body.end)
    return FileResponse(dst, media_type="video/mp4", filename=name)


class BatchIn(BaseModel):
    clips: list[ClipIn]


@app.post("/api/projects/{pid}/clips/export-batch")
def export_batch(pid: str, body: BatchIn):
    vp = storage.video_path(pid)
    if not vp:
        raise HTTPException(404, "Este projeto não tem vídeo local.")
    if not body.clips or len(body.clips) > 100:
        raise HTTPException(422, "Selecione entre 1 e 100 clips.")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        for i, c in enumerate(body.clips):
            name = f"{i + 1:02d}_{_safe(c.title)}.mp4"
            dst = storage.project_dir(pid) / "clips" / name
            video.export_clip(vp, dst, c.start, c.end)
            z.write(dst, name)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": 'attachment; filename="clips_futsal_iq.zip"'})


# ---------------------------------------------------------------------------
# Serve the built frontend (single-command deployment)
# ---------------------------------------------------------------------------
_dist = BASE_DIR.parent / "frontend" / "dist"
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        f = _dist / full_path
        if full_path and f.is_file() and _dist in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(_dist / "index.html")
