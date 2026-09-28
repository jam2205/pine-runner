import { describe, expect, it } from 'vitest';

import { createQuantPadPineProvider, pineTimeframeStringToMs } from '../src/provider';
import type { OhlcvBar, PineSymbolInfo } from '../src/types';

const MIN = 60_000;

const SYMBOL_INFO = { pointvalue: 50, currency: 'USD' } as unknown as PineSymbolInfo;

describe('pineTimeframeStringToMs', () => {
  it('parses Pine timeframe strings', () => {
    expect(pineTimeframeStringToMs('1')).toBe(MIN);
    expect(pineTimeframeStringToMs('5')).toBe(5 * MIN);
    expect(pineTimeframeStringToMs('240')).toBe(240 * MIN);
    expect(pineTimeframeStringToMs('30S')).toBe(30_000);
    expect(pineTimeframeStringToMs('S')).toBe(1_000);
    expect(pineTimeframeStringToMs('D')).toBe(86_400_000);
    expect(pineTimeframeStringToMs('2W')).toBe(2 * 7 * 86_400_000);
  });

  it('returns null for calendar months and junk', () => {
    expect(pineTimeframeStringToMs('M')).toBeNull();
    expect(pineTimeframeStringToMs('3M')).toBeNull();
    expect(pineTimeframeStringToMs('')).toBeNull();
    expect(pineTimeframeStringToMs(undefined)).toBeNull();
    expect(pineTimeframeStringToMs('abc')).toBeNull();
  });
});

function makeBars(count: number, startMs: number): OhlcvBar[] {
  return Array.from({ length: count }, (_, i) => ({
    t: startMs + i * MIN,
    o: 100 + i,
    h: 101 + i,
    l: 99 + i,
    c: 100.5 + i,
    v: 10,
  }));
}

describe('createQuantPadPineProvider.getMarketData', () => {
  const start = Date.UTC(2026, 0, 5);
  const provider = createQuantPadPineProvider({
    symbol: 'ES.FUT',
    bars: makeBars(60, start),
    barMs: MIN,
    symbolInfo: SYMBOL_INFO,
  });

  it('returns chart candles for the chart timeframe', async () => {
    const series = await provider.getMarketData('ES.FUT', '1');
    expect(series.length).toBe(60);
    expect(series[0].openTime).toBe(start);
    expect(series[0].closeTime).toBe(start + MIN);
  });

  it('resamples coarser multiples with a +1ms closeTime nudge for TV lookahead alignment', async () => {
    const series = await provider.getMarketData('ES.FUT', '5');
    expect(series.length).toBe(12);
    expect(series[0].openTime).toBe(start);
    // Without the nudge, the engine hands the completed bucket to the LAST chart
    // bar inside it (one bar of lookahead vs TradingView).
    expect(series[0].closeTime).toBe(start + 5 * MIN + 1);
    expect(series[0].high).toBe(101 + 4);
    expect(series[0].volume).toBe(50);
  });

  it('falls back to chart candles for finer or non-multiple timeframes', async () => {
    const finer = await provider.getMarketData('ES.FUT', '30S');
    expect(finer.length).toBe(60);
    expect(finer[0].closeTime).toBe(start + MIN);
  });

  it('filters by requested date range', async () => {
    const series = await provider.getMarketData(
      'ES.FUT',
      '1',
      undefined,
      start + 10 * MIN,
      start + 19 * MIN,
    );
    expect(series.length).toBe(10);
    expect(series[0].openTime).toBe(start + 10 * MIN);
  });

  it('exposes the passed-in symbol info', async () => {
    expect(await provider.getSymbolInfo()).toBe(SYMBOL_INFO);
  });
});
