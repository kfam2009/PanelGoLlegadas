// PanelGo Llegadas - control de domos (PTZ). Un "driver" por marca, porque los comandos cambian.
// Foscam: API CGI (CGIProxy.fcgi). Longse/otros: ONVIF (se activa cuando se conecte para probar).
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Mueve de a pasos (apretar = empezar, soltar = parar). 6 posiciones guardadas por cámara (PG1..PG6).
export const DIRECCIONES = ['arriba', 'abajo', 'izq', 'der', 'arriba-izq', 'arriba-der', 'abajo-izq', 'abajo-der'];

// ---------- Foscam ----------
function foscam(cam) {
  const base = `http://${cam.host}:${cam.puerto || 88}/cgi-bin/CGIProxy.fcgi`;
  const q = extra => `usr=${encodeURIComponent(cam.usuario || 'admin')}&pwd=${encodeURIComponent(cam.clave || '')}${extra}`;
  const cgi = async (cmd, extra = '') => {
    const r = await fetch(`${base}?cmd=${cmd}&${q(extra)}`, { signal: AbortSignal.timeout(6000) });
    return r.text();
  };
  const MOV = {
    arriba: 'ptzMoveUp', abajo: 'ptzMoveDown', izq: 'ptzMoveLeft', der: 'ptzMoveRight',
    'arriba-izq': 'ptzMoveTopLeft', 'arriba-der': 'ptzMoveTopRight', 'abajo-izq': 'ptzMoveBottomLeft', 'abajo-der': 'ptzMoveBottomRight',
  };
  const nombrePreset = n => 'PG' + Number(n);
  return {
    async probar() {
      const t = await cgi('getDevInfo');
      if (!/<result>\s*0\s*<\/result>/.test(t)) throw Error('No respondió (revisá IP, puerto, usuario y clave)');
      const nom = /<devName>(.*?)<\/devName>/.exec(t)?.[1];
      return { ok: true, nombre: nom || 'Foscam' };
    },
    async mover(dir) { const c = MOV[dir]; if (c) await cgi(c); },        // empieza a moverse (continuo)
    async zoom(dir) { await cgi(dir === 'mas' ? 'zoomIn' : 'zoomOut'); }, // empieza a hacer zoom
    async parar() { await cgi('ptzStopRun'); await cgi('zoomStop'); },
    async paso(dir, ms = 400) { const c = MOV[dir]; if (!c) return; await cgi(c); await sleep(ms); await cgi('ptzStopRun'); },
    async guardarPreset(n) { await cgi('ptzAddPresetPoint', `&name=${nombrePreset(n)}`); },
    async irPreset(n) { await cgi('ptzGotoPresetPoint', `&name=${nombrePreset(n)}`); },
    snapshot: () => `${base}?cmd=snapPicture2&${q('')}`,
  };
}

// ---------- registro por marca ----------
export function crearDomo(cam) {
  if (!cam || !cam.host) throw Error('Elegí una cámara (o cargá IP, usuario y clave)');
  const m = String(cam.marca || 'foscam').toLowerCase();
  if (m === 'foscam') return foscam(cam);
  if (m === 'longse' || m === 'onvif') throw Error('Longse/ONVIF todavía no está activo: lo probamos cuando conectes esa cámara. Por ahora anda Foscam.');
  throw Error('Marca desconocida: ' + m);
}
export const MARCAS = ['foscam', 'longse'];
