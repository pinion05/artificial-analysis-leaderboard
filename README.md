# Artificial Analysis Leaderboard (Live) — Agent Skill

A portable **coding-agent skill** that fetches **live** LLM model data from [artificialanalysis.ai/leaderboards/models](https://artificialanalysis.ai/leaderboards/models) — including Artificial Analysis' three composite indices:

- **Intelligence Index** (v4.1)
- **Coding Index** (SWE-Bench Verified / LiveCodeBench)
- **Agentic Index** (τ²-Bench / GDPval-AA / Terminal-Bench)

…plus median output speed, time-to-first-token, and blended pricing. ~225 models, continuously updated.

The skill follows the common `SKILL.md` format (a `name` + `description` frontmatter and a Markdown body), so it drops into **any agent that loads skills from a directory** — gjc, pi, and similar. The fetch script is fully self-contained.

The leaderboard page is server-side rendered (Next.js) and embeds the full per-model data payload in the HTML, so the script extracts that directly — **no API key, no JS rendering, no scraping of dynamic content, zero dependencies** (Node.js stdlib only).

## What it returns

| Field | Meaning |
|---|---|
| `model` | Model name (e.g. `GPT-5.5 (xhigh)`) |
| `creator` | Vendor (Anthropic, OpenAI, Google, DeepSeek, …) |
| `intelligence` | **Intelligence Index v4.1** — main quality score (higher = better). Trailing `*` = estimated. |
| `coding` | **Coding Index** (higher = better at code) |
| `agentic` | **Agentic Index** (higher = better at tool use / agents) |
| `blendedUSD` | Blended price per 1M tokens (lower = cheaper) |
| `speedTokPerSec` | Median output throughput, tokens/sec (higher = faster) |
| `latencyFirstChunk` | Time to first chunk, seconds (lower = snappier) |
| `totalResponse` | End-to-end response time, seconds |

`--` means that model has no data for that metric (e.g. a newly released model, or one not yet benchmarked on the coding/agentic suites).

## Usage

```bash
# Top 15 models by Intelligence Index (default sort)
node aa-leaderboard.js --top 15

# Top 10 by CODING
node aa-leaderboard.js --sort coding --top 10

# Top 10 by AGENTIC (tool use / agents)
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
node aa-leaderboard.js --json --sort coding --creator google
```

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

**Sort direction:** `intelligence`/`coding`/`agentic`/`speed` sort **descending** (best first); `price`/`latency` sort **ascending** (cheapest/snappiest first); `name` sorts A→Z. Rows with `--` in the sort field sink to the bottom.

## Deep single-model profile (`--deep`)

`--deep` trades the many-rows table for a **full profile of one model**, surfacing
the ~90 fields the site embeds per model (the table shows only ~8). Requires
`--model X` (name or slug, substring OK; an exact match wins ties). Sections:

- **Identity** — full name, slug, creator + country, release date, context window, size/price tier, reasoning / open-weights flags, modalities, OpenRouter id
- **Composite Indices** — Intelligence / Coding / Agentic (0–100)
- **Benchmarks** — GPQA, MMMU-Pro, HLE, Terminal-Bench (v2.1 + hard), SciCode, τ²-Bench, Long-Context Reasoning, GDPval (normalized + Elo w/ 95% CI), Critical Point, Analyst Agent, IT-Bench (SRE), IF-Bench, Omniscience (accuracy / non-hallucination / score)
- **Pricing** — input / output / cache-read (w/ discount %) / cache-write, plus blended variants (7:2:1 is the leaderboard's headline price)
- **Speed & latency distribution** — throughput and time-to-first-token across **p5 / p25 / p50 / p75 / p95** (a single median hides the long-tail reasoning runs), plus end-to-end and answer speed
- **Intelligence Index internals** — cost / time / tokens per eval task

`--deep --json` emits the whole decoded object (nested objects intact, `$undefined` normalised to null) for programmatic use.

## Install as an agent skill

Agents discover this skill by finding `SKILL.md` inside `<skills-dir>/artificial-analysis-leaderboard/`. Clone into whichever skills directory your agent scans:

```bash
# Example locations (use the one for your agent):
#   gjc : ~/.gjc/agent/skills/
#   pi  : ~/.pi/agent/skills/
git clone https://github.com/pinion05/artificial-analysis-leaderboard.git \
  <your-skills-dir>/artificial-analysis-leaderboard
```

Restart your agent session, then trigger it with `/skill:artificial-analysis-leaderboard`, or ask in natural language:

- "요즘 가장 똑똑한 모델 뭐야?" / "best LLM right now"
- "코딩 잘하는 모델", "에이전트 점수", "model leaderboard"
- "가장 빠른 모델", "가장 싼 모델"

### Standalone (no agent)

The script is fully self-contained — it works anywhere with Node.js 14+:

```bash
curl -O https://raw.githubusercontent.com/pinion05/artificial-analysis-leaderboard/main/aa-leaderboard.js
node aa-leaderboard.js --sort coding --top 10
```

## How it works

The leaderboard page is Next.js SSR; the full per-model data payload is embedded in the HTML as escaped JSON. `parse()` splits on each model's `id`, `field()` reads each field by its escaped key, and records are de-duplicated by slug (preferring the copy with the most non-null metrics). `--deep` goes further: `deepExtract()` locates the target record, `braceMatch()` walks from its opening brace to its matching close (treating `\"` as an in-string toggle so braces inside string values are skipped), and the slice is double-parsed — once to unescape the embedded JSON string, once to materialise the object — yielding the full ~90-field model payload. The blended price uses Artificial Analysis' `price1mBlended7To2To1` blend, which matches the site's default table column.

## Files

- `aa-leaderboard.js` — fetch + parse script (Node.js stdlib, no deps)
- `SKILL.md` — portable agent skill definition
- `README.md` — this file

## Requirements

- Node.js 14+ (uses only `https` from the standard library)
- Internet access to `artificialanalysis.ai`

## Reliability

- Plain HTTPS GET with a browser User-Agent. If the site changes its embedded payload shape, the parser's `parse()` / `field()` will need updating.
- Data is live at fetch time; Artificial Analysis updates continuously.
- No API key required — public leaderboard. (Artificial Analysis also offers a paid Data API for individual benchmark breakdowns and time series; this skill does not use it.)

## License

MIT
