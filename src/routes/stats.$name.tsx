import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getStoredPlayer, type StoredPlayer } from "@/lib/player";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/TopNav";

export const Route = createFileRoute("/stats/$name")({
  head: () => ({
    meta: [
      { title: "Vanguard.OS — Service record" },
      { name: "description", content: "Career battle statistics for a Vanguard.OS operator." },
    ],
  }),
  component: StatsPage,
});

type PlayerRow = {
  id: string;
  display_name: string;
  wins: number;
  losses: number;
  shots_fired: number;
  shots_hit: number;
  ships_sunk: number;
  games_played: number;
  created_at: string;
};

type GameHistory = {
  id: string;
  session_name: string;
  status: string;
  grid_size: number;
  winner_id: string | null;
  host_id: string;
  guest_id: string | null;
  created_at: string;
};

function StatsPage() {
  const { name } = useParams({ from: "/stats/$name" });
  const [me, setMe] = useState<StoredPlayer | null>(null);
  const [row, setRow] = useState<PlayerRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [history, setHistory] = useState<GameHistory[]>([]);
  const [opponents, setOpponents] = useState<Record<string, string>>({});

  useEffect(() => { setMe(getStoredPlayer()); }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from("players").select("*").eq("display_name", name).maybeSingle();
      if (!alive) return;
      if (!data) { setNotFound(true); return; }
      setRow(data as PlayerRow);
      const { data: games } = await supabase
        .from("games")
        .select("id,session_name,status,grid_size,winner_id,host_id,guest_id,created_at")
        .or(`host_id.eq.${data.id},guest_id.eq.${data.id}`)
        .order("created_at", { ascending: false })
        .limit(20);
      const rows = (games ?? []) as GameHistory[];
      setHistory(rows);
      const others = Array.from(new Set(rows.flatMap((g) => [g.host_id, g.guest_id]).filter((x): x is string => !!x && x !== data.id)));
      if (others.length) {
        const { data: ps } = await supabase.from("players").select("id,display_name").in("id", others);
        const m: Record<string, string> = {};
        (ps ?? []).forEach((p: { id: string; display_name: string }) => { m[p.id] = p.display_name; });
        setOpponents(m);
      }
    })();
    return () => { alive = false; };
  }, [name]);

  if (notFound) {
    return (
      <div className="min-h-screen">
        <TopNav player={me} />
        <div className="max-w-xl mx-auto p-16 text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-warning mb-3">operator_unknown</div>
          <h2 className="text-3xl font-bold">No record for “{name}”.</h2>
        </div>
      </div>
    );
  }
  if (!row) return null;

  const accuracy = row.shots_fired > 0 ? Math.round((row.shots_hit / row.shots_fired) * 100) : 0;
  const winRate = row.games_played > 0 ? Math.round((row.wins / row.games_played) * 100) : 0;

  return (
    <div className="min-h-screen">
      <TopNav player={me} />
      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <Link to="/lobby" className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink-mute hover:text-phosphor">
            ← Back to lobby
          </Link>
        </div>

        <header className="mb-10 flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-phosphor mb-3">service_record</div>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tighter">{row.display_name}</h1>
            <p className="text-sm text-ink-dim mt-2 font-mono">
              Commissioned {new Date(row.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase font-mono tracking-[0.25em] text-ink-mute">win rate</div>
            <div className="text-5xl font-bold text-phosphor tracking-tighter">{winRate}<span className="text-2xl text-ink-mute">%</span></div>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          <Stat label="Games" value={row.games_played} />
          <Stat label="Victories" value={row.wins} tone="ok" />
          <Stat label="Defeats" value={row.losses} tone="warn" />
          <Stat label="Accuracy" value={`${accuracy}%`} />
          <Stat label="Shots fired" value={row.shots_fired} />
          <Stat label="Shots hit" value={row.shots_hit} />
          <Stat label="Ships sunk" value={row.ships_sunk} />
          <Stat label="W/L ratio" value={row.losses > 0 ? (row.wins / row.losses).toFixed(2) : row.wins.toString()} />
        </div>

        <section>
          <h3 className="text-sm font-bold uppercase tracking-[0.25em] text-ink-mute mb-4">Recent engagements</h3>
          {history.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-10 text-center text-ink-dim">
              No recorded engagements yet.
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((g) => {
                const otherId = g.host_id === row.id ? g.guest_id : g.host_id;
                const otherName = otherId ? (opponents[otherId] ?? "…") : "—";
                const outcome = g.status !== "finished" ? g.status.toUpperCase()
                  : g.winner_id === row.id ? "VICTORY" : "DEFEAT";
                const outcomeCls = outcome === "VICTORY" ? "text-phosphor" : outcome === "DEFEAT" ? "text-hit" : "text-ink-dim";
                return (
                  <div key={g.id} className="p-4 bg-panel/60 border border-border rounded-xl flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold">{g.session_name}</div>
                      <div className="text-[10px] font-mono text-ink-mute mt-0.5 uppercase">
                        vs {otherName} · {g.grid_size}×{g.grid_size} · {new Date(g.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className={`font-mono text-xs font-bold ${outcomeCls}`}>{outcome}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-phosphor" : tone === "warn" ? "text-hit" : "text-ink";
  return (
    <div className="bg-panel border border-border rounded-xl p-4">
      <div className="text-[10px] uppercase font-mono tracking-[0.25em] text-ink-mute">{label}</div>
      <div className={`text-3xl font-bold tracking-tighter mt-1 ${color}`}>{value}</div>
    </div>
  );
}
