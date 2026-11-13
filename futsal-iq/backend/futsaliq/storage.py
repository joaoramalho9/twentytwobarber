"""Filesystem storage for projects (video + intermediate tracking data + results).

Layout per project:
  data/projects/<id>/project.json     metadata, settings, calibration, corrections
  data/projects/<id>/video.<ext>      source video (uploaded or imported)
  data/projects/<id>/frames.jsonl     stage-1 detections/tracks (append-only, checkpointed)
  data/projects/<id>/progress.json    stage-1 checkpoint
  data/projects/<id>/audio.json       audio energy envelope
  data/projects/<id>/analysis.json    stage-2 results
  data/projects/<id>/clips/           exported MP4 clips
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .config import PROJECTS_DIR

_lock = threading.RLock()
_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{4,64}$")


class NotFound(Exception):
    pass


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def project_dir(pid: str) -> Path:
    if not _ID_RE.match(pid):
        raise NotFound(pid)
    d = PROJECTS_DIR / pid
    return d


def read_json(path: Path, default: Any = None) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def _np_default(o):
    import numpy as np
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(f"not serializable: {type(o).__name__}")


def write_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"), default=_np_default)
    os.replace(tmp, path)


def create_project(meta: dict) -> dict:
    pid = new_id()
    d = PROJECTS_DIR / pid
    d.mkdir(parents=True)
    (d / "clips").mkdir()
    now = time.time()
    project = {
        "id": pid,
        "name": meta.get("name") or "Jogo sem nome",
        "competition": meta.get("competition") or "",
        "date": meta.get("date") or "",
        "teamA": {"name": meta.get("teamA") or "Equipa A", "color": meta.get("teamAColor") or None},
        "teamB": {"name": meta.get("teamB") or "Equipa B", "color": meta.get("teamBColor") or None},
        "youtubeUrl": meta.get("youtubeUrl") or None,
        "video": None,
        "court": meta.get("court") or {"length": 40.0, "width": 20.0},
        "calibrations": [],
        "halfTimeS": None,
        "corrections": {"merge": [], "names": {}, "team": {}, "role": {}, "hidden": []},
        "createdAt": now,
        "updatedAt": now,
    }
    write_json(d / "project.json", project)
    return project


def load_project(pid: str) -> dict:
    d = project_dir(pid)
    p = read_json(d / "project.json")
    if p is None:
        raise NotFound(pid)
    return p


def save_project(project: dict) -> dict:
    with _lock:
        project["updatedAt"] = time.time()
        write_json(project_dir(project["id"]) / "project.json", project)
    return project


def update_project(pid: str, **fields) -> dict:
    with _lock:
        p = load_project(pid)
        p.update(fields)
        return save_project(p)


def list_projects() -> list[dict]:
    out = []
    for d in sorted(PROJECTS_DIR.iterdir()) if PROJECTS_DIR.exists() else []:
        p = read_json(d / "project.json")
        if p:
            out.append(p)
    out.sort(key=lambda p: p.get("updatedAt", 0), reverse=True)
    return out


def video_path(pid: str) -> Path | None:
    p = load_project(pid)
    if not p.get("video"):
        return None
    vp = project_dir(pid) / p["video"]["file"]
    return vp if vp.exists() else None
