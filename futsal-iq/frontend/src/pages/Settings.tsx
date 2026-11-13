import { Download, RefreshCw, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Card, Field, PageHeader, inputCls } from "../components/ui";
import { db } from "../lib/db";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { useApp } from "../lib/store";

export default function SettingsPage() {
  const { settings, setSettings, health, online, refreshProjects, toast } = useApp();
  const [s, setS] = useState(settings);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = () => {
    setSettings(s);
    toast("Definições guardadas.");
    refreshProjects();
  };

  const exportAll = async () => {
    const blob = new Blob([await db.exportAll()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `futsal-iq-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  const importAll = async (f: File) => {
    try {
      const n = await db.importAll(await f.text());
      toast(`${n} projetos importados.`);
      refreshProjects();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Definições" />
      <Card title="Motor de análise (backend local)" actions={<Button size="sm" onClick={refreshProjects}><RefreshCw size={14} /> Testar ligação</Button>}>
        <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>Estado: <b className={online ? "text-neon" : "text-red-300"}>{online ? "ligado" : "desligado"}</b></div>
          {health && (
            <>
              <div>Dispositivo: <b>{health.device?.toUpperCase()}</b> (PyTorch {health.torch})</div>
              <div>Ultralytics YOLO: <b>{health.ultralytics}</b></div>
              <div>FFmpeg: <b>{health.ffmpeg ? "disponível" : "não encontrado"}</b></div>
              <div>yt-dlp: <b>{health.ytdlp ? "disponível" : "não instalado"}</b></div>
              <div>Modelos descarregados: <b>{health.models.join(", ") || "nenhum (descarrega na 1.ª análise)"}</b></div>
            </>
          )}
        </div>
        <Field label="Endereço do backend" hint="Vazio = mesmo endereço desta página (recomendado). Ex.: http://127.0.0.1:8000">
          <input className={inputCls} value={s.apiBase} onChange={(e) => setS({ ...s, apiBase: e.target.value })} placeholder="(mesma origem)" />
        </Field>
        {!online && (
          <pre className="mt-4 overflow-x-auto rounded-lg bg-ink-850 p-3 text-xs text-ink-300">{`cd futsal-iq/backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
python run.py`}</pre>
        )}
      </Card>

      <Card title="Parâmetros de análise por omissão">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Frames por segundo">
            <input type="number" min={1} max={15} className={inputCls} value={s.analysis.sample_fps} onChange={(e) => setS({ ...s, analysis: { ...s.analysis, sample_fps: Number(e.target.value) } })} />
          </Field>
          <Field label="Modelo">
            <select className={inputCls} value={s.analysis.model} onChange={(e) => setS({ ...s, analysis: { ...s.analysis, model: e.target.value } })}>
              {["yolo11n.pt", "yolo11s.pt", "yolo11m.pt"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Resolução">
            <select className={inputCls} value={s.analysis.imgsz} onChange={(e) => setS({ ...s, analysis: { ...s.analysis, imgsz: Number(e.target.value) } })}>
              {[640, 960, 1280].map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Confiança mínima (pessoas)">
            <input type="number" step={0.05} min={0.05} max={0.9} className={inputCls} value={s.analysis.person_conf} onChange={(e) => setS({ ...s, analysis: { ...s.analysis, person_conf: Number(e.target.value) } })} />
          </Field>
          <Field label="Confiança mínima (bola)">
            <input type="number" step={0.01} min={0.03} max={0.9} className={inputCls} value={s.analysis.ball_conf} onChange={(e) => setS({ ...s, analysis: { ...s.analysis, ball_conf: Number(e.target.value) } })} />
          </Field>
          <Field label="Câmara">
            <select className={inputCls} value={s.analysis.camera_mode} onChange={(e) => setS({ ...s, analysis: { ...s.analysis, camera_mode: e.target.value as "static" | "moving" } })}>
              <option value="moving">Em movimento</option>
              <option value="static">Fixa</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Clips e interface">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Segundos antes do evento"><input type="number" min={0} max={60} className={inputCls} value={s.clipPadBefore} onChange={(e) => setS({ ...s, clipPadBefore: Number(e.target.value) })} /></Field>
          <Field label="Segundos depois do evento"><input type="number" min={0} max={60} className={inputCls} value={s.clipPadAfter} onChange={(e) => setS({ ...s, clipPadAfter: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={s.showOverlayByDefault} onChange={(e) => setS({ ...s, showOverlayByDefault: e.target.checked })} /> Mostrar deteções sobre o vídeo</label>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button variant="primary" onClick={save}>Guardar definições</Button>
        <Button variant="ghost" onClick={() => setS(DEFAULT_SETTINGS)}>Repor valores por omissão</Button>
      </div>

      <Card title="Dados guardados no browser" subtitle="Projetos, análises, eventos, clips, avaliações e notas ficam no IndexedDB deste browser. Os vídeos ficam na pasta do backend.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportAll}><Download size={16} /> Exportar cópia de segurança (JSON)</Button>
          <Button onClick={() => fileRef.current?.click()}><Upload size={16} /> Importar cópia</Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])} />
        </div>
      </Card>

      <Card title="Sobre e limitações">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-300">
          <li>Deteção: YOLO11 (Ultralytics, AGPL-3.0) com pesos COCO genéricos — a bola de futsal é pequena e é detetada de forma intermitente; a fiabilidade de passes/posse depende disso e é sempre indicada.</li>
          <li>Tracking: ByteTrack. Os IDs fragmentam em oclusões/mudanças de plano; uma fusão conservadora junta fragmentos e o analista corrige o resto.</li>
          <li>Números de camisola não são lidos: usam-se identificadores provisórios (Jogador A, B…).</li>
          <li>Métricas em metros exigem calibração; com câmara em movimento a compensação é aproximada e cada calibração vale para o seu segmento de câmara.</li>
          <li>YouTube: o leitor oficial incorporado não dá acesso aos frames; a análise automática exige o ficheiro (ou importação com direitos).</li>
          <li>Nenhuma API paga, nenhum dado enviado para a nuvem.</li>
        </ul>
      </Card>
    </div>
  );
}
