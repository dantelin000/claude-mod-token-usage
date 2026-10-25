import { test, expect, mock } from 'claude-code/testing'

const done = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const }
const usage = { input_tokens: 1200, output_tokens: 34, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

test('band draws on terminal and desktop', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> }) // the engine draws nothing of its own there
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'token-usage', surface, component: 'AbovePrompt', props: {} as any })
    expect(await ui.find({ type: 'Text', text: /token-usage/ })).toBeDefined()
    await ui.unmount()
  }
})

// regression: with data, the terminal must draw a Text line (not the desktop-only Svg,
// which ui.resolve hands the terminal as an empty fragment)
test('band with data draws Text on terminal, Svg on desktop', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('turn.complete', async () => ({ text: 'ok' }))
  await $.turn.complete({ ...done, usage } as any)
  const term = await $.ui.mount({ plugin: 'token-usage', surface: 'terminal', component: 'AbovePrompt', props: {} as any })
  expect(await term.find({ type: 'Text', text: /⇧ 1\.2k/ })).toBeDefined()
  await term.unmount()
  const desk = await $.ui.mount({ plugin: 'token-usage', surface: 'desktop', component: 'AbovePrompt', props: {} as any })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  await desk.unmount()
})

// another plugin's band beneath (cc-arcade's board) is kept, our line drawn under it
test('band keeps what is drawn beneath it', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>BOARD</Text>
  })
  const ui = await $.ui.mount({ plugin: 'token-usage', surface: 'terminal', component: 'AbovePrompt', props: {} as any })
  expect(await ui.find({ type: 'Text', text: /BOARD/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /token-usage/ })).toBeDefined()
  await ui.unmount()
})

// 2026-10-14 accuracy fix: count once per API response (turn.step), not once per turn
const step = (i: number) => ({
  input_tokens: 10, output_tokens: 1000 * (i + 1), cache_creation_input_tokens: 2000, cache_read_input_tokens: 100_000, model: 'claude-opus-5-5',
})
const drive = async (s: AsyncIterable<unknown>) => { for await (const _ of s) { /* read to the end */ } }

test('every response of a turn counts once; the turn total does not count again', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: e.index < 2 ? 'tool_use' : 'end_turn', usage: step(e.index) } as any
  })
  on('turn.complete', async () => ({ text: 'ok' }))
  for (const index of [0, 1, 2]) await drive($.turn.step({ turnId: 't9', index, model: 'claude-opus-5-5', messageCount: 1 } as any))
  // the turn's own total (what the band used to count, last response only) must not be added on top
  await $.turn.complete({ ...done, turnId: 't9', usage: { ...step(2), model: 'claude-opus-5-5' } } as any)
  const ui = await $.ui.mount({ plugin: 'token-usage', surface: 'terminal', component: 'AbovePrompt', props: {} as any })
  // output 1k+2k+3k = 6.0k; cache reads 3 x 100k = 300.0k; new input 3 x (10 + 2000) = 6.0k with 6.0k written
  expect(await ui.find({ type: 'Text', text: /⇩ 6\.0k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▤ 300\.0k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /寫 6\.0k/ })).toBeDefined()
  await ui.unmount()
})

// 2026-10-16 fix: the amount is this conversation's own spend. A fork copies its parent's ledger
// ($4.36 of Opus in the case that showed it), which is not what the fork costs.
const ledger = (usd: number) => ({ context: { window: 1_000_000 }, rateLimits: [], cost: { usd } })
const start = { cwd: '/', surface: 'terminal' as const, isInteractive: true }
const measure = (usd: number) => ({ ...ledger(usd), changed: ['cost'] }) as any
// the engine's side of a session: its id, its ledger, and the two events the plugin observes
const engine = (on: any, sid: string, usd?: number) => {
  on('session.id', async () => ({ value: sid }))
  on('session.usage', async () => ({ value: { startedAt: 1000, context: { window: 1_000_000 }, rateLimits: [], ...(usd === undefined ? {} : { cost: { usd } }) } }))
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.measure', async (_$: any, e: any) => ({ changed: e.changed }))
}
const costBand = async ($: any) => $.ui.mount({ plugin: 'token-usage', surface: 'terminal', component: 'AbovePrompt', props: {} as any })

test('a fork shows its own spend, not the ledger it inherited', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  engine(on, 'fork-1', 4.36)
  await $.session.start(start)
  await $.session.measure(measure(4.44))
  const ui = await costBand($)
  expect(await ui.find({ type: 'Text', text: /\$0\.08/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$4\.44/ })).toBeUndefined()
  await ui.unmount()
})

test('a resumed session keeps the baseline it saved', async ($, on) => {
  mock.clock(on)
  mock.store(on, { 'sess:fork-2': { tokIn: 5, tokWrite: 0, tokOut: 5, tokCache: 0, startedAt: 1000, since: 1000, base: 4.36 } })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  engine(on, 'fork-2', 4.4)
  await $.session.start(start)
  const ui = await costBand($)
  expect(await ui.find({ type: 'Text', text: /\$0\.04/ })).toBeDefined()
  await ui.unmount()
})

test('a session saved before baselines existed keeps showing the whole ledger', async ($, on) => {
  mock.clock(on)
  mock.store(on, { 'sess:old-1': { tokIn: 5, tokWrite: 0, tokOut: 5, tokCache: 0, startedAt: 1000, since: 1000 } })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  engine(on, 'old-1', 3.21)
  await $.session.start(start)
  const ui = await costBand($)
  expect(await ui.find({ type: 'Text', text: /\$3\.21/ })).toBeDefined()
  await ui.unmount()
})

test('a new session starts at zero and counts everything after', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  engine(on, 'new-1', 0)
  await $.session.start(start)
  await $.session.measure(measure(0.5))
  const ui = await costBand($)
  expect(await ui.find({ type: 'Text', text: /\$0\.50/ })).toBeDefined()
  await ui.unmount()
})

test('a ledger first seen at the first measure is the start only while nothing was counted', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  engine(on, 'late-1') // no ledger at start
  await $.session.start(start)
  await $.session.measure(measure(4.36)) // nothing counted yet: this is where the conversation began
  await $.session.measure(measure(4.44))
  const ui = await costBand($)
  expect(await ui.find({ type: 'Text', text: /\$0\.08/ })).toBeDefined()
  await ui.unmount()
})

test('a turn with no step usage falls back to its own total', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('turn.complete', async () => ({ text: 'ok' }))
  await $.turn.complete({ ...done, turnId: 't7', usage: { ...usage, output_tokens: 4200, model: 'claude-opus-5-5' } } as any)
  const ui = await $.ui.mount({ plugin: 'token-usage', surface: 'terminal', component: 'AbovePrompt', props: {} as any })
  expect(await ui.find({ type: 'Text', text: /⇩ 4\.2k/ })).toBeDefined()
  await ui.unmount()
})

// subagents step in their own loop: each run is its own turn (its own turnId) and its steps carry
// its agentId. A fork subagent is one too; its first request carries the parent's whole context,
// so it reads a lot from the cache. A background run may end after the main turn did.
const steps: Record<string, { agentId?: string; usage: ReturnType<typeof step>[] }> = {
  m1: { usage: [0, 1].map(() => ({ ...step(0), output_tokens: 1000, cache_creation_input_tokens: 0 })) },
  s1: { agentId: 'a-sub', usage: [0, 1].map(() => ({ ...step(0), input_tokens: 0, output_tokens: 500, cache_creation_input_tokens: 5000, cache_read_input_tokens: 20_000 })) },
  f1: { agentId: 'a-fork', usage: [{ ...step(0), input_tokens: 0, output_tokens: 2000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 400_000 }] },
}
const sum = (us: ReturnType<typeof step>[]) => ({
  input_tokens: us.reduce((n, u) => n + u.input_tokens, 0),
  output_tokens: us.reduce((n, u) => n + u.output_tokens, 0),
  cache_creation_input_tokens: us.reduce((n, u) => n + u.cache_creation_input_tokens, 0),
  cache_read_input_tokens: us.reduce((n, u) => n + u.cache_read_input_tokens, 0),
  model: 'claude-opus-5-5',
})
const runStep = ($: any, turnId: string, index: number) =>
  drive($.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 1, agentId: steps[turnId].agentId } as any))
// the turn's own total as the host carries it: the last response only (see the 2026-10-14 fix);
// `whole` gives the true sum, for a run none of whose steps reported usage
const endTurn = ($: any, turnId: string, whole = false) => {
  const us = steps[turnId].usage
  const usage = whole ? sum(us) : { ...us[us.length - 1], model: 'claude-opus-5-5' }
  return $.turn.complete({ ...done, turnId, agentId: steps[turnId].agentId, usage } as any)
}

test('subagent and fork subagent responses count once each, with the main loop', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: steps[e.turnId].usage[e.index] } as any
  })
  on('turn.complete', async () => ({ text: 'ok' }))
  await runStep($, 'm1', 0) // the main loop calls Agent twice: a subagent and a background fork
  await runStep($, 's1', 0)
  await runStep($, 's1', 1)
  await endTurn($, 's1')
  await runStep($, 'm1', 1)
  await endTurn($, 'm1') // the main turn ends while the fork still runs
  await runStep($, 'f1', 0)
  await endTurn($, 'f1')
  const ui = await $.ui.mount({ plugin: 'token-usage', surface: 'terminal', component: 'AbovePrompt', props: {} as any })
  // output 2 x 1k + 2 x 500 + 2k = 5.0k; cache reads 2 x 100k + 2 x 20k + 400k = 640.0k;
  // written 2 x 5k + 1k = 11.0k, new input 11.0k + 20 uncached
  expect(await ui.find({ type: 'Text', text: /⇩ 5\.0k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▤ 640\.0k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⇧ 11\.0k \(寫 11\.0k\)/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent run with no step usage falls back to its own total', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('turn.step', async function* ($, e) {
    const usage = e.agentId === undefined ? steps.m1.usage[e.index] : null
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as any
  })
  on('turn.complete', async () => ({ text: 'ok' }))
  await runStep($, 'm1', 0)
  await runStep($, 's1', 0)
  await endTurn($, 's1', true) // its steps reported nothing: its own total, 2 x 500 out, counts
  await runStep($, 'm1', 1)
  await endTurn($, 'm1')
  const ui = await $.ui.mount({ plugin: 'token-usage', surface: 'terminal', component: 'AbovePrompt', props: {} as any })
  expect(await ui.find({ type: 'Text', text: /⇩ 3\.0k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▤ 240\.0k/ })).toBeDefined()
  await ui.unmount()
})
