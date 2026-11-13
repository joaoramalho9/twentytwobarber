"""Single-worker background job queue (video processing is CPU-bound: one at a time)."""
from __future__ import annotations

import queue
import threading
import time
import traceback

from . import analyze, detect, storage, video, youtube


class JobManager:
    def __init__(self):
        self.q: queue.Queue = queue.Queue()
        self.state: dict[str, dict] = {}
        self.cancel_flags: dict[str, threading.Event] = {}
        self.lock = threading.Lock()
        self.worker = threading.Thread(target=self._loop, daemon=True)
        self.worker.start()

    # -- public -------------------------------------------------------------
    def status(self, pid: str) -> dict:
        with self.lock:
            st = dict(self.state[pid]) if pid in self.state else None
        if st:
            base = st
        else:
            saved = storage.read_json(storage.project_dir(pid) / "job.json")
            if saved and saved.get("status") in ("queued", "running"):
                saved["status"] = "interrupted"  # server restarted mid-job
                saved["message"] = "Processo interrompido (servidor reiniciado). Pode retomar a análise."
            base = saved or {"status": "idle"}
        ck = detect.checkpoint(pid)
        if ck:
            base["checkpoint"] = {"done": ck.get("done"), "nextFrame": ck.get("next_frame"),
                                  "startF": ck.get("start_f"), "endF": ck.get("end_f"), "params": ck.get("params")}
        return base

    def submit(self, pid: str, kind: str, payload: dict | None = None) -> dict:
        with self.lock:
            cur = self.state.get(pid)
            if cur and cur["status"] in ("queued", "running"):
                raise RuntimeError("Já existe um processamento em curso para este projeto.")
            self.cancel_flags[pid] = threading.Event()
            st = {"status": "queued", "kind": kind, "stage": "Na fila", "progress": 0.0, "message": "",
                  "detail": {}, "startedAt": time.time(), "error": None}
            self.state[pid] = st
        self._persist(pid)
        self.q.put((pid, kind, payload or {}))
        return st

    def cancel(self, pid: str) -> bool:
        ev = self.cancel_flags.get(pid)
        if ev:
            ev.set()
            return True
        return False

    # -- internals ------------------------------------------------------------
    def _persist(self, pid):
        try:
            storage.write_json(storage.project_dir(pid) / "job.json", self.state[pid])
        except Exception:
            pass

    def _update(self, pid, **kw):
        with self.lock:
            self.state[pid].update(kw)
        self._persist(pid)

    def _loop(self):
        while True:
            pid, kind, payload = self.q.get()
            cancelled = self.cancel_flags[pid].is_set
            if cancelled():
                self._update(pid, status="cancelled", stage="Cancelado", message="Cancelado antes de iniciar.")
                continue
            self._update(pid, status="running")
            try:
                if kind == "youtube":
                    self._youtube(pid, payload, cancelled)
                elif kind == "full":
                    self._full(pid, payload, cancelled)
                elif kind == "analyze":
                    self._analyze(pid)
                elif kind == "transcode":
                    self._transcode(pid, cancelled)
                self._update(pid, status="done", progress=1.0, stage="Concluído", finishedAt=time.time())
            except detect.Cancelled:
                self._update(pid, status="cancelled", stage="Interrompido",
                             message="Análise interrompida. O progresso foi guardado — pode retomar.")
            except youtube.YouTubeError as e:
                self._update(pid, status="error", error=str(e), stage="Erro")
            except Exception as e:  # report readable errors to the UI
                traceback.print_exc()
                self._update(pid, status="error", error=f"{type(e).__name__}: {e}", stage="Erro")

    def _youtube(self, pid, payload, cancelled):
        d = storage.project_dir(pid)
        self._update(pid, stage="A descarregar do YouTube", progress=0.0)
        path = youtube.download(payload["url"], d, lambda p, m: self._update(pid, progress=p, stage=m), cancelled)
        info = video.probe(path)
        p = storage.load_project(pid)
        p["video"] = {"file": path.name, "info": info, "source": "youtube", "originalName": payload["url"]}
        storage.save_project(p)

    def _transcode(self, pid, cancelled):
        p = storage.load_project(pid)
        src = storage.video_path(pid)
        d = storage.project_dir(pid)
        dst = d / "video_h264.mp4"
        self._update(pid, stage="A converter o vídeo para MP4 (reprodução no browser)", progress=0.0)
        video.transcode_h264(src, dst, p["video"]["info"]["duration"],
                             lambda x: self._update(pid, progress=round(x, 4)), cancelled)
        final = d / "video.mp4"
        src.unlink(missing_ok=True)
        dst.replace(final)
        p = storage.load_project(pid)
        p["video"]["file"] = final.name
        p["video"]["info"] = video.probe(final)
        p["video"]["transcoded"] = True
        storage.save_project(p)

    def _full(self, pid, params, cancelled):
        def prog(p, stage, detail):
            self._update(pid, progress=round(0.95 * p, 4), stage=stage, detail=detail)
        detect.run(pid, params, prog, cancelled)
        if cancelled():
            raise detect.Cancelled()
        vp = storage.video_path(pid)
        d = storage.project_dir(pid)
        if not (d / "audio.json").exists():
            self._update(pid, stage="A extrair energia do áudio", progress=0.95)
            try:
                a = video.audio_energy(vp)
                if a:
                    storage.write_json(d / "audio.json", a)
            except Exception:
                pass
        self._analyze(pid, base=0.96)

    def _analyze(self, pid, base=0.0):
        def prog(p, stage, detail):
            self._update(pid, progress=round(base + (1 - base) * p, 4), stage=stage, detail=detail)
        analyze.run(pid, prog)


jobs = JobManager()
