**English** | [繁體中文](CHANGELOG.zh-TW.md)

# Changelog

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
