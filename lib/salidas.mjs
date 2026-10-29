// PanelGo Llegadas - carga los graficos directamente en vMix (API web) y en OBS (obs-websocket 5).
import crypto from 'node:crypto';
import { WsClient } from './wsclient.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const attr = (s, k) => { const m = new RegExp(`\\s${k}="([^"]*)"`).exec(s); return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : ''; };

// ---------- vMix ----------
export function vmixEstado(xml) {
  const inputs = [...xml.matchAll(/<input\s[^>]*>/g)].map(m => ({ key: attr(m[0], 'key'), number: Number(attr(m[0], 'number')), type: attr(m[0], 'type'), title: attr(m[0], 'title') })).filter(i => i.number);
  const ov = /<overlays>([\s\S]*?)<\/overlays>/.exec(xml)?.[1] || '';
  const overlays = Object.fromEntries([...ov.matchAll(/<overlay number="(\d+)"[^>]*>(\d*)<\/overlay>|<overlay number="(\d+)"[^>]*\/>/g)].map(m => [m[1] || m[3], Number(m[2]) || null]));
  return { inputs, overlays, version: /<version>([^<]*)<\/version>/.exec(xml)?.[1] || '' };
}
export class VMix {
  constructor(cfg) { this.cfg = cfg; }
  base() { const c = this.cfg(); return `http://${c.host || '127.0.0.1'}:${c.puerto || 8088}/api/`; }
  async req(params = {}) {
    const r = await fetch(this.base() + '?' + new URLSearchParams(params), { signal: AbortSignal.timeout(4000) }).catch(e => { throw Error('vMix no responde en ' + this.base().replace('/api/', '') + ' (¿está abierto? ¿Web Controller activado?)'); });
    const t = await r.text(); if (!r.ok) throw Error('vMix: ' + t.slice(0, 120)); return t;
  }
  async estado() { return vmixEstado(await this.req()); }
  // crea (o actualiza) el input Browser con la pagina y lo pone en el overlay elegido
  async cargar({ nombre, url, overlay }) {
    let s = await this.estado(), log = [];
    let inp = s.inputs.find(i => i.title.toLowerCase() === nombre.toLowerCase());
    if (inp) { await this.req({ Function: 'BrowserNavigate', Input: inp.key, Value: url }); log.push(`"${nombre}" ya estaba (input ${inp.number}): actualizado`); }
    else {
      const antes = new Set(s.inputs.map(i => i.key));
      await this.req({ Function: 'AddInput', Value: `Browser|${url}` });
      for (let t = 0; t < 25 && !inp; t++) { await sleep(400); s = await this.estado(); inp = s.inputs.find(i => !antes.has(i.key)); }
      if (!inp) throw Error('vMix no creó el input');
      await this.req({ Function: 'SetInputName', Input: inp.key, Value: nombre });
      log.push(`Creado "${nombre}" (input ${inp.number})`);
    }
    if (overlay) {
      s = await this.estado();
      if (s.overlays[overlay] !== inp.number) await this.req({ Function: `OverlayInput${overlay}In`, Input: inp.key });
      log.push(`Al aire en el overlay ${overlay}`);
    }
    return log;
  }
  async sacar({ nombre, overlay }) {
    const s = await this.estado(), inp = s.inputs.find(i => i.title.toLowerCase() === nombre.toLowerCase());
    if (inp && s.overlays[overlay] === inp.number) await this.req({ Function: `OverlayInput${overlay}Out` });
  }
}

// ---------- OBS (obs-websocket 5, viene con OBS 28 o mas nuevo) ----------
export class OBS {
  constructor(cfg) { this.cfg = cfg; }
  sesion(fn) {
    const c = this.cfg(), url = `ws://${c.host || '127.0.0.1'}:${c.puerto || 4455}`;
    return new Promise((resolve, reject) => {
      let ws, id = 0; const pend = new Map(); let fin = false;
      const t = setTimeout(() => terminar(Error('OBS no responde en ' + url + ' (Herramientas > Ajustes del servidor WebSocket)')), 8000);
      const terminar = (err, val) => { if (fin) return; fin = true; clearTimeout(t); try { ws?.close(); } catch {} err ? reject(err) : resolve(val); };
      const pedir = (requestType, requestData = {}) => new Promise((ok, bad) => {
        const requestId = String(++id); pend.set(requestId, { ok, bad });
        ws.send(0x1, Buffer.from(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } })));
      });
      try { ws = new WsClient(url, { origin: 'http://127.0.0.1' }); } catch (e) { return terminar(e); }
      ws.on('error', e => terminar(Error('OBS no responde en ' + url + ': ' + e.message)));
      ws.on('close', code => terminar(Error(code === 4009 ? 'OBS: contraseña incorrecta' : 'OBS cerró la conexión (' + code + ')')));
      ws.on('message', m => {
        let msg; try { msg = JSON.parse(m); } catch { return; }
        if (msg.op === 0) { // Hello
          const d = { rpcVersion: 1 }, a = msg.d.authentication;
          if (a) {
            if (!c.clave) return terminar(Error('OBS pide contraseña: cargala en el panel'));
            const secret = crypto.createHash('sha256').update(c.clave + a.salt).digest('base64');
            d.authentication = crypto.createHash('sha256').update(secret + a.challenge).digest('base64');
          }
          ws.send(0x1, Buffer.from(JSON.stringify({ op: 1, d })));
        } else if (msg.op === 2) { // Identified
          Promise.resolve(fn(pedir)).then(v => terminar(null, v), e => terminar(e));
        } else if (msg.op === 7) {
          const p = pend.get(msg.d.requestId); if (!p) return; pend.delete(msg.d.requestId);
          msg.d.requestStatus.result ? p.ok(msg.d.responseData || {}) : p.bad(Object.assign(Error('OBS: ' + (msg.d.requestStatus.comment || msg.d.requestStatus.code)), { code: msg.d.requestStatus.code }));
        }
      });
    });
  }
  escenas() { return this.sesion(async pedir => (await pedir('GetSceneList')).scenes.map(s => s.sceneName).reverse()); }
  // crea (o actualiza) la fuente de navegador en la escena, a pantalla completa del lienzo
  cargar({ nombre, url, escena }) {
    return this.sesion(async pedir => {
      const log = [];
      const v = await pedir('GetVideoSettings');
      const settings = { url, width: 1920, height: 1080, fps_custom: true, fps: 30, reroute_audio: false, shutdown: false, restart_when_active: false };
      const esc = escena || (await pedir('GetCurrentProgramScene')).currentProgramSceneName;
      let itemId;
      try {
        itemId = (await pedir('CreateInput', { sceneName: esc, inputName: nombre, inputKind: 'browser_source', inputSettings: settings, sceneItemEnabled: true })).sceneItemId;
        log.push(`Creada la fuente "${nombre}" en la escena "${esc}"`);
      } catch (e) {
        if (e.code !== 601) throw e; // ya existe: se actualiza y se agrega a la escena si no esta
        await pedir('SetInputSettings', { inputName: nombre, inputSettings: settings });
        try { itemId = (await pedir('GetSceneItemId', { sceneName: esc, sourceName: nombre })).sceneItemId; log.push(`"${nombre}" ya estaba en "${esc}": actualizada`); }
        catch { itemId = (await pedir('CreateSceneItem', { sceneName: esc, sourceName: nombre, sceneItemEnabled: true })).sceneItemId; log.push(`"${nombre}" agregada a la escena "${esc}"`); }
      }
      // si el lienzo no es 1920x1080, se escala para que ocupe todo
      await pedir('SetSceneItemTransform', { sceneName: esc, sceneItemId: itemId, sceneItemTransform: { positionX: 0, positionY: 0, scaleX: v.baseWidth / 1920, scaleY: v.baseHeight / 1080 } });
      await pedir('SetSceneItemEnabled', { sceneName: esc, sceneItemId: itemId, sceneItemEnabled: true });
      // arriba de todo en la escena, para que se vea encima de las camaras
      const items = (await pedir('GetSceneItemList', { sceneName: esc })).sceneItems;
      await pedir('SetSceneItemIndex', { sceneName: esc, sceneItemId: itemId, sceneItemIndex: Math.max(0, items.length - 1) });
      return log;
    });
  }
}
