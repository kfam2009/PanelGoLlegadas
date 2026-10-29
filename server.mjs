// PanelGo Llegadas - graficos de llegadas y posiciones para transmisiones de carreras.
// Panel:     http://<esta-pc>:5200/            (PC o celular, misma red)
// Graficos:  http://<esta-pc>:5200/graficos.html  (vMix / OBS, fondo transparente 1920x1080)
import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Motor } from './lib/motor.mjs';
import { crearFuente } from './lib/fuentes.mjs';
import { CAMPOS } from './lib/detectar.mjs';
import { VMix, OBS } from './lib/salidas.mjs';
import { leer } from './lib/recursos.mjs';

export const VERSION = '0.1.1';
const root = process.env.PC_ROOT || path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5200);
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const logosDir = path.join(dataDir, 'logos');
fss.mkdirSync(logosDir, { recursive: true });
const configFile = path.join(dataDir, 'config.json');

export const TEMA_BASE = { c1: '#ffd400', c2: '#0f131b', c3: '#1b2130', tx: '#ffffff', sub: '#aab3c2', ctx: '#000000', fuente: 'Segoe UI', redondeo: 10, escala: 1, margen: 70, mayusculas: true, logoLado: 'der' };
export const TEMAS = {
  'Amarillo noche': TEMA_BASE,
  'Rojo deportivo': { ...TEMA_BASE, c1: '#e3262b', c2: '#111111', c3: '#24262b', ctx: '#ffffff', fuente: 'Bahnschrift' },
  'Azul eléctrico': { ...TEMA_BASE, c1: '#18a0fb', c2: '#0b1630', c3: '#152448', ctx: '#ffffff' },
  'Verde trail': { ...TEMA_BASE, c1: '#7bd63b', c2: '#13190f', c3: '#212a1a', ctx: '#0b1206', fuente: 'Arial Black', redondeo: 2 },
  'Naranja': { ...TEMA_BASE, c1: '#ff7a00', c2: '#16110c', c3: '#2a2018', ctx: '#000000' },
  'Blanco limpio': { ...TEMA_BASE, c1: '#111111', c2: '#ffffff', c3: '#eceef2', tx: '#111111', sub: '#5b6270', ctx: '#ffffff', redondeo: 16 },
};
export const FUENTES = ['Segoe UI', 'Bahnschrift', 'Arial Black', 'Arial', 'Impact', 'Trebuchet MS', 'Verdana', 'Tahoma', 'Franklin Gothic Medium', 'Calibri', 'Century Gothic', 'Georgia'];
const DEFAULTS = {
  link: '', intervalo: 5, columnas: null,
  tema: TEMA_BASE, temasGuardados: {},
  textos: { llegada: 'LLEGADA', llegadas: 'LLEGADAS', tiempo: 'TIEMPO', posiciones: 'POSICIONES', esperando: 'Esperando llegadas...' },
  llegada: { segundos: 8, agrupar: true },
  aire: { llegadas: true, posiciones: false, podio: false, reloj: false, logo: false },
  posiciones: { dist: '', cat: '', sexo: '', lado: 'der', filas: 10, segundos: 8, titulo: '', logo: 'arriba' },
  podio: { dist: '', cat: '', sexo: '' },
  reloj: { inicio: 0, pausa: 0, lado: 'izq', titulo: 'TIEMPO' },
  logos: { productora: '', crono: '', sponsors: [] },
  vmix: { host: '127.0.0.1', puerto: 8088, overlay: 1, nombre: 'PanelGo Llegadas' },
  obs: { host: '127.0.0.1', puerto: 4455, clave: '', escena: '', nombre: 'PanelGo Llegadas' },
};
let config = structuredClone(DEFAULTS);
try { const c = JSON.parse(fss.readFileSync(configFile, 'utf8')); for (const k of Object.keys(c)) config[k] = c[k] && typeof c[k] === 'object' && !Array.isArray(c[k]) && DEFAULTS[k] ? { ...DEFAULTS[k], ...c[k] } : c[k]; } catch {}
let saving = Promise.resolve();
const save = () => (saving = saving.then(async () => {
  await fs.writeFile(configFile + '.tmp', JSON.stringify(config, null, 2));
  await fs.rename(configFile + '.tmp', configFile);
}).catch(() => {}));

const motor = new Motor({ dataDir });
let fuente = null, cargando = null;
function conectar() {
  fuente?.desconectar(); fuente = null;
  if (!config.link) return;
  try { fuente = crearFuente(config.link, motor, { intervalo: config.intervalo, columnas: config.columnas }); fuente.conectar(); }
  catch (e) { fuente = { estado: { conectado: false, error: e.message }, info: () => ({}), desconectar() {} }; }
}
motor.ready.then(conectar);
const vmix = new VMix(() => config.vmix), obs = new OBS(() => config.obs);

function lanIps() { return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address); }
// direccion de los graficos para vMix/OBS: si estan en otra PC, por la IP de la red
function urlGraficos(host, capa = '') {
  const local = !host || /^(127\.|localhost$)/.test(host);
  const ip = local ? '127.0.0.1' : (lanIps().find(i => i.split('.').slice(0, 3).join('.') === host.split('.').slice(0, 3).join('.')) || lanIps()[0] || '127.0.0.1');
  return `http://${ip}:${PORT}/graficos.html${capa ? '?capa=' + capa : ''}`;
}

function estado() {
  return {
    version: VERSION, urls: lanIps().map(i => `http://${i}:${PORT}/`), puerto: PORT,
    config: { ...config, obs: { ...config.obs, clave: config.obs.clave ? '••••' : '' } },
    temas: TEMAS, fuentes: FUENTES, campos: CAMPOS,
    datos: { ...(fuente?.estado || { conectado: false, error: '' }), ...(fuente?.info?.() || {}), cargando },
    ...motor.resumen(), categorias: motor.categorias(config.posiciones.dist), sexos: [...new Set([...motor.corredores.values()].map(c => c.sexo).filter(Boolean))].sort(),
    graficos: { local: urlGraficos(''), vmix: urlGraficos(config.vmix.host), obs: urlGraficos(config.obs.host) },
  };
}
const fila = c => ({ id: c.id, puesto: c.puesto, nombre: c.nombre, tiempo: c.tiempo, club: c.club, cat: c.cat, dist: c.dist, bib: c.bib });
function graficos() {
  const P = config.posiciones, D = motor.distancias();
  const sub = [P.cat, P.sexo].filter(Boolean).join(' · ');
  const grupos = (P.dist ? [P.dist] : D).map(d => ({
    titulo: P.titulo || `${config.textos.posiciones}${d && d !== 'General' ? ' ' + d : ''}`, subtitulo: sub,
    tabla: motor.tabla({ dist: d, cat: P.cat, sexo: P.sexo }).slice(0, 100).map(fila),
  }));
  const pd = config.podio.dist || D[0] || '';
  return {
    ahora: Date.now(), seq: motor.seq, feed: motor.feedPantalla().map(f => ({ seq: f.seq, c: f.c })),
    tema: config.tema, textos: config.textos, llegada: config.llegada, aire: config.aire, logos: config.logos, reloj: config.reloj,
    posiciones: { ...P, grupos },
    podio: { titulo: ['PODIO', pd !== 'General' && pd, config.podio.cat, config.podio.sexo].filter(Boolean).join(' · '), tabla: motor.tabla({ dist: pd, cat: config.podio.cat, sexo: config.podio.sexo }).slice(0, 3).map(fila) },
  };
}

// ---- Cambios (todo validado) ----
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const color = v => /^#[0-9a-f]{6}$/i.test(v) ? v : null;
const numero = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
async function setLink(d) {
  const link = str(d.link, 1000).replace(/^\+/, '');
  if ('intervalo' in d) config.intervalo = numero(d.intervalo, 2, 120, 5);
  if (link) { const f = crearFuente(link, motor, { intervalo: config.intervalo }); await f.probar().catch(e => { throw Error('No se pudo leer el link: ' + e.message); }); }
  if (link !== config.link) config.columnas = null;
  config.link = link; await save(); conectar();
}
async function setColumnas(d) {
  if (d.columnas === null) config.columnas = null;
  else { const m = {}; for (const [k, v] of Object.entries(d.columnas || {})) if (k in CAMPOS) m[k] = v === '' || v == null ? -1 : Number(v); config.columnas = m; }
  await save(); conectar();
}
async function setConfig(d) {
  if (d.tema) {
    const t = config.tema;
    for (const k of ['c1', 'c2', 'c3', 'tx', 'sub', 'ctx']) if (color(d.tema[k])) t[k] = d.tema[k];
    if (FUENTES.includes(d.tema.fuente)) t.fuente = d.tema.fuente;
    if ('redondeo' in d.tema) t.redondeo = numero(d.tema.redondeo, 0, 40, 10);
    if ('escala' in d.tema) t.escala = numero(d.tema.escala, 0.5, 1.6, 1);
    if ('margen' in d.tema) t.margen = numero(d.tema.margen, 0, 300, 70);
    if ('mayusculas' in d.tema) t.mayusculas = Boolean(d.tema.mayusculas);
    if (['der', 'izq'].includes(d.tema.logoLado)) t.logoLado = d.tema.logoLado;
  }
  if (d.temaBase && (TEMAS[d.temaBase] || config.temasGuardados[d.temaBase])) config.tema = { ...(TEMAS[d.temaBase] || config.temasGuardados[d.temaBase]) };
  if (d.guardarTema) { const n = str(d.guardarTema, 40); if (n) config.temasGuardados[n] = { ...config.tema }; }
  if (d.borrarTema) delete config.temasGuardados[d.borrarTema];
  if (d.textos) for (const k of Object.keys(DEFAULTS.textos)) if (k in d.textos) config.textos[k] = str(d.textos[k], 60) || DEFAULTS.textos[k];
  if (d.llegada) { if ('segundos' in d.llegada) config.llegada.segundos = numero(d.llegada.segundos, 3, 60, 8); if ('agrupar' in d.llegada) config.llegada.agrupar = Boolean(d.llegada.agrupar); }
  if (d.aire) for (const k of Object.keys(DEFAULTS.aire)) if (k in d.aire) config.aire[k] = Boolean(d.aire[k]);
  if (d.posiciones) {
    const P = config.posiciones, x = d.posiciones;
    for (const k of ['dist', 'cat', 'sexo', 'titulo']) if (k in x) P[k] = str(x[k], 60);
    if (['der', 'izq', 'cen'].includes(x.lado)) P.lado = x.lado;
    if (['arriba', 'titulo', 'no'].includes(x.logo)) P.logo = x.logo;
    if ('filas' in x) P.filas = numero(x.filas, 3, 15, 10);
    if ('segundos' in x) P.segundos = numero(x.segundos, 3, 60, 8);
  }
  if (d.podio) for (const k of ['dist', 'cat', 'sexo']) if (k in d.podio) config.podio[k] = str(d.podio[k], 60);
  if (d.reloj) {
    const R = config.reloj, x = d.reloj;
    if (x.accion === 'largar') { R.inicio = Date.now(); R.pausa = 0; }
    if (x.accion === 'cero') { R.inicio = 0; R.pausa = 0; }
    if (x.accion === 'hora' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(x.hora || '')) {
      // largada a una hora del dia (de hoy)
      const [h, m, s = 0] = x.hora.split(':').map(Number), t = new Date(); t.setHours(h, m, s, 0); R.inicio = t.getTime(); R.pausa = 0;
    }
    if (['izq', 'der'].includes(x.lado)) R.lado = x.lado;
    if ('titulo' in x) R.titulo = str(x.titulo, 30) || 'TIEMPO';
  }
  for (const s of ['vmix', 'obs']) if (d[s]) {
    const C = config[s], x = d[s];
    if ('host' in x) C.host = str(x.host, 100) || '127.0.0.1';
    if ('puerto' in x) C.puerto = numero(x.puerto, 1, 65535, s === 'vmix' ? 8088 : 4455);
    if ('nombre' in x) C.nombre = str(x.nombre, 60) || 'PanelGo Llegadas';
    if (s === 'vmix' && 'overlay' in x) C.overlay = numero(x.overlay, 0, 4, 1);
    if (s === 'obs' && 'escena' in x) C.escena = str(x.escena, 100);
    if (s === 'obs' && 'clave' in x && x.clave !== '••••') C.clave = str(x.clave, 200);
  }
  await save();
}
async function subirLogo({ tipo, data }) {
  const m = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,([a-z0-9+/=]+)$/i.exec(String(data || ''));
  if (!m) throw Error('La imagen tiene que ser PNG, JPG, WEBP, GIF o SVG');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw Error('La imagen es muy grande (máximo 8 MB)');
  const id = crypto.randomBytes(5).toString('hex'), ext = m[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg'), archivo = `media/${id}.${ext}`;
  await fs.writeFile(path.join(logosDir, `${id}.${ext}`), buf);
  if (tipo === 'sponsor') config.logos.sponsors.push(archivo);
  else if (tipo === 'productora' || tipo === 'crono') { borrarArchivo(config.logos[tipo]); config.logos[tipo] = archivo; }
  else throw Error('Tipo de logo desconocido');
  await save();
}
function borrarArchivo(a) { if (a && a.startsWith('media/')) fs.unlink(path.join(logosDir, path.basename(a))).catch(() => {}); }
async function quitarLogo({ tipo, archivo }) {
  if (tipo === 'sponsor') { config.logos.sponsors = config.logos.sponsors.filter(s => s !== archivo); borrarArchivo(archivo); }
  else if (tipo in config.logos) { borrarArchivo(config.logos[tipo]); config.logos[tipo] = ''; }
  await save();
}
let ultimoLog = [];
const ROUTES = {
  'POST /api/link': d => setLink(d),
  'POST /api/columnas': d => setColumnas(d),
  'POST /api/reconectar': () => conectar(),
  'POST /api/config': d => setConfig(d),
  'POST /api/logos/subir': d => subirLogo(d),
  'POST /api/logos/quitar': d => quitarLogo(d),
  'POST /api/simular': async d => { if (!fuente?.simular) throw Error('Primero cargá el link de los resultados'); await fuente.simular(str(d.bib, 20)); },
  'POST /api/repetir': d => { motor.repetir(str(d.id, 80)); },
  'POST /api/cargar': () => {
    if (!fuente?.cargarTodos) throw Error('Primero cargá el link de los resultados');
    if (cargando) return; cargando = { hechos: 0, total: 0, encontrados: 0 };
    fuente.cargarTodos(1000, a => { cargando = a; }).catch(e => { if (fuente) fuente.estado.error = e.message; }).finally(() => { cargando = null; });
  },
  'POST /api/borrar': () => motor.borrar(),
  'POST /api/vmix': async d => { ultimoLog = d.sacar ? (await vmix.sacar(config.vmix), ['Sacado del overlay']) : await vmix.cargar({ ...config.vmix, url: urlGraficos(config.vmix.host) }); },
  'POST /api/obs': async () => { ultimoLog = await obs.cargar({ ...config.obs, url: urlGraficos(config.obs.host) }); },
};

// ---- HTTP ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const json = (res, code, v) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(v)); };
const body = req => new Promise((ok, bad) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > 12e6) { bad(Error('Demasiado grande')); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); req.on('error', bad); });
function servir(res, data, rel) {
  if (!data) return json(res, 404, { error: 'No encontrado' });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
  res.end(data);
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/api/estado') return json(res, 200, estado());
    if (req.method === 'GET' && url.pathname === '/api/graficos') return json(res, 200, graficos());
    if (req.method === 'GET' && url.pathname === '/api/obs/escenas') { try { return json(res, 200, { escenas: await obs.escenas() }); } catch (e) { return json(res, 400, { error: e.message }); } }
    if (req.method === 'POST' && url.pathname === '/api/salir') {
      if (!/^(::ffff:)?127\.|^::1$/.test(req.socket.remoteAddress || '')) return json(res, 403, { error: 'Solo desde esta PC' });
      json(res, 200, { ok: true }); setTimeout(() => process.exit(0), 300); return;
    }
    const route = ROUTES[`${req.method} ${url.pathname}`];
    if (route) {
      const d = req.method === 'POST' ? JSON.parse((await body(req)) || '{}') : {};
      ultimoLog = [];
      try { await route(d); } catch (e) { return json(res, 400, { error: e.message }); }
      return json(res, 200, { ...estado(), log: ultimoLog });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Ruta desconocida' });
    if (url.pathname.startsWith('/media/')) {
      const f = path.resolve(logosDir, decodeURIComponent(url.pathname.slice(7)));
      if (!f.startsWith(logosDir + path.sep)) return json(res, 403, { error: 'Ruta no permitida' });
      return servir(res, await fs.readFile(f).catch(() => null), f);
    }
    const rel = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    return servir(res, leer(root, 'public/' + rel), rel);
  } catch (e) { json(res, 400, { error: e.message }); }
});

if (process.env.PC_START || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`PanelGo Llegadas ${VERSION}\nPanel: http://127.0.0.1:${PORT}/\n${lanIps().map(i => `Desde el celular: http://${i}:${PORT}/`).join('\n')}\nGráficos: http://127.0.0.1:${PORT}/graficos.html`);
  });
  process.on('SIGINT', () => process.exit(0)); process.on('SIGTERM', () => process.exit(0));
}
