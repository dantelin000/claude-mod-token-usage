// External API usage ledger. Claude Code's own cost ledger only knows the requests it sends itself;
// a subagent that calls Vertex, OpenAI, Ollama... from a script is invisible to it. Any caller can
// append one JSON line per API call to ~/.claude/token-usage/ledger/YYYY-MM-DD.jsonl:
//   { "ts": <ms>, "session": "<CLAUDE_CODE_SESSION_ID>", "provider": "vertex", "model": "gemini-...", "usage": <the response's own usage object> }
// and this module turns those lines into tokens (one reading per provider shape), prices them with a
// table the user keeps in prices.json, and sums them. Pure functions: the reading and the drawing of
// the answer live in register.tsx.

export type Rec = { ts: number; session?: string; provider?: string; model?: string; usage: any; note?: string }
export type Tok = { input: number; cached: number; cacheWrite: number; output: number; thinking: number }
type RateKey = 'input' | 'output' | 'cached' | 'cacheWrite' | 'thinking'
type Rate = Partial<Record<RateKey, number | null>>
export type Price = Rate & { longPrompt?: Rate & { above: number } }
export type Prices = { per?: number; models?: Record<string, Price> }
export type Row = Tok & { key: string; calls: number; cost: number; unpriced: number }
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
//   cacheWrite prompt tokens written to a cache (Anthropic-style, priced above input)
//   output     reply tokens, thinking apart; thinking is priced as output unless the table says otherwise
export const normalize = (raw: unknown): Tok | null => {
  const u: any = unwrap(raw)
  if (!u || typeof u !== 'object') return null
  const tok = (t: Partial<Tok>): Tok => ({ input: 0, cached: 0, cacheWrite: 0, output: 0, thinking: 0, ...t })

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
    // Anthropic: input_tokens is only the uncached part, cache reads and writes are separate
    if (has(u, 'cache_read_input_tokens', 'cache_creation_input_tokens')) {
      return tok({ input: pick(u, 'input_tokens'), cached: pick(u, 'cache_read_input_tokens'), cacheWrite: pick(u, 'cache_creation_input_tokens'), output: pick(u, 'output_tokens') })
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
    return tok({ input: pick(u, 'input'), cached: pick(u, 'cached'), cacheWrite: pick(u, 'cacheWrite'), output: pick(u, 'output'), thinking: pick(u, 'thinking') })
  }
  return null
}

// ---- prices ----

const modelOf = (r: Rec) => r.model || r.usage?.modelVersion || r.usage?.model || 'unknown'
export const keyOf = (r: Rec) => (r.provider ? `${r.provider}/${modelOf(r)}` : modelOf(r))

// `provider/model` first, then the bare model name
const priceOf = (prices: Prices | null, r: Rec): Price | undefined => {
  const m = prices?.models
  if (!m) return undefined
  return m[keyOf(r)] ?? m[modelOf(r)]
}

// null when the table has no entry for the model, or no input/output rate: those calls are left unpriced
// rather than guessed. A missing cached/cacheWrite rate falls back to the input rate, thinking to output.
// longPrompt: a model priced higher for a prompt above a size (the whole call at the higher rate).
export const cost = (t: Tok, p: Price | undefined, per = 1_000_000): number | null => {
  if (!p) return null
  const tier = p.longPrompt && t.input + t.cached + t.cacheWrite > p.longPrompt.above ? p.longPrompt : undefined
  const rate = (k: RateKey) => {
    const v = tier && typeof tier[k] === 'number' ? tier[k] : p[k]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
  }
  const pi = rate('input')
  const po = rate('output')
  if (pi === undefined || po === undefined) return null
  const pc = rate('cached') ?? pi
  const pw = rate('cacheWrite') ?? pi
  const pt = rate('thinking') ?? po
  return (t.input * pi + t.cached * pc + t.cacheWrite * pw + t.output * po + t.thinking * pt) / per
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

const zero = (key: string): Row => ({ key, calls: 0, cost: 0, unpriced: 0, input: 0, cached: 0, cacheWrite: 0, output: 0, thinking: 0 })
const addTo = (a: Row, t: Tok, c: number | null) => {
  a.calls++
  a.input += t.input
  a.cached += t.cached
  a.cacheWrite += t.cacheWrite
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
    const c = cost(t, priceOf(prices, r), prices?.per)
    const key = keyOf(r)
    if (!by.has(key)) by.set(key, zero(key))
    addTo(by.get(key)!, t, c)
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
  return `${r.key} · ${r.calls} 次 · 输入 ${k(r.input)}${r.cacheWrite ? `（缓存写入 ${k(r.cacheWrite)}）` : ''} · 缓存读取 ${k(r.cached)} · 输出 ${out} · 估价 ${price}`
}

export type Notes = { bad: number; unreadable: string[]; dir: string; priced: boolean }

export const render = (s: ReturnType<typeof summarize>, scope: Scope, n: Notes) => {
  const head = `外部 API 用量（${scopeName(scope)}，来自账本；不含 Claude Code 自己的请求，那部分看 /cost）`
  if (!s.total.calls && !s.unrecognized) {
    return `${head}\n没有记录。账本目录：${n.dir}/ledger/（格式见 README 的 External API usage 一节）`
  }
  const out = [head, ...s.rows.map(line)]
  if (s.rows.length > 1) out.push(line(s.total))
  if (s.total.unpriced) out.push(`有 ${s.total.unpriced} 次调用没有价格，只统计了 token：把模型的价格填进 ${n.dir}/prices.json${n.priced ? '' : '（文件不存在，参考 prices.example.json）'}`)
  if (s.unrecognized) out.push(`有 ${s.unrecognized} 条记录的 usage 认不出格式，已跳过`)
  if (n.bad) out.push(`有 ${n.bad} 行不是合法的账本记录，已跳过`)
  if (n.unreadable.length) out.push(`读不了的账本文件：${n.unreadable.join('、')}（超过 4 MiB 请按日拆分或归档）`)
  out.push('估价 = token × 你填的价格，仅供参考；以云厂商账单为准')
  return out.join('\n')
}
