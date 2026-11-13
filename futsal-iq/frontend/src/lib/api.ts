import { loadSettings } from "./settings";
import type { Analysis, Corrections, JobState, Project } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function apiUrl(path: string) {
  const base = loadSettings().apiBase.replace(/\/$/, "");
  return `${base}${path}`;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiError("Não foi possível contactar o servidor de análise (backend). Verifique se está a correr — ver Definições.", 0);
  }
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d: { msg: string; loc?: string[] }) => `${d.loc?.slice(-1)[0] ?? ""}: ${d.msg}`).join("; ");
    } catch {
      /* not json */
    }
    throw new ApiError(msg, res.status);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.blob()) as unknown as T;
}

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface Health {
  ok: boolean;
  ffmpeg: boolean;
  ytdlp: boolean;
  ultralytics: string | null;
  torch: string | null;
  device: string | null;
  models: string[];
}

export const api = {
  health: () => req<Health>("/api/health"),
  listProjects: () => req<Project[]>("/api/projects"),
  getProject: (id: string) => req<Project>(`/api/projects/${id}`),
  createProject: (body: Record<string, unknown>) => req<Project>("/api/projects", json(body)),
  patchProject: (id: string, body: Record<string, unknown>) => req<Project>(`/api/projects/${id}`, json(body, "PATCH")),
  deleteProject: (id: string) => req<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  importYouTube: (id: string, url: string) => req<JobState>(`/api/projects/${id}/youtube`, json({ url, confirmRights: true })),
  analyze: (id: string, params: Record<string, unknown>) => req<JobState>(`/api/projects/${id}/analyze`, json(params)),
  reanalyze: (id: string) => req<JobState>(`/api/projects/${id}/reanalyze`, json({})),
  cancel: (id: string) => req<{ ok: boolean }>(`/api/projects/${id}/cancel`, json({})),
  job: (id: string) => req<JobState>(`/api/projects/${id}/job`),
  analysis: (id: string) => req<Analysis>(`/api/projects/${id}/analysis`),
  landmarks: (L: number, W: number) =>
    req<{ id: string; label: string; x: number; y: number }[]>(`/api/court/landmarks?length=${L}&width=${W}`),
  calibPreview: (id: string, body: Record<string, unknown>) =>
    req<{ H: number[][]; errorM: number; maxErrorM: number; lines: number[][][] }>(`/api/projects/${id}/calibration/preview`, json(body)),
  addCalibration: (id: string, body: Record<string, unknown>) => req<Project>(`/api/projects/${id}/calibrations`, json(body)),
  deleteCalibration: (id: string, idx: number) => req<Project>(`/api/projects/${id}/calibrations/${idx}`, { method: "DELETE" }),
  putCorrections: (id: string, c: Corrections) => req<Project>(`/api/projects/${id}/corrections`, json(c, "PUT")),
  overlay: (id: string, start: number, end: number) =>
    req<{ frames: OverlayFrame[] }>(`/api/projects/${id}/overlay?start=${start.toFixed(2)}&end=${end.toFixed(2)}`),
  videoUrl: (id: string) => apiUrl(`/api/projects/${id}/video`),
  frameUrl: (id: string, t: number) => apiUrl(`/api/projects/${id}/frame?t=${t.toFixed(3)}`),
};

export interface OverlayFrame {
  t: number;
  persons: { tid: number; pid: string | null; team: string; name: string | null; role: string | null; box: number[]; xy: [number, number] | null }[];
  ball: { box: number[]; conf: number; xy: [number, number] | null } | null;
}

/** Upload with progress (fetch has no upload progress). */
export function uploadVideo(id: string, file: File, onProgress: (p: number) => void): Promise<Project> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl(`/api/projects/${id}/upload`));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(j);
        else reject(new ApiError(typeof j.detail === "string" ? j.detail : `Erro ${xhr.status}`, xhr.status));
      } catch {
        reject(new ApiError(`Erro ${xhr.status}`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError("Falha de rede durante o envio do vídeo.", 0));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

/** POST that returns a file; triggers a browser download. */
export async function downloadPost(path: string, body: unknown, filename: string) {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), json(body));
  } catch {
    throw new ApiError("Servidor indisponível.", 0);
  }
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      msg = (await res.json()).detail || msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
