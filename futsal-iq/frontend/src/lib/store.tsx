import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Health } from "./api";
import { db } from "./db";
import { loadSettings, saveSettings, type Settings } from "./settings";
import type { Analysis, Project, UserData } from "./types";
import { emptyUserData } from "./types";

interface Ctx {
  settings: Settings;
  setSettings: (s: Settings) => void;
  health: Health | null;
  online: boolean;
  projects: Project[];
  refreshProjects: () => Promise<void>;
  currentId: string | null;
  setCurrentId: (id: string | null) => void;
  toast: (msg: string, kind?: "ok" | "error") => void;
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings());
  const [health, setHealth] = useState<Health | null>(null);
  const [online, setOnline] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCur] = useState<string | null>(() => {
    try {
      return localStorage.getItem("futsaliq.current");
    } catch {
      return null;
    }
  });
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);

  const toast = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);

  const refreshProjects = useCallback(async () => {
    const local = await db.allProjects();
    try {
      const remote = await api.listProjects();
      setOnline(true);
      for (const p of remote) {
        const prev = local.find((l) => l.id === p.id);
        await db.putProject({ ...prev, ...p });
        // cache analysis locally when available and newer
        if (p.hasAnalysis) {
          const cached = await db.getAnalysis(p.id);
          if (!cached) {
            try {
              await db.putAnalysis(p.id, await api.analysis(p.id));
            } catch {
              /* ignore */
            }
          }
        }
      }
      const remoteIds = new Set(remote.map((p) => p.id));
      const merged = [...remote, ...local.filter((l) => !remoteIds.has(l.id))];
      setProjects(merged.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch {
      setOnline(false);
      setProjects(local);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const h = await api.health();
        if (alive) {
          setHealth(h);
          setOnline(true);
        }
      } catch {
        if (alive) {
          setHealth(null);
          setOnline(false);
        }
      }
    };
    ping();
    refreshProjects();
    const t = setInterval(ping, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refreshProjects, settings.apiBase]);

  const setSettings = (s: Settings) => {
    saveSettings(s);
    setSettingsState(s);
  };
  const setCurrentId = (id: string | null) => {
    setCur(id);
    try {
      if (id) localStorage.setItem("futsaliq.current", id);
      else localStorage.removeItem("futsaliq.current");
    } catch {
      /* ignore */
    }
  };

  const value = useMemo(
    () => ({ settings, setSettings, health, online, projects, refreshProjects, currentId, setCurrentId, toast }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, health, online, projects, refreshProjects, currentId, toast],
  );

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 print:hidden">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`max-w-sm rounded-lg border px-4 py-3 text-sm shadow-xl ${
              t.kind === "error" ? "border-red-500/40 bg-red-950/90 text-red-100" : "border-neon/30 bg-ink-800/95 text-white"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

/** Loads a project with its analysis and analyst data; keeps IndexedDB in sync. */
export function useProjectData(id: string | null | undefined) {
  const { online } = useApp();
  const [project, setProject] = useState<Project | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | undefined>(undefined);
  const [user, setUserState] = useState<UserData>(emptyUserData());
  const [loading, setLoading] = useState(true);
  const userRef = useRef(user);
  userRef.current = user;

  const reload = useCallback(async () => {
    if (!id) {
      setProject(null);
      setAnalysis(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    const cached = await db.getProject(id);
    let p = cached || null;
    if (online && !cached?.localOnly) {
      try {
        p = await api.getProject(id);
        await db.putProject(p);
      } catch {
        /* keep cached */
      }
    }
    setProject(p);
    let a = await db.getAnalysis(id);
    if (online && p?.hasAnalysis && !p.localOnly) {
      try {
        const fresh = await api.analysis(id);
        if (!a || fresh.generatedAt !== a.generatedAt) {
          a = fresh;
          await db.putAnalysis(id, fresh);
        }
      } catch {
        /* offline */
      }
    }
    setAnalysis(a);
    setUserState(await db.getUser(id));
    setLoading(false);
  }, [id, online]);

  useEffect(() => {
    reload();
  }, [reload]);

  const setUser = useCallback(
    (fn: (u: UserData) => UserData) => {
      if (!id) return;
      const next = fn(userRef.current);
      userRef.current = next;
      setUserState(next);
      db.putUser(id, next);
    },
    [id],
  );

  return { project, setProject, analysis, setAnalysis, user, setUser, loading, reload };
}
