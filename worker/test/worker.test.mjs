// Pruebas del Worker con un KV falso y un Telegram falso. Ejecutar:  node worker/test/worker.test.mjs
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { ahoraNegocio, sumarDias, diaSemana } from '../../js/config.js';

class KVFalso {
  constructor() { this.m = new Map(); }
  async get(k, tipo) { const v = this.m.get(k); return v === undefined ? null : tipo === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
}

const llamadasTelegram = [];
let telegramFalla = false;
globalThis.fetch = async (url, init) => {
  const metodo = String(url).split('/').pop();
  const cuerpo = JSON.parse(init.body);
  llamadasTelegram.push({ metodo, cuerpo });
  if (telegramFalla) return new Response(JSON.stringify({ ok: false, description: 'caído' }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
};

const ORIGEN = 'https://angelvillota29-bot.github.io';
const env = {
  RESERVAS: new KVFalso(), ALLOWED_ORIGIN: ORIGEN, TELEGRAM_BOT_USUARIO: 'oasis_demo_bot',
  TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '777', WEBHOOK_SECRET: 'secreto',
};

// próximo día hábil con al menos 2 días de margen (evita depender de la hora actual)
let fecha = sumarDias(ahoraNegocio().fecha, 2);
while (diaSemana(fecha) === 0) fecha = sumarDias(fecha, 1);

const post = (ruta, cuerpo, cab = {}, ip = '1.1.1.1') =>
  worker.fetch(new Request('https://api.test' + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGEN, 'CF-Connecting-IP': ip, ...cab }, body: JSON.stringify(cuerpo) }), env);
const get = (ruta) => worker.fetch(new Request('https://api.test' + ruta, { headers: { Origin: ORIGEN } }), env);

const base = { servicio: 'semipermanente', extras: ['nail-art'], fecha, hora: '10:00', nombre: 'Camila Torres', contacto: '@camila_t', notas: 'Quiero tonos nude' };
let pasadas = 0;
const ok = (nombre) => { pasadas++; console.log('  ✓', nombre); };

// 1. salud y CORS
let r = await get('/api/salud');
assert.equal(r.status, 200);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGEN);
ok('salud + CORS');

// 2. origen no permitido no puede reservar
r = await worker.fetch(new Request('https://api.test/api/reservas', { method: 'POST', headers: { Origin: 'https://malo.com' }, body: JSON.stringify(base) }), env);
assert.equal(r.status, 403);
ok('origen ajeno rechazado');

// 3. validaciones
for (const [cambio, campo] of [
  [{ servicio: 'x' }, 'servicio'], [{ extras: ['nada'] }, 'servicio'], [{ fecha: '2020-01-01' }, 'fecha'],
  [{ hora: '10:15' }, 'hora'], [{ hora: '17:30' }, 'hora'], [{ nombre: ' ' }, 'nombre'], [{ contacto: 'ab' }, 'contacto'],
]) {
  r = await post('/api/reservas', { ...base, ...cambio }, {}, '9.9.9.' + Math.random());
  const j = await r.json();
  assert.equal(r.status, 400, JSON.stringify(cambio));
  assert.equal(j.campo, campo, JSON.stringify(cambio));
}
assert.equal(llamadasTelegram.length, 0);
ok('validaciones (servicio, extras, fecha, hora, nombre, contacto)');

// 4. domingo cerrado
let dom = sumarDias(ahoraNegocio().fecha, 1); while (diaSemana(dom) !== 0) dom = sumarDias(dom, 1);
r = await post('/api/reservas', { ...base, fecha: dom }, {}, '8.8.8.8');
assert.equal((await r.json()).campo, 'fecha');
ok('domingo cerrado');

// 5. reserva correcta → Telegram con botones
r = await post('/api/reservas', base);
let j = await r.json();
assert.equal(r.status, 201);
assert.match(j.id, /^[a-z0-9]{6}$/);
assert.equal(j.botUrl, `https://t.me/oasis_demo_bot?start=${j.id}`);
const id = j.id;
const envio = llamadasTelegram.at(-1);
assert.equal(envio.metodo, 'sendMessage');
assert.equal(envio.cuerpo.chat_id, '777');
assert.match(envio.cuerpo.text, /Camila Torres/);
assert.match(envio.cuerpo.text, /@camila_t/);
assert.match(envio.cuerpo.text, /10:00 a\. m\. – 11:15 a\. m\./); // 60 + 15 min
assert.match(envio.cuerpo.text, /\$70\.000/);
assert.deepEqual(envio.cuerpo.reply_markup.inline_keyboard[0].map((b) => b.callback_data), [`ok:${id}`, `no:${id}`]);
ok('reserva creada y avisada por Telegram (texto, duración, precio, botones)');

// 6. el horario queda ocupado y se ve en disponibilidad (sin datos personales)
j = await (await get(`/api/disponibilidad?fecha=${fecha}`)).json();
assert.deepEqual(j.ocupados, [{ inicio: 600, fin: 675 }]);
assert.ok(!JSON.stringify(j).includes('Camila'));
ok('disponibilidad sin datos personales');

// 7. choque de horario
r = await post('/api/reservas', { ...base, hora: '10:30', nombre: 'Otra' }, {}, '2.2.2.2');
assert.equal(r.status, 409);
r = await post('/api/reservas', { ...base, hora: '09:30', extras: [], servicio: 'acrilicas', nombre: 'Otra' }, {}, '2.2.2.2'); // 9:30–11:30 choca
assert.equal(r.status, 409);
r = await post('/api/reservas', { ...base, hora: '11:00', nombre: 'Otra', contacto: '3001234567' }, {}, '2.2.2.2'); // 11:00 ya es libre (termina 11:15 → choca)
assert.equal(r.status, 409);
r = await post('/api/reservas', { ...base, hora: '11:30', nombre: 'Otra', contacto: '3001234567' }, {}, '2.2.2.2');
assert.equal(r.status, 201);
ok('choques de horario rechazados, horario libre aceptado');

// 8. webhook: sin secreto → 401
r = await post('/api/telegram', { callback_query: {} }, {});
assert.equal(r.status, 401);
ok('webhook exige secreto');

const hook = (u) => post('/api/telegram', u, { 'X-Telegram-Bot-Api-Secret-Token': 'secreto' });

// 9. la clienta se enlaza con /start <id>
llamadasTelegram.length = 0;
await hook({ message: { text: `/start ${id}`, chat: { id: 555 } } });
assert.equal(llamadasTelegram[0].cuerpo.chat_id, 555);
assert.match(llamadasTelegram[0].cuerpo.text, /Camila/);
ok('clienta enlazada con /start');

// 10. alguien que NO es Oasis no puede confirmar
llamadasTelegram.length = 0;
await hook({ callback_query: { id: 'c1', data: `ok:${id}`, message: { chat: { id: 999 }, message_id: 5 } } });
assert.equal(llamadasTelegram[0].metodo, 'answerCallbackQuery');
assert.equal(JSON.parse(await env.RESERVAS.get(`res:${id}`)).estado, 'pendiente');
ok('un tercero no puede confirmar');

// 11. Oasis confirma → mensaje editado + aviso a la clienta
llamadasTelegram.length = 0;
await hook({ callback_query: { id: 'c2', data: `ok:${id}`, message: { chat: { id: 777 }, message_id: 5 } } });
assert.equal(JSON.parse(await env.RESERVAS.get(`res:${id}`)).estado, 'confirmada');
const metodos = llamadasTelegram.map((x) => x.metodo);
assert.deepEqual(metodos, ['editMessageText', 'answerCallbackQuery', 'sendMessage']);
assert.match(llamadasTelegram[0].cuerpo.text, /Confirmada/);
assert.equal(llamadasTelegram[2].cuerpo.chat_id, 555);
assert.match(llamadasTelegram[2].cuerpo.text, /confirmada/);
ok('confirmar edita el mensaje y avisa a la clienta');

// 12. cancelar libera el horario
await hook({ callback_query: { id: 'c3', data: `no:${id}`, message: { chat: { id: 777 }, message_id: 5 } } });
j = await (await get(`/api/disponibilidad?fecha=${fecha}`)).json();
assert.deepEqual(j.ocupados, [{ inicio: 690, fin: 765 }]); // solo queda la de las 11:30
ok('cancelar libera el horario');

// 13. /start sin código muestra el chat id (configuración inicial)
llamadasTelegram.length = 0;
await hook({ message: { text: '/start', chat: { id: 4242 } } });
assert.match(llamadasTelegram[0].cuerpo.text, /4242/);
ok('/start sin código devuelve el chat id');

// 14. si Telegram falla, no queda reserva fantasma
telegramFalla = true;
r = await post('/api/reservas', { ...base, hora: '15:00', nombre: 'Fallida' }, {}, '3.3.3.3');
assert.equal(r.status, 502);
telegramFalla = false;
j = await (await get(`/api/disponibilidad?fecha=${fecha}`)).json();
assert.equal(j.ocupados.length, 1);
ok('Telegram caído → la reserva se deshace');

// 15. límite de intentos por IP
let ultimo;
for (let i = 0; i < 10; i++) ultimo = await post('/api/reservas', { ...base, nombre: ' ' }, {}, '4.4.4.4');
assert.equal(ultimo.status, 429);
ok('límite de intentos por IP');

// 16. campo trampa (bots)
const antes = llamadasTelegram.length;
r = await post('/api/reservas', { ...base, web: 'http://spam' }, {}, '5.5.5.5');
assert.equal(llamadasTelegram.length, antes);
ok('bots (honeypot) ignorados');

// 17. HTML escapado en Telegram
llamadasTelegram.length = 0;
r = await post('/api/reservas', { ...base, hora: '14:00', nombre: '<b>Hack</b>', notas: 'a & b <i>', contacto: '3001112233' }, {}, '6.6.6.6');
assert.equal(r.status, 201);
assert.ok(llamadasTelegram[0].cuerpo.text.includes('&lt;b&gt;Hack&lt;/b&gt;'));
assert.ok(!llamadasTelegram[0].cuerpo.text.includes('<b>Hack'));
assert.ok(llamadasTelegram[0].cuerpo.text.includes('href="https://wa.me/573001112233"')); // celular → enlace a WhatsApp
ok('HTML del cliente escapado');

console.log(`\n${pasadas} grupos de pruebas OK`);
