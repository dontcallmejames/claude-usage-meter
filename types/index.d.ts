export type Limit = { kind: string; percent: number; resetsAt?: string }
export type Category = { name: string; tokens: number; color: string }
export type TurnTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type Snapshot = {
  ctxPercent?: number
  ctxTokens?: number
  window: number
  limits: Limit[]
  usd?: number
  categories: Category[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { snap: Snapshot | null; turn: TurnTokens | null }
  }
}
