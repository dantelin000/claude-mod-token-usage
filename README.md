**English** | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

# token-usage

A usage strip above the prompt box in Claude Desktop (Code tab): 5h / 7d rate-limit quota, token usage and cost. It also draws a compact text line in the terminal CLI.

> This is a fork of [letswritetw/claude-mod-token-usage](https://github.com/letswritetw/claude-mod-token-usage).
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

**1. Record each call.** Hand the API response (or only its usage object) to the helper. It keeps only the numbers, never the prompt or the reply, and tags the line with `$CLAUDE_CODE_SESSION_ID`:

```bash
~/.claude/mods/token-usage/bin/tu-log --provider vertex < response.json
~/.claude/mods/token-usage/bin/tu-log --provider openai --model gpt-x '{"usage":{"prompt_tokens":500,"completion_tokens":200}}'
```

Or append a line yourself, from any language, to `~/.claude/token-usage/ledger/YYYY-MM-DD.jsonl` (local date). `ts` is in milliseconds and `usage` is the provider's own usage object:

```json
{"ts":1793148848057,"session":"<CLAUDE_CODE_SESSION_ID>","provider":"vertex","model":"gemini-x","usage":{"promptTokenCount":12000,"candidatesTokenCount":340}}
```

Understood: Gemini / Vertex `usageMetadata` (and Gemini CLI stats), OpenAI chat and Responses, Anthropic, Ollama. (The helper needs Python 3; on Windows run it as `python tu-log`, not tested there.)

**2. Prices (optional).** Copy `prices.example.json` to `~/.claude/token-usage/prices.json` and fill in your rates in USD per million tokens, from your provider's pricing page. No real prices are shipped. A model without an input and an output rate is counted in tokens but left unpriced. A missing `cached` / `cacheWrite` rate uses the input rate, a missing `thinking` rate the output rate; `longPrompt` sets a higher rate above a prompt size.

**3. Read it.** `/usage-ext` for this conversation, or `/usage-ext today`, `7d`, `all`. Add `json` for machine-readable output. `TOKEN_USAGE_EXT_DIR` moves the folder.

**Limits.** A mod cannot see another program's network traffic, so a call is counted only when something logs it. The estimate is tokens x your prices; the provider's bill is authoritative.

## Uninstall
Delete `~/.claude/mods/token-usage` and remove `CLAUDE_CODE_PLUGIN_DIRS` and `CLAUDE_CODE_PLUGIN_DIR_WATCH` from `env` in `settings.json`.
