import { Link, useNavigate } from "@tanstack/react-router";
import type { StoredPlayer } from "@/lib/player";
import { clearStoredPlayer } from "@/lib/player";

export function TopNav({ player }: { player: StoredPlayer | null }) {
  const navigate = useNavigate();
  return (
    <nav className="border-b border-border bg-deck/70 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/lobby" className="flex items-center gap-3 group">
          <div className="size-9 bg-phosphor rounded-sm grid place-items-center shadow-glow group-hover:scale-105 transition-transform">
            <div className="size-5 border-2 border-deck rounded-full grid place-items-center">
              <div className="size-1 bg-deck rounded-full" />
            </div>
          </div>
          <div className="leading-none">
            <div className="text-lg font-bold tracking-tighter text-foreground">
              VANGUARD<span className="text-phosphor">.OS</span>
            </div>
            <div className="text-[9px] font-mono uppercase tracking-[0.25em] text-ink-mute mt-1">
              tactical command deck
            </div>
          </div>
        </Link>

        {player ? (
          <div className="flex items-center gap-6">
            <Link
              to="/stats/$name"
              params={{ name: player.display_name }}
              className="text-right hidden sm:block hover:opacity-80 transition-opacity"
            >
              <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-ink-mute">
                Command ID
              </div>
              <div className="text-sm font-mono text-phosphor flex items-center gap-2 justify-end">
                <span className="size-1.5 bg-phosphor rounded-full animate-pulse-dot" />
                {player.display_name.toUpperCase()}
              </div>
            </Link>
            <button
              onClick={() => { clearStoredPlayer(); navigate({ to: "/" }); }}
              className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-mute hover:text-warning transition-colors border border-border px-3 py-1.5 rounded"
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
