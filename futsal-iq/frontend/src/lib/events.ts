import type { AEvent, Analysis, Clip, ReviewStatus, TeamKey, UserData } from "./types";
import { uid } from "./format";

/** Manual tagging catalogue (analyst). key = keyboard shortcut. */
export const TAGS: { type: string; label: string; key: string; setPiece?: boolean }[] = [
  { type: "goal", label: "Golo", key: "g" },
  { type: "shot", label: "Remate", key: "r" },
  { type: "chance", label: "Oportunidade de golo", key: "o" },
  { type: "corner", label: "Canto", key: "c", setPiece: true },
  { type: "free_kick_direct", label: "Livre direto", key: "d", setPiece: true },
  { type: "free_kick_indirect", label: "Livre indireto", key: "i", setPiece: true },
  { type: "kick_in", label: "Reposição lateral", key: "l", setPiece: true },
  { type: "goal_clearance", label: "Reposição de fundo", key: "f", setPiece: true },
  { type: "press_exit", label: "Saída de pressão", key: "s", setPiece: true },
  { type: "power_play", label: "Jogada 5 para 4", key: "5", setPiece: true },
  { type: "recovery", label: "Recuperação", key: "u" },
  { type: "turnover", label: "Perda de bola", key: "p" },
  { type: "defensive_error", label: "Erro defensivo", key: "e" },
  { type: "good_action", label: "Boa ação individual", key: "b" },
  { type: "transition", label: "Transição ofensiva", key: "t" },
  { type: "def_transition", label: "Transição defensiva", key: "y" },
  { type: "counter", label: "Contra-ataque", key: "k" },
  { type: "foul", label: "Falta", key: "x" },
];

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(TAGS.map((t) => [t.type, t.label]));
Object.assign(TYPE_LABEL, {
  pass: "Passe",
  kickoff: "Pontapé de saída",
  free_kick: "Livre",
  penalty: "Penálti / 10 m",
  restart_unknown: "Reinício",
  rupture: "Movimento de rutura",
  audio_peak: "Pico sonoro",
});

export interface MergedEvent extends AEvent {
  status: ReviewStatus | "manual";
}

export function mergedEvents(a: Analysis | undefined, u: UserData): MergedEvent[] {
  const auto: MergedEvent[] = (a?.events || []).map((e) => ({
    ...e,
    ...(u.eventEdits[e.id] || {}),
    status: u.review[e.id] || "pending",
  }));
  const manual: MergedEvent[] = u.manualEvents.map((e) => ({ ...e, status: "manual" as const }));
  return [...auto, ...manual].sort((x, y) => x.t - y.t);
}

export function newManualEvent(type: string, t: number, team: TeamKey | null, player: string | null): AEvent {
  return {
    id: uid("m"),
    type,
    label: TYPE_LABEL[type] || type,
    t,
    team,
    player,
    kind: "medição",
    confidence: 1,
    source: "manual",
    method: "Marcação manual do analista",
    setPiece: !!TAGS.find((x) => x.type === type)?.setPiece,
  };
}

export const CLIP_CATEGORIES = [
  "Golos",
  "Jogadas ensaiadas",
  "Bolas paradas",
  "Oportunidades de golo",
  "Erros defensivos",
  "Boas ações individuais",
  "Transições",
  "Momentos de intensidade",
  "Outros",
];

export function categoryFor(e: AEvent, rehearsed: Set<string>): string | null {
  if (e.type === "goal") return "Golos";
  if (rehearsed.has(e.id)) return "Jogadas ensaiadas";
  if (e.setPiece || ["corner", "kick_in", "free_kick", "free_kick_direct", "free_kick_indirect", "goal_clearance", "penalty", "press_exit", "power_play"].includes(e.type))
    return "Bolas paradas";
  if (e.type === "shot" || e.type === "chance") return "Oportunidades de golo";
  if (e.type === "defensive_error" || (e.type === "turnover" && e.dangerZone)) return "Erros defensivos";
  if (e.type === "good_action" || e.type === "rupture" || e.type === "recovery") return "Boas ações individuais";
  if (["transition", "counter", "def_transition"].includes(e.type)) return "Transições";
  if (e.type === "audio_peak") return "Momentos de intensidade";
  if (e.type === "foul" || e.type === "turnover") return "Outros";
  return null; // passes, kickoffs: not clipped automatically
}

/** Build clip suggestions from events not rejected; skip ones already clipped. */
export function autoClips(events: MergedEvent[], a: Analysis | undefined, existing: Clip[], before: number, after: number, includePending: boolean, nameOf: (pid?: string | null) => string | null): Clip[] {
  const rehearsed = new Set((a?.setPieces.items || []).filter((i) => i.rehearsed).map((i) => i.eventId));
  const have = new Set(existing.map((c) => c.eventId).filter(Boolean));
  const out: Clip[] = [];
  for (const e of events) {
    if (e.status === "rejected") continue;
    if (!includePending && e.status === "pending") continue;
    if (have.has(e.id)) continue;
    const cat = categoryFor(e, rehearsed);
    if (!cat) continue;
    const start = Math.max(0, e.t - before);
    const end = Math.max(e.tEnd ?? e.t, e.t) + after + (cat === "Jogadas ensaiadas" || cat === "Bolas paradas" ? 6 : 0);
    const pname = nameOf(e.player);
    const teamName = e.team && a ? a.teams[e.team]?.name : e.team || "";
    out.push({
      id: uid("c"),
      title: `${e.label}${pname ? ` — ${pname}` : ""}`,
      category: cat,
      start,
      end,
      team: (e.team as TeamKey) || null,
      player: e.player || null,
      description: [teamName, e.source === "auto" ? `Deteção automática (${e.kind}, confiança ${(e.confidence * 100).toFixed(0)}%)` : "Marcação manual", e.status === "pending" ? "por confirmar" : ""]
        .filter(Boolean)
        .join(" · "),
      eventId: e.id,
      source: e.source,
      createdAt: Date.now(),
    });
  }
  return out;
}
