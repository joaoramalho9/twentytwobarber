"""Set pieces and rehearsed-play (jogada ensaiada) detection.

A set piece is only labelled as a rehearsed play when the *movement pattern* of the
executing team (positions relative to the ball over the first seconds after the restart,
normalised for attack direction and ball side) repeats in at least one other set piece
of the same type by the same team.
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np
from scipy.optimize import linear_sum_assignment

from .events import FrameState
from .world import TEAMS, World

SET_TYPES = {"corner", "kick_in", "free_kick", "goal_clearance", "penalty"}
STEPS = [0, 1, 2, 3, 4, 5, 6]          # seconds after restart
MATCH_THRESHOLD_M = 3.5


def _snapshot(world: World, states: list[FrameState], t: float, team: str):
    f = int(np.searchsorted(world.t, t))
    best = None
    for k in (f, f - 1, f + 1):
        if 0 <= k < world.F and world.valid[k] and abs(world.t[k] - t) <= 0.6:
            best = k
            break
    if best is None:
        return None
    st = states[best]
    return {pid: st.xy[i] for i, (pid, tm) in enumerate(zip(st.pids, st.teams)) if tm == team}


def extract_pattern(world: World, states, sp: dict) -> dict | None:
    team = sp.get("team")
    if team not in TEAMS or sp.get("xy") is None:
        return None
    bxy = np.array(sp["xy"])
    d = world.dir(team, sp["t"])
    flip = 1.0 if bxy[1] < world.W / 2 else -1.0
    traj = defaultdict(dict)
    for s in STEPS:
        snap = _snapshot(world, states, sp["t"] + s, team)
        if not snap:
            continue
        for pid, xy in snap.items():
            rel = np.array([d * (xy[0] - bxy[0]), flip * (xy[1] - bxy[1])])
            traj[pid][s] = rel
    traj = {pid: v for pid, v in traj.items() if 0 in v and len(v) >= 4}
    if len(traj) < 3:
        return None
    return {"traj": traj, "flip": flip, "dir": d}


def pattern_distance(p1: dict, p2: dict) -> tuple[float, list]:
    a, b = list(p1["traj"].items()), list(p2["traj"].items())
    C = np.full((len(a), len(b)), 1e3)
    for i, (_, ta) in enumerate(a):
        for j, (_, tb) in enumerate(b):
            common = [s for s in STEPS if s in ta and s in tb]
            if len(common) >= 3:
                C[i, j] = float(np.mean([np.linalg.norm(ta[s] - tb[s]) for s in common]))
    r, c = linear_sum_assignment(C)
    pairs = [(a[i][0], b[j][0], C[i, j]) for i, j in zip(r, c) if C[i, j] < 1e3]
    if len(pairs) < 3:
        return float("inf"), []
    return float(np.mean([p[2] for p in pairs])), pairs


def analyse(world: World, states, restarts: list, passes: list, shots: list, goals: list, poss) -> dict:
    items = []
    for sp in restarts:
        if sp["type"] not in SET_TYPES:
            continue
        pat = extract_pattern(world, states, sp)
        t0, t1 = sp["t"], sp["t"] + 10
        seq = [p for p in passes if t0 - 0.5 <= p["t"] <= t1 and p["team"] == sp.get("team")]
        sh = [s for s in shots if t0 <= s["t"] <= t1 and s.get("team") == sp.get("team")]
        gl = [g for g in goals if t0 <= g["t"] <= t1 + 5 and g.get("team") == sp.get("team")]
        # outcome
        lost = False
        f0, f1 = int(np.searchsorted(world.t, t0)), int(np.searchsorted(world.t, t1))
        for f in range(f0, min(f1, world.F)):
            if poss["team"][f] and sp.get("team") in TEAMS and poss["team"][f] != sp["team"]:
                lost = True
                break
        if gl:
            result = "golo provável"
        elif sh:
            result = "remate"
        elif lost:
            result = "perda de posse"
        elif sp.get("team") in TEAMS:
            result = "posse mantida"
        else:
            result = "indeterminado"
        initial = None
        moves = None
        if pat:
            initial = {pid: [round(float(v[0][0]), 2), round(float(v[0][1]), 2)] for pid, v in pat["traj"].items()}
            moves = {pid: [[s, round(float(xy[0]), 2), round(float(xy[1]), 2)] for s, xy in sorted(v.items())]
                     for pid, v in pat["traj"].items()}
        items.append({
            "eventId": sp["id"], "t": sp["t"], "type": sp["type"], "label": sp["label"], "team": sp.get("team"),
            "taker": sp.get("player"), "ballXY": sp.get("xy"), "initialPositions": initial, "movements": moves,
            "passes": [{"t": p["t"], "from": p["player"], "to": p["to"]} for p in seq],
            "finish": ({"t": sh[0]["t"], "player": sh[0].get("player"), "onTarget": sh[0].get("onTarget")} if sh else None),
            "result": result, "detectionConfidence": sp["confidence"], "_pat": pat,
            "rehearsed": False, "patternId": None, "patternSimilarityM": None, "rehearsedConfidence": 0.0,
        })
    # repetition clustering per (team, type)
    groups = defaultdict(list)
    for i, it in enumerate(items):
        if it["_pat"] is not None:
            groups[(it["team"], it["type"])].append(i)
    patterns = []
    for (team, typ), idxs in groups.items():
        n = len(idxs)
        parent = list(range(n))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        dmat = np.full((n, n), np.inf)
        for a in range(n):
            for b in range(a + 1, n):
                d, _ = pattern_distance(items[idxs[a]]["_pat"], items[idxs[b]]["_pat"])
                dmat[a, b] = dmat[b, a] = d
                if d <= MATCH_THRESHOLD_M:
                    parent[find(b)] = find(a)
        comps = defaultdict(list)
        for a in range(n):
            comps[find(a)].append(a)
        for comp in comps.values():
            if len(comp) < 2:
                continue
            pid = f"P{len(patterns) + 1}"
            ds = [dmat[a, b] for a in comp for b in comp if a < b and np.isfinite(dmat[a, b])]
            mean_d = float(np.mean(ds))
            conf = float(np.clip(1 - mean_d / MATCH_THRESHOLD_M, 0, 1)) * 0.6 + min(0.3, 0.1 * len(comp))
            for a in comp:
                it = items[idxs[a]]
                it["rehearsed"] = True
                it["patternId"] = pid
                others = [dmat[a, b] for b in comp if b != a and np.isfinite(dmat[a, b])]
                it["patternSimilarityM"] = round(float(min(others)), 2) if others else None
                it["rehearsedConfidence"] = round(conf * it["detectionConfidence"] / 0.7, 2)
            patterns.append({"id": pid, "team": team, "type": typ, "occurrences": [items[idxs[a]]["eventId"] for a in comp],
                             "times": [items[idxs[a]]["t"] for a in comp], "meanDistanceM": round(mean_d, 2),
                             "confidence": round(conf, 2),
                             "results": [items[idxs[a]]["result"] for a in comp]})
    for it in items:
        it.pop("_pat", None)
    return {"items": items, "patterns": patterns,
            "method": f"Trajetórias da equipa executante (0–6 s após o reinício) relativas à bola, normalizadas pelo sentido de ataque e lado da bola; "
                      f"jogadores emparelhados pelo algoritmo húngaro. Duas execuções com distância média ≤ {MATCH_THRESHOLD_M} m formam um padrão repetido."}
