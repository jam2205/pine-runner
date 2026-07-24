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
}

export type ScanResult = ResolvedPineSettings;

export type PineRunnerResponse =
  | { ok: true; result: RunResult | ScanResult }
  | { ok: false; error: { message: string; status: number } };

export type CompactBarRow = [number, number, number, number, number, number];
