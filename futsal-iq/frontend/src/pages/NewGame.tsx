import { AlertTriangle, Upload, Youtube } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Field, PageHeader, Progress, inputCls } from "../components/ui";
import { api, uploadVideo } from "../lib/api";
import { db } from "../lib/db";
import { uid, ytId } from "../lib/format";
import { useApp } from "../lib/store";
import type { Project } from "../lib/types";

export default function NewGame() {
  const { online, refreshProjects, setCurrentId, toast, health } = useApp();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", competition: "", date: "", teamA: "", teamB: "", teamAColor: "", teamBColor: "", length: 40, width: 20 });
  const [useColors, setUseColors] = useState(false);
  const [source, setSource] = useState<"file" | "youtube">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [download, setDownload] = useState(false);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }));
  const validYt = !!ytId(url);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (source === "file" && !file) return setErr("Escolha um ficheiro de vídeo.");
    if (source === "youtube" && !validYt) return setErr("O link do YouTube não é válido.");
    if (source === "youtube" && download && !rights) return setErr("Para descarregar o vídeo tem de confirmar que tem direitos/autorização.");
    const name = form.name || `${form.teamA || "Equipa A"} vs ${form.teamB || "Equipa B"}`;

    if (!online) {
      if (source === "file") return setErr("O processamento de ficheiros exige o motor de análise (backend) ligado. Veja Definições.");
      // local-only project: YouTube embed + manual tagging, stored in the browser
      const now = Date.now() / 1000;
      const p: Project = {
        id: uid("local-"),
        name,
        competition: form.competition,
        date: form.date,
        teamA: { name: form.teamA || "Equipa A", color: useColors ? form.teamAColor || null : null },
        teamB: { name: form.teamB || "Equipa B", color: useColors ? form.teamBColor || null : null },
        youtubeUrl: url,
        youtubeId: ytId(url),
        video: null,
        court: { length: form.length, width: form.width },
        calibrations: [],
        halfTimeS: null,
        corrections: { merge: [], names: {}, team: {}, role: {}, hidden: [] },
        createdAt: now,
        updatedAt: now,
        localOnly: true,
      };
      await db.putProject(p);
      await refreshProjects();
      setCurrentId(p.id);
      toast("Projeto local criado (marcação manual sobre o leitor do YouTube).");
      return nav(`/jogo/${p.id}`);
    }

    setBusy(true);
    try {
      const p = await api.createProject({
        name,
        competition: form.competition,
        date: form.date,
        teamA: form.teamA,
        teamB: form.teamB,
        teamAColor: useColors ? form.teamAColor || null : null,
        teamBColor: useColors ? form.teamBColor || null : null,
        youtubeUrl: source === "youtube" ? url : null,
        court: { length: form.length, width: form.width },
      });
      if (source === "file" && file) {
        await uploadVideo(p.id, file, setUp);
      } else if (source === "youtube" && download) {
        await api.importYouTube(p.id, url);
        toast("Importação do YouTube iniciada.");
      }
      await refreshProjects();
      setCurrentId(p.id);
      nav(`/jogo/${p.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title="Novo jogo" subtitle="Crie o projeto, associe o vídeo e configure as equipas." />
      <form onSubmit={submit} className="space-y-6">
        <Card title="Jogo">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Nome do jogo">
              <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Jornada 12" />
            </Field>
            <Field label="Competição">
              <input className={inputCls} value={form.competition} onChange={(e) => set("competition", e.target.value)} />
            </Field>
            <Field label="Data">
              <input type="date" className={inputCls} value={form.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label="Equipa A">
              <input className={inputCls} value={form.teamA} onChange={(e) => set("teamA", e.target.value)} placeholder="Equipa A" />
            </Field>
            <Field label="Equipa B">
              <input className={inputCls} value={form.teamB} onChange={(e) => set("teamB", e.target.value)} placeholder="Equipa B" />
            </Field>
            <Field label="Campo (m)" hint="Medidas oficiais: 38–42 × 20–25 m">
              <div className="flex gap-2">
                <input type="number" min={25} max={45} step={0.5} className={inputCls} value={form.length} onChange={(e) => set("length", Number(e.target.value))} aria-label="Comprimento" />
                <input type="number" min={14} max={25} step={0.5} className={inputCls} value={form.width} onChange={(e) => set("width", Number(e.target.value))} aria-label="Largura" />
              </div>
            </Field>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-ink-300">
            <input type="checkbox" checked={useColors} onChange={(e) => setUseColors(e.target.checked)} />
            Indicar as cores das camisolas (melhora a separação das equipas; caso contrário é feita automaticamente por k-means)
          </label>
          {useColors && (
            <div className="mt-3 flex gap-6">
              <Field label="Cor Equipa A">
                <input type="color" value={form.teamAColor || "#22aa44"} onChange={(e) => set("teamAColor", e.target.value)} className="h-10 w-20 rounded bg-transparent" />
              </Field>
              <Field label="Cor Equipa B">
                <input type="color" value={form.teamBColor || "#ffffff"} onChange={(e) => set("teamBColor", e.target.value)} className="h-10 w-20 rounded bg-transparent" />
              </Field>
            </div>
          )}
        </Card>

        <Card title="Vídeo">
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setSource("file")} className={`rounded-xl border p-4 text-left ${source === "file" ? "border-neon bg-neon/5" : "border-ink-700"}`}>
              <Upload size={18} className="mb-2 text-neon" />
              <div className="font-medium">Ficheiro de vídeo</div>
              <div className="text-xs text-ink-400">MP4/MOV/MKV/AVI/WEBM. Análise automática completa.</div>
            </button>
            <button type="button" onClick={() => setSource("youtube")} className={`rounded-xl border p-4 text-left ${source === "youtube" ? "border-neon bg-neon/5" : "border-ink-700"}`}>
              <Youtube size={18} className="mb-2 text-neon" />
              <div className="font-medium">Link público do YouTube</div>
              <div className="text-xs text-ink-400">Leitor oficial incorporado + marcação manual; importação opcional.</div>
            </button>
          </div>
          {source === "file" ? (
            <div>
              <input type="file" accept="video/*,.mkv,.avi" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm text-ink-300 file:mr-4 file:rounded-lg file:border-0 file:bg-neon file:px-4 file:py-2 file:font-semibold file:text-ink-950" />
              {file && <div className="mt-2 text-xs text-ink-400">{file.name} · {(file.size / 1e6).toFixed(0)} MB</div>}
              {busy && up > 0 && <div className="mt-3"><Progress value={up} label={<><span>A enviar para o motor de análise local</span><span>{Math.round(up * 100)}%</span></>} /></div>}
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="URL do YouTube">
                <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
              </Field>
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-100">
                <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle size={14} /> Limitação do YouTube</div>
                Os Termos de Serviço do YouTube não permitem descarregar vídeos sem autorização, e o leitor oficial incorporado não dá acesso aos
                frames. Por isso: <b>sem importação</b>, o jogo é visto no leitor oficial e analisado por <b>marcação manual</b> (eventos, clips por
                timestamps, relatório) — sem visão computacional. Para a <b>análise automática</b>, carregue o ficheiro do jogo ou, se o vídeo for
                seu/da sua equipa ou tiver autorização (ou licença Creative Commons), ative a importação abaixo.
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} disabled={!online || (health ? !health.ytdlp : false)} />
                Importar o vídeo para análise automática (yt-dlp, no seu computador)
              </label>
              {download && (
                <label className="flex items-start gap-2 text-sm text-ink-300">
                  <input type="checkbox" className="mt-1" checked={rights} onChange={(e) => setRights(e.target.checked)} />
                  Confirmo que sou titular dos direitos deste vídeo ou tenho autorização do titular para o descarregar e analisar.
                </label>
              )}
              {!online && <div className="text-xs text-ink-400">Motor de análise desligado: será criado um projeto local só com o leitor do YouTube.</div>}
            </div>
          )}
        </Card>

        {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">{err}</div>}
        <div className="flex justify-end">
          <Button variant="primary" type="submit" disabled={busy} className="px-6">
            {busy ? "A criar…" : "Criar projeto"}
          </Button>
        </div>
      </form>
    </div>
  );
}
