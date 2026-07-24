import { describe, expect, it } from 'vitest';

import {
  patchPineRuntimeClassCompat,
  patchPineRuntimeCompat,
  pineMarginCompat,
  scanPineDeclaration,
} from '../src/runtime-compat';

const V5_STRATEGY = `// © QuantPad LLC
//@version=5
strategy("Test (with parens) [QuantPad]", overlay=true, initial_capital=100000, max_boxes_count=500)
plot(close)
`;

describe('scanPineDeclaration', () => {
  it('parses the version directive', () => {
    expect(scanPineDeclaration(V5_STRATEGY).version).toBe(5);
    expect(scanPineDeclaration('//@version=6\nindicator("x")').version).toBe(6);
  });

  it('defaults to version 1 when the directive is missing', () => {
    expect(scanPineDeclaration('strategy("x")').version).toBe(1);
  });

  it('identifies the declaration type', () => {
    expect(scanPineDeclaration(V5_STRATEGY).declarationType).toBe('strategy');
    expect(scanPineDeclaration('//@version=5\nindicator("x")').declarationType).toBe('indicator');
    expect(scanPineDeclaration('//@version=5\nplot(close)').declarationType).toBeNull();
  });

  it('extracts declaration args across parens inside string literals', () => {
    const args = scanPineDeclaration(V5_STRATEGY).declarationArgs;
    expect(args).toContain('max_boxes_count=500');
    expect(args).toContain('initial_capital=100000');
  });

  it('handles multi-line declarations', () => {
    const src = `//@version=5\nstrategy("x",\n    margin_long=25,\n    overlay=true)\n`;
    expect(scanPineDeclaration(src).declarationArgs).toContain('margin_long=25');
  });

  it('does not match strategy() calls that are not declarations', () => {
    const src = `//@version=5\nindicator("x")\ny = mystrategy(1)\n`;
    expect(scanPineDeclaration(src).declarationType).toBe('indicator');
  });
});

describe('pineMarginCompat', () => {
  it('forces both margins to 0 for v5 strategies that do not declare them', () => {
    expect(pineMarginCompat(V5_STRATEGY)).toEqual({ margin_long: 0, margin_short: 0 });
  });

  it('applies to scripts with no version directive (TV treats them as v1)', () => {
    expect(pineMarginCompat('strategy("x")')).toEqual({ margin_long: 0, margin_short: 0 });
  });

  it('keeps declared margins', () => {
    const src = `//@version=5\nstrategy("x", margin_long=20, margin_short=20)\n`;
    expect(pineMarginCompat(src)).toEqual({});
  });

  it('forces only the undeclared margin', () => {
    const src = `//@version=5\nstrategy("x", margin_long=20)\n`;
    expect(pineMarginCompat(src)).toEqual({ margin_short: 0 });
  });

  it('does not apply to v6 strategies', () => {
    expect(pineMarginCompat(`//@version=6\nstrategy("x")`)).toEqual({});
  });

  it('does not apply to indicators', () => {
    expect(pineMarginCompat(`//@version=5\nindicator("x")`)).toEqual({});
  });

  it('skips margins the user overrode through settings', () => {
    expect(pineMarginCompat(V5_STRATEGY, { margin_long: 50 })).toEqual({ margin_short: 0 });
  });
});

function makeFakePine() {
  const contexts: Record<string, unknown>[] = [];
  return {
    contexts,
    _initializeContext(..._args: unknown[]) {
      const ctx: Record<string, unknown> = { indicator: undefined, strategy: undefined };
      contexts.push(ctx);
      return ctx;
    },
  };
}

describe('patchPineRuntimeCompat', () => {
  it('bridges context.indicator to the strategy config for drawing caps', () => {
    const pine = makeFakePine();
    patchPineRuntimeCompat(pine, { marginDefaults: {} });
    const ctx = pine._initializeContext() as Record<string, unknown>;

    expect(ctx.indicator).toBeUndefined();
    ctx.strategy = { config: { max_boxes_count: 500, overlay: true } };
    expect((ctx.indicator as Record<string, unknown>).max_boxes_count).toBe(500);
    expect((ctx.indicator as Record<string, unknown>).overlay).toBe(true);
  });

  it('lets an explicit indicator() assignment win over the strategy bridge', () => {
    const pine = makeFakePine();
    patchPineRuntimeCompat(pine, { marginDefaults: {} });
    const ctx = pine._initializeContext() as Record<string, unknown>;

    ctx.strategy = { config: { max_boxes_count: 500 } };
    ctx.indicator = { max_boxes_count: 75 };
    expect((ctx.indicator as Record<string, unknown>).max_boxes_count).toBe(75);
  });

  it('forces margin defaults onto the strategy config when it is created', () => {
    const pine = makeFakePine();
    patchPineRuntimeCompat(pine, { marginDefaults: { margin_long: 0, margin_short: 0 } });
    const ctx = pine._initializeContext() as Record<string, unknown>;

    ctx.strategy = { config: { margin_long: 100, margin_short: 100 } };
    const config = (ctx.strategy as { config: Record<string, unknown> }).config;
    expect(config.margin_long).toBe(0);
    expect(config.margin_short).toBe(0);
  });

  it('leaves margins alone when no defaults are forced', () => {
    const pine = makeFakePine();
    patchPineRuntimeCompat(pine, { marginDefaults: {} });
    const ctx = pine._initializeContext() as Record<string, unknown>;

    ctx.strategy = { config: { margin_long: 100 } };
    expect((ctx.strategy as { config: Record<string, unknown> }).config.margin_long).toBe(100);
  });

  it('is a no-op when _initializeContext is missing', () => {
    const bare = {};
    expect(() => patchPineRuntimeCompat(bare)).not.toThrow();
  });
});

function makeFakePineClass() {
  class FakePine {
    _initializeContext(..._args: unknown[]) {
      return { params: {} as Record<string, unknown> };
    }
  }
  return FakePine;
}

/** Mimics the engine's dual-use TimeHelper: opaque object with a __value accessor. */
function makeTimeHelper(currentTime: number) {
  return {
    context: {},
    dataField: 'openTime',
    get __value() {
      return { get: (i: number) => currentTime - i * 60_000 };
    },
  };
}

describe('patchPineRuntimeClassCompat', () => {
  it('unwraps time helpers recorded in security tuple params', () => {
    const FakePine = makeFakePineClass();
    patchPineRuntimeClassCompat(FakePine);
    const ctx = new FakePine()._initializeContext() as { params: Record<string, unknown[]> };

    ctx.params.p3 = [];
    ctx.params.p3.push([101.5, 2500, makeTimeHelper(1_700_000_000_000)]);
    ctx.params.p3[ctx.params.p3.length - 1] = [102, 2600, makeTimeHelper(1_700_000_060_000)];

    expect(ctx.params.p3[0]).toEqual([102, 2600, 1_700_000_060_000]);
  });

  it('unwraps scalar time helpers and leaves plain values untouched', () => {
    const FakePine = makeFakePineClass();
    patchPineRuntimeClassCompat(FakePine);
    const ctx = new FakePine()._initializeContext() as { params: Record<string, unknown> };

    ctx.params.p1 = makeTimeHelper(1_700_000_000_000);
    ctx.params.p2 = 'ES.FUT';
    ctx.params.p4 = { custom: 'udt-like object' };

    expect(ctx.params.p1).toBe(1_700_000_000_000);
    expect(ctx.params.p2).toBe('ES.FUT');
    expect(ctx.params.p4).toEqual({ custom: 'udt-like object' });
  });

  it('unwraps numeric __value helpers (time components)', () => {
    const FakePine = makeFakePineClass();
    patchPineRuntimeClassCompat(FakePine);
    const ctx = new FakePine()._initializeContext() as { params: Record<string, unknown[]> };

    ctx.params.p1 = [];
    ctx.params.p1.push([{ context: {}, extractor: () => 5, __value: 14 }]);
    expect(ctx.params.p1[0]).toEqual([14]);
  });

  it('is idempotent per class', () => {
    const FakePine = makeFakePineClass();
    patchPineRuntimeClassCompat(FakePine);
    const patched = FakePine.prototype._initializeContext;
    patchPineRuntimeClassCompat(FakePine);
    expect(FakePine.prototype._initializeContext).toBe(patched);
  });

  it('is a no-op for classes without _initializeContext', () => {
    class Bare {}
    expect(() => patchPineRuntimeClassCompat(Bare)).not.toThrow();
  });
});
