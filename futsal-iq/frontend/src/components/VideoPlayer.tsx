import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { OverlayFrame } from "../lib/api";

export interface PlayerHandle {
  currentTime: () => number;
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  duration: () => number;
}

interface Props {
  src?: string | null;          // local video URL (backend)
  youtubeId?: string | null;    // official embedded player (ToS-compliant viewing)
  onTime?: (t: number) => void;
  overlay?: OverlayFrame[] | null;
  colors?: Record<string, string>;
  selectedPid?: string | null;
  onPersonClick?: (p: OverlayFrame["persons"][number]) => void;
  videoSize?: { width: number; height: number };
}

declare global {
  interface Window {
    YT?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytPromise: Promise<void> | null = null;
function loadYT(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => reject(new Error("Não foi possível carregar o leitor do YouTube (sem ligação?)."));
    window.onYouTubeIframeAPIReady = () => resolve();
    document.head.appendChild(s);
  });
  return ytPromise;
}

export const VideoPlayer = forwardRef<PlayerHandle, Props>(function VideoPlayer(
  { src, youtubeId, onTime, overlay, colors, selectedPid, onPersonClick, videoSize },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytHost = useRef<HTMLDivElement>(null);
  const yt = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ytError, setYtError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  useImperativeHandle(ref, () => ({
    currentTime: () => (src ? videoRef.current?.currentTime || 0 : yt.current?.getCurrentTime?.() || 0),
    seek: (time: number) => {
      if (src && videoRef.current) videoRef.current.currentTime = Math.max(0, time);
      else yt.current?.seekTo?.(Math.max(0, time), true);
    },
    play: () => (src ? videoRef.current?.play() : yt.current?.playVideo?.()),
    pause: () => (src ? videoRef.current?.pause() : yt.current?.pauseVideo?.()),
    toggle: () => {
      if (src && videoRef.current) videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause();
      else if (yt.current) yt.current.getPlayerState?.() === 1 ? yt.current.pauseVideo() : yt.current.playVideo();
    },
    duration: () => (src ? videoRef.current?.duration || 0 : yt.current?.getDuration?.() || 0),
  }));

  // YouTube embed
  useEffect(() => {
    if (src || !youtubeId || !ytHost.current) return;
    let cancelled = false;
    const host = document.createElement("div");
    ytHost.current.innerHTML = "";
    ytHost.current.appendChild(host);
    loadYT()
      .then(() => {
        if (cancelled) return;
        yt.current = new window.YT.Player(host, {
          videoId: youtubeId,
          width: "100%",
          height: "100%",
          host: "https://www.youtube-nocookie.com",
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onError: (e: { data: number }) =>
              setYtError(e.data === 101 || e.data === 150 ? "O proprietário não permite a reprodução incorporada deste vídeo. Use a importação de ficheiro." : `Erro do leitor do YouTube (${e.data}).`),
          },
        });
      })
      .catch((e) => setYtError(e.message));
    const timer = setInterval(() => {
      const tt = yt.current?.getCurrentTime?.();
      if (typeof tt === "number") {
        setT(tt);
        onTimeRef.current?.(tt);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearInterval(timer);
      try {
        yt.current?.destroy?.();
      } catch {
        /* ignore */
      }
      yt.current = null;
    };
  }, [src, youtubeId]);

  // Local video time updates (rAF for smooth overlay)
  useEffect(() => {
    if (!src) return;
    let raf = 0;
    let last = -1;
    const loop = () => {
      const v = videoRef.current;
      if (v && v.currentTime !== last) {
        last = v.currentTime;
        setT(last);
        onTimeRef.current?.(last);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [src]);

  // Draw overlay
  useEffect(() => {
    const cv = canvasRef.current;
    const v = videoRef.current;
    if (!cv || !v) return;
    const rect = v.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = rect.width * dpr;
    cv.height = rect.height * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!overlay?.length || !videoSize) return;
    // nearest frame within 0.3 s
    let best: OverlayFrame | null = null;
    let bd = 0.3;
    for (const f of overlay) {
      const d = Math.abs(f.t - t);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (!best) return;
    const s = Math.min(rect.width / videoSize.width, rect.height / videoSize.height);
    const ox = (rect.width - videoSize.width * s) / 2;
    const oy = (rect.height - videoSize.height * s) / 2;
    ctx.font = "600 11px Inter, sans-serif";
    for (const p of best.persons) {
      if (!p.pid) continue;
      const [x1, y1, x2, y2] = p.box;
      const col = colors?.[p.team] || "#9aa3ad";
      const sel = p.pid === selectedPid;
      ctx.strokeStyle = col;
      ctx.lineWidth = sel ? 3 : 1.5;
      ctx.strokeRect(ox + x1 * s, oy + y1 * s, (x2 - x1) * s, (y2 - y1) * s);
      const label = (p.role === "gk" ? "GR · " : "") + (p.name || "?");
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = "rgba(7,8,10,0.75)";
      ctx.fillRect(ox + x1 * s, oy + y1 * s - 16, tw, 15);
      ctx.fillStyle = col;
      ctx.fillText(label, ox + x1 * s + 4, oy + y1 * s - 5);
    }
    if (best.ball) {
      const [x1, y1, x2, y2] = best.ball.box;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ox + ((x1 + x2) / 2) * s, oy + ((y1 + y2) / 2) * s, Math.max(6, ((x2 - x1) / 2) * s + 3), 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [overlay, t, colors, selectedPid, videoSize]);

  const handleClick = (e: React.MouseEvent) => {
    if (!onPersonClick || !overlay?.length || !videoSize || !videoRef.current) return;
    const rect = videoRef.current.getBoundingClientRect();
    const s = Math.min(rect.width / videoSize.width, rect.height / videoSize.height);
    const ox = (rect.width - videoSize.width * s) / 2;
    const oy = (rect.height - videoSize.height * s) / 2;
    const px = (e.clientX - rect.left - ox) / s;
    const py = (e.clientY - rect.top - oy) / s;
    const best = overlay.reduce((a, f) => (Math.abs(f.t - t) < Math.abs(a.t - t) ? f : a), overlay[0]);
    const hit = best.persons.find((p) => p.pid && px >= p.box[0] && px <= p.box[2] && py >= p.box[1] && py <= p.box[3]);
    if (hit) {
      e.preventDefault();
      onPersonClick(hit);
    }
  };

  if (src) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} src={src} controls className="h-full w-full" preload="metadata" />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {onPersonClick && !!overlay?.length && (
          <div onClick={handleClick} className="absolute inset-x-0 top-0 bottom-14 cursor-crosshair" title="Clique num jogador para o selecionar" />
        )}
      </div>
    );
  }
  if (youtubeId) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        <div ref={ytHost} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />
        {ytError && <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center text-sm text-red-200">{ytError}</div>}
      </div>
    );
  }
  return (
    <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-ink-600 bg-ink-900 text-sm text-ink-400">
      Sem vídeo — carregue um ficheiro ou associe um link do YouTube.
    </div>
  );
});
