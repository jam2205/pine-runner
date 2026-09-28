// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
/**
 * NaN/Infinity-safe JSON codec.
 *
 * Pine uses `NaN` for `na` and the engine emits ±Infinity in some numeric
 * fields. Plain JSON coerces all of these to `null`, which would silently
 * change values across the process boundary. We replace them with string
 * sentinels on encode and restore them on decode so the child's output round-
 * trips exactly.
 */
const NAN_SENTINEL = '__pine_nan__';
const POS_INF_SENTINEL = '__pine_inf__';
const NEG_INF_SENTINEL = '__pine_-inf__';

export function encodeSpecials(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'number') {
      if (Number.isNaN(val)) return NAN_SENTINEL;
      if (val === Infinity) return POS_INF_SENTINEL;
      if (val === -Infinity) return NEG_INF_SENTINEL;
    }
    return val;
  });
}

export function decodeSpecials<T = unknown>(text: string): T {
  return JSON.parse(text, (_key, val) => {
    if (typeof val === 'string') {
      if (val === NAN_SENTINEL) return NaN;
      if (val === POS_INF_SENTINEL) return Infinity;
      if (val === NEG_INF_SENTINEL) return -Infinity;
    }
    return val;
  }) as T;
}
