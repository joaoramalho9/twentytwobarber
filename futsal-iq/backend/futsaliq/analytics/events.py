"""Ball track, possession, and automatic event detection.

Every event carries:
  source: "auto"         (automatic detection from tracking data)
  kind:   "deteção" | "estimativa" | "interpretação"
  confidence: 0..1
  method: short human-readable explanation of how it was derived
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from .world import TEAMS, World


@dataclass
class FrameState:
    rows: np.ndarray           # detection rows of players (inside court, assigned, not hidden)
    pids: list
    teams: list
    xy: np.ndarray             # court coords (nan if uncalibrated)
    feet: np.ndarray           # image coords
    heights: np.ndarray


def frame_states(world: World) -> list[FrameState]:
    by_f = defaultdict(list)
    hidden = {pid for pid, p in world.players.items() if p.hidden}
    for r, f in enumerate(world.d_f):
        pid = world.d_pid[r]
        if not pid or pid in hidden:
            continue
        if world.valid[f] and not world.d_inside[r]:
            continue  # bench / public / outside court
        by_f[f].append(r)
    out = []
    for i in range(world.F):
        rows = np.array(by_f.get(i, []), dtype=int)
        box = world.d_box[rows] if len(rows) else np.zeros((0, 4))
        out.append(FrameState(
            rows=rows,
            pids=[world.d_pid[r] for r in rows],
            teams=[world.players[world.d_pid[r]].team for r in rows],
            xy=world.d_xy[rows] if len(rows) else np.zeros((0, 2)),
            feet=np.c_[(box[:, 0] + box[:, 2]) / 2, box[:, 3]] if len(rows) else np.zeros((0, 2)),
            heights=(box[:, 3] - box[:, 1]) if len(rows) else np.zeros(0),
        ))
    return out


# ---------------------------------------------------------------------------
# Ball
# ---------------------------------------------------------------------------

def ball_track(world: World) -> dict:
    """Pick one ball candidate per frame with motion gating; interpolate short gaps."""
    F = world.F
    cand = defaultdict(list)
    for r, f in enumerate(world.b_f):
        cand[f].append(r)
    img = np.full((F, 2), np.nan)
    crt = np.full((F, 2), np.nan)
    conf = np.zeros(F)
    detected = np.zeros(F, dtype=bool)
    last_f, last_img = None, None
    for f in range(F):
        rows = cand.get(f, [])
        if not rows:
            continue
        best, best_score = None, -1e9
        for r in rows:
            b = world.b_box[r]
            c = np.array([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])
            if world.valid[f]:
                xy = world.b_xy[r]
                if not (np.all(np.isfinite(xy)) and -1 < xy[0] < world.L + 1 and -1 < xy[1] < world.W + 1):
                    continue
            score = world.b_conf[r]
            if last_f is not None and f - last_f <= int(1.0 / world.dt) + 1:
                jump = np.linalg.norm(c - last_img) / max(1, world.img_w)
                if jump > 0.25 * (f - last_f) * world.dt / 0.2:
                    continue
                score -= jump
            if score > best_score:
                best, best_score = r, score
        if best is None:
            continue
        b = world.b_box[best]
        img[f] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
        crt[f] = world.b_xy[best] if world.valid[f] else np.nan
        conf[f] = world.b_conf[best]
        detected[f] = True
        last_f, last_img = f, img[f]
    # interpolate gaps <= 1 s
    interp = np.zeros(F, dtype=bool)
    idx = np.flatnonzero(detected)
    max_gap = max(1, int(round(1.0 / world.dt)))
    for a, b in zip(idx[:-1], idx[1:]):
        if 1 < b - a <= max_gap:
            for f in range(a + 1, b):
                w = (f - a) / (b - a)
                img[f] = img[a] * (1 - w) + img[b] * w
                if np.all(np.isfinite(crt[a])) and np.all(np.isfinite(crt[b])):
                    crt[f] = crt[a] * (1 - w) + crt[b] * w
                interp[f] = True
    return {"img": img, "xy": crt, "conf": conf, "detected": detected, "interp": interp}


# ---------------------------------------------------------------------------
# Possession
# ---------------------------------------------------------------------------

def possession(world: World, states: list[FrameState], ball: dict, dead: np.ndarray | None = None) -> dict:
    """Ball holder per frame. No holder while the ball travels fast (pass/shot in flight) or play is dead.
    A holder must be observed in >= 2 consecutive frames (filters a ball flying past a player)."""
    F = world.F
    holder = np.array([""] * F, dtype=object)
    hteam = np.array([""] * F, dtype=object)
    bspeed = np.linalg.norm(ball_velocity(world, ball), axis=1)
    for f in range(F):
        st = states[f]
        if not len(st.pids):
            continue
        if dead is not None and dead[f]:
            continue
        if not (ball["detected"][f] or ball["interp"][f]):
            continue
        if np.isfinite(bspeed[f]) and bspeed[f] > 7.0:
            continue
        cand = [k for k, tm in enumerate(st.teams) if tm in TEAMS]
        if not cand:
            continue
        if world.valid[f] and np.all(np.isfinite(ball["xy"][f])):
            d = np.linalg.norm(st.xy[cand] - ball["xy"][f], axis=1)
            k = int(np.argmin(d))
            if d[k] <= 1.6:
                holder[f] = st.pids[cand[k]]
                hteam[f] = st.teams[cand[k]]
        elif not world.calibrated[f]:
            d = np.linalg.norm(st.feet[cand] - ball["img"][f], axis=1) / np.maximum(st.heights[cand], 10)
            k = int(np.argmin(d))
            if d[k] <= 0.55:
                holder[f] = st.pids[cand[k]]
                hteam[f] = st.teams[cand[k]]
    # remove single-frame touches
    for f in range(F):
        if holder[f] and not ((f > 0 and holder[f - 1] == holder[f]) or (f + 1 < F and holder[f + 1] == holder[f])):
            holder[f] = ""
            hteam[f] = ""
    # spells: merge same-team observations separated by <= 3 s with no opposing touch between
    spells = []
    obs = np.flatnonzero(hteam != "")
    cur = None
    for f in obs:
        tm = hteam[f]
        crossed_dead = dead is not None and dead[cur["end"]:f].any() if cur else False
        if cur and cur["team"] == tm and world.t[f] - world.t[cur["end"]] <= 3.0 and not crossed_dead:
            cur["end"] = f
            cur["frames"].append(f)
        else:
            if cur:
                spells.append(cur)
            cur = {"team": tm, "start": f, "end": f, "frames": [f]}
    if cur:
        spells.append(cur)
    team_time = {"A": 0.0, "B": 0.0}
    for s in spells:
        s["t0"] = float(world.t[s["start"]])
        s["t1"] = float(world.t[s["end"]]) + world.dt
        team_time[s["team"]] += s["t1"] - s["t0"]
    return {"holder": holder, "team": hteam, "spells": spells, "teamTime": team_time, "dead": dead}


# ---------------------------------------------------------------------------
# Event detection
# ---------------------------------------------------------------------------

class EventLog:
    def __init__(self):
        self.items = []

    def add(self, **kw):
        kw.setdefault("source", "auto")
        kw["id"] = f"e{len(self.items) + 1}"
        for k in ("t", "tEnd", "confidence"):
            if k in kw and kw[k] is not None:
                kw[k] = round(float(kw[k]), 2)
        self.items.append(kw)
        return kw


def _xy(v):
    return [round(float(v[0]), 2), round(float(v[1]), 2)] if v is not None and np.all(np.isfinite(v)) else None


def passes_and_turnovers(world: World, poss: dict, ball: dict, ev: EventLog) -> dict:
    holder, hteam = poss["holder"], poss["team"]
    obs = np.flatnonzero(holder != "")
    out = {"passes": [], "turnovers": []}
    for a, b in zip(obs[:-1], obs[1:]):
        pa, pb = holder[a], holder[b]
        if pa == pb:
            continue
        gap = world.t[b] - world.t[a]
        xa, xb = ball["xy"][a], ball["xy"][b]
        calibrated = np.all(np.isfinite(xa)) and np.all(np.isfinite(xb))
        if hteam[a] == hteam[b]:
            if gap > 3.0 or (poss.get("dead") is not None and poss["dead"][a:b].any()):
                continue
            conf = 0.55 if calibrated else 0.35
            conf *= min(1.0, ball["detected"][a] + ball["detected"][b] * 0.5)
            e = ev.add(type="pass", label="Passe", t=world.t[a], tEnd=world.t[b], team=hteam[a], player=pa, to=pb,
                       xy=_xy(xa), xyEnd=_xy(xb), kind="estimativa", confidence=conf,
                       length=round(float(np.linalg.norm(xb - xa)), 1) if calibrated else None,
                       method="Mudança de jogador mais próximo da bola dentro da mesma equipa.")
            out["passes"].append(e)
        else:
            if gap > 4.0 or (poss.get("dead") is not None and poss["dead"][a:b].any()):
                continue
            conf = 0.5 if calibrated else 0.3
            danger = None
            if np.all(np.isfinite(xb)) and hteam[a] in TEAMS:
                own_x = 0.0 if world.dir(hteam[a], world.t[b]) == 1 else world.L
                danger = bool(abs(xb[0] - own_x) < 13)
            e = ev.add(type="turnover", dangerZone=danger, label="Perda / recuperação de bola", t=world.t[b], team=hteam[b],
                       player=pb, lostBy=pa, lostTeam=hteam[a], xy=_xy(xb), kind="estimativa", confidence=conf,
                       method="Posse passa de uma equipa para a outra em ≤ 4 s.")
            out["turnovers"].append(e)
    return out


def ball_velocity(world: World, ball: dict) -> np.ndarray:
    F = world.F
    v = np.full((F, 2), np.nan)
    det = np.flatnonzero(ball["detected"] & world.valid)
    for a, b in zip(det[:-1], det[1:]):
        dt = world.t[b] - world.t[a]
        if 0 < dt <= 0.6:
            v[b] = (ball["xy"][b] - ball["xy"][a]) / dt
    return v


def shots(world: World, poss: dict, ball: dict, ev: EventLog) -> list:
    L, W = world.L, world.W
    vel = ball_velocity(world, ball)
    out = []
    last_t = -99
    for f in range(world.F):
        v = vel[f]
        if not np.all(np.isfinite(v)):
            continue
        speed = float(np.linalg.norm(v))
        if speed < 11 or speed > 40:
            continue
        p = ball["xy"][f]
        for gx, sign in ((0.0, -1), (L, 1)):
            if np.sign(v[0]) != sign or abs(p[0] - gx) > 18:
                continue
            tt = (gx - p[0]) / v[0]
            if tt <= 0 or tt > 2.5:
                continue
            yhit = p[1] + v[1] * tt
            if abs(yhit - W / 2) > 3.0:
                continue
            if world.t[f] - last_t < 2.0:
                continue
            # shooter = last holder within 1.5 s, attacking that goal
            shooter, team = None, None
            k = f
            while k >= 0 and world.t[f] - world.t[k] <= 1.5:
                if poss["holder"][k]:
                    shooter, team = poss["holder"][k], poss["team"][k]
                    break
                k -= 1
            if team and world.dir(team, world.t[f]) != sign:
                continue  # moving towards own goal = back-pass/clearance, not a shot
            last_t = world.t[f]
            e = ev.add(type="shot", label="Remate", t=world.t[k] if shooter else world.t[f], team=team,
                       player=shooter, xy=_xy(p), goal="right" if sign > 0 else "left",
                       speedKmh=round(speed * 3.6), onTarget=abs(yhit - W / 2) <= 1.5,
                       kind="estimativa", confidence=0.45 if shooter else 0.3,
                       method="Bola com velocidade > 40 km/h em direção à baliza (trajetória projetada entre os postes ±1.5 m).")
            out.append(e)
    return out


def stoppages(world: World, states: list[FrameState], ball: dict, min_s: float = 2.0) -> list[dict]:
    """Dead-ball windows: players nearly static and (ball static or not visible), or non-tactical shots (replays)."""
    F = world.F
    speed = np.full(F, np.nan)
    prev = {}
    for f in range(F):
        st = states[f]
        if not world.valid[f] or not len(st.pids):
            prev = {}
            continue
        sp = []
        cur = {}
        for pid, xy in zip(st.pids, st.xy):
            cur[pid] = xy
            if pid in prev:
                sp.append(np.linalg.norm(xy - prev[pid]) / world.dt)
        prev = cur
        if len(sp) >= 3:
            speed[f] = float(np.median(sp))
    win = max(1, int(round(0.6 / world.dt)))
    sm = np.array([np.nanmean(speed[max(0, f - win):f + win + 1]) if np.isfinite(speed[max(0, f - win):f + win + 1]).any() else np.nan
                   for f in range(F)])
    bvel = ball_velocity(world, ball)
    bspeed = np.linalg.norm(bvel, axis=1)
    quiet = np.zeros(F, dtype=bool)
    for f in range(F):
        ball_quiet = (not np.isfinite(bspeed[f])) or bspeed[f] < 1.0
        if np.isfinite(sm[f]) and sm[f] < 1.1 and ball_quiet:
            quiet[f] = True
        elif not world.wide[f]:
            quiet[f] = True  # close-up / replay: play is very likely stopped
    out = []
    f = 0
    while f < F:
        if not quiet[f]:
            f += 1
            continue
        g = f
        while g + 1 < F and quiet[g + 1]:
            g += 1
        if world.t[g] - world.t[f] >= min_s:
            out.append({"start": f, "end": g, "t0": float(world.t[f]), "t1": float(world.t[g]),
                        "replay": float(np.mean(~world.wide[f:g + 1]))})
        f = g + 1
    return out


def classify_restarts(world: World, states, ball, poss, stops, ev: EventLog) -> list:
    L, W = world.L, world.W
    out = []
    first_kickoff_half = {}
    for s in stops:
        # restart = first frame after stoppage that is wide & valid
        f = s["end"] + 1
        while f < world.F and not (world.valid[f] and world.wide[f]) and world.t[f] - s["t1"] < 3:
            f += 1
        if f >= world.F or not world.valid[f]:
            continue
        t0 = float(world.t[f])
        # ball location: last ball seen at the end of the stoppage or first after restart
        bxy = None
        for k in list(range(f, min(world.F, f + int(2 / world.dt)))) + list(range(s["end"], max(-1, s["end"] - int(2 / world.dt)), -1)):
            if ball["detected"][k] and np.all(np.isfinite(ball["xy"][k])):
                bxy = ball["xy"][k]
                break
        # executing team: first holder within 3 s
        team, kicker = None, None
        for k in range(f, min(world.F, f + int(3 / world.dt))):
            if poss["holder"][k]:
                team, kicker = poss["team"][k], poss["holder"][k]
                break
        if bxy is not None and not (-0.3 <= bxy[0] <= L + 0.3 and -0.3 <= bxy[1] <= W + 0.3):
            continue  # ball still out of play (e.g. inside the goal after a goal)
        st = states[f]
        tm = np.array(st.teams)
        # kickoff formation: each team entirely in its own half
        kickoff_like = False
        if (tm == "A").sum() >= 3 and (tm == "B").sum() >= 3:
            ok = True
            for team_ in TEAMS:
                d = world.dir(team_, t0)
                xs = st.xy[tm == team_, 0]
                own = (xs < L / 2 + 0.5) if d == 1 else (xs > L / 2 - 0.5)
                if own.mean() < 0.9:
                    ok = False
            kickoff_like = ok
        rtype, label, conf, details = None, None, 0.0, {}
        if kickoff_like and (bxy is None or np.linalg.norm(bxy - [L / 2, W / 2]) < 3):
            rtype, label, conf = "kickoff", "Pontapé de saída", 0.75 if bxy is not None else 0.55
        elif bxy is not None:
            corners = [(0, 0), (0, W), (L, 0), (L, W)]
            dc = min(np.linalg.norm(bxy - np.array(c)) for c in corners)
            in_area_l = bxy[0] < 6.5 and abs(bxy[1] - W / 2) < 9
            in_area_r = bxy[0] > L - 6.5 and abs(bxy[1] - W / 2) < 9
            pen = min(np.linalg.norm(bxy - np.array(p)) for p in [(6, W / 2), (L - 6, W / 2), (10, W / 2), (L - 10, W / 2)])
            if dc < 2.5:
                rtype, label, conf = "corner", "Canto", 0.7
            elif bxy[1] < 1.5 or bxy[1] > W - 1.5:
                rtype, label, conf = "kick_in", "Reposição lateral", 0.65
            elif (in_area_l or in_area_r) and pen > 1.0:
                rtype, label, conf = "goal_clearance", "Reposição de fundo (GR)", 0.55
            elif pen <= 1.0:
                rtype, label, conf = "penalty", "Penálti / livre de 10 m", 0.45
            else:
                # free kick: look for a wall (>=2 opponents 3.5-6.5 m from ball, between ball and goal)
                wall = 0
                if team in TEAMS:
                    d = world.dir(team, t0)
                    gx = L if d == 1 else 0
                    opp = "B" if team == "A" else "A"
                    for xy in st.xy[tm == opp]:
                        dist = np.linalg.norm(xy - bxy)
                        if 3.5 <= dist <= 6.5 and abs(xy[0] - gx) < abs(bxy[0] - gx):
                            wall += 1
                rtype, label = "free_kick", "Livre (direto/indireto não distinguível automaticamente)"
                conf = 0.6 if wall >= 2 else 0.35
                details["wallPlayers"] = wall
        else:
            rtype, label, conf = "restart_unknown", "Reinício de jogo (tipo não determinado — bola não detetada)", 0.25
        if rtype is None:
            continue
        if rtype == "kickoff":
            h = world.half_of(t0)
            if h not in first_kickoff_half:
                first_kickoff_half[h] = t0
        e = ev.add(type=rtype, label=label, t=t0, stopT0=s["t0"], team=team, player=kicker, xy=_xy(bxy),
                   kind="deteção" if rtype in ("corner", "kick_in", "kickoff") else "estimativa",
                   confidence=conf, replayShare=round(s["replay"], 2), setPiece=rtype not in ("kickoff", "restart_unknown"),
                   method="Paragem detetada (jogadores e bola parados ou plano fechado/repetição) e classificação pela posição da bola no reinício.",
                   **details)
        out.append(e)
    return out, first_kickoff_half


def goal_candidates(world: World, restarts, first_kickoff_half, shot_events, audio, ev: EventLog) -> list:
    out = []
    for r in restarts:
        if r["type"] != "kickoff":
            continue
        h = world.half_of(r["t"])
        half_start = world.half_time if (h == 2 and world.half_time is not None) else float(world.t[0])
        if first_kickoff_half.get(h) == r["t"] and r["t"] - half_start < 300:
            continue  # start of the half
        kick_team = r.get("team")
        scorer_team = ("B" if kick_team == "A" else "A") if kick_team in TEAMS else None
        # estimated goal moment: last shot before the stoppage, else stoppage start
        prev_shots = [s for s in shot_events if s["t"] <= r["stopT0"] + 1 and s["t"] >= r["stopT0"] - 30]
        if scorer_team:
            prev_shots = [s for s in prev_shots if s.get("team") in (None, scorer_team)] or prev_shots
        tg = prev_shots[-1]["t"] if prev_shots else r["stopT0"]
        conf = 0.5 + (0.15 if prev_shots else 0) + (0.1 if scorer_team else 0)
        loud = None
        if audio:
            step = audio["step"]
            db = np.array(audio["db"])
            a, b = int(max(0, (tg - 5) / step)), int(min(len(db), (tg + 15) / step))
            base = np.median(db) if len(db) else 0
            if b > a:
                peak = float(db[a:b].max() - base)
                loud = round(peak, 1)
                if peak > 8:
                    conf += 0.1
        e = ev.add(type="goal", label="Golo provável (candidato)", t=max(0, tg), tEnd=r["t"], team=scorer_team,
                   player=prev_shots[-1].get("player") if prev_shots else None, kind="interpretação",
                   confidence=min(0.85, conf), audioPeakDb=loud, restartId=r["id"],
                   method="Pontapé de saída a meio do jogo (equipas cada uma no seu meio-campo após paragem). "
                          "A equipa que não repôs a bola é a provável marcadora. Requer confirmação manual.")
        out.append(e)
    return out


def audio_peaks(audio: dict | None, ev: EventLog, min_s: float = 1.5, thr_db: float = 9.0) -> list:
    if not audio or not audio.get("db"):
        return []
    db = np.array(audio["db"], dtype=float)
    step = audio["step"]
    n = len(db)
    win = int(60 / step)
    base = np.array([np.median(db[max(0, i - win):i + win]) for i in range(0, n, 10)])
    base = np.repeat(base, 10)[:n]
    loud = db - base > thr_db
    out = []
    i = 0
    while i < n:
        if not loud[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and loud[j + 1]:
            j += 1
        if (j - i + 1) * step >= min_s:
            out.append(ev.add(type="audio_peak", label="Pico de intensidade sonora (público/ambiente)",
                              t=i * step, tEnd=(j + 1) * step, kind="deteção",
                              confidence=min(0.9, 0.4 + float((db[i:j + 1] - base[i:j + 1]).max()) / 40),
                              peakDb=round(float((db[i:j + 1] - base[i:j + 1]).max()), 1),
                              method="Energia de áudio > 9 dB acima da mediana local durante ≥ 1.5 s."))
        i = j + 1
    return out


def dead_mask(world: World, stops: list[dict]) -> np.ndarray:
    m = np.zeros(world.F, dtype=bool)
    for s in stops:
        m[s["start"]:s["end"] + 1] = True
    return m
