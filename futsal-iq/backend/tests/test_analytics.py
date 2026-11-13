import os
import tempfile

os.environ.setdefault("FUTSALIQ_DATA", tempfile.mkdtemp(prefix="futsaliq_test_"))

import numpy as np  # noqa: E402

from futsaliq import analyze, court, storage  # noqa: E402
from futsaliq.analytics.tactics import classify_shape  # noqa: E402

from . import sim  # noqa: E402


def _run():
    pid = sim.write_project(storage, sim.build())
    return pid, analyze.run(pid)


RESULT = None


def result():
    global RESULT
    if RESULT is None:
        RESULT = _run()
    return RESULT


def test_homography_roundtrip():
    pts = [{"landmark": "corner_left_far", "x": 100, "y": 50}, {"landmark": "corner_left_near", "x": 20, "y": 400},
           {"landmark": "corner_right_far", "x": 700, "y": 50}, {"landmark": "corner_right_near", "x": 780, "y": 400},
           {"landmark": "center", "x": 400, "y": 190}]
    sol = court.solve_homography(pts, 40, 20)
    c = court.to_court(np.array(sol["H"]), np.array([[100, 50], [780, 400]]))
    assert np.allclose(c[0], [0, 0], atol=0.6) and np.allclose(c[1], [40, 20], atol=0.6)


def test_shape_classifier():
    assert classify_shape(np.array([(-2.5, -6), (-2.5, 0), (-2.5, 6), (7.5, 0)], float))[0] == "3-1"
    assert classify_shape(np.array([(0, -7), (0, -2), (0, 3), (0, 8)], float))[0] == "4-0"
    assert classify_shape(np.array([(-4, -5), (-4, 5), (4, -5), (4, 5)], float))[0] == "2-2"
    assert classify_shape(np.array([(-6, 0), (0, -6), (0, 6), (6, 0)], float))[0] == "1-2-1"


def test_teams_and_goalkeepers():
    _, a = result()
    named = [p for p in a["players"] if p["team"] in ("A", "B")]
    assert len([p for p in named if p["team"] == "A"]) == 5
    assert len([p for p in named if p["team"] == "B"]) == 5
    gks = [p for p in a["players"] if p["role"] == "gk"]
    assert {p["team"] for p in gks} == {"A", "B"}
    assert all(p["name"].startswith("Jogador ") for p in named)
    # A attacks to the right in the scripted match (direction is relative to team labels)
    dirs = {t: a["teams"][t]["direction"]["1"] for t in "AB"}
    assert dirs["A"] == -dirs["B"]


def test_possession_passes_turnovers():
    _, a = result()
    types = [e["type"] for e in a["events"]]
    assert types.count("pass") >= 8
    assert types.count("turnover") >= 1
    assert sum(t["possessionS"] for t in a["teams"].values()) > 20


def test_set_pieces_and_rehearsed_pattern():
    _, a = result()
    corners = [e for e in a["events"] if e["type"] == "corner"]
    assert len(corners) == 2, [e["label"] for e in a["events"] if e.get("setPiece")]
    pats = a["setPieces"]["patterns"]
    assert len(pats) == 1 and pats[0]["type"] == "corner" and len(pats[0]["occurrences"]) == 2
    assert all(it["rehearsed"] for it in a["setPieces"]["items"] if it["type"] == "corner")


def test_shot_and_goal_candidate():
    _, a = result()
    shots = [e for e in a["events"] if e["type"] == "shot"]
    goals = [e for e in a["events"] if e["type"] == "goal"]
    assert len(shots) >= 1
    assert len(goals) == 1
    assert goals[0]["team"] == shots[0]["team"]
    assert 58 <= goals[0]["t"] <= 63


def test_tactical_system_detected():
    _, a = result()
    # the attacking team in the scripted 3-20 s phase uses 3-1
    systems = [s["attackSystem"] for s in a["tactics"]["spells"] if s["t0"] < 20]
    assert "3-1" in systems
    blocks = [s["defenceBlock"] for s in a["tactics"]["spells"] if s["t0"] < 20 and s["defenceBlock"]]
    assert blocks and blocks[0] == "bloco baixo"


def test_physical_metrics_plausible():
    _, a = result()
    for p in a["players"]:
        st = p["stats"]
        if st.get("topSpeedKmh"):
            assert st["topSpeedKmh"] < 36
        if st.get("distancePerMin"):
            assert 0 <= st["distancePerMin"] < 400
    assert all(i["kind"] in ("medição", "estimativa", "interpretação") for i in a["insights"])
