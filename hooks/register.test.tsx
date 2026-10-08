import { describe, expect, mock, test } from 'claude-code/testing'

import { filledCells, levelColor, untilReset } from './register'

const context = { tokens: 84_000, window: 200_000, percent: 42 }
const rateLimits = [
  { kind: 'five_hour', percentUsed: 23 },
  { kind: 'seven_day', percentUsed: 91 },
]

describe('usage-meter', () => {
  test('helpers', async () => {
    expect(levelColor(10)).toBe('success')
    expect(levelColor(70)).toBe('warning')
    expect(levelColor(90)).toBe('error')
    expect(filledCells(42)).toBe(2)
    expect(filledCells(150)).toBe(5)
    expect(untilReset(new Date(134 * 60000).toISOString(), 0)).toBe('2h14m')
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`band on ${surface}: summary row with hover-revealed details`, async ($, on) => {
      mock.clock(on)
      on('session.measure', (_$, e) => ({ changed: e.changed }))
      on('session.usage', () => ({ value: {
        startedAt: 0,
        context: {
          ...context,
          breakdown: {
            categories: [
              { name: 'Messages', tokens: 52_000, color: 'permission', isDeferred: false, kind: 'used' },
              { name: 'Free space', tokens: 100_000, color: 'inactive', isDeferred: false, kind: 'free' },
            ],
          },
        },
        rateLimits,
        cost: { usd: 1.84 },
      } }) as never)

      await $.session.measure({ context, rateLimits, cost: { usd: 1.84 }, changed: ['context', 'rateLimits', 'cost'] })

      const ui = await $.ui.mount({
        plugin: 'usage-meter',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 20 } as never,
      })

      expect(await ui.find({ text: '$1.84' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: '▰▰▰▰▰' }))?.props.color).toBe('error')
      expect(await ui.find({ type: 'Button' })).toBeUndefined()

      const hidden = (await ui.findAll({ type: 'Box' })).filter(b => b.props.display === 'none')
      expect(hidden).toHaveLength(1)
      const tree = (await ui.drawn()) as unknown as { children: { props: { display?: string }; hover?: unknown }[] }
      expect(tree.children[0].hover).toEqual({ display: 'flex' })
      expect(await ui.find({ text: /messages 52k/ })).toBeDefined()
      expect(await ui.find({ text: /free space/ })).toBeUndefined()
      expect(await ui.find({ text: '84k / 200k' })).toBeDefined()
    })
  }
})
