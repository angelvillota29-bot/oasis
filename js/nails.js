// Uñas dibujadas en SVG (sin fotos): cada diseño es un acabado distinto.
// nailSet(['rosa','french',...]) devuelve un <svg> con 5 uñas en abanico.

let contador = 0;

const FORMA = 'M30 3 C43 3 53 32 55 62 C56 83 47 97 30 97 C13 97 4 83 5 62 C7 32 17 3 30 3 Z';

function semilla(n) {
  let s = n * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

// Cada acabado devuelve { defs, fill, extra } para una uña con identificador `u`.
const ACABADOS = {
  rosa: (u) => ({
    defs: `<linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7DCD4"/><stop offset=".35" stop-color="#E9AB9D"/><stop offset=".55" stop-color="#FCEEE8"/><stop offset=".8" stop-color="#D98F80"/><stop offset="1" stop-color="#F2C4B8"/></linearGradient>`,
    fill: `url(#g${u})`,
  }),
  french: (u) => ({
    fill: '#F4DED2',
    extra: `<path d="M0 -2 H60 V30 C46 20 14 20 0 30 Z" fill="#FFFDFB"/>`,
  }),
  salvia: () => ({ fill: '#A8BDA1' }),
  terracota: () => ({ fill: '#C4715E' }),
  vino: () => ({ fill: '#7B2F3B' }),
  lavanda: () => ({ fill: '#C9B7E4' }),
  ojo: (u) => ({
    defs: `<linearGradient id="g${u}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#1F2E27"/><stop offset=".38" stop-color="#2A3D33"/><stop offset=".5" stop-color="#D9B56A"/><stop offset=".62" stop-color="#2A3D33"/><stop offset="1" stop-color="#1F2E27"/></linearGradient>`,
    fill: `url(#g${u})`,
  }),
  dorado: (u) => {
    const r = semilla(u + 7);
    let puntos = '';
    for (let i = 0; i < 26; i++) {
      const x = 6 + r() * 48, y = 6 + r() * 88, t = 0.7 + r() * 1.6;
      puntos += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${t.toFixed(1)}" fill="${i % 3 ? '#D9B56A' : '#FFF3D6'}" opacity="${(0.55 + r() * 0.45).toFixed(2)}"/>`;
    }
    return { fill: '#F3DACB', extra: puntos };
  },
  marmol: (u) => ({
    fill: '#F7F3EE',
    extra: `<path d="M-4 22 C14 18 20 40 34 36 S52 44 66 38" stroke="#B9AFA6" stroke-width="1.6" fill="none" opacity=".75"/>
            <path d="M-4 56 C10 62 22 48 34 56 S54 70 66 60" stroke="#CFC4B9" stroke-width="2.4" fill="none" opacity=".8"/>
            <path d="M8 84 C20 76 30 90 46 80" stroke="#A89E95" stroke-width="1.2" fill="none" opacity=".7"/>`,
  }),
  ombre: (u) => ({
    defs: `<linearGradient id="g${u}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#F3C8BC"/><stop offset=".55" stop-color="#F6DDD3"/><stop offset="1" stop-color="#FFF8F3"/></linearGradient>`,
    fill: `url(#g${u})`,
  }),
  floral: () => ({
    fill: '#F4E1D6',
    extra: [[30, 34, '#C4715E'], [24, 58, '#A8BDA1'], [38, 72, '#C4715E']].map(([x, y, c]) =>
      [0, 72, 144, 216, 288].map((a) => `<ellipse cx="${x}" cy="${y - 4}" rx="2.6" ry="4.4" fill="${c}" transform="rotate(${a} ${x} ${y})"/>`).join('') +
      `<circle cx="${x}" cy="${y}" r="1.7" fill="#FFF3D6"/>`).join(''),
  }),
};

function unaUna(estilo, tx, ty, giro, escala) {
  const u = ++contador;
  const a = (ACABADOS[estilo] || ACABADOS.rosa)(u);
  return `
  <g transform="translate(${tx} ${ty}) rotate(${giro} 30 97) scale(${escala})">
    <defs>${a.defs || ''}<clipPath id="c${u}"><path d="${FORMA}"/></clipPath></defs>
    <ellipse cx="30" cy="100" rx="24" ry="3.4" fill="#2B2420" opacity=".12"/>
    <path d="${FORMA}" fill="${a.fill}"/>
    <g clip-path="url(#c${u})">${a.extra || ''}</g>
    <path d="M14 34 C11 52 11 66 15 80" stroke="#fff" stroke-width="3.2" stroke-linecap="round" fill="none" opacity=".5"/>
    <path d="M40 16 C44 22 46 28 47 34" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none" opacity=".35"/>
    <path d="${FORMA}" fill="none" stroke="#2B2420" stroke-opacity=".1" stroke-width="1"/>
  </g>`;
}

// Cinco uñas: meñique, anular, medio, índice, pulgar (largos y giros distintos para que parezca una mano).
const DISPOSICION = [
  { x: 6, y: 62, giro: -12, e: 0.8 },
  { x: 70, y: 22, giro: -5, e: 0.94 },
  { x: 136, y: 4, giro: 0, e: 1 },
  { x: 202, y: 20, giro: 5, e: 0.95 },
  { x: 264, y: 74, giro: 12, e: 0.84 },
];

export function nailSet(estilos, { titulo = '', clase = '' } = {}) {
  const lista = Array.isArray(estilos) ? estilos : Array(5).fill(estilos);
  const piezas = DISPOSICION.map((d, i) => unaUna(lista[i % lista.length], d.x, d.y, d.giro, d.e)).join('');
  return `<svg class="${clase}" viewBox="0 0 330 205" role="img" aria-label="${titulo}" xmlns="http://www.w3.org/2000/svg">${piezas}</svg>`;
}
