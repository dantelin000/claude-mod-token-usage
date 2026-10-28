// External API usage ledger. Claude Code's own cost ledger only knows the requests it sends itself;
// a subagent that calls Vertex, OpenAI, Ollama... from a script is invisible to it. Any caller can
// append one JSON line per API call to ~/.claude/token-usage/ledger/YYYY-MM-DD.jsonl:
//   { "ts": <ms>, "session": "<CLAUDE_CODE_SESSION_ID>", "provider": "vertex", "model": "gemini-...", "usage": <the response's own usage object> }
// and this module turns those lines into tokens (one reading per provider shape), prices them with a
// table (the one shipped with the mod, prices.default.json, overlaid by the user's own prices.json), and
// sums them. Pure functions: the reading and the drawing of the answer live in register.tsx.

export type Rec = { ts: number; session?: string; provider?: string; model?: string; usage: any; note?: string }
export type Tok = { input: number; cached: number; cacheWrite: number; cacheWrite1h: number; output: number; thinking: number }
type RateKey = 'input' | 'output' | 'cached' | 'cacheWrite' | 'cacheWrite1h' | 'thinking'
type Rate = Partial<Record<RateKey, number | null>>
type Tier = Rate & { above: number }
// effective: from that UTC date on (ISO YYYY-MM-DD) the entry's fields replace the base's; note is free text
export type Price = Rate & { longPrompt?: Tier; effective?: (Rate & { from: string; longPrompt?: Tier })[]; note?: string }
export type Prices = { per?: number; updated?: string; sources?: string[]; models?: Record<string, Price> }
export type Row = Tok & { key: string; calls: number; cost: number; unpriced: number; note?: string }
export type Scope = 'session' | 'today' | 'all' | { days: number }

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0)
const pick = (u: any, ...keys: string[]) => {
  for (const k of keys) if (typeof u[k] === 'number') return num(u[k])
  return 0
}
const has = (u: any, ...keys: string[]) => keys.some(k => typeof u[k] === 'number')

// a caller may hand over the whole response: take the usage object out of it
const unwrap = (raw: any) => {
  if (raw && typeof raw === 'object') {
    for (const k of ['usageMetadata', 'usage_metadata', 'usage']) if (raw[k] && typeof raw[k] === 'object') return raw[k]
  }
  return raw
}

// What each provider reports, as four kinds of tokens that are priced differently:
//   input      new prompt tokens at the full input price (cache hits excluded)
//   cached     prompt tokens served from the provider's cache
//   cacheWrite prompt tokens written to a cache (Anthropic-style, priced above input); Anthropic's
//              1-hour writes (cache_creation.ephemeral_1h_input_tokens) are cacheWrite1h, priced above the 5-minute ones
//   output     reply tokens, thinking apart; thinking is priced as output unless the table says otherwise
export const normalize = (raw: unknown): Tok | null => {
  const u: any = unwrap(raw)
  if (!u || typeof u !== 'object') return null
  const tok = (t: Partial<Tok>): Tok => ({ input: 0, cached: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0, thinking: 0, ...t })

  // Gemini / Vertex usageMetadata (REST camelCase, Python snake_case): the prompt count includes the cached part
  if (has(u, 'promptTokenCount', 'prompt_token_count', 'candidatesTokenCount', 'candidates_token_count')) {
    const cached = pick(u, 'cachedContentTokenCount', 'cached_content_token_count')
    const prompt = pick(u, 'promptTokenCount', 'prompt_token_count')
    return tok({
      input: Math.max(0, prompt - cached) + pick(u, 'toolUsePromptTokenCount', 'tool_use_prompt_token_count'),
      cached,
      output: pick(u, 'candidatesTokenCount', 'candidates_token_count'),
      thinking: pick(u, 'thoughtsTokenCount', 'thoughts_token_count'),
    })
  }
  // Gemini CLI stats.models[m].tokens: `input` is already the prompt less the cached part
  if (has(u, 'candidates', 'thoughts')) {
    const cached = pick(u, 'cached')
    const input = has(u, 'input') ? pick(u, 'input') : Math.max(0, pick(u, 'prompt') - cached)
    return tok({ input: input + pick(u, 'tool'), cached, output: pick(u, 'candidates'), thinking: pick(u, 'thoughts') })
  }
  // OpenAI chat completions, OpenRouter, Groq: reasoning tokens are counted inside completion_tokens
  if (has(u, 'prompt_tokens', 'completion_tokens')) {
    const cached = num(u.prompt_tokens_details?.cached_tokens)
    const think = num(u.completion_tokens_details?.reasoning_tokens)
    return tok({ input: Math.max(0, pick(u, 'prompt_tokens') - cached), cached, output: Math.max(0, pick(u, 'completion_tokens') - think), thinking: think })
  }
  if (has(u, 'input_tokens', 'output_tokens')) {
    // Anthropic: input_tokens is only the uncached part, cache reads and writes are separate. cache_creation_input_tokens
    // is all writes; the nested cache_creation splits them into 5-minute and 1-hour ones.
    const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null
    if (has(u, 'cache_read_input_tokens', 'cache_creation_input_tokens') || cc) {
      const w1h = cc ? num(cc.ephemeral_1h_input_tokens) : 0
      const write = has(u, 'cache_creation_input_tokens') ? pick(u, 'cache_creation_input_tokens') : cc ? num(cc.ephemeral_5m_input_tokens) + w1h : 0
      const long = Math.min(write, w1h)
      return tok({ input: pick(u, 'input_tokens'), cached: pick(u, 'cache_read_input_tokens'), cacheWrite: write - long, cacheWrite1h: long, output: pick(u, 'output_tokens') })
    }
    // OpenAI Responses API: details nested, cached inside input_tokens, reasoning inside output_tokens
    if (u.input_tokens_details || u.output_tokens_details) {
      const cached = num(u.input_tokens_details?.cached_tokens)
      const think = num(u.output_tokens_details?.reasoning_tokens)
      return tok({ input: Math.max(0, pick(u, 'input_tokens') - cached), cached, output: Math.max(0, pick(u, 'output_tokens') - think), thinking: think })
    }
    return tok({ input: pick(u, 'input_tokens'), output: pick(u, 'output_tokens') })
  }
  // Ollama
  if (has(u, 'prompt_eval_count', 'eval_count')) return tok({ input: pick(u, 'prompt_eval_count'), output: pick(u, 'eval_count') })
  // already in this module's own terms
  if (has(u, 'input', 'output')) {
    return tok({ input: pick(u, 'input'), cached: pick(u, 'cached'), cacheWrite: pick(u, 'cacheWrite'), cacheWrite1h: pick(u, 'cacheWrite1h'), output: pick(u, 'output'), thinking: pick(u, 'thinking') })
  }
  return null
}

// ---- prices ----

const modelOf = (r: Rec) => r.model || r.usage?.modelVersion || r.usage?.model || 'unknown'
export const keyOf = (r: Rec) => (r.provider ? `${r.provider}/${modelOf(r)}` : modelOf(r))

// A model id in a usage object or a response often carries more than the table's key: `models/gemini-2.5-flash`,
// `publishers/google/models/gemini-2.5-flash`, `claude-sonnet-4-5-20250929`, `gpt-5-2025-08-07`, `...@20250929`, `...-latest`.
// In order: the id as given, the part after the last `/`, then each of those with one trailing date or `-latest`
// removed. Never a prefix match: `gpt-5.1-codex` must not fall onto `gpt-5.1`.
const DATED = /(-\d{8}|-\d{4}-\d{2}-\d{2}|@\d{8}|-latest)$/
export const idForms = (id: string) => {
  const tail = id.slice(id.lastIndexOf('/') + 1)
  return [...new Set([id, tail, id.replace(DATED, ''), tail.replace(DATED, '')])].filter(Boolean)
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

// for each form of the id, `provider/form` first, then the bare form
const priceOf = (prices: Prices | null, r: Rec): Price | undefined => {
  const m = prices?.models
  if (!m) return undefined
  for (const f of idForms(modelOf(r))) {
    for (const key of r.provider ? [`${r.provider}/${f}`, f] : [f]) {
      if (own(m, key) && m[key] && typeof m[key] === 'object') return m[key]
    }
  }
  return undefined
}

// The price that applied on the UTC day of `ts`: of the `effective` entries not after that day, the one with the
// greatest `from` overrides the base field by field (a longPrompt inside it replaces the base's whole). Providers
// give no time zone for their dates, so UTC is assumed. No `ts`, or no entry yet in force: the base.
export const priceAt = (p: Price, ts?: number): Price => {
  if (!p.effective?.length || typeof ts !== 'number' || !Number.isFinite(ts)) return p
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return p
  const day = date.toISOString().slice(0, 10)
  let best: NonNullable<Price['effective']>[number] | undefined
  for (const e of p.effective) {
    if (e && typeof e.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.from) && e.from <= day && (!best || e.from >= best.from)) best = e
  }
  if (!best) return p
  const { from: _from, ...over } = best
  const { effective: _effective, ...base } = p
  return { ...base, ...over }
}

// Overlay the user's table on the one shipped with the mod: the user's entry for a model replaces the shipped
// one whole, the shipped ones fill the rest. The result is in the user's `per`; the shipped rates are rescaled to it.
const RATES: RateKey[] = ['input', 'output', 'cached', 'cacheWrite', 'cacheWrite1h', 'thinking']
const rescale = (x: Rate, f: number) => {
  const o: Rate = { ...x }
  for (const k of RATES) if (typeof o[k] === 'number') o[k] = o[k]! * f
  return o
}
const rescalePrice = (p: Price, f: number): Price => ({
  ...p,
  ...rescale(p, f),
  ...(p.longPrompt ? { longPrompt: { ...p.longPrompt, ...rescale(p.longPrompt, f) } } : {}),
  ...(p.effective ? { effective: p.effective.map(e => ({ ...e, ...rescale(e, f), ...(e.longPrompt ? { longPrompt: { ...e.longPrompt, ...rescale(e.longPrompt, f) } } : {}) })) } : {}),
})
export const mergePrices = (builtin: Prices | null, user: Prices | null): Prices | null => {
  if (!builtin?.models || typeof builtin.models !== 'object') return user
  if (!user) return builtin
  const per = user.per ?? 1_000_000
  const f = per / (builtin.per ?? 1_000_000)
  const shipped = f === 1 ? builtin.models : Object.fromEntries(Object.entries(builtin.models).map(([k, v]) => [k, rescalePrice(v, f)]))
  return { ...user, per, models: { ...shipped, ...(user.models ?? {}) } }
}

// null when the table has no entry for the model, or no input/output rate: those calls are left unpriced
// rather than guessed. A missing cached/cacheWrite rate falls back to the input rate, cacheWrite1h to cacheWrite,
// thinking to output. longPrompt: a model priced higher for a prompt above a size (the whole call at the higher
// rate). ts picks the `effective` entry in force that day.
export const cost = (t: Tok, price: Price | undefined, per = 1_000_000, ts?: number): number | null => {
  if (!price) return null
  const p = priceAt(price, ts)
  const tier = p.longPrompt && t.input + t.cached + t.cacheWrite + t.cacheWrite1h > p.longPrompt.above ? p.longPrompt : undefined
  const rate = (k: RateKey) => {
    const v = tier && typeof tier[k] === 'number' ? tier[k] : p[k]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
  }
  const pi = rate('input')
  const po = rate('output')
  if (pi === undefined || po === undefined) return null
  const pc = rate('cached') ?? pi
  const pw = rate('cacheWrite') ?? pi
  const pw1 = rate('cacheWrite1h') ?? pw
  const pt = rate('thinking') ?? po
  return (t.input * pi + t.cached * pc + t.cacheWrite * pw + t.cacheWrite1h * pw1 + t.output * po + t.thinking * pt) / per
}

// ---- reading the ledger ----

export const parse = (text: string) => {
  const recs: Rec[] = []
  let bad = 0
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      const o = JSON.parse(s)
      if (o && typeof o === 'object' && typeof o.ts === 'number' && o.usage && typeof o.usage === 'object') recs.push(o)
      else bad++
    } catch {
      bad++
    }
  }
  return { recs, bad }
}

export const parseArgs = (args: string): { scope: Scope; json: boolean } => {
  let scope: Scope = 'session'
  let json = false
  for (const t of args.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (t === 'json') json = true
    else if (t === 'all' || t === 'today' || t === 'session') scope = t
    else if (/^\d+d$/.test(t)) scope = { days: Math.max(1, Number(t.slice(0, -1))) }
  }
  return { scope, json }
}

const DAY = 86_400_000
const ymd = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const midnight = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
const MAX_FILES = 400

// where a scope begins, in ms; a session has no start of its own here, it is matched by id
const sinceOf = (scope: Scope, now: number) =>
  scope === 'today' ? midnight(now) : typeof scope === 'object' ? now - scope.days * DAY : 0

// the day files that can hold the scope (one day of slack each way: files are named by the caller's local date)
export const pickFiles = (names: string[], scope: Scope, now: number, sessionStart: number) => {
  const days = names.filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort()
  const from = scope === 'all' ? '' : ymd((scope === 'session' ? sessionStart : sinceOf(scope, now)) - DAY)
  return days.filter(n => n.slice(0, 10) >= from).slice(-MAX_FILES)
}

export const select = (recs: Rec[], scope: Scope, sid: string, now: number) =>
  scope === 'session' ? recs.filter(r => r.session === sid) : recs.filter(r => r.ts >= sinceOf(scope, now))

const zero = (key: string): Row => ({ key, calls: 0, cost: 0, unpriced: 0, input: 0, cached: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0, thinking: 0 })
const addTo = (a: Row, t: Tok, c: number | null) => {
  a.calls++
  a.input += t.input
  a.cached += t.cached
  a.cacheWrite += t.cacheWrite
  a.cacheWrite1h += t.cacheWrite1h
  a.output += t.output
  a.thinking += t.thinking
  if (c === null) a.unpriced++
  else a.cost += c
}

export const summarize = (recs: Rec[], prices: Prices | null) => {
  const by = new Map<string, Row>()
  const total = zero('合计')
  let unrecognized = 0
  for (const r of recs) {
    const t = normalize(r.usage)
    if (!t) {
      unrecognized++
      continue
    }
    const p = priceOf(prices, r)
    const c = cost(t, p, prices?.per, r.ts)
    const key = keyOf(r)
    if (!by.has(key)) by.set(key, zero(key))
    const row = by.get(key)!
    if (typeof p?.note === 'string' && p.note) row.note = p.note
    addTo(row, t, c)
    addTo(total, t, c)
  }
  const rows = [...by.values()].sort((a, b) => b.cost - a.cost || b.calls - a.calls)
  return { rows, total, unrecognized }
}

// ---- the answer ----

export const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`)
export const usd = (c: number) => `$${c.toFixed(c < 1 ? 4 : 2)}`

const scopeName = (s: Scope) => (s === 'session' ? '本对话' : s === 'today' ? '今天' : s === 'all' ? '全部记录' : `最近 ${s.days} 天`)

const line = (r: Row) => {
  const out = `${k(r.output)}${r.thinking ? `（另含思考 ${k(r.thinking)}）` : ''}`
  const price = r.unpriced === r.calls ? '未定价' : usd(r.cost) + (r.unpriced ? `（另有 ${r.unpriced} 次未定价）` : '')
  return `${r.key} · ${r.calls} 次 · 输入 ${k(r.input)}${r.cacheWrite + r.cacheWrite1h ? `（缓存写入 ${k(r.cacheWrite + r.cacheWrite1h)}）` : ''} · 缓存读取 ${k(r.cached)} · 输出 ${out} · 估价 ${price}`
}

// builtin: the shipped price table (null when it could not be read); priced: the user has a prices.json of their own
export type Notes = { bad: number; unreadable: string[]; dir: string; priced: boolean; builtin: { updated?: string } | null }

// the built-in table's date: prices change, so every answer says how old the shipped ones are
const builtinLine = (n: Notes) =>
  n.builtin
    ? `内置价格表更新于 ${n.builtin.updated ?? '（未标日期）'}（built-in prices updated ${n.builtin.updated ?? 'unknown'}）；你自己的 prices.json 优先。价格会变，以云厂商账单为准`
    : '内置价格表读不到，只用你自己的 prices.json'

export const render = (s: ReturnType<typeof summarize>, scope: Scope, n: Notes) => {
  const head = `外部 API 用量（${scopeName(scope)}，来自账本；不含 Claude Code 自己的请求，那部分看 /cost）`
  if (!s.total.calls && !s.unrecognized) {
    return `${head}\n没有记录。账本目录：${n.dir}/ledger/（格式见 README 的 External API usage 一节）\n${builtinLine(n)}`
  }
  const out = [head, ...s.rows.map(line)]
  if (s.rows.length > 1) out.push(line(s.total))
  for (const r of s.rows) if (r.note) out.push(`${r.key} 的价格备注：${r.note}`)
  if (s.total.unpriced) out.push(`有 ${s.total.unpriced} 次调用没有价格，只统计了 token：${n.builtin ? '内置价格表' : '价格表'}里没有这个模型。把它的价格填进 ${n.dir}/prices.json${n.priced ? '' : '（文件不存在，参考 prices.example.json）'}`)
  if (s.unrecognized) out.push(`有 ${s.unrecognized} 条记录的 usage 认不出格式，已跳过`)
  if (n.bad) out.push(`有 ${n.bad} 行不是合法的账本记录，已跳过`)
  if (n.unreadable.length) out.push(`读不了的账本文件：${n.unreadable.join('、')}（超过 4 MiB 请按日拆分或归档）`)
  out.push(builtinLine(n))
  out.push('估价 = token × 价格表，仅供参考；以云厂商账单为准')
  return out.join('\n')
}
