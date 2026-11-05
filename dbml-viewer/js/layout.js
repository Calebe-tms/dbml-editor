'use strict';
/* ========================== layout automático ========================== */
function autoLayout(nodes, edges) {
  const GX = 110, GY = 36, MAXH = 1500;
  const refsOf = new Map(nodes.map(n => [n, []])), nbr = new Map(nodes.map(n => [n, new Set()]));
  for (const e of edges) {
    if (e.a === e.b) continue;
    // "quem referencia" fica à direita de "quem é referenciado"
    let from = e.a, to = e.b;
    if (e.kind === 'ref' && (e.ca === '1' && e.cb === '*')) { from = e.b; to = e.a; }
    refsOf.get(from).push(to); nbr.get(from).add(to); nbr.get(to).add(from);
  }
  const state = new Map(), rank = new Map();
  const rk = v => {
    if (rank.has(v)) return rank.get(v);
    state.set(v, 1); let r = 0;
    for (const u of refsOf.get(v)) { if (state.get(u) === 1) continue; r = Math.max(r, rk(u) + 1); }
    state.set(v, 2); rank.set(v, r); return r;
  };
  const connected = nodes.filter(n => nbr.get(n).size > 0), isolated = nodes.filter(n => nbr.get(n).size === 0);
  connected.forEach(rk);
  const layers = [];
  for (const v of connected) (layers[rank.get(v)] = layers[rank.get(v)] || []).push(v);
  const L = layers.filter(Boolean);
  const pos = new Map(); const reindex = () => L.forEach(l => l.forEach((v, i) => pos.set(v, i)));
  reindex();
  for (let it = 0; it < 8; it++) {
    const order = it % 2 === 0 ? L : [...L].reverse();
    for (const layer of order) {
      const bary = new Map(layer.map(v => {
        const ns = [...nbr.get(v)].filter(u => rank.get(u) !== rank.get(v));
        return [v, ns.length ? ns.reduce((s, u) => s + pos.get(u) / Math.max(1, L[rank.get(u)] ? 1 : 1), 0) / ns.length : pos.get(v)];
      }));
      layer.sort((a, b) => bary.get(a) - bary.get(b));
      layer.forEach((v, i) => pos.set(v, i));
    }
  }
  // empacota em colunas
  const colsList = [];
  for (const layer of L) {
    let cur = [], hh = 0; const cols = [];
    for (const v of layer) { if (cur.length && hh + v.h + GY > MAXH) { cols.push(cur); cur = []; hh = 0; } cur.push(v); hh += v.h + GY; }
    if (cur.length) cols.push(cur);
    colsList.push(cols);
  }
  const colH = c => c.reduce((s, v) => s + v.h + GY, -GY);
  const maxTot = Math.max(0, ...colsList.map(cols => cols.length === 1 ? colH(cols[0]) : 0));
  let x = 0, totalH = 0;
  for (const cols of colsList) for (const c of cols) {
    const w = Math.max(...c.map(v => v.w)); let y = cols.length === 1 ? (maxTot - colH(c)) / 2 : 0;
    for (const v of c) { v.x = x; v.y = y; y += v.h + GY; }
    totalH = Math.max(totalH, y); x += w + GX;
  }
  const mainW = Math.max(0, x - GX);
  if (isolated.length) {
    const target = Math.max(mainW, 1300); let cx = 0, cy = connected.length ? totalH + 70 : 0, rowH = 0;
    for (const v of isolated) {
      if (cx > 0 && cx + v.w > target) { cx = 0; cy += rowH + GY; rowH = 0; }
      v.x = cx; v.y = cy; cx += v.w + 50; rowH = Math.max(rowH, v.h);
    }
  }
}

