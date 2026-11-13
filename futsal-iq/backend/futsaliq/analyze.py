"""Stage 2 — analytics (cheap; re-run after calibration, corrections or team colours change)."""
from __future__ import annotations

import time
from typing import Callable

import numpy as np

from . import detect, storage
from .analytics import events as E
from .analytics import players as P
from .analytics import setpieces as S
from .analytics import tactics as T
from .analytics import world as Wd

VERSION = 1


def _pct(x):
    return f"{x:.0%}" if x is not None else "—"


def insights(world, tactics, trans, buildup, setp, poss, ball_cov, team_names) -> list[dict]:
    """Report statements. Each one: section, team, text, kind (medição/estimativa/interpretação), confidence, evidence."""
    out = []

    def add(section, team, text, kind, conf, evidence):
        out.append({"section": section, "team": team, "text": text, "kind": kind,
                    "confidence": round(float(conf), 2), "evidence": evidence})

    tot = sum(poss["teamTime"].values())
    for team in Wd.TEAMS:
        nm = team_names[team]
        s = tactics["summary"][team]
        if tot > 0:
            add("identidade", team, f"{nm} teve a bola em {poss['teamTime'][team] / tot:.0%} do tempo de posse medido.",
                "estimativa", 0.6 * min(1, ball_cov / 0.5), f"posse por proximidade jogador-bola; bola detetada em {ball_cov:.0%} dos frames válidos")
        if s["attackSystems"]:
            top, share = next(iter(s["attackSystems"].items()))
            others = ", ".join(f"{k} {_pct(v)}" for k, v in list(s["attackSystems"].items())[1:3])
            add("sistemas", team, f"Sistema ofensivo predominante: {top} ({share:.0%} do tempo de posse analisado)"
                + (f"; também {others}." if others else "."), "interpretação",
                min(0.8, 0.3 + share * 0.5) * min(1, s["possessionAnalysedS"] / 120),
                f"{s['spells']} posses analisadas, {s['possessionAnalysedS']:.0f} s; classificação por modelos 3-1/4-0/2-2/1-2-1")
        if s["powerPlayS"] > 5:
            add("sistemas", team, f"Utilizou power play (5x4 com guarda-redes avançado) durante ~{s['powerPlayS']:.0f} s.",
                "interpretação", 0.55, "guarda-redes/5.º jogador a > 12 m da própria baliza durante a posse")
        if s["swapsPerMin"] is not None:
            lvl = "elevada" if s["swapsPerMin"] >= 2 else "moderada" if s["swapsPerMin"] >= 0.8 else "baixa"
            add("ataque", team, f"Mobilidade posicional {lvl}: {s['swapsPerMin']} trocas posicionais por minuto de posse (rotações).",
                "interpretação", 0.5, "mudanças persistentes da ordem lateral dos 4 jogadores de campo")
        if s["superiorityPct"] is not None:
            add("ataque", team, f"Criou superioridade numérica junto à bola (raio 8 m) em {_pct(s['superiorityPct'])} do tempo de posse.",
                "estimativa", 0.5, "contagem atacantes vs defensores a ≤ 8 m da bola")
        if s["defenceBlocks"]:
            top, share = max(s["defenceBlocks"].items(), key=lambda kv: kv[1])
            add("defesa", team, f"Sem bola, predominou {top} ({share:.0%}); distância média do bloco à própria baliza: {s['blockDepthM']} m.",
                "interpretação", 0.6, "posição média dos 4 jogadores de campo durante a posse adversária (>22 m alta, 13–22 m média, <13 m baixo)")
        if s["marking"]:
            top, share = max(s["marking"].items(), key=lambda kv: kv[1])
            add("defesa", team, f"Tipo de marcação predominante: {top} ({share:.0%}).", "interpretação", 0.45,
                "estabilidade do atacante mais próximo de cada defensor (≥ 70% = individual, ≤ 45% = zona)")
        if s["coverPct"] is not None:
            add("defesa", team, f"Quando um jogador pressionou a bola, existiu cobertura de um colega em {_pct(s['coverPct'])} dos casos.",
                "estimativa", 0.5, "colega a 2.5–7.5 m do pressionante e mais perto da própria baliza")
        if s["lanesClosedPct"] is not None:
            add("defesa", team, f"Fechou {_pct(s['lanesClosedPct'])} das linhas de passe do portador da bola.", "estimativa", 0.45,
                "defensor a < 1 m do segmento bola→colega")
        tr = trans["summary"][team]
        if tr["offensive"]:
            add("transições", team, f"{tr['offensive']} transições ofensivas após recuperação; {tr['counter']} classificadas como contra-ataque.",
                "interpretação", 0.45, "recuperação seguida de chegada à zona de finalização em ≤ 6 s")
        if tr["defensive"]:
            add("transições", team, f"Reação à perda: pressão imediata em {tr['counterPress']}/{tr['defensive']} perdas; "
                f"recuperou a bola em ≤ 5 s em {tr['regained5s']}.", "interpretação", 0.45,
                "≥ 2 jogadores a ≤ 4 m da bola nos 3 s após a perda")
        b = buildup[team]
        if b["count"]:
            add("ataque", team, f"Construção desde o guarda-redes: {b['count']} posses; {b['reachedMidfield']} passaram o meio-campo, "
                f"{b['reachedFinalThird']} chegaram ao último terço.", "estimativa", 0.45, "posses cujo 1.º portador é o guarda-redes")
        pats = [p for p in setp["patterns"] if p["team"] == team]
        if pats:
            for p in pats:
                add("bolas paradas", team, f"Padrão repetido em {p['type']}: {len(p['occurrences'])} execuções semelhantes "
                    f"(distância média {p['meanDistanceM']} m) — provável jogada ensaiada.", "interpretação", p["confidence"],
                    "comparação de trajetórias 0–6 s após o reinício")
    if not world.valid.any():
        add("limitações", None, "Sem calibração do campo, a análise tática, física e de bolas paradas não é calculada.",
            "medição", 1.0, "nenhum frame com homografia válida")
    if ball_cov < 0.3:
        add("limitações", None, f"A bola foi detetada em apenas {ball_cov:.0%} dos frames válidos: passes, posse e remates têm baixa fiabilidade.",
            "medição", 1.0, "deteção YOLO classe 'sports ball'")
    return out


def recommendations(ins: list[dict], tactics: dict, trans: dict, team_names) -> list[dict]:
    """Rule-based preparation points for the next match, derived from the opponent's measured tendencies."""
    recs = []
    for team in Wd.TEAMS:
        nm = team_names[team]
        s = tactics["summary"][team]
        tr = trans["summary"][team]
        if s["defenceBlocks"].get("pressão alta", 0) > 0.4:
            recs.append({"team": team, "text": f"{nm} pressiona alto com frequência: preparar saída de pressão com 4-0/3-1 e "
                         "opção de bola longa ao pivô; considerar 5x4 com guarda-redes avançado na construção.", "basis": "bloco defensivo"})
        if s["defenceBlocks"].get("bloco baixo", 0) > 0.4:
            recs.append({"team": team, "text": f"{nm} defende baixo: privilegiar circulação rápida, remate de meia distância e "
                         "segundo poste; paciência para criar 2x1 nas alas.", "basis": "bloco defensivo"})
        if s["coverPct"] is not None and s["coverPct"] < 0.4:
            recs.append({"team": team, "text": f"{nm} raramente tem cobertura ao jogador que pressiona: atacar com 1x1 e "
                         "desmarcações nas costas do pressionante.", "basis": "coberturas"})
        if tr["defensive"] >= 3 and tr["counterPress"] / tr["defensive"] < 0.3:
            recs.append({"team": team, "text": f"{nm} recua após perder a bola em vez de pressionar: explorar transições rápidas após recuperação.",
                         "basis": "reação à perda"})
        if tr["defensive"] >= 3 and tr["counterPress"] / tr["defensive"] >= 0.6:
            recs.append({"team": team, "text": f"{nm} pressiona forte após a perda: primeiro passe de segurança para fora da zona de pressão.",
                         "basis": "reação à perda"})
        if s["marking"].get("individual", 0) > 0.5:
            recs.append({"team": team, "text": f"{nm} marca maioritariamente individual: usar bloqueios, trocas posicionais e "
                         "movimentos de arrastamento para abrir espaços.", "basis": "tipo de marcação"})
        if s["marking"].get("zona", 0) > 0.5:
            recs.append({"team": team, "text": f"{nm} defende à zona: sobrecarregar um setor e procurar jogadores entre linhas.",
                         "basis": "tipo de marcação"})
    return recs


def run(pid: str, progress: Callable[[float, str, dict], None] | None = None) -> dict:
    progress = progress or (lambda *a: None)
    t0 = time.time()
    project = storage.load_project(pid)
    ck = detect.checkpoint(pid)
    if not ck:
        raise RuntimeError("Ainda não existem dados de deteção. Execute primeiro a análise de vídeo.")
    params = ck["params"]
    progress(0.05, "A carregar dados de tracking", {})
    frames = detect.load_frames(pid)
    if not frames:
        raise RuntimeError("Não há frames analisados.")
    world = Wd.build_world(frames, project, params)
    progress(0.2, "A separar equipas e identificar jogadores", {})
    Wd.assign_teams(world, project)
    Wd.stitch(world)
    corr = project.get("corrections") or {}
    Wd.apply_corrections(world, corr)
    Wd.finalize_ids(world, corr)
    Wd.detect_roles_and_direction(world)
    Wd.name_players(world)
    states = E.frame_states(world)
    progress(0.4, "Bola e posse", {})
    ball = E.ball_track(world)
    stops = E.stoppages(world, states, ball)
    poss = E.possession(world, states, ball, E.dead_mask(world, stops))
    ev = E.EventLog()
    pt = E.passes_and_turnovers(world, poss, ball, ev)
    shots = E.shots(world, poss, ball, ev)
    progress(0.55, "Paragens, reinícios e bolas paradas", {})
    restarts, first_ko = E.classify_restarts(world, states, ball, poss, stops, ev)
    audio = storage.read_json(storage.project_dir(pid) / "audio.json")
    goals = E.goal_candidates(world, restarts, first_ko, shots, audio, ev)
    E.audio_peaks(audio, ev)
    progress(0.65, "Análise tática", {})
    tactics = T.analyse_spells(world, states, poss, ball)
    speeds = T.player_speeds(world)
    rups = T.ruptures(world, states, poss, speeds, ev)
    trans = T.transitions(world, states, poss, ball, pt["turnovers"], ev)
    buildup = T.build_up_from_gk(world, states, poss)
    progress(0.8, "Jogadas ensaiadas", {})
    setp = S.analyse(world, states, restarts, pt["passes"], shots, goals, poss)
    progress(0.9, "Scouting individual", {})
    players = P.build_players(world, states, poss, ball, {"passes": pt["passes"], "turnovers": pt["turnovers"],
                                                         "shots": shots, "ruptures": rups}, speeds)
    valid_n = int(world.valid.sum())
    ball_cov = float((ball["detected"] & world.valid).sum() / valid_n) if valid_n else float(ball["detected"].mean())
    team_names = {"A": project["teamA"]["name"], "B": project["teamB"]["name"]}
    ins = insights(world, tactics, trans, buildup, setp, poss, ball_cov, team_names)
    recs = recommendations(ins, tactics, trans, team_names)

    # possession timeline in 60 s buckets
    bucket = 60.0
    nb = int(np.ceil((world.t[-1] - world.t[0] + 1) / bucket)) if world.F else 0
    timeline = [{"t": round(world.t[0] + i * bucket, 1), "A": 0.0, "B": 0.0} for i in range(nb)]
    for sp in poss["spells"]:
        i = int((sp["t0"] - world.t[0]) // bucket)
        if 0 <= i < nb:
            timeline[i][sp["team"]] += round(sp["t1"] - sp["t0"], 2)

    result = {
        "version": VERSION,
        "projectId": pid,
        "generatedAt": time.time(),
        "computeS": round(time.time() - t0, 2),
        "params": params,
        "coverage": {
            "framesAnalysed": world.F,
            "sampleDt": round(world.dt, 3),
            "analysedFromS": float(world.t[0]), "analysedToS": float(world.t[-1]),
            "calibratedPct": round(float(world.calibrated.mean()), 3),
            "validPct": round(float(world.valid.mean()), 3),
            "widePct": round(float(world.wide.mean()), 3),
            "ballDetectedPct": round(ball_cov, 3),
            "tracklets": len(world.tracklets),
            "segments": int(len(set(world.seg.tolist()))),
        },
        "warnings": world.warnings,
        "teams": {
            team: {"name": team_names[team], "color": world.team_colors.get(team),
                   "colorSource": world.team_color_source,
                   "direction": {str(h): d for h, d in world.direction.get(team, {}).items()},
                   "possessionS": round(poss["teamTime"][team], 1)}
            for team in Wd.TEAMS
        },
        "directionSource": {str(k): v for k, v in getattr(world, "direction_source", {}).items()},
        "players": players,
        "events": ev.items,
        "tactics": tactics,
        "transitions": trans["summary"],
        "buildUp": buildup,
        "setPieces": setp,
        "insights": ins,
        "recommendations": recs,
        "possessionTimeline": timeline,
        "trackMap": {str(tid): pid_ for tid, pid_ in world.tid2pid.items()},
        "court": {"length": world.L, "width": world.W},
    }
    storage.write_json(storage.project_dir(pid) / "analysis.json", result)
    progress(1.0, "Análise concluída", {})
    return result
