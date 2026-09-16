# career-ops web (alpha)

An **experimental, opt-in web UI** for career-ops. It is a local-first *view* over
the exact same files the CLI reads and writes (`data/pipeline.md`,
`data/applications.md`, `reports/`, `config/`): no parallel engine, no separate
database, no server. If you never run it, nothing about your CLI workflow changes.

> **Status: alpha.** Expect rough edges. Feedback →
> [Discussion #1142](https://github.com/santifer/career-ops/discussions/1142) ·
> roadmap context → [Discussion #156](https://github.com/santifer/career-ops/discussions/156).

## Quick start

Requires Node 20+.

```bash
cd web
npm ci
npm run dev
```

Open http://localhost:3000. The app reads the career-ops checkout it lives in
(the parent directory) — your existing CV, pipeline and reports appear as-is.

Run more than one checkout on one machine by giving each its own port
(`npm run dev -- -p 3001`).

### Before it will be useful

The web app is a view over the core, so the core has to be set up first:

| Needed | Why | Check |
|---|---|---|
| `cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml` | every page reads them | `node doctor.mjs --json` → `onboardingNeeded: false` |
| Node 20+ | Next.js 15 | `node -v` |
| An AI CLI | only the AI-powered buttons | `node doctor.mjs` lists what it found |
| Playwright browsers | JD capture, liveness checks, company browsing | `npx playwright install chromium` |

Only the first two are required. Without an AI CLI the zero-token features
still work.

## What works today

- **Pipeline** — your tracker as a sortable, filterable table; status changes
  write back through the core's own scripts. Inbox rows carry location, age and
  a source tag; bookmarking moves a role to the Shortlist tab.
- **Explore** — the free reverse-ATS scan with an honest partial-dataset
  indicator, plus AI-assisted discovery (bring your own CLI/keys).
- **Apply** — assisted form prefill with a hard rule inherited from the core:
  **it never submits for you** — you always press the button.
- **Today / Analytics / CV / Config** — action queue, funnel, CV editing with
  preview, settings.

### The three scan buttons are not interchangeable

They sit next to each other and differ by orders of magnitude in cost:

| Button | Backend | Tokens | Typical run |
|---|---|---|---|
| **Scan portals** | `scan.mjs` via `/api/scan` | **zero** | seconds |
| **Scan ATS Full** | `scan-ats-full.mjs` via `/api/scan-ats-full` | **zero** | **10–20 min** |
| **Broad search (AI)** | your AI CLI via `/api/run` | **spends tokens** | minutes |

- **Scan portals** — the companies and boards *you* configured in `portals.yml`.
  Pure HTTP + JSON through `providers/`.
- **Scan ATS Full** — the *reverse* scan: walks the public per-ATS company
  directories (Greenhouse, Lever, Ashby, Workday — tens of thousands of
  employers) and keeps whatever matches your `title_filter`/`location_filter`.
  No company curation needed. Still zero tokens, but long-running, which is why
  it is a separate button behind its own confirmation.
- **Broad search (AI)** — the coverage a script cannot reach: `search_queries`
  (WebSearch) plus browsing career sites no provider supports. The only one
  that costs money.

Long runs are recorded in a durable job registry
(`.career-ops-web/job-registry.json`), so closing the tab — or the whole app —
does not lose them; the buttons re-adopt a running job when you return.

## Configuration

### Environment (`web/.env.local`, all optional)

| Variable | Default | Purpose |
|---|---|---|
| `CAREER_OPS_ROOT` | the parent checkout | point the app at a different career-ops directory |
| `JOB_CONCURRENCY` | `5` | how many AI jobs run at once; the rest queue |
| `DEBUG_ENABLED` | `false` | show the raw worker transcript panels |

`DEBUG_ENABLED` is read per request, so toggling it needs a server restart but
not a rebuild.

### Model routing (`config/profile.yml`)

On OpenCode you can send different modes to different models — a cheap one for
scanning, a stronger one for scoring:

```yaml
opencode_models:
  default: "opencode-go/deepseek-v4-flash"
  scan: "opencode-go/qwen3.7-plus"        # Broad search
  triage: "opencode-go/deepseek-v4-flash"  # Quick Triage
  evaluate: "opencode-go/hy3"              # scoring — the one worth paying for
```

Only those four keys are read. An extra key is not a fallback; it does nothing.

### Giving the AI worker a browser (optional)

Some career sites have no ATS API and render listings with JavaScript. A
headless worker can still read them, but only with browser tools. For OpenCode,
in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp@latest",
                  "--headless", "--isolated", "--output-dir", "/tmp/playwright-mcp"],
      "enabled": true
    }
  }
}
```

Without it the worker falls back to `browser-extract.mjs`, which reads
`<a href>` links only. That returns nothing on card-based boards, so treat an
empty result as "needs a manual look", never as "this company has no jobs".

## Installing it as an app (PWA)

The app ships a manifest, icons and a service worker, so it installs on a phone
or desktop.

- **iOS/Safari** — Share → *Add to Home Screen*.
- **Android/Chrome** — *Install app*. Chrome requires a registered service
  worker before offering this, which is what `public/sw.js` is for.

The service worker caches nothing but a static offline page.

To use it from your phone, either browse to `http://<machine-ip>:3000` on the
same network, or expose it with something like a Cloudflare Tunnel for HTTPS
and a stable hostname.

> **The app has no login of its own.** Anything that can reach the port can read
> your CV, your salary expectations and every application you have tracked. Keep
> it on localhost, or put authentication in front of it.

## Safety

- **Local-first:** runs entirely on your machine — no cloud, no account needed.
  Your CV and data stay in your own files.
- **Never auto-submits:** the apply flow drafts and prefills; submitting is
  always a human action.
- **Additive:** the web is isolated from the core's packaging, CI and release
  automation. The CLI works exactly the same without it.
- **No auth of its own:** see above before exposing it.

## Development

```bash
npm run dev          # dev server (Turbopack)
npx tsc --noEmit     # typecheck
npm run build        # production build
```

Set `CAREER_OPS_ROOT=/path/to/checkout` in `web/.env.local` to point the app at
a different career-ops directory (useful for testing against sample data). Run
the core's suite from the repo root (`node test-all.mjs`) — it covers the
scripts the web app shells out to.

### Running it as a service

Any process manager works. With PM2:

```bash
cd web && npm run build
pm2 start npm --name career-ops -- start
pm2 save
```

**Rebuild after changing anything under `web/src`.** Server routes and the AI
prompts inside them are baked into the build, so a restart alone will not pick
up a change.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| A button reports an HTML error instead of JSON | that API route is missing from this checkout — compare `web/src/app/api/**/route.ts` |
| Android says "can't install this app" | no service worker registered, or the manifest/icons are unreachable (an auth proxy will redirect them when signed out) |
| A long scan's spinner disappears after navigating away | that route isn't writing to the durable registry (`registerJob`/`updateJob`) |
| Nothing found at a company whose board is JS-rendered | expected without Playwright MCP — see above |
| An edit to a server route changes nothing | rebuild, don't just restart |
