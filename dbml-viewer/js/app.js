'use strict';
/* ============================ utilidades ============================ */
const $ = s => document.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const sv = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

const vp = $('#vp'), world = $('#world'), svgEl = $('#edges');
let model = null, byId = {}, view = { tx: 40, ty: 40, s: 1 }, selected = null, zTop = 10;
let bandNode = null, caretNode = null, doc = null, ed = null, saveTimer = 0, compileTimer = 0, extPending = false;
let prefs = { light: false, sw: 440, noside: false };
const P = window.__DBML__;

/* ============================ persistência ============================ */
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignora */ } }
};
// Com o launcher (servidor local) o arquivo, o layout e as preferências ficam em disco; sem ele, usa localStorage.
const backend = P && P.api ? {
  async file() { const r = await fetch('file', { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return { text: await r.text(), mtime: Number(r.headers.get('X-Mtime')) }; },
  async save(text) { const r = await fetch('file', { method: 'PUT', body: text }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); },
  async ping() { const r = await fetch('ping', { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); },
  async get(name) { try { const r = await fetch(name, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } },
  async put(name, obj) { try { await fetch(name, { method: 'PUT', body: JSON.stringify(obj) }); } catch (e) { /* ignora */ } }
} : null;
const kv = {
  async get(name) { return backend ? backend.get(name) : ls.get('dbmlv:' + name + (name === 'layout' && doc ? ':' + doc.key : '')); },
  put(name, obj) { if (backend) backend.put(name, obj); else ls.set('dbmlv:' + name + (name === 'layout' && doc ? ':' + doc.key : ''), obj); }
};
function applyPrefs() {
  document.body.classList.toggle('light', !!prefs.light);
  document.body.classList.toggle('noside', !!prefs.noside);
  $('#bSide').classList.toggle('on', !prefs.noside);
  document.documentElement.style.setProperty('--sw', prefs.sw + 'px');
}
const savePrefs = () => { applyPrefs(); kv.put('prefs', prefs); };

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!model || !doc || doc.layout) return;
    const pos = {}; for (const n of model.nodes) pos[n.id] = [Math.round(n.x), Math.round(n.y)];
    kv.put('layout', { pos, view });
  }, 300);
}

/* ============================== diagrama ============================== */
function applyView() {
  world.style.transform = `translate(${view.tx}px,${view.ty}px) scale(${view.s})`;
  const g = 24 * view.s; vp.style.backgroundSize = `${g}px ${g}px`; vp.style.backgroundPosition = `${view.tx}px ${view.ty}px`;
  $('#zoom').textContent = Math.round(view.s * 100) + '%';
  scheduleSave();
}
function measure(n) {
  n.w = n.el.offsetWidth; n.h = n.el.offsetHeight;
  n.rowY = {}; n.hdY = n.hd.offsetHeight / 2;
  n.el.querySelectorAll('.rw').forEach(r => { n.rowY[r.dataset.col] = r.offsetTop + r.offsetHeight / 2; });
}
function placeNode(n) { n.el.style.left = n.x + 'px'; n.el.style.top = n.y + 'px'; }

function buildNode(n) {
  const el = h('div', 'tbl' + (n.kind === 'enum' ? ' enum' : '')); el.dataset.id = n.id;
  const hd = h('div', 'hd'); if (n.color) hd.style.background = n.color;
  hd.append(h('span', null, n.name)); if (n.schema) hd.append(h('small', null, n.schema));
  if (n.alias) hd.append(h('small', null, 'as ' + n.alias));
  if (n.note) hd.title = n.note;
  el.append(hd);
  if (n.kind === 'table') for (const c of n.cols) {
    const r = h('div', 'rw'); r.dataset.col = c.name;
    r.append(h('span', 'cn', c.name));
    if (c.pk) r.append(h('span', 'bd pk', 'PK')); if (c.fk) r.append(h('span', 'bd fk', 'FK'));
    r.append(h('span', 'ty', c.type));
    r.title = [`${c.name}: ${c.type}`, [c.pk && 'PK', c.notnull && 'NOT NULL', c.unique && 'UNIQUE', c.inc && 'AUTO INCREMENT'].filter(Boolean).join(', '),
      c.def != null ? 'default: ' + c.def : '', c.note || ''].filter(Boolean).join('\n');
    el.append(r);
  } else for (const v of n.values) { const r = h('div', 'rw'); r.dataset.col = v.name; r.append(h('span', 'cn', v.name)); if (v.note) r.title = v.note; el.append(r); }
  n.el = el; n.hd = hd; world.append(el);
}

function markerPath(x, y, dir, card) {
  if (card === '1') return `M${x + dir * 11} ${y - 5}V${y + 5}M${x + dir * 16} ${y - 5}V${y + 5}`;
  if (card === '*') return `M${x + dir * 13} ${y}L${x} ${y - 6}M${x + dir * 13} ${y}L${x} ${y}M${x + dir * 13} ${y}L${x} ${y + 6}`;
  return '';
}
function endY(n, cols) { const c = cols && cols[0]; return n.y + (c != null && n.rowY[c] != null ? n.rowY[c] : n.hdY); }
function drawEdge(e) {
  const A = e.a, B = e.b, y1 = endY(A, e.aCols), y2 = endY(B, e.bCols);
  let sa, sb;
  if (A === B) { sa = sb = 1; }
  else if (A.x + A.w + 30 <= B.x) { sa = 1; sb = -1; }
  else if (B.x + B.w + 30 <= A.x) { sa = -1; sb = 1; }
  else { sa = sb = 1; }
  const x1 = sa > 0 ? A.x + A.w : A.x, x2 = sb > 0 ? B.x + B.w : B.x, dx = Math.abs(x2 - x1);
  const d = sa === sb ? 55 + Math.min(dx * 0.25, 120) : Math.max(45, Math.min(dx / 2, 200));
  e.ln.setAttribute('d', `M${x1} ${y1}C${x1 + sa * d} ${y1},${x2 + sb * d} ${y2},${x2} ${y2}`);
  e.mk.setAttribute('d', markerPath(x1, y1, sa, e.ca) + markerPath(x2, y2, sb, e.cb));
}
function buildEdges() {
  svgEl.replaceChildren();
  for (const e of model.edges) {
    const g = sv('g', { class: 'edge ' + e.kind }); e.g = g;
    e.ln = sv('path', { class: 'ln' }); e.mk = sv('path', { class: 'mk' });
    g.append(e.ln, e.mk); svgEl.append(g); drawEdge(e);
  }
}
const edgesOf = n => model.edges.filter(e => e.a === n || e.b === n);

function select(n) {
  selected = n;
  const rel = new Set(); if (n) { rel.add(n); for (const e of edgesOf(n)) { rel.add(e.a); rel.add(e.b); } }
  for (const m of model.nodes) { m.el.classList.toggle('sel', m === n); m.el.classList.toggle('dim', !!n && !rel.has(m)); }
  for (const e of model.edges) { const on = !!n && (e.a === n || e.b === n); e.g.classList.toggle('hl', on); e.g.classList.toggle('dim', !!n && !on); }
}
function centerOn(n) { view.tx = vp.clientWidth / 2 - (n.x + n.w / 2) * view.s; view.ty = vp.clientHeight / 2 - (n.y + n.h / 2) * view.s; applyView(); }
function fit() {
  if (!model || !model.nodes.length) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of model.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
  const w = x1 - x0, hh = y1 - y0, vw = vp.clientWidth, vh = vp.clientHeight;
  view.s = Math.max(0.1, Math.min(1.1, (vw - 80) / w, (vh - 80) / hh));
  view.tx = (vw - w * view.s) / 2 - x0 * view.s; view.ty = (vh - hh * view.s) / 2 - y0 * view.s; applyView();
}
function zoomAt(f, cx, cy) {
  const s2 = Math.max(0.08, Math.min(3, view.s * f)), wx = (cx - view.tx) / view.s, wy = (cy - view.ty) / view.s;
  view.s = s2; view.tx = cx - wx * s2; view.ty = cy - wy * s2; applyView();
}
function runSearch() {
  const q = $('#q').value.trim().toLowerCase(); let first = null;
  for (const n of model ? model.nodes : []) {
    const m = !!q && (n.full.toLowerCase().includes(q) || (n.cols || n.values).some(c => c.name.toLowerCase().includes(q)));
    n.el.classList.toggle('match', m); if (m && !first) first = n;
  }
  return first;
}

/* ---- ligação diagrama <-> código ---- */
const nodeAt = line => model && model.nodes.find(n => line >= n.line && line <= n.endLine) || null;
function showBand(n) { bandNode = n; ed.setBand(n ? n.line : 0, n ? n.endLine : 0); }
function revealNode(n) {
  if (prefs.noside) { prefs.noside = false; savePrefs(); }
  showBand(n); ed.reveal(n.line, n.endLine);
}
function onCaretLine(l) {
  const n = nodeAt(l);
  if (n !== caretNode) { if (caretNode && caretNode.el) caretNode.el.classList.remove('cur'); caretNode = n; if (n) n.el.classList.add('cur'); }
  showBand(n);
}

/* ---- novas tabelas: posiciona sem sobrepor as existentes ---- */
function placeNew(n, placed, edges) {
  let x, y; const nb = [];
  for (const e of edges) { if (e.a === n && placed.includes(e.b)) nb.push(e.b); else if (e.b === n && placed.includes(e.a)) nb.push(e.a); }
  if (nb.length) { const X = nb[0]; x = X.x + X.w + 100; y = X.y; }
  else { x = Math.min(...placed.map(p => p.x)); y = Math.max(...placed.map(p => p.y + p.h)) + 60; }
  const hit = () => placed.some(p => x < p.x + p.w + 24 && x + n.w + 24 > p.x && y < p.y + p.h + 24 && y + n.h + 24 > p.y);
  for (let i = 0; i < 400 && hit(); i++) y += 30;
  n.x = x; n.y = y; placed.push(n);
}
const sig = n => n.kind + ':' + (n.cols || n.values).map(c => c.name).join('|');

function clearDiagram() { world.querySelectorAll('.tbl').forEach(e => e.remove()); svgEl.replaceChildren(); }
function applyModel(m) {
  const prev = model, first = !prev, selId = selected ? selected.id : null;
  clearDiagram(); model = m; byId = {}; selected = null; caretNode = null; bandNode = null;
  for (const n of m.nodes) { byId[n.id] = n; buildNode(n); }
  m.nodes.forEach(measure);
  autoLayout(m.nodes, m.edges);
  const known = new Map();
  if (prev) for (const n of prev.nodes) known.set(n.id, [n.x, n.y]);
  else if (doc.layout && doc.layout.pos) for (const k in doc.layout.pos) known.set(k, doc.layout.pos[k]);
  if (prev) { // renomear uma tabela no código mantém a posição (mesma linha / mesmas colunas)
    const gone = prev.nodes.filter(o => !byId[o.id]);
    for (const n of m.nodes) {
      if (known.has(n.id)) continue;
      const o = gone.find(o => o.kind === n.kind && o.line === n.line) || gone.find(o => sig(o) === sig(n));
      if (o) { known.set(n.id, [o.x, o.y]); gone.splice(gone.indexOf(o), 1); }
    }
  }
  const placed = [], fresh = [];
  for (const n of m.nodes) { if (known.has(n.id)) { n.x = known.get(n.id)[0]; n.y = known.get(n.id)[1]; placed.push(n); } else fresh.push(n); }
  if (placed.length) for (const n of fresh) placeNew(n, placed, m.edges);
  m.nodes.forEach(placeNode); buildEdges();
  if (selId && byId[selId]) select(byId[selId]);
  const nt = m.nodes.filter(n => n.kind === 'table').length, ne = m.nodes.length - nt;
  $('#status').textContent = `${nt} tabelas` + (ne ? ` · ${ne} enums` : '') + ` · ${m.edges.filter(e => e.kind === 'ref').length} relações` + (m.warnings.length ? ` · ⚠ ${m.warnings.join(' | ')}` : '');
  $('#empty').style.display = m.nodes.length ? 'none' : 'flex'; $('#empty').textContent = 'Escreva o DBML no editor ao lado';
  if (first) { if (doc.layout && doc.layout.view) { view = doc.layout.view; applyView(); } else fit(); doc.layout = null; }
  runSearch(); onCaretLine(ed.caretLine());
  (document.fonts && document.fonts.ready || Promise.resolve()).then(() => { if (model !== m) return; m.nodes.forEach(measure); m.edges.forEach(drawEdge); });
  window.__model = m;
}

function compile() {
  let m;
  try { m = parseDbml(ed.value); }
  catch (e) {
    ed.setError(e instanceof DbmlError ? e.line : 1, e.message);
    if (!model) { $('#empty').style.display = 'flex'; $('#empty').textContent = 'Corrija o erro de sintaxe no código'; }
    return;
  }
  ed.setError(0, null); applyModel(m);
}

/* ============================ documento ============================ */
const isDirty = () => !!doc && ed.value !== doc.saved;
function updateDirty() {
  const d = isDirty();
  $('#dirty').style.display = d ? 'inline' : 'none'; $('#bSave').disabled = !d;
  document.title = (d ? '• ' : '') + (doc ? doc.name : 'DBML Editor') + ' — DBML Editor';
}
function setSaveState(txt, bad) { const s = $('#saveState'); s.textContent = txt; s.classList.toggle('bad', !!bad); }
async function loadDocument(text, name, key, extra) {
  extra = extra || {};
  const eol = text.includes('\r\n') ? '\r\n' : '\n', t = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  doc = { name, key, eol, saved: t, mtime: extra.mtime || 0, handle: extra.handle || null, layout: null };
  clearDiagram(); model = null; selected = null;
  doc.layout = await kv.get('layout');
  ed.setValue(t); ed.setError(0, null); $('#fname').textContent = name; updateDirty(); setSaveState('');
  compile();
}
async function save() {
  if (!doc || !isDirty()) return;
  const text = ed.value.replace(/\n/g, doc.eol), snapshot = ed.value;
  try {
    if (backend) { const r = await backend.save(text); doc.mtime = r.mtime; }
    else if (doc.handle) { const w = await doc.handle.createWritable(); await w.write(text); await w.close(); }
    else { const a = h('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = doc.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
    doc.saved = snapshot; extPending = false; $('#ext').style.display = 'none';
    updateDirty(); setSaveState('Salvo às ' + new Date().toLocaleTimeString('pt-BR'));
  } catch (e) { setSaveState('Erro ao salvar: ' + e.message, true); }
}
async function reloadFromDisk() {
  const f = await backend.file(), st = ed.ta.scrollTop, t = f.text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  doc.eol = f.text.includes('\r\n') ? '\r\n' : '\n'; doc.saved = t; doc.mtime = f.mtime; extPending = false; $('#ext').style.display = 'none';
  ed.setValue(t); ed.ta.scrollTop = st; updateDirty(); compile(); setSaveState('Atualizado a partir do disco');
}
async function poll() {
  try {
    const r = await backend.ping();
    if (doc && doc.mtime && r.mtime && r.mtime !== doc.mtime && !extPending) {
      if (!isDirty()) await reloadFromDisk(); else { extPending = true; doc.diskMtime = r.mtime; $('#ext').style.display = 'flex'; }
    }
  } catch (e) { setSaveState('Sem conexão com o servidor local — reabra o arquivo', true); }
}
$('#extReload').onclick = () => reloadFromDisk();
$('#extKeep').onclick = () => { doc.mtime = doc.diskMtime || doc.mtime; extPending = false; $('#ext').style.display = 'none'; };

/* ============================ interação ============================ */
let drag = null;
vp.addEventListener('pointerdown', ev => {
  if (ev.button !== 0 || !model) return;
  const tb = ev.target.closest('.tbl'); vp.setPointerCapture(ev.pointerId);
  if (tb) {
    const n = byId[tb.dataset.id]; n.el.style.zIndex = ++zTop;
    drag = { type: 'node', n, sx: ev.clientX, sy: ev.clientY, ox: n.x, oy: n.y, moved: false };
  } else { drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, ox: view.tx, oy: view.ty, moved: false }; vp.classList.add('panning'); }
});
vp.addEventListener('pointermove', ev => {
  if (!drag) return;
  const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  if (!drag.moved) { drag.moved = true; if (drag.type === 'node') drag.n.el.classList.add('dragging'); }
  if (drag.type === 'node') {
    const n = drag.n; n.x = drag.ox + dx / view.s; n.y = drag.oy + dy / view.s;
    if (ev.shiftKey) { n.x = Math.round(n.x / 20) * 20; n.y = Math.round(n.y / 20) * 20; }
    placeNode(n); for (const e of edgesOf(n)) drawEdge(e);
  } else { view.tx = drag.ox + dx; view.ty = drag.oy + dy; applyView(); }
});
const endDrag = () => {
  if (!drag) return;
  if (drag.type === 'node') {
    drag.n.el.classList.remove('dragging');
    if (!drag.moved) { const on = selected !== drag.n; select(on ? drag.n : null); if (on) revealNode(drag.n); else showBand(caretNode); }
    else scheduleSave();
  } else { vp.classList.remove('panning'); if (!drag.moved) { select(null); showBand(caretNode); } }
  drag = null;
};
vp.addEventListener('pointerup', endDrag); vp.addEventListener('pointercancel', endDrag);
vp.addEventListener('wheel', ev => {
  ev.preventDefault(); const r = vp.getBoundingClientRect();
  zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)), ev.clientX - r.left, ev.clientY - r.top);
}, { passive: false });

$('#bFit').onclick = fit;
$('#bPlus').onclick = () => zoomAt(1.2, vp.clientWidth / 2, vp.clientHeight / 2);
$('#bMinus').onclick = () => zoomAt(1 / 1.2, vp.clientWidth / 2, vp.clientHeight / 2);
$('#bOrg').onclick = () => { if (!model) return; autoLayout(model.nodes, model.edges); model.nodes.forEach(placeNode); model.edges.forEach(drawEdge); select(null); fit(); };
$('#bTheme').onclick = () => { prefs.light = !prefs.light; savePrefs(); };
$('#bSide').onclick = () => { prefs.noside = !prefs.noside; savePrefs(); };
$('#bSave').onclick = save;
$('#q').addEventListener('input', runSearch);
$('#q').addEventListener('keydown', ev => {
  if (ev.key === 'Enter') { const n = runSearch(); if (n) { select(n); centerOn(n); revealNode(n); } }
  if (ev.key === 'Escape') { ev.target.value = ''; runSearch(); ev.target.blur(); }
});
addEventListener('keydown', ev => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'b') { ev.preventDefault(); $('#bSide').click(); return; }
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
  if (ev.key === '/') { ev.preventDefault(); $('#q').focus(); }
  else if (ev.key === '0') fit();
  else if (ev.key === '+' || ev.key === '=') $('#bPlus').click();
  else if (ev.key === '-') $('#bMinus').click();
  else if (ev.key === 'Escape') { select(null); showBand(caretNode); }
});
// divisória redimensionável
$('#split').addEventListener('pointerdown', ev => {
  const sp = $('#split'); sp.setPointerCapture(ev.pointerId); sp.classList.add('drag');
  const mv = e => { prefs.sw = Math.round(Math.max(260, Math.min(innerWidth * 0.75, e.clientX))); document.documentElement.style.setProperty('--sw', prefs.sw + 'px'); };
  const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); savePrefs(); };
  sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up);
});
addEventListener('beforeunload', ev => { if (isDirty()) { ev.preventDefault(); ev.returnValue = ''; } });
addEventListener('pagehide', () => { if (backend && navigator.sendBeacon) navigator.sendBeacon('bye'); });

/* ---- abrir arquivo (modo sem servidor) ---- */
async function openLocal() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await showOpenFilePicker({ types: [{ description: 'DBML', accept: { 'text/plain': ['.dbml', '.txt'] } }] });
      const f = await handle.getFile(); await loadDocument(await f.text(), f.name, f.name, { handle });
    } catch (e) { /* cancelado */ }
  } else $('#file').click();
}
$('#bOpen').onclick = openLocal;
$('#file').onchange = ev => { const f = ev.target.files[0]; if (f) f.text().then(t => loadDocument(t, f.name, f.name)); ev.target.value = ''; };
if (!backend) {
  addEventListener('dragover', ev => ev.preventDefault());
  addEventListener('drop', ev => { ev.preventDefault(); const f = ev.dataTransfer.files[0]; if (f) f.text().then(t => loadDocument(t, f.name, f.name)); });
} else $('#bOpen').style.display = 'none';

/* ============================== início ============================== */
ed = new CodeEditor({
  onInput() { updateDirty(); clearTimeout(compileTimer); compileTimer = setTimeout(compile, 250); },
  onCaretLine,
  onSave: save
});
(async () => {
  const p = await kv.get('prefs'); if (p) prefs = Object.assign(prefs, p); applyPrefs();
  if (backend) {
    try { const f = await backend.file(); await loadDocument(f.text, P.name, P.path, { mtime: f.mtime }); setInterval(poll, 3000); }
    catch (e) { setSaveState('Não foi possível ler o arquivo: ' + e.message, true); }
  } else { doc = { name: 'novo.dbml', key: 'novo.dbml', eol: '\n', saved: '', mtime: 0, handle: null, layout: null }; $('#empty').style.display = 'flex'; $('#fname').textContent = 'novo.dbml'; }
})();
