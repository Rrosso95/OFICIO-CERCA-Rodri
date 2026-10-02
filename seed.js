'use strict';
// Datos de ejemplo: solo se cargan si la base de datos está vacía.
// Centro configurable con SEED_LAT / SEED_LNG (por defecto, Madrid).
module.exports = function seed(db, { hashPassword }) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  const CENTER = { lat: Number(process.env.SEED_LAT) || 40.4168, lng: Number(process.env.SEED_LNG) || -3.7038 };
  let s = 42;
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

  // Clientes
  const clientNames = ['Laura Gómez', 'Javier Ruiz', 'Marta Sánchez', 'Pablo Díaz', 'Lucía Fernández', 'Andrés Moreno',
    'Elena Romero', 'Diego Navarro', 'Carmen Torres', 'Sergio Ramos', 'Ana Castillo', 'Raúl Ortega'];
  const clients = clientNames.map((name, i) =>
    Number(insUser.run(i === 0 ? 'cliente@demo.com' : `cliente${i}@demo.com`, pw, name, 'client', daysAgo(200 + i)).lastInsertRowid));

  const specs = {
    'Plomero / Fontanero': { extra: ['Gasista'], head: 'Fugas, desatascos y reformas de baño', price: [30, 45] },
    'Gasista': { extra: ['Plomero / Fontanero', 'Climatización'], head: 'Instalación y revisión de gas, calderas', price: [35, 55] },
    'Electricista': { extra: ['Manitas'], head: 'Instalaciones, boletines y averías', price: [30, 50] },
    'Cerrajero': { extra: [], head: 'Aperturas 24h y cambio de cerraduras', price: [40, 70] },
    'Pintor': { extra: ['Albañil'], head: 'Pintura de interiores, fachadas y lacados', price: [18, 28] },
    'Albañil': { extra: ['Instalador de suelos'], head: 'Reformas integrales y pequeñas obras', price: [22, 35] },
    'Carpintero': { extra: ['Manitas'], head: 'Muebles a medida, puertas y armarios', price: [28, 40] },
    'Climatización': { extra: ['Electricista'], head: 'Aire acondicionado y bombas de calor', price: [35, 55] },
    'Jardinero': { extra: [], head: 'Mantenimiento de jardines y podas', price: [15, 25] },
    'Manitas': { extra: ['Carpintero', 'Pintor'], head: 'Montaje de muebles y arreglos del hogar', price: [20, 30] },
    'Limpieza': { extra: [], head: 'Limpieza de hogares, oficinas y fin de obra', price: [12, 18] },
    'Mudanzas': { extra: [], head: 'Mudanzas y portes con furgoneta', price: [30, 45] },
  };
  const first = ['Carlos', 'Miguel', 'José', 'Antonio', 'Manuel', 'David', 'Francisco', 'Juan', 'Rubén', 'Óscar',
    'Alberto', 'Fernando', 'Iván', 'Rocío', 'Patricia', 'Silvia', 'Nuria', 'Hugo', 'Adrián', 'Gonzalo'];
  const last = ['García', 'Martínez', 'López', 'Hernández', 'Pérez', 'Jiménez', 'Muñoz', 'Álvarez', 'Gil', 'Serrano',
    'Molina', 'Blanco', 'Vega', 'Rubio', 'Delgado', 'Prieto', 'Herrero', 'Cano'];
  const zones = ['Centro', 'Chamberí', 'Salamanca', 'Retiro', 'Arganzuela', 'Tetuán', 'Carabanchel', 'Usera',
    'Latina', 'Moncloa', 'Hortaleza', 'Vallecas', 'Getafe', 'Alcorcón', 'Leganés', 'Pozuelo', 'Alcobendas', 'Móstoles'];
  const comments = {
    5: ['Rapidísimo y muy limpio trabajando. Lo recomiendo 100%.', 'Vino el mismo día, explicó todo y el precio fue el acordado.',
      'Profesional de verdad. Repetiré seguro.', 'Muy amable, puntual y dejó todo impecable.'],
    4: ['Buen trabajo, aunque llegó un poco tarde.', 'Correcto y a buen precio. Tardó algo en responder al principio.',
      'Muy buen resultado, el presupuesto se ajustó bastante.'],
    3: ['Trabajo aceptable, pero tuvo que volver a terminar un detalle.', 'Bien, aunque algo caro para lo que era.'],
    2: ['Tardó varios días más de lo prometido.'],
    1: ['No apareció el primer día y no avisó.'],
  };
  const payments = ['Efectivo', 'Bizum', 'Transferencia', 'Tarjeta'];

  const tradeList = Object.keys(specs);
  for (let i = 0; i < 36; i++) {
    const trade = tradeList[i % tradeList.length];
    const sp = specs[trade];
    const name = `${pick(first)} ${pick(last)}`;
    const email = i === 0 ? 'plomero@demo.com' : `pro${i}@demo.com`;
    const uid = Number(insUser.run(email, pw, name, 'pro', daysAgo(100 + Math.floor(rnd() * 900))).lastInsertRowid);
    // ubicación base en un radio de ~25 km del centro
    const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.22;
    const lat = CENTER.lat + r * Math.cos(ang);
    const lng = CENTER.lng + r * Math.sin(ang) * 1.3;
    const years = 2 + Math.floor(rnd() * 25);
    const price = Math.round(sp.price[0] + rnd() * (sp.price[1] - sp.price[0]));
    const emergency = ['Cerrajero', 'Plomero / Fontanero', 'Electricista', 'Gasista'].includes(trade) ? (rnd() > 0.3 ? 1 : 0) : (rnd() > 0.85 ? 1 : 0);
    const radius = [5, 8, 10, 15, 20, 25, 30, 40][Math.floor(rnd() * 8)];
    const zone = pick(zones);
    const desc = `Soy ${name.split(' ')[0]}, ${trade.toLowerCase()} con ${years} años de experiencia trabajando en ${zone} y alrededores.\n\n` +
      `Trabajo con materiales de primera calidad y doy garantía por escrito en todas las reparaciones. ` +
      `Presupuestos claros, sin sorpresas. Si no puedo ir yo, te lo digo desde el principio.`;
    insPro.run(uid, trade, JSON.stringify(sp.extra.filter(() => rnd() > 0.4)), sp.head, desc,
      `+34 6${String(10000000 + Math.floor(rnd() * 89999999)).slice(0, 8)}`, rnd() > 0.2 ? 'same' : '',
      email, years, price, rnd() > 0.5 ? Math.round(15 + rnd() * 25) : null, rnd() > 0.35 ? 1 : 0, emergency,
      ['Gasista', 'Electricista', 'Climatización'].includes(trade) ? `Instalador autorizado nº ${Math.floor(1000 + rnd() * 9000)}` : '',
      rnd() > 0.4 ? 1 : 0, rnd() > 0.5 ? 1 : 0,
      emergency ? 'Lunes a domingo, 24 horas' : 'Lunes a viernes 8:00–19:00, sábados 9:00–14:00',
      JSON.stringify(payments.filter(() => rnd() > 0.35).concat(['Efectivo']).filter((v, k, a) => a.indexOf(v) === k)),
      JSON.stringify(rnd() > 0.7 ? ['Español', 'Inglés'] : ['Español']),
      lat, lng, `${zone}, Madrid`, radius, rnd() > 0.6 ? 1 : 0, daysAgo(Math.floor(rnd() * 30)));
    // whatsapp = mismo teléfono
    db.prepare("UPDATE pros SET whatsapp = phone WHERE user_id = ? AND whatsapp = 'same'").run(uid);

    // reseñas
    const nReviews = Math.floor(rnd() * 9);
    const bias = rnd(); // algunos profesionales son mejores que otros
    for (let k = 0; k < nReviews; k++) {
      const x = rnd() * 0.6 + bias * 0.4;
      const rating = x > 0.75 ? 5 : x > 0.55 ? 4 : x > 0.4 ? 3 : x > 0.3 ? 2 : 1;
      const reply = rating <= 3 && rnd() > 0.5 ? 'Gracias por tu opinión, lo tendré en cuenta para mejorar.' : null;
      insReview.run(uid, pick(clients), rating, pick(comments[rating]), reply, daysAgo(Math.floor(rnd() * 300)));
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
