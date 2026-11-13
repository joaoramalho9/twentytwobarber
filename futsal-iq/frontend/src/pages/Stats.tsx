import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, Empty, PageHeader, Stat } from "../components/ui";
import { db } from "../lib/db";
import { mergedEvents } from "../lib/events";
import { pct } from "../lib/format";
import { useApp } from "../lib/store";
import type { Analysis, Project, UserData } from "../lib/types";

interface Row {
  p: Project;
  a?: Analysis;
  u: UserData;
}

/** Counts only events that are confirmed or manual (never unreviewed automatic ones). */
function counts(r: Row, team: "A" | "B") {
  const ev = mergedEvents(r.a, r.u).filter((e) => e.team === team && (e.status === "confirmed" || e.status === "manual"));
  const c = (t: string[]) => ev.filter((e) => t.includes(e.type)).length;
  return {
    goals: c(["goal"]),
    shots: c(["shot", "chance"]),
    setPieces: ev.filter((e) => e.setPiece).length,
  };
}

export default function Stats() {
  const { projects } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    (async () => {
      const out: Row[] = [];
      for (const p of projects) out.push({ p, a: await db.getAnalysis(p.id), u: await db.getUser(p.id) });
      setRows(out);
    })();
  }, [projects]);

  // aggregate by team name across games
  const teams = new Map<string, { games: number; poss: number[]; goals: number; shots: number; setPieces: number; systems: Record<string, number> }>();
  rows.forEach((r) => {
    (["A", "B"] as const).forEach((t) => {
      const name = (t === "A" ? r.p.teamA.name : r.p.teamB.name).trim();
      const cur = teams.get(name) || { games: 0, poss: [], goals: 0, shots: 0, setPieces: 0, systems: {} };
      cur.games++;
      if (r.a) {
        const tot = r.a.teams.A.possessionS + r.a.teams.B.possessionS;
        if (tot > 0) cur.poss.push(r.a.teams[t].possessionS / tot);
        Object.entries(r.a.tactics.summary[t].attackSystems).forEach(([k, v]) => (cur.systems[k] = (cur.systems[k] || 0) + v * r.a!.tactics.summary[t].possessionAnalysedS));
      }
      const c = counts(r, t);
      cur.goals += c.goals;
      cur.shots += c.shots;
      cur.setPieces += c.setPieces;
      teams.set(name, cur);
    });
  });

  const totalEvents = rows.reduce((s, r) => s + mergedEvents(r.a, r.u).filter((e) => e.status === "confirmed" || e.status === "manual").length, 0);
  const pending = rows.reduce((s, r) => s + mergedEvents(r.a, r.u).filter((e) => e.status === "pending" && e.type !== "pass").length, 0);

  return (
    <div>
      <PageHeader title="Estatísticas" subtitle="Agregado de todos os jogos guardados neste browser. Golos, remates e bolas paradas contam apenas eventos confirmados ou marcados manualmente." />
      {rows.length === 0 ? (
        <Empty title="Sem dados" />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Jogos" value={rows.length} />
            <Stat label="Com análise automática" value={rows.filter((r) => r.a).length} />
            <Stat label="Eventos confirmados" value={totalEvents} accent />
            <Stat label="Eventos por rever" value={pending} hint="automáticos (sem passes)" />
          </div>
          <Card title="Por jogo" className="mb-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                  <tr>
                    <th className="py-2">Jogo</th><th>Posse A/B</th><th>Golos A–B</th><th>Remates A–B</th><th>Bolas paradas A–B</th><th>Sistema A</th><th>Sistema B</th><th>Qualidade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800">
                  {rows.map((r) => {
                    const a = r.a;
                    const tot = a ? a.teams.A.possessionS + a.teams.B.possessionS : 0;
                    const ca = counts(r, "A");
                    const cb = counts(r, "B");
                    const sys = (t: "A" | "B") => {
                      const top = a ? Object.entries(a.tactics.summary[t].attackSystems)[0] : undefined;
                      return top ? `${top[0]} (${pct(top[1])})` : "—";
                    };
                    return (
                      <tr key={r.p.id}>
                        <td className="py-2"><Link className="hover:text-neon" to={`/jogo/${r.p.id}`}>{r.p.name}</Link><div className="text-xs text-ink-500">{r.p.teamA.name} vs {r.p.teamB.name}</div></td>
                        <td className="font-mono">{tot ? `${pct(a!.teams.A.possessionS / tot)} / ${pct(a!.teams.B.possessionS / tot)}` : "—"}</td>
                        <td className="font-mono">{ca.goals}–{cb.goals}</td>
                        <td className="font-mono">{ca.shots}–{cb.shots}</td>
                        <td className="font-mono">{ca.setPieces}–{cb.setPieces}</td>
                        <td className="text-xs">{sys("A")}</td>
                        <td className="text-xs">{sys("B")}</td>
                        <td className="text-xs text-ink-400">{a ? `calib. ${pct(a.coverage.validPct)} · bola ${pct(a.coverage.ballDetectedPct)}` : "manual"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Por equipa (todos os jogos)">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                  <tr><th className="py-2">Equipa</th><th>Jogos</th><th>Posse média</th><th>Golos</th><th>Remates</th><th>Bolas paradas</th><th>Sistema mais usado</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-800">
                  {[...teams.entries()].sort((x, y) => y[1].games - x[1].games).map(([name, t]) => {
                    const top = Object.entries(t.systems).sort((x, y) => y[1] - x[1])[0];
                    return (
                      <tr key={name}>
                        <td className="py-2">{name}</td>
                        <td className="font-mono">{t.games}</td>
                        <td className="font-mono">{t.poss.length ? pct(t.poss.reduce((s, x) => s + x, 0) / t.poss.length) : "—"}</td>
                        <td className="font-mono">{t.goals}</td>
                        <td className="font-mono">{t.shots}</td>
                        <td className="font-mono">{t.setPieces}</td>
                        <td>{top ? top[0] : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
