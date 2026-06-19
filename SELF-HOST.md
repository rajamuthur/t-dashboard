# Self-hosting on Windows (always-on) + Cloudflare Tunnel

Run the backend + frontend as always-on background services on your own PC,
auto-starting at boot and auto-restarting on crash, then expose them to the
internet for free with a Cloudflare Tunnel. No credit card, no server bill.

## Architecture

```
Internet ──HTTPS──▶ Cloudflare ──tunnel──▶ localhost:3000  (Next.js, production)
                                                  │  /api/backend/* rewrite
                                                  ▼
                                            localhost:8000  (FastAPI, private)
```

You only expose **port 3000**. The Next.js server proxies `/api/backend/*` to
the backend on localhost, so :8000 never faces the internet.

---

## 1. One-time: build the frontend

Production mode serves a prebuilt app (fast, low memory). Build it once:

```powershell
cd D:\Personal\personal\Trade\project-auth\frontend
npm run build
```

(The launcher also auto-builds if it finds no `.next/`, but doing it now is faster.)

## 2. Install the always-on services (Task Scheduler)

Open **PowerShell as Administrator**, then:

```powershell
cd D:\Personal\personal\Trade\project-auth
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
```

This registers two tasks — **TDashboard Backend** and **TDashboard Frontend** —
that:
- start automatically **when you log on** (reliable Interactive task, no stored password),
- **auto-restart** if the process dies (the launcher loops; Task Scheduler is a second net),
- run hidden in the background.

It also starts them immediately, so you don't need to log out. Verify:

```powershell
curl http://localhost:8000/openapi.json -o NUL -w "%{http_code}`n"   # 200
curl http://localhost:3000 -o NUL -w "%{http_code}`n"                 # 200/307
```

Logs: `scripts\logs\backend.log` and `scripts\logs\frontend.log`.

### After you change code

- **Backend change** → just restart its task:
  `Restart-ScheduledTask -TaskName "TDashboard Backend"` (or it picks up on next boot).
- **Frontend change** → rebuild + bounce:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\rebuild-frontend.ps1
  ```

### Remove the services

```powershell
# Admin PowerShell
powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1
```

---

## 3. Expose it with Cloudflare Tunnel

### Quick tunnel (random URL, zero config — no domain needed)

One-off:
```powershell
cloudflared tunnel --url http://localhost:3000
```
It prints a `https://<random>.trycloudflare.com` URL. Works instantly, but the
URL **changes on every restart** and isn't a background service.

**Always-on (scripted):** the repo ships a self-contained tunnel —
`scripts\cloudflare-tunnel.ps1` downloads `cloudflared` on first run (no winget
needed) and keeps a quick tunnel up with auto-restart. Register it at logon:
```powershell
.\scripts\install-cloudflare-tunnel.ps1     # Admin PowerShell, once
```
Find the current public URL any time:
```powershell
Select-String trycloudflare scripts\logs\cloudflare.log | Select-Object -Last 1
```
The URL still rotates on each (re)start. For a fixed URL, use the named tunnel.

### Named tunnel (stable URL, runs as a service — recommended)

Needs a free Cloudflare account **and a domain added to it** — a public,
browsable hostname requires a domain you control (point its nameservers at
Cloudflare). Without a domain, only the quick tunnel (random URL) is available.

```powershell
cloudflared tunnel login                      # opens browser, authorize
cloudflared tunnel create t-dashboard         # creates tunnel + credentials file
```

Create `C:\Users\<you>\.cloudflared\config.yml`:

```yaml
tunnel: t-dashboard
credentials-file: C:\Users\<you>\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: t-dashboard.example.com   # your domain, OR omit for a route you map
    service: http://localhost:3000
  - service: http_status:404
```

If you have a domain on Cloudflare, map it:

```powershell
cloudflared tunnel route dns t-dashboard t-dashboard.example.com
```

Install cloudflared as an auto-starting Windows service (so the tunnel also
survives reboots):

```powershell
# Admin PowerShell
cloudflared service install
```

Now the tunnel starts on boot alongside your backend + frontend. Your app is
reachable at your configured hostname.

---

## Notes & gotchas

- **Secrets stay local.** The Telegram token, Fyers keys, and OpenAI key live in
  `.env` and `fyers_data.db` on your machine — never in the repo. Nothing to set
  on Cloudflare.
- **PC must be on.** This hosts from your machine; it's reachable only while the
  PC is powered on and online. (That's the trade-off for $0 + no card.)
- **PORT/host.** Backend binds `127.0.0.1:8000` (localhost only). Frontend binds
  `:3000`. Only :3000 is tunneled.
- **Auth.** Login still uses the app's credentials. Before exposing publicly,
  consider putting Cloudflare Access (free) in front for a second gate.
- **Scheduler.** The backend's APScheduler jobs (EOW scan etc.) run locally since
  your `.env` has Fyers creds. Set `ENABLE_SCHEDULER=false` in `.env` to silence
  them if tokens are expired.
- **Updating the build.** `next start` serves the last `npm run build` output —
  remember to run `scripts\rebuild-frontend.ps1` after frontend code changes.
- **Start at logon, not before login.** The tasks use an Interactive At-Logon
  trigger (reliable, no password). They start the moment you log in — so keep the
  box logged in (or enable Windows auto-login) for true 24/7. If you genuinely
  need the services up *before* anyone logs in, re-register with a stored
  password instead: in `install-autostart.ps1` replace the principal with
  `-LogonType Password` + `-User $user` and add `-Password (Read-Host -AsSecureString)`,
  and change the trigger to `-AtStartup`. That runs at boot pre-login but stores
  your Windows password in the task store.
