"""Futsal court model, image->court homography and camera-motion compensation.

Court coordinate system (metres):
  x: along the length, 0 = left goal line, L = right goal line
  y: across the width, 0 = far touchline (top of a typical broadcast image), W = near touchline
"""
from __future__ import annotations

import pickle
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np


def landmarks(L: float = 40.0, W: float = 20.0) -> dict[str, tuple[str, float, float]]:
    c = W / 2
    return {
        "corner_left_far": ("Canto esquerdo – lado oposto", 0, 0),
        "corner_left_near": ("Canto esquerdo – lado da câmara", 0, W),
        "corner_right_far": ("Canto direito – lado oposto", L, 0),
        "corner_right_near": ("Canto direito – lado da câmara", L, W),
        "half_far": ("Linha de meio-campo – lado oposto", L / 2, 0),
        "half_near": ("Linha de meio-campo – lado da câmara", L / 2, W),
        "center": ("Centro do campo", L / 2, c),
        "pen6_left": ("Marca de penálti (6 m) esquerda", 6, c),
        "pen6_right": ("Marca de penálti (6 m) direita", L - 6, c),
        "pen10_left": ("2.ª marca de penálti (10 m) esquerda", 10, c),
        "pen10_right": ("2.ª marca de penálti (10 m) direita", L - 10, c),
        "post_left_far": ("Poste esq. – lado oposto", 0, c - 1.5),
        "post_left_near": ("Poste esq. – lado da câmara", 0, c + 1.5),
        "post_right_far": ("Poste dir. – lado oposto", L, c - 1.5),
        "post_right_near": ("Poste dir. – lado da câmara", L, c + 1.5),
        "area_left_far": ("Área esq. × linha de fundo – lado oposto", 0, c - 7.5),
        "area_left_near": ("Área esq. × linha de fundo – lado da câmara", 0, c + 7.5),
        "area_right_far": ("Área dir. × linha de fundo – lado oposto", L, c - 7.5),
        "area_right_near": ("Área dir. × linha de fundo – lado da câmara", L, c + 7.5),
        "area_left_top": ("Área esq. – topo (lado oposto)", 6, c - 1.5),
        "area_left_bottom": ("Área esq. – topo (lado da câmara)", 6, c + 1.5),
        "area_right_top": ("Área dir. – topo (lado oposto)", L - 6, c - 1.5),
        "area_right_bottom": ("Área dir. – topo (lado da câmara)", L - 6, c + 1.5),
    }


def court_lines(L: float = 40.0, W: float = 20.0) -> list[list[tuple[float, float]]]:
    """Polylines (court metres) for drawing."""
    c = W / 2
    lines: list[list[tuple[float, float]]] = [
        [(0, 0), (L, 0), (L, W), (0, W), (0, 0)],
        [(L / 2, 0), (L / 2, W)],
    ]
    circ = [(L / 2 + 3 * np.cos(a), c + 3 * np.sin(a)) for a in np.linspace(0, 2 * np.pi, 48)]
    lines.append([(float(x), float(y)) for x, y in circ])
    for side in (0, 1):
        sx = (lambda x: x) if side == 0 else (lambda x: L - x)
        pts = []
        for a in np.linspace(-np.pi / 2, 0, 16):  # far quarter-circle around far post
            pts.append((sx(6 * np.cos(a)), c - 1.5 + 6 * np.sin(a)))
        for a in np.linspace(0, np.pi / 2, 16):
            pts.append((sx(6 * np.cos(a)), c + 1.5 + 6 * np.sin(a)))
        lines.append([(float(x), float(y)) for x, y in pts])
    return lines


def solve_homography(points: list[dict], L: float, W: float) -> dict:
    """points: [{landmark, x, y}] in image pixels -> homography img->court."""
    lm = landmarks(L, W)
    img, crt = [], []
    for p in points:
        if p["landmark"] not in lm:
            raise ValueError(f"Referência desconhecida: {p['landmark']}")
        img.append([float(p["x"]), float(p["y"])])
        crt.append([lm[p["landmark"]][1], lm[p["landmark"]][2]])
    if len(img) < 4:
        raise ValueError("São necessários pelo menos 4 pontos de referência.")
    img_a = np.array(img, dtype=np.float64)
    crt_a = np.array(crt, dtype=np.float64)
    # Degenerate check: need non-collinear court points
    if np.linalg.matrix_rank(np.c_[crt_a, np.ones(len(crt_a))]) < 3:
        raise ValueError("Os pontos escolhidos são colineares no campo; escolha referências em linhas diferentes.")
    H, _ = cv2.findHomography(img_a, crt_a, 0 if len(img) == 4 else cv2.RANSAC, 0.75)
    if H is None:
        raise ValueError("Não foi possível calcular a homografia com esses pontos.")
    proj = cv2.perspectiveTransform(img_a.reshape(-1, 1, 2), H).reshape(-1, 2)
    err = np.linalg.norm(proj - crt_a, axis=1)
    return {"H": H.tolist(), "errorM": float(err.mean()), "maxErrorM": float(err.max())}


def project_lines(H_img2court: np.ndarray, L: float, W: float) -> list[list[list[float]]]:
    Hinv = np.linalg.inv(H_img2court)
    out = []
    for poly in court_lines(L, W):
        a = np.array(poly, dtype=np.float64).reshape(-1, 1, 2)
        p = cv2.perspectiveTransform(a, Hinv).reshape(-1, 2)
        out.append([[round(float(x), 1), round(float(y), 1)] for x, y in p])
    return out


def to_court(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    if len(pts) == 0:
        return np.zeros((0, 2))
    return cv2.perspectiveTransform(pts.reshape(-1, 1, 2).astype(np.float64), H).reshape(-1, 2)


# ---------------------------------------------------------------------------
# Camera motion compensation (pan/tilt/zoom of a fixed-position camera = homography)
# ---------------------------------------------------------------------------

@dataclass
class _Keyframe:
    seg: int
    G: np.ndarray            # keyframe -> segment reference (small-image coords)
    kp: np.ndarray           # Nx2 keypoints
    des: np.ndarray


@dataclass
class CameraMotion:
    """Estimates, for every analysed frame, G_f: frame -> segment-reference homography.

    Matching is done against the current keyframe (not the previous frame) to limit drift.
    On a hard cut (replay, other camera) we try to re-localise against recent keyframes;
    if that fails a new segment starts. Calibrations are valid only inside their segment.
    """
    width: int = 640
    keyframes: list[_Keyframe] = field(default_factory=list)
    cur: int = -1
    next_seg: int = 0
    min_inliers: int = 40

    def __post_init__(self):
        self.orb = cv2.ORB_create(nfeatures=1500, fastThreshold=12)
        self.bf = cv2.BFMatcher(cv2.NORM_HAMMING)

    def _features(self, gray: np.ndarray, boxes: np.ndarray, scale: float):
        mask = np.full(gray.shape, 255, np.uint8)
        for b in boxes:
            x1, y1, x2, y2 = (b * scale).astype(int)
            cv2.rectangle(mask, (x1 - 4, y1 - 4), (x2 + 4, y2 + 4), 0, -1)
        kp, des = self.orb.detectAndCompute(gray, mask)
        if des is None or len(kp) < 20:
            return None, None
        return np.float32([k.pt for k in kp]), des

    def _match(self, kp1, des1, kp2, des2):
        """Homography mapping points of image 1 -> image 2, inlier count."""
        try:
            matches = self.bf.knnMatch(des1, des2, k=2)
        except cv2.error:
            return None, 0
        good = [m for m, n in (p for p in matches if len(p) == 2) if m.distance < 0.75 * n.distance]
        if len(good) < self.min_inliers:
            return None, len(good)
        p1 = kp1[[m.queryIdx for m in good]]
        p2 = kp2[[m.trainIdx for m in good]]
        disp = np.linalg.norm(p1 - p2, axis=1)
        if np.median(disp) > 3:  # camera moving: drop static overlay features (score bug, logos)
            keep = disp > 1.0
            p1, p2 = p1[keep], p2[keep]
            if len(p1) < self.min_inliers:
                return None, len(p1)
        H, inl = cv2.findHomography(p1, p2, cv2.RANSAC, 3.0)
        if H is None:
            return None, 0
        n_in = int(inl.sum())
        # sanity: reject extreme warps
        det = np.linalg.det(H[:2, :2])
        if n_in < self.min_inliers or not (0.5 < det < 2.0):
            return None, n_in
        return H, n_in

    def update(self, frame_bgr: np.ndarray, person_boxes: np.ndarray) -> tuple[int, np.ndarray | None]:
        h, w = frame_bgr.shape[:2]
        scale = self.width / w
        small = cv2.resize(frame_bgr, (self.width, int(h * scale)))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        kp, des = self._features(gray, person_boxes, scale)
        S = np.diag([scale, scale, 1.0])
        Sinv = np.diag([1 / scale, 1 / scale, 1.0])
        if kp is None:
            return -1, None  # featureless frame (e.g. black/fade)

        if self.cur >= 0:
            kf = self.keyframes[self.cur]
            H, n_in = self._match(kp, des, kf.kp, kf.des)
            if H is not None:
                G_small = kf.G @ H
                if n_in < 2.5 * self.min_inliers:  # overlap shrinking -> promote to keyframe
                    self.keyframes.append(_Keyframe(kf.seg, G_small, kp, des))
                    self.cur = len(self.keyframes) - 1
                    self._trim()
                return kf.seg, Sinv @ G_small @ S
            # lost: try to re-localise against recent keyframes (cut back to main camera)
            for idx in range(len(self.keyframes) - 1, max(-1, len(self.keyframes) - 40), -1):
                if idx == self.cur:
                    continue
                k2 = self.keyframes[idx]
                H, n_in = self._match(kp, des, k2.kp, k2.des)
                if H is not None:
                    G_small = k2.G @ H
                    self.keyframes.append(_Keyframe(k2.seg, G_small, kp, des))
                    self.cur = len(self.keyframes) - 1
                    self._trim()
                    return k2.seg, Sinv @ G_small @ S
        # new segment
        seg = self.next_seg
        self.next_seg += 1
        self.keyframes.append(_Keyframe(seg, np.eye(3), kp, des))
        self.cur = len(self.keyframes) - 1
        self._trim()
        return seg, np.eye(3)

    def _trim(self, keep: int = 300):
        if len(self.keyframes) > keep:
            drop = len(self.keyframes) - keep
            self.keyframes = self.keyframes[drop:]
            self.cur -= drop

    # persistence for resumable analysis
    def save(self, path: Path):
        state = {"kf": [(k.seg, k.G, k.kp, k.des) for k in self.keyframes], "cur": self.cur, "next_seg": self.next_seg}
        with open(path, "wb") as f:
            pickle.dump(state, f)

    def load(self, path: Path) -> bool:
        try:
            with open(path, "rb") as f:
                st = pickle.load(f)
        except (FileNotFoundError, EOFError, pickle.UnpicklingError):
            return False
        self.keyframes = [_Keyframe(*k) for k in st["kf"]]
        self.cur = st["cur"]
        self.next_seg = st["next_seg"]
        return True
