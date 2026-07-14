# Agentic Todos Desktop

This is a lightweight Electron scaffold for Agentic Todos. It talks to the simplified Agentic Todos API for users and TODOs.

## Run locally

Start the Agentic Todos server first from the server folder:

```bash
cp .env.example .env
docker compose up -d postgres
go run ./cmd/server
```

Google login requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_TOKEN_SECRET` in the server `.env`.

Then start the desktop app:

```bash
npm install
npm run dev
```

The desktop shell calls the production Railway API by default:

```text
https://agentic-todos-server-production.up.railway.app/api/v1
```

Override it with:

```bash
AGENTIC_TODOS_SERVER_URL=http://localhost:8081/api/v1 npm run dev
```

You can also start the desktop app through Bazel. Production remains the default:

```bash
bazel run //:desktop
```

Point it at a local server with:

```bash
RUN_LOCAL=1 bazel run //:desktop
```

For a shorter target name matching the server workflow, `//:server` is an alias:

```bash
RUN_LOCAL=1 bazel run //:server
```

`RUN_LOCAL=1` sets `AGENTIC_TODOS_SERVER_URL` to `http://localhost:8081/api/v1`. You can override that local URL with `LOCAL_SERVER_URL`.

## Useful scripts

```bash
npm run typecheck
npm run build
npm run preview
npm run package:mac:zip
```

`npm run package:mac:zip` creates an unsigned Apple Silicon macOS zip in `release/`.

## Structure

- `electron/main.ts` creates the desktop window and loads Vite in development.
- `electron/preload.ts` exposes a small, safe bridge for future desktop/backend integrations.
- `src/App.tsx` contains the TODO-style homepage and local task interactions.
- `src/styles.css` owns the desktop visual system.

## API status

The renderer talks to the server through Electron's preload bridge. Future external app execution should live behind that same bridge rather than inside React components.
