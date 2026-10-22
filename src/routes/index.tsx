import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { claimName, getStoredPlayer } from "@/lib/player";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vanguard.OS — Enter Callsign" },
      { name: "description", content: "Enter your callsign to join the real-time Battleship command deck." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = getStoredPlayer();
    if (p) navigate({ to: "/lobby" });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const p = await claimName(name);
      toast.success(`Uplink established — ${p.display_name}`);
      navigate({ to: "/lobby" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* radar backdrop */}
      <div className="absolute inset-0 grid-scan opacity-40" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 size-[900px] rounded-full border border-phosphor/10" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 size-[600px] rounded-full border border-phosphor/10" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 size-[300px] rounded-full border border-phosphor/10" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 size-[900px] origin-center animate-radar pointer-events-none">
        <div className="absolute left-1/2 top-1/2 h-1/2 w-px bg-gradient-to-b from-phosphor/60 to-transparent" />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 bg-phosphor rounded-sm grid place-items-center shadow-glow">
              <div className="size-5 border-2 border-deck rounded-full grid place-items-center">
                <div className="size-1 bg-deck rounded-full" />
              </div>
            </div>
            <div className="leading-none">
              <div className="text-lg font-bold tracking-tighter">
                VANGUARD<span className="text-phosphor">.OS</span>
              </div>
              <div className="text-[9px] font-mono uppercase tracking-[0.25em] text-ink-mute mt-1">
                tactical command deck
              </div>
            </div>
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink-mute flex items-center gap-2">
            <span className="size-1.5 bg-phosphor rounded-full animate-pulse-dot" />
            uplink online
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-xl">
            <div className="mb-8 text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.4em] text-phosphor mb-4">
                system_init // operator_identification
              </div>
              <h1 className="text-5xl md:text-6xl font-bold tracking-tighter leading-[0.95] text-balance">
                Command the fleet.
                <br />
                <span className="text-phosphor">Sink the enemy.</span>
              </h1>
              <p className="mt-4 text-sm text-ink-dim max-w-md mx-auto">
                Real-time multiplayer Battleship. No signup, no password — just a
                callsign and a target.
              </p>
            </div>

            <form onSubmit={submit} className="bg-panel/80 backdrop-blur-md border border-border rounded-2xl p-8 shadow-2xl">
              <label className="block text-[10px] uppercase tracking-[0.25em] text-phosphor font-bold mb-3">
                Callsign
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. ARCHER"
                maxLength={24}
                className="w-full bg-deck/60 border border-border rounded-lg px-4 py-4 text-xl font-mono uppercase tracking-wider text-foreground placeholder:text-ink-mute focus:outline-none focus:border-phosphor focus:ring-2 focus:ring-phosphor/20 transition"
              />
              <p className="text-[10px] text-ink-mute mt-2 font-mono">
                Duplicate callsigns get a numeric suffix (e.g. ARCHER 2, ARCHER 3).
              </p>
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="mt-6 w-full py-4 bg-phosphor hover:bg-phosphor-dim disabled:opacity-40 disabled:cursor-not-allowed text-deck font-bold uppercase tracking-[0.2em] text-sm rounded-lg transition shadow-glow"
              >
                {loading ? "Establishing uplink…" : "Establish uplink →"}
              </button>
            </form>

            <div className="mt-10 grid grid-cols-3 gap-4 text-center">
              <Feature label="Live opponents" value="Real-time" />
              <Feature label="Grid & fleet" value="Configurable" />
              <Feature label="Persistent stats" value="Tracked" />
            </div>
          </div>
        </main>

        <footer className="px-6 py-4 text-center text-[10px] font-mono uppercase tracking-[0.25em] text-ink-mute">
          v4.0.2 // encrypted signal // multi-sector engagement
        </footer>
      </div>
    </div>
  );
}

function Feature({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg py-3 bg-panel/40">
      <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-ink-mute">{label}</div>
      <div className="text-sm font-bold text-phosphor mt-1">{value}</div>
    </div>
  );
}
