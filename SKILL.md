---
name: artificial-analysis-leaderboard
description: Fetch live LLM model rankings and Artificial Analysis composite indices — Intelligence Index, Coding Index, and Agentic Index — plus speed and pricing from https://artificialanalysis.ai/leaderboards/models. Use when the user asks for model benchmarks, "best models", model comparison, leaderboard/ranking, "가장 성능 좋은 모델", "모델 순위", "코딩 잘하는 모델", "에이전트/코딩 점수", Intelligence/Coding/Agentic Index, model speed/latency/pricing, or which model to pick for a task. Also deep-dives a single model (--deep): every benchmark score, full price breakdown, and the speed/latency percentile distribution. Returns current (live) data, not cached.
---

Invoke as a skill (e.g. `/skill:artificial-analysis-leaderboard`) or just ask about model
rankings in natural language (e.g. "요즘 가장 똑똑한 모델 뭐야?"). The script runs under
Node.js with zero dependencies — it works with any agent that loads SKILL.md.

# Artificial Analysis Leaderboard (Live)

Fetches **live** model rankings and metrics from
https://artificialanalysis.ai/leaderboards/models and prints them as a
human-readable table or JSON.

## When to use

- "요즘 가장 똑똑한 모델 뭐야?" / "best LLM right now"
- "모델 순위", "leaderboard", "model ranking"
- Model comparison by **intelligence**, **coding**, **agentic**, **speed**, **price**, or **latency**
- "코딩 잘하는 모델", "에이전트 점수", "best coding/agent model"
- "가장 빠른 모델", "가장 싼 모델", "best speed/price model"
- Filtering by creator (Anthropic, OpenAI, Google, DeepSeek, …) or model name
- Deep-dive one model — "이 모델 자세히", "GPT-5.6 벤치마크가 뭐야", "한 모델 가격/지연 분포 보여줘" → `--deep`

## How it works

The page is server-side rendered (Next.js) and embeds the full per-model data payload
in the HTML — **no API key, no JS rendering, no scraping of dynamic content**. The skill
script (`aa-leaderboard.js`, Node.js stdlib only — no dependencies) fetches the page and
extracts the embedded model array (~225 models, refreshed continuously), including the
Artificial Analysis composite indices (Intelligence / Coding / Agentic).

## Data fields

Each model row contains:

| Field | Meaning |
|---|---|
| `model` | Model name (e.g. `GPT-5.5 (xhigh)`) |
| `creator` | Vendor (Anthropic, OpenAI, Google, …) |
| `intelligence` | **Intelligence Index v4.1** — main quality score (higher = better). A trailing `*` means estimated. |
| `coding` | **Coding Index** — SWE-Bench Verified / LiveCodeBench blend (higher = better at coding) |
| `agentic` | **Agentic Index** — τ²-Bench / GDPval-AA / Terminal-Bench blend (higher = better at tool use / agents) |
| `blendedUSD` | Blended price per 1M tokens (lower = cheaper) |
| `speedTokPerSec` | Median output throughput, tokens/sec (higher = faster) |
| `latencyFirstChunk` | Time to first chunk, seconds (lower = snappier) |
| `totalResponse` | End-to-end response time, seconds |

`--` means that model has no data for that metric (e.g. newly released).

## Usage

The script is at `./aa-leaderboard.js` (relative to this skill dir). Run it with `node`.

```bash
# Top 15 models by Intelligence Index (default sort)
node aa-leaderboard.js --top 15

# Top 10 by CODING (best at code)
node aa-leaderboard.js --sort coding --top 10

# Top 10 by AGENTIC (best at tool use / agents)
node aa-leaderboard.js --sort agentic --top 10

# Top 10 by SPEED
node aa-leaderboard.js --sort speed --top 10

# Cheapest models (price ascending)
node aa-leaderboard.js --sort price --top 10

# Lowest latency (snappiest first-chunk)
node aa-leaderboard.js --sort latency --top 10

# Filter by creator
node aa-leaderboard.js --creator anthropic --top 10
node aa-leaderboard.js --creator deepseek

# Filter by model name (substring, case-insensitive)
node aa-leaderboard.js --model 'mini' --top 10

# Deep profile of ONE model: identity, all 3 indices, every benchmark,
# full price breakdown (input/output/cache/blends), and the speed/latency
# percentile distribution (p5–p95). Works by display name OR slug.
node aa-leaderboard.js --deep --model 'Claude Opus 5 (max)'
node aa-leaderboard.js --deep --model claude-opus-5          # slug works too
node aa-leaderboard.js --deep --model claude-opus-5 --json   # raw ~90-field payload

# Machine-readable JSON (for piping / further processing)
node aa-leaderboard.js --json --top 20
node aa-leaderboard.js --json --creator google
```

## Deep single-model profile (`--deep`)

`--deep` trades the many-rows table for a **full profile of one model**, surfacing
the ~90 fields the site embeds per model (the table only shows ~8 of them). It
groups them readably and is meant for "investigate this one model" questions.

Requires `--model X` (name or slug, substring OK; an exact match wins ties). Sections:

- **Identity** — full name, slug, creator + country, release date, context window,
  size/price tier, reasoning / open-weights flags, modalities, OpenRouter id
- **Composite Indices** — Intelligence / Coding / Agentic (0–100)
- **Benchmarks** — GPQA, MMMU-Pro, HLE, Terminal-Bench (v2.1 + hard), SciCode,
  τ²-Bench, Long-Context Reasoning, GDPval (normalized + Elo w/ 95% CI), Critical
  Point, Analyst Agent, IT-Bench (SRE), IF-Bench, Omniscience (accuracy /
  non-hallucination / score)
- **Pricing** — input / output / cache-read (w/ discount %) / cache-write, plus the
  blended variants (7:2:1 is the leaderboard's headline price)
- **Speed & latency distribution** — throughput and time-to-first-token across
  **p5 / p25 / p50 / p75 / p95** (a single median hides the long-tail reasoning runs),
  plus end-to-end and answer speed
- **Intelligence Index internals** — cost / time / tokens per eval task

`--deep --json` emits the whole decoded object (nested objects intact,
`$undefined` normalised to null) for programmatic use.

### Flags

| Flag | Description |
|---|---|
| `--top N` | Limit to top N rows (after sort + filter) |
| `--sort FIELD` | `intelligence` (default) · `coding` · `agentic` · `speed` · `price` · `latency` · `name` |
| `--creator X` | Filter: creator contains X (case-insensitive) |
| `--model X` | Filter: model name **or slug** contains X (case-insensitive). Required with `--deep`. |
| `--deep` | Full single-model profile (use with `--model X`): indices, every benchmark, price breakdown, latency percentiles |
| `--table` | Human-readable aligned table (default) |
| `--json` | Emit JSON array; with `--deep`, emit the model's full ~90-field object |

Sort direction: `intelligence`/`coding`/`agentic`/`speed` sort **descending** (best first);
`price`/`latency` sort **ascending** (cheapest/snappiest first); `name` sorts A→Z.
Rows with `--` in the sort field are pushed to the bottom.

## Output tips

- When the user asks a natural-language question, run the relevant query and
  **summarize the result in prose** — don't dump the raw table unless asked.
- The site tracks several leaderboards; this skill covers the **models** leaderboard
  (Intelligence / Coding / Agentic indices, speed, price). For image generation,
  speech, video, etc., point the user to the site directly.

## Reliability / notes

- Fetch is a plain HTTPS GET with a browser User-Agent. The parser extracts the
  embedded model data payload (see `parse()` / `field()` in the script); if the site
  changes that payload shape, the parser will need updating.
- Data is live at fetch time; Artificial Analysis updates continuously.
- No API key required — public leaderboard.
