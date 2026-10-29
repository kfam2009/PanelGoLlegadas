// PanelGo Llegadas - motor: guarda los corredores, detecta las llegadas y arma las tablas.
// Las fuentes (RaceResult, link generico) le pasan corredores normalizados con actualizar().
import fs from 'node:fs/promises';
import path from 'node:path';

const seg = t => { const p = String(t || '').replace(',', '.').split(':').map(Number); if (p.some(isNaN) || !p.length) return Infinity; return p.reduce((a, b) => a * 60 + b, 0); };
export const ordenarDist = (a, b) => (parseFloat(a) || 1e9) - (parseFloat(b) || 1e9) || a.localeCompare(b);

export class Motor {
  constructor({ dataDir }) {
    this.file = path.join(dataDir, 'corredores.json');
    this.corredores = new Map(); this.orden = []; this.feed = [];
    this.seq = Date.now(); this.evento = '';
    this.ready = this.cargar();
  }
  async cargar() {
    try {
      const d = JSON.parse(await fs.readFile(this.file, 'utf8'));
      for (const c of d.corredores || []) this.corredores.set(c.id, c);
      this.orden = (d.orden || []).filter(id => this.corredores.has(id)); this.evento = d.evento || '';
    } catch {}
  }
  guardar() {
    clearTimeout(this.t);
    this.t = setTimeout(() => {
      const data = JSON.stringify({ corredores: [...this.corredores.values()], orden: this.orden, evento: this.evento });
      fs.writeFile(this.file + '.tmp', data).then(() => fs.rename(this.file + '.tmp', this.file)).catch(() => {});
    }, 300);
    this.t.unref?.();
  }
  // en vivo: si recien ahora tiene tiempo, es una llegada (va a la pantalla)
  actualizar(c, enVivo = true) {
    if (!c || !c.id || !c.nombre) return null;
    const prev = this.corredores.get(c.id);
    const llego = c.finished && (!prev || !prev.finished);
    const n = { ...prev, ...c, t: llego ? Date.now() : prev?.t || (c.finished ? Date.now() : 0) };
    this.corredores.set(c.id, n);
    if (llego && enVivo) {
      this.orden = [...this.orden.filter(x => x !== c.id), c.id];
      this.feed = [...this.feed, { seq: ++this.seq, id: c.id }].slice(-40);
    }
    this.guardar();
    return llego ? n : null;
  }
  // repite una llegada (para probar el grafico)
  repetir(id) {
    const c = this.corredores.get(id); if (!c) throw Error('No está ese corredor');
    this.orden = [...this.orden.filter(x => x !== id), id];
    this.feed = [...this.feed, { seq: ++this.seq, id }].slice(-40);
    return c;
  }
  borrar() { this.corredores.clear(); this.orden = []; this.feed = []; this.evento = ''; this.seq++; this.guardar(); }

  distancias() { return [...new Set([...this.corredores.values()].map(c => c.dist))].sort(ordenarDist); }
  categorias(dist) { return [...new Set([...this.corredores.values()].filter(c => c.finished && (!dist || c.dist === dist) && c.cat).map(c => c.cat))].sort(); }
  // posiciones: las del cronometraje; si no vienen, por tiempo
  tabla({ dist = '', cat = '', sexo = '' } = {}) {
    const l = [...this.corredores.values()].filter(c => c.finished && (!dist || c.dist === dist) && (!cat || c.cat === cat) && (!sexo || c.sexo === sexo));
    l.sort((a, b) => (cat ? (a.catPos ?? 1e9) - (b.catPos ?? 1e9) : 0) || (a.pos ?? 1e9) - (b.pos ?? 1e9) || seg(a.tiempo) - seg(b.tiempo));
    return l.map((c, i) => ({ ...c, puesto: cat ? (c.catPos ?? i + 1) : (c.pos ?? i + 1) }));
  }
  recientes(n = 10) { return this.orden.slice(-n).reverse().map(id => this.corredores.get(id)).filter(Boolean); }
  resumen() {
    const all = [...this.corredores.values()];
    return { evento: this.evento, total: all.length, llegaron: all.filter(c => c.finished).length, distancias: this.distancias().map(d => ({ dist: d, n: this.tabla({ dist: d }).length })), recientes: this.recientes(20).map(c => this.conPuesto(c)) };
  }
  // puesto para mostrar: el del cronometraje o, si no viene, por tiempo dentro de su distancia
  conPuesto(c) {
    if (!c) return c;
    if (c.pos) return { ...c, puesto: c.pos };
    const i = this.tabla({ dist: c.dist }).findIndex(x => x.id === c.id);
    return { ...c, puesto: i >= 0 ? i + 1 : null };
  }
  feedPantalla() { return this.feed.map(f => ({ seq: f.seq, c: this.conPuesto(this.corredores.get(f.id)) })).filter(f => f.c); }
}
