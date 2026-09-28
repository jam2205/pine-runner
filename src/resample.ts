// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
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
