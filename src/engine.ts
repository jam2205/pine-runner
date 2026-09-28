// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
// Modified by QuantPad (2026): integrates the upstream Pine engine behind a
// neutral loader seam so the rest of the tree never names the package directly.
/**
 * The ONLY module in the tree that references the upstream engine package.
 * Everything else uses the neutral `PineEngine` / `PineIndicator` names.
 *
 * The engine is a third-party AGPL-3.0 dependency. This runner package is the
 * process-isolated, publishable boundary for it: the parent (proprietary)
 * process never imports it — it only spawns this runner and talks JSON.
 */
import * as EngineModule from 'pinets';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EngineClass = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IndicatorClass = any;

export interface PineEngineModule {
  /** The transpiler/runtime engine class. */
  PineEngine: EngineClass;
  /** The script-introspection class (inputs/props/declaration metadata). */
  PineIndicator: IndicatorClass;
}

export function loadPineEngine(): PineEngineModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = EngineModule as any;
  return { PineEngine: mod.PineTS, PineIndicator: mod.Indicator };
}
