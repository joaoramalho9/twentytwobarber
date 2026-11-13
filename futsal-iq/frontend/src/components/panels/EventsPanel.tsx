import { Check, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { mergedEvents, newManualEvent, TAGS, TYPE_LABEL, type MergedEvent } from "../../lib/events";
import { fmtTime, parseTime } from "../../lib/format";
import type { AEvent, Analysis, Project, TeamKey, UserData } from "../../lib/types";
import { Button, Card, KindBadge, StatusBadge, TeamDot, inputCls, inputSm } from "../ui";

interface Props {
  project: Project;
  analysis?: Analysis;
  user: UserData;
  setUser: (fn: (u: UserData) => UserData) => void;
  getTime: () => number;
  seek: (t: number) => void;
  active: boolean;
}

export default function EventsPanel({ project, analysis, user, setUser, getTime, seek, active }: Props) {
  const [team, setTeam] = useState<TeamKey | "">("A");
  const [player, setPlayer] = useState<string>("");
  const [fType, setFType] = useState("");
  const [fSource, setFSource] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [hidePasses, setHidePasses] = useState(true);
  const [minConf, setMinConf] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);

  const players = (analysis?.players || []).filter((p) => p.team !== "other");
  const nameOf = (pid?: string | null) => (pid ? analysis?.players.find((p) => p.id === pid)?.name || pid : "");
  const teamName = (t?: string | null) => (t === "A" ? project.teamA.name : t === "B" ? project.teamB.name : "—");
  const color = (t?: string | null) => (t === "A" ? analysis?.teams.A.color || project.teamA.color : t === "B" ? analysis?.teams.B.color || project.teamB.color : null);

  const tag = (type: string) => {
    const e = newManualEvent(type, Math.round(getTime() * 10) / 10, (team || null) as TeamKey | null, player || null);
    setUser((u) => ({ ...u, manualEvents: [...u.manualEvents, e] }));
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = TAGS.find((x) => x.key === e.key.toLowerCase());
      if (t) {
        e.preventDefault();
        tag(t.type);
      }
      if (e.key === "1") setTeam("A");
      if (e.key === "2") setTeam("B");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const all = useMemo(() => mergedEvents(analysis, user), [analysis, user]);
  const list = all.filter(
    (e) =>
      (!fType || e.type === fType) &&
      (!fSource || e.source === fSource) &&
      (!fStatus || e.status === fStatus) &&
      (!hidePasses || e.type !== "pass" || fType === "pass") &&
      e.confidence >= minConf,
  );
  const types = Array.from(new Set(all.map((e) => e.type)));

  const review = (id: string, st: "confirmed" | "rejected" | "pending") => setUser((u) => ({ ...u, review: { ...u.review, [id]: st } }));
  const removeManual = (id: string) => setUser((u) => ({ ...u, manualEvents: u.manualEvents.filter((e) => e.id !== id) }));
  const saveEdit = (e: MergedEvent, patch: Partial<AEvent>) => {
    if (e.source === "manual") setUser((u) => ({ ...u, manualEvents: u.manualEvents.map((m) => (m.id === e.id ? { ...m, ...patch } : m)) }));
    else setUser((u) => ({ ...u, eventEdits: { ...u.eventEdits, [e.id]: { ...(u.eventEdits[e.id] || {}), ...patch } }, review: { ...u.review, [e.id]: "confirmed" } }));
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <Card title="Marcação manual" subtitle="Clique (ou use a tecla) para registar um evento no instante atual do vídeo. Eventos manuais contam como confirmados.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-400">Equipa:</span>
          {(["A", "B", ""] as const).map((t) => (
            <button key={t || "none"} onClick={() => setTeam(t)} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs ${team === t ? "border-neon text-neon" : "border-ink-600 text-ink-300"}`}>
              {t && <TeamDot color={color(t)} />} {t ? teamName(t) : "Nenhuma"} {t && <kbd>{t === "A" ? 1 : 2}</kbd>}
            </button>
          ))}
          {players.length > 0 && (
            <select className={`${inputCls} ml-2 max-w-[200px] py-1 text-xs`} value={player} onChange={(e) => setPlayer(e.target.value)} aria-label="Jogador">
              <option value="">Jogador (opcional)</option>
              {players.filter((p) => !team || p.team === team).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
          {TAGS.map((t) => (
            <button key={t.type} onClick={() => tag(t.type)} className="flex items-center justify-between rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-left text-xs hover:border-neon/60 hover:text-neon">
              {t.label} <kbd>{t.key.toUpperCase()}</kbd>
            </button>
          ))}
        </div>
      </Card>

      <Card title={`Eventos (${list.length}/${all.length})`} subtitle="Automáticos ficam «por confirmar» até serem revistos. Rejeitados não entram em clips nem no relatório.">
        <div className="mb-3 flex flex-wrap gap-2">
          <select className={`${inputSm}`} value={fType} onChange={(e) => setFType(e.target.value)} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
          </select>
          <select className={`${inputSm}`} value={fSource} onChange={(e) => setFSource(e.target.value)} aria-label="Origem">
            <option value="">Automáticos + manuais</option>
            <option value="auto">Automáticos</option>
            <option value="manual">Manuais</option>
          </select>
          <select className={`${inputSm}`} value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Estado">
            <option value="">Todos os estados</option>
            <option value="pending">Por confirmar</option>
            <option value="confirmed">Confirmados</option>
            <option value="rejected">Rejeitados</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-ink-300">
            Confiança ≥ {Math.round(minConf * 100)}%
            <input type="range" min={0} max={0.9} step={0.05} value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-1 text-xs text-ink-300">
            <input type="checkbox" checked={hidePasses} onChange={(e) => setHidePasses(e.target.checked)} /> ocultar passes
          </label>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-ink-400">Sem eventos. {analysis ? "" : "Execute a análise automática ou marque eventos manualmente."}</p>
        ) : (
          <div className="max-h-[560px] divide-y divide-ink-800 overflow-y-auto pr-1">
            {list.map((e) =>
              editing === e.id ? (
                <EditRow key={e.id} e={e} players={players} teamName={teamName} onCancel={() => setEditing(null)} onSave={(patch) => saveEdit(e, patch)} />
              ) : (
                <div key={e.id} className={`flex flex-wrap items-center gap-2 py-2 text-sm ${e.status === "rejected" ? "opacity-45" : ""}`}>
                  <button className="w-14 shrink-0 font-mono text-neon hover:underline" onClick={() => seek(Math.max(0, e.t - 2))} title="Ver no vídeo (2 s antes)">
                    {fmtTime(e.t)}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.label}</span>
                      {e.team && <span className="flex items-center gap-1 text-xs text-ink-300"><TeamDot color={color(e.team)} /> {teamName(e.team)}</span>}
                      {e.player && <span className="text-xs text-ink-300">· {nameOf(e.player)}{e.to ? ` → ${nameOf(e.to)}` : ""}</span>}
                    </div>
                    {(e.method || e.note) && <div className="mt-0.5 truncate text-[11px] text-ink-500" title={e.method}>{e.note || e.method}</div>}
                  </div>
                  <KindBadge kind={e.source === "manual" ? "manual" : e.kind} confidence={e.source === "manual" ? undefined : e.confidence} title={e.method} />
                  <StatusBadge status={e.status} />
                  <div className="flex gap-0.5">
                    {e.source === "auto" && (
                      <>
                        <Button size="sm" variant="ghost" aria-label="Confirmar" title="Confirmar" onClick={() => review(e.id, e.status === "confirmed" ? "pending" : "confirmed")}><Check size={14} /></Button>
                        <Button size="sm" variant="ghost" aria-label="Rejeitar" title="Rejeitar" onClick={() => review(e.id, e.status === "rejected" ? "pending" : "rejected")}><X size={14} /></Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" aria-label="Editar" title="Editar" onClick={() => setEditing(e.id)}><Pencil size={14} /></Button>
                    {e.source === "manual" && <Button size="sm" variant="ghost" aria-label="Apagar" title="Apagar" onClick={() => removeManual(e.id)}><Trash2 size={14} /></Button>}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function EditRow({ e, players, teamName, onSave, onCancel }: { e: MergedEvent; players: { id: string; name: string; team: string }[]; teamName: (t?: string | null) => string; onSave: (p: Partial<AEvent>) => void; onCancel: () => void }) {
  const [type, setType] = useState(e.type);
  const [t, setT] = useState(fmtTime(e.t));
  const [team, setTeam] = useState(e.team || "");
  const [player, setPlayer] = useState(e.player || "");
  const [note, setNote] = useState(e.note || "");
  const types = Array.from(new Set([e.type, ...TAGS.map((x) => x.type), "free_kick", "kickoff", "pass", "penalty"]));
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-6">
      <select className={inputCls} value={type} onChange={(x) => setType(x.target.value)} aria-label="Tipo">
        {types.map((k) => <option key={k} value={k}>{TYPE_LABEL[k] || k}</option>)}
      </select>
      <input className={inputCls} value={t} onChange={(x) => setT(x.target.value)} aria-label="Tempo (m:ss)" />
      <select className={inputCls} value={team} onChange={(x) => setTeam(x.target.value)} aria-label="Equipa">
        <option value="">—</option>
        <option value="A">{teamName("A")}</option>
        <option value="B">{teamName("B")}</option>
      </select>
      <select className={inputCls} value={player} onChange={(x) => setPlayer(x.target.value)} aria-label="Jogador">
        <option value="">—</option>
        {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input className={inputCls} value={note} placeholder="Nota" onChange={(x) => setNote(x.target.value)} aria-label="Nota" />
      <div className="flex gap-1">
        <Button size="sm" variant="primary" onClick={() => onSave({ type, label: TYPE_LABEL[type] || e.label, t: parseTime(t) ?? e.t, team: (team || null) as TeamKey | null, player: player || null, note })}>Guardar</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}
