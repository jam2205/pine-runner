// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
// Modified by QuantPad (2026): wraps the upstream engine's input/prop
// introspection and applies saved overrides.
import { loadPineEngine } from './engine';
import {
  type IPineInput,
  type PineSettingsOverrides,
  type PineSettingsSchema,
  type PineStaleKeys,
  type ResolvedPineSettings,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Indicator = any;

/**
 * A loose equality that treats numeric strings and numbers as equal (Pine
 * input defaults sometimes arrive as strings, e.g. source="close").
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-9;
  }
  return String(a) === String(b);
}

function inputMetaFor(schema: PineSettingsSchema, key: string): IPineInput | undefined {
  return (
    schema.inputs.find((meta) => meta.varId === key) ??
    schema.inputs.find((meta) => meta.title === key)
  );
}

function newIndicator(source: string): Indicator {
  const { PineIndicator } = loadPineEngine();
  return new PineIndicator(source);
}

/**
 * Scan a Pine source into its input + prop schema. Never throws — a script
 * that fails to transpile yields an empty schema with `error` set so the UI
 * can surface it instead of crashing.
 */
export function scanPineSettings(source: string): PineSettingsSchema {
  try {
    const indicator = newIndicator(source);
    return {
      declarationType: indicator.getDeclarationType(),
      inputs: indicator.getInputsMeta(),
      props: indicator.getPropsMeta(),
    };
  } catch (err: any) {
    return {
      declarationType: null,
      inputs: [],
      props: [],
      error: err?.message || 'Failed to parse Pine script settings',
    };
  }
}

/**
 * Apply saved overrides to an `Indicator`, skipping (and reporting) any that
 * the current script rejects. Rejections happen when the user edited the
 * script so an input/prop was removed, renamed, retyped, had its range
 * tightened, or lost an enum option.
 */
export function applyPineOverrides(
  indicator: Indicator,
  saved: PineSettingsOverrides,
): PineStaleKeys {
  const stale: PineStaleKeys = { inputs: [], props: [] };

  for (const [key, value] of Object.entries(saved.inputs ?? {})) {
    try {
      indicator.input[key] = value;
    } catch {
      stale.inputs.push(key);
    }
  }
  for (const [key, value] of Object.entries(saved.props ?? {})) {
    try {
      indicator.prop[key] = value;
    } catch {
      stale.props.push(key);
    }
  }

  return stale;
}

/**
 * Build a configured `Indicator` for execution: scans the schema, applies the
 * saved overrides, and reports which were dropped. The returned indicator is
 * ready to hand to `engine.run(...)`.
 */
export function buildConfiguredIndicator(
  source: string,
  saved: PineSettingsOverrides = {},
): { indicator: Indicator; schema: PineSettingsSchema; stale: PineStaleKeys } {
  const indicator = newIndicator(source);
  const schema: PineSettingsSchema = {
    declarationType: indicator.getDeclarationType(),
    inputs: indicator.getInputsMeta(),
    props: indicator.getPropsMeta(),
  };
  const stale = applyPineOverrides(indicator, saved);
  return { indicator, schema, stale };
}

/**
 * Full resolution used by the settings API: schema + canonical applied
 * overrides + stale keys + a modified flag. Never throws.
 */
export function resolvePineSettings(
  source: string,
  saved: PineSettingsOverrides = {},
): ResolvedPineSettings {
  let indicator: Indicator;
  let schema: PineSettingsSchema;
  try {
    indicator = newIndicator(source);
    schema = {
      declarationType: indicator.getDeclarationType(),
      inputs: indicator.getInputsMeta(),
      props: indicator.getPropsMeta(),
    };
  } catch (err: any) {
    return {
      schema: {
        declarationType: null,
        inputs: [],
        props: [],
        error: err?.message || 'Failed to parse Pine script settings',
      },
      applied: { inputs: {}, props: {} },
      stale: { inputs: Object.keys(saved.inputs ?? {}), props: Object.keys(saved.props ?? {}) },
      isModified: false,
    };
  }

  // Capture the script's own prop values (source args / spec defaults) BEFORE
  // applying user overrides, so "modified" means "differs from what the script
  // itself would use".
  const propBaseline: Record<string, unknown> = {};
  for (const meta of schema.props) {
    try {
      propBaseline[meta.name] = indicator.prop[meta.name];
    } catch {
      // Non-readable prop — ignore.
    }
  }

  const stale = applyPineOverrides(indicator, saved);

  // Canonicalize applied input keys to varId so persistence is stable even if
  // the saved data used title aliases.
  const runtimeInputs = indicator.getRuntimeInputs();
  const appliedInputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(runtimeInputs)) {
    const meta = inputMetaFor(schema, key);
    appliedInputs[meta?.varId ?? key] = value;
  }
  const appliedProps = { ...indicator.getRuntimePropOverrides() };

  let isModified = false;
  for (const [key, value] of Object.entries(appliedInputs)) {
    const meta = inputMetaFor(schema, key);
    if (!meta || !valuesEqual(value, meta.defval)) {
      isModified = true;
      break;
    }
  }
  if (!isModified) {
    for (const [key, value] of Object.entries(appliedProps)) {
      if (!valuesEqual(value, propBaseline[key])) {
        isModified = true;
        break;
      }
    }
  }

  return {
    schema,
    applied: { inputs: appliedInputs, props: appliedProps },
    stale,
    isModified,
  };
}
