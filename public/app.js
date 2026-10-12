'use strict';
/* Oficio Cerca — SPA sin framework (Leaflet para mapas, iconos Lucide en icons.js) */

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const state = {
  token: localStorage.getItem('token'),
  me: null, pro: null, unread: 0, pending: { total: 0 },
  trades: [], config: { demo: false, pay: { mode: 'off', fee_pct: 10, release_hours: 72 } }, isAdmin: false,
  loc: JSON.parse(localStorage.getItem('loc') || 'null'), // {lat,lng,label}
};
let maps = [];
let poller = null;
const DEFAULT_CENTER = { lat: 40.4168, lng: -3.7038 };

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (v == null ? '' : `${Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`);
const dec = (v) => Number(v).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const initials = (name) => esc(String(name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase());
const fmtDate = (iso) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const firstName = (n) => String(n || '').split(' ')[0];

const TRADE_ICON = {
  'Plomero / Fontanero': 'wrench', Gasista: 'flame', Electricista: 'zap', Cerrajero: 'key-round', Pintor: 'paint-roller',
  Albañil: 'brick-wall', Carpintero: 'hammer', Climatización: 'snowflake', Jardinero: 'trees', Limpieza: 'sparkles',
  Mudanzas: 'truck', Manitas: 'drill', Cristalero: 'app-window', Techador: 'house', Herrero: 'anvil', 'Instalador de suelos': 'layout-grid',
};
const tradeIcon = (t, cls = '') => icon(TRADE_ICON[t] || 'wrench', cls);
const tradeHue = (t) => [...String(t)].reduce((a, c) => a + c.charCodeAt(0), 0) * 37 % 360;

function stars(r, size = '') {
  const v = Math.round((r || 0) * 2) / 2;
  let out = '';
  for (let i = 1; i <= 5; i++) out += v >= i ? '<span class="star on">★</span>' : v >= i - 0.5 ? '<span class="star half">★</span>' : '<span class="star off">☆</span>';
  const label = r ? `${dec(r)} de 5 estrellas` : 'Sin valoraciones';
  return `<span class="stars ${size}" role="img" aria-label="${label}" title="${label}">${out}</span>`;
}
// Profesionales sin foto: icono de su oficio. Resto de usuarios: iniciales.
function avatar(p, cls = '') {
  if (p.photo) return `<img class="avatar ${cls}" src="${esc(p.photo)}" alt="Foto de ${esc(p.name)}">`;
  if (p.trade) return `<div class="avatar ${cls} trade-av" style="--h:${tradeHue(p.trade)}" role="img" aria-label="${esc(p.name)}">${tradeIcon(p.trade)}</div>`;
  return `<div class="avatar ${cls} ph" style="--h:${(p.id * 47) % 360}" role="img" aria-label="${esc(p.name)}">${initials(p.name)}</div>`;
}
function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `show ${kind}`;
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = ''), 3500);
}
async function api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 20000);
  let res;
  try {
    res = await fetch(path, {
      method: opts.method || 'GET', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'El servidor está tardando demasiado en responder.' : 'No hay conexión con el servidor.');
  } finally { clearTimeout(timer); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token && path !== '/api/auth/login') logoutLocal();
  if (!res.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}
function qs(obj) { return Object.entries(obj).filter(([, v]) => v !== '' && v != null && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); }
function parseHash() {
  const h = location.hash.slice(1) || '/';
  const [p, q] = h.split('?');
  return { parts: p.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(q || '')) };
}
function go(hash) { location.hash = hash; }
function errorBox(msg, retry) {
  return `<div class="empty"><h3>Algo ha fallado</h3><p>${esc(msg)}</p>
    <p class="muted small">Si es la primera visita en un rato, el servidor puede estar despertando. Suele tardar menos de un minuto.</p>
    <button class="btn" data-retry>Reintentar</button></div>`;
}
function bindRetry(root, fn) { const b = root.querySelector('[data-retry]'); if (b) b.onclick = fn; }

// ---------- ubicación ----------
function setLoc(loc) { state.loc = loc; localStorage.setItem('loc', JSON.stringify(loc)); }
function browserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Tu navegador no permite geolocalización'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error('No se pudo obtener tu ubicación. Escribe tu dirección o marca en el mapa.')),
      { enableHighAccuracy: true, timeout: 10000 });
  });
}
// Etiqueta limpia: "Calle 12, Barrio, Ciudad" sin repeticiones ni comarcas
function cleanLabel(parts) {
  const out = [];
  parts.filter(Boolean).forEach((p) => { if (!out.some((o) => o.toLowerCase() === String(p).toLowerCase())) out.push(p); });
  return out.slice(0, 3).join(', ');
}
function labelFromNominatim(a = {}) {
  const street = a.road ? `${a.road}${a.house_number ? ` ${a.house_number}` : ''}` : '';
  return cleanLabel([street, a.suburb || a.neighbourhood || a.quarter, a.city || a.town || a.village || a.municipality]);
}
function labelFromPhoton(p = {}) {
  const street = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : '';
  return cleanLabel([p.type === 'street' || p.type === 'house' ? street || p.name : p.name, p.district || p.locality, p.city || p.county, p.postcode && !p.city ? p.postcode : '']);
}
async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1&accept-language=es`);
    const d = await r.json();
    return labelFromNominatim(d.address) || 'Mi ubicación';
  } catch { return 'Mi ubicación'; }
}
async function geocode(text) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&accept-language=es&q=${encodeURIComponent(text)}`);
  const d = await r.json();
  if (!d.length) throw new Error('No encontramos esa dirección');
  return { lat: Number(d[0].lat), lng: Number(d[0].lon), label: labelFromNominatim(d[0].address) || text };
}
// Autocompletado con Photon (Nominatim no permite autocompletar)
async function suggest(text) {
  const c = state.loc || DEFAULT_CENTER;
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=5&lat=${c.lat}&lon=${c.lng}`);
  const d = await r.json();
  return (d.features || []).map((f) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: labelFromPhoton(f.properties) }))
    .filter((s, i, a) => s.label && a.findIndex((x) => x.label === s.label) === i);
}
async function useMyLocation() {
  const p = await browserLocation();
  return { ...p, label: await reverseGeocode(p.lat, p.lng) };
}

// ---------- mapas ----------
function newMap(el, center, zoom = 12) {
  const m = L.map(el, { scrollWheelZoom: true }).setView([center.lat, center.lng], zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
  maps.push(m);
  return m;
}
const pinIcon = (label, cls = '') => L.divIcon({ className: '', html: `<div class="pin ${cls}"><span>${label}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 34] });
const meMarker = (lat, lng) => L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }) });
function clearView() {
  maps.forEach((m) => m.remove()); maps = [];
  if (poller) { clearInterval(poller); poller = null; }
  document.body.classList.remove('menu-open');
}

// ---------- animación al hacer scroll ----------
const revealer = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); } }), { threshold: 0.12 })
  : null;
function reveal() {
  document.querySelectorAll('.reveal:not(.in)').forEach((el) => (revealer ? revealer.observe(el) : el.classList.add('in')));
}

// ---------- sesión y cabecera ----------
async function loadMe() {
  if (!state.token) { state.me = null; state.pro = null; state.unread = 0; state.pending = { total: 0 }; return; }
  try {
    const d = await api('/api/me');
    state.me = d.user; state.pro = d.pro; state.unread = d.unread; state.pending = d.pending || { total: 0 }; state.isAdmin = !!d.is_admin;
  } catch { state.me = null; }
}
function logoutLocal() {
  state.token = null; state.me = null; state.pro = null; state.pending = { total: 0 }; state.isAdmin = false;
  localStorage.removeItem('token');
  renderNav();
}
function renderNav() {
  const m = state.me;
  $nav.innerHTML = `
    <a href="#/pedir">${icon('sparkles')} Pedir presupuestos</a>
    <a href="#/buscar">${icon('search')} Buscar</a>
    <a href="/precios">${icon('euro')} Precios</a>
    ${m ? `
      <a href="#/pedidos">${icon('receipt')} Pedidos${state.pending.total ? `<span class="badge">${state.pending.total}</span>` : ''}</a>
      ${state.pro && state.config.pay.mode !== 'off' ? `<a href="#/cobros">${icon('euro')} Cobros</a>` : ''}
      ${state.isAdmin ? `<a href="#/admin">${icon('shield-check')} Admin</a>` : ''}
      <a href="#/mensajes">${icon('message-circle')} Mensajes${state.unread ? `<span class="badge">${state.unread}</span>` : ''}</a>
      <a href="#/panel">${icon('user-round')} ${m.role === 'pro' ? 'Mi perfil profesional' : 'Mi cuenta'}</a>
      <a href="#" id="logout" class="muted">Salir</a>`
    : `<a href="#/profesionales">Soy profesional</a><a href="#/login">Entrar</a>
       <a href="#/registro" class="btn small">Regístrate gratis</a>`}`;
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = async (e) => { e.preventDefault(); try { await api('/api/auth/logout', { method: 'POST' }); } catch {} logoutLocal(); go('#/'); };
}
document.getElementById('menuBtn').onclick = () => document.body.classList.toggle('menu-open');
$nav.addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('menu-open'); });

// ---------- componentes ----------
function locationPicker(id) {
  return `
    <div class="locbox" id="${id}">
      <div class="ac">
        <input type="text" class="loc-input" autocomplete="off" aria-label="Tu dirección" placeholder="Dirección, barrio o código postal" value="${esc(state.loc?.label || '')}">
        <ul class="ac-list" hidden></ul>
      </div>
      <button type="button" class="btn ghost loc-gps" title="Usar mi ubicación" aria-label="Usar mi ubicación">${icon('locate-fixed')}<span class="hide-sm">Mi ubicación</span></button>
    </div>`;
}
function bindLocationPicker(id, onPick) {
  const box = document.getElementById(id);
  const input = box.querySelector('.loc-input');
  const list = box.querySelector('.ac-list');
  let chosen = state.loc && input.value === state.loc.label ? state.loc : null;
  let timer, items = [], active = -1;
  const close = () => { list.hidden = true; active = -1; };
  const choose = (s) => { chosen = s; input.value = s.label; setLoc(s); close(); onPick(s); };
  const paint = () => {
    list.innerHTML = items.map((s, i) => `<li class="${i === active ? 'on' : ''}" data-i="${i}">${icon('map-pin')} ${esc(s.label)}</li>`).join('');
    list.hidden = !items.length;
    list.querySelectorAll('li').forEach((li) => (li.onmousedown = (e) => { e.preventDefault(); choose(items[li.dataset.i]); }));
  };
  input.oninput = () => {
    chosen = null; clearTimeout(timer);
    const t = input.value.trim();
    if (t.length < 3) { items = []; return paint(); }
    timer = setTimeout(async () => { try { items = await suggest(t); active = -1; paint(); } catch { /* sin sugerencias */ } }, 300);
  };
  input.onkeydown = (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') close();
  };
  input.onblur = () => setTimeout(close, 150);
  box.querySelector('.loc-gps').onclick = async () => {
    const prev = input.value; input.value = 'Buscando tu ubicación…';
    try { const l = await useMyLocation(); chosen = l; input.value = l.label; setLoc(l); onPick(l); }
    catch (e) { input.value = prev; toast(e.message, 'err'); }
  };
  return async () => {
    if (chosen) return chosen;
    const txt = input.value.trim();
    if (!txt) throw new Error('Indica tu ubicación');
    const l = await geocode(txt); chosen = l; setLoc(l); return l;
  };
}
function tradeOptions(selected, { any = true } = {}) {
  return (any ? `<option value="">Todos los oficios</option>` : `<option value="">Elige…</option>`) +
    state.trades.map((t) => `<option ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('');
}
function badges(p) {
  return [
    p.verified && `<span class="tag ok">${icon('badge-check')} Verificado</span>`,
    p.emergency && `<span class="tag hot">${icon('siren')} Urgencias 24h</span>`,
    p.free_quote && '<span class="tag">Presupuesto gratis</span>',
    p.insured && `<span class="tag">${icon('shield-check')} Seguro RC</span>`,
    p.invoice && '<span class="tag">Emite factura</span>',
  ].filter(Boolean).join('');
}
function proCard(p, i) {
  return `
    <article class="card" data-id="${p.id}">
      ${avatar(p)}
      <div class="card-body">
        <div class="card-top">
          <a class="name" href="#/pro/${p.id}">${i != null ? `<span class="num">${i + 1}</span>` : ''}${esc(p.name)}</a>
          <span class="price">${p.price_hour ? `${money(p.price_hour)}<small>/h</small>` : ''}</span>
        </div>
        <div class="trade">${tradeIcon(p.trade)} ${esc(p.trade)}${p.trades_extra.length ? ` <span class="muted">· ${p.trades_extra.map(esc).join(', ')}</span>` : ''}</div>
        <div class="rating">${stars(p.avg_rating)} <b>${p.avg_rating ? dec(p.avg_rating) : '—'}</b> <span class="muted">(${p.review_count} ${p.review_count === 1 ? 'reseña' : 'reseñas'})</span></div>
        <p class="headline">${esc(p.headline)}</p>
        <div class="meta">
          ${p.distance_km != null ? `<span>${icon('map-pin')} a ${dec(p.distance_km)} km</span>` : ''}
          <span>${icon('truck')} hasta ${p.radius_km} km</span><span>${icon('briefcase')} ${p.years_exp} años</span></div>
        <div class="tags">${badges(p)}</div>
      </div>
    </article>`;
}
function bindCards(root) {
  root.querySelectorAll('.card').forEach((c) => (c.onclick = (e) => { if (!e.target.closest('a')) go(`#/pro/${c.dataset.id}`); }));
}

// ---------- vistas ----------
async function viewHome() {
  $app.innerHTML = `
    <section class="hero">
      <div class="hero-inner">
        <h1>El profesional que necesitas,<br><em>a la vuelta de la esquina.</em></h1>
        <p class="lead">Cuéntanos qué pasa en casa y recibe presupuestos de fontaneros, electricistas, gasistas y más. Solo te avisamos a quien realmente se desplaza hasta tu dirección.</p>
        <form class="askhero" id="ask">
          <label class="sr-only" for="askq">Cuéntanos qué pasa en casa</label>
          <textarea id="askq" rows="2" maxlength="1500" placeholder="Ej.: Se ha atascado el fregadero de la cocina y no baja el agua"></textarea>
          <button class="btn big">${icon('sparkles')} Pedir presupuestos</button>
        </form>
        <div class="quick" id="hquick">${QUICK.map((t) => `<button type="button" class="chip-btn">${esc(t)}</button>`).join('')}</div>
        <p class="or-search">¿Prefieres elegir tú? Busca por oficio y zona:</p>
        <form class="searchbar" id="hs">
          <select name="trade" aria-label="Oficio">${tradeOptions('')}</select>
          ${locationPicker('hloc')}
          <button class="btn big">${icon('search')} Encontrar profesional</button>
        </form>
        <div class="proof" id="proof">
          <span>${icon('users')} <b id="st-pros">—</b> profesionales</span>
          <span>${icon('star')} <b id="st-avg">—</b> valoración media</span>
          <span>${icon('circle-check')} Gratis para clientes</span>
        </div>
      </div>
    </section>
    <section class="wrap">
      <h2 class="section-title reveal">¿Qué necesitas arreglar?</h2>
      <div class="cats reveal">
        ${state.trades.map((t) => `<button class="cat" data-t="${esc(t)}" style="--h:${tradeHue(t)}"><span class="cat-ic">${tradeIcon(t)}</span>${esc(t)}</button>`).join('')}
      </div>

      <div id="featured"></div>

      <h2 class="section-title reveal">Precios y herramientas gratis</h2>
      <div class="how reveal">
        <div><h3>¿Cuánto cuesta?</h3><p>Cuéntanos qué necesitas y te damos el rango habitual de mano de obra.</p><a href="#/presupuestador">Calcular →</a></div>
        <div><h3>¿Está bien este presupuesto?</h3><p>Compáralo con lo que suele costar ese trabajo antes de aceptarlo.</p><a href="#/comparador">Comparar →</a></div>
        <div><h3>Precios por oficio</h3><p>Fontanero, electricista, cerrajero, pintor… con rangos y preguntas frecuentes.</p><a href="/precios">Ver precios →</a></div>
      </div>

      <h2 class="section-title reveal" id="como-funciona">Cómo funciona</h2>
      <div class="how reveal">
        <div><b>1</b><h3>Cuéntanos qué pasa</h3><p>Nuestro asistente te hace un par de preguntas y prepara el pedido. También puedes buscar tú por oficio y zona.</p></div>
        <div><b>2</b><h3>Recibe presupuestos</h3><p>Los profesionales verificados que llegan a tu dirección te envían su precio. Compara valoraciones, materiales y disponibilidad.</p></div>
        <div><b>3</b><h3>Elige y habla</h3><p>Acepta el presupuesto que prefieras y coordina el día y la hora por el chat del pedido.</p></div>
      </div>

      <div class="trust reveal">
        <div class="trust-ic">${icon('shield-check')}</div>
        <div>
          <h2>Qué significa «Verificado»</h2>
          <p>Los profesionales con esta insignia nos han enviado su documento de identidad, su licencia o carné profesional cuando el oficio lo exige (gas, electricidad, climatización) y su seguro de responsabilidad civil, y los hemos revisado.</p>
          <ul class="checklist"><li>${icon('check')} Identidad comprobada</li><li>${icon('check')} Licencia o carné del oficio</li><li>${icon('check')} Seguro de responsabilidad civil</li></ul>
        </div>
      </div>

      <div id="reviews-home"></div>

      <h2 class="section-title reveal">Preguntas frecuentes</h2>
      <div class="faq reveal">
        <details><summary>¿Es gratis?</summary><p>${state.config.pay.mode === 'off'
          ? 'Sí. Buscar, comparar y contactar con profesionales es gratis. Tampoco cobramos comisión a los profesionales por los trabajos que acuerdan.'
          : `Para ti sí: pedir presupuestos, comparar y contactar es gratis y pagas exactamente el presupuesto que aceptes. El profesional paga una comisión del ${state.config.pay.fee_pct} % solo sobre los trabajos que cobra a través de la plataforma.`}</p></details>
        ${state.config.pay.mode === 'off' ? '' : `<details><summary>¿Cómo funciona el pago?</summary><p>Al aceptar un presupuesto pagas en la plataforma y retenemos el dinero. Se libera al profesional cuando confirmas que el trabajo está hecho (o ${state.config.pay.release_hours} horas después de que él lo marque como terminado, si no reclamas). Si algo sale mal, abre una reclamación y el pago queda congelado hasta que lo revisemos.</p></details>`}
        <details><summary>¿Cómo se verifican los profesionales?</summary><p>Revisamos su identidad, su licencia o carné cuando el oficio lo exige y su seguro de responsabilidad civil. Los que pasan la revisión llevan la insignia «Verificado».</p></details>
        <details><summary>¿Por qué no veo a todos los profesionales de mi ciudad?</summary><p>Cada profesional indica hasta dónde se desplaza. Solo te mostramos a quienes llegan a tu dirección, para que no pierdas el tiempo.</p></details>
        <details><summary>¿Cómo funciona pedir presupuestos?</summary><p>Cuentas tu problema al asistente (puedes añadir fotos), publicas el pedido y los profesionales de tu zona y oficio te envían presupuestos. Tú eliges, aceptas y coordináis por el chat del pedido. Pedir es gratis y sin compromiso.</p></details>
        <details><summary>¿La IA decide algo por mí?</summary><p>No. El asistente solo te ayuda a describir el problema y a elegir el tipo de profesional. Cualquier precio que te muestre es una referencia orientativa de mano de obra, no un presupuesto: el precio real lo ponen los profesionales.</p></details>
        <details><summary>¿Cómo acuerdo el precio?</summary><p>Con los presupuestos de tu pedido. Si prefieres elegir tú a un profesional concreto, también puedes escribirle desde su perfil y acordar una propuesta de precio en el chat.</p></details>
        <details><summary>¿Qué pasa si hay un problema con el trabajo?</summary><p>Habla primero con el profesional desde el chat. Después deja una reseña honesta: el profesional puede responder públicamente. Si crees que un perfil incumple las normas, escríbenos desde la página de contacto.</p></details>
      </div>

      <div class="pro-cta reveal">
        <div><h2>¿Eres profesional?</h2><p>Crea tu perfil gratis, marca hasta dónde te desplazas y recibe clientes de tu zona.</p></div>
        <a class="btn big light" href="#/profesionales">Consigue clientes en tu zona</a>
      </div>
    </section>`;
  const getLoc = bindLocationPicker('hloc', () => {});
  const doSearch = async (trade) => {
    try { const l = await getLoc(); go(`#/buscar?${qs({ trade, lat: l.lat.toFixed(5), lng: l.lng.toFixed(5) })}`); }
    catch (e) { toast(e.message, 'err'); }
  };
  document.getElementById('hs').onsubmit = (e) => { e.preventDefault(); doSearch(e.target.trade.value); };
  const askNow = (text) => { const t = String(text || '').trim(); go(t ? `#/pedir?${qs({ q: t })}` : '#/pedir'); };
  document.getElementById('ask').onsubmit = (e) => { e.preventDefault(); askNow(document.getElementById('askq').value); };
  document.getElementById('askq').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askNow(e.target.value); } };
  document.querySelectorAll('#hquick button').forEach((b) => (b.onclick = () => askNow(b.textContent)));
  document.querySelectorAll('.cat').forEach((b) => (b.onclick = () => doSearch(b.dataset.t)));
  reveal();

  // Datos de la home (si fallan, la página sigue siendo útil)
  api('/api/stats').then((st) => {
    if (!document.getElementById('st-pros')) return;
    document.getElementById('st-pros').textContent = st.pros.toLocaleString('es-ES');
    document.getElementById('st-avg').textContent = st.avg_rating ? `${dec(st.avg_rating)} ★` : '—';
    if (st.recent_reviews.length) {
      document.getElementById('reviews-home').innerHTML = `
        <h2 class="section-title reveal">Opiniones recientes de clientes</h2>
        <div class="quotes reveal">${st.recent_reviews.map((r) => `
          <figure><blockquote>${esc(r.comment)}</blockquote>
          <figcaption>${stars(r.rating)}<span><b>${esc(r.author)}</b> sobre <a href="#/pro/${r.pro_id}">${esc(r.pro_name)}</a>, ${esc(r.trade.toLowerCase())}</span></figcaption></figure>`).join('')}</div>`;
      reveal();
    }
  }).catch(() => document.getElementById('proof')?.remove());
  const c = state.loc;
  api(`/api/featured?${c ? qs({ lat: c.lat, lng: c.lng }) : ''}`).then((list) => {
    const el = document.getElementById('featured');
    if (!el || !list.length) return;
    el.innerHTML = `<h2 class="section-title reveal">Profesionales destacados ${c ? 'cerca de ti' : ''}</h2>
      <div class="featured reveal">${list.map((p) => proCard(p)).join('')}</div>`;
    bindCards(el); reveal();
  }).catch(() => {});
}

async function viewSearch(query) {
  const lat = Number(query.lat) || state.loc?.lat, lng = Number(query.lng) || state.loc?.lng;
  const hasFilters = query.q || query.minRating || query.emergency || query.freeQuote || query.insured;
  $app.innerHTML = `
    <div class="search-layout">
      <div class="search-side">
        <form class="filters" id="sf">
          <div class="row">
            <select name="trade" aria-label="Oficio">${tradeOptions(query.trade || '')}</select>
            ${locationPicker('sloc')}
          </div>
          <div class="row">
            <input name="q" aria-label="Palabra clave" placeholder="Palabra clave (caldera, persiana…)" value="${esc(query.q || '')}">
            <select name="minRating" aria-label="Valoración mínima">
              <option value="">Cualquier valoración</option>
              ${[3, 4, 4.5].map((v) => `<option value="${v}" ${query.minRating == v ? 'selected' : ''}>${dec(v)}+ ★</option>`).join('')}
            </select>
            <select name="sort" aria-label="Ordenar">
              ${[['distance', 'Más cercanos'], ['rating', 'Mejor valorados'], ['reviews', 'Más reseñas'], ['price', 'Precio/hora más bajo']]
                .map(([v, l]) => `<option value="${v}" ${query.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="row checks">
            <label><input type="checkbox" name="emergency" ${query.emergency ? 'checked' : ''}> Urgencias 24h</label>
            <label><input type="checkbox" name="freeQuote" ${query.freeQuote ? 'checked' : ''}> Presupuesto gratis</label>
            <label><input type="checkbox" name="insured" ${query.insured ? 'checked' : ''}> Con seguro</label>
            <button class="btn">Aplicar</button>
          </div>
        </form>
        <div id="results" class="results"><div class="empty"><div class="spinner"></div>Buscando profesionales…</div></div>
      </div>
      <div class="search-map"><div id="smap"></div></div>
    </div>`;

  const form = document.getElementById('sf');
  const submit = async (forced, extra = {}) => {
    try {
      const l = forced || await getLoc();
      const f = form.elements;
      go(`#/buscar?${qs({ trade: f.trade.value, lat: l.lat.toFixed(5), lng: l.lng.toFixed(5), q: f.q.value,
        minRating: f.minRating.value, sort: f.sort.value,
        emergency: f.emergency.checked ? 1 : '', freeQuote: f.freeQuote.checked ? 1 : '', insured: f.insured.checked ? 1 : '', ...extra })}`);
    } catch (e) { toast(e.message, 'err'); }
  };
  const getLoc = bindLocationPicker('sloc', (l) => submit(l));
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  ['trade', 'minRating', 'sort', 'emergency', 'freeQuote', 'insured'].forEach((n) => (form.elements[n].onchange = () => submit()));

  const $res = document.getElementById('results');
  const map = newMap('smap', lat ? { lat, lng } : DEFAULT_CENTER, lat ? 12 : 6);
  map.on('click', async (e) => {
    const l = { lat: e.latlng.lat, lng: e.latlng.lng, label: await reverseGeocode(e.latlng.lat, e.latlng.lng) };
    setLoc(l); submit(l);
  });
  if (!lat || !lng) {
    $res.innerHTML = `<div class="empty"><h3>¿Dónde necesitas el servicio?</h3><p>Escribe tu dirección arriba, pulsa ${icon('locate-fixed')} o haz clic en el mapa.</p></div>`;
    return;
  }
  meMarker(lat, lng).addTo(map).bindTooltip('Tu ubicación');

  const load = async () => {
    $res.innerHTML = '<div class="empty"><div class="spinner"></div>Buscando profesionales…</div>';
    let data;
    try {
      data = await api(`/api/search?${qs({ lat, lng, trade: query.trade, q: query.q, minRating: query.minRating, sort: query.sort, emergency: query.emergency, freeQuote: query.freeQuote, insured: query.insured })}`);
    } catch (e) { $res.innerHTML = errorBox(e.message); bindRetry($res, load); return; }
    render(data);
  };

  const render = (data) => {
    if (!data.count) {
      $res.innerHTML = `
        <div class="empty">
          <h3>${query.trade ? `Ningún profesional de «${esc(query.trade)}» llega hasta aquí` : 'Ningún profesional llega hasta aquí'}</h3>
          <p>Prueba a quitar filtros o a buscar en una dirección cercana.</p>
          <div class="empty-actions">
            ${hasFilters ? '<button class="btn ghost" id="clearF">Quitar filtros</button>' : ''}
            ${query.trade ? '<button class="btn ghost" id="allT">Ver todos los oficios</button>' : ''}
            <a class="btn ghost" href="#/registro?role=pro">¿Eres profesional en esta zona? Sé el primero</a>
          </div>
          <form id="alertF" class="alert-form">
            <label for="alertEmail">${icon('bell')} Avísame cuando haya profesionales aquí</label>
            <div class="inline"><input id="alertEmail" type="email" required placeholder="tu@email.com" value="${esc(state.me?.email || '')}"><button class="btn">Avisarme</button></div>
          </form>
        </div>`;
      const cf = document.getElementById('clearF');
      if (cf) cf.onclick = () => go(`#/buscar?${qs({ trade: query.trade, lat, lng, sort: query.sort })}`);
      const at = document.getElementById('allT');
      if (at) at.onclick = () => go(`#/buscar?${qs({ lat, lng, sort: query.sort })}`);
      document.getElementById('alertF').onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api('/api/alerts', { method: 'POST', body: { email: e.target.alertEmail.value, trade: query.trade, lat, lng, label: state.loc?.label } });
          e.target.outerHTML = `<p class="ok-text">${icon('check')} Te avisaremos cuando haya profesionales en tu zona.</p>`;
        } catch (err) { toast(err.message, 'err'); }
      };
      return;
    }
    $res.innerHTML = `<p class="count"><b>${data.count}</b> ${data.count === 1 ? 'profesional se desplaza' : 'profesionales se desplazan'} hasta tu ubicación</p>` +
      data.results.map((p, i) => proCard(p, i)).join('');

    const markers = {};
    let circle = null;
    const bounds = L.latLngBounds([[lat, lng]]);
    data.results.forEach((p, i) => {
      const mk = L.marker([p.base_lat, p.base_lng], { icon: pinIcon(i + 1), alt: p.name }).addTo(map)
        .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.trade)}<br>${stars(p.avg_rating)} (${p.review_count})<br><a href="#/pro/${p.id}">Ver perfil →</a>`);
      markers[p.id] = { mk, p, i };
      bounds.extend([p.base_lat, p.base_lng]);
    });
    map.fitBounds(bounds.pad(0.15), { maxZoom: 13 });
    const highlight = (id, on) => {
      const m = markers[id]; if (!m) return;
      m.mk.setIcon(pinIcon(m.i + 1, on ? 'active' : ''));
      if (circle) { circle.remove(); circle = null; }
      if (on) circle = L.circle([m.p.base_lat, m.p.base_lng], { radius: m.p.radius_km * 1000, color: '#c2410c', weight: 1.5, fillOpacity: 0.08 }).addTo(map);
    };
    $res.querySelectorAll('.card').forEach((c) => {
      c.onmouseenter = () => highlight(c.dataset.id, true);
      c.onmouseleave = () => highlight(c.dataset.id, false);
    });
    bindCards($res);
  };
  load();
}

async function viewPro(id) {
  $app.innerHTML = '<div class="wrap empty"><div class="spinner"></div></div>';
  let p;
  try { p = await api(`/api/pros/${id}`); }
  catch (e) { $app.innerHTML = `<div class="wrap">${errorBox(e.message)}</div>`; bindRetry($app, () => viewPro(id)); return; }
  const me = state.me;
  const isMe = me && me.id === p.id;
  const myReview = me && p.reviews.find((r) => r.user_id === me.id);
  const total = p.review_count || 0;
  const dist = state.loc && p.base_lat ? haversine(state.loc, { lat: p.base_lat, lng: p.base_lng }) : null;
  const reaches = dist != null ? dist <= p.radius_km : null;
  const next = encodeURIComponent(location.hash);
  const hasContact = p.has_phone || p.has_whatsapp || p.has_email;

  $app.innerHTML = `
    <div class="wrap profile">
      <div class="profile-main">
        <a href="javascript:history.back()" class="back">${icon('arrow-left')} Volver</a>
        <header class="phead">
          ${avatar(p, 'xl')}
          <div>
            <h1>${esc(p.name)} ${p.verified ? `<span class="tag ok">${icon('badge-check')} Verificado</span>` : ''}</h1>
            <div class="trade big">${tradeIcon(p.trade)} ${esc(p.trade)}${p.trades_extra.length ? ` <span class="muted">· ${p.trades_extra.map(esc).join(' · ')}</span>` : ''}</div>
            <div class="rating">${stars(p.avg_rating, 'lg')} <b>${p.avg_rating ? dec(p.avg_rating) : 'Sin valoraciones'}</b> <span class="muted">· ${total} ${total === 1 ? 'reseña' : 'reseñas'} · en Oficio Cerca desde ${new Date(p.member_since).getFullYear()}</span></div>
            ${p.headline ? `<p class="headline big">${esc(p.headline)}</p>` : ''}
            <div class="tags">${badges(p)}</div>
          </div>
        </header>
        ${!p.active ? '<div class="notice">Este perfil está pausado y no aparece en las búsquedas.</div>' : ''}

        <section class="facts">
          <div><span>Precio orientativo</span><b>${p.price_hour ? `${money(p.price_hour)}/h` : 'A consultar'}</b></div>
          <div><span>Desplazamiento</span><b>${p.callout_fee ? money(p.callout_fee) : 'Incluido'}</b></div>
          <div><span>Experiencia</span><b>${p.years_exp} años</b></div>
          ${p.jobs_agreed ? `<div><span>Trabajos acordados aquí</span><b>${p.jobs_agreed}</b></div>` : ''}
        </section>

        ${p.description ? `<section><h2>Sobre mí</h2><p class="desc">${esc(p.description).replace(/\n/g, '<br>')}</p></section>` : ''}

        ${p.gallery.length ? `<section><h2>Trabajos realizados</h2><div class="gallery">${p.gallery.map((g, i) => `<a href="${esc(g)}" target="_blank"><img src="${esc(g)}" alt="Trabajo de ${esc(p.name)} (${i + 1})"></a>`).join('')}</div></section>` : ''}

        <section class="details">
          <h2>Detalles</h2>
          <dl>
            ${p.hours ? `<dt>Horario</dt><dd>${esc(p.hours)}</dd>` : ''}
            ${p.license ? `<dt>Licencia / carné</dt><dd>${esc(p.license)}</dd>` : ''}
            ${p.payment_methods.length ? `<dt>Formas de pago</dt><dd>${p.payment_methods.map(esc).join(', ')}</dd>` : ''}
            ${p.languages.length ? `<dt>Idiomas</dt><dd>${p.languages.map(esc).join(', ')}</dd>` : ''}
            <dt>Zona base</dt><dd>${esc(p.base_label || '—')}</dd>
            <dt>Radio de acción</dt><dd>Se desplaza hasta <b>${p.radius_km} km</b></dd>
          </dl>
          <div id="pmap" class="pmap" role="img" aria-label="Mapa con la zona a la que se desplaza"></div>
          ${reaches != null ? `<p class="${reaches ? 'ok-text' : 'warn-text'}">${reaches ? `${icon('check')} Llega hasta tu ubicación (a ${dec(dist)} km).` : `${icon('x')} Tu ubicación queda a ${dec(dist)} km, fuera de su radio de ${p.radius_km} km.`}</p>` : ''}
        </section>

        <section class="reviews">
          <h2>Reseñas</h2>
          <div class="rv-summary">
            <div class="rv-big"><b>${p.avg_rating ? dec(p.avg_rating) : '—'}</b>${stars(p.avg_rating)}<span class="muted">${total} ${total === 1 ? 'reseña' : 'reseñas'}</span></div>
            <div class="rv-bars">${[5, 4, 3, 2, 1].map((k) => `<div><span>${k} ★</span><i style="--w:${total ? (p.breakdown[k] / total) * 100 : 0}%"></i><span>${p.breakdown[k]}</span></div>`).join('')}</div>
          </div>
          ${me && !isMe ? `
            <form id="rvform" class="rvform">
              <h3>${myReview ? 'Editar tu reseña' : 'Deja tu reseña'}</h3>
              <div class="star-input" role="radiogroup" aria-label="Valoración">${[1, 2, 3, 4, 5].map((k) => `<button type="button" data-v="${k}" aria-label="${k} estrellas" class="${myReview && myReview.rating >= k ? 'on' : ''}">★</button>`).join('')}</div>
              <textarea name="comment" aria-label="Comentario" placeholder="¿Cómo fue el trabajo? Puntualidad, limpieza, precio…">${esc(myReview?.comment || '')}</textarea>
              <button class="btn">Publicar reseña</button>
            </form>` : !me ? `<p class="muted"><a href="#/login?next=${next}">Inicia sesión</a> para dejar una reseña.</p>` : ''}
          <div class="rv-list">
            ${p.reviews.length ? p.reviews.map((r) => `
              <div class="rv">
                <div class="rv-head"><b>${esc(r.author)}</b> ${stars(r.rating)} <span class="muted">${fmtDate(r.created_at)}</span></div>
                ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
                ${r.reply ? `<div class="reply"><b>Respuesta de ${esc(firstName(p.name))}:</b> ${esc(r.reply)}</div>` : ''}
                ${isMe ? `<button class="link reply-btn" data-id="${r.id}">${r.reply ? 'Editar respuesta' : 'Responder'}</button>` : ''}
              </div>`).join('') : '<p class="muted">Todavía no tiene reseñas. ¿Has trabajado con este profesional? Sé el primero en opinar.</p>'}
          </div>
        </section>
      </div>

      <aside class="contact">
        <div class="contact-card">
          ${isMe ? `
            <h3>Este es tu perfil</h3>
            <p class="muted">Así lo ven los clientes.</p>
            <a class="btn full" href="#/panel">Editar perfil</a>` : `
            <h3>Contactar con ${esc(firstName(p.name))}</h3>
            ${p.free_quote ? '<p class="ok-text small">Presupuesto sin compromiso</p>' : ''}
            ${me ? `
              <form id="cform">
                <textarea name="body" required aria-label="Mensaje" placeholder="Hola, necesito… ¿cuándo podrías venir?"></textarea>
                <label class="small muted" for="offerIn">Precio que propones (opcional)</label>
                <div class="inline"><input id="offerIn" name="offer" type="number" min="0" step="1" placeholder="p. ej. 60"><span>€</span></div>
                <button class="btn full">Enviar mensaje</button>
              </form>
              <div class="direct">
                ${p.phone ? `<button class="btn ghost full" id="showphone">${icon('phone')} Ver teléfono</button>` : ''}
                ${p.whatsapp ? `<a class="btn ghost full" target="_blank" rel="noopener" href="https://wa.me/${esc(p.whatsapp.replace(/\D/g, ''))}?text=${encodeURIComponent(`Hola ${p.name}, te encontré en Oficio Cerca.`)}">${icon('message-circle')} WhatsApp</a>` : ''}
                ${p.contact_email ? `<a class="btn ghost full" href="mailto:${esc(p.contact_email)}">${icon('mail')} Email</a>` : ''}
              </div>` : `
              <p class="muted small">Regístrate gratis para escribirle por el chat${hasContact ? ', ver su teléfono y contactar por WhatsApp o email' : ''}. Tardas menos de un minuto.</p>
              <a class="btn full" href="#/registro?next=${next}">Regístrate gratis para contactar</a>
              <a class="btn ghost full mt" href="#/login?next=${next}">Ya tengo cuenta</a>
              ${hasContact ? `<div class="locked">${p.has_phone ? `<span>${icon('phone')} Teléfono</span>` : ''}${p.has_whatsapp ? `<span>${icon('message-circle')} WhatsApp</span>` : ''}${p.has_email ? `<span>${icon('mail')} Email</span>` : ''}</div>` : ''}`}`}
        </div>
      </aside>
    </div>
    ${!isMe ? `<div class="mobile-cta"><button class="btn full big" id="goContact">${icon('message-circle')} Contactar con ${esc(firstName(p.name))}</button></div>` : ''}`;
  const gc = document.getElementById('goContact');
  if (gc) gc.onclick = () => document.querySelector('.contact').scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (p.base_lat) {
    const m = newMap('pmap', { lat: p.base_lat, lng: p.base_lng }, 11);
    const c = L.circle([p.base_lat, p.base_lng], { radius: p.radius_km * 1000, color: '#c2410c', weight: 1.5, fillOpacity: 0.1 }).addTo(m);
    L.marker([p.base_lat, p.base_lng], { icon: pinIcon(tradeIcon(p.trade)) }).addTo(m);
    if (state.loc) meMarker(state.loc.lat, state.loc.lng).addTo(m).bindTooltip('Tú');
    m.fitBounds(c.getBounds().pad(0.05));
  }

  const sp = document.getElementById('showphone');
  if (sp) sp.onclick = () => { sp.outerHTML = `<a class="btn ghost full" href="tel:${esc(p.phone.replace(/\s/g, ''))}">${icon('phone')} ${esc(p.phone)}</a>`; };

  const cf = document.getElementById('cform');
  if (cf) cf.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/conversations', { method: 'POST', body: { proId: p.id, body: cf.body.value, offer: cf.offer.value } });
      toast('Mensaje enviado'); go(`#/mensajes/${r.id}`);
    } catch (err) { toast(err.message, 'err'); }
  };

  const rf = document.getElementById('rvform');
  if (rf) {
    let rating = myReview?.rating || 0;
    const btns = rf.querySelectorAll('.star-input button');
    btns.forEach((b) => (b.onclick = () => { rating = Number(b.dataset.v); btns.forEach((x) => x.classList.toggle('on', Number(x.dataset.v) <= rating)); }));
    rf.onsubmit = async (e) => {
      e.preventDefault();
      if (!rating) return toast('Elige de 1 a 5 estrellas', 'err');
      try { await api(`/api/pros/${p.id}/reviews`, { method: 'POST', body: { rating, comment: rf.comment.value } }); toast('¡Gracias por tu reseña!'); viewPro(id); }
      catch (err) { toast(err.message, 'err'); }
    };
  }
  document.querySelectorAll('.reply-btn').forEach((b) => (b.onclick = async () => {
    const reply = prompt('Tu respuesta pública a esta reseña:');
    if (reply == null) return;
    try { await api(`/api/reviews/${b.dataset.id}/reply`, { method: 'POST', body: { reply } }); viewPro(id); }
    catch (err) { toast(err.message, 'err'); }
  }));
}
function haversine(a, b) {
  const R = 6371, r = (d) => (d * Math.PI) / 180;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function viewAuth(mode, query) {
  const isReg = mode === 'registro';
  const keepQ = query.next ? `?next=${encodeURIComponent(query.next)}` : '';
  $app.innerHTML = `
    <div class="auth">
      <form id="af" class="auth-card">
        <h1>${isReg ? 'Crea tu cuenta gratis' : 'Bienvenido de nuevo'}</h1>
        ${isReg ? `
          <div class="role-pick">
            <label><input type="radio" name="role" value="client" ${query.role !== 'pro' ? 'checked' : ''}><span><b>Busco profesionales</b><small>Quiero contratar un servicio</small></span></label>
            <label><input type="radio" name="role" value="pro" ${query.role === 'pro' ? 'checked' : ''}><span><b>Soy profesional</b><small>Quiero conseguir clientes</small></span></label>
          </div>
          <label>Nombre<input name="name" required autocomplete="name"></label>` : ''}
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Contraseña
          <span class="pw"><input name="password" type="password" required minlength="6" autocomplete="${isReg ? 'new-password' : 'current-password'}">
          <button type="button" class="pw-toggle" aria-label="Mostrar contraseña">${icon('eye')}</button></span>
          ${isReg ? '<small class="muted">Mínimo 6 caracteres</small>' : ''}
        </label>
        <button class="btn full big">${isReg ? 'Crear cuenta' : 'Entrar'}</button>
        ${isReg ? '<p class="muted small center">Al registrarte aceptas el <a href="#/legal/aviso-legal">aviso legal</a> y la <a href="#/legal/privacidad">política de privacidad</a>.</p>' : ''}
        <p class="muted center">${isReg ? `¿Ya tienes cuenta? <a href="#/login${keepQ}">Entra</a>` : `¿No tienes cuenta? <a href="#/registro${keepQ}">Regístrate gratis</a>`}</p>
        ${!isReg && state.config.demo ? `<div class="demo"><b>Cuentas de prueba</b> (contraseña <code>demo1234</code>)<br>
          <a href="#" data-e="cliente@demo.com">cliente@demo.com</a> · <a href="#" data-e="plomero@demo.com">plomero@demo.com</a></div>` : ''}
      </form>
    </div>`;
  const f = document.getElementById('af');
  const pwt = f.querySelector('.pw-toggle');
  pwt.onclick = () => {
    const show = f.password.type === 'password';
    f.password.type = show ? 'text' : 'password';
    pwt.innerHTML = icon(show ? 'eye-off' : 'eye');
    pwt.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
  };
  f.querySelectorAll('[data-e]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); f.email.value = a.dataset.e; f.password.value = 'demo1234'; }));
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    try {
      const r = await api(isReg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
      state.token = r.token; localStorage.setItem('token', r.token);
      await loadMe(); renderNav();
      toast(isReg ? 'Cuenta creada' : `Hola, ${firstName(r.user.name)}`);
      go(query.next || (r.user.role === 'pro' && !state.pro ? '#/panel' : '#/'));
    } catch (err) { toast(err.message, 'err'); }
  };
}

function fileToDataURL(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Imagen no válida'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- notificaciones push en este dispositivo ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function b64ToBytes(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function currentPushSub() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}
async function renderPushRow() {
  const row = document.getElementById('pushRow');
  if (!row) return;
  if (!pushSupported()) { row.innerHTML = '<p class="muted small">Este navegador no admite notificaciones push. En iPhone, añade la web a la pantalla de inicio para recibirlas.</p>'; return; }
  const sub = await currentPushSub().catch(() => null);
  const blocked = Notification.permission === 'denied';
  row.innerHTML = blocked
    ? '<p class="muted small">Las notificaciones están bloqueadas en este navegador. Actívalas en los ajustes del sitio para recibirlas.</p>'
    : `<button type="button" class="btn ghost small" id="pushBtn">${icon('bell')} ${sub ? 'Desactivar notificaciones en este dispositivo' : 'Activar notificaciones en este dispositivo'}</button>`;
  const btn = document.getElementById('pushBtn');
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    try {
      if (sub) {
        await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
        await sub.unsubscribe(); toast('Notificaciones desactivadas en este dispositivo');
      } else {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (await Notification.requestPermission() !== 'granted') throw new Error('No has dado permiso para mostrar notificaciones');
        const { key } = await api('/api/push/key');
        const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
        await api('/api/push/subscribe', { method: 'POST', body: { subscription: s.toJSON() } });
        toast('Notificaciones activadas en este dispositivo');
      }
    } catch (e) { toast(e.message, 'err'); }
    renderPushRow();
  };
}

function bindNotifs() {
  renderPushRow();
  const el = document.getElementById('notifsOn');
  if (!el) return;
  el.onchange = async () => {
    try { await api('/api/me/notifs', { method: 'PUT', body: { email_notifs: el.checked } }); state.me.email_notifs = el.checked; toast(el.checked ? 'Avisos por email activados' : 'Avisos por email desactivados'); }
    catch (e) { el.checked = !el.checked; toast(e.message, 'err'); }
  };
}
async function viewPanel() {
  if (!state.me) return go('#/login?next=%23%2Fpanel');
  await loadMe(); renderNav();
  if (state.me.role !== 'pro') {
    $app.innerHTML = `
      <div class="wrap narrow">
        <h1>Hola, ${esc(firstName(state.me.name))}</h1>
        <p class="muted">${esc(state.me.email)}</p>
        <div class="panel-links">
          <a class="tile" href="#/buscar"><b>${icon('search')} Buscar profesionales</b><span>Encuentra quién llega hasta tu casa</span></a>
          <a class="tile" href="#/mensajes"><b>${icon('message-circle')} Mis mensajes</b><span>${state.unread ? `${state.unread} sin leer` : 'Tus conversaciones y propuestas'}</span></a>
        </div>
        <label class="check"><input type="checkbox" id="notifsOn" ${state.me.email_notifs !== false ? 'checked' : ''}> Avisarme por email de presupuestos y mensajes de mis pedidos</label>
        <div id="pushRow" class="push-row"></div>
        <div class="pro-cta small"><div><h3>¿También ofreces un oficio?</h3><p>Activa tu perfil profesional con la misma cuenta.</p></div>
          <button class="btn light" id="become">Quiero ser profesional</button></div>
      </div>`;
    bindNotifs();
    document.getElementById('become').onclick = async () => { await api('/api/me/become-pro', { method: 'POST' }); viewPanel(); };
    return;
  }

  const p = state.pro || {
    name: state.me.name, trade: '', trades_extra: [], headline: '', description: '', phone: '', whatsapp: '', contact_email: state.me.email,
    photo: '', years_exp: 0, price_hour: '', callout_fee: '', free_quote: true, emergency: false, license: '', insured: false, invoice: false,
    hours: '', payment_methods: ['Efectivo', 'Bizum'], languages: ['Español'], gallery: [], base_lat: state.loc?.lat, base_lng: state.loc?.lng,
    base_label: state.loc?.label || '', radius_km: 10, active: true,
  };
  p.name = state.me.name;
  const PAY = ['Efectivo', 'Bizum', 'Transferencia', 'Tarjeta'];
  let photo = p.photo || '', gallery = [...(p.gallery || [])];

  $app.innerHTML = `
    <div class="wrap panel">
      <div class="panel-head">
        <div><h1>${state.pro ? 'Tu perfil profesional' : 'Crea tu perfil profesional'}</h1>
        <p class="muted">Los perfiles con foto, descripción y fotos de trabajos reciben muchos más mensajes.</p></div>
        ${state.pro ? `<a class="btn ghost" href="#/pro/${state.pro.id}">Ver perfil público →</a>` : ''}
      </div>
      <form id="pf" class="pform">
        <section>
          <h2>Datos básicos</h2>
          <div class="photo-row">
            <div id="photoPrev">${avatar({ ...p, id: state.me.id, photo }, 'xl')}</div>
            <div><label class="btn ghost">Subir foto<input type="file" accept="image/*" id="photoIn" hidden></label>
            ${photo ? '<button type="button" class="link" id="photoDel">Quitar</button>' : ''}
            <p class="muted small">Una foto tuya, de cara y con buena luz, genera más confianza.</p></div>
          </div>
          <div class="grid2">
            <label>Nombre que verán los clientes<input name="name" value="${esc(p.name)}" required></label>
            <label>Oficio principal<select name="trade" required>${tradeOptions(p.trade, { any: false })}</select></label>
          </div>
          <label>Titular (una frase)<input name="headline" maxlength="120" value="${esc(p.headline)}" placeholder="Ej.: Fugas, desatascos y calderas — urgencias 24h"></label>
          <label>Descripción<textarea name="description" rows="5" placeholder="Tu experiencia, qué trabajos haces, garantías…">${esc(p.description)}</textarea></label>
          <fieldset><legend>Otros oficios que también haces</legend>
            <div class="chips">${state.trades.map((t) => `<label class="chip"><input type="checkbox" name="extra" value="${esc(t)}" ${p.trades_extra.includes(t) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>
          </fieldset>
        </section>

        <section>
          <h2>Zona y radio de acción</h2>
          <p class="muted">Marca tu punto de salida (clic en el mapa o arrastra el marcador) y hasta dónde te desplazas. Solo te encontrarán clientes dentro del círculo.</p>
          ${locationPicker('ploc')}
          <div class="radius-row"><label for="radiusIn">Radio: <b id="rv">${p.radius_km}</b> km</label><input id="radiusIn" type="range" name="radius_km" min="1" max="100" value="${p.radius_km}"></div>
          <div id="panelmap" class="pmap tall"></div>
          <input type="hidden" name="base_label" value="${esc(p.base_label)}">
        </section>

        <section>
          <h2>Precios y condiciones</h2>
          <div class="grid3">
            <label>Precio orientativo (€/hora)<input name="price_hour" type="number" min="0" step="0.5" value="${p.price_hour ?? ''}"></label>
            <label>Coste de desplazamiento (€)<input name="callout_fee" type="number" min="0" step="0.5" value="${p.callout_fee ?? ''}" placeholder="Vacío = incluido"></label>
            <label>Años de experiencia<input name="years_exp" type="number" min="0" max="70" value="${p.years_exp}"></label>
          </div>
          <div class="checks">
            <label><input type="checkbox" name="free_quote" ${p.free_quote ? 'checked' : ''}> Presupuesto gratis</label>
            <label><input type="checkbox" name="emergency" ${p.emergency ? 'checked' : ''}> Atiendo urgencias 24h</label>
            <label><input type="checkbox" name="insured" ${p.insured ? 'checked' : ''}> Tengo seguro de responsabilidad civil</label>
            <label><input type="checkbox" name="invoice" ${p.invoice ? 'checked' : ''}> Emito factura</label>
          </div>
          <fieldset><legend>Formas de pago</legend>
            <div class="chips">${PAY.map((t) => `<label class="chip"><input type="checkbox" name="pay" value="${t}" ${p.payment_methods.includes(t) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
          </fieldset>
          <div class="grid2">
            <label>Horario<input name="hours" value="${esc(p.hours)}" placeholder="L–V 8:00–19:00, sábados mañana"></label>
            <label>Licencia / carné / certificación<input name="license" value="${esc(p.license)}" placeholder="Ej.: Instalador autorizado de gas nº…"></label>
          </div>
          <label>Idiomas (separados por comas)<input name="languages" value="${esc(p.languages.join(', '))}"></label>
        </section>

        <section>
          <h2>Contacto directo</h2>
          <p class="muted small">Solo lo ven los usuarios registrados.</p>
          <div class="grid3">
            <label>Teléfono<input name="phone" type="tel" value="${esc(p.phone)}" placeholder="+34 600 000 000"></label>
            <label>WhatsApp<input name="whatsapp" type="tel" value="${esc(p.whatsapp)}" placeholder="+34 600 000 000"></label>
            <label>Email de contacto<input name="contact_email" type="email" value="${esc(p.contact_email)}"></label>
          </div>
          <label class="check"><input type="checkbox" id="notifsOn" ${state.me.email_notifs !== false ? 'checked' : ''}> Avisarme por email de presupuestos y mensajes de mis pedidos</label>
          <div id="pushRow" class="push-row"></div>
          ${state.pro ? `<label class="check"><input type="checkbox" id="alertsOn" ${p.email_alerts !== false ? 'checked' : ''}> Avisarme por email (${esc(state.me.email)}) cuando haya un pedido nuevo en mi zona</label>` : ''}
        </section>

        <section>
          <h2>Fotos de trabajos (máx. 8)</h2>
          <div class="gallery edit" id="gal"></div>
          <label class="btn ghost">Añadir fotos<input type="file" accept="image/*" multiple id="galIn" hidden></label>
        </section>

        <div class="savebar">
          <label class="checks"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Perfil visible en búsquedas</label>
          <button class="btn big">Guardar perfil</button>
        </div>
      </form>
    </div>`;

  const f = document.getElementById('pf');
  const start = p.base_lat ? { lat: p.base_lat, lng: p.base_lng } : DEFAULT_CENTER;
  const map = newMap('panelmap', start, p.base_lat ? 11 : 6);
  let pos = p.base_lat ? { ...start } : null;
  let marker = null, circle = null;
  const draw = (fit) => {
    if (!pos) return;
    const r = Number(f.radius_km.value) * 1000;
    if (!marker) {
      marker = L.marker([pos.lat, pos.lng], { draggable: true, icon: pinIcon(icon('house')) }).addTo(map);
      marker.on('dragend', async () => { const ll = marker.getLatLng(); pos = { lat: ll.lat, lng: ll.lng }; draw(); setLabel(await reverseGeocode(pos.lat, pos.lng)); });
      circle = L.circle([pos.lat, pos.lng], { radius: r, color: '#c2410c', weight: 1.5, fillOpacity: 0.1 }).addTo(map);
    }
    marker.setLatLng([pos.lat, pos.lng]); circle.setLatLng([pos.lat, pos.lng]); circle.setRadius(r);
    if (fit) map.fitBounds(circle.getBounds().pad(0.1));
  };
  const setLabel = (l) => { f.base_label.value = l; document.querySelector('#ploc .loc-input').value = l; };
  draw(true);
  map.on('click', async (e) => { pos = { lat: e.latlng.lat, lng: e.latlng.lng }; draw(); setLabel(await reverseGeocode(pos.lat, pos.lng)); });
  f.radius_km.oninput = () => { document.getElementById('rv').textContent = f.radius_km.value; draw(); };
  f.radius_km.onchange = () => draw(true);
  const getLoc = bindLocationPicker('ploc', (l) => { pos = { lat: l.lat, lng: l.lng }; setLabel(l.label); draw(true); });
  document.querySelector('#ploc .loc-input').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    try { const l = await getLoc(); pos = { lat: l.lat, lng: l.lng }; setLabel(l.label); draw(true); } catch (err) { toast(err.message, 'err'); }
  });

  bindNotifs();
  const ao = document.getElementById('alertsOn');
  if (ao) ao.onchange = async () => {
    try { await api('/api/pros/me/alerts', { method: 'PUT', body: { email_alerts: ao.checked } }); toast(ao.checked ? 'Avisos por email activados' : 'Avisos por email desactivados'); }
    catch (e) { ao.checked = !ao.checked; toast(e.message, 'err'); }
  };
  const renderPhoto = () => { document.getElementById('photoPrev').innerHTML = avatar({ ...p, id: state.me.id, name: f.name.value, trade: f.trade.value || p.trade, photo }, 'xl'); };
  document.getElementById('photoIn').onchange = async (e) => { if (e.target.files[0]) { photo = await fileToDataURL(e.target.files[0], 320); renderPhoto(); } };
  const pd = document.getElementById('photoDel'); if (pd) pd.onclick = () => { photo = ''; renderPhoto(); pd.remove(); };

  const renderGal = () => {
    document.getElementById('gal').innerHTML = gallery.map((g, i) => `<div class="gi"><img src="${esc(g)}" alt="Foto de trabajo ${i + 1}"><button type="button" data-i="${i}" aria-label="Quitar foto">✕</button></div>`).join('') || '<p class="muted">Aún no has subido fotos.</p>';
    document.querySelectorAll('#gal button').forEach((b) => (b.onclick = () => { gallery.splice(Number(b.dataset.i), 1); renderGal(); }));
  };
  renderGal();
  document.getElementById('galIn').onchange = async (e) => {
    for (const file of [...e.target.files]) { if (gallery.length >= 8) break; gallery.push(await fileToDataURL(file, 900)); }
    e.target.value = ''; renderGal();
  };

  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!pos) return toast('Marca tu ubicación base en el mapa', 'err');
    const fd = new FormData(f);
    const body = {
      name: fd.get('name'), trade: fd.get('trade'), trades_extra: fd.getAll('extra'), headline: fd.get('headline'),
      description: fd.get('description'), phone: fd.get('phone'), whatsapp: fd.get('whatsapp'), contact_email: fd.get('contact_email'),
      photo, gallery, years_exp: fd.get('years_exp'), price_hour: fd.get('price_hour'), callout_fee: fd.get('callout_fee'),
      free_quote: !!fd.get('free_quote'), emergency: !!fd.get('emergency'), insured: !!fd.get('insured'), invoice: !!fd.get('invoice'),
      license: fd.get('license'), hours: fd.get('hours'), payment_methods: fd.getAll('pay'),
      languages: String(fd.get('languages') || '').split(',').map((s) => s.trim()).filter(Boolean),
      base_lat: pos.lat, base_lng: pos.lng, base_label: fd.get('base_label'), radius_km: fd.get('radius_km'), active: !!fd.get('active'),
    };
    try { const r = await api('/api/pros/me', { method: 'PUT', body }); state.pro = r; toast('Perfil guardado'); go(`#/pro/${r.id}`); }
    catch (err) { toast(err.message, 'err'); }
  };
}

async function viewMessages(convId) {
  if (!state.me) return go(`#/login?next=${encodeURIComponent(location.hash)}`);
  $app.innerHTML = `
    <div class="inbox ${convId ? 'has-conv' : ''}">
      <aside class="conv-list" id="cl"><div class="empty"><div class="spinner"></div></div></aside>
      <section class="thread" id="th">${convId ? '<div class="empty"><div class="spinner"></div></div>' : '<div class="empty"><h3>Tus conversaciones</h3><p>Elige una conversación de la lista.</p></div>'}</section>
    </div>`;

  const loadList = async () => {
    const list = await api('/api/conversations');
    const cl = document.getElementById('cl'); if (!cl) return;
    cl.innerHTML = list.length ? list.map((c) => `
      <a class="conv ${String(c.id) === String(convId) ? 'active' : ''}" href="#/mensajes/${c.id}">
        ${avatar({ id: c.other.id, name: c.other.name, photo: c.other.photo || '', trade: c.i_am_pro ? '' : c.trade })}
        <div class="conv-txt"><b>${esc(c.other.name)}</b>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}
          <small>${c.i_am_pro ? 'Cliente' : esc(c.trade || '')} · ${fmtTime(c.updated_at)}</small>
          <p>${c.last_offer != null ? `Propuesta: ${money(c.last_offer)}` : esc(c.last_body || '')}</p></div>
      </a>`).join('') : `<div class="empty"><p>Aún no tienes conversaciones.</p><a class="btn" href="#/buscar">Buscar profesionales</a></div>`;
  };

  let lastCount = -1;
  const loadThread = async (force) => {
    const d = await api(`/api/conversations/${convId}`);
    const th = document.getElementById('th'); if (!th) return;
    if (d.messages.length === lastCount && !force) return;
    const keepDraft = th.querySelector('textarea')?.value || '';
    lastCount = d.messages.length;
    const other = d.i_am_pro ? d.client : d.pro;
    th.innerHTML = `
      <header class="th-head">
        <a href="#/mensajes" class="back mobile-only" aria-label="Volver">${icon('arrow-left')}</a>
        ${avatar({ id: other.id, name: other.name, photo: other.photo || '', trade: d.i_am_pro ? '' : d.pro.trade })}
        <div class="th-txt"><b>${esc(other.name)}</b><small>${d.i_am_pro ? 'Cliente' : `${esc(d.pro.trade)} · ${stars(d.pro.avg_rating)}`}</small></div>
        ${!d.i_am_pro ? `<a class="btn ghost small" href="#/pro/${d.pro.id}">Ver perfil</a>` : ''}
      </header>
      <div class="msgs" id="msgs">
        ${d.messages.map((m) => {
          const mine = m.sender_id === state.me.id;
          return `<div class="msg ${mine ? 'mine' : ''}">
            ${m.body ? `<p>${esc(m.body).replace(/\n/g, '<br>')}</p>` : ''}
            ${m.offer_amount != null ? `
              <div class="offer ${m.offer_status}">
                <span>Propuesta de precio</span><b>${money(m.offer_amount)}</b>
                <em>${{ pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada' }[m.offer_status]}</em>
                ${m.offer_status === 'pending' && !mine ? `<div class="offer-actions"><button class="btn small" data-o="${m.id}" data-s="accepted">Aceptar</button><button class="btn ghost small" data-o="${m.id}" data-s="rejected">Rechazar</button></div>` : ''}
              </div>` : ''}
            <time>${fmtTime(m.created_at)}</time>
          </div>`;
        }).join('')}
      </div>
      <form class="composer" id="mf">
        <textarea name="body" aria-label="Mensaje" placeholder="Escribe un mensaje…" rows="2">${esc(keepDraft)}</textarea>
        <div class="composer-side">
          <input name="offer" type="number" min="0" step="1" aria-label="Proponer precio en euros" placeholder="Proponer €">
          <button class="btn">Enviar</button>
        </div>
      </form>`;
    const box = document.getElementById('msgs'); box.scrollTop = box.scrollHeight;
    th.querySelectorAll('[data-o]').forEach((b) => (b.onclick = async () => {
      try { await api(`/api/messages/${b.dataset.o}/offer`, { method: 'POST', body: { status: b.dataset.s } }); await loadThread(true); loadList(); }
      catch (e) { toast(e.message, 'err'); }
    }));
    const mf = document.getElementById('mf');
    mf.body.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mf.requestSubmit(); } };
    mf.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/api/conversations/${convId}/messages`, { method: 'POST', body: { body: mf.body.value, offer: mf.offer.value } });
        mf.body.value = ''; await loadThread(true); loadList();
      } catch (err) { toast(err.message, 'err'); }
    };
  };

  try {
    await loadList();
    if (convId) { await loadThread(true); await loadList(); }
    await loadMe(); renderNav();
  } catch (e) {
    document.getElementById('cl').innerHTML = errorBox(e.message);
    bindRetry(document.getElementById('cl'), () => viewMessages(convId));
  }
  poller = setInterval(async () => {
    try { if (convId) await loadThread(false); await loadList(); await loadMe(); renderNav(); } catch {}
  }, 5000);
}

// ---------- páginas de contenido ----------
function viewProfesionales() {
  $app.innerHTML = `
    <section class="hero pro-hero">
      <div class="hero-inner">
        <h1>Consigue clientes <em>en tu barrio</em>, sin cuotas ni permanencia.</h1>
        <p class="lead">Crea tu perfil en 5 minutos, marca hasta dónde te desplazas y recibe mensajes de clientes que están dentro de tu zona.</p>
        <a class="btn big" href="#/registro?role=pro">Crear mi perfil gratis</a>
      </div>
    </section>
    <section class="wrap">
      <div class="benefits reveal">
        <div>${icon('euro')}<h3>${state.config.pay.mode === 'off' ? 'Sin comisiones' : 'Solo pagas si cobras'}</h3><p>${state.config.pay.mode === 'off'
          ? 'El precio lo acuerdas tú con el cliente. No nos quedamos con un porcentaje de tu trabajo.'
          : `Crear tu perfil y recibir pedidos es gratis. Solo cobramos un ${state.config.pay.fee_pct} % de los trabajos que cobras por la plataforma, con el pago ya garantizado por el cliente.`}</p></div>
        <div>${icon('map-pin')}<h3>Solo clientes de tu zona</h3><p>Tú decides el radio. Nadie de fuera de tu círculo te encontrará, así que no pierdes tiempo en desplazamientos.</p></div>
        <div>${icon('star')}<h3>Tu reputación trabaja por ti</h3><p>Cada reseña buena te sube en los resultados de “Mejor valorados”. Puedes responder públicamente a cualquier opinión.</p></div>
        <div>${icon('receipt')}<h3>Pedidos de tu zona</h3><p>Recibes los pedidos de clientes de tu oficio que están dentro de tu radio, envías tu presupuesto y, si te eligen, coordináis por el chat del pedido.</p></div>
      </div>

      <h2 class="section-title reveal">Cómo te llegan los clientes</h2>
      <div class="how reveal">
        <div><b>1</b><h3>El cliente pide</h3><p>Cuenta su problema al asistente o busca por oficio y dirección.</p></div>
        <div><b>2</b><h3>Apareces si llegas</h3><p>Si su dirección está dentro de tu radio, sales en la lista y en el mapa, con tus reseñas y precio orientativo.</p></div>
        <div><b>3</b><h3>Te elige</h3><p>Ves los pedidos nuevos de tu zona, envías tu presupuesto y, si el cliente lo acepta, hablas con él por el chat. También puede escribirte desde tu perfil.</p></div>
      </div>

      <h2 class="section-title reveal">Preguntas de profesionales</h2>
      <div class="faq reveal">
        <details><summary>¿Cuánto cuesta?</summary><p>${state.config.pay.mode === 'off'
          ? 'Crear el perfil y recibir clientes es gratis, y no cobramos comisión por los trabajos.'
          : `Crear el perfil y recibir clientes es gratis. Solo hay una comisión del ${state.config.pay.fee_pct} % sobre los trabajos que cobras a través de la plataforma.`}</p></details>
        ${state.config.pay.mode === 'off' ? '' : '<details><summary>¿Cuándo cobro?</summary><p>El cliente paga al aceptar tu presupuesto y retenemos el dinero. Cuando termina el trabajo y el cliente lo confirma, te lo transferimos (si lo marcas como terminado y no hay reclamación, se libera solo pasado el plazo). Necesitas configurar tus cobros una vez.</p></details>'}
        <details><summary>¿Cómo consigo la insignia «Verificado»?</summary><p>Envíanos tu documento de identidad, tu licencia o carné si tu oficio lo exige y tu seguro de responsabilidad civil desde la página de contacto. Los revisamos y activamos la insignia.</p></details>
        <details><summary>¿Puedo pausar mi perfil?</summary><p>Sí. Desmarca «Perfil visible en búsquedas» en tu panel cuando estés de vacaciones o con la agenda llena.</p></details>
        <details><summary>¿Quién ve mi teléfono?</summary><p>Solo los usuarios registrados. Así evitas llamadas de spam y sabes que quien te contacta tiene una cuenta.</p></details>
        <details><summary>¿Puedo ofrecer varios oficios?</summary><p>Sí. Eliges un oficio principal y puedes marcar todos los secundarios que hagas.</p></details>
      </div>
      <div class="pro-cta reveal">
        <div><h2>Empieza hoy</h2><p>Tu primer cliente puede estar a pocas calles.</p></div>
        <a class="btn big light" href="#/registro?role=pro">Consigue clientes en tu zona</a>
      </div>
    </section>`;
  reveal();
}

// Textos legales base. Hay que completar los datos marcados entre [corchetes] antes de publicar.
const LEGAL = {
  'aviso-legal': ['Aviso legal', `
    <p>En cumplimiento de la Ley 34/2002, de Servicios de la Sociedad de la Información y de Comercio Electrónico (LSSI-CE), se informa de los datos del titular de este sitio web:</p>
    <ul><li><b>Titular:</b> [Nombre o razón social]</li><li><b>NIF:</b> [NIF]</li><li><b>Domicilio:</b> [Dirección]</li><li><b>Email:</b> [email de contacto]</li></ul>
    <h2>Objeto</h2><p>Oficio Cerca es una plataforma que pone en contacto a personas que necesitan un servicio con profesionales de oficios. Oficio Cerca no presta los servicios ni es parte de los acuerdos entre clientes y profesionales.</p>
    <h2>Responsabilidad</h2><p>Cada profesional es responsable de la información de su perfil y de los trabajos que realiza. Las reseñas reflejan la opinión de sus autores.</p>
    <h2>Propiedad intelectual</h2><p>El diseño y el código del sitio pertenecen a su titular. Los mapas son de OpenStreetMap y sus colaboradores.</p>`],
  privacidad: ['Política de privacidad', `
    <p>Esta política explica cómo tratamos tus datos personales conforme al Reglamento (UE) 2016/679 (RGPD) y la Ley Orgánica 3/2018 (LOPDGDD).</p>
    <h2>Responsable</h2><p>[Nombre o razón social], NIF [NIF], [email de contacto].</p>
    <h2>Qué datos tratamos</h2><ul><li>Datos de cuenta: nombre, email y contraseña (cifrada).</li><li>Datos del perfil profesional que decidas publicar: foto, descripción, zona, teléfono, etc.</li><li>Mensajes y reseñas que envías.</li><li>Ubicación: solo cuando la escribes o autorizas al navegador, para buscar profesionales cercanos. No la guardamos en el servidor salvo la zona base de los profesionales.</li></ul>
    <h2>Para qué</h2><p>Para prestar el servicio: mostrar perfiles, permitir el contacto y las reseñas. Base legal: ejecución del contrato (art. 6.1.b RGPD).</p>
    <h2>Con quién se comparten</h2><p>Los datos del perfil profesional son públicos. El contacto directo solo lo ven usuarios registrados. Usamos OpenStreetMap/Nominatim y Photon para mapas y direcciones, que reciben el texto de búsqueda. Alojamiento: [proveedor de hosting].</p>
    <h2>Tus derechos</h2><p>Puedes acceder, rectificar, suprimir, oponerte, limitar y portar tus datos escribiendo a [email de contacto]. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).</p>`],
  condiciones: ['Condiciones de pago y garantía', () => {
    const c = state.config.pay;
    return `<div class="notice">Borrador pendiente de revisión legal. Completa los datos entre [corchetes] y que lo revise un profesional antes de publicar.</div>
    <h2>Qué es Oficio Cerca</h2><p>Oficio Cerca es una plataforma de intermediación entre personas que necesitan un servicio («clientes») y profesionales autónomos que lo prestan. No presta los servicios ni es parte del contrato entre ambos.</p>
    <h2>Pago retenido</h2><p>Cuando el cliente acepta un presupuesto, paga su importe a través de la plataforma. [Titular] retiene el pago hasta que el trabajo se confirma. ${c.mode === 'off' ? 'Actualmente los pagos están desactivados.' : ''}</p>
    <h2>Comisión</h2><p>El cliente paga exactamente el importe del presupuesto aceptado. La plataforma cobra al profesional una comisión del ${c.fee_pct} % sobre ese importe, que se descuenta al liberar el pago. La comisión se factura al profesional.</p>
    <h2>Liberación del pago</h2><ul><li>Cuando el cliente confirma que el trabajo está hecho, el pago se libera al profesional.</li><li>Si el profesional marca el trabajo como terminado y el cliente no responde ni reclama en ${c.release_hours} horas, el pago se libera automáticamente.</li></ul>
    <h2>Reclamaciones y reembolsos</h2><ul><li>Mientras el pago está retenido, el cliente puede abrir una reclamación indicando el motivo. El pago queda congelado hasta que lo revise la plataforma, que podrá reembolsar al cliente o liberar al profesional.</li><li>Si el cliente cancela antes de que el profesional marque el trabajo como terminado, se le reembolsa el importe íntegro.</li><li>Las reclamaciones sobre pagos ya liberados se dirigen al profesional; esto no limita los derechos que la ley reconoce al consumidor.</li></ul>
    <h2>Importante</h2><p>Para estar cubierto, el pago y la comunicación deben hacerse dentro de la plataforma. Los trabajos o materiales fuera del presupuesto aceptado no están incluidos.</p>`;
  }],
  cookies: ['Política de cookies', `
    <p>Oficio Cerca no usa cookies de publicidad ni de analítica.</p>
    <p>Solo guardamos en el almacenamiento local de tu navegador lo imprescindible para que la web funcione: tu sesión iniciada, la última ubicación que buscaste y que ya has visto este aviso. Al ser técnicos y necesarios, no requieren consentimiento según el art. 22.2 de la LSSI-CE.</p>
    <p>Los mapas cargan imágenes de los servidores de OpenStreetMap y las tipografías se cargan desde Google Fonts.</p>`],
};
function viewLegal(slug) {
  const page = LEGAL[slug];
  if (!page) return viewNotFound();
  $app.innerHTML = `<div class="wrap narrow legal"><h1>${page[0]}</h1>${typeof page[1] === 'function' ? page[1]() : page[1]}<p class="muted small">Última actualización: ${new Date().getFullYear()}</p></div>`;
}
function viewContacto() {
  $app.innerHTML = `
    <div class="wrap narrow legal">
      <h1>Contacto</h1>
      <p>¿Tienes una duda, quieres verificar tu perfil profesional o denunciar un perfil que incumple las normas?</p>
      <p class="contact-mail">${icon('mail')} <a href="mailto:[email de contacto]">[email de contacto]</a></p>
      <p class="muted">Respondemos en 1–2 días laborables.</p>
    </div>`;
}
function viewNotFound() {
  $app.innerHTML = '<div class="wrap empty"><h2>Página no encontrada</h2><a href="#/">Volver al inicio</a></div>';
}

// ---------- aviso de almacenamiento técnico ----------
function cookieNotice() {
  if (localStorage.getItem('cookiesOk')) return;
  const el = document.createElement('div');
  el.className = 'cookie';
  el.innerHTML = `<p>Solo usamos almacenamiento técnico para mantener tu sesión y tu última búsqueda. Sin publicidad ni analítica. <a href="#/legal/cookies">Más info</a></p><button class="btn small">Entendido</button>`;
  el.querySelector('button').onclick = () => { localStorage.setItem('cookiesOk', '1'); el.remove(); };
  document.body.appendChild(el);
}

// ---------- router ----------
async function route() {
  clearView();
  window.scrollTo(0, 0);
  const { parts, query } = parseHash();
  renderNav();
  document.body.classList.toggle('full', parts[0] === 'buscar' || parts[0] === 'mensajes');
  switch (parts[0]) {
    case undefined: return viewHome();
    case 'presupuestador': return viewPresupuestador(query);
    case 'comparador': return viewComparador(query);
    case 'pedir': return viewPedir(query);
    case 'pedidos': return viewPedidos(query);
    case 'pedido': return viewPedido(parts[1], query);
    case 'cobros': return viewCobros(query);
    case 'admin': return viewAdmin();
    case 'buscar': return viewSearch(query);
    case 'pro': return viewPro(parts[1]);
    case 'login': return viewAuth('login', query);
    case 'registro': return viewAuth('registro', query);
    case 'panel': return viewPanel();
    case 'mensajes': return viewMessages(parts[1]);
    case 'profesionales': return viewProfesionales();
    case 'legal': return viewLegal(parts[1]);
    case 'contacto': return viewContacto();
    default: return viewNotFound();
  }
}

(async function init() {
  window.addEventListener('hashchange', route);
  const boot = async () => {
    try {
      [state.trades, state.config] = await Promise.all([api('/api/trades', { timeout: 60000 }), api('/api/config', { timeout: 60000 }).catch(() => ({ demo: false }))]);
      state.config.pay = state.config.pay || { mode: 'off', fee_pct: 10, release_hours: 72 };
    } catch (e) {
      $app.innerHTML = `<div class="wrap">${errorBox(e.message)}</div>`;
      bindRetry($app, boot);
      return;
    }
    if (state.config.demo) {
      const b = document.getElementById('demoBanner');
      b.hidden = false;
    }
    await loadMe();
    route();
    cookieNotice();
    setInterval(async () => { if (state.token && !document.hidden) { await loadMe(); renderNav(); } }, 30000);
  };
  boot();
})();
