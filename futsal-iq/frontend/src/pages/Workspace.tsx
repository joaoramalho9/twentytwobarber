import { ExternalLink, FileText, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CalibrationPanel from "../components/panels/CalibrationPanel";
import EventsPanel from "../components/panels/EventsPanel";
import PlayersPanel from "../components/panels/PlayersPanel";
import ProcessingPanel from "../components/panels/ProcessingPanel";
import { VideoPlayer, type PlayerHandle } from "../components/VideoPlayer";
import { Button, Card, Empty, Field, PageHeader, Tabs, TeamDot, inputCls } from "../components/ui";
import { api, type OverlayFrame } from "../lib/api";
import { db } from "../lib/db";
import { fmtTime, ytId } from "../lib/format";
import { useApp, useProjectData } from "../lib/store";
import type { Project } from "../lib/types";

type Tab = "proc" | "calib" | "events" | "players" | "project";

export default function Workspace() {
  const { id } = useParams();
  const nav = useNavigate();
  const { setCurrentId, settings, toast, refreshProjects, online } = useApp();
  const { project, setProject, analysis, user, setUser, loading, reload } = useProjectData(id);
  const player = useRef<PlayerHandle>(null);
  const [tab, setTab] = useState<Tab>("proc");
  const [t, setT] = useState(0);
  const [overlayOn, setOverlayOn] = useState(settings.showOverlayByDefault);
  const [overlay, setOverlay] = useState<{ from: number; to: number; frames: OverlayFrame[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const loadingOverlay = useRef(false);

  useEffect(() => {
    if (id) setCurrentId(id);
  }, [id, setCurrentId]);

  // seek from ?t= query (links from other pages)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("t");
    if (q && project) setTimeout(() => player.current?.seek(Number(q)), 600);
  }, [project]);

  // overlay window fetch
  useEffect(() => {
    if (!overlayOn || !analysis || !project?.video || !online) return;
    if (overlay && t >= overlay.from && t <= overlay.to - 3) return;
    if (loadingOverlay.current) return;
    loadingOverlay.current = true;
    const from = Math.max(0, t - 2);
    api
      .overlay(project.id, from, from + 30)
      .then((r) => setOverlay({ from, to: from + 30, frames: r.frames }))
      .catch(() => setOverlay(null))
      .finally(() => (loadingOverlay.current = false));
  }, [t, overlayOn, analysis, project, online, overlay]);

  useEffect(() => setOverlay(null), [analysis?.generatedAt]);

  const onChanged = useCallback(async () => {
    await reload();
    await refreshProjects();
  }, [reload, refreshProjects]);

  if (loading && !project) return <div className="text-ink-400">A carregar…</div>;
  if (!project) return <Empty title="Projeto não encontrado" action={<Link to="/"><Button>Voltar ao dashboard</Button></Link>}>Pode ter sido apagado ou o motor de análise está desligado.</Empty>;

  const src = project.video && !project.localOnly && online ? `${api.videoUrl(project.id)}?v=${encodeURIComponent(project.video!.file)}` : null;
  const yid = project.youtubeId || ytId(project.youtubeUrl);
  const colors = { A: analysis?.teams.A.color || project.teamA.color || "#39ff88", B: analysis?.teams.B.color || project.teamB.color || "#5ab4ff", other: "#9aa3ad", "?": "#9aa3ad" };

  const getTime = () => player.current?.currentTime() || 0;
  const seek = (s: number) => player.current?.seek(s);
  const updateProject = async (p: Project) => {
    setProject(p);
    await db.putProject(p);
  };

  return (
    <div>
      <PageHeader
        title={project.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <TeamDot color={colors.A} /> {project.teamA.name} <span className="text-ink-600">vs</span> <TeamDot color={colors.B} /> {project.teamB.name}
            {project.competition && <span>· {project.competition}</span>}
            {project.date && <span>· {project.date}</span>}
          </span>
        }
        actions={
          <>
            <Link to="/tatica"><Button size="sm">Análise tática</Button></Link>
            <Link to="/scouting"><Button size="sm">Scouting</Button></Link>
            <Link to="/clips"><Button size="sm">Clips</Button></Link>
            <Link to="/relatorio"><Button size="sm" variant="primary"><FileText size={14} /> Relatório</Button></Link>
          </>
        }
      />
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-3 2xl:sticky 2xl:top-6 2xl:self-start">
          <VideoPlayer
            ref={player}
            src={src}
            youtubeId={src ? null : yid}
            onTime={setT}
            overlay={overlayOn ? overlay?.frames : null}
            colors={colors}
            selectedPid={selected}
            videoSize={project.video ? { width: project.video.info.width, height: project.video.info.height } : undefined}
            onPersonClick={(p) => {
              if (p.pid) {
                setSelected(p.pid);
                setTab("players");
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
            <span className="font-mono text-white">{fmtTime(t)}</span>
            <div className="flex flex-wrap items-center gap-3">
              {src && analysis && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={overlayOn} onChange={(e) => setOverlayOn(e.target.checked)} /> Mostrar deteções (caixas, IDs, bola)
                </label>
              )}
              {!src && yid && <span>Leitor oficial do YouTube · marcação manual</span>}
              {project.video && !online && <span className="text-amber-300">Motor desligado: vídeo local indisponível</span>}
              {yid && (
                <a className="inline-flex items-center gap-1 hover:text-neon" href={`https://www.youtube.com/watch?v=${yid}&t=${Math.floor(t)}s`} target="_blank" rel="noreferrer">
                  YouTube <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "proc", label: "Processamento" },
              { id: "calib", label: `Calibração${project.calibrations.length ? ` (${project.calibrations.length})` : ""}` },
              { id: "events", label: "Eventos" },
              { id: "players", label: "Jogadores" },
              { id: "project", label: "Projeto" },
            ]}
          />
          {tab === "proc" && <ProcessingPanel project={project} analysis={analysis} onChanged={onChanged} />}
          {tab === "calib" && <CalibrationPanel project={project} getTime={getTime} seek={seek} onSaved={updateProject} />}
          {tab === "events" && <EventsPanel project={project} analysis={analysis} user={user} setUser={setUser} getTime={getTime} seek={seek} active={tab === "events"} />}
          {tab === "players" && <PlayersPanel project={project} analysis={analysis} selected={selected} onSelect={setSelected} onSaved={updateProject} />}
          {tab === "project" && (
            <ProjectPanel
              project={project}
              getTime={getTime}
              onSaved={updateProject}
              onDelete={async () => {
                if (!confirm("Apagar este projeto, o vídeo e toda a análise? Esta ação não pode ser desfeita.")) return;
                try {
                  if (!project.localOnly) await api.deleteProject(project.id);
                  await db.deleteProject(project.id);
                  setCurrentId(null);
                  await refreshProjects();
                  toast("Projeto apagado.");
                  nav("/");
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectPanel({ project, getTime, onSaved, onDelete }: { project: Project; getTime: () => number; onSaved: (p: Project) => void; onDelete: () => void }) {
  const { toast, online } = useApp();
  const [f, setF] = useState({
    name: project.name,
    competition: project.competition,
    date: project.date,
    teamA: project.teamA.name,
    teamB: project.teamB.name,
    colorA: project.teamA.color || "",
    colorB: project.teamB.color || "",
    length: project.court.length,
    width: project.court.width,
  });
  const save = async (extra: Record<string, unknown> = {}) => {
    const body = {
      name: f.name,
      competition: f.competition,
      date: f.date,
      teamA: { name: f.teamA, color: f.colorA || null },
      teamB: { name: f.teamB, color: f.colorB || null },
      court: { length: f.length, width: f.width },
      ...extra,
    };
    try {
      if (project.localOnly) {
        const p: Project = {
          ...project,
          name: f.name,
          competition: f.competition,
          date: f.date,
          teamA: { name: f.teamA, color: f.colorA || null },
          teamB: { name: f.teamB, color: f.colorB || null },
          court: { length: f.length, width: f.width },
          halfTimeS: "halfTimeS" in extra ? (extra.halfTimeS as number) : extra.clearHalfTime ? null : project.halfTimeS,
          updatedAt: Date.now() / 1000,
        };
        onSaved(p);
      } else onSaved(await api.patchProject(project.id, body));
      toast("Projeto atualizado. Recalcule a análise para aplicar cores/intervalo/campo.");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <div className="space-y-4">
      <Card title="Dados do jogo">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Competição"><input className={inputCls} value={f.competition} onChange={(e) => setF({ ...f, competition: e.target.value })} /></Field>
          <Field label="Data"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Campo (comprimento × largura, m)">
            <div className="flex gap-2">
              <input type="number" className={inputCls} value={f.length} onChange={(e) => setF({ ...f, length: Number(e.target.value) })} />
              <input type="number" className={inputCls} value={f.width} onChange={(e) => setF({ ...f, width: Number(e.target.value) })} />
            </div>
          </Field>
          <Field label="Equipa A"><div className="flex gap-2"><input className={inputCls} value={f.teamA} onChange={(e) => setF({ ...f, teamA: e.target.value })} /><input type="color" className="h-10 w-12 bg-transparent" value={f.colorA || "#39ff88"} onChange={(e) => setF({ ...f, colorA: e.target.value })} title="Cor do equipamento" /></div></Field>
          <Field label="Equipa B"><div className="flex gap-2"><input className={inputCls} value={f.teamB} onChange={(e) => setF({ ...f, teamB: e.target.value })} /><input type="color" className="h-10 w-12 bg-transparent" value={f.colorB || "#5ab4ff"} onChange={(e) => setF({ ...f, colorB: e.target.value })} title="Cor do equipamento" /></div></Field>
        </div>
        <div className="mt-2 text-xs text-ink-500">
          Cores: {project.teamA.color || project.teamB.color ? "definidas pelo utilizador (usadas na separação de equipas)." : "não definidas — separação automática por k-means."}{" "}
          {(f.colorA || f.colorB) && <button className="text-ink-300 underline" onClick={() => setF({ ...f, colorA: "", colorB: "" })}>remover cores</button>}
        </div>
        <div className="mt-4"><Button variant="primary" disabled={!online && !project.localOnly} onClick={() => save()}>Guardar</Button></div>
      </Card>
      <Card title="Intervalo (2.ª parte)" subtitle="As equipas trocam de campo: necessário para o sentido de ataque correto na 2.ª parte.">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Início da 2.ª parte: <b className="font-mono">{project.halfTimeS != null ? fmtTime(project.halfTimeS) : "não definido"}</b></span>
          <Button size="sm" onClick={() => save({ halfTimeS: getTime() })}>Marcar no instante atual</Button>
          {project.halfTimeS != null && <Button size="sm" variant="ghost" onClick={() => save({ clearHalfTime: true })}>Limpar</Button>}
        </div>
      </Card>
      <Card title="Zona de perigo">
        <Button variant="danger" onClick={onDelete}><Trash2 size={16} /> Apagar projeto</Button>
      </Card>
    </div>
  );
}
