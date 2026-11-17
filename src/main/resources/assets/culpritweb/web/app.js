/* Culprit Web viewer. No dependencies: the page must work on servers with no internet. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const tip = $('#tip');
const SVGNS = 'http://www.w3.org/2000/svg';

// ---------- helpers ----------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

function fmtNs(ns) {
  if (!isFinite(ns)) return '–';
  if (ns < 1000) return Math.round(ns) + ' ns';
  if (ns < 1e6) return (ns / 1000).toFixed(ns < 1e4 ? 2 : 1) + ' µs';
  return (ns / 1e6).toFixed(ns < 1e7 ? 2 : 1) + ' ms';
}
const fmtMs = ms => fmtNs(ms * 1e6);
const fmtPct = f => (f * 100 >= 10 ? (f * 100).toFixed(1) : (f * 100).toFixed(2)) + '%';
const fmtInt = n => Number(n).toLocaleString();
function fmtBytes(b) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(i ? 1 : 0) + ' ' + u[i];
}
function fmtDur(ms) {
  const sec = Math.floor(ms / 1000), d = Math.floor(sec / 86400), hr = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : m ? `${m}m ${sec % 60}s` : `${sec}s`;
}
const fmtDate = t => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortDim = d => (d || '').replace(/^minecraft:/, '');
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;
const ns = id => (id || '').includes(':') ? id.slice(0, id.indexOf(':')) : 'minecraft';

// Culprit's cost scale: pale yellow for a microsecond a tick to deep magenta at 5 ms, on a log scale.
const HEAT = [[0xff, 0xf1, 0xa8], [0xff, 0xd1, 0x66], [0xff, 0xa0, 0x40], [0xff, 0x6b, 0x3d], [0xf0, 0x30, 0x4a], [0xc8, 0x17, 0x8a]];
function heatT(nsPerTick) { return Math.min(1, Math.max(0, Math.log10(Math.max(nsPerTick / 1000, 1)) / Math.log10(5000))); }
function heat(nsPerTick, a = 1) {
  const x = heatT(nsPerTick) * (HEAT.length - 1), i = Math.min(Math.floor(x), HEAT.length - 2), f = x - i;
  const c = HEAT[i].map((v, k) => Math.round(v * (1 - f) + HEAT[i + 1][k] * f));
  return a === 1 ? `rgb(${c})` : `rgba(${c},${a})`;
}
const HEAT_CSS = `linear-gradient(90deg, ${HEAT.map(c => `rgb(${c})`).join(',')})`;
// Culprit's chunk reasons, in its own colours.
const REASON_COLOUR = ['#56B4E9', '#E69F00', '#D55E00', '#CC79A7', '#009E73', '#F0E442', '#8C8C8C', '#C8C8C8'];
const STATUS = ['border', 'block ticking', 'entity ticking'];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 1800);
}
function copy(text, what = 'Copied') {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
    () => toast(`${what}: ${text}`),
    () => { prompt('Copy:', text); });
}
function tpCommand(dim, x, y, z) {
  const at = `${x} ${y} ${z}`;
  return !dim || dim === 'minecraft:overworld' ? `/tp @s ${at}` : `/execute in ${dim} run tp @s ${at}`;
}
function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
const hideTip = () => (tip.hidden = true);
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const row = (k, v) => `<div class="r"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;

function setTop(meta, actions) {
  const m = $('#topMeta');
  m.replaceChildren(...meta.filter(Boolean).map(t => h('span', null, t)));
  $('#topActions').replaceChildren(...(actions || []));
}

// ---------- routing ----------

const path = location.pathname;
if (path.startsWith('/r/')) loadReport(path.slice(3));
else if (path.startsWith('/live/')) live(path.slice(6));
else home();

async function loadReport(id) {
  try {
    const res = await fetch('/api/report/' + encodeURIComponent(id));
    if (!res.ok) throw new Error(res.status === 404 ? 'No report by that link. It may have been pruned.' : 'Error ' + res.status);
    const doc = await res.json();
    render(doc);
  } catch (e) {
    app.replaceChildren(h('div', { class: 'error' }, e.message));
  }
}

// ---------- home: how to, and opening a file ----------

function home() {
  document.title = 'Culprit Web';
  setTop(['Lag profiler viewer']);
  const drop = h('label', { class: 'drop' },
    h('div', { style: { fontSize: '16px', marginBottom: '6px' } }, 'Drop a report here'),
    h('div', null, 'A Culprit Web report, or a JSON report saved by Culprit (culprit/reports/*.json)'),
    h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: e => openFile(e.target.files[0]) }));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); openFile(e.dataTransfer.files[0]); });
  app.replaceChildren(h('div', { class: 'home' },
    h('h1', null, 'Find what lags your server'),
    h('p', null, 'Run a command in game or in the console; Culprit times every entity, block entity, scheduled tick and chunk for a while, and you get a link to the results here.'),
    h('div', { class: 'cmds' },
      h('div', null, '/culpritweb profiler [seconds]'), h('div', null, 'Profile the server tick, then get a link (default 30 s)'),
      h('div', null, '/culpritweb profiler stop'), h('div', null, 'End the profile early and get the link now'),
      h('div', null, '/culpritweb last'), h('div', null, 'Link the last Culprit scan, however it was started (F8, /culprit scan)'),
      h('div', null, '/culpritweb chunks'), h('div', null, 'Every loaded chunk and what keeps it loaded'),
      h('div', null, '/culpritweb health'), h('div', null, 'A live link: TPS, MSPT, CPU, memory, worlds'),
      h('div', null, '/culpritweb list'), h('div', null, 'Links to the last ten reports')),
    drop));
}

function openFile(file) {
  if (!file) return;
  file.text().then(t => {
    let doc = JSON.parse(t);
    if (doc.culpritReport) doc = fromCulpritExport(doc);
    if (doc.format !== 'culpritweb') throw new Error('Not a Culprit report');
    history.pushState(null, '', '/');
    render(doc, file.name);
  }).catch(e => toast('Could not open: ' + e.message));
}

/** A JSON file saved by Culprit itself, in this viewer's shape (fewer columns: no calls, no census). */
function fromCulpritExport(c) {
  const KEYS = ['block_entity', 'entity', 'block_tick', 'fluid_tick', 'block_event', 'chunk', 'random_tick', 'spawning', 'particle'];
  const NAMES = ['block entity', 'entity', 'block ticks', 'fluid ticks', 'block events', 'chunk upkeep', 'random ticks', 'mob spawning', 'particles'];
  const conv = (r) => {
    const n = r.count || 1, dims = [], types = [], labels = [];
    const id = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { arr.push(v); i = arr.length - 1; } return i; };
    const things = { kind: [], dim: [], x: [], y: [], z: [], type: [], label: [], total: [], max: [], calls: [] };
    for (const t of r.things || []) {
      things.kind.push(Math.max(0, KEYS.indexOf(t.kind))); things.dim.push(id(dims, t.dimension));
      things.x.push(t.x); things.y.push(t.y); things.z.push(t.z); things.type.push(id(types, t.type));
      things.label.push(id(labels, t.name)); things.total.push(t.nsPerCount * n); things.max.push(t.worstNs); things.calls.push(0);
    }
    const tl = { type: [], label: [], kind: [], total: [], count: [], worstDim: [], worstX: [], worstY: [], worstZ: [] };
    for (const t of r.types || []) {
      tl.type.push(id(types, t.type)); tl.label.push(id(labels, t.type)); tl.kind.push(Math.max(0, KEYS.indexOf(t.kind)));
      tl.total.push(t.nsPerCount * n); tl.count.push(t.count); tl.worstDim.push(-1); tl.worstX.push(0); tl.worstY.push(0); tl.worstZ.push(0);
    }
    const mods = { id: [], name: [], total: [], count: [] };
    for (const m of r.mods || []) { mods.id.push(m.mod); mods.name.push(m.mod); mods.total.push(m.nsPerCount * n); mods.count.push(m.things); }
    const chunks = { dim: [], x: [], z: [], total: [], count: [], top: [], topNs: [], topKind: [] };
    for (const ch of r.chunks || []) {
      chunks.dim.push(id(dims, ch.dimension)); chunks.x.push(ch.x); chunks.z.push(ch.z); chunks.total.push(ch.nsPerCount * n);
      chunks.count.push(ch.things); chunks.top.push(-1); chunks.topNs.push(0); chunks.topKind.push(0);
    }
    const parts = (r.parts || []).map(p => ({ name: p.name, about: '', group: -1, kind: -1, ns: p.nsPerCount * n }));
    const kindNs = KEYS.map(() => 0);
    things.kind.forEach((k, i) => (kindNs[k] += things.total[i]));
    return {
      ticks: n, totalNs: r.meanNs * n, worstNs: r.worstNs, medianNs: r.medianNs, spikeThresholdNs: r.spikeThresholdNs,
      thingCount: r.thingsMeasured, kindNs, groups: [], parts, dims, types, labels, things, typeList: tl, mods, chunks,
    };
  };
  const report = conv(c);
  const sp = c.lagSpikes || c.stutters;
  if (sp && sp.count) report.spikes = conv(sp);
  return {
    format: 'culpritweb', version: 1, kind: c.of === 'frames' ? 'frames' : 'ticks', source: 'file', created: Date.parse(c.saved) || Date.now(),
    report, kinds: { key: KEYS, name: NAMES, about: KEYS.map(() => ''), chunkWide: KEYS.map((k, i) => i >= 5) },
  };
}

// ---------- a report ----------

function render(doc, fileName) {
  const r = doc.report;
  const unit = doc.kind === 'frames' ? 'frame' : 'tick';
  const title = doc.kind === 'chunks' ? 'Loaded chunks' : doc.kind === 'frames' ? 'Frame profile' : 'Tick profile';
  document.title = `${title} · Culprit Web`;
  const meta = [title, fmtDate(doc.created)];
  if (doc.by) meta.push('by ' + doc.by);
  if (r) meta.push(`${fmtInt(r.ticks)} ${unit}s` + (unit === 'tick' ? ` (${(r.ticks / 20).toFixed(1)} s)` : ''));
  if (fileName) meta.push(fileName);
  setTop(meta, [
    h('button', { class: 'btn', onclick: () => download(doc) }, 'Download JSON'),
    !fileName && h('button', { class: 'btn', onclick: () => copy(location.href, 'Link copied') }, 'Copy link'),
  ]);

  const tabs = [];
  if (r) {
    const M = model(r, doc);
    tabs.push(['Overview', () => overview(doc, M)]);
    tabs.push(['Tree', () => treeView(M)]);
    tabs.push(['Things', () => thingsTable(M), r.things.kind.length]);
    tabs.push(['Types', () => typesTable(M), r.typeList.type.length]);
    tabs.push(['Mods', () => modsTable(M), r.mods.id.length]);
    tabs.push(['Chunks', () => chunkCostTable(M), r.chunks.x.length]);
    if (r.spikes) tabs.push([unit === 'tick' ? 'Lag spikes' : 'Stutters', () => spikesView(doc, model(r.spikes, doc), M), r.spikes.ticks]);
  }
  if (doc.chunks) tabs.push(['Chunk map', () => chunkMap(doc, r ? model(r, doc) : null)]);
  if (doc.server) tabs.push(['Server', () => serverView(doc)]);

  const bar = h('div', { class: 'tabs' });
  const body = h('div');
  let current = Math.max(0, tabs.findIndex(t => t[0].toLowerCase().replace(/ /g, '-') === location.hash.slice(1)));
  const show = i => {
    current = i;
    [...bar.children].forEach((b, k) => b.classList.toggle('on', k === i));
    hideTip();
    body.replaceChildren(tabs[i][1]());
    history.replaceState(null, '', '#' + tabs[i][0].toLowerCase().replace(/ /g, '-'));
  };
  tabs.forEach(([name, , n], i) => bar.append(h('button', { class: 'tab', onclick: () => show(i) }, name, n != null && h('span', { class: 'n' }, fmtInt(n)))));
  app.replaceChildren(bar, body);
  show(current);
}

function download(doc) {
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `culprit-web-${doc.id || 'report'}.json` });
  document.body.append(a);
  a.click();
  a.remove();
}

/** The report's rows as objects, with per-tick costs worked out once. */
function model(r, doc) {
  const n = r.ticks || 1, perTick = t => t / n;
  const kinds = doc.kinds;
  const label = i => (i >= 0 ? r.labels[i] : '');
  const T = r.things;
  const things = T.kind.map((k, i) => {
    const type = r.types[T.type[i]];
    return {
      i, kind: k, kindName: kinds.name[k], chunkWide: kinds.chunkWide[k], dim: r.dims[T.dim[i]], x: T.x[i], y: T.y[i], z: T.z[i],
      type, name: label(T.label[i]) || type, mod: ns(type), cost: perTick(T.total[i]), worst: T.max[i], calls: T.calls[i] / n,
    };
  });
  const TL = r.typeList;
  const types = TL.type.map((t, i) => {
    const type = r.types[t];
    return {
      type, name: label(TL.label[i]) || type, kind: TL.kind[i], kindName: kinds.name[TL.kind[i]], count: TL.count[i], cost: perTick(TL.total[i]),
      mod: ns(type), dim: r.dims[TL.worstDim[i]], x: TL.worstX[i], y: TL.worstY[i], z: TL.worstZ[i],
    };
  });
  const mods = r.mods.id.map((id, i) => ({ id, name: r.mods.name[i], count: r.mods.count[i], cost: perTick(r.mods.total[i]) }));
  const modName = Object.fromEntries(mods.map(m => [m.id, m.name]));
  for (const m of (doc.server?.mods || [])) if (!modName[m.id]) modName[m.id] = m.name;
  const C = r.chunks;
  const chunks = C.x.map((x, i) => ({
    dim: r.dims[C.dim[i]], x, z: C.z[i], cost: perTick(C.total[i]), count: C.count[i], top: label(C.top[i]), topCost: perTick(C.topNs[i]),
  }));
  return { r, n, tick: r.totalNs / n, worst: r.worstNs, things, types, mods, modName, chunks, kinds, unit: doc.kind === 'frames' ? 'frame' : 'tick' };
}

function tile(k, v, unit, sub, dot) {
  return h('div', { class: 'tile' }, h('div', { class: 'k' }, dot && h('span', { class: 'dot', style: { background: dot } }), k),
    h('div', { class: 'v' }, v, unit && h('small', null, unit)), sub && h('div', { class: 's' }, sub));
}

function tpsPill(tps) {
  return h('span', { class: 'pill ' + (tps >= 19.5 ? 'good' : tps >= 15 ? 'warn' : 'bad') }, tps >= 19.5 ? 'healthy' : tps >= 15 ? 'behind' : 'lagging');
}

function overview(doc, M) {
  const r = M.r, tickMs = M.tick / 1e6;
  const tps = Math.min(20, 1000 / Math.max(tickMs, 50));
  const spikes = r.spikes ? r.spikes.ticks : 0;
  const root = h('div');
  if (M.unit === 'tick') {
    root.append(h('div', { class: 'tiles' },
      tile('Average tick', fmtMs(tickMs), null, `${fmtPct(tickMs / 50)} of the 50 ms budget`),
      tile('Worst tick', fmtNs(r.worstNs), null, `median ${fmtNs(r.medianNs)}`),
      tile('TPS it allows', Math.min(20, 1000 / tickMs).toFixed(1), null, h('span', null, tpsPill(tps), ' at the average tick')),
      tile('Lag spikes', fmtInt(spikes), null, spikes ? `ticks over ${fmtNs(r.spikeThresholdNs)}` : 'none over twice the median'),
      tile('Things timed', fmtInt(r.thingCount), null, `${fmtInt(M.things.length)} costliest kept`)));
  } else {
    root.append(h('div', { class: 'tiles' },
      tile('Average frame', fmtMs(tickMs), null, `${Math.round(1000 / tickMs)} FPS`),
      tile('Worst frame', fmtNs(r.worstNs), null, `median ${fmtNs(r.medianNs)}`),
      tile('Stutters', fmtInt(spikes)), tile('Things timed', fmtInt(r.thingCount))));
  }
  if (r.incomplete) root.append(h('div', { class: 'note' }, 'This scan was stopped early or a world unloaded during it; its numbers cover what was timed.'));

  // the tick in parts
  const total = r.totalNs || 1;
  const groups = r.groups.length ? r.groups : [];
  if (groups.length) {
    const stack = h('div', { class: 'stack' });
    for (const g of groups) {
      if (g.ns <= 0) continue;
      const d = h('div', { style: { background: g.colour, flex: `${g.ns} 0 0` } });
      d.addEventListener('mousemove', e => showTip(e, `<b>${esc(g.name)}</b>${row('per ' + M.unit, fmtNs(g.ns / M.n))}${row('share', fmtPct(g.ns / total))}`));
      d.addEventListener('mouseleave', hideTip);
      stack.append(d);
    }
    root.append(h('div', { class: 'panel' }, h('h3', null, `Where the ${M.unit} went`, h('span', { class: 'sub' }, `${fmtMs(tickMs)} a ${M.unit} on average`)),
      stack, h('div', { class: 'legend' }, groups.filter(g => g.ns > 0).map(g =>
        h('span', null, h('span', { class: 'dot', style: { background: g.colour } }), g.name, h('b', null, fmtNs(g.ns / M.n)))))));
  }

  const two = h('div', { class: 'two' });
  // parts
  const parts = h('table', null, h('thead', null, h('tr', null, h('th', null, 'Part'), h('th', { class: 'num' }, 'Per ' + M.unit), h('th', { class: 'num' }, 'Share'))),
    h('tbody', null, r.parts.filter(p => p.ns > 0).map(p => h('tr', null,
      h('td', { class: 'name' }, groups[p.group] && h('span', { class: 'dot', style: { background: groups[p.group].colour } }), p.name,
        p.about && h('span', { class: 'about' }, p.about)),
      h('td', { class: 'num' }, fmtNs(p.ns / M.n)), h('td', { class: 'num' }, shareCell(p.ns / total))))));
  two.append(h('div', { class: 'panel' }, h('h3', null, 'Every part'), h('div', { class: 'scroll' }, parts)));
  // top things
  const top = M.things.slice(0, 12);
  two.append(h('div', { class: 'panel' }, h('h3', null, 'Costliest things', h('span', { class: 'grow' }), h('span', { class: 'sub' }, 'click a row to copy its /tp')),
    h('div', { class: 'scroll' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'What'), h('th', null, 'Where'), h('th', { class: 'num' }, 'Per ' + M.unit))),
      h('tbody', null, top.map(t => h('tr', { class: 'copy', onclick: () => copy(tpCommand(t.dim, t.x, t.y, t.z), 'Copied') },
        h('td', { class: 'name' }, t.name, h('span', { class: 'id' }, `${t.kindName} · ${M.modName[t.mod] || t.mod}`)),
        h('td', { class: 'where' }, where(t)),
        h('td', { class: 'num cost', style: { color: heat(t.cost) } }, fmtNs(t.cost)))))))));
  root.append(two);

  if (doc.timeline && doc.timeline.ms.length) root.append(timeline(doc, M));

  const mods = M.mods.slice(0, 8);
  if (mods.length) {
    const max = mods[0].cost || 1;
    root.append(h('div', { class: 'panel' }, h('h3', null, 'By mod', h('span', { class: 'sub' }, 'things each mod adds, together')),
      h('table', null, h('tbody', null, mods.map(m => h('tr', null, h('td', { class: 'name' }, m.name, h('span', { class: 'id' }, m.id)),
        h('td', { class: 'num' }, fmtInt(m.count) + ' things'), h('td', { class: 'num' }, fmtNs(m.cost)),
        h('td', { style: { width: '35%' } }, h('div', { class: 'node', style: { padding: 0, display: 'block' } },
          h('div', { class: 'bar' }, h('i', { style: { width: (m.cost / max * 100) + '%', background: heat(m.cost) } }))))))))));
  }
  return root;
}

function shareCell(f) {
  return h('div', { class: 'share' }, fmtPct(f), h('div', { class: 'track' }, h('i', { style: { width: Math.min(100, f * 100) + '%' } })));
}

function where(t) {
  const dim = t.dim && t.dim !== 'minecraft:overworld' ? ` ${shortDim(t.dim)}` : '';
  return t.chunkWide ? `chunk ${t.x >> 4}, ${t.z >> 4}${dim}` : `${t.x} ${t.y} ${t.z}${dim}`;
}

// ---------- the tick timeline (an SVG line with a crosshair) ----------

function timeline(doc, M) {
  const ms = doc.timeline.ms, at = doc.timeline.at;
  const spike = (M.r.spikeThresholdNs || 0) / 1e6;
  const panel = h('div', { class: 'panel' }, h('h3', null, `Each ${M.unit} through the profile`,
    h('span', { class: 'sub' }, `${fmtInt(ms.length)} ticks · line at 50 ms (the tick's budget)` + (spike ? `, dashed at the lag spike line (${fmtMs(spike)})` : ''))));
  panel.append(lineChart({ x: at, ys: [{ v: ms, colour: 'var(--accent)', name: 'tick' }], unit: 'ms', marks: [50, spike].filter(Boolean),
    fmtX: v => v.toFixed(1) + ' s', fmtY: v => fmtMs(v), height: 200 }));
  return panel;
}

function lineChart({ x, ys, marks = [], fmtX, fmtY, height = 180, yMin = 0, yMax }) {
  const wrap = h('div', { class: 'chart' });
  const W = 1000, H = height, L = 70, R = 10, T = 8, B = 22;
  let max = yMax ?? Math.max(...ys.flatMap(y => y.v), ...marks, 1e-9) * 1.08;
  const x0 = x[0] ?? 0, x1 = x[x.length - 1] ?? 1;
  const sx = v => L + (v - x0) / Math.max(1e-9, x1 - x0) * (W - L - R);
  const sy = v => T + (1 - (v - yMin) / (max - yMin)) * (H - T - B);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', style: `height:${H}px` });
  const grid = s('g', { class: 'grid' });
  for (let k = 0; k <= 4; k++) {
    const v = yMin + (max - yMin) * k / 4, y = sy(v);
    grid.append(s('line', { x1: L, x2: W - R, y1: y, y2: y, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
  }
  svg.append(grid);
  for (const m of marks) {
    if (m > max) continue;
    svg.append(s('line', { x1: L, x2: W - R, y1: sy(m), y2: sy(m), stroke: 'var(--ink3)', 'stroke-width': 1, 'stroke-dasharray': m === 50 ? null : '4 4', 'vector-effect': 'non-scaling-stroke' }));
  }
  for (const y of ys) {
    if (!y.v.length) continue;
    let d = '';
    // Down-sample to a few points per pixel column, keeping each column's peak.
    const step = Math.max(1, Math.floor(y.v.length / 1500));
    for (let i = 0; i < y.v.length; i += step) {
      let peak = y.v[i];
      for (let k = i + 1; k < Math.min(y.v.length, i + step); k++) peak = Math.max(peak, y.v[k]);
      d += (d ? 'L' : 'M') + sx(x[i]).toFixed(1) + ' ' + sy(peak).toFixed(1);
    }
    svg.append(s('path', { d, fill: 'none', stroke: y.colour, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
  }
  const cross = s('line', { y1: T, y2: H - B, stroke: 'var(--ink2)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' });
  svg.append(cross);
  wrap.append(svg);
  // axis labels as HTML so they don't stretch
  const axis = h('div', { style: { position: 'absolute', inset: 0, pointerEvents: 'none' } });
  for (let k = 0; k <= 4; k++) {
    const v = yMin + (max - yMin) * k / 4;
    axis.append(h('div', { class: 'axis', style: { position: 'absolute', left: 0, width: (L - 6) + 'px', whiteSpace: 'nowrap', textAlign: 'right', top: `calc(${sy(v) / H * 100}% - 8px)`, fontSize: '11px', color: 'var(--ink3)' } }, fmtY(v)));
  }
  for (let k = 0; k <= 5; k++) {
    const v = x0 + (x1 - x0) * k / 5;
    axis.append(h('div', { style: { position: 'absolute', bottom: 0, left: `calc(${sx(v) / W * 100}% - 30px)`, width: '60px', textAlign: 'center', fontSize: '11px', color: 'var(--ink3)' } }, fmtX(v)));
  }
  wrap.append(axis);
  if (ys.length > 1) wrap.prepend(h('div', { class: 'legend', style: { marginTop: 0, marginBottom: '6px' } }, ys.map(y => h('span', null, h('span', { class: 'dot', style: { background: y.colour } }), y.name))));
  svg.addEventListener('mousemove', e => {
    const rect = svg.getBoundingClientRect();
    const vx = x0 + ((e.clientX - rect.left) / rect.width * W - L) / (W - L - R) * (x1 - x0);
    let lo = 0, hi = x.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (x[mid] < vx) lo = mid + 1; else hi = mid; }
    const i = Math.max(0, Math.min(x.length - 1, lo));
    cross.setAttribute('x1', sx(x[i])); cross.setAttribute('x2', sx(x[i])); cross.setAttribute('visibility', 'visible');
    showTip(e, `<b>${esc(fmtX(x[i]))}</b>` + ys.map(y => row(y.name, fmtY(y.v[i]))).join(''));
  });
  svg.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  return wrap;
}

// ---------- the tree, as spark draws its call tree ----------

function treeView(M) {
  const r = M.r, total = r.totalNs || 1;
  const root = { name: `Server ${M.unit}`, ns: total, kids: [] };
  for (const p of r.parts) {
    if (p.ns <= 0) continue;
    const node = { name: p.name, sub: p.about, ns: p.ns, colour: r.groups[p.group]?.colour, kids: [] };
    if (p.kind >= 0) {
      const mods = new Map();
      let listed = 0;
      for (const t of M.things) {
        if (t.kind !== p.kind) continue;
        listed += t.cost * M.n;
        let m = mods.get(t.mod);
        if (!m) mods.set(t.mod, (m = { name: M.modName[t.mod] || t.mod, sub: t.mod, ns: 0, kids: [], types: new Map() }));
        m.ns += t.cost * M.n;
        let ty = m.types.get(t.type);
        if (!ty) m.types.set(t.type, (ty = { name: t.name, sub: t.type, ns: 0, kids: [], count: 0 }));
        ty.ns += t.cost * M.n;
        ty.count++;
        ty.kids.push({ name: where(t), ns: t.cost * M.n, thing: t, mono: true, kids: [] });
      }
      for (const m of mods.values()) {
        m.kids = [...m.types.values()];
        for (const ty of m.kids) ty.sub = `${ty.count} × · ${ty.sub}`;
        node.kids.push(m);
      }
      const rest = p.ns - listed;
      if (rest > total * 0.0005) node.kids.push({ name: 'the rest, each too small to keep', ns: rest, kids: [], muted: true });
    }
    root.kids.push(node);
  }
  const sortKids = n => { n.kids.sort((a, b) => b.ns - a.ns); n.kids.forEach(sortKids); };
  sortKids(root);

  const search = h('input', { type: 'search', placeholder: 'Search names, mods, ids…' });
  const out = h('div', { class: 'tree' });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const matches = n => (n.name + ' ' + (n.sub || '')).toLowerCase().includes(q);
    const has = n => matches(n) || n.kids.some(has);
    const make = (n, depth, open) => {
      const wrap = h('div');
      const kidsBox = h('div', { class: 'kids', hidden: !open });
      const f = n.ns / total;
      const arrow = h('span', { class: 'arrow' }, n.kids.length ? (open ? '▾' : '▸') : '');
      const line = h('div', { class: 'node' + (q && matches(n) ? ' match' : '') },
        h('div', { class: 'label' }, arrow, n.colour && h('span', { class: 'dot', style: { background: n.colour } }),
          h('span', { class: 't', style: n.mono ? { fontFamily: 'var(--mono)', fontSize: '12px' } : n.muted ? { color: 'var(--ink3)' } : null }, n.name),
          n.sub && h('span', { class: 'muted' }, n.sub)),
        h('div', { class: 'ms', style: { color: heat(n.ns / M.n) } }, fmtNs(n.ns / M.n)),
        h('div', { class: 'pc' }, fmtPct(f)),
        h('div', { class: 'bar' }, h('i', { style: { width: Math.min(100, f * 100) + '%', background: n.colour || heat(n.ns / M.n) } })));
      let built = false;
      const build = () => {
        if (built) return;
        built = true;
        const kids = q ? n.kids.filter(has) : n.kids;
        kids.slice(0, 300).forEach(k => kidsBox.append(make(k, depth + 1, q ? has(k) && !matches(k) : false)));
        if (kids.length > 300) kidsBox.append(h('div', { class: 'note' }, `${kids.length - 300} more`));
      };
      if (open) build();
      if (n.kids.length) line.addEventListener('click', () => { build(); kidsBox.hidden = !kidsBox.hidden; arrow.textContent = kidsBox.hidden ? '▸' : '▾'; });
      if (n.thing) {
        line.title = 'Click to copy its /tp';
        line.style.cursor = 'pointer';
        line.addEventListener('click', () => copy(tpCommand(n.thing.dim, n.thing.x, n.thing.y, n.thing.z)));
      }
      wrap.append(line, kidsBox);
      return wrap;
    };
    out.replaceChildren(make(root, 0, true));
  };
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 150); });
  draw();
  return h('div', { class: 'panel' }, h('div', { class: 'toolbar' }, search,
    h('span', { class: 'count' }, 'Each part, then mod, type and each thing. Time per ' + M.unit + ', and its share of the whole.')), out);
}

// ---------- tables ----------

function dataTable({ rows, cols, search, filters = [], initialSort, onRow, empty = 'Nothing here' }) {
  let sortCol = cols.findIndex(c => c.key === initialSort), asc = false, limit = 200;
  const box = h('div', { class: 'panel' });
  const q = h('input', { type: 'search', placeholder: 'Search…' });
  const sels = filters.map(f => {
    const sel = h('select', null, h('option', { value: '' }, f.all), f.options.map(([v, l]) => h('option', { value: v }, l)));
    sel.addEventListener('change', () => { limit = 200; draw(); });
    return sel;
  });
  const count = h('span', { class: 'count' });
  const thead = h('thead');
  const tbody = h('tbody');
  const more = h('div', { class: 'more' });
  const draw = () => {
    const text = q.value.trim().toLowerCase();
    let list = rows.filter(r => (!text || search(r).toLowerCase().includes(text)) && filters.every((f, i) => !sels[i].value || String(f.get(r)) === sels[i].value));
    if (sortCol >= 0) {
      const c = cols[sortCol], get = c.sort || (r => r[c.key]);
      list = list.slice().sort((a, b) => { const x = get(a), y = get(b); const v = typeof x === 'string' ? x.localeCompare(y) : x - y; return asc ? v : -v; });
    }
    count.textContent = `${fmtInt(list.length)} of ${fmtInt(rows.length)}`;
    thead.replaceChildren(h('tr', null, cols.map((c, i) => h('th', {
      class: (c.num ? 'num ' : '') + (i === sortCol ? 'sorted' + (asc ? ' asc' : '') : ''),
      onclick: () => { if (sortCol === i) asc = !asc; else { sortCol = i; asc = !!c.asc; } draw(); },
    }, c.title))));
    tbody.replaceChildren(...list.slice(0, limit).map((r, idx) => h('tr', { class: onRow ? 'copy' : null, onclick: onRow ? () => onRow(r) : null },
      cols.map(c => h('td', { class: (c.num ? 'num ' : '') + (c.cls || '') }, c.cell ? c.cell(r, idx) : r[c.key])))));
    if (!list.length) tbody.append(h('tr', null, h('td', { colspan: cols.length, class: 'empty' }, empty)));
    more.replaceChildren(list.length > limit ? h('button', { class: 'btn', onclick: () => { limit += 500; draw(); } }, `Show more (${fmtInt(list.length - limit)} left)`) : '');
  };
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { limit = 200; draw(); }, 120); });
  draw();
  box.append(h('div', { class: 'toolbar' }, q, sels, count), h('div', { class: 'scroll' }, h('table', null, thead, tbody)), more);
  return box;
}

const kindFilter = (M, rows) => ({
  all: 'All kinds', get: r => r.kind,
  options: [...new Set(rows.map(r => r.kind))].sort((a, b) => a - b).map(k => [k, cap(M.kinds.name[k])]),
});
const modFilter = (M, rows) => ({
  all: 'All mods', get: r => r.mod,
  options: [...new Set(rows.map(r => r.mod))].sort().map(m => [m, M.modName[m] || m]),
});
const dimFilter = rows => ({
  all: 'All dimensions', get: r => r.dim,
  options: [...new Set(rows.map(r => r.dim))].filter(Boolean).sort().map(d => [d, shortDim(d)]),
});
const costCell = (key = 'cost') => r => h('span', { class: 'cost', style: { color: heat(r[key]) } }, fmtNs(r[key]));

function thingsTable(M, note) {
  const total = M.tick;
  const t = dataTable({
    rows: M.things, initialSort: 'cost',
    search: r => `${r.name} ${r.type} ${r.kindName} ${M.modName[r.mod] || ''} ${r.x} ${r.y} ${r.z}`,
    filters: [kindFilter(M, M.things), modFilter(M, M.things), dimFilter(M.things)],
    onRow: r => copy(tpCommand(r.dim, r.x, r.chunkWide ? 100 : r.y, r.z)),
    cols: [
      { title: '#', key: 'i', num: true, asc: true, cell: r => r.i + 1 },
      { title: 'What', key: 'name', cls: 'name', asc: true, cell: r => [r.name, h('span', { class: 'id' }, r.type)] },
      { title: 'Kind', key: 'kindName', asc: true, cell: r => h('span', { class: 'kindtag' }, r.kindName) },
      { title: 'Mod', key: 'mod', asc: true, cell: r => M.modName[r.mod] || r.mod },
      { title: 'Where', key: 'x', cls: 'where', cell: r => where(r) },
      { title: 'Per ' + M.unit, key: 'cost', num: true, cell: costCell() },
      { title: 'Share', key: 'cost', num: true, cell: r => shareCell(r.cost / total) },
      { title: 'Worst', key: 'worst', num: true, cell: r => fmtNs(r.worst) },
      { title: 'Calls/' + M.unit, key: 'calls', num: true, cell: r => r.calls ? r.calls.toFixed(r.calls < 10 ? 1 : 0) : '–' },
    ],
  });
  if (note !== false) t.append(h('div', { class: 'note' }, `The ${fmtInt(M.things.length)} costliest of ${fmtInt(M.r.thingCount)} things timed. Click a row to copy a /tp to it.`));
  return t;
}

function typesTable(M) {
  const total = M.tick;
  return dataTable({
    rows: M.types, initialSort: 'cost',
    search: r => `${r.name} ${r.type} ${r.kindName} ${M.modName[r.mod] || ''}`,
    filters: [kindFilter(M, M.types), modFilter(M, M.types)],
    onRow: r => r.dim && copy(tpCommand(r.dim, r.x, r.y, r.z)),
    cols: [
      { title: 'Type', key: 'name', cls: 'name', asc: true, cell: r => [r.name, h('span', { class: 'id' }, r.type)] },
      { title: 'Kind', key: 'kindName', asc: true, cell: r => h('span', { class: 'kindtag' }, r.kindName) },
      { title: 'Mod', key: 'mod', asc: true, cell: r => M.modName[r.mod] || r.mod },
      { title: 'How many', key: 'count', num: true, cell: r => fmtInt(r.count) },
      { title: 'Per ' + M.unit, key: 'cost', num: true, cell: costCell() },
      { title: 'Each', key: 'each', num: true, sort: r => r.cost / r.count, cell: r => fmtNs(r.cost / Math.max(1, r.count)) },
      { title: 'Share', key: 'cost', num: true, cell: r => shareCell(r.cost / total) },
      { title: 'Worst at', key: 'x', cls: 'where', cell: r => r.dim ? where({ ...r, chunkWide: M.kinds.chunkWide[r.kind] }) : '' },
    ],
  });
}

function modsTable(M) {
  const total = M.tick;
  return dataTable({
    rows: M.mods, initialSort: 'cost', search: r => `${r.name} ${r.id}`,
    cols: [
      { title: 'Mod', key: 'name', cls: 'name', asc: true, cell: r => [r.name, h('span', { class: 'id' }, r.id)] },
      { title: 'Things', key: 'count', num: true, cell: r => fmtInt(r.count) },
      { title: 'Per ' + M.unit, key: 'cost', num: true, cell: costCell() },
      { title: 'Share', key: 'cost', num: true, cell: r => shareCell(r.cost / total) },
    ],
  });
}

function chunkCostTable(M) {
  const total = M.tick;
  return dataTable({
    rows: M.chunks, initialSort: 'cost', search: r => `${r.x}, ${r.z} ${r.dim} ${r.top}`,
    filters: [dimFilter(M.chunks)],
    onRow: r => copy(tpCommand(r.dim, r.x * 16 + 8, 100, r.z * 16 + 8)),
    cols: [
      { title: 'Chunk', key: 'x', cls: 'where', cell: r => `${r.x}, ${r.z}` },
      { title: 'Blocks', key: 'z', cls: 'where', cell: r => `${r.x * 16} ${r.z * 16}` },
      { title: 'Dimension', key: 'dim', asc: true, cell: r => shortDim(r.dim) },
      { title: 'Things', key: 'count', num: true, cell: r => fmtInt(r.count) },
      { title: 'Per ' + M.unit, key: 'cost', num: true, cell: costCell() },
      { title: 'Share', key: 'cost', num: true, cell: r => shareCell(r.cost / total) },
      { title: 'Mostly', key: 'top', cls: 'name', asc: true, cell: r => r.top ? [r.top, h('span', { class: 'id' }, fmtNs(r.topCost))] : '' },
    ],
  });
}

function spikesView(doc, S, M) {
  const root = h('div');
  const r = S.r;
  root.append(h('div', { class: 'tiles' },
    tile(M.unit === 'tick' ? 'Lag spikes' : 'Stutters', fmtInt(r.ticks), null, `${fmtPct(r.ticks / M.n)} of the ${M.unit}s`),
    tile('Spike line', fmtNs(M.r.spikeThresholdNs), null, `twice the median ${fmtNs(M.r.medianNs)}`),
    tile('Average spike', fmtNs(S.tick), null, `vs ${fmtNs(M.tick)} overall`),
    tile('Worst', fmtNs(r.worstNs))));
  root.append(h('div', { class: 'note', style: { margin: '0 0 10px' } }, `What took the time in the slow ${M.unit}s only. Something here but not in the overall list is a spike maker, not a steady cost.`));
  if (r.groups.length) {
    const stack = h('div', { class: 'stack' }, r.groups.filter(g => g.ns > 0).map(g => h('div', { style: { background: g.colour, flex: `${g.ns} 0 0` }, title: `${g.name}: ${fmtNs(g.ns / S.n)}` })));
    root.append(h('div', { class: 'panel' }, h('h3', null, `In a spike, the ${M.unit} went to`), stack,
      h('div', { class: 'legend' }, r.groups.filter(g => g.ns > 0).map(g => h('span', null, h('span', { class: 'dot', style: { background: g.colour } }), g.name, h('b', null, fmtNs(g.ns / S.n)))))));
  }
  root.append(thingsTable(S, false));
  return root;
}

// ---------- the chunk map ----------

function chunkMap(doc, M) {
  const C = doc.chunks;
  const dims = C.dims.filter(d => d.x.length);
  const root = h('div');
  if (!dims.length) { root.append(h('div', { class: 'empty' }, 'No loaded chunks were recorded.')); return root; }
  const costs = new Map();
  if (M) for (const c of M.chunks) costs.set(`${c.dim}|${c.x}|${c.z}`, c);
  let dim = dims.find(d => d.dim === 'minecraft:overworld') || dims[0];
  let mode = 'reason';
  const dimSel = h('select', null, dims.map(d => h('option', { value: d.dim }, `${shortDim(d.dim)} (${fmtInt(d.x.length)})`)));
  dimSel.value = dim.dim;
  const modeSel = h('select', null, h('option', { value: 'reason' }, 'Why loaded'), M && h('option', { value: 'cost' }, 'Cost per tick'),
    h('option', { value: 'entities' }, 'Entities'), h('option', { value: 'blockEntities' }, 'Block entities'), h('option', { value: 'status' }, 'How active'));
  const legend = h('div', { class: 'legend' });
  const summary = h('span', { class: 'count' });
  const wrap = h('div', { class: 'mapwrap' });
  const canvas = h('canvas');
  wrap.append(canvas, h('div', { class: 'hint' }, 'drag to pan · wheel to zoom · click a chunk to copy its /tp'));
  const sourcesBox = h('div');
  root.append(h('div', { class: 'panel' }, h('div', { class: 'toolbar' }, dimSel, modeSel, summary), wrap, legend), sourcesBox);

  let view = { cx: 0, cz: 0, scale: 6 };
  let index = new Map();
  const fit = () => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < dim.x.length; i++) { minX = Math.min(minX, dim.x[i]); maxX = Math.max(maxX, dim.x[i]); minZ = Math.min(minZ, dim.z[i]); maxZ = Math.max(maxZ, dim.z[i]); }
    const r = canvas.getBoundingClientRect();
    view.cx = (minX + maxX + 1) / 2; view.cz = (minZ + maxZ + 1) / 2;
    view.scale = Math.max(1, Math.min(40, Math.min(r.width / (maxX - minX + 3), r.height / (maxZ - minZ + 3))));
  };
  const maxOf = key => { let m = 1; for (const v of dim[key]) m = Math.max(m, v); return m; };
  const colourOf = (i) => {
    if (mode === 'reason') return REASON_COLOUR[dim.reason[i]] || '#888';
    if (mode === 'status') return ['#4a5262', '#56B4E9', '#E69F00'][dim.status[i]];
    if (mode === 'cost') { const c = costs.get(`${dim.dim}|${dim.x[i]}|${dim.z[i]}`); return c ? heat(c.cost) : 'rgba(128,128,128,.18)'; }
    const v = dim[mode][i], m = maxOf(mode);
    return v ? heat(5000 * Math.pow(1000, (Math.log(v + 1) / Math.log(m + 1)) - 1) * 1000) : 'rgba(128,128,128,.18)';
  };
  const drawLegend = () => {
    const counts = new Array(8).fill(0);
    dim.reason.forEach(r => counts[r]++);
    if (mode === 'reason') legend.replaceChildren(...C.reasons.map((n, r) => counts[r] ? h('span', null, h('span', { class: 'swatch', style: { background: REASON_COLOUR[r] } }), cap(n), h('b', null, fmtInt(counts[r]))) : null).filter(Boolean));
    else if (mode === 'status') legend.replaceChildren(...STATUS.map((n, i) => h('span', null, h('span', { class: 'swatch', style: { background: ['#4a5262', '#56B4E9', '#E69F00'][i] } }), cap(n))));
    else legend.replaceChildren(h('span', null, mode === 'cost' ? '1 µs' : 'few', ' ', h('span', { class: 'heatbar', style: { background: HEAT_CSS } }), ' ', mode === 'cost' ? '5 ms+ a tick' : fmtInt(maxOf(mode))),
      mode === 'cost' && h('span', null, h('span', { class: 'swatch', style: { background: 'rgba(128,128,128,.3)' } }), 'loaded, nothing timed'));
    summary.textContent = `${fmtInt(dim.total)} loaded chunks` + (dim.edges ? `, ${fmtInt(dim.edges)} more at the edges` : '') + (dim.total > dim.x.length ? ` (${fmtInt(dim.x.length)} shown)` : '');
  };
  const draw = () => {
    const dpr = devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    const sz = view.scale, ox = r.width / 2 - view.cx * sz, oz = r.height / 2 - view.cz * sz;
    const gap = sz >= 6 ? 1 : 0;
    for (let i = 0; i < dim.x.length; i++) {
      const px = ox + dim.x[i] * sz, pz = oz + dim.z[i] * sz;
      if (px > r.width || pz > r.height || px + sz < 0 || pz + sz < 0) continue;
      g.fillStyle = colourOf(i);
      g.fillRect(px, pz, sz - gap, sz - gap);
    }
    // sources: a ring at each loader
    g.lineWidth = 1.5;
    for (let s = 0; s < dim.sources.x.length; s++) {
      if (dim.sources.reason[s] === 0) continue;
      const px = ox + (dim.sources.x[s] + .5) * sz, pz = oz + (dim.sources.z[s] + .5) * sz;
      g.strokeStyle = getComputedStyle(document.body).color;
      g.beginPath(); g.arc(px, pz, Math.max(3, sz * .35), 0, Math.PI * 2); g.stroke();
    }
    // spawn axis
    g.strokeStyle = 'rgba(128,128,128,.35)';
    g.beginPath(); g.moveTo(ox, 0); g.lineTo(ox, r.height); g.moveTo(0, oz); g.lineTo(r.width, oz); g.stroke();
  };
  const chunkAt = e => {
    const r = canvas.getBoundingClientRect(), sz = view.scale;
    const x = Math.floor((e.clientX - r.left - r.width / 2) / sz + view.cx), z = Math.floor((e.clientY - r.top - r.height / 2) / sz + view.cz);
    return { x, z, i: index.get(x + ',' + z) };
  };
  const pick = () => {
    index = new Map();
    for (let i = 0; i < dim.x.length; i++) index.set(dim.x[i] + ',' + dim.z[i], i);
    fit(); drawLegend(); draw(); sources();
  };
  const sources = () => {
    const S = dim.sources, groups = new Map();
    const loaded = new Array(S.x.length).fill(0);
    dim.source.forEach(s => s >= 0 && loaded[s]++);
    for (let k = 0; k < S.x.length; k++) {
      const key = S.reason[k] + '|' + S.owner[k];
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { reason: S.reason[k], reasonName: C.reasons[S.reason[k]], owner: S.owner[k], n: 0, loaded: 0, x: S.x[k], z: S.z[k], best: -1 }));
      g.n++;
      g.loaded += loaded[k];
      if (loaded[k] > g.best) { g.best = loaded[k]; g.x = S.x[k]; g.z = S.z[k]; }
    }
    const rows = [...groups.values()];
    const table = dataTable({
      rows, initialSort: 'loaded', search: r => `${r.reasonName} ${r.owner} ${r.x} ${r.z}`,
      filters: [{ all: 'All reasons', get: r => r.reason, options: [...new Set(rows.map(r => r.reason))].map(r => [r, cap(C.reasons[r])]) }],
      onRow: r => copy(tpCommand(dim.dim, r.x * 16 + 8, 100, r.z * 16 + 8)),
      cols: [
        { title: 'Why', key: 'reasonName', asc: true, cell: r => [h('span', { class: 'swatch', style: { background: REASON_COLOUR[r.reason] } }), cap(r.reasonName)] },
        { title: 'Who or what', key: 'owner', cls: 'name', asc: true, cell: r => r.owner || '–' },
        { title: 'Tickets', key: 'n', num: true, cell: r => fmtInt(r.n) },
        { title: 'Chunks it keeps', key: 'loaded', num: true, cell: r => fmtInt(r.loaded) },
        { title: 'Biggest at', key: 'x', cls: 'where', cell: r => `chunk ${r.x}, ${r.z}` },
      ],
    });
    table.prepend(h('h3', null, 'What keeps them loaded', h('span', { class: 'sub' }, 'each loader, its tickets together · click to copy a /tp')));
    sourcesBox.replaceChildren(table);
  };
  dimSel.addEventListener('change', () => { dim = dims.find(d => d.dim === dimSel.value); pick(); });
  modeSel.addEventListener('change', () => { mode = modeSel.value; drawLegend(); draw(); });
  let drag = null, moved = false;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz }; moved = false; canvas.setPointerCapture(e.pointerId); wrap.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', e => {
    if (drag) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) moved = true;
      view.cx = drag.cx - (e.clientX - drag.x) / view.scale; view.cz = drag.cz - (e.clientY - drag.y) / view.scale; draw(); hideTip(); return;
    }
    const c = chunkAt(e);
    if (c.i == null) { hideTip(); return; }
    const i = c.i, cost = costs.get(`${dim.dim}|${c.x}|${c.z}`);
    const allReasons = C.reasons.filter((n, r) => dim.reasons[i] & (1 << r)).join(', ');
    const src = dim.source[i];
    showTip(e, `<b>Chunk ${c.x}, ${c.z}</b> <span style="color:var(--ink3)">blocks ${c.x * 16} ${c.z * 16}</span>` +
      row('loaded by', cap(C.reasons[dim.reason[i]])) + (allReasons && allReasons !== C.reasons[dim.reason[i]] ? row('also in reach of', allReasons) : '') +
      (src >= 0 && dim.sources.owner[src] ? row('owner', dim.sources.owner[src]) : '') +
      row('activity', STATUS[dim.status[i]]) + row('entities', dim.entities[i]) + row('block entities', dim.blockEntities[i]) +
      (cost ? row('cost per tick', fmtNs(cost.cost)) + (cost.top ? row('mostly', cost.top) : '') : ''));
  });
  canvas.addEventListener('pointerup', e => {
    drag = null; wrap.style.cursor = '';
    if (!moved) { const c = chunkAt(e); if (c.i != null) copy(tpCommand(dim.dim, c.x * 16 + 8, 100, c.z * 16 + 8)); }
  });
  canvas.addEventListener('pointerleave', hideTip);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
    const before = { x: mx / view.scale + view.cx, z: my / view.scale + view.cz };
    view.scale = Math.max(0.5, Math.min(60, view.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    view.cx = before.x - mx / view.scale; view.cz = before.z - my / view.scale;
    draw();
  }, { passive: false });
  new ResizeObserver(() => draw()).observe(wrap);
  requestAnimationFrame(pick);
  return root;
}

// ---------- server info ----------

function serverView(doc) {
  const S = doc.server, H = doc.health;
  const root = h('div');
  const two = h('div', { class: 'two' });
  two.append(h('div', { class: 'panel' }, h('h3', null, 'Platform'), kv([
    ['Minecraft', S.minecraft], ['NeoForge', S.neoforge], ['Culprit', S.culprit], ['Culprit Web', S.culpritweb],
    ['Server', S.dedicated ? 'dedicated' : 'integrated (single player / LAN)'], ['MOTD', S.motd || '–'],
    ['View / simulation distance', `${S.viewDistance} / ${S.simulationDistance} chunks`],
    ['Java', S.java], ['VM', S.vm], ['OS', S.os], ['CPU cores', S.cores], ['Max memory', fmtBytes(S.maxMemory)],
    ['JVM flags', S.jvmFlags.length ? h('code', null, S.jvmFlags.join(' ')) : '–']])));
  if (H) two.append(h('div', { class: 'panel' }, h('h3', null, 'Health when the report was made'), healthKv(H)));
  root.append(two);
  root.append(dataTable({
    rows: S.mods, initialSort: 'name', search: m => `${m.name} ${m.id} ${m.version}`,
    cols: [
      { title: `Mods (${S.mods.length})`, key: 'name', cls: 'name', asc: true, cell: m => [m.name, h('span', { class: 'id' }, m.id)] },
      { title: 'Version', key: 'version', asc: true, cls: 'where' },
    ],
  }));
  return root;
}

function kv(pairs) {
  return h('div', { class: 'kv' }, pairs.flatMap(([k, v]) => [h('div', null, k), h('div', null, v)]));
}

function healthKv(H) {
  return kv([
    ['TPS (5 s / 1 m / 5 m / 15 m)', `${H.tps.s5.toFixed(1)} / ${H.tps.m1.toFixed(1)} / ${H.tps.m5.toFixed(1)} / ${H.tps.m15.toFixed(1)}`],
    ['MSPT last minute (median / 95% / max)', `${fmtMs(H.mspt.m1.median)} / ${fmtMs(H.mspt.m1.p95)} / ${fmtMs(H.mspt.m1.max)}`],
    ['CPU (server / machine)', `${(H.cpu.process * 100).toFixed(0)}% / ${(H.cpu.system * 100).toFixed(0)}%`],
    ['Memory', `${fmtBytes(H.memory.used)} of ${fmtBytes(H.memory.max)}`],
    ['GC', H.gc.map(g => `${g.name}: ${fmtInt(g.count)} (${fmtInt(g.timeMs)} ms)`).join(', ')],
    ['Players', `${H.players.online} / ${H.players.max}`], ['Uptime', fmtDur(H.uptimeMs)], ['Threads', H.threads],
    ['Worlds', H.worlds.map(w => `${shortDim(w.dim)}: ${fmtInt(w.chunks)} chunks, ${fmtInt(w.entities)} entities`).join(' · ')],
  ]);
}

// ---------- live health ----------

function live(id) {
  document.title = 'Live health · Culprit Web';
  let timer, failed = 0;
  const tick = async () => {
    try {
      const res = await fetch('/api/live/' + encodeURIComponent(id), { cache: 'no-store' });
      if (res.status === 410 || res.status === 404) {
        app.replaceChildren(h('div', { class: 'error' }, 'This live link has ended. Run /culpritweb health for a new one.'));
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      failed = 0;
      drawLive(await res.json());
    } catch (e) {
      if (++failed === 3) setTop(['Live health', 'server not answering…']);
    }
    timer = setTimeout(tick, 1000);
  };
  tick();
}

let liveBuilt;
function drawLive(d) {
  const H = d.health, S = d.server;
  if (!H.tps) { app.replaceChildren(h('div', { class: 'loading' }, 'Waiting for the server’s first second…')); return; }
  setTop(['Live health', S.motd || '', `MC ${S.minecraft}`, `until ${new Date(d.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`],
    [h('span', { class: 'pill good' }, '● live')]);
  const mem = H.memory.used / H.memory.max;
  const tiles = h('div', { class: 'tiles' },
    tile('TPS', H.tps.s5.toFixed(1), null, h('span', null, tpsPill(H.tps.s5), ` 1m ${H.tps.m1.toFixed(1)} · 15m ${H.tps.m15.toFixed(1)}`)),
    tile('MSPT', fmtMs(H.mspt.s10.mean), null, `10 s: median ${fmtMs(H.mspt.s10.median)} · 95% ${fmtMs(H.mspt.s10.p95)} · max ${fmtMs(H.mspt.s10.max)}`),
    tile('CPU', (H.cpu.process * 100).toFixed(0), '%', `machine ${(H.cpu.system * 100).toFixed(0)}% · ${H.cpu.cores} cores`),
    tile('Memory', fmtBytes(H.memory.used), null, `${(mem * 100).toFixed(0)}% of ${fmtBytes(H.memory.max)}`),
    tile('Players', `${H.players.online}`, `/ ${H.players.max}`, `up ${fmtDur(H.uptimeMs)}`),
    tile('Loaded', fmtInt(H.worlds.reduce((a, w) => a + w.chunks, 0)), 'chunks', fmtInt(H.worlds.reduce((a, w) => a + w.entities, 0)) + ' entities'));
  const se = H.series, t0 = se.at[se.at.length - 1] || 0;
  const x = se.at.map(t => (t - t0) / 1000);
  const fmtAgo = v => v >= -0.5 ? 'now' : `${Math.round(-v)} s ago`;
  const charts = h('div', { class: 'two' },
    h('div', { class: 'panel' }, h('h3', null, 'MSPT', h('span', { class: 'sub' }, 'average and worst tick each second · line at 50 ms')),
      lineChart({ x, ys: [{ v: se.msptMax, colour: '#F0304A', name: 'worst' }, { v: se.mspt, colour: 'var(--accent2)', name: 'average' }], marks: [50], fmtX: fmtAgo, fmtY: fmtMs })),
    h('div', { class: 'panel' }, h('h3', null, 'TPS'), lineChart({ x, ys: [{ v: se.tps, colour: '#56B4E9', name: 'TPS' }], yMax: 21, fmtX: fmtAgo, fmtY: v => v.toFixed(1) })),
    h('div', { class: 'panel' }, h('h3', null, 'CPU', h('span', { class: 'sub' }, 'this server process')), lineChart({ x, ys: [{ v: se.cpu, colour: '#009E73', name: 'CPU' }], yMax: 100, fmtX: fmtAgo, fmtY: v => v.toFixed(0) + '%' })),
    h('div', { class: 'panel' }, h('h3', null, 'Memory', h('span', { class: 'sub' }, 'heap in use · drops are garbage collection')),
      lineChart({ x, ys: [{ v: se.memMb, colour: '#CC79A7', name: 'heap' }], yMax: H.memory.max / 1048576, fmtX: fmtAgo, fmtY: v => fmtBytes(v * 1048576) })));
  const worlds = h('div', { class: 'panel' }, h('h3', null, 'Worlds'), h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Dimension'), h('th', { class: 'num' }, 'Chunks'), h('th', { class: 'num' }, 'Entities'), h('th', { class: 'num' }, 'Players'))),
    h('tbody', null, H.worlds.map(w => h('tr', null, h('td', null, shortDim(w.dim)), h('td', { class: 'num' }, fmtInt(w.chunks)), h('td', { class: 'num' }, fmtInt(w.entities)), h('td', { class: 'num' }, w.players))))));
  const hovering = !tip.hidden;
  if (hovering && liveBuilt) { liveBuilt.tiles.replaceWith(tiles); liveBuilt.tiles = tiles; return; }
  liveBuilt = { tiles };
  app.replaceChildren(tiles, charts, worlds,
    h('div', { class: 'note' }, 'Run /culpritweb profiler to find what is behind a high MSPT.'));
}
