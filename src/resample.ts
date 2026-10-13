// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
// Modified by jam2205 (2026): resampleBySession, bars cut on the symbol's session.
import { sessionBarStart, tradingDay, type SessionSpec } from './session';
import { type OhlcvBar } from './types';

function bucketStart(t: number, bucketMs: number): number {
  return Math.floor(t / bucketMs) * bucketMs;
}

/**
 * Aggregate OHLCV bars into fixed-width `bucketMs` buckets (open of first,
 * high/low extremes, close of last, summed volume). A private copy of the
 * host's `resampleOhlcvBars` so the runner has no dependency on `lib/`.
 */
export function resampleOhlcvBars(bars: OhlcvBar[], bucketMs: number): OhlcvBar[] {
  if (bars.length === 0) return [];

  const sorted = [...bars]
    .filter(
      (bar) =>
        Number.isFinite(bar.t) &&
        Number.isFinite(bar.o) &&
        Number.isFinite(bar.h) &&
        Number.isFinite(bar.l) &&
        Number.isFinite(bar.c) &&
        Number.isFinite(bar.v),
    )
    .sort((a, b) => a.t - b.t);

  const out: OhlcvBar[] = [];
  for (const bar of sorted) {
    const t = bucketStart(bar.t, bucketMs);
    const prev = out[out.length - 1];
    if (!prev || prev.t !== t) {
      out.push({ t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
      continue;
    }
    prev.h = Math.max(prev.h, bar.h);
    prev.l = Math.min(prev.l, bar.l);
    prev.c = bar.c;
    prev.v += bar.v;
  }

  return out;
}

/**
 * The same aggregation, cut on the symbol's session (see session.ts) instead of
 * fixed-width blocks: a daily bar runs from one session start to the next, a
 * week from the first session of the week, a month from its first. A bar is
 * stamped with the earlier of its nominal start and its first constituent, so
 * a feed that opens before the session start on Sunday keeps that open.
 * Returns null when `timeframe` cannot be parsed.
 */
export function resampleBySession(
  bars: OhlcvBar[],
  timeframe: string,
  spec: SessionSpec,
): OhlcvBar[] | null {
  const out: OhlcvBar[] = [];
  let key: number | null = null;
  const sorted = [...bars]
    .filter((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);
  for (const bar of sorted) {
    const start = sessionBarStart(bar.t, timeframe, spec);
    if (start === null) return null;
    const prev = out[out.length - 1];
    if (!prev || key !== start) {
      key = start;
      out.push({ t: Math.min(start, bar.t), o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
      continue;
    }
    prev.h = Math.max(prev.h, bar.h);
    prev.l = Math.min(prev.l, bar.l);
    prev.c = bar.c;
    prev.v += bar.v;
  }
  return out;
}

/**
 * Modified by jam2205 (2026). One daily series from two sources: `history`,
 * daily bars supplied by the parent (years of them), and `derived`, daily bars
 * cut from the chart's own intraday bars (the last days or weeks, live).
 *
 * Why: a script that asks for daily, weekly or monthly values gets them from
 * the bars the run holds, and an intraday run holds days, not years. A 20-day
 * average range, last month's high or a gap opened two years ago cannot come
 * out of 500 fifteen-minute bars, where the chart, which has the whole daily
 * history behind it, shows all three.
 *
 * Days are matched by trading day. A day only one source has is taken as is.
 * A day both have is the supplied bar's open, the wider high and low, and the
 * derived bar's close and time -- the supplied bar may have been saved while
 * that day was still trading, and the intraday bars are the newer reading.
 */
export function mergeDaily(history: OhlcvBar[], derived: OhlcvBar[], spec: SessionSpec): OhlcvBar[] {
  const byDay = new Map<number, OhlcvBar>();
  for (const bar of history) {
    if (![bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite)) continue;
    byDay.set(tradingDay(bar.t, spec), { ...bar });
  }
  for (const bar of derived) {
    const day = tradingDay(bar.t, spec);
    const old = byDay.get(day);
    byDay.set(
      day,
      old
        ? { t: Math.min(old.t, bar.t), o: old.o, h: Math.max(old.h, bar.h), l: Math.min(old.l, bar.l), c: bar.c, v: bar.v }
        : { ...bar },
    );
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, bar]) => bar);
}
