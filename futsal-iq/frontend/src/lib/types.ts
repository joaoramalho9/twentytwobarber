export type TeamKey = "A" | "B";
export type Kind = "medição" | "deteção" | "estimativa" | "interpretação";

export interface VideoInfo {
  duration: number;
  fps: number;
  width: number;
  height: number;
  codec?: string | null;
  hasAudio?: boolean;
}

export interface Calibration {
  t: number;
  points: { landmark: string; x: number; y: number }[];
  H: number[][];
  errorM: number;
}

export interface Corrections {
  merge: string[][];
  names: Record<string, string>;
  team: Record<string, string>;
  role: Record<string, string>;
  hidden: string[];
  swapTeams?: boolean;
}

export interface JobState {
  status: "idle" | "queued" | "running" | "done" | "error" | "cancelled" | "interrupted";
  kind?: string;
  stage?: string;
  progress?: number;
  message?: string;
  error?: string | null;
  detail?: { framesDone?: number; framesTotal?: number; fps?: number; etaS?: number | null; videoT?: number };
  checkpoint?: { done: boolean; nextFrame: number; startF: number; endF: number; params: Record<string, unknown> };
}

export interface Project {
  id: string;
  name: string;
  competition: string;
  date: string;
  teamA: { name: string; color: string | null };
  teamB: { name: string; color: string | null };
  youtubeUrl: string | null;
  youtubeId?: string | null;
  video: { file: string; info: VideoInfo; source: string; originalName?: string } | null;
  court: { length: number; width: number };
  calibrations: Calibration[];
  halfTimeS: number | null;
  corrections: Corrections;
  createdAt: number;
  updatedAt: number;
  hasAnalysis?: boolean;
  job?: JobState;
  localOnly?: boolean;
}

export interface AEvent {
  id: string;
  type: string;
  label: string;
  t: number;
  tEnd?: number;
  team?: TeamKey | null;
  player?: string | null;
  to?: string | null;
  lostBy?: string | null;
  lostTeam?: TeamKey | null;
  xy?: [number, number] | null;
  xyEnd?: [number, number] | null;
  kind: Kind;
  confidence: number;
  method?: string;
  source: "auto" | "manual";
  setPiece?: boolean;
  dangerZone?: boolean | null;
  onTarget?: boolean;
  speedKmh?: number;
  note?: string;
  [k: string]: unknown;
}

export interface EvalEntry {
  label: string;
  category: string;
  value: number | null;
  sample: number;
  sampleKey: string;
  minSample: number;
  status: string;
  percentile?: number;
}

export interface PlayerA {
  id: string;
  name: string;
  autoName: string;
  customName: string | null;
  team: TeamKey | "other";
  role: "field" | "gk" | "other";
  roleSource: string;
  tracklets: number;
  stats: Record<string, number | null>;
  heatmap: number[][] | null;
  path: [number, number, number][];
  meanPosition: [number, number] | null;
  positionalRole?: string;
  evaluation: Record<string, EvalEntry>;
  strengths: { metric: string; label: string; text: string; percentile: number }[];
  weaknesses: { metric: string; label: string; text: string; percentile: number }[];
  recommendations: string[];
  notMeasurable: Record<string, string[]>;
}

export interface TeamSummary {
  possessionAnalysedS: number;
  spells: number;
  attackSystems: Record<string, number>;
  powerPlayS: number;
  defenceBlocks: Record<string, number>;
  defenceShapes: Record<string, number>;
  marking: Record<string, number>;
  coverPct: number | null;
  lanesClosedPct: number | null;
  blockDepthM: number | null;
  defWidthM: number | null;
  defDepthM: number | null;
  superiorityPct: number | null;
  swapsPerMin: number | null;
}

export interface SetPieceItem {
  eventId: string;
  t: number;
  type: string;
  label: string;
  team: TeamKey | null;
  taker: string | null;
  ballXY: [number, number] | null;
  initialPositions: Record<string, [number, number]> | null;
  movements: Record<string, [number, number, number][]> | null;
  passes: { t: number; from: string; to: string }[];
  finish: { t: number; player: string | null; onTarget?: boolean } | null;
  result: string;
  detectionConfidence: number;
  rehearsed: boolean;
  patternId: string | null;
  patternSimilarityM: number | null;
  rehearsedConfidence: number;
}

export interface Insight {
  section: string;
  team: TeamKey | null;
  text: string;
  kind: Kind;
  confidence: number;
  evidence: string;
}

export interface Analysis {
  version: number;
  projectId: string;
  generatedAt: number;
  params: Record<string, unknown>;
  coverage: {
    framesAnalysed: number;
    sampleDt: number;
    analysedFromS: number;
    analysedToS: number;
    calibratedPct: number;
    validPct: number;
    widePct: number;
    ballDetectedPct: number;
    tracklets: number;
    segments: number;
  };
  warnings: string[];
  teams: Record<TeamKey, { name: string; color: string | null; colorSource: string; direction: Record<string, number>; possessionS: number }>;
  players: PlayerA[];
  events: AEvent[];
  tactics: { spells: Record<string, unknown>[]; summary: Record<TeamKey, TeamSummary> };
  transitions: Record<TeamKey, { offensive: number; counter: number; defensive: number; counterPress: number; regained5s: number }>;
  buildUp: Record<TeamKey, { count: number; reachedMidfield: number; reachedFinalThird: number; lostOwnHalf: number }>;
  setPieces: { items: SetPieceItem[]; patterns: { id: string; team: TeamKey; type: string; occurrences: string[]; times: number[]; meanDistanceM: number; confidence: number; results: string[] }[]; method: string };
  insights: Insight[];
  recommendations: { team: TeamKey; text: string; basis: string }[];
  possessionTimeline: { t: number; A: number; B: number }[];
  court: { length: number; width: number };
}

export type ReviewStatus = "pending" | "confirmed" | "rejected";

export interface Clip {
  id: string;
  title: string;
  category: string;
  start: number;
  end: number;
  team: TeamKey | null;
  player: string | null;
  description: string;
  eventId?: string;
  source: "auto" | "manual";
  createdAt: number;
}

/** Everything the analyst adds/edits — stored only in the browser (IndexedDB). */
export interface UserData {
  review: Record<string, ReviewStatus>;
  eventEdits: Record<string, Partial<AEvent>>;
  manualEvents: AEvent[];
  clips: Clip[];
  ratings: Record<string, Record<string, number>>; // playerId -> item -> 1..5
  playerNotes: Record<string, string>;
  reportNotes: Record<string, string>;
}

export const emptyUserData = (): UserData => ({
  review: {},
  eventEdits: {},
  manualEvents: [],
  clips: [],
  ratings: {},
  playerNotes: {},
  reportNotes: {},
});
