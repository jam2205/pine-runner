import { describe, expect, it } from 'vitest';

import { decodeSpecials, encodeSpecials } from '../src/codec';

describe('codec sentinel round-trip', () => {
  it('preserves NaN, Infinity and -Infinity through JSON', () => {
    const value = {
      a: NaN,
      b: Infinity,
      c: -Infinity,
      d: 42,
      e: 'str',
      nested: [NaN, 1, { x: Infinity }],
    };
    const decoded = decodeSpecials<typeof value>(encodeSpecials(value));
    expect(Number.isNaN(decoded.a)).toBe(true);
    expect(decoded.b).toBe(Infinity);
    expect(decoded.c).toBe(-Infinity);
    expect(decoded.d).toBe(42);
    expect(decoded.e).toBe('str');
    expect(Number.isNaN(decoded.nested[0] as number)).toBe(true);
    expect(decoded.nested[1]).toBe(1);
    expect((decoded.nested[2] as { x: number }).x).toBe(Infinity);
  });

  it('plain JSON would have destroyed those values (sanity)', () => {
    const roundTripped = JSON.parse(JSON.stringify({ a: NaN, b: Infinity }));
    expect(roundTripped.a).toBeNull();
    expect(roundTripped.b).toBeNull();
  });

  it('leaves ordinary payloads unchanged', () => {
    const value = { trades: [{ profit: 12.5, size: -1 }], title: 'x' };
    expect(decodeSpecials(encodeSpecials(value))).toEqual(value);
  });
});
