
-- Players (identified by display_name, no auth)
CREATE TABLE public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT UNIQUE NOT NULL,
  base_name TEXT NOT NULL,
  name_number INT NOT NULL DEFAULT 1,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  shots_fired INT NOT NULL DEFAULT 0,
  shots_hit INT NOT NULL DEFAULT 0,
  ships_sunk INT NOT NULL DEFAULT 0,
  games_played INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.players TO anon, authenticated;
GRANT ALL ON public.players TO service_role;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read players" ON public.players FOR SELECT USING (true);
CREATE POLICY "public insert players" ON public.players FOR INSERT WITH CHECK (true);
CREATE POLICY "public update players" ON public.players FOR UPDATE USING (true) WITH CHECK (true);

-- Games
CREATE TABLE public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  host_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  guest_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | placing | playing | finished | abandoned
  grid_size INT NOT NULL,
  ship_config JSONB NOT NULL, -- [{name,length,count}]
  host_ships JSONB, -- [{name,length,cells:[[x,y],...],hits:[]}]
  guest_ships JSONB,
  host_ready BOOLEAN NOT NULL DEFAULT false,
  guest_ready BOOLEAN NOT NULL DEFAULT false,
  current_turn UUID REFERENCES public.players(id),
  winner_id UUID REFERENCES public.players(id),
  session_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX games_status_idx ON public.games(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.games TO anon, authenticated;
GRANT ALL ON public.games TO service_role;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read games" ON public.games FOR SELECT USING (true);
CREATE POLICY "public insert games" ON public.games FOR INSERT WITH CHECK (true);
CREATE POLICY "public update games" ON public.games FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public delete games" ON public.games FOR DELETE USING (true);

-- Moves
CREATE TABLE public.moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  x INT NOT NULL,
  y INT NOT NULL,
  result TEXT NOT NULL, -- miss | hit | sunk
  sunk_ship TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX moves_game_idx ON public.moves(game_id, created_at);
GRANT SELECT, INSERT ON public.moves TO anon, authenticated;
GRANT ALL ON public.moves TO service_role;
ALTER TABLE public.moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read moves" ON public.moves FOR SELECT USING (true);
CREATE POLICY "public insert moves" ON public.moves FOR INSERT WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER games_updated_at BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Name allocation: given a base name, return "Name" or "Name 2" etc.
CREATE OR REPLACE FUNCTION public.claim_player(p_base TEXT)
RETURNS public.players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base TEXT := trim(p_base);
  v_num INT := 1;
  v_display TEXT;
  v_player public.players;
BEGIN
  IF v_base IS NULL OR length(v_base) = 0 THEN
    RAISE EXCEPTION 'Name cannot be empty';
  END IF;
  LOOP
    v_display := CASE WHEN v_num = 1 THEN v_base ELSE v_base || ' ' || v_num END;
    BEGIN
      INSERT INTO public.players (display_name, base_name, name_number)
      VALUES (v_display, v_base, v_num)
      RETURNING * INTO v_player;
      RETURN v_player;
    EXCEPTION WHEN unique_violation THEN
      v_num := v_num + 1;
      IF v_num > 9999 THEN RAISE EXCEPTION 'Name space exhausted'; END IF;
    END;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_player(TEXT) TO anon, authenticated;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
ALTER PUBLICATION supabase_realtime ADD TABLE public.moves;
ALTER TABLE public.games REPLICA IDENTITY FULL;
ALTER TABLE public.moves REPLICA IDENTITY FULL;
