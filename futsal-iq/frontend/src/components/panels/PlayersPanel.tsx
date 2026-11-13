import { GitMerge, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { Analysis, Corrections, Project } from "../../lib/types";
import { Button, Card, TeamDot, inputCls } from "../ui";

interface Props {
  project: Project;
  analysis?: Analysis;
  selected: string | null;
  onSelect: (pid: string | null) => void;
  onSaved: (p: Project) => void;
}

const EMPTY: Corrections = { merge: [], names: {}, team: {}, role: {}, hidden: [], swapTeams: false };
const clone = (c: Partial<Corrections>): Corrections => JSON.parse(JSON.stringify({ ...EMPTY, ...c }));

export default function PlayersPanel({ project, analysis, selected, onSelect, onSaved }: Props) {
  const { toast } = useApp();
  const [corr, setCorr] = useState<Corrections>(clone(project.corrections));
  const [checked, setChecked] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setCorr(clone(project.corrections));
    setDirty(false);
  }, [project.corrections]);
  useEffect(() => {
    if (selected) rowRefs.current[selected]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  if (!analysis) return <Card title="Jogadores"><p className="text-sm text-ink-400">Disponível após a análise automática.</p></Card>;

  const upd = (fn: (c: Corrections) => void) => {
    const n = clone(corr);
    fn(n);
    setCorr(n);
    setDirty(true);
  };

  const save = async (andRecompute: boolean) => {
    try {
      const p = await api.putCorrections(project.id, corr);
      onSaved(p);
      if (andRecompute) {
        await api.reanalyze(project.id);
        toast("Correções guardadas. A recalcular a análise…");
      } else toast("Correções guardadas.");
      setDirty(false);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const players = [...analysis.players].sort((a, b) => (a.team + a.name).localeCompare(b.team + b.name));
  const tn = (t: string) => (t === "A" ? analysis.teams.A.name : t === "B" ? analysis.teams.B.name : "Outro");

  return (
    <Card
      title={`Jogadores identificados (${players.length})`}
      subtitle="Identificadores provisórios (sem leitura de números). Clique numa caixa no vídeo para localizar o jogador. Corrija nomes, equipa, função e funda fragmentos do mesmo jogador."
      actions={
        <>
          <Button size="sm" disabled={checked.length < 2} onClick={() => { upd((c) => { for (let i = 1; i < checked.length; i++) c.merge.push([checked[0], checked[i]]); }); setChecked([]); }}>
            <GitMerge size={14} /> Fundir ({checked.length})
          </Button>
          <Button size="sm" onClick={() => upd((c) => { c.swapTeams = !c.swapTeams; })}>Trocar A↔B {corr.swapTeams ? "(ativo)" : ""}</Button>
          <Button size="sm" variant="primary" disabled={!dirty} onClick={() => save(true)}><Save size={14} /> Guardar e recalcular</Button>
        </>
      }
    >
      {corr.merge.length > 0 && (
        <div className="mb-3 text-xs text-ink-400">
          Fusões pendentes/aplicadas: {corr.merge.map((m) => m.join(" + ")).join(" · ")}{" "}
          <button className="text-red-300 hover:underline" onClick={() => upd((c) => { c.merge = []; })}>limpar</button>
        </div>
      )}
      <div className="max-h-[560px] divide-y divide-ink-800 overflow-y-auto pr-1">
        {players.map((p) => (
          <div
            key={p.id}
            ref={(el) => (rowRefs.current[p.id] = el)}
            onClick={() => onSelect(p.id)}
            className={`grid grid-cols-12 items-center gap-2 py-2 text-sm ${selected === p.id ? "bg-neon/5 ring-1 ring-neon/40" : ""} ${corr.hidden.includes(p.id) ? "opacity-40" : ""}`}
          >
            <input type="checkbox" className="col-span-1 justify-self-center" checked={checked.includes(p.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setChecked(e.target.checked ? [...checked, p.id] : checked.filter((x) => x !== p.id))} aria-label={`Selecionar ${p.name}`} />
            <div className="col-span-4 flex items-center gap-2">
              <TeamDot color={p.team === "A" ? analysis.teams.A.color : p.team === "B" ? analysis.teams.B.color : "#777"} />
              <input className={`${inputCls} py-1`} value={corr.names[p.id] ?? ""} placeholder={p.autoName} onChange={(e) => upd((c) => { c.names[p.id] = e.target.value; })} aria-label="Nome" />
            </div>
            <select className={`${inputCls} col-span-2 py-1 text-xs`} value={corr.team[p.id] ?? p.team} onChange={(e) => upd((c) => { c.team[p.id] = e.target.value; })} aria-label="Equipa">
              <option value="A">{tn("A")}</option>
              <option value="B">{tn("B")}</option>
              <option value="other">Outro/árbitro</option>
            </select>
            <select className={`${inputCls} col-span-2 py-1 text-xs`} value={corr.role[p.id] ?? p.role} onChange={(e) => upd((c) => { c.role[p.id] = e.target.value; })} aria-label="Função">
              <option value="field">Jogador de campo</option>
              <option value="gk">Guarda-redes</option>
              <option value="other">Outro</option>
            </select>
            <div className="col-span-2 text-right text-xs text-ink-400">
              {p.stats.minutesVisible?.toFixed(1)} min · {p.tracklets} frag.
            </div>
            <label className="col-span-1 flex items-center justify-center gap-1 text-[11px] text-ink-400" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={corr.hidden.includes(p.id)} onChange={(e) => upd((c) => { c.hidden = e.target.checked ? [...c.hidden, p.id] : c.hidden.filter((x) => x !== p.id); })} />
              ocultar
            </label>
          </div>
        ))}
      </div>
    </Card>
  );
}
