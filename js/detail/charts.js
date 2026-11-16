// Draws <figure class="chart" data-chart='{...}'> as inline SVG (PLAN 7.2).
//
// JSON shape
//   type        "bar" | "line" | "step"
//   series      [{ name, tone, values: [number|null], labels?: [string], dash?: true, x?: [...] }]
//   categories  bar: the category names            (bar)
//   x           line/step: x values (numbers, or strings for evenly spaced points)
//   unit        unit of the values, e.g. "VAR"
//   xLabel, yLabel, xUnit
//   target      { value, label }  drawn as a dashed line
//   yMin, yMax  optional axis limits (yMin is ignored for bars, which always start at zero)
//   orientation bar only: "vertical" | "horizontal" (default: vertical when the labels fit)
//   labels      bar only: false hides the value labels on the bars
//   title       optional accessible title (default: the figcaption text)
// tone: ac | dc | ctl | inv1 | inv2 | warn | ink | home | muted (colours come from css/tokens.css)
//
// The SVG is drawn at the real pixel width of the figure (viewBox = that size),
// so text stays 12 px on a phone, and it is redrawn when the width changes.

const NS = 'http://www.w3.org/2000/svg';
const TONES = ['ac', 'dc', 'ctl', 'inv1', 'inv2', 'warn', 'ink', 'home', 'muted'];
const TONE_ORDER = ['ac', 'dc', 'ctl', 'inv1', 'inv2', 'warn', 'ink'];
const MINUS = '−';
let uid = 0;

/* ---------- helpers ---------- */

function svg(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}

function html(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

const isNum = v => typeof v === 'number' && isFinite(v);
const r1 = v => Math.round(v * 10) / 10;

function decimalsOf(v) {
  if (!isNum(v)) return 0;
  const s = String(Math.abs(v));
  if (s.includes('e-')) return Math.min(6, parseInt(s.split('e-')[1], 10));
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(6, s.length - i - 1);
}

function fmt(v, decimals) {
  if (!isNum(v)) return 'no data';
  const d = decimals == null ? decimalsOf(v) : decimals;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (v < 0 && Number(Math.abs(v).toFixed(d)) !== 0 ? MINUS : '') + s;
}

// "Nice" axis ticks (1, 2, 2.5, 5 x 10^n).
function niceTicks(min, max, count) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 3.5 ? 2.5 : norm < 7.5 ? 5 : 10) * mag;
  const start = Math.floor(min / step + 1e-9) * step;
  const end = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 1e-6; v += step) ticks.push(Number(v.toPrecision(12)));
  return { ticks, step, min: start, max: end };
}

let measureCtx = null;
function textWidth(text, font) {
  if (measureCtx === null) {
    try { measureCtx = document.createElement('canvas').getContext('2d'); } catch (e) { measureCtx = false; }
  }
  if (!measureCtx) return String(text).length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(String(text)).width;
}

// Break a label into at most `maxLines` lines that fit `width`. Returns null if it cannot.
function wrapLabel(text, width, font, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const tryLine = line ? line + ' ' + word : word;
    if (textWidth(tryLine, font) <= width) { line = tryLine; continue; }
    if (line) lines.push(line);
    if (textWidth(word, font) > width) return null;
    line = word;
  }
  if (line) lines.push(line);
  return lines.length <= maxLines ? lines : null;
}

function ellipsize(text, width, font) {
  let s = String(text);
  if (textWidth(s, font) <= width) return s;
  while (s.length > 1 && textWidth(s + '…', font) > width) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}

/* ---------- spec ---------- */

function readSpec(fig) {
  let raw;
  try {
    raw = JSON.parse(fig.dataset.chart);
  } catch (err) {
    return { error: 'The chart data is not valid JSON.' };
  }
  if (!raw || typeof raw !== 'object') return { error: 'The chart data is empty.' };
  const type = ['bar', 'line', 'step'].includes(raw.type) ? raw.type : 'bar';
  const seriesIn = Array.isArray(raw.series) ? raw.series : [];
  if (!seriesIn.length) return { error: 'The chart has no series.' };

  const used = new Set();
  const series = seriesIn.map((s, i) => {
    let tone = TONES.includes(s.tone) ? s.tone : null;
    if (!tone) tone = TONE_ORDER.find(t => !used.has(t)) || 'ink';
    used.add(tone);
    const values = (Array.isArray(s.values) ? s.values : []).map(v => (isNum(v) ? v : (v == null || v === '' || isNaN(Number(v)) ? null : Number(v))));
    return {
      name: s.name != null ? String(s.name) : 'Series ' + (i + 1),
      tone,
      values,
      labels: Array.isArray(s.labels) ? s.labels.map(String) : null,
      dash: !!s.dash,
      x: Array.isArray(s.x) ? s.x : null,
      decimals: Math.min(4, Math.max(0, ...values.map(decimalsOf)))
    };
  });

  const n = Math.max(...series.map(s => s.values.length));
  let cats;
  if (type === 'bar') {
    cats = (Array.isArray(raw.categories) ? raw.categories : Array.isArray(raw.x) ? raw.x : []).map(String);
    while (cats.length < n) cats.push(String(cats.length + 1));
  } else {
    cats = Array.isArray(raw.x) ? raw.x.slice() : Array.isArray(raw.categories) ? raw.categories.slice() : [];
    while (cats.length < n) cats.push(cats.length + 1);
  }
  if (!n) return { error: 'The chart has no values.' };

  const target = raw.target && isNum(Number(raw.target.value))
    ? { value: Number(raw.target.value), label: raw.target.label != null ? String(raw.target.label) : '' }
    : null;

  return {
    type, series, cats, n, target,
    unit: raw.unit ? String(raw.unit) : '',
    xUnit: raw.xUnit ? String(raw.xUnit) : '',
    xLabel: raw.xLabel ? String(raw.xLabel) : '',
    yLabel: raw.yLabel ? String(raw.yLabel) : '',
    yMin: isNum(raw.yMin) ? raw.yMin : null,
    yMax: isNum(raw.yMax) ? raw.yMax : null,
    orientation: raw.orientation === 'horizontal' || raw.orientation === 'vertical' ? raw.orientation : 'auto',
    showLabels: raw.labels !== false,
    title: raw.title ? String(raw.title) : ''
  };
}

function valueLabel(s, i) {
  if (s.labels && s.labels[i] != null) return s.labels[i];
  return fmt(s.values[i], s.decimals);
}

function describe(spec, title) {
  const kind = spec.type === 'bar' ? 'Bar chart' : spec.type === 'step' ? 'Step chart' : 'Line chart';
  const unit = spec.unit ? ' ' + spec.unit : '';
  const parts = [kind + (spec.yLabel ? ' of ' + spec.yLabel : '') + (spec.unit ? ', in ' + spec.unit : '') + '.'];
  spec.series.forEach(s => {
    const pts = s.values.map((v, i) => ({ v, i })).filter(p => p.v != null);
    if (!pts.length) return;
    const xAt = i => String((s.x || spec.cats)[i]);
    if (pts.length <= 8) {
      parts.push(s.name + ': ' + pts.map(p => xAt(p.i) + ' ' + valueLabel(s, p.i) + unit).join(', ') + '.');
    } else {
      const lo = pts.reduce((a, b) => (b.v < a.v ? b : a));
      const hi = pts.reduce((a, b) => (b.v > a.v ? b : a));
      const first = pts[0];
      const last = pts[pts.length - 1];
      parts.push(s.name + ': ' + pts.length + ' points, from ' + valueLabel(s, first.i) + unit + ' at ' + xAt(first.i) +
        ' to ' + valueLabel(s, last.i) + unit + ' at ' + xAt(last.i) +
        ', lowest ' + valueLabel(s, lo.i) + unit + ', highest ' + valueLabel(s, hi.i) + unit + '.');
    }
  });
  if (spec.target) parts.push('Reference line at ' + fmt(spec.target.value) + unit + (spec.target.label ? ' (' + spec.target.label + ')' : '') + '.');
  return parts.join(' ');
}

/* ---------- static parts: legend, data table ---------- */

function buildLegend(spec) {
  if (spec.series.length < 2) return null; // one series: the caption names it
  const ul = html('ul', 'chart-legend');
  spec.series.forEach(s => {
    const li = html('li');
    const key = html('span', 'key ' + (spec.type === 'bar' ? 'key-bar' : 'key-line') + ' tone-' + s.tone + (s.dash ? ' dash' : ''));
    key.setAttribute('aria-hidden', 'true');
    li.append(key, html('span', null, s.name));
    ul.append(li);
  });
  return ul;
}

function buildTable(spec, title) {
  const details = html('details', 'chart-data');
  details.append(html('summary', null, 'Data table'));
  const wrap = html('div', 'chart-data__scroll');
  const table = html('table');
  const cap = html('caption', null, title + (spec.unit ? ' (' + spec.unit + ')' : ''));
  table.append(cap);
  const thead = html('thead');
  const hr = html('tr');
  const corner = html('th', null, spec.type === 'bar' ? (spec.xLabel || 'Case') : (spec.xLabel || 'x') + (spec.xUnit ? ' (' + spec.xUnit + ')' : ''));
  corner.scope = 'col';
  hr.append(corner);
  spec.series.forEach(s => {
    const th = html('th', null, s.name + (spec.unit ? ' (' + spec.unit + ')' : ''));
    th.scope = 'col';
    hr.append(th);
  });
  thead.append(hr);
  const tbody = html('tbody');
  for (let i = 0; i < spec.n; i++) {
    const tr = html('tr');
    const th = html('th', null, String(spec.cats[i]));
    th.scope = 'row';
    tr.append(th);
    spec.series.forEach(s => tr.append(html('td', null, s.values[i] == null ? '' : valueLabel(s, i))));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  if (spec.target) {
    const tfoot = html('tfoot');
    const tr = html('tr');
    const th = html('th', null, spec.target.label || 'Reference line');
    th.scope = 'row';
    const td = html('td', null, fmt(spec.target.value));
    td.colSpan = spec.series.length;
    tr.append(th, td);
    tfoot.append(tr);
    table.append(tfoot);
  }
  wrap.append(table);
  details.append(wrap);
  return details;
}

/* ---------- drawing ---------- */

function fonts(fig) {
  const cs = getComputedStyle(fig);
  const sans = cs.getPropertyValue('--font-sans').trim() || 'sans-serif';
  const mono = cs.getPropertyValue('--font-mono').trim() || 'monospace';
  return { label: '12px ' + sans, tick: '11.5px ' + mono, value: '500 12px ' + mono };
}

function yDomain(spec, isBar) {
  let lo = Infinity;
  let hi = -Infinity;
  spec.series.forEach(s => s.values.forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (spec.target) { lo = Math.min(lo, spec.target.value); hi = Math.max(hi, spec.target.value); }
  if (isBar) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  else if (lo === hi) { lo -= 1; hi += 1; }
  else if (spec.yMin == null && lo > 0 && lo / hi < 0.35) lo = 0; // near zero anyway: show the baseline
  const userMin = spec.yMin != null && !(isBar && spec.yMin > 0) ? spec.yMin : null;
  const userMax = spec.yMax;
  if (userMin != null) lo = userMin;
  if (userMax != null) hi = userMax;
  if (hi <= lo) hi = lo + 1;
  return { lo, hi, userMin, userMax };
}

function axisTicks(dom, count) {
  const t = niceTicks(dom.lo, dom.hi, count);
  const min = dom.userMin != null ? dom.userMin : t.min;
  const max = dom.userMax != null ? dom.userMax : t.max;
  const ticks = t.ticks.filter(v => v >= min - 1e-9 && v <= max + 1e-9);
  return { ticks, min, max, decimals: Math.min(6, decimalsOf(Number(t.step.toPrecision(6)))) };
}

function barPath(x, y, w, h, r, dir) {
  // dir: 'up' | 'down' | 'right' | 'left' = the rounded (data) end. Square at the baseline.
  r = Math.max(0, Math.min(r, w / 2, h / 2, dir === 'up' || dir === 'down' ? h : w));
  const x2 = x + w;
  const y2 = y + h;
  if (dir === 'up') return `M${x} ${y2}V${y + r}Q${x} ${y} ${x + r} ${y}H${x2 - r}Q${x2} ${y} ${x2} ${y + r}V${y2}Z`;
  if (dir === 'down') return `M${x} ${y}V${y2 - r}Q${x} ${y2} ${x + r} ${y2}H${x2 - r}Q${x2} ${y2} ${x2} ${y2 - r}V${y}Z`;
  if (dir === 'right') return `M${x} ${y}H${x2 - r}Q${x2} ${y} ${x2} ${y + r}V${y2 - r}Q${x2} ${y2} ${x2 - r} ${y2}H${x}Z`;
  return `M${x2} ${y}H${x + r}Q${x} ${y} ${x} ${y + r}V${y2 - r}Q${x} ${y2} ${x + r} ${y2}H${x2}Z`;
}

function draw(state) {
  const { fig, spec, plot, ids, title } = state;
  const F = fonts(fig);
  const W = Math.max(240, Math.floor(plot.clientWidth));
  const isBar = spec.type === 'bar';
  const nS = spec.series.length;
  const axisTitle = [spec.yLabel, spec.unit ? (spec.yLabel ? '(' + spec.unit + ')' : spec.unit) : ''].filter(Boolean).join(' ');

  const dom = yDomain(spec, isBar);
  let horizontal = false;
  let catLines = null;
  let geo = {};

  /* layout decisions for bars */
  if (isBar) {
    const yT = axisTicks(dom, 4);
    const leftGuess = Math.max(...yT.ticks.map(t => textWidth(fmt(t, yT.decimals), F.tick))) + 12;
    const band = Math.min(200, (W - leftGuess - 14) / spec.n);
    if (spec.orientation !== 'horizontal') {
      const wrapped = spec.cats.map(c => wrapLabel(c, band - 10, F.label, 2));
      const fits = wrapped.every(Boolean) && band >= 34 + (nS - 1) * 12;
      if (fits) catLines = wrapped;
      else if (spec.orientation === 'vertical') catLines = spec.cats.map(c => wrapLabel(c, band - 6, F.label, 2) || [ellipsize(c, band - 6, F.label)]);
      else horizontal = true;
    } else {
      horizontal = true;
    }
  }

  const svgEl = svg('svg', { class: 'chart-svg', role: 'img', 'aria-labelledby': ids.title + ' ' + ids.desc });
  svg('title', { id: ids.title }, svgEl).textContent = title;
  svg('desc', { id: ids.desc }, svgEl).textContent = state.desc;

  const gGrid = svg('g', { class: 'grid' }, svgEl);
  const gHover = svg('g', { class: 'hover' }, svgEl);
  const gMarks = svg('g', { class: 'marks' }, svgEl);
  const gAxis = svg('g', { class: 'axis' }, svgEl);
  const gTop = svg('g', { class: 'top' }, svgEl);

  let H;
  const top = axisTitle ? 34 : 18;

  if (isBar && horizontal) {
    /* ----- horizontal bars ----- */
    const barH = nS > 1 ? 14 : 18;
    const rowH = nS * barH + (nS - 1) * 2 + 18;
    const labelMax = Math.min(W * 0.42, 220);
    const lines = spec.cats.map(c => wrapLabel(c, labelMax, F.label, 2) || [ellipsize(c, labelMax, F.label)]);
    const left = Math.max(...lines.map(ls => Math.max(...ls.map(l => textWidth(l, F.label))))) + 12;
    const labelPad = spec.showLabels ? Math.max(...spec.series.map(s => Math.max(0, ...s.values.map((v, i) => (v == null ? 0 : textWidth(valueLabel(s, i), F.value)))))) + 10 : 14;
    const right = Math.max(16, labelPad);
    const hasNeg = dom.lo < 0;
    const pw = Math.max(60, W - left - right - (hasNeg && spec.showLabels ? labelPad : 0));
    const px0 = left + (hasNeg && spec.showLabels ? labelPad : 0);
    const xT = axisTicks(dom, Math.max(2, Math.min(6, Math.floor(pw / 80))));
    const ph = spec.n * rowH;
    const bottom = 26 + (spec.xLabel ? 18 : 0);
    H = top + ph + bottom;
    const sx = v => px0 + ((v - xT.min) / (xT.max - xT.min)) * pw;
    const zero = sx(Math.max(xT.min, Math.min(0, xT.max)));

    xT.ticks.forEach(t => {
      const x = r1(sx(t));
      svg('line', { x1: x, x2: x, y1: top, y2: top + ph, class: t === 0 ? 'baseline' : 'gridline' }, gGrid);
      svg('text', { x, y: top + ph + 16, class: 'tick', 'text-anchor': 'middle' }, gAxis).textContent = fmt(t, xT.decimals);
    });
    if (axisTitle) svg('text', { x: px0, y: 14, class: 'axis-title' }, gAxis).textContent = axisTitle;
    if (spec.xLabel) svg('text', { x: px0 + pw / 2, y: H - 4, class: 'axis-title', 'text-anchor': 'middle' }, gAxis).textContent = spec.xLabel;

    const bands = [];
    for (let i = 0; i < spec.n; i++) {
      const y0 = top + i * rowH;
      bands.push(svg('rect', { x: 0, y: y0, width: W, height: rowH, class: 'band' }, gHover));
      const ls = lines[i];
      ls.forEach((l, k) => {
        svg('text', { x: left - 12, y: y0 + rowH / 2 + 4 + (k - (ls.length - 1) / 2) * 14, class: 'cat', 'text-anchor': 'end' }, gAxis).textContent = l;
      });
      spec.series.forEach((s, j) => {
        const v = s.values[i];
        if (v == null) return;
        const y = y0 + 9 + j * (barH + 2);
        const x1 = sx(Math.max(xT.min, Math.min(v, xT.max)));
        const w = Math.max(1, Math.abs(x1 - zero));
        svg('path', { d: barPath(r1(Math.min(x1, zero)), r1(y), r1(w), barH, 4, v >= 0 ? 'right' : 'left'), class: 'bar tone-' + s.tone }, gMarks);
        if (spec.showLabels) {
          svg('text', {
            x: r1(v >= 0 ? x1 + 6 : x1 - 6), y: r1(y + barH / 2 + 4), class: 'value',
            'text-anchor': v >= 0 ? 'start' : 'end'
          }, gTop).textContent = valueLabel(s, i);
        }
      });
    }
    if (spec.target) {
      const x = r1(sx(spec.target.value));
      svg('line', { x1: x, x2: x, y1: top - 4, y2: top + ph, class: 'target' }, gTop);
      if (spec.target.label) {
        const tw = textWidth(spec.target.label, F.label);
        const anchor = x + tw + 6 > W ? 'end' : 'start';
        svg('text', { x: anchor === 'start' ? x + 6 : x - 6, y: top - 8, class: 'target-label', 'text-anchor': anchor }, gTop).textContent = spec.target.label;
      }
    }
    geo = { kind: 'rows', top, rowH, bands, n: spec.n, anchor: i => ({ x: px0 + pw / 2, y: top + i * rowH }) };
  } else {
    /* ----- vertical bars, lines, steps ----- */
    const height = Math.round(Math.max(230, Math.min(380, W * 0.52)));
    const catRows = isBar ? Math.max(...catLines.map(l => l.length)) : 1;
    const bottom = 12 + catRows * 15 + (spec.xLabel ? 20 : 0) + 4;
    H = height;
    const ph = H - top - bottom;
    const yT = axisTicks(dom, Math.max(2, Math.min(6, Math.round(ph / 48))));
    const left = Math.max(...yT.ticks.map(t => textWidth(fmt(t, yT.decimals), F.tick))) + 12;
    const targetW = spec.target && spec.target.label ? textWidth(spec.target.label, F.label) : 0;
    const right = 14;
    let pw = W - left - right;
    if (isBar) pw = Math.min(pw, spec.n * 200);
    const sy = v => top + (1 - (v - yT.min) / (yT.max - yT.min)) * ph;
    const zeroY = sy(Math.max(yT.min, Math.min(0, yT.max)));

    yT.ticks.forEach(t => {
      const y = r1(sy(t));
      svg('line', { x1: left, x2: left + pw, y1: y, y2: y, class: t === 0 || (t === yT.min && !isBar && yT.min > 0 === false && t === yT.ticks[0] && dom.lo >= 0) ? 'baseline' : 'gridline' }, gGrid);
      svg('text', { x: left - 8, y: y + 4, class: 'tick', 'text-anchor': 'end' }, gAxis).textContent = fmt(t, yT.decimals);
    });
    if (axisTitle) svg('text', { x: 0, y: 13, class: 'axis-title' }, gAxis).textContent = axisTitle;
    if (spec.xLabel) {
      svg('text', { x: left + pw / 2, y: H - 5, class: 'axis-title', 'text-anchor': 'middle' }, gAxis).textContent =
        spec.xLabel + (spec.xUnit ? ' (' + spec.xUnit + ')' : '');
    }

    if (isBar) {
      const band = pw / spec.n;
      const gap = 2;
      const barW = Math.max(3, Math.min(nS > 1 ? 24 : 32, (band * 0.72 - gap * (nS - 1)) / nS));
      const groupW = nS * barW + (nS - 1) * gap;
      const showValues = spec.showLabels && spec.series.every(s => s.values.every((v, i) => v == null || textWidth(valueLabel(s, i), F.value) <= (nS > 1 ? barW + gap + 6 : band - 6)));
      const bands = [];
      for (let i = 0; i < spec.n; i++) {
        const bx = left + i * band;
        bands.push(svg('rect', { x: r1(bx), y: top - 6, width: r1(band), height: ph + 6, class: 'band' }, gHover));
        catLines[i].forEach((l, k) => {
          svg('text', { x: r1(bx + band / 2), y: top + ph + 18 + k * 15, class: 'cat', 'text-anchor': 'middle' }, gAxis).textContent = l;
        });
        spec.series.forEach((s, j) => {
          const v = s.values[i];
          if (v == null) return;
          const x = bx + (band - groupW) / 2 + j * (barW + gap);
          const y1 = sy(Math.max(yT.min, Math.min(v, yT.max)));
          const h = Math.max(1, Math.abs(zeroY - y1));
          svg('path', { d: barPath(r1(x), r1(Math.min(y1, zeroY)), r1(barW), r1(h), 4, v >= 0 ? 'up' : 'down'), class: 'bar tone-' + s.tone }, gMarks);
          if (showValues) {
            svg('text', { x: r1(x + barW / 2), y: r1(v >= 0 ? y1 - 7 : y1 + 15), class: 'value', 'text-anchor': 'middle' }, gTop).textContent = valueLabel(s, i);
          }
        });
      }
      geo = { kind: 'cols', left, band, bands, n: spec.n, anchor: i => ({ x: left + (i + 0.5) * band, y: top }) };
    } else {
      /* x scale: numeric if every x is a number, otherwise evenly spaced points */
      const allX = spec.series.some(s => s.x) ? spec.series.flatMap(s => s.x || spec.cats.slice(0, s.values.length)) : spec.cats;
      const numeric = allX.every(v => isNum(v) || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))));
      let sx;
      let xTicks = [];
      if (numeric) {
        const xs = allX.map(Number);
        const xmin = Math.min(...xs);
        const xmax = Math.max(...xs);
        const span = xmax - xmin || 1;
        sx = v => left + ((Number(v) - xmin) / span) * pw;
        const t = niceTicks(xmin, xmax, Math.max(2, Math.min(8, Math.floor(pw / 90))));
        const dec = Math.min(6, decimalsOf(Number(t.step.toPrecision(6))));
        xTicks = t.ticks.filter(v => v >= xmin - 1e-9 && v <= xmax + 1e-9).map(v => ({ x: sx(v), label: fmt(v, dec) }));
      } else {
        const m = Math.max(1, spec.cats.length - 1);
        const inset = Math.min(28, pw / (m + 1) / 2);
        sx = (v, i) => left + inset + (i / m) * (pw - 2 * inset);
        const every = Math.max(1, Math.ceil(spec.cats.length / Math.max(2, Math.floor(pw / 70))));
        xTicks = spec.cats.map((c, i) => ({ x: sx(c, i), label: String(c), i })).filter(t => t.i % every === 0);
      }
      svg('line', { x1: left, x2: left + pw, y1: top + ph, y2: top + ph, class: 'baseline' }, gGrid);
      xTicks.forEach((t, k) => {
        svg('line', { x1: r1(t.x), x2: r1(t.x), y1: top + ph, y2: top + ph + 4, class: 'tickmark' }, gAxis);
        const anchor = k === xTicks.length - 1 && t.x + textWidth(t.label, F.tick) / 2 > W ? 'end' : 'middle';
        svg('text', { x: r1(t.x), y: top + ph + 18, class: 'tick', 'text-anchor': anchor }, gAxis).textContent = t.label;
      });

      const pointSets = spec.series.map(s => {
        const xs = s.x || spec.cats;
        const pts = [];
        s.values.forEach((v, i) => {
          pts.push(v == null ? null : { x: sx(xs[i], i), y: sy(Math.max(yT.min, Math.min(v, yT.max))), i, v });
        });
        return pts;
      });

      const clipId = ids.title + '-clip';
      const clip = svg('clipPath', { id: clipId }, svgEl);
      svg('rect', { x: left - 4, y: top - 6, width: pw + 8, height: ph + 12 }, clip);
      gMarks.setAttribute('clip-path', 'url(#' + clipId + ')');

      spec.series.forEach((s, j) => {
        let d = '';
        let prev = null;
        pointSets[j].forEach(p => {
          if (!p) { prev = null; return; }
          if (!prev) d += `M${r1(p.x)} ${r1(p.y)}`;
          else if (spec.type === 'step') d += `H${r1(p.x)}V${r1(p.y)}`;
          else d += `L${r1(p.x)} ${r1(p.y)}`;
          prev = p;
        });
        svg('path', { d, class: 'line tone-' + s.tone + (s.dash ? ' dash' : '') }, gMarks);
        const real = pointSets[j].filter(Boolean);
        if (real.length && real.length <= 16 && spec.type !== 'step') {
          real.forEach(p => svg('circle', { cx: r1(p.x), cy: r1(p.y), r: 3.5, class: 'dot tone-' + s.tone }, gTop));
        } else if (real.length) {
          const last = real[real.length - 1];
          svg('circle', { cx: r1(last.x), cy: r1(last.y), r: 4, class: 'dot tone-' + s.tone }, gTop);
        }
      });

      // Positions the pointer can snap to: the union of every series' x positions.
      const stops = [];
      pointSets.forEach((pts, j) => pts.forEach(p => {
        if (!p) return;
        let stop = stops.find(st => Math.abs(st.x - p.x) < 0.5);
        if (!stop) { stop = { x: p.x, rows: [], label: String((spec.series[j].x || spec.cats)[p.i]) }; stops.push(stop); }
        stop.rows.push({ j, i: p.i, y: p.y });
      }));
      stops.sort((a, b) => a.x - b.x);
      const cross = svg('line', { y1: top - 4, y2: top + ph, class: 'crosshair', visibility: 'hidden' }, gHover);
      const focusDots = spec.series.map(s => svg('circle', { r: 5, class: 'dot focus tone-' + s.tone, visibility: 'hidden' }, gTop));
      geo = { kind: 'stops', stops, cross, focusDots, n: stops.length, anchor: i => ({ x: stops[i].x, y: top }) };
    }

    if (spec.target) {
      const y = r1(sy(spec.target.value));
      svg('line', { x1: left, x2: left + pw, y1: y, y2: y, class: 'target' }, gTop);
      if (spec.target.label) {
        const above = y - top > 16;
        const lbl = svg('text', { x: left + pw - 4, y: above ? y - 6 : y + 15, class: 'target-label', 'text-anchor': 'end' }, gTop);
        lbl.textContent = targetW > pw - 8 ? ellipsize(spec.target.label, pw - 8, F.label) : spec.target.label;
      }
    }
    if (isBar) state.figMax = left + pw + right;
  }

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.setAttribute('width', W);
  svgEl.setAttribute('height', H);

  if (state.svg) state.svg.replaceWith(svgEl);
  else plot.prepend(svgEl);
  state.svg = svgEl;
  state.geo = geo;
  state.W = W;
  state.H = H;
  if (state.active != null) showAt(state, Math.min(state.active, geo.n - 1));
}

/* ---------- hover and keyboard readout ---------- */

function tipRows(state, i) {
  const { spec, geo } = state;
  const rows = [];
  let head;
  if (geo.kind === 'stops') {
    const stop = geo.stops[i];
    head = (spec.xLabel ? spec.xLabel + ' ' : '') + stop.label + (spec.xUnit ? ' ' + spec.xUnit : '');
    stop.rows.forEach(r => rows.push({ s: spec.series[r.j], text: valueLabel(spec.series[r.j], r.i) }));
  } else {
    head = spec.cats[i];
    spec.series.forEach(s => { if (s.values[i] != null) rows.push({ s, text: valueLabel(s, i) }); });
  }
  return { head, rows };
}

function showAt(state, i) {
  const { geo, tip, spec, plot } = state;
  if (!geo || !geo.n) return;
  i = Math.max(0, Math.min(geo.n - 1, i));
  state.active = i;

  if (geo.kind === 'stops') {
    const stop = geo.stops[i];
    geo.cross.setAttribute('x1', r1(stop.x));
    geo.cross.setAttribute('x2', r1(stop.x));
    geo.cross.setAttribute('visibility', 'visible');
    geo.focusDots.forEach(d => d.setAttribute('visibility', 'hidden'));
    stop.rows.forEach(r => {
      const d = geo.focusDots[r.j];
      d.setAttribute('cx', r1(stop.x));
      d.setAttribute('cy', r1(r.y));
      d.setAttribute('visibility', 'visible');
    });
  } else {
    geo.bands.forEach((b, k) => b.classList.toggle('on', k === i));
  }

  const { head, rows } = tipRows(state, i);
  tip.textContent = '';
  tip.append(html('p', 'chart-tip__head', head));
  rows.forEach(r => {
    const row = html('p', 'chart-tip__row');
    const key = html('span', 'key key-line tone-' + r.s.tone);
    key.setAttribute('aria-hidden', 'true');
    row.append(key, html('strong', null, r.text + (spec.unit ? ' ' + spec.unit : '')));
    if (spec.series.length > 1) row.append(html('span', 'name', r.s.name));
    tip.append(row);
  });
  tip.hidden = false;

  const scale = plot.clientWidth / state.W;
  const a = geo.anchor(i);
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = a.x * scale + 12;
  if (geo.kind !== 'stops') left = a.x * scale - tw / 2;
  else if (left + tw > plot.clientWidth) left = a.x * scale - tw - 12;
  left = Math.max(0, Math.min(left, plot.clientWidth - tw));
  let topPx = geo.kind === 'rows' ? a.y * scale - th - 2 : a.y * scale - 6;
  if (geo.kind === 'rows' && topPx < -th * 0.6) topPx = (a.y + geo.rowH) * scale + 2;
  tip.style.left = Math.round(left) + 'px';
  tip.style.top = Math.round(topPx) + 'px';
}

function hideTip(state) {
  state.active = null;
  state.tip.hidden = true;
  const geo = state.geo;
  if (!geo) return;
  if (geo.kind === 'stops') {
    geo.cross.setAttribute('visibility', 'hidden');
    geo.focusDots.forEach(d => d.setAttribute('visibility', 'hidden'));
  } else {
    geo.bands.forEach(b => b.classList.remove('on'));
  }
}

function indexFromPointer(state, e) {
  const { geo, plot } = state;
  const rect = plot.getBoundingClientRect();
  const scale = state.W / rect.width;
  const x = (e.clientX - rect.left) * scale;
  const y = (e.clientY - rect.top) * scale;
  if (geo.kind === 'cols') {
    const i = Math.floor((x - geo.left) / geo.band);
    return i >= 0 && i < geo.n ? i : -1;
  }
  if (geo.kind === 'rows') {
    const i = Math.floor((y - geo.top) / geo.rowH);
    return i >= 0 && i < geo.n ? i : -1;
  }
  let best = -1;
  let bestD = Infinity;
  geo.stops.forEach((s, i) => {
    const d = Math.abs(s.x - x);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/* ---------- public ---------- */

export function renderChart(fig) {
  if (fig.__chart) return fig.__chart;
  const spec = readSpec(fig);
  const caption = fig.querySelector('figcaption');

  const bodyEl = html('div', 'chart-body');
  if (caption && caption !== fig.firstElementChild) fig.insertBefore(bodyEl, caption);
  else fig.append(bodyEl);

  if (spec.error) {
    console.warn('[charts] ' + spec.error, fig);
    bodyEl.append(html('p', 'chart-error', 'This chart could not be drawn. ' + spec.error));
    fig.dataset.ready = 'error';
    fig.__chart = { error: spec.error };
    return fig.__chart;
  }

  const n = ++uid;
  const title = spec.title || (caption ? caption.textContent.trim().replace(/\s+/g, ' ') : '') || 'Chart';
  const state = {
    fig, spec, title,
    ids: { title: 'chart-' + n + '-title', desc: 'chart-' + n + '-desc' },
    svg: null, geo: null, active: null, W: 0, H: 0, figMax: 0
  };
  state.desc = describe(spec, title);

  const legend = buildLegend(spec);
  if (legend) bodyEl.append(legend);

  const plot = html('div', 'chart-plot');
  plot.tabIndex = 0;
  plot.setAttribute('role', 'group');
  plot.setAttribute('aria-label', 'Chart. ' + title + '. Use the left and right arrow keys to read the values.');
  const tip = html('div', 'chart-tip');
  tip.setAttribute('role', 'status');
  tip.hidden = true;
  plot.append(tip);
  bodyEl.append(plot);
  bodyEl.append(buildTable(spec, title));
  state.plot = plot;
  state.tip = tip;

  const redraw = () => {
    draw(state);
    // Few bars: keep the bands a readable width and let the figure shrink to fit.
    if (state.figMax) {
      const cs = getComputedStyle(fig);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      fig.style.setProperty('--chart-fit', Math.ceil(Math.max(340, state.figMax + pad)) + 'px');
    }
  };
  redraw();
  fig.dataset.ready = 'true';

  let lastW = plot.clientWidth;
  if ('ResizeObserver' in window) {
    let raf = 0;
    new ResizeObserver(() => {
      if (Math.abs(plot.clientWidth - lastW) < 1) return;
      lastW = plot.clientWidth;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(redraw);
    }).observe(plot);
  }
  // Text is measured with the web fonts, so draw again once they have loaded.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw).catch(() => {});

  plot.addEventListener('pointermove', e => {
    const i = indexFromPointer(state, e);
    if (i < 0) hideTip(state);
    else if (i !== state.active || tip.hidden) showAt(state, i);
  });
  plot.addEventListener('pointerleave', () => { if (document.activeElement !== plot) hideTip(state); });
  plot.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') {
      const i = indexFromPointer(state, e);
      if (i >= 0) showAt(state, i);
    }
  });
  plot.addEventListener('focus', () => {
    if (plot.matches(':focus-visible') && state.active == null) showAt(state, 0);
  });
  plot.addEventListener('blur', () => hideTip(state));
  plot.addEventListener('keydown', e => {
    const max = state.geo ? state.geo.n - 1 : 0;
    const cur = state.active == null ? -1 : state.active;
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (fwd) { e.preventDefault(); showAt(state, Math.min(max, cur + 1)); }
    else if (back) { e.preventDefault(); showAt(state, Math.max(0, cur - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); showAt(state, 0); }
    else if (e.key === 'End') { e.preventDefault(); showAt(state, max); }
    else if (e.key === 'Escape') hideTip(state);
  });

  fig.__chart = state;
  return state;
}

export function renderAllCharts(root = document) {
  root.querySelectorAll('figure.chart[data-chart]').forEach(renderChart);
}
