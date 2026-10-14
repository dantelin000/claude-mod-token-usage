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

test('a turn with no step usage falls back to its own total', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('turn.complete', async () => ({ text: 'ok' }))
  await $.turn.complete({ ...done, turnId: 't7', usage: { ...usage, output_tokens: 4200, model: 'claude-opus-5-5' } } as any)
  const ui = await $.ui.mount({ plugin: 'token-usage', surface: 'terminal', component: 'AbovePrompt', props: {} as any })
  expect(await ui.find({ type: 'Text', text: /⇩ 4\.2k/ })).toBeDefined()
  await ui.unmount()
})
