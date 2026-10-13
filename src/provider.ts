// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
// Modified by QuantPad (2026): feeds QuantPad OHLCV into the upstream
// Pine engine via its market-data provider interface.
// Modified by jam2205 (2026): higher-timeframe bars are cut on the symbol's
// session when it declares one (session.ts); monthly bars are built at all.
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

/**
 * In-memory candle provider backing the engine. Symbol metadata is passed in
 * (resolved parent-side and shipped in the request) so the runner never needs
 * the symbol-spec table.
 */
export function createQuantPadPineProvider(params: {
  symbol: string;
  bars: OhlcvBar[];
  barMs: number;
  symbolInfo: PineSymbolInfo;
}) {
  const candles: PineCandle[] = toPineCandles(params.bars, params.barMs);
  const info = params.symbolInfo;
  // request.security() spins up a secondary context that re-queries the
  // provider at the script-requested timeframe. Resampled series are cached
  // since a script's security calls repeat the same timeframe every run.
  const resampleCache = new Map<number, PineCandle[]>();
  const session = sessionSpec(info);
  const sessionCache = new Map<string, PineCandle[] | null>();

  return {
    async getMarketData(
      _tickerId?: string,
      timeframe?: string,
      _limit?: number,
      sDate?: number,
      eDate?: number,
    ) {
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
      } else
      // Coarser multiples of the chart timeframe are aggregated from the held
      // bars (e.g. "5"-minute security data on a 1m chart). Finer or
      // non-multiple requests fall back to the chart bars — we can't
      // synthesize data below the granularity we fetched.
      if (tfMs != null && tfMs !== params.barMs && tfMs % params.barMs === 0) {
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
    },
    async getSymbolInfo() {
      return info;
    },
    configure() {
      // The in-memory provider has no runtime configuration.
    },
  };
}
