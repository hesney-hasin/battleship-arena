import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { getStoredPlayer, type StoredPlayer } from "@/lib/player";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/TopNav";
import { DEFAULT_FLEETS, randomPlacement, totalShipCells, type ShipSpec } from "@/lib/battleship";
import { toast } from "sonner";


export const Route = createFileRoute("/lobby")({
  head: () => ({
    meta: [
      { title: "Vanguard.OS — Lobby" },
      { name: "description", content: "Live Battleship sessions. Create your own or join an open sector." },
    ],
  }),
  component: Lobby,
});

type GameRow = {
  id: string;
  code: string;
  session_name: string;
  status: string;
  grid_size: number;
  ship_config: ShipSpec[];
  host_id: string;
  guest_id: string | null;
  created_at: string;
};

const SIZE_OPTIONS = [8, 10, 12, 14];

function randomCode() {
  const s = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += s[Math.floor(Math.random() * s.length)];
  return out;
}

function Lobby() {
  const navigate = useNavigate();
  const [player, setPlayer] = useState<StoredPlayer | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);
  const [hostNames, setHostNames] = useState<Record<string, string>>({});

  const [size, setSize] = useState(10);
  const [fleet, setFleet] = useState<ShipSpec[]>(DEFAULT_FLEETS[10]);
  const [sessionName, setSessionName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const p = getStoredPlayer();
    if (!p) { navigate({ to: "/" }); return; }
    setPlayer(p);
  }, [navigate]);

  useEffect(() => {
    setFleet(DEFAULT_FLEETS[size]);
  }, [size]);

  async function loadGames() {
    const { data } = await supabase
      .from("games")
      .select("id,code,session_name,status,grid_size,ship_config,host_id,guest_id,created_at")
      .in("status", ["waiting", "placing", "playing"])
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = (data ?? []) as GameRow[];
    // Filter out single-player (bot) games from the public sector list.
    const allIds = Array.from(new Set(rows.flatMap((r) => [r.host_id, r.guest_id].filter(Boolean) as string[])));
    let botIds = new Set<string>();
    const map: Record<string, string> = {};
    if (allIds.length) {
      const { data: ps } = await supabase
        .from("players")
        .select("id,display_name,is_bot")
        .in("id", allIds);
      (ps ?? []).forEach((p: { id: string; display_name: string; is_bot: boolean }) => {
        map[p.id] = p.display_name;
        if (p.is_bot) botIds.add(p.id);
      });
    }
    const publicRows = rows.filter(
      (r) => !botIds.has(r.host_id) && !(r.guest_id && botIds.has(r.guest_id)),
    );
    setGames(publicRows);
    setHostNames(map);
  }


  useEffect(() => {
    loadGames();
    const channel = supabase
      .channel("lobby-games")
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, () => {
        loadGames();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const totalCells = useMemo(() => totalShipCells(fleet), [fleet]);
  const maxCells = size * size;
  const density = Math.round((totalCells / maxCells) * 100);

  function updateFleetCount(idx: number, delta: number) {
    setFleet((f) => f.map((s, i) => i === idx ? { ...s, count: Math.max(0, Math.min(6, s.count + delta)) } : s));
  }

  async function createGame(vsBot: boolean) {
    if (!player) return;
    if (totalCells === 0) { toast.error("Add at least one ship"); return; }
    if (totalCells > Math.floor(maxCells * 0.5)) { toast.error("Fleet too dense for grid"); return; }
    setCreating(true);
    try {
      const code = randomCode();
      const activeFleet = fleet.filter((s) => s.count > 0);
      const insert: Record<string, unknown> = {
        code,
        host_id: player.id,
        status: vsBot ? "placing" : "waiting",
        grid_size: size,
        ship_config: activeFleet,
        session_name: sessionName.trim() || (vsBot ? `Drill vs CPU` : `Sector ${code}`),
      };
      if (vsBot) {
        // Spawn a fresh CPU opponent and pre-deploy its fleet.
        const { data: bot, error: bErr } = await supabase.rpc("create_bot", { p_difficulty: "smart" });
        if (bErr) throw bErr;
        const botRow = bot as { id: string };
        insert.guest_id = botRow.id;
        insert.guest_ships = randomPlacement(activeFleet, size);
        insert.guest_ready = true;
      }
      const { data, error } = await supabase.from("games").insert(insert as never).select().single();
      if (error) throw error;
      navigate({ to: "/game/$id", params: { id: (data as { id: string }).id } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function joinGame(g: GameRow) {
    if (!player) return;
    if (g.host_id === player.id) {
      navigate({ to: "/game/$id", params: { id: g.id } });
      return;
    }
    if (g.guest_id && g.guest_id !== player.id) {
      toast.error("Sector already engaged");
      return;
    }

    if (!g.guest_id) {
      const { error } = await supabase
        .from("games")
        .update({ guest_id: player.id, status: "placing" })
        .eq("id", g.id)
        .is("guest_id", null);
      if (error) { toast.error(error.message); return; }
    }
    navigate({ to: "/game/$id", params: { id: g.id } });
  }

  if (!player) return null;

  return (
    <div className="min-h-screen">
      <TopNav player={player} />

      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-phosphor mb-2">
              command_lobby
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tighter">
              Choose your engagement.
            </h1>
          </div>
          <Link
            to="/stats/$name"
            params={{ name: player.display_name }}
            className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-dim hover:text-phosphor border border-border px-4 py-2.5 rounded-lg"
          >
            → Service record
          </Link>
        </div>

        <div className="grid lg:grid-cols-12 gap-8">
          {/* Create session */}
          <section className="lg:col-span-5 space-y-6">
            <div className="bg-panel border border-border rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-phosphor/10 blur-3xl pointer-events-none" />
              <div className="relative">
                <h2 className="text-xl font-bold mb-1">Initialize session</h2>
                <p className="text-xs text-ink-dim mb-6">Set the arena. Opponents will see it in the lobby.</p>

                <div className="mb-5">
                  <label className="block text-[10px] uppercase tracking-[0.25em] text-phosphor font-bold mb-2">Session name</label>
                  <input
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    placeholder="e.g. Iron Rain"
                    maxLength={32}
                    className="w-full bg-deck/60 border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-ink-mute focus:outline-none focus:border-phosphor"
                  />
                </div>

                <div className="mb-5">
                  <label className="block text-[10px] uppercase tracking-[0.25em] text-phosphor font-bold mb-2">Grid dimensions</label>
                  <div className="grid grid-cols-4 gap-2">
                    {SIZE_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setSize(s)}
                        className={`py-3 rounded-lg text-sm font-mono transition ${
                          s === size
                            ? "bg-phosphor text-deck font-bold"
                            : "bg-deck/60 border border-border text-ink-dim hover:border-phosphor/50"
                        }`}
                      >
                        {s}×{s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <div className="flex justify-between items-baseline mb-2">
                    <label className="block text-[10px] uppercase tracking-[0.25em] text-phosphor font-bold">Ship complement</label>
                    <span className="text-[10px] font-mono text-ink-mute">
                      density {density}%
                    </span>
                  </div>
                  <div className="bg-deck/60 border border-border rounded-lg divide-y divide-border">
                    {fleet.map((s, i) => (
                      <div key={s.name} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <div className="text-sm">{s.name}</div>
                          <div className="text-[10px] font-mono text-ink-mute">length {s.length}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateFleetCount(i, -1)}
                            className="size-7 rounded border border-border hover:border-phosphor text-ink-dim hover:text-phosphor text-sm"
                          >−</button>
                          <span className="w-8 text-center font-mono text-sm">×{s.count}</span>
                          <button
                            onClick={() => updateFleetCount(i, +1)}
                            className="size-7 rounded border border-border hover:border-phosphor text-ink-dim hover:text-phosphor text-sm"
                          >+</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <button
                    onClick={() => createGame(false)}
                    disabled={creating}
                    className="py-3.5 bg-phosphor hover:bg-phosphor-dim text-deck font-bold uppercase tracking-[0.2em] text-sm rounded-lg shadow-glow disabled:opacity-50"
                  >
                    {creating ? "Initializing…" : "Initialize session"}
                  </button>
                  <button
                    onClick={() => createGame(true)}
                    disabled={creating}
                    title="Start a solo drill against a computer opponent"
                    className="px-4 py-3.5 border border-phosphor/40 bg-panel-2 text-phosphor font-mono uppercase tracking-[0.15em] text-[11px] rounded-lg hover:bg-phosphor/10 disabled:opacity-50"
                  >
                    vs CPU
                  </button>
                </div>

              </div>
            </div>
          </section>

          {/* Active sectors */}
          <section className="lg:col-span-7">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold uppercase tracking-[0.25em] text-ink-mute">Active sectors</h3>
              <span className="px-2 py-0.5 rounded bg-phosphor/10 text-phosphor text-[10px] font-mono">
                {games.length} LIVE
              </span>
            </div>
            <div className="space-y-2.5">
              {games.length === 0 && (
                <div className="border border-dashed border-border rounded-xl p-10 text-center">
                  <div className="text-sm text-ink-dim">No open sectors. Initialize a session to draw fire.</div>
                </div>
              )}
              {games.map((g) => {
                const isMine = g.host_id === player.id || g.guest_id === player.id;
                const isFull = !!g.guest_id && !isMine;
                return (
                  <button
                    key={g.id}
                    onClick={() => joinGame(g)}
                    disabled={isFull}
                    className={`w-full text-left p-4 bg-panel/60 border border-border rounded-xl flex items-center justify-between transition ${
                      isFull ? "opacity-40 cursor-not-allowed" : "hover:border-phosphor/60 hover:bg-panel"
                    }`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`size-2 rounded-full ${g.status === "waiting" ? "bg-phosphor animate-pulse-dot" : g.status === "playing" ? "bg-warning" : "bg-ink-mute"}`} />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-foreground truncate">{g.session_name}</div>
                        <div className="text-[10px] font-mono text-ink-mute uppercase mt-0.5">
                          Host: {hostNames[g.host_id] ?? "…"} · {g.status}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <div className="text-[10px] font-mono text-ink-mute uppercase">{g.grid_size}×{g.grid_size}</div>
                      <div className="text-xs font-mono text-phosphor mt-0.5">
                        {isMine ? "RESUME →" : isFull ? "FULL" : "ENGAGE →"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
