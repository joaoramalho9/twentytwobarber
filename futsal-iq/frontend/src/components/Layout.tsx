import { BarChart3, Clapperboard, FileText, LayoutDashboard, Menu, PlusCircle, Settings, Target, UserSearch, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useApp } from "../lib/store";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/novo", label: "Novo jogo", icon: PlusCircle },
  { to: "/tatica", label: "Análise tática", icon: Target },
  { to: "/scouting", label: "Scouting individual", icon: UserSearch },
  { to: "/clips", label: "Biblioteca de clips", icon: Clapperboard },
  { to: "/estatisticas", label: "Estatísticas", icon: BarChart3 },
  { to: "/relatorio", label: "Relatório", icon: FileText },
  { to: "/definicoes", label: "Definições", icon: Settings },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#111418" />
        <circle cx="16" cy="16" r="8.5" fill="none" stroke="#39ff88" strokeWidth="2.6" />
        <path d="M16 7.5v17M7.5 16h17" stroke="#39ff88" strokeWidth="1.2" opacity=".5" />
      </svg>
      <div className="font-display text-lg font-bold tracking-tight">
        FUTSAL <span className="text-neon">IQ</span>
      </div>
    </div>
  );
}

export default function Layout() {
  const { online, health } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
              isActive ? "bg-neon/10 text-neon" : "text-ink-300 hover:bg-ink-800 hover:text-white"
            }`
          }
        >
          <n.icon size={18} strokeWidth={1.8} />
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
  const status = (
    <div className="rounded-lg border border-ink-700 p-3 text-xs">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${online ? "bg-neon" : "bg-red-500"}`} />
        <span className="text-ink-300">{online ? "Motor de análise ligado" : "Motor de análise desligado"}</span>
      </div>
      {online && health && (
        <div className="mt-1 text-ink-500">
          {health.device?.toUpperCase()} · FFmpeg {health.ffmpeg ? "✓" : "✗"} · yt-dlp {health.ytdlp ? "✓" : "✗"}
        </div>
      )}
      {!online && <div className="mt-1 text-ink-500">Só dados guardados no browser.</div>}
    </div>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-ink-800 bg-ink-950 p-4 lg:flex print:hidden">
        <div className="space-y-8">
          <Logo />
          {nav}
        </div>
        {status}
      </aside>
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-ink-800 bg-ink-950/95 px-4 py-3 backdrop-blur lg:hidden print:hidden">
        <Logo />
        <button aria-label="Menu" onClick={() => setOpen(!open)} className="rounded-lg p-2 text-ink-300 hover:bg-ink-800">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-30 bg-ink-950/98 px-4 pt-20 lg:hidden">
          {nav}
          <div className="mt-6">{status}</div>
        </div>
      )}
      <main key={loc.pathname} className="min-w-0 flex-1 px-4 pb-16 pt-20 md:px-8 lg:pt-8">
        <Outlet />
      </main>
    </div>
  );
}
