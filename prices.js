'use strict';
// Precios de referencia (España, solo mano de obra, sin materiales ni IVA) y herramientas que los usan.
// OJO: son estimaciones de partida elaboradas para Oficio Cerca, NO datos medidos. Revísalas con profesionales
// reales antes de publicar. Cuando hay suficientes presupuestos aceptados en la plataforma, las páginas
// muestran además el rango medido (ver measured()).

const TRADE_META = {
  'Plomero / Fontanero': { slug: 'fontanero', noun: 'fontanero', plural: 'fontaneros', icon: 'wrench' },
  Gasista: { slug: 'gasista', noun: 'gasista', plural: 'gasistas', icon: 'flame' },
  Electricista: { slug: 'electricista', noun: 'electricista', plural: 'electricistas', icon: 'zap' },
  Cerrajero: { slug: 'cerrajero', noun: 'cerrajero', plural: 'cerrajeros', icon: 'key-round' },
  Pintor: { slug: 'pintor', noun: 'pintor', plural: 'pintores', icon: 'paint-roller' },
  Albañil: { slug: 'albanil', noun: 'albañil', plural: 'albañiles', icon: 'brick-wall' },
  Carpintero: { slug: 'carpintero', noun: 'carpintero', plural: 'carpinteros', icon: 'hammer' },
  Climatización: { slug: 'climatizacion', noun: 'técnico de climatización', plural: 'técnicos de climatización', icon: 'snowflake' },
  Manitas: { slug: 'manitas', noun: 'manitas', plural: 'manitas', icon: 'drill' },
  Jardinero: { slug: 'jardinero', noun: 'jardinero', plural: 'jardineros', icon: 'trees' },
  Limpieza: { slug: 'limpieza', noun: 'profesional de limpieza', plural: 'profesionales de limpieza', icon: 'sparkles' },
  Mudanzas: { slug: 'mudanzas', noun: 'profesional de mudanzas', plural: 'profesionales de mudanzas', icon: 'truck' },
  Cristalero: { slug: 'cristalero', noun: 'cristalero', plural: 'cristaleros', icon: 'app-window' },
  Techador: { slug: 'techador', noun: 'techador', plural: 'techadores', icon: 'house' },
  Herrero: { slug: 'herrero', noun: 'herrero', plural: 'herreros', icon: 'anvil' },
  'Instalador de suelos': { slug: 'instalador-de-suelos', noun: 'instalador de suelos', plural: 'instaladores de suelos', icon: 'layout-grid' },
};

// Recargos habituales fuera de horario, por oficio (texto orientativo)
const SURCHARGE = {
  'Plomero / Fontanero': 'Las urgencias nocturnas, de fin de semana o festivos suelen llevar un recargo del 30 % al 50 %.',
  Electricista: 'Las urgencias nocturnas, de fin de semana o festivos suelen llevar un recargo del 30 % al 50 %.',
  Gasista: 'Las urgencias fuera de horario suelen llevar un recargo del 30 % al 50 %.',
  Cerrajero: 'Las aperturas nocturnas, de fin de semana o festivos suelen costar entre un 40 % y un 80 % más.',
};

const I = (trade, slug, name, min, max, note, keywords) => ({ trade, slug, name, min, max, note, keywords });
const ITEMS = [
  // Fontanería
  I('Plomero / Fontanero', 'desatasco-fregadero', 'Desatascar un fregadero o lavabo', 50, 90, 'Sin máquina; con máquina eléctrica puede subir', ['desatasc', 'atasc', 'atranc', 'fregadero', 'lavabo', 'no baja el agua', 'desague', 'sifon obstruido']),
  I('Plomero / Fontanero', 'cambiar-grifo', 'Cambiar un grifo', 40, 80, 'No incluye el grifo', ['grifo', 'grifería', 'griferia', 'canilla', 'monomando', 'gotea el grifo', 'cambiar el grifo']),
  I('Plomero / Fontanero', 'reparar-fuga', 'Reparar una fuga de agua visible', 60, 130, 'Si hay que picar, se presupuesta aparte', ['fuga', 'gotera', 'pierde agua', 'perdida de agua', 'humedad', 'tuberia', 'tubo roto', 'goteo']),
  I('Plomero / Fontanero', 'cambiar-cisterna', 'Reparar o cambiar el mecanismo de la cisterna', 45, 90, 'Mecanismo no incluido', ['cisterna', 'cisterna pierde', 'cadena del inodoro', 'mecanismo cisterna', 'descarga del inodoro']),
  I('Plomero / Fontanero', 'cambiar-sifon', 'Cambiar un sifón', 35, 70, 'Sin material', ['sifon', 'sifón', 'bote sifonico']),
  I('Plomero / Fontanero', 'instalar-termo', 'Instalar un termo eléctrico', 90, 180, 'Sin el termo; retirada del antiguo aparte', ['termo electrico', 'termo', 'calentador electrico', 'acumulador', 'instalar termo']),
  I('Plomero / Fontanero', 'instalar-lavadora', 'Instalar una lavadora o lavavajillas', 40, 80, 'Con tomas ya preparadas', ['lavadora', 'lavavajillas', 'conectar lavadora', 'instalar lavadora']),
  // Electricidad
  I('Electricista', 'cambiar-diferencial', 'Cambiar un interruptor diferencial', 60, 120, 'Sin el diferencial', ['diferencial', 'salta el diferencial', 'salta la luz', 'salta el automatico']),
  I('Electricista', 'cambiar-magnetotermico', 'Cambiar un magnetotérmico (PIA)', 40, 80, 'Sin la pieza', ['magnetotermico', 'magnetotérmico', 'llave termica', 'térmica', 'termica']),
  I('Electricista', 'punto-luz-enchufe', 'Instalar un punto de luz o un enchufe', 40, 90, 'Con canalización existente', ['enchufe', 'punto de luz', 'interruptor', 'instalar enchufe', 'no hay corriente', 'toma de corriente']),
  I('Electricista', 'revision-cuadro', 'Revisar el cuadro eléctrico', 80, 160, 'Diagnóstico y ajustes básicos', ['cuadro electrico', 'revision electrica', 'no hay luz', 'cortocircuito', 'apagon']),
  I('Electricista', 'boletin-electrico', 'Boletín eléctrico (certificado de instalación)', 100, 200, 'Tasas de la comunidad aparte', ['boletin', 'certificado electrico', 'alta de luz', 'contrato de luz']),
  I('Electricista', 'instalar-lampara', 'Instalar una lámpara o foco', 30, 60, 'Por unidad, sin la lámpara', ['lampara', 'lámpara', 'foco', 'plafon', 'colgar lampara']),
  I('Electricista', 'punto-recarga', 'Instalar un punto de recarga de coche eléctrico', 300, 700, 'Solo mano de obra; sin el cargador', ['punto de recarga', 'cargador coche electrico', 'wallbox', 'coche electrico']),
  // Gas
  I('Gasista', 'revision-gas', 'Revisión periódica de la instalación de gas', 60, 110, 'Obligatoria cada 5 años', ['revision de gas', 'revision gas', 'inspeccion de gas', 'revision periodica', 'certificado de gas']),
  I('Gasista', 'reparar-caldera', 'Reparar una caldera o un calentador', 70, 160, 'Sin recambios', ['caldera', 'calentador', 'no enciende la caldera', 'no hay agua caliente', 'caldera no calienta', 'agua caliente']),
  I('Gasista', 'cambiar-caldera', 'Sustituir una caldera o calentador de gas', 150, 350, 'Solo mano de obra; sin el equipo', ['cambiar caldera', 'instalar caldera', 'sustituir caldera', 'nueva caldera', 'cambiar calentador']),
  I('Gasista', 'instalar-cocina-gas', 'Instalar una cocina o encimera de gas', 80, 160, 'Incluye conexión y prueba de estanqueidad', ['cocina de gas', 'encimera de gas', 'placa de gas', 'conectar cocina', 'instalar cocina']),
  // Cerrajería
  I('Cerrajero', 'apertura-puerta', 'Abrir una puerta sin romper la cerradura', 70, 150, 'En horario diurno', ['abrir puerta', 'apertura', 'me he quedado fuera', 'sin llaves', 'perdi las llaves', 'puerta cerrada']),
  I('Cerrajero', 'cambiar-bombin', 'Cambiar el bombín', 60, 130, 'Sin el bombín', ['bombin', 'bombín', 'cambiar bombin', 'cilindro', 'antibumping']),
  I('Cerrajero', 'cambiar-cerradura', 'Cambiar una cerradura', 90, 200, 'Sin la cerradura', ['cerradura', 'cambiar cerradura', 'cerradura rota', 'cerradura de seguridad', 'puerta acorazada']),
  // Pintura
  I('Pintor', 'pintar-habitacion', 'Pintar una habitación (unos 15 m²)', 150, 300, 'Sin pintura; paredes y techo', ['pintar habitacion', 'pintar dormitorio', 'pintar una habitacion', 'pintar cuarto', 'pintar salon']),
  I('Pintor', 'pintar-piso', 'Pintar un piso completo (unos 80 m²)', 1200, 2400, 'Sin pintura', ['pintar piso', 'pintar casa', 'pintar vivienda', 'pintar apartamento', 'pintar todo el piso']),
  I('Pintor', 'quitar-gotele', 'Quitar el gotelé de una vivienda', 900, 1800, 'Para unos 80 m² de paredes', ['gotele', 'gotelé', 'alisar paredes', 'quitar gotele']),
  I('Pintor', 'lacar-puerta', 'Lacar una puerta', 50, 100, 'Por puerta, por ambas caras', ['lacar', 'lacado', 'puerta lacada', 'pintar puerta']),
  // Albañilería
  I('Albañil', 'reforma-bano', 'Reforma integral de un baño', 2500, 5500, 'Solo mano de obra; sin materiales ni sanitarios', ['reforma bano', 'reforma baño', 'reformar bano', 'cambiar bañera por plato', 'cambiar banera por plato', 'obra bano']),
  I('Albañil', 'tapar-grietas', 'Reparar grietas o desconchones', 80, 200, 'Según extensión y acceso', ['grieta', 'desconchon', 'desconchón', 'tapar agujero', 'arreglar pared', 'yeso']),
  I('Albañil', 'tabique-pladur', 'Montar un tabique de pladur', 350, 800, 'Para unos 10 m²; sin material', ['tabique', 'pladur', 'tabiqueria', 'dividir habitacion']),
  // Carpintería
  I('Carpintero', 'ajustar-puerta', 'Ajustar o reparar una puerta', 40, 90, 'Por puerta', ['ajustar puerta', 'puerta roza', 'puerta no cierra', 'bisagra', 'arreglar puerta']),
  I('Carpintero', 'montar-armario', 'Montar un armario o mueble grande', 80, 250, 'Montaje de muebles de caja', ['montar armario', 'montaje armario', 'montar mueble', 'montaje de muebles', 'armario ikea']),
  I('Carpintero', 'reparar-persiana', 'Reparar una persiana', 50, 120, 'Sin cinta ni motor', ['persiana', 'reparar persiana', 'cinta de persiana', 'persiana atascada']),
  // Climatización
  I('Climatización', 'instalar-split', 'Instalar un aire acondicionado split', 180, 350, 'Solo mano de obra, hasta 3 m de tubería; sin el equipo', ['instalar aire', 'aire acondicionado', 'split', 'instalar split', 'instalacion de aire']),
  I('Climatización', 'mantenimiento-split', 'Limpieza y mantenimiento de un split', 50, 90, 'Por equipo', ['limpieza aire', 'mantenimiento aire', 'limpiar split', 'revision aire']),
  I('Climatización', 'recarga-gas-aire', 'Recargar gas del aire acondicionado', 90, 180, 'Incluye búsqueda básica de fugas', ['recarga de gas', 'aire no enfria', 'no enfria', 'gas del aire', 'aire no enfría']),
  // Manitas
  I('Manitas', 'montar-mueble', 'Montar un mueble pequeño o mediano', 30, 80, 'Por mueble', ['montar mueble', 'montaje', 'montar estanteria', 'montar comoda', 'montar cama']),
  I('Manitas', 'colgar-cuadros', 'Colgar cuadros, estantes o cortinas', 25, 50, 'Hasta una hora de trabajo', ['colgar', 'cuadros', 'colgar cuadro', 'colgar estante', 'colgar cortinas', 'cortinero', 'colgar espejo', 'baldas']),
];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
ITEMS.forEach((it) => { it.nkeys = it.keywords.map(norm); it.slugTrade = TRADE_META[it.trade].slug; });

const slugOf = (trade) => TRADE_META[trade]?.slug;
const tradeBySlug = (slug) => Object.keys(TRADE_META).find((t) => TRADE_META[t].slug === slug);
const itemsFor = (trade) => ITEMS.filter((i) => i.trade === trade);
const findItem = (trade, slug) => ITEMS.find((i) => i.trade === trade && i.slug === slug);

// Devuelve los trabajos más parecidos a un texto libre (puntuación simple por palabras clave)
function match(text, limit = 3) {
  const t = norm(text);
  if (t.length < 3) return [];
  return ITEMS
    .map((it) => ({ it, score: it.nkeys.reduce((s, k) => (t.includes(k) ? s + k.length : s), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.it.min - b.it.min)
    .slice(0, limit)
    .map((x) => x.it);
}

// Semáforo: ¿está bien el presupuesto que te han pasado? (importe total, sin materiales salvo que se indique)
function verdict(item, amount) {
  const { min, max } = item;
  if (amount < min * 0.6) return { level: 'barato', label: 'Sospechosamente barato', text: 'Está muy por debajo de lo habitual. Comprueba qué incluye, si usa buenos materiales y si da garantía y factura.' };
  if (amount <= max) return { level: 'bueno', label: 'Buen precio', text: 'Está dentro del rango habitual para este trabajo.' };
  if (amount <= max * 1.25) return { level: 'mejorable', label: 'Podrías mejorarlo', text: `Está algo por encima del rango habitual. Pedir otro presupuesto puede ahorrarte hasta unos ${Math.round(amount - max)} €.` };
  return { level: 'caro', label: 'Parece caro', text: `Está bastante por encima del rango habitual. Podrías ahorrar unos ${Math.round(amount - max)} € o más con otros presupuestos.` };
}

// Rango medido con presupuestos aceptados en la plataforma (solo si hay muestra suficiente)
function measured(db, trade, minSample = 8) {
  const rows = db.prepare(`SELECT q.amount FROM quotes q JOIN orders o ON o.id = q.order_id
    WHERE o.trade = ? AND q.status = 'accepted' ORDER BY q.amount`).all(trade).map((r) => r.amount);
  if (rows.length < minSample) return null;
  const at = (p) => rows[Math.min(rows.length - 1, Math.floor(p * (rows.length - 1)))];
  return { n: rows.length, p25: Math.round(at(0.25)), p50: Math.round(at(0.5)), p75: Math.round(at(0.75)) };
}

module.exports = { TRADE_META, SURCHARGE, ITEMS, slugOf, tradeBySlug, itemsFor, findItem, match, verdict, measured, norm };
