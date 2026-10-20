# JARVIS-X Server

A small Node server with no third-party dependencies. It turns JARVIS-X into a multi-user service. Every feature is free for everyone — there are no plans or payments.

| Area | What it does |
|---|---|
| Accounts | Sign-up and sign-in with scrypt-hashed passwords. Sessions live in an httpOnly SameSite cookie (HS256 JWT plus a revocable session row). Includes password reset by email, password change (signs out other devices), a device limit (`MAX_DEVICES`, default 20) and account deletion. |
| AI | A proxy to Anthropic or any OpenAI-compatible API, with streaming and tool use. Keys never reach the browser. An optional fair-use cap (`AI_DAILY_LIMIT`, off by default) protects your bill. |
| Sync | Each user's workspace is stored AES-256-GCM-encrypted in SQLite, with optimistic versioning. Clients merge changes section by section. |
| Live data | Google News RSS, stock quotes (Yahoo Finance delayed, or Finnhub), and ECB exchange rates, all cached. |
| Code runner | Python, JavaScript, Java, C and C++ run in throwaway Docker containers with no network and capped CPU and memory. SQL runs in an isolated in-memory SQLite database. |
| Media | Image and speech generation (OpenAI), a Replicate relay for the Video Studio and FLUX plugins (`REPLICATE_API_TOKEN`, or each person's own token), and a music-search proxy (iTunes; YouTube via `YOUTUBE_API_KEY` or, without a key, public Piped/Invidious mirrors — override with `YOUTUBE_MIRRORS`). |
| Developer API | `/v1/tasks`, `/v1/notes`, `/v1/memory`, `/v1/events` and `/v1/chat`, using per-user API keys (also used by the Godot editor add-on). |

## Run it

```bash
cp .env.example .env        # fill in what you need
npm start                   # Node ≥ 22.13 — no npm install needed
# → http://localhost:8080
```

With Docker:

```bash
docker compose up -d --build
```

Put it behind HTTPS (Caddy, nginx or Cloudflare) and set `PUBLIC_URL=https://your-domain` and `TRUST_PROXY=true`. Cookies are marked `Secure` automatically when `PUBLIC_URL` is https.

**Back up `DATA_DIR`** (the SQLite database). Keep `VAULT_SECRET` stable: synced data is encrypted with it.

## Code runner

```bash
CODE_RUNNER=docker   # needs Docker on the host (mount /var/run/docker.sock when the server itself runs in Docker)
docker pull python:3.12-alpine node:22-alpine eclipse-temurin:21-jdk gcc:14
```

Each run starts with `--network none --memory 256m --cpus 0.5 --pids-limit 64 --read-only`, has a time limit, and caps output at 64 KB. `CODE_RUNNER=local` runs compilers directly on the host. **Use it for development only**, because user code would run with the server's permissions.

## API reference (summary)

```
GET  /api/health
POST /api/auth/register | login | logout | forgot | reset | password | delete
GET  /api/auth/me        PATCH /api/auth/me
GET  /api/auth/sessions  DELETE /api/auth/sessions/:id  POST /api/auth/sessions/revoke-others
GET  /api/ai/status                 POST /api/ai/chat {system, messages, tools?, stream?}
GET  /api/sync                      PUT  /api/sync {state, baseVersion}
GET  /api/data/news?q=  /api/data/quotes?symbols=  /api/data/fx?base=
GET  /api/run/status                POST /api/run {lang, code, stdin?}
POST /api/media/image {prompt, size}   POST /api/media/speech {text, voice}
POST /api/media/replicate/predictions {model, input}   GET /api/media/replicate/predictions/:id
GET  /api/music/search?source=itunes|youtube&q=
GET  /api/web/read?url=             Reader view (signed in; public http/https only — private networks refused)
GET/POST /api/keys  DELETE /api/keys/:id
/v1/tasks · /v1/notes · /v1/memory · /v1/events · /v1/chat   (Authorization: Bearer jxk_…)
```

All cookie-authenticated, state-changing requests must send `X-JX: 1`, which is the CSRF defence. API-key requests don't need it.

## Tests

```bash
npm test
```

The tests boot the real server with mocked Anthropic, Replicate, iTunes and data endpoints (`server/test/mock-providers.js`). They cover:
- health and feature flags
- auth and CSRF
- sync conflicts
- the AI tool loop and the optional fair-use cap
- developer API keys, the `/v1` API and the Replicate relay
- music search
- password reset
- live data
- the SQL sandbox
- static file security and CSP
