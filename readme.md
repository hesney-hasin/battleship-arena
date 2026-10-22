
# Battleship Arena

A real-time multiplayer Battleship game. Choose a callsign, configure your fleet, and challenge another player or play against the CPU.
## Link - https://battleship-arena-sooty.vercel.app/
## Features

- Live multiplayer game rooms
- Single-player matches against a CPU opponent
- Configurable grid sizes and fleets
- Player statistics

## Tech Stack

- React and TypeScript
- TanStack Start
- Vite and Tailwind CSS
- Supabase
- Bun

## Run Locally

Install [Bun](https://bun.sh/), then install dependencies and start the development server:

```bash
bun install
bun run dev
```

Before playing, configure the Supabase environment variables described below and apply the database migrations in `supabase/migrations` to your Supabase project.

## Environment Variables

Set these values in your local environment and in Vercel:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase URL used by the browser client |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key used by the browser client |
| `SUPABASE_URL` | Supabase URL used by server code |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key used by server code |
| `SUPABASE_SERVICE_ROLE_KEY` | Private key for server-side administrative operations |

The service role key is privileged. Keep it server-side only: do not add a `VITE_` prefix, commit it to GitHub, or expose it in browser code.

## Available Scripts

```bash
bun run dev      # Start the development server
bun run build    # Build the app and run TypeScript checks
bun run preview  # Preview the production build locally
bun run lint     # Run ESLint
```

## Deploy to Vercel

1. Push the project to a GitHub repository.
2. In Vercel, select **Add New Project** and import the repository.
3. Keep the project root directory set to the repository root. Vercel should detect TanStack Start from the project configuration.
4. Add the Supabase environment variables above in the project’s **Settings → Environment Variables**. Select the environments you plan to deploy to.
5. Deploy. The project build command is `bun run build`; leave the output directory at its default.
6. After deployment, open the site and verify that it can connect to Supabase and create or join a game.

## License

No license has been specified for this project.
```
