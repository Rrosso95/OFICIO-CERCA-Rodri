'use strict';
// Datos de ejemplo: solo se cargan con DEMO_MODE=true y si la base de datos está vacía.
// Teléfonos con prefijo 000 (no asignable) para no apuntar a personas reales.
// Centro configurable con SEED_LAT / SEED_LNG (por defecto, Madrid).
module.exports = function seed(db, { hashPassword }) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  const CENTER = { lat: Number(process.env.SEED_LAT) || 40.4168, lng: Number(process.env.SEED_LNG) || -3.7038 };
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const pw = hashPassword('demo1234');

  const insUser = db.prepare('INSERT INTO users (email, pass_hash, name, role, created_at) VALUES (?,?,?,?,?)');
  const insPro = db.prepare(`INSERT INTO pros (user_id, trade, trades_extra, headline, description, phone, whatsapp,
    contact_email, years_exp, price_hour, callout_fee, free_quote, emergency, license, insured, invoice, hours,
    payment_methods, languages, base_lat, base_lng, base_label, radius_km, verified, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insReview = db.prepare('INSERT OR IGNORE INTO reviews (pro_id, user_id, rating, comment, reply, created_at) VALUES (?,?,?,?,?,?)');

  const clientNames = ['Laura Gómez', 'Javier Ruiz', 'Marta Sánchez', 'Pablo Díaz', 'Lucía Fernández', 'Andrés Moreno',
    'Elena Romero', 'Diego Navarro', 'Carmen Torres', 'Sergio Ramos', 'Ana Castillo', 'Raúl Ortega', 'Irene Vidal',
    'Tomás Rey', 'Beatriz Marín', 'Álvaro Soler', 'Claudia León', 'Mario Fuentes'];
  const clients = clientNames.map((name, i) =>
    Number(insUser.run(i === 0 ? 'cliente@demo.com' : `cliente${i}@demo.com`, pw, name, 'client', daysAgo(200 + i)).lastInsertRowid));

  // Por oficio: oficios extra, titulares, servicios concretos y rango de precio/hora
  const specs = {
    'Plomero / Fontanero': { extra: ['Gasista'], price: [30, 45],
      heads: ['Fugas, desatascos y reformas de baño', 'Fontanería urgente y cambio de bañera por plato', 'Reparación de fugas sin obra'],
      jobs: ['detección de fugas', 'desatascos', 'cambio de grifería y cisternas', 'sustitución de bañera por plato de ducha', 'instalación de termos'] },
    'Gasista': { extra: ['Plomero / Fontanero', 'Climatización'], price: [35, 55],
      heads: ['Instalación y revisión de gas, calderas', 'Revisiones oficiales de gas y certificados', 'Calderas de condensación: instalación y mantenimiento'],
      jobs: ['revisiones periódicas de gas', 'instalación de calderas', 'certificados de instalación', 'cambio de calentadores', 'detección de fugas de gas'] },
    'Electricista': { extra: ['Manitas'], price: [30, 50],
      heads: ['Instalaciones, boletines y averías', 'Electricista autorizado: cuadros y boletines', 'Iluminación LED y puntos de recarga'],
      jobs: ['boletines eléctricos', 'cambio de cuadros', 'averías y cortocircuitos', 'iluminación LED', 'puntos de recarga para coche eléctrico'] },
    'Cerrajero': { extra: [], price: [40, 70],
      heads: ['Aperturas 24h y cambio de cerraduras', 'Cerrajería urgente sin romper la puerta', 'Bombines de seguridad y puertas acorazadas'],
      jobs: ['aperturas de puertas', 'cambio de bombines', 'cerraduras antibumping', 'puertas acorazadas', 'amaestramiento de llaves'] },
    'Pintor': { extra: ['Albañil'], price: [18, 28],
      heads: ['Pintura de interiores, fachadas y lacados', 'Pisos pintados en 2 días, limpio y sin sorpresas', 'Alisado de gotelé y pintura decorativa'],
      jobs: ['pintura de pisos completos', 'quitar gotelé', 'lacado de puertas', 'fachadas', 'papel pintado'] },
    'Albañil': { extra: ['Instalador de suelos'], price: [22, 35],
      heads: ['Reformas integrales y pequeñas obras', 'Reformas de baño y cocina llave en mano', 'Tabiquería, alicatados y pequeñas reparaciones'],
      jobs: ['reformas de baño', 'alicatados', 'tabiques de pladur', 'reparación de humedades', 'solados'] },
    'Carpintero': { extra: ['Manitas'], price: [28, 40],
      heads: ['Muebles a medida, puertas y armarios', 'Armarios empotrados y vestidores a medida', 'Restauración de muebles y puertas de madera'],
      jobs: ['armarios empotrados', 'ajuste de puertas', 'muebles a medida', 'tarimas', 'restauración de madera'] },
    'Climatización': { extra: ['Electricista'], price: [35, 55],
      heads: ['Aire acondicionado y bombas de calor', 'Instalación de splits con certificado F-gas', 'Mantenimiento y recarga de aire acondicionado'],
      jobs: ['instalación de splits', 'limpieza de equipos', 'recarga de gas', 'aerotermia', 'conductos'] },
    'Jardinero': { extra: [], price: [15, 25],
      heads: ['Mantenimiento de jardines y podas', 'Jardines de comunidades y chalets', 'Riego automático y césped'],
      jobs: ['poda de árboles', 'mantenimiento de césped', 'instalación de riego automático', 'desbroces', 'diseño de jardines'] },
    'Manitas': { extra: ['Carpintero', 'Pintor'], price: [20, 30],
      heads: ['Montaje de muebles y arreglos del hogar', 'Pequeñas reparaciones el mismo día', 'Cuelgo cuadros, monto muebles y arreglo lo que haga falta'],
      jobs: ['montaje de muebles', 'colgar cuadros y estanterías', 'cambio de enchufes', 'arreglo de persianas', 'sellado de juntas'] },
    'Limpieza': { extra: [], price: [12, 18],
      heads: ['Limpieza de hogares, oficinas y fin de obra', 'Limpiezas a fondo y de fin de obra', 'Limpieza de cristales y portales'],
      jobs: ['limpiezas a fondo', 'limpieza de fin de obra', 'cristales', 'oficinas', 'pisos turísticos'] },
    'Mudanzas': { extra: [], price: [30, 45],
      heads: ['Mudanzas y portes con furgoneta', 'Pequeñas mudanzas y portes en el día', 'Mudanzas con montaje y desmontaje de muebles'],
      jobs: ['mudanzas de pisos', 'portes', 'montaje y desmontaje de muebles', 'guardamuebles', 'embalaje'] },
  };
  const first = ['Carlos', 'Miguel', 'José', 'Antonio', 'Manuel', 'David', 'Francisco', 'Juan', 'Rubén', 'Óscar',
    'Alberto', 'Fernando', 'Iván', 'Rocío', 'Patricia', 'Silvia', 'Nuria', 'Hugo', 'Adrián', 'Gonzalo', 'Sara', 'Víctor'];
  const last = ['García', 'Martínez', 'López', 'Hernández', 'Pérez', 'Jiménez', 'Muñoz', 'Álvarez', 'Gil', 'Serrano',
    'Molina', 'Blanco', 'Vega', 'Rubio', 'Delgado', 'Prieto', 'Herrero', 'Cano', 'Ibáñez', 'Crespo'];
  const zones = ['Centro', 'Chamberí', 'Salamanca', 'Retiro', 'Arganzuela', 'Tetuán', 'Carabanchel', 'Usera',
    'Latina', 'Moncloa', 'Hortaleza', 'Vallecas', 'Getafe', 'Alcorcón', 'Leganés', 'Pozuelo', 'Alcobendas', 'Móstoles'];
  const intros = [
    (n, t, y, z) => `Soy ${n}, ${t} con ${y} años de oficio en ${z} y alrededores.`,
    (n, t, y, z) => `Llevo ${y} años trabajando como ${t} por la zona de ${z}.`,
    (n, t, y, z) => `${n} al habla: ${t} desde hace ${y} años, con base en ${z}.`,
    (n, t, y, z) => `Negocio familiar de ${t} con ${y} años de experiencia. Salimos desde ${z}.`,
  ];
  const outros = [
    'Doy presupuesto cerrado antes de empezar y garantía por escrito.',
    'Trabajo limpio: protejo suelos y muebles y me llevo los residuos.',
    'Si el arreglo no merece la pena, te lo digo antes de cobrarte nada.',
    'Respondo en menos de una hora en horario laboral.',
    'Materiales de primeras marcas y factura con IVA si la necesitas.',
  ];
  const comments = {
    5: ['Rapidísimo y muy limpio trabajando. Lo recomiendo sin dudarlo.', 'Vino el mismo día, explicó todo y el precio fue el acordado.',
      'Profesional de verdad. Repetiré seguro.', 'Muy amable, puntual y dejó todo impecable.', 'Me solucionó en una hora lo que otro no supo arreglar.',
      'Presupuesto claro y sin sorpresas al final. Un diez.', 'Nos atendió un domingo por la noche. Muy agradecidos.',
      'Trabajo muy cuidado y además me dio consejos para el mantenimiento.'],
    4: ['Buen trabajo, aunque llegó un poco tarde.', 'Correcto y a buen precio. Tardó algo en responder al principio.',
      'Muy buen resultado, el presupuesto se ajustó bastante.', 'Todo bien, aunque tuvo que volver a por una pieza.'],
    3: ['Trabajo aceptable, pero tuvo que volver a terminar un detalle.', 'Bien, aunque algo caro para lo que era.'],
  };
  const payments = ['Efectivo', 'Bizum', 'Transferencia', 'Tarjeta'];

  const tradeList = Object.keys(specs);
  for (let i = 0; i < 36; i++) {
    const trade = tradeList[i % tradeList.length];
    const sp = specs[trade];
    const fn = pick(first);
    const name = `${fn} ${pick(last)}`;
    const email = i === 0 ? 'plomero@demo.com' : `pro${i}@demo.com`;
    const uid = Number(insUser.run(email, pw, name, 'pro', daysAgo(100 + Math.floor(rnd() * 900))).lastInsertRowid);
    const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.2;
    const lat = CENTER.lat + r * Math.cos(ang);
    const lng = CENTER.lng + r * Math.sin(ang) * 1.3;
    const years = 3 + Math.floor(rnd() * 25);
    const price = Math.round(sp.price[0] + rnd() * (sp.price[1] - sp.price[0]));
    const emergency = ['Cerrajero', 'Plomero / Fontanero', 'Electricista', 'Gasista'].includes(trade) ? (rnd() > 0.3 ? 1 : 0) : (rnd() > 0.85 ? 1 : 0);
    const radius = [8, 10, 15, 20, 25, 30, 40][Math.floor(rnd() * 7)];
    const zone = pick(zones);
    const jobs = [...sp.jobs].sort(() => rnd() - 0.5).slice(0, 3);
    const desc = `${pick(intros)(fn, trade.toLowerCase(), years, zone)}\n\nMe dedico sobre todo a ${jobs[0]}, ${jobs[1]} y ${jobs[2]}. ` +
      `${pick(outros)} ${pick(outros.filter(Boolean))}`;
    const phone = `+34 000 000 ${String(100 + i).padStart(3, '0')}`;
    insPro.run(uid, trade, JSON.stringify(sp.extra.filter(() => rnd() > 0.4)), pick(sp.heads), desc,
      phone, rnd() > 0.2 ? phone : '', email, years, price, rnd() > 0.5 ? Math.round(15 + rnd() * 25) : null,
      rnd() > 0.35 ? 1 : 0, emergency,
      ['Gasista', 'Electricista', 'Climatización'].includes(trade) ? `Instalador autorizado nº ${Math.floor(1000 + rnd() * 9000)}` : '',
      rnd() > 0.4 ? 1 : 0, rnd() > 0.5 ? 1 : 0,
      emergency ? 'Lunes a domingo, 24 horas' : pick(['Lunes a viernes 8:00–19:00, sábados 9:00–14:00', 'Lunes a sábado 8:00–20:00', 'Lunes a viernes 9:00–18:00']),
      JSON.stringify(['Efectivo', ...payments.slice(1).filter(() => rnd() > 0.35)]),
      JSON.stringify(rnd() > 0.7 ? ['Español', 'Inglés'] : ['Español']),
      lat, lng, `${zone}, Madrid`, radius, rnd() > 0.5 ? 1 : 0, daysAgo(Math.floor(rnd() * 30)));

    // 3–12 reseñas, mayoritariamente buenas (como suele pasar en la realidad)
    const nReviews = 3 + Math.floor(rnd() * 10);
    const bias = 0.6 + rnd() * 0.4;
    const shuffled = [...clients].sort(() => rnd() - 0.5);
    for (let k = 0; k < nReviews; k++) {
      const x = rnd() * 0.5 + bias * 0.5;
      const rating = x > 0.72 ? 5 : x > 0.55 ? 4 : 3;
      const reply = rating === 3 && rnd() > 0.4 ? 'Gracias por tu opinión, lo tendré en cuenta para mejorar.' : null;
      insReview.run(uid, shuffled[k], rating, pick(comments[rating]), reply, daysAgo(Math.floor(rnd() * 300)));
    }
  }

  // Conversación demo entre cliente@demo.com y plomero@demo.com
  const plomero = db.prepare("SELECT id FROM users WHERE email = 'plomero@demo.com'").get().id;
  const t1 = daysAgo(1), t2 = daysAgo(0.9), t3 = daysAgo(0.8);
  const conv = Number(db.prepare('INSERT INTO conversations (pro_id, client_id, created_at, updated_at) VALUES (?,?,?,?)')
    .run(plomero, clients[0], t1, t3).lastInsertRowid);
  const insMsg = db.prepare('INSERT INTO messages (conversation_id, sender_id, body, offer_amount, offer_status, created_at) VALUES (?,?,?,?,?,?)');
  insMsg.run(conv, clients[0], 'Hola, tengo una fuga debajo del fregadero de la cocina. ¿Podrías venir esta semana?', null, null, t1);
  insMsg.run(conv, plomero, 'Hola Laura, sí. Puedo pasar el jueves por la tarde. Por lo que cuentas, sería cambiar el sifón y las juntas.', null, null, t2);
  insMsg.run(conv, plomero, 'Te propongo este precio con material incluido:', 65, 'pending', t3);

  console.log('Datos de ejemplo cargados (contraseña de todas las cuentas: demo1234)');
};

// Pedidos de ejemplo (solo en DEMO_MODE y si no hay ninguno): se siembran aparte para que también
// aparezcan en bases de datos demo creadas antes de existir los pedidos.
module.exports.orders = function seedOrders(db, { payMode } = {}) {
  if (db.prepare('SELECT COUNT(*) AS c FROM orders').get().c > 0) return;
  const uid = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id;
  const laura = uid('cliente@demo.com'), javier = uid('cliente1@demo.com'), plomero = uid('plomero@demo.com');
  const plomeroPro = plomero && db.prepare('SELECT * FROM pros WHERE user_id = ?').get(plomero);
  if (!laura || !javier || !plomeroPro) return;

  const iso = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const km = (aLat, aLng, bLat, bLng) => {
    const r = (x) => (x * Math.PI) / 180, h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  const zone = (p) => String(p.base_label || 'Centro, Madrid').split(',')[0];
  const insOrder = db.prepare(`INSERT INTO orders (client_id, trade, title, description, urgency, when_text, est_min, est_max,
    address_label, address_detail, lat, lng, status, accepted_quote_id, accepted_pro_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insQuote = db.prepare(`INSERT INTO quotes (order_id, pro_id, amount, message, materials_included, visit_when, status, client_seen, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insMsg = db.prepare("INSERT INTO order_messages (order_id, pro_id, sender_id, kind, body, created_at) VALUES (?,?,?,?,?,?)");

  // A) Pedido abierto de Laura, con varios presupuestos (el del fontanero demo incluido)
  const aLat = plomeroPro.base_lat + 0.008, aLng = plomeroPro.base_lng + 0.006;
  const a = Number(insOrder.run(laura, 'Plomero / Fontanero', 'Fuga bajo el fregadero de la cocina',
    'Gotea agua debajo del fregadero cada vez que uso el grifo. Hay una mancha de humedad en el mueble. Edificio de 1970, sin obras recientes.',
    'semana', 'Por las tardes a partir de las 17:00', 40, 90, `Calle Mayor 12, ${zone(plomeroPro)}, Madrid`, '2.º B', aLat, aLng,
    'open', null, null, iso(1), iso(1)).lastInsertRowid);
  insQuote.run(a, plomero, 65, 'Por lo que cuentas sería cambiar el sifón y las juntas. Material incluido y factura si la necesitas.', 1, 'Jueves por la tarde', 'pending', 0, iso(0.9), iso(0.9));
  const others = db.prepare("SELECT * FROM pros WHERE active = 1 AND user_id != ? AND (trade = 'Plomero / Fontanero' OR trades_extra LIKE '%Plomero / Fontanero%')").all(plomero)
    .filter((p) => km(aLat, aLng, p.base_lat, p.base_lng) <= p.radius_km).slice(0, 2);
  [[48, 'Puedo ir mañana mismo. Si es solo el sifón, te lo dejo hecho en una hora.', 0, 'Mañana por la mañana'],
   [82, 'Reviso toda la instalación bajo el fregadero y sustituyo flexibles y llaves de paso.', 1, 'Esta semana']].forEach(([amount, msg, mat, when], i) => {
    if (others[i]) insQuote.run(a, others[i].user_id, amount, msg, mat, when, 'pending', 0, iso(0.8 - i * 0.1), iso(0.8 - i * 0.1));
  });
  insMsg.run(a, plomero, plomero, 'text', '¿El agua sale de la unión del sifón o de la pared?', iso(0.95));
  insMsg.run(a, plomero, laura, 'text', 'Parece que del sifón, la pared está seca.', iso(0.93));

  // B) Pedido abierto de Javier en la zona del fontanero demo: aparece en «Nuevos en tu zona»
  insOrder.run(javier, 'Plomero / Fontanero', 'Cambiar el grifo del lavabo del baño',
    'Quiero sustituir el grifo del lavabo por uno nuevo que ya tengo comprado (monomando). Solo hay que desmontar el viejo y montar el nuevo.',
    'flexible', 'Fines de semana', 30, 55, `Calle de Bravo Murillo 40, ${zone(plomeroPro)}, Madrid`, '', plomeroPro.base_lat - 0.006, plomeroPro.base_lng + 0.004,
    'open', null, null, iso(0.3), iso(0.3));

  // C) Pedido en curso de Laura con un electricista (presupuesto ya aceptado)
  const elec = db.prepare("SELECT * FROM pros WHERE trade = 'Electricista' AND active = 1 ORDER BY user_id LIMIT 1").get();
  if (elec) {
    const cLat = elec.base_lat + 0.004, cLng = elec.base_lng - 0.004;
    const c = Number(insOrder.run(laura, 'Electricista', 'Salta el diferencial al enchufar el horno',
      'Cada vez que enciendo el horno salta el diferencial. El resto de la casa funciona bien.', 'hoy', 'Cualquier hora', 50, 120,
      `Calle de Atocha 8, ${zone(elec)}, Madrid`, '3.º A', cLat, cLng, 'taken', null, elec.user_id, iso(3), iso(2)).lastInsertRowid);
    const q = Number(insQuote.run(c, elec.user_id, 90, 'Reviso el circuito del horno y la derivación a tierra. Si hay que cambiar el magnetotérmico, ya va incluido.', 1,
      'Mañana a primera hora', 'accepted', 1, iso(2.9), iso(2)).lastInsertRowid);
    db.prepare('UPDATE orders SET accepted_quote_id = ? WHERE id = ?').run(q, c);
    insMsg.run(c, elec.user_id, laura, 'system', '✅ Presupuesto de 90 € aceptado. Ya podéis coordinar el día y la hora por aquí.', iso(2));
    insMsg.run(c, elec.user_id, elec.user_id, 'text', 'Hola Laura, mañana a las 9:00 estoy por allí. ¿Te viene bien?', iso(1.9));
    insMsg.run(c, elec.user_id, laura, 'text', 'Perfecto, aquí estaré. Gracias.', iso(1.8));
    if (payMode === 'simulated') {
      db.prepare(`INSERT INTO payments (order_id, client_id, pro_id, amount, fee, net, status, provider, created_at, updated_at, paid_at)
        VALUES (?,?,?,?,?,?, 'held', 'simulated', ?, ?, ?)`).run(c, laura, elec.user_id, 90, 9, 81, iso(1.95), iso(1.95), iso(1.95));
      insMsg.run(c, elec.user_id, laura, 'system', '💳 Pago de 90 € recibido y retenido. Se liberará al profesional cuando el cliente confirme que el trabajo está hecho.', iso(1.95));
    }
  }
};
