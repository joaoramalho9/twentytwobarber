"""Builds the analysable 'world' from stage-1 data: court projection, teams, identities."""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

import cv2
import numpy as np

from ..court import to_court

TEAMS = ("A", "B")


@dataclass
class Tracklet:
    tid: int
    rows: list[int] = field(default_factory=list)   # indices into detection table
    team: str = "other"
    lab: np.ndarray | None = None


@dataclass
class Player:
    pid: str
    tids: list[int]
    team: str
    role: str = "field"           # field | gk | other
    name: str = ""
    auto_name: str = ""
    hidden: bool = False
    role_source: str = "auto"


@dataclass
class World:
    L: float
    W: float
    img_w: int
    img_h: int
    dt: float
    t: np.ndarray
    seg: np.ndarray
    calibrated: np.ndarray
    valid: np.ndarray
    wide: np.ndarray
    # detection table
    d_f: np.ndarray
    d_tid: np.ndarray
    d_conf: np.ndarray
    d_box: np.ndarray
    d_lab: np.ndarray
    d_xy: np.ndarray
    d_inside: np.ndarray
    # ball candidates
    b_f: np.ndarray
    b_conf: np.ndarray
    b_box: np.ndarray
    b_xy: np.ndarray
    H: list
    warnings: list[str] = field(default_factory=list)
    tracklets: dict[int, Tracklet] = field(default_factory=dict)
    players: dict[str, Player] = field(default_factory=dict)
    tid2pid: dict[int, str] = field(default_factory=dict)
    team_colors: dict[str, str] = field(default_factory=dict)
    team_color_source: str = "auto"
    d_pid: np.ndarray | None = None
    d_team: np.ndarray | None = None
    direction: dict = field(default_factory=dict)   # team -> {half: +1/-1}
    half_time: float | None = None

    @property
    def F(self) -> int:
        return len(self.t)

    def half_of(self, t: float) -> int:
        return 2 if (self.half_time is not None and t >= self.half_time) else 1

    def dir(self, team: str, t: float) -> int:
        """+1 if `team` attacks towards x=L at time t, -1 towards x=0."""
        return self.direction.get(team, {}).get(self.half_of(t), 1)


def _hex_to_lab(hexcol: str) -> np.ndarray:
    hexcol = hexcol.lstrip("#")
    r, g, b = (int(hexcol[i:i + 2], 16) for i in (0, 2, 4))
    px = np.uint8([[[b, g, r]]])
    return cv2.cvtColor(px, cv2.COLOR_BGR2LAB)[0, 0].astype(float)


def _lab_to_hex(lab) -> str:
    px = np.uint8([[np.clip(lab, 0, 255)]])
    b, g, r = cv2.cvtColor(px, cv2.COLOR_LAB2BGR)[0, 0]
    return f"#{r:02x}{g:02x}{b:02x}"


def frame_homographies(frames: list[dict], calibrations: list[dict], camera_mode: str) -> list:
    """Image->court homography for each frame, or None when not calibratable."""
    F = len(frames)
    out: list = [None] * F
    if not calibrations:
        return out
    times = np.array([fr["t"] for fr in frames])
    cals = []
    for c in calibrations:
        Hc = np.array(c["H"], dtype=np.float64)
        if camera_mode == "static":
            cals.append((c["t"], 0, Hc))
            continue
        k = int(np.argmin(np.abs(times - c["t"]))) if F else -1
        if k < 0 or frames[k].get("g") is None or abs(times[k] - c["t"]) > 1.0:
            continue
        Gc = np.array(frames[k]["g"]).reshape(3, 3)
        cals.append((c["t"], frames[k]["s"], Hc @ np.linalg.inv(Gc)))
    for i, fr in enumerate(frames):
        if camera_mode == "static":
            best = min(cals, key=lambda c: abs(c[0] - fr["t"]))
            out[i] = best[2]
            continue
        if fr.get("g") is None or fr.get("s", -1) < 0:
            continue
        same = [c for c in cals if c[1] == fr["s"]]
        if not same:
            continue
        best = min(same, key=lambda c: abs(c[0] - fr["t"]))
        out[i] = best[2] @ np.array(fr["g"]).reshape(3, 3)
    return out


def build_world(frames: list[dict], project: dict, params: dict) -> World:
    court = project.get("court") or {"length": 40.0, "width": 20.0}
    L, W = float(court["length"]), float(court["width"])
    info = project["video"]["info"]
    img_w, img_h = info["width"], info["height"]
    F = len(frames)
    t = np.array([fr["t"] for fr in frames], dtype=np.float64)
    seg = np.array([fr.get("s", 0) for fr in frames])
    dt = float(np.median(np.diff(t))) if F > 1 else 0.2
    Hs = frame_homographies(frames, project.get("calibrations") or [], params.get("camera_mode", "moving"))

    d_f, d_tid, d_conf, d_box, d_lab = [], [], [], [], []
    b_f, b_conf, b_box = [], [], []
    for i, fr in enumerate(frames):
        for p in fr["p"]:
            d_f.append(i); d_tid.append(p[0]); d_conf.append(p[1]); d_box.append(p[2:6]); d_lab.append(p[6:9])
        for b in fr["b"]:
            b_f.append(i); b_conf.append(b[0]); b_box.append(b[1:5])
    d_f = np.array(d_f, dtype=int); d_tid = np.array(d_tid, dtype=int)
    d_conf = np.array(d_conf, dtype=float); d_box = np.array(d_box, dtype=float).reshape(-1, 4)
    d_lab = np.array(d_lab, dtype=float).reshape(-1, 3)
    b_f = np.array(b_f, dtype=int); b_conf = np.array(b_conf, dtype=float)
    b_box = np.array(b_box, dtype=float).reshape(-1, 4)

    d_xy = np.full((len(d_f), 2), np.nan)
    b_xy = np.full((len(b_f), 2), np.nan)
    calibrated = np.array([h is not None for h in Hs], dtype=bool)
    valid = np.zeros(F, dtype=bool)
    d_inside = np.zeros(len(d_f), dtype=bool)
    feet = np.c_[(d_box[:, 0] + d_box[:, 2]) / 2, d_box[:, 3]] if len(d_box) else np.zeros((0, 2))
    bfoot = np.c_[(b_box[:, 0] + b_box[:, 2]) / 2, b_box[:, 3]] if len(b_box) else np.zeros((0, 2))
    d_by_f = defaultdict(list)
    for r, f in enumerate(d_f):
        d_by_f[f].append(r)
    b_by_f = defaultdict(list)
    for r, f in enumerate(b_f):
        b_by_f[f].append(r)
    margin = 1.0
    for i in range(F):
        H = Hs[i]
        if H is None:
            continue
        rows = d_by_f.get(i, [])
        if rows:
            xy = to_court(H, feet[rows])
            d_xy[rows] = xy
            ins = (xy[:, 0] > -margin) & (xy[:, 0] < L + margin) & (xy[:, 1] > -margin) & (xy[:, 1] < W + margin)
            d_inside[rows] = ins
            valid[i] = ins.sum() >= 3 and ins.mean() >= 0.5 and np.all(np.isfinite(xy))
        brows = b_by_f.get(i, [])
        if brows:
            b_xy[brows] = to_court(H, bfoot[brows])
        if not valid[i]:
            d_inside[rows] = False

    # Wide (tactical) shot detection: enough people, people small in frame.
    wide = np.zeros(F, dtype=bool)
    heights = d_box[:, 3] - d_box[:, 1] if len(d_box) else np.zeros(0)
    for i in range(F):
        rows = d_by_f.get(i, [])
        if len(rows) >= 4 and np.median(heights[rows]) < 0.28 * img_h:
            wide[i] = True

    world = World(L, W, img_w, img_h, dt, t, seg, calibrated, valid, wide, d_f, d_tid, d_conf, d_box, d_lab,
                  d_xy, d_inside, b_f, b_conf, b_box, b_xy, Hs)
    world.half_time = project.get("halfTimeS")
    for r, tid in enumerate(d_tid):
        world.tracklets.setdefault(int(tid), Tracklet(int(tid))).rows.append(r)
    if F and not calibrated.any():
        world.warnings.append("Sem calibração do campo: métricas físicas (metros, velocidades), sistemas táticos e "
                              "classificação de bolas paradas por zona não são calculadas.")
    elif F and valid.mean() < 0.4:
        world.warnings.append(f"Apenas {valid.mean():.0%} dos frames têm calibração válida. Adicione calibrações "
                              "noutros momentos do vídeo (câmara em movimento / mudanças de plano).")
    return world


# ---------------------------------------------------------------------------
# Team assignment from jersey colour
# ---------------------------------------------------------------------------

def assign_teams(world: World, project: dict) -> None:
    has_cal = world.valid.any()
    usable = []
    for tr in world.tracklets.values():
        rows = np.array(tr.rows)
        if has_cal:
            rows = rows[world.d_inside[rows]]
        rows = rows[np.all(np.isfinite(world.d_lab[rows]), axis=1)] if len(rows) else rows
        if len(rows) < 3:
            tr.team = "noise"
            continue
        tr.lab = np.median(world.d_lab[rows], axis=0)
        usable.append((tr, rows))
    if not usable:
        return

    ca = (project.get("teamA") or {}).get("color")
    cb = (project.get("teamB") or {}).get("color")
    if ca and cb:
        la, lb = _hex_to_lab(ca), _hex_to_lab(cb)
        w = np.array([0.5, 1.0, 1.0])
        for tr, rows in usable:
            da = np.linalg.norm((world.d_lab[rows] - la) * w, axis=1)
            db = np.linalg.norm((world.d_lab[rows] - lb) * w, axis=1)
            va = np.mean(da < db)
            md = np.median(np.minimum(da, db))
            tr.team = ("A" if va >= 0.5 else "B") if md < 45 else "other"
        world.team_colors = {"A": ca, "B": cb}
        world.team_color_source = "utilizador"
        return

    # unsupervised: k-means on detection-level colours (naturally weighted by visibility)
    allrows = np.concatenate([r for _, r in usable])
    feats = world.d_lab[allrows] * np.array([0.5, 1.0, 1.0])
    rng = np.random.default_rng(0)
    if len(feats) > 30000:
        feats = feats[rng.choice(len(feats), 30000, replace=False)]
    k = int(min(4, max(2, len(feats) // 20)))
    if len(feats) < 6:
        return
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.2)
    cv2.setRNGSeed(0)
    _, labels, centers = cv2.kmeans(feats.astype(np.float32), k, None, crit, 5, cv2.KMEANS_PP_CENTERS)
    labels = labels.ravel()
    centers = centers.astype(float)
    # merge near-identical clusters (lit/shadowed versions of the same kit)
    groups = list(range(k))
    for i in range(k):
        for j in range(i + 1, k):
            if np.linalg.norm(centers[i] - centers[j]) < 16:
                gi, gj = groups[i], groups[j]
                groups = [gi if g == gj else g for g in groups]
    glabels = np.array([groups[l] for l in labels])
    sizes = Counter(glabels.tolist())
    order = [g for g, _ in sizes.most_common()]
    if len(order) < 2:
        world.warnings.append("Não foi possível separar duas equipas pelas cores dos equipamentos. "
                              "Indique as cores das equipas no projeto.")
        for tr, _ in usable:
            tr.team = "A"
        return
    gA, gB = order[0], order[1]
    total = sum(sizes.values())
    if sizes[gB] / total < 0.15:
        world.warnings.append("Separação de equipas por cor pouco fiável (uma das equipas tem poucas deteções). "
                              "Recomenda-se indicar as cores das equipas.")
    gcent = {g: np.mean([centers[i] for i in range(k) if groups[i] == g], axis=0) for g in set(groups)}

    def nearest_group(x):
        return min(gcent, key=lambda g: np.linalg.norm(x - gcent[g]))

    for tr, rows in usable:
        f = world.d_lab[rows] * np.array([0.5, 1.0, 1.0])
        votes = Counter(nearest_group(x) for x in f[:: max(1, len(f) // 40)])
        g = votes.most_common(1)[0][0]
        tr.team = "A" if g == gA else "B" if g == gB else "other"
    world.team_colors = {"A": _lab_to_hex(gcent[gA] / np.array([0.5, 1, 1])),
                         "B": _lab_to_hex(gcent[gB] / np.array([0.5, 1, 1]))}
    world.team_color_source = "auto (k-means)"


# ---------------------------------------------------------------------------
# Identity: stitch fragmented tracklets into provisional players
# ---------------------------------------------------------------------------

def _endpoint(world: World, rows: list[int], first: bool):
    r = rows[0] if first else rows[-1]
    return world.t[world.d_f[r]], world.d_xy[r], world.d_box[r]


def stitch(world: World, max_gap: float = 3.0) -> None:
    by_team = defaultdict(list)
    for tr in world.tracklets.values():
        if tr.team == "noise":
            continue
        tr.rows.sort(key=lambda r: world.d_f[r])
        by_team[tr.team].append(tr)
    nxt, prv = {}, {}
    for team, trs in by_team.items():
        cands = []
        for a in trs:
            ta, xa, ba = _endpoint(world, a.rows, False)
            for b in trs:
                if a is b:
                    continue
                tb, xb, bb = _endpoint(world, b.rows, True)
                gap = tb - ta
                if not (0 < gap <= max_gap):
                    continue
                if np.all(np.isfinite(xa)) and np.all(np.isfinite(xb)):
                    d = float(np.linalg.norm(xa - xb))
                    lim = 1.5 + 6.0 * gap
                    norm = d / lim
                else:
                    ha = max(10.0, ba[3] - ba[1])
                    ca = np.array([(ba[0] + ba[2]) / 2, ba[3]]); cb = np.array([(bb[0] + bb[2]) / 2, bb[3]])
                    d = float(np.linalg.norm(ca - cb)) / ha
                    lim = 0.6 + 1.5 * gap
                    norm = d / lim
                if norm > 1.0:
                    continue
                cdist = float(np.linalg.norm((a.lab - b.lab) * np.array([0.5, 1, 1]))) if a.lab is not None and b.lab is not None else 0
                if cdist > 22:
                    continue
                cands.append((norm + gap / max_gap * 0.5 + cdist / 44, a.tid, b.tid))
        cands.sort()
        for _, a, b in cands:
            if a in nxt or b in prv:
                continue
            nxt[a] = b
            prv[b] = a
    world.players = {}
    for tr in world.tracklets.values():
        if tr.team == "noise" or tr.tid in prv:
            continue
        chain = [tr.tid]
        while chain[-1] in nxt:
            chain.append(nxt[chain[-1]])
        pid = f"p{tr.tid}"
        world.players[pid] = Player(pid, chain, tr.team)


def apply_corrections(world: World, corr: dict) -> None:
    corr = corr or {}
    # merges (union-find on pids)
    parent = {p: p for p in world.players}

    def find(x):
        while parent.get(x, x) != x:
            x = parent[x]
        return x

    for a, b in corr.get("merge", []):
        if a in parent and b in parent:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[rb] = ra
    merged: dict[str, Player] = {}
    for pid, pl in world.players.items():
        root = find(pid)
        if root not in merged:
            base = world.players[root]
            merged[root] = Player(root, [], base.team)
        merged[root].tids.extend(pl.tids)
    world.players = merged
    for pid, team in (corr.get("team") or {}).items():
        if pid in world.players and team in ("A", "B", "other"):
            world.players[pid].team = team
            world.players[pid].role_source = "manual"
    for pid, role in (corr.get("role") or {}).items():
        if pid in world.players and role in ("field", "gk", "other"):
            world.players[pid].role = role
            world.players[pid].role_source = "manual"
    for pid in corr.get("hidden", []):
        if pid in world.players:
            world.players[pid].hidden = True
    for pid, name in (corr.get("names") or {}).items():
        if pid in world.players and name:
            world.players[pid].name = str(name)[:60]
    if corr.get("swapTeams"):
        for pl in world.players.values():
            if pl.team in TEAMS and pl.role_source != "manual":
                pl.team = "B" if pl.team == "A" else "A"
        world.team_colors = {"A": world.team_colors.get("B"), "B": world.team_colors.get("A")}


def finalize_ids(world: World, corr: dict, min_visible_s: float = 4.0) -> None:
    world.tid2pid = {}
    for pid, pl in world.players.items():
        for tid in pl.tids:
            world.tid2pid[tid] = pid
    world.d_pid = np.array([world.tid2pid.get(int(t), "") for t in world.d_tid], dtype=object)
    team_of = {pid: pl.team for pid, pl in world.players.items()}
    world.d_team = np.array([team_of.get(p, "noise") for p in world.d_pid], dtype=object)
    # visibility
    vis = Counter(world.d_pid.tolist())
    for pid, pl in world.players.items():
        if vis.get(pid, 0) * world.dt < min_visible_s and pid not in (corr or {}).get("names", {}):
            pl.hidden = True


def letter_name(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def detect_roles_and_direction(world: World) -> None:
    """Goalkeepers (by location near a goal) and attack direction per team per half."""
    L, W = world.L, world.W
    vis_rows = defaultdict(list)
    for r, pid in enumerate(world.d_pid):
        if pid and world.d_inside[r]:
            vis_rows[pid].append(r)
    gk_side = {}
    for pid, pl in world.players.items():
        if pl.hidden or pl.role_source == "manual":
            continue
        rows = vis_rows.get(pid, [])
        if len(rows) * world.dt < 20:
            continue
        xy = world.d_xy[rows]
        near_l = (xy[:, 0] < 7) & (np.abs(xy[:, 1] - W / 2) < 8)
        near_r = (xy[:, 0] > L - 7) & (np.abs(xy[:, 1] - W / 2) < 8)
        if near_l.mean() >= 0.6 or near_r.mean() >= 0.6:
            pl.role = "gk"
            gk_side[pid] = ("L" if near_l.mean() > near_r.mean() else "R", world.t[world.d_f[rows]].mean())
        elif pl.team == "other":
            pl.role = "other"
    # Direction: team whose outfield players sit closer to x=0 on average defends the left goal.
    halves = [1, 2] if world.half_time is not None else [1]
    world.direction = {"A": {}, "B": {}}
    world.direction_source = {}
    for h in halves:
        sel = world.d_inside.copy()
        tt = world.t[world.d_f]
        if world.half_time is not None:
            sel &= (tt >= world.half_time) if h == 2 else (tt < world.half_time)
        meanx = {}
        for team in TEAMS:
            m = sel & (world.d_team == team)
            meanx[team] = float(np.nanmean(world.d_xy[m, 0])) if m.any() else np.nan
        # GK evidence first
        gk_vote = {}
        for pid, (side, tm) in gk_side.items():
            team = world.players[pid].team
            if world.half_time is not None and ((tm >= world.half_time) != (h == 2)):
                continue
            if team in TEAMS:
                gk_vote[team] = side
        if gk_vote:
            team, side = next(iter(gk_vote.items()))
            d = 1 if side == "L" else -1
            other = "B" if team == "A" else "A"
            world.direction["A" if team == "A" else "B"][h] = d
            world.direction[other][h] = -d
            world.direction_source[h] = "guarda-redes"
            # assign GK in 'other' cluster to the team defending that side
        elif np.isfinite(meanx["A"]) and np.isfinite(meanx["B"]):
            dA = 1 if meanx["A"] < meanx["B"] else -1
            world.direction["A"][h] = dA
            world.direction["B"][h] = -dA
            world.direction_source[h] = "posição média das equipas"
        else:
            world.direction["A"][h] = 1
            world.direction["B"][h] = -1
            world.direction_source[h] = "indeterminado"
    # goalkeepers wearing a different colour ('other' cluster) join the team defending that goal
    for pid, (side, tm) in gk_side.items():
        pl = world.players[pid]
        if pl.team == "other" and pl.role_source != "manual":
            h = world.half_of(tm)
            for team in TEAMS:
                own_left = world.direction[team].get(h, 1) == 1
                if (side == "L") == own_left:
                    pl.team = team
    team_of = {pid: pl.team for pid, pl in world.players.items()}
    world.d_team = np.array([team_of.get(p, "noise") for p in world.d_pid], dtype=object)


def name_players(world: World) -> None:
    vis = Counter(world.d_pid.tolist())
    ordered = sorted([p for p in world.players.values() if not p.hidden and p.team in TEAMS],
                     key=lambda p: -vis.get(p.pid, 0))
    for i, pl in enumerate(ordered):
        pl.auto_name = f"Jogador {letter_name(i)}"
    others = sorted([p for p in world.players.values() if not p.hidden and p.team not in TEAMS],
                    key=lambda p: -vis.get(p.pid, 0))
    for i, pl in enumerate(others):
        pl.auto_name = f"Outro {i + 1} (árbitro/não atribuído)"
