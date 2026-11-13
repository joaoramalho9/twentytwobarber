/** Browser-local storage (IndexedDB) for projects, analyses and analyst work. */
import { createStore, del, get, keys, set } from "idb-keyval";
import type { Analysis, Project, UserData } from "./types";
import { emptyUserData } from "./types";

const projects = createStore("futsaliq-projects", "kv");
const analyses = createStore("futsaliq-analyses", "kv");
const userdata = createStore("futsaliq-userdata", "kv");

export const db = {
  async allProjects(): Promise<Project[]> {
    const ks = await keys(projects);
    const out: Project[] = [];
    for (const k of ks) {
      const p = await get<Project>(k, projects);
      if (p) out.push(p);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  getProject: (id: string) => get<Project>(id, projects),
  putProject: (p: Project) => set(p.id, p, projects),
  async deleteProject(id: string) {
    await del(id, projects);
    await del(id, analyses);
    await del(id, userdata);
  },
  getAnalysis: (id: string) => get<Analysis>(id, analyses),
  putAnalysis: (id: string, a: Analysis) => set(id, a, analyses),
  async getUser(id: string): Promise<UserData> {
    return { ...emptyUserData(), ...((await get<UserData>(id, userdata)) || {}) };
  },
  putUser: (id: string, u: UserData) => set(id, u, userdata),

  async exportAll(): Promise<string> {
    const ps = await db.allProjects();
    const out = [];
    for (const p of ps) out.push({ project: p, analysis: await db.getAnalysis(p.id), user: await db.getUser(p.id) });
    return JSON.stringify({ app: "futsal-iq", version: 1, exportedAt: new Date().toISOString(), items: out });
  },
  async importAll(text: string): Promise<number> {
    const data = JSON.parse(text);
    if (data.app !== "futsal-iq" || !Array.isArray(data.items)) throw new Error("Ficheiro de exportação inválido.");
    for (const it of data.items) {
      await db.putProject(it.project);
      if (it.analysis) await db.putAnalysis(it.project.id, it.analysis);
      if (it.user) await db.putUser(it.project.id, it.user);
    }
    return data.items.length;
  },
};
