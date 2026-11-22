# Oasis · Estudio de uñas

Página web de reservas para **Oasis**, un estudio de uñas. Diseño elegante (claro y oscuro automático según el celular o el computador de quien la visita), catálogo de servicios, galería de diseños y **reservas en línea**: la clienta elige servicio, día y hora, y la reserva le llega a la dueña **por Telegram** con botones para *Confirmar* o *Cancelar*.

> La página pública **no menciona Telegram**: es una herramienta interna de Oasis. La clienta solo deja su nombre y su WhatsApp.

Hecha por [Ángel Automatizaciones](https://angel-automatizaciones.lovable.app/).

## Qué hay en el repositorio

| Ruta | Qué es |
|---|---|
| `index.html`, `css/`, `js/` | La página (HTML/CSS/JS puro, sin instalar nada). |
| `js/config.js` | **Servicios, precios, extras y horarios.** Es lo único que hay que editar para cambiar el negocio. |
| `js/entorno.js` | Dirección del Worker. Vacía = **modo demostración**. |
| `js/nails.js` | Las uñas de la galería, dibujadas en vectores (se pueden reemplazar por fotos reales). |
| `worker/` | Servicio en Cloudflare que recibe las reservas, evita que dos clientas tomen la misma hora y avisa por Telegram. |

## Probarla en tu computador

```bash
python -m http.server 5180
```

Abre http://localhost:5180. Sin Worker conectado funciona en **modo demostración**: se puede hacer todo el recorrido de reserva (los horarios ocupados se simulan y la reserva se recuerda solo en ese navegador), pero no se envía nada a nadie.

## Publicarla (gratis)

En GitHub: **Settings → Pages → Deploy from a branch → `main` / `(root)`**. Quedará en `https://angelvillota29-bot.github.io/oasis/`. Sirve igual en Cloudflare Pages o Netlify (carpeta raíz, sin build).

## Conectar las reservas con Telegram

Hacen falta (una sola vez) una cuenta de Cloudflare y la app de Telegram. Todo es gratis para este volumen.

1. **Crear el bot.** En Telegram habla con **@BotFather** → `/newbot` → elige nombre y usuario. Guarda el **token** que te da (es secreto).
2. **Obtener el chat de Oasis.** Que la dueña abra el bot y le escriba `/start`. El bot responde con *"El ID de este chat es: 123456789"* (después de desplegar el Worker, paso 5). Ese número es `TELEGRAM_CHAT_ID`.
3. **Crear el almacén de reservas** (desde la carpeta `worker/`):
   ```bash
   npx wrangler kv namespace create RESERVAS
   ```
   Copia el `id` que muestra dentro de `worker/wrangler.toml` (línea `id = "..."`). Allí mismo ajusta `ALLOWED_ORIGIN` con la dirección de la página y `TELEGRAM_BOT_USUARIO` con el usuario del bot (sin @).
4. **Cargar los secretos:**
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put WEBHOOK_SECRET      # inventa una clave larga (letras y números)
   npx wrangler secret put TELEGRAM_CHAT_ID    # en el paso 2 aún no lo tienes: pon 0 y vuelve a cargarlo después
   ```
5. **Desplegar:** `npx wrangler deploy` (te devuelve la dirección `https://oasis-reservas.<usuario>.workers.dev`).
6. **Enlazar Telegram con el Worker** (reemplaza los valores):
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<DIRECCION_DEL_WORKER>/api/telegram&secret_token=<WEBHOOK_SECRET>
   ```
   Ábrelo en el navegador: debe responder `"ok":true`. Ahora sí escribe `/start` al bot, copia el ID y repite el último `secret put TELEGRAM_CHAT_ID`.
7. **Conectar la página:** en `js/entorno.js` pon `export const API_URL = 'https://oasis-reservas.<usuario>.workers.dev';` y sube el cambio.

Cada reserva le llega a Oasis así: nombre, WhatsApp (con enlace directo para escribirle), servicio y extras, día y hora, duración, total y notas, con los botones **✅ Confirmar** / **❌ Cancelar**. Al cancelar, el horario se libera solo.

> Opcional: el Worker también permite que la clienta reciba el aviso de confirmación en su propio Telegram (enlace `t.me/<bot>?start=<id>` que devuelve la API). La página no lo muestra; si algún día se quiere, solo hay que ponerlo en la pantalla de reserva recibida.

## Personalizar

- **Servicios, precios, extras y horarios:** `js/config.js` (los valores actuales son **de ejemplo**).
- **Fotos reales:** reemplaza las uñas dibujadas de la galería (`js/nails.js` / `DISENOS` en `js/app.js`) por `<img>` con trabajos de Oasis.
- **Textos, dirección y redes:** `index.html`. El pie de página dice que la dirección se envía al confirmar; cámbialo si Oasis prefiere mostrarla.
- **Colores y tipografías:** variables al inicio de `css/styles.css` (claro y oscuro).

## Pruebas

```bash
npm test
```
Ejecuta 17 grupos de pruebas del Worker con un Telegram y un almacén simulados: validaciones, choques de horario, dueña vs. terceros en los botones, aviso a la clienta, reserva que se deshace si Telegram falla, límite de intentos, anti-bots y escape de HTML.

## Notas técnicas

- Horario y fechas siempre en hora de Colombia (UTC-5).
- Los datos de reservas se borran solos a los 120 días.
- El almacén (KV de Cloudflare) no es transaccional: si dos personas reservaran el mismo segundo exacto podría pasar una doble reserva; para una sola profesional es muy improbable. Si el negocio crece, el siguiente paso es pasar a D1 o a un Durable Object.
- El Worker solo acepta reservas desde la página autorizada (`ALLOWED_ORIGIN`), limita 8 intentos por hora por conexión y descarta bots con un campo trampa.
