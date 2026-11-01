import test from 'node:test';
import assert from 'node:assert/strict';
import { linkResultadosRR, aplanarRR, mapaRR, corredorRR } from '../lib/fuentes.mjs';

test('my.raceresult: reconoce el link de posiciones finales (y no el presenter)', () => {
  assert.deepEqual(linkResultadosRR('https://my.raceresult.com/433095/results#0_DB6BDF'), { event: '433095', listId: 'DB6BDF', host: 'https://my.raceresult.com' });
  assert.equal(linkResultadosRR('https://events.raceresult.com/presenters/?event=1&n=x&k=y'), null);
  assert.equal(linkResultadosRR('https://ejemplo.com/resultados'), null);
});

test('my.raceresult: interpreta posiciones por categoria y toma el tiempo final (multideporte)', () => {
  const DataFields = ['BIB', 'ID', 'ConEstatus([AUTORANK.p])', 'MostrarNombre', 'KAYAKyT1', 'BICIyT2', 'Runing', 'Final'];
  const data = { '#1_Tria Adulto Individual': { '#1_Masculino': [
    ['2', '2', '1.', ', Romera Facundo', '33:45', '1:44:06', '37:00', '2:21:06'],
    ['14', '14', '6.', ', Castagna Marcos', '', '2:02:18', '41:32', '2:43:50'],
    ['4', '4', 'DNF', ', Fernandez Diego', '', '', '', ''],
  ] } };
  const map = mapaRR(DataFields), filas = aplanarRR(data);
  assert.equal(filas[0].dist, 'Tria Adulto Individual · Masculino');
  const c = filas.map(f => corredorRR(f.fila, map, f.dist));
  assert.deepEqual([c[0].id, c[0].nombre, c[0].pos, c[0].tiempo, c[0].finished], ['rl2', 'Romera Facundo', 1, '2:21:06', true]);
  assert.equal(c[1].tiempo, '2:43:50', 'sin parcial de kayak igual toma el final');
  assert.deepEqual([c[2].pos, c[2].finished, c[2].tiempo], [null, false, ''], 'DNF no cuenta');
});
