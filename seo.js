'use strict';
// Páginas públicas renderizadas en servidor (indexables): precios de referencia, servicios por oficio y ciudad,
// sitemap y robots. Reutilizan styles.css para mantener el diseño de la app. Las herramientas interactivas
// (presupuestador y comparador) viven en la SPA y usan las APIs /api/tools/*.
const P = require('./prices');

const CITIES = [
  { slug: 'madrid', name: 'Madrid', lat: 40.4168, lng: -3.7038, zones: ['Centro', 'Chamberí', 'Salamanca', 'Retiro', 'Arganzuela', 'Tetuán', 'Moncloa-Aravaca', 'Chamartín'] },
  { slug: 'barcelona', name: 'Barcelona', lat: 41.3874, lng: 2.1686, zones: ['Eixample', 'Gràcia', 'Sants-Montjuïc', 'Sarrià-Sant Gervasi', 'Horta-Guinardó', 'Sant Martí', 'Les Corts', 'Ciutat Vella'] },
  { slug: 'valencia', name: 'Valencia', lat: 39.4699, lng: -0.3763, zones: ['Ciutat Vella', "L'Eixample", 'Russafa', 'Benimaclet', 'El Cabanyal', 'Campanar', 'Patraix', 'Algirós'] },
  { slug: 'sevilla', name: 'Sevilla', lat: 37.3891, lng: -5.9845, zones: ['Triana', 'Nervión', 'Los Remedios', 'Macarena', 'Casco Antiguo', 'Heliópolis', 'Bellavista', 'Santa Justa'] },
  { slug: 'zaragoza', name: 'Zaragoza', lat: 41.6488, lng: -0.8891, zones: ['Centro', 'Delicias', 'Actur', 'Universidad', 'San José', 'Las Fuentes', 'Casco Histórico', 'Torrero'] },
  { slug: 'malaga', name: 'Málaga', lat: 36.7213, lng: -4.4214, zones: ['Centro', 'Teatinos', 'Cruz de Humilladero', 'El Palo', 'Churriana', 'Carretera de Cádiz', 'Ciudad Jardín', 'Pedregalejo'] },
  { slug: 'bilbao', name: 'Bilbao', lat: 43.263, lng: -2.935, zones: ['Abando', 'Deusto', 'Indautxu', 'Casco Viejo', 'Basurto', 'Txurdinaga', 'Santutxu', 'Begoña'] },
  { slug: 'alicante', name: 'Alicante', lat: 38.3452, lng: -0.481, zones: ['Centro', 'Playa de San Juan', 'Benalúa', 'Carolinas', 'Florida', 'Altozano', 'San Blas', 'Vistahermosa'] },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => `${Number(n).toLocaleString('es-ES')} €`;
const range = (it) => `${eur(it.min)} – ${eur(it.max)}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const askUrl = (text) => `/#/pedir?q=${encodeURIComponent(text)}`;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

module.exports = function seoModule(app, { db, PRO_SELECT, proOut, haversineKm, parse, TRADES }) {
  const origin = (req) => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const when = () => { const d = new Date(); return { year: d.getFullYear(), label: `${MONTHS[d.getMonth()]} de ${d.getFullYear()}` }; };

  // ---------- datos en vivo ----------
  const allPros = () => db.prepare(`${PRO_SELECT} WHERE p.active = 1 AND p.base_lat IS NOT NULL`).all();
  const doesTrade = (r, trade) => r.trade === trade || parse(r.trades_extra).includes(trade);
  function prosFor(trade, city) {
    return allPros().filter((r) => doesTrade(r, trade) && (!city || haversineKm(city.lat, city.lng, r.base_lat, r.base_lng) <= r.radius_km))
      .sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0) || b.review_count - a.review_count);
  }
  const avg = (rows) => { const r = rows.filter((x) => x.avg_rating); return r.length ? Math.round((r.reduce((s, x) => s + x.avg_rating, 0) / r.length) * 10) / 10 : null; };

  // ---------- plantilla ----------
  function layout(req, { title, desc, path, body, ld = [], noindex = false }) {
    const url = origin(req) + path;
    const jsonld = ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n');
    return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ''}
<meta name="theme-color" content="#c2410c">
<meta property="og:type" content="website"><meta property="og:site_name" content="Oficio Cerca"><meta property="og:locale" content="es_ES">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(origin(req))}/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
${jsonld}
</head><body>
<header class="topbar static">
  <a href="/" class="logo" aria-label="Oficio Cerca, inicio"><span class="logo-mark">◆</span><span>Oficio<b>Cerca</b></span></a>
  <nav id="nav" aria-label="Principal">
    <a href="/precios">Precios</a><a href="/#/buscar" class="hide-xs">Buscar</a><a href="/#/profesionales" class="hide-xs">Soy profesional</a>
    <a href="/#/pedir" class="btn small">Pedir presupuestos</a>
  </nav>
</header>
<main>${body}</main>
<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand"><a href="/" class="logo"><span class="logo-mark">◆</span><span>Oficio<b>Cerca</b></span></a>
      <p>Profesionales de oficios que llegan hasta tu casa. Gratis para clientes.</p></div>
    <nav aria-label="Oficio Cerca"><h4>Oficio Cerca</h4><a href="/#/pedir">Pedir presupuestos</a><a href="/#/buscar">Buscar profesionales</a><a href="/precios">Precios</a><a href="/#/profesionales">Para profesionales</a></nav>
    <nav aria-label="Herramientas"><h4>Herramientas</h4><a href="/#/presupuestador">Cuánto cuesta un arreglo</a><a href="/#/comparador">Comparar un presupuesto</a><a href="/#/legal/privacidad">Privacidad</a><a href="/#/legal/aviso-legal">Aviso legal</a></nav>
  </div>
  <div class="footer-copy"><span>© ${new Date().getFullYear()} Oficio Cerca</span><span class="made-by">Diseñado y desarrollado por <strong class="pewmatic">Pewmatic</strong></span></div>
</footer>
</body></html>`;
  }

  const crumbs = (req, list) => ({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: list.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: origin(req) + path })),
  });
  const faqLd = (faqs) => ({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  });
  const crumbHtml = (list) => `<nav class="crumbs" aria-label="Migas de pan">${list.map(([n, p], i) => (i < list.length - 1 ? `<a href="${p}">${esc(n)}</a>` : `<span>${esc(n)}</span>`)).join(' › ')}</nav>`;
  const faqHtml = (faqs) => `<div class="faq">${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
  const disclaimer = (w) => `<p class="muted small">Precios de referencia de mano de obra en España, sin materiales ni IVA, a ${w.label}. Son estimaciones orientativas elaboradas por Oficio Cerca, no un presupuesto: el precio real depende de la zona, la complejidad y el profesional. Pide presupuestos para conocerlo.</p>`;
  const ctaBox = (text, label = 'Pedir presupuestos gratis') => `<div class="pro-cta"><div><h2>¿Lo necesitas?</h2><p>${esc(text)}</p></div><a class="btn big light" href="/#/pedir">${esc(label)}</a></div>`;

  function priceTable(items, trade) {
    return `<div class="ptable-wrap"><table class="ptable"><thead><tr><th>Trabajo</th><th>Rango orientativo</th><th></th></tr></thead><tbody>${items.map((it) => `
      <tr><td><a href="/precios/${P.slugOf(trade)}/${it.slug}"><b>${esc(it.name)}</b></a><span class="muted small">${esc(it.note)}</span></td>
      <td class="pr">${range(it)}</td><td><a class="btn small ghost" href="${askUrl(it.name)}">Pedir</a></td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------- /precios ----------
  app.get('/precios', (req, res) => {
    const w = when();
    const trades = Object.keys(P.TRADE_META).filter((t) => P.itemsFor(t).length);
    const body = `<section class="hero"><div class="hero-inner">
      <h1>Cuánto cuesta arreglar tu casa en ${w.year}</h1>
      <p class="lead">Precios de referencia de mano de obra de los oficios más habituales en España, para que sepas qué es razonable antes de pedir presupuestos.</p>
    </div></section>
    <section class="wrap">
      ${crumbHtml([['Inicio', '/'], ['Precios', '/precios']])}
      <div class="cats">${trades.map((t) => { const m = P.TRADE_META[t], its = P.itemsFor(t); return `<a class="cat" style="--h:${[...t].reduce((a, c) => a + c.charCodeAt(0), 0) * 37 % 360}" href="/precios/${m.slug}"><b>${esc(cap(m.noun))}</b><span class="muted small">${its.length} trabajos · desde ${eur(Math.min(...its.map((i) => i.min)))}</span></a>`; }).join('')}</div>
      <h2 class="section-title">Herramientas gratis</h2>
      <div class="how">
        <a class="tile" href="/#/presupuestador"><b>Cuánto cuesta un arreglo</b><span>Cuéntanos qué necesitas y te damos el rango habitual.</span></a>
        <a class="tile" href="/#/comparador"><b>¿Está bien este presupuesto?</b><span>Dinos cuánto te han pedido y te decimos si es razonable.</span></a>
        <a class="tile" href="/#/pedir"><b>Pedir presupuestos</b><span>Recibe precios reales de profesionales de tu zona.</span></a>
      </div>
      ${disclaimer(w)}
    </section>`;
    res.send(layout(req, {
      title: `Precios de reparaciones y servicios del hogar en España (${w.year}) | Oficio Cerca`,
      desc: 'Cuánto cobra un fontanero, un electricista, un cerrajero o un pintor. Rangos de referencia de mano de obra en España y herramientas gratis para comparar presupuestos.',
      path: '/precios', body, ld: [crumbs(req, [['Inicio', '/'], ['Precios', '/precios']])],
    }));
  });

  const notFound = (req, res) => res.status(404).send(layout(req, { title: 'Página no encontrada | Oficio Cerca', desc: 'No encontramos esta página.', path: req.path, noindex: true,
    body: '<div class="wrap empty"><h2>Página no encontrada</h2><p><a href="/precios">Ver precios</a> · <a href="/">Volver al inicio</a></p></div>' }));

  // ---------- /precios/:oficio ----------
  app.get('/precios/:trade', (req, res) => {
    const trade = P.tradeBySlug(req.params.trade), items = trade && P.itemsFor(trade);
    if (!items || !items.length) return notFound(req, res);
    const m = P.TRADE_META[trade], w = when(), real = P.measured(db, trade);
    const lowest = Math.min(...items.map((i) => i.min));
    const faqs = [
      ...items.slice(0, 3).map((it) => [`¿Cuánto cuesta ${low(it.name)}?`, `Suele costar entre ${range(it)} de mano de obra. ${it.note}. El precio final depende de la zona, el acceso y los materiales.`]),
      [`¿Los precios de un ${m.noun} incluyen materiales?`, 'No. Los rangos son solo de mano de obra, sin materiales ni IVA. Los materiales y piezas se cotizan aparte, salvo que el profesional diga lo contrario en su presupuesto.'],
      [`¿Cómo pido un ${m.noun} en Oficio Cerca?`, 'Cuentas el problema al asistente, publicas el pedido y los profesionales de tu zona te envían presupuestos. Tú comparas, eliges y coordináis por el chat. Pedir es gratis y sin compromiso.'],
    ];
    const body = `<section class="hero"><div class="hero-inner">
      <h1>Cuánto cobra un ${esc(m.noun)} en ${w.year}</h1>
      <p class="lead">Rangos de referencia de mano de obra para los trabajos más habituales: desde ${eur(lowest)}. Úsalos para saber qué es razonable antes de pedir presupuestos.</p>
      <a class="btn big" href="/#/pedir">Pedir un ${esc(m.noun)}</a>
    </div></section>
    <section class="wrap">
      ${crumbHtml([['Inicio', '/'], ['Precios', '/precios'], [cap(m.noun), `/precios/${m.slug}`]])}
      ${real ? `<div class="est">Medido en Oficio Cerca: la mitad de los ${real.n} presupuestos aceptados de ${esc(m.plural)} estuvo entre <b>${eur(real.p25)}</b> y <b>${eur(real.p75)}</b> (mediana ${eur(real.p50)}).</div>` : ''}
      <h2 class="section-title">Precios por trabajo</h2>
      ${priceTable(items, trade)}
      ${disclaimer(w)}
      <h2 class="section-title">Qué hace que el precio cambie</h2>
      <ul class="plain"><li><b>Zona:</b> el coste de la vida y la demanda cambian entre ciudades y barrios.</li><li><b>Complejidad y acceso:</b> un trabajo en un sitio difícil de alcanzar lleva más tiempo.</li><li><b>Materiales:</b> se pagan aparte; pide al profesional que los detalle.</li><li><b>Urgencia:</b> ${esc(P.SURCHARGE[trade] || 'Las urgencias fuera de horario suelen llevar recargo.')}</li><li><b>El profesional:</b> la experiencia, el seguro y la garantía también influyen.</li></ul>
      <h2 class="section-title">¿Te han pasado un presupuesto?</h2>
      <p>Compáralo con el rango habitual en <a href="/#/comparador">nuestra herramienta gratuita</a>.</p>
      <h2 class="section-title">Preguntas frecuentes</h2>
      ${faqHtml(faqs)}
      <h2 class="section-title">${esc(cap(m.plural))} por ciudad</h2>
      <div class="chips-links">${CITIES.map((c) => `<a href="/servicios/${m.slug}/${c.slug}">${esc(cap(m.noun))} en ${esc(c.name)}</a>`).join('')}</div>
      ${ctaBox(`Recibe presupuestos de ${m.plural} de tu zona en minutos. Es gratis y sin compromiso.`)}
    </section>`;
    res.send(layout(req, {
      title: `Cuánto cobra un ${m.noun} en ${w.year}: precios por trabajo | Oficio Cerca`,
      desc: `Precios de referencia de un ${m.noun} en España: ${items.slice(0, 3).map((i) => `${low(i.name)} (${range(i)})`).join(', ')}. Solo mano de obra.`,
      path: `/precios/${m.slug}`, body,
      ld: [crumbs(req, [['Inicio', '/'], ['Precios', '/precios'], [cap(m.noun), `/precios/${m.slug}`]]), faqLd(faqs)],
    }));
  });

  // ---------- /precios/:oficio/:trabajo ----------
  app.get('/precios/:trade/:item', (req, res) => {
    const trade = P.tradeBySlug(req.params.trade), it = trade && P.findItem(trade, req.params.item);
    if (!it) return notFound(req, res);
    const m = P.TRADE_META[trade], w = when();
    const others = P.itemsFor(trade).filter((x) => x !== it).slice(0, 4);
    const faqs = [
      [`¿Cuánto cuesta ${low(it.name)}?`, `Entre ${range(it)} de mano de obra. ${it.note}.`],
      ['¿Incluye materiales?', 'No: el rango es solo de mano de obra, sin materiales ni IVA. Pide al profesional que detalle qué incluye su presupuesto.'],
      ['¿Cuándo es normal pagar más?', `${P.SURCHARGE[trade] || 'Si es urgente, está fuera de horario o el acceso es complicado, el precio suele subir.'} También influyen la zona y la complejidad del trabajo.`],
    ];
    const body = `<section class="hero"><div class="hero-inner">
      <h1>Cuánto cuesta ${esc(low(it.name))}</h1>
      <p class="lead">Mano de obra de un ${esc(m.noun)}: <b>${range(it)}</b>. ${esc(it.note)}.</p>
      <a class="btn big" href="${askUrl(it.name)}">Pedir presupuestos</a>
    </div></section>
    <section class="wrap narrow">
      ${crumbHtml([['Inicio', '/'], ['Precios', '/precios'], [cap(m.noun), `/precios/${m.slug}`], [it.name, `/precios/${m.slug}/${it.slug}`]])}
      <div class="est">${range(it)} · solo mano de obra, sin materiales ni IVA.</div>
      ${disclaimer(w)}
      <h2 class="section-title">¿Te han pasado un presupuesto?</h2>
      <p>Comprueba si es razonable con <a href="/#/comparador?q=${encodeURIComponent(it.name)}">el comparador gratuito</a>.</p>
      <h2 class="section-title">Preguntas frecuentes</h2>
      ${faqHtml(faqs)}
      <h2 class="section-title">Otros trabajos de ${esc(m.noun)}</h2>
      ${priceTable(others, trade)}
      <p><a href="/precios/${m.slug}">Ver todos los precios de ${esc(m.noun)} →</a></p>
      ${ctaBox('Recibe presupuestos reales de profesionales de tu zona. Es gratis y sin compromiso.')}
    </section>`;
    res.send(layout(req, {
      title: `Cuánto cuesta ${low(it.name)} (${range(it)}) | Oficio Cerca`,
      desc: `${it.name}: ${range(it)} de mano de obra en España. ${it.note}. Compara y pide presupuestos gratis.`,
      path: `/precios/${m.slug}/${it.slug}`, body,
      ld: [crumbs(req, [['Inicio', '/'], ['Precios', '/precios'], [cap(m.noun), `/precios/${m.slug}`], [it.name, `/precios/${m.slug}/${it.slug}`]]), faqLd(faqs)],
    }));
  });

  // ---------- /servicios/:oficio y /servicios/:oficio/:ciudad ----------
  const proCards = (rows) => rows.slice(0, 4).map((r) => { const p = proOut(r); return `
    <a class="card" href="/#/pro/${p.id}"><div class="card-body"><b class="name">${esc(p.name)}</b>
      <div class="rating">${p.avg_rating ? `★ ${p.avg_rating.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : 'Sin valoraciones'} <span class="muted">(${p.review_count})</span></div>
      <p class="headline">${esc(p.headline)}</p><div class="meta"><span>${esc(p.base_label)}</span><span>hasta ${p.radius_km} km</span></div></div></a>`; }).join('');

  app.get('/servicios/:trade', (req, res) => {
    const trade = P.tradeBySlug(req.params.trade);
    if (!trade) return notFound(req, res);
    const m = P.TRADE_META[trade], w = when(), pros = prosFor(trade), items = P.itemsFor(trade);
    const body = `<section class="hero"><div class="hero-inner">
      <h1>${esc(cap(m.plural))} que van a tu casa</h1>
      <p class="lead">Cuéntanos qué necesitas y recibe presupuestos de ${esc(m.plural)} de tu zona. Solo te avisamos a quien llega a tu dirección, con reseñas de otros clientes.</p>
      <a class="btn big" href="/#/pedir">Pedir un ${esc(m.noun)}</a>
    </div></section>
    <section class="wrap">
      ${crumbHtml([['Inicio', '/'], ['Servicios', '/precios'], [cap(m.plural), `/servicios/${m.slug}`]])}
      ${pros.length ? `<h2 class="section-title">Mejor valorados</h2><div class="featured">${proCards(pros)}</div>` : ''}
      <h2 class="section-title">${esc(cap(m.plural))} por ciudad</h2>
      <div class="chips-links">${CITIES.map((c) => `<a href="/servicios/${m.slug}/${c.slug}">${esc(cap(m.noun))} en ${esc(c.name)}</a>`).join('')}</div>
      ${items.length ? `<h2 class="section-title">Precios habituales</h2>${priceTable(items.slice(0, 5), trade)}<p><a href="/precios/${m.slug}">Ver todos los precios →</a></p>${disclaimer(w)}` : ''}
      ${ctaBox(`Pide presupuestos a ${m.plural} de tu zona. Gratis y sin compromiso.`)}
    </section>`;
    res.send(layout(req, {
      title: `${cap(m.plural)} a domicilio en España: pide presupuestos | Oficio Cerca`,
      desc: `Encuentra ${m.plural} que se desplazan hasta tu casa. Compara reseñas y presupuestos. Gratis y sin compromiso.`,
      path: `/servicios/${m.slug}`, body, ld: [crumbs(req, [['Inicio', '/'], ['Servicios', '/precios'], [cap(m.plural), `/servicios/${m.slug}`]])],
    }));
  });

  app.get('/servicios/:trade/:city', (req, res) => {
    const trade = P.tradeBySlug(req.params.trade), city = CITIES.find((c) => c.slug === req.params.city);
    if (!trade || !city) return notFound(req, res);
    const m = P.TRADE_META[trade], w = when(), pros = prosFor(trade, city), items = P.itemsFor(trade);
    const lead = items.length ? ` Los trabajos habituales van desde ${eur(Math.min(...items.map((i) => i.min)))} de mano de obra.` : '';
    const faqs = [
      [`¿Cuánto cobra un ${m.noun} en ${city.name}?`, items.length ? `Depende del trabajo y del barrio. Como referencia, ${items.slice(0, 2).map((i) => `${low(i.name)}: ${range(i)}`).join('; ')} (solo mano de obra, sin materiales ni IVA).` : 'Depende del trabajo, el barrio y los materiales. Pide presupuestos para conocer el precio real.'],
      [`¿Cómo encuentro un ${m.noun} en ${city.name}?`, 'Cuenta el problema al asistente de Oficio Cerca y publica el pedido: los profesionales de tu zona te envían presupuestos y tú eliges. También puedes buscar por oficio y dirección.'],
      [`¿Los ${m.plural} de ${city.name} van a mi barrio?`, `Cada profesional indica hasta dónde se desplaza. Solo te mostramos a los que llegan a tu dirección${city.zones.length ? `, por ejemplo en ${city.zones.slice(0, 4).join(', ')}` : ''}.`],
    ];
    const body = `<section class="hero"><div class="hero-inner">
      <h1>${esc(cap(m.noun))} en ${esc(city.name)}</h1>
      <p class="lead">Pide presupuestos a ${esc(m.plural)} que se desplazan hasta tu casa en ${esc(city.name)}.${esc(lead)}</p>
      <a class="btn big" href="/#/pedir">Pedir un ${esc(m.noun)} en ${esc(city.name)}</a>
      ${pros.length ? `<div class="proof"><span><b>${pros.length}</b> ${pros.length === 1 ? 'profesional llega' : 'profesionales llegan'} al centro de ${esc(city.name)}</span>${avg(pros) ? `<span><b>${avg(pros).toLocaleString('es-ES', { minimumFractionDigits: 1 })} ★</b> valoración media</span>` : ''}</div>` : ''}
    </div></section>
    <section class="wrap">
      ${crumbHtml([['Inicio', '/'], [cap(m.plural), `/servicios/${m.slug}`], [city.name, `/servicios/${m.slug}/${city.slug}`]])}
      ${pros.length ? `<h2 class="section-title">Mejor valorados en ${esc(city.name)}</h2><div class="featured">${proCards(pros)}</div>`
        : `<div class="empty"><h3>Estamos incorporando ${esc(m.plural)} en ${esc(city.name)}</h3><p>Publica tu pedido y avisaremos a los profesionales de la zona en cuanto se unan, o crea tu perfil si eres ${esc(m.noun)}.</p>
        <div class="empty-actions"><a class="btn" href="/#/pedir">Pedir presupuestos</a><a class="btn ghost" href="/#/registro?role=pro">Soy ${esc(m.noun)} en ${esc(city.name)}</a></div></div>`}
      <h2 class="section-title">Zonas de ${esc(city.name)}</h2>
      <div class="chips-links">${city.zones.map((z) => `<span>${esc(z)}</span>`).join('')}</div>
      ${items.length ? `<h2 class="section-title">Precios de referencia</h2>${priceTable(items.slice(0, 4), trade)}<p><a href="/precios/${m.slug}">Ver todos los precios de ${esc(m.noun)} →</a></p>${disclaimer(w)}` : ''}
      <h2 class="section-title">Preguntas frecuentes</h2>
      ${faqHtml(faqs)}
      <h2 class="section-title">Otras ciudades</h2>
      <div class="chips-links">${CITIES.filter((c) => c !== city).map((c) => `<a href="/servicios/${m.slug}/${c.slug}">${esc(cap(m.noun))} en ${esc(c.name)}</a>`).join('')}</div>
      ${ctaBox(`Recibe presupuestos de ${m.plural} de ${city.name}. Gratis y sin compromiso.`)}
    </section>`;
    res.send(layout(req, {
      title: `${cap(m.noun)} en ${city.name}: presupuestos y precios (${w.year}) | Oficio Cerca`,
      desc: `Encuentra un ${m.noun} en ${city.name}. Compara presupuestos y reseñas de profesionales que se desplazan hasta tu casa. Gratis.`,
      path: `/servicios/${m.slug}/${city.slug}`, body, noindex: !pros.length,
      ld: [crumbs(req, [['Inicio', '/'], [cap(m.plural), `/servicios/${m.slug}`], [city.name, `/servicios/${m.slug}/${city.slug}`]]), faqLd(faqs)],
    }));
  });

  // ---------- robots y sitemap ----------
  app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin(req)}/sitemap.xml\n`));
  app.get('/sitemap.xml', (req, res) => {
    const o = origin(req), urls = ['/', '/precios'];
    for (const t of Object.keys(P.TRADE_META)) {
      const m = P.TRADE_META[t], its = P.itemsFor(t);
      if (its.length) { urls.push(`/precios/${m.slug}`); its.forEach((i) => urls.push(`/precios/${m.slug}/${i.slug}`)); }
      urls.push(`/servicios/${m.slug}`);
      CITIES.forEach((c) => { if (prosFor(t, c).length) urls.push(`/servicios/${m.slug}/${c.slug}`); });
    }
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(o + u)}</loc></url>`).join('\n')}\n</urlset>\n`);
  });

  // ---------- APIs de las herramientas ----------
  const hits = new Map();
  const limited = (ip) => { const t = Date.now(), l = (hits.get(ip) || []).filter((x) => t - x < 10 * 60 * 1000); l.push(t); hits.set(ip, l); if (hits.size > 5000) hits.clear(); return l.length > 60; };
  const out = (it) => ({ trade: it.trade, trade_slug: it.slugTrade, slug: it.slug, name: it.name, min: it.min, max: it.max, note: it.note });
  const guard = (req, res) => { if (limited(req.ip)) { res.status(429).json({ error: 'Demasiadas consultas seguidas. Espera unos minutos.' }); return false; } return true; };

  app.post('/api/tools/estimate', (req, res) => {
    if (!guard(req, res)) return;
    const text = String(req.body?.text || '').slice(0, 300);
    if (text.trim().length < 3) return res.status(400).json({ error: 'Cuéntanos qué necesitas' });
    const found = P.match(text, 3);
    res.json({ matches: found.map(out), measured: found[0] ? P.measured(db, found[0].trade) : null });
  });

  app.post('/api/tools/compare', (req, res) => {
    if (!guard(req, res)) return;
    const text = String(req.body?.text || '').slice(0, 300), amount = Number(req.body?.amount);
    if (text.trim().length < 3) return res.status(400).json({ error: 'Describe el trabajo' });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return res.status(400).json({ error: 'Indica el importe en euros' });
    const item = P.match(text, 1)[0];
    if (!item) return res.json({ match: null });
    res.json({ match: out(item), amount, verdict: P.verdict(item, amount) });
  });

  return { CITIES };
};
