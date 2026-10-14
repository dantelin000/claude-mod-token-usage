export type Win = { used: number; resetsAt?: string }
export type Snap = {
  five: Win | null
  seven: Win | null
  usd: number | null
  /** uncached input tokens (full input price) */
  tokIn: number
  /** tokens written to the prompt cache (1.25x / 2x input price) */
  tokWrite: number
  tokOut: number
  /** tokens read from the prompt cache */
  tokCache: number
  /** whose counters these are: the session id and its startedAt, so a resume restores and a /clear starts over */
  sid: string | null
  startedAt: number | null
  /** when counting began, ms; later than startedAt when the counters could not be restored */
  since: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'token-usage': { snap: Snap; tick: number }
  }
}
