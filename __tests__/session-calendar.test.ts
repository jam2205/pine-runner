/**
 * Session-aware day / week / month boundaries (src/session.ts), through the
 * resampler and through the engine. Synthetic bars only.
 *
 * The engine tests are also the tripwire for the runtime patch in
 * runtime-compat.ts: it hooks names inside the engine, and if a future engine
 * build moves them the patch silently does nothing and these fail.
 */
import { describe, expect, it } from 'vitest';

import { loadPineEngine } from '../src/engine';
import { createQuantPadPineProvider } from '../src/provider';
import { resampleBySession } from '../src/resample';
import { patchPineRuntimeClassCompat } from '../src/runtime-compat';
import { sessionBarStart, sessionSpec, tradingDay } from '../src/session';
import type { OhlcvBar, PineSymbolInfo } from '../src/types';

const MIN = 60_000;
const NY = { session: '1700-1700', timezone: 'America/New_York' };
const utc = (s: string) => Date.parse(s + ':00Z');
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString().slice(0, 16));

describe('sessionSpec', () => {
  it('reads a plain session', () => {
    expect(sessionSpec(NY)).toEqual({ timezone: 'America/New_York', startMin: 1020 });
  });
  it("reads TradingView's per-day form by the start most days share", () => {
    expect(sessionSpec({ session: '1600F-1700:2|1700-1700:3456', timezone: 'America/New_York' })?.startMin).toBe(1020);
  });
  it('is null without a session, for midnight UTC, and for an unknown timezone', () => {
    expect(sessionSpec({ session: '', timezone: 'America/New_York' })).toBeNull();
    expect(sessionSpec({ session: '0000-0000', timezone: 'Etc/UTC' })).toBeNull();
    expect(sessionSpec({ session: '1700-1700', timezone: 'Mars/Olympus' })).toBeNull();
    expect(sessionSpec(undefined)).toBeNull();
  });
});

describe('sessionBarStart, 17:00 New York', () => {
  const s = sessionSpec(NY)!;
  it('starts the day at 17:00 New York, in summer and winter time', () => {
    expect(iso(sessionBarStart(utc('2026-10-12T20:45'), 'D', s))).toBe('2026-10-11T21:00'); // Mon 16:45 EDT
    expect(iso(sessionBarStart(utc('2026-10-12T21:00'), 'D', s))).toBe('2026-10-12T21:00'); // Mon 17:00 EDT
    expect(iso(sessionBarStart(utc('2026-01-12T21:30'), 'D', s))).toBe('2026-01-11T22:00'); // Mon 16:30 EST
    expect(iso(sessionBarStart(utc('2026-01-12T22:00'), '1D', s))).toBe('2026-01-12T22:00');
  });
  it("makes Sunday's evening open Monday, and folds an early Sunday open into it", () => {
    expect(new Date(tradingDay(utc('2026-10-11T21:00'), s) * 86_400_000).toISOString().slice(0, 10)).toBe('2026-10-12');
    expect(iso(sessionBarStart(utc('2026-10-11T20:00'), 'D', s))).toBe('2026-10-11T21:00'); // Sun 16:00 EDT, IG's open
  });
  it('starts the week at the Sunday open', () => {
    for (const t of ['2026-10-11T21:00', '2026-10-13T12:00', '2026-10-16T20:45']) {
      expect(iso(sessionBarStart(utc(t), 'W', s))).toBe('2026-10-11T21:00');
    }
    expect(iso(sessionBarStart(utc('2026-10-18T21:00'), 'W', s))).toBe('2026-10-18T21:00');
  });
  it("starts the month at its first weekday's session", () => {
    expect(iso(sessionBarStart(utc('2026-10-13T12:00'), 'M', s))).toBe('2026-09-30T21:00'); // 1 Oct is a Thursday
    expect(iso(sessionBarStart(utc('2026-09-30T20:45'), 'M', s))).toBe('2026-08-31T21:00'); // still September
    expect(iso(sessionBarStart(utc('2026-11-10T12:00'), 'M', s))).toBe('2026-11-01T22:00'); // 1 Nov is a Sunday; EST
  });
  it('counts intraday bars from the session start', () => {
    expect(iso(sessionBarStart(utc('2026-10-12T22:15'), '240', s))).toBe('2026-10-12T21:00');
    expect(iso(sessionBarStart(utc('2026-10-13T01:30'), '240', s))).toBe('2026-10-13T01:00');
    expect(iso(sessionBarStart(utc('2026-10-13T01:30'), '60', s))).toBe('2026-10-13T01:00');
  });
  it('returns null for a timeframe it cannot parse', () => {
    expect(sessionBarStart(0, 'bogus', s)).toBeNull();
  });
});

// 15-minute bars from Wed 7 Oct 2026 21:00 UTC to Tue 13 Oct 01:00 UTC, none
// from Friday 21:00 to Sunday 21:00 (New York is on summer time: 17:00 = 21:00 UTC).
// Each bar's prices are a function of its index, so every level is distinct.
function fxBars(): OhlcvBar[] {
  const bars: OhlcvBar[] = [];
  const start = utc('2026-10-07T21:00');
  const end = utc('2026-10-13T01:00');
  let i = 0;
  for (let t = start; t < end; t += 15 * MIN) {
    if (t >= utc('2026-10-09T21:00') && t < utc('2026-10-11T21:00')) continue;
    const base = 1.4 + Math.sin(i / 17) * 0.004 + i * 0.00001;
    bars.push({ t, o: base, h: base + 0.0003 + (i % 5) * 0.00002, l: base - 0.0003 - (i % 3) * 0.00002, c: base + 0.0001, v: 1 });
    i++;
  }
  return bars;
}

const within = (bars: OhlcvBar[], from: string, to: string) => bars.filter((b) => b.t >= utc(from) && b.t < utc(to));

describe('a day that starts early (IG: Monday opens 16:00 New York on Sunday)', () => {
  const ig = sessionSpec({ session: '1600F-1700:2|1700-1700:3456', timezone: 'America/New_York' })!;
  it('keeps the common start and records the early one', () => {
    expect(ig).toEqual({ timezone: 'America/New_York', startMin: 1020, startByDay: { 1: 960 } });
  });
  it("counts Monday's bars from Sunday 16:00 and the other days' from 17:00, as the chart does", () => {
    // TradingView's own 4-hour bars on IG:GBPJPY, Mon 12 Oct 2026: 20:00 (Sun), 00:00, 04:00 ... 16:00, a
    // one-hour bar at 20:00, then Tuesday's from 21:00.
    expect(iso(sessionBarStart(utc('2026-10-11T20:15'), '240', ig))).toBe('2026-10-11T20:00');
    expect(iso(sessionBarStart(utc('2026-10-12T03:45'), '240', ig))).toBe('2026-10-12T00:00');
    expect(iso(sessionBarStart(utc('2026-10-12T20:30'), '240', ig))).toBe('2026-10-12T20:00');
    expect(iso(sessionBarStart(utc('2026-10-12T21:00'), '240', ig))).toBe('2026-10-12T21:00');
    expect(iso(sessionBarStart(utc('2026-10-13T02:00'), '240', ig))).toBe('2026-10-13T01:00');
    expect(iso(sessionBarStart(utc('2026-10-12T12:00'), 'D', ig))).toBe('2026-10-11T20:00');
    expect(iso(sessionBarStart(utc('2026-10-13T12:00'), 'W', ig))).toBe('2026-10-11T20:00');
  });
  it("stamps months as the chart's monthly bars are stamped", () => {
    // TradingView's monthly bars on IG:GBPJPY: 30 Sep 21:00, 2 Aug 20:00 (1 Aug is a Saturday), 31 May 20:00, 1 Mar 21:00 UTC.
    expect(iso(sessionBarStart(utc('2026-10-13T12:00'), 'M', ig))).toBe('2026-09-30T21:00');
    expect(iso(sessionBarStart(utc('2026-08-20T12:00'), 'M', ig))).toBe('2026-08-02T20:00');
    expect(iso(sessionBarStart(utc('2026-06-10T12:00'), 'M', ig))).toBe('2026-05-31T20:00');
    expect(iso(sessionBarStart(utc('2026-03-10T12:00'), 'M', ig))).toBe('2026-03-01T21:00');
  });
});

describe('resampleBySession', () => {
  const s = sessionSpec(NY)!;
  const bars = fxBars();
  it('cuts daily bars at 21:00 UTC and one weekly bar from the Sunday open', () => {
    const daily = resampleBySession(bars, 'D', s)!;
    expect(daily.map((b) => iso(b.t))).toEqual([
      '2026-10-07T21:00', '2026-10-08T21:00', '2026-10-11T21:00', '2026-10-12T21:00',
    ]);
    const monday = within(bars, '2026-10-11T21:00', '2026-10-12T21:00');
    expect(daily[2]).toMatchObject({
      o: monday[0]!.o,
      c: monday[monday.length - 1]!.c,
      h: Math.max(...monday.map((b) => b.h)),
      l: Math.min(...monday.map((b) => b.l)),
    });
    expect(resampleBySession(bars, 'W', s)!.map((b) => iso(b.t))).toEqual(['2026-10-04T21:00', '2026-10-11T21:00']);
    expect(resampleBySession(bars, 'M', s)!.map((b) => iso(b.t))).toEqual(['2026-09-30T21:00']);
  });
  it("keeps an early Sunday open as Monday's open", () => {
    const early = [{ t: utc('2026-10-11T20:00'), o: 1.5, h: 1.5, l: 1.5, c: 1.5, v: 1 }, ...bars];
    const daily = resampleBySession(early, 'D', s)!;
    expect(iso(daily[2]!.t)).toBe('2026-10-11T20:00');
    expect(daily[2]!.o).toBe(1.5);
  });
});

const LEVELS = `//@version=6
indicator("levels", overlay = true)
var float dO = na
var float pC = na
if timeframe.change("D")
    pC := close[1]
    dO := open
[sC, sH] = request.security(syminfo.tickerid, "D", [close[1], high[1]], lookahead = barmerge.lookahead_on)
wk = request.security(syminfo.tickerid, "W", time, lookahead = barmerge.lookahead_on)
plot(pC, "pdc_change")
plot(dO, "do_change")
plot(sC, "pdc_security")
plot(sH, "pdh_security")
plot(time("D"), "day_time")
plot(time_tradingday, "trading_day")
plot(wk, "week_time")
`;

async function lastValues(symbolInfo: Record<string, unknown>): Promise<Record<string, number>> {
  const { PineEngine, PineIndicator } = loadPineEngine();
  patchPineRuntimeClassCompat(PineEngine);
  const bars = fxBars();
  const info = { tickerid: 'USDCAD', ticker: 'USDCAD', type: 'forex', mintick: 0.00001, pricescale: 100000, currency: 'CAD', ...symbolInfo } as unknown as PineSymbolInfo;
  const provider = createQuantPadPineProvider({ symbol: 'USDCAD', bars, barMs: 15 * MIN, symbolInfo: info });
  const context = await new PineEngine(provider, 'USDCAD', '15', bars.length).run(new PineIndicator(LEVELS));
  const out: Record<string, number> = {};
  for (const [name, plot] of Object.entries(context.plots as Record<string, { data: { value: number }[] }>)) {
    out[name] = plot.data[plot.data.length - 1]!.value;
  }
  return out;
}

describe('the engine, on a symbol with a 17:00 New York session', () => {
  const bars = fxBars();
  const monday = within(bars, '2026-10-11T21:00', '2026-10-12T21:00');
  const tuesday = within(bars, '2026-10-12T21:00', '2026-10-14T00:00');

  it('rolls the day at 17:00 New York in timeframe.change, request.security, time() and time_tradingday', async () => {
    const v = await lastValues(NY);
    const pdc = monday[monday.length - 1]!.c;
    expect(v.pdc_change).toBeCloseTo(pdc, 10);
    expect(v.do_change).toBeCloseTo(tuesday[0]!.o, 10);
    expect(v.pdc_security).toBeCloseTo(pdc, 10);
    expect(v.pdh_security).toBeCloseTo(Math.max(...monday.map((b) => b.h)), 10);
    expect(iso(v.day_time!)).toBe('2026-10-12T21:00');
    expect(iso(v.trading_day!)).toBe('2026-10-13T00:00');
    expect(iso(v.week_time!)).toBe('2026-10-11T21:00');
  });

  it('leaves a symbol with no session on the stock UTC calendar', async () => {
    const v = await lastValues({ timezone: 'Etc/UTC' });
    const utcMonday = within(bars, '2026-10-12T00:00', '2026-10-13T00:00');
    expect(v.pdc_change).toBeCloseTo(utcMonday[utcMonday.length - 1]!.c, 10);
    expect(iso(v.day_time!)).toBe('2026-10-13T00:00');
  });
});
