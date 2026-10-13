// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
/**
 * Self-contained type definitions for the Pine runner package.
 *
 * This package is published under AGPL-3.0 and MUST NOT import anything from
 * outside `pine-runner/` (enforced by the self-containment test). These types
 * are intentionally duplicated from the host app rather than shared, so the
 * runner can be extracted and built on its own.
 */

export interface OhlcvBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface PineCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PineChartPoint {
  t: number;
  y: number;
  color?: string;
}

export type PineOverlayStyle =
  | 'line'
  | 'stepline'
  | 'area'
  | 'columns'
  | 'histogram'
  | 'circles'
  | 'cross'
  | 'linebr';

export interface PineChartOverlay {
  kind: 'line' | 'histogram';
  id: string;
  name: string;
  color?: string;
  overlay: boolean;
  data: PineChartPoint[];
  style?: PineOverlayStyle;
  linewidth?: number;
  hasPerPointColor?: boolean;
}

export interface PineChartHline {
  id: string;
  title: string;
  price: number;
  color?: string;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
}

export interface PineChartFillBand {
  id: string;
  color?: string;
  points: Array<{ t: number; y1: number; y2: number }>;
}

export interface PineChartBarColor {
  t: number;
  color: string;
}

export interface PineChartLineDrawing {
  kind: 'line';
  /** Drawn on the price pane by a script that lives in its own pane (`force_overlay`). */
  forceOverlay?: boolean;
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  xloc: string;
  color?: string;
  style?: string;
  width?: number;
}

export interface PineChartBoxDrawing {
  kind: 'box';
  /** Drawn on the price pane by a script that lives in its own pane (`force_overlay`). */
  forceOverlay?: boolean;
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  xloc: string;
  borderColor?: string;
  borderStyle?: string;
  borderWidth?: number;
  backgroundColor?: string;
  text?: string;
  textColor?: string;
}

export interface PineChartLabelDrawing {
  kind: 'label';
  /** Drawn on the price pane by a script that lives in its own pane (`force_overlay`). */
  forceOverlay?: boolean;
  id: string;
  x: number;
  y: number;
  xloc: string;
  yloc: string;
  text: string;
  color?: string;
  textColor?: string;
  style?: string;
  size?: string;
}

export interface PineChartPolylinePoint {
  x: number;
  y: number;
}

export interface PineChartPolylineDrawing {
  kind: 'polyline';
  id: string;
  points: PineChartPolylinePoint[];
  curved: boolean;
  closed: boolean;
  xloc: string;
  lineColor?: string;
  fillColor?: string;
  lineStyle?: string;
  lineWidth?: number;
}

export interface PineChartShapeDrawing {
  kind: 'shape';
  id: string;
  t: number;
  y: number;
  location: string;
  shape?: string;
  text?: string;
  color?: string;
  size?: string;
}

export interface PineChartLinefillDrawing {
  kind: 'linefill';
  id: string;
  line1: Omit<PineChartLineDrawing, 'kind'>;
  line2: Omit<PineChartLineDrawing, 'kind'>;
  color?: string;
}

export type PineChartDrawing =
  | PineChartLineDrawing
  | PineChartBoxDrawing
  | PineChartLabelDrawing
  | PineChartPolylineDrawing
  | PineChartShapeDrawing
  | PineChartLinefillDrawing;

export interface PineChartTableCell {
  text: string;
  textColor?: string;
  backgroundColor?: string;
}

export interface PineChartTable {
  id: string;
  position: string;
  columns: number;
  rows: number;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  cells: Array<Array<PineChartTableCell | null>>;
}

// --- Settings schema (mirrors the engine's Indicator introspection) ---

export type PineInputType =
  | 'int'
  | 'float'
  | 'bool'
  | 'string'
  | 'source'
  | 'color'
  | 'enum'
  | 'price'
  | 'time'
  | 'session'
  | 'symbol'
  | 'timeframe'
  | 'text_area';

export type PineInputDisplay = 'none' | 'data_window' | 'status_line' | 'all';

export interface IPineInput {
  type: PineInputType;
  defval: unknown;
  varId?: string;
  title?: string;
  tooltip?: string;
  group?: string;
  display?: PineInputDisplay;
  active?: boolean;
  confirm?: boolean;
  inline?: string;
  options?: unknown[];
  minval?: number;
  maxval?: number;
  step?: number;
}

export type PinePropType = 'string' | 'int' | 'float' | 'bool' | 'enum';

export interface IPineProp {
  name: string;
  type: PinePropType;
  defval: unknown;
  options?: unknown[];
  minval?: number;
  maxval?: number;
  mutable: boolean;
  appliesTo: 'indicator' | 'strategy' | 'both';
  version?: 5 | 6;
}

export type PineDeclarationType = 'indicator' | 'strategy' | null;

export interface PineSettingsSchema {
  declarationType: PineDeclarationType;
  inputs: IPineInput[];
  props: IPineProp[];
  error?: string;
}

export interface PineSettingsOverrides {
  inputs?: Record<string, unknown>;
  props?: Record<string, unknown>;
}

export interface PineStaleKeys {
  inputs: string[];
  props: string[];
}

export interface ResolvedPineSettings {
  schema: PineSettingsSchema;
  applied: Required<PineSettingsOverrides>;
  stale: PineStaleKeys;
  isModified: boolean;
}

/** Static symbol metadata handed to the engine's `syminfo` built-in. */
export interface PineSymbolInfo {
  current_contract: string;
  description: string;
  isin: string;
  main_tickerid: string;
  prefix: string;
  root: string;
  ticker: string;
  tickerid: string;
  type: string;
  basecurrency: string;
  country: string;
  currency: string;
  timezone: string;
  employees: number;
  industry: string;
  sector: string;
  shareholders: number;
  shares_outstanding_float: number;
  shares_outstanding_total: number;
  expiration_date: number;
  session: string;
  volumetype: string;
  mincontract: number;
  minmove: number;
  mintick: number;
  pointvalue: number;
  pricescale: number;
  recommendations_buy: number;
  recommendations_buy_strong: number;
  recommendations_date: number;
  recommendations_hold: number;
  recommendations_sell: number;
  recommendations_sell_strong: number;
  recommendations_total: number;
  target_price_average: number;
  target_price_date: number;
  target_price_estimates: number;
  target_price_high: number;
  target_price_low: number;
  target_price_median: number;
}
