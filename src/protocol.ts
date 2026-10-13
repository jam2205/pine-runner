// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
/**
 * Arm's-length JSON protocol between the parent (proprietary) process and the
 * AGPL child runner. The parent writes a request file (and a separate bars
 * file for the large OHLCV payload); the child writes a single response
 * envelope to stdout, sentinel-encoded (see codec.ts).
 */
import { type NormalizedPineVisuals } from './normalize';
import {
  type IPineInput,
  type PineDeclarationType,
  type PineSettingsOverrides,
  type PineStaleKeys,
  type PineSymbolInfo,
  type ResolvedPineSettings,
} from './types';

export interface RunRequest {
  op: 'run';
  source: string;
  symbol: string;
  /** Normalized (Pine-format) chart timeframe, e.g. "1", "15", "60". */
  timeframe: string;
  /** Millisecond duration of one chart bar (bucketMs). */
  barMs: number;
  symbolInfo: PineSymbolInfo;
  overrides: Required<PineSettingsOverrides>;
  /** Path to the bars file: JSON array of compact rows [t,o,h,l,c,v]. */
  barsFile: string;
  /** Display-window start (candles[0].t); trims visuals when `windowed`. */
  displayStartMs: number | null;
  /** True when the run window is wider than the display window. */
  windowed: boolean;
  /**
   * Modified by jam2205 (2026). Bars for symbols OTHER than the chart's, for
   * `request.security("TVC:US02Y", ...)`. `ticker` is what the script asks for;
   * the match ignores case. A symbol the script asks for that is neither the
   * chart's nor listed here gets no data (na), and is reported back in
   * `requestedSymbols` so the parent can supply it and run again.
   */
  extraSeries?: ExtraSeriesRef[];
  /**
   * Modified by jam2205 (2026). Daily bars for the chart's OWN symbol, reaching
   * further back than the chart's bars: a JSON array of compact rows, bar open
   * times. Used for daily, weekly and monthly requests on an intraday run, so
   * they have the history a chart has. Needs `symbolInfo.session`.
   */
  dailyHistoryFile?: string;
}

export interface ExtraSeriesRef {
  ticker: string;
  /** Millisecond duration of one bar of this series (86_400_000 for daily). */
  barMs: number;
  /** Path to a JSON array of compact rows [t,o,h,l,c,v]. */
  barsFile: string;
}

export interface RequestedSymbol {
  /** Without its exchange prefix, upper case: the engine drops the prefix before asking. */
  ticker: string;
  /** True when bars were supplied for it in `extraSeries`. */
  supplied: boolean;
}

export interface ScanRequest {
  op: 'scan';
  source: string;
  overrides: Required<PineSettingsOverrides>;
}

export type PineRunnerRequest = RunRequest | ScanRequest;

export interface RunResult {
  visuals: NormalizedPineVisuals;
  /** Raw strategy state (plain, bounded) for parent-side stats; null for indicators. */
  strategyState: Record<string, unknown> | null;
  appliedInputs: Record<string, unknown>;
  appliedProps: Record<string, unknown>;
  stale: PineStaleKeys;
  declarationType: PineDeclarationType;
  inputsMeta: IPineInput[];
  /** Symbols other than the chart's that the script requested, in first-asked order. */
  requestedSymbols: RequestedSymbol[];
}

export type ScanResult = ResolvedPineSettings;

export type PineRunnerResponse =
  | { ok: true; result: RunResult | ScanResult }
  | { ok: false; error: { message: string; status: number } };

export type CompactBarRow = [number, number, number, number, number, number];
