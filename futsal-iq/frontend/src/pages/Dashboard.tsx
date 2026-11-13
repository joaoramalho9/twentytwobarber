import { ArrowRight, Loader2, PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Empty, PageHeader, Stat, TeamDot } from "../components/ui";
import { db } from "../lib/db";
import { fmtTime } from "../lib/format";
import { useApp } from "../lib/store";
import type { Analysis, Project, UserData } from "../lib/types";

interface Row {
  p: Project;
  a?: Analysis;
  u: UserData;
}

export default function Dashboard() {
  const { projects, setCurrentId, online } = useApp();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      const out: Row[] = [];
      for (const p of projects) out.push({ p, a: await db.getAnalysis(p.id), u: await db.getUser(p.id) });
      setRows(out);
    })();
  }, [projects]);

  const analysed = rows.filter((r) => r.a);
  const teams = new Set<string>();
  rows.forEach((r) => {
    teams.add(r.p.teamA.name.trim().toLowerCase());
    teams.add(r.p.teamB.name.trim().toLowerCase());
  });
  const players = analysed.reduce((s, r) => s + r.a!.players.filter((p) => p.team !== "other").length, 0);
  let goalsConfirmed = 0;
  let goalsCandidates = 0;
  rows.forEach((r) => {
    (r.a?.events || []).forEach((e) => {
      if (e.type !== "goal") return;
      const st = r.u.review[e.id];
      if (st === "confirmed") goalsConfirmed++;
      else if (st !== "rejected") goalsCandidates++;
    });
    goalsConfirmed += r.u.manualEvents.filter((e) => e.type === "goal").length;
  });
  const clips = rows.reduce((s, r) => s + r.u.clips.length, 0);

  const open = (id: string) => {
    setCurrentId(id);
    nav(`/jogo/${id}`);
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral dos jogos analisados neste computador."
        actions={
          <Link to="/novo">
            <Button variant="primary" className="px-6 py-3 text-base tracking-wide">
              <PlayCircle size={20} /> ANALISAR NOVO JOGO
            </Button>
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Jogos analisados" value={analysed.length} hint={`${rows.length} projetos no total`} accent />
        <Stat label="Equipas" value={teams.size} hint="nomes distintos nos projetos" />
        <Stat label="Jogadores identificados" value={players} hint="identidades provisórias por tracking" />
        <Stat label="Golos" value={goalsConfirmed} hint={`confirmados · ${goalsCandidates} candidatos por rever`} />
        <Stat label="Clips criados" value={clips} />
      </div>

      <div className="mt-8">
        <Card title="Últimas análises" actions={!online && <span className="text-xs text-amber-300">Motor de análise desligado — a mostrar dados locais</span>}>
          {rows.length === 0 ? (
            <Empty title="Ainda não há jogos" action={<Link to="/novo"><Button variant="primary">Criar o primeiro jogo</Button></Link>}>
              Carregue o vídeo de um jogo (ou associe um link do YouTube) para iniciar a análise.
            </Empty>
          ) : (
            <div className="divide-y divide-ink-800">
              {rows.slice(0, 12).map(({ p, a, u }) => {
                const running = p.job?.status === "running" || p.job?.status === "queued";
                return (
                  <button key={p.id} onClick={() => open(p.id)} className="flex w-full flex-wrap items-center gap-4 py-3 text-left hover:bg-ink-850/60 md:flex-nowrap">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-400">
                        <TeamDot color={a?.teams.A.color || p.teamA.color} /> {p.teamA.name}
                        <span className="text-ink-600">vs</span>
                        <TeamDot color={a?.teams.B.color || p.teamB.color} /> {p.teamB.name}
                        {p.date && <span>· {p.date}</span>}
                      </div>
                    </div>
                    <div className="text-xs text-ink-400">
                      {p.video ? `Vídeo ${fmtTime(p.video.info.duration)}` : p.youtubeUrl ? "Só YouTube (incorporado)" : "Sem vídeo"}
                    </div>
                    <div className="w-44 text-right text-xs">
                      {running ? (
                        <span className="inline-flex items-center gap-1 text-neon">
                          <Loader2 size={12} className="animate-spin" /> {Math.round((p.job?.progress || 0) * 100)}% · {p.job?.stage}
                        </span>
                      ) : a ? (
                        <span className="text-neon">Análise disponível · {a.players.filter((x) => x.team !== "other").length} jogadores</span>
                      ) : p.job?.status === "cancelled" || p.job?.status === "interrupted" ? (
                        <span className="text-amber-300">Interrompida — pode retomar</span>
                      ) : p.job?.status === "error" ? (
                        <span className="text-red-300">Erro no processamento</span>
                      ) : (
                        <span className="text-ink-500">{u.manualEvents.length ? `${u.manualEvents.length} eventos manuais` : "Por analisar"}</span>
                      )}
                    </div>
                    <ArrowRight size={16} className="text-ink-500" />
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
