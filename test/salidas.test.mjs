import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { VMix, OBS } from '../lib/salidas.mjs';

test('vMix: crea el input Browser, le pone nombre y lo manda al overlay', async () => {
  const inputs = [{ key: 'k1', n: 1, type: 'Capture', title: 'Cam 1' }]; const ov = { 1: null, 2: null, 3: null, 4: null }; const calls = [];
  const srv = http.createServer((q, r) => {
    const p = Object.fromEntries(new URL(q.url, 'http://x').searchParams); if (p.Function) calls.push(p.Function);
    if (p.Function === 'AddInput') inputs.push({ key: 'k2', n: 2, type: 'Browser', title: p.Value.split('|')[1] });
    if (p.Function === 'SetInputName') inputs.find(i => i.key === p.Input).title = p.Value;
    const m = /^OverlayInput(\d)In$/.exec(p.Function || ''); if (m) ov[m[1]] = inputs.find(i => i.key === p.Input).n;
    r.end(`<vmix><version>27.0</version><inputs>${inputs.map(i => `<input key="${i.key}" number="${i.n}" type="${i.type}" title="${i.title}">x</input>`).join('')}</inputs><overlays>${Object.entries(ov).map(([k, v]) => v ? `<overlay number="${k}">${v}</overlay>` : `<overlay number="${k}" />`).join('')}</overlays></vmix>`);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const V = new VMix(() => ({ host: '127.0.0.1', puerto: srv.address().port }));
  const log = await V.cargar({ nombre: 'PanelGo Llegadas', url: 'http://127.0.0.1:5200/graficos.html', overlay: 2 });
  assert.deepEqual(calls, ['AddInput', 'SetInputName', 'OverlayInput2In']);
  assert.equal(ov[2], 2); assert.match(log.join(), /Creado/);
  calls.length = 0;
  await V.cargar({ nombre: 'PanelGo Llegadas', url: 'http://x/g', overlay: 2 });
  assert.deepEqual(calls, ['BrowserNavigate']); // ya estaba y ya estaba al aire
  srv.close();
});

// OBS de prueba: servidor obs-websocket 5 minimo con contraseña
function fakeObs(clave) {
  const reqs = []; const escenas = ['Escena', 'Carrera'];
  const srv = http.createServer();
  srv.on('upgrade', (req, sock) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = o => { const b = Buffer.from(JSON.stringify(o)); sock.write(Buffer.concat([Buffer.from(b.length < 126 ? [0x81, b.length] : [0x81, 126, b.length >> 8, b.length & 255]), b])); };
    const salt = 'sal', challenge = 'reto';
    send({ op: 0, d: { rpcVersion: 1, authentication: { salt, challenge } } });
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 6) {
        let len = buf[1] & 127, off = 2; if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + 4 + len) return;
        const mk = buf.subarray(off, off + 4), p = Buffer.from(buf.subarray(off + 4, off + 4 + len).map((b, i) => b ^ mk[i % 4])); const op = buf[0] & 15; buf = buf.subarray(off + 4 + len);
        if (op !== 1) continue;
        const m = JSON.parse(p);
        if (m.op === 1) {
          const ok = m.d.authentication === crypto.createHash('sha256').update(crypto.createHash('sha256').update(clave + salt).digest('base64') + challenge).digest('base64');
          if (!ok) { sock.end(Buffer.from([0x88, 2, 4009 >> 8, 4009 & 255])); return; }
          send({ op: 2, d: { negotiatedRpcVersion: 1 } });
        } else if (m.op === 6) {
          reqs.push(m.d.requestType);
          const R = { GetSceneList: { scenes: escenas.map(s => ({ sceneName: s })) }, GetVideoSettings: { baseWidth: 1280, baseHeight: 720 }, CreateInput: { sceneItemId: 7 }, GetSceneItemList: { sceneItems: [{}, {}, {}] } };
          send({ op: 7, d: { requestType: m.d.requestType, requestId: m.d.requestId, requestStatus: { result: true, code: 100 }, responseData: R[m.d.requestType] || {} } });
          if (m.d.requestType === 'SetSceneItemTransform') reqs.push(JSON.stringify(m.d.requestData.sceneItemTransform));
        }
      }
    });
  });
  return { srv, reqs };
}
test('OBS: contraseña, escenas y fuente de navegador escalada al lienzo', async () => {
  const { srv, reqs } = fakeObs('secreto'); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await assert.rejects(new OBS(() => ({ puerto: port, clave: 'mal' })).escenas(), /contraseña/);
  const O = new OBS(() => ({ puerto: port, clave: 'secreto' }));
  assert.deepEqual(await O.escenas(), ['Carrera', 'Escena']);
  const log = await O.cargar({ nombre: 'PanelGo Llegadas', url: 'http://x/g', escena: 'Carrera' });
  assert.match(log[0], /Creada/);
  assert.ok(reqs.includes('CreateInput') && reqs.includes('SetSceneItemIndex'));
  assert.ok(reqs.some(r => r.includes('"scaleX":0.6666')));
  srv.close();
});
