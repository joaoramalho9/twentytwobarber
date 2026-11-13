export interface Settings {
  apiBase: string; // "" = same origin (served by backend or Vite proxy)
  analysis: {
    sample_fps: number;
    model: string;
    imgsz: number;
    person_conf: number;
    ball_conf: number;
    camera_mode: "static" | "moving";
  };
  clipPadBefore: number;
  clipPadAfter: number;
  minConfidenceShown: number;
  showOverlayByDefault: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  apiBase: "",
  analysis: { sample_fps: 5, model: "yolo11n.pt", imgsz: 960, person_conf: 0.25, ball_conf: 0.1, camera_mode: "moving" },
  clipPadBefore: 6,
  clipPadAfter: 4,
  minConfidenceShown: 0,
  showOverlayByDefault: true,
};

const KEY = "futsaliq.settings.v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...s, analysis: { ...DEFAULT_SETTINGS.analysis, ...(s.analysis || {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings live for this session only */
  }
}
