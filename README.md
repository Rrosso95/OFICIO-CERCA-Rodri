# Oficio Cerca

Plataforma para España que conecta a particulares con profesionales de oficios (fontanero, electricista, gasista, cerrajero…). El cliente cuenta su problema a un asistente con IA y recibe presupuestos de los profesionales que **realmente se desplazan hasta su dirección**. Elige uno, paga a través de la plataforma con el dinero retenido hasta que el trabajo está hecho, y valora al profesional. También puede buscar y contactar directamente por oficio y zona.

> **Estado:** prototipo funcional completo en modo demostración. **No está listo para producción**: antes hay que resolver los puntos de [Qué falta para producción](#qué-falta-para-producción).

## Índice

- [Arrancar en local](#arrancar-en-local)
- [Qué incluye](#qué-incluye)
- [Configuración](#configuración)
- [Arquitectura](#arquitectura)
- [API](#api)
- [Cómo se ha probado](#cómo-se-ha-probado)
- [Qué falta para producción](#qué-falta-para-producción)

## Arrancar en local

Requisitos: Docker. Sin Docker: Node.js 22.13 o superior y `npm install && npm start`.

```bash
docker compose up --build -d
```

Abre http://localhost:3080. La primera vez se cargan unos 36 profesionales de ejemplo repartidos por **Asturias** (Oviedo, Gijón, Avilés, Siero, Langreo y Mieres), con reseñas y pedidos.

| Cuenta de prueba (contraseña `demo1234`) | Para ver |
|---|---|
| `cliente@demo.com` | Cliente con un pedido abierto con 3 presupuestos y otro en curso con el pago retenido |
| `cliente1@demo.com` | Otro cliente con un pedido abierto |
| `plomero@demo.com` | Profesional: pedidos nuevos en su zona, presupuestos, cobros y verificación |
| `admin@demo.com` | Administración: pagos, reclamaciones y verificaciones (`#/admin`) |

```bash
docker compose logs -f     # ver logs
docker compose down        # parar (los datos se conservan)
docker compose down -v     # parar y BORRAR los datos (vuelve a sembrar la demo)
```

En modo demostración (`DEMO_MODE=true`) todo funciona sin claves externas:
- **IA:** el asistente hace preguntas guiadas por oficio a partir de palabras clave. Para que entienda cualquier problema como una IA, configura Claude (ver [Configuración](#configuración)).
- **Pagos:** son simulados, sin dinero real.
- **Emails:** se guardan en un registro en vez de enviarse.

## Qué incluye

### Para clientes
- **Asistente para pedir presupuestos** (`#/pedir`): el cliente describe el problema y el asistente hace de 1 a 3 preguntas. Después elige el oficio y propone título, descripción, urgencia y un precio orientativo de mano de obra.
  - Ante riesgos como un olor a gas o chispas, indica qué hacer primero.
  - El cliente revisa el pedido, añade su dirección y hasta 3 fotos, y lo publica. Si no tiene cuenta, se le pide al publicar sin perder lo escrito.
- **Comparar presupuestos** (`#/pedido/:id`): importe, si incluye materiales, cuándo puede ir el profesional, valoraciones y distancia, con las etiquetas «Más barato» y «Mejor valorado». Hay un chat interno con cada profesional.
- **Búsqueda directa** por oficio y ubicación, con un mapa del radio de cada profesional, filtros, perfiles, reseñas y contacto.
- **Herramientas gratis sin registro:** «¿Cuánto cuesta?» (`#/presupuestador`) y «¿Está bien este presupuesto?» (`#/comparador`), que responde con un semáforo.

### Para profesionales
- **Perfil:** foto, galería, oficios, precio orientativo y zona base con su **radio de desplazamiento** en el mapa.
- **Pedidos nuevos de su zona:** solo los de su oficio cuyo cliente queda dentro de su radio. Ven el barrio y la distancia; la **dirección exacta solo la ve el profesional elegido**.
- **Presupuestos:** pueden enviarlos, editarlos o retirarlos, y escribir al cliente antes de presupuestar.
- **Cobros** (`#/cobros`): se configuran una vez con Stripe Connect. Hasta entonces no pueden presupuestar.
- **Verificación documental:** suben su DNI/NIE y su seguro de responsabilidad civil, más el carné en los oficios de gas, electricidad o climatización. Un administrador lo revisa y el perfil pasa a mostrar «Verificado».
- **Cancelación:** si no pueden hacer un trabajo ya aceptado, lo cancelan explicando el motivo, y el cliente recupera su dinero.

### Ciclo de un pedido

```
abierto ──(el cliente acepta un presupuesto)──▶ en curso ──(trabajo confirmado)──▶ finalizado
   │                                              │
   ├─(7 días sin elegir)──▶ caducado ─┐           ├─(cancela el cliente)──▶ cancelado (reembolso)
   └─(cancela el cliente)──▶ cancelado │           └─(cancela el profesional)──▶ cancelado (reembolso) ─┐
                                       └────────── «Volver a publicar» ◀─────────────────────────────────┘
```

Al volver a publicar, los demás presupuestos vuelven a estar disponibles y se avisa de nuevo a los profesionales de la zona.

### Pagos con retención
- El cliente **paga al aceptar** el presupuesto, exactamente su importe, y el dinero queda **retenido**.
- Al **confirmar el cliente** que el trabajo está hecho, se transfiere al profesional el importe **menos la comisión (10 %, a cargo del profesional)**.
- Si el profesional lo marca como terminado y el cliente no responde, el pago se libera solo a las **72 h**.
- Mientras el pago está retenido, el cliente puede **reclamar**. El pago queda congelado hasta que un administrador lo reembolse o lo libere.
- Si alguien cancela antes de terminar el trabajo, se **reembolsa** íntegro al cliente.

Funciona con tres modos de pago:

| Modo | Cuándo se activa | Qué hace |
|---|---|---|
| `stripe` | hay `STRIPE_SECRET_KEY` | Stripe Connect con cuentas Express, cargos separados y transferencias (`source_transaction`), Checkout y reembolsos |
| `simulated` | sin clave y con `DEMO_MODE=true` | El mismo flujo con un proveedor falso, sin dinero real |
| `off` | sin clave y con `DEMO_MODE=false` | Sin pagos |

### Avisos
Cada usuario puede desactivar los emails desde su cuenta. Las notificaciones push se activan por dispositivo.

| A quién | Cuándo |
|---|---|
| Profesionales de la zona | Hay un pedido nuevo de su oficio dentro de su radio (con su propia casilla de desactivación) |
| Cliente | Llega un presupuesto nuevo, se recibe su pago, el profesional termina, el pedido caduca, el profesional cancela, se le reembolsa |
| Profesional | Le eligen, el cliente paga, le transfieren, hay una reclamación, el cliente cancela, se resuelve su verificación |
| Ambos | Mensaje en el chat del pedido: solo un email por conversación hasta que se lee |
| Administradores | Se abre una reclamación |

Los emails nunca incluyen la dirección exacta ni el nombre completo del cliente.

### Precios y SEO
- **Páginas renderizadas en el servidor**, indexables y con datos estructurados:
  - `/precios`, `/precios/:oficio` y `/precios/:oficio/:trabajo`.
  - `/servicios/:oficio` y `/servicios/:oficio/:ciudad`, para 11 ciudades (Oviedo, Gijón y Avilés, más 8 de otras zonas de España). Las ciudades sin profesionales llevan `noindex`.
  - `sitemap.xml` y `robots.txt`.
- **Páginas de ciudad sin profesionales:** llevan `noindex` y quedan fuera del sitemap.
- **Portada:** una sección «¿Qué necesitas arreglar?» con una fila deslizable por oficio y una tarjeta con foto por trabajo (rango de mano de obra), con filtro por oficio (`GET /api/prices`, [public/precios-filas.js](public/precios-filas.js)). Las fotos se cargan desde Unsplash, lo que implica una petición a un tercero (ya recogido en la política de cookies).
- **Precios:** son **rangos de referencia** escritos a mano en [prices.js](prices.js). Cuando un oficio acumula 8 o más presupuestos aceptados, se muestra también el rango medido en la plataforma.

### Administración (`#/admin`)
- **Pagos:** lista de pagos y reclamaciones, con reembolso o liberación.
- **Verificaciones:** revisión de documentos, con aprobación o rechazo indicando el motivo.

Los administradores se definen con `ADMIN_EMAILS`.

## Configuración

Todas las variables de entorno se pasan en [docker-compose.yml](docker-compose.yml) (desde tu entorno o un `.env` junto a él) o en [render.yaml](render.yaml).

| Variable | Por defecto | Para qué |
|---|---|---|
| `DEMO_MODE` | `true` | Datos de ejemplo, aviso de demo, pagos simulados y la cuenta `admin@demo.com`. **`false` en producción** |
| `PUBLIC_URL` | — | URL pública (p. ej. `https://oficiocerca.es`), usada en canonical, sitemap, emails y retornos de Stripe. **Obligatoria en producción** |
| `DB_PATH` | `data/oficios.db` | Base de datos SQLite; los documentos privados se guardan en `private/`, en la misma carpeta |
| `SEED_LAT`, `SEED_LNG` | Asturias | Si los defines, los datos de ejemplo se reparten alrededor de ese punto y el mapa se centra ahí (p. ej. Madrid: `40.4168`, `-3.7038`) |
| `ANTHROPIC_API_KEY` | — | Activa el asistente con Claude |
| `AI_MODEL` | `claude-opus-5-5` | Modelo de Claude (`claude-haiku-5-5` es mucho más barato) |
| `STRIPE_SECRET_KEY` | — | Activa los pagos reales con Stripe Connect (usa `sk_test_...` para probar) |
| `STRIPE_WEBHOOK_SECRET` | — | Firma del webhook `/api/stripe/webhook`; sin ella, el estado del pago se consulta al abrir el pedido |
| `PAYMENTS_MODE` | automático | Fuerza `stripe`, `simulated` u `off` |
| `PLATFORM_FEE_PCT` | `10` | Comisión que paga el profesional (%) |
| `RELEASE_HOURS` | `72` | Horas hasta la liberación automática si el profesional marca el trabajo como terminado |
| `ADMIN_EMAILS` | `admin@demo.com` en demo | Emails de administración, separados por comas |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM` | — | Envío de emails por cualquier proveedor SMTP. Sin `SMTP_HOST` solo se registran (`GET /api/admin/emails`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | generadas | Claves de las notificaciones push. Fíjalas en producción con `npx web-push generate-vapid-keys` |
| `ORDER_EXPIRY_DAYS` | `7` | Días hasta que caduca un pedido sin elegir presupuesto (`0` = nunca) |
| `VERIF_KEEP_DOCS` | `false` | `true` conserva los documentos de verificación tras revisarlos |
| `KEEP_ALIVE` | activado en Render | Autoping para que el plan gratuito de Render no se duerma |

### Probar Stripe en modo test
1. En el panel de Stripe, activa **Connect** y copia la clave secreta de test.
2. Arranca con `STRIPE_SECRET_KEY` y `PUBLIC_URL`. Opcionalmente, ejecuta `stripe listen --forward-to localhost:3080/api/stripe/webhook` y pon el `whsec_...` que imprime en `STRIPE_WEBHOOK_SECRET`.
3. El cliente paga con la tarjeta `4242 4242 4242 4242`. El profesional completa su alta con los datos de prueba de Stripe Connect.

## Arquitectura

- **Backend:** Node.js 22 con Express y SQLite nativo de Node (`node:sqlite`). No hay dependencias nativas que compilar.
- **Frontend:** una SPA en JavaScript sin framework, con rutas `#/...`, más páginas de precios y servicios renderizadas en el servidor.
- **Mapas:** Leaflet con OpenStreetMap, y geocodificación con Nominatim y Photon.
- **Dependencias:** `express`, `leaflet`, `@anthropic-ai/sdk`, `stripe`, `nodemailer` y `web-push`.

```
server.js        arranque, usuarios, perfiles, búsqueda, reseñas, mensajes directos
orders.js        pedidos, presupuestos, chat del pedido, caducidad, cancelaciones, avisos de pedidos
ai.js            asistente (Claude con salida estructurada, o preguntas guiadas por palabras clave)
payments.js      pagos con retención, reclamaciones y administración de pagos
verification.js  verificación documental de profesionales
notify.js        avisos por email y push (claves VAPID)
mailer.js        envío SMTP o registro local
prices.js        precios de referencia, emparejado de trabajos y veredicto del comparador
seo.js           páginas /precios y /servicios, sitemap, robots y APIs de las herramientas
seed.js          datos de ejemplo
public/          index.html, app.js, pedidos.js, herramientas.js, sw.js, styles.css, icons.js
```

**Datos persistentes:** el volumen `/app/data` contiene la base de datos y `private/verificaciones` con los documentos pendientes de revisión. Las fotos de perfil, la galería y las fotos de los pedidos se guardan en la base de datos como data URLs.

## API

Autenticación con `Authorization: Bearer <token>`, que devuelven `/api/auth/login` y `/api/auth/register`.

| Área | Rutas |
|---|---|
| Cuenta | `POST /api/auth/register` · `/login` · `/logout` · `GET /api/me` · `PUT /api/me/notifs` |
| Profesionales | `GET /api/search` · `GET /api/pros/:id` · `PUT /api/pros/me` · `PUT /api/pros/me/alerts` · `POST /api/pros/:id/reviews` · `POST /api/reviews/:id/reply` |
| Mensajes directos | `GET/POST /api/conversations` · `POST /api/conversations/:id/messages` · `POST /api/messages/:id/offer` |
| Asistente | `POST /api/ai/chat` (20 consultas cada 10 min por IP) · `GET /api/ai/status` |
| Pedidos | `POST /api/orders` · `GET /api/orders/mine` · `GET /api/orders/:id` · `GET /api/pro/orders` |
| Presupuestos | `POST /api/orders/:id/quotes` · `/quotes/withdraw` · `/accept` |
| Ciclo del pedido | `POST /api/orders/:id/finish` · `/cancel` · `/pro-cancel` · `/reopen` · `GET/POST /api/orders/:id/chat?pro=` |
| Pagos | `POST /api/orders/:id/pay` · `/pay/confirm-simulated` · `/dispute` · `GET /api/pay/status` · `POST /api/pay/connect` · `/api/pay/dashboard` · `POST /api/stripe/webhook` |
| Verificación | `GET /api/verification/me` · `POST /api/verification` |
| Push | `GET /api/push/key` · `GET /api/push/status` · `POST /api/push/subscribe` · `/unsubscribe` |
| Herramientas | `POST /api/tools/estimate` · `POST /api/tools/compare` (60 consultas cada 10 min por IP) |
| Administración | `GET /api/admin/payments` · `POST /api/admin/orders/:id/resolve` · `GET /api/admin/verifications` · `GET .../:id/doc/:i` · `POST .../:id/review` · `GET /api/admin/emails` |

## Cómo se ha probado

- **Flujos de punta a punta:** se comprobaron contra un servidor local con datos limpios usando **scripts de prueba temporales**, que no están en el repositorio. Cubren pedidos y permisos, el ciclo de pagos (retención, liberación manual y automática, reclamación, reembolso, cancelación), los avisos, la verificación documental, la caducidad, la cancelación por el profesional y la republicación.
- **Navegador:** la interfaz se revisó en escritorio y en móvil.
- **Stripe:** se verificó contra un **Stripe simulado en local** (importes en céntimos, comisión, `source_transaction`, cuenta Express ES). **No se ha probado contra la API real de Stripe.**
- **Asistente con Claude:** **no se ha probado con una clave real**. El modo guiado sin IA sí se ha probado.
- **Emails:** se enviaron a un servidor SMTP simulado. No se ha probado con un proveedor real ni la entregabilidad.
- **Push:** el envío se probó con `web-push` simulado (incluida la limpieza de suscripciones caducadas). No se ha probado la recepción en un dispositivo real.
- **Tests automatizados:** no hay. Es lo primero que conviene añadir (ver abajo).

## Qué falta para producción

Ordenado por prioridad. Las marcadas como **bloqueantes** deben resolverse antes de abrir al público o de mover dinero real.

### 1. Legal y cumplimiento (bloqueante)
- [ ] **Textos legales:** el aviso legal, la privacidad, las cookies y las condiciones de pago (`#/legal/...` en [public/app.js](public/app.js)) son **borradores con datos entre [corchetes]**. Complétalos y que los revise un abogado.
- [ ] **Términos de uso generales:** no existen. Hay que redactarlos (derechos y obligaciones de clientes y profesionales, contenido, suspensión de cuentas) y que se acepten al registrarse.
- [ ] **RGPD:**
  - Registro de actividades de tratamiento.
  - Contratos de encargado de tratamiento con Stripe, el proveedor SMTP, Anthropic (la IA recibe los textos del cliente) y el hosting.
  - Mencionar en la política de privacidad el envío de datos a la IA.
  - Plazos de conservación de los datos.
- [ ] **Google Fonts** se carga desde los servidores de Google (envía la IP del visitante). Alójalas en el propio servidor o pide consentimiento.
- [ ] **Derechos del consumidor:** información precontractual y derecho de desistimiento en los servicios que paga el cliente.
- [ ] **Facturación:**
  - La plataforma debe facturar su comisión al profesional (IVA incluido). Consulta con tu gestoría la normativa de facturación aplicable (Veri\*factu).
  - Los profesionales facturan al cliente.
  - Revisa también la obligación de informar a Hacienda de las operaciones de los vendedores en plataformas (DAC7).

### 2. Pagos reales (bloqueante para cobrar)
- [ ] Probar el flujo completo con **Stripe en modo test real** (ver [Probar Stripe](#probar-stripe-en-modo-test)), y después en modo live.
- [ ] Confirmar con Stripe que tu cuenta de plataforma puede operar así en España: Connect, retener fondos entre el cobro y la transferencia, y cuentas Express de autónomos.
- [ ] Configurar `STRIPE_WEBHOOK_SECRET` y `PUBLIC_URL` con HTTPS.
- [ ] Definir el proceso de reclamaciones: quién las revisa, plazos de respuesta y qué pruebas se piden. Hoy un administrador decide manualmente.
- [ ] Decidir qué pasa con los pedidos **aceptados que nunca se pagan**: hoy no caducan.

### 3. Seguridad (bloqueante)
- [ ] **Sesiones:** los tokens no caducan nunca y se guardan en `localStorage`, lo que los expone a XSS. Pásalos a cookies `httpOnly` y `Secure` con caducidad y rotación.
- [ ] **Recuperación de contraseña:** no existe. Hay que añadirla, junto con la verificación del email al registrarse.
- [ ] **Límites de peticiones** en login, registro, envío de mensajes y creación de pedidos: hoy solo los tienen la IA y las herramientas.
- [ ] **Cabeceras de seguridad** (CSP, HSTS, `X-Frame-Options`), por ejemplo con `helmet`. HTTPS obligatorio.
- [ ] **Documentos de verificación:** se guardan en disco sin cifrar (aunque se borran al revisarlos). En producción conviene un almacenamiento privado cifrado.
- [ ] Revisión de seguridad del código antes del lanzamiento.

### 4. Datos e infraestructura (bloqueante)
- [ ] **Render en plan gratuito no tiene disco persistente:** se perderían todos los datos en cada reinicio. Usa un plan con disco o migra a **PostgreSQL** gestionado.
- [ ] **Copias de seguridad** automáticas de la base de datos y de `private/`.
- [ ] **Imágenes:** las fotos de perfil, la galería y los pedidos están en la base de datos como data URLs. Muévelas a almacenamiento de objetos (S3, R2) con CDN.
- [ ] **Configuración de producción:** dominio propio con SPF/DKIM para los emails, `VAPID_*` fijas, `ADMIN_EMAILS` reales y `DEMO_MODE=false`.
- [ ] **Monitorización:** errores (p. ej. Sentry), logs centralizados, alertas y uptime.

### 5. Contenido y producto (bloqueante para lanzar)
- [ ] **Validar los precios de referencia** de [prices.js](prices.js) con profesionales reales: son estimaciones sin validar.
- [ ] **Probar el asistente con `ANTHROPIC_API_KEY`:** calidad de las preguntas, coste por pedido y comportamiento ante textos inesperados.
- [ ] **Captar profesionales** en las ciudades de lanzamiento antes de abrir a clientes: sin ellos, los pedidos no reciben presupuestos.

### 6. Importante, pero no bloqueante
- [ ] **Tests automatizados** (API e interfaz) e integración continua.
- [ ] **Reseñas:** hoy cualquier usuario registrado puede reseñar a cualquier profesional. Limítalas a clientes con un trabajo **finalizado** con ese profesional, y añade moderación y denuncias.
- [ ] **Administración ampliada:** gestión de usuarios, bloqueo de cuentas, moderación de contenido y métricas de negocio.
- [ ] **Penalizar las cancelaciones repetidas** de profesionales y los perfiles con valoraciones bajas.
- [ ] **Evitar que el trato se cierre fuera de la plataforma:** detectar teléfonos y emails en el chat del pedido.
- [ ] **Escalabilidad:** la búsqueda recorre todos los profesionales en memoria. Con muchos usuarios, usa PostgreSQL con PostGIS.
- [ ] **Emails en HTML** con diseño propio (hoy son solo texto).
- [ ] **Notificaciones push en iPhone:** requieren instalar la web en la pantalla de inicio (PWA). Conviene explicarlo en la interfaz.
- [ ] **Accesibilidad:** revisión completa con lector de pantalla y teclado.
- [ ] **SEO:** las páginas de la SPA (perfiles de profesionales) no son indexables. Valora renderizarlas en el servidor.
