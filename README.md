# Oficio Cerca

Web para que profesionales de oficios (plomero/fontanero, gasista, electricista, cerrajero…) publiquen su perfil con su **radio de desplazamiento**, y los clientes encuentren a quienes **realmente llegan hasta su ubicación**, vean reseñas y les contacten directamente.

## Arrancar con Docker

```powershell
Expand-Archive .\oficio-cerca.zip -DestinationPath .
cd .\oficio-cerca
docker compose up --build -d
```

Abre http://localhost:3080

La primera vez se cargan ~36 profesionales de ejemplo alrededor de Madrid, con reseñas.

| Cuenta de prueba | Contraseña | Qué ver |
|---|---|---|
| `cliente@demo.com` | `demo1234` | Cliente con una conversación y una propuesta de precio pendiente |
| `plomero@demo.com` | `demo1234` | Profesional: editar perfil, radio en el mapa, responder mensajes y reseñas |

Comandos útiles:

```powershell
docker compose logs -f            # ver logs
docker compose down               # parar
docker compose down -v            # parar y BORRAR la base de datos (vuelve a sembrar datos demo)
```

Para sembrar los datos demo en otra ciudad, cambia `SEED_LAT` / `SEED_LNG` en `docker-compose.yml` y ejecuta `docker compose down -v; docker compose up --build -d`.

## Qué incluye

**Clientes**
- Búsqueda por oficio + ubicación (escribir dirección, botón "Mi ubicación" del navegador o clic en el mapa).
- Solo aparecen profesionales cuyo círculo de desplazamiento cubre tu ubicación.
- Filtros: valoración mínima, urgencias 24h, presupuesto gratis, con seguro, palabra clave. Orden: cercanía, valoración, nº reseñas, precio.
- Mapa con los profesionales; al pasar por una tarjeta se dibuja su radio de acción.
- Perfil completo: precio/hora, coste de desplazamiento, experiencia, horario, licencia/matrícula, seguro RC, factura, formas de pago, idiomas, fotos de trabajos, mapa del radio y aviso de si llega a tu casa.
- Reseñas de 1 a 5 estrellas con desglose; el profesional puede responder públicamente.
- Contacto: chat interno (estilo Idealista) con **propuestas de precio** que la otra parte acepta o rechaza, además de teléfono, WhatsApp y email.

**Profesionales**
- Perfil editable con foto, galería (hasta 8 fotos), oficio principal y secundarios.
- Ubicación base en mapa (arrastrable) y radio de 1 a 100 km con previsualización del círculo.
- Bandeja de mensajes con contador de no leídos; pausar el perfil para no salir en búsquedas.

## Pedir presupuestos (MVP)

Además de buscar, el cliente puede **contar su problema a un asistente** y recibir presupuestos:

1. **Asistente** (`#/pedir`): el cliente describe el problema; el asistente hace 1–3 preguntas, elige el oficio, propone título, descripción, urgencia y un precio orientativo de mano de obra. El cliente lo revisa, añade dirección y fotos (máx. 3) y publica. Si no tiene cuenta, se le pide al publicar y no pierde lo escrito.
2. **Profesionales** (`#/pedidos`): ven los pedidos nuevos de su oficio dentro de su radio de acción (solo el barrio y la distancia; la dirección exacta se revela únicamente al profesional elegido) y envían un presupuesto (importe, si incluye materiales, cuándo pueden ir, mensaje).
3. **Cliente** (`#/pedido/:id`): compara presupuestos (etiquetas «Más barato» / «Mejor valorado»), chatea con cada profesional, acepta uno (los demás se descartan) y marca el trabajo como finalizado para poder valorarlo.

Estados del pedido: `open` → `taken` → `done` (o `cancelled`). Hay un chat interno por pedido y profesional, y contadores de novedades en la barra de navegación.

**IA.** Con `ANTHROPIC_API_KEY` el asistente usa Claude (`AI_MODEL`, por defecto `claude-opus-5-5`) con salida estructurada. Sin clave, o si la API falla, cae a un clasificador por palabras clave: el flujo sigue funcionando, solo sin preguntas de aclaración ni precio orientativo. `/api/ai/status` indica el modo activo. La IA no decide precios: los presupuestos los ponen los profesionales.

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
docker compose up --build -d
```

Datos de ejemplo: `cliente@demo.com` tiene un pedido abierto con 3 presupuestos y otro en curso con chat; `plomero@demo.com` tiene un pedido nuevo en su zona y un presupuesto enviado.

## Precios, SEO y herramientas gratis

Páginas **renderizadas en servidor** (indexables, con `title`, `description`, `canonical`, migas y datos estructurados `FAQPage`/`BreadcrumbList`), con el mismo diseño de la app:

| Ruta | Contenido |
|---|---|
| `/precios` | Índice de oficios con precios de referencia |
| `/precios/:oficio` · `/precios/:oficio/:trabajo` | Rangos de mano de obra, qué cambia el precio, preguntas frecuentes |
| `/servicios/:oficio` · `/servicios/:oficio/:ciudad` | Profesionales mejor valorados que llegan a esa ciudad, zonas, precios y FAQ (8 ciudades de España) |
| `/sitemap.xml` · `/robots.txt` | Las páginas de ciudad sin profesionales llevan `noindex` y no entran en el sitemap |
| `#/presupuestador` | «¿Cuánto cuesta?»: texto libre → rango habitual (`POST /api/tools/estimate`) |
| `#/comparador` | «¿Está bien este presupuesto?»: semáforo buen precio / mejorable / caro / sospechosamente barato (`POST /api/tools/compare`) |

**Importante:** los rangos de [prices.js](prices.js) son **estimaciones de partida** hechas para este proyecto, no datos medidos. Revísalos con profesionales reales antes de publicar. En cuanto haya al menos 8 presupuestos aceptados de un oficio, las páginas muestran además el rango **medido** en la plataforma. Para añadir trabajos u oficios edita `ITEMS` en `prices.js`; las ciudades están en `CITIES` de `seo.js`. Pon `PUBLIC_URL` en producción para que canonical y sitemap usen tu dominio.

## Pagos con retención y reclamaciones

Flujo: el cliente **paga al aceptar** un presupuesto → el dinero queda **retenido** en la plataforma → al **confirmar el cliente** que el trabajo está hecho se transfiere al profesional el importe **menos la comisión (10 %, a cargo del profesional; el cliente paga exactamente el presupuesto)**. Si es el profesional quien lo marca como terminado, el pago se libera solo a las 72 h salvo reclamación. Mientras el pago está retenido el cliente puede **reclamar**: queda congelado hasta que un administrador (`#/admin`) lo reembolse al cliente o lo libere al profesional. Si el cliente cancela antes de que el profesional termine, se **reembolsa** íntegro. Los profesionales configuran sus cobros una vez en `#/cobros` y no pueden presupuestar sin hacerlo.

| Modo | Cuándo | Qué hace |
|---|---|---|
| `stripe` | hay `STRIPE_SECRET_KEY` | Stripe Connect (cuentas Express, cargos separados + transferencias con `source_transaction`), Checkout, reembolsos |
| `simulated` | sin clave y `DEMO_MODE=true` | Mismo flujo con un proveedor falso: ves todo sin mover dinero |
| `off` | sin clave y `DEMO_MODE=false` | Sin pagos (comportamiento anterior) |

Variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_URL` (para las URLs de retorno), `PLATFORM_FEE_PCT` (10), `RELEASE_HOURS` (72), `ADMIN_EMAILS` (lista separada por comas; en demo, `admin@demo.com` / `demo1234`), `PAYMENTS_MODE` para forzar un modo.

**Probar con Stripe (modo test):**
1. En el panel de Stripe activa **Connect** y copia la clave secreta de test (`sk_test_...`).
2. Arranca con `STRIPE_SECRET_KEY` y `PUBLIC_URL`. Con el CLI de Stripe: `stripe listen --forward-to localhost:3080/api/stripe/webhook` y pon el `whsec_...` que imprime en `STRIPE_WEBHOOK_SECRET`.
3. Sin webhook también funciona en local: al abrir el pedido se consulta a Stripe el estado del pago.
4. Tarjeta de prueba `4242 4242 4242 4242`; para el alta del profesional usa los datos de prueba de Stripe Connect.

**Pendiente antes de cobrar dinero real:** revisión legal de [las condiciones](public/app.js) (borrador en `#/legal/condiciones`), facturación de la comisión, comprobar con Stripe que tu cuenta de plataforma puede operar así (Connect, retención y transferencias en España/UE), y probar el flujo con Stripe real: yo solo lo he verificado contra un Stripe simulado en local, no contra la API real.

**Aún no incluye:** avisos por email o push, verificación documental de profesionales, caducidad automática de pedidos y cancelación por parte del profesional.

## Arquitectura

- **Backend**: Node.js 22 + Express, SQLite nativo de Node (`node:sqlite`), sin dependencias nativas que compilar.
- **Frontend**: SPA en JavaScript sin framework + Leaflet (servido desde la propia app). Mapas de OpenStreetMap y geocodificación con Nominatim (requieren internet en el navegador).
- **Datos**: `/app/data/oficios.db` dentro de un volumen Docker (`oficios-data`), persiste entre reinicios.

```
server.js        API REST (usuarios, perfiles, búsqueda, reseñas, mensajes)
orders.js        pedidos, presupuestos y chat del pedido
payments.js      pagos con retención (Stripe Connect o simulado), reclamaciones, administración
ai.js            asistente (Claude + respaldo por palabras clave)
prices.js        precios de referencia, emparejado de trabajos y veredicto del comparador
seo.js           páginas de precios/servicios, sitemap y APIs de las herramientas
seed.js          datos de ejemplo
public/          index.html, app.js, pedidos.js, herramientas.js, styles.css
```

### API

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Sesión (token Bearer) |
| GET | `/api/me` | Usuario, perfil pro y mensajes sin leer |
| GET | `/api/search?lat&lng&trade&minRating&emergency&freeQuote&insured&q&sort` | Búsqueda por radio |
| GET | `/api/pros/:id` | Perfil con reseñas |
| PUT | `/api/pros/me` | Crear/editar mi perfil profesional |
| POST | `/api/pros/:id/reviews` · `/api/reviews/:id/reply` | Reseñar · responder |
| GET/POST | `/api/conversations` · `/api/conversations/:id/messages` | Chat |
| POST | `/api/messages/:id/offer` | Aceptar/rechazar propuesta de precio |
| POST | `/api/ai/chat` | Asistente: `{messages:[{role,content}]}` → `{status, reply, trade, title, summary, urgency, estimate_*}` (20 consultas/10 min por IP) |
| POST/GET | `/api/orders` · `/api/orders/mine` · `/api/orders/:id` | Crear pedido · mis pedidos · detalle (vista cliente o profesional) |
| GET | `/api/pro/orders` | Pedidos nuevos en mi zona y mis presupuestos |
| POST | `/api/orders/:id/quotes` · `/quotes/withdraw` | Enviar/actualizar o retirar presupuesto |
| POST | `/api/orders/:id/accept` · `/finish` · `/cancel` | Aceptar presupuesto · finalizar · cancelar |
| GET/POST | `/api/orders/:id/chat?pro=` | Chat del pedido |
| POST | `/api/orders/:id/pay` · `/pay/confirm-simulated` · `/dispute` | Pagar (Checkout) · confirmar pago simulado · abrir reclamación |
| GET/POST | `/api/pay/status` · `/api/pay/connect` · `/api/pay/dashboard` | Cobros del profesional (Stripe Connect) |
| POST | `/api/stripe/webhook` | Webhook de Stripe (firmado) |
| GET/POST | `/api/admin/payments` · `/api/admin/orders/:id/resolve` | Administración: pagos y resolución de reclamaciones |

## Siguientes pasos para producción

Esto es un prototipo funcional. Antes de abrirlo al público: verificación de email y de profesionales (DNI/licencia), reseñas solo tras un trabajo acordado, moderación y denuncias, almacenamiento de imágenes en S3 en lugar de la base de datos, PostgreSQL + PostGIS para búsquedas geográficas a escala, HTTPS, límites de peticiones, y textos legales (RGPD, términos de uso).
