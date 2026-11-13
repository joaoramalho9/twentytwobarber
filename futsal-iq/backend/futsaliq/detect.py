"""Stage 1 — detection + tracking (expensive, checkpointed, resumable).

For every sampled frame we store:
  persons: [track_id, conf, x1, y1, x2, y2, L, a, b]   (Lab = median torso colour)
  balls:   [conf, x1, y1, x2, y2]                       (top-3 candidates, untracked)
  camera:  segment id + homography frame->segment reference (moving-camera mode)
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Callable

import cv2
import numpy as np

from . import storage
from .config import COCO_BALL, COCO_PERSON, MODELS_DIR
from .court import CameraMotion

PARAM_KEYS = ("sample_fps", "model", "imgsz", "person_conf", "ball_conf", "camera_mode", "start_s", "end_s")


class Cancelled(Exception):
    pass


def load_model(name: str):
    from ultralytics import YOLO
    if "/" in name or "\\" in name or not name.endswith(".pt"):
        raise ValueError("Nome de modelo inválido.")
    path = MODELS_DIR / name
    # Ultralytics downloads official weights automatically (free) on first use.
    return YOLO(str(path))


def make_tracker(sample_fps: float):
    from ultralytics.trackers.byte_tracker import BYTETracker
    args = SimpleNamespace(
        tracker_type="bytetrack", track_high_thresh=0.35, track_low_thresh=0.1, new_track_thresh=0.4,
        track_buffer=max(5, int(round(2.5 * sample_fps))), match_thresh=0.8, fuse_score=True,
    )
    try:
        return BYTETracker(args)
    except TypeError:  # older ultralytics signature
        return BYTETracker(args, frame_rate=int(round(sample_fps)))


def torso_lab(frame: np.ndarray, box) -> tuple[float, float, float]:
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    xa, xb = int(x1 + 0.28 * w), int(x2 - 0.28 * w)
    ya, yb = int(y1 + 0.18 * h), int(y1 + 0.48 * h)
    H, W = frame.shape[:2]
    xa, xb, ya, yb = max(0, xa), min(W, xb), max(0, ya), min(H, yb)
    if xb - xa < 2 or yb - ya < 2:
        return (float("nan"),) * 3
    patch = cv2.cvtColor(frame[ya:yb, xa:xb], cv2.COLOR_BGR2LAB).reshape(-1, 3)
    med = np.median(patch, axis=0)
    return float(med[0]), float(med[1]), float(med[2])


def _paths(pid: str):
    d = storage.project_dir(pid)
    return d / "frames.jsonl", d / "progress.json", d / "camera.pkl"


def checkpoint(pid: str) -> dict | None:
    return storage.read_json(_paths(pid)[1])


def reset(pid: str):
    for p in _paths(pid):
        p.unlink(missing_ok=True)


def run(pid: str, params: dict, progress: Callable[[float, str, dict], None], cancelled: Callable[[], bool]) -> dict:
    frames_path, prog_path, cam_path = _paths(pid)
    vpath = storage.video_path(pid)
    if vpath is None:
        raise RuntimeError("O projeto ainda não tem vídeo.")
    project = storage.load_project(pid)
    info = project["video"]["info"]
    fps = info["fps"] or 25.0
    duration = info["duration"]

    p = {k: params[k] for k in PARAM_KEYS}
    ck = storage.read_json(prog_path)
    if ck and ck.get("params") != p:
        reset(pid)
        ck = None

    step = max(1, int(round(fps / float(p["sample_fps"]))))
    start_f = int(float(p["start_s"] or 0) * fps)
    end_s = float(p["end_s"]) if p.get("end_s") else duration
    end_f = int(min(duration, end_s) * fps)
    if end_f <= start_f:
        raise RuntimeError("Intervalo de análise inválido.")

    if ck and ck.get("done"):
        return ck
    next_f = ck["next_frame"] if ck else start_f
    id_offset = (ck["max_id"] + 1000) if ck else 0
    max_id = ck["max_id"] if ck else 0

    # drop any partial lines beyond the checkpoint
    if frames_path.exists():
        kept = []
        with open(frames_path, encoding="utf-8") as f:
            for line in f:
                try:
                    if json.loads(line)["i"] < next_f:
                        kept.append(line)
                except (json.JSONDecodeError, KeyError):
                    pass
        with open(frames_path, "w", encoding="utf-8") as f:
            f.writelines(kept)

    progress(0.0, "A carregar o modelo YOLO (descarrega na 1.ª utilização)", {})
    model = load_model(p["model"])
    tracker = make_tracker(float(p["sample_fps"]))
    cam = None
    if p["camera_mode"] == "moving":
        cam = CameraMotion()
        if ck:
            cam.load(cam_path)

    cap = cv2.VideoCapture(str(vpath))
    if not cap.isOpened():
        raise RuntimeError("Não foi possível abrir o vídeo para análise.")
    cap.set(cv2.CAP_PROP_POS_FRAMES, next_f)
    idx = next_f
    out = open(frames_path, "a", encoding="utf-8")
    t0 = time.time()
    processed = 0
    total = max(1, (end_f - start_f) // step)
    done_before = (next_f - start_f) // step

    def save_ck(done: bool):
        out.flush()
        if cam is not None:
            cam.save(cam_path)
        storage.write_json(prog_path, {
            "params": p, "next_frame": idx, "max_id": max_id, "done": done, "step": step,
            "fps": fps, "start_f": start_f, "end_f": end_f, "updatedAt": time.time(),
        })

    try:
        while idx < end_f:
            if cancelled():
                save_ck(False)
                raise Cancelled()
            if (idx - start_f) % step != 0:
                if not cap.grab():
                    break
                idx += 1
                continue
            ok, frame = cap.read()
            if not ok:
                break
            r = model.predict(frame, classes=[COCO_PERSON, COCO_BALL], conf=min(p["ball_conf"], p["person_conf"], 0.1),
                              imgsz=int(p["imgsz"]), verbose=False)[0]
            boxes = r.boxes.cpu().numpy()
            cls = boxes.cls.astype(int) if len(boxes) else np.zeros(0, int)
            pmask = cls == COCO_PERSON
            bmask = (cls == COCO_BALL) & (boxes.conf >= p["ball_conf"])
            tracks = tracker.update(boxes[pmask], frame)
            persons = []
            for row in tracks:
                x1, y1, x2, y2, tid, score = row[:6]
                if score < p["person_conf"] * 0.6:
                    continue
                tid = int(tid) + id_offset
                max_id = max(max_id, tid)
                L, a, b = torso_lab(frame, (x1, y1, x2, y2))
                persons.append([tid, round(float(score), 3), round(float(x1), 1), round(float(y1), 1),
                                round(float(x2), 1), round(float(y2), 1), round(L, 1), round(a, 1), round(b, 1)])
            balls = []
            if bmask.any():
                bb = boxes[bmask]
                order = np.argsort(-bb.conf)[:3]
                for j in order:
                    x1, y1, x2, y2 = bb.xyxy[j]
                    balls.append([round(float(bb.conf[j]), 3), round(float(x1), 1), round(float(y1), 1),
                                  round(float(x2), 1), round(float(y2), 1)])
            rec = {"i": idx, "t": round(idx / fps, 3), "p": persons, "b": balls}
            if cam is not None:
                pb = np.array([q[2:6] for q in persons], dtype=np.float64).reshape(-1, 4)
                seg, G = cam.update(frame, pb)
                rec["s"] = seg
                rec["g"] = [round(float(v), 7) for v in G.ravel()] if G is not None else None
            else:
                rec["s"] = 0
                rec["g"] = None
            out.write(json.dumps(rec, separators=(",", ":")) + "\n")
            idx += 1
            processed += 1
            if processed % 25 == 0:
                save_ck(False)
                done_n = done_before + processed
                rate = processed / max(1e-6, time.time() - t0)
                eta = (total - done_n) / rate if rate > 0 else None
                progress(min(0.999, done_n / total), "Deteção e tracking de jogadores e bola",
                         {"framesDone": done_n, "framesTotal": total, "fps": round(rate, 2),
                          "etaS": round(eta) if eta else None, "videoT": round(idx / fps, 1)})
        save_ck(True)
    finally:
        out.close()
        cap.release()
    return storage.read_json(prog_path)


def load_frames(pid: str) -> list[dict]:
    frames_path = _paths(pid)[0]
    out = []
    if not frames_path.exists():
        return out
    with open(frames_path, encoding="utf-8") as f:
        for line in f:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    out.sort(key=lambda r: r["i"])
    return out
