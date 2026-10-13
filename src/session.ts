// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Modified by jam2205 (2026): session-aware bar boundaries. Not in the upstream
// QuantPad runner. Corresponding source: https://github.com/jam2205/pine-runner
/**
 * Where a day, a week, a month and an intraday bar START for a symbol whose
 * trading day does not begin at midnight UTC.
 *
 * The stock engine cuts higher-timeframe bars on the UTC calendar: days at
 * 00:00 UTC, weeks from Monday 00:00 UTC (or, in the runner's own resampler,
 * in fixed blocks counted from 1970, which is a Thursday). TradingView cuts
 * them on the symbol's session: for spot FX the day starts at 17:00 New York,
 * so Sunday's evening open is Monday, the week starts there, and a 4-hour bar
 * is counted from 17:00. Measured 2026-10-13 on OANDA:USDCAD and IG:USDCAD
 * 15-minute bars: the stock engine's prior-day close and day open were 1 to 3
 * pips away from the chart's, for this reason alone.
 *
 * Everything here is derived from two fields Pine itself exposes,
 * `syminfo.session` ("1700-1700") and `syminfo.timezone`. A symbol with no
 * session, or a midnight-UTC one, gets `null` and the stock behaviour.
 */

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

export interface SessionSpec {
  timezone: string;
  /** Minutes after local midnight at which the trading day starts (1020 = 17:00). */
  startMin: number;
  /**
   * Trading days that start at a different time, by weekday of the trading day
   * (0 = Sunday). IG's Monday starts at 16:00 on Sunday: { 1: 960 }.
   */
  startByDay?: Record<number, number>;
}

/**
 * Reads the day's start from a TradingView session string. Accepts the plain
 * form ("1700-1700") and the per-day form TradingView reports for a symbol
 * ("1600F-1700:2|1700-1700:3456", days numbered 1 = Sunday): the start that
 * covers the most days is the day's start, and a day listed with a different
 * one (IG's Monday, 16:00 on Sunday) keeps it in `startByDay`. Which day a bar
 * belongs to is still decided by the common start plus the weekend rule in
 * `tradingDay`; the per-day start only moves where that day's bars are counted
 * from. Measured on IG:GBPJPY 2026-10-13: TradingView's Monday 4-hour bars run
 * 20:00, 00:00, 04:00 ... UTC and a month that begins on a Monday is stamped
 * Sunday 20:00 UTC.
 */
export function sessionSpec(
  info: { session?: unknown; timezone?: unknown } | null | undefined,
): SessionSpec | null {
  const session = typeof info?.session === 'string' ? info.session.trim() : '';
  const timezone = typeof info?.timezone === 'string' ? info.timezone.trim() : '';
  if (!session || !timezone) return null;

  const weight = new Map<number, number>();
  const listed: [number, number][] = []; // [weekday 0 = Sunday, start]
  for (const part of session.split('|')) {
    const m = /^(\d{2})(\d{2})F?-(\d{2})(\d{2})(?::(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const start = Number(m[1]) * 60 + Number(m[2]);
    if (start >= 1440) continue;
    weight.set(start, (weight.get(start) ?? 0) + (m[5] ? m[5].length : 5));
    for (const digit of m[5] ?? '') {
      const d = Number(digit);
      if (d >= 1 && d <= 7) listed.push([d - 1, start]);
    }
  }
  if (weight.size === 0) return null;
  const startMin = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const startByDay: Record<number, number> = {};
  for (const [weekday, start] of listed) if (start !== startMin && start > 0) startByDay[weekday] = start;

  try {
    formatter(timezone);
  } catch {
    return null; // an unknown timezone must not take the run down
  }
  if (startMin === 0 && offsetMs(0, timezone) === 0 && offsetMs(Date.UTC(2026, 6, 1), timezone) === 0) {
    return null; // midnight UTC is the stock calendar
  }
  return Object.keys(startByDay).length ? { timezone, startMin, startByDay } : { timezone, startMin };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** Local wall-clock time minus UTC, in ms, at instant `t`. */
function offsetMs(t: number, timezone: string): number {
  const p: Record<string, number> = {};
  for (const part of formatter(timezone).formatToParts(new Date(t))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return local - Math.floor(t / 1000) * 1000;
}

/** The UTC instant at which the local wall clock reads `wall` (ms, as if UTC). */
function wallToUtc(wall: number, timezone: string): number {
  // Two passes settle the offset across a daylight-saving change.
  let t = wall - offsetMs(wall, timezone);
  t = wall - offsetMs(t, timezone);
  return t;
}

const weekdayOf = (dayIdx: number) => (((dayIdx + 4) % 7) + 7) % 7; // 0 = Sunday; 1970-01-01 was a Thursday

/**
 * The trading day a bar opening at `t` belongs to, as whole days since
 * 1970-01-01. The local clock is moved forward so the session start reads
 * midnight: 17:00 New York on Sunday is the first minute of Monday.
 *
 * `mergeWeekend` folds a Saturday or Sunday trading day into Monday. That is
 * what makes a feed that opens before the session start on Sunday (IG, 16:00
 * New York) part of Monday's bar, as on the chart, not a one-hour day of its own.
 */
export function tradingDay(t: number, spec: SessionSpec, mergeWeekend = true): number {
  const wall = t + offsetMs(t, spec.timezone);
  const shifted = spec.startMin > 0 ? wall + (1440 - spec.startMin) * MIN_MS : wall;
  let day = Math.floor(shifted / DAY_MS);
  if (mergeWeekend) {
    const wd = weekdayOf(day);
    if (wd === 6) day += 2;
    else if (wd === 0) day += 1;
  }
  return day;
}

/** The UTC instant at which trading day `dayIdx` starts. */
export function tradingDayStart(dayIdx: number, spec: SessionSpec): number {
  const start = spec.startByDay?.[weekdayOf(dayIdx)] ?? spec.startMin;
  const wall = dayIdx * DAY_MS - (start > 0 ? (1440 - start) * MIN_MS : 0);
  return wallToUtc(wall, spec.timezone);
}

interface ParsedTf {
  n: number;
  unit: 'S' | '' | 'D' | 'W' | 'M';
}

export function parseTf(timeframe: string | undefined | null): ParsedTf | null {
  const m = /^(\d*)([SDWM]?)$/.exec(String(timeframe ?? '').trim().toUpperCase());
  if (!m || (!m[1] && !m[2])) return null;
  const n = m[1] ? Number(m[1]) : 1;
  if (!Number.isFinite(n) || n <= 0) return null;
  return { n, unit: m[2] as ParsedTf['unit'] };
}

/** Nominal length of a timeframe in ms (a month counts as 30 days); null if unparseable. */
export function tfMs(timeframe: string | undefined | null): number | null {
  const tf = parseTf(timeframe);
  if (!tf) return null;
  switch (tf.unit) {
    case 'S': return tf.n * 1000;
    case '': return tf.n * MIN_MS;
    case 'D': return tf.n * DAY_MS;
    case 'W': return tf.n * 7 * DAY_MS;
    case 'M': return tf.n * 30 * DAY_MS;
  }
}

const firstWeekday = (dayIdx: number) => {
  const wd = weekdayOf(dayIdx);
  return wd === 6 ? dayIdx + 2 : wd === 0 ? dayIdx + 1 : dayIdx;
};

/**
 * Open time of the bar of `timeframe` that holds a chart bar opening at `t`.
 *   days     the session start of the trading day;
 *   weeks    the session start of that week's Monday (Sunday evening for FX);
 *   months   the session start of the month's first weekday trading day;
 *   intraday every N minutes counted from the session start of the day.
 * Returns null when the timeframe cannot be parsed.
 */
export function sessionBarStart(t: number, timeframe: string, spec: SessionSpec): number | null {
  const tf = parseTf(timeframe);
  if (!tf) return null;
  if (tf.unit === 'S' || tf.unit === '') {
    const step = tf.unit === 'S' ? tf.n * 1000 : tf.n * MIN_MS;
    // Intraday bars restart at each trading day's start. A bar before it (a feed
    // that opens ahead of the session on Sunday) falls in a block of its own.
    const dayStart = tradingDayStart(tradingDay(t, spec), spec);
    return dayStart + Math.floor((t - dayStart) / step) * step;
  }
  const day = tradingDay(t, spec);
  if (tf.unit === 'D') {
    return tradingDayStart(tf.n === 1 ? day : Math.floor(day / tf.n) * tf.n, spec);
  }
  if (tf.unit === 'W') {
    const monday = day - ((weekdayOf(day) + 6) % 7);
    const weeks = Math.floor((monday - 4) / 7); // day 4 (1970-01-05) was a Monday
    return tradingDayStart(4 + Math.floor(weeks / tf.n) * tf.n * 7, spec);
  }
  const d = new Date(day * DAY_MS);
  const first = Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / tf.n) * tf.n, 1) / DAY_MS;
  return tradingDayStart(firstWeekday(first), spec);
}
