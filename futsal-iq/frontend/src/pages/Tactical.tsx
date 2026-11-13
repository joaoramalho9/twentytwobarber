import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Court } from "../components/Court";
import { Bar, Button, Card, Empty, KindBadge, NeedProject, PageHeader, ProjectPicker, Tabs, TeamDot } from "../components/ui";
import { api, type OverlayFrame } from "../lib/api";
import { fmtTime, num, pct, SET_PIECE_LABEL } from "../lib/format";
import { useApp, useProjectData } from "../lib/store";
import type { Analysis, SetPieceItem, TeamKey } from "../lib/types";

type Tab = "attack" | "defence" | "transitions" | "setpieces" | "replay";

export default function Tactical() {
  const { currentId, setCurrentId } = useApp();
  const { project, analysis, loading } = useProjectData(currentId);
  const [tab, setTab] = useState<Tab>("attack");

  return (
    <div>
      <PageHeader title="Análise tática" subtitle="Sistemas, organização ofensiva/defensiva, transições e bolas paradas — calculados a partir das posições no campo." actions={<ProjectPicker value={currentId} onChange={setCurrentId} />} />
      {!currentId ? (
        <NeedProject />
      ) : loading ? (
        <div className="text-ink-400">A carregar…</div>
      ) : !analysis ? (
        <Empty title="Sem análise automática para este jogo" action={<Link to={`/jogo/${currentId}`}><Button variant="primary">Abrir jogo</Button></Link>}>
          A análise tática requer o processamento do vídeo (e calibração do campo). Para projetos só com YouTube, use a marcação manual de eventos e o relatório.
        </Empty>
      ) : (
        <>
          {analysis.coverage.validPct < 0.05 && (
            <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100">
              Sem calibração válida do campo: os indicadores táticos não podem ser calculados. Faça a calibração no separador «Calibração» do jogo e recalcule a análise.
            </div>
          )}
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "attack", label: "Sistemas e ataque" },
              { id: "defence", label: "Defesa" },
              { id: "transitions", label: "Transições" },
              { id: "setpieces", label: "Bolas paradas e jogadas ensaiadas" },
              { id: "replay", label: "Replay 2D" },
            ]}
          />
          {tab === "attack" && <Attack a={analysis} />}
          {tab === "defence" && <Defence a={analysis} />}
          {tab === "transitions" && <Transitions a={analysis} />}
          {tab === "setpieces" && <SetPieces a={analysis} pid={project!.id} />}
          {tab === "replay" && <Replay a={analysis} pid={project!.id} />}
        </>
      )}
    </div>
  );
}

function TeamHeader({ a, t }: { a: Analysis; t: TeamKey }) {
  return (
    <span className="flex items-center gap-2">
      <TeamDot color={a.teams[t].color} /> {a.teams[t].name}
    </span>
  );
}

function Insights({ a, section, team }: { a: Analysis; section: string; team: TeamKey }) {
  const items = a.insights.filter((i) => i.section === section && i.team === team);
  if (!items.length) return <p className="text-sm text-ink-500">Sem conclusões com evidência suficiente.</p>;
  return (
    <ul className="space-y-2">
      {items.map((i, k) => (
        <li key={k} className="flex items-start gap-2 text-sm">
          <KindBadge kind={i.kind} confidence={i.confidence} title={`Evidência: ${i.evidence}`} />
          <span>
            {i.text} <span className="block text-[11px] text-ink-500">{i.evidence}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Distribution({ data, color, empty }: { data: Record<string, number>; color?: string | null; empty: string }) {
  const entries = Object.entries(data);
  if (!entries.length) return <p className="text-sm text-ink-500">{empty}</p>;
  return (
    <div className="space-y-2">
      {entries.sort((x, y) => y[1] - x[1]).map(([k, v]) => <Bar key={k} label={k} value={v} color={color || "#39ff88"} />)}
    </div>
  );
}

function Attack({ a }: { a: Analysis }) {
  return (
    <div className="space-y-6">
      <PossessionTimeline a={a} />
      <div className="grid gap-6 lg:grid-cols-2">
        {(["A", "B"] as TeamKey[]).map((t) => {
          const s = a.tactics.summary[t];
          const b = a.buildUp[t];
          return (
            <Card key={t} title={<TeamHeader a={a} t={t} />} subtitle={`${s.spells} posses analisadas · ${Math.round(s.possessionAnalysedS)} s`}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Sistema ofensivo (% do tempo de posse)</h4>
              <Distribution data={s.attackSystems} color={a.teams[t].color} empty="Sem posses calibradas suficientes." />
              {s.powerPlayS > 0 && <p className="mt-2 text-sm">Power play: <b>{Math.round(s.powerPlayS)} s</b></p>}
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Kpi label="Trocas posicionais / min" value={num(s.swapsPerMin, 2)} />
                <Kpi label="Superioridade junto à bola" value={pct(s.superiorityPct)} />
                <Kpi label="Construções desde o GR" value={b.count} />
                <Kpi label="… que passaram o meio-campo" value={b.count ? `${b.reachedMidfield}/${b.count}` : "—"} />
              </div>
              <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-ink-400">Conclusões</h4>
              <Insights a={a} section="sistemas" team={t} />
              <div className="mt-2" />
              <Insights a={a} section="ataque" team={t} />
              <RuptureList a={a} t={t} />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function RuptureList({ a, t }: { a: Analysis; t: TeamKey }) {
  const r = a.events.filter((e) => e.type === "rupture" && e.team === t);
  if (!r.length) return null;
  const name = (pid?: string | null) => a.players.find((p) => p.id === pid)?.name || "—";
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Movimentos de rutura detetados ({r.length})</h4>
      <div className="flex flex-wrap gap-1.5">
        {r.slice(0, 20).map((e) => (
          <Link key={e.id} to={`/jogo/${a.projectId}?t=${Math.max(0, e.t - 2)}`} className="rounded border border-ink-700 px-2 py-0.5 font-mono text-xs hover:border-neon">
            {fmtTime(e.t)} · {name(e.player)}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-ink-850 p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-1 font-mono text-lg">{value}</div>
    </div>
  );
}

function PossessionTimeline({ a }: { a: Analysis }) {
  const tl = a.possessionTimeline;
  if (!tl.length) return null;
  const max = Math.max(1, ...tl.map((b) => b.A + b.B));
  const total = a.teams.A.possessionS + a.teams.B.possessionS;
  return (
    <Card title="Posse de bola" subtitle="Tempo de posse estimado por minuto (proximidade jogador–bola). Indicador do tipo «estimativa».">
      <div className="mb-3 flex flex-wrap gap-6 text-sm">
        {(["A", "B"] as TeamKey[]).map((t) => (
          <span key={t} className="flex items-center gap-2"><TeamDot color={a.teams[t].color} /> {a.teams[t].name}: <b className="font-mono">{total ? pct(a.teams[t].possessionS / total) : "—"}</b></span>
        ))}
        <KindBadge kind="estimativa" confidence={Math.min(0.7, a.coverage.ballDetectedPct + 0.2)} title="Depende da taxa de deteção da bola" />
      </div>
      <div className="flex h-28 items-end gap-[2px]">
        {tl.map((b, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end" title={`${fmtTime(b.t)} — A ${b.A.toFixed(0)} s · B ${b.B.toFixed(0)} s`}>
            <div style={{ height: `${(b.B / max) * 100}%`, background: a.teams.B.color || "#5ab4ff" }} className="min-h-0 rounded-t-sm opacity-80" />
            <div style={{ height: `${(b.A / max) * 100}%`, background: a.teams.A.color || "#39ff88" }} className="min-h-0 opacity-90" />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-500">
        <span>{fmtTime(tl[0].t)}</span>
        <span>{fmtTime(tl[tl.length - 1].t)}</span>
      </div>
    </Card>
  );
}

function Defence({ a }: { a: Analysis }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {(["A", "B"] as TeamKey[]).map((t) => {
        const s = a.tactics.summary[t];
        return (
          <Card key={t} title={<TeamHeader a={a} t={t} />} subtitle="Comportamento sem bola (durante a posse adversária)">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Altura do bloco</h4>
            <Distribution data={s.defenceBlocks} color={a.teams[t].color} empty="Sem dados calibrados." />
            <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-ink-400">Tipo de marcação</h4>
            <Distribution data={s.marking} color={a.teams[t].color} empty="Sem dados suficientes." />
            <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-ink-400">Forma defensiva</h4>
            <Distribution data={s.defenceShapes} color={a.teams[t].color} empty="Sem dados suficientes." />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Kpi label="Distância à própria baliza" value={s.blockDepthM != null ? `${s.blockDepthM} m` : "—"} />
              <Kpi label="Coberturas ao pressionante" value={pct(s.coverPct)} />
              <Kpi label="Linhas de passe fechadas" value={pct(s.lanesClosedPct)} />
              <Kpi label="Largura × profundidade" value={s.defWidthM != null ? `${s.defWidthM} × ${s.defDepthM} m` : "—"} />
            </div>
            <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-ink-400">Conclusões</h4>
            <Insights a={a} section="defesa" team={t} />
            <p className="mt-4 text-[11px] text-ink-500">Compensações defensivas não são medidas automaticamente (exigem leitura de intenção) — registe-as como notas no relatório.</p>
          </Card>
        );
      })}
    </div>
  );
}

function Transitions({ a }: { a: Analysis }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {(["A", "B"] as TeamKey[]).map((t) => {
        const s = a.transitions[t];
        const items = a.events.filter((e) => (e.type === "counter" || e.type === "transition") && e.team === t);
        return (
          <Card key={t} title={<TeamHeader a={a} t={t} />}>
            <div className="grid grid-cols-2 gap-3">
              <Kpi label="Transições ofensivas" value={s.offensive} />
              <Kpi label="Contra-ataques" value={s.counter} />
              <Kpi label="Pressão imediata pós-perda" value={s.defensive ? `${s.counterPress}/${s.defensive}` : "—"} />
              <Kpi label="Recuperação ≤ 5 s após perda" value={s.defensive ? `${s.regained5s}/${s.defensive}` : "—"} />
            </div>
            <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-ink-400">Conclusões</h4>
            <Insights a={a} section="transições" team={t} />
            {items.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {items.slice(0, 30).map((e) => (
                  <Link key={e.id} to={`/jogo/${a.projectId}?t=${Math.max(0, e.t - 3)}`} className={`rounded border px-2 py-0.5 font-mono text-xs hover:border-neon ${e.type === "counter" ? "border-neon/50 text-neon" : "border-ink-700"}`}>
                    {fmtTime(e.t)}
                  </Link>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function SetPieces({ a, pid }: { a: Analysis; pid: string }) {
  const [sel, setSel] = useState<SetPieceItem | null>(a.setPieces.items[0] || null);
  const name = (p?: string | null) => a.players.find((x) => x.id === p)?.name || "—";
  const items = a.setPieces.items;
  return (
    <div className="space-y-6">
      <Card title="Padrões repetidos (jogadas ensaiadas)" subtitle={a.setPieces.method}>
        {a.setPieces.patterns.length === 0 ? (
          <p className="text-sm text-ink-400">Nenhum padrão repetido detetado. Uma bola parada só é classificada como ensaiada quando o movimento se repete noutra execução.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {a.setPieces.patterns.map((p) => (
              <div key={p.id} className="rounded-lg border border-neon/30 bg-neon/5 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <b>{p.id} · {SET_PIECE_LABEL[p.type] || p.type}</b>
                  <KindBadge kind="interpretação" confidence={p.confidence} />
                </div>
                <div className="mt-1 flex items-center gap-2 text-ink-300"><TeamDot color={a.teams[p.team]?.color} /> {a.teams[p.team]?.name} · {p.occurrences.length} execuções · dist. média {p.meanDistanceM} m</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.times.map((t, i) => (
                    <button key={i} onClick={() => setSel(items.find((it) => it.eventId === p.occurrences[i]) || null)} className="rounded border border-ink-600 px-2 py-0.5 font-mono text-xs hover:border-neon">
                      {fmtTime(t)} → {p.results[i]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card title={`Bolas paradas detetadas (${items.length})`}>
          {items.length === 0 ? (
            <p className="text-sm text-ink-400">Nenhuma bola parada classificada automaticamente (requer calibração e deteção da bola no reinício). Pode marcá-las manualmente no separador Eventos.</p>
          ) : (
            <div className="max-h-[520px] divide-y divide-ink-800 overflow-y-auto">
              {items.map((it) => (
                <button key={it.eventId} onClick={() => setSel(it)} className={`flex w-full items-center gap-3 py-2 text-left text-sm ${sel?.eventId === it.eventId ? "text-neon" : ""}`}>
                  <span className="w-12 font-mono">{fmtTime(it.t)}</span>
                  <span className="flex-1">{SET_PIECE_LABEL[it.type] || it.label}</span>
                  {it.team && <TeamDot color={a.teams[it.team].color} />}
                  {it.rehearsed && <span className="rounded-full border border-neon/50 px-2 text-[10px] uppercase text-neon">ensaiada {it.patternId}</span>}
                  <span className="text-xs text-ink-400">{it.result}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
        {sel && (
          <Card
            title={`${SET_PIECE_LABEL[sel.type] || sel.label} · ${fmtTime(sel.t)}`}
            actions={<Link to={`/jogo/${pid}?t=${Math.max(0, sel.t - 3)}`}><Button size="sm">Ver no vídeo</Button></Link>}
          >
            <div className="mb-3 flex flex-wrap gap-2 text-sm">
              <KindBadge kind="deteção" confidence={sel.detectionConfidence} title="Confiança da classificação do lance" />
              {sel.rehearsed ? <KindBadge kind="interpretação" confidence={sel.rehearsedConfidence} title={`Padrão ${sel.patternId}: semelhança ${sel.patternSimilarityM} m`} /> : <span className="text-xs text-ink-400">Sem padrão repetido (não classificada como ensaiada)</span>}
            </div>
            {sel.movements ? (
              <>
                <p className="mb-2 text-xs text-ink-400">Posições iniciais (●) e movimentos nos 6 s seguintes, relativos à bola (★), com ataque para a direita e a bola normalizada para o lado de cima.</p>
                <RelativeDiagram item={sel} color={sel.team ? a.teams[sel.team].color : null} name={name} />
              </>
            ) : (
              <p className="text-sm text-ink-400">Sem posições suficientes para reconstruir o movimento.</p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-400">Equipa</dt><dd>{sel.team ? a.teams[sel.team].name : "—"}</dd>
              <dt className="text-ink-400">Executante</dt><dd>{name(sel.taker)}</dd>
              <dt className="text-ink-400">Sequência de passes</dt><dd>{sel.passes.length ? sel.passes.map((p) => `${name(p.from)} → ${name(p.to)}`).join(", ") : "não detetada"}</dd>
              <dt className="text-ink-400">Finalização</dt><dd>{sel.finish ? `${fmtTime(sel.finish.t)} · ${name(sel.finish.player)}${sel.finish.onTarget ? " (enquadrado)" : ""}` : "sem remate detetado"}</dd>
              <dt className="text-ink-400">Resultado</dt><dd>{sel.result}</dd>
            </dl>
          </Card>
        )}
      </div>
    </div>
  );
}

function RelativeDiagram({ item, color, name }: { item: SetPieceItem; color: string | null; name: (p?: string | null) => string }) {
  // relative coords: x' = depth towards goal from ball, y' = lateral from ball (ball side = top). Draw in a 24x20 box.
  const pts = Object.entries(item.movements || {});
  const all = pts.flatMap(([, m]) => m.map((s) => [s[1], s[2]]));
  const minX = Math.min(-2, ...all.map((p) => p[0])) - 1;
  const maxX = Math.max(2, ...all.map((p) => p[0])) + 1;
  const minY = Math.min(-2, ...all.map((p) => p[1])) - 1;
  const maxY = Math.max(2, ...all.map((p) => p[1])) + 1;
  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="w-full rounded-lg bg-[#0b1a12]">
      <defs>
        <marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill={color || "#39ff88"} /></marker>
      </defs>
      {pts.map(([pid, m]) => (
        <g key={pid}>
          <polyline points={m.map((s) => `${s[1]},${s[2]}`).join(" ")} fill="none" stroke={color || "#39ff88"} strokeWidth={0.15} markerEnd="url(#arr)" opacity={0.9} />
          <circle cx={m[0][1]} cy={m[0][2]} r={0.45} fill={color || "#39ff88"} />
          <text x={m[0][1] + 0.6} y={m[0][2] - 0.5} fontSize={0.9} fill="#fff">{name(pid).replace("Jogador ", "")}</text>
        </g>
      ))}
      <text x={0} y={0} fontSize={1.4} textAnchor="middle" dominantBaseline="middle" fill="#fff">★</text>
    </svg>
  );
}

function Replay({ a, pid }: { a: Analysis; pid: string }) {
  const { online } = useApp();
  const [t, setT] = useState(a.coverage.analysedFromS);
  const [playing, setPlaying] = useState(false);
  const [buf, setBuf] = useState<{ from: number; to: number; frames: OverlayFrame[] } | null>(null);
  const loading = useRef(false);
  const end = a.coverage.analysedToS;

  useEffect(() => {
    if (!online || loading.current) return;
    if (buf && t >= buf.from && t <= buf.to - 2) return;
    loading.current = true;
    api.overlay(pid, t, t + 60).then((r) => setBuf({ from: t, to: t + 60, frames: r.frames })).catch(() => {}).finally(() => (loading.current = false));
  }, [t, buf, pid, online]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((x) => (x + 0.2 > end ? end : x + 0.2)), 200);
    return () => clearInterval(id);
  }, [playing, end]);

  if (!online) return <Empty title="Motor de análise desligado">O replay 2D lê as posições frame a frame do servidor local.</Empty>;
  const fr = buf?.frames.reduce<OverlayFrame | null>((b, f) => (!b || Math.abs(f.t - t) < Math.abs(b.t - t) ? f : b), null);
  const near = fr && Math.abs(fr.t - t) < 0.5 ? fr : null;
  return (
    <Card title="Replay 2D (posições no campo)" subtitle="Posições projetadas pela calibração. Só frames com calibração aparecem.">
      <Court L={a.court.length} W={a.court.width}>
        {near?.persons.filter((p) => p.xy && p.pid).map((p) => (
          <g key={p.tid}>
            <circle cx={p.xy![0]} cy={p.xy![1]} r={0.55} fill={p.team === "A" ? a.teams.A.color || "#39ff88" : p.team === "B" ? a.teams.B.color || "#5ab4ff" : "#888"} stroke="#000" strokeWidth={0.08} />
            <text x={p.xy![0]} y={p.xy![1] - 0.8} fontSize={0.7} textAnchor="middle" fill="#fff">{(p.name || "").replace("Jogador ", "")}</text>
          </g>
        ))}
        {near?.ball?.xy && <circle cx={near.ball.xy[0]} cy={near.ball.xy[1]} r={0.3} fill="#fff" />}
      </Court>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={14} /> : <Play size={14} />}</Button>
        <input type="range" className="flex-1" min={a.coverage.analysedFromS} max={end} step={0.2} value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Tempo" />
        <span className="w-14 font-mono text-sm">{fmtTime(t)}</span>
        <Link to={`/jogo/${pid}?t=${t}`}><Button size="sm">Ver no vídeo</Button></Link>
      </div>
      {!near && <p className="mt-2 text-xs text-ink-500">Sem posições calibradas neste instante.</p>}
    </Card>
  );
}
