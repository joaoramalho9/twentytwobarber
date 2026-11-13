import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Court, Heat, Path, hexToRgb } from "../components/Court";
import { Button, Card, Empty, KindBadge, NeedProject, PageHeader, ProjectPicker, TeamDot, inputCls } from "../components/ui";
import { mergedEvents } from "../lib/events";
import { fmtTime, num, pct } from "../lib/format";
import { useApp, useProjectData } from "../lib/store";
import type { Analysis, EvalEntry, PlayerA } from "../lib/types";

const CATS: { id: string; label: string }[] = [
  { id: "técnica", label: "Técnica" },
  { id: "tática", label: "Tática" },
  { id: "defesa", label: "Defesa" },
  { id: "física", label: "Física" },
];

export default function Scouting() {
  const { currentId, setCurrentId } = useApp();
  const { project, analysis, user, setUser, loading } = useProjectData(currentId);
  const [team, setTeam] = useState<string>("");
  const [sel, setSel] = useState<string | null>(null);

  const players = useMemo(
    () => (analysis?.players || []).filter((p) => p.team !== "other" && (!team || p.team === team)).sort((a, b) => (b.stats.minutesVisible || 0) - (a.stats.minutesVisible || 0)),
    [analysis, team],
  );
  const p = players.find((x) => x.id === sel) || players[0];

  return (
    <div>
      <PageHeader title="Scouting individual" subtitle="Fichas por jogador, baseadas apenas em evidência medida. Itens não mensuráveis automaticamente são avaliados pelo analista." actions={<ProjectPicker value={currentId} onChange={setCurrentId} />} />
      {!currentId ? (
        <NeedProject />
      ) : loading ? (
        <div className="text-ink-400">A carregar…</div>
      ) : !analysis ? (
        <Empty title="Sem análise automática" action={<Link to={`/jogo/${currentId}`}><Button variant="primary">Abrir jogo</Button></Link>}>
          As fichas de scouting são geradas a partir do tracking. Execute a análise do vídeo.
        </Empty>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <Card title="Jogadores">
            <select className={`${inputCls} mb-3`} value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Equipa">
              <option value="">Ambas as equipas</option>
              <option value="A">{analysis.teams.A.name}</option>
              <option value="B">{analysis.teams.B.name}</option>
            </select>
            <div className="max-h-[70vh] space-y-1 overflow-y-auto">
              {players.map((x) => (
                <button key={x.id} onClick={() => setSel(x.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${p?.id === x.id ? "bg-neon/10 text-neon" : "hover:bg-ink-800"}`}>
                  <TeamDot color={analysis.teams[x.team as "A" | "B"]?.color} />
                  <span className="flex-1 truncate">{x.name}{x.role === "gk" ? " (GR)" : ""}</span>
                  <span className="font-mono text-xs text-ink-400">{num(x.stats.minutesVisible, 1)}′</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-ink-500">Para renomear ou fundir jogadores use o separador «Jogadores» do jogo.</p>
          </Card>
          {p ? (
            <PlayerCard
              a={analysis}
              p={p}
              ratings={user.ratings[p.id] || {}}
              note={user.playerNotes[p.id] || ""}
              setRating={(item, v) => setUser((u) => ({ ...u, ratings: { ...u.ratings, [p.id]: { ...(u.ratings[p.id] || {}), [item]: v } } }))}
              setNote={(v) => setUser((u) => ({ ...u, playerNotes: { ...u.playerNotes, [p.id]: v } }))}
              events={mergedEvents(analysis, user).filter((e) => e.status !== "rejected" && (e.player === p.id || e.to === p.id || e.lostBy === p.id) && e.type !== "pass")}
              pid={project!.id}
            />
          ) : (
            <Empty title="Sem jogadores" />
          )}
        </div>
      )}
    </div>
  );
}

function PlayerCard({ a, p, ratings, note, setRating, setNote, events, pid }: { a: Analysis; p: PlayerA; ratings: Record<string, number>; note: string; setRating: (k: string, v: number) => void; setNote: (v: string) => void; events: ReturnType<typeof mergedEvents>; pid: string }) {
  const col = a.teams[p.team as "A" | "B"]?.color;
  const s = p.stats;
  const evalBy = (cat: string) => Object.entries(p.evaluation).filter(([, e]) => e.category === cat);
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl font-display text-xl font-bold" style={{ background: `rgba(${hexToRgb(col)},0.15)`, color: col || "#fff" }}>
            {p.name.replace("Jogador ", "").slice(0, 3)}
          </div>
          <div className="flex-1">
            <div className="font-display text-xl font-semibold">{p.name}</div>
            <div className="text-sm text-ink-400">
              {a.teams[p.team as "A" | "B"]?.name} · {p.role === "gk" ? "Guarda-redes" : p.positionalRole || "Jogador de campo"}
              {p.customName ? "" : " · identificador provisório"}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center text-sm">
            <div><div className="font-mono text-lg">{num(s.minutesVisible, 1)}′</div><div className="text-[11px] text-ink-400">visível</div></div>
            <div><div className="font-mono text-lg">{num(s.minutesCalibrated, 1)}′</div><div className="text-[11px] text-ink-400">calibrado</div></div>
            <div><div className="font-mono text-lg">{p.tracklets}</div><div className="text-[11px] text-ink-400">fragmentos</div></div>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-ink-500">
          Todas as métricas referem-se apenas ao tempo em que o jogador foi visto (e calibrado, para métricas em metros). Percentis comparam com os outros jogadores de campo deste jogo com amostra mínima.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Mapa de calor" subtitle="Normalizado: a equipa ataca sempre para a direita">
          {p.heatmap ? (
            <Court L={a.court.length} W={a.court.width}><Heat grid={p.heatmap} L={a.court.length} W={a.court.width} color={hexToRgb(col)} /></Court>
          ) : <p className="text-sm text-ink-400">Requer calibração do campo.</p>}
        </Card>
        <Card title="Percurso" subtitle="Amostra a 1 Hz">
          {p.path.length > 1 ? (
            <Court L={a.court.length} W={a.court.width}><Path pts={p.path} color={col || "#39ff88"} /></Court>
          ) : <p className="text-sm text-ink-400">Requer calibração do campo.</p>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {CATS.map((c) => (
          <Card key={c.id} title={c.label}>
            <div className="space-y-3">
              {evalBy(c.id).map(([k, e]) => <EvalRow key={k} k={k} e={e} />)}
              {c.id === "física" && (
                <div className="grid grid-cols-3 gap-2 pt-1 text-sm">
                  <Mini label="Distância medida" value={s.distanceM != null ? `${s.distanceM} m` : "—"} />
                  <Mini label="Sprints (≥18 km/h, ≥1 s)" value={s.sprints ?? "—"} />
                  <Mini label="Vel. máx. (p95 1 s)" value={s.topSpeedKmh != null ? `${s.topSpeedKmh} km/h` : "—"} />
                </div>
              )}
              {c.id === "técnica" && (
                <div className="grid grid-cols-4 gap-2 pt-1 text-sm">
                  <Mini label="Toques" value={s.touches ?? 0} />
                  <Mini label="Passes certos" value={s.passesCompleted ?? 0} />
                  <Mini label="Perdas" value={s.losses ?? 0} />
                  <Mini label="Remates" value={s.shots ?? 0} />
                </div>
              )}
              {c.id === "defesa" && (
                <div className="grid grid-cols-3 gap-2 pt-1 text-sm">
                  <Mini label="Recuperações" value={s.recoveries ?? 0} />
                  <Mini label="Pressões" value={s.pressures ?? 0} />
                  <Mini label="Ruturas (tática)" value={s.ruptures ?? 0} />
                </div>
              )}
              {(p.notMeasurable[c.id] || []).length > 0 && (
                <div className="border-t border-ink-700 pt-3">
                  <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-ink-400">Avaliação do analista <KindBadge kind="manual" /></div>
                  {(p.notMeasurable[c.id] || []).map((item) => (
                    <div key={item} className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="text-ink-300">{item}</span>
                      <div className="flex gap-1" role="radiogroup" aria-label={item}>
                        {[1, 2, 3, 4, 5].map((v) => (
                          <button key={v} role="radio" aria-checked={ratings[item] === v} onClick={() => setRating(item, ratings[item] === v ? 0 : v)} className={`h-6 w-6 rounded text-xs ${ratings[item] >= v ? "bg-fuchsia-500/70 text-white" : "bg-ink-800 text-ink-400"}`}>{v}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-ink-500">Não medido automaticamente com fiabilidade a partir de vídeo amador/broadcast.</p>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Pontos fortes">
          {p.strengths.length ? <ul className="space-y-2 text-sm">{p.strengths.map((x) => <li key={x.metric}>▲ {x.text}</li>)}</ul> : <p className="text-sm text-ink-400">Nenhum com evidência suficiente.</p>}
        </Card>
        <Card title="Fragilidades">
          {p.weaknesses.length ? <ul className="space-y-2 text-sm">{p.weaknesses.map((x) => <li key={x.metric}>▼ {x.text}</li>)}</ul> : <p className="text-sm text-ink-400">Nenhuma com evidência suficiente.</p>}
        </Card>
        <Card title="Recomendações de melhoria">
          {p.recommendations.length ? <ul className="list-disc space-y-2 pl-4 text-sm">{p.recommendations.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-ink-400">Sem recomendações automáticas (nenhuma fragilidade com evidência).</p>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Ações do jogador (${events.length})`}>
          {events.length ? (
            <div className="max-h-72 divide-y divide-ink-800 overflow-y-auto text-sm">
              {events.map((e) => (
                <Link key={e.id} to={`/jogo/${pid}?t=${Math.max(0, e.t - 3)}`} className="flex items-center gap-3 py-1.5 hover:text-neon">
                  <span className="w-12 font-mono">{fmtTime(e.t)}</span>
                  <span className="flex-1">{e.lostBy === p.id ? "Perda de bola" : e.label}</span>
                  <KindBadge kind={e.source === "manual" ? "manual" : e.kind} confidence={e.source === "manual" ? undefined : e.confidence} />
                </Link>
              ))}
            </div>
          ) : <p className="text-sm text-ink-400">Sem ações registadas.</p>}
        </Card>
        <Card title="Notas do analista">
          <textarea className={`${inputCls} h-40`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observações qualitativas (guardadas apenas neste browser)…" />
        </Card>
      </div>
    </div>
  );
}

const PCT_KEYS = new Set(["passAccuracy", "highIntensityPct", "attackingHalfPct", "lossesPerTouch"]);

function EvalRow({ k, e }: { k: string; e: EvalEntry }) {
  const val = e.value == null ? "—" : PCT_KEYS.has(k) ? pct(e.value, 0) : String(e.value);
  return (
    <div className="text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-300">{e.label}</span>
        <span className="font-mono">{val}</span>
      </div>
      {e.status === "ok" && e.percentile != null ? (
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
            <div className="h-full rounded-full bg-neon" style={{ width: `${e.percentile * 100}%` }} />
          </div>
          <span className="w-16 text-right text-[11px] text-ink-400">p{Math.round(e.percentile * 100)}</span>
        </div>
      ) : (
        <div className="mt-0.5 text-[11px] text-ink-500">
          {e.status}
          {e.status === "evidência insuficiente" && ` (amostra ${typeof e.sample === "number" ? +e.sample.toFixed(1) : e.sample} < ${e.minSample})`}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-ink-850 p-2">
      <div className="text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}
