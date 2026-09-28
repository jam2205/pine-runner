import { describe, expect, it } from 'vitest';

import {
  applyPineOverrides,
  buildConfiguredIndicator,
  resolvePineSettings,
  scanPineSettings,
} from '../src/settings';

const INDICATOR_SOURCE = `
//@version=5
indicator("Demo", overlay=true, precision=2)
grp = "Trend"
length = input.int(14, "Length", minval=2, maxval=200, group=grp)
src = input.source(close, "Source")
maType = input.string("EMA", "MA Type", options=["EMA", "SMA", "WMA"])
useFilter = input.bool(true, "Use Filter")
lineCol = input.color(color.orange, "Line")
plot(ta.sma(src, length))
`;

const STRATEGY_SOURCE = `
//@version=5
strategy("Strat", overlay=true, initial_capital=50000, pyramiding=3)
len = input.int(20, "Len")
plot(ta.sma(close, len))
`;

describe('scanPineSettings', () => {
  it('extracts typed input metadata with ranges, options, and normalized colors', () => {
    const schema = scanPineSettings(INDICATOR_SOURCE);
    expect(schema.declarationType).toBe('indicator');

    const byId = Object.fromEntries(schema.inputs.map((meta) => [meta.varId, meta]));
    expect(byId.length).toMatchObject({
      type: 'int',
      defval: 14,
      title: 'Length',
      group: 'Trend',
      minval: 2,
      maxval: 200,
    });
    expect(byId.src).toMatchObject({ type: 'source', defval: 'close' });
    expect(byId.maType).toMatchObject({ type: 'string', options: ['EMA', 'SMA', 'WMA'] });
    expect(byId.useFilter).toMatchObject({ type: 'bool', defval: true });
    // color defaults are normalized to #RRGGBBAA
    expect(byId.lineCol.type).toBe('color');
    expect(String(byId.lineCol.defval)).toMatch(/^#[0-9A-F]{8}$/);
  });

  it('filters props by declaration type and marks title/shorttitle immutable', () => {
    const schema = scanPineSettings(STRATEGY_SOURCE);
    expect(schema.declarationType).toBe('strategy');
    const initialCapital = schema.props.find((p) => p.name === 'initial_capital');
    expect(initialCapital?.appliesTo).toBe('strategy');
    const title = schema.props.find((p) => p.name === 'title');
    expect(title?.mutable).toBe(false);
    // strategy-only props should not appear for indicator scripts
    const indicatorSchema = scanPineSettings(INDICATOR_SOURCE);
    expect(indicatorSchema.props.some((p) => p.name === 'initial_capital')).toBe(false);
  });

  it('degrades gracefully on a source with no recognizable declaration', () => {
    const schema = scanPineSettings('this is not pine script {{{');
    expect(schema.inputs).toEqual([]);
    expect(schema.declarationType).toBeNull();
  });
});

describe('applyPineOverrides', () => {
  it('applies valid overrides and reports stale keys without throwing', () => {
    const { indicator } = buildConfiguredIndicator(INDICATOR_SOURCE);
    const stale = applyPineOverrides(indicator, {
      inputs: {
        length: 50, // valid
        maType: 'HMA', // invalid option -> stale
        removed: 5, // unknown key -> stale
      },
    });
    expect(stale.inputs).toEqual(expect.arrayContaining(['maType', 'removed']));
    expect(stale.inputs).not.toContain('length');
    expect(indicator.getRuntimeInputs()).toMatchObject({ length: 50 });
  });

  it('flags out-of-range values as stale', () => {
    const { indicator } = buildConfiguredIndicator(INDICATOR_SOURCE);
    const stale = applyPineOverrides(indicator, { inputs: { length: 1 } });
    expect(stale.inputs).toContain('length');
  });
});

describe('resolvePineSettings', () => {
  it('canonicalizes applied inputs to varId and flags modification', () => {
    const resolved = resolvePineSettings(INDICATOR_SOURCE, {
      inputs: { Length: 50 }, // saved by title alias
    });
    expect(resolved.applied.inputs).toEqual({ length: 50 });
    expect(resolved.stale.inputs).toEqual([]);
    expect(resolved.isModified).toBe(true);
  });

  it('is not modified when an override equals the input default', () => {
    const resolved = resolvePineSettings(INDICATOR_SOURCE, {
      inputs: { length: 14 },
    });
    expect(resolved.isModified).toBe(false);
  });

  it('drops overrides that no longer exist and reports them stale', () => {
    const resolved = resolvePineSettings(INDICATOR_SOURCE, {
      inputs: { length: 50, ghost: 10 },
    });
    expect(resolved.applied.inputs).toEqual({ length: 50 });
    expect(resolved.stale.inputs).toContain('ghost');
  });

  it('applies strategy property overrides and marks modified', () => {
    const resolved = resolvePineSettings(STRATEGY_SOURCE, {
      props: { initial_capital: 75000 },
    });
    expect(resolved.applied.props).toMatchObject({ initial_capital: 75000 });
    expect(resolved.isModified).toBe(true);
  });

  it('treats a property override equal to the source value as unmodified', () => {
    const resolved = resolvePineSettings(STRATEGY_SOURCE, {
      props: { initial_capital: 50000 },
    });
    expect(resolved.isModified).toBe(false);
  });
});
