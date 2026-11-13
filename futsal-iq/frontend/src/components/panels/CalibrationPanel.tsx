import { Camera, Check, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { fmtTime } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { Project } from "../../lib/types";
import { Button, Card, inputCls } from "../ui";

interface Props {
  project: Project;
  getTime: () => number;
  seek: (t: number) => void;
  onSaved: (p: Project) => void;
}

interface Pt {
  landmark: string;
  x: number;
  y: number;
}

export default function CalibrationPanel({ project, getTime, seek, onSaved }: Props) {
  const { toast } = useApp();
  const [lms, setLms] = useState<{ id: string; label: string }[]>([]);
  const [frame, setFrame] = useState<{ t: number; url: string; w: number; h: number } | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [active, setActive] = useState<string>("corner_left_far");
  const [preview, setPreview] = useState<{ errorM: number; lines: number[][][] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    api.landmarks(project.court.length, project.court.width).then(setLms).catch(() => setLms([]));
  }, [project.court.length, project.court.width]);

  useEffect(() => {
    setErr(null);
    if (pts.length < 4) {
      setPreview(null);
      return;
    }
    api
      .calibPreview(project.id, { t: frame?.t || 0, points: pts })
      .then(setPreview)
      .catch((e) => {
        setPreview(null);
        setErr(e.message);
      });
  }, [pts, project.id, frame?.t]);

  const capture = async () => {
    const t = getTime();
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setFrame({ t, url: img.src, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => toast("Não foi possível obter o frame.", "error");
    img.src = api.frameUrl(project.id, t);
    setPts([]);
  };

  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!frame || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * frame.w;
    const y = ((e.clientY - r.top) / r.height) * frame.h;
    setPts((p) => [...p.filter((q) => q.landmark !== active), { landmark: active, x: Math.round(x), y: Math.round(y) }]);
    // advance to the next unused landmark
    const used = new Set([...pts.map((q) => q.landmark), active]);
    const next = lms.find((l) => !used.has(l.id));
    if (next) setActive(next.id);
  };

  const save = async () => {
    if (!frame) return;
    try {
      const p = await api.addCalibration(project.id, { t: frame.t, points: pts });
      onSaved(p);
      toast("Calibração guardada. Recalcule a análise para aplicar.");
      setFrame(null);
      setPts([]);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async (i: number) => {
    try {
      onSaved(await api.deleteCalibration(project.id, i));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (!project.video) {
    return <Card title="Calibração do campo"><p className="text-sm text-ink-400">A calibração precisa do ficheiro de vídeo (frames). Não é possível com o leitor incorporado do YouTube.</p></Card>;
  }
  const labelOf = (id: string) => lms.find((l) => l.id === id)?.label || id;

  return (
    <div className="space-y-4">
      <Card
        title="Calibração do campo"
        subtitle="Converte posições na imagem em metros no campo (homografia). Necessária para tática, física e bolas paradas."
        actions={<Button variant="primary" size="sm" onClick={capture}><Camera size={14} /> Capturar frame atual</Button>}
      >
        {!frame ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-300">
            <li>Pause o vídeo num plano aberto onde se vejam bem as linhas do campo.</li>
            <li>Clique em «Capturar frame atual».</li>
            <li>Escolha a referência (canto, meio-campo, marca de penálti…) e clique no ponto correspondente da imagem. Mínimo 4 pontos, não colineares.</li>
            <li>Confirme que as linhas projetadas (verde) coincidem com as do campo e guarde.</li>
            <li>Câmara em movimento: adicione calibrações em vários momentos (ex.: cada mudança de plano); cada uma vale para o segmento de câmara em que foi feita.</li>
          </ol>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-400">Referência a marcar:</span>
              <select className={`${inputCls} max-w-sm`} value={active} onChange={(e) => setActive(e.target.value)}>
                {lms.map((l) => (
                  <option key={l.id} value={l.id}>
                    {pts.find((p) => p.landmark === l.id) ? "✓ " : ""}
                    {l.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-ink-500">Frame em {fmtTime(frame.t)}</span>
            </div>
            <div className="relative cursor-crosshair select-none overflow-hidden rounded-lg" onClick={click}>
              <img ref={imgRef} src={frame.url} alt="Frame para calibração" className="w-full" draggable={false} />
              <svg viewBox={`0 0 ${frame.w} ${frame.h}`} className="pointer-events-none absolute inset-0 h-full w-full">
                {preview?.lines.map((l, i) => (
                  <polyline key={i} points={l.map((p) => p.join(",")).join(" ")} fill="none" stroke="#39ff88" strokeWidth={Math.max(1.5, frame.w / 700)} opacity={0.85} />
                ))}
                {pts.map((p) => (
                  <g key={p.landmark}>
                    <circle cx={p.x} cy={p.y} r={frame.w / 160} fill="#ff3b6b" stroke="#fff" strokeWidth={1.5} />
                    <text x={p.x + 8} y={p.y - 8} fill="#fff" fontSize={frame.w / 70} style={{ paintOrder: "stroke" }} stroke="#000" strokeWidth={3}>
                      {labelOf(p.landmark).split(" – ")[0].slice(0, 26)}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
            <div className="flex flex-wrap gap-2">
              {pts.map((p) => (
                <span key={p.landmark} className="inline-flex items-center gap-1 rounded-full border border-ink-600 px-2 py-0.5 text-xs">
                  {labelOf(p.landmark)}
                  <button aria-label="Remover ponto" onClick={() => setPts(pts.filter((q) => q !== p))} className="text-ink-400 hover:text-red-300">×</button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {preview && (
                <span className={`text-sm ${preview.errorM < 0.5 ? "text-neon" : preview.errorM < 1.5 ? "text-amber-300" : "text-red-300"}`}>
                  Erro médio de reprojeção: {preview.errorM.toFixed(2)} m
                </span>
              )}
              {err && <span className="text-sm text-red-300">{err}</span>}
              <Button variant="primary" disabled={!preview || preview.errorM > 1.5} onClick={save}><Check size={16} /> Guardar calibração</Button>
              <Button variant="ghost" onClick={() => { setFrame(null); setPts([]); }}>Cancelar</Button>
            </div>
          </div>
        )}
      </Card>
      <Card title={`Calibrações guardadas (${project.calibrations.length})`}>
        {project.calibrations.length === 0 ? (
          <p className="text-sm text-ink-400">Nenhuma. Sem calibração, a análise fica limitada a deteções na imagem (sem metros, sistemas táticos ou zonas).</p>
        ) : (
          <ul className="divide-y divide-ink-800 text-sm">
            {project.calibrations.map((c, i) => (
              <li key={i} className="flex items-center justify-between py-2">
                <button className="font-mono text-neon hover:underline" onClick={() => seek(c.t)}>{fmtTime(c.t)}</button>
                <span className="text-ink-300">{c.points.length} pontos · erro {c.errorM.toFixed(2)} m</span>
                <Button size="sm" variant="ghost" onClick={() => remove(i)} aria-label="Apagar calibração"><Trash2 size={14} /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
