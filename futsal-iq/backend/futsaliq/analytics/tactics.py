"""Tactical analysis computed from calibrated court positions.

All outputs here are *interpretations* built on measured positions; each carries the
measurement it is based on, the number of frames used and a confidence value.
"""
from __future__ import annotations

from collections import Counter, defaultdict

import numpy as np
from scipy.optimize import linear_sum_assignment

from .events import EventLog, FrameState
from .world import TEAMS, World

# Templates in (depth, lateral) metres, attack towards +depth. Outfield players only.
TEMPLATES = {
    "4-0": np.array([(0, -7.5), (0, -2.5), (0, 2.5), (0, 7.5)], float),
    "3-1": np.array([(-2.5, -6), (-2.5, 0), (-2.5, 6), (7.5, 0)], float),
    "2-2": np.array([(-4, -5), (-4, 5), (4, -5), (4, 5)], float),
    "1-2-1": np.array([(-6, 0), (0, -6), (0, 6), (6, 0)], float),
}
for _k, _v in TEMPLATES.items():
    _v -= _v.mean(axis=0)
    TEMPLATES[_k] = _v / np.sqrt((_v ** 2).sum(axis=1).mean())


def classify_shape(pts: np.ndarray) -> tuple[str | None, float]:
    """pts: 4x2 (depth, lateral). Returns (system, confidence)."""
    if len(pts) != 4:
        return None, 0.0
    p = pts - pts.mean(axis=0)
    rms = np.sqrt((p ** 2).sum(axis=1).mean())
    if rms < 1.0:
        return None, 0.0
    p = p / rms
    costs = {}
    for name, tpl in TEMPLATES.items():
        C = ((p[:, None, :] - tpl[None, :, :]) ** 2).sum(axis=2)
        r, c = linear_sum_assignment(C)
        costs[name] = C[r, c].mean()
    ordered = sorted(costs.items(), key=lambda kv: kv[1])
    (best, c1), (_, c2) = ordered[0], ordered[1]
    if c1 > 0.45:
        return None, 0.0
    conf = float(np.clip((c2 - c1) / max(c2, 1e-6), 0, 1))
    return best, conf


def _outfield(world: World, st: FrameState, team: str, t: float):
    """Indices of outfield players of `team` (excludes GK near own goal). Also returns power-play flag."""
    idx = [k for k, tm in enumerate(st.teams) if tm == team]
    if not idx:
        return [], False, None
    d = world.dir(team, t)
    own_x = 0.0 if d == 1 else world.L
    gk = None
    for k in idx:
        if world.players[st.pids[k]].role == "gk":
            gk = k
    if gk is None:
        k = min(idx, key=lambda k: abs(st.xy[k, 0] - own_x))
        if abs(st.xy[k, 0] - own_x) < 9 and abs(st.xy[k, 1] - world.W / 2) < 9:
            gk = k
    power_play = False
    if gk is not None and abs(st.xy[gk, 0] - own_x) > 12:
        power_play = True  # goalkeeper/5th player advanced as an outfield player
    if gk is None and len(idx) >= 5:
        power_play = True
    out = [k for k in idx if k != gk] if not power_play else idx
    return out, power_play, gk


def _depth(world: World, team: str, t: float, xy: np.ndarray) -> np.ndarray:
    """Attack-positive depth coordinate centred on the halfway line, and lateral."""
    d = world.dir(team, t)
    return np.c_[d * (xy[:, 0] - world.L / 2), xy[:, 1] - world.W / 2]


def analyse_spells(world: World, states: list[FrameState], poss: dict, ball: dict) -> dict:
    res = {team: defaultdict(float) for team in TEAMS}
    counts = {team: defaultdict(int) for team in TEAMS}
    spells_out = []
    lists = {team: defaultdict(list) for team in TEAMS}
    for sp in poss["spells"]:
        T = sp["team"]
        D = "B" if T == "A" else "A"
        fr = [f for f in range(sp["start"], sp["end"] + 1) if world.valid[f]]
        dur = sp["t1"] - sp["t0"]
        if dur < 3 or len(fr) < max(3, 0.5 * (sp["end"] - sp["start"] + 1)):
            continue
        att_sys, def_sys = Counter(), Counter()
        pp_frames = 0
        block_depth, marking_pairs, cover_ok, cover_n, lanes_closed, lanes_n = [], defaultdict(list), 0, 0, 0, 0
        sup_frames, width_d, depth_d = 0, [], []
        lateral_orders = []
        for f in fr:
            st = states[f]
            t = world.t[f]
            ao, pp, _ = _outfield(world, st, T, t)
            do, _, _ = _outfield(world, st, D, t)
            if pp:
                pp_frames += 1
            if len(ao) == 4 and not pp:
                s, c = classify_shape(_depth(world, T, t, st.xy[ao]))
                if s:
                    att_sys[s] += c
                lateral_orders.append(tuple((st.pids[k], float(st.xy[k, 1])) for k in ao))
            if len(do) == 4:
                s, c = classify_shape(_depth(world, D, t, st.xy[do]))
                if s:
                    def_sys[s] += c
            if do:
                dD = world.dir(D, t)
                own_x = 0.0 if dD == 1 else world.L
                dist_own = np.abs(st.xy[do, 0] - own_x)
                block_depth.append(float(dist_own.mean()))
                width_d.append(float(np.ptp(st.xy[do, 1])) if len(do) > 1 else 0)
                depth_d.append(float(np.ptp(st.xy[do, 0])) if len(do) > 1 else 0)
                # marking: nearest attacker per defender
                if ao:
                    for k in do:
                        dd = np.linalg.norm(st.xy[ao] - st.xy[k], axis=1)
                        j = int(np.argmin(dd))
                        marking_pairs[st.pids[k]].append((st.pids[ao[j]], float(dd[j])))
                bxy = ball["xy"][f]
                if np.all(np.isfinite(bxy)):
                    dd = np.linalg.norm(st.xy[do] - bxy, axis=1)
                    j = int(np.argmin(dd))
                    if dd[j] < 3.0:  # someone pressing the ball
                        cover_n += 1
                        presser_goal = abs(st.xy[do[j], 0] - own_x)
                        for k2, kk in enumerate(do):
                            if k2 == j:
                                continue
                            dp = np.linalg.norm(st.xy[kk] - st.xy[do[j]])
                            if 2.5 <= dp <= 7.5 and abs(st.xy[kk, 0] - own_x) < presser_goal:
                                cover_ok += 1
                                break
                    # numerical superiority near ball
                    na = int((np.linalg.norm(st.xy[ao] - bxy, axis=1) < 8).sum()) if ao else 0
                    nd = int((dd < 8).sum())
                    if na > nd:
                        sup_frames += 1
                    # passing lanes closed (ball holder -> teammates)
                    holder = poss["holder"][f]
                    if holder and poss["team"][f] == T:
                        for k in ao:
                            if st.pids[k] == holder:
                                continue
                            a, b = bxy, st.xy[k]
                            ab = b - a
                            L2 = float(ab @ ab)
                            if L2 < 4:
                                continue
                            lanes_n += 1
                            tproj = np.clip(((st.xy[do] - a) @ ab) / L2, 0, 1)
                            closest = a + tproj[:, None] * ab
                            dline = np.linalg.norm(st.xy[do] - closest, axis=1)
                            if ((dline < 1.0) & (tproj > 0.1) & (tproj < 0.9)).any():
                                lanes_closed += 1
        n = len(fr)
        # positional swaps: a pair of attackers exchanges lateral sides by >= 3 m, persisting >= 1 s
        swaps = 0
        pair_sign: dict = {}
        pair_cand: dict = {}
        for snap in lateral_orders:
            ids = list(snap)
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    key = tuple(sorted((ids[i][0], ids[j][0])))
                    a_, b_ = (ids[i], ids[j]) if ids[i][0] == key[0] else (ids[j], ids[i])
                    dy = a_[1] - b_[1]
                    if abs(dy) < 3.0:
                        continue
                    sg = 1 if dy > 0 else -1
                    if key not in pair_sign:
                        pair_sign[key] = sg
                        continue
                    if sg == pair_sign[key]:
                        pair_cand.pop(key, None)
                        continue
                    c = pair_cand.get(key, 0) + 1
                    pair_cand[key] = c
                    if c >= max(3, int(round(1.0 / world.dt))):
                        swaps += 1
                        pair_sign[key] = sg
                        pair_cand.pop(key, None)
        # marking type
        stab = []
        dists = []
        for pid, pairs in marking_pairs.items():
            if len(pairs) < 8:
                continue
            c = Counter(p for p, _ in pairs)
            stab.append(c.most_common(1)[0][1] / len(pairs))
            dists.append(np.mean([d for _, d in pairs]))
        marking = None
        if stab:
            ms, md = float(np.mean(stab)), float(np.mean(dists))
            if ms >= 0.7 and md < 3.5:
                marking = "individual"
            elif ms <= 0.45:
                marking = "zona"
            else:
                marking = "mista"
        bd = float(np.mean(block_depth)) if block_depth else None
        block = None
        if bd is not None:
            block = "pressão alta" if bd > 22 else "pressão média" if bd > 13 else "bloco baixo"
        att = att_sys.most_common(1)[0][0] if att_sys else None
        att_share = (att_sys[att] / sum(att_sys.values())) if att else 0
        dsys = def_sys.most_common(1)[0][0] if def_sys else None
        powerplay = pp_frames / n > 0.5
        spell_res = {
            "team": T, "t0": round(sp["t0"], 2), "t1": round(sp["t1"], 2), "frames": n,
            "attackSystem": "power play" if powerplay else att, "attackSystemShare": round(att_share, 2),
            "defenceShape": dsys, "defenceBlock": block, "defenceBlockDepthM": round(bd, 1) if bd else None,
            "marking": marking, "coverPct": round(cover_ok / cover_n, 2) if cover_n >= 5 else None,
            "lanesClosedPct": round(lanes_closed / lanes_n, 2) if lanes_n >= 10 else None,
            "superiorityPct": round(sup_frames / n, 2), "swaps": swaps,
        }
        spells_out.append(spell_res)
        r, c = res[T], counts[T]
        r["possessionAnalysedS"] += dur
        c["spells"] += 1
        if spell_res["attackSystem"]:
            r[f"sys:{spell_res['attackSystem']}"] += dur
        if powerplay:
            r["powerPlayS"] += dur
        rD = res[D]
        if block:
            rD[f"block:{block}"] += dur
        if dsys:
            rD[f"dshape:{dsys}"] += dur
        if marking:
            rD[f"marking:{marking}"] += dur
        if spell_res["coverPct"] is not None:
            lists[D]["cover"].append(spell_res["coverPct"])
        if spell_res["lanesClosedPct"] is not None:
            lists[D]["lanes"].append(spell_res["lanesClosedPct"])
        if bd:
            lists[D]["blockDepth"].append(bd)
        if width_d:
            lists[D]["width"].append(np.mean(width_d))
            lists[D]["depth"].append(np.mean(depth_d))
        lists[T]["superiority"].append(spell_res["superiorityPct"])
        r["swaps"] += swaps
    summary = {}
    for team in TEAMS:
        r, l = res[team], lists[team]
        poss_s = r.get("possessionAnalysedS", 0.0)
        systems = {k[4:]: v for k, v in r.items() if k.startswith("sys:")}
        tot = sum(systems.values())
        blocks = {k[6:]: v for k, v in r.items() if k.startswith("block:")}
        btot = sum(blocks.values())
        dshapes = {k[7:]: v for k, v in r.items() if k.startswith("dshape:")}
        dtot = sum(dshapes.values())
        marks = {k[8:]: v for k, v in r.items() if k.startswith("marking:")}
        mtot = sum(marks.values())
        summary[team] = {
            "possessionAnalysedS": round(poss_s, 1),
            "spells": counts[team]["spells"],
            "attackSystems": {k: round(v / tot, 3) for k, v in sorted(systems.items(), key=lambda kv: -kv[1])} if tot else {},
            "powerPlayS": round(r.get("powerPlayS", 0.0), 1),
            "defenceBlocks": {k: round(v / btot, 3) for k, v in blocks.items()} if btot else {},
            "defenceShapes": {k: round(v / dtot, 3) for k, v in sorted(dshapes.items(), key=lambda kv: -kv[1])} if dtot else {},
            "marking": {k: round(v / mtot, 3) for k, v in marks.items()} if mtot else {},
            "coverPct": round(float(np.mean(l["cover"])), 2) if l["cover"] else None,
            "lanesClosedPct": round(float(np.mean(l["lanes"])), 2) if l["lanes"] else None,
            "blockDepthM": round(float(np.mean(l["blockDepth"])), 1) if l["blockDepth"] else None,
            "defWidthM": round(float(np.mean(l["width"])), 1) if l["width"] else None,
            "defDepthM": round(float(np.mean(l["depth"])), 1) if l["depth"] else None,
            "superiorityPct": round(float(np.mean(l["superiority"])), 2) if l["superiority"] else None,
            "swapsPerMin": round(r.get("swaps", 0) / (poss_s / 60), 2) if poss_s > 30 else None,
        }
    return {"spells": spells_out, "summary": summary}


def player_speeds(world: World) -> dict:
    """Per player smoothed court positions and speeds (valid frames only)."""
    by_pid = defaultdict(list)
    for r, pid in enumerate(world.d_pid):
        if pid and world.d_inside[r]:
            by_pid[pid].append(r)
    out = {}
    for pid, rows in by_pid.items():
        rows = sorted(rows, key=lambda r: world.d_f[r])
        f = world.d_f[rows]
        t = world.t[f]
        xy = world.d_xy[rows].copy()
        # 3-sample median smoothing within continuous runs
        if len(xy) >= 3:
            sm = xy.copy()
            for k in range(1, len(xy) - 1):
                if t[k + 1] - t[k - 1] <= 3 * world.dt + 1e-6:
                    sm[k] = np.median(xy[k - 1:k + 2], axis=0)
            xy = sm
        sp = np.full(len(t), np.nan)
        seg_d = np.zeros(len(t))
        for k in range(1, len(t)):
            dt = t[k] - t[k - 1]
            if 0 < dt <= 0.6:
                d = float(np.linalg.norm(xy[k] - xy[k - 1]))
                v = d / dt
                if v <= 10.0:  # > 36 km/h = projection noise
                    sp[k] = v
                    seg_d[k] = d
        out[pid] = {"f": f, "t": t, "xy": xy, "speed": sp, "dist": seg_d}
    return out


def ruptures(world: World, states, poss, speeds, ev: EventLog) -> list:
    """Runs in behind: attacker (not holder) moving towards goal >= 4.5 m/s for >= 1 s ending beyond last defender."""
    out = []
    holder_team = poss["team"]
    for pid, s in speeds.items():
        pl = world.players.get(pid)
        if not pl or pl.team not in TEAMS or pl.hidden:
            continue
        team = pl.team
        opp = "B" if team == "A" else "A"
        run_start = None
        for k in range(len(s["t"])):
            f = s["f"][k]
            d = world.dir(team, s["t"][k])
            v = s["speed"][k]
            vx = (s["xy"][k, 0] - s["xy"][k - 1, 0]) / max(1e-6, s["t"][k] - s["t"][k - 1]) * d if k else 0
            moving = np.isfinite(v) and v >= 4.5 and vx >= 3.0 and holder_team[f] == team and poss["holder"][f] != pid
            if moving and run_start is None:
                run_start = k
            if (not moving or k == len(s["t"]) - 1) and run_start is not None:
                k_end = k - 1 if not moving else k
                if s["t"][k_end] - s["t"][run_start] >= 1.0:
                    fe = s["f"][k_end]
                    st = states[fe]
                    opp_x = [xy[0] for xy, tm in zip(st.xy, st.teams) if tm == opp]
                    if len(opp_x) >= 3:
                        depth_me = d * s["xy"][k_end, 0]
                        last_def = sorted([d * x for x in opp_x])[-2]  # second-deepest = last outfield defender
                        if depth_me > last_def:
                            out.append(ev.add(type="rupture", label="Movimento de rutura", t=s["t"][run_start],
                                              tEnd=s["t"][k_end], team=team, player=pid,
                                              xy=[round(float(v), 2) for v in s["xy"][run_start]],
                                              xyEnd=[round(float(v), 2) for v in s["xy"][k_end]],
                                              kind="estimativa", confidence=0.5,
                                              method="Jogador sem bola a ≥ 16 km/h em direção à baliza durante ≥ 1 s, terminando nas costas do último defensor de campo."))
                run_start = None
    return out


def transitions(world: World, states, poss, ball, turnovers: list, ev: EventLog) -> dict:
    L = world.L
    res = {team: {"offensive": 0, "counter": 0, "defensive": 0, "counterPress": 0, "regained5s": 0} for team in TEAMS}
    items = []
    t_arr = world.t
    for to in turnovers:
        W_, Lo = to.get("team"), to.get("lostTeam")
        if W_ not in TEAMS or Lo not in TEAMS:
            continue
        t0 = to["t"]
        f0 = int(np.searchsorted(t_arr, t0))
        if f0 >= world.F or not world.valid[f0]:
            continue
        d = world.dir(W_, t0)
        goal_x = L if d == 1 else 0.0
        reached, fast = False, False
        bx0 = ball["xy"][f0]
        max_press = 0
        regained = False
        f = f0
        while f < world.F and t_arr[f] - t0 <= 8:
            bxy = ball["xy"][f]
            if poss["team"][f] == Lo and t_arr[f] - t0 <= 5:
                regained = True
            if np.all(np.isfinite(bxy)) and world.valid[f]:
                if abs(bxy[0] - goal_x) < 12 and t_arr[f] - t0 <= 6:
                    reached = True
                    if np.all(np.isfinite(bx0)) and abs(bxy[0] - bx0[0]) / max(0.5, t_arr[f] - t0) > 3:
                        fast = True
                if t_arr[f] - t0 <= 3:
                    st = states[f]
                    n = sum(1 for xy, tm in zip(st.xy, st.teams) if tm == Lo and np.linalg.norm(xy - bxy) < 4)
                    max_press = max(max_press, n)
            f += 1
        counter = reached and fast and not regained
        cp = max_press >= 2
        res[W_]["offensive"] += 1
        res[W_]["counter"] += int(counter)
        res[Lo]["defensive"] += 1
        res[Lo]["counterPress"] += int(cp)
        res[Lo]["regained5s"] += int(regained)
        items.append(ev.add(type="counter" if counter else "transition", label="Contra-ataque" if counter else "Transição ofensiva",
                            t=t0, tEnd=t0 + 6, team=W_, player=to.get("player"), opponent=Lo,
                            reachedFinalThird=reached, opponentCounterPress=cp, opponentRegained5s=regained,
                            xy=to.get("xy"), kind="interpretação", confidence=0.45 if counter else 0.4,
                            method="Após recuperação: bola chega a ≤ 12 m da baliza adversária em ≤ 6 s com progressão > 3 m/s = contra-ataque. "
                                   "Pressão pós-perda = ≥ 2 adversários a ≤ 4 m da bola nos 3 s seguintes."))
    return {"summary": res, "items": items}


def build_up_from_gk(world: World, states, poss) -> dict:
    res = {team: {"count": 0, "reachedMidfield": 0, "reachedFinalThird": 0, "lostOwnHalf": 0} for team in TEAMS}
    for sp in poss["spells"]:
        T = sp["team"]
        first = poss["holder"][sp["start"]]
        pl = world.players.get(first)
        if not pl or pl.role != "gk":
            continue
        res[T]["count"] += 1
        mid, final = False, False
        for f in sp["frames"]:
            st = states[f]
            if not world.valid[f]:
                continue
            k = [i for i, p in enumerate(st.pids) if p == poss["holder"][f]]
            if not k:
                continue
            x = st.xy[k[0], 0]
            depth = world.dir(T, world.t[f]) * (x - world.L / 2)
            mid |= depth > 0
            final |= depth > world.L / 2 - 13
        res[T]["reachedMidfield"] += int(mid)
        res[T]["reachedFinalThird"] += int(final)
        res[T]["lostOwnHalf"] += int(not mid)
    return res
