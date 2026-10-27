# WorkLog AI

A private Windows desktop worklog app. Notes and generated worklogs stay on the computer: records are stored in SQLite, and AI requests go only to a locally running Ollama service. There is no cloud AI fallback, activity monitoring, filesystem scan, clipboard access, screenshot capture, or corporate-system integration.

## Run in development

Requirements: Windows 11, Node.js 20+, npm, and (for local generation) [Ollama for Windows](https://ollama.com/download).

1. Open this folder in PowerShell and run `npm install`.
2. Optional AI setup: copy `.env.example` to `.env`, run `ollama pull llama3.2`, and leave Ollama running. You can set `OLLAMA_MODEL` to another model installed in Ollama.
3. Run `npm run dev`. Open the Vite URL shown in the terminal (usually `http://localhost:5173`). The local API is bound to `127.0.0.1:4317`.

When Ollama is unavailable, you can enter or edit all worklog fields manually and save as usual. AI generation reports the missing local setup; notes are never sent to a hosted provider.

## Run with Docker Compose

Requirements: Docker Desktop with the Linux container engine running.

From this folder, run:

```powershell
docker compose up --build -d
docker compose exec ollama ollama pull llama3.2
```

Open `http://localhost:4317`. The `worklog` container serves the UI and API together; the `ollama` container runs the local model. SQLite records and model files use separate named Docker volumes, so they remain after container restarts. The web port binds to localhost by default and Ollama is only exposed inside the Compose network.

Useful commands:

```powershell
docker compose logs -f worklog
docker compose logs -f ollama
docker compose down
```

To use a different local model, set `OLLAMA_MODEL` in your shell before `docker compose up`, then pull that model with `docker compose exec ollama ollama pull <model>`. `docker compose down -v` permanently deletes both named volumes, including saved worklogs and downloaded models.

The Docker setup stores the SQLite database in the `worklog-data` volume. Back up or remove it with Docker volume tools; the Settings screen can still delete all worklog entries.

## Build the Windows desktop installer

Run `npm run dist:win`. Electron Builder rebuilds SQLite for Electron, then creates an NSIS installer in `release/`. Install and launch the generated `WorkLog-AI-Setup-1.0.0.exe`. Worklog data is stored under Electron's per-user application data directory in `data/worklog.db`; this is separate from the installed app files. The installer is per-user and does not request administrator privileges.

To build on a clean Windows machine, install the project dependencies with `npm install` first. The packaging command prepares SQLite's native binding for Electron.

## Data and exports

Development database: `data/worklog.db`. Packaged desktop database: `%APPDATA%\worklog-ai\data\worklog.db` (Electron's user data folder). Use Settings to delete all saved worklogs. Reports provides Excel (`.xlsx`), CSV, and Markdown exports. Treat exported files as copies of your work records.

## Local AI behavior

The default endpoint is `http://127.0.0.1:11434` and the default model is `llama3.2`. Configure `OLLAMA_URL` and `OLLAMA_MODEL` in `.env` for development. Ollama must be installed and the selected model downloaded separately. The app requests JSON worklog fields and labels durations as rough estimates; use `0` when the note does not support a reasonable estimate. Confirm or adjust generated details before saving.

## Commands

- `npm run dev` — local API and Vite development UI
- `npm test` — SQLite persistence and filter test
- `npm run build` — production web UI bundle
- `npm run desktop` — launch the desktop shell (in development, run `npm run dev` in another terminal)
- `npm run dist:win` — create the Windows installer
