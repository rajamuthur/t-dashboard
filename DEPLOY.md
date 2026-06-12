# Deploying to Fly.io (free tier) + Vercel

Goal: backend on Fly.io with a persistent volume for the SQLite trades DB;
frontend on Vercel (or anywhere). All secrets injected at runtime — never
committed.

## 0. Before the first push to GitHub

Verify nothing sensitive sneaks in:

```bash
git init
git add .
git status               # scan the staged-files list
# look for .env, fyers_data.db, *.log, archive/, screenshots/ — these MUST NOT appear
git commit -m "initial commit"
git remote add origin https://github.com/rajamuthur/t-dashboard.git
git push -u origin main
```

If you accidentally stage `.env` or `fyers_data.db`, do **not** push — run
`git reset` first, fix `.gitignore`, and re-add.

GitHub also has push protection that scans for known token formats
(OpenAI `sk-…`, AWS keys, etc.) — if it blocks the push, **don't override**:
remove the secret, rotate it, and try again.

If you ever did push a secret by mistake — even just once, even if you
delete it in a follow-up commit — **rotate that secret immediately**. Git
history keeps the original blob, and bots scrape public GitHub within minutes.

## 1. Backend → Fly.io

Install flyctl: <https://fly.io/docs/hands-on/install-flyctl/>

```bash
flyctl auth signup        # or `flyctl auth login`
cd /path/to/t-dashboard
flyctl launch             # generates Dockerfile + fly.toml — accept defaults
flyctl volumes create data --size 1   # 1 GB persistent disk (free up to 3 GB)
```

Edit `fly.toml` so `/app/data` mounts the volume:

```toml
[[mounts]]
  source = "data"
  destination = "/app/data"
```

Set `DB_PATH=/app/data/fyers_data.db` so SQLite writes to the volume.

### Inject secrets (these stay encrypted on Fly's side)

```bash
# Auth — required
flyctl secrets set ENV=production
flyctl secrets set JWT_SECRET="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')"
flyctl secrets set ADMIN_USERNAME="<your-username>"
flyctl secrets set ADMIN_PASSWORD="<a-strong-password>"

# CORS — set to your deployed frontend URL
flyctl secrets set CORS_ORIGINS="https://t-dashboard.vercel.app"

# Storage
flyctl secrets set DB_PATH=/app/data/fyers_data.db

# Optional integrations (only if you use them)
flyctl secrets set OPENAI_API_KEY="<your-openai-key>"
flyctl secrets set CLIENT_APP_ID="<fyers-app-id>"
flyctl secrets set APP_SECRET="<fyers-app-secret>"
# …add the rest of the Fyers vars only when you intend to run those features
```

Verify secrets are loaded but their values stay hidden:

```bash
flyctl secrets list
flyctl deploy
```

## 2. Migrate your existing trades to the production volume

Your local `fyers_data.db` is gitignored — you have to upload it once:

```bash
flyctl ssh sftp shell
# then in the sftp prompt:
put fyers_data.db /app/data/fyers_data.db
```

(Skip if you'd rather start fresh on the deployed app — but then the
trades you've already logged locally won't be there.)

## 3. Frontend → Vercel

```bash
cd frontend
npx vercel login
npx vercel              # accept defaults; pick the `frontend` folder
```

Set the API rewrite to point at Fly. In Vercel project → **Settings → Environment Variables**:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `https://<your-fly-app>.fly.dev` |

You also need to update `frontend/next.config.mjs` to read from that env
(currently hardcoded to `localhost:8000`) — see the patch in the README.

## 4. After deploy

- Open `https://t-dashboard.vercel.app` and log in with the
  `ADMIN_USERNAME`/`ADMIN_PASSWORD` you set.
- The `/auth/login` endpoint mints a JWT signed with `JWT_SECRET`. If
  `JWT_SECRET` is missing on the server you'll get `503 Auth not configured`
  on login — fix by `flyctl secrets set JWT_SECRET=...`.

## What is and isn't protected

| Item | Where it lives | Public? |
|---|---|---|
| Real Fyers tokens, OpenAI key, FYERS_PIN | local `.env` + Fly.io secrets | **No** — `.env` is gitignored; Fly stores secrets encrypted |
| `fyers_data.db` (trades + cached data) | local file + Fly volume | **No** — gitignored, mounted on the Fly volume |
| `archive/` (legacy tokens, old logs) | local only | **No** — gitignored |
| `JWT_SECRET`, `ADMIN_PASSWORD` | Fly secrets only | **No** — never committed |
| Source code, `.env.example`, `DEPLOY.md` | git | **Yes** — safe to publish |

## Rotating credentials after exposure

If a token ever leaks (anywhere — push, screenshot, copy-paste):

1. **Fyers**: log in to <https://myapi.fyers.in> → revoke the app and re-create. Tokens older than the rotation are dead.
2. **OpenAI**: <https://platform.openai.com/api-keys> → revoke + create new.
3. **JWT_SECRET**: `flyctl secrets set JWT_SECRET=<new>` — all current sessions stop working.
4. **ADMIN_PASSWORD**: same, just rotate.
