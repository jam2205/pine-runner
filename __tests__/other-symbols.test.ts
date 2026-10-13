/**
 * Symbols other than the chart's (provider.ts), price-pane drawings
 * (normalize.ts) and signed number formats (runtime-compat.ts). Synthetic bars.
 */
import { describe, expect, it } from 'vitest';

import { runPine } from '../src/run';
import type { OhlcvBar, PineSymbolInfo } from '../src/types';

const MIN = 60_000;
const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 5); // Monday 00:00 UTC

const chartBars: OhlcvBar[] = Array.from({ length: 4 * 96 }, (_, i) => {
  const base = 200 + Math.sin(i / 30);
  return { t: START + i * 15 * MIN, o: base, h: base + 0.2, l: base - 0.2, c: base + 0.05, v: 1 };
});
// One daily bar per date, 40 days back from the chart's first day: closes 4.00, 4.01, ...
const yieldBars: OhlcvBar[] = Array.from({ length: 44 }, (_, i) => {
  const c = 4 + i * 0.01;
  return { t: START - 40 * DAY + i * DAY, o: c, h: c, l: c, c, v: 0 };
});

const INFO = { ticker: 'GBPJPY', tickerid: 'GBPJPY', type: 'forex', mintick: 0.001, pricescale: 1000, timezone: 'Etc/UTC', basecurrency: 'GBP', currency: 'JPY' } as unknown as PineSymbolInfo;

async function run(source: string, extra: { ticker: string; barMs: number; bars: OhlcvBar[] }[] = []) {
  return runPine(
    { op: 'run', source, symbol: 'GBPJPY', timeframe: '15', barMs: 15 * MIN, symbolInfo: INFO, overrides: { inputs: {}, props: {} }, barsFile: '', displayStartMs: chartBars[0]!.t, windowed: false } as never,
    chartBars,
    extra,
  );
}
const last = (r: Awaited<ReturnType<typeof run>>, name: string) => {
  const o = r.visuals.overlays.find((x) => x.name === name);
  return o ? o.data[o.data.length - 1]!.y : undefined;
};

const OTHER = `//@version=6
indicator("other")
[a, b] = request.security("TVC:US02Y", "D", [close[1], close[6]], lookahead = barmerge.lookahead_on, ignore_invalid_symbol = true)
own = request.security(syminfo.tickerid, "D", high, lookahead = barmerge.lookahead_on)
plot(a, "prev")
plot(b, "prev5")
plot(own, "own")
`;

describe('a symbol other than the chart\'s', () => {
  it('gets no data, not the chart\'s bars, when none was supplied, and is reported', async () => {
    const r = await run(OTHER);
    expect(last(r, 'prev')).toBeUndefined();
    expect(last(r, 'own')).toBeGreaterThan(199);
    expect(r.requestedSymbols).toEqual([{ ticker: 'US02Y', supplied: false }]);
  });

  it('gets the supplied bars, matched without the exchange prefix', async () => {
    const r = await run(OTHER, [{ ticker: 'TVC:US02Y', barMs: DAY, bars: yieldBars }]);
    // The chart's last bar is on Thu 8 Oct, the yield series' 44th day (index 43): the completed close
    // before it is index 42, and five sessions before that index 37.
    expect(last(r, 'prev')).toBeCloseTo(4.42, 10);
    expect(last(r, 'prev5')).toBeCloseTo(4.37, 10);
    expect(last(r, 'own')).toBeGreaterThan(199);
    expect(r.requestedSymbols).toEqual([{ ticker: 'US02Y', supplied: true }]);
  });

  it('carries the last close forward when the supplied series stops before the chart does', async () => {
    // Stops on Mon 5 Oct (index 40, close 4.40); the chart runs to Thu 8 Oct.
    const r = await run(OTHER + 'plot(request.security("TVC:US02Y", timeframe.period, close, ignore_invalid_symbol = true), "now")\n',
      [{ ticker: 'TVC:US02Y', barMs: DAY, bars: yieldBars.slice(0, 41) }]);
    expect(last(r, 'prev')).toBeCloseTo(4.4, 10);
    expect(last(r, 'now')).toBeCloseTo(4.4, 10);
    // ...on the chart's LAST bar, three days after the series stops, not only on the day after it.
    const now = r.visuals.overlays.find((x) => x.name === 'now')!;
    expect(now.data[now.data.length - 1]!.t).toBe(chartBars[chartBars.length - 1]!.t);
  });

  it('does not list the chart\'s own symbol, with or without a prefix', async () => {
    const r = await run('//@version=6\nindicator("own")\nplot(request.security("OANDA:GBPJPY", "D", close), "x")\n');
    expect(r.requestedSymbols).toEqual([]);
  });
});

describe('drawings on the price pane from a script in its own pane', () => {
  it('come back, marked forceOverlay', async () => {
    const r = await run(`//@version=6
indicator("pane", overlay = false)
if barstate.islast
    box.new(bar_index - 5, high, bar_index, low, force_overlay = true, text = "zone")
    line.new(bar_index - 5, close, bar_index, close, force_overlay = true)
    label.new(bar_index, close, "here", force_overlay = true)
    label.new(bar_index, 0, "in the pane")
plot(close)
`);
    const d = r.visuals.drawings as { kind: string; text?: string; forceOverlay?: boolean }[];
    expect(d.filter((x) => x.forceOverlay).map((x) => x.kind).sort()).toEqual(['box', 'label', 'line']);
    expect(d.find((x) => x.text === 'in the pane')?.forceOverlay).toBeUndefined();
  });
});

describe('str.tostring with signed formats', () => {
  it('prints them as TradingView does', async () => {
    const r = await run(`//@version=6
indicator("fmt", overlay = true)
if barstate.islast
    label.new(bar_index, close, str.tostring(1.23456, "+0.000;-0.000") + "|" + str.tostring(-0.5, "+0.0;-0.0") + "|" + str.tostring(0.0, "+0.0;-0.0") + "|" + str.tostring(-2.5, "+0.00") + "|" + str.tostring(3.14159, "0.00"))
plot(close)
`);
    const label = (r.visuals.drawings as { kind: string; text?: string }[]).find((x) => x.kind === 'label');
    expect(label?.text).toBe('+1.235|-0.5|+0.0|-2.50|3.14');
  });

  it('rounds the number as stored, as TradingView does', async () => {
    // Read off the chart (IG:GBPJPY, 2026-10-13): 209.5325 shows 209.533, 209.4905 shows 209.491, 209.9765 shows 209.976.
    const r = await run(`//@version=6
indicator("half", overlay = true)
if barstate.islast
    label.new(bar_index, close, str.tostring(209.5325, format.mintick) + "|" + str.tostring(209.4905, "0.000") + "|" + str.tostring(209.9765, format.mintick) + "|" + str.tostring(2.5, "0") + "|" + str.tostring(4166.876, "#.###") + "|" + str.tostring(1.2, "0.000"))
plot(close)
`);
    const label = (r.visuals.drawings as { kind: string; text?: string }[]).find((x) => x.kind === 'label');
    expect(label?.text).toBe('209.533|209.491|209.976|3|4166.876|1.200');
  });
});
