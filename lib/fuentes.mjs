// PanelGo Llegadas - de donde vienen los datos:
//  - RaceResult (link del presenter): en vivo por websocket + revision de los que faltan
//  - Cualquier otro link (pagina con tabla, JSON, CSV, planilla de Google): se consulta cada pocos segundos
//    y se detecta solo que es cada columna; el operador puede corregir la deteccion.
import { WsClient } from './wsclient.mjs';
import { leerTabla, detectarColumnas, aCorredor, direccionDatos, nombrePropio, limpiar, prolijoTiempo } from './detectar.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------- RaceResult ----------
export function linkRaceResult(link) {
  let u; try { u = new URL(String(link || '').trim().replace(/^\+/, '')); } catch { return null; }
  const event = u.searchParams.get('event'), name = u.searchParams.get('n'), key = u.searchParams.get('k');
  if (!/raceresult|\/presenters?\//i.test(u.href) || !event || !name || !key) return null;
  return { event, name, key, host: u.origin };
}
const rrQuery = p => `eventid=${encodeURIComponent(p.event)}&name=${encodeURIComponent(p.name)}&key=${encodeURIComponent(p.key)}&lang=&screen=0&index=0`;

// RaceResult nuevo: la ventana trae DataFields (expresiones) y Data (los ultimos registros), sin el id adelante.
// Se reconoce cada columna por la expresion (BIB, CONTEST.NAME, AGEGROUP.NAME, Final.GUN...), no por el titulo.
export function columnasRR(exprs) {
  const E = exprs.map(e => String(e || '').toLowerCase()), map = {}, usado = new Set();
  const tomar = (campo, re, no) => { const i = E.findIndex((e, k) => !usado.has(k) && re.test(e) && !(no && no.test(e))); if (i >= 0 && !(campo in map)) { map[campo] = i; usado.add(i); } };
  tomar('id', /^\[?id\]?$|^pid$/);
  tomar('bib', /^\[?bib\]?$|startnumber|dorsal/);
  for (let k = 0; k < E.length; k++) if (!usado.has(k) && /^\[?bib\]?$/.test(E[k])) usado.add(k); // repetidos
  tomar('dist', /contest/);
  tomar('cat', /agegroup|categ/);
  tomar('nombre', /displayname|mostrarnombre|nombre|fullname|lastname|firstname|^\[?name\]?$/, /\./);
  tomar('sexo', /gender|^\[?sex|genero/);
  tomar('club', /club|team|equipo|city|ciudad/);
  tomar('pos', /rank|rango|place|^\[?pos/, /\./);
  tomar('neto', /\.net|neto|chip/);
  tomar('tiempo', /time|gun|tiempo|final|finish|llegada/);
  return map;
}
// "MTB (54°)" -> ["MTB", 54]
const conPuesto = v => { const m = /^(.*?)\s*\((\d+)\s*[°º]?\)\s*$/.exec(limpiar(v)); return m ? [m[1], Number(m[2])] : [limpiar(v), null]; };

class RaceResult {
  constructor(p, motor) { this.p = p; this.motor = motor; this.tipo = 'RaceResult (presenter)'; this.gen = 0; this.map = null; this.estado = { conectado: false, error: '', ultimo: 0 }; this.columnas = []; this.modo = 'viejo'; }
  async get(route, extra = '') {
    const r = await fetch(`${this.p.host}/api/presenter/${route}?${rrQuery(this.p)}${extra}`, { signal: AbortSignal.timeout(10000) });
    const t = await r.text();
    if (!r.ok) throw Error(`RaceResult ${r.status}: ${t.slice(0, 120)}`);
    try { return JSON.parse(t); } catch { return t; }
  }
  async probar() { await this.get('config'); }
  async campos() {
    const w = await this.get('window');
    if (Array.isArray(w?.DataFields) && w.DataFields.length) {
      this.modo = 'datos'; this.exprs = w.DataFields;
      const lab = new Map((w.List?.Fields || []).map(f => [f.Expression, f.Label]));
      this.columnas = w.DataFields.map(e => lab.get(e) || e);
      this.map = columnasRR(w.DataFields);
      const h = w.List?.HeadLine1 || w.HeadLine1; if (h) this.motor.evento = limpiar(h);
      return Array.isArray(w.Data) ? w.Data : [];
    }
    this.modo = 'viejo';
    const labels = Array.isArray(w?.Fields) && w.Fields.length ? w.Fields.map(f => f.Label) : ['Rango', 'Dorsal', 'Nombre', 'Neto', 'Cat.Pos', 'Dist.', 'Tiempo'];
    this.columnas = labels; this.map = detectarColumnas(labels, []);
    if (w?.HeadLine1) this.motor.evento = limpiar(w.HeadLine1);
    return [];
  }
  corredor(rec) {
    if (this.modo === 'datos') {
      const r = rec.length === this.exprs.length + 1 ? rec.slice(1) : rec, M = this.map;
      const g = k => (M[k] != null ? limpiar(r[M[k]]) : '');
      const [dist, dPos] = conPuesto(g('dist')), [cat, cPos] = conPuesto(g('cat'));
      const expDist = M.dist != null ? String(this.exprs[M.dist]).toLowerCase() : '';
      const posSexo = /mf|sex|gen/.test(expDist);
      const crudo = g('neto') || g('tiempo'), tiempo = /^(dnf|dns|dsq|dq)$/i.test(crudo) ? '' : prolijoTiempo(crudo);
      const id = g('id') || g('bib');
      return {
        id: 'rr' + id, bib: g('bib'), nombre: nombrePropio(g('nombre')),
        pos: Number(g('pos')) || (posSexo ? null : dPos), sexoPos: posSexo ? dPos : null,
        dist: dist || 'General', cat, catPos: cPos, sexo: g('sexo'), club: g('club'), tiempo, oficial: g('tiempo'),
        finished: /^\d+:\d{2}/.test(tiempo),
      };
    }
    const c = aCorredor(rec.slice(1), this.map);
    return { ...c, id: 'rr' + rec[0], nombre: nombrePropio(c.nombre) };
  }
  // registros de la ventana (los mas nuevos primero): se cargan del mas viejo al mas nuevo
  cargarDatos(data, enVivo) {
    const lista = [...data].reverse().map(r => Array.isArray(r) ? this.corredor(r) : null).filter(c => c && c.nombre);
    for (const c of lista) this.motor.actualizar(c, enVivo);
    if (!enVivo) this.motor.historial(lista.filter(c => c.finished).map(c => c.id));
    return lista.length;
  }
  conectar() {
    this.desconectar(); const gen = this.gen;
    const abrir = async () => {
      if (gen !== this.gen) return;
      try { const data = await this.campos(); if (gen === this.gen) this.cargarDatos(data, false); } catch (e) { this.estado.error = e.message; }
      if (gen !== this.gen) return;
      let ws;
      try { ws = new WsClient(`${this.p.host.replace(/^http/, 'ws')}/api/presenter/websocket?${rrQuery(this.p)}`, { origin: this.p.host }); }
      catch (e) { this.estado.error = e.message; return setTimeout(abrir, 3000); }
      this.ws = ws;
      ws.on('open', () => { if (gen === this.gen) this.estado = { ...this.estado, conectado: true, error: '' }; });
      ws.on('message', m => {
        if (gen !== this.gen) return; this.estado.ultimo = Date.now();
        let d; try { d = JSON.parse(m); } catch { return; }
        if (d && !Array.isArray(d) && Array.isArray(d.Data)) d = d.Data;
        for (const r of Array.isArray(d?.[0]) ? d : [d]) if (Array.isArray(r)) this.motor.actualizar(this.corredor(r), true);
      });
      ws.on('close', () => { if (gen !== this.gen) return; this.estado.conectado = false; setTimeout(abrir, 2000); });
      ws.on('error', e => { if (gen === this.gen) this.estado.error = `Sin conexión con RaceResult (${e.message}), reintentando...`; });
    };
    abrir();
    this.guard = setInterval(() => { if (gen === this.gen) this.revisar().catch(() => {}); }, 20000); this.guard.unref?.();
  }
  desconectar() { this.gen++; clearInterval(this.guard); try { this.ws?.close(); } catch {} this.ws = null; this.estado = { conectado: false, error: '', ultimo: 0 }; }
  async porDorsal(bib) { const l = await this.get('chipcheck', `&value=${encodeURIComponent(bib)}`).catch(() => []); return Array.isArray(l) ? l.filter(x => Array.isArray(x) && x.length > 2) : []; }
  // respaldo cada 20 s por si se corto la conexion en vivo
  async revisar() {
    if (this.ocupado) return; this.ocupado = true;
    try {
      if (this.modo === 'datos') { const w = await this.get('window'); if (Array.isArray(w?.Data)) this.cargarDatos(w.Data, true); return; }
      const pend = [...this.motor.corredores.values()].filter(c => !c.finished && c.bib).map(c => c.bib);
      for (let i = 0; i < pend.length; i += 8) for (const l of await Promise.all(pend.slice(i, i + 8).map(b => this.porDorsal(b)))) for (const x of l) this.motor.actualizar(this.corredor(x), true);
    } finally { this.ocupado = false; }
  }
  async simular(bib) {
    if (!this.map) await this.campos();
    const l = bib ? await this.porDorsal(bib) : [];
    if (l.length) return l.map(x => { const c = this.corredor(x); this.motor.actualizar(c, false); return this.motor.repetir(c.id); });
    // sin chipcheck: uno que ya este cargado (por dorsal o al azar)
    const ya = [...this.motor.corredores.values()].filter(c => c.finished && (!bib || c.bib === String(bib)));
    if (!ya.length) throw Error(bib ? `Dorsal ${bib}: no está en esta carrera (o todavía no llegó)` : 'Todavía no hay corredores con tiempo');
    return [this.motor.repetir((bib ? ya[0] : ya[Math.floor(Math.random() * ya.length)]).id)];
  }
  async cargarTodos(max = 1000, avance = () => {}) {
    const data = await this.campos();
    if (this.modo === 'datos') { const n = this.cargarDatos(data, false); avance({ hechos: n, total: n, encontrados: n }); return; }
    let n = 0;
    for (let i = 1; i <= max; i += 10) {
      const res = await Promise.all(Array.from({ length: Math.min(10, max - i + 1) }, (_, k) => this.porDorsal(i + k)));
      for (const l of res) for (const x of l) { this.motor.actualizar(this.corredor(x), false); n++; }
      avance({ hechos: Math.min(max, i + 9), total: max, encontrados: n }); await sleep(60);
    }
  }
  info() { return { tipo: this.tipo, columnas: this.columnas.map((h, i) => ({ titulo: h, campo: Object.keys(this.map || {}).find(k => k !== 'id' && this.map[k] === i) || '' })) }; }
}

// ---------- Link generico ----------
class LinkGenerico {
  constructor(link, motor, { intervalo = 5, columnas = null } = {}) {
    this.link = link; this.url = direccionDatos(link); this.motor = motor; this.intervalo = intervalo; this.manual = columnas;
    this.tipo = 'Link'; this.estado = { conectado: false, error: '', ultimo: 0 }; this.tabla = { headers: [], rows: [] }; this.map = {}; this.gen = 0;
  }
  async leer() {
    const r = await fetch(this.url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/csv,text/html,*/*' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
    if (!r.ok) throw Error(`El link respondió ${r.status}`);
    const t = await r.text();
    const tabla = leerTabla(t);
    if (!tabla.rows.length) throw Error('El link no tiene una tabla de resultados que se pueda leer (' + tabla.formato + ')');
    this.tabla = tabla; this.tipo = 'Link (' + tabla.formato + ')';
    this.map = { ...detectarColumnas(tabla.headers, tabla.rows), ...(this.manual || {}) };
    for (const k of Object.keys(this.map)) if (this.map[k] == null || this.map[k] < 0) delete this.map[k];
    if (this.map.nombre == null) throw Error('No se encontró la columna del nombre: indicala a mano');
    return tabla.rows.map(r => aCorredor(r, this.map)).filter(c => c.nombre);
  }
  async probar() { await this.leer(); }
  conectar() {
    this.desconectar(); const gen = this.gen; let primera = this.motor.corredores.size === 0;
    const ciclo = async () => {
      if (gen !== this.gen) return;
      try {
        const lista = await this.leer();
        if (gen !== this.gen) return;
        // la primera lectura carga lo que ya habia (sin carteles); despues, cada tiempo nuevo es una llegada
        for (const c of lista) this.motor.actualizar(c, !primera);
        primera = false;
        this.estado = { conectado: true, error: '', ultimo: Date.now() };
      } catch (e) { this.estado = { ...this.estado, conectado: false, error: e.message }; }
      this.timer = setTimeout(ciclo, Math.max(2, this.intervalo) * 1000); this.timer.unref?.();
    };
    ciclo();
  }
  desconectar() { this.gen++; clearTimeout(this.timer); this.estado = { conectado: false, error: '', ultimo: 0 }; }
  async simular(bib) {
    const l = [...this.motor.corredores.values()].filter(c => c.finished && (!bib || c.bib === String(bib)));
    if (!l.length) throw Error(bib ? `Dorsal ${bib}: no tiene tiempo todavía` : 'Todavía no hay corredores con tiempo');
    return [this.motor.repetir((bib ? l[0] : l[Math.floor(Math.random() * l.length)]).id)];
  }
  async cargarTodos() { for (const c of await this.leer()) this.motor.actualizar(c, false); }
  info() {
    return {
      tipo: this.tipo, url: this.url,
      columnas: this.tabla.headers.map((h, i) => ({ titulo: h, campo: Object.keys(this.map).find(k => this.map[k] === i) || '', ejemplo: this.tabla.rows.slice(0, 3).map(r => r[i] || '').join(' · ') })),
    };
  }
}

export function crearFuente(link, motor, opciones) {
  const rr = linkRaceResult(link);
  if (rr) return new RaceResult(rr, motor);
  let u; try { u = new URL(String(link).trim()); } catch { throw Error('Link inválido'); }
  if (!/^https?:$/.test(u.protocol)) throw Error('El link tiene que empezar con http:// o https://');
  return new LinkGenerico(u.href, motor, opciones);
}
