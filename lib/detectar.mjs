// PanelGo Llegadas - lee resultados de cualquier cronometraje: JSON, CSV/TSV, planillas de Google, tablas HTML.
// Detecta solo que es cada columna (por el titulo y, si no alcanza, por el contenido).

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü' };
export const limpiar = s => String(s ?? '').replace(/<[^>]*>/g, ' ')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m)
  .replace(/\s+/g, ' ').trim();

// ---- Texto -> { headers, rows } ----
export function leerTabla(texto) {
  const t = String(texto ?? '').replace(/^﻿/, '').trim();
  if (!t) return { headers: [], rows: [], formato: 'vacío' };
  if (/^[[{]/.test(t)) { try { return deJson(JSON.parse(t)); } catch {} }
  if (/<table/i.test(t)) return deHtml(t);
  return deCsv(t);
}

function deJson(d) {
  // el arreglo mas grande de objetos o de filas, este donde este
  let best = null;
  const visit = (v, depth) => {
    if (depth > 6 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      const objs = v.filter(x => x && typeof x === 'object' && !Array.isArray(x)).length, arrs = v.filter(Array.isArray).length;
      if (Math.max(objs, arrs) >= 1 && (!best || v.length > best.length)) best = v;
      v.slice(0, 50).forEach(x => visit(x, depth + 1));
    } else Object.values(v).forEach(x => visit(x, depth + 1));
  };
  visit(d, 0);
  if (!best) return { headers: [], rows: [], formato: 'JSON' };
  if (best.some(Array.isArray)) {
    const rows = best.filter(Array.isArray).map(r => r.map(c => limpiar(typeof c === 'object' ? JSON.stringify(c) : c)));
    const head = rows[0].every(c => c && !/^\d+([.:,]\d+)*$/.test(c)) && rows.length > 1 ? rows.shift() : rows[0].map((_, i) => 'Columna ' + (i + 1));
    return { headers: head, rows, formato: 'JSON' };
  }
  const objs = best.filter(x => x && typeof x === 'object' && !Array.isArray(x));
  const keys = [...new Set(objs.flatMap(o => Object.keys(o).filter(k => o[k] == null || typeof o[k] !== 'object')))];
  return { headers: keys, rows: objs.map(o => keys.map(k => limpiar(o[k]))), formato: 'JSON' };
}

function deHtml(t) {
  let best = null;
  for (const m of t.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const trs = [...m[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(r => ({ th: /<th/i.test(r[0]), cells: [...r[0].matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi)].map(c => limpiar(c[2])) }))
      .filter(r => r.cells.length);
    if (!best || trs.length > best.length) best = trs;
  }
  if (!best || !best.length) return { headers: [], rows: [], formato: 'HTML' };
  const hi = best.findIndex(r => r.th);
  const headRow = hi >= 0 && hi < 3 ? best[hi] : best[0];
  const rows = best.slice(best.indexOf(headRow) + 1).map(r => r.cells).filter(c => c.some(Boolean));
  return { headers: headRow.cells, rows, formato: 'HTML' };
}

function deCsv(t) {
  const first = t.split(/\r?\n/, 1)[0];
  const sep = [',', ';', '\t', '|'].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  const clean = rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean));
  return { headers: clean.shift() || [], rows: clean, formato: sep === '\t' ? 'TSV' : 'CSV' };
}

// ---- Columnas: que es cada una ----
export const CAMPOS = {
  pos: 'Puesto', bib: 'Dorsal', nombre: 'Nombre', apellido: 'Apellido', tiempo: 'Tiempo', neto: 'Tiempo neto',
  dist: 'Distancia / carrera', cat: 'Categoría', catPos: 'Puesto en categoría', sexo: 'Sexo', sexoPos: 'Puesto por sexo', club: 'Club / equipo', ritmo: 'Ritmo',
};
const REGLAS = [
  ['catPos', /(pos|puesto|lugar|rank|rango|clas)\w*\.?\s*(en\s*)?cat|cat\w*\.?\s*(pos|puesto|lugar|rank)/],
  ['sexoPos', /(pos|puesto|lugar|rank)\w*\.?\s*(sexo|g[eé]n|gender|rama)|(sexo|g[eé]nero|gender)\s*(pos|puesto|rank)/],
  ['pos', /^(#|n°|nº|pos\b|pos\.|posici[oó]n|puesto|lugar|rank|rango|place|pl\.?$|clasif|gral|general|overall)/],
  ['bib', /dorsal|^bib|n[uú]mero|^nro|^num\b|^n°$|^no\.?$/],
  ['ritmo', /ritmo|pace|min\/km|velocidad|speed/],
  ['neto', /neto|chip|net\b|net time|real/],
  ['tiempo', /tiempo|time|oficial|gun|bruto|total|marca|final|llegada/],
  ['nombre', /apellido.*nombre|nombre.*apellido|full ?name|nombre completo/],
  ['apellido', /apellido|surname|last ?name/],
  ['nombre', /nombre|name|atleta|corredor|participante|competidor|runner|athlete|ciclista|nadador/],
  ['cat', /categ|^cat\b|^cat\.|grupo|edad|age ?group|division/],
  ['sexo', /^sexo|g[eé]nero|^sex|gender|^rama|^s$/],
  ['club', /club|equipo|team|agrupaci|escuela|ciudad|localidad|city/],
  ['dist', /dist|carrera|prueba|circuito|modalidad|competencia|race|contest|recorrido|evento/],
];
const TIEMPO = /^\d{1,3}:\d{2}(:\d{2})?([.,]\d+)?$|^\d+h\s?\d+/i;
const ENTERO = /^\d{1,5}$/;
const fueraDeCarrera = v => /^(dnf|dns|dsq|dq|abandon|desc|no larg|no lleg|-+)$/i.test(String(v || '').trim());

export function detectarColumnas(headers, rows) {
  const H = headers.map(h => limpiar(h).toLowerCase());
  const map = {}; const usado = new Set();
  for (const [campo, re] of REGLAS) {
    const i = H.findIndex((h, k) => !usado.has(k) && re.test(h));
    if (i >= 0 && !(campo in map)) { map[campo] = i; usado.add(i); }
  }
  // por contenido, para lo que falte
  const muestra = rows.slice(0, 40), n = headers.length || (muestra[0] || []).length;
  const col = k => muestra.map(r => String(r[k] ?? '').trim()).filter(Boolean);
  const proporcion = (k, re) => { const v = col(k); return v.length ? v.filter(x => re.test(x)).length / v.length : 0; };
  const libres = () => Array.from({ length: n }, (_, k) => k).filter(k => !usado.has(k));
  const tomar = (campo, k) => { if (k != null && k >= 0) { map[campo] = k; usado.add(k); } };
  if (map.tiempo == null && map.neto == null) tomar('tiempo', libres().find(k => proporcion(k, TIEMPO) > 0.6));
  if (map.nombre == null) {
    const k = libres().map(k => [k, col(k).filter(x => /\p{L}{2,}.*\s+.*\p{L}{2,}/u.test(x)).length]).sort((a, b) => b[1] - a[1])[0];
    if (k && k[1] > 0) tomar('nombre', k[0]);
  }
  if (map.pos == null) {
    const k = libres().find(k => { const v = col(k).map(Number); return v.length > 2 && v.every(Number.isInteger) && v.filter((x, i) => i === 0 || x >= v[i - 1]).length / v.length > 0.9 && v[0] <= 3; });
    tomar('pos', k);
  }
  if (map.bib == null) tomar('bib', libres().find(k => proporcion(k, ENTERO) > 0.9));
  return map;
}

// "PEREZ, juan martin" -> "Juan Martin Perez"
export function nombrePropio(s) {
  let n = limpiar(s).replace(/^,\s*/, '').replace(/\s*,\s*$/, '');
  const m = /^([^,]+),\s*(.+)$/.exec(n); if (m) n = `${m[2]} ${m[1]}`;
  return n.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\s+/g, ' ');
}
const entero = v => { const m = /\d+/.exec(String(v ?? '')); const x = m ? parseInt(m[0], 10) : NaN; return Number.isFinite(x) && x > 0 ? x : null; };

// "00:41:30" -> "41:30", "01:05:00" -> "1:05:00"
export function prolijoTiempo(t) {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?(.*)$/.exec(String(t).trim());
  if (!m) return String(t).trim();
  if (m[3] != null && Number(m[1]) === 0) return `${Number(m[2])}:${m[3]}${m[4]}`;
  return `${Number(m[1])}:${m[2]}${m[3] != null ? ':' + m[3] : ''}${m[4]}`;
}
// Fila -> corredor normalizado
export function aCorredor(row, map) {
  const g = k => (map[k] != null && map[k] >= 0 ? limpiar(row[map[k]]) : '');
  const nombre = nombrePropio([g('nombre'), g('apellido')].filter(Boolean).join(' '));
  const crudo = g('neto') || g('tiempo');
  const tiempo = fueraDeCarrera(crudo) ? '' : prolijoTiempo(crudo);
  const bib = g('bib').replace(/^#/, '');
  return {
    id: bib || nombre.toLowerCase(), bib, nombre,
    pos: fueraDeCarrera(g('pos')) ? null : entero(g('pos')), tiempo, oficial: g('tiempo'),
    dist: g('dist') || 'General', cat: g('cat'), catPos: entero(g('catPos')), sexo: g('sexo'), sexoPos: entero(g('sexoPos')),
    club: g('club'), ritmo: g('ritmo'), finished: Boolean(tiempo) && TIEMPO.test(tiempo.replace(/\s/g, '')),
  };
}

// Links comunes -> la direccion que devuelve los datos
export function direccionDatos(link) {
  const u = new URL(String(link).trim());
  // Google Sheets: .../d/ID/edit#gid=N  ->  export csv
  const g = /docs\.google\.com\/spreadsheets\/d\/(e\/)?([\w-]+)/.exec(u.href);
  if (g) {
    const gid = /gid=(\d+)/.exec(u.href)?.[1];
    if (g[1]) return `https://docs.google.com/spreadsheets/d/e/${g[2]}/pub?output=csv${gid ? '&gid=' + gid : ''}`;
    return `https://docs.google.com/spreadsheets/d/${g[2]}/export?format=csv${gid ? '&gid=' + gid : ''}`;
  }
  return u.href;
}
