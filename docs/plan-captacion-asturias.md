# Plan de captación: Gijón y Oviedo (8 semanas)

**Objetivo:** comprobar con datos reales si Oficio Cerca puede funcionar en una zona pequeña antes de gastar en publicidad o de salir a otras provincias.

**Cómo usar este documento:** las cifras son **metas propuestas** para tener una referencia, no previsiones: ajustadlas con lo que vayáis viendo. Nada de aquí se ha probado todavía en la calle.

## 1. Antes de salir a la calle (semana 0)

Sin esto, captar gente solo quema contactos. Marcad cada punto cuando esté hecho.

- [ ] **La app en un servidor real** con dominio propio y HTTPS, y con disco persistente o base de datos gestionada. En Render gratuito se pierden los datos al reiniciar.
- [ ] `DEMO_MODE=false` y `PUBLIC_URL` con vuestro dominio.
- [ ] **Emails reales** (`SMTP_*`) para que los profesionales reciban los avisos de pedidos nuevos.
- [ ] **Textos legales completos** (aviso legal, privacidad, cookies, condiciones) revisados por alguien con conocimiento legal.
- [ ] **Una persona de contacto** con teléfono y WhatsApp visibles. En Asturias la confianza pasa por poder llamar a alguien.
- [ ] Decisión sobre **pagos en el piloto** (ver más abajo).
- [ ] `ANTHROPIC_API_KEY` configurada y probadas 20 conversaciones reales con el asistente.

### Recomendación: empezar el piloto **sin pagos** y sin comisión
Con `PAYMENTS_MODE=off`, el cliente y el profesional acuerdan el pago entre ellos. Así:
- el profesional no tiene que configurar Stripe para empezar;
- no hay que explicar comisiones a quien aún no os conoce;
- aprendéis si el flujo (pedido → presupuestos → elegir) funciona antes de añadir el dinero.

El pago retenido y la comisión se activan después, cuando haya confianza. Si preferís lanzar ya con pagos, usad los mensajes de la variante B de cada guion.

## 2. A quién captar primero

**Oficios:** fontanería y electricidad (muchos pedidos, urgencias). Si hay capacidad, añadid «manitas» (trabajos pequeños y frecuentes). No abráis más oficios hasta tener cubiertos estos.

**Zonas:** Gijón y Oviedo centro y alrededores. Avilés, Siero, Langreo y Mieres, solo cuando las dos primeras funcionen.

**Mínimo para abrir a clientes:** **8 profesionales por oficio y por ciudad** que lleguen a esa zona (24-32 en total). Con menos, muchos pedidos no recibirán presupuesto.

## 3. Captar profesionales (el trabajo principal)

### Dónde encontrarlos
1. **Ferreterías y almacenes de material** eléctrico y de fontanería de Gijón y Oviedo: es donde los profesionales compran cada semana. Pedid permiso para dejar tarjetas y hablad con el encargado.
2. **Listados públicos de la zona** en Habitissimo, Cronoshare, Wallapop y Milanuncios: profesionales que ya buscan clientes por internet.
3. **Google Maps**: buscad «fontanero Gijón», «electricista Oviedo» y mirad los de mejores valoraciones.
4. **Recomendaciones**: pedid a cada profesional que consigáis que os presente a dos colegas.
5. **Gremios y asociaciones de instaladores de Asturias**: buscadlas y preguntad si podéis presentar el proyecto en una reunión.

### Cómo contactar
- **Una persona, no un mensaje masivo.** Llamada o visita personal; después, un WhatsApp con un enlace.
- Contactad solo a **profesionales con anuncio público** y respetad un «no» a la primera. No compréis listas ni hagáis envíos masivos automáticos. Si dudáis de qué contactos comerciales están permitidos (llamadas, WhatsApp, email), consultadlo con quien revise vuestros textos legales.

### Qué ofrecer (solo lo que podáis cumplir)
- **Cero cuotas y cero pago por contacto.** No pagan por ver un cliente.
- **Solo piden presupuesto los pedidos de su oficio y de su zona**, ya explicados por el cliente (el asistente pregunta lo importante antes).
- **Variante A (piloto sin pagos):** «Sin comisión durante el piloto. Os lo diremos con antelación si cambia».
- **Variante B (con pagos):** «El cliente paga al aceptar y el dinero queda retenido; cobras al terminar, el importe íntegro. De momento no hay comisión (promoción de lanzamiento); si algún día la aplicamos, os avisaremos con antelación».
- **Insignia «Verificado»** si envían DNI y seguro (los documentos se borran al revisarlos).

### Guion de llamada (1-2 minutos)
> «Hola, soy [nombre], de Oficio Cerca. Es un proyecto nuevo de Asturias: los clientes cuentan su avería a un asistente y los profesionales de su zona le mandan presupuesto. **No se paga por contacto ni hay cuotas.** Os he visto [en Habitissimo / en Google Maps] y me gustaría que probarais con los pedidos de [Gijón/Oviedo]. ¿Os puedo mandar un WhatsApp con el enlace para que lo veáis con calma?»

### Mensaje de WhatsApp tras la llamada (variante A)
> «Hola [nombre], soy [nombre] de Oficio Cerca. Como hemos hablado: aquí podéis crear vuestro perfil en 5 minutos: [enlace]. Elegís el oficio y hasta dónde os desplazáis, y solo veréis pedidos de vuestra zona. Durante el piloto no hay comisión. Cualquier duda, me escribís a este número.»

### Respuestas a las objeciones habituales
| Objeción | Respuesta honesta |
|---|---|
| «Ya tengo trabajo de sobra» | «Perfecto: entonces solo coges lo que te interesa. Puedes pausar tu perfil cuando quieras». |
| «Las apps cobran por contacto y no sale nada» | «Aquí no se paga por contacto. Y solo ves pedidos de tu oficio y de tu zona». |
| «No me fío / no sé usar apps» | Ofrecer crear el perfil juntos por teléfono o en persona. |
| «¿Y cuánto os lleváis?» | Variante A: «Nada en el piloto». Variante B: «De momento nada, es promoción de lanzamiento». Sé claro en que más adelante puede haber comisión y que se avisará antes. |
| «¿Quién me asegura que el cliente paga?» | Variante B: «El cliente paga antes de que empieces». Variante A: «Pacta el pago con el cliente como siempre; el chat deja constancia». |

### Meta de profesionales
| Semana | Contactados | Perfiles creados | Verificados |
|---|---|---|---|
| 1 | 20 | 5 | 0 |
| 2 | 40 | 15 | 5 |
| 3 | 60 | 25 | 12 |
| 4 | 80 | 35 | 20 |

Si en la semana 3 no llegáis a 15 perfiles, el problema está en la propuesta a los profesionales, no en los clientes. Parad y hablad con 10 de ellos para entenderlo.

## 4. Administradores de fincas y comunidades (palanca de clientes)

**Por qué:** una sola relación trae muchos trabajos y repetidos (averías, portales, bajantes, iluminación común).

**Qué ofrecerles:** avisar una avería y recibir en horas presupuestos comparables de profesionales verificados, con todo por escrito en el chat del pedido.

**Aviso importante:** la app está pensada para particulares. **No tiene** todavía varias comunidades en una misma cuenta, facturación a nombre de la comunidad ni aprobación de presupuestos por junta. En el piloto, **vosotros cargáis los pedidos a mano** que el administrador os pase por WhatsApp o email, y haréis de intermediarios. Es más trabajo, pero enseña qué necesitan antes de programar nada.

### Guion de email o carta a un administrador
> Asunto: Presupuestos comparables de averías en 24 horas — piloto en Gijón/Oviedo
>
> Buenos días [nombre]:
>
> Somos [vuestros nombres], de Oficio Cerca, un servicio nuevo de Asturias que conecta con fontaneros y electricistas de la zona. Nos gustaría proponerle un piloto sin coste: usted nos pasa una avería de alguna de sus comunidades y le enviamos en pocas horas varios presupuestos de profesionales de la zona, para que pueda comparar y decidir.
>
> Nos encargamos de coordinar y usted solo elige. Si le interesa, podemos hacer una prueba con un trabajo pequeño esta misma semana.
>
> [nombre, teléfono, correo]

### Cómo llegar
Una visita corta o llamada después del email. Empezad por **10 administradores** y apuntad qué piden. Meta: **3 piloto aceptados en la semana 6**.

## 5. Clientes particulares (canales baratos)

1. **Carteles o tarjetas** en las ferreterías y en comercios con quien ya hayáis hablado (con su permiso).
2. **Prensa y radio local:** una nota sencilla («dos asturianos crean una plataforma para pedir presupuestos de reparaciones sin dar vueltas») en medios regionales. Cuesta poco y da confianza.
3. **Recomendación:** al terminar un trabajo, el cliente recibe un enlace para invitar a un vecino.
4. **Las páginas de precios y ciudades** del propio sitio: tardan meses en posicionar, así que dejadlas trabajando desde la semana 1.
5. **Grupos de vecinos en redes:** solo donde las normas lo permitan, aportando una respuesta útil, sin spam.

## 6. Publicidad de prueba (semana 5 en adelante)

**No antes de tener 20 profesionales activos.**

- **Presupuesto máximo para la prueba:** 300-500 €, repartido entre Google (búsquedas «fontanero Gijón», «electricista Oviedo»…) y una campaña local en Meta.
- **Destino del anuncio:** `/servicios/fontanero/gijon` y similares, no la página de inicio.
- **Qué medir:** coste por pedido publicado (no por clic), y cuántos reciben ≥2 presupuestos en menos de 1 hora.
- **Regla para decidir:** si el coste por pedido real es mayor que lo que ganáis por trabajo (con la comisión que decidáis aplicar más adelante; hoy es 0 %), **no escaléis** la publicidad. Cambiad antes el modelo (trabajos de más valor o ingresos por el lado del profesional).

## 7. Calendario

| Semana | Foco | Meta |
|---|---|---|
| 0 | Preparar la app y los textos | Lista de la sección 1 completa |
| 1-2 | Captar profesionales (fontanería y electricidad) | 15 perfiles |
| 3-4 | Seguir captando y verificar | 35 perfiles, 20 verificados |
| 4 | Abrir a los primeros clientes (amigos, conocidos, ferreterías) | 15 pedidos reales |
| 5-6 | Administradores de fincas y prensa local | 3 pilotos de administradores, 40 pedidos acumulados |
| 5-7 | Publicidad de prueba | Medir coste por pedido |
| 8 | Balance y decisión | Ver más abajo |

## 8. Qué medir (cada semana)

| Métrica | Meta orientativa |
|---|---|
| Profesionales con perfil / verificados | 35 / 20 al final del mes 1 |
| Pedidos publicados por semana | 15-20 en las semanas 5-8 |
| **Pedidos con ≥2 presupuestos en <1 hora** | **≥ 70 %** |
| Pedidos en los que el cliente elige un presupuesto | ≥ 50 % |
| Pedidos terminados | Anotadlos, aunque el pago sea fuera |
| Clientes que repiten en 8 semanas | Anotadlos, sin meta |
| Coste por pedido de la publicidad | Lo que salga: es el dato clave |

## 9. Decisiones al final

**Semana 4:**
- Si hay ≥25 perfiles y los profesionales responden a los pedidos: seguir.
- Si no: parad, hablad con 10 profesionales para ver qué falla y ajustad la propuesta.

**Semana 8:**
- **Seguir y ampliar** (Avilés, otros oficios) si ≥70 % de los pedidos reciben ≥2 presupuestos rápido y al menos la mitad se acepta.
- **Cambiar el modelo** si hay pedidos pero el coste por pedido o los ingresos no cuadran.
- **Parar o replantear** si cuesta conseguir profesionales o clientes incluso a mano.

## 10. Riesgos y qué hacer

| Riesgo | Qué hacer |
|---|---|
| Profesionales sin pedidos se dan de baja | No abrir más profesionales de los que los clientes pueden alimentar; avisarles de que el comienzo es lento. |
| El cliente cierra el trato fuera de la plataforma | En el piloto es esperable; medid solo si el cliente pidió y eligió. |
| Mala experiencia con un profesional | Verificad antes de dar visibilidad, y tened un teléfono de contacto para incidencias. |
| Los pedidos llegan pero no hay presupuestos | Contactad vosotros a profesionales de la zona en ese momento, a mano. |
| Os ven como «otra app más» | Llevad el mensaje local: dos asturianos, un teléfono, trato directo. |
