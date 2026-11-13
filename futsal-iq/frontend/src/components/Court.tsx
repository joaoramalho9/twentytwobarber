import type { ReactNode } from "react";

/** Futsal court in SVG, court coordinates in metres (x: 0..L, y: 0..W). */
export function Court({ L = 40, W = 20, children, className = "", half }: { L?: number; W?: number; children?: ReactNode; className?: string; half?: "right" }) {
  const pad = 1.2;
  const x0 = half === "right" ? L / 2 - pad : -pad;
  const vw = half === "right" ? L / 2 + 2 * pad : L + 2 * pad;
  const c = W / 2;
  const line = { stroke: "currentColor", strokeWidth: 0.12, fill: "none" };
  const area = (side: 0 | 1) => {
    const sx = (x: number) => (side === 0 ? x : L - x);
    const pts: string[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = -Math.PI / 2 + (i / 16) * (Math.PI / 2);
      pts.push(`${sx(6 * Math.cos(a))},${c - 1.5 + 6 * Math.sin(a)}`);
    }
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2);
      pts.push(`${sx(6 * Math.cos(a))},${c + 1.5 + 6 * Math.sin(a)}`);
    }
    return <polyline points={pts.join(" ")} {...line} />;
  };
  return (
    <svg viewBox={`${x0} ${-pad} ${vw} ${W + 2 * pad}`} className={`w-full text-white/35 print:text-gray-500 ${className}`} role="img" aria-label="Campo de futsal">
      <rect x={x0} y={-pad} width={vw} height={W + 2 * pad} fill="#0b1a12" className="print:fill-white" />
      <rect x={0} y={0} width={L} height={W} {...line} />
      <line x1={L / 2} y1={0} x2={L / 2} y2={W} {...line} />
      <circle cx={L / 2} cy={c} r={3} {...line} />
      <circle cx={L / 2} cy={c} r={0.12} fill="currentColor" />
      {area(0)}
      {area(1)}
      {[6, 10, L - 6, L - 10].map((x) => (
        <circle key={x} cx={x} cy={c} r={0.12} fill="currentColor" />
      ))}
      <rect x={-1} y={c - 1.5} width={1} height={3} {...line} />
      <rect x={L} y={c - 1.5} width={1} height={3} {...line} />
      {children}
    </svg>
  );
}

export function Heat({ grid, L = 40, W = 20, color = "57,255,136" }: { grid: number[][]; L?: number; W?: number; color?: string }) {
  const rows = grid.length;
  const cols = grid[0]?.length || 0;
  const cw = L / cols;
  const ch = W / rows;
  return (
    <g>
      {grid.map((row, j) =>
        row.map((v, i) =>
          v > 0.02 ? <rect key={`${i}-${j}`} x={i * cw} y={j * ch} width={cw} height={ch} fill={`rgba(${color},${Math.min(0.85, 0.12 + v * 0.75)})`} /> : null,
        ),
      )}
    </g>
  );
}

export function Path({ pts, color = "#39ff88" }: { pts: [number, number, number][]; color?: string }) {
  if (pts.length < 2) return null;
  // break the polyline where consecutive samples are far apart in time (player not visible)
  const segs: string[][] = [[]];
  for (let k = 0; k < pts.length; k++) {
    if (k && pts[k][0] - pts[k - 1][0] > 3) segs.push([]);
    segs[segs.length - 1].push(`${pts[k][1]},${pts[k][2]}`);
  }
  return (
    <g>
      {segs.filter((s) => s.length > 1).map((s, i) => (
        <polyline key={i} points={s.join(" ")} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={0.12} />
      ))}
    </g>
  );
}

export function hexToRgb(hex?: string | null): string {
  if (!hex) return "57,255,136";
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
}
