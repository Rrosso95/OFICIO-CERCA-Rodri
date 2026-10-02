# Oficio Cerca

Web para que profesionales de oficios (plomero/fontanero, gasista, electricista, cerrajero…) publiquen su perfil con su **radio de desplazamiento**, y los clientes encuentren a quienes **realmente llegan hasta su ubicación**, vean reseñas y les contacten directamente.

## Arrancar con Docker (PowerShell)

```powershell
Expand-Archive .\oficio-cerca.zip -DestinationPath .
cd .\oficio-cerca
docker compose up --build -d
```

Abre http://localhost:3000

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

## Arquitectura

- **Backend**: Node.js 22 + Express, SQLite nativo de Node (`node:sqlite`), sin dependencias nativas que compilar.
- **Frontend**: SPA en JavaScript sin framework + Leaflet (servido desde la propia app). Mapas de OpenStreetMap y geocodificación con Nominatim (requieren internet en el navegador).
- **Datos**: `/app/data/oficios.db` dentro de un volumen Docker (`oficios-data`), persiste entre reinicios.

```
server.js        API REST
seed.js          datos de ejemplo
public/          index.html, app.js, styles.css
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

## Siguientes pasos para producción

Esto es un prototipo funcional. Antes de abrirlo al público: verificación de email y de profesionales (DNI/licencia), reseñas solo tras un trabajo acordado, moderación y denuncias, almacenamiento de imágenes en S3 en lugar de la base de datos, PostgreSQL + PostGIS para búsquedas geográficas a escala, HTTPS, límites de peticiones, y textos legales (RGPD, términos de uso).
