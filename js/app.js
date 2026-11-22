import {
  SERVICIOS, EXTRAS, HORARIO, DIAS, DIAS_ADELANTE, NEGOCIO,
  ahoraNegocio, sumarDias, diaSemana, formatoFecha, formatoHora, formatoPrecio, formatoDuracion,
  calcularReserva, horariosDelDia, fechaReservable, minAHora,
} from './config.js';
import { nailSet } from './nails.js';
import { API_URL } from './entorno.js';

const MODO_DEMO = !API_URL;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;

const estado = { paso: 1, servicio: null, extras: new Set(), fecha: null, hora: null, enviando: false, ultima: null };
let ticketHoras = 0;

/* ================= Arte y contenido estático ================= */

$('#heroNails').innerHTML = nailSet(['rosa', 'rosa', 'dorado', 'rosa', 'rosa'], { titulo: 'Uñas con acabado rosa espejo y una uña dorada' });

const DISENOS = [
  { nombre: 'Rosa espejo', nota: 'Efecto cromo suave, muy luminoso', estilos: ['rosa'] },
  { nombre: 'French suave', nota: 'El clásico que nunca pasa de moda', estilos: ['french'] },
  { nombre: 'Ojo de gato', nota: 'Brillo magnético con reflejo dorado', estilos: ['ojo'] },
  { nombre: 'Salvia y floral', nota: 'Tonos naturales con flores pintadas a mano', estilos: ['salvia', 'floral', 'salvia', 'floral', 'salvia'] },
  { nombre: 'Glitter dorado', nota: 'Destellos para ocasiones especiales', estilos: ['dorado'] },
  { nombre: 'Mármol y nude', nota: 'Elegancia sutil para todos los días', estilos: ['marmol', 'ombre', 'marmol', 'ombre', 'marmol'] },
];
$('#galeria').innerHTML = DISENOS.map((d) => `
  <figure class="diseno reveal">
    <div class="diseno-arte">${nailSet(d.estilos, { titulo: 'Diseño ' + d.nombre })}</div>
    <figcaption><b>${d.nombre}</b><span>${d.nota}</span></figcaption>
  </figure>`).join('');

$('#listaServicios').innerHTML = SERVICIOS.map((s) => `
  <article class="servicio reveal">
    <div class="servicio-icono"><svg class="ic" aria-hidden="true"><use href="#s-${s.icono}"/></svg></div>
    <h3>${s.nombre}</h3>
    <p>${s.desc}</p>
    <div class="servicio-meta">
      <span class="tiempo"><svg class="ic" aria-hidden="true"><use href="#i-reloj"/></svg> ${formatoDuracion(s.min)}</span>
      <span class="precio"><small>desde</small>${formatoPrecio(s.precio)}</span>
    </div>
    <button type="button" class="btn btn-claro" data-reservar="${s.id}">Reservar ${s.nombre.toLowerCase()}</button>
  </article>`).join('');

// Horario del pie, agrupando días consecutivos con el mismo horario
(function pieHorario() {
  const orden = [1, 2, 3, 4, 5, 6, 0];
  const corto = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const texto = (d) => (HORARIO[d] ? `${formatoHora(HORARIO[d][0])} – ${formatoHora(HORARIO[d][1])}` : 'Cerrado');
  const grupos = [];
  for (const d of orden) {
    const t = texto(d), g = grupos.at(-1);
    if (g && g.t === t) g.fin = d; else grupos.push({ ini: d, fin: d, t });
  }
  $('#pieHorario').innerHTML = grupos.map((g) =>
    `<li><b>${g.ini === g.fin ? corto[g.ini] : corto[g.ini] + ' – ' + corto[g.fin]}</b><span>${g.t}</span></li>`).join('');
})();
$('#anio').textContent = new Date().getFullYear();

/* ================= Cabecera, menú y animaciones ================= */

const cabecera = $('#cabecera');
const alScroll = () => cabecera.classList.toggle('scroll', scrollY > 8);
addEventListener('scroll', alScroll, { passive: true }); alScroll();

const menuBtn = $('#menuBtn');
function menu(abierto) {
  cabecera.classList.toggle('abierta', abierto);
  menuBtn.setAttribute('aria-expanded', String(abierto));
  menuBtn.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
  menuBtn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#${abierto ? 'i-cerrar' : 'i-menu'}"/></svg>`;
}
menuBtn.addEventListener('click', () => menu(!cabecera.classList.contains('abierta')));
$('#nav').addEventListener('click', (e) => { if (e.target.closest('a')) menu(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && cabecera.classList.contains('abierta')) { menu(false); menuBtn.focus(); } });

if ('IntersectionObserver' in window && !sinMovimiento) {
  const io = new IntersectionObserver((entradas) => {
    for (const en of entradas) if (en.isIntersecting) { en.target.classList.add('visto'); io.unobserve(en.target); }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach((el, i) => { el.style.transitionDelay = `${(i % 4) * 70}ms`; io.observe(el); });
} else {
  $$('.reveal').forEach((el) => el.classList.add('visto'));
}

/* ================= Reservas ================= */

const form = $('#form');
const pasos = $$('.paso');

$('#opcServicios').innerHTML = SERVICIOS.map((s) => `
  <label class="opcion">
    <input type="radio" name="servicio" value="${s.id}">
    <span class="opcion-caja">
      <span class="opcion-ico"><svg class="ic" aria-hidden="true"><use href="#s-${s.icono}"/></svg></span>
      <span class="opcion-txt"><b>${s.nombre}</b><span>${formatoDuracion(s.min)}</span></span>
      <span class="opcion-precio">${formatoPrecio(s.precio)}</span>
    </span>
  </label>`).join('');

$('#opcExtras').innerHTML = EXTRAS.map((x) => `
  <label class="extra">
    <input type="checkbox" name="extras" value="${x.id}">
    <span class="extra-caja">${x.nombre} <small>+${formatoPrecio(x.precio)}</small></span>
  </label>`).join('');

function calculo() { return estado.servicio ? calcularReserva(estado.servicio, [...estado.extras]) : null; }

function pintarResumen() {
  const c = calculo();
  const vacio = '<dd class="vacio">Aún sin elegir</dd>';
  $('#resumen').innerHTML = `
    <div><dt>Servicio</dt>${c ? `<dd>${c.servicio.nombre}${c.extras.length ? `<small>+ ${c.extras.map((e) => e.nombre).join(', ')}</small>` : ''}</dd>` : vacio}</div>
    <div><dt>Duración</dt>${c ? `<dd>${formatoDuracion(c.min)}</dd>` : vacio}</div>
    <div><dt>Día</dt>${estado.fecha ? `<dd>${cap(formatoFecha(estado.fecha))}</dd>` : vacio}</div>
    <div><dt>Hora</dt>${estado.hora !== null && c ? `<dd>${formatoHora(estado.hora)} – ${formatoHora(estado.hora + c.min)}</dd>` : vacio}</div>
    <div class="total"><dt>Total estimado</dt><dd>${c ? formatoPrecio(c.precio) : '—'}</dd></div>`;
}

function mostrarError(id, msg) {
  const el = $('#' + id);
  el.textContent = msg || '';
  el.hidden = !msg;
}
const limpiarErrores = () => { ['err1', 'err2', 'err3'].forEach((id) => mostrarError(id, '')); };

function textoBoton() {
  $('#btnSiguiente').innerHTML = estado.paso === 3
    ? 'Confirmar reserva <svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>'
    : 'Continuar <svg class="ic" aria-hidden="true"><use href="#i-flecha"/></svg>';
}

function ir(n, { enfocar = true } = {}) {
  estado.paso = n;
  pasos.forEach((p) => { p.hidden = Number(p.dataset.paso) !== n; });
  $$('#stepper li').forEach((li) => {
    const k = Number(li.dataset.paso);
    li.classList.toggle('activo', k === n);
    li.classList.toggle('hecho', k < n);
    if (k === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  $('#btnAtras').hidden = n === 1;
  textoBoton();
  limpiarErrores();
  if (n === 2) { pintarCalendario(); if (estado.fecha) cargarHoras(); else $('#horas').innerHTML = ''; }
  if (enfocar) {
    const t = $(`#t${n}`);
    const top = $('#bookMain').getBoundingClientRect().top;
    if (top < 0 || top > innerHeight * 0.5) $('#bookMain').scrollIntoView({ behavior: sinMovimiento ? 'auto' : 'smooth', block: 'start' });
    t.focus({ preventScroll: true });
  }
}

/* ----- Paso 1 ----- */
form.addEventListener('change', (e) => {
  if (e.target.name === 'servicio') { estado.servicio = e.target.value; }
  if (e.target.name === 'extras') { e.target.checked ? estado.extras.add(e.target.value) : estado.extras.delete(e.target.value); }
  if (e.target.name === 'servicio' || e.target.name === 'extras') {
    estado.hora = null; // la duración cambió: hay que volver a elegir hora
    mostrarError('err1', '');
    pintarResumen();
  }
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-reservar]');
  if (!b) return;
  const radio = form.querySelector(`input[name="servicio"][value="${b.dataset.reservar}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
  location.hash = '#reservar';
  ir(1, { enfocar: false });
  $('#bookMain').scrollIntoView({ behavior: sinMovimiento ? 'auto' : 'smooth', block: 'start' });
});

/* ----- Paso 2: calendario y horas ----- */
function pintarCalendario() {
  const hoy = ahoraNegocio().fecha;
  const ultimo = sumarDias(hoy, DIAS_ADELANTE);
  const dow = (diaSemana(hoy) + 6) % 7; // lunes = 0
  const inicio = sumarDias(hoy, -dow);
  let html = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((l) => `<span class="cal-dia-semana" aria-hidden="true">${l}</span>`).join('');
  for (let f = inicio; ; f = sumarDias(f, 1)) {
    const fuera = f < hoy || f > ultimo;
    if (f > ultimo && (new Date(f + 'T12:00:00Z').getUTCDay() === 1)) break;
    if (fuera) { html += '<span class="dia vacio" aria-hidden="true"></span>'; continue; }
    const abierto = fechaReservable(f);
    const n = Number(f.slice(8));
    const pequeno = f === hoy ? 'hoy' : n === 1 ? new Intl.DateTimeFormat('es-CO', { month: 'short', timeZone: 'UTC' }).format(new Date(f + 'T12:00:00Z')).replace('.', '') : '';
    html += `<button type="button" class="dia${f === hoy ? ' hoy' : ''}" data-fecha="${f}" aria-pressed="${estado.fecha === f}" ${abierto ? '' : 'disabled'}
      aria-label="${formatoFecha(f)}${abierto ? '' : ', cerrado'}">${n}${pequeno ? `<small>${pequeno}</small>` : ''}</button>`;
  }
  $('#cal').innerHTML = html;
  const a = new Intl.DateTimeFormat('es-CO', { month: 'long', timeZone: 'UTC' });
  const m1 = a.format(new Date(hoy + 'T12:00:00Z')), m2 = a.format(new Date(ultimo + 'T12:00:00Z'));
  $('#calMes').textContent = cap(m1 === m2 ? `${m1} ${hoy.slice(0, 4)}` : `${m1} – ${m2} ${ultimo.slice(0, 4)}`);
}

$('#cal').addEventListener('click', (e) => {
  const b = e.target.closest('.dia[data-fecha]');
  if (!b || b.disabled) return;
  estado.fecha = b.dataset.fecha;
  estado.hora = null;
  $$('#cal .dia[data-fecha]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  mostrarError('err2', '');
  pintarResumen();
  cargarHoras();
});

// --- Disponibilidad: real (Worker) o de demostración (navegador) ---
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function reservasDemo() { try { return JSON.parse(localStorage.getItem('oasis-demo') || '[]'); } catch { return []; } }

function ocupadosDemo(fecha) {
  const [abre, cierra] = HORARIO[diaSemana(fecha)] || [0, 0];
  let h = hash(fecha), lista = [];
  for (let i = 0; i < 2; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const ini = abre + (h % Math.max(1, Math.floor((cierra - abre - 120) / 30))) * 30;
    lista.push({ inicio: ini, fin: ini + (i ? 90 : 60) });
  }
  return lista.concat(reservasDemo().filter((r) => r.fecha === fecha).map((r) => ({ inicio: r.inicio, fin: r.fin })));
}

async function ocupadosDe(fecha) {
  if (MODO_DEMO) { await new Promise((r) => setTimeout(r, 260)); return ocupadosDemo(fecha); }
  const r = await fetch(`${API_URL}/api/disponibilidad?fecha=${fecha}`);
  if (!r.ok) throw new Error('disponibilidad ' + r.status);
  return (await r.json()).ocupados || [];
}

async function cargarHoras() {
  const c = calculo();
  const cont = $('#horas'), est = $('#estadoHoras');
  if (!c || !estado.fecha) return;
  const ticket = ++ticketHoras;
  cont.innerHTML = '';
  est.innerHTML = '<span class="cargando">Buscando horarios libres…</span>';
  try {
    const ocupados = await ocupadosDe(estado.fecha);
    if (ticket !== ticketHoras) return; // llegó una respuesta vieja
    const lista = horariosDelDia(estado.fecha, c.min, ocupados);
    const libres = lista.filter((h) => h.libre).length;
    cont.innerHTML = lista.map((h) => `
      <button type="button" class="hora" data-min="${h.min}" aria-pressed="${estado.hora === h.min}" ${h.libre ? '' : 'disabled'}
        aria-label="${formatoHora(h.min)}${h.libre ? '' : ', ocupado'}">${formatoHora(h.min)}</button>`).join('');
    est.textContent = libres
      ? `${libres} ${libres === 1 ? 'horario libre' : 'horarios libres'} para ${formatoFecha(estado.fecha)} (tu servicio dura ${formatoDuracion(c.min)}).`
      : 'No quedan horarios libres este día. Prueba con otro, por favor.';
  } catch {
    if (ticket !== ticketHoras) return;
    est.innerHTML = 'No pudimos cargar los horarios. <button type="button" class="btn btn-claro btn-sm" id="reintentar">Reintentar</button>';
    $('#reintentar').addEventListener('click', cargarHoras);
  }
}

$('#horas').addEventListener('click', (e) => {
  const b = e.target.closest('.hora');
  if (!b || b.disabled) return;
  estado.hora = Number(b.dataset.min);
  $$('#horas .hora').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  mostrarError('err2', '');
  pintarResumen();
});

/* ----- Paso 3: datos y envío ----- */
const contactoValido = (v) => /^\d{7,15}$/.test(v.trim().replace(/[\s()+-]/g, ''));

function validarDatos() {
  const errores = [];
  const nombre = $('#nombre').value.trim(), contacto = $('#contacto').value.trim();
  if (nombre.length < 2) errores.push(['nombre', 'Escribe tu nombre.']);
  if (!contactoValido(contacto)) errores.push(['contacto', contacto ? 'Revisa tu número: escríbelo con 10 dígitos, por ejemplo 300 123 4567.' : 'Escribe tu número de WhatsApp o celular para confirmarte la cita.']);
  ['nombre', 'contacto'].forEach((id) => {
    const falla = errores.find((x) => x[0] === id);
    const input = $('#' + id), msg = $('#e-' + id);
    input.setAttribute('aria-invalid', String(!!falla));
    msg.textContent = falla ? falla[1] : '';
    msg.hidden = !falla;
  });
  const res = $('#resErrores');
  if (errores.length) {
    res.innerHTML = `<b>Revisa ${errores.length === 1 ? 'este campo' : 'estos campos'}:</b> ` +
      errores.map(([id, m]) => `<a href="#${id}">${esc(m)}</a>`).join(' · ');
    res.hidden = false;
    res.focus();
    res.querySelectorAll('a').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); $(a.getAttribute('href')).focus(); }));
  } else res.hidden = true;
  return errores.length === 0;
}
['nombre', 'contacto'].forEach((id) => $('#' + id).addEventListener('input', () => {
  $('#' + id).setAttribute('aria-invalid', 'false'); $('#e-' + id).hidden = true;
}));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (estado.enviando) return;
  limpiarErrores();
  if (estado.paso === 1) {
    if (!estado.servicio) return mostrarError('err1', 'Elige un servicio para continuar.');
    return ir(2);
  }
  if (estado.paso === 2) {
    if (!estado.fecha) return mostrarError('err2', 'Elige el día que prefieres.');
    if (estado.hora === null) return mostrarError('err2', 'Elige una hora disponible.');
    return ir(3);
  }
  if (!validarDatos()) return;
  await enviar();
});
$('#btnAtras').addEventListener('click', () => ir(Math.max(1, estado.paso - 1)));

async function enviar() {
  const c = calculo();
  const datos = {
    servicio: estado.servicio, extras: [...estado.extras], fecha: estado.fecha, hora: minAHora(estado.hora),
    nombre: $('#nombre').value.trim(), contacto: $('#contacto').value.trim(), notas: $('#notas').value.trim(),
    web: form.elements.web.value,
  };
  const btn = $('#btnSiguiente');
  estado.enviando = true; btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    let id = 'DEMO';
    if (MODO_DEMO) {
      await new Promise((r) => setTimeout(r, 700));
      const guardadas = reservasDemo();
      guardadas.push({ fecha: datos.fecha, inicio: estado.hora, fin: estado.hora + c.min });
      try { localStorage.setItem('oasis-demo', JSON.stringify(guardadas.slice(-40))); } catch { /* sin almacenamiento: no pasa nada */ }
    } else {
      const r = await fetch(`${API_URL}/api/reservas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        if (r.status === 409 || j.campo === 'hora' || j.campo === 'fecha') {
          estado.hora = null; pintarResumen(); ir(2);
          mostrarError('err2', j.error || 'Ese horario ya no está disponible. Elige otro, por favor.');
          return;
        }
        if (j.campo === 'servicio') { ir(1); mostrarError('err1', j.error); return; }
        mostrarError('err3', j.error || 'No pudimos enviar tu reserva. Intenta de nuevo.');
        return;
      }
      id = j.id;
    }
    exito({ ...datos, id }, c);
  } catch {
    mostrarError('err3', 'No hay conexión con el servidor. Revisa tu internet e inténtalo otra vez; tus datos siguen aquí.');
  } finally {
    estado.enviando = false; btn.disabled = false;
    textoBoton();
  }
}

/* ----- Éxito ----- */
function exito(d, c) {
  estado.ultima = { d, c, inicio: estado.hora };
  form.hidden = true; $('#stepper').hidden = true; $('#exito').hidden = false;
  $('#exitoSub').textContent = MODO_DEMO
    ? 'Modo demostración: esta reserva es solo de prueba y no se envió a nadie.'
    : `Gracias, ${d.nombre.split(' ')[0]}. Oasis recibió tu reserva y te escribirá a tu WhatsApp para confirmarla.`;
  $('#exitoDatos').innerHTML = `
    <div><dt>Servicio</dt><dd>${esc(c.servicio.nombre)}</dd></div>
    <div><dt>Día</dt><dd>${esc(cap(formatoFecha(d.fecha)))}</dd></div>
    <div><dt>Hora</dt><dd>${formatoHora(estado.hora)}</dd></div>
    <div><dt>Total estimado</dt><dd>${formatoPrecio(c.precio)}</dd></div>`;
  pasosScrollExito();
}
function pasosScrollExito() {
  $('#bookMain').scrollIntoView({ behavior: sinMovimiento ? 'auto' : 'smooth', block: 'start' });
  $('#tExito').focus({ preventScroll: true });
}

$('#btnOtra').addEventListener('click', () => {
  form.reset(); form.hidden = false; $('#stepper').hidden = false; $('#exito').hidden = true;
  Object.assign(estado, { servicio: null, extras: new Set(), fecha: null, hora: null, ultima: null });
  ['nombre', 'contacto'].forEach((id) => { $('#' + id).setAttribute('aria-invalid', 'false'); $('#e-' + id).hidden = true; });
  $('#resErrores').hidden = true;
  pintarResumen(); ir(1);
});

// "Guardar en mi calendario": archivo .ics (la hora se convierte de Colombia a UTC)
$('#btnIcs').addEventListener('click', () => {
  const { d, c, inicio } = estado.ultima;
  const base = new Date(d.fecha + 'T00:00:00Z').getTime() - NEGOCIO.desfaseHoras * 3600000;
  const fmt = (m) => new Date(base + m * 60000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Oasis//Reservas//ES', 'BEGIN:VEVENT',
    `UID:${d.id}-${d.fecha}@oasis`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${fmt(inicio)}`, `DTEND:${fmt(inicio + c.min)}`,
    `SUMMARY:${c.servicio.nombre} · ${NEGOCIO.nombre}`,
    `DESCRIPTION:Reserva en ${NEGOCIO.nombre}. Total estimado ${formatoPrecio(c.precio)}.`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Tu cita en Oasis es en 2 horas', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  a.download = 'cita-oasis.ics';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

pintarResumen();
ir(1, { enfocar: false });
