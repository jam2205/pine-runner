import { describe, expect, it } from 'vitest';

import {
  normalizePineBarColors,
  normalizePineBgColors,
  normalizePineDrawings,
  normalizePineFills,
  normalizePineHlines,
  normalizePinePlots,
  normalizePineShapeDrawings,
  normalizePineTables,
  normalizePineVisuals,
  rebaseDrawingsToTime,
  toPineCandles,
  trimVisualsToWindow,
} from '../src/normalize';

const candles = [
  { t: 1_000, o: 10, h: 12, l: 9, c: 11, v: 100 },
  { t: 2_000, o: 11, h: 13, l: 10, c: 12, v: 200 },
  { t: 3_000, o: 12, h: 14, l: 11, c: 13, v: 300 },
];

describe('toPineCandles', () => {
  it('maps QuantPad OHLCV bars to Pine custom candle data', () => {
    expect(toPineCandles(candles, 1_000)).toEqual([
      { openTime: 1_000, closeTime: 2_000, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { openTime: 2_000, closeTime: 3_000, open: 11, high: 13, low: 10, close: 12, volume: 200 },
      { openTime: 3_000, closeTime: 4_000, open: 12, high: 14, low: 11, close: 13, volume: 300 },
    ]);
  });
});

describe('normalizePinePlots', () => {
  it('normalizes object plot data with explicit times', () => {
    const overlays = normalizePinePlots(
      {
        EMA: {
          title: 'EMA 9',
          color: '#0ea5e9',
          data: [
            { time: 1, value: 10.5 },
            { time: 2, value: 11.5 },
          ],
        },
      },
      candles,
    );

    expect(overlays).toMatchObject([
      {
        kind: 'line',
        id: 'ema_9',
        name: 'EMA 9',
        color: '#0ea5e9',
        overlay: true,
        data: [
          { t: 1_000, y: 10.5 },
          { t: 2_000, y: 11.5 },
        ],
      },
    ]);
  });

  it('aligns numeric plot arrays to the tail of candle data', () => {
    const overlays = normalizePinePlots({ RSI: [48, 51] }, candles);
    expect(overlays[0]).toMatchObject({
      kind: 'line',
      id: 'rsi',
      name: 'RSI',
      data: [
        { t: 2_000, y: 48 },
        { t: 3_000, y: 51 },
      ],
    });
  });

  it('marks histogram-like plot styles as histograms', () => {
    const overlays = normalizePinePlots(
      {
        Hist: {
          style: 'plot.style_histogram',
          data: [{ t: 3_000, y: -1.5 }],
        },
      },
      candles,
    );
    expect(overlays[0]?.kind).toBe('histogram');
  });

  it('does not render plotshape boolean values as zero-price line overlays', () => {
    const visuals = normalizePineVisuals(
      {
        Close: {
          data: [{ time: 1_000, value: 11 }],
        },
        'Long Signal': {
          options: {
            style: 'shape',
            location: 'BelowBar',
            color: '#4CAF50FF',
            size: 'tiny',
            text: '▲',
            shape: 'shape_triangle_up',
          },
          data: [
            { time: 1_000, value: false },
            {
              time: 2_000,
              value: true,
              options: {
                text: '▲',
                color: '#4CAF50FF',
                shape: 'shape_triangle_up',
                location: 'BelowBar',
                size: 'tiny',
              },
            },
          ],
        },
      },
      candles,
    );

    expect(visuals.overlays.map((overlay) => overlay.name)).toEqual(['Close']);
    expect(visuals.drawings).toContainEqual({
      kind: 'shape',
      id: 'shape_long_signal_1',
      t: 2_000_000,
      y: 11,
      location: 'BelowBar',
      shape: 'shape_triangle_up',
      text: '▲',
      color: '#4CAF50FF',
      size: 'tiny',
    });
  });
});

describe('normalizePineDrawings', () => {
  it('extracts engine drawing objects from internal plot collections', () => {
    const drawings = normalizePineDrawings({
      __boxes__: {
        data: [
          {
            value: [
              {
                id: 1,
                left: 1,
                top: 104,
                right: 3,
                bottom: 101,
                xloc: 'bi',
                border_color: '#F23645',
                border_width: 2,
                bgcolor: '#2196F333',
                text: 'Zone',
                text_color: '#FFFFFF',
                _deleted: false,
              },
            ],
          },
        ],
      },
      __lines__: {
        data: [
          {
            value: [
              {
                id: 2,
                x1: 0,
                y1: 100,
                x2: 2,
                y2: 105,
                xloc: 'bi',
                color: '#4CAF50',
                width: 3,
                _deleted: false,
              },
            ],
          },
        ],
      },
      __labels__: {
        data: [
          {
            value: [
              {
                id: 3,
                x: 2,
                y: 103,
                xloc: 'bi',
                yloc: 'pr',
                text: 'Here',
                color: '#FDD835',
                textcolor: '#363A45',
                _deleted: false,
              },
            ],
          },
        ],
      },
    });

    expect(drawings).toEqual([
      {
        kind: 'box',
        id: 'box_1',
        left: 1,
        top: 104,
        right: 3,
        bottom: 101,
        xloc: 'bi',
        borderColor: '#F23645',
        borderStyle: undefined,
        borderWidth: 2,
        backgroundColor: '#2196F333',
        text: 'Zone',
        textColor: '#FFFFFF',
      },
      {
        kind: 'line',
        id: 'line_2',
        x1: 0,
        y1: 100,
        x2: 2,
        y2: 105,
        xloc: 'bi',
        color: '#4CAF50',
        style: undefined,
        width: 3,
      },
      {
        kind: 'label',
        id: 'label_3',
        x: 2,
        y: 103,
        xloc: 'bi',
        yloc: 'pr',
        text: 'Here',
        color: '#FDD835',
        textColor: '#363A45',
        style: undefined,
        size: undefined,
      },
    ]);
  });

  it('extracts polyline and linefill drawings', () => {
    const drawings = normalizePineDrawings({
      __linefills__: {
        data: [
          {
            value: [
              {
                id: 1,
                line1: { id: 10, x1: 0, y1: 100, x2: 2, y2: 103, xloc: 'bi' },
                line2: { id: 11, x1: 0, y1: 98, x2: 2, y2: 99, xloc: 'bi' },
                color: '#2196F326',
                _deleted: false,
              },
            ],
          },
        ],
      },
      __polylines__: {
        data: [
          {
            value: [
              {
                id: 2,
                points: [
                  { index: 0, price: 100 },
                  { index: 1, price: 104 },
                  { index: 2, price: 101 },
                ],
                curved: false,
                closed: false,
                xloc: 'bi',
                line_color: '#FF9800',
                line_width: 2,
                _deleted: false,
              },
            ],
          },
        ],
      },
    });

    expect(drawings[0]).toMatchObject({
      kind: 'linefill',
      id: 'linefill_1',
      color: '#2196F326',
    });
    expect(drawings[1]).toMatchObject({
      kind: 'polyline',
      id: 'polyline_2',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 104 },
        { x: 2, y: 101 },
      ],
      lineColor: '#FF9800',
      lineWidth: 2,
    });
  });
});

describe('normalizePinePlots visual fidelity', () => {
  it('captures per-point conditional colors, base color, style and linewidth', () => {
    const overlays = normalizePinePlots(
      {
        E: {
          options: { color: '#F23645', style: 'style_stepline', linewidth: 2 },
          data: [
            { title: 'E', time: 1_000, value: 10, options: { color: '#F23645' } },
            { title: 'E', time: 2_000, value: 11, options: { color: '#4CAF50' } },
            { title: 'E', time: 3_000, value: 12, options: { color: '#4CAF50' } },
          ],
        },
      },
      candles,
    );

    expect(overlays[0]).toMatchObject({
      name: 'E',
      color: '#F23645',
      style: 'stepline',
      linewidth: 2,
      hasPerPointColor: true,
    });
    // Point matching the base color carries no per-point override.
    expect(overlays[0].data[0]).toEqual({ t: 1_000_000, y: 10 });
    // Differing point carries its own color.
    expect(overlays[0].data[1]).toEqual({ t: 2_000_000, y: 11, color: '#4CAF50' });
  });

  it('excludes display:none plots from overlays', () => {
    const overlays = normalizePinePlots(
      {
        hidden: {
          options: { display: 'none' },
          data: [{ time: 1_000, value: 10 }],
        },
      },
      candles,
    );
    expect(overlays).toEqual([]);
  });
});

describe('normalizePineHlines', () => {
  it('extracts a horizontal price line with dashed style', () => {
    const hlines = normalizePineHlines({
      Ceiling: {
        options: { color: '#787B86', linestyle: 'dashed', style: 'hline' },
        data: [{ title: 'Ceiling', time: 1_000, value: 105, options: { color: '#787B86' } }],
      },
    });
    expect(hlines).toEqual([
      { id: 'ceiling', title: 'Ceiling', price: 105, color: '#787B86', lineStyle: 'dashed' },
    ]);
  });
});

describe('normalizePineFills', () => {
  it('builds a band between two referenced plot series', () => {
    const plots = {
      f: { options: { display: 'none' }, data: [{ time: 1_000, value: 10 }, { time: 2_000, value: 12 }] },
      s: { options: { display: 'none' }, data: [{ time: 1_000, value: 8 }, { time: 2_000, value: 9 }] },
      fill: {
        options: { plot1: 'f', plot2: 's', color: '#2196F326', style: 'fill' },
        data: [{ time: 1_000, value: null }, { time: 2_000, value: null }],
      },
    };
    const fills = normalizePineFills(plots, candles);
    expect(fills[0]).toMatchObject({ color: '#2196F326' });
    expect(fills[0].points).toEqual([
      { t: 1_000_000, y1: 10, y2: 8 },
      { t: 2_000_000, y1: 12, y2: 9 },
    ]);
  });
});

describe('normalizePineBgColors / normalizePineBarColors', () => {
  it('extracts background bands only for colored bars', () => {
    const bg = normalizePineBgColors({
      plot: {
        options: { color: '#4CAF501A', style: 'background' },
        data: [
          { time: 1_000, value: true, options: { color: '#4CAF501A' } },
          { time: 2_000, value: null, options: { color: null } },
          { time: 3_000, value: true, options: { color: '#4CAF501A' } },
        ],
      },
    });
    expect(bg).toEqual([
      { t: 1_000_000, color: '#4CAF501A' },
      { t: 3_000_000, color: '#4CAF501A' },
    ]);
  });

  it('extracts per-bar barcolor overrides', () => {
    const bars = normalizePineBarColors({
      plot: {
        options: { color: '#00E676', style: 'barcolor' },
        data: [
          { time: 1_000, value: true, options: { color: '#00E676' } },
          { time: 2_000, value: true, options: { color: '#F23645' } },
        ],
      },
    });
    expect(bars).toEqual([
      { t: 1_000_000, color: '#00E676' },
      { t: 2_000_000, color: '#F23645' },
    ]);
  });
});

describe('normalizePineShapeDrawings arrows and chars', () => {
  it('renders plotarrow signed values as directional shapes, skipping zero', () => {
    const drawings = normalizePineShapeDrawings(
      {
        Arrow: {
          options: { colorup: '#4CAF50', colordown: '#F23645', style: 'shape' },
          data: [
            { title: 'Arrow', time: 1_000, value: 1, options: { color: '#4CAF50', shape: 'shape_arrow_up', location: 'BelowBar' } },
            { title: 'Arrow', time: 2_000, value: -1, options: { color: '#F23645', shape: 'shape_arrow_down', location: 'AboveBar' } },
            { title: 'Arrow', time: 3_000, value: 0, options: { color: '#4CAF50', shape: 'shape_arrow_up', location: 'BelowBar' } },
          ],
        },
      },
      candles,
    );
    expect(drawings).toHaveLength(2);
    expect(drawings[0]).toMatchObject({ kind: 'shape', shape: 'shape_arrow_up', location: 'BelowBar', y: 9 });
    expect(drawings[1]).toMatchObject({ kind: 'shape', shape: 'shape_arrow_down', location: 'AboveBar', y: 13 });
  });

  it('renders plotchar glyphs from the char option', () => {
    const drawings = normalizePineShapeDrawings(
      {
        Cross: {
          options: { char: '✚', location: 'BelowBar', color: '#FF9800', style: 'char' },
          data: [
            { title: 'Cross', time: 1_000, value: false },
            { title: 'Cross', time: 2_000, value: true, options: { char: '✚', color: '#FF9800', location: 'BelowBar' } },
          ],
        },
      },
      candles,
    );
    expect(drawings).toHaveLength(1);
    expect(drawings[0]).toMatchObject({ kind: 'shape', text: '✚', color: '#FF9800', location: 'BelowBar' });
  });
});

describe('rebaseDrawingsToTime', () => {
  // Ten 1-minute bars starting at t=60_000.
  const bars = Array.from({ length: 10 }, (_, i) => ({
    t: (i + 1) * 60_000,
    o: 10,
    h: 11,
    l: 9,
    c: 10,
    v: 1,
  }));

  it('converts bar_index anchors to epoch time and marks them as time-based', () => {
    const rebased = rebaseDrawingsToTime(
      [
        {
          kind: 'box',
          id: 'box_1',
          left: 2,
          top: 12,
          right: 5,
          bottom: 8,
          xloc: 'bi',
        },
        { kind: 'label', id: 'label_1', x: 4, y: 10, xloc: 'bar_index', yloc: 'pr', text: 'hi' },
      ],
      bars,
      60_000,
    );
    expect(rebased[0]).toMatchObject({ left: 180_000, right: 360_000, xloc: 'time' });
    expect(rebased[1]).toMatchObject({ x: 300_000, xloc: 'time' });
  });

  it('extrapolates past the last bar and leaves time-anchored drawings alone', () => {
    const rebased = rebaseDrawingsToTime(
      [
        { kind: 'line', id: 'l1', x1: 9, y1: 10, x2: 12, y2: 11, xloc: 'bi' },
        { kind: 'line', id: 'l2', x1: 120_000, y1: 10, x2: 180_000, y2: 11, xloc: 'time' },
        { kind: 'shape', id: 's1', t: 120_000, y: 10, location: 'abovebar' },
      ],
      bars,
      60_000,
    );
    // index 12 is 3 bars past the last (index 9, t=600_000) → 780_000
    expect(rebased[0]).toMatchObject({ x1: 600_000, x2: 780_000, xloc: 'time' });
    expect(rebased[1]).toMatchObject({ x1: 120_000, x2: 180_000, xloc: 'time' });
    expect(rebased[2]).toMatchObject({ t: 120_000 });
  });
});

describe('trimVisualsToWindow', () => {
  it('drops per-bar visuals before the display window and keeps timeless ones', () => {
    const trimmed = trimVisualsToWindow(
      {
        overlays: [
          {
            kind: 'line',
            id: 'ema',
            name: 'EMA',
            overlay: true,
            data: [
              { t: 100, y: 1 },
              { t: 200, y: 2 },
              { t: 300, y: 3 },
            ],
          },
        ],
        drawings: [
          { kind: 'shape', id: 'old', t: 100, y: 1, location: 'abovebar' },
          { kind: 'shape', id: 'new', t: 250, y: 2, location: 'abovebar' },
          // Box straddling the window boundary must survive.
          { kind: 'box', id: 'straddle', left: 100, top: 2, right: 250, bottom: 1, xloc: 'time' },
        ],
        tables: [
          {
            id: 'table_1',
            position: 'top_right',
            columns: 1,
            rows: 1,
            cells: [[{ text: 'x' }]],
          },
        ],
        hlines: [{ id: 'h1', title: 'Zero', price: 0 }],
        fills: [
          {
            id: 'f1',
            points: [
              { t: 100, y1: 1, y2: 2 },
              { t: 300, y1: 1, y2: 2 },
            ],
          },
        ],
        bgColors: [
          { t: 100, color: '#ff0000' },
          { t: 300, color: '#00ff00' },
        ],
        barColors: [{ t: 100, color: '#0000ff' }],
      },
      200,
    );

    expect(trimmed.overlays[0].data.map((p) => p.t)).toEqual([200, 300]);
    expect(trimmed.drawings.map((d) => d.id)).toEqual(['new', 'straddle']);
    expect(trimmed.tables).toHaveLength(1);
    expect(trimmed.hlines).toHaveLength(1);
    expect(trimmed.fills[0].points.map((p) => p.t)).toEqual([300]);
    expect(trimmed.bgColors.map((c) => c.t)).toEqual([300]);
    expect(trimmed.barColors).toEqual([]);
  });
});

describe('normalizePineTables', () => {
  it('extracts engine table data from internal plot collections', () => {
    const tables = normalizePineTables({
      __tables__: {
        data: [
          {
            value: [
              {
                id: 1,
                position: 'top_right',
                columns: 2,
                rows: 1,
                bgcolor: '#363A45FF',
                border_color: '#FFFFFF',
                cells: [
                  [
                    { text: 'Metric', text_color: '#FFFFFF', bgcolor: '' },
                    { text: 'Value', text_color: '#FFFFFF', bgcolor: '#000000' },
                  ],
                ],
                _deleted: false,
              },
            ],
          },
        ],
      },
    });

    expect(tables).toEqual([
      {
        id: 'table_1',
        position: 'top_right',
        columns: 2,
        rows: 1,
        backgroundColor: '#363A45FF',
        borderColor: '#FFFFFF',
        borderWidth: undefined,
        cells: [
          [
            { text: 'Metric', textColor: '#FFFFFF', backgroundColor: undefined },
            { text: 'Value', textColor: '#FFFFFF', backgroundColor: '#000000' },
          ],
        ],
      },
    ]);
  });
});
