# 🔮 Delphi

A council-based prediction engine. Five AI forecaster personas deliberate in two rounds, their judgments are combined with a track-record-weighted logarithmic opinion pool, and **the system grades itself** — every resolved question updates each councilor's Brier score, which drives future aggregation weights.

Built from Ryan's [Prediction](https://github.com/Franzferdinan51/Prediction) (forecast types, provider configs, research patterns) and [AI-Bot-Council-Consensus](https://github.com/Franzferdinan51/AI-Bot-Council-Consensus) (councilor selection, quality gates, orchestration) repos.

## Quickstart

```bash
cd ~/workspace/delphi
npm install          # engine deps
npm test             # 39 tests
npm run dev:api      # API on http://127.0.0.1:8790 (demo mode, zero creds)
npm run dev          # web UI (proxies /api → :8790)
```

Or production-style: `npm run build && npm start` — the API serves the built UI itself on port 8790.

Try it:

```bash
npx tsx src/cli.ts ask "Will Bitcoin exceed $150k in 2026?" --type binary --deadline 2026-12-31
npx tsx src/cli.ts resolve <id-prefix> yes
npx tsx src/cli.ts leaderboard
```

Install the CLI globally-ish: `npm run build && npm link` → `delphi ask …`.

**Demo mode is on by default** (`DELPHI_DEMO=true`). Everything works with zero credentials — canned providers, canned research. Flip to live with `--live` (CLI) or `demoMode: false` (API).

## Going live

| Provider | Env var | Default |
|---|---|---|
| LM Studio (local-first default) | `LMSTUDIO_URL`, `LMSTUDIO_MODEL`, `LM_API_TOKEN` | `http://127.0.0.1:1234/v1` |
| MiniMax | `MINIMAX_API_KEY`, `MINIMAX_MODEL`, `MINIMAX_ENDPOINT` | `MiniMax-M2.7` |
| Grok (xAI) | `XAI_API_KEY`, `GROK_MODEL`, `GROK_ENDPOINT` | `grok-4.5` |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_ENDPOINT` | `gpt-4o-mini` |
| NVIDIA NIM | `NVIDIA_API_KEY`, `NVIDIA_MODEL`, `NVIDIA_ENDPOINT` | `nvidia/llama-3.1-nemotron-70b-instruct` |
| OpenCode Zen (free) | `OPENCODE_MODEL`, `OPENCODE_ENDPOINT` (no key needed) | `claude-sonnet-4-6` |

Every provider speaks the OpenAI-compatible `/chat/completions` protocol, so LM Studio, vLLM, Ollama, or any other endpoint works by changing the URL. Demo mode stays on unless you flip it (`DELPHI_DEMO=false`).

### Custom providers

Add arbitrary OpenAI-compatible endpoints via `DELPHI_PROVIDERS` (JSON array):

```bash
export DELPHI_PROVIDERS='[
  {"id":"deepseek","name":"DeepSeek","endpoint":"https://api.deepseek.com/v1",
   "model":"deepseek-chat","apiKey":"sk-..."},
  {"id":"ollama","name":"Ollama (local)","endpoint":"http://127.0.0.1:11434/v1",
   "model":"qwen3:8b"}
]'
```

Keyless local servers are probed at `/models`; keyed ones are marked connected when the key is present. Secrets can also come from per-provider env vars (`DELPHI_PROVIDER_<ID>_API_KEY`, `_ENDPOINT`, `_MODEL`) instead of living in the JSON. Custom providers show up in `/api/health` and `get_providers`, and any councilor can be reassigned to one:

```bash
export DELPHI_COUNCILOR_PROVIDER_SKEPTIC=deepseek   # skeptic now runs on DeepSeek
```

Councilor ids: `base-rate-analyst`, `domain-expert`, `skeptic`, `superforecaster`, `quant`.

Research: `SEARXNG_URL` (default `http://127.0.0.1:8080`), or `TAVILY_API_KEY` / `BRAVE_API_KEY` to use those instead. Other knobs: `DELPHI_PORT` (8790), `DELPHI_HOST`, `DELPHI_DB` (default `data/delphi.db`). Requires Node ≥ 22 (uses `node:sqlite`).

## Architecture

```
src/
  pipeline.ts   Research → Deliberate → Critic → Aggregate → Learn
  council.ts    5 personas + topic-relevance selection + prompts
  providers.ts  OpenAI-compatible chat calls + deterministic demo mode
  research.ts   SearXNG/Tavily/Brave, 5-min SQLite cache, URL dedup
  aggregate.ts  Log opinion pool, track-record weights, extremization
  scoring.ts    Brier / log scores, calibration buckets, outcome parsing
  quality.ts    Response quality gates (length, tags, forbidden patterns)
  db.ts         SQLite schema + queries (node:sqlite)
  resolve.ts    Resolution + per-councilor grading
  seed.ts       3 resolved example questions (leaderboard isn't empty)
  cli.ts        ask / resolve / leaderboard / list / show
  api.ts        HTTP API + SSE streaming + serves web/dist + /mcp
  mcp.ts        MCP server (Streamable HTTP) — forecast lifecycle as tools
  service.ts    Shared read models (REST + MCP + CLI use the same shapes)
web/            Vite + React UI (built by a second agent, same contract)
```

### The pipeline, per question

1. **Intake** — question, type (`binary` | `timing` | `numeric` | `categorical`), deadline, resolution criteria, context → SQLite.
2. **Research** — budgeted web research (2 queries × 6 results), 5-minute cache, URL dedup; notes injected into every councilor's brief.
3. **Deliberation** — 3–5 personas selected by topic relevance forecast **independently** (round 1, parallel). Each persona is a system prompt + assigned provider:
   - **Base-Rate Analyst** — outside view, reference classes
   - **Domain Expert** — inside view, causal mechanisms
   - **Skeptic** — red team, steelmans the opposite
   - **Superforecaster** — Fermi decomposition, Bayesian updating
   - **Quant Modeler** — distributions, explicit numbers
4. **Critic** — round 2: each councilor sees peers' reasoning and may update (anchoring to the group is penalized in the prompt).
5. **Aggregation** — logarithmic opinion pool (geometric-mean consensus), weights from each councilor's resolved Brier history, then extremization. Cold start: equal weights until 5+ resolved forecasts each.
6. **Output** — central answer, calibrated probability, full readout (thesis, drivers, counter-signals, update triggers, assumptions, best/worst case, timeline, indicators, per-councilor opinions with reasoning).
7. **Resolution & grading** — `resolve` records the outcome; Brier + log scores per councilor and provider update the leaderboard. This self-grading loop is the killer feature.
8. **Belief tracking** — re-running a question (`--rerun <id>` / `existingQuestionId`) appends a new forecast run; the UI charts probability over time.

## Methodology — why each piece exists

- **Council, not a single model.** Single models are overconfident and miss base rates. Five deliberately opposed personae (outside view vs inside view vs red team) produce the disagreement that makes aggregation work.
- **Two rounds, not one.** Round 1 preserves independence (the key ingredient — correlated errors don't cancel). Round 2 lets genuine new evidence propagate without herding, because the critic prompt explicitly warns against anchoring.
- **Logarithmic opinion pool, not averaging.** Arithmetic averaging of probabilities double-counts shared evidence. The log pool (normalized geometric mean) is the coherent way to combine independent Bayesian judgments.
- **Track-record weights, not vibes.** Weights come from resolved Brier scores: skill = improvement over the always-say-50% baseline (0.25). Councilors who are actually calibrated earn influence; cold start is equal weights so nobody dominates before they've proven anything.
- **Extremization.** Groups of forecasters are systematically underconfident. Pushing the aggregate away from 50% (Satopää et al.) corrects for that.
- **Self-grading.** A prediction system that never scores itself is a horoscope. Every resolution is public, per-councilor, and feeds the weights — the system gets better (or visibly doesn't) over time.

## HTTP API

Base `http://127.0.0.1:8790`. All JSON, CORS open.

| Method | Route | Notes |
|---|---|---|
| `POST` | `/api/ask` | **SSE stream** of pipeline events → final `result`. Body: `question`, `questionType`, `deadline`, `resolutionCriteria?`, `context?`, `demoMode?`, `councilSize?` (3–5), `existingQuestionId?` (re-run) |
| `POST` | `/api/resolve` | `{ id, outcome }` — binary: `yes`/`no`; else `correct`/`incorrect` |
| `GET` | `/api/questions` | list with latest probability + status |
| `GET` | `/api/questions/:id` | full detail: readout, belief history, opinions, resolution |
| `GET` | `/api/leaderboard` | councilors + providers ranked by Brier (lower = better) |
| `GET` | `/api/calibration` | 10 calibration buckets + Brier-over-time |
| `GET` | `/api/health` | version, demo mode, provider connectivity |

SSE event types: `started`, `phase` (`research`→`deliberation`→`critic`→`aggregation`→`done`), `research`, `opinion` (rounds 1 & 2), `result`, `error`.

## Agent access (MCP)

Delphi isn't just for humans — external agents (Ryan's bots, coding agents, anything that speaks MCP) can drive the full forecast lifecycle over the network. One endpoint:

```
POST http://127.0.0.1:8790/mcp
```

**Streamable HTTP, stateless.** Send JSON-RPC 2.0 (`initialize` → `notifications/initialized` → `tools/list` / `tools/call`); each POST gets a single JSON response. No sessions, no SSE stream (that's what the REST `/api/ask` endpoint is for). Clients must send `Accept: application/json, text/event-stream` per the MCP spec.

| Tool | What it does |
|---|---|
| `ask_forecast` | Run the full council pipeline. Args: `question`, `question_type`, `deadline`, `resolution_criteria?`, `context?`, `demo_mode?`, `council_size?`, `existing_question_id?` (belief tracking). Returns the stored forecast: probability, per-councilor opinions, full readout. |
| `list_questions` | All questions with latest probability + status |
| `get_question` | Full detail: metadata, belief history, latest forecast, resolution |
| `resolve_question` | `{ id, outcome }` → records outcome, returns per-councilor Brier/log grades |
| `get_leaderboard` | Councilor + provider track records, ranked by Brier |
| `get_calibration` | Calibration buckets + Brier-over-time |
| `list_councilors` | The 5 personas: role, topics, default provider |
| `get_providers` | Built-ins + custom endpoints, with connectivity |
| `delphi_health` | Version, demo mode, provider status |

IDs accept unambiguous prefixes, like the CLI.

**Example client config** (Claude Code / any MCP client with Streamable HTTP support):

```json
{
  "mcpServers": {
    "delphi": {
      "url": "http://127.0.0.1:8790/mcp"
    }
  }
}
```

Over Tailscale, swap in the machine's tailnet IP and set `DELPHI_HOST=0.0.0.0` so bots on other boxes can reach it.

## CLI

```
delphi ask "<question>" --type binary --deadline 2027-01-01 [--criteria …] [--context …]
       [--council 4] [--demo|--live] [--rerun <id>]
delphi resolve <id> <yes|no>     # non-binary: correct|incorrect
delphi leaderboard
delphi list
delphi show <id>
```

IDs can be unambiguous prefixes (first 8 chars shown everywhere).

## Web UI

`web/` — dark, premium forecasting platform: ask console with live deliberation streaming (watch councilors' opinions arrive per round), question detail with belief-over-time chart and per-councilor cards, leaderboard, calibration dashboard (calibration curve + Brier over time). Hand-rolled SVG charts, no chart deps.

## What's deliberately not here (yet)

- **Non-binary scoring beyond correct/incorrect.** Timing/numeric/categorical questions score on whether the central answer was right, not how close. Continuous Ranked Probability Score would be the upgrade.
- **Prediction-market / poll ingestion.** The Quant wants market prices; there's no Polymarket/metaculus fetcher yet.
- **Auth on the API *and* the MCP endpoint.** Both are loopback-first; put them behind a reverse proxy before exposing them.
- **Multi-user / teams.** Single-user SQLite, like everything else Ryan runs locally.
- **Automatic resolution.** Outcomes are recorded by hand. Auto-resolution from news feeds is a real roadmap item.
