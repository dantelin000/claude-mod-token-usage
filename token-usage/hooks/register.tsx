import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Snap, Win } from '../types'

const EMPTY: Snap = { five: null, seven: null, usd: null, base: null, tokIn: 0, tokWrite: 0, tokOut: 0, tokCache: 0, sid: null, startedAt: null, since: null }
const snap = atom({ plugin: 'token-usage', key: 'snap' } as const, EMPTY)

const tick = atom({ plugin: 'token-usage', key: 'tick' } as const, 0)

const H = 3600_000

// ---- token counting ----
// The engine's cost (session.measure e.cost.usd, the same figure as /cost) sums every priced API
// response of the session. Count tokens the same way: once per API response. turn.complete's usage
// only carried the last response of a turn here (2026-10-14: this band showed 37.9M cache reads /
// 54k output where the transcript held 140.9M / 344k for the same $52), so turn.step is the source;
// turn.complete is the fallback for a turn none of whose steps reported usage.
type U = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
const add = ($: any, u: U) =>
  update($, snap, v => ({
    ...v,
    tokIn: v.tokIn + (u.input_tokens ?? 0),
    tokWrite: v.tokWrite + (u.cache_creation_input_tokens ?? 0),
    tokOut: v.tokOut + (u.output_tokens ?? 0),
    tokCache: v.tokCache + (u.cache_read_input_tokens ?? 0),
  }))
// turns whose steps were counted; a module variable, so a reload mid-turn at worst falls back for that turn
const stepped = new Set<string>()

// counters persist per session in $.store, so a restart or resume of the same session restores them
const KEEP = 30
const SKEY = 'sess:'
const persist = async ($: any) => {
  const v = await read($, snap)
  if (!v.sid) return
  await $.store.set(SKEY + v.sid, { tokIn: v.tokIn, tokWrite: v.tokWrite, tokOut: v.tokOut, tokCache: v.tokCache, startedAt: v.startedAt, since: v.since, base: v.base })
  const old = ((await $.store.keys()) as string[]).filter(x => x.startsWith(SKEY) && x !== SKEY + v.sid)
  for (const x of old.slice(0, Math.max(0, old.length - KEEP))) await $.store.delete(x)
}
// what this conversation itself has cost. A fork copies its parent's ledger, so the engine's total
// starts at the parent's spend (2026-10-16: a Haiku fork of an Opus chat opened at $4.36 for ~$0.1
// of its own); the amount is the ledger less what it held when this conversation began counting.
const spent = (v: Snap) => (v.usd === null ? null : Math.max(0, v.usd - (v.base ?? 0)))
const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`)

const left = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${String(m % 60).padStart(2, '0')}m`
}

// ---- desktop: one SVG strip of rounded pills (Svg is the desktop's picture leaf) ----

const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
const CW = 7.9 // monospace advance at 13px

type Icon = 'gauge' | 'cal' | 'clock' | 'up' | 'down' | 'layers' | 'coin'

// 16x16 line icons, drawn with currentColor-ish stroke set by the caller
const icon = (name: Icon, x: number, c: string) => {
  const g: Record<Icon, string> = {
    gauge: '<path d="M2.5 12.5a6 6 0 1 1 11 0" /><path d="M8 11l2.6-3.6" />',
    cal: '<rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />',
    clock: '<circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.2" />',
    up: '<path d="M8 10V3M5.2 5.6L8 2.8l2.8 2.8M3 10v3h10v-3" />',
    down: '<path d="M8 3v7M5.2 7.4L8 10.2l2.8-2.8M3 10v3h10v-3" />',
    layers: '<path d="M8 2.5l5.5 2.8L8 8.1 2.5 5.3zM2.5 8.2L8 11l5.5-2.8M2.5 11L8 13.8l5.5-2.8" />',
    coin: '<circle cx="8" cy="8" r="5.8" /><path d="M8 4.6v6.8M9.8 6.2c-.4-.6-1-.9-1.8-.9-1 0-1.8.5-1.8 1.3 0 1.8 3.6.8 3.6 2.6 0 .8-.8 1.3-1.8 1.3-.8 0-1.5-.3-1.9-.9" />',
  }
  return `<g transform="translate(${x} 6)" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${g[name]}</g>`
}

// slate developer-tool palette: dark tinted pills read on both dark and light app themes
const CARD = '#1B2336'
const FG = '#F8FAFC'
const MUTED = '#94A3B8'
const TRACK = '#334155'

const level = (p: number, fg: string) => (p >= 90 ? '#EF4444' : p >= 75 ? '#FBBF24' : fg)

// <title> is the native hover tooltip (works because the Svg is drawn isInteractive)
const pill = (x: number, w: number, bg: string, body: string, tip: string) =>
  `<g class="p"><title>${tip}</title><rect x="${x}" y="0" width="${w}" height="28" rx="14" fill="${CARD}"/>` +
  `<rect class="h" x="${x + 0.5}" y=".5" width="${w - 1}" height="27" rx="13.5" fill="${bg}" fill-opacity=".14" stroke="${bg}" stroke-opacity=".38"/>${body}</g>`

const longLeft = (iso: string | undefined, now: number) => {
  if (!iso) return '重置時間未知'
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d} 天 ${h} 小時後重置`
  if (h > 0) return `${h} 小時 ${m % 60} 分後重置`
  return `${m} 分後重置`
}

const text = (x: number, s: string, c: string, bold = false) =>
  `<text x="${x}" y="18.3" font-family="${MONO}" font-size="13" ${bold ? 'font-weight="700"' : ''} fill="${c}">${s}</text>`

// returns [svg, width]
const winPill = (x: number, label: string, title: string, ic: Icon, w: Win, span: number, now: number, bg: string, fg: string): [string, number] => {
  const c = level(w.used, fg)
  const pct = `${Math.round(w.used)}%`
  const reset = left(w.resetsAt, now)
  const BAR = 56
  let cx = x + 11
  let s = icon(ic, cx, fg)
  cx += 16 + 6
  s += text(cx, label, MUTED)
  cx += label.length * CW + 7
  const filled = Math.max(0, Math.min(1, w.used / 100)) * BAR
  s += `<rect x="${cx}" y="11.5" width="${BAR}" height="5" rx="2.5" fill="${TRACK}"/>`
  if (filled > 0) s += `<rect x="${cx}" y="11.5" width="${Math.max(5, filled)}" height="5" rx="2.5" fill="${c}"/>`
  if (w.resetsAt) {
    const el = Math.max(0, Math.min(1, 1 - (Date.parse(w.resetsAt) - now) / span))
    s += `<rect x="${cx + el * (BAR - 2)}" y="8.5" width="2" height="11" rx="1" fill="${FG}"/>`
  }
  cx += BAR + 9
  s += text(cx, pct, FG, true)
  cx += pct.length * (CW + 0.5) + 8
  s += `<rect x="${cx}" y="8" width="1" height="12" fill="${MUTED}" opacity=".35"/>`
  cx += 9
  s += icon('clock', cx, fg)
  cx += 16 + 5
  s += text(cx, reset, MUTED)
  cx += reset.length * CW + 11
  const tip = `${title}：已用 ${pct}，${longLeft(w.resetsAt, now)}&#10;長條上的直線＝這個時段已經過了多少時間`
  return [pill(x, cx - x, bg, s, tip), cx - x]
}

const chip = (x: number, ic: Icon, label: string, bg: string, fg: string, tip: string): [string, number] => {
  const w = 11 + 16 + 5 + label.length * CW + 11
  const body = icon(ic, x + 11, fg) + text(x + 11 + 16 + 5, label, FG)
  return [pill(x, w, bg, body, tip), w]
}

const strip = (v: Snap, now: number) => {
  const parts: string[] = []
  let x = 0
  const add = ([s, w]: [string, number], gap = 8) => {
    parts.push(s)
    x += w + gap
  }
  if (v.five) add(winPill(x, '5h', '5 小時工作階段額度', 'gauge', v.five, 5 * H, now, '#22C55E', '#4ADE80'))
  if (v.seven) add(winPill(x, '7d', '7 天每週額度', 'cal', v.seven, 7 * 24 * H, now, '#8B5CF6', '#A78BFA'), 18)
  add(chip(x, 'up', k(v.tokIn + v.tokWrite), '#F43F5E', '#FB7185', `新輸入 token：${k(v.tokIn + v.tokWrite)}&#10;寫入快取 ${k(v.tokWrite)}（按輸入價 1.25～2 倍計）＋未快取輸入 ${k(v.tokIn)}（按輸入價計）`))
  add(chip(x, 'down', k(v.tokOut), '#10B981', '#34D399', `輸出 token：模型在本工作階段產生的內容共 ${k(v.tokOut)}`))
  add(chip(x, 'layers', k(v.tokCache), '#6366F1', '#818CF8', `快取讀取 token：從提示快取重複使用 ${k(v.tokCache)}，計費較一般輸入低`), 18)
  const partial = v.since !== null && v.startedAt !== null && v.since - v.startedAt > 120_000
  const own = spent(v)
  const carried = v.usd !== null ? Math.min(v.base ?? 0, v.usd) : 0
  if (own !== null) add(chip(x, 'coin', `$${own.toFixed(2)}`, '#F59E0B', '#FBBF24', `本對話費用：依 API 牌價約 $${own.toFixed(2)} 美元（Claude Code 帳本，含子代理與壓縮）` + (carried >= 0.005 ? `&#10;不含起算前已有的 $${carried.toFixed(2)}（從別的對話分支而來）；/cost 的帳本總額為 $${v.usd!.toFixed(2)}` : '') + (partial ? `&#10;token 計數自 ${hhmm(v.since!)} 起` : '')))
  const w = Math.ceil(x - 8)
  return { w, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28" viewBox="0 0 ${w} 28"><style>:root{color-scheme:light dark;background:transparent}.p{cursor:help}.p .h{transition:fill-opacity .12s}.p:hover .h{fill-opacity:.26}</style>${parts.join('')}</svg>` }
}

// ---- terminal fallback: text chips ----

const bar = (w: Win, span: number, now: number) => {
  const n = 8
  const cells: string[] = Array.from({ length: n }, (_, i) => (i < Math.round((w.used / 100) * n) ? '━' : '─'))
  if (w.resetsAt) {
    const el = 1 - (Date.parse(w.resetsAt) - now) / span
    cells[Math.min(n - 1, Math.max(0, Math.floor(el * n)))] = '┃'
  }
  return cells.join('')
}

export const register: Register = on => {
  // redraw every 5 min so the reset countdowns and time markers keep moving; no model call
  on('session.start', async ($, e, next) => {
    $.clock.every(5 * 60_000, () => update($, tick, n => n + 1))
    // whose counters: same session and start → keep (a hot reload); else restore what this
    // session saved (a restart or resume), else start over (a new session, a /clear)
    try {
      const sid = await $.session.id()
      const { startedAt, cost } = await $.session.usage()
      const v = await read($, snap)
      if (v.sid !== sid || v.startedAt !== startedAt) {
        const saved = (await $.store.get(SKEY + sid)) as Partial<Snap> | undefined
        const ok = !!saved && saved.startedAt === startedAt
        const now = await $.clock.now()
        await update($, snap, cur => ({
          ...cur,
          tokIn: ok ? saved!.tokIn ?? 0 : 0,
          tokWrite: ok ? saved!.tokWrite ?? 0 : 0,
          tokOut: ok ? saved!.tokOut ?? 0 : 0,
          tokCache: ok ? saved!.tokCache ?? 0 : 0,
          sid,
          startedAt,
          since: ok ? saved!.since ?? startedAt : Math.max(startedAt, now - 60_000),
          // the ledger as the conversation opens: a fork's already holds its parent's spend, which is
          // not this conversation's. A record from before this was kept stays on the whole ledger.
          usd: cost ? cost.usd : null,
          base: ok ? saved!.base ?? 0 : cost ? cost.usd : null,
        }))
        await persist($)
      }
    } catch {}
    return next(e)
  })

  // one count per API response, main loop and subagents alike
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    try {
      if (r && r.usage) {
        stepped.add(e.turnId)
        await add($, r.usage)
      }
    } catch {}
    return r
  })

  // the compaction's own request is priced in the session's cost but is no turn step
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (r && 'usage' in r && r.usage) void add($, r.usage).then(() => persist($)).catch(() => {})
    return r
  })

  // a plugin's own model calls ($.model.complete) are priced too
  on('model.complete', async ($, e, next) => {
    const r = await next(e)
    // a call on $ answers { value } (or { deny }); the usage rides the value
    const u = r && 'value' in r ? r.value?.usage : undefined
    if (u) void add($, u).catch(() => {})
    return r
  })

  on('session.measure', async ($, e, next) => {
    const f = e.rateLimits.find(r => r.kind === 'five_hour')
    const s = e.rateLimits.find(r => r.kind === 'seven_day')
    await update($, snap, v => {
      const usd = e.cost ? e.cost.usd : v.usd
      // no ledger was readable at start: the first one seen is the conversation's start only while
      // nothing of its own has been counted; later it cannot be told apart, so the whole ledger shows
      const base = v.base ?? (usd === null ? null : v.tokIn + v.tokWrite + v.tokOut + v.tokCache === 0 ? usd : 0)
      return {
        ...v,
        five: f ? { used: f.percentUsed, resetsAt: f.resetsAt } : v.five,
        seven: s ? { used: s.percentUsed, resetsAt: s.resetsAt } : v.seven,
        usd,
        base,
      }
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      // fallback: a turn none of whose steps reported usage counts its own total once
      if (e.usage && !stepped.has(e.turnId)) await add($, e.usage)
      stepped.delete(e.turnId)
      await persist($)
    } catch {}
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await read($, tick)
    const v = await read($, snap)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    // AbovePrompt is one band shared by every plugin hooked on it. Answering without
    // next() would hide whatever a plugin beneath draws there (e.g. cc-arcade's board
    // while /arcade is open), so take what is beneath and draw our line under it.
    const below = await next(e)
    const stack = (own: ReturnType<typeof Box>) => (below ? <Box flexDirection="column">{below}{own}</Box> : own)

    const own = spent(v)
    if (!v.five && !v.seven && own === null && v.tokIn + v.tokWrite + v.tokOut + v.tokCache === 0) {
      return stack(<Box><Text dimColor>token-usage：等待第一次回應後顯示額度…</Text></Box>)
    }

    // ui.resolve completes every surface's table to every element name (an element
    // the surface lacks draws an empty fragment), so `'Svg' in t` is true on the
    // terminal too and the band drew nothing there. Branch on the surface instead.
    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const { w, svg } = strip(v, now)
      return stack(<Box><Svg source={svg} alt="5h / 7d 額度、token 與花費" width={w} height={28} isInteractive /></Box>)
    }

    const line = [
      v.five && `5h ${bar(v.five, 5 * H, now)} ${Math.round(v.five.used)}% ↻ ${left(v.five.resetsAt, now)}`,
      v.seven && `7d ${bar(v.seven, 7 * 24 * H, now)} ${Math.round(v.seven.used)}% ↻ ${left(v.seven.resetsAt, now)}`,
      `⇧ ${k(v.tokIn + v.tokWrite)}${v.tokWrite ? ` (寫 ${k(v.tokWrite)})` : ''}  ⇩ ${k(v.tokOut)}  ▤ ${k(v.tokCache)}`,
      own !== null && `$${own.toFixed(2)}`,
    ].filter(Boolean).join('  │  ')
    return stack(<Box><Text>{line}</Text></Box>)
  })
}
