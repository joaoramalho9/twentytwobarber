import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../lib/store";
import type { Kind } from "../lib/types";

export function Card({ title, actions, children, className = "", subtitle }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-ink-700 bg-ink-900/80 print:border-gray-300 print:bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700/70 px-4 py-3 print:border-gray-300">
          <div>
            {title && <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-white print:text-black">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "outline"; size?: "sm" | "md" };
export function Button({ variant = "outline", size = "md", className = "", ...rest }: BtnProps) {
  const v = {
    primary: "bg-neon text-ink-950 hover:bg-neon-600 font-semibold",
    outline: "border border-ink-600 text-white hover:border-neon/60 hover:text-neon",
    ghost: "text-ink-300 hover:text-white hover:bg-ink-800",
    danger: "border border-red-500/50 text-red-300 hover:bg-red-500/10",
  }[variant];
  const s = size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${v} ${s} ${className}`}
    />
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/80 p-4 print:border-gray-300 print:bg-white">
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-1 font-display text-3xl font-semibold ${accent ? "text-neon" : "text-white"} print:text-black`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-400">{hint}</div>}
    </div>
  );
}

const KIND_STYLE: Record<string, string> = {
  medição: "border-white/30 text-white",
  deteção: "border-neon/50 text-neon",
  estimativa: "border-amber-400/50 text-amber-300",
  interpretação: "border-sky-400/50 text-sky-300",
  manual: "border-fuchsia-400/50 text-fuchsia-300",
};

export function KindBadge({ kind, confidence, title }: { kind: Kind | "manual"; confidence?: number; title?: string }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KIND_STYLE[kind] || "border-ink-500 text-ink-300"}`}>
      {kind}
      {confidence != null && <span className="font-mono opacity-80">{Math.round(confidence * 100)}%</span>}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending: ["por confirmar", "border-amber-400/40 text-amber-300"],
    confirmed: ["confirmado", "border-neon/50 text-neon"],
    rejected: ["rejeitado", "border-red-500/40 text-red-300 line-through"],
    manual: ["manual", "border-fuchsia-400/50 text-fuchsia-300"],
  };
  const [t, c] = map[status] || [status, "border-ink-500 text-ink-300"];
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${c}`}>{t}</span>;
}

export function Progress({ value, label }: { value: number; label?: ReactNode }) {
  return (
    <div>
      {label && <div className="mb-1 flex justify-between text-xs text-ink-300">{label}</div>}
      <div className="h-2 overflow-hidden rounded-full bg-ink-700">
        <div className="h-full rounded-full bg-neon transition-all" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </div>
    </div>
  );
}

export function Bar({ value, color = "#39ff88", label, right }: { value: number; color?: string; label: ReactNode; right?: ReactNode }) {
  return (
    <div className="text-sm">
      <div className="mb-1 flex justify-between gap-2">
        <span className="text-ink-300 print:text-gray-700">{label}</span>
        <span className="font-mono text-white print:text-black">{right ?? `${Math.round(value * 100)}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-700 print:bg-gray-200">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-600 px-6 py-12 text-center">
      <div className="font-display text-lg font-semibold">{title}</div>
      {children && <div className="mt-2 max-w-lg text-sm text-ink-400">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-400">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

const inputBase = "rounded-lg border border-ink-600 bg-ink-850 px-3 text-white placeholder:text-ink-500 focus:border-neon/70 focus:outline-none";
export const inputCls = `w-full py-2 text-sm ${inputBase}`;
/** compact select/input for toolbars */
export const inputSm = `w-auto py-1 text-xs ${inputBase}`;

export function ProjectPicker({ value, onChange, onlyAnalysed }: { value: string | null; onChange: (id: string) => void; onlyAnalysed?: boolean }) {
  const { projects } = useApp();
  const list = onlyAnalysed ? projects.filter((p) => p.hasAnalysis || p.localOnly) : projects;
  return (
    <select className={`${inputCls} max-w-xs`} value={value || ""} onChange={(e) => onChange(e.target.value)} aria-label="Selecionar jogo">
      <option value="" disabled>
        Selecionar jogo…
      </option>
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} — {p.teamA.name} vs {p.teamB.name}
        </option>
      ))}
    </select>
  );
}

export function NeedProject({ children }: { children?: ReactNode }) {
  return (
    <Empty title="Nenhum jogo selecionado" action={<Link to="/novo"><Button variant="primary">Analisar novo jogo</Button></Link>}>
      {children || "Escolha um jogo na lista acima ou crie um novo."}
    </Empty>
  );
}

export function TeamDot({ color }: { color?: string | null }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/30" style={{ background: color || "#888" }} />;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-ink-700 print:hidden" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${value === t.id ? "border-neon text-white" : "border-transparent text-ink-400 hover:text-white"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
