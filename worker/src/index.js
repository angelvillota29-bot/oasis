// Worker de reservas de Oasis (Cloudflare) ↔ Telegram.
//
//  GET  /api/disponibilidad?fecha=YYYY-MM-DD  → horarios ocupados (sin datos personales)
//  POST /api/reservas                         → crea la reserva y le avisa a Oasis por Telegram
//  POST /api/telegram                         → webhook de Telegram (botones Confirmar / Cancelar y /start)
//  GET  /api/salud                            → prueba rápida
//
// Variables (wrangler.toml): ALLOWED_ORIGIN, TELEGRAM_BOT_USUARIO
// Secretos (wrangler secret put): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WEBHOOK_SECRET
// Almacenamiento: KV "RESERVAS"

import {
  NEGOCIO, PASO_MIN, HORARIO, calcularReserva, fechaReservable, diaSemana, horaAMin,
  formatoFecha, formatoHora, formatoPrecio, formatoDuracion, ahoraNegocio,
} from '../../js/config.js';

const TTL = 60 * 60 * 24 * 120; // los datos se borran solos a los 120 días
const LIMITE_POR_HORA = 8;

/* ---------- utilidades ---------- */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const limpiar = (s, max) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function origenPermitido(request, env) {
  const origen = request.headers.get('Origin');
  if (!origen) return null;
  const lista = String(env.ALLOWED_ORIGIN || '').split(',').map((x) => x.trim()).filter(Boolean);
  return lista.includes('*') || lista.includes(origen) ? origen : null;
}

function respuesta(datos, status, request, env) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const origen = request && origenPermitido(request, env);
  if (origen) {
    h['Access-Control-Allow-Origin'] = origen;
    h['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify(datos), { status, headers: h });
}

function nuevoId() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => (x % 36).toString(36)).join('');
}

async function leerDia(env, fecha) {
  return (await env.RESERVAS.get(`dia:${fecha}`, 'json')) || [];
}
const guardarDia = (env, fecha, lista) => env.RESERVAS.put(`dia:${fecha}`, JSON.stringify(lista), { expirationTtl: TTL });
const leerReserva = (env, id) => env.RESERVAS.get(`res:${id}`, 'json');
const guardarReserva = (env, r) => env.RESERVAS.put(`res:${r.id}`, JSON.stringify(r), { expirationTtl: TTL });

const activas = (lista) => lista.filter((x) => x.estado !== 'cancelada');

/* ---------- Telegram ---------- */

async function telegram(env, metodo, cuerpo) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`Telegram ${metodo}: ${j.description || r.status}`);
  return j.result;
}

const ETIQUETA = { pendiente: '🟡 Pendiente de confirmar', confirmada: '✅ Confirmada', cancelada: '❌ Cancelada' };

// Celular colombiano (10 dígitos que empiezan por 3, con o sin 57) → enlace directo a WhatsApp.
function enlaceContacto(contacto) {
  const d = contacto.replace(/\D/g, '');
  const num = /^3\d{9}$/.test(d) ? '57' + d : /^573\d{9}$/.test(d) ? d : null;
  if (num) return `<a href="https://wa.me/${num}">${esc(contacto)}</a> (WhatsApp)`;
  return /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(contacto) ? '@' + esc(contacto.replace(/^@/, '')) : esc(contacto);
}

function resumenTexto(r) {
  const calc = calcularReserva(r.servicio, r.extras);
  const extras = calc.extras.length ? `\n➕ ${calc.extras.map((e) => esc(e.nombre)).join(', ')}` : '';
  const contacto = enlaceContacto(r.contacto);
  return (
    `💅 <b>Reserva · ${esc(NEGOCIO.nombre)}</b>\n` +
    `<b>${ETIQUETA[r.estado]}</b>\n\n` +
    `👤 ${esc(r.nombre)}\n` +
    `📱 ${contacto}\n` +
    `✨ ${esc(calc.servicio.nombre)}${extras}\n` +
    `📅 ${esc(formatoFecha(r.fecha))}\n` +
    `🕑 ${formatoHora(r.inicio)} – ${formatoHora(r.fin)} (${formatoDuracion(calc.min)})\n` +
    `💰 ${formatoPrecio(calc.precio)}` +
    (r.notas ? `\n📝 ${esc(r.notas)}` : '') +
    `\n\n<code>#${r.id}</code>`
  );
}

function botones(r) {
  if (r.estado === 'cancelada') return { inline_keyboard: [] };
  const fila = [];
  if (r.estado === 'pendiente') fila.push({ text: '✅ Confirmar', callback_data: `ok:${r.id}` });
  fila.push({ text: '❌ Cancelar', callback_data: `no:${r.id}` });
  return { inline_keyboard: [fila] };
}

/* ---------- validación ---------- */

function validar(b, ahora) {
  const calc = calcularReserva(b.servicio, b.extras ?? []);
  if (!calc) return { campo: 'servicio', error: 'Elige un servicio válido.' };
  if (!fechaReservable(b.fecha, ahora)) return { campo: 'fecha', error: 'Esa fecha no está disponible.' };
  const inicio = horaAMin(b.hora);
  const [abre, cierra] = HORARIO[diaSemana(b.fecha)];
  if (Number.isNaN(inicio) || inicio % PASO_MIN || inicio < abre || inicio + calc.min > cierra) {
    return { campo: 'hora', error: 'Esa hora no está disponible.' };
  }
  if (b.fecha === ahora.fecha && inicio < ahora.min + 60) return { campo: 'hora', error: 'Esa hora ya pasó o es muy pronto.' };
  const nombre = limpiar(b.nombre, 60);
  if (nombre.length < 2) return { campo: 'nombre', error: 'Escribe tu nombre.' };
  const contacto = limpiar(b.contacto, 60);
  if (contacto.length < 4) return { campo: 'contacto', error: 'Escribe tu usuario de Telegram o tu número.' };
  return {
    datos: {
      servicio: calc.servicio.id,
      extras: calc.extras.map((e) => e.id),
      fecha: b.fecha,
      inicio,
      fin: inicio + calc.min,
      nombre,
      contacto,
      notas: limpiar(b.notas, 300),
    },
  };
}

/* ---------- rutas ---------- */

async function disponibilidad(request, env) {
  const fecha = new URL(request.url).searchParams.get('fecha');
  if (!fechaReservable(fecha)) return respuesta({ fecha, ocupados: [], cerrado: true }, 200, request, env);
  const ocupados = activas(await leerDia(env, fecha)).map((x) => ({ inicio: x.inicio, fin: x.fin }));
  return respuesta({ fecha, ocupados }, 200, request, env);
}

async function crearReserva(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const claveRL = `rl:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const usados = Number((await env.RESERVAS.get(claveRL)) || 0);
  if (usados >= LIMITE_POR_HORA) return respuesta({ ok: false, error: 'Demasiados intentos. Intenta más tarde.' }, 429, request, env);
  await env.RESERVAS.put(claveRL, String(usados + 1), { expirationTtl: 3700 });

  let cuerpo;
  try { cuerpo = await request.json(); } catch { return respuesta({ ok: false, error: 'Solicitud inválida.' }, 400, request, env); }
  if (!cuerpo || typeof cuerpo !== 'object') return respuesta({ ok: false, error: 'Solicitud inválida.' }, 400, request, env);
  if (cuerpo.web) return respuesta({ ok: true, id: 'ok' }, 201, request, env); // campo trampa para bots

  const v = validar(cuerpo, ahoraNegocio());
  if (v.error) return respuesta({ ok: false, campo: v.campo, error: v.error }, 400, request, env);

  const dia = await leerDia(env, v.datos.fecha);
  if (activas(dia).some((x) => v.datos.inicio < x.fin && v.datos.fin > x.inicio)) {
    return respuesta({ ok: false, campo: 'hora', error: 'Ese horario se acaba de ocupar. Elige otro, por favor.' }, 409, request, env);
  }

  const reserva = { id: nuevoId(), estado: 'pendiente', creada: new Date().toISOString(), clienteChat: null, ...v.datos };
  dia.push({ id: reserva.id, inicio: reserva.inicio, fin: reserva.fin, estado: 'pendiente' });
  await guardarDia(env, reserva.fecha, dia);
  await guardarReserva(env, reserva);

  try {
    await telegram(env, 'sendMessage', {
      chat_id: env.TELEGRAM_CHAT_ID,
      text: resumenTexto(reserva),
      parse_mode: 'HTML',
      reply_markup: botones(reserva),
    });
  } catch (e) {
    // Si no pudimos avisarle a Oasis, no dejamos una reserva "fantasma": se deshace.
    await guardarDia(env, reserva.fecha, dia.filter((x) => x.id !== reserva.id));
    await env.RESERVAS.delete(`res:${reserva.id}`);
    console.error(e.message);
    return respuesta({ ok: false, error: 'No pudimos avisar a Oasis. Intenta de nuevo en un momento.' }, 502, request, env);
  }

  const bot = String(env.TELEGRAM_BOT_USUARIO || '').replace(/^@/, '');
  return respuesta({ ok: true, id: reserva.id, botUrl: bot ? `https://t.me/${bot}?start=${reserva.id}` : null }, 201, request, env);
}

async function cambiarEstado(env, id, estado) {
  const r = await leerReserva(env, id);
  if (!r) return null;
  r.estado = estado;
  await guardarReserva(env, r);
  const dia = await leerDia(env, r.fecha);
  const item = dia.find((x) => x.id === id);
  if (item) item.estado = estado;
  await guardarDia(env, r.fecha, dia);
  return r;
}

async function avisarCliente(env, r) {
  if (!r.clienteChat) return;
  const calc = calcularReserva(r.servicio, r.extras);
  const cuando = `${formatoFecha(r.fecha)} a las ${formatoHora(r.inicio)}`;
  const texto = r.estado === 'confirmada'
    ? `✅ ¡Tu cita en ${NEGOCIO.nombre} está confirmada!\n\n${calc.servicio.nombre}\n📅 ${cuando}\n\nTe esperamos. Si no puedes venir, avísanos con tiempo.`
    : `Tu cita del ${cuando} fue cancelada. Si quieres, puedes reservar otro horario en nuestra página.`;
  try { await telegram(env, 'sendMessage', { chat_id: r.clienteChat, text: texto }); } catch (e) { console.error(e.message); }
}

async function webhook(request, env) {
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET || !env.WEBHOOK_SECRET) {
    return new Response('no autorizado', { status: 401 });
  }
  const u = await request.json().catch(() => null);
  if (!u) return new Response('ok');

  // Botones del mensaje que le llega a Oasis
  if (u.callback_query) {
    const cb = u.callback_query;
    const chat = cb.message?.chat?.id;
    if (String(chat) !== String(env.TELEGRAM_CHAT_ID)) {
      await telegram(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'No tienes permiso.', show_alert: true }).catch(() => {});
      return new Response('ok');
    }
    const [accion, id] = String(cb.data || '').split(':');
    const nuevo = accion === 'ok' ? 'confirmada' : accion === 'no' ? 'cancelada' : null;
    const r = nuevo && /^[a-z0-9]{6}$/.test(id || '') ? await cambiarEstado(env, id, nuevo) : null;
    if (!r) {
      await telegram(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'No encontré esa reserva.' }).catch(() => {});
      return new Response('ok');
    }
    await telegram(env, 'editMessageText', {
      chat_id: chat, message_id: cb.message.message_id, text: resumenTexto(r), parse_mode: 'HTML', reply_markup: botones(r),
    }).catch((e) => console.error(e.message));
    await telegram(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: nuevo === 'confirmada' ? 'Reserva confirmada' : 'Reserva cancelada' }).catch(() => {});
    await avisarCliente(env, r);
    return new Response('ok');
  }

  // Mensajes: /start (con o sin código de reserva)
  const m = u.message;
  if (m?.text?.startsWith('/start')) {
    const id = m.text.split(/\s+/)[1];
    if (id && /^[a-z0-9]{6}$/.test(id)) {
      const r = await leerReserva(env, id);
      if (r && !r.clienteChat) {
        r.clienteChat = m.chat.id;
        await guardarReserva(env, r);
        const calc = calcularReserva(r.servicio, r.extras);
        const cuando = `${formatoFecha(r.fecha)} a las ${formatoHora(r.inicio)}`;
        const estado = r.estado === 'confirmada' ? 'Tu cita ya está confirmada ✅' : 'Oasis la revisará y te avisaré por aquí apenas la confirme.';
        await telegram(env, 'sendMessage', { chat_id: m.chat.id, text: `¡Hola ${r.nombre}! 💅\n\nRecibimos tu reserva de ${calc.servicio.nombre} para el ${cuando}.\n${estado}` }).catch(() => {});
      } else {
        await telegram(env, 'sendMessage', { chat_id: m.chat.id, text: 'Ese enlace ya fue usado o venció. Haz tu reserva en nuestra página y te avisaré por aquí.' }).catch(() => {});
      }
    } else {
      // Útil para la configuración inicial: le dice a Oasis su "chat id".
      await telegram(env, 'sendMessage', { chat_id: m.chat.id, text: `Hola, soy el bot de reservas de ${NEGOCIO.nombre}. 💅\n\nEl ID de este chat es: ${m.chat.id}` }).catch(() => {});
    }
  }
  return new Response('ok');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') {
        const origen = origenPermitido(request, env);
        return new Response(null, {
          status: 204,
          headers: origen ? {
            'Access-Control-Allow-Origin': origen, 'Vary': 'Origin',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400',
          } : {},
        });
      }
      if (url.pathname === '/api/salud') return respuesta({ ok: true, negocio: NEGOCIO.nombre }, 200, request, env);
      if (url.pathname === '/api/disponibilidad' && request.method === 'GET') return await disponibilidad(request, env);
      if (url.pathname === '/api/reservas' && request.method === 'POST') {
        // Solo desde la página autorizada (los navegadores siempre mandan Origin en POST entre sitios).
        if (!origenPermitido(request, env)) return respuesta({ ok: false, error: 'Origen no permitido.' }, 403, null, env);
        return await crearReserva(request, env);
      }
      if (url.pathname === '/api/telegram' && request.method === 'POST') return await webhook(request, env);
      return respuesta({ ok: false, error: 'No encontrado.' }, 404, request, env);
    } catch (e) {
      console.error(e && e.stack ? e.stack : e);
      return respuesta({ ok: false, error: 'Error interno.' }, 500, request, env);
    }
  },
};
