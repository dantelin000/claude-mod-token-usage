import { test, expect, mock } from 'claude-code/testing'
import { cost, normalize, parse, parseArgs, pickFiles, select, summarize } from './external'

// ---- one reading per provider shape ----

test('Gemini / Vertex usageMetadata: cached is inside the prompt count, thoughts apart', async () => {
  const t = normalize({ usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 400, candidatesTokenCount: 50, thoughtsTokenCount: 30, toolUsePromptTokenCount: 20 } })
  expect(t).toEqual({ input: 620, cached: 400, cacheWrite: 0, output: 50, thinking: 30 })
  // the Python SDK spells it in snake_case
  expect(normalize({ prompt_token_count: 10, candidates_token_count: 2 })).toEqual({ input: 10, cached: 0, cacheWrite: 0, output: 2, thinking: 0 })
})

test('Gemini CLI stats: input is already the prompt less the cached part', async () => {
  // a real job of the bridge: input 8044 + candidates 367 + thoughts 37 = total 8448
  const t = normalize({ input: 8044, prompt: 8044, candidates: 367, total: 8448, cached: 0, thoughts: 37, tool: 0 })
  expect(t).toEqual({ input: 8044, cached: 0, cacheWrite: 0, output: 367, thinking: 37 })
})

test('OpenAI chat and Responses: cached and reasoning are inside the totals', async () => {
  expect(normalize({ usage: { prompt_tokens: 500, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 60 } } }))
    .toEqual({ input: 400, cached: 100, cacheWrite: 0, output: 140, thinking: 60 })
  expect(normalize({ input_tokens: 500, output_tokens: 200, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 60 } }))
    .toEqual({ input: 400, cached: 100, cacheWrite: 0, output: 140, thinking: 60 })
})

test('Anthropic: input_tokens is only the uncached part; cache reads and writes are separate', async () => {
  expect(normalize({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 }))
    .toEqual({ input: 10, cached: 300, cacheWrite: 40, output: 20, thinking: 0 })
  expect(normalize({ input_tokens: 10, output_tokens: 20 })).toEqual({ input: 10, cached: 0, cacheWrite: 0, output: 20, thinking: 0 })
})

test('Ollama, already-normalized and unknown shapes', async () => {
  expect(normalize({ prompt_eval_count: 7, eval_count: 3 })).toEqual({ input: 7, cached: 0, cacheWrite: 0, output: 3, thinking: 0 })
  expect(normalize({ input: 5, output: 6, cached: 7 })).toEqual({ input: 5, cached: 7, cacheWrite: 0, output: 6, thinking: 0 })
  expect(normalize({ hello: 'world' })).toBeNull()
  expect(normalize('nope')).toBeNull()
  expect(normalize(null)).toBeNull()
})

// ---- price ----

const tok = { input: 1_000_000, cached: 1_000_000, cacheWrite: 0, output: 1_000_000, thinking: 1_000_000 }

test('cost: the table decides; a gap in it is never guessed', async () => {
  // thinking falls back to the output rate, cached to the input rate
  expect(cost(tok, { input: 2, output: 10 })).toBe(2 + 2 + 10 + 10)
  expect(cost(tok, { input: 2, output: 10, cached: 0.5, thinking: 8 })).toBe(2 + 0.5 + 10 + 8)
  // no entry, or no input/output rate (null placeholders from prices.example.json): unpriced
  expect(cost(tok, undefined)).toBeNull()
  expect(cost(tok, { input: null, output: null })).toBeNull()
  expect(cost(tok, { input: 2 })).toBeNull()
  // per: prices quoted per thousand tokens
  expect(cost({ ...tok, cached: 0, thinking: 0 }, { input: 2, output: 10 }, 1000)).toBe(12 * 1000)
})

test('cost: a long prompt is priced at the higher tier for the whole call', async () => {
  const p = { input: 1, output: 5, longPrompt: { above: 100_000, input: 4, output: 20 } }
  expect(cost({ input: 50_000, cached: 0, cacheWrite: 0, output: 1_000_000, thinking: 0 }, p)).toBe(0.05 + 5)
  expect(cost({ input: 150_000, cached: 0, cacheWrite: 0, output: 1_000_000, thinking: 0 }, p)).toBe(0.6 + 20)
})

// ---- the ledger ----

test('parse keeps good lines and counts the rest', async () => {
  const text = [
    '{"ts":1,"session":"s","model":"m","usage":{"input":1,"output":2}}',
    'not json',
    '{"ts":"yesterday","usage":{"input":1}}',
    '{"ts":2,"model":"m"}',
    '',
  ].join('\n')
  const { recs, bad } = parse(text)
  expect(recs.length).toBe(1)
  expect(bad).toBe(3)
})

test('arguments, files and records follow the scope', async () => {
  expect(parseArgs('')).toEqual({ scope: 'session', json: false })
  expect(parseArgs('7d JSON')).toEqual({ scope: { days: 7 }, json: true })
  expect(parseArgs('all')).toEqual({ scope: 'all', json: false })

  const now = new Date(2026, 9, 28, 12).getTime()
  const names = ['2026-10-20.jsonl', '2026-10-26.jsonl', '2026-10-28.jsonl', 'prices.json', 'notes.txt']
  expect(pickFiles(names, 'all', now, now)).toEqual(['2026-10-20.jsonl', '2026-10-26.jsonl', '2026-10-28.jsonl'])
  expect(pickFiles(names, { days: 3 }, now, now)).toEqual(['2026-10-26.jsonl', '2026-10-28.jsonl'])
  // a session that began this morning: yesterday's file and later
  expect(pickFiles(names, 'session', now, new Date(2026, 9, 28, 1).getTime())).toEqual(['2026-10-28.jsonl'])

  const recs = [
    { ts: now - 1000, session: 'a', usage: { input: 1, output: 1 } },
    { ts: now - 5 * 86_400_000, session: 'b', usage: { input: 1, output: 1 } },
  ]
  expect(select(recs, 'session', 'a', now).length).toBe(1)
  expect(select(recs, 'today', 'zzz', now).length).toBe(1)
  expect(select(recs, { days: 7 }, 'zzz', now).length).toBe(2)
})

test('summarize: per model, unpriced calls counted apart, unknown shapes skipped', async () => {
  const prices = { models: { 'vertex/g': { input: 1, output: 4 } } }
  const recs = [
    { ts: 1, provider: 'vertex', model: 'g', usage: { usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 250_000 } } },
    { ts: 2, provider: 'vertex', model: 'g', usage: { prompt_token_count: 1_000_000, candidates_token_count: 250_000 } },
    { ts: 3, provider: 'ollama', model: 'q', usage: { prompt_eval_count: 5, eval_count: 5 } },
    { ts: 4, model: 'x', usage: { weird: true } },
  ]
  const s = summarize(recs as any, prices)
  expect(s.rows.map(r => r.key)).toEqual(['vertex/g', 'ollama/q'])
  expect(s.rows[0]).toMatchObject({ calls: 2, input: 2_000_000, output: 500_000, cost: 4, unpriced: 0 })
  expect(s.rows[1]).toMatchObject({ calls: 1, cost: 0, unpriced: 1 })
  expect(s.total.calls).toBe(3)
  expect(s.unrecognized).toBe(1)
})

// ---- /usage-ext through the command path, the filesystem mocked ----

test('/usage-ext reads this session from the ledger and prices it', async ($, on) => {
  mock.clock(on)
  const now = new Date(2026, 9, 28, 12).getTime()
  const day = '2026-10-28.jsonl'
  const ledger = [
    { ts: now - 5000, session: 'me', provider: 'vertex', model: 'g', usage: { promptTokenCount: 2_000_000, candidatesTokenCount: 500_000 } },
    { ts: now - 4000, session: 'someone-else', provider: 'vertex', model: 'g', usage: { promptTokenCount: 9_000_000, candidatesTokenCount: 9_000_000 } },
  ].map(r => JSON.stringify(r)).join('\n')
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'TOKEN_USAGE_EXT_DIR' ? '/ext' : undefined }))
  on('session.id', async () => ({ value: 'me' }))
  on('session.usage', async () => ({ value: { startedAt: now - 60_000, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('fs.list', async () => ({ value: [{ name: day, kind: 'file', size: 1, mtimeMs: 0, isLink: false }, { name: 'x.txt', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', async (_$: any, e: any) => {
    if (e.path === `/ext/ledger/${day}`) return { value: ledger }
    if (e.path === '/ext/prices.json') return { value: JSON.stringify({ models: { 'vertex/g': { input: 1, output: 4 } } }) }
    return { deny: 'missing' }
  })
  const { text } = await $.command.run({ command: 'usage-ext', args: '' } as any)
  expect(text).toContain('vertex/g · 1 次')
  expect(text).toContain('输入 2.0M')
  expect(text).toContain('估价 $4.00') // 2M x 1 + 0.5M x 4
  expect(text).not.toContain('9.0M')
  const asJson = JSON.parse(((await $.command.run({ command: 'usage-ext', args: 'json' } as any)) as any).text)
  expect(asJson.total.calls).toBe(1)
  expect(asJson.pricesLoaded).toBe(true)
})
