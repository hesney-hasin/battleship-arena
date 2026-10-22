ALTER TABLE public.players ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.create_bot(p_difficulty text DEFAULT 'smart')
RETURNS public.players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suffix text := to_char(floor(random()*9000+1000)::int, 'FM0000');
  v_base text := 'CPU-' || v_suffix;
  v_player public.players;
BEGIN
  INSERT INTO public.players (display_name, base_name, name_number, is_bot)
  VALUES (v_base, v_base, 1, true)
  RETURNING * INTO v_player;
  RETURN v_player;
END;
$$;