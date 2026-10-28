# Open tasks, part 2: findings from a first attempt at Task B

Written 2026-10-28, a companion to `docs/TASKS.md`. Read that file first; its scope rule and release
conventions apply here too. A local session started Task B (the built-in price table) and was stopped
halfway. **Nothing from it was committed and no code was written**, but the research below was done and
changes what Task B must build. This file adds: how to run both tasks, what was found, schema decisions
TASKS.md does not cover, and the traps that cost time.

## How to run both files

- **One session, in order, one release (v1.3.0) that holds both tasks.** Task A (auto-capture) and Task B
  (prices) both edit `hooks/external.ts` and `hooks/register.tsx`; two sessions in parallel would conflict.
- Order: (1) Task B schema work below, with tests; (2) Task B data; (3) Task A; (4) docs in three
  languages, then validate, test, tag, release. Commit after each step; tag once, at the end.
- State when this was written: `master` at `a0a8067`, v1.2.0 released (`2dc22b9`). The maintainer's local
  mod copy equals v1.2.0.
- The fork also has a branch `claude/focused-dirac-r2yzo2`: one commit from 2026-10-25, "test: subagent
  and fork subagent usage counts once per response" (+68 lines in `hooks/band.test.tsx`), behind
  `master` by two commits. It is not part of these tasks. Look at it once: if the tests are sound and pass
  on top of `master`, cherry-pick it into the release and say so in the CHANGELOG; if not, leave it alone
  and mention it in your final report. Do not force-push or delete it.

## Rules that decide what ships (from the maintainer)

- Every price must be read from an official page **during the run**. Not from memory, and not from a
  third-party price tracker (several rank high in web search; they are not sources). A model whose price
  you could not read is **left out**, and the release notes say which.
- The shipped table carries its date: `updated` in the JSON, plus README, CHANGELOG and release notes in
  all three languages, plus one line in the `/usage-ext` output ("built-in prices updated YYYY-MM-DD").
  Use the date you read the pages, not a date from this file.

## What was found (2026-10-28)

### Read the raw page, not a summary

`WebFetch` runs the page through a small model, and it misled here: it returned model rows and
long-context columns that could not be checked, and for the Vertex page it returned nothing. Use raw text.

- **OpenAI:** `https://developers.openai.com/api/docs/pricing.md` is the real Markdown (about 22 KB, one
  table per tier). The HTML page shows only the Short-context view and a handful of models. The first
  table, "Standard pricing data", has these columns in order: Model | short input | short output | short
  cached input | short 30m write | short 12h write | the same five for long context. Anchor to check your
  parser: `gpt-6-astra | $10.00 | $50.00 | $1.00 | $12.50 | $25.00 | $20.00 | $75.00 | $2.00 | $25.00 | $50.00`.
  A second table below it lists older models with only Input | Output | Cached input.
- **Anthropic:** `https://platform.claude.com/docs/en/about-claude/pricing` came back as full Markdown with
  `WebFetch` (about 52 KB). Columns: Model | base input | 5m cache writes | 1h cache writes | cache hits |
  output. Anchor: `Claude Opus 5.5 | $4 | $5 | $8 | $0.20 | $20`. Read the footnotes under the table (below).
- **Google AI (Gemini API):** `https://ai.google.dev/gemini-api/docs/pricing` as HTML through `curl`. Strip
  `<script>` and tags; each model is a block that starts with the model id and "Try it in Google AI
  Studio", then "Standard | Free Tier | Paid Tier, per 1M tokens in USD" with input, output, context caching
  rows. The page says "Last updated 2026-10-27 UTC."
- **Vertex AI: not verified.** `https://cloud.google.com/vertex-ai/generative-ai/pricing` returned only a
  title; it redirects to `https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing`,
  which is JavaScript-rendered. Try a real browser or another raw route. If you cannot read it, ship the
  Gemini rows as "from the Gemini API page" and say in the README that the Vertex page could not be read
  (Vertex list prices for the same model are not confirmed to match). Do not claim Vertex prices.
- **Cross-check for Anthropic:** Claude Code's own catalog lists the per-model rates behind `/cost`:
  `strings "$(readlink -f "$(command -v claude)")" | grep pricing_tiers` shows `tier_4_20_cache_read_0_20`
  for opus-5-5, `tier_2_10_cache_read_0_10` for sonnet-5-5, `tier_10_50` / `tier_10_50_cache_read_0_25` for
  fable-5 / fable-5-1, and `haiku_55` with a `long_prompt` tier above 100000. On 2026-10-28 these agreed
  with the page. The catalog also gives the API model ids (`claude-opus-5-5`, `claude-fable-5-1`, ...).

### Prices change on a date: the schema needs "effective from"

A static table goes wrong silently. Seen on 2026-10-28:

- `gemini-4-argon`: input $2.00, output $10.00, cached $0.10 through 2026-11-30; $4.00 / $20.00 / $0.20
  starting 2026-12-01.
- `gemini-3.8-flash` and `gemini-3.6-flash`: $0.75 / $3.75 / cached $0.075 through 2026-12-31; $1.50 /
  $7.50 / $0.15 starting 2027-01-01.
- OpenAI: "GPT-5.6 Sol's promotional pricing is available at least through November 21, 2026". The
  `gpt-5.6-sol` Standard row is promotional and the page does not give the regular price. Ship the current
  row and mark it in a `note`.
- Anthropic Sonnet 5: footnote says the $2/$10 introductory price is now the standard price.

**Add to the price shape** (and to `cost()` in `hooks/external.ts`):

```json
"gemini-4-argon": {
  "input": 2, "output": 10, "cached": 0.10,
  "effective": [ { "from": "2026-12-01", "input": 4, "output": 20, "cached": 0.20 } ]
}
```

For a record, take the UTC date of its `ts`, pick the `effective` entry with the greatest `from` that is
not after that date, and let its fields override the base (a `longPrompt` inside it replaces the base's).
So old records keep the price that applied then. The provider pages give no time zone; say "UTC assumed" in
the README. A free-text `note` field is allowed and ignored by `cost()`. Tests: a record on 2026-11-30 and
one on 2026-12-01 get different prices; an entry with no `effective` behaves as before.

### Model ids in the ledger often carry a suffix

Usage objects and `modelVersion` give ids like `claude-sonnet-4-5-20250929`, `gpt-5-2025-08-07`,
`models/gemini-2.5-flash` or `publishers/google/models/gemini-2.5-flash`. Today the lookup is exact, so
these would be "unpriced". Look up, in order: the id as given, the part after the last `/`, then each with a
trailing `-YYYYMMDD`, `-YYYY-MM-DD`, `@YYYYMMDD` or `-latest` removed. **No prefix matching**: `gpt-5.1-codex`
must not fall onto `gpt-5.1`. Key the shipped table by bare model id (`claude-...`, `gpt-...`, `gemini-...`)
and use `provider/model` only where one provider's price differs; the lookup already tries
`provider/model` first and the bare id second. Test with the suffixed forms above.

### Rules on each page to encode (not prices)

- **Anthropic:** cache hits cost 0.05x base input on Opus 5.5 and Sonnet 5.5, 0.025x on Fable 5.1 and
  Mythos 5.1, 0.1x elsewhere (the table already shows the dollar amounts). Haiku 5.5 is priced higher for
  the whole call when the prompt is over 100,000 tokens: `longPrompt`. 1M context is at standard price for
  Claude 4.6 and later except Haiku 5.5. Not modelled: `inference_geo: "us"` is 1.1x on every category,
  and fast mode has its own prices. Mythos is limited availability (still list it). Thinking tokens are
  counted inside `output_tokens` (the usage object shows `output_tokens_details.thinking_tokens`), and
  `cost()` prices them as output; confirm that on the page.
- **OpenAI:** use the Standard tier only (Batch, Flex, Fast, Ultrafast exist and the usage object does not
  say which was used). "Long context" means more than 272K input tokens: `longPrompt.above` = 272000, the
  whole call. The `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.4`, `gpt-5.4-pro` rows are labelled "(<272K context
  length)" but carry long-context columns too. A `-` in the cached column means no cache price: leave
  `cached` unset (it falls back to the input rate). Cache writes (30m, 12h) are priced but the usage object
  has no field for them: not modelled. Regional (data-residency) processing is +10% for models released on
  or after 2026-03-05: not modelled. Skip realtime, audio, image, TTS, transcription, embedding,
  moderation, fine-tuning, and per-minute or per-character rows.
- **Gemini:** "Output price (including thinking tokens)": thoughts are billed as output, which is the
  default in `cost()`. `gemini-3.1-pro-preview` and `gemini-2.5-pro` have a 200k tier (`longPrompt.above` =
  200000, input, output and cached all change). Several models have a higher audio input price; the usage
  object does not split modalities, so use the text price and say in the README that audio-heavy calls are
  underestimated. Not modelled: context-cache storage per hour, grounding fees. Skip live, translate,
  transcribe, TTS, image, embedding, omni and robotics models. Text models seen on the page: gemini-4-argon,
  gemini-3.8-flash, gemini-3.6-flash, gemini-3.5-flash-lite, gemini-3.1-flash-lite, gemini-3.1-pro-preview,
  gemini-3-flash-preview, gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite. Rows for
  `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` were only seen in a summary and **not** checked
  against the raw page: check them like the rest.
- Say in the README which of these are left out ("Not included"), so nobody reads a missing cost as zero.

### Traps that cost time

- **Test kit:** an op the plugin calls (`$.session.id()`, `$.session.usage()`, `$.fs.read`, `$.env.get`)
  is answered in a test with `on('session.id', async () => ({ value: 'x' }))`: the return is a result
  object `{ value }`, not the bare value, or the hook is skipped. `$.session.start(...)` and
  `$.session.measure(...)` also need a bottom handler (`on('session.start', async (_$, e) => ({ cwd: e.cwd }))`).
  See `hooks/band.test.tsx` and `hooks/external.test.tsx`.
- **`claude plugin validate`** generates `.claude-plugin/types/` (already git-ignored) and its output is
  the reference for hook and `$` signatures. An old `claude` rejects `session.measure`: check
  `claude --version` and say so if you cannot get a recent one, instead of skipping validation.
- **Real-engine check:** `claude -p --no-session-persistence --model claude-haiku-5-5 "/usage-ext all"`
  (with `TOKEN_USAGE_EXT_DIR` pointing at a temp folder holding a ledger made by `bin/tu-log`) runs the
  command locally with no model call (`total_cost_usd` 0). Do this after changes, as the v1.2.0 release did.
  For Task A, a real run needs a Bash tool call that prints a usage object; keep it cheap.
- **Env var for scripts:** Bash tool subprocesses get `CLAUDE_CODE_SESSION_ID`; the mod itself uses
  `$.session.id()`. They should be the same id (not checked); `bin/tu-log` tags records with the env var, so
  for Task A's deduplication use the id the mod sees and check that the two agree in a real run.
- Pushing from a cloud environment uses that environment's own GitHub credentials; the local-machine
  workaround (`gh auth git-credential` as a one-off helper) is not needed there. Commit identity for this
  repo is the maintainer's noreply address (`225208181+dantelin000@users.noreply.github.com`); end commit
  messages with the attribution trailer your environment asks for.

## Definition of done

- `prices.default.json` merged with the user's `prices.json`, with `effective` dates, model-id
  normalization and `cacheWrite1h` in place, each covered by a test; every shipped price traceable to a
  page read during the run, with `sources` and `updated` in the file.
- Task A as specified in TASKS.md, no double counting, with a test.
- `claude plugin validate token-usage` and `claude plugin test token-usage` pass; `/usage-ext` checked once
  in the real engine.
- README, CHANGELOG and release notes in English, Traditional Chinese and Simplified Chinese, naming the
  date of the built-in prices and what is not included; tag `v1.3.0`; release created.
- Final report to the maintainer: what shipped, which models were left out and why (including whether the
  Vertex page could be read), what was done about the `claude/focused-dirac-r2yzo2` branch.
