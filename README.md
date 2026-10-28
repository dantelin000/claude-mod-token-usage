**English** | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

# token-usage

A usage strip above the prompt box in Claude Desktop (Code tab): 5h / 7d rate-limit quota, token usage and cost. It also draws a compact text line in the terminal CLI.

> This is a fork of [letswritetw/claude-mod-token-usage](https://github.com/letswritetw/claude-mod-token-usage).
> **v1.3.0** logs usage printed by Bash / MCP tool calls automatically, and ships a built-in price table (**built-in prices last updated 2026-10-28**). See [Automatic capture](#automatic-capture-v130) and [Built-in prices](#built-in-prices).
> **v1.2.0** adds an external API usage ledger and the `/usage-ext` command (nothing changes in the strip). See [External API usage](#external-api-usage-usage-ext).
> **v1.1.1** fixes the cost cell showing a fork's inherited cost as its own: it now shows what this conversation itself has spent.
> **v1.1.0** fixes the token counts being badly undercounted (now counted once per API response), the band not showing in the terminal, and the band hiding other plugins' content. See the [CHANGELOG](CHANGELOG.md).

## Install
- macOS: `bash install.sh`
- Windows: run `powershell -ExecutionPolicy Bypass -File install.ps1` in PowerShell

When it finishes, fully quit and reopen Claude Desktop. The script backs up and merges `~/.claude/settings.json` (it only adds two variables under `env`).

## Requirements
- A recent Claude Code / Claude Desktop that supports mods
- The 5h / 7d quota needs a subscription account; data appears after the first response

## External API usage (`/usage-ext`)

Claude Code's own cost (the cost cell, `/cost`) only covers the requests it sends itself. When a subagent or a script calls another API directly (Vertex AI, OpenAI, Ollama, ...), those tokens are invisible to it. The mod can keep a local ledger of such calls and estimate their cost. It is not drawn in the strip: you ask for it with a command.

**1. Record each call.** Two ways, and they do not double count (see below).

*Automatically (v1.3.0).* When a Bash or MCP tool call in the session prints a provider's usage object, the mod logs it for you. Nothing to set up. See [Automatic capture](#automatic-capture-v130).

*By hand.* Hand the API response (or only its usage object) to the helper. It keeps only the numbers, never the prompt or the reply, and tags the line with `$CLAUDE_CODE_SESSION_ID`:

```bash
~/.claude/mods/token-usage/bin/tu-log --provider vertex < response.json
~/.claude/mods/token-usage/bin/tu-log --provider openai --model gpt-x '{"usage":{"prompt_tokens":500,"completion_tokens":200}}'
```

Or append a line yourself, from any language, to `~/.claude/token-usage/ledger/YYYY-MM-DD.jsonl` (local date). `ts` is in milliseconds and `usage` is the provider's own usage object:

```json
{"ts":1793148848057,"session":"<CLAUDE_CODE_SESSION_ID>","provider":"vertex","model":"gemini-x","usage":{"promptTokenCount":12000,"candidatesTokenCount":340}}
```

Understood: Gemini / Vertex `usageMetadata` (and Gemini CLI stats), OpenAI chat and Responses, Anthropic (including 5-minute and 1-hour cache writes), Ollama. (The helper needs Python 3; on Windows run it as `python tu-log`, not tested there.)

**2. Prices.** The mod ships a price table (see [Built-in prices](#built-in-prices)), so `/usage-ext` estimates cost out of the box. To add a model it lacks, or to override a price, copy `prices.example.json` to `~/.claude/token-usage/prices.json` and fill in your rates in USD per million tokens, from your provider's pricing page. Your entry for a model replaces the shipped one whole; the shipped table fills in the rest. A model with no input and output rate anywhere is counted in tokens but left unpriced (never shown as $0). A missing `cached` rate uses the input rate, `cacheWrite` too, `cacheWrite1h` the `cacheWrite` rate, `thinking` the output rate; `longPrompt` sets higher rates above a prompt size; `effective` changes the rates from a date on.

**3. Read it.** `/usage-ext` for this conversation, or `/usage-ext today`, `7d`, `all`. Add `json` for machine-readable output. `TOKEN_USAGE_EXT_DIR` moves the folder. The answer carries the date of the built-in prices ("built-in prices updated YYYY-MM-DD").

**Limits.** A mod cannot see another program's network traffic, so a call is counted only when it is logged or its usage is printed in a tool result (below). A script a person runs on their own in a terminal, outside Claude Code, is out of scope. The estimate is tokens x prices; the provider's bill is authoritative.

### Automatic capture (v1.3.0)

When a **Bash or MCP tool call** returns output that contains a provider's usage object, the mod appends it to the ledger. It reads complete JSON objects in the output text: Gemini / Vertex `usageMetadata`, Gemini CLI `stats.models`, OpenAI chat and Responses, Anthropic, Ollama.

- **Numbers only.** Never the prompt, the reply, the command or the output text. Each line holds the usage numbers, the session id, the tool's name (`auto: Bash`, `auto: mcp__server__tool`), and the `model` and `provider` if the output carries them. The provider is filled in for Ollama's reply shape and for `claude-*` and `gpt-*` / o-series model ids; Gemini calls get none (the Gemini API and Vertex AI print the same shape).
- **Only usage that is really printed.** A script that prints only the reply text still needs a `tu-log` line. Also not seen: output the tool cut off in the middle of the JSON, Python `repr` dicts (single quotes), commands run in the background (the Bash result comes back before they finish), and usage the script never prints.
- **No double counting.** If the command logged the call itself with `tu-log` while it ran (same session, same numbers, a model that agrees), the automatic line is skipped. The same numbers printed twice in one output count once. A *later, separate* `tu-log` call for a response whose usage was already printed is a second line: log a response once.
- **Not logged:** a command that only shows files or text (`cat`, `grep`, `jq`, `git diff`, ... without a command substitution), because what it prints is somebody's document or an earlier response; ledger lines; the generic `{"input": .., "output": ..}` pair (not a provider format); objects with zero tokens. Repeated or cumulative usage in a streamed event log is not deduplicated.
- **Where.** `~/.claude/token-usage/ledger/YYYY-MM-DD.auto-<session>.jsonl`, one file per session. It is a separate file because the mod can only rewrite a file whole, and must not rewrite one that `tu-log` is appending to. Delete a file to remove its records.
- **Off switch.** Set `TOKEN_USAGE_AUTO=off` (for example under `env` in `settings.json`). `/usage-ext` says how many lines were logged automatically.

### Built-in prices

**Built-in prices last updated: 2026-10-28** (the date the pages below were read; `updated` in `prices.default.json`, and printed by `/usage-ext`).

Sources, read on that date:
- Anthropic: <https://platform.claude.com/docs/en/about-claude/pricing> (cross-checked against the per-model rates in Claude Code's own model catalog)
- OpenAI: <https://developers.openai.com/api/docs/pricing>
- Google, Gemini API: <https://ai.google.dev/gemini-api/docs/pricing>
- Google, Vertex AI: <https://cloud.google.com/vertex-ai/generative-ai/pricing> (read for comparison, see below)

**Prices change, and the provider's bill is authoritative.** The table is list prices on one day, not a promise. It will be refreshed as patch releases (1.3.1, ...), each with a new date. Where a page announced a change, the table carries it: `gemini-4-argon` rises on 2026-12-01, `gemini-3.8-flash` and `gemini-3.6-flash` on 2027-01-01 (provider pages give no time zone; **UTC is assumed**), and a record is priced by the day it was logged. `gpt-5.6-sol` is a promotional price OpenAI lists as available at least through 2026-11-21, with no regular price published; its entry says so.

**What is in it:** 75 models at Standard-tier list prices in USD per million tokens: Anthropic (Claude Fable, Mythos, Opus, Sonnet and Haiku, including 5-minute and 1-hour cache writes and Haiku 5.5's higher price above 100k tokens), OpenAI (GPT-6 / 5.x / 4.x / o-series, Codex, Cyber and Rosalind models, the 272K long-context tier), and the Gemini API (Gemini 4 and 3.x, 2.5; the 200k tier of the Pro models). Model ids are matched as logged, after the last `/`, and without a trailing date (`-20250929`, `-2025-08-07`, `@20250929`) or `-latest`; there is no prefix matching, so `gpt-5.1-codex` is not priced as `gpt-5.1`. Thinking tokens are priced as output tokens, which all three providers' pages say they bill them as.

**Vertex AI.** The Vertex page was read on the same date. Its Global-endpoint Standard prices for input, output and cached input equal the Gemini API rows above for every Gemini model in the table except `gemini-3-flash-preview` (the Vertex page lists no output price for it) and `gemini-3.1-pro-preview-customtools` (not listed there). Vertex's regional (non-global) endpoints cost 10% more and are not modelled. The Vertex promotional prices (such as Gemini 4 Argon through 2026-11-30) are given there as credits back on net spend.

**Not included.** A missing cost is never read as zero: a model that is not in the table, or in your `prices.json`, is counted in tokens and shown as unpriced.
- Anthropic: Batch (50%), fast mode, `inference_geo: "us"` (1.1x), server-tool fees, Managed Agents runtime; Claude 3.5 / 3.7 Sonnet (in Claude Code's catalog, not on the pricing page). Retired Opus 4 / 4.1, Sonnet 4 and Haiku 3.5 are listed at the Claude API list price (partner clouds that still serve them bill themselves). Claude Mythos is limited-availability but listed.
- OpenAI: Batch, Flex, Fast and Ultrafast tiers (a usage object does not say which was used), the +10% regional-processing uplift, cache-write prices (the usage object has no field for them), realtime, audio, image, speech, transcription, embedding, moderation and fine-tuning models, tools.
- Gemini: Batch, Flex, Priority and Contributor tiers, context-cache storage per hour, grounding fees, the free tier (the table is the paid tier; free-tier calls cost nothing), live / translate / transcribe / TTS / image / embedding / Omni / robotics models, and models only the Vertex page lists (3.7 Flash, 3.5 Flash, 2.0, the Cyber variants). Some models charge more for audio input; the usage object does not split modalities, so the text price is used and audio-heavy calls are underestimated (those entries say so).
- Other providers: OpenRouter (hundreds of models) and local Ollama models (free) are not covered; add them in `prices.json`.

## Uninstall
Delete `~/.claude/mods/token-usage` and remove `CLAUDE_CODE_PLUGIN_DIRS` and `CLAUDE_CODE_PLUGIN_DIR_WATCH` from `env` in `settings.json`.
