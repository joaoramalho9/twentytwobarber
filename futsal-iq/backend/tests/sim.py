"""Synthetic futsal tracking data (stage-1 format) with a known ground truth.

Used to validate stage-2 analytics deterministically. It does NOT test the detector;
it feeds analytics with what a perfect detector+tracker would output for a scripted match.
Image: 800x400 px, static camera, 20 px per metre.
"""
from __future__ import annotations

import json
import math

import numpy as np

PX = 20.0
DT = 0.2
FPS = 25
L, W = 40.0, 20.0

LAB = {"A": (120, 185, 160), "B": (230, 128, 128), "GKA": (150, 110, 200), "GKB": (70, 160, 80), "REF": (25, 128, 128)}


def corner_pattern(side_top: bool, noise: float, rng):
    """Corner for team A at right end. Returns waypoints relative to the restart time."""
    def fy(y):
        return y if side_top else W - y
    n = lambda: rng.normal(0, noise, 2)
    p = {
        "A4": [(0, 39.0, fy(0.4)), (6, 39.0, fy(0.4))],
        "A1": [(0, 34, fy(6)), (2, 34, fy(6)), (5, 37.5, fy(9.5)), (6, 37.5, fy(9.5))],
        "A2": [(0, 30, fy(10)), (2, 30, fy(10)), (4, 35, fy(6)), (6, 35, fy(6))],
        "A3": [(0, 26, fy(8)), (3, 26, fy(8)), (6, 31, fy(13))],
        "A0": [(0, 3, 10), (6, 3, 10)],
    }
    out = {}
    for k, wps in p.items():
        out[k] = [(t, x + (n()[0] if k != "A0" else 0), y + (n()[1] if k != "A0" else 0)) for t, x, y in wps]
    return out


def _h(s):
    return sum(map(ord, s))


def interp(wps, t):
    if t <= wps[0][0]:
        return np.array(wps[0][1:])
    for (t0, x0, y0), (t1, x1, y1) in zip(wps[:-1], wps[1:]):
        if t0 <= t <= t1:
            w = (t - t0) / (t1 - t0) if t1 > t0 else 0
            return np.array([x0 + (x1 - x0) * w, y0 + (y1 - y0) * w])
    return np.array(wps[-1][1:])


def build(seed=0):
    rng = np.random.default_rng(seed)
    T_END = 90.0
    players = ["A0", "A1", "A2", "A3", "A4", "B0", "B1", "B2", "B3", "B4", "R"]
    # base shapes
    kickoff = {"A0": (2, 10), "A1": (12, 5), "A2": (12, 15), "A3": (16, 10), "A4": (16.5, 12),
               "B0": (38, 10), "B1": (28, 5), "B2": (28, 15), "B3": (24, 10), "B4": (20.4, 10.4), "R": (20, 1.5)}
    att31 = {"A0": (3, 10), "A1": (22, 4), "A2": (22, 10), "A3": (22, 16), "A4": (32, 10),
             "B0": (38.5, 10), "B1": (34, 6), "B2": (34, 14), "B3": (28, 7), "B4": (28, 13), "R": (25, 2)}
    batt = {"A0": (2, 10), "A1": (10, 6), "A2": (10, 14), "A3": (16, 7), "A4": (16, 13),
            "B0": (36, 10), "B1": (24, 4), "B2": (22, 10), "B3": (24, 16), "B4": (14, 10), "R": (18, 2)}
    phase_shapes = [(0, 3, kickoff, False), (3, 20, att31, True), (20, 30, batt, True)]

    def pos(pl, t):
        # scripted phases
        if t < 30:
            for t0, t1, shape, moving in phase_shapes:
                if t0 <= t < t1:
                    base = np.array(shape[pl], float)
                    if moving:
                        ph = _h(pl) % 7
                        base = base + 1.5 * np.array([math.cos(1.2 * t + ph), math.sin(1.2 * t + ph)])
                    return base
        if 30 <= t < 40:
            pat = PATS[0]
            if pl in pat:
                return interp(pat[pl], max(0, t - 34))
            return np.array(att31[pl], float) + ([0, 0] if t < 34 else 1.5 * np.array([math.cos(1.2 * t), math.sin(1.2 * t)]))
        if 40 <= t < 48:
            return np.array(att31[pl], float) + 1.5 * np.array([math.cos(1.2 * t + _h(pl) % 5), math.sin(1.2 * t + _h(pl) % 5)])
        if 48 <= t < 58:
            pat = PATS[1]
            if pl in pat:
                return interp(pat[pl], max(0, t - 52))
            mir = np.array(att31[pl], float)
            mir[1] = W - mir[1]
            return mir + ([0, 0] if t < 52 else 1.5 * np.array([math.cos(1.2 * t), math.sin(1.2 * t)]))
        if 58 <= t < 62:
            return np.array(att31[pl], float) + 1.5 * np.array([math.cos(1.2 * t + _h(pl) % 5), math.sin(1.2 * t + _h(pl) % 5)])
        if 62 <= t < 78:
            return np.array(att31[pl] if t < 70 else kickoff[pl], float)
        return np.array(kickoff[pl], float) + 1.5 * np.array([math.cos(1.2 * t + _h(pl) % 5), math.sin(1.2 * t + _h(pl) % 5)])

    PATS = [corner_pattern(True, 0.0, rng), corner_pattern(False, 0.4, rng)]

    # ball script: list of (t0, t1, holder) or ("fly", t0, t1, from_xy_fn, to)
    holders = []
    t = 3.0
    order = ["A1", "A2", "A3", "A4", "A2", "A1", "A3"]
    k = 0
    while t < 19.5:
        holders.append((t, t + 1.8, order[k % len(order)]))
        t += 2.4
        k += 1
    holders.append((20.0, 21.6, "B1"))
    t, k = 22.2, 0
    border = ["B2", "B3", "B1", "B4"]
    while t < 29.5:
        holders.append((t, t + 1.6, border[k % 4]))
        t += 2.2
        k += 1
    holders += [(30, 36, "A4"), (36.6, 39.0, "A2"), (40, 47.5, "A1"), (48, 54, "A4"), (54.6, 57.5, "A2"),
                (58, 59.6, "A2")]
    holders += [(78.0, 79.0, "B4"), (79.6, 85, "B2")]

    def ball_at(t):
        for t0, t1, h in holders:
            if t0 <= t <= t1:
                return pos(h, t) + np.array([0.6, 0.0]), "held"
        # shot 59.6 -> 60.6 from A2 to goal
        if 59.6 < t <= 60.6:
            a = pos("A2", 59.6) + [0.6, 0]
            b = np.array([40.2, 10.4])
            w = (t - 59.6) / 1.0
            return a + (b - a) * w, "fly"
        if 60.6 < t < 70:
            return np.array([40.3, 10.4]), "goal"
        if 70 <= t < 78:
            return np.array([20.0, 10.0]), "centre"
        if 0 <= t < 3:
            return np.array([20.0, 10.0]), "centre"
        # in flight between holders
        prev = max([h for h in holders if h[1] < t], key=lambda h: h[1], default=None)
        nxt = min([h for h in holders if h[0] > t], key=lambda h: h[0], default=None)
        if prev and nxt:
            a = pos(prev[2], prev[1]) + [0.6, 0]
            b = pos(nxt[2], nxt[0]) + [0.6, 0]
            w = (t - prev[1]) / (nxt[0] - prev[1])
            return a + (b - a) * w, "fly"
        return None, None

    frames = []
    tid = {pl: i + 1 for i, pl in enumerate(players)}
    for n in range(int(T_END / DT)):
        t = round(n * DT, 3)
        ps = []
        for pl in players:
            x, y = pos(pl, t)
            px, py = x * PX, y * PX
            lab = LAB["GKA"] if pl == "A0" else LAB["GKB"] if pl == "B0" else LAB["REF"] if pl == "R" else LAB[pl[0]]
            lab = [c + rng.normal(0, 3) for c in lab]
            ps.append([tid[pl], 0.85, round(px - 8, 1), round(py - 40, 1), round(px + 8, 1), round(py, 1)] + [round(c, 1) for c in lab])
        bxy, _ = ball_at(t)
        balls = []
        if bxy is not None:
            bx, by = bxy * PX
            balls.append([0.6, round(bx - 3, 1), round(by - 6, 1), round(bx + 3, 1), round(by, 1)])
        frames.append({"i": int(round(t * FPS)), "t": t, "p": ps, "b": balls, "s": 0, "g": None})
    return frames


def write_project(storage, frames):
    p = storage.create_project({"name": "Simulação", "teamA": "Azuis", "teamB": "Brancos"})
    pid = p["id"]
    d = storage.project_dir(pid)
    with open(d / "frames.jsonl", "w") as f:
        for fr in frames:
            f.write(json.dumps(fr) + "\n")
    storage.write_json(d / "progress.json", {"params": {"camera_mode": "static", "sample_fps": 5}, "done": True,
                                             "next_frame": frames[-1]["i"] + 1, "max_id": 20})
    from futsaliq.court import solve_homography
    pts = [{"landmark": "corner_left_far", "x": 0, "y": 0}, {"landmark": "corner_left_near", "x": 0, "y": W * PX},
           {"landmark": "corner_right_far", "x": L * PX, "y": 0}, {"landmark": "corner_right_near", "x": L * PX, "y": W * PX}]
    sol = solve_homography(pts, L, W)
    p["calibrations"] = [{"t": 0.0, "points": pts, "H": sol["H"], "errorM": sol["errorM"]}]
    p["video"] = {"file": "none.mp4", "info": {"duration": 90.0, "fps": FPS, "width": int(L * PX), "height": int(W * PX)}}
    storage.save_project(p)
    return pid
