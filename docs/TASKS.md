# Open tasks

Written 2026-10-28 for whoever (human or a cloud Claude session) picks these up. Both tasks extend the
external API usage ledger shipped in v1.2.0 (`/usage-ext`, `bin/tu-log`, `hooks/external.ts`). Read
`CHANGELOG.md` (1.2.0) and the "External API usage" section of `README.md` first.

## Scope rule (decided by the maintainer)

This mod exists to help people **inside Claude Code**. It counts what Claude Code itself does, plus
external API calls that Claude Code **dispatches** (a subagent, or the Bash / MCP tools running a
script that calls Vertex AI, OpenAI, ...). A script a person runs on their own in a terminal, outside
Claude Code, is out of scope. So: no local proxy, no machine-wide traffic capture. `bin/tu-log` stays
as the manual way to log a call.

## Task A: capture external API usage automatically from tool results

Goal: when a Bash or MCP tool call made in the session returns output that carries a provider's usage
object, append it to the ledger without anyone calling `tu-log`.

- Hook the tool results of the session (the `tool.call` event in the mod SDK; read
  `.claude-plugin/types/claude-code/index.d.ts` after `claude plugin validate` generates it, and the
  `plugin-authoring` skill if available). Only Bash and MCP tool outputs are candidates.
- Find usage objects in the output text with `normalize()` from `hooks/external.ts` (it already reads
  Gemini / Vertex `usageMetadata`, Gemini CLI stats, OpenAI chat and Responses, Anthropic, Ollama). Do
  not record anything `normalize()` cannot read, and never store the output text, only the numbers.
- Tag each record with the current session id (`$.session.id()`), `provider` if it can be told,
  `model` if the output carries one.
- **No double counting:** a script may call `tu-log` itself and also print the usage. Deduplicate, for
  example on session + model + the token numbers inside a short time window, and cover it with a test.
- Only usage that is really printed can be captured. Say so in the README (a script that prints only the
  reply text still needs a `tu-log` line).
- Tests with `claude plugin test .` (the kit answers ops with `on('fs.read', ...)` etc.; see the existing
  `hooks/external.test.tsx`). Also run `/usage-ext` once in the real engine, as the 1.2.0 release did.
- Docs and release: README section plus CHANGELOG entry in English, Traditional and Simplified Chinese,
  release notes in all three, version 1.3.0 (see Release below).

## Task B: ship a pre-filled price table, with its update date

Goal: `/usage-ext` should estimate cost out of the box. Today `prices.example.json` has only null
placeholders and the user must fill in `~/.claude/token-usage/prices.json`.

- Add `token-usage/prices.default.json` (shipped with the mod, read via `$.plugin.root`). Merge it with
  the user's `prices.json`: the user's entries win per model, the shipped ones fill the rest. Add a
  test for the merge.
- Fields: `updated` (ISO date the prices were checked), `sources` (the pages used), and `models` in the
  existing shape (`provider/model` keys; input, output, cached, cacheWrite, thinking, `longPrompt`).
- **Every price must come from an official page fetched when the table is written, never from memory.**
  If a price cannot be verified, leave the model out (or null). Sources to use:
  - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
  - OpenAI: https://developers.openai.com/api/docs/pricing
  - Google: https://ai.google.dev/gemini-api/docs/pricing and
    https://cloud.google.com/vertex-ai/generative-ai/pricing
  - Cross-check for Anthropic models: Claude Code's own model catalog inside its binary lists the
    per-model rates it uses for `/cost` (look for `pricing_tiers` in `strings` of the `claude` binary).
- Known shape needs:
  - Anthropic has separate 5-minute and 1-hour cache-write prices. The ledger has one `cacheWrite`;
    add a `cacheWrite1h` token class (from `usage.cache_creation.ephemeral_1h_input_tokens`) and rate,
    or the estimate is low for 1-hour writes.
  - Some models are priced higher for a prompt above a size (e.g. Haiku 5.5: above 100k tokens, the
    whole call). `longPrompt` already models that; check each provider's rule.
  - Gemini thinking tokens: check from the page whether they bill at the output rate.
- Write the update date where people will see it: `updated` in the JSON, the README (a "Built-in prices
  last updated: YYYY-MM-DD" line with the sources), the CHANGELOG entry and the release notes, in all
  three languages. The command output should also say the date of the built-in table.
- Say plainly in the README that prices change and the provider's bill is authoritative. A scheduled
  refresh is a good follow-up: prices update as patch releases (1.3.1, ...), each with a new date.
- Not covered on purpose: OpenRouter (hundreds of models; its public `/api/v1/models` lists prices, so a
  refresh script is a possible follow-up) and local Ollama models (free).

## Release

- Conventions: `token-usage/hooks/register.tsx` has CRLF line endings, keep them so diffs stay small;
  everything else is LF. `bin/tu-log` must stay executable (mode 100755).
- Docs exist in English, Traditional Chinese (`*.zh-TW.md`) and Simplified Chinese (`*.zh-CN.md`),
  English first, each with a language switcher.
- Verify before tagging: `claude plugin validate token-usage` and `claude plugin test token-usage`
  (needs a recent `claude` CLI; an old one rejects the `session.measure` hook).
- Commit, tag `v1.3.0`, push, then `gh release create v1.3.0 --verify-tag --latest` with notes in
  English then 繁體 then 简体, like the v1.1.1 and v1.2.0 releases. This repo is the maintainer's own
  fork of letswritetw/claude-mod-token-usage; do not open pull requests upstream.
