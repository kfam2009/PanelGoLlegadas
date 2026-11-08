// PanelGo Llegadas - licencia offline firmada.
// La llave la emite Panel Go con su clave PRIVADA (en el generador, que no se comparte).
// El panel la verifica con la clave PUBLICA de abajo, sin internet. Vence por fecha.
import crypto from 'node:crypto';

// Clave publica de Panel Go (se puede repartir; no sirve para fabricar llaves).
const PUBLICA = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAtdt93Yh6fH34wSJcvw9F2I/3PyZVuClBOB1djhRa47s=
-----END PUBLIC KEY-----`;

const deB64url = s => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hoyISO = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD en hora local

// Verifica una llave. Devuelve { ok, demo, cliente, desde, hasta, evento, motivo }.
// ok = firma valida Y dentro de fechas. demo = hay que mostrar marca de agua.
export function verificar(token) {
  const t = String(token || '').trim();
  if (!t) return { ok: false, demo: true, motivo: 'Sin licencia (modo demo)' };
  try {
    const [p, s] = t.split('.');
    if (!p || !s) return { ok: false, demo: true, motivo: 'Formato de llave inválido' };
    const payload = deB64url(p), sig = deB64url(s);
    if (!crypto.verify(null, payload, PUBLICA, sig)) return { ok: false, demo: true, motivo: 'Llave no válida (firma)' };
    const d = JSON.parse(payload.toString('utf8'));
    const hoy = hoyISO();
    const antes = d.d && hoy < d.d, despues = d.h && hoy > d.h;
    const ok = !antes && !despues;
    return {
      ok, demo: !ok, cliente: d.c || '', desde: d.d || '', hasta: d.h || '', evento: d.e || '',
      motivo: ok ? '' : antes ? `La licencia empieza el ${d.d}` : `Licencia vencida el ${d.h}`,
    };
  } catch { return { ok: false, demo: true, motivo: 'Llave ilegible' }; }
}

// Resumen liviano para los graficos (sin datos de mas).
export function estadoLicencia(token) {
  const v = verificar(token);
  return { ok: v.ok, demo: v.demo, cliente: v.cliente || '', hasta: v.hasta || '', motivo: v.motivo || '' };
}
