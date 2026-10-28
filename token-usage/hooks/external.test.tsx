import { test, expect, mock } from 'claude-code/testing'
import { alreadyLogged, cost, findUsages, idForms, mergePrices, normalize, onlyViews, parse, parseArgs, pickFiles, priceAt, select, summarize } from './external'

// ---- one reading per provider shape ----

test('Gemini / Vertex usageMetadata: cached is inside the prompt count, thoughts apart', async () => {
  const t = normalize({ usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 400, candidatesTokenCount: 50, thoughtsTokenCount: 30, toolUsePromptTokenCount: 20 } })
  expect(t).toEqual({ input: 620, cached: 400, cacheWrite: 0, cacheWrite1h: 0, output: 50, thinking: 30 })
  // the Python SDK spells it in snake_case
  expect(normalize({ prompt_token_count: 10, candidates_token_count: 2 })).toEqual({ input: 10, cached: 0, cacheWrite: 0, cacheWrite1h: 0, output: 2, thinking: 0 })
})

test('Gemini CLI stats: input is already the prompt less the cached part', async () => {
  // a real job of the bridge: input 8044 + candidates 367 + thoughts 37 = total 8448
  const t = normalize({ input: 8044, prompt: 8044, candidates: 367, total: 8448, cached: 0, thoughts: 37, tool: 0 })
  expect(t).toEqual({ input: 8044, cached: 0, cacheWrite: 0, cacheWrite1h: 0, output: 367, thinking: 37 })
})

test('OpenAI chat and Responses: cached and reasoning are inside the totals', async () => {
  expect(normalize({ usage: { prompt_tokens: 500, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 60 } } }))
    .toEqual({ input: 400, cached: 100, cacheWrite: 0, cacheWrite1h: 0, output: 140, thinking: 60 })
  expect(normalize({ input_tokens: 500, output_tokens: 200, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 60 } }))
    .toEqual({ input: 400, cached: 100, cacheWrite: 0, cacheWrite1h: 0, output: 140, thinking: 60 })
})

test('Anthropic: input_tokens is only the uncached part; cache reads and writes are separate', async () => {
  expect(normalize({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 }))
    .toEqual({ input: 10, cached: 300, cacheWrite: 40, cacheWrite1h: 0, output: 20, thinking: 0 })
  expect(normalize({ input_tokens: 10, output_tokens: 20 })).toEqual({ input: 10, cached: 0, cacheWrite: 0, cacheWrite1h: 0, output: 20, thinking: 0 })
})

test('Anthropic: cache_creation splits the writes into 5-minute and 1-hour ones', async () => {
  const base = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300 }
  // the total is cache_creation_input_tokens; the nested object says how much of it was written for an hour
  expect(normalize({ ...base, cache_creation_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 70 } }))
    .toEqual({ input: 10, cached: 300, cacheWrite: 30, cacheWrite1h: 70, output: 20, thinking: 0 })
  // only the nested object: the writes are the two parts together
  expect(normalize({ ...base, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 70 } }))
    .toEqual({ input: 10, cached: 300, cacheWrite: 30, cacheWrite1h: 70, output: 20, thinking: 0 })
  // no 1-hour part: all the writes are 5-minute ones, as before
  expect(normalize({ ...base, cache_creation_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 } }))
    .toEqual({ input: 10, cached: 300, cacheWrite: 100, cacheWrite1h: 0, output: 20, thinking: 0 })
  // never more 1-hour writes than writes
  expect(normalize({ ...base, cache_creation_input_tokens: 50, cache_creation: { ephemeral_1h_input_tokens: 70 } })).toMatchObject({ cacheWrite: 0, cacheWrite1h: 50 })
  // the module's own terms carry it through
  expect(normalize({ input: 1, output: 2, cacheWrite: 3, cacheWrite1h: 4 })).toMatchObject({ cacheWrite: 3, cacheWrite1h: 4 })
})

test('Ollama, already-normalized and unknown shapes', async () => {
  expect(normalize({ prompt_eval_count: 7, eval_count: 3 })).toEqual({ input: 7, cached: 0, cacheWrite: 0, cacheWrite1h: 0, output: 3, thinking: 0 })
  expect(normalize({ input: 5, output: 6, cached: 7 })).toEqual({ input: 5, cached: 7, cacheWrite: 0, cacheWrite1h: 0, output: 6, thinking: 0 })
  expect(normalize({ hello: 'world' })).toBeNull()
  expect(normalize('nope')).toBeNull()
  expect(normalize(null)).toBeNull()
})

// ---- price ----

const tok = { input: 1_000_000, cached: 1_000_000, cacheWrite: 0, cacheWrite1h: 0, output: 1_000_000, thinking: 1_000_000 }

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
  expect(cost({ input: 50_000, cached: 0, cacheWrite: 0, cacheWrite1h: 0, output: 1_000_000, thinking: 0 }, p)).toBe(0.05 + 5)
  expect(cost({ input: 150_000, cached: 0, cacheWrite: 0, cacheWrite1h: 0, output: 1_000_000, thinking: 0 }, p)).toBe(0.6 + 20)
})

test('cost: 1-hour cache writes have their own rate, else the 5-minute rate, else the input rate', async () => {
  const w = { input: 0, cached: 0, cacheWrite: 1_000_000, cacheWrite1h: 1_000_000, output: 0, thinking: 0 }
  expect(cost(w, { input: 5, output: 25, cacheWrite: 6.25, cacheWrite1h: 10 })).toBe(6.25 + 10)
  expect(cost(w, { input: 5, output: 25, cacheWrite: 6.25 })).toBe(6.25 + 6.25)
  expect(cost(w, { input: 5, output: 25 })).toBe(5 + 5)
  // 1-hour writes count towards the size of a long prompt
  const p = { input: 1, output: 5, longPrompt: { above: 100_000, input: 4, output: 20 } }
  expect(cost({ input: 0, cached: 0, cacheWrite: 50_000, cacheWrite1h: 60_000, output: 0, thinking: 0 }, p)).toBe(0.11 * 4)
})

const day = (iso: string) => Date.parse(iso)
const near = (a: number | null, b: number) => expect(a !== null && Math.abs(a - b) < 1e-9).toBe(true)
const million = { input: 1_000_000, cached: 1_000_000, cacheWrite: 0, cacheWrite1h: 0, output: 1_000_000, thinking: 0 }

test('cost: an effective entry applies from its UTC day, so old records keep the price of their day', async () => {
  const p = { input: 2, output: 10, cached: 0.1, effective: [{ from: '2026-12-01', input: 4, output: 20, cached: 0.2 }] }
  const at = (iso: string) => cost(million, p, 1_000_000, day(iso))
  near(at('2026-11-30T23:59:59.999Z'), 2 + 0.1 + 10)
  near(at('2026-12-01T00:00:00.000Z'), 4 + 0.2 + 20)
  near(at('2027-03-01T12:00:00Z'), 4 + 0.2 + 20)
  // no timestamp, or an entry with no effective list: the base, as before
  near(cost(million, p), 2 + 0.1 + 10)
  near(cost(million, { input: 2, output: 10, cached: 0.1 }, 1_000_000, day('2027-01-01')), 12.1)
  expect(p.input).toBe(2) // the table itself is not touched
})

test('priceAt: the latest entry in force wins, fields it leaves out come from the base, a longPrompt replaces the base one', async () => {
  const p = {
    input: 1, output: 5, cached: 0.1, note: 'n',
    longPrompt: { above: 200_000, input: 2, output: 8 },
    effective: [
      { from: '2027-01-01', input: 3, longPrompt: { above: 100_000, input: 6, output: 12 } }, // out of order on purpose
      { from: '2026-06-01', input: 1.5 },
      { from: 'soon', input: 99 }, // not a date: ignored
    ],
  }
  expect(priceAt(p, day('2026-05-31'))).toBe(p)
  expect(priceAt(p, day('2026-06-01'))).toMatchObject({ input: 1.5, output: 5, cached: 0.1, longPrompt: { above: 200_000, input: 2, output: 8 }, note: 'n' })
  const late = priceAt(p, day('2027-02-01'))
  expect(late).toMatchObject({ input: 3, output: 5, cached: 0.1, longPrompt: { above: 100_000, input: 6, output: 12 } })
  expect(late.effective).toBeUndefined()
  // a timestamp no Date can hold is not a reason to throw
  expect(priceAt(p, 1e20)).toBe(p)
  expect(priceAt(p, NaN)).toBe(p)
})

test('model ids with a date, a path or -latest find the table key; no prefix matching', async () => {
  expect(idForms('claude-sonnet-4-5-20250929')).toEqual(['claude-sonnet-4-5-20250929', 'claude-sonnet-4-5'])
  expect(idForms('gpt-5-2025-08-07')).toEqual(['gpt-5-2025-08-07', 'gpt-5'])
  expect(idForms('publishers/google/models/gemini-2.5-flash')).toEqual(['publishers/google/models/gemini-2.5-flash', 'gemini-2.5-flash'])
  expect(idForms('models/gemini-2.5-flash-latest')).toEqual(['models/gemini-2.5-flash-latest', 'gemini-2.5-flash-latest', 'models/gemini-2.5-flash', 'gemini-2.5-flash'])
  expect(idForms('claude-sonnet-4-5@20250929')).toEqual(['claude-sonnet-4-5@20250929', 'claude-sonnet-4-5'])

  const prices = { models: { 'claude-sonnet-4-5': { input: 1, output: 1 }, 'gpt-5': { input: 1, output: 1 }, 'gpt-5.1': { input: 1, output: 1 }, 'gemini-2.5-flash': { input: 1, output: 1 }, 'vertex/gemini-2.5-flash': { input: 2, output: 2 } } }
  const u = { input: 1_000_000, output: 0 }
  const ids = ['claude-sonnet-4-5-20250929', 'claude-sonnet-4-5@20250929', 'gpt-5-2025-08-07', 'models/gemini-2.5-flash', 'publishers/google/models/gemini-2.5-flash', 'gemini-2.5-flash-latest']
  const priced = summarize(ids.map((model, i) => ({ ts: i, model, usage: u })), prices)
  expect(priced.total).toMatchObject({ calls: 6, unpriced: 0, cost: 6 })
  // a longer name is another model: never the table's shorter key
  for (const model of ['gpt-5.1-codex', 'gpt-5-mini', 'claude-sonnet-4-5-fast', 'gpt-5.1-2025-11-13x']) {
    expect(summarize([{ ts: 1, model, usage: u }], prices).total.unpriced).toBe(1)
  }
  // provider/model is tried before the bare id, at each form of the id
  expect(summarize([{ ts: 1, provider: 'vertex', model: 'publishers/google/models/gemini-2.5-flash', usage: u }], prices).total.cost).toBe(2)
  expect(summarize([{ ts: 1, provider: 'other', model: 'models/gemini-2.5-flash', usage: u }], prices).total.cost).toBe(1)
})

test('mergePrices: the user wins per model, the shipped table fills the rest, and per is rescaled', async () => {
  const shipped = { per: 1_000_000, updated: '2026-10-28', models: { a: { input: 1, output: 2 }, b: { input: 3, output: 4, cached: 0.3, effective: [{ from: '2026-12-01', input: 6, longPrompt: { above: 10, input: 9 } }], longPrompt: { above: 200_000, input: 5, output: 6 } } } }
  const user = { models: { b: { input: 10, output: 20 }, c: { input: 7, output: 8 } } }
  const m = mergePrices(shipped, user)!
  expect(Object.keys(m.models!).sort()).toEqual(['a', 'b', 'c'])
  expect(m.models!.a).toEqual({ input: 1, output: 2 })
  expect(m.models!.b).toEqual({ input: 10, output: 20 }) // the user's entry replaces the shipped one whole
  expect(m.per).toBe(1_000_000)
  // either side missing
  expect(mergePrices(shipped, null)).toBe(shipped)
  expect(mergePrices(null, user)).toBe(user)
  expect(mergePrices(null, null)).toBeNull()
  expect(mergePrices({ per: 1_000_000 } as any, user)).toBe(user)
  // a user table kept per 1000 tokens: the shipped per-million rates are converted, so a shipped price is not 1000x off
  const k = mergePrices(shipped, { per: 1000, models: {} })!
  expect(k.per).toBe(1000)
  expect(k.models!.a).toEqual({ input: 0.001, output: 0.002 })
  expect(k.models!.b).toMatchObject({ input: 0.003, output: 0.004, longPrompt: { above: 200_000, input: 0.005, output: 0.006 } })
  const e0 = (k.models!.b as any).effective[0]
  expect(e0).toMatchObject({ from: '2026-12-01', input: 0.006, longPrompt: { above: 10 } })
  near(e0.longPrompt.input, 0.009)
  near(cost({ input: 1000, cached: 0, cacheWrite: 0, cacheWrite1h: 0, output: 1000, thinking: 0 }, k.models!.a, k.per), 0.003)
  // a model of the user's own with null rates stays unpriced and does not borrow the shipped one
  expect(cost(million, mergePrices(shipped, { models: { a: { input: null, output: null } } })!.models!.a)).toBeNull()
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
  // the files this mod writes from tool output are read too; other names are not
  expect(pickFiles(['2026-10-28.jsonl', '2026-10-28.auto-abc_1.jsonl', '2026-10-28.a b.jsonl', '2026-10-28.auto-x.json', 'x.auto-y.jsonl'], 'all', now, now)).toEqual(['2026-10-28.auto-abc_1.jsonl', '2026-10-28.jsonl'])

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

test('summarize prices each record by its own day and carries the price note', async () => {
  const prices = { models: { m: { input: 1, output: 1, note: 'promotional price', effective: [{ from: '2026-12-01', input: 2, output: 2 }] } } }
  const u = { input: 1_000_000, output: 0 }
  const s = summarize([{ ts: day('2026-11-30T12:00:00Z'), model: 'm', usage: u }, { ts: day('2026-12-01T12:00:00Z'), model: 'm', usage: u }] as any, prices)
  expect(s.rows[0]).toMatchObject({ calls: 2, cost: 3, note: 'promotional price' })
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

test('/usage-ext prices from the table shipped with the mod, the user\'s entries win, and the answer dates the table', async ($, on) => {
  mock.clock(on)
  const now = new Date(2026, 9, 28, 12).getTime()
  const file = '2026-10-28.jsonl'
  const ledger = [
    { ts: now - 5000, session: 'me', model: 'shipped-model-20261001', usage: { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 2_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 } } },
    { ts: now - 4000, session: 'me', model: 'mine', usage: { input_tokens: 1_000_000, output_tokens: 0 } },
    { ts: now - 3000, session: 'me', model: 'nobody-knows', usage: { input_tokens: 5, output_tokens: 5 } },
  ].map(r => JSON.stringify(r)).join('\n')
  const builtin = { per: 1_000_000, updated: '2026-10-28', sources: ['https://example.test/pricing'], models: { 'shipped-model': { input: 1, output: 2, cacheWrite: 3, cacheWrite1h: 4, note: 'a note' }, mine: { input: 100, output: 100 } } }
  let user: string | undefined = JSON.stringify({ models: { mine: { input: 5, output: 5 } } })
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'TOKEN_USAGE_EXT_DIR' ? '/ext' : undefined }))
  on('session.id', async () => ({ value: 'me' }))
  on('session.usage', async () => ({ value: { startedAt: now - 60_000, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('fs.list', async () => ({ value: [{ name: file, kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', async (_$: any, e: any) => {
    if (e.path === `/ext/ledger/${file}`) return { value: ledger }
    if (e.path.endsWith('/prices.default.json')) return { value: JSON.stringify(builtin) }
    if (e.path === '/ext/prices.json' && user) return { value: user }
    return { deny: 'missing' }
  })
  const { text } = await $.command.run({ command: 'usage-ext', args: '' } as any)
  expect(text).toContain('shipped-model-20261001 · 1 次')
  expect(text).toContain('估价 $10.00') // 1 input + 2 output + 3 (5-minute write) + 4 (1-hour write), per million
  expect(text).toContain('mine · 1 次')
  expect(text).toContain('估价 $5.00') // the user's own entry, not the shipped $100
  expect(text).toContain('nobody-knows · 1 次')
  expect(text).toContain('未定价')
  expect(text).toContain('shipped-model-20261001 的价格备注：a note')
  expect(text).toContain('内置价格表更新于 2026-10-28')
  expect(text).toContain('built-in prices updated 2026-10-28')
  const asJson = JSON.parse(((await $.command.run({ command: 'usage-ext', args: 'json' } as any)) as any).text)
  expect(asJson.builtinPrices).toEqual({ updated: '2026-10-28', sources: ['https://example.test/pricing'] })
  expect(asJson.pricesLoaded).toBe(true)
  // no prices.json of the user's: the shipped table alone prices what it knows
  user = undefined
  const alone = ((await $.command.run({ command: 'usage-ext', args: '' } as any)) as any).text
  expect(alone).toContain('估价 $100.00')
  expect(alone).toContain('内置价格表更新于 2026-10-28')
})

// ---- capturing usage from Bash / MCP tool output (the tool.call hook) ----

const NOW = new Date(2026, 9, 28, 12).getTime()
const AUTO = '/ext/ledger/2026-10-28.auto-me.jsonl'
const DAYFILE = '/ext/ledger/2026-10-28.jsonl'

// the engine beneath the plugin: a filesystem in memory (reads and writes take a tick, as real ones do), the session,
// the clock, the environment, and a tool that answers with `out.text`
const rig = ($: any, on: any, files: Record<string, string> = {}, out: { text?: string | ((e: any) => string); isError?: boolean; deny?: string; env?: Record<string, string>; unreadable?: string } = {}) => {
  on('clock.now', async () => ({ value: NOW }))
  on('session.id', async () => ({ value: 'me' }))
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'TOKEN_USAGE_EXT_DIR' ? '/ext' : out.env?.[e.name] }))
  on('fs.read', async (_$: any, e: any) => {
    await Promise.resolve()
    return e.path in files && e.path !== out.unreadable ? { value: files[e.path] } : { deny: 'missing' }
  })
  on('fs.exists', async (_$: any, e: any) => ({ value: e.path in files }))
  on('fs.write', async (_$: any, e: any) => {
    await Promise.resolve()
    files[e.path] = e.text
    return { value: undefined }
  })
  on('tool.call', async (_$: any, e: any) => (out.deny ? { deny: out.deny } : { result: {}, text: (typeof out.text === 'function' ? out.text(e) : out.text) ?? '', ...(out.isError ? { isError: true } : {}) }) as any)
  return files
}
const autoFiles = (files: Record<string, string>) => Object.keys(files).filter(k => k.includes('.auto-'))
const linesOf = (text: string | undefined) => (text ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l))
const openai = (extra: object = {}) => JSON.stringify({ id: 'chatcmpl-secret-id', object: 'chat.completion', model: 'gpt-5-2025-08-07', choices: [{ message: { content: 'THE SECRET REPLY' } }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_tokens_details: { cached_tokens: 20 } }, ...extra })

test('a Bash call that prints a response with usage is logged: numbers, model, session; never the text', async ($, on) => {
  const files = rig($, on, {}, { text: 'calling the API...\n' + openai() + '\ndone' })
  const r: any = await $.tool.call({ tool: 'Bash', command: 'python3 call.py --prompt "a private prompt"', tool_use_id: 'toolu_1' } as any)
  expect(r.text).toContain('THE SECRET REPLY') // the tool's answer goes on untouched
  expect(autoFiles(files)).toEqual([AUTO])
  const [rec, ...more] = linesOf(files[AUTO])
  expect(more.length).toBe(0)
  expect(rec).toEqual({ ts: NOW, session: 'me', provider: 'openai', model: 'gpt-5-2025-08-07', usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_tokens_details: { cached_tokens: 20 } }, note: 'auto: Bash', auto: true, call: 'toolu_1' })
  const raw = files[AUTO]
  for (const secret of ['THE SECRET REPLY', 'chatcmpl-secret-id', 'a private prompt', 'call.py']) expect(raw).not.toContain(secret)
  // and the ledger reads it back like any other line
  expect(summarize(parse(raw).recs, null).rows[0]).toMatchObject({ key: 'openai/gpt-5-2025-08-07', calls: 1, input: 100, cached: 20, output: 30 })
})

// No double counting: the command may have logged the call itself (tu-log) and also printed the usage.
test('a call the command already logged with tu-log is not logged again', async ($, on) => {
  const text = openai()
  const tuLog = (over: object = {}) => JSON.stringify({ ts: NOW - 1000, session: 'me', provider: 'openai', model: 'gpt-5-2025-08-07', usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 } }, ...over })
  // same session, same numbers, a moment before the command ended: one call
  let files = rig($, on, { [DAYFILE]: tuLog() + '\n' }, { text })
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
  expect(autoFiles(files)).toEqual([])
  // a bare tu-log line (no model, no provider) is the same call too
  files[DAYFILE] = tuLog({ model: undefined, provider: undefined }) + '\n'
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
  expect(autoFiles(files)).toEqual([])
  // not the same call: other numbers, another session, another model, or logged long before the command ran
  for (const over of [{ usage: { prompt_tokens: 121, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 } } }, { session: 'someone-else' }, { model: 'gpt-4o' }, { ts: NOW - 60_000 }]) {
    for (const k of autoFiles(files)) delete files[k]
    files[DAYFILE] = tuLog(over) + '\n'
    await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
    expect(autoFiles(files)).toEqual([AUTO])
  }
})

test('alreadyLogged: the window, the session, the numbers and the model all have to agree', async () => {
  const [f] = findUsages(openai())
  const rec = { ts: 1000, session: 's', model: 'gpt-5', usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 } } }
  expect(alreadyLogged(f, [rec], 's', 900, 1100)).toBe(true) // a dated snapshot id and the bare model are the same model
  expect(alreadyLogged(f, [rec], 's', 1001, 1100)).toBe(false)
  expect(alreadyLogged(f, [rec], 'other', 900, 1100)).toBe(false)
  expect(alreadyLogged(f, [{ ...rec, model: 'gpt-4o' }], 's', 900, 1100)).toBe(false)
  expect(alreadyLogged(f, [{ ...rec, usage: { prompt_tokens: 1, completion_tokens: 1 } }], 's', 900, 1100)).toBe(false)
})

test('the same numbers printed twice in one output are one call; two different calls are two', async ($, on) => {
  const once = openai()
  const out: any = { text: `${once}\nusage again: ${JSON.stringify({ usage: JSON.parse(once).usage, model: 'gpt-5-2025-08-07' })}` }
  const files = rig($, on, {}, out)
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
  expect(linesOf(files[AUTO]).length).toBe(1)
  delete files[AUTO]
  out.text = `${once}\n${openai({ usage: { prompt_tokens: 7, completion_tokens: 3 } })}`
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
  expect(linesOf(files[AUTO]).map(r => r.usage.prompt_tokens)).toEqual([120, 7])
})

test('what is not a new API call is not logged', async ($, on) => {
  const out: any = { text: '' }
  const files = rig($, on, {}, out)
  const ledgerLine = JSON.stringify({ ts: NOW, session: 'me', provider: 'openai', model: 'gpt-5', usage: { prompt_tokens: 5, completion_tokens: 5 } })
  const cases: [string, string, string][] = [
    ['a file shown with cat', 'cat notes.md', openai()],
    ['a git diff', 'git diff HEAD~1 -- docs', openai()],
    ['a pipe of viewers', 'cd docs && grep -n usage README.md | head -5', openai()],
    ['the ledger itself', 'python3 show_ledger.py', ledgerLine + '\n' + ledgerLine],
    ['the generic {input, output} pair', 'python3 bench.py', JSON.stringify({ model: 'x', usage: { input: 5, output: 6 } })],
    ['a Python repr', 'python3 call.py', "{'model': 'gpt-5', 'usage': {'prompt_tokens': 5, 'completion_tokens': 6}}"],
    ['truncated JSON', 'python3 call.py', openai().slice(0, 150)],
    ['output with no usage', 'python3 call.py', JSON.stringify({ model: 'gpt-5', choices: [] }) + ' tokens'],
    ['zero tokens', 'python3 call.py', JSON.stringify({ usage: { prompt_tokens: 0, completion_tokens: 0 } })],
  ]
  for (const [why, command, text] of cases) {
    out.text = text
    await $.tool.call({ tool: 'Bash', command } as any)
    expect([why, autoFiles(files)]).toEqual([why, []])
  }
  // a denied call has no output to read; the switch turns the whole thing off
  out.text = openai()
  out.deny = 'blocked'
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
  out.deny = undefined
  out.env = { TOKEN_USAGE_AUTO: 'off' }
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
  expect(autoFiles(files)).toEqual([])
  // a tool that is neither Bash nor MCP is never looked at
  out.env = {}
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  expect(autoFiles(files)).toEqual([])
  // and with the switch back on the very same call is logged
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
  expect(autoFiles(files)).toEqual([AUTO])
})

test('an MCP tool that returns a Gemini response is logged under its own name; Gemini gets no provider', async ($, on) => {
  const gemini = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'SECRET' }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 10, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 1000 }] }, modelVersion: 'gemini-2.5-flash', responseId: 'abc' })
  const files = rig($, on, {}, { text: gemini })
  await $.tool.call({ tool: 'mcp__vertex__generate', prompt: 'hi', tool_use_id: 'toolu_2' } as any)
  const [rec] = linesOf(files[AUTO])
  expect(rec).toEqual({ ts: NOW, session: 'me', model: 'gemini-2.5-flash', usage: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 10 }, note: 'auto: mcp__vertex__generate', auto: true, call: 'toolu_2' })
  expect(files[AUTO]).not.toContain('SECRET')
})

test('Gemini CLI stats give one line per model', async ($, on) => {
  const stats = JSON.stringify({ response: 'SECRET', stats: { models: { 'gemini-2.5-pro': { api: { totalRequests: 1 }, tokens: { input: 8044, prompt: 8044, candidates: 367, total: 8448, cached: 0, thoughts: 37, tool: 0 } }, 'gemini-2.5-flash-lite': { tokens: { input: 100, prompt: 100, candidates: 5, total: 105, cached: 0, thoughts: 0, tool: 0 } } } } })
  const files = rig($, on, {}, { text: stats })
  await $.tool.call({ tool: 'Bash', command: 'gemini -p "x" --output-format json' } as any)
  expect(linesOf(files[AUTO]).map(r => [r.model, r.usage.candidates])).toEqual([['gemini-2.5-pro', 367], ['gemini-2.5-flash-lite', 5]])
  expect(files[AUTO]).not.toContain('SECRET')
})

test('a call that failed after printing its usage still spent the tokens', async ($, on) => {
  const files = rig($, on, {}, { text: openai() + '\nTraceback: connection reset', isError: true })
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
  expect(linesOf(files[AUTO]).length).toBe(1)
})

test('calls that finish together are all logged; the same call is never logged twice', async ($, on) => {
  // parallel tool calls: each prints its own numbers, told apart by tool_use_id
  const files = rig($, on, {}, { text: (e: any) => openai({ usage: { prompt_tokens: Number(String(e.tool_use_id).slice(1)), completion_tokens: 1 } }) })
  await Promise.all([1, 2, 3].map(n => $.tool.call({ tool: 'Bash', command: 'python3 call.py', tool_use_id: `t${n}` } as any)))
  expect(linesOf(files[AUTO]).map(r => r.usage.prompt_tokens).sort()).toEqual([1, 2, 3])
  // the same tool call seen again (a replay) adds nothing
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py', tool_use_id: 't2' } as any)
  expect(linesOf(files[AUTO]).length).toBe(3)
})

test('a capture file that exists but cannot be read is left alone, not overwritten', async ($, on) => {
  const out: any = { text: openai(), unreadable: AUTO }
  const files = rig($, on, { [AUTO]: '{"ts":1,"usage":{"input":1,"output":1}}\n' }, out)
  const before = files[AUTO]
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
  expect(files[AUTO]).toBe(before)
  // readable again, but the last line has no newline: the new line is not glued to it
  out.unreadable = undefined
  files[AUTO] = '{"ts":1,"session":"me","usage":{"input_tokens":1,"output_tokens":1}}'
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
  expect(linesOf(files[AUTO]).length).toBe(2)
})

test('/usage-ext reads the capture files and says how many lines were logged automatically', async ($, on) => {
  const files = rig($, on, {}, { text: openai() })
  on('session.usage', async () => ({ value: { startedAt: NOW - 60_000, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('fs.list', async () => ({ value: Object.keys(files).map(k => ({ name: k.split('/').pop(), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }))
  files[DAYFILE] = JSON.stringify({ ts: NOW - 300_000, session: 'me', model: 'tu-logged', usage: { input: 1, output: 1 } }) + '\n'
  await $.tool.call({ tool: 'Bash', command: 'python3 call.py' } as any)
  const { text } = await $.command.run({ command: 'usage-ext', args: '' } as any)
  expect(text).toContain('openai/gpt-5-2025-08-07 · 1 次')
  expect(text).toContain('tu-logged · 1 次')
  expect(text).toContain('其中 1 条是从 Bash / MCP 工具的输出里自动记下的')
  expect(text).toContain('TOKEN_USAGE_AUTO=off')
})

// ---- reading usage out of text ----

test('findUsages: the wire formats providers send, wherever they sit in the text', async () => {
  const one = (text: string) => findUsages(text).map(f => ({ model: f.model, provider: f.provider, ...f.tok }))
  // Anthropic message: model beside the usage; the vendor follows from a claude-* id
  expect(one('{"type":"message","model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":300,"cache_creation_input_tokens":40,"cache_creation":{"ephemeral_5m_input_tokens":10,"ephemeral_1h_input_tokens":30}}}'))
    .toEqual([{ model: 'claude-sonnet-4-5-20250929', provider: 'anthropic', input: 10, cached: 300, cacheWrite: 10, cacheWrite1h: 30, output: 20, thinking: 0 }])
  // OpenAI Responses inside an event, in a log line
  expect(one('2026-10-28 INFO event=' + JSON.stringify({ type: 'response.completed', response: { model: 'gpt-5.5', usage: { input_tokens: 500, output_tokens: 200, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 60 } } } }) + ' ok'))
    .toEqual([{ model: 'gpt-5.5', provider: 'openai', input: 400, cached: 100, cacheWrite: 0, cacheWrite1h: 0, output: 140, thinking: 60 }])
  // Ollama: the counts sit beside the reply, in the reply object itself
  expect(one('{"model":"llama3.2","response":"hi","done":true,"prompt_eval_count":26,"eval_count":298}')).toEqual([{ model: 'llama3.2', provider: 'ollama', input: 26, cached: 0, cacheWrite: 0, cacheWrite1h: 0, output: 298, thinking: 0 }])
  // a script that printed only the usage object: no model, no provider
  expect(one('usage -> {"promptTokenCount": 9, "candidatesTokenCount": 3}')).toEqual([{ model: undefined, provider: undefined, input: 9, cached: 0, cacheWrite: 0, cacheWrite1h: 0, output: 3, thinking: 0 }])
  // JSON lines, and a list of responses: each is found
  expect(findUsages(['{"model":"m","usage":{"prompt_tokens":1,"completion_tokens":1}}', 'text', '[{"usage":{"prompt_tokens":2,"completion_tokens":2}}]'].join('\n')).length).toBe(2)
  // a model id that is free text is not kept as a model
  expect(findUsages('{"model":"a long sentence that is not an id","usage":{"prompt_tokens":1,"completion_tokens":1}}')[0].model).toBeUndefined()
  // braces in strings do not confuse the scan; an unbalanced brace before real JSON does not hide it
  expect(findUsages('{ oops "{" ... ' + '{"note":"}{","usage":{"prompt_tokens":4,"completion_tokens":4}}').length).toBe(1)
  expect(findUsages('')).toEqual([])
  expect(findUsages('{'.repeat(50_000)).length).toBe(0)
})

test('onlyViews: commands that only show files or text', async () => {
  for (const c of ['cat a.json', 'head -n 5 a.json | jq .', 'git log -p -3', 'cd x && ls -la && rg usage .', 'FOO=1 sed -n 1,5p /tmp/a', '/usr/bin/cat a', 'sudo cat /etc/hosts']) expect([c, onlyViews(c)]).toEqual([c, true])
  for (const c of ['python3 call.py', 'curl -s https://api.openai.com/v1/chat/completions | jq .', 'gemini -p hi', 'cat $(python3 call.py)', 'echo `python3 call.py`', 'git push', 'cat a && python3 call.py', 'bash -c "cat a"', '']) expect([c, onlyViews(c)]).toEqual([c, false])
})
