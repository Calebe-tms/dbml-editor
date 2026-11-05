'use strict';
class DbmlError extends Error { constructor(line, msg) { super(msg); this.line = line; } }
/* ============================ tokenizer ============================ */
function tokenize(src) {
  const T = []; let i = 0, line = 1; const n = src.length;
  const isId = c => /[\w$ -￿]/.test(c);
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2), end = e < 0 ? n : e + 2;
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end; continue;
    }
    if (src.startsWith("'''", i)) {
      const e = src.indexOf("'''", i + 3);
      if (e < 0) throw new DbmlError(line, "String ''' não foi fechada");
      const v = src.slice(i + 3, e);
      T.push({ t: 'str', v: v.replace(/^\n/, '').replace(/\n\s*$/, ''), line });
      for (const ch of v) if (ch === '\n') line++;
      i = e + 3; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, v = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < n) { v += src[j + 1]; j += 2; continue; }
        if (src[j] === '\n') line++;
        v += src[j++];
      }
      if (j >= n) throw new DbmlError(line, 'String não foi fechada');
      T.push({ t: c === '"' ? 'qid' : 'str', v, line });
      i = j + 1; continue;
    }
    if (c === '`') {
      const e = src.indexOf('`', i + 1);
      if (e < 0) throw new DbmlError(line, 'Expressão ` não foi fechada');
      T.push({ t: 'expr', v: src.slice(i + 1, e), line });
      i = e + 1; continue;
    }
    if (c === '<' && src[i + 1] === '>') { T.push({ t: 'p', v: '<>', line }); i += 2; continue; }
    if (isId(c)) {
      let j = i; while (j < n && isId(src[j])) j++;
      T.push({ t: 'id', v: src.slice(i, j), line }); i = j; continue;
    }
    T.push({ t: 'p', v: c, line }); i++;
  }
  return T;
}

/* ============================== parser ============================== */
function parseDbml(src) {
  const toks = tokenize(src); let p = 0;
  const tables = [], enums = [], groups = [], refs = [];
  const lastLine = () => toks.length ? toks[toks.length - 1].line : 1;
  const peek = (k = 0) => toks[p + k];
  const next = () => { if (p >= toks.length) throw new DbmlError(lastLine(), 'Fim inesperado do arquivo (falta fechar "}" ?)'); return toks[p++]; };
  const isP = (v, k = 0) => { const t = toks[p + k]; return !!t && t.t === 'p' && t.v === v; };
  const isKw = (v, k = 0) => { const t = toks[p + k]; return !!t && t.t === 'id' && t.v.toLowerCase() === v; };
  const expectP = v => { const t = next(); if (t.t !== 'p' || t.v !== v) throw new DbmlError(t.line, `Esperava "${v}" mas encontrei "${t.v}"`); return t; };
  const oneName = () => { const t = next(); if (t.t === 'id' || t.t === 'qid' || t.t === 'str') return t.v; throw new DbmlError(t.line, `Nome inválido: "${t.v}"`); };
  const dotted = () => { const a = [oneName()]; while (isP('.') && !isP('(', 1)) { next(); a.push(oneName()); } return a; };
  const skipBlock = () => { expectP('{'); let d = 1; while (d > 0) { const t = next(); if (t.t === 'p') { if (t.v === '{') d++; else if (t.v === '}') d--; } } };
  const tokText = t => t.t === 'expr' ? '`' + t.v + '`' : t.v;

  function value() {
    const out = []; let depth = 0;
    for (;;) {
      const t = peek(); if (!t) throw new DbmlError(lastLine(), 'Valor incompleto');
      if (depth === 0 && t.t === 'p' && (t.v === ',' || t.v === ']')) break;
      next();
      if (t.t === 'p') { if (t.v === '(' || t.v === '[') depth++; if (t.v === ')' || t.v === ']') depth--; }
      out.push(tokText(t));
    }
    return out.join('');
  }
  function endpoint() {
    const parts = dotted(); let cols = null;
    if (isP('.') && isP('(', 1)) {
      next(); next(); cols = [];
      while (!isP(')')) { if (isP(',')) { next(); continue; } cols.push(oneName()); }
      next();
    }
    return { parts, cols };
  }
  function refRest() {
    const t = next();
    if (t.t !== 'p' || !['>', '<', '-', '<>'].includes(t.v)) throw new DbmlError(t.line, `Operador de relação inválido: "${t.v}"`);
    return { op: t.v, ep: endpoint() };
  }
  function settings() {
    expectP('[');
    const s = { flags: new Set(), kv: {}, ref: null };
    while (!isP(']')) {
      if (isP(',')) { next(); continue; }
      const key = [];
      while (!isP(',') && !isP(']') && !isP(':')) key.push(String(next().v).toLowerCase());
      const k = key.join(' ');
      if (isP(':')) { next(); if (k === 'ref') s.ref = refRest(); else s.kv[k] = value(); }
      else s.flags.add(k);
    }
    expectP(']');
    return s;
  }
  function type() {
    let ty = dotted().join('.');
    if (isP('(')) { let raw = ''; next(); while (!isP(')')) raw += tokText(next()); next(); ty += '(' + raw + ')'; }
    while (isP('[') && (isP(']', 1) || (peek(1) && peek(1).t === 'id' && /^\d+$/.test(peek(1).v) && isP(']', 2)))) {
      next(); if (!isP(']')) next(); next(); ty += '[]';
    }
    return ty;
  }
  function parseIndexes(t) {
    expectP('{');
    while (!isP('}')) {
      let cols = [];
      if (isP('(')) { next(); while (!isP(')')) { if (isP(',')) { next(); continue; } cols.push(tokText(next())); } next(); }
      else cols = [tokText(next())];
      const st = isP('[') ? settings() : null;
      t.indexes.push({ cols, st });
    }
    expectP('}');
  }
  function parseTable(line) {
    const parts = dotted(); let alias = null;
    if (isKw('as')) { next(); alias = oneName(); }
    const st = isP('[') ? settings() : null;
    expectP('{');
    const t = { kind: 'table', name: parts[parts.length - 1], schema: parts.slice(0, -1).join('.'), full: parts.join('.'), alias,
      color: st && st.kv.headercolor, note: st && st.kv.note, cols: [], indexes: [], line };
    while (!isP('}')) {
      if (isP('~')) { next(); dotted(); continue; }
      const tk = peek();
      if (isKw('note') && (isP(':', 1) || isP('{', 1))) {
        next(); if (isP(':')) { next(); t.note = next().v; } else { next(); t.note = next().v; expectP('}'); }
        continue;
      }
      if (isKw('indexes') && isP('{', 1)) { next(); parseIndexes(t); continue; }
      if (isKw('checks') && isP('{', 1)) { next(); skipBlock(); continue; }
      const col = { name: oneName(), type: '', pk: false, notnull: false, unique: false, inc: false, def: null, note: null, fk: false };
      col.type = type();
      if (isP('[')) {
        const s = settings(), f = s.flags;
        col.pk = f.has('pk') || f.has('primary key'); col.notnull = f.has('not null'); col.unique = f.has('unique');
        col.inc = f.has('increment'); col.def = s.kv.default != null ? s.kv.default : null; col.note = s.kv.note || null;
        if (s.ref) refs.push({ a: { parts: parts, cols: [col.name], direct: true }, op: s.ref.op, b: s.ref.ep, line: tk.line });
      }
      t.cols.push(col);
    }
    t.endLine = expectP('}').line;
    for (const ix of t.indexes) {
      if (!ix.st) continue;
      for (const cn of ix.cols) { const c = t.cols.find(c => c.name === cn); if (!c) continue;
        if (ix.st.flags.has('pk')) c.pk = true;
        if (ix.st.flags.has('unique') && ix.cols.length === 1) c.unique = true; }
    }
    tables.push(t);
  }
  function parseRef(line) {
    let name = null;
    if (!isP(':') && !isP('{')) name = oneName();
    const one = () => {
      const a = endpoint(), r = refRest(), st = isP('[') ? settings() : null;
      refs.push({ a, op: r.op, b: r.ep, st, line });
    };
    if (isP(':')) { next(); one(); }
    else { expectP('{'); while (!isP('}')) one(); expectP('}'); }
  }
  function parseEnum(line) {
    const parts = dotted(); expectP('{');
    const e = { kind: 'enum', name: parts[parts.length - 1], schema: parts.slice(0, -1).join('.'), full: parts.join('.'), values: [], line };
    while (!isP('}')) { const v = { name: oneName(), note: null }; if (isP('[')) { const s = settings(); v.note = s.kv.note || null; } e.values.push(v); }
    e.endLine = expectP('}').line; enums.push(e);
  }
  function parseGroup() {
    const name = oneName(); if (isP('[')) settings(); expectP('{');
    const g = { name, tables: [] };
    while (!isP('}')) {
      if (isKw('note') && isP(':', 1)) { next(); next(); next(); continue; }
      if (isKw('note') && isP('{', 1)) { next(); skipBlock(); continue; }
      g.tables.push(dotted().join('.'));
    }
    expectP('}'); groups.push(g);
  }
  function skipStatement() {
    while (peek()) {
      if (isP('{')) { skipBlock(); return; }
      if (isP(':')) { next(); next(); return; }
      next();
    }
  }

  while (p < toks.length) {
    const tk = next();
    if (tk.t !== 'id') throw new DbmlError(tk.line, `Esperava Table, Ref, Enum… mas encontrei "${tk.v}"`);
    switch (tk.v.toLowerCase()) {
      case 'table': parseTable(tk.line); break;
      case 'ref': parseRef(tk.line); break;
      case 'enum': parseEnum(tk.line); break;
      case 'tablegroup': parseGroup(); break;
      case 'project': case 'note': case 'tablepartial': skipStatement(); break;
      default: throw new DbmlError(tk.line, `Comando desconhecido: "${tk.v}"`);
    }
  }

  /* ---- resolve relações ---- */
  const byKey = new Map(), plain = new Map();
  for (const t of tables) {
    byKey.set(t.full.toLowerCase(), t); if (t.alias) byKey.set(t.alias.toLowerCase(), t);
    const k = t.name.toLowerCase(); plain.set(k, (plain.get(k) || []).concat(t));
  }
  const findTable = name => {
    const k = name.toLowerCase();
    const r = byKey.get(k) || byKey.get(k.replace(/^public\./, '')) || byKey.get('public.' + k);
    if (r) return r;
    const pl = plain.get(k.split('.').pop()); return pl && pl.length === 1 ? pl[0] : null;
  };
  const edges = [], warnings = [];
  const resolve = ep => {
    let tname, cols;
    if (ep.direct) { tname = ep.parts.join('.'); cols = ep.cols; }
    else if (ep.cols) { tname = ep.parts.join('.'); cols = ep.cols; }
    else { tname = ep.parts.slice(0, -1).join('.'); cols = [ep.parts[ep.parts.length - 1]]; }
    const t = tname ? findTable(tname) : null;
    return t ? { t, cols } : null;
  };
  for (const r of refs) {
    const A = resolve(r.a), B = resolve(r.b);
    if (!A || !B) { warnings.push(`Linha ${r.line}: relação ignorada (tabela não encontrada)`); continue; }
    const card = { '>': ['*', '1'], '<': ['1', '*'], '-': ['1', '1'], '<>': ['*', '*'] }[r.op];
    const markFk = (X) => X.cols.forEach(cn => { const c = X.t.cols.find(c => c.name === cn); if (c) c.fk = true; });
    if (r.op === '>' || r.op === '-') markFk(A); else if (r.op === '<') markFk(B);
    edges.push({ a: A.t, aCols: A.cols, b: B.t, bCols: B.cols, ca: card[0], cb: card[1], kind: 'ref', line: r.line });
  }
  const enumByKey = new Map(); for (const e of enums) { enumByKey.set(e.full.toLowerCase(), e); enumByKey.set(e.name.toLowerCase(), e); }
  for (const t of tables) for (const c of t.cols) {
    const base = c.type.replace(/\[\]/g, '').replace(/\(.*\)/, '').toLowerCase();
    const e = enumByKey.get(base) || enumByKey.get(base.replace(/^public\./, ''));
    if (e) edges.push({ a: t, aCols: [c.name], b: e, bCols: [], ca: null, cb: null, kind: 'enum' });
  }
  const nodes = [...tables, ...enums];
  for (const n of nodes) n.id = n.kind + ':' + n.full;
  return { nodes, edges, groups, warnings };
}

