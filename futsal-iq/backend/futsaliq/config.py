"""Global configuration for the FUTSAL IQ backend."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("FUTSALIQ_DATA", BASE_DIR / "data"))
PROJECTS_DIR = DATA_DIR / "projects"
MODELS_DIR = Path(os.environ.get("FUTSALIQ_MODELS", BASE_DIR / "models"))

PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")

# COCO classes used by the generic YOLO models
COCO_PERSON = 0
COCO_BALL = 32

# Default analysis parameters (user can override per analysis)
DEFAULT_ANALYSIS = {
    "sample_fps": 5.0,          # frames analysed per second of video
    "model": "yolo11n.pt",      # yolo11n / yolo11s / yolo11m (downloaded once, free)
    "imgsz": 960,               # inference size; larger helps the small futsal ball
    "person_conf": 0.25,
    "ball_conf": 0.10,
    "camera_mode": "moving",    # "static" or "moving" (camera motion compensation)
    "start_s": 0.0,
    "end_s": None,
}

# Futsal court (FIFA): length 38-42 m, width 20-25 m. Defaults to 40x20.
DEFAULT_COURT = {"length": 40.0, "width": 20.0}

ALLOWED_VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mpg", ".mpeg"}
