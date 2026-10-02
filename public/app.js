'use strict';
/* Oficio Cerca — SPA sin dependencias (salvo Leaflet para mapas) */

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const state = {
  token: localStorage.getItem('token'),
  me: null, pro: null, unread: 0,
  trades: [],
  loc: JSON.parse(localStorage.getItem('loc') || 'null'), // {lat,lng,label}
};
let maps = [];          // instancias Leaflet activas (se destruyen al cambiar de vista)
let poller = null;      // intervalo de refresco de mensajes

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (v == null ? '' : `${Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`);
const initials = (name) => esc(String(name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase());
const fmtDate = (iso) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const sinceYear = (iso) => new Date(iso).getFullYear();

function stars(r, size = '') {
  const v = Math.round((r || 0) * 2) / 2;
  let out = '';
  for (let i = 1; i <= 5; i++) out += `<span class="star ${v >= i ? 'on' : v >= i - 0.5 ? 'half' : ''}">★</span>`;
  return `<span class="stars ${size}" title="${r ? r.toFixed(1) : 'Sin valoraciones'}">${out}</span>`;
}
function avatar(p, cls = '') {
  return p.photo
    ? `<img class="avatar ${cls}" src="${esc(p.photo)}" alt="">`
    : `<div class="avatar ${cls} ph" style="--h:${(p.id * 47) % 360}">${initials(p.name)}</div>`;
}
function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `show ${kind}`;
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = ''), 3000);
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token && path !== '/api/auth/login') { logoutLocal(); }
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
async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=es`);
    const d = await r.json();
    const a = d.address || {};
    return [a.suburb || a.neighbourhood || a.quarter, a.city || a.town || a.village].filter(Boolean).join(', ') || d.display_name || 'Mi ubicación';
  } catch { return 'Mi ubicación'; }
}
async function geocode(text) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=${encodeURIComponent(text)}`);
  const d = await r.json();
  if (!d.length) throw new Error('No encontramos esa dirección');
  return { lat: Number(d[0].lat), lng: Number(d[0].lon), label: d[0].display_name.split(',').slice(0, 3).join(',') };
}
async function useMyLocation() {
  const p = await browserLocation();
  const label = await reverseGeocode(p.lat, p.lng);
  return { ...p, label };
}

// ---------- mapas ----------
function newMap(el, center, zoom = 12) {
  const m = L.map(el, { scrollWheelZoom: true }).setView([center.lat, center.lng], zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap',
  }).addTo(m);
  maps.push(m);
  return m;
}
const pinIcon = (label, cls = '') => L.divIcon({ className: '', html: `<div class="pin ${cls}"><span>${label}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 34] });
function clearView() {
  maps.forEach((m) => m.remove()); maps = [];
  if (poller) { clearInterval(poller); poller = null; }
}

// ---------- sesión ----------
async function loadMe() {
  if (!state.token) { state.me = null; state.pro = null; state.unread = 0; return; }
  try {
    const d = await api('/api/me');
    state.me = d.user; state.pro = d.pro; state.unread = d.unread;
  } catch { state.me = null; }
}
function logoutLocal() {
  state.token = null; state.me = null; state.pro = null;
  localStorage.removeItem('token');
  renderNav();
}
function renderNav() {
  const m = state.me;
  $nav.innerHTML = `
    <a href="#/buscar">Buscar</a>
    ${m ? `
      <a href="#/mensajes">Mensajes${state.unread ? `<span class="badge">${state.unread}</span>` : ''}</a>
      <a href="#/panel">${m.role === 'pro' ? 'Mi perfil profesional' : 'Mi cuenta'}</a>
      <a href="#" id="logout" class="muted">Salir</a>`
    : `<a href="#/login">Entrar</a><a href="#/registro?role=pro" class="btn small">Ofrece tus servicios</a>`}`;
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = async (e) => { e.preventDefault(); try { await api('/api/auth/logout', { method: 'POST' }); } catch {} logoutLocal(); go('#/'); };
}

// ---------- componentes ----------
function locationPicker(id, onPick) {
  // Devuelve HTML y luego hay que llamar a bindLocationPicker
  return `
    <div class="locbox" id="${id}">
      <input type="text" class="loc-input" placeholder="Tu dirección, barrio o código postal" value="${esc(state.loc?.label || '')}">
      <button type="button" class="btn ghost loc-gps" title="Usar mi ubicación">◎ Mi ubicación</button>
    </div>`;
}
function bindLocationPicker(id, onPick) {
  const box = document.getElementById(id);
  const input = box.querySelector('.loc-input');
  box.querySelector('.loc-gps').onclick = async () => {
    input.value = 'Buscando…';
    try { const l = await useMyLocation(); input.value = l.label; setLoc(l); onPick(l); }
    catch (e) { input.value = state.loc?.label || ''; toast(e.message, 'err'); }
  };
  return async () => {
    const txt = input.value.trim();
    if (!txt) throw new Error('Indica tu ubicación');
    if (state.loc && txt === state.loc.label) return state.loc;
    const l = await geocode(txt); setLoc(l); return l;
  };
}
function tradeOptions(selected, { any = true } = {}) {
  return (any ? `<option value="">Todos los oficios</option>` : `<option value="">Elige…</option>`) +
    state.trades.map((t) => `<option ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('');
}
const TRADE_ICON = {
  'Plomero / Fontanero': '🔧', Gasista: '🔥', Electricista: '⚡', Cerrajero: '🔑', Pintor: '🎨', Albañil: '🧱',
  Carpintero: '🪚', Climatización: '❄️', Jardinero: '🌿', Limpieza: '🧽', Mudanzas: '📦', Manitas: '🛠️',
  Cristalero: '🪟', Techador: '🏠', Herrero: '⚒️', 'Instalador de suelos': '📐',
};
function badges(p) {
  return [
    p.verified && '<span class="tag ok">✔ Verificado</span>',
    p.emergency && '<span class="tag hot">Urgencias 24h</span>',
    p.free_quote && '<span class="tag">Presupuesto gratis</span>',
    p.insured && '<span class="tag">Seguro RC</span>',
    p.invoice && '<span class="tag">Emite factura</span>',
  ].filter(Boolean).join('');
}

// ---------- vistas ----------
async function viewHome() {
  $app.innerHTML = `
    <section class="hero">
      <div class="hero-inner">
        <h1>El profesional que necesitas,<br><em>a la vuelta de la esquina.</em></h1>
        <p class="lead">Fontaneros, gasistas, electricistas y más. Solo te mostramos quien realmente se desplaza hasta tu casa, con reseñas reales de otros vecinos.</p>
        <form class="searchbar" id="hs">
          <select name="trade">${tradeOptions('')}</select>
          ${locationPicker('hloc')}
          <button class="btn big">Buscar</button>
        </form>
      </div>
    </section>
    <section class="wrap">
      <h2 class="section-title">¿Qué necesitas arreglar?</h2>
      <div class="cats">
        ${state.trades.map((t) => `<button class="cat" data-t="${esc(t)}"><span>${TRADE_ICON[t] || '🔧'}</span>${esc(t)}</button>`).join('')}
      </div>
      <div class="how">
        <div><b>1</b><h3>Dinos dónde estás</h3><p>Escribe tu dirección o deja que el navegador la detecte.</p></div>
        <div><b>2</b><h3>Compara</h3><p>Valoraciones, precio por hora, experiencia y si atienden urgencias.</p></div>
        <div><b>3</b><h3>Habla y acuerda</h3><p>Escríbele, recibe propuestas de precio y acéptalas desde el chat.</p></div>
      </div>
      <div class="pro-cta">
        <div><h2>¿Eres profesional?</h2><p>Crea tu perfil gratis, marca hasta dónde te desplazas y recibe clientes de tu zona.</p></div>
        <a class="btn big light" href="#/registro?role=pro">Crear mi perfil</a>
      </div>
    </section>`;
  const getLoc = bindLocationPicker('hloc', () => {});
  const doSearch = async (trade) => {
    try { const l = await getLoc(); go(`#/buscar?${qs({ trade, lat: l.lat.toFixed(5), lng: l.lng.toFixed(5) })}`); }
    catch (e) { toast(e.message, 'err'); }
  };
  document.getElementById('hs').onsubmit = (e) => { e.preventDefault(); doSearch(e.target.trade.value); };
  document.querySelectorAll('.cat').forEach((b) => (b.onclick = () => doSearch(b.dataset.t)));
}

async function viewSearch(query) {
  const lat = Number(query.lat) || state.loc?.lat, lng = Number(query.lng) || state.loc?.lng;
  $app.innerHTML = `
    <div class="search-layout">
      <div class="search-side">
        <form class="filters" id="sf">
          <div class="row">
            <select name="trade">${tradeOptions(query.trade || '')}</select>
            ${locationPicker('sloc')}
          </div>
          <div class="row">
            <input name="q" placeholder="Palabra clave (p. ej. caldera, persiana…)" value="${esc(query.q || '')}">
            <select name="minRating">
              <option value="">Cualquier valoración</option>
              ${[3, 4, 4.5].map((v) => `<option value="${v}" ${query.minRating == v ? 'selected' : ''}>${v}+ ★</option>`).join('')}
            </select>
            <select name="sort">
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
        <div id="results" class="results"><div class="empty">Cargando…</div></div>
      </div>
      <div class="search-map"><div id="smap"></div></div>
    </div>`;

  const getLoc = bindLocationPicker('sloc', (l) => submit(l));
  const form = document.getElementById('sf');
  const submit = async (forced) => {
    try {
      const l = forced || await getLoc();
      const f = form.elements;
      go(`#/buscar?${qs({ trade: f.trade.value, lat: l.lat.toFixed(5), lng: l.lng.toFixed(5), q: f.q.value,
        minRating: f.minRating.value, sort: f.sort.value,
        emergency: f.emergency.checked ? 1 : '', freeQuote: f.freeQuote.checked ? 1 : '', insured: f.insured.checked ? 1 : '' })}`);
    } catch (e) { toast(e.message, 'err'); }
  };
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  ['trade', 'minRating', 'sort', 'emergency', 'freeQuote', 'insured'].forEach((n) => (form.elements[n].onchange = () => submit()));

  const $res = document.getElementById('results');
  if (!lat || !lng) {
    $res.innerHTML = `<div class="empty"><h3>¿Dónde necesitas el servicio?</h3><p>Escribe tu dirección arriba, pulsa “Mi ubicación” o haz clic en el mapa.</p></div>`;
  }
  const map = newMap('smap', lat ? { lat, lng } : { lat: 40.4168, lng: -3.7038 }, lat ? 12 : 6);
  map.on('click', async (e) => {
    const l = { lat: e.latlng.lat, lng: e.latlng.lng, label: await reverseGeocode(e.latlng.lat, e.latlng.lng) };
    setLoc(l); submit(l);
  });
  if (!lat || !lng) return;

  L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }) })
    .addTo(map).bindTooltip('Tu ubicación');

  let data;
  try {
    data = await api(`/api/search?${qs({ lat, lng, trade: query.trade, q: query.q, minRating: query.minRating, sort: query.sort, emergency: query.emergency, freeQuote: query.freeQuote, insured: query.insured })}`);
  } catch (e) { $res.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  if (!data.count) {
    $res.innerHTML = `<div class="empty"><h3>No hay profesionales que lleguen hasta aquí</h3><p>Prueba con otro oficio, quita filtros o cambia la ubicación.</p></div>`;
    return;
  }
  $res.innerHTML = `<p class="count"><b>${data.count}</b> ${data.count === 1 ? 'profesional se desplaza' : 'profesionales se desplazan'} hasta tu ubicación</p>` +
    data.results.map((p) => `
      <article class="card" data-id="${p.id}">
        ${avatar(p)}
        <div class="card-body">
          <div class="card-top">
            <a class="name" href="#/pro/${p.id}">${esc(p.name)}</a>
            <span class="price">${p.price_hour ? `${money(p.price_hour)}<small>/h</small>` : ''}</span>
          </div>
          <div class="trade">${TRADE_ICON[p.trade] || ''} ${esc(p.trade)}${p.trades_extra.length ? ` <span class="muted">· ${p.trades_extra.map(esc).join(', ')}</span>` : ''}</div>
          <div class="rating">${stars(p.avg_rating)} <b>${p.avg_rating ? p.avg_rating.toFixed(1) : '—'}</b> <span class="muted">(${p.review_count} reseñas)</span></div>
          <p class="headline">${esc(p.headline)}</p>
          <div class="meta"><span>📍 a ${p.distance_km} km</span><span>🚐 se desplaza hasta ${p.radius_km} km</span><span>🧰 ${p.years_exp} años</span></div>
          <div class="tags">${badges(p)}</div>
        </div>
      </article>`).join('');

  const markers = {};
  let circle = null;
  const bounds = L.latLngBounds([[lat, lng]]);
  data.results.forEach((p, i) => {
    const mk = L.marker([p.base_lat, p.base_lng], { icon: pinIcon(i + 1) }).addTo(map)
      .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.trade)}<br>${stars(p.avg_rating)} (${p.review_count})<br><a href="#/pro/${p.id}">Ver perfil →</a>`);
    markers[p.id] = { mk, p };
    bounds.extend([p.base_lat, p.base_lng]);
  });
  map.fitBounds(bounds.pad(0.15), { maxZoom: 13 });
  const highlight = (id, on) => {
    const m = markers[id]; if (!m) return;
    m.mk.setIcon(pinIcon(data.results.indexOf(m.p) + 1, on ? 'active' : ''));
    if (circle) { circle.remove(); circle = null; }
    if (on) circle = L.circle([m.p.base_lat, m.p.base_lng], { radius: m.p.radius_km * 1000, color: '#c2410c', weight: 1.5, fillOpacity: 0.08 }).addTo(map);
  };
  $res.querySelectorAll('.card').forEach((c) => {
    c.onmouseenter = () => highlight(c.dataset.id, true);
    c.onmouseleave = () => highlight(c.dataset.id, false);
    c.onclick = (e) => { if (!e.target.closest('a')) go(`#/pro/${c.dataset.id}`); };
  });
}

async function viewPro(id) {
  let p;
  try { p = await api(`/api/pros/${id}`); } catch (e) { $app.innerHTML = `<div class="wrap empty">${esc(e.message)}</div>`; return; }
  const me = state.me;
  const isMe = me && me.id === p.id;
  const myReview = me && p.reviews.find((r) => r.user_id === me.id);
  const total = p.review_count || 0;
  const dist = state.loc && p.base_lat ? haversine(state.loc, { lat: p.base_lat, lng: p.base_lng }) : null;
  const reaches = dist != null ? dist <= p.radius_km : null;

  $app.innerHTML = `
    <div class="wrap profile">
      <div class="profile-main">
        <a href="javascript:history.back()" class="back">← Volver</a>
        <header class="phead">
          ${avatar(p, 'xl')}
          <div>
            <h1>${esc(p.name)} ${p.verified ? '<span class="tag ok">✔ Verificado</span>' : ''}</h1>
            <div class="trade big">${TRADE_ICON[p.trade] || ''} ${esc(p.trade)}${p.trades_extra.length ? ` <span class="muted">· ${p.trades_extra.map(esc).join(' · ')}</span>` : ''}</div>
            <div class="rating">${stars(p.avg_rating, 'lg')} <b>${p.avg_rating ? p.avg_rating.toFixed(1) : 'Sin valoraciones'}</b> <span class="muted">· ${total} reseñas · en Oficio Cerca desde ${sinceYear(p.member_since)}</span></div>
            ${p.headline ? `<p class="headline big">${esc(p.headline)}</p>` : ''}
            <div class="tags">${badges(p)}</div>
          </div>
        </header>
        ${!p.active ? '<div class="notice">Este perfil está pausado y no aparece en las búsquedas.</div>' : ''}

        <section class="facts">
          <div><span>Precio orientativo</span><b>${p.price_hour ? `${money(p.price_hour)}/h` : 'A consultar'}</b></div>
          <div><span>Desplazamiento</span><b>${p.callout_fee ? money(p.callout_fee) : 'Incluido'}</b></div>
          <div><span>Experiencia</span><b>${p.years_exp} años</b></div>
          <div><span>Trabajos acordados aquí</span><b>${p.jobs_agreed}</b></div>
        </section>

        ${p.description ? `<section><h2>Sobre mí</h2><p class="desc">${esc(p.description).replace(/\n/g, '<br>')}</p></section>` : ''}

        ${p.gallery.length ? `<section><h2>Trabajos realizados</h2><div class="gallery">${p.gallery.map((g) => `<a href="${esc(g)}" target="_blank"><img src="${esc(g)}" alt=""></a>`).join('')}</div></section>` : ''}

        <section class="details">
          <h2>Detalles</h2>
          <dl>
            ${p.hours ? `<dt>Horario</dt><dd>${esc(p.hours)}</dd>` : ''}
            ${p.license ? `<dt>Matrícula / licencia</dt><dd>${esc(p.license)}</dd>` : ''}
            ${p.payment_methods.length ? `<dt>Formas de pago</dt><dd>${p.payment_methods.map(esc).join(', ')}</dd>` : ''}
            ${p.languages.length ? `<dt>Idiomas</dt><dd>${p.languages.map(esc).join(', ')}</dd>` : ''}
            <dt>Zona base</dt><dd>${esc(p.base_label || '—')}</dd>
            <dt>Radio de acción</dt><dd>Se desplaza hasta <b>${p.radius_km} km</b></dd>
          </dl>
          <div id="pmap" class="pmap"></div>
          ${reaches != null ? `<p class="${reaches ? 'ok-text' : 'warn-text'}">${reaches ? `✔ Llega hasta tu ubicación (a ${dist.toFixed(1)} km).` : `✖ Tu ubicación queda a ${dist.toFixed(1)} km, fuera de su radio de ${p.radius_km} km.`}</p>` : ''}
        </section>

        <section class="reviews">
          <h2>Reseñas</h2>
          <div class="rv-summary">
            <div class="rv-big"><b>${p.avg_rating ? p.avg_rating.toFixed(1) : '—'}</b>${stars(p.avg_rating)}<span class="muted">${total} reseñas</span></div>
            <div class="rv-bars">${[5, 4, 3, 2, 1].map((k) => `<div><span>${k}★</span><i style="--w:${total ? (p.breakdown[k] / total) * 100 : 0}%"></i><span>${p.breakdown[k]}</span></div>`).join('')}</div>
          </div>
          ${me && !isMe ? `
            <form id="rvform" class="rvform">
              <h3>${myReview ? 'Editar tu reseña' : 'Deja tu reseña'}</h3>
              <div class="star-input">${[1, 2, 3, 4, 5].map((k) => `<button type="button" data-v="${k}" class="${myReview && myReview.rating >= k ? 'on' : ''}">★</button>`).join('')}</div>
              <textarea name="comment" placeholder="¿Cómo fue el trabajo? Puntualidad, limpieza, precio…">${esc(myReview?.comment || '')}</textarea>
              <button class="btn">Publicar reseña</button>
            </form>` : !me ? `<p class="muted"><a href="#/login?next=${encodeURIComponent(location.hash)}">Inicia sesión</a> para dejar una reseña.</p>` : ''}
          <div class="rv-list">
            ${p.reviews.length ? p.reviews.map((r) => `
              <div class="rv">
                <div class="rv-head"><b>${esc(r.author)}</b> ${stars(r.rating)} <span class="muted">${fmtDate(r.created_at)}</span></div>
                ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
                ${r.reply ? `<div class="reply"><b>Respuesta de ${esc(p.name.split(' ')[0])}:</b> ${esc(r.reply)}</div>` : ''}
                ${isMe ? `<button class="link reply-btn" data-id="${r.id}">${r.reply ? 'Editar respuesta' : 'Responder'}</button>` : ''}
              </div>`).join('') : '<p class="muted">Todavía no tiene reseñas.</p>'}
          </div>
        </section>
      </div>

      <aside class="contact">
        <div class="contact-card">
          ${isMe ? `
            <h3>Este es tu perfil</h3>
            <p class="muted">Así lo ven los clientes.</p>
            <a class="btn full" href="#/panel">Editar perfil</a>` : `
            <h3>Contactar con ${esc(p.name.split(' ')[0])}</h3>
            ${p.free_quote ? '<p class="ok-text small">Presupuesto sin compromiso</p>' : ''}
            ${me ? `
              <form id="cform">
                <textarea name="body" required placeholder="Hola, necesito… ¿cuándo podrías venir?"></textarea>
                <label class="small muted">Precio que propones (opcional)</label>
                <div class="inline"><input name="offer" type="number" min="0" step="1" placeholder="p. ej. 60"><span>€</span></div>
                <button class="btn full">Enviar mensaje</button>
              </form>` : `<a class="btn full" href="#/login?next=${encodeURIComponent(location.hash)}">Inicia sesión para escribirle</a>`}
            <div class="direct">
              ${p.phone ? `<button class="btn ghost full" id="showphone">📞 Ver teléfono</button>` : ''}
              ${p.whatsapp ? `<a class="btn ghost full" target="_blank" rel="noopener" href="https://wa.me/${esc(p.whatsapp.replace(/\D/g, ''))}?text=${encodeURIComponent(`Hola ${p.name}, te encontré en Oficio Cerca.`)}">💬 WhatsApp</a>` : ''}
              ${p.contact_email ? `<a class="btn ghost full" href="mailto:${esc(p.contact_email)}">✉️ Email</a>` : ''}
            </div>`}
        </div>
      </aside>
    </div>`;

  if (p.base_lat) {
    const m = newMap('pmap', { lat: p.base_lat, lng: p.base_lng }, 11);
    const c = L.circle([p.base_lat, p.base_lng], { radius: p.radius_km * 1000, color: '#c2410c', weight: 1.5, fillOpacity: 0.1 }).addTo(m);
    L.marker([p.base_lat, p.base_lng], { icon: pinIcon(TRADE_ICON[p.trade] || '●') }).addTo(m);
    if (state.loc) L.marker([state.loc.lat, state.loc.lng], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(m).bindTooltip('Tú');
    m.fitBounds(c.getBounds().pad(0.05));
  }

  const sp = document.getElementById('showphone');
  if (sp) sp.onclick = () => { sp.outerHTML = `<a class="btn ghost full" href="tel:${esc(p.phone.replace(/\s/g, ''))}">📞 ${esc(p.phone)}</a>`; };

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
  $app.innerHTML = `
    <div class="auth">
      <form id="af" class="auth-card">
        <h1>${isReg ? 'Crea tu cuenta' : 'Bienvenido de nuevo'}</h1>
        ${isReg ? `
          <div class="role-pick">
            <label><input type="radio" name="role" value="client" ${query.role !== 'pro' ? 'checked' : ''}><span><b>Busco profesionales</b><small>Quiero contratar un servicio</small></span></label>
            <label><input type="radio" name="role" value="pro" ${query.role === 'pro' ? 'checked' : ''}><span><b>Soy profesional</b><small>Quiero ofrecer mis servicios</small></span></label>
          </div>
          <label>Nombre<input name="name" required autocomplete="name"></label>` : ''}
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Contraseña<input name="password" type="password" required minlength="6" autocomplete="${isReg ? 'new-password' : 'current-password'}"></label>
        <button class="btn full big">${isReg ? 'Crear cuenta' : 'Entrar'}</button>
        <p class="muted center">${isReg ? '¿Ya tienes cuenta? <a href="#/login">Entra</a>' : '¿No tienes cuenta? <a href="#/registro">Regístrate</a>'}</p>
        ${!isReg ? `<div class="demo"><b>Cuentas de prueba</b> (contraseña <code>demo1234</code>)<br>
          <a href="#" data-e="cliente@demo.com">cliente@demo.com</a> · <a href="#" data-e="plomero@demo.com">plomero@demo.com</a></div>` : ''}
      </form>
    </div>`;
  const f = document.getElementById('af');
  f.querySelectorAll('[data-e]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); f.email.value = a.dataset.e; f.password.value = 'demo1234'; }));
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    try {
      const r = await api(isReg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
      state.token = r.token; localStorage.setItem('token', r.token);
      await loadMe(); renderNav();
      toast(isReg ? 'Cuenta creada' : `Hola, ${r.user.name.split(' ')[0]}`);
      go(query.next || (r.user.role === 'pro' && !state.pro ? '#/panel' : '#/'));
    } catch (err) { toast(err.message, 'err'); }
  };
}

// --- imágenes: redimensiona en el navegador y devuelve data URL ---
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

async function viewPanel() {
  if (!state.me) return go('#/login?next=%23%2Fpanel');
  await loadMe(); renderNav();
  if (state.me.role !== 'pro') {
    $app.innerHTML = `
      <div class="wrap narrow">
        <h1>Hola, ${esc(state.me.name)}</h1>
        <p class="muted">${esc(state.me.email)}</p>
        <div class="panel-links">
          <a class="tile" href="#/buscar"><b>🔍 Buscar profesionales</b><span>Encuentra quién llega hasta tu casa</span></a>
          <a class="tile" href="#/mensajes"><b>💬 Mis mensajes</b><span>${state.unread ? `${state.unread} sin leer` : 'Tus conversaciones y propuestas'}</span></a>
        </div>
        <div class="pro-cta small"><div><h3>¿También ofreces un oficio?</h3><p>Activa tu perfil profesional con la misma cuenta.</p></div>
          <button class="btn light" id="become">Quiero ser profesional</button></div>
      </div>`;
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
        <p class="muted">Cuanto más completo, más confianza generas.</p></div>
        ${state.pro ? `<a class="btn ghost" href="#/pro/${state.pro.id}">Ver perfil público →</a>` : ''}
      </div>
      <form id="pf" class="pform">
        <section>
          <h2>Datos básicos</h2>
          <div class="photo-row">
            <div id="photoPrev">${avatar({ ...p, id: state.me.id, photo }, 'xl')}</div>
            <label class="btn ghost">Subir foto<input type="file" accept="image/*" id="photoIn" hidden></label>
            ${photo ? '<button type="button" class="link" id="photoDel">Quitar</button>' : ''}
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
          <div class="grid2">
            ${locationPicker('ploc')}
            <button type="button" class="btn ghost" id="locSearch">Buscar dirección</button>
          </div>
          <div class="radius-row"><label>Radio: <b id="rv">${p.radius_km}</b> km</label><input type="range" name="radius_km" min="1" max="100" value="${p.radius_km}"></div>
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
            <label>Matrícula / licencia / certificación<input name="license" value="${esc(p.license)}" placeholder="Ej.: Instalador autorizado de gas nº…"></label>
          </div>
          <label>Idiomas (separados por comas)<input name="languages" value="${esc(p.languages.join(', '))}"></label>
        </section>

        <section>
          <h2>Contacto directo</h2>
          <div class="grid3">
            <label>Teléfono<input name="phone" value="${esc(p.phone)}" placeholder="+34 600 000 000"></label>
            <label>WhatsApp<input name="whatsapp" value="${esc(p.whatsapp)}" placeholder="+34 600 000 000"></label>
            <label>Email de contacto<input name="contact_email" type="email" value="${esc(p.contact_email)}"></label>
          </div>
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
  // mapa con marcador arrastrable y círculo de radio
  const start = p.base_lat ? { lat: p.base_lat, lng: p.base_lng } : { lat: 40.4168, lng: -3.7038 };
  const map = newMap('panelmap', start, p.base_lat ? 11 : 6);
  let pos = p.base_lat ? { ...start } : null;
  let marker = null, circle = null;
  const draw = (fit) => {
    if (!pos) return;
    const r = Number(f.radius_km.value) * 1000;
    if (!marker) {
      marker = L.marker([pos.lat, pos.lng], { draggable: true, icon: pinIcon('🏠') }).addTo(map);
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
  document.getElementById('locSearch').onclick = async () => {
    try { const l = await getLoc(); pos = { lat: l.lat, lng: l.lng }; setLabel(l.label); draw(true); } catch (e) { toast(e.message, 'err'); }
  };

  // foto de perfil
  const renderPhoto = () => { document.getElementById('photoPrev').innerHTML = avatar({ ...p, id: state.me.id, name: f.name.value, photo }, 'xl'); };
  document.getElementById('photoIn').onchange = async (e) => { if (e.target.files[0]) { photo = await fileToDataURL(e.target.files[0], 320); renderPhoto(); } };
  const pd = document.getElementById('photoDel'); if (pd) pd.onclick = () => { photo = ''; renderPhoto(); pd.remove(); };

  // galería
  const renderGal = () => {
    document.getElementById('gal').innerHTML = gallery.map((g, i) => `<div class="gi"><img src="${esc(g)}"><button type="button" data-i="${i}">✕</button></div>`).join('') || '<p class="muted">Aún no has subido fotos.</p>';
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
      <aside class="conv-list" id="cl"><div class="empty">Cargando…</div></aside>
      <section class="thread" id="th">${convId ? '<div class="empty">Cargando…</div>' : '<div class="empty"><h3>Tus conversaciones</h3><p>Elige una conversación a la izquierda.</p></div>'}</section>
    </div>`;

  const loadList = async () => {
    const list = await api('/api/conversations');
    const cl = document.getElementById('cl'); if (!cl) return;
    cl.innerHTML = list.length ? list.map((c) => `
      <a class="conv ${String(c.id) === String(convId) ? 'active' : ''}" href="#/mensajes/${c.id}">
        ${avatar({ id: c.other.id, name: c.other.name, photo: c.other.photo || '' })}
        <div><b>${esc(c.other.name)}</b>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}
          <small>${c.i_am_pro ? 'Cliente' : esc(c.trade || '')} · ${fmtTime(c.updated_at)}</small>
          <p>${c.last_offer != null ? `💶 Propuesta: ${money(c.last_offer)}` : esc(c.last_body || '')}</p></div>
      </a>`).join('') : `<div class="empty"><p>Aún no tienes conversaciones.</p><a class="btn" href="#/buscar">Buscar profesionales</a></div>`;
  };

  let lastCount = -1;
  const loadThread = async (scroll) => {
    const d = await api(`/api/conversations/${convId}`);
    const th = document.getElementById('th'); if (!th) return;
    if (d.messages.length === lastCount && !scroll) return;
    const keepDraft = th.querySelector('textarea')?.value || '';
    lastCount = d.messages.length;
    const other = d.i_am_pro ? d.client : d.pro;
    th.innerHTML = `
      <header class="th-head">
        <a href="#/mensajes" class="back mobile-only">←</a>
        ${avatar({ id: other.id, name: other.name, photo: other.photo || '' })}
        <div><b>${esc(other.name)}</b><small>${d.i_am_pro ? 'Cliente' : `${esc(d.pro.trade)} · ${stars(d.pro.avg_rating)}`}</small></div>
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
        <textarea name="body" placeholder="Escribe un mensaje…" rows="2">${esc(keepDraft)}</textarea>
        <div class="composer-side">
          <div class="inline"><input name="offer" type="number" min="0" step="1" placeholder="Proponer €"></div>
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
  } catch (e) { toast(e.message, 'err'); }
  poller = setInterval(async () => {
    try { if (convId) await loadThread(false); await loadList(); await loadMe(); renderNav(); } catch {}
  }, 5000);
}

// ---------- router ----------
async function route() {
  clearView();
  window.scrollTo(0, 0);
  const { parts, query } = parseHash();
  renderNav();
  switch (parts[0]) {
    case undefined: return viewHome();
    case 'buscar': return viewSearch(query);
    case 'pro': return viewPro(parts[1]);
    case 'login': return viewAuth('login', query);
    case 'registro': return viewAuth('registro', query);
    case 'panel': return viewPanel();
    case 'mensajes': return viewMessages(parts[1]);
    default: $app.innerHTML = '<div class="wrap empty"><h2>Página no encontrada</h2><a href="#/">Volver al inicio</a></div>';
  }
}

(async function init() {
  state.trades = await api('/api/trades');
  await loadMe();
  window.addEventListener('hashchange', route);
  route();
})();
