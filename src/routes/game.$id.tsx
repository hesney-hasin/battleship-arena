import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getStoredPlayer, type StoredPlayer } from "@/lib/player";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/TopNav";
import {
  applyShot,
  canPlace,
  cellsForShip,
  coordLabel,
  key as ckey,
  randomPlacement,
  shipsFromConfig,
  type Coord,
  type PlacedShip,
  type ShipSpec,
} from "@/lib/battleship";
import { pickBotShot } from "@/lib/bot";
import { downloadBlob, recordReplay } from "@/lib/replay-recorder";
import { toast } from "sonner";


export const Route = createFileRoute("/game/$id")({
  head: () => ({ meta: [{ title: "Vanguard.OS — Engagement" }] }),
  component: GamePage,
});

type GameRow = {
  id: string;
  code: string;
  session_name: string;
  status: "waiting" | "placing" | "playing" | "finished" | "abandoned";
  grid_size: number;
  ship_config: ShipSpec[];
  host_id: string;
  guest_id: string | null;
  host_ships: PlacedShip[] | null;
  guest_ships: PlacedShip[] | null;
  host_ready: boolean;
  guest_ready: boolean;
  current_turn: string | null;
  winner_id: string | null;
};

type MoveRow = {
  id: string;
  game_id: string;
  player_id: string;
  x: number;
  y: number;
  result: "miss" | "hit" | "sunk";
  sunk_ship: string | null;
  created_at: string;
};

function GamePage() {
  const { id } = useParams({ from: "/game/$id" });
  const navigate = useNavigate();
  const [player, setPlayer] = useState<StoredPlayer | null>(null);
  const [game, setGame] = useState<GameRow | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [names, setNames] = useState<Record<string, { display_name: string; is_bot: boolean }>>({});

  useEffect(() => {
    const p = getStoredPlayer();
    if (!p) { navigate({ to: "/" }); return; }
    setPlayer(p);
  }, [navigate]);

  const reloadGame = useCallback(async () => {
    const { data } = await supabase.from("games").select("*").eq("id", id).maybeSingle();
    if (data) setGame(data as unknown as GameRow);
  }, [id]);

  const reloadMoves = useCallback(async () => {
    const { data } = await supabase.from("moves").select("*").eq("game_id", id).order("created_at");
    setMoves((data ?? []) as MoveRow[]);
  }, [id]);

  useEffect(() => {
    reloadGame();
    reloadMoves();
    const ch = supabase
      .channel(`game-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${id}` }, () => {
        reloadGame();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "moves", filter: `game_id=eq.${id}` }, () => {
        reloadMoves();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, reloadGame, reloadMoves]);

  useEffect(() => {
    if (!game) return;
    const ids = [game.host_id, game.guest_id].filter(Boolean) as string[];
    if (!ids.length) return;
    supabase.from("players").select("id,display_name,is_bot").in("id", ids).then(({ data }) => {
      const m: Record<string, { display_name: string; is_bot: boolean }> = {};
      (data ?? []).forEach((r: { id: string; display_name: string; is_bot: boolean }) => {
        m[r.id] = { display_name: r.display_name, is_bot: r.is_bot };
      });
      setNames(m);
    });
  }, [game?.host_id, game?.guest_id]);


  if (!player || !game) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-phosphor animate-pulse-dot">
          Establishing link…
        </div>
      </div>
    );
  }

  const isHost = game.host_id === player.id;
  const isGuest = game.guest_id === player.id;
  const isParticipant = isHost || isGuest;
  if (!isParticipant) {
    return (
      <div className="min-h-screen">
        <TopNav player={player} />
        <div className="max-w-2xl mx-auto p-10 text-center">
          <div className="font-mono text-xs uppercase tracking-[0.3em] text-warning mb-3">Access denied</div>
          <h2 className="text-2xl font-bold mb-2">Sector locked.</h2>
          <p className="text-ink-dim">This engagement already has two combatants.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopNav player={player} />
      <GameStage
        game={game}
        moves={moves}
        player={player}
        isHost={isHost}
        names={names}
        onReloadGame={reloadGame}
      />
    </div>
  );
}

function GameStage({
  game, moves, player, isHost, names, onReloadGame,
}: {
  game: GameRow;
  moves: MoveRow[];
  player: StoredPlayer;
  isHost: boolean;
  names: Record<string, { display_name: string; is_bot: boolean }>;

  onReloadGame: () => void;
}) {
  const opponentId = isHost ? game.guest_id : game.host_id;
  const myShipsField = isHost ? "host_ships" : "guest_ships";
  const myReadyField = isHost ? "host_ready" : "guest_ready";
  const oppShipsField = isHost ? "guest_ships" : "host_ships";
  const oppReadyField = isHost ? "guest_ready" : "host_ready";

  const myShips = (game[myShipsField] as PlacedShip[] | null) ?? null;
  const oppShips = (game[oppShipsField] as PlacedShip[] | null) ?? null;

  // ============ Waiting for opponent ============
  if (game.status === "waiting") {
    return <WaitingRoom game={game} player={player} />;
  }

  // ============ Placement ============
  if (game.status === "placing") {
    return (
      <PlacementStage
        game={game}
        player={player}
        alreadyPlaced={myShips}
        oppReady={game[oppReadyField]}
        onReloadGame={onReloadGame}
        myShipsField={myShipsField}
        myReadyField={myReadyField}
        isHost={isHost}
      />
    );
  }

  // ============ Playing or finished ============
  return (
    <BattleStage
      game={game}
      moves={moves}
      player={player}
      isHost={isHost}
      names={names}
      myShips={myShips!}
      oppShips={oppShips}
      opponentId={opponentId!}
    />
  );
}

// ------------------ Waiting Room ------------------
function WaitingRoom({ game, player }: { game: GameRow; player: StoredPlayer }) {
  const navigate = useNavigate();
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/game/${game.id}` : "";
  async function cancel() {
    await supabase.from("games").delete().eq("id", game.id);
    navigate({ to: "/lobby" });
  }
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-phosphor mb-4">
        awaiting_uplink
      </div>
      <h1 className="text-4xl font-bold tracking-tighter mb-3">{game.session_name}</h1>
      <p className="text-ink-dim mb-10">Listening for an opponent to join sector <span className="font-mono text-phosphor">{game.code}</span></p>

      <div className="relative w-64 h-64 mx-auto mb-10">
        <div className="absolute inset-0 rounded-full border border-phosphor/20" />
        <div className="absolute inset-6 rounded-full border border-phosphor/15" />
        <div className="absolute inset-12 rounded-full border border-phosphor/10" />
        <div className="absolute inset-0 origin-center animate-radar">
          <div className="absolute left-1/2 top-1/2 h-1/2 w-px bg-gradient-to-b from-phosphor to-transparent" />
        </div>
        <div className="absolute inset-0 grid place-items-center">
          <div className="size-2.5 bg-phosphor rounded-full shadow-glow animate-pulse-dot" />
        </div>
      </div>

      <div className="bg-panel border border-border rounded-xl p-4 max-w-lg mx-auto">
        <div className="text-[10px] uppercase font-mono text-ink-mute mb-2">Share this link with your opponent</div>
        <div className="flex gap-2">
          <input readOnly value={shareUrl} className="flex-1 bg-deck/60 border border-border rounded px-3 py-2 text-xs font-mono text-ink-dim" />
          <button
            onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success("Link copied"); }}
            className="px-4 py-2 bg-phosphor text-deck font-bold text-xs uppercase tracking-widest rounded"
          >Copy</button>
        </div>
      </div>

      <button onClick={cancel} className="mt-10 text-[10px] font-mono uppercase tracking-[0.25em] text-ink-mute hover:text-warning">
        ← Abort session
      </button>
    </main>
  );
}

// ------------------ Placement Stage ------------------
function PlacementStage({
  game, player, alreadyPlaced, oppReady, onReloadGame, myShipsField, myReadyField, isHost,
}: {
  game: GameRow;
  player: StoredPlayer;
  alreadyPlaced: PlacedShip[] | null;
  oppReady: boolean;
  onReloadGame: () => void;
  myShipsField: "host_ships" | "guest_ships";
  myReadyField: "host_ready" | "guest_ready";
  isHost: boolean;
}) {
  const size = game.grid_size;
  const ships = useMemo(() => shipsFromConfig(game.ship_config), [game.ship_config]);
  const [placed, setPlaced] = useState<PlacedShip[]>(alreadyPlaced ?? []);
  const [nextIdx, setNextIdx] = useState<number>(alreadyPlaced?.length ?? 0);
  const [orientation, setOrientation] = useState<"H" | "V">("H");
  const [hover, setHover] = useState<Coord | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (alreadyPlaced) { setPlaced(alreadyPlaced); setNextIdx(alreadyPlaced.length); }
  }, [alreadyPlaced]);

  const occupied = useMemo(() => {
    const s = new Set<string>();
    placed.forEach((p) => p.cells.forEach(([x, y]) => s.add(ckey(x, y))));
    return s;
  }, [placed]);

  const currentShip = ships[nextIdx] ?? null;
  const done = nextIdx >= ships.length;

  const previewCells: Coord[] = useMemo(() => {
    if (!currentShip || !hover) return [];
    return cellsForShip(hover[0], hover[1], currentShip.length, orientation);
  }, [currentShip, hover, orientation]);

  const previewValid = previewCells.length > 0 && canPlace(previewCells, size, occupied);

  function placeAt(x: number, y: number) {
    if (!currentShip) return;
    const cells = cellsForShip(x, y, currentShip.length, orientation);
    if (!canPlace(cells, size, occupied)) return;
    setPlaced((p) => [...p, { name: currentShip.name, length: currentShip.length, cells, hits: [] }]);
    setNextIdx((i) => i + 1);
  }

  function undo() {
    if (placed.length === 0) return;
    setPlaced((p) => p.slice(0, -1));
    setNextIdx((i) => Math.max(0, i - 1));
  }

  function autoPlace() {
    const rp = randomPlacement(game.ship_config, size);
    setPlaced(rp);
    setNextIdx(rp.length);
  }

  async function confirm() {
    if (!done) return;
    setSubmitting(true);
    try {
      const update: Record<string, unknown> = {
        [myShipsField]: placed,
        [myReadyField]: true,
      };
      // if both ready, start playing
      const otherReady = oppReady;
      if (otherReady) {
        update.status = "playing";
        update.current_turn = game.host_id; // host fires first
      }
      const { error } = await supabase.from("games").update(update as never).eq("id", game.id);
      if (error) throw error;
      await onReloadGame();
      toast.success("Fleet deployed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Right-click / R to rotate
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "r" || e.key === "R") setOrientation((o) => (o === "H" ? "V" : "H"));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const meReady = !!(alreadyPlaced && game[myReadyField]);

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <header className="mb-8 flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-phosphor mb-2">
            phase_01 // fleet_deployment
          </div>
          <h1 className="text-3xl font-bold tracking-tighter">Deploy your fleet.</h1>
          <p className="text-sm text-ink-dim mt-1">
            Click to place. Press <kbd className="font-mono text-phosphor">R</kbd> to rotate.
            You are the <span className="text-phosphor font-mono">{isHost ? "HOST" : "GUEST"}</span>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill label={meReady ? "You: ready" : "You: placing"} tone={meReady ? "ok" : "warn"} />
          <StatusPill label={oppReady ? "Foe: ready" : "Foe: placing"} tone={oppReady ? "ok" : "mute"} />
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr_320px] gap-8">
        <div className="bg-panel border border-border rounded-2xl p-6">
          <Grid
            size={size}
            interactive={!done && !meReady}
            onHover={setHover}
            onClick={(x, y) => placeAt(x, y)}
            renderCell={(x, y) => {
              const isOcc = occupied.has(ckey(x, y));
              const inPreview = previewCells.some(([px, py]) => px === x && py === y);
              return (
                <div
                  className={`w-full h-full ${
                    isOcc
                      ? "bg-phosphor/25 border border-phosphor/60"
                      : inPreview
                        ? previewValid ? "bg-phosphor/40 border border-phosphor" : "bg-hit/30 border border-hit"
                        : ""
                  }`}
                />
              );
            }}
          />
        </div>

        <aside className="space-y-4">
          <div className="bg-panel border border-border rounded-xl p-5">
            <div className="text-[10px] uppercase font-mono text-ink-mute mb-3">Deployment queue</div>
            <ol className="space-y-1.5 max-h-64 overflow-auto pr-1">
              {ships.map((s, i) => (
                <li key={i} className={`flex justify-between text-sm px-3 py-2 rounded ${
                  i < nextIdx ? "bg-phosphor/10 text-phosphor line-through opacity-70"
                    : i === nextIdx ? "bg-phosphor text-deck font-bold"
                    : "bg-deck/50 text-ink-dim"
                }`}>
                  <span>{s.name}</span>
                  <span className="font-mono text-xs opacity-70">len {s.length}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
            <button
              onClick={() => setOrientation((o) => o === "H" ? "V" : "H")}
              disabled={meReady}
              className="w-full py-2.5 bg-deck/60 border border-border rounded text-sm font-mono uppercase tracking-widest hover:border-phosphor disabled:opacity-40"
            >
              Rotate · <span className="text-phosphor">{orientation === "H" ? "horizontal" : "vertical"}</span>
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={undo} disabled={meReady || placed.length === 0} className="py-2 border border-border rounded text-xs font-mono uppercase tracking-widest hover:border-phosphor disabled:opacity-40">Undo</button>
              <button onClick={autoPlace} disabled={meReady} className="py-2 border border-border rounded text-xs font-mono uppercase tracking-widest hover:border-phosphor disabled:opacity-40">Auto</button>
            </div>
            <button
              onClick={confirm}
              disabled={!done || submitting || !!meReady}
              className="w-full py-3 bg-phosphor hover:bg-phosphor-dim text-deck font-bold uppercase tracking-[0.2em] text-xs rounded shadow-glow disabled:opacity-40 disabled:shadow-none"
            >
              {meReady ? "Deployed — awaiting foe" : done ? "Confirm deployment" : `Place ${ships.length - nextIdx} more`}
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}

// ------------------ Battle Stage ------------------
function BattleStage({
  game, moves, player, isHost, names, myShips, oppShips, opponentId,
}: {
  game: GameRow;
  moves: MoveRow[];
  player: StoredPlayer;
  isHost: boolean;
  names: Record<string, { display_name: string; is_bot: boolean }>;

  myShips: PlacedShip[];
  oppShips: PlacedShip[] | null;
  opponentId: string;
}) {
  const size = game.grid_size;
  const myTurn = game.status === "playing" && game.current_turn === player.id;
  const finished = game.status === "finished";
  const iWon = finished && game.winner_id === player.id;

  // Reconstruct board states from moves
  const myMoves = moves.filter((m) => m.player_id === player.id); // shots I fired -> on enemy grid
  const oppMoves = moves.filter((m) => m.player_id === opponentId); // shots foe fired -> on my grid

  const enemyMap = useMemo(() => {
    const m = new Map<string, MoveRow>();
    myMoves.forEach((mv) => m.set(ckey(mv.x, mv.y), mv));
    return m;
  }, [myMoves]);
  const myBoardHits = useMemo(() => {
    const m = new Map<string, MoveRow>();
    oppMoves.forEach((mv) => m.set(ckey(mv.x, mv.y), mv));
    return m;
  }, [oppMoves]);

  const [firing, setFiring] = useState<Coord | null>(null);
  const [exporting, setExporting] = useState(false);
  const botBusyRef = useRef(false);

  const opponentIsBot = !!names[opponentId]?.is_bot;
  const isBotTurn = game.status === "playing" && !finished && opponentIsBot && isHost && game.current_turn === opponentId;

  // ============ Bot autoplay (host drives the CPU) ============
  useEffect(() => {
    if (!isBotTurn || botBusyRef.current) return;
    botBusyRef.current = true;
    const priorBotShots = moves
      .filter((m) => m.player_id === opponentId)
      .map((m) => ({ x: m.x, y: m.y, result: m.result }));
    const [bx, by] = pickBotShot(size, priorBotShots);

    const delay = 650 + Math.random() * 500;
    const t = setTimeout(async () => {
      try {
        const shot = applyShot(myShips, bx, by);
        const { error: mErr } = await supabase.from("moves").insert({
          game_id: game.id,
          player_id: opponentId,
          x: bx,
          y: by,
          result: shot.result,
          sunk_ship: shot.shipName ?? null,
        });
        if (mErr) throw mErr;
        const gu: Record<string, unknown> = {
          [isHost ? "host_ships" : "guest_ships"]: shot.updatedShips,
        };
        if (shot.allSunk) {
          gu.status = "finished";
          gu.winner_id = opponentId;
          gu.current_turn = null;
        } else {
          gu.current_turn = shot.result === "miss" ? player.id : opponentId;
        }
        await supabase.from("games").update(gu as never).eq("id", game.id);
        if (shot.allSunk) {
          const { data: loser } = await supabase.from("players").select("losses,games_played").eq("id", player.id).maybeSingle();
          if (loser) {
            await supabase.from("players").update({
              losses: (loser.losses ?? 0) + 1,
              games_played: (loser.games_played ?? 0) + 1,
            }).eq("id", player.id);
          }
        }
      } catch (e) {
        console.error("bot fire failed", e);
      } finally {
        botBusyRef.current = false;
      }
    }, delay);
    return () => { clearTimeout(t); botBusyRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBotTurn, game.current_turn, moves.length]);

  async function exportReplay() {
    if (!oppShips || !finished) return;
    setExporting(true);
    try {
      const hostShips = isHost ? myShips : oppShips;
      const guestShips = isHost ? oppShips : myShips;
      const hostId = isHost ? player.id : opponentId;
      const guestId = isHost ? opponentId : player.id;
      const blob = await recordReplay({
        sessionName: game.session_name,
        gridSize: size,
        hostName: names[hostId]?.display_name ?? "HOST",
        guestName: names[guestId]?.display_name ?? "GUEST",
        hostId,
        guestId,
        hostShips,
        guestShips,
        moves: moves.map((m) => ({
          x: m.x, y: m.y, player_id: m.player_id, result: m.result, sunk_ship: m.sunk_ship,
        })),
        winnerId: game.winner_id,
      });
      const safe = game.session_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "engagement";
      downloadBlob(blob, `vanguard-${safe}-${game.code}.webm`);
      toast.success("Replay saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }


  async function fire(x: number, y: number) {
    if (!myTurn || finished) return;
    if (enemyMap.has(ckey(x, y))) return;
    if (!oppShips) { toast.error("Opponent fleet not ready"); return; }
    setFiring([x, y]);
    try {
      const shot = applyShot(oppShips, x, y);
      // Insert move
      const { error: moveErr } = await supabase.from("moves").insert({
        game_id: game.id,
        player_id: player.id,
        x, y,
        result: shot.result,
        sunk_ship: shot.shipName ?? null,
      });
      if (moveErr) throw moveErr;

      // Update game state: opp ships (with hits), turn switch, potentially winner
      const gameUpdate: Record<string, unknown> = {
        [isHost ? "guest_ships" : "host_ships"]: shot.updatedShips,
      };
      if (shot.allSunk) {
        gameUpdate.status = "finished";
        gameUpdate.winner_id = player.id;
        gameUpdate.current_turn = null;
      } else {
        // hits and sinks keep the turn; misses pass turn
        gameUpdate.current_turn = shot.result === "miss" ? opponentId : player.id;
      }
      const { error: gameErr } = await supabase.from("games").update(gameUpdate as never).eq("id", game.id);
      if (gameErr) throw gameErr;

      // Stats — best-effort
      const hitCount = shot.result === "miss" ? 0 : 1;
      const sunkCount = shot.result === "sunk" ? 1 : 0;
      // Fetch current then update (no atomic increment without RPC — acceptable trade-off)
      const { data: cur } = await supabase.from("players").select("shots_fired,shots_hit,ships_sunk").eq("id", player.id).maybeSingle();
      if (cur) {
        await supabase.from("players").update({
          shots_fired: (cur.shots_fired ?? 0) + 1,
          shots_hit: (cur.shots_hit ?? 0) + hitCount,
          ships_sunk: (cur.ships_sunk ?? 0) + sunkCount,
          last_seen: new Date().toISOString(),
        }).eq("id", player.id);
      }

      if (shot.allSunk) {
        // Increment W/L
        const { data: winner } = await supabase.from("players").select("wins,games_played").eq("id", player.id).maybeSingle();
        if (winner) {
          await supabase.from("players").update({
            wins: (winner.wins ?? 0) + 1,
            games_played: (winner.games_played ?? 0) + 1,
          }).eq("id", player.id);
        }
        const { data: loser } = await supabase.from("players").select("losses,games_played").eq("id", opponentId).maybeSingle();
        if (loser) {
          await supabase.from("players").update({
            losses: (loser.losses ?? 0) + 1,
            games_played: (loser.games_played ?? 0) + 1,
          }).eq("id", opponentId);
        }
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFiring(null);
    }
  }

  const myName = names[player.id]?.display_name ?? player.display_name;
  const foeName = names[opponentId]?.display_name ?? "OPPONENT";

  const totalMyShipCells = myShips.reduce((s, x) => s + x.length, 0);
  const foeHitsOnMe = oppMoves.filter((m) => m.result !== "miss").length;

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      {/* Status bar */}
      <div className="bg-panel border border-border rounded-2xl px-5 py-3 flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink-mute">Op</div>
            <div className="text-sm font-bold tracking-tight">{game.session_name}</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink-mute">You</div>
            <div className="text-sm font-mono text-phosphor">{myName}</div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink-mute">Foe</div>
            <div className="text-sm font-mono text-hit">{foeName}</div>
          </div>
        </div>
        <div className="text-right">
          {finished ? (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink-mute">Result</div>
              <div className={`text-lg font-bold tracking-tight ${iWon ? "text-phosphor" : "text-hit"}`}>
                {iWon ? "VICTORY" : "DEFEAT"}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink-mute">Turn</div>
              <div className={`text-sm font-bold ${myTurn ? "text-phosphor animate-pulse-dot" : "text-ink-dim"}`}>
                {myTurn ? "YOUR ORDERS" : "AWAITING FOE…"}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Enemy grid */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.3em] text-hit">Hostile waters</h3>
            <span className="text-[10px] font-mono text-ink-mute">
              hits {myMoves.filter((m) => m.result !== "miss").length}/{oppShips?.reduce((s, x) => s + x.length, 0) ?? "?"}
            </span>
          </div>
          <div className="bg-panel border border-border rounded-2xl p-5 relative">
            <div className="absolute inset-5 pointer-events-none grid-scan opacity-30 rounded" />
            <Grid
              size={size}
              interactive={myTurn && !finished}
              onClick={fire}
              renderCell={(x, y) => {
                const mv = enemyMap.get(ckey(x, y));
                if (!mv) return null;
                if (mv.result === "miss")
                  return <div className="w-full h-full grid place-items-center"><div className="size-1.5 rounded-full bg-miss" /></div>;
                return (
                  <div className="w-full h-full grid place-items-center animate-ordnance">
                    <div className={`size-2.5 rounded-full ${mv.result === "sunk" ? "bg-hit shadow-hit ring-2 ring-hit" : "bg-hit shadow-hit"}`} />
                  </div>
                );
              }}
              cellExtraClass={(x, y) => {
                if (firing && firing[0] === x && firing[1] === y) return "bg-phosphor/30";
                if (myTurn && !enemyMap.has(ckey(x, y)) && !finished) return "hover:bg-phosphor/15 cursor-crosshair";
                return "";
              }}
              tone="enemy"
            />
          </div>
        </section>

        {/* Own grid */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.3em] text-phosphor">Home fleet</h3>
            <span className="text-[10px] font-mono text-ink-mute">
              intact {totalMyShipCells - foeHitsOnMe}/{totalMyShipCells}
            </span>
          </div>
          <div className="bg-panel border border-border rounded-2xl p-5">
            <Grid
              size={size}
              interactive={false}
              renderCell={(x, y) => {
                const ship = myShips.find((s) => s.cells.some(([sx, sy]) => sx === x && sy === y));
                const mv = myBoardHits.get(ckey(x, y));
                if (mv) {
                  if (mv.result === "miss")
                    return <div className="w-full h-full grid place-items-center"><div className="size-1.5 rounded-full bg-miss" /></div>;
                  return <div className="w-full h-full grid place-items-center animate-ordnance"><div className="size-2.5 rounded-full bg-hit shadow-hit" /></div>;
                }
                if (ship) return <div className="w-full h-full bg-phosphor/25 border border-phosphor/50" />;
                return null;
              }}
              tone="friendly"
            />
          </div>
          <FleetRoster ships={myShips} />
        </section>
      </div>

      {/* Log */}
      <section className="mt-8 bg-panel border border-border rounded-2xl p-5">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-ink-mute mb-3">Tactical feed</div>
        <div className="max-h-56 overflow-auto space-y-1 font-mono text-[11px]">
          {moves.length === 0 && <div className="text-ink-mute">Awaiting first shot…</div>}
          {[...moves].reverse().map((m) => {
            const who = m.player_id === player.id ? "YOU" : (names[m.player_id]?.display_name ?? "FOE").toUpperCase();
            const color = m.result === "miss" ? "text-ink-dim" : m.result === "sunk" ? "text-warning" : "text-hit";
            return (
              <div key={m.id} className="flex justify-between animate-ticker">
                <span className="text-ink-mute">
                  [{new Date(m.created_at).toLocaleTimeString()}] <span className="text-ink-dim">{who}</span> → {coordLabel(m.x, m.y)}
                </span>
                <span className={color}>
                  {m.result.toUpperCase()}{m.sunk_ship ? ` · ${m.sunk_ship}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {finished && (
        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <a href="/lobby" className="inline-block px-6 py-3 bg-phosphor text-deck font-bold uppercase tracking-[0.2em] text-xs rounded-lg shadow-glow">
            Return to lobby
          </a>
          <button
            onClick={exportReplay}
            disabled={exporting}
            className="px-6 py-3 border border-phosphor/40 bg-panel-2 text-phosphor font-bold uppercase tracking-[0.2em] text-xs rounded-lg hover:bg-phosphor/10 disabled:opacity-50"
          >
            {exporting ? "Rendering replay…" : "⤓ Export replay video"}
          </button>
        </div>
      )}

    </main>
  );
}

// ------------------ Reusable UI ------------------
function Grid({
  size, renderCell, onClick, onHover, interactive, cellExtraClass, tone = "friendly",
}: {
  size: number;
  renderCell?: (x: number, y: number) => React.ReactNode;
  onClick?: (x: number, y: number) => void;
  onHover?: (c: Coord | null) => void;
  interactive: boolean;
  cellExtraClass?: (x: number, y: number) => string;
  tone?: "friendly" | "enemy";
}) {
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const extra = cellExtraClass?.(x, y) ?? "";
      cells.push(
        <div
          key={`${x},${y}`}
          onClick={interactive && onClick ? () => onClick(x, y) : undefined}
          onMouseEnter={interactive && onHover ? () => onHover([x, y]) : undefined}
          onMouseLeave={interactive && onHover ? () => onHover(null) : undefined}
          className={`relative border border-white/5 ${interactive ? "cursor-pointer" : ""} ${extra}`}
        >
          {renderCell?.(x, y)}
        </div>
      );
    }
  }
  const borderColor = tone === "enemy" ? "border-hit/30" : "border-phosphor/20";
  return (
    <div className={`relative`}>
      {/* col labels */}
      <div className="grid gap-0 pl-6 mb-1" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
        {Array.from({ length: size }).map((_, i) => (
          <div key={i} className="text-[9px] font-mono text-ink-mute text-center">{String.fromCharCode(65 + i)}</div>
        ))}
      </div>
      <div className="flex">
        <div className="grid gap-0 mr-1" style={{ gridTemplateRows: `repeat(${size}, minmax(0, 1fr))` }}>
          {Array.from({ length: size }).map((_, i) => (
            <div key={i} className="w-5 flex items-center justify-end pr-1 text-[9px] font-mono text-ink-mute">{i + 1}</div>
          ))}
        </div>
        <div className={`grid flex-1 aspect-square bg-deck/60 border ${borderColor} rounded overflow-hidden`}
             style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
             onMouseLeave={() => onHover?.(null)}>
          {cells}
        </div>
      </div>
    </div>
  );
}

function FleetRoster({ ships }: { ships: PlacedShip[] }) {
  return (
    <div className="mt-4 bg-panel border border-border rounded-xl p-4">
      <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-ink-mute mb-3">Fleet status</div>
      <div className="grid grid-cols-2 gap-2">
        {ships.map((s, i) => {
          const sunk = s.hits.length >= s.length;
          return (
            <div key={i} className={`flex items-center justify-between px-3 py-2 rounded ${sunk ? "bg-hit/10" : "bg-deck/50"}`}>
              <span className={`text-xs ${sunk ? "line-through text-hit" : "text-ink"}`}>{s.name}</span>
              <div className="flex gap-0.5">
                {Array.from({ length: s.length }).map((_, k) => (
                  <div key={k} className={`h-1.5 w-3 rounded-sm ${k < s.hits.length ? "bg-hit" : "bg-phosphor/40"}`} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "ok" | "warn" | "mute" }) {
  const cls = tone === "ok" ? "bg-phosphor/10 text-phosphor border-phosphor/30"
            : tone === "warn" ? "bg-warning/10 text-warning border-warning/30"
            : "bg-panel-2 text-ink-mute border-border";
  return (
    <span className={`px-3 py-1 rounded-full border font-mono text-[10px] uppercase tracking-[0.2em] ${cls}`}>
      {label}
    </span>
  );
}
