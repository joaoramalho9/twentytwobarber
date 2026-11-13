import { Pause, Play, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, uploadVideo } from "../../lib/api";
import { fmtTime, pct } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { Analysis, JobState, Project } from "../../lib/types";
import { Button, Card, Field, KindBadge, Progress, inputCls } from "../ui";

interface Props {
  project: Project;
  analysis?: Analysis;
  onChanged: () => void;
}

export default function ProcessingPanel({ project, analysis, onChanged }: Props) {
  const { settings, toast, online, health } = useApp();
  const [job, setJob] = useState<JobState | null>(project.job || null);
  const [params, setParams] = useState({ ...settings.analysis, start_s: 0, end_s: "" as number | "" });
  const [file, setFile] = useState<File | null>(null);
  const [up, setUp] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rights, setRights] = useState(false);
  const prevStatus = useRef(job?.status);

  const running = job?.status === "running" || job?.status === "queued";
  const ck = job?.checkpoint;
  const canResume = !!ck && !ck.done;

  useEffect(() => {
    if (project.localOnly || !online) return;
    let alive = true;
    const poll = async () => {
      try {
        const j = await api.job(project.id);
        if (!alive) return;
        setJob(j);
        if ((prevStatus.current === "running" || prevStatus.current === "queued") && j.status !== prevStatus.current) {
          if (j.status === "done") {
            toast(j.kind === "youtube" ? "Vídeo importado do YouTube." : j.kind === "transcode" ? "Vídeo convertido para MP4 — pronto para análise." : "Análise concluída.");
            onChanged();
          } else if (j.status === "error") toast(j.error || "Erro no processamento", "error");
          else if (j.status === "cancelled") toast("Análise interrompida. Progresso guardado.");
        }
        prevStatus.current = j.status;
      } catch {
        /* offline */
      }
    };
    poll();
    const t = setInterval(poll, running ? 1500 : 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [project.id, project.localOnly, online, running, onChanged, toast]);

  const start = async (restart = false) => {
    if (restart && !confirm("Recomeçar do zero apaga os dados de deteção já processados. Continuar?")) return;
    setBusy(true);
    try {
      const body = { ...params, end_s: params.end_s === "" ? null : Number(params.end_s), restart };
      const j = await api.analyze(project.id, body);
      setJob(j);
      prevStatus.current = "queued";
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const reanalyze = async () => {
    try {
      setJob(await api.reanalyze(project.id));
      prevStatus.current = "queued";
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const doUpload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadVideo(project.id, file, setUp);
      toast("Vídeo carregado.");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setUp(0);
    }
  };

  const doImport = async () => {
    if (!project.youtubeUrl) return;
    try {
      setJob(await api.importYouTube(project.id, project.youtubeUrl));
      prevStatus.current = "queued";
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (project.localOnly) {
    return (
      <Card title="Processamento">
        <p className="text-sm text-ink-300">
          Projeto local (criado sem o motor de análise): vídeo visto no leitor oficial do YouTube. A análise automática por visão computacional não
          está disponível porque o YouTube não permite aceder aos frames do leitor incorporado. Use o separador <b>Eventos</b> para marcação manual;
          clips e relatório funcionam a partir dessas marcações.
        </p>
      </Card>
    );
  }

  const d = job?.detail || {};
  return (
    <div className="space-y-4">
      {!project.video && (
        <Card title="Associar vídeo">
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-sm text-ink-300">Carregar ficheiro do jogo (recomendado):</div>
              <div className="flex flex-wrap items-center gap-3">
                <input type="file" accept="video/*,.mkv,.avi" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-700 file:px-3 file:py-2 file:text-white" />
                <Button variant="primary" disabled={!file || busy || !online} onClick={doUpload}><Upload size={16} /> Carregar</Button>
              </div>
              {up > 0 && <div className="mt-3"><Progress value={up} label={<><span>A enviar</span><span>{Math.round(up * 100)}%</span></>} /></div>}
            </div>
            {project.youtubeUrl && (
              <div className="border-t border-ink-700 pt-4">
                <div className="mb-2 text-sm text-ink-300">Ou importar o vídeo do YouTube associado (apenas se tiver direitos/autorização):</div>
                <label className="mb-2 flex items-start gap-2 text-sm text-ink-300">
                  <input type="checkbox" className="mt-1" checked={rights} onChange={(e) => setRights(e.target.checked)} />
                  Confirmo que sou titular dos direitos deste vídeo ou tenho autorização para o descarregar e analisar.
                </label>
                <Button disabled={!rights || running || !online || (health ? !health.ytdlp : false)} onClick={doImport}>Importar do YouTube</Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {project.video && (
        <Card title="Análise automática do vídeo" subtitle={`${project.video.originalName || project.video.file} · ${fmtTime(project.video.info.duration)} · ${project.video.info.width}×${project.video.info.height} · ${project.video.info.fps.toFixed(1)} fps`}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Frames analisados / s" hint="Mais = mais preciso e mais lento">
              <select className={inputCls} value={params.sample_fps} disabled={running} onChange={(e) => setParams({ ...params, sample_fps: Number(e.target.value) })}>
                {[2, 3, 5, 8, 10].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Modelo YOLO" hint="n = rápido · s/m = mais preciso">
              <select className={inputCls} value={params.model} disabled={running} onChange={(e) => setParams({ ...params, model: e.target.value })}>
                {["yolo11n.pt", "yolo11s.pt", "yolo11m.pt"].map((v) => <option key={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Câmara">
              <select className={inputCls} value={params.camera_mode} disabled={running} onChange={(e) => setParams({ ...params, camera_mode: e.target.value as "static" | "moving" })}>
                <option value="moving">Em movimento (compensação)</option>
                <option value="static">Fixa</option>
              </select>
            </Field>
            <Field label="Resolução de inferência">
              <select className={inputCls} value={params.imgsz} disabled={running} onChange={(e) => setParams({ ...params, imgsz: Number(e.target.value) })}>
                {[640, 960, 1280].map((v) => <option key={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Início (s)">
              <input type="number" min={0} className={inputCls} disabled={running} value={params.start_s} onChange={(e) => setParams({ ...params, start_s: Number(e.target.value) })} />
            </Field>
            <Field label="Fim (s, vazio = até ao fim)">
              <input type="number" min={0} className={inputCls} disabled={running} value={params.end_s} onChange={(e) => setParams({ ...params, end_s: e.target.value === "" ? "" : Number(e.target.value) })} />
            </Field>
          </div>

          {running && (
            <div className="mt-5 space-y-2 rounded-lg border border-neon/20 bg-neon/5 p-4">
              <Progress value={job?.progress || 0} label={<><span>{job?.stage}</span><span className="font-mono">{pct(job?.progress, 1)}</span></>} />
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-300">
                {d.framesTotal != null && <span>Frames: {d.framesDone}/{d.framesTotal}</span>}
                {d.fps != null && <span>Velocidade: {d.fps} frames/s</span>}
                {d.videoT != null && <span>Posição no vídeo: {fmtTime(d.videoT)}</span>}
                {d.etaS != null && <span>Tempo restante estimado: {fmtTime(d.etaS)}</span>}
              </div>
            </div>
          )}
          {job?.status === "error" && <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200" role="alert">{job.error}</div>}
          {(job?.status === "cancelled" || job?.status === "interrupted") && (
            <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100">{job.message || "Análise interrompida."}</div>
          )}
          {canResume && !running && ck && ck.endF > ck.startF && (
            <div className="mt-3 text-xs text-ink-400">
              Progresso guardado: {Math.round(((ck.nextFrame - ck.startF) / (ck.endF - ck.startF)) * 100)}% da deteção. Retomar usa os mesmos parâmetros guardados.
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {running ? (
              <Button variant="danger" onClick={() => api.cancel(project.id).then(() => toast("A interromper…"))}><Pause size={16} /> Interromper</Button>
            ) : (
              <>
                <Button variant="primary" disabled={busy || !online || job?.status === "error" && job.kind === "transcode"} onClick={() => start(false)}>
                  <Play size={16} /> {canResume ? "Retomar análise" : ck?.done ? "Executar novamente" : "Iniciar análise"}
                </Button>
                {ck && <Button disabled={busy || !online} onClick={() => start(true)}><RotateCcw size={16} /> Recomeçar do zero</Button>}
                {ck?.done && <Button disabled={!online} onClick={reanalyze} title="Recalcula equipas, eventos, tática e scouting com a calibração/correções atuais, sem repetir a deteção"><RefreshCw size={16} /> Recalcular análise</Button>}
              </>
            )}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            Pipeline: YOLO (deteção de pessoas e bola) → ByteTrack (IDs persistentes) → cor do equipamento (equipas) → homografia (campo) →
            eventos, tática e scouting. Tudo corre localmente no seu computador ({health?.device?.toUpperCase() || "CPU"}). Os parâmetros
            ficam guardados para poder interromper e retomar.
          </p>
        </Card>
      )}

      {analysis && (
        <Card title="Qualidade dos dados da análise" subtitle="Determina a fiabilidade de todas as conclusões">
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <Metric label="Período analisado" value={`${fmtTime(analysis.coverage.analysedFromS)} – ${fmtTime(analysis.coverage.analysedToS)}`} />
            <Metric label="Frames analisados" value={analysis.coverage.framesAnalysed} />
            <Metric label="Frames com calibração válida" value={pct(analysis.coverage.validPct)} />
            <Metric label="Planos abertos (táticos)" value={pct(analysis.coverage.widePct)} />
            <Metric label="Bola detetada (frames válidos)" value={pct(analysis.coverage.ballDetectedPct)} />
            <Metric label="Tracklets (fragmentos de tracking)" value={analysis.coverage.tracklets} />
          </div>
          {analysis.warnings.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm text-amber-200">
              {analysis.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-ink-400">
            Legenda das conclusões: <KindBadge kind="medição" /> valor medido · <KindBadge kind="deteção" /> evento detetado ·
            <KindBadge kind="estimativa" /> estimativa com incerteza · <KindBadge kind="interpretação" /> interpretação tática · <KindBadge kind="manual" /> analista
          </div>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-ink-850 p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-1 font-mono text-white">{value}</div>
    </div>
  );
}
