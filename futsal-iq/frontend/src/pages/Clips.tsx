import { Download, Pencil, Play, Plus, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { VideoPlayer, type PlayerHandle } from "../components/VideoPlayer";
import { Button, Card, Field, NeedProject, PageHeader, ProjectPicker, TeamDot, inputCls, inputSm } from "../components/ui";
import { api, downloadPost } from "../lib/api";
import { autoClips, CLIP_CATEGORIES, mergedEvents } from "../lib/events";
import { fmtTime, parseTime, uid, ytId } from "../lib/format";
import { useApp, useProjectData } from "../lib/store";
import type { Clip, TeamKey } from "../lib/types";

export default function Clips() {
  const { currentId, setCurrentId, settings, toast, online } = useApp();
  const { project, analysis, user, setUser } = useProjectData(currentId);
  const player = useRef<PlayerHandle>(null);
  const [cat, setCat] = useState("");
  const [team, setTeam] = useState("");
  const [playing, setPlaying] = useState<Clip | null>(null);
  const [edit, setEdit] = useState<Clip | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [includePending, setIncludePending] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const nameOf = (pid?: string | null) => (pid ? analysis?.players.find((p) => p.id === pid)?.name || null : null);
  const events = useMemo(() => mergedEvents(analysis, user), [analysis, user]);
  const clips = user.clips.filter((c) => (!cat || c.category === cat) && (!team || c.team === team)).sort((a, b) => a.start - b.start);
  const hasLocal = !!project?.video && !project.localOnly && online;
  const yid = project?.youtubeId || ytId(project?.youtubeUrl);

  // stop at the end of the clip being played
  useEffect(() => {
    if (playing && now >= playing.end) {
      player.current?.pause();
      setPlaying(null);
    }
  }, [now, playing]);

  if (!currentId || !project) return <div><PageHeader title="Biblioteca de clips" actions={<ProjectPicker value={currentId} onChange={setCurrentId} />} /><NeedProject /></div>;

  const generate = () => {
    const add = autoClips(events, analysis, user.clips, settings.clipPadBefore, settings.clipPadAfter, includePending, nameOf);
    if (!add.length) return toast("Não há novos eventos para gerar clips.");
    setUser((u) => ({ ...u, clips: [...u.clips, ...add] }));
    toast(`${add.length} clips criados a partir dos eventos.`);
  };

  const play = (c: Clip) => {
    setPlaying(c);
    player.current?.seek(c.start);
    setTimeout(() => player.current?.play(), 250);
  };

  const saveClip = (c: Clip) => {
    if (c.end <= c.start) return toast("O fim tem de ser posterior ao início.", "error");
    setUser((u) => ({ ...u, clips: u.clips.some((x) => x.id === c.id) ? u.clips.map((x) => (x.id === c.id ? c : x)) : [...u.clips, c] }));
    setEdit(null);
  };

  const exportOne = async (c: Clip) => {
    setBusy(c.id);
    try {
      await downloadPost(`/api/projects/${project.id}/clips/export`, { start: c.start, end: c.end, title: c.title }, `${c.title.replace(/[^\w-]+/g, "_")}.mp4`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };
  const exportBatch = async () => {
    const sel = user.clips.filter((c) => checked.includes(c.id));
    setBusy("batch");
    try {
      await downloadPost(`/api/projects/${project.id}/clips/export-batch`, { clips: sel.map((c) => ({ start: c.start, end: c.end, title: c.title })) }, "clips_futsal_iq.zip");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Biblioteca de clips"
        subtitle={`${user.clips.length} clips · ${project.name}`}
        actions={<ProjectPicker value={currentId} onChange={setCurrentId} />}
      />
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-3 2xl:sticky 2xl:top-6 2xl:self-start">
          <VideoPlayer ref={player} src={hasLocal ? `${api.videoUrl(project.id)}?v=${encodeURIComponent(project.video!.file)}` : null} youtubeId={hasLocal ? null : yid} onTime={setNow} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
            <span className="font-mono text-white">{fmtTime(now)}</span>
            {playing && <span className="text-neon">A reproduzir: {playing.title} ({fmtTime(playing.start)}–{fmtTime(playing.end)})</span>}
            <span className="flex-1" />
            <Button size="sm" onClick={() => setEdit({ id: uid("c"), title: "Novo clip", category: "Outros", start: Math.max(0, now - settings.clipPadBefore), end: now + settings.clipPadAfter, team: null, player: null, description: "", source: "manual", createdAt: Date.now() })}>
              <Plus size={14} /> Clip no instante atual
            </Button>
          </div>
          {!hasLocal && (
            <p className="text-xs text-amber-200">
              {yid ? "Vídeo apenas no YouTube: os clips são reproduzidos por timestamps no leitor oficial; a exportação MP4 requer o ficheiro do vídeo." : "Sem vídeo disponível."}
            </p>
          )}
          {edit && <ClipEditor clip={edit} onCancel={() => setEdit(null)} onSave={saveClip} teams={{ A: project.teamA.name, B: project.teamB.name }} players={(analysis?.players || []).filter((p) => p.team !== "other")} now={now} />}
        </div>

        <div className="space-y-4">
          <Card
            title="Gerar automaticamente"
            subtitle={`A partir dos eventos (automáticos e manuais), com ${settings.clipPadBefore} s antes e ${settings.clipPadAfter} s depois (ajustável em Definições).`}
            actions={<Button variant="primary" size="sm" onClick={generate}><Wand2 size={14} /> Gerar clips</Button>}
          >
            <label className="flex items-center gap-2 text-sm text-ink-300">
              <input type="checkbox" checked={includePending} onChange={(e) => setIncludePending(e.target.checked)} /> incluir eventos automáticos ainda por confirmar (os rejeitados nunca são incluídos)
            </label>
            {!analysis && !user.manualEvents.length && <p className="mt-2 text-xs text-ink-500">Sem eventos ainda: execute a análise ou marque eventos em <Link className="underline" to={`/jogo/${project.id}`}>Eventos</Link>.</p>}
          </Card>

          <Card
            title="Clips"
            actions={
              <>
                <select className={`${inputSm}`} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
                  <option value="">Todas as categorias</option>
                  {CLIP_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <select className={`${inputSm}`} value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Equipa">
                  <option value="">Ambas</option>
                  <option value="A">{project.teamA.name}</option>
                  <option value="B">{project.teamB.name}</option>
                </select>
                <Button size="sm" disabled={!checked.length || !hasLocal || busy === "batch"} onClick={exportBatch}>
                  <Download size={14} /> {busy === "batch" ? "A exportar…" : `Exportar ${checked.length || ""} (ZIP)`}
                </Button>
              </>
            }
          >
            {clips.length === 0 ? (
              <p className="text-sm text-ink-400">Sem clips nesta seleção.</p>
            ) : (
              <div className="divide-y divide-ink-800">
                {clips.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <input type="checkbox" checked={checked.includes(c.id)} onChange={(e) => setChecked(e.target.checked ? [...checked, c.id] : checked.filter((x) => x !== c.id))} aria-label={`Selecionar ${c.title}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.title}</span>
                        <span className="rounded-full border border-ink-600 px-2 text-[10px] uppercase tracking-wide text-ink-300">{c.category}</span>
                        {c.team && <span className="flex items-center gap-1 text-xs text-ink-400"><TeamDot color={c.team === "A" ? analysis?.teams.A.color || project.teamA.color : analysis?.teams.B.color || project.teamB.color} />{c.team === "A" ? project.teamA.name : project.teamB.name}</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-500">
                        <span className="font-mono text-ink-300">{fmtTime(c.start)} – {fmtTime(c.end)}</span> · {(c.end - c.start).toFixed(0)} s{nameOf(c.player) ? ` · ${nameOf(c.player)}` : ""}{c.description ? ` · ${c.description}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      <Button size="sm" variant="ghost" onClick={() => play(c)} aria-label="Reproduzir" title="Reproduzir"><Play size={14} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(c)} aria-label="Editar" title="Editar"><Pencil size={14} /></Button>
                      <Button size="sm" variant="ghost" disabled={!hasLocal || busy === c.id} onClick={() => exportOne(c)} aria-label="Exportar MP4" title={hasLocal ? "Exportar MP4 (FFmpeg)" : "Requer ficheiro de vídeo"}>
                        <Download size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setUser((u) => ({ ...u, clips: u.clips.filter((x) => x.id !== c.id) }))} aria-label="Apagar" title="Apagar"><Trash2 size={14} /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ClipEditor({ clip, onSave, onCancel, teams, players, now }: { clip: Clip; onSave: (c: Clip) => void; onCancel: () => void; teams: Record<TeamKey, string>; players: { id: string; name: string; team: string }[]; now: number }) {
  const [c, setC] = useState(clip);
  const [s, setS] = useState(fmtTime(clip.start));
  const [e, setE] = useState(fmtTime(clip.end));
  useEffect(() => {
    setC(clip);
    setS(fmtTime(clip.start));
    setE(fmtTime(clip.end));
  }, [clip]);
  return (
    <Card title="Editar clip">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Título"><input className={inputCls} value={c.title} onChange={(x) => setC({ ...c, title: x.target.value })} /></Field>
        <Field label="Categoria">
          <select className={inputCls} value={c.category} onChange={(x) => setC({ ...c, category: x.target.value })}>
            {CLIP_CATEGORIES.map((k) => <option key={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Início (m:ss)">
          <div className="flex gap-1"><input className={inputCls} value={s} onChange={(x) => setS(x.target.value)} /><Button size="sm" onClick={() => setS(fmtTime(now))} title="Usar instante atual">⏱</Button></div>
        </Field>
        <Field label="Fim (m:ss)">
          <div className="flex gap-1"><input className={inputCls} value={e} onChange={(x) => setE(x.target.value)} /><Button size="sm" onClick={() => setE(fmtTime(now))} title="Usar instante atual">⏱</Button></div>
        </Field>
        <Field label="Equipa">
          <select className={inputCls} value={c.team || ""} onChange={(x) => setC({ ...c, team: (x.target.value || null) as TeamKey | null })}>
            <option value="">—</option>
            <option value="A">{teams.A}</option>
            <option value="B">{teams.B}</option>
          </select>
        </Field>
        <Field label="Jogador">
          <select className={inputCls} value={c.player || ""} onChange={(x) => setC({ ...c, player: x.target.value || null })}>
            <option value="">—</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Descrição"><textarea className={`${inputCls} mt-1 h-20`} value={c.description} onChange={(x) => setC({ ...c, description: x.target.value })} /></Field>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={() => onSave({ ...c, start: parseTime(s) ?? c.start, end: parseTime(e) ?? c.end })}>Guardar clip</Button>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}
