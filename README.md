# WorkLog AI

WorkLog AI is a personal work journal for recording tasks in a format that is easy to review later. You can write a quick note, optionally ask a local AI model to prepare a title and worklog, edit the result, and save it. The app also has task history, search and filters, summaries, and CSV, Excel, and Markdown exports.

The app is designed to run on your own computer. It saves data in a local SQLite database. Optional AI text generation uses Ollama on your computer; WorkLog AI does not send prompts to a cloud AI service.

## What the app does

1. You create a local account with your name, email, and password.
2. You write a short note about work you did, such as `Updated the deployment pipeline and tested it.`
3. Optionally, select **Generate with local AI**. Ollama suggests a task title, description, comment, category, status, and a rough duration when the note has enough detail.
4. Review and edit the fields. AI output is a suggestion; enter the actual time yourself when you know it.
5. Select **Save worklog**. The task is saved to the local database for your account.
6. Use the dashboard and history to search and filter entries. Reports can be exported as Excel, CSV, or Markdown.

Each account sees its own tasks. Accounts are local to this database: there is no email verification, cloud account, or password reset service. Keep your password safe. When upgrading an older database that has tasks but no accounts, the first account created receives those existing tasks.

## Run manually on Windows

### Requirements

- Windows 10 or 11
- Node.js 20 or newer (npm is included with Node.js)
- Ollama for Windows, only if you want AI generation

### 1. Open the project

Open PowerShell in the project folder (the folder containing `package.json`). If you downloaded the project from GitHub, you can use:

```powershell
git clone https://github.com/jainmanav25/Worklog-AI.git
cd Worklog-AI
```

If you already have the project folder, open PowerShell there instead.

### 2. Install the app dependencies

```powershell
npm install
```

### 3. (Optional) Set up local AI

Install and start [Ollama](https://ollama.com/download), then download the default model:

```powershell
ollama pull llama3.2
```

Keep Ollama running while you use AI generation. The app uses `http://127.0.0.1:11434` and the `llama3.2` model by default. To use another model already installed in Ollama, copy `.env.example` to `.env` and change `OLLAMA_MODEL` to its name. Restart the app after changing `.env`.

AI is optional. Without Ollama, you can still fill in all fields yourself and save worklogs; only AI generation will be unavailable.

### 4. Start the app

The simplest option starts the API and the development website together:

```powershell
npm run dev
```

Open the Vite URL shown in the terminal, usually <http://localhost:5173>. Keep the terminal open while using the app. Press **Ctrl+C** there to stop it.

The API listens on `127.0.0.1:4317`; Vite forwards app requests to it. To run them separately, open two PowerShell windows in the project folder:

```powershell
# Window 1: start the API
npm run server
```

```powershell
# Window 2: start the website
npm run client
```

Then open the URL printed by Vite.

### 5. Sign up and save a worklog

Choose **Sign up**, enter your name, email, and a password of at least 10 characters, and create your account. Then write a note on the Add a task page. You can generate a suggestion if Ollama is ready, edit the suggested fields, and save. Your saved entries are available when you sign in again on this database.

## Where data is stored

When running manually, SQLite data is stored at `data/worklog.db` inside the project folder. The `data` directory is created automatically and is excluded from Git. Back up this file if you want to preserve your worklogs when moving computers or deleting the project.

The Windows desktop installer stores data in Electron's per-user application data directory, under `%APPDATA%\worklog-ai\data\worklog.db`. This is separate from the manual development database.

## Run with Docker Compose

Docker is an alternative to the manual Node.js steps. Install Docker Desktop and start its Linux container engine. In PowerShell, from the project folder, run:

```powershell
docker compose up --build -d
docker compose exec ollama ollama pull llama3.2
```

Open <http://localhost:4317>. The Compose setup runs the WorkLog AI website and API in one container and Ollama in another. SQLite files and model files are stored in separate named Docker volumes. They survive container restarts and `docker compose down`.

Useful Docker commands:

```powershell
docker compose ps                 # Show service status
docker compose logs -f worklog    # Follow app logs
docker compose logs -f ollama     # Follow Ollama logs
docker compose down               # Stop and remove containers; keep saved volumes
docker compose up -d              # Start the existing services again
```

**Data warning:** `docker compose down -v` removes the named volumes, including saved worklogs and downloaded models. Do not use it unless you intend to delete them. By default the web app port is available only from your own computer (`127.0.0.1:4317`).

## Tests and other commands

```powershell
npm test          # Run automated API and database tests
npm run build     # Build the production website into dist/
npm run desktop   # Launch the Electron desktop shell (start npm run dev separately)
npm run dist:win  # Build a Windows installer in release/
```

## Troubleshooting

- **The page does not load:** When using manual development mode, check that both API and Vite are running. With Docker, run `docker compose ps` and check `docker compose logs -f worklog`.
- **AI says it is not connected:** Start Ollama and check `ollama list`. Make sure the configured model is downloaded (for example, `ollama pull llama3.2`). For Docker, download the model with `docker compose exec ollama ollama pull llama3.2`.
- **I cannot find my old tasks:** Manual mode and Docker use different databases. Manual mode uses `data/worklog.db`; Docker uses its `worklog-data` volume. Tasks are also private to the account that owns them.
- **I forgot my password:** There is no password reset flow. The app does not have access to an email service to reset it.
