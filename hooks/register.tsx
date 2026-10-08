import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Category, Limit, Snapshot, TurnTokens } from '../types'

const snap = atom({ plugin: 'usage-meter', key: 'snap' } as const, null)
const turn = atom({ plugin: 'usage-meter', key: 'turn' } as const, null)

const CELLS = 5
const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$cap' }
const LIMIT_ORDER = ['five_hour', 'seven_day', 'spend_limit']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Theme keys, so the colors follow the person's theme.
export const levelColor = (percent: number) =>
  percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'success'

export const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

export const filledCells = (percent: number) =>
  Math.min(CELLS, Math.max(0, Math.round((percent / 100) * CELLS)))

export const untilReset = (resetsAt: string | undefined, now: number) => {
  if (!resetsAt) return ''
  const at = Date.parse(resetsAt)
  const mins = Math.max(0, Math.round((at - now) / 60000))
  if (mins < 60) return `${mins}m`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`
  const d = new Date(at)
  return `${DAYS[d.getDay()]} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

const toSnapshot = (
  context: SessionContextUsage,
  rateLimits: SessionRateLimit[],
  cost: SessionCost | undefined,
  categories: Category[],
): Snapshot => ({
  ctxPercent: context.percent,
  ctxTokens: context.tokens,
  window: context.window,
  limits: rateLimits.map((l): Limit => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt })),
  usd: cost?.usd,
  categories,
})

// The local estimate is free; `full` would spend token-count requests every turn.
async function measure($: EngineInterface): Promise<Snapshot> {
  const u = await $.session.usage({ breakdown: 'summary' })
  const categories = (u.context.breakdown?.categories ?? [])
    .filter(c => c.kind === 'used' && c.tokens > 0)
    .map(c => ({ name: c.name, tokens: c.tokens, color: c.color }))
  return toSnapshot(u.context, u.rateLimits, u.cost, categories)
}

// A reading can come back without rate limits or cost (a fresh or restarted session,
// a response that carried no headers). Keep the last known values instead of blanking them.
export const keepKnown = (prev: Snapshot | null, fresh: Snapshot): Snapshot => {
  if (!prev) return fresh
  const limits = [...prev.limits.filter(p => !fresh.limits.some(f => f.kind === p.kind)), ...fresh.limits]
  limits.sort((a, b) => LIMIT_ORDER.indexOf(a.kind) - LIMIT_ORDER.indexOf(b.kind))
  return { ...fresh, limits, usd: fresh.usd ?? prev.usd }
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    const fresh = await measure($)
    await update($, snap, s => keepKnown(s, fresh))
    return ran
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      const fresh = await measure($)
      await update($, snap, s => keepKnown(s, fresh))
    } else {
      await update($, snap, s => keepKnown(s, toSnapshot(e.context, e.rateLimits, e.cost, s?.categories ?? [])))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const u = done.usage
    if (u) {
      const t: TurnTokens = {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens,
      }
      await update($, turn, () => t)
    }
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || s === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const last = await read($, turn)
    const now = await $.clock.now()

    const Bar = ({ percent }: { percent?: number }) => {
      if (percent === undefined) return <Text color="subtle">{'▱'.repeat(CELLS)}</Text>
      const n = filledCells(percent)
      return (
        <Box>
          <Text color={levelColor(percent)}>{'▰'.repeat(n)}</Text>
          <Text color="subtle">{'▱'.repeat(CELLS - n)}</Text>
        </Box>
      )
    }
    // One grid for every detail row: label | percent (right-aligned) | figure | extra.
    const Row = (props: { label: string; percent?: number; figure: string; children?: unknown }) => (
      <Box>
        <Box width={5}>
          <Text color="inactive">{props.label}</Text>
        </Box>
        <Box width={4} justifyContent="flex-end">
          {props.percent !== undefined && (
            <Text color={levelColor(props.percent)}>{`${Math.round(props.percent)}%`}</Text>
          )}
        </Box>
        <Box width={16} marginLeft={2}>
          <Text color="subtle">{props.figure}</Text>
        </Box>
        <Box flexShrink={1}>{props.children}</Box>
      </Box>
    )
    const Sep = () => <Text color="subtle">{' · '}</Text>

    const ctx = s.ctxPercent ?? 0
    // Until the first reply reports rate limits, show empty 5h/7d slots so they read as
    // "waiting" rather than missing. After a turn with none, the account has none (API key).
    const limits: (Omit<Limit, 'percent'> & { percent?: number })[] =
      s.limits.length > 0 || last ? s.limits : [{ kind: 'five_hour' }, { kind: 'seven_day' }]
    const rows = [{ label: 'ctx', percent: ctx as number | undefined }, ...limits.map(l => ({ label: LIMIT_LABEL[l.kind] ?? l.kind, percent: l.percent }))]
    const cost = s.usd === undefined ? '' : `$${s.usd.toFixed(2)}`
    const cached = last ? last.input + last.cacheRead + last.cacheWrite : 0
    const hitRate = last && cached > 0 ? Math.round((last.cacheRead / cached) * 100) : 0

    // Details sit above the summary and appear while the pointer is over the band,
    // so the row under the pointer never moves.
    return (
      <Box key="usage-meter" flexDirection="column">
        <Box flexDirection="column" display="none" hover={{ display: 'flex' }}>
          <Row label="ctx" percent={ctx} figure={s.ctxTokens === undefined ? '' : `${compact(s.ctxTokens)} / ${compact(s.window)}`}>
            {[...s.categories]
              .sort((x, y) => y.tokens - x.tokens)
              .slice(0, 4)
              .flatMap((c, i) => [
                ...(i > 0 ? [<Sep />] : []),
                <Text color={c.color} wrap="truncate">{`${c.name.toLowerCase()} ${compact(c.tokens)}`}</Text>,
              ])}
          </Row>
          {limits.map(l => (
            <Row
              label={LIMIT_LABEL[l.kind] ?? l.kind}
              percent={l.percent}
              figure={l.percent === undefined ? 'waiting for a reply' : l.resetsAt ? `resets ${untilReset(l.resetsAt, now)}` : ''}
            />
          ))}
          <Row label="turn" figure={last ? `${compact(last.input + last.cacheWrite)} in` : 'no turns yet'}>
            {last && <Text color="subtle">{`${compact(last.output)} out`}</Text>}
            {last && <Sep />}
            {last && <Text color="subtle">{`${compact(last.cacheRead)} cached (${hitRate}%)`}</Text>}
          </Row>
        </Box>
        <Box gap={2}>
          {rows.map(r => (
            <Box gap={1}>
              <Text color="inactive">{r.label}</Text>
              <Bar percent={r.percent} />
            </Box>
          ))}
          {cost && <Text color="claude">{cost}</Text>}
        </Box>
      </Box>
    )
  })
}
