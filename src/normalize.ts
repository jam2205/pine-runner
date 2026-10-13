// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
// Modified by QuantPad (2026): normalizes the upstream engine's plot/drawing
// output into QuantPad's chart artifact shape.
import {
  type OhlcvBar,
  type PineCandle,
  type PineChartBarColor,
  type PineChartDrawing,
  type PineChartFillBand,
  type PineChartHline,
  type PineChartLineDrawing,
  type PineChartOverlay,
  type PineChartTable,
  type PineOverlayStyle,
} from './types';

export function toPineCandles(bars: OhlcvBar[], barMs = 60_000): PineCandle[] {
  return bars.map((bar, index) => ({
    openTime: bar.t,
    closeTime: bars[index + 1]?.t ?? bar.t + barMs,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  }));
}

function stableOverlayId(name: string, index: number): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `plot_${index + 1}`
  );
}

function extractY(point: unknown): number | null {
  if (typeof point === 'number') return Number.isFinite(point) ? point : null;
  if (!point || typeof point !== 'object') return null;
  const obj = point as Record<string, unknown>;
  const raw =
    obj.value ??
    obj.y ??
    obj.data ??
    obj.close ??
    (Array.isArray(point) ? (point as unknown[])[1] : undefined);
  const y = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(y) ? y : null;
}

function extractTime(point: unknown): number | null {
  if (!point || typeof point !== 'object') return null;
  const obj = point as Record<string, unknown>;
  const raw =
    obj.time ??
    obj.t ??
    obj.openTime ??
    obj.timestamp ??
    (Array.isArray(point) ? (point as unknown[])[0] : undefined);
  const t = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(t)) return null;
  return t < 10_000_000_000 ? t * 1000 : t;
}

function plotData(plot: unknown): unknown[] {
  if (Array.isArray(plot)) return plot;
  if (!plot || typeof plot !== 'object') return [];
  const obj = plot as Record<string, unknown>;
  const raw = obj.data ?? obj.values ?? obj.series;
  return Array.isArray(raw) ? raw : [];
}

function plotName(key: string, plot: unknown): string {
  if (plot && typeof plot === 'object') {
    const obj = plot as Record<string, unknown>;
    const title = obj.title ?? obj.name;
    if (typeof title === 'string' && title.trim()) return title.trim();
  }
  return key;
}

/** Top-level plot style string (lowercased), e.g. `style_stepline`, `hline`. */
function plotStyle(plot: unknown): string {
  if (!plot || typeof plot !== 'object') return '';
  const obj = plot as Record<string, unknown>;
  const options = obj.options && typeof obj.options === 'object' ? obj.options : undefined;
  return String(
    obj.style ?? (options as Record<string, unknown> | undefined)?.style ?? '',
  ).toLowerCase();
}

function plotDisplay(plot: unknown): string {
  if (!plot || typeof plot !== 'object') return '';
  const obj = plot as Record<string, unknown>;
  const options = obj.options && typeof obj.options === 'object' ? obj.options : undefined;
  return String((options as Record<string, unknown> | undefined)?.display ?? '').toLowerCase();
}

// Plot styles that are NOT rendered as line/area overlays — each has its own
// normalizer (shapes, background bands, bar colors, horizontal lines, fills).
const NON_OVERLAY_STYLES = new Set(['shape', 'char', 'background', 'barcolor', 'hline', 'fill']);

function isShapePlot(plot: unknown): boolean {
  const style = plotStyle(plot);
  return style === 'shape' || style === 'char';
}

function isLineOverlayPlot(plot: unknown): boolean {
  return !NON_OVERLAY_STYLES.has(plotStyle(plot)) && plotDisplay(plot) !== 'none';
}

function mapOverlayStyle(raw: string): PineOverlayStyle {
  const style = raw.replace(/^style_/, '');
  switch (style) {
    case 'stepline':
    case 'stepline_diamond':
      return 'stepline';
    case 'area':
    case 'areabr':
      return 'area';
    case 'columns':
      return 'columns';
    case 'histogram':
      return 'histogram';
    case 'circles':
      return 'circles';
    case 'cross':
      return 'cross';
    case 'linebr':
      return 'linebr';
    default:
      return 'line';
  }
}

function plotKind(plot: unknown): PineChartOverlay['kind'] {
  const style = plotStyle(plot);
  return style.includes('histogram') || style.includes('column') ? 'histogram' : 'line';
}

/** Per-point color, read from a plot point's own `options.color`. */
function pointColor(point: unknown): string | undefined {
  if (!point || typeof point !== 'object') return undefined;
  const options = (point as Record<string, unknown>).options;
  if (!options || typeof options !== 'object') return undefined;
  return cleanColor((options as Record<string, unknown>).color);
}

function plotLinewidth(plot: unknown): number | undefined {
  if (!plot || typeof plot !== 'object') return undefined;
  const obj = plot as Record<string, unknown>;
  const options = obj.options && typeof obj.options === 'object' ? obj.options : undefined;
  return finiteNumber((options as Record<string, unknown> | undefined)?.linewidth) ?? undefined;
}

function plotColor(plot: unknown): string | undefined {
  if (!plot || typeof plot !== 'object') return undefined;
  const obj = plot as Record<string, unknown>;
  const options = obj.options && typeof obj.options === 'object' ? obj.options : undefined;
  const raw = obj.color ?? (options as Record<string, unknown> | undefined)?.color;
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

function cleanColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const color = raw.trim();
  return color ? color : undefined;
}

function finiteNumber(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Modified by jam2205 (2026). A script in its own pane draws on the PRICE pane
 * with `force_overlay = true`; the engine keeps those under `__boxes_overlay__`
 * (and `__lines_overlay__`, `__labels_overlay__`), which were never read, so a
 * script's levels and zones on the price were silently missing. Both sets are
 * returned; the overlay ones carry `forceOverlay: true`.
 */
function drawingValues(plots: unknown, key: string): Record<string, unknown>[] {
  return [
    ...latestDrawingValues(plots, key),
    ...latestDrawingValues(plots, key.replace(/__$/, '_overlay__')),
  ];
}

function latestDrawingValues(plots: unknown, key: string): Record<string, unknown>[] {
  if (!plots || typeof plots !== 'object') return [];
  const plot = (plots as Record<string, unknown>)[key];
  const data = plotData(plot);
  const latestById = new Map<string, Record<string, unknown>>();

  for (const point of data) {
    const values =
      point && typeof point === 'object' ? (point as Record<string, unknown>).value : null;
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const obj = value as Record<string, unknown>;
      if (obj._deleted === true) continue;
      latestById.set(String(obj.id ?? `${key}_${latestById.size}`), obj);
    }
  }

  return [...latestById.values()];
}

function normalizeLineDrawing(
  raw: Record<string, unknown>,
  idPrefix = 'line',
): PineChartLineDrawing | null {
  const x1 = finiteNumber(raw.x1);
  const y1 = finiteNumber(raw.y1);
  const x2 = finiteNumber(raw.x2);
  const y2 = finiteNumber(raw.y2);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
  const id = `${idPrefix}_${String(raw.id ?? `${x1}_${x2}`)}`;
  return {
    kind: 'line',
    id,
    x1,
    y1,
    x2,
    y2,
    xloc: typeof raw.xloc === 'string' ? raw.xloc : 'bi',
    color: cleanColor(raw.color),
    style: typeof raw.style === 'string' ? raw.style : undefined,
    width: finiteNumber(raw.width) ?? undefined,
    ...(raw.force_overlay === true ? { forceOverlay: true } : {}),
  };
}

export function normalizePinePlots(plots: unknown, candles: OhlcvBar[]): PineChartOverlay[] {
  if (!plots || typeof plots !== 'object') return [];
  const entries = Object.entries(plots as Record<string, unknown>).filter(
    ([key, plot]) => !key.startsWith('__') && isLineOverlayPlot(plot),
  );

  return entries
    .map(([key, plot], index): PineChartOverlay | null => {
      const rawData = plotData(plot);
      if (rawData.length === 0) return null;

      const baseColor = plotColor(plot);
      const offset = Math.max(0, candles.length - rawData.length);
      const colorSet = new Set<string>();
      const data = rawData
        .map((point, pointIndex) => {
          const y = extractY(point);
          if (y == null) return null;
          const t = extractTime(point) ?? candles[offset + pointIndex]?.t;
          if (!Number.isFinite(t)) return null;
          const color = pointColor(point);
          if (color) colorSet.add(color);
          return color && color !== baseColor ? { t, y, color } : { t, y };
        })
        .filter((point): point is { t: number; y: number; color?: string } => point != null);

      if (data.length === 0) return null;

      const name = plotName(key, plot);
      const hasPerPointColor = colorSet.size > 1;
      return {
        kind: plotKind(plot),
        id: stableOverlayId(name, index),
        name,
        color: baseColor,
        overlay: true,
        data,
        style: mapOverlayStyle(plotStyle(plot)),
        linewidth: plotLinewidth(plot),
        hasPerPointColor: hasPerPointColor || undefined,
      };
    })
    .filter((overlay): overlay is PineChartOverlay => overlay != null);
}

/** Aligns a referenced plot series (by title/key) to a time→value map. */
function seriesForPlot(plots: unknown, key: string, candles: OhlcvBar[]): Map<number, number> {
  const map = new Map<number, number>();
  if (!plots || typeof plots !== 'object') return map;
  const plot = (plots as Record<string, unknown>)[key];
  const rawData = plotData(plot);
  const offset = Math.max(0, candles.length - rawData.length);
  rawData.forEach((point, pointIndex) => {
    const y = extractY(point);
    if (y == null) return;
    const t = extractTime(point) ?? candles[offset + pointIndex]?.t;
    if (!Number.isFinite(t)) return;
    map.set(t as number, y);
  });
  return map;
}

export function normalizePineHlines(plots: unknown): PineChartHline[] {
  if (!plots || typeof plots !== 'object') return [];
  const hlines: PineChartHline[] = [];
  Object.entries(plots as Record<string, unknown>).forEach(([key, plot], index) => {
    if (key.startsWith('__') || plotStyle(plot) !== 'hline') return;
    const data = plotData(plot);
    let price: number | null = null;
    for (const point of data) {
      const y = extractY(point);
      if (y != null) {
        price = y;
        break;
      }
    }
    if (price == null) return;
    const obj = plot && typeof plot === 'object' ? (plot as Record<string, unknown>) : {};
    const options =
      obj.options && typeof obj.options === 'object'
        ? (obj.options as Record<string, unknown>)
        : {};
    const rawStyle = String(options.linestyle ?? '').toLowerCase();
    const lineStyle = rawStyle.includes('dash')
      ? 'dashed'
      : rawStyle.includes('dot')
        ? 'dotted'
        : 'solid';
    hlines.push({
      id: stableOverlayId(plotName(key, plot), index),
      title: plotName(key, plot),
      price,
      color: plotColor(plot),
      lineStyle,
    });
  });
  return hlines;
}

export function normalizePineFills(plots: unknown, candles: OhlcvBar[]): PineChartFillBand[] {
  if (!plots || typeof plots !== 'object') return [];
  const fills: PineChartFillBand[] = [];
  Object.entries(plots as Record<string, unknown>).forEach(([key, plot], index) => {
    if (key.startsWith('__') || plotStyle(plot) !== 'fill') return;
    const obj = plot && typeof plot === 'object' ? (plot as Record<string, unknown>) : {};
    const options =
      obj.options && typeof obj.options === 'object'
        ? (obj.options as Record<string, unknown>)
        : {};
    const plot1 = typeof options.plot1 === 'string' ? options.plot1 : null;
    const plot2 = typeof options.plot2 === 'string' ? options.plot2 : null;
    if (!plot1 || !plot2) return;
    const s1 = seriesForPlot(plots, plot1, candles);
    const s2 = seriesForPlot(plots, plot2, candles);
    const points: Array<{ t: number; y1: number; y2: number }> = [];
    for (const [t, y1] of s1) {
      const y2 = s2.get(t);
      if (y2 == null) continue;
      points.push({ t, y1, y2 });
    }
    points.sort((a, b) => a.t - b.t);
    if (points.length === 0) return;
    fills.push({
      id: `fill_${index}`,
      color: plotColor(plot),
      points,
    });
  });
  return fills;
}

function normalizeBarColorSeries(
  plots: unknown,
  style: 'background' | 'barcolor',
): PineChartBarColor[] {
  if (!plots || typeof plots !== 'object') return [];
  const out: PineChartBarColor[] = [];
  Object.entries(plots as Record<string, unknown>).forEach(([key, plot]) => {
    if (key.startsWith('__') || plotStyle(plot) !== style) return;
    for (const point of plotData(plot)) {
      if (!point || typeof point !== 'object') continue;
      const obj = point as Record<string, unknown>;
      if (!obj.value) continue;
      const t = extractTime(point);
      const color = pointColor(point);
      if (t == null || !color) continue;
      out.push({ t, color });
    }
  });
  return out;
}

export function normalizePineBgColors(plots: unknown): PineChartBarColor[] {
  return normalizeBarColorSeries(plots, 'background');
}

export function normalizePineBarColors(plots: unknown): PineChartBarColor[] {
  return normalizeBarColorSeries(plots, 'barcolor');
}

export function normalizePineShapeDrawings(
  plots: unknown,
  candles: OhlcvBar[],
): PineChartDrawing[] {
  if (!plots || typeof plots !== 'object') return [];
  const drawings: PineChartDrawing[] = [];

  Object.entries(plots as Record<string, unknown>).forEach(([key, plot], plotIndex) => {
    if (key.startsWith('__') || !isShapePlot(plot)) return;
    const plotObj = plot && typeof plot === 'object' ? (plot as Record<string, unknown>) : {};
    const plotOptions =
      plotObj.options && typeof plotObj.options === 'object'
        ? (plotObj.options as Record<string, unknown>)
        : {};
    const rawData = plotData(plot);
    const offset = Math.max(0, candles.length - rawData.length);

    rawData.forEach((point, pointIndex) => {
      if (!point || typeof point !== 'object') return;
      const obj = point as Record<string, unknown>;
      // plotshape/plotchar emit booleans; plotarrow emits signed numbers where
      // 0/na means "no marker". Treat any truthy value as an active marker.
      const active =
        obj.value === true ||
        (typeof obj.value === 'number' && Number.isFinite(obj.value) && obj.value !== 0);
      if (!active) return;
      const candle = candles[offset + pointIndex];
      if (!candle) return;
      const options =
        obj.options && typeof obj.options === 'object'
          ? (obj.options as Record<string, unknown>)
          : {};
      const location = String(options.location ?? plotOptions.location ?? 'AboveBar');
      const t = extractTime(point) ?? candle.t;
      const y =
        location.toLowerCase().includes('below') || location.toLowerCase().includes('bottom')
          ? candle.l
          : candle.h;
      // plotchar carries its glyph in `char`; plotshape/plotarrow use `text`.
      const text =
        typeof options.text === 'string'
          ? options.text
          : typeof options.char === 'string'
            ? options.char
            : typeof plotOptions.text === 'string'
              ? (plotOptions.text as string)
              : typeof plotOptions.char === 'string'
                ? (plotOptions.char as string)
                : undefined;

      drawings.push({
        kind: 'shape',
        id: `shape_${stableOverlayId(key, plotIndex)}_${pointIndex}`,
        t,
        y,
        location,
        shape:
          typeof options.shape === 'string'
            ? options.shape
            : (plotOptions.shape as string | undefined),
        text,
        color: cleanColor(options.color ?? plotOptions.color),
        size:
          typeof options.size === 'string'
            ? options.size
            : (plotOptions.size as string | undefined),
      });
    });
  });

  return drawings;
}

export function normalizePineDrawings(plots: unknown): PineChartDrawing[] {
  const drawings: PineChartDrawing[] = [];

  for (const raw of latestDrawingValues(plots, '__linefills__')) {
    const line1Raw = raw.line1 && typeof raw.line1 === 'object' ? raw.line1 : null;
    const line2Raw = raw.line2 && typeof raw.line2 === 'object' ? raw.line2 : null;
    if (!line1Raw || !line2Raw) continue;
    const line1 = normalizeLineDrawing(line1Raw as Record<string, unknown>, 'linefill_line1');
    const line2 = normalizeLineDrawing(line2Raw as Record<string, unknown>, 'linefill_line2');
    if (!line1 || !line2) continue;
    const { kind: _kind1, ...line1Data } = line1;
    const { kind: _kind2, ...line2Data } = line2;
    drawings.push({
      kind: 'linefill',
      id: `linefill_${String(raw.id ?? drawings.length)}`,
      line1: line1Data,
      line2: line2Data,
      color: cleanColor(raw.color),
    });
  }

  for (const raw of drawingValues(plots, '__boxes__')) {
    const left = finiteNumber(raw.left);
    const top = finiteNumber(raw.top);
    const right = finiteNumber(raw.right);
    const bottom = finiteNumber(raw.bottom);
    if (left == null || top == null || right == null || bottom == null) continue;
    drawings.push({
      kind: 'box',
      id: `box_${String(raw.id ?? drawings.length)}`,
      left,
      top,
      right,
      bottom,
      xloc: typeof raw.xloc === 'string' ? raw.xloc : 'bi',
      borderColor: cleanColor(raw.border_color),
      borderStyle: typeof raw.border_style === 'string' ? raw.border_style : undefined,
      borderWidth: finiteNumber(raw.border_width) ?? undefined,
      backgroundColor: cleanColor(raw.bgcolor),
      text: typeof raw.text === 'string' ? raw.text : undefined,
      textColor: cleanColor(raw.text_color),
      ...(raw.force_overlay === true ? { forceOverlay: true } : {}),
    });
  }

  for (const raw of latestDrawingValues(plots, '__polylines__')) {
    const rawPoints = Array.isArray(raw.points) ? raw.points : [];
    const points = rawPoints
      .map((point) => {
        if (!point || typeof point !== 'object') return null;
        const obj = point as Record<string, unknown>;
        const x = finiteNumber(obj.index ?? obj.time);
        const y = finiteNumber(obj.price);
        return x == null || y == null ? null : { x, y };
      })
      .filter((point): point is { x: number; y: number } => point != null);
    if (points.length < 2) continue;
    drawings.push({
      kind: 'polyline',
      id: `polyline_${String(raw.id ?? drawings.length)}`,
      points,
      curved: raw.curved === true,
      closed: raw.closed === true,
      xloc: typeof raw.xloc === 'string' ? raw.xloc : 'bi',
      lineColor: cleanColor(raw.line_color),
      fillColor: cleanColor(raw.fill_color),
      lineStyle: typeof raw.line_style === 'string' ? raw.line_style : undefined,
      lineWidth: finiteNumber(raw.line_width) ?? undefined,
    });
  }

  for (const raw of drawingValues(plots, '__lines__')) {
    const line = normalizeLineDrawing(raw);
    if (line) drawings.push(line);
  }

  for (const raw of drawingValues(plots, '__labels__')) {
    const x = finiteNumber(raw.x);
    const y = finiteNumber(raw.y);
    if (x == null || y == null) continue;
    drawings.push({
      kind: 'label',
      id: `label_${String(raw.id ?? drawings.length)}`,
      x,
      y,
      xloc: typeof raw.xloc === 'string' ? raw.xloc : 'bi',
      yloc: typeof raw.yloc === 'string' ? raw.yloc : 'pr',
      text: typeof raw.text === 'string' ? raw.text : '',
      color: cleanColor(raw.color),
      textColor: cleanColor(raw.textcolor),
      style: typeof raw.style === 'string' ? raw.style : undefined,
      size: typeof raw.size === 'string' ? raw.size : undefined,
      ...(raw.force_overlay === true ? { forceOverlay: true } : {}),
    });
  }

  return drawings;
}

export function normalizePineTables(plots: unknown): PineChartTable[] {
  return latestDrawingValues(plots, '__tables__').map((raw, index) => {
    const cells = Array.isArray(raw.cells)
      ? raw.cells.map((row) =>
          Array.isArray(row)
            ? row.map((cell) => {
                if (!cell || typeof cell !== 'object') return null;
                const obj = cell as Record<string, unknown>;
                return {
                  text: String(obj.text ?? ''),
                  textColor: cleanColor(obj.text_color),
                  backgroundColor: cleanColor(obj.bgcolor),
                };
              })
            : [],
        )
      : [];

    return {
      id: `table_${String(raw.id ?? index)}`,
      position: typeof raw.position === 'string' ? raw.position : 'top_right',
      columns: finiteNumber(raw.columns) ?? cells[0]?.length ?? 0,
      rows: finiteNumber(raw.rows) ?? cells.length,
      backgroundColor: cleanColor(raw.bgcolor),
      borderColor: cleanColor(raw.border_color),
      borderWidth: finiteNumber(raw.border_width) ?? undefined,
      cells,
    };
  });
}

export interface NormalizedPineVisuals {
  overlays: PineChartOverlay[];
  drawings: PineChartDrawing[];
  tables: PineChartTable[];
  hlines: PineChartHline[];
  fills: PineChartFillBand[];
  bgColors: PineChartBarColor[];
  barColors: PineChartBarColor[];
}

export function normalizePineVisuals(plots: unknown, candles: OhlcvBar[]): NormalizedPineVisuals {
  return {
    overlays: normalizePinePlots(plots, candles),
    drawings: [...normalizePineDrawings(plots), ...normalizePineShapeDrawings(plots, candles)],
    tables: normalizePineTables(plots),
    hlines: normalizePineHlines(plots),
    fills: normalizePineFills(plots, candles),
    bgColors: normalizePineBgColors(plots),
    barColors: normalizePineBarColors(plots),
  };
}

function isTimeXloc(xloc: string): boolean {
  const normalized = xloc.toLowerCase();
  return normalized.includes('time') || normalized === 'bt';
}

/**
 * Convert a bar-index x coordinate to epoch milliseconds against the bar
 * array the script ran over, extrapolating past either edge by `barMs`
 * (boxes/lines routinely extend a few bars right of the last candle).
 */
function barIndexToTime(x: number, bars: OhlcvBar[], barMs: number): number {
  const last = bars.length - 1;
  if (last < 0) return x;
  const index = Math.round(x);
  if (index <= 0) return bars[0].t + index * barMs;
  if (index >= last) return bars[last].t + (index - last) * barMs;
  return bars[index].t;
}

/**
 * Rewrite every bar_index-anchored drawing to time (`xloc: 'time'`) against
 * the full bar array of the run. Required whenever the displayed candle
 * window is narrower than the strategy window: bar indexes are positions in
 * the FULL array, so they would resolve to the wrong candles (or none) once
 * the artifact only ships the display slice.
 */
export function rebaseDrawingsToTime(
  drawings: PineChartDrawing[],
  bars: OhlcvBar[],
  barMs: number,
): PineChartDrawing[] {
  const toTime = (x: number) => barIndexToTime(x, bars, barMs);
  const rebaseLine = <T extends Omit<PineChartLineDrawing, 'kind'>>(line: T): T =>
    isTimeXloc(line.xloc)
      ? line
      : { ...line, x1: toTime(line.x1), x2: toTime(line.x2), xloc: 'time' };

  return drawings.map((drawing) => {
    switch (drawing.kind) {
      case 'line':
        return rebaseLine(drawing);
      case 'linefill':
        return { ...drawing, line1: rebaseLine(drawing.line1), line2: rebaseLine(drawing.line2) };
      case 'box':
        return isTimeXloc(drawing.xloc)
          ? drawing
          : {
              ...drawing,
              left: toTime(drawing.left),
              right: toTime(drawing.right),
              xloc: 'time',
            };
      case 'label':
        return isTimeXloc(drawing.xloc)
          ? drawing
          : { ...drawing, x: toTime(drawing.x), xloc: 'time' };
      case 'polyline':
        return isTimeXloc(drawing.xloc)
          ? drawing
          : {
              ...drawing,
              points: drawing.points.map((point) => ({ ...point, x: toTime(point.x) })),
              xloc: 'time',
            };
      case 'shape':
        // Shape drawings are already time-anchored (`t`).
        return drawing;
    }
  });
}

function drawingMaxTime(drawing: PineChartDrawing): number {
  switch (drawing.kind) {
    case 'line':
      return Math.max(drawing.x1, drawing.x2);
    case 'linefill':
      return Math.max(drawing.line1.x1, drawing.line1.x2, drawing.line2.x1, drawing.line2.x2);
    case 'box':
      return Math.max(drawing.left, drawing.right);
    case 'label':
      return drawing.x;
    case 'polyline':
      return drawing.points.reduce((max, point) => Math.max(max, point.x), -Infinity);
    case 'shape':
      return drawing.t;
  }
}

/**
 * Drop the visual payload that falls entirely before the displayed candle
 * window. Long-range backtests run over up to `MAX_STRATEGY_BARS` bars, but
 * only the display slice ships in the artifact — per-bar visuals outside it
 * would bloat the JSON without ever rendering. Drawings must already be
 * time-anchored (see `rebaseDrawingsToTime`). Hlines and tables are
 * timeless and pass through.
 */
export function trimVisualsToWindow(
  visuals: NormalizedPineVisuals,
  windowStartMs: number,
): NormalizedPineVisuals {
  return {
    overlays: visuals.overlays.map((overlay) => ({
      ...overlay,
      data: overlay.data.filter((point) => point.t >= windowStartMs),
    })),
    drawings: visuals.drawings.filter((drawing) => drawingMaxTime(drawing) >= windowStartMs),
    tables: visuals.tables,
    hlines: visuals.hlines,
    fills: visuals.fills.map((fill) => ({
      ...fill,
      points: fill.points.filter((point) => point.t >= windowStartMs),
    })),
    bgColors: visuals.bgColors.filter((entry) => entry.t >= windowStartMs),
    barColors: visuals.barColors.filter((entry) => entry.t >= windowStartMs),
  };
}
