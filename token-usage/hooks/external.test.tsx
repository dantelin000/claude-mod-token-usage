import { test, expect, mock } from 'claude-code/testing'
import { cost, idForms, mergePrices, normalize, parse, parseArgs, pickFiles, priceAt, select, summarize } from './external'

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
