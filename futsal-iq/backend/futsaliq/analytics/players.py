"""Individual scouting built only on measured evidence (with sample sizes)."""
from __future__ import annotations

from collections import Counter, defaultdict

import numpy as np

from .world import TEAMS, World

SPRINT_MS = 5.0         # 18 km/h
HIGH_INT_MS = 4.0       # 14.4 km/h
GRID = (20, 10)

# metric -> (label, category, higher_is_better, min_sample_key, min_sample)
METRICS = {
    "passAccuracy": ("Eficácia de passe (certos / certos + perdas)", "técnica", True, "passesAttempted", 8),
    "passesPerMin": ("Passes por minuto em campo", "técnica", True, "minutesVisible", 5),
    "touchesPerMin": ("Participação com bola (toques/min)", "técnica", True, "minutesVisible", 5),
    "lossesPerTouch": ("Perdas de bola por toque", "técnica", False, "touches", 10),
    "shots": ("Remates", "técnica", True, "minutesVisible", 5),
    "recoveriesPerMin": ("Recuperações por minuto", "defesa", True, "minutesVisible", 5),
    "pressuresPerMin": ("Pressões sobre o portador/min", "defesa", True, "minutesCalibrated", 5),
    "coversPerMin": ("Coberturas ao colega que pressiona/min", "defesa", True, "minutesCalibrated", 5),
    "distancePerMin": ("Distância por minuto (m)", "física", True, "minutesCalibrated", 5),
    "topSpeedKmh": ("Velocidade máxima (km/h)", "física", True, "minutesCalibrated", 5),
    "sprintsPerMin": ("Sprints por minuto", "física", True, "minutesCalibrated", 5),
    "highIntensityPct": ("% tempo em alta intensidade", "física", True, "minutesCalibrated", 5),
    "rupturesPerMin": ("Movimentos de rutura/min", "tática", True, "minutesCalibrated", 5),
    "attackingHalfPct": ("% tempo no meio-campo ofensivo", "tática", None, "minutesCalibrated", 5),
}

RECOMMENDATIONS = {
    "passAccuracy": "Trabalhar passe sob pressão (rondos 3x1/4x2 em espaço reduzido) e orientação corporal antes da receção.",
    "lossesPerTouch": "Reduzir perdas: exercícios de proteção de bola e de decisão rápida (2 toques) com pressão imediata.",
    "touchesPerMin": "Aumentar a participação com bola: oferecer linhas de passe com desmarcações de apoio e de rutura.",
    "recoveriesPerMin": "Melhorar a agressividade na recuperação: tarefas de pressão pós-perda (regra dos 5 s).",
    "pressuresPerMin": "Aumentar as ações de pressão: jogos condicionados com pontuação por recuperação em zona alta.",
    "coversPerMin": "Trabalhar coberturas defensivas: situações 2x2/3x3 com foco na distância e ângulo ao colega que pressiona.",
    "distancePerMin": "Volume de deslocamento abaixo dos colegas: avaliar condição física e envolvimento sem bola.",
    "sprintsPerMin": "Poucas ações de alta velocidade: incluir trabalho de aceleração e reação em transição.",
    "topSpeedKmh": "Velocidade máxima reduzida face aos colegas: trabalho de velocidade máxima e técnica de corrida.",
    "highIntensityPct": "Baixa intensidade de movimentação: rever exigências do posto e capacidade de repetição de esforços.",
    "rupturesPerMin": "Poucos ataques ao espaço: treinar movimentos de rutura nas costas da defesa e timing de desmarcação.",
}

NOT_MEASURABLE = {
    "técnica": ["Receção", "Condução", "Drible"],
    "tática": ["Leitura de jogo", "Decisão"],
    "defesa": ["Marcação (qualidade)", "Antecipação"],
}


def build_players(world: World, states, poss, ball, events: dict, speeds: dict) -> list[dict]:
    L, W = world.L, world.W
    vis = Counter(world.d_pid.tolist())
    passes = events["passes"]
    turnovers = events["turnovers"]
    shots = events["shots"]
    ruptures = events["ruptures"]
    # pressures and covers from frame states
    pressures = defaultdict(int)
    covers = defaultdict(int)
    press_state = {}
    for f in range(world.F):
        if not world.valid[f]:
            continue
        h, ht = poss["holder"][f], poss["team"][f]
        if not h or ht not in TEAMS:
            continue
        st = states[f]
        try:
            hk = st.pids.index(h)
        except ValueError:
            continue
        opp = "B" if ht == "A" else "A"
        dk = [k for k, tm in enumerate(st.teams) if tm == opp]
        if not dk:
            continue
        dd = np.linalg.norm(st.xy[dk] - st.xy[hk], axis=1)
        j = int(np.argmin(dd))
        presser = st.pids[dk[j]]
        if dd[j] < 2.5:
            if press_state.get(presser) != f - 1:
                pressures[presser] += 1
            press_state[presser] = f
            own_x = 0.0 if world.dir(opp, world.t[f]) == 1 else L
            pg = abs(st.xy[dk[j], 0] - own_x)
            for k in dk:
                if k == dk[j]:
                    continue
                dp = np.linalg.norm(st.xy[k] - st.xy[dk[j]])
                if 2.5 <= dp <= 7.5 and abs(st.xy[k, 0] - own_x) < pg:
                    covers[st.pids[k]] += 1
                    break
    # touches = possession episodes
    touches = Counter()
    prev = ""
    for f in range(world.F):
        h = poss["holder"][f]
        if h and h != prev:
            touches[h] += 1
        if h:
            prev = h
    pa, pc = Counter(), Counter()
    for p in passes:
        pa[p["player"]] += 1
        pc[p["player"]] += 1
    lost = Counter(t["lostBy"] for t in turnovers)
    rec = Counter(t["player"] for t in turnovers)
    for t in turnovers:
        pa[t["lostBy"]] += 1  # a lost ball counts as an attempted (failed) action
    sh = Counter(s["player"] for s in shots if s.get("player"))
    rup = Counter(r["player"] for r in ruptures)

    out = []
    for pid, pl in world.players.items():
        if pl.hidden:
            continue
        mins_vis = vis.get(pid, 0) * world.dt / 60
        s = speeds.get(pid)
        mins_cal = (len(s["t"]) * world.dt / 60) if s else 0
        stats = {
            "minutesVisible": round(mins_vis, 2),
            "minutesCalibrated": round(mins_cal, 2),
            "touches": touches.get(pid, 0),
            "passesCompleted": pc.get(pid, 0),
            "passesAttempted": pa.get(pid, 0),
            "losses": lost.get(pid, 0),
            "recoveries": rec.get(pid, 0),
            "shots": sh.get(pid, 0),
            "pressures": pressures.get(pid, 0),
            "covers": covers.get(pid, 0),
            "ruptures": rup.get(pid, 0),
        }
        heat = None
        path = []
        mean_pos = None
        if s and len(s["t"]) >= 5:
            sp = s["speed"]
            fin = np.isfinite(sp)
            dist = float(s["dist"].sum())
            # top speed: 95th percentile of 1-s rolling mean, to suppress single-frame noise
            win = max(1, int(round(1 / world.dt)))
            roll = np.convolve(np.nan_to_num(sp), np.ones(win) / win, mode="same") if len(sp) >= win else np.nan_to_num(sp)
            top = float(np.percentile(roll[fin], 95)) if fin.sum() >= 5 else None
            sprints, run = 0, 0
            for v in sp:
                if np.isfinite(v) and v >= SPRINT_MS:
                    run += 1
                    if run == win:
                        sprints += 1
                else:
                    run = 0
            hi = float((sp[fin] >= HIGH_INT_MS).mean()) if fin.any() else None
            # normalise: attack towards +x for heatmap/path comparability across halves
            nxy = s["xy"].copy()
            for k in range(len(nxy)):
                if pl.team in TEAMS and world.dir(pl.team, s["t"][k]) == -1:
                    nxy[k] = [L - nxy[k, 0], W - nxy[k, 1]]
            nxy[:, 0] = np.clip(nxy[:, 0], 0, L)
            nxy[:, 1] = np.clip(nxy[:, 1], 0, W)
            H, _, _ = np.histogram2d(nxy[:, 0], nxy[:, 1], bins=GRID, range=[[0, L], [0, W]])
            heat = (H / H.max()).round(3).T.tolist() if H.max() > 0 else None
            step = max(1, int(round(1 / world.dt)))
            path = [[round(float(s["t"][k]), 1), round(float(nxy[k, 0]), 1), round(float(nxy[k, 1]), 1)]
                    for k in range(0, len(nxy), step)]
            mean_pos = [round(float(nxy[:, 0].mean()), 1), round(float(nxy[:, 1].mean()), 1)]
            stats.update({
                "distanceM": round(dist),
                "distancePerMin": round(dist / max(mins_cal, 1e-6), 1) if mins_cal > 0 else None,
                "topSpeedKmh": round(top * 3.6, 1) if top else None,
                "sprints": sprints,
                "sprintsPerMin": round(sprints / mins_cal, 2) if mins_cal > 0 else None,
                "highIntensityPct": round(hi, 3) if hi is not None else None,
                "attackingHalfPct": round(float((nxy[:, 0] > L / 2).mean()), 3),
                "rupturesPerMin": round(stats["ruptures"] / mins_cal, 2) if mins_cal > 0 else None,
                "pressuresPerMin": round(stats["pressures"] / mins_cal, 2) if mins_cal > 0 else None,
                "coversPerMin": round(stats["covers"] * world.dt / mins_cal, 3) if mins_cal > 0 else None,
            })
        if mins_vis > 0:
            stats["touchesPerMin"] = round(stats["touches"] / mins_vis, 2)
            stats["passesPerMin"] = round(stats["passesCompleted"] / mins_vis, 2)
            stats["recoveriesPerMin"] = round(stats["recoveries"] / mins_vis, 2)
        if stats["passesAttempted"]:
            stats["passAccuracy"] = round(stats["passesCompleted"] / stats["passesAttempted"], 3)
        if stats["touches"]:
            stats["lossesPerTouch"] = round(stats["losses"] / stats["touches"], 3)
        out.append({
            "id": pid, "name": pl.name or pl.auto_name, "autoName": pl.auto_name, "customName": pl.name or None,
            "team": pl.team, "role": pl.role, "roleSource": pl.role_source, "tracklets": len(pl.tids),
            "trackIds": pl.tids[:50], "stats": stats, "heatmap": heat, "path": path, "meanPosition": mean_pos,
        })

    # positional role (interpretation) from mean position among outfield team-mates
    for team in TEAMS:
        tp = [p for p in out if p["team"] == team and p["role"] == "field" and p["meanPosition"]
              and p["stats"]["minutesCalibrated"] >= 2]
        for p in tp:
            x, y = p["meanPosition"]
            if x < L * 0.38:
                p["positionalRole"] = "Fixo (posição média recuada)"
            elif x > L * 0.6:
                p["positionalRole"] = "Pivô (posição média avançada)"
            else:
                p["positionalRole"] = "Ala " + ("esquerdo" if y < W / 2 else "direito") + " (posição média intermédia)"
    _evaluate(out)
    return out


def _evaluate(players: list[dict]) -> None:
    """Percentiles vs other outfield players of the same match, only with enough sample."""
    pool = [p for p in players if p["team"] in TEAMS and p["role"] != "other"]
    for p in players:
        p["evaluation"] = {}
        p["strengths"], p["weaknesses"], p["recommendations"] = [], [], []
    for key, (label, cat, hib, skey, smin) in METRICS.items():
        eligible = [p for p in pool if p["stats"].get(key) is not None and p["stats"].get(skey, 0) >= smin
                    and p["role"] == "field"]
        vals = np.array([p["stats"][key] for p in eligible], dtype=float)
        for p in players:
            v = p["stats"].get(key)
            entry = {"label": label, "category": cat, "value": v, "sample": p["stats"].get(skey, 0),
                     "sampleKey": skey, "minSample": smin}
            if v is None:
                entry["status"] = "sem dados"
            elif p["stats"].get(skey, 0) < smin:
                entry["status"] = "evidência insuficiente"
            elif len(vals) < 4:
                entry["status"] = "sem comparação (poucos jogadores com amostra)"
            elif p["role"] != "field":
                entry["status"] = "não comparável (guarda-redes/outro)"
            else:
                pct = float((vals < v).mean() + 0.5 * (vals == v).mean())
                entry["percentile"] = round(pct, 2)
                entry["status"] = "ok"
                if hib is not None:
                    good = pct if hib else 1 - pct
                    if good >= 0.75:
                        p["strengths"].append({"metric": key, "label": label, "value": v, "percentile": round(pct, 2),
                                               "text": f"{label}: {v} — entre os melhores do jogo (percentil {pct:.0%})."})
                    elif good <= 0.25:
                        p["weaknesses"].append({"metric": key, "label": label, "value": v, "percentile": round(pct, 2),
                                                "text": f"{label}: {v} — abaixo dos restantes jogadores (percentil {pct:.0%})."})
                        if key in RECOMMENDATIONS:
                            p["recommendations"].append(RECOMMENDATIONS[key])
            p["evaluation"][key] = entry
    for p in players:
        p["notMeasurable"] = NOT_MEASURABLE
