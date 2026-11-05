'use strict';
/* Editor de código DBML: <textarea> transparente sobre uma camada com realce de sintaxe. */
const LINE_H = 20, PAD_T = 10;
const KW = new Set(['table', 'ref', 'enum', 'tablegroup', 'project', 'note', 'indexes', 'tablepartial', 'checks']);
const ATTR = new Set(['pk', 'primary', 'key', 'not', 'null', 'unique', 'increment', 'default', 'ref', 'note', 'headercolor',
  'delete', 'update', 'name', 'type', 'color', 'cascade', 'restrict', 'no', 'action', 'set']);
const TYPES = new Set(['int', 'integer', 'bigint', 'smallint', 'tinyint', 'serial', 'bigserial', 'varchar', 'char', 'text', 'string',
  'boolean', 'bool', 'decimal', 'numeric', 'float', 'double', 'real', 'money', 'date', 'datetime', 'timestamp', 'timestamptz',
  'time', 'uuid', 'json', 'jsonb', 'blob', 'binary', 'bytea', 'bit', 'xml', 'enum', 'longtext', 'mediumtext']);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function highlight(text) {
  const re = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'''[\s\S]*?(?:'''|$)|'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|`[^`\n]*`?|[A-Za-z_À-￿][\w$À-￿]*|\d+(?:\.\d+)?|<>|[<>\-]|[\[\]{}()]|\n|\s+|[^\s]/g;
  let out = '', depth = 0, word = 0, m;
  const span = (c, s) => `<span class="${c}">${esc(s)}</span>`;
  while ((m = re.exec(text))) {
    const s = m[0], c = s[0];
    if (s === '\n') { out += '\n'; word = 0; continue; }
    if (/^\s/.test(c)) { out += s; continue; }
    if (c === '/' && (s[1] === '/' || s[1] === '*')) { out += span('tc', s); continue; }
    if (c === "'" || c === '`') { out += span('ts', s); continue; }
    if (c === '"') { out += span('tq', s); continue; }
    if (/[A-Za-z_À-￿]/.test(c)) {
      const l = s.toLowerCase();
      if (depth > 0 && ATTR.has(l)) out += span('ta', s);
      else if (depth === 0 && word === 0 && KW.has(l)) out += span('tk', s);
      else if (depth === 0 && word >= 1 && l === 'as') out += span('tk', s);
      else if (depth === 0 && word === 1 && TYPES.has(l)) out += span('tt', s);
      else out += esc(s);
      if (depth === 0) word++;
      continue;
    }
    if (/\d/.test(c)) { out += span('tn', s); continue; }
    if (s === '<>' || s === '<' || s === '>' || s === '-') { out += span('to', s); continue; }
    if (c === '[') { depth++; out += span('tp', s); continue; }
    if (c === ']') { depth = Math.max(0, depth - 1); out += span('tp', s); continue; }
    if (c === '{' || c === '}' || c === '(' || c === ')') { out += span('tp', s); continue; }
    out += esc(s);
  }
  return out;
}

class CodeEditor {
  constructor(cb) {
    this.cb = cb; // { onInput, onCaretLine, onSave }
    this.ta = $('#ta'); this.hl = $('#hl'); this.layer = $('#layer'); this.gut = $('#gutIn');
    this.band = $('#band'); this.errBar = $('#edErr');
    this.errLine = 0; this.nLines = -1; this.lastCaret = -1;
    this.ta.addEventListener('input', () => { this.refresh(); cb.onInput(); this.caretCheck(); });
    this.ta.addEventListener('scroll', () => this.syncScroll());
    this.ta.addEventListener('keydown', ev => this.onKey(ev));
    document.addEventListener('selectionchange', () => { if (document.activeElement === this.ta) this.caretCheck(); });
    this.errBar.addEventListener('click', () => { if (this.errLine) this.reveal(this.errLine, this.errLine, true); });
  }
  get value() { return this.ta.value; }
  setValue(t) { this.ta.value = t; this.refresh(); this.syncScroll(); }
  focus() { this.ta.focus(); }

  refresh() {
    const t = this.ta.value;
    this.hl.innerHTML = highlight(t) + '\n';
    const n = t.split('\n').length;
    if (n !== this.nLines || this._gErr !== this.errLine) { this.nLines = n; this._gErr = this.errLine; this.buildGutter(); }
  }
  buildGutter() {
    let s = '';
    for (let i = 1; i <= this.nLines; i++) s += (i === this.errLine ? `<span class="gerr">${i}</span>` : i) + '\n';
    this.gut.innerHTML = s;
  }
  syncScroll() {
    const t = this.ta;
    this.layer.style.transform = `translate(${-t.scrollLeft}px,${-t.scrollTop}px)`;
    this.gut.style.transform = `translateY(${-t.scrollTop}px)`;
  }
  caretLine() { const t = this.ta.value, p = this.ta.selectionStart; let n = 1; for (let i = t.indexOf('\n'); i >= 0 && i < p; i = t.indexOf('\n', i + 1)) n++; return n; }
  caretCheck() { const l = this.caretLine(); if (l !== this.lastCaret) { this.lastCaret = l; this.cb.onCaretLine(l); } }
  offsetOfLine(l) { const t = this.ta.value; let idx = 0; for (let i = 1; i < l; i++) { const j = t.indexOf('\n', idx); if (j < 0) return t.length; idx = j + 1; } return idx; }

  setBand(l1, l2) {
    if (!l1) { this.band.style.display = 'none'; return; }
    this.band.style.display = 'block';
    this.band.style.top = (PAD_T + (l1 - 1) * LINE_H) + 'px';
    this.band.style.height = ((l2 - l1 + 1) * LINE_H) + 'px';
  }
  flash() { this.band.classList.remove('flash'); void this.band.offsetWidth; this.band.classList.add('flash'); }
  reveal(l1, l2, smooth) {
    const top = Math.max(0, (l1 - 3) * LINE_H);
    this.ta.scrollTo({ top, left: 0, behavior: smooth === false ? 'auto' : 'smooth' });
    const off = this.offsetOfLine(l1); this.ta.setSelectionRange(off, off); this.lastCaret = l1;
    this.setBand(l1, l2); this.flash();
  }
  setError(line, msg) {
    this.errLine = line || 0;
    this.errBar.style.display = msg ? 'block' : 'none';
    this.errBar.textContent = msg ? `Linha ${line}: ${msg}` : '';
    if (this._gErr !== this.errLine) { this._gErr = this.errLine; this.buildGutter(); }
  }

  /* ---- edição: usa execCommand para manter o desfazer (Ctrl+Z) nativo ---- */
  insert(text) { if (!document.execCommand('insertText', false, text)) { const ta = this.ta, s = ta.selectionStart; ta.setRangeText(text, s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } }
  lineRange() {
    const t = this.ta.value, a = this.ta.selectionStart; let b = this.ta.selectionEnd;
    if (b > a && t[b - 1] === '\n') b--;
    const s = t.lastIndexOf('\n', a - 1) + 1; let e = t.indexOf('\n', b); if (e < 0) e = t.length;
    return [s, e];
  }
  replaceLines(fn) {
    const [s, e] = this.lineRange(), ta = this.ta, old = ta.value.slice(s, e), nw = fn(old);
    ta.setSelectionRange(s, e); this.insert(nw); ta.setSelectionRange(s, s + nw.length);
  }
  onKey(ev) {
    const ta = this.ta;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); this.cb.onSave(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === '/') {
      ev.preventDefault();
      this.replaceLines(b => { const ls = b.split('\n'), all = ls.every(l => !l.trim() || /^\s*\/\//.test(l));
        return ls.map(l => !l.trim() ? l : all ? l.replace(/^(\s*)\/\/ ?/, '$1') : l.replace(/^(\s*)/, '$1// ')).join('\n'); });
      return;
    }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const multi = ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n');
      if (ev.shiftKey) this.replaceLines(b => b.split('\n').map(l => l.replace(/^( {1,2}|\t)/, '')).join('\n'));
      else if (multi) this.replaceLines(b => b.split('\n').map(l => '  ' + l).join('\n'));
      else this.insert('  ');
      return;
    }
    if (ev.key === 'Enter' && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
      const t = ta.value, p = ta.selectionStart, ls = t.lastIndexOf('\n', p - 1) + 1;
      const indent = (t.slice(ls, p).match(/^[ \t]*/) || [''])[0];
      const before = t.slice(0, p).trimEnd().slice(-1), after = t.slice(ta.selectionEnd).match(/^[ \t]*(.)/);
      ev.preventDefault();
      if (before === '{' && after && after[1] === '}') {
        this.insert('\n' + indent + '  \n' + indent);
        const q = ta.selectionStart - indent.length - 1; ta.setSelectionRange(q, q);
      } else this.insert('\n' + indent + (before === '{' ? '  ' : ''));
      return;
    }
    if (ev.key === '}' && !ev.ctrlKey && !ev.altKey) {
      const t = ta.value, p = ta.selectionStart, ls = t.lastIndexOf('\n', p - 1) + 1, seg = t.slice(ls, p);
      if (ta.selectionStart === ta.selectionEnd && /^ {2,}$/.test(seg)) ta.setSelectionRange(p - 2, p);
    }
  }
}
