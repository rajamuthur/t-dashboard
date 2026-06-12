# Deploy — free `.fly.dev` (backend) + `.vercel.app` (frontend)

No domain purchase needed. Fly gives you `https://<app>.fly.dev` and Vercel
gives `https://<project>.vercel.app`, both with HTTPS, free.

Artifacts already in the repo:
- `Dockerfile` + `.dockerignore` — backend image (port 8080)
- `fly.toml` — Fly config with a persistent volume for the SQLite DB
- `frontend/next.config.mjs` — reads `NEXT_PUBLIC_BACKEND_URL`
- `.env.example` — every env var, no values

---

## 1. Backend → Fly.io

Install flyctl: <https://fly.io/docs/hands-on/install-flyctl/>, then:

```bash
flyctl auth signup            # or: flyctl auth login
cd D:\Personal\personal\Trade\project-auth

# Pick a globally-unique app name → your URL becomes https://<that-name>.fly.dev
# Use --no-deploy so we can create the volume + secrets BEFORE first boot.
flyctl launch --no-deploy --copy-config --name t-dashboard-api --region sin
```

If `flyctl launch` offers to overwrite `fly.toml`, **decline** — keep the one
in the repo. Make sure the `app = "..."` line matches the name you chose.

### Create the persistent volume (holds your trades DB)

```bash
flyctl volumes create data --size 1 --region sin   # 1 GB, free up to 3 GB
```

The region must match `primary_region` in `fly.toml` (`sin`).

### Set secrets (encrypted by Fly — never in git)

```bash
flyctl secrets set JWT_SECRET="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')"
flyctl secrets set ADMIN_USERNAME="your-username"
flyctl secrets set ADMIN_PASSWORD="a-strong-password"
# CORS — fill in AFTER step 2 once you know the Vercel URL (you can re-run this anytime):
flyctl secrets set CORS_ORIGINS="https://t-dashboard.vercel.app"
```

`ENV=production`, `DB_PATH`, `ENABLE_SCHEDULER=false`, and `PORT=8080` are
already set in `fly.toml [env]` — no action needed. (Leave the scheduler off
unless you wire real Fyers credentials; the Trades + Live Charts features
don't use it.)

### Deploy

```bash
flyctl deploy
flyctl status          # confirm the machine is healthy
flyctl logs            # watch boot logs
```

Your backend is now at **`https://t-dashboard-api.fly.dev`**. Sanity check:

```bash
curl https://t-dashboard-api.fly.dev/openapi.json -o NUL -w "%{http_code}\n"   # expect 200
```

### (Optional) bring your existing trades to the server

Your local `fyers_data.db` is gitignored, so upload it once:

```bash
flyctl ssh sftp shell
# at the sftp> prompt:
put fyers_data.db /app/data/fyers_data.db
```

Skip this to start the deployed app with a fresh, empty DB.

---

## 2. Frontend → Vercel

```bash
cd frontend
npx vercel login
npx vercel            # first run: creates the project (accept defaults)
```

In the Vercel dashboard → your project → **Settings → Environment Variables**:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `https://t-dashboard-api.fly.dev` |

Then deploy to production:

```bash
npx vercel --prod
```

Your app is now at **`https://t-dashboard.vercel.app`** (Vercel prints the
exact URL). Go back to step 1 and set `CORS_ORIGINS` to this URL, then
`flyctl deploy` again (or just `flyctl secrets set` — it restarts the app).

---

## 3. First login

Open the Vercel URL → log in with the `ADMIN_USERNAME` / `ADMIN_PASSWORD`
you set on Fly. Live Charts opens in the 2-pane default; Trades & P&L is in
the sidebar.

If login returns **503 "Auth not configured"** → `JWT_SECRET` isn't set on
Fly. Run the `flyctl secrets set JWT_SECRET=...` line again and redeploy.

If the browser console shows **CORS errors** → `CORS_ORIGINS` doesn't match
your exact Vercel URL (no trailing slash). Fix and redeploy.

---

## What's free vs. what costs

| | Free tier | Notes |
|---|---|---|
| Fly.io backend | ✓ | Machine auto-stops when idle, wakes on request (~few-sec cold start). 3 GB volume free. |
| Fly `.fly.dev` URL + SSL | ✓ | Automatic. |
| Vercel frontend | ✓ | Generous personal limits. |
| Vercel `.vercel.app` URL + SSL | ✓ | Automatic. |
| Custom domain (e.g. `mytrades.in`) | ✗ (registrar fee) | Optional. Attach free to both Fly + Vercel via a DNS CNAME; you only pay the registrar (~$3–10/yr). [duckdns.org](https://duckdns.org) is a free subdomain alternative. |

---

## Updating after the first deploy

```bash
# backend changes:
flyctl deploy
# frontend changes:
cd frontend && npx vercel --prod
```

Or wire GitHub auto-deploy: Vercel deploys the frontend on every push;
Fly can do the same with a GitHub Action (`flyctl deploy` on push to main).

---

## Secret hygiene reminder

- Never commit `.env`, `fyers_data.db`, `archive/`, or `*.log` (all gitignored).
- If a token ever leaks: rotate it.
  - Fyers → <https://myapi.fyers.in> (revoke + recreate the app)
  - OpenAI → <https://platform.openai.com/api-keys>
  - `JWT_SECRET` / `ADMIN_PASSWORD` → `flyctl secrets set ...` (invalidates sessions)
