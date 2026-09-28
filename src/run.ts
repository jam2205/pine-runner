// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
import { loadPineEngine } from './engine';
import { normalizePineVisuals, rebaseDrawingsToTime, trimVisualsToWindow } from './normalize';
import { type RunRequest, type RunResult, type ScanRequest, type ScanResult } from './protocol';
import { createQuantPadPineProvider } from './provider';
import {
  patchPineRuntimeClassCompat,
  patchPineRuntimeCompat,
  pineMarginCompat,
} from './runtime-compat';
import { applyPineOverrides, resolvePineSettings } from './settings';
import { type OhlcvBar } from './types';

/** Fields the parent's backtest normalizer reads off a raw engine trade. */
const TRADE_FIELDS = [
  'id',
  'entry_id',
  'entry_comment',
  'entry_price',
  'entry_time',
  'entry_bar_index',
  'exit_id',
  'exit_comment',
  'exit_price',
  'exit_time',
  'exit_bar_index',
  'size',
  'profit',
  'commission',
  'max_drawdown',
  'max_runup',
  'status',
] as const;

/** Scalar strategy fields the parent's backtest normalizer reads. */
const STRATEGY_SCALARS = [
  'account_currency',
  'initial_capital',
  'equity',
  'netprofit',
  'grossprofit',
  'grossloss',
  'openprofit',
  'max_drawdown',
  'max_runup',
  'wintrades',
  'losstrades',
  'eventrades',
  'sharpe_ratio',
  'sortino_ratio',
  'buy_and_hold_pnl',
  'strategy_outperformance',
] as const;

function plainTrade(trade: unknown): Record<string, unknown> {
  const src = (trade ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of TRADE_FIELDS) out[field] = src[field];
  return out;
}

/**
 * Reduce the engine's live strategy object to a plain, bounded, serializable
 * snapshot containing only what the parent's `normalizeStrategyBacktest` reads
 * (scalars + config subset + closed/open trade rows). Avoids shipping engine
 * internals (functions, circular refs, per-bar series) across the boundary.
 */
function extractStrategyState(strategy: unknown): Record<string, unknown> | null {
  if (!strategy || typeof strategy !== 'object') return null;
  const s = strategy as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of STRATEGY_SCALARS) out[field] = s[field];

  const config = (s.config ?? {}) as Record<string, unknown>;
  out.config = { title: config.title, currency: config.currency };

  out.closedtrades = Array.isArray(s.closedtrades) ? s.closedtrades.map(plainTrade) : [];
  out.opentrades = Array.isArray(s.opentrades) ? s.opentrades.map(plainTrade) : [];
  return out;
}

/** Execute a Pine script over `bars` and return normalized visuals + state. */
export async function runPine(req: RunRequest, bars: OhlcvBar[]): Promise<RunResult> {
  const { PineEngine, PineIndicator } = loadPineEngine();
  patchPineRuntimeClassCompat(PineEngine);

  const indicator = new PineIndicator(req.source);
  const inputsMeta = indicator.getInputsMeta();
  const declarationType = indicator.getDeclarationType();
  const stale = applyPineOverrides(indicator, req.overrides);

  const provider = createQuantPadPineProvider({
    symbol: req.symbol,
    bars,
    barMs: req.barMs,
    symbolInfo: req.symbolInfo,
  });
  const engine = new PineEngine(provider, req.symbol, req.timeframe, bars.length);
  patchPineRuntimeCompat(engine, {
    marginDefaults: pineMarginCompat(req.source, req.overrides.props),
  });

  const context = await engine.run(indicator);
  const appliedInputs = indicator.getRuntimeInputs();
  const appliedProps = indicator.getRuntimePropOverrides();

  let visuals = normalizePineVisuals(context?.plots, bars);
  if (req.windowed && req.displayStartMs != null) {
    visuals = trimVisualsToWindow(
      {
        ...visuals,
        drawings: rebaseDrawingsToTime(visuals.drawings, bars, req.barMs),
      },
      req.displayStartMs,
    );
  }

  return {
    visuals,
    strategyState: extractStrategyState(context?.strategy),
    appliedInputs,
    appliedProps,
    stale,
    declarationType,
    inputsMeta,
  };
}

/** Resolve the input/prop schema for a script (settings dialog). */
export function scanPine(req: ScanRequest): ScanResult {
  return resolvePineSettings(req.source, req.overrides);
}
