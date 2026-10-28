**English** | [繁體中文](CHANGELOG.zh-TW.md) | [简体中文](CHANGELOG.zh-CN.md)

# Changelog

## 1.3.0 — 2026-10-28

Two things at once: usage printed by Bash / MCP tool calls is now logged without `tu-log`, and `/usage-ext` estimates cost out of the box with a built-in price table. **Built-in prices last updated: 2026-10-28.** The strip is unchanged.

### Added: automatic capture from tool results

- A `tool.call` hook reads the output of every **Bash and MCP tool call** in the session. A complete JSON object that carries a provider's usage (Gemini / Vertex `usageMetadata`, Gemini CLI `stats.models`, OpenAI chat and Responses, Anthropic, Ollama) is appended to the ledger. Only the numbers are kept, never the prompt, the reply, the command or the output; the line carries the session id (`$.session.id()`), the tool's name, and `provider` / `model` when the output carries them (provider from Ollama's reply shape or a `claude-*` / `gpt-*` / o-series model id; Gemini gets none).
- **No double counting.** If the command logged the same call with `tu-log` while it ran (same session, same numbers, a model that agrees, within the call's time window ± 5 s) the automatic line is skipped; the same numbers printed twice in one output count once; a replayed `tool_use_id` adds nothing.
- **Not logged:** commands that only view files or text (`cat`, `grep`, `jq`, `git diff`, ...; so reading a document or a transcript does not log its examples), ledger lines (so reading the ledger does not log it again), the generic `{input, output}` pair, Python reprs, truncated JSON, zero-token objects. `TOKEN_USAGE_AUTO=off` turns it off (checked: as a shell variable and under `env` in settings).
- **Stored in its own file**, `ledger/YYYY-MM-DD.auto-<session>.jsonl`: the mod can only write a file whole, and must not rewrite the day file `tu-log` appends to. The day files are only read, to find a line the command logged itself. `/usage-ext` reads both and says how many lines were logged automatically.
- Checked in the real engine with a script that prints a response, once alone (logged once) and once also calling `tu-log` (one line, from `tu-log`): the id the mod sees equals `$CLAUDE_CODE_SESSION_ID` in the Bash tool, also when the CLI mints a fresh session id.

### Added: built-in price table

- `prices.default.json`, shipped with the mod (read through `$.plugin.root`) and merged with your `prices.json`: your entry for a model replaces the shipped one whole, the shipped ones fill the rest. 75 models at Standard-tier list prices: **Anthropic 20, OpenAI 44, Gemini API 11**. Every price was read from the provider's own pricing page on 2026-10-28 (Anthropic's cross-checked against the model catalog inside the `claude` binary, where all 20 agree). The file carries `updated` and `sources`; `/usage-ext` prints "built-in prices updated 2026-10-28" (and `json` has `builtinPrices`).
- **Prices change.** The provider's bill is authoritative. The table is refreshed as patch releases (1.3.1, ...), each with a new date. `scripts/check-prices.py` checks the file's shape after a refresh.
- **Vertex AI:** the page could be read (with a browser User-Agent) and was compared: its Global-endpoint Standard input, output and cached prices equal the Gemini API rows for every Gemini model in the table except `gemini-3-flash-preview` (no output price listed there) and `gemini-3.1-pro-preview-customtools` (not listed). Regional Vertex endpoints (+10%) are not modelled.
- **Left out (never read as $0):** a model that is not in the table is counted in tokens and shown unpriced. Not included: Anthropic Batch, fast mode, `inference_geo` 1.1x, tool fees, Claude 3.5 / 3.7 Sonnet (not on the pricing page); OpenAI Batch / Flex / Fast / Ultrafast, regional +10%, cache-write prices, realtime / audio / image / speech / transcription / embedding / moderation / fine-tuning; Gemini Batch / Flex / Priority / Contributor, cache storage, grounding, the free tier, live / translate / transcribe / TTS / image / Omni / robotics models, and models only the Vertex page lists (3.7 Flash, 3.5 Flash, 2.0, Cyber variants). Audio input is billed higher on some Gemini models; the text price is used and those entries say so. OpenRouter and local Ollama models are not covered.
- `gpt-5.6-sol` is a promotional price (OpenAI: available at least through 2026-11-21, no regular price published); its entry says so and `/usage-ext` prints the note when it is used.

### Changed: price handling

- **`effective`**: a price entry may change rates from a date on (`"effective": [{"from": "2026-12-01", "input": 4, ...}]`); a record is priced by the UTC day of its `ts` (UTC assumed: the pages give no time zone), so old records keep the price of their day. Used for `gemini-4-argon` (2026-12-01) and `gemini-3.8-flash` / `gemini-3.6-flash` (2027-01-01). A free-text `note` is allowed.
- **`cacheWrite1h`**: Anthropic's 1-hour cache writes (`usage.cache_creation.ephemeral_1h_input_tokens`) are their own token class with their own rate (falls back to `cacheWrite`, then input), so the estimate is no longer low for them.
- **Model ids with a suffix** are found: as given, after the last `/`, and without a trailing `-YYYYMMDD`, `-YYYY-MM-DD`, `@YYYYMMDD` or `-latest` (`claude-sonnet-4-5-20250929`, `gpt-5-2025-08-07`, `publishers/google/models/gemini-2.5-pro`). No prefix matching: `gpt-5.1-codex` is not `gpt-5.1`.
- A `prices.json` kept per 1,000 tokens still works with the shipped table (the shipped rates are rescaled to your `per`).
- The ledger reader also accepts `YYYY-MM-DD.<name>.jsonl` files (cap 400 → 1000 files); older versions ignore them.

### Tests

- 21 → 44. Two of them are the subagent / fork-subagent "counts once per response" tests from the branch `claude/focused-dirac-r2yzo2` (commit b16d912), cherry-picked after checking the arithmetic and that they fail when the once-per-response logic is broken; the branch itself is left as it is.
- Each rule above is tested, and the ones that guard against double counting and false captures were checked by removing the guard and watching a test fail. `claude plugin test` cannot read files, so the shipped table's own shape is checked by `scripts/check-prices.py`; the end-to-end check is `/usage-ext` in the real engine.

**Limits**

- Only usage that is really printed can be captured: a script that prints only the reply text still needs a `tu-log` line. A later, separate `tu-log` call for a response whose usage was already printed is counted again. Repeated or cumulative usage in a streamed event log is not deduplicated.
- The command's output text is still Simplified Chinese. The helper is not tested on Windows.

### Other

- Version 1.2.0 → 1.3.0.

## 1.2.0 — 2026-10-28

### Added: external API usage ledger and `/usage-ext`

Claude Code's own cost ledger only knows the requests it sends itself. A subagent or a script that calls Vertex AI, OpenAI, Ollama, ... directly is invisible to it. 1.2.0 adds a provider-agnostic ledger you can read back. **The strip is unchanged**: nothing new is drawn there.

- **Ledger:** JSON lines in `~/.claude/token-usage/ledger/YYYY-MM-DD.jsonl` (folder overridable with `TOKEN_USAGE_EXT_DIR`). Each line holds the provider's own usage object, the model, the time and the session id.
- **`bin/tu-log`** (Python 3, standard library only): appends one call from a whole API response or just its usage object. It keeps only numbers, never the prompt or the reply, and tags the line with `$CLAUDE_CODE_SESSION_ID`. Gemini CLI results with several models become one line per model.
- **`/usage-ext [today|7d|all] [json]`:** reads the ledger and prints calls, tokens and an estimated cost per model, for this conversation by default. `json` gives machine-readable output. It runs locally and makes no model call.
- **Usage shapes understood:** Gemini / Vertex `usageMetadata` (camelCase and snake_case) and Gemini CLI stats; OpenAI chat and Responses (cached and reasoning tokens split out); Anthropic (cache reads and writes); Ollama.
- **Prices:** `prices.json` in the same folder, filled in by you (`prices.example.json` is a template; nothing in it is a real price). Per model: input, output, cached, cacheWrite, thinking, and a `longPrompt` tier for models priced higher above a prompt size. A model with no input or output rate is counted in tokens and marked unpriced; a missing cached / cacheWrite rate uses the input rate and a missing thinking rate the output rate.
- **Tests:** 11 new (21 in total). Also checked in the real engine: the command reads a ledger written by the helper and prints the right numbers, with no model call.

**Limits**

- A mod cannot listen on a port or see another program's network traffic, so a call is counted only when something logs it (the helper, or a line you append). Automatic capture, such as reading usage out of tool results or a local proxy, is not included.
- The estimate is tokens x the prices you enter; the provider's bill is authoritative. Whether thinking tokens are billed as output is the provider's rule: check it and set `thinking` if it differs.
- The command's output text is currently Simplified Chinese. The helper is not tested on Windows.

### Other

- Version 1.1.1 → 1.2.0.

## 1.1.1 — 2026-10-16

### Fixed: a fork showed its parent's cost as its own

The cost cell shows Claude Code's own cost ledger. A forked conversation starts with a **copy of its parent's ledger**, so the cell opened at the parent's total instead of at zero. Seen on a Haiku 5.5 fork of an Opus 5.5 chat: the cell read $4.44 while the fork itself had spent about $0.08. The other $4.36 was Opus spend carried over from the parent (it is the `cost-state` entry at the head of the fork's transcript). The token cells only count from the fork onwards, so the amount looked wildly out of line with them.

Forking itself costs nothing (no API call is made, the ledger is just copied), and Haiku 5.5 pricing was correct throughout.

**The fix**

- When a conversation starts, the mod reads the ledger once (`$.session.usage().cost`) and keeps it as a **baseline** (`Snap.base`). The cost cell now shows the ledger minus that baseline: what this conversation itself has spent, compaction and subagents included.
- The baseline is saved with the token counters per session id, so a restart or a resume keeps it.
- Hovering the cell says what was left out and what the ledger totals, e.g. "Excludes $4.36 that was already there before this conversation began (branched from another one); /cost's ledger total is $4.44."
- If no ledger can be read at start, the first one seen becomes the baseline only while nothing has been counted yet.
- Added 5 tests (a fork, a resume that keeps its saved baseline, a session saved before baselines existed, a new session, a ledger first seen at the first measurement). Also checked with a real headless fork of an older session: the saved baseline equalled the parent's ledger.

**Good to know**

- The cell no longer equals `/cost`, which still totals the whole ledger including what a fork inherited. The 1.1.0 note "the cost cell was always correct (same number as `/cost`)" no longer holds for forks.
- A session saved by an earlier version has no baseline and keeps showing the whole ledger. So does a session that was already open when you updated: restart it, because the baseline cannot be recovered afterwards. Start a new fork to see the fix.
- A resumed session the mod never saw (for example one that ran before you installed it) starts counting at the resume, so its earlier spend is left out of the cell (`/cost` still has it).

### Other

- Version 1.1.0 → 1.1.1.
- Tests: 5 → 10.

## 1.1.0 — 2026-10-14

### Fixed: token cells were badly undercounted

The **cost cell was always correct** (it comes straight from Claude Code's own cost ledger, the same number as `/cost`). The token cells (↑ input, ↓ output, ▤ cache read) were wrong:

- The old version only added `e.usage` on `turn.complete`, but on the host versions tested that event carries only the usage of the *last API request of a turn*.
- A turn with tool calls sends several requests, and the last one is usually just a short closing message, so output was undercounted the most (about 6x) and cache reads about 3.7x.
- Multiplying the token cells by list prices then gave roughly a third of the cost cell, which looked like "the cost is overstated" when the token counts were what was wrong.

Measured on one long session, against the de-duplicated totals in the conversation transcript:

| | Old version showed | Actual total |
|---|---|---|
| ↓ Output | 54.0k | 344k |
| ▤ Cache read | 37.9M | 140.9M |

**The fix**

- A new `turn.step` hook counts **once per API response** (main loop and subagents alike). `turn.complete` is only a fallback for a turn in which no request reported usage, so nothing is counted twice.
- Added the missing sources: `session.compact` (the compaction request itself) and `model.complete` (the plugin's own model calls).
- Counters are saved per session id in `$.store` (the last 30 sessions are kept): they survive a hot reload, a restart or a resume, and start from zero on `/clear` or a new session. When earlier counts cannot be restored, the cost tooltip says "token counting since HH:MM".
- Cache writes are now tracked separately (`tokWrite`). The ↑ number is still "uncached input + cache writes"; hovering shows the two parts. The terminal line shows `⇧ 6.0k (寫 6.0k)`.
- Added 2 tests (three requests in one turn count once and not again from the turn total; with no step usage the turn total is used).

**Still not counted in tokens (cost only):** `model.classify` (its result has no usage) and internal engine helper calls that pass through none of the hooks above. Their share is small.

### Fixed: nothing was shown in the terminal

`ui.resolve` fills every surface's table with every element name (an element the surface lacks becomes an empty fragment), so `'Svg' in t` was true in the terminal too and the band drew an empty Svg. It now branches on `e.surface`: a text line in the terminal, the Svg strip elsewhere.

### Fixed: hid other plugins' content above the prompt

`AbovePrompt` is one band shared by every plugin. The old version returned without calling `next()`, which hid whatever a plugin beneath drew there (for example cc-arcade's board). It now takes the content beneath and draws the usage line under it.

### Other

- Version 0.1.0 → 1.1.0.
- Added `hooks/band.test.tsx` (5 tests in total).

### Checking the token totals yourself

Transcripts live in `~/.claude/projects/<project-dir>/<session-id>.jsonl`. One response is split over several lines that each carry the same usage, so de-duplicate by `message.id`:

```python
import json
seen = {}
for ln in open('<session-id>.jsonl'):
    try: d = json.loads(ln)
    except ValueError: continue
    m = d.get('message') or {}
    if isinstance(m, dict) and m.get('usage'):
        seen[m.get('id') or d.get('requestId')] = m['usage']
t = {k: sum((u.get(k) or 0) for u in seen.values()) for k in
     ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')}
print(len(seen), 'responses', t)
```

After the fix, the three token cells of a newly started session should match these totals closely. Sessions that were already open keep running the old code until restarted.

## 0.1.0

Initial release (by [letswritetw](https://github.com/letswritetw/claude-mod-token-usage)).
