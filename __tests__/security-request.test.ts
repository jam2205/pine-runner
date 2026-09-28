/**
 * Offline (synthetic-data) integration tests for request.security() through
 * the candle provider + runtime-compat shims. Guards two Pine parity fixes:
 *  - `time` inside a security tuple must be a per-bar numeric timestamp, not
 *    the opaque dual-use TimeHelper object (breaks ta.change / comparisons);
 *  - HTF values must become visible on the FIRST chart bar of the next
 *    bucket (TV lookahead_off), so `ta.change(security(..., time))` fires on
 *    boundary bars like 09:30/09:35 — the standard "new HTF bar" idiom.
 */
import { describe, expect, it } from 'vitest';

import { loadPineEngine } from '../src/engine';
import { createQuantPadPineProvider } from '../src/provider';
import { patchPineRuntimeClassCompat } from '../src/runtime-compat';
import type { OhlcvBar, PineSymbolInfo } from '../src/types';

const MIN = 60_000;

const SYMBOL_INFO = {
  tickerid: 'ES.FUT',
  ticker: 'ES.FUT',
  pointvalue: 50,
  mintick: 0.25,
  pricescale: 4,
  currency: 'USD',
  timezone: 'America/Chicago',
  type: 'futures',
} as unknown as PineSymbolInfo;

function syntheticBars(count: number): OhlcvBar[] {
  const bars: OhlcvBar[] = [];
  const start = Date.UTC(2026, 0, 5); // Monday 00:00 UTC
  for (let i = 0; i < count; i++) {
    const base = 100 + Math.sin(i / 25) * 5;
    bars.push({
      t: start + i * MIN,
      o: base,
      h: base + 1,
      l: base - 1,
      c: base + 0.5,
      v: 1000 + i,
    });
  }
  return bars;
}

const SRC = `//@version=5
indicator("sec debug")
[h5, v5, t5] = request.security(syminfo.tickerid, "5", [high, volume, time], barmerge.gaps_off, barmerge.lookahead_off)
n5 = ta.change(t5) != 0
plot(h5, "h5")
plot(t5, "t5")
plot(n5 ? 1 : 0, "n5")
`;

describe('request.security with a [ohlcv, time] tuple on a finer chart', () => {
  it('returns numeric per-bar time and flips on TV boundary bars', async () => {
    const { PineEngine, PineIndicator } = loadPineEngine();
    patchPineRuntimeClassCompat(PineEngine);

    const bars = syntheticBars(600);
    const provider = createQuantPadPineProvider({
      symbol: 'ES.FUT',
      bars,
      barMs: MIN,
      symbolInfo: SYMBOL_INFO,
    });
    const pine = new PineEngine(provider, 'ES.FUT', '1m', bars.length);
    const context = await pine.run(new PineIndicator(SRC));

    const points = (key: string): Array<{ time: number; value: number }> =>
      context?.plots?.[key]?.data ?? [];

    const t5 = points('t5');
    const n5 = points('n5');
    // The first bucket has no completed prior bucket (na → dropped point).
    expect(t5.length).toBeGreaterThan(590);

    // Every time value is a real numeric timestamp, never an object/NaN —
    // without the class compat patch the whole series is dropped because the
    // tuple records the opaque TimeHelper object.
    for (const p of t5) {
      expect(typeof p.value).toBe('number');
      expect(Number.isFinite(p.value)).toBe(true);
    }

    // TV lookahead_off alignment: the completed 5m bucket becomes visible on
    // the first 1m bar of the NEXT bucket, so changes land exactly on
    // 5-minute boundaries and report the PREVIOUS bucket's open time.
    for (const p of t5) {
      const expectedBucket = Math.floor((p.time - 5 * MIN) / (5 * MIN)) * 5 * MIN;
      expect(p.value).toBe(expectedBucket);
    }
    const start = Date.UTC(2026, 0, 5);
    for (const p of n5) {
      if (p.time < start + 10 * MIN) continue;
      const isBoundary = p.time % (5 * MIN) === 0;
      expect(p.value).toBe(isBoundary ? 1 : 0);
    }
  });
});
