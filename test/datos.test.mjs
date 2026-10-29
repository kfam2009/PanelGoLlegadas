import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leerTabla, detectarColumnas, aCorredor, direccionDatos } from '../lib/detectar.mjs';
import { Motor } from '../lib/motor.mjs';
import { crearFuente } from '../lib/fuentes.mjs';
import { fakeRaceResult, CORREDORES } from './fake-raceresult.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw Error('tiempo agotado'); await wait(50); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pgl-'));

test('CSV con punto y coma y titulos en castellano', () => {
  const t = leerTabla('Pos;Dorsal;Apellido y Nombre;Sexo;Categoría;Pos Cat;Distancia;Tiempo\n1;253;GALVAN, Luciano;M;M30;1;21K;1:13:00\n2;250;Gimenez Franco;M;M35;1;21K;1:15:02\n;300;Perez Ana;F;F40;;10K;DNF');
  const m = detectarColumnas(t.headers, t.rows);
  assert.deepEqual([m.pos, m.bib, m.nombre, m.sexo, m.cat, m.catPos, m.dist, m.tiempo], [0, 1, 2, 3, 4, 5, 6, 7]);
  const a = aCorredor(t.rows[0], m);
  assert.equal(a.nombre, 'Luciano Galvan'); assert.equal(a.pos, 1); assert.equal(a.cat, 'M30'); assert.equal(a.finished, true);
  assert.equal(aCorredor(t.rows[2], m).finished, false);
});
test('Tabla HTML de una pagina de resultados', () => {
  const t = leerTabla('<html><table><tr><td>menu</td></tr></table><table class="r"><thead><tr><th>Puesto</th><th>N°</th><th>Atleta</th><th>Club</th><th>Tiempo&nbsp;Neto</th></tr></thead><tbody><tr><td>1</td><td>12</td><td>Ríos Andrea</td><td>Bahía Runners</td><td>00:41:30</td></tr><tr><td>2</td><td>15</td><td>Soto Juan</td><td>-</td><td>00:42:10</td></tr></tbody></table>');
  const m = detectarColumnas(t.headers, t.rows);
  assert.equal(m.nombre, 2); assert.equal(m.club, 3); assert.equal(m.neto, 4); assert.equal(m.pos, 0); assert.equal(m.bib, 1);
  assert.equal(aCorredor(t.rows[0], m).tiempo, '41:30');
});
test('JSON (arreglo de objetos, metido adentro de otro objeto)', () => {
  const t = leerTabla(JSON.stringify({ ok: 1, data: { results: [{ rank: 1, bib: '7', name: 'ANA LOPEZ', gender: 'F', race: '5K', chiptime: '20:01' }, { rank: 2, bib: '9', name: 'EVA DIAZ', gender: 'F', race: '5K', chiptime: '21:00' }] } }));
  const m = detectarColumnas(t.headers, t.rows);
  const a = aCorredor(t.rows[1], m);
  assert.deepEqual([a.pos, a.bib, a.nombre, a.sexo, a.dist, a.tiempo], [2, '9', 'Eva Diaz', 'F', '5K', '21:00']);
});
test('Sin titulos reconocibles: detecta por el contenido', () => {
  const t = leerTabla('a,b,c,d\n1,101,Juan Perez,0:35:10\n2,87,Pedro Gomez,0:36:00\n3,15,Luis Diaz,0:37:30');
  const m = detectarColumnas(t.headers, t.rows);
  assert.equal(m.nombre, 2); assert.equal(m.tiempo, 3); assert.equal(m.pos, 0); assert.equal(m.bib, 1);
});
test('Links de Google Sheets -> CSV', () => {
  assert.equal(direccionDatos('https://docs.google.com/spreadsheets/d/ABC123/edit#gid=55'), 'https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=55');
  assert.equal(direccionDatos('https://docs.google.com/spreadsheets/d/e/2PACX-xyz/pubhtml'), 'https://docs.google.com/spreadsheets/d/e/2PACX-xyz/pub?output=csv');
});

test('Link generico: la primera lectura carga, despues cada tiempo nuevo es una llegada', async () => {
  let csv = 'Pos,Dorsal,Nombre,Distancia,Tiempo\n1,10,Ana Ruiz,10K,40:00\n,11,Eva Paz,10K,\n,12,Juan Gil,5K,';
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/csv' }); r.end(csv); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const M = new Motor({ dataDir: tmp() }); await M.ready;
  const F = crearFuente(`http://127.0.0.1:${srv.address().port}/r.csv`, M, { intervalo: 2 });
  try {
    F.conectar();
    await until(() => M.corredores.size === 3);
    assert.equal(M.feed.length, 0);
    csv = csv.replace(',11,Eva Paz,10K,', '2,11,Eva Paz,10K,41:30').replace(',12,Juan Gil,5K,', ',12,Juan Gil,5K,22:10');
    await until(() => M.feed.length === 2, 6000);
    const f = M.feedPantalla();
    assert.deepEqual(f.map(x => [x.c.nombre, x.c.puesto]), [['Eva Paz', 2], ['Juan Gil', 1]]);
    assert.deepEqual(M.distancias(), ['5K', '10K']);
    assert.deepEqual(M.tabla({ dist: '10K' }).map(c => c.nombre), ['Ana Ruiz', 'Eva Paz']);
    assert.match(F.info().tipo, /CSV/);
  } finally { F.desconectar(); srv.close(); }
});

test('RaceResult: en vivo, simular y cargar todos', async () => {
  const rr = fakeRaceResult(); await new Promise(r => rr.listen(0, '127.0.0.1', r));
  const M = new Motor({ dataDir: tmp() }); await M.ready;
  const F = crearFuente(`http://127.0.0.1:${rr.address().port}/presenters/?event=1&n=X&k=CLAVE`, M);
  try {
    assert.match(F.tipo, /RaceResult/);
    await F.probar();
    F.conectar();
    await until(() => F.estado.conectado && rr.conectados() > 0);
    rr.cruza(CORREDORES[3]);
    await until(() => M.feed.length === 1);
    assert.equal(M.feedPantalla()[0].c.nombre, 'Luciano Galvan');
    await F.simular('1');
    assert.equal(M.feed.length, 2);
    await assert.rejects(F.simular('999'), /no está/);
    await F.cargarTodos(300);
    assert.equal(M.resumen().total, 4); assert.equal(M.resumen().llegaron, 3);
    assert.equal(M.evento, 'CARRERA DE PRUEBA');
  } finally { F.desconectar(); rr.close(); }
});
