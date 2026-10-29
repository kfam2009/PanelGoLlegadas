// PanelGo Llegadas - panel (PC o celular)
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
let st = null, busy = false, colDraft = null;
const sigs = {};
// solo se redibuja lo que cambio (si se rearma un boton mientras se hace clic, el clic se pierde)
const changed = (k, v) => { const s = JSON.stringify(v); if (sigs[k] === s) return false; sigs[k] = s; return true; };
const focused = e => document.activeElement === (typeof e === 'string' ? $(e) : e);
const setVal = (sel, v) => { const e = $(sel); if (e && !focused(e) && e.value !== String(v ?? '')) e.value = v ?? ''; };

function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 5000); }
async function api(route, data, ms) {
  const r = await fetch('/api/' + route, { ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : { cache: 'no-store' }), signal: AbortSignal.timeout(ms || (data ? 30000 : 8000)) });
  const j = await r.json(); if (!r.ok) throw Error(j.error || 'No se pudo completar'); return j;
}
async function act(route, data, msg) {
  if (busy) return; busy = true;
  try { st = await api(route, data || {}); render(); const l = st.log?.length ? '\n' + st.log.join('\n') : ''; if (msg || l) toast((msg || '') + l); return true; }
  catch (e) { toast(e.name === 'TimeoutError' ? 'El programa no respondió, probá de nuevo' : e.message); return false; }
  finally { busy = false; }
}
const cfg = d => act('config', d);
const ago = t => { if (!t) return ''; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`; };
const opciones = (sel, list, todos, val) => {
  const e = $(sel); if (focused(e)) return;
  const k = JSON.stringify([list, todos]); if (e.dataset.k !== k) { e.dataset.k = k; e.replaceChildren(new Option(todos, ''), ...list.map(x => new Option(x, x))); }
  e.value = list.includes(val) ? val : '';
};

function render() {
  if (!st) return;
  const C = st.config, D = st.datos;
  $('#ver').textContent = 'Versión ' + st.version;
  if (changed('urls', st.urls)) $('#urls').textContent = st.urls.length ? 'Desde el celular: ' + st.urls[0] : '';
  // Datos
  setVal('#link', C.link); setVal('#intervalo', C.intervalo);
  $('#conn').textContent = !C.link ? 'SIN DATOS' : D.conectado ? 'CONECTADO' : D.error ? 'SIN CONEXIÓN' : 'CONECTANDO';
  $('#conn').className = 'pill' + (D.conectado ? ' ok' : D.error ? ' bad' : C.link ? ' warn' : '');
  $('#tipo').textContent = D.tipo || '';
  $('#info').textContent = [D.error, st.evento, D.ultimo && 'último dato ' + ago(D.ultimo), D.cargando && `cargando ${D.cargando.hechos}/${D.cargando.total}`].filter(Boolean).join(' · ');
  $('#cuenta').textContent = `${st.llegaron} con tiempo de ${st.total}` + (st.distancias.length > 1 ? ' · ' + st.distancias.map(d => `${d.dist}: ${d.n}`).join(' · ') : '');
  if (!colDraft && changed('cols', [D.columnas, st.campos])) drawCols();
  // Llegadas
  if (changed('list', st.recientes.map(c => [c.id, c.t, c.puesto]))) {
    $('#list').replaceChildren(...(st.recientes.length ? st.recientes.map(c => {
      const r = el('div', 'it'), rep = el('button', '', '↻'); rep.title = 'Mostrar de nuevo el cartel'; rep.onclick = () => act('repetir', { id: c.id }, 'Cartel de ' + c.nombre);
      r.append(el('b', '', c.puesto ? c.puesto + '°' : '-'), el('span', 'n', c.nombre), el('span', 'm', [c.bib && '#' + c.bib, c.dist !== 'General' && c.dist, c.cat].filter(Boolean).join(' · ')), el('b', 't', c.tiempo || '--'), rep);
      return r;
    }) : [el('p', 'muted', 'Todavía no llegó nadie. Para probar el cartel: CARGAR TODOS y después PROBAR (con un dorsal o vacío para uno al azar).')]));
  }
  // Al aire
  for (const b of $$('.sw')) b.classList.toggle('on', Boolean(C.aire[b.dataset.aire]));
  setVal('#llSeg', C.llegada.segundos); if (!focused('#llAgr')) $('#llAgr').checked = C.llegada.agrupar;
  const dists = st.distancias.map(d => d.dist);
  opciones('#pDist', dists, 'Todas (rotan)', C.posiciones.dist); opciones('#pCat', st.categorias, 'Todas', C.posiciones.cat); opciones('#pSexo', st.sexos, 'Todos', C.posiciones.sexo);
  opciones('#dDist', dists, dists.length ? 'La primera' : 'General', C.podio.dist); opciones('#dCat', st.categorias, 'General', C.podio.cat); opciones('#dSexo', st.sexos, 'Todos', C.podio.sexo);
  setVal('#pLado', C.posiciones.lado); setVal('#pFilas', C.posiciones.filas); setVal('#rLado', C.reloj.lado);
  $('#relInfo').textContent = C.reloj.inicio ? 'largó a las ' + new Date(C.reloj.inicio).toLocaleTimeString() : 'sin largada';
  // Diseño
  if (changed('temas', [Object.keys(st.temas), Object.keys(C.temasGuardados)]) && !focused('#temaBase')) {
    $('#temaBase').replaceChildren(new Option('Elegí un estilo...', ''), ...Object.keys(st.temas).map(k => new Option(k, k)), ...Object.keys(C.temasGuardados).map(k => new Option('★ ' + k, k)));
  }
  if (changed('fuentes', st.fuentes)) $('#fuente').replaceChildren(...st.fuentes.map(f => { const o = new Option(f, f); o.style.fontFamily = f; return o; }));
  for (const i of $$('[data-t]')) setVal(`[data-t="${i.dataset.t}"]`, C.tema[i.dataset.t]);
  setVal('#fuente', C.tema.fuente); setVal('#escala', C.tema.escala); setVal('#margen', C.tema.margen); setVal('#redondeo', C.tema.redondeo);
  if (!focused('#mayus')) $('#mayus').checked = C.tema.mayusculas;
  for (const i of $$('[data-x]')) setVal(`[data-x="${i.dataset.x}"]`, C.textos[i.dataset.x]);
  setVal('#pTitulo', C.posiciones.titulo); setVal('#rTitulo', C.reloj.titulo);
  // Logos
  if (changed('logos', C.logos)) {
    for (const s of $$('.slot')) {
      const k = s.dataset.logo, src = C.logos[k]; s.replaceChildren();
      if (src) { const i = el('img'); i.src = src; const x = el('button', 'x', '×'); x.title = 'Quitar'; x.onclick = e => { e.stopPropagation(); act('logos/quitar', { tipo: k }); }; s.append(i, x); }
      else s.textContent = '+ SUBIR';
    }
    $('#sponsors').replaceChildren(...(C.logos.sponsors.length ? C.logos.sponsors.map(a => { const d = el('div', 'sp'), i = el('img'), x = el('button', 'x', '×'); i.src = a; x.onclick = () => act('logos/quitar', { tipo: 'sponsor', archivo: a }); d.append(i, x); return d; }) : [el('p', 'muted', 'Sin sponsors.')]));
  }
  // Salidas
  setVal('#vHost', C.vmix.host); setVal('#vPuerto', C.vmix.puerto); setVal('#vOv', C.vmix.overlay);
  setVal('#oHost', C.obs.host); setVal('#oPuerto', C.obs.puerto); setVal('#oClave', C.obs.clave);
  if (changed('esc', C.obs.escena) && ![...$('#oEsc').options].some(o => o.value === C.obs.escena)) $('#oEsc').append(new Option(C.obs.escena, C.obs.escena));
  setVal('#oEsc', C.obs.escena);
  if (changed('links', st.graficos)) {
    const g = st.graficos, base = g.vmix.replace(/\/graficos\.html.*/, '');
    $('#links').replaceChildren(...[['Todo (se maneja desde AL AIRE)', g.vmix], ['Solo llegadas', base + '/graficos.html?capa=llegada'], ['Solo posiciones', base + '/graficos.html?capa=posiciones'], ['Solo podio', base + '/graficos.html?capa=podio'], ['Solo reloj', base + '/graficos.html?capa=reloj']]
      .map(([t, u]) => { const d = el('div'); const c = el('code', '', u); c.title = 'Tocá para copiar'; c.onclick = () => navigator.clipboard?.writeText(u).then(() => toast('Copiado')); d.append(el('span', 'muted', t), c); return d; }));
  }
}

// Columnas detectadas: se pueden corregir a mano
function drawCols() {
  const cols = st.datos.columnas || [], box = $('#cols');
  $('#colsRes').textContent = cols.length ? '· ' + cols.filter(c => c.campo).map(c => st.campos[c.campo]).join(', ') : '';
  box.replaceChildren(...cols.flatMap((c, i) => {
    const h = el('div', 'h', c.titulo || `Columna ${i + 1}`); if (c.ejemplo) h.append(el('small', '', c.ejemplo));
    const s = el('select'); s.append(new Option('— no usar —', ''), ...Object.entries(st.campos).map(([k, v]) => new Option(v, k))); s.value = c.campo;
    s.onchange = () => { colDraft ||= Object.fromEntries(cols.filter(x => x.campo).map(x => [x.campo, cols.indexOf(x)])); for (const k of Object.keys(colDraft)) if (colDraft[k] === i) delete colDraft[k]; if (s.value) colDraft[s.value] = i; };
    return [h, s];
  }));
  if (!cols.length) box.append(el('p', 'muted', 'Conectá un link para ver qué detectó.'));
}
$('#saveCols').onclick = async () => { const m = {}; for (const k of Object.keys(st.campos)) m[k] = colDraft && k in colDraft ? colDraft[k] : -1; colDraft = null; sigs.cols = ''; await act('columnas', { columnas: m }, 'Columnas guardadas'); };
$('#autoCols').onclick = async () => { colDraft = null; sigs.cols = ''; await act('columnas', { columnas: null }, 'Detección automática'); };

// ---- Acciones ----
$('#saveLink').onclick = () => act('link', { link: $('#link').value, intervalo: Number($('#intervalo').value) }, $('#link').value.trim() ? 'Conectado' : 'Link borrado');
$('#link').onkeydown = e => { if (e.key === 'Enter') $('#saveLink').click(); };
$('#intervalo').onchange = () => act('link', { link: st.config.link, intervalo: Number($('#intervalo').value) });
$('#sim').onclick = () => act('simular', { bib: $('#bib').value.trim() }, 'Probando el cartel');
$('#bib').onkeydown = e => { if (e.key === 'Enter') $('#sim').click(); };
$('#scan').onclick = () => act('cargar', {}, 'Cargando todos los resultados...');
$('#clear').onclick = () => { if (confirm('¿Borrar todos los corredores guardados? (para empezar un evento nuevo)')) act('borrar', {}, 'Borrado'); };
for (const b of $$('.sw')) b.onclick = () => cfg({ aire: { [b.dataset.aire]: !st.config.aire[b.dataset.aire] } });
$('#llSeg').onchange = () => cfg({ llegada: { segundos: Number($('#llSeg').value) } });
$('#llAgr').onchange = () => cfg({ llegada: { agrupar: $('#llAgr').checked } });
for (const [id, k] of [['#pDist', 'dist'], ['#pCat', 'cat'], ['#pSexo', 'sexo'], ['#pLado', 'lado'], ['#pFilas', 'filas'], ['#pTitulo', 'titulo']]) $(id).onchange = () => cfg({ posiciones: { [k]: $(id).value } });
for (const [id, k] of [['#dDist', 'dist'], ['#dCat', 'cat'], ['#dSexo', 'sexo']]) $(id).onchange = () => cfg({ podio: { [k]: $(id).value } });
$('#largar').onclick = () => { if (!st.config.reloj.inicio || confirm('¿Largar de nuevo el reloj desde cero?')) act('config', { reloj: { accion: 'largar' } }, 'Reloj largado'); };
$('#hora').onchange = () => $('#hora').value && act('config', { reloj: { accion: 'hora', hora: $('#hora').value.length === 5 ? $('#hora').value + ':00' : $('#hora').value } }, 'Largada a las ' + $('#hora').value);
$('#cero').onclick = () => act('config', { reloj: { accion: 'cero' } });
$('#rLado').onchange = () => cfg({ reloj: { lado: $('#rLado').value } });
$('#rTitulo').onchange = () => cfg({ reloj: { titulo: $('#rTitulo').value } });
// diseño: los colores y deslizadores se mandan mientras se mueven (con una pausa corta)
let tmr = null; const temaYa = (k, v) => { clearTimeout(tmr); tmr = setTimeout(() => cfg({ tema: { [k]: v } }), 120); };
for (const i of $$('[data-t]')) i.oninput = () => temaYa(i.dataset.t, i.value);
$('#fuente').onchange = () => cfg({ tema: { fuente: $('#fuente').value } });
$('#mayus').onchange = () => cfg({ tema: { mayusculas: $('#mayus').checked } });
for (const k of ['escala', 'margen', 'redondeo']) $('#' + k).oninput = () => temaYa(k, Number($('#' + k).value));
$('#temaBase').onchange = () => { if ($('#temaBase').value) cfg({ temaBase: $('#temaBase').value }); };
$('#guardarTema').onclick = () => { const n = prompt('Nombre para este estilo (ej. el de la productora):'); if (n) act('config', { guardarTema: n }, 'Estilo guardado: ' + n); };
for (const i of $$('[data-x]')) i.onchange = () => cfg({ textos: { [i.dataset.x]: i.value } });
for (const t of $$('.tabs button')) t.onclick = () => { for (const b of $$('.tabs button')) b.classList.toggle('on', b === t); for (const p of $$('.tab')) p.hidden = p.id !== 'tab-' + t.dataset.tab; };
// logos
const leerImagen = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(f); });
for (const s of $$('.slot')) s.onclick = () => { const i = el('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { if (i.files[0]) await act('logos/subir', { tipo: s.dataset.logo, data: await leerImagen(i.files[0]) }, 'Logo cargado'); }; i.click(); };
$('#spFile').onchange = async () => { for (const f of $('#spFile').files) await act('logos/subir', { tipo: 'sponsor', data: await leerImagen(f) }); $('#spFile').value = ''; toast('Sponsors agregados'); };
// salidas
const vmixCfg = () => ({ vmix: { host: $('#vHost').value, puerto: Number($('#vPuerto').value), overlay: Number($('#vOv').value) } });
const obsCfg = () => ({ obs: { host: $('#oHost').value, puerto: Number($('#oPuerto').value), clave: $('#oClave').value, escena: $('#oEsc').value } });
for (const id of ['#vHost', '#vPuerto', '#vOv']) $(id).onchange = () => cfg(vmixCfg());
for (const id of ['#oHost', '#oPuerto', '#oClave', '#oEsc']) $(id).onchange = () => cfg(obsCfg());
$('#vCargar').onclick = async () => { await cfg(vmixCfg()); if (await act('vmix', {}, 'vMix:')) $('#vmixRes').textContent = 'cargado ✓'; };
$('#vSacar').onclick = () => act('vmix', { sacar: true }, 'vMix:');
$('#oCargar').onclick = async () => { await cfg(obsCfg()); if (await act('obs', {}, 'OBS:')) $('#obsRes').textContent = 'cargado ✓'; };
$('#oEscenas').onclick = async () => {
  await cfg(obsCfg());
  try { const r = await api('obs/escenas'); const v = $('#oEsc').value; $('#oEsc').replaceChildren(new Option('La que está al aire', ''), ...r.escenas.map(e => new Option(e, e))); $('#oEsc').value = r.escenas.includes(v) ? v : ''; toast(`OBS: ${r.escenas.length} escenas`); }
  catch (e) { toast(e.message); }
};

function fitPreview() { const p = $('.prev'); $('#preview').style.transform = `scale(${p.clientWidth / 1920})`; }
new ResizeObserver(fitPreview).observe($('.prev'));
async function poll() {
  if (!busy) { try { st = await api('estado'); render(); } catch { $('#conn').textContent = 'SIN PROGRAMA'; $('#conn').className = 'pill bad'; } }
  setTimeout(poll, 1500);
}
fitPreview(); poll();
