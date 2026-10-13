// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
// Modified by QuantPad (2026): feeds QuantPad OHLCV into the upstream
// Pine engine via its market-data provider interface.
// Modified by jam2205 (2026): higher-timeframe bars are cut on the symbol's
// session when it declares one (session.ts); monthly bars are built at all;
// symbols other than the chart's are served from bars the parent supplies.
import { toPineCandles } from './normalize';
import { resampleBySession, resampleOhlcvBars } from './resample';
import { sessionSpec, tfMs as sessionTfMs } from './session';
import { type OhlcvBar, type PineCandle, type PineSymbolInfo } from './types';

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Duration of a Pine-format timeframe string ("5" = 5 minutes, "30S", "60",
 * "D", "2W"...), or null for calendar-based / unparseable timeframes ("M")
 * that fixed-width buckets can't represent.
 */
export function pineTimeframeStringToMs(timeframe: string | undefined): number | null {
  if (!timeframe) return null;
  const match = timeframe
    .trim()
    .toUpperCase()
    .match(/^(\d*)(S|D|W|M)?$/);
  if (!match) return null;
  const [, digits, unit] = match;
  const count = digits ? Number(digits) : 1;
  if (!Number.isFinite(count) || count <= 0) return null;
  switch (unit) {
    case 'S':
      return count * SECOND_MS;
    case 'D':
      return count * DAY_MS;
    case 'W':
      return count * 7 * DAY_MS;
    case 'M':
      return null; // calendar months are not fixed-width
    default:
      return digits ? count * MINUTE_MS : null;
  }
}

export interface ExtraSeries {
  /** The symbol as the script asks for it, e.g. "TVC:US02Y"; matched without its exchange prefix. */
  ticker: string;
  bars: OhlcvBar[];
  barMs: number;
}

/** One symbol's bars, served at whatever timeframe the engine asks for. */
function createSeries(params: { bars: OhlcvBar[]; barMs: number; info: PineSymbolInfo; openUntil?: number }) {
  const candles: PineCandle[] = toPineCandles(params.bars, params.barMs);
  // A series carried forward stays open to the end of the chart, however far that is.
  const tail = candles[candles.length - 1];
  if (tail && params.openUntil != null) tail.closeTime = Math.max(tail.closeTime, params.openUntil + 1);
  // request.security() spins up a secondary context that re-queries the
  // provider at the script-requested timeframe. Resampled series are cached
  // since a script's security calls repeat the same timeframe every run.
  const resampleCache = new Map<number, PineCandle[]>();
  const session = sessionSpec(params.info);
  const sessionCache = new Map<string, PineCandle[] | null>();

  return (timeframe?: string, sDate?: number, eDate?: number): PineCandle[] => {
    const tfMs = pineTimeframeStringToMs(timeframe);
    let series = candles;
    // A symbol with a session gets its coarser bars cut on that session: days
    // from the session start, weeks from the week's first session, months,
    // and intraday bars counted from the session start. Same +1ms parity
    // nudge as below, for the same reason.
    const wantMs = session ? sessionTfMs(timeframe) : null;
    if (session && timeframe && wantMs != null && wantMs > params.barMs) {
      const key = timeframe.trim().toUpperCase();
      let cut = sessionCache.get(key);
      if (cut === undefined) {
        const bars = resampleBySession(params.bars, key, session);
        cut = bars
          ? toPineCandles(bars, wantMs).map((candle) => ({ ...candle, closeTime: candle.closeTime + 1 }))
          : null;
        // The last bar is still open: it must reach past the last chart bar
        // however long the period is (a 31-day month, a week with a holiday).
        const lastChart = candles[candles.length - 1];
        const lastCut = cut?.[cut.length - 1];
        if (lastChart && lastCut) lastCut.closeTime = Math.max(lastCut.closeTime, lastChart.closeTime + 1);
        sessionCache.set(key, cut);
      }
      if (cut) series = cut;
    } else if (tfMs != null && tfMs !== params.barMs && tfMs % params.barMs === 0) {
      // Coarser multiples of the chart timeframe are aggregated from the held
      // bars (e.g. "5"-minute security data on a 1m chart). Finer or
      // non-multiple requests fall back to the chart bars — we can't
      // synthesize data below the granularity we fetched.
      let resampled = resampleCache.get(tfMs);
      if (!resampled) {
        // TV parity nudge: the Pine runtime maps a chart bar to HTF bucket `s` when
        // `chartClose >= bucketClose[s]`, which hands the completed bucket
        // to the LAST chart bar inside it (e.g. the 09:49 1m bar sees the
        // final 09:45 5m values — one bar of lookahead). TradingView only
        // exposes the bucket from the FIRST chart bar of the next bucket,
        // which is what `ta.change(request.security(..., time))` boundary
        // detection relies on. +1ms on closeTime defeats the >= comparison
        // for exactly that last constituent bar and nothing else.
        resampled = toPineCandles(resampleOhlcvBars(params.bars, tfMs), tfMs).map((candle) => ({
          ...candle,
          closeTime: candle.closeTime + 1,
        }));
        resampleCache.set(tfMs, resampled);
      }
      series = resampled;
    }
    if (sDate != null || eDate != null) {
      series = series.filter(
        (candle) =>
          (sDate == null || candle.openTime >= sDate) &&
          (eDate == null || candle.openTime <= eDate),
      );
    }
    return series;
  };
}

/** "OANDA:usdcad" and "USDCAD" are the same symbol; so is an empty ticker (the chart's own). */
const bare = (ticker: string | undefined | null) =>
  String(ticker ?? '').trim().toUpperCase().replace(/^[^:]*:/, '');

/**
 * In-memory candle provider backing the engine. Symbol metadata is passed in
 * (resolved parent-side and shipped in the request) so the runner never needs
 * the symbol-spec table.
 *
 * Modified by jam2205 (2026): the requested ticker is no longer ignored. The
 * chart's own symbol gets the chart's bars; a symbol in `extraSeries` gets
 * those; anything else gets NO bars, so the script sees na, where it used to
 * be handed the chart's bars under the other symbol's name. Every other symbol
 * asked for is listed by `requestedSymbols()`.
 */
export function createQuantPadPineProvider(params: {
  symbol: string;
  bars: OhlcvBar[];
  barMs: number;
  symbolInfo: PineSymbolInfo;
  extraSeries?: ExtraSeries[];
}) {
  const info = params.symbolInfo;
  const chart = createSeries({ bars: params.bars, barMs: params.barMs, info });
  const own = new Set([bare(params.symbol), bare(info?.ticker), bare(info?.tickerid), ''].filter((v) => v !== undefined));
  const extras = new Map<string, ReturnType<typeof createSeries>>();
  const chartEnd = params.bars.length ? params.bars[params.bars.length - 1]!.t + params.barMs : 0;
  for (const supplied of params.extraSeries ?? []) {
    // A supplied series that stops before the chart does (a daily table last
    // refreshed on Friday, a chart running into Tuesday) carries its last close
    // forward in one flat bar. Without it the chart's later bars fall outside
    // every bar of the series and read na; with it `close` is the last close
    // held and `close[1]` under lookahead is that same completed close, which
    // is what a script asking for "the last completed daily close" means.
    let extra = supplied;
    const lastBar = supplied.bars[supplied.bars.length - 1];
    if (lastBar && lastBar.t + supplied.barMs < chartEnd) {
      const c = lastBar.c;
      extra = { ...supplied, bars: [...supplied.bars, { t: lastBar.t + supplied.barMs, o: c, h: c, l: c, c, v: 0 }] };
    }
    // No session for a supplied series: its bars are used as dated.
    // The engine drops the exchange prefix before it asks ("TVC:US02Y" arrives as "US02Y").
    extras.set(bare(extra.ticker), createSeries({ bars: extra.bars, barMs: extra.barMs, info: { ...info, session: '' } as PineSymbolInfo, openUntil: chartEnd }));
  }
  const requested = new Map<string, boolean>();

  return {
    async getMarketData(
      tickerId?: string,
      timeframe?: string,
      _limit?: number,
      sDate?: number,
      eDate?: number,
    ) {
      if (own.has(bare(tickerId))) return chart(timeframe, sDate, eDate);
      const key = bare(tickerId);
      const series = extras.get(key);
      if (!requested.has(key)) requested.set(key, Boolean(series));
      return series ? series(timeframe, sDate, eDate) : [];
    },
    async getSymbolInfo() {
      return info;
    },
    configure() {
      // The in-memory provider has no runtime configuration.
    },
    /** Symbols other than the chart's that the engine asked for, and whether bars were supplied. */
    requestedSymbols(): { ticker: string; supplied: boolean }[] {
      return [...requested.entries()].map(([ticker, supplied]) => ({ ticker, supplied }));
    },
  };
}
