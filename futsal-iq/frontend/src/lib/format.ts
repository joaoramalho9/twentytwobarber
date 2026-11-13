export function fmtTime(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return "—";
  const neg = s < 0;
  s = Math.abs(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const core = h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  return (neg ? "-" : "") + core;
}

export function parseTime(v: string): number | null {
  const parts = v.trim().split(":").map(Number);
  if (!parts.length || parts.some((x) => isNaN(x))) return null;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}

export const pct = (x: number | null | undefined, d = 0) => (x == null || !isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
export const num = (x: number | null | undefined, d = 1) => (x == null || !isFinite(x) ? "—" : x.toFixed(d));

export function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function ytId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export const SET_PIECE_LABEL: Record<string, string> = {
  corner: "Canto",
  kick_in: "Reposição lateral",
  free_kick: "Livre",
  free_kick_direct: "Livre direto",
  free_kick_indirect: "Livre indireto",
  goal_clearance: "Reposição de fundo",
  penalty: "Penálti / 10 m",
  kickoff: "Pontapé de saída",
  press_exit: "Saída de pressão",
  power_play: "Jogada de 5 para 4",
};
