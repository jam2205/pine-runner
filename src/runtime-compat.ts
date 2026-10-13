// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
// Modified by QuantPad (2026): patches upstream Pine engine internals for
// TradingView-parity behavior.
/**
 * TradingView-parity shims for Pine runtime divergences.
 *
 * Two known gaps are patched here:
 *
 * 1. Margin defaults — TradingView's Pine v5 (and earlier) defaults
 *    `margin_long`/`margin_short` to 0, meaning strategies never check
 *    available funds before filling entries. Pine v6 changed the default to
 *    100. The runtime hardcodes the v6 default (100) for every script and —
 *    unlike TV's broker emulator, which reduces the order size — silently
 *    CANCELS any entry whose notional margin exceeds equity. For v5 scripts
 *    that don't declare margins this cancels essentially every futures trade
 *    (e.g. 3 MNQ contracts ≈ $190k notional vs $100k default equity), so we
 *    restore the v5 default of 0.
 *
 * 2. Drawing caps for strategies — the runtime's drawing garbage collector
 *    reads `max_boxes_count`/`max_lines_count`/`max_labels_count`/
 *    `max_polylines_count` from `context.indicator`, which is only populated
 *    by `indicator()` declarations. `strategy(max_boxes_count=500)` lands in
 *    `context.strategy.config` and is never seen by the GC, so strategy
 *    scripts are always trimmed to the default 50 objects per type. We bridge
 *    `context.indicator` to fall back to the strategy config.
 *
 * 3. `time` inside request.security() expressions — the runtime's security
 *    argument recorder unwraps Series values per bar, but the dual-use `time`
 *    identifier resolves to a TimeHelper object which is stored AS-IS. Every
 *    bar then sees the same opaque object instead of that bar's timestamp, so
 *    `request.security(sym, tf, [high, low, volume, time])` returns a `time`
 *    element that breaks `ta.change()` / comparisons and silently disables
 *    any aggregation logic built on it. We patch context creation at the
 *    engine class level (secondary contexts are constructed internally) to
 *    unwrap helper objects to their current bar value at record time.
 */

import { sessionBarStart, sessionSpec, tradingDay, type SessionSpec } from './session';

const DECLARATION_RE = /^[ \t]*(strategy|indicator)[ \t]*\(/m;

export interface PineDeclarationScan {
  /** `//@version=N` directive; TradingView treats a missing directive as v1. */
  version: number;
  /** 'strategy' | 'indicator' | null when no declaration call was found. */
  declarationType: 'strategy' | 'indicator' | null;
  /** Full text inside the declaration call's parentheses. */
  declarationArgs: string;
}

/**
 * Extract the text between the declaration call's balanced parentheses,
 * skipping over string literals so titles like "My (great) strategy" don't
 * break the depth count.
 */
function extractCallArgs(source: string, openParenIdx: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParenIdx; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIdx + 1, i);
    }
  }
  return source.slice(openParenIdx + 1);
}

export function scanPineDeclaration(source: string): PineDeclarationScan {
  const versionMatch = source.match(/\/\/@version[ \t]*=[ \t]*(\d+)/);
  const version = versionMatch ? Number(versionMatch[1]) : 1;

  const decl = DECLARATION_RE.exec(source);
  if (!decl) return { version, declarationType: null, declarationArgs: '' };

  const openParenIdx = decl.index + decl[0].length - 1;
  return {
    version,
    declarationType: decl[1] as 'strategy' | 'indicator',
    declarationArgs: extractCallArgs(source, openParenIdx),
  };
}

/**
 * Margin values to force onto the strategy config for TV parity, keyed by
 * config field. Empty when nothing should be forced: non-strategy scripts,
 * Pine v6+, params declared in `strategy(...)`, or params the user overrode
 * through the settings dialog.
 */
export function pineMarginCompat(
  source: string,
  userProps: Record<string, unknown> = {},
): Partial<Record<'margin_long' | 'margin_short', number>> {
  const scan = scanPineDeclaration(source);
  if (scan.declarationType !== 'strategy' || scan.version >= 6) return {};

  const forced: Partial<Record<'margin_long' | 'margin_short', number>> = {};
  for (const key of ['margin_long', 'margin_short'] as const) {
    const declared = new RegExp(`\\b${key}[ \\t]*=`).test(scan.declarationArgs);
    if (!declared && !(key in userProps)) forced[key] = 0;
  }
  return forced;
}

/**
 * Patch an engine instance so every context it creates gets:
 *  - `context.indicator` falling back to `context.strategy.config`, which
 *    makes the drawing GC honor `strategy(max_*_count=...)` declarations;
 *  - forced margin defaults applied to the strategy config the moment the
 *    engine creates it (before any orders can be processed).
 *
 * Relies on the (unmangled) private `_initializeContext` method; if a future
 * engine build renames it, this becomes a no-op and behavior degrades to the
 * engine's stock semantics rather than breaking the run.
 */
export function patchPineRuntimeCompat(
  engine: unknown,
  options: { marginDefaults?: Partial<Record<'margin_long' | 'margin_short', number>> } = {},
): void {
  const instance = engine as { _initializeContext?: (...args: unknown[]) => unknown };
  const original = instance._initializeContext;
  if (typeof original !== 'function') return;

  const marginDefaults = options.marginDefaults ?? {};
  instance._initializeContext = function patched(this: unknown, ...args: unknown[]) {
    const context = original.apply(this, args);
    installContextBridges(context, marginDefaults);
    return context;
  };
}

const CLASS_PATCH_FLAG = Symbol.for('quantpad.pine.classCompat');

/**
 * Patch the engine class itself so EVERY context — including the secondary
 * contexts the engine constructs internally for request.security() — records
 * per-bar numeric values for dual-use time helpers instead of the helper
 * object. Idempotent; safe to call once per import.
 */
export function patchPineRuntimeClassCompat(engineClass: unknown): void {
  const proto = (engineClass as { prototype?: Record<string | symbol, unknown> })?.prototype;
  if (!proto || proto[CLASS_PATCH_FLAG]) return;
  const original = proto._initializeContext;
  if (typeof original !== 'function') return;

  proto[CLASS_PATCH_FLAG] = true;
  proto._initializeContext = function patched(this: unknown, ...args: unknown[]) {
    const context = (original as (...a: unknown[]) => unknown).apply(this, args);
    installParamsTimeUnwrap(context);
    installSessionCalendar(context);
    return context;
  };
}

/**
 * Modified by jam2205 (2026). Make the engine's calendar follow the symbol's
 * session (session.ts) in the three places a script asks "has a new day, week
 * or month started?":
 *
 *   timeframe.change(tf)   stock: the UTC calendar period changed
 *   time(tf)               stock: the UTC-aligned period start
 *   time_tradingday        stock: the calendar date of the bar's close
 *
 * Each falls back to the stock method when the symbol declares no session, the
 * call has a shape this does not handle (time() with a session or bars_back
 * argument), or anything it needs is missing. Installed on every context, the
 * secondary ones request.security() builds included.
 *
 * Relies on `context.pine.timeframe`, `.time` and `.syminfo` keeping those
 * names; __tests__/session-calendar.test.ts fails if a future engine build
 * moves them, so this cannot go quiet unnoticed.
 */
function installSessionCalendar(context: unknown): void {
  if (!context || typeof context !== 'object') return;
  const ctx = context as { pine?: Record<string, any>; data?: Record<string, unknown>; timeframe?: string };
  const pine = ctx.pine;
  if (!pine || typeof pine !== 'object') return;

  let cachedFor: unknown;
  let cached: SessionSpec | null = null;
  const spec = (): SessionSpec | null => {
    const info = pine.syminfo;
    if (info !== cachedFor) {
      cachedFor = info;
      cached = sessionSpec(info);
    }
    return cached;
  };
  const text = (v: unknown): string | null => {
    let x: any = typeof v === 'function' ? v() : v;
    if (x && typeof x === 'object' && typeof x.get === 'function') x = x.get(0);
    return typeof x === 'string' ? x : null;
  };
  const openTime = (back: number): number => {
    const helper = pine.time;
    const store = ctx.data?.openTime;
    if (!helper || typeof helper.param !== 'function' || store == null) return NaN;
    return Number(helper.param(store, back));
  };

  const tfHelper = pine.timeframe;
  if (tfHelper && typeof tfHelper.change === 'function') {
    const stock = tfHelper.change.bind(tfHelper);
    tfHelper.change = (timeframe: unknown) => {
      const s = spec();
      const tf = text(timeframe);
      const now = openTime(0);
      const before = openTime(1);
      if (!s || !tf || !Number.isFinite(now) || !Number.isFinite(before)) return stock(timeframe);
      const a = sessionBarStart(now, tf, s);
      const b = sessionBarStart(before, tf, s);
      return a === null || b === null ? stock(timeframe) : a !== b;
    };
  }

  const timeHelper = pine.time;
  if (timeHelper && typeof timeHelper.any === 'function') {
    const stock = timeHelper.any.bind(timeHelper);
    timeHelper.any = (...args: unknown[]) => {
      const s = spec();
      const tf = args.length === 1 ? text(args[0]) : null;
      const now = openTime(0);
      if (!s || !tf || !Number.isFinite(now) || sameTimeframe(tf, ctx.timeframe)) return stock(...args);
      return sessionBarStart(now, tf, s) ?? stock(...args);
    };
  }

  const stockDay = Object.getOwnPropertyDescriptor(pine, 'time_tradingday');
  if (stockDay?.configurable) {
    Object.defineProperty(pine, 'time_tradingday', {
      configurable: true,
      enumerable: stockDay.enumerable,
      get() {
        const s = spec();
        const now = openTime(0);
        if (!s || !Number.isFinite(now)) return stockDay.get ? stockDay.get.call(pine) : stockDay.value;
        return tradingDay(now, s) * 86_400_000;
      },
    });
  }
}

function sameTimeframe(a: string, b: string | undefined): boolean {
  const norm = (v: string | undefined) => String(v ?? '').trim().toUpperCase().replace(/^1([DWM])$/, '$1');
  return norm(a) === norm(b);
}

/**
 * Replace `context.params` with a proxy that unwraps time-helper objects
 * (duck-typed: `context` + `dataField`/`extractor` props with a `__value`
 * accessor) to their current bar value whenever the security-argument
 * recorder writes into a params array.
 */
function installParamsTimeUnwrap(context: unknown): void {
  if (!context || typeof context !== 'object') return;
  const ctx = context as { params?: Record<string, unknown> };
  const base = ctx.params && typeof ctx.params === 'object' ? ctx.params : {};
  ctx.params = new Proxy(base, {
    set(target, key, value) {
      (target as Record<string | symbol, unknown>)[key] = Array.isArray(value)
        ? wrapParamArray(value)
        : unwrapTimeValue(value);
      return true;
    },
  });
}

function wrapParamArray(arr: unknown[]): unknown[] {
  const seeded = arr.map(unwrapTimeValue);
  return new Proxy(seeded, {
    set(target, key, value) {
      (target as Record<string | symbol, unknown> & unknown[])[key as never] = unwrapTimeValue(
        value,
      ) as never;
      return true;
    },
  });
}

function unwrapTimeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unwrapTimeValue);
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (!('context' in v)) return value;
  if (!('dataField' in v) && !('extractor' in v)) return value;
  try {
    const inner = (v as { __value?: unknown }).__value;
    if (inner == null) return value;
    const series = inner as { get?: (i: number) => unknown };
    // TimeHelper.__value is the openTime store: either a Series (get(0) =
    // current bar) or a raw reverse-ordered array ([0] = current bar).
    // TimeComponentHelper.__value is already a number.
    if (typeof series.get === 'function') return series.get(0);
    if (Array.isArray(inner)) return inner[0];
    return inner;
  } catch {
    return value;
  }
}

function installContextBridges(
  context: unknown,
  marginDefaults: Partial<Record<'margin_long' | 'margin_short', number>>,
): void {
  if (!context || typeof context !== 'object') return;
  const ctx = context as Record<string, unknown>;

  // Drawing-cap bridge: `indicator()` declarations still win (the engine
  // assigns through the setter), strategies fall back to their config.
  let explicitIndicator = ctx.indicator;
  let strategyState = ctx.strategy as { config?: Record<string, unknown> } | undefined;
  Object.defineProperty(ctx, 'indicator', {
    configurable: true,
    enumerable: true,
    get() {
      return explicitIndicator ?? strategyState?.config;
    },
    set(value) {
      explicitIndicator = value;
    },
  });

  const applyMarginDefaults = (state: typeof strategyState) => {
    if (!state?.config) return;
    for (const [key, value] of Object.entries(marginDefaults)) {
      state.config[key] = value;
    }
  };
  applyMarginDefaults(strategyState);

  Object.defineProperty(ctx, 'strategy', {
    configurable: true,
    enumerable: true,
    get() {
      return strategyState;
    },
    set(value) {
      strategyState = value as typeof strategyState;
      applyMarginDefaults(strategyState);
    },
  });
}
