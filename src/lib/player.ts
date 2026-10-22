import { supabase } from "@/integrations/supabase/client";

const KEY = "vanguard.player";

export type StoredPlayer = {
  id: string;
  display_name: string;
  base_name: string;
};

export function getStoredPlayer(): StoredPlayer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredPlayer;
  } catch {
    return null;
  }
}

export function saveStoredPlayer(p: StoredPlayer) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function clearStoredPlayer() {
  localStorage.removeItem(KEY);
}

export async function claimName(base: string): Promise<StoredPlayer> {
  const trimmed = base.trim();
  if (!trimmed) throw new Error("Callsign required");
  const { data, error } = await supabase.rpc("claim_player", { p_base: trimmed });
  if (error) throw error;
  const row = data as { id: string; display_name: string; base_name: string };
  const p: StoredPlayer = { id: row.id, display_name: row.display_name, base_name: row.base_name };
  saveStoredPlayer(p);
  return p;
}
