import { Printer } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Court, Heat, hexToRgb } from "../components/Court";
import { Bar, Button, KindBadge, NeedProject, PageHeader, ProjectPicker, TeamDot } from "../components/ui";
import { mergedEvents, type MergedEvent } from "../lib/events";
import { fmtTime, num, pct, SET_PIECE_LABEL } from "../lib/format";
import { useApp, useProjectData } from "../lib/store";
import type { Analysis, Insight, Project, TeamKey, UserData } from "../lib/types";

const TEAMS: TeamKey[] = ["A", "B"];

export default function Report() {
  const { currentId, setCurrentId } = useApp();
  const { project, analysis, user, setUser, loading } = useProjectData(currentId);
  if (!currentId) return <div><PageHeader title="Relatório" actions={<ProjectPicker value={currentId} onChange={setCurrentId} />} /><NeedProject /></div>;
  if (loading || !project) return <div className="text-ink-400">A carregar…</div>;
  const note = (k: string) => (
    <Notes value={user.reportNotes[k] || ""} onChange={(v) => setUser((u) => ({ ...u, reportNotes: { ...u.reportNotes, [k]: v } }))} />
  );
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Relatório do jogo"
        subtitle="Gerado a partir de dados medidos, eventos confirmados e notas do analista. Cada conclusão indica a origem e o grau de confiança."
        actions={
          <>
            <ProjectPicker value={currentId} onChange={setCurrentId} />
            <Button variant="primary" onClick={() => window.print()}><Printer size={16} /> Exportar PDF</Button>
          </>
        }
      />
      <ReportBody p={project} a={analysis} u={user} note={note} />
    </div>
  );
}

function Notes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-3">
      <textarea
        className="w-full rounded-lg border border-dashed border-ink-600 bg-transparent p-2 text-sm text-white placeholder:text-ink-500 focus:border-fuchsia-400/60 focus:outline-none print:hidden"
        rows={2}
        value={value}
        placeholder="Notas do analista para esta secção (aparecem no PDF)…"
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <div className="mt-1 hidden whitespace-pre-wrap border-l-2 border-fuchsia-400 pl-3 text-sm print:block">
          <span className="text-[10px] font-semibold uppercase">Analista:</span> {value}
        </div>
      )}
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-ink-700 bg-ink-900/70 p-5 print:mb-4 print:rounded-none print:border-0 print:border-t print:border-gray-300 print:bg-white print:p-0 print:pt-3">
      <h2 className="mb-3 font-display text-lg font-semibold">
        <span className="mr-2 text-neon">{String(n).padStart(2, "0")}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function InsightList({ items }: { items: Insight[] }) {
  if (!items.length) return <p className="text-sm text-ink-500">Sem conclusões automáticas com evidência suficiente.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((i, k) => (
        <li key={k} className="flex items-start gap-2 text-sm">
          <KindBadge kind={i.kind} confidence={i.confidence} title={i.evidence} />
          <span>{i.text}<span className="block text-[11px] text-ink-500">Base: {i.evidence}</span></span>
        </li>
      ))}
    </ul>
  );
}

function TeamCols({ a, p, render }: { a?: Analysis; p: Project; render: (t: TeamKey) => ReactNode }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 print:grid-cols-2">
      {TEAMS.map((t) => (
        <div key={t}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
            <TeamDot color={a?.teams[t].color || (t === "A" ? p.teamA.color : p.teamB.color)} /> {t === "A" ? p.teamA.name : p.teamB.name}
          </h3>
          {render(t)}
        </div>
      ))}
    </div>
  );
}

function compare(a: Analysis) {
  const out: { team: TeamKey; strength: boolean; text: string }[] = [];
  const S = a.tactics.summary;
  const tr = a.transitions;
  const nm = (t: TeamKey) => a.teams[t].name;
  const metrics: [string, (t: TeamKey) => number | null][] = [
    ["coberturas ao jogador que pressiona", (t) => S[t].coverPct],
    ["fecho de linhas de passe", (t) => S[t].lanesClosedPct],
    ["superioridade numérica junto à bola", (t) => S[t].superiorityPct],
    ["pressão imediata após perda", (t) => (tr[t].defensive >= 3 ? tr[t].counterPress / tr[t].defensive : null)],
    ["recuperação da bola ≤ 5 s após perda", (t) => (tr[t].defensive >= 3 ? tr[t].regained5s / tr[t].defensive : null)],
  ];
  for (const [label, f] of metrics) {
    const va = f("A");
    const vb = f("B");
    if (va == null || vb == null || Math.abs(va - vb) < 0.1) continue;
    const best: TeamKey = va > vb ? "A" : "B";
    const worst: TeamKey = best === "A" ? "B" : "A";
    out.push({ team: best, strength: true, text: `Melhor ${label} (${pct(f(best))} vs ${pct(f(worst))} de ${nm(worst)}).` });
    out.push({ team: worst, strength: false, text: `Menor ${label} (${pct(f(worst))} vs ${pct(f(best))} de ${nm(best)}).` });
  }
  return out;
}

function ReportBody({ p, a, u, note }: { p: Project; a?: Analysis; u: UserData; note: (k: string) => ReactNode }) {
  const ev = mergedEvents(a, u);
  const confirmed = ev.filter((e) => e.status === "confirmed" || e.status === "manual");
  const goals = confirmed.filter((e) => e.type === "goal");
  const pendingGoals = ev.filter((e) => e.type === "goal" && e.status === "pending");
  const name = (pid?: string | null) => (pid ? a?.players.find((x) => x.id === pid)?.name || "—" : "—");
  const ins = (section: string, t: TeamKey | null) => (a?.insights || []).filter((i) => i.section === section && i.team === t);
  const cmp = a ? compare(a) : [];
  const totPoss = a ? a.teams.A.possessionS + a.teams.B.possessionS : 0;
  const setPieceManual = confirmed.filter((e) => e.setPiece && e.source === "manual");

  return (
    <div className="print:text-black">
      <div className="mb-6 rounded-xl border border-ink-700 bg-gradient-to-br from-ink-900 to-ink-850 p-6 print:border-0 print:bg-none print:p-0">
        <div className="text-xs uppercase tracking-[0.2em] text-neon">FUTSAL IQ · Relatório de análise</div>
        <h1 className="mt-2 font-display text-3xl font-bold">{p.teamA.name} vs {p.teamB.name}</h1>
        <div className="mt-1 text-sm text-ink-400">{[p.name, p.competition, p.date].filter(Boolean).join(" · ")}</div>
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <span>Golos confirmados: <b className="font-mono">{goals.filter((g) => g.team === "A").length} – {goals.filter((g) => g.team === "B").length}</b></span>
          {pendingGoals.length > 0 && <span className="text-amber-300">{pendingGoals.length} golo(s) candidato(s) por confirmar (não contabilizados)</span>}
          {a && totPoss > 0 && <span>Posse estimada: {pct(a.teams.A.possessionS / totPoss)} – {pct(a.teams.B.possessionS / totPoss)}</span>}
        </div>
        <div className="mt-4 text-xs text-ink-400">
          {a ? (
            <>Fonte: análise automática de {fmtTime(a.coverage.analysedFromS)}–{fmtTime(a.coverage.analysedToS)} · calibração válida em {pct(a.coverage.validPct)} dos frames · bola detetada em {pct(a.coverage.ballDetectedPct)} · {confirmed.length} eventos confirmados/manuais.</>
          ) : (
            <>Fonte: apenas marcação manual ({confirmed.length} eventos). Sem análise automática — as secções táticas baseiam-se nas notas do analista.</>
          )}
        </div>
        {a?.warnings.map((w, i) => <div key={i} className="mt-1 text-xs text-amber-300">⚠ {w}</div>)}
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-ink-400">
          <KindBadge kind="medição" /> <KindBadge kind="deteção" /> <KindBadge kind="estimativa" /> <KindBadge kind="interpretação" /> <KindBadge kind="manual" /> — percentagem = confiança
        </div>
      </div>

      {goals.length > 0 && (
        <div className="mb-6 text-sm">
          <b>Golos:</b> {goals.map((g) => `${fmtTime(g.t)} ${g.team ? (g.team === "A" ? p.teamA.name : p.teamB.name) : ""}${g.player ? ` (${name(g.player)})` : ""}`).join(" · ")}
        </div>
      )}

      <Section n={1} title="Identidade tática das equipas">
        <TeamCols a={a} p={p} render={(t) => (
          <>
            <InsightList items={ins("identidade", t)} />
            {a && Object.keys(a.tactics.summary[t].attackSystems).length > 0 && (
              <p className="mt-2 text-sm">Perfil: ataca predominantemente em <b>{Object.keys(a.tactics.summary[t].attackSystems)[0]}</b>{Object.keys(a.tactics.summary[t].defenceBlocks).length > 0 && <> e defende maioritariamente em <b>{Object.entries(a.tactics.summary[t].defenceBlocks).sort((x, y) => y[1] - x[1])[0][0]}</b></>}. <KindBadge kind="interpretação" /></p>
            )}
          </>
        )} />
        {note("identity")}
      </Section>

      <Section n={2} title="Sistemas utilizados">
        <TeamCols a={a} p={p} render={(t) => a ? (
          <div className="space-y-2">
            {Object.entries(a.tactics.summary[t].attackSystems).map(([k, v]) => <Bar key={k} label={`Ataque ${k}`} value={v} color={a.teams[t].color || undefined} />)}
            {Object.entries(a.tactics.summary[t].defenceShapes).slice(0, 3).map(([k, v]) => <Bar key={k} label={`Defesa ${k}`} value={v} color="#888" />)}
            {a.tactics.summary[t].powerPlayS > 0 && <p className="text-sm">Power play: {Math.round(a.tactics.summary[t].powerPlayS)} s</p>}
            {!Object.keys(a.tactics.summary[t].attackSystems).length && <p className="text-sm text-ink-500">Sem dados calibrados suficientes.</p>}
            <InsightList items={ins("sistemas", t)} />
          </div>
        ) : <p className="text-sm text-ink-500">Sem análise automática.</p>} />
        {note("systems")}
      </Section>

      <Section n={3} title="Organização ofensiva">
        <TeamCols a={a} p={p} render={(t) => <InsightList items={ins("ataque", t)} />} />
        {note("attack")}
      </Section>

      <Section n={4} title="Organização defensiva">
        <TeamCols a={a} p={p} render={(t) => <InsightList items={ins("defesa", t)} />} />
        {note("defence")}
      </Section>

      <Section n={5} title="Transições">
        <TeamCols a={a} p={p} render={(t) => <InsightList items={ins("transições", t)} />} />
        {note("transitions")}
      </Section>

      <Section n={6} title="Jogadas ensaiadas e bolas paradas">
        {a && a.setPieces.patterns.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {a.setPieces.patterns.map((pt) => (
              <li key={pt.id} className="flex items-start gap-2">
                <KindBadge kind="interpretação" confidence={pt.confidence} />
                <span><b>{a.teams[pt.team].name}</b> — {SET_PIECE_LABEL[pt.type] || pt.type}: padrão repetido {pt.occurrences.length}× ({pt.times.map(fmtTime).join(", ")}); resultados: {pt.results.join(", ")}.</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-500">Nenhuma jogada ensaiada identificada automaticamente (exige repetição do mesmo padrão de movimentos).</p>
        )}
        {a && (
          <p className="mt-2 text-sm text-ink-300">
            Bolas paradas detetadas automaticamente: {Object.entries(a.setPieces.items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.type]: (acc[i.type] || 0) + 1 }), {})).map(([k, v]) => `${SET_PIECE_LABEL[k] || k} ${v}`).join(" · ") || "nenhuma"}.
          </p>
        )}
        {setPieceManual.length > 0 && <p className="mt-1 text-sm text-ink-300">Marcadas pelo analista: {setPieceManual.map((e) => `${fmtTime(e.t)} ${e.label}`).join(" · ")}.</p>}
        {note("setpieces")}
      </Section>

      <Section n={7} title="Análise individual dos jogadores">
        {a ? (
          <TeamCols a={a} p={p} render={(t) => (
            <div className="space-y-3">
              {a.players.filter((x) => x.team === t && (x.stats.minutesVisible || 0) >= 2).sort((x, y) => (y.stats.minutesVisible || 0) - (x.stats.minutesVisible || 0)).slice(0, 8).map((pl) => {
                const r = u.ratings[pl.id] || {};
                return (
                  <div key={pl.id} className="rounded-lg border border-ink-700 p-3 text-sm print:border-gray-300">
                    <div className="flex items-start gap-3">
                      {pl.heatmap && <div className="w-24 shrink-0"><Court L={a.court.length} W={a.court.width}><Heat grid={pl.heatmap} L={a.court.length} W={a.court.width} color={hexToRgb(a.teams[t].color)} /></Court></div>}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{pl.name} <span className="font-normal text-ink-400">· {pl.role === "gk" ? "GR" : pl.positionalRole || "campo"} · {num(pl.stats.minutesVisible, 1)} min visível</span></div>
                        <div className="mt-0.5 text-xs text-ink-400">
                          {pl.stats.distancePerMin != null && `${pl.stats.distancePerMin} m/min · `}
                          {pl.stats.topSpeedKmh != null && `${pl.stats.topSpeedKmh} km/h máx · `}
                          {pl.stats.touches} toques · {pl.stats.passesCompleted} passes · {pl.stats.recoveries} recup. · {pl.stats.losses} perdas
                        </div>
                        {pl.strengths.length > 0 && <div className="mt-1 text-xs">▲ {pl.strengths.map((s) => s.label).join(", ")}</div>}
                        {pl.weaknesses.length > 0 && <div className="text-xs">▼ {pl.weaknesses.map((s) => s.label).join(", ")}</div>}
                        {Object.keys(r).filter((k) => r[k]).length > 0 && <div className="mt-1 text-xs text-fuchsia-300">Analista: {Object.entries(r).filter(([, v]) => v).map(([k, v]) => `${k} ${v}/5`).join(" · ")}</div>}
                        {u.playerNotes[pl.id] && <div className="mt-1 text-xs italic text-ink-300">“{u.playerNotes[pl.id]}”</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )} />
        ) : <p className="text-sm text-ink-500">Sem análise automática de jogadores.</p>}
        {note("players")}
      </Section>

      <Section n={8} title="Pontos fortes">
        <TeamCols a={a} p={p} render={(t) => {
          const items = cmp.filter((c) => c.team === t && c.strength);
          return items.length ? <ul className="space-y-1.5 text-sm">{items.map((c, i) => <li key={i} className="flex gap-2"><KindBadge kind="interpretação" /> {c.text}</li>)}</ul> : <p className="text-sm text-ink-500">Sem diferenças mensuráveis relevantes (≥ 10 p.p.).</p>;
        }} />
        {note("strengths")}
      </Section>

      <Section n={9} title="Fragilidades">
        <TeamCols a={a} p={p} render={(t) => {
          const items = cmp.filter((c) => c.team === t && !c.strength);
          return items.length ? <ul className="space-y-1.5 text-sm">{items.map((c, i) => <li key={i} className="flex gap-2"><KindBadge kind="interpretação" /> {c.text}</li>)}</ul> : <p className="text-sm text-ink-500">Sem diferenças mensuráveis relevantes (≥ 10 p.p.).</p>;
        }} />
        <EventsSummary ev={confirmed} p={p} />
        {note("weaknesses")}
      </Section>

      <Section n={10} title="Recomendações para o próximo jogo">
        {a && a.recommendations.length > 0 ? (
          <TeamCols a={a} p={p} render={(t) => {
            const r = a.recommendations.filter((x) => x.team === t);
            return r.length ? <ul className="list-disc space-y-1.5 pl-4 text-sm">{r.map((x, i) => <li key={i}>{x.text} <span className="text-[11px] text-ink-500">(base: {x.basis})</span></li>)}</ul> : <p className="text-sm text-ink-500">Sem recomendações automáticas.</p>;
          }} />
        ) : <p className="text-sm text-ink-500">Sem recomendações automáticas (dados insuficientes). Use as notas abaixo.</p>}
        <p className="mt-2 text-[11px] text-ink-500">As recomendações referem-se a como jogar <i>contra</i> a equipa indicada, derivadas das suas tendências medidas.</p>
        {note("recommendations")}
      </Section>

      <div className="mt-8 text-center text-[11px] text-ink-500 print:mt-4">
        FUTSAL IQ · análise local open-source (YOLO + ByteTrack + OpenCV) · gerado em {new Date().toLocaleString("pt-PT")} · <Link to={`/jogo/${p.id}`} className="print:hidden">abrir jogo</Link>
      </div>
    </div>
  );
}

function EventsSummary({ ev, p }: { ev: MergedEvent[]; p: Project }) {
  const errs = ev.filter((e) => e.type === "defensive_error" || (e.type === "turnover" && e.dangerZone));
  if (!errs.length) return null;
  const byTeam = (t: TeamKey) => errs.filter((e) => (e.type === "turnover" ? e.lostTeam === t : e.team === t));
  return (
    <div className="mt-3 text-sm">
      <b>Erros/perdas em zona de risco (confirmados):</b>{" "}
      {TEAMS.map((t) => `${t === "A" ? p.teamA.name : p.teamB.name}: ${byTeam(t).length}${byTeam(t).length ? ` (${byTeam(t).map((e) => fmtTime(e.t)).join(", ")})` : ""}`).join(" · ")}
    </div>
  );
}
