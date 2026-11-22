// Reglas del negocio — UNA sola fuente de verdad.
// La usan la página (js/app.js) y el Worker de Telegram (worker/src/index.js).
// Para cambiar precios, servicios u horarios, edita SOLO este archivo.

export const NEGOCIO = {
  nombre: 'Oasis',
  lema: 'Estudio de uñas',
  zonaHoraria: 'America/Bogota', // UTC-5 todo el año
  desfaseHoras: -5,
};

// Precios y duraciones de EJEMPLO (demostración). Moneda: COP.
export const SERVICIOS = [
  { id: 'manicure-clasica', nombre: 'Manicure clásica', desc: 'Limado, cutícula y esmaltado tradicional con acabado brillante.', min: 45, precio: 30000, icono: 'hoja' },
  { id: 'semipermanente', nombre: 'Semipermanente', desc: 'Color que dura hasta 3 semanas, sin imperfecciones ni tiempos de secado.', min: 60, precio: 50000, icono: 'gota' },
  { id: 'acrilicas', nombre: 'Uñas acrílicas', desc: 'Extensión y estructura a tu medida: almendra, coffin, cuadrada o stiletto.', min: 120, precio: 110000, icono: 'diamante' },
  { id: 'polygel', nombre: 'Polygel', desc: 'Más liviano que el acrílico y muy resistente. Ideal si tus uñas se quiebran.', min: 120, precio: 120000, icono: 'pluma' },
  { id: 'pedicure-spa', nombre: 'Pedicure spa', desc: 'Exfoliación, hidratación y esmaltado para unos pies suaves y cuidados.', min: 75, precio: 55000, icono: 'ola' },
  { id: 'manicure-pedicure', nombre: 'Manicure + pedicure', desc: 'El combo completo en una sola cita, con semipermanente en manos y pies.', min: 120, precio: 95000, icono: 'sol' },
];

export const EXTRAS = [
  { id: 'nail-art', nombre: 'Nail art a mano', detalle: 'Diseño por uña', min: 15, precio: 20000 },
  { id: 'french', nombre: 'French o baby boomer', detalle: 'Acabado clásico', min: 10, precio: 10000 },
  { id: 'efecto-espejo', nombre: 'Efecto espejo / cromo', detalle: 'Brillo tipo espejo', min: 10, precio: 15000 },
  { id: 'retiro', nombre: 'Retiro de material anterior', detalle: 'Gel, acrílico o polygel', min: 20, precio: 15000 },
  { id: 'reparacion', nombre: 'Reparación de uña', detalle: 'Por uña', min: 10, precio: 5000 },
];

// Horario por día de la semana (0 = domingo). Valores en minutos desde las 00:00. null = cerrado.
export const HORARIO = {
  0: null,
  1: [9 * 60, 18 * 60],
  2: [9 * 60, 18 * 60],
  3: [9 * 60, 18 * 60],
  4: [9 * 60, 18 * 60],
  5: [9 * 60, 18 * 60],
  6: [9 * 60, 15 * 60],
};

export const PASO_MIN = 30;        // las citas empiezan cada 30 minutos
export const ANTICIPACION_MIN = 60; // no se puede reservar con menos de 1 hora de anticipación
export const DIAS_ADELANTE = 27;    // se puede reservar hasta 27 días adelante

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/* ---------- utilidades de tiempo (siempre en hora de Colombia) ---------- */

export function ahoraNegocio(nowMs = Date.now()) {
  const d = new Date(nowMs + NEGOCIO.desfaseHoras * 3600 * 1000);
  return { fecha: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

export function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diaSemana(fecha) {
  return new Date(fecha + 'T12:00:00Z').getUTCDay();
}

export function minAHora(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

export function horaAMin(h) {
  const m = /^(\d{2}):(\d{2})$/.exec(h || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export function formatoHora(min) {
  const h24 = Math.floor(min / 60), m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'a. m.' : 'p. m.'}`;
}

export function formatoFecha(fecha, opciones = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('es-CO', { ...opciones, timeZone: 'UTC' }).format(new Date(fecha + 'T12:00:00Z'));
}

export function formatoPrecio(n) {
  return '$' + new Intl.NumberFormat('es-CO').format(n);
}

export function formatoDuracion(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/* ---------- reglas de reserva ---------- */

export function servicioPorId(id) {
  return SERVICIOS.find((s) => s.id === id) || null;
}

// Devuelve { servicio, extras, min, precio } o null si algún id no existe.
export function calcularReserva(servicioId, extraIds = []) {
  const servicio = servicioPorId(servicioId);
  if (!servicio || !Array.isArray(extraIds)) return null;
  const vistos = new Set();
  const extras = [];
  for (const id of extraIds) {
    const e = EXTRAS.find((x) => x.id === id);
    if (!e || vistos.has(id)) return null;
    vistos.add(id);
    extras.push(e);
  }
  return {
    servicio,
    extras,
    min: servicio.min + extras.reduce((a, e) => a + e.min, 0),
    precio: servicio.precio + extras.reduce((a, e) => a + e.precio, 0),
  };
}

export function fechaReservable(fecha, ahora = ahoraNegocio()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return false;
  if (Number.isNaN(new Date(fecha + 'T12:00:00Z').getTime())) return false;
  if (fecha < ahora.fecha) return false;
  if (fecha > sumarDias(ahora.fecha, DIAS_ADELANTE)) return false;
  return !!HORARIO[diaSemana(fecha)];
}

// ocupados: [{ inicio, fin }] en minutos. Devuelve todos los horarios posibles del día
// con `libre` true/false.
export function horariosDelDia(fecha, duracionMin, ocupados = [], ahora = ahoraNegocio()) {
  if (!fechaReservable(fecha, ahora)) return [];
  const [abre, cierra] = HORARIO[diaSemana(fecha)];
  const salida = [];
  for (let ini = abre; ini + duracionMin <= cierra; ini += PASO_MIN) {
    const fin = ini + duracionMin;
    const pasado = fecha === ahora.fecha && ini < ahora.min + ANTICIPACION_MIN;
    const choca = ocupados.some((o) => ini < o.fin && fin > o.inicio);
    salida.push({ min: ini, hora: minAHora(ini), libre: !pasado && !choca });
  }
  return salida;
}
