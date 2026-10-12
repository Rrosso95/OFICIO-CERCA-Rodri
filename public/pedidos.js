'use strict';
/* Pedidos: asistente con IA, presupuestos y chat del pedido. Usa las utilidades de app.js. */

const URGENCY = { hoy: 'Hoy mismo', semana: 'Esta semana', flexible: 'Sin prisa' };
const STATUS = { open: ['Abierto', 'open'], taken: ['En curso', 'taken'], done: ['Finalizado', 'done'], cancelled: ['Cancelado', 'cancelled'] };
const QUICK = ['Se ha atascado el fregadero', 'Ha saltado el diferencial', 'El aire no enfría', 'Gotea un grifo', 'Me he quedado fuera de casa', 'No hay agua caliente'];
const GREETING = 'Hola, soy el asistente de Oficio Cerca. Cuéntame qué ocurre en casa y te ayudo a pedir presupuestos a profesionales de tu zona.';

const statusPill = (s) => `<span class="pill ${(STATUS[s] || STATUS.open)[1]}">${(STATUS[s] || STATUS.open)[0]}</span>`;
const estimateText = (o) => (o.est_min ? `${money(o.est_min)} – ${money(o.est_max)}` : '');
function ago(iso) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}
function openPhoto(src) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${esc(src)}" alt="Foto ampliada">`;
  lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
}
const thumbs = (photos) => (photos.length
  ? `<div class="thumbs">${photos.map((p, i) => `<button type="button" class="thumb" data-p="${i}" aria-label="Ver foto ${i + 1}"><img src="${esc(p)}" alt="Foto ${i + 1} del problema"></button>`).join('')}</div>` : '');
const bindThumbs = (root, photos) => root.querySelectorAll('.thumb').forEach((b) => (b.onclick = () => openPhoto(photos[b.dataset.p])));

// ---------- bloques de pago ----------
function payBoxClient(d) {
  const p = d.payment; if (!p) return '';
  const sim = p.provider === 'simulated' ? '<span class="tag">Modo demostración: no se cobra dinero real</span>' : '';
  const h = {
    pending: `<b>Paga ${money(p.amount)} para confirmar el trabajo</b><p>Retenemos el pago y solo se libera al profesional cuando tú confirmes que está hecho.</p><button class="btn" id="bPay">Pagar ${money(p.amount)}</button>`,
    held: p.pro_done_at
      ? `<b>El profesional dice que ha terminado</b><p>Confirma el trabajo o abre una reclamación antes del ${fmtTime(p.release_at)}. Si no, el pago se liberará automáticamente.</p>`
      : `<b>Pago de ${money(p.amount)} retenido</b><p>Se libera al profesional cuando confirmes que el trabajo está hecho.</p>`,
    disputed: '<b>Reclamación abierta</b><p>Estamos revisando el caso. Mientras tanto, el pago está congelado.</p>',
    released: '<b>Pago liberado al profesional</b>',
    refunded: `<b>Pago reembolsado</b><p>Te hemos devuelto ${money(p.amount)}.</p>`,
  }[p.status];
  return `<section class="paybox ${p.status}">${h}${sim}</section>`;
}
function payBoxPro(d) {
  const p = d.payment; if (!p) return '';
  const h = {
    pending: '<b>Esperando el pago del cliente</b><p>No empieces el trabajo hasta que esté pagado.</p>',
    held: p.pro_done_at
      ? `<b>Pendiente de confirmación del cliente</b><p>Recibirás ${money(p.net)}. Si no responde ni reclama, se libera automáticamente el ${fmtTime(p.release_at)}.</p>`
      : `<b>Pago de ${money(p.amount)} retenido</b><p>Recibirás <b>${money(p.net)}</b> (comisión de ${money(p.fee)}) cuando el cliente confirme el trabajo. Márcalo como terminado al acabar.</p>`,
    disputed: '<b>El cliente ha abierto una reclamación</b><p>El pago está congelado hasta que lo revise el equipo de Oficio Cerca.</p>',
    released: `<b>Cobrado: ${money(p.net)}</b><p>Transferido a tu cuenta (importe ${money(p.amount)} menos la comisión de ${money(p.fee)}).</p>`,
    refunded: '<b>Pago reembolsado al cliente</b>',
  }[p.status];
  return `<section class="paybox ${p.status}">${h}</section>`;
}
async function startPayment(o, amount, refresh) {
  const r = await api(`/api/orders/${o.id}/pay`, { method: 'POST' });
  if (r.url) { location.href = r.url; return; }
  if (r.simulated && confirm(`Pago simulado de ${money(amount)}: no se cobra dinero real. ¿Confirmar?`)) {
    await api(`/api/orders/${o.id}/pay/confirm-simulated`, { method: 'POST' });
    toast('Pago recibido'); await refresh(true);
  }
}

// ---------- chat del pedido ----------
let activeChat = null;
function mountChat(el, { orderId, proId, name, sub = '' }) {
  let last = -1;
  el.innerHTML = `
    <header class="th-head"><div class="th-txt"><b>${esc(name)}</b><small>${esc(sub)}</small></div></header>
    <div class="msgs" data-msgs></div>
    <form class="composer" data-form>
      <textarea name="body" aria-label="Mensaje" placeholder="Escribe un mensaje…" rows="2"></textarea>
      <div class="composer-side"><button class="btn">Enviar</button></div>
    </form>
    <p class="chat-note muted small">Mantén la conversación aquí: así queda constancia de lo acordado.</p>`;
  const box = el.querySelector('[data-msgs]'), form = el.querySelector('[data-form]'), note = el.querySelector('.chat-note');
  const chat = {
    async load(force) {
      const d = await api(`/api/orders/${orderId}/chat?pro=${proId}`);
      form.hidden = d.closed;
      if (d.closed) note.textContent = 'Esta conversación está cerrada.';
      if (!force && d.messages.length === last) return;
      last = d.messages.length;
      box.innerHTML = d.messages.map((m) => (m.kind === 'system'
        ? `<div class="sysmsg">${esc(m.body)}</div>`
        : `<div class="msg ${m.sender_id === state.me.id ? 'mine' : ''}"><p>${esc(m.body).replace(/\n/g, '<br>')}</p><time>${fmtTime(m.created_at)}</time></div>`)).join('')
        || '<p class="muted center">Aún no hay mensajes. Escribe el primero.</p>';
      box.scrollTop = box.scrollHeight;
    },
  };
  form.body.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = form.body.value.trim();
    if (!body) return;
    try {
      await api(`/api/orders/${orderId}/chat`, { method: 'POST', body: { pro: proId, body } });
      form.body.value = ''; await chat.load(true);
    } catch (err) { toast(err.message, 'err'); }
  };
  activeChat = chat;
  chat.load(true).catch((e) => { box.innerHTML = `<p class="muted center">${esc(e.message)}</p>`; });
  return chat;
}

// ---------- asistente: pedir presupuestos ----------
const WIZ_KEY = 'wiz';
async function viewPedir(query) {
  let wiz = { msgs: [], draft: null, form: null };
  if (query.resume) { try { wiz = { ...wiz, ...JSON.parse(sessionStorage.getItem(WIZ_KEY) || '{}') }; } catch { /* empezar de cero */ } }
  else { try { sessionStorage.removeItem(WIZ_KEY); } catch { /* sin almacenamiento */ } }
  const persist = () => { try { sessionStorage.setItem(WIZ_KEY, JSON.stringify(wiz)); } catch { /* foto demasiado grande */ } };
  let busy = false, photos = wiz.form?.photos ? [...wiz.form.photos] : [];

  $app.innerHTML = `
    <div class="wrap narrow ask">
      <h1>Cuéntanos qué pasa</h1>
      <p class="muted">Te hago un par de preguntas y los profesionales de tu zona te envían presupuestos. Es gratis y sin compromiso.</p>
      <div class="chatbox">
        <div class="msgs" id="wmsgs" aria-live="polite"></div>
        <form class="composer" id="wf">
          <textarea name="q" aria-label="Cuéntanos qué pasa" rows="2" maxlength="1500" placeholder="Ej.: Se ha atascado el fregadero de la cocina y no baja el agua"></textarea>
          <div class="composer-side"><button class="btn">${icon('send')} Enviar</button></div>
        </form>
      </div>
      <div class="quick" id="wquick"></div>
      <div id="wconfirm"></div>
    </div>`;
  const $msgs = document.getElementById('wmsgs'), wf = document.getElementById('wf');

  const paint = () => {
    $msgs.innerHTML = `<div class="msg"><p>${esc(GREETING)}</p></div>` +
      wiz.msgs.map((m) => `<div class="msg ${m.role === 'user' ? 'mine' : ''}"><p>${esc(m.content).replace(/\n/g, '<br>')}</p></div>`).join('') +
      (busy ? '<div class="msg typing" aria-label="Escribiendo"><span></span><span></span><span></span></div>' : '');
    $msgs.scrollTop = $msgs.scrollHeight;
    const q = document.getElementById('wquick');
    q.innerHTML = wiz.msgs.length ? '' : QUICK.map((t) => `<button type="button" class="chip-btn">${esc(t)}</button>`).join('');
    q.querySelectorAll('button').forEach((b) => (b.onclick = () => send(b.textContent)));
  };

  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    wiz.msgs.push({ role: 'user', content: text });
    wf.q.value = ''; busy = true; paint(); persist();
    try {
      const r = await api('/api/ai/chat', { method: 'POST', body: { messages: wiz.msgs }, timeout: 60000 });
      wiz.msgs.push({ role: 'assistant', content: r.reply || 'Revisa los datos y publica el pedido.' });
      if (r.status === 'ready') { wiz.draft = r; wiz.form = null; }
      busy = false; paint(); persist();
      if (r.status === 'ready') renderConfirm();
    } catch (e) {
      wiz.msgs.pop(); busy = false; paint(); toast(e.message, 'err');
      wf.q.value = text;
    }
  }
  wf.onsubmit = (e) => { e.preventDefault(); send(wf.q.value); };
  wf.q.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); wf.requestSubmit(); } };

  function renderConfirm() {
    const d = wiz.draft, f = wiz.form || {};
    const host = document.getElementById('wconfirm');
    const est = d.estimate_min ? { min: d.estimate_min, max: d.estimate_max } : null;
    host.innerHTML = `
      <form class="confirm" id="cf">
        <h2>Esto es lo que he entendido</h2>
        <div class="grid2">
          <label>Tipo de profesional<select name="trade" required>${tradeOptions(f.trade ?? d.trade, { any: false })}</select></label>
          <label>Título<input name="title" maxlength="100" required value="${esc(f.title ?? d.title)}"></label>
        </div>
        <label>Descripción para los profesionales<textarea name="description" rows="4" maxlength="2000">${esc(f.description ?? d.summary)}</textarea></label>
        ${est ? `<div class="est">${icon('info')}<span>Precio orientativo de mano de obra: <b>${money(est.min)} – ${money(est.max)}</b>, sin materiales. Es solo una referencia: los presupuestos reales pueden variar.</span></div>` : ''}
        <fieldset><legend>¿Cuándo lo necesitas?</legend>
          <div class="chips">${Object.entries(URGENCY).map(([k, v]) => `<label class="chip"><input type="radio" name="urgency" value="${k}" ${(f.urgency ?? d.urgency) === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
        </fieldset>
        <label>Disponibilidad (opcional)<input name="when_text" maxlength="200" value="${esc(f.when_text ?? '')}" placeholder="Por las tardes, a partir de las 17:00"></label>
        <div><div class="lbl">¿Dónde es?</div>${locationPicker('cloc')}</div>
        <label>Portal, piso, puerta… (opcional)<input name="address_detail" maxlength="200" value="${esc(f.address_detail ?? '')}" placeholder="2.º B"></label>
        <p class="muted small">Los profesionales solo ven tu barrio. La dirección exacta la verá únicamente quien elijas.</p>
        <fieldset><legend>Fotos del problema (opcional, máx. 3)</legend>
          <div class="thumbs" id="wphotos"></div>
          <label class="btn ghost small">${icon('camera')} Añadir fotos<input type="file" accept="image/*" multiple id="wphotoIn" hidden></label>
        </fieldset>
        <button class="btn big full">${state.me ? 'Publicar pedido' : 'Continuar y publicar'}</button>
        ${state.me ? '' : '<p class="muted small center">Necesitas una cuenta gratuita para recibir los presupuestos. Tus datos se conservan.</p>'}
      </form>`;
    const cf = document.getElementById('cf');
    const getLoc = bindLocationPicker('cloc', () => {});
    const paintPhotos = () => {
      const el = document.getElementById('wphotos');
      el.innerHTML = photos.map((p, i) => `<div class="gi"><img src="${esc(p)}" alt="Foto ${i + 1}"><button type="button" data-i="${i}" aria-label="Quitar foto">✕</button></div>`).join('');
      el.querySelectorAll('button').forEach((b) => (b.onclick = () => { photos.splice(Number(b.dataset.i), 1); paintPhotos(); }));
    };
    paintPhotos();
    document.getElementById('wphotoIn').onchange = async (e) => {
      for (const file of [...e.target.files]) { if (photos.length >= 3) break; try { photos.push(await fileToDataURL(file, 900)); } catch { toast('Imagen no válida', 'err'); } }
      e.target.value = ''; paintPhotos();
    };
    cf.onsubmit = async (e) => {
      e.preventDefault();
      let loc;
      try { loc = await getLoc(); } catch (err) { return toast(err.message, 'err'); }
      const fd = new FormData(cf);
      const body = {
        trade: fd.get('trade'), title: fd.get('title'), description: fd.get('description'), urgency: fd.get('urgency') || 'semana',
        when_text: fd.get('when_text'), address_detail: fd.get('address_detail'), address_label: loc.label, lat: loc.lat, lng: loc.lng,
        est_min: est?.min, est_max: est?.max, photos,
      };
      wiz.form = body; persist();
      if (!state.me) return go(`#/registro?next=${encodeURIComponent('#/pedir?resume=1')}`);
      try {
        const r = await api('/api/orders', { method: 'POST', body });
        try { sessionStorage.removeItem(WIZ_KEY); } catch { /* sin almacenamiento */ }
        toast('Pedido publicado. Te avisaremos cuando lleguen presupuestos.');
        go(`#/pedido/${r.id}`);
      } catch (err) { toast(err.message, 'err'); }
    };
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  paint();
  if (wiz.draft) { renderConfirm(); document.getElementById('wconfirm').scrollIntoView({ block: 'start' }); }
  else if (query.q && !wiz.msgs.length) send(query.q);
}

// ---------- listado de pedidos ----------
async function viewPedidos(query) {
  if (!state.me) return go(`#/login?next=${encodeURIComponent('#/pedidos')}`);
  $app.innerHTML = '<div class="wrap empty"><div class="spinner"></div></div>';
  await loadMe(); renderNav();
  const isPro = state.me.role === 'pro' && !!state.pro;
  let mine, proData = { new: [], quoted: [] };
  try { [mine, proData] = await Promise.all([api('/api/orders/mine'), isPro ? api('/api/pro/orders') : Promise.resolve(proData)]); }
  catch (e) { $app.innerHTML = `<div class="wrap">${errorBox(e.message)}</div>`; bindRetry($app, () => viewPedidos(query)); return; }

  let payNotice = '';
  if (isPro && state.config.pay.mode === 'stripe') {
    try { const st = await api('/api/pay/status'); if (!st.ready) payNotice = `<div class="notice">Para poder presupuestar necesitas configurar tus cobros. <a href="#/cobros">Configurar ahora</a></div>`; } catch { /* sin aviso */ }
  }
  const tabs = isPro
    ? [['nuevos', `Nuevos en tu zona${proData.new.length ? ` (${proData.new.length})` : ''}`], ['presupuestos', 'Mis presupuestos'], ['mios', 'Mis pedidos']]
    : [['mios', 'Mis pedidos']];
  const tab = tabs.some(([k]) => k === query.tab) ? query.tab : tabs[0][0];

  const clientCard = (o) => `
    <a class="ocard" href="#/pedido/${o.id}">
      <div class="oc-top"><b>${esc(o.title)}</b>${statusPill(o.status)}</div>
      <div class="meta"><span>${tradeIcon(o.trade)} ${esc(o.trade)}</span><span>${icon('map-pin')} ${esc(o.area)}</span><span>${ago(o.created_at)}</span></div>
      <div class="oc-foot">${o.status === 'open'
        ? (o.quote_count ? `<b>${o.quote_count}</b> ${o.quote_count === 1 ? 'presupuesto' : 'presupuestos'} · desde <b>${money(o.lowest)}</b>${o.new_quotes ? ` <span class="badge">${o.new_quotes} nuevo${o.new_quotes > 1 ? 's' : ''}</span>` : ''}` : 'Esperando presupuestos…')
        : o.status === 'taken' ? `En curso con <b>${esc(o.accepted_pro || '')}</b>`
        : o.status === 'done' ? `Finalizado con <b>${esc(o.accepted_pro || '')}</b>` : 'Cancelado'}</div>
    </a>`;
  const proCard2 = (o) => `
    <a class="ocard" href="#/pedido/${o.id}">
      <div class="oc-top"><b>${esc(o.title)}</b>${o.urgency === 'hoy' ? '<span class="tag hot">Urgente</span>' : ''}</div>
      <div class="meta"><span>${tradeIcon(o.trade)} ${esc(o.trade)}</span><span>${icon('map-pin')} ${esc(o.area)}${o.distance_km != null ? ` · a ${dec(o.distance_km)} km` : ''}</span><span>${ago(o.created_at)}</span></div>
      <div class="oc-foot">${o.my_status
        ? `Tu presupuesto: <b>${money(o.my_amount)}</b> · ${{ pending: o.status === 'open' ? 'Esperando respuesta' : 'Sin resolver', accepted: '🎉 Te han elegido', rejected: 'No elegido', withdrawn: 'Retirado' }[o.my_status]}`
        : `${o.quote_count ? `${o.quote_count} ${o.quote_count === 1 ? 'presupuesto' : 'presupuestos'} ya` : 'Sé el primero en presupuestar'}${estimateText(o) ? ` · orientativo ${estimateText(o)}` : ''} · ${URGENCY[o.urgency]}`}</div>
    </a>`;
  const list = (items, card, empty) => (items.length ? `<div class="olist">${items.map(card).join('')}</div>` : empty);

  const emptyMine = `<div class="empty"><h3>Aún no has pedido nada</h3><p>Cuéntanos qué necesitas y recibe presupuestos de profesionales de tu zona.</p><a class="btn" href="#/pedir">Pedir presupuestos</a></div>`;
  const body = tab === 'nuevos'
    ? list(proData.new, proCard2, `<div class="empty"><h3>No hay pedidos nuevos en tu zona</h3><p>Te avisaremos aquí cuando alguien pida un servicio de tu oficio dentro de tu radio de acción.</p></div>`)
    : tab === 'presupuestos'
      ? list(proData.quoted, proCard2, `<div class="empty"><h3>Todavía no has enviado presupuestos</h3><p>Mira los pedidos nuevos de tu zona y presupuesta los que te encajen.</p><a class="btn" href="#/pedidos?tab=nuevos">Ver pedidos nuevos</a></div>`)
      : list(mine, clientCard, emptyMine);

  $app.innerHTML = `
    <div class="wrap narrow">
      <div class="panel-head"><div><h1>Pedidos</h1><p class="muted">${isPro ? 'Los pedidos de tu zona y los que has hecho tú.' : 'Tus peticiones de presupuesto.'}</p></div>
        <a class="btn" href="#/pedir">${icon('plus')} Nuevo pedido</a></div>
      ${payNotice}
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<a role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" href="#/pedidos?tab=${k}">${l}</a>`).join('')}</div>
      ${body}
    </div>`;
  poller = setInterval(async () => { try { await loadMe(); renderNav(); } catch { /* sin red */ } }, 15000);
}

// ---------- detalle de un pedido ----------
async function viewPedido(id, query = {}) {
  if (!state.me) return go(`#/login?next=${encodeURIComponent(location.hash)}`);
  $app.innerHTML = '<div class="wrap empty"><div class="spinner"></div></div>';
  let d;
  try { d = await api(`/api/orders/${id}`); }
  catch (e) { $app.innerHTML = `<div class="wrap">${errorBox(e.message)}</div>`; bindRetry($app, () => viewPedido(id)); return; }

  activeChat = null;
  if (query.paid) toast('Pago realizado. Lo estamos confirmando…');
  let sig = '', sel = null;
  const o0 = d.order;
  $app.innerHTML = `
    <div class="wrap order">
      <a href="#/pedidos" class="back">${icon('arrow-left')} Volver a pedidos</a>
      <div class="order-grid">
        <div id="odetail"></div>
        <aside class="chatpanel" id="ochat"><div class="empty"><p>${d.role === 'client' ? 'Elige un profesional para hablar con él.' : ''}</p></div></aside>
      </div>
    </div>`;

  const openChat = (proId, name, sub) => {
    sel = proId;
    document.getElementById('ochat').classList.add('on');
    mountChat(document.getElementById('ochat'), { orderId: o0.id, proId, name, sub });
    if (window.innerWidth <= 900) document.getElementById('ochat').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const head = (o, role) => `
    <header class="ohead">
      <div class="oh-top">${statusPill(o.status)}${o.urgency === 'hoy' ? '<span class="tag hot">Urgente</span>' : ''}<span class="muted small">Publicado ${ago(o.created_at)}</span></div>
      <h1>${esc(o.title)}</h1>
      <div class="meta"><span>${tradeIcon(o.trade)} ${esc(o.trade)}</span><span>${icon('clock')} ${URGENCY[o.urgency]}${o.when_text ? ` · ${esc(o.when_text)}` : ''}</span></div>
    </header>
    <section class="osec">
      <h2>${role === 'client' ? 'Tu pedido' : 'Qué necesita'}</h2>
      ${o.description ? `<p class="desc">${esc(o.description).replace(/\n/g, '<br>')}</p>` : '<p class="muted">Sin descripción.</p>'}
      ${thumbs(o.photos)}
      ${estimateText(o) ? `<p class="est-line">${icon('info')} Orientativo (mano de obra, sin materiales): <b>${estimateText(o)}</b></p>` : ''}
    </section>`;

  function renderClient() {
    const o = d.order, parts = d.participants;
    const quoted = parts.filter((p) => p.quote);
    const pending = quoted.filter((p) => p.quote.status === 'pending');
    const lowest = Math.min(...pending.map((p) => p.quote.amount));
    const best = [...pending].filter((p) => p.pro.review_count >= 3).sort((a, b) => b.pro.avg_rating - a.pro.avg_rating)[0];
    const chosen = parts.find((p) => p.pro.id === o.accepted_pro_id);
    const qcard = (p) => {
      const q = p.quote;
      return `
      <article class="qcard ${q.status}">
        <div class="q-head">
          ${avatar({ ...p.pro, id: p.pro.id })}
          <div class="q-who"><a class="name" href="#/pro/${p.pro.id}">${esc(p.pro.name)}</a>
            <div class="rating">${stars(p.pro.avg_rating)} <b>${p.pro.avg_rating ? dec(p.pro.avg_rating) : '—'}</b> <span class="muted">(${p.pro.review_count})</span></div>
            <div class="tags">${p.pro.verified ? `<span class="tag ok">${icon('badge-check')} Verificado</span>` : ''}${q.status === 'pending' && q.amount === lowest && pending.length > 1 ? '<span class="tag ok">Más barato</span>' : ''}${best && best.pro.id === p.pro.id && pending.length > 1 ? '<span class="tag">Mejor valorado</span>' : ''}${p.pro.insured ? `<span class="tag">${icon('shield-check')} Seguro RC</span>` : ''}</div></div>
          <div class="q-amount">${money(q.amount)}<small>${q.materials_included ? 'materiales incluidos' : 'sin materiales'}</small></div>
        </div>
        ${q.message ? `<p class="q-msg">${esc(q.message).replace(/\n/g, '<br>')}</p>` : ''}
        <div class="meta">${q.visit_when ? `<span>${icon('calendar')} ${esc(q.visit_when)}</span>` : ''}${p.pro.distance_km != null ? `<span>${icon('map-pin')} a ${dec(p.pro.distance_km)} km</span>` : ''}<span>${icon('briefcase')} ${p.pro.years_exp} años</span></div>
        <div class="q-actions">
          ${o.status === 'open' && q.status === 'pending' ? `<button class="btn" data-accept="${q.id}" data-name="${esc(p.pro.name)}" data-amount="${q.amount}">Aceptar presupuesto</button>` : ''}
          ${o.status !== 'cancelled' && !(o.status !== 'open' && o.accepted_pro_id !== p.pro.id) ? `<button class="btn ghost" data-chat="${p.pro.id}" data-name="${esc(p.pro.name)}" data-sub="${esc(p.pro.trade)}">${icon('message-circle')} Chatear${p.unread ? ` <span class="badge">${p.unread}</span>` : ''}</button>` : ''}
          ${q.status === 'accepted' ? '<span class="tag ok">Elegido</span>' : q.status === 'rejected' ? '<span class="tag">No elegido</span>' : ''}
        </div>
      </article>`;
    };
    const asking = parts.filter((p) => !p.quote && o.status === 'open');
    let main;
    if (o.status === 'open') {
      main = `<section class="osec">
        <h2>Presupuestos${quoted.length ? ` (${quoted.length})` : ''}</h2>
        ${quoted.length ? `<div class="qlist">${quoted.map(qcard).join('')}</div>` : `
          <div class="waiting">${icon('bell')}<div><b>Estamos avisando a los profesionales de tu zona</b>
          <p class="muted">${d.matching_pros ? `${d.matching_pros} ${d.matching_pros === 1 ? 'profesional cubre' : 'profesionales cubren'} tu dirección y ${d.matching_pros === 1 ? 'verá' : 'verán'} tu pedido. Esta página se actualiza sola cuando lleguen presupuestos.` : 'Todavía no hay profesionales de este oficio que lleguen a tu dirección. Mantendremos el pedido abierto.'}</p></div></div>`}
        ${asking.map((p) => `<article class="qcard"><div class="q-head">${avatar(p.pro)}<div class="q-who"><a class="name" href="#/pro/${p.pro.id}">${esc(p.pro.name)}</a><div class="muted small">Te ha escrito antes de presupuestar</div></div></div>
          <div class="q-actions"><button class="btn ghost" data-chat="${p.pro.id}" data-name="${esc(p.pro.name)}" data-sub="${esc(p.pro.trade)}">${icon('message-circle')} Chatear${p.unread ? ` <span class="badge">${p.unread}</span>` : ''}</button></div></article>`).join('')}
      </section>`;
    } else if (chosen) {
      main = `<section class="osec"><h2>${o.status === 'cancelled' ? 'Pedido cancelado' : 'Profesional elegido'}</h2><div class="qlist">${qcard(chosen)}</div>
        ${o.status === 'done' ? `<p class="ok-text">${icon('check')} Trabajo finalizado. ¿Qué tal fue?</p><a class="btn" href="#/pro/${chosen.pro.id}">Valorar a ${esc(firstName(chosen.pro.name))}</a>` : ''}</section>`;
    } else {
      main = `<section class="osec"><h2>Pedido cancelado</h2><p class="muted">Este pedido se canceló antes de elegir presupuesto.</p></section>`;
    }
    const place = `<section class="osec"><h2>Dónde</h2><p>${icon('map-pin')} ${esc(o.address_label)}${o.address_detail ? ` · ${esc(o.address_detail)}` : ''}</p>
      <p class="muted small">Los profesionales solo ven tu barrio hasta que eliges uno.</p></section>`;
    const pm = d.pay_mode !== 'off', ps = d.payment?.status;
    const actions = `<div class="oactions">
      ${o.status === 'taken' && (!pm || ps === 'held') ? `<button class="btn" id="bFinish">${pm ? 'Confirmar trabajo hecho y liberar el pago' : 'Marcar como finalizado'}</button>` : ''}
      ${o.status === 'taken' && pm && ps === 'held' ? '<button class="btn ghost" id="bDispute">Tengo un problema</button>' : ''}
      ${['open', 'taken'].includes(o.status) && ps !== 'disputed' && !d.payment?.pro_done_at ? `<button class="btn ghost" id="bCancel">${ps === 'held' ? 'Cancelar y reembolsar' : 'Cancelar pedido'}</button>` : ''}</div>`;
    $app.querySelector('#odetail').innerHTML = head(o, 'client') + (pm ? payBoxClient(d) : '') + main + place + actions;
    const bp = document.getElementById('bPay');
    if (bp) bp.onclick = async () => { try { await startPayment(o, d.payment.amount, refresh); } catch (e) { toast(e.message, 'err'); } };
    const bd = document.getElementById('bDispute');
    if (bd) bd.onclick = async () => {
      const reason = prompt('Cuéntanos qué ha pasado (mínimo 10 caracteres). El pago quedará congelado hasta que lo revisemos:');
      if (reason == null) return;
      try { await api(`/api/orders/${o.id}/dispute`, { method: 'POST', body: { reason } }); toast('Reclamación abierta'); await refresh(true); } catch (e) { toast(e.message, 'err'); }
    };
    bindThumbs($app, o.photos);

    $app.querySelectorAll('[data-chat]').forEach((b) => (b.onclick = () => openChat(Number(b.dataset.chat), b.dataset.name, b.dataset.sub)));
    $app.querySelectorAll('[data-accept]').forEach((b) => (b.onclick = async () => {
      if (!confirm(`¿Aceptar el presupuesto de ${money(Number(b.dataset.amount))} de ${b.dataset.name}? Los demás se descartarán.`)) return;
      try { await api(`/api/orders/${o.id}/accept`, { method: 'POST', body: { quoteId: Number(b.dataset.accept) } }); toast('Presupuesto aceptado'); await refresh(true); openChat(d.order.accepted_pro_id, b.dataset.name, ''); }
      catch (e) { toast(e.message, 'err'); }
    }));
    const fin = document.getElementById('bFinish');
    if (fin) fin.onclick = async () => { if (!confirm(pm ? '¿Confirmas que el trabajo está hecho? Se liberará el pago al profesional.' : '¿Marcar el trabajo como finalizado?')) return; try { await api(`/api/orders/${o.id}/finish`, { method: 'POST' }); await refresh(true); } catch (e) { toast(e.message, 'err'); } };
    const can = document.getElementById('bCancel');
    if (can) can.onclick = async () => { if (!confirm(ps === 'held' ? '¿Cancelar el pedido? Te devolveremos el pago íntegro.' : '¿Cancelar este pedido? No se puede deshacer.')) return; try { await api(`/api/orders/${o.id}/cancel`, { method: 'POST' }); await refresh(true); } catch (e) { toast(e.message, 'err'); } };

    if (!sel && chosen) openChat(chosen.pro.id, chosen.pro.name, chosen.pro.trade);
  }

  function renderPro() {
    const o = d.order, q = d.my_quote;
    const status = q
      ? { pending: o.status === 'open' ? 'Esperando respuesta del cliente' : 'Sin resolver', accepted: '🎉 ¡El cliente te ha elegido!', rejected: 'El cliente ha elegido otro presupuesto' }[q.status]
      : '';
    const noPayouts = d.can_quote && d.pay_mode !== 'off' && !d.payouts_ready;
    const form = noPayouts ? `<div class="waiting">${icon('euro')}<div><b>Configura tus cobros para presupuestar</b><p class="muted">Necesitamos saber dónde transferirte el dinero cuando termines un trabajo. Son unos minutos y se hace una sola vez.</p><a class="btn" href="#/cobros">Configurar cobros</a></div></div>` : d.can_quote ? `
      <form class="qform" id="qf">
        <h3>${q ? 'Actualizar tu presupuesto' : 'Enviar presupuesto'}</h3>
        <div class="grid2">
          <label>Importe total (€)<input name="amount" type="number" min="1" max="100000" step="1" required value="${q ? q.amount : ''}" placeholder="p. ej. 65">
            ${d.pay_mode !== 'off' ? `<small class="muted" id="netHint">Comisión de la plataforma: ${d.fee_pct} %. Se descuenta al cobrar.</small>` : ''}</label>
          <label>¿Cuándo podrías ir?<input name="visit_when" maxlength="120" value="${esc(q?.visit_when || '')}" placeholder="Mañana por la tarde"></label>
        </div>
        <label class="check"><input type="checkbox" name="materials" ${q?.materials_included ? 'checked' : ''}> El importe incluye materiales</label>
        <label>Mensaje<textarea name="message" rows="3" maxlength="1000" placeholder="Qué incluye, cómo lo harías, si necesitas ver algo antes…">${esc(q?.message || '')}</textarea></label>
        <div class="inline"><button class="btn">${q ? 'Guardar cambios' : 'Enviar presupuesto'}</button>${q ? '<button type="button" class="btn ghost" id="bWithdraw">Retirar presupuesto</button>' : ''}</div>
      </form>` : '';
    const mine = q ? `<section class="osec"><h2>Tu presupuesto</h2>
      <div class="qcard ${q.status}"><div class="q-head"><div class="q-who"><b>${status}</b>${q.message ? `<p class="q-msg">${esc(q.message)}</p>` : ''}</div>
      <div class="q-amount">${money(q.amount)}<small>${q.materials_included ? 'materiales incluidos' : 'sin materiales'}</small></div></div></div></section>` : '';
    const place = `<section class="osec"><h2>Dónde</h2>
      ${d.won ? `<p>${icon('map-pin')} ${esc(o.address_label)}${o.address_detail ? ` · ${esc(o.address_detail)}` : ''}</p><p class="muted small">Cliente: ${esc(d.client_name)}</p>`
        : `<p>${icon('map-pin')} ${esc(o.area)} · a ${dec(d.distance_km)} km de tu base</p><p class="muted small">La dirección exacta se muestra cuando el cliente te elige.</p>`}</section>`;
    const pm = d.pay_mode !== 'off', pp = d.payment;
    const actions = `<div class="oactions">${o.status === 'taken' && d.won && (!pm || (pp?.status === 'held' && !pp.pro_done_at)) ? `<button class="btn" id="bFinish">${pm ? 'Marcar trabajo como terminado' : 'Marcar como finalizado'}</button>` : ''}</div>`;
    const warn = o.status === 'cancelled' ? '<div class="notice">El cliente ha cancelado este pedido.</div>'
      : o.status !== 'open' && !d.won ? '<div class="notice">Este pedido ya está asignado a otro profesional.</div>' : '';
    $app.querySelector('#odetail').innerHTML = warn + head(o, 'pro') + (d.won && pm ? payBoxPro(d) : '') + place + mine + (form ? `<section class="osec">${form}</section>` : '') + actions;
    const amountIn = document.querySelector('#qf [name=amount]'), hint = document.getElementById('netHint');
    if (amountIn && hint) {
      const upd = () => { const a = Number(amountIn.value); hint.textContent = a > 0 ? `Comisión de la plataforma: ${d.fee_pct} %. Recibirías ${money(Math.round(a * (100 - d.fee_pct)) / 100)}.` : `Comisión de la plataforma: ${d.fee_pct} %. Se descuenta al cobrar.`; };
      amountIn.oninput = upd; upd();
    }
    bindThumbs($app, o.photos);

    const qf = document.getElementById('qf');
    if (qf) qf.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/api/orders/${o.id}/quotes`, { method: 'POST', body: { amount: qf.amount.value, visit_when: qf.visit_when.value, materials_included: qf.materials.checked, message: qf.message.value } });
        toast(q ? 'Presupuesto actualizado' : 'Presupuesto enviado'); await refresh(true);
      } catch (err) { toast(err.message, 'err'); }
    };
    const wd = document.getElementById('bWithdraw');
    if (wd) wd.onclick = async () => { if (!confirm('¿Retirar tu presupuesto?')) return; try { await api(`/api/orders/${o.id}/quotes/withdraw`, { method: 'POST' }); await refresh(true); } catch (err) { toast(err.message, 'err'); } };
    const fin = document.getElementById('bFinish');
    if (fin) fin.onclick = async () => { if (!confirm(pm ? '¿Has terminado el trabajo? El cliente podrá confirmarlo o reclamar; si no, el pago se liberará automáticamente.' : '¿Marcar el trabajo como finalizado?')) return; try { await api(`/api/orders/${o.id}/finish`, { method: 'POST' }); await refresh(true); } catch (err) { toast(err.message, 'err'); } };

    if (!sel && !(o.status === 'cancelled') && (o.status === 'open' || d.won)) openChat(state.me.id, d.client_name || 'Cliente', 'Cliente');
  }

  const render = () => (d.role === 'client' ? renderClient() : renderPro());
  const signature = () => JSON.stringify([d.order.status, d.order.accepted_pro_id, d.participants?.map((p) => [p.pro.id, p.quote?.id, p.quote?.amount, p.quote?.status, p.unread]), d.my_quote?.status, d.my_quote?.amount, d.payment?.status, d.payment?.pro_done_at]);
  async function refresh(force) {
    const nd = await api(`/api/orders/${id}`);
    d = nd;
    const s = signature();
    if (force || s !== sig) { sig = s; render(); }
    await loadMe(); renderNav();
  }
  sig = signature(); render();
  loadMe().then(renderNav);
  poller = setInterval(async () => {
    try { await refresh(false); if (activeChat) await activeChat.load(false); } catch { /* sin red */ }
  }, 6000);
}

// ---------- cobros del profesional ----------
async function viewCobros(query) {
  if (!state.me) return go(`#/login?next=${encodeURIComponent('#/cobros')}`);
  $app.innerHTML = '<div class="wrap empty"><div class="spinner"></div></div>';
  let st;
  try { st = await api('/api/pay/status'); } catch (e) { $app.innerHTML = `<div class="wrap">${errorBox(e.message)}</div>`; return; }
  const body = st.mode === 'off' ? '<p class="muted">Los pagos a través de la plataforma no están activados.</p>'
    : st.mode === 'simulated' ? '<div class="notice">Modo demostración: los cobros son simulados y no hace falta configurar nada. No se mueve dinero real.</div>'
    : st.ready ? `<p class="ok-text">${icon('check')} Tus cobros están activados. Recibirás el dinero de los trabajos que el cliente confirme.</p><button class="btn ghost" id="bDash">Abrir mi panel de pagos</button>`
    : `<p>${st.started ? 'Falta completar un paso para activar tus cobros.' : 'Configura dónde quieres recibir el dinero de tus trabajos.'} Lo gestiona Stripe, nuestro proveedor de pagos: te pedirá tus datos y una cuenta bancaria. Se hace una sola vez.</p><button class="btn big" id="bConnect">${st.started ? 'Continuar configuración' : 'Configurar cobros'}</button>`;
  $app.innerHTML = `
    <div class="wrap narrow">
      <h1>Cobros</h1>
      <div class="osec">${body}</div>
      <div class="osec"><h2>Cómo funciona</h2>
        <ul class="plain">
          <li>Cuando un cliente acepta tu presupuesto, <b>paga a través de la plataforma</b> y retenemos el dinero. Así sabes que el trabajo está pagado antes de empezar.</li>
          <li>Al terminar, el cliente confirma y <b>te transferimos el importe menos la comisión del ${st.fee_pct} %</b>.</li>
          <li>Si marcas el trabajo como terminado y el cliente no responde ni reclama en ${st.release_hours} horas, el pago se libera solo.</li>
          <li>Si hay una reclamación, el pago queda congelado hasta que la revisemos. Más detalle en las <a href="#/legal/condiciones">condiciones de pago</a>.</li>
        </ul></div>
    </div>`;
  const go2 = async (path) => { try { const r = await api(path, { method: 'POST' }); if (r.url) location.href = r.url; } catch (e) { toast(e.message, 'err'); } };
  const bc = document.getElementById('bConnect'); if (bc) bc.onclick = () => go2('/api/pay/connect');
  const bd = document.getElementById('bDash'); if (bd) bd.onclick = () => go2('/api/pay/dashboard');
  if (query.return) toast(st.ready ? 'Cobros activados' : 'Aún falta completar algún paso');
}

// ---------- administración: pagos y reclamaciones ----------
async function viewAdmin() {
  if (!state.me) return go(`#/login?next=${encodeURIComponent('#/admin')}`);
  $app.innerHTML = '<div class="wrap empty"><div class="spinner"></div></div>';
  let rows;
  try { rows = await api('/api/admin/payments'); } catch (e) { $app.innerHTML = `<div class="wrap"><div class="empty"><h3>${esc(e.message)}</h3></div></div>`; return; }
  const LABEL = { pending: 'Pendiente de pago', held: 'Retenido', disputed: 'En reclamación', released: 'Liberado', refunded: 'Reembolsado' };
  $app.innerHTML = `
    <div class="wrap narrow">
      <h1>Pagos y reclamaciones</h1>
      <div class="olist">${rows.length ? rows.map((p) => `
        <div class="ocard">
          <div class="oc-top"><b>#${p.order_id} · ${esc(p.title)}</b><span class="pill ${p.status === 'disputed' ? 'cancelled' : p.status === 'held' ? 'taken' : 'open'}">${LABEL[p.status]}</span></div>
          <div class="meta"><span>Cliente: ${esc(p.client_name)}</span><span>Profesional: ${esc(p.pro_name)}</span><span>${money(p.amount)} (comisión ${money(p.fee)})</span></div>
          ${p.dispute_reason ? `<p class="q-msg"><b>Motivo:</b> ${esc(p.dispute_reason)}</p>` : ''}
          ${['disputed', 'held'].includes(p.status) ? `<div class="q-actions"><button class="btn" data-a="refund" data-id="${p.order_id}">Reembolsar al cliente</button><button class="btn ghost" data-a="release" data-id="${p.order_id}">Liberar al profesional</button></div>` : ''}
        </div>`).join('') : '<div class="empty"><p>Todavía no hay pagos.</p></div>'}</div>
    </div>`;
  $app.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
    const msg = b.dataset.a === 'refund' ? '¿Reembolsar el pago al cliente y cancelar el pedido?' : '¿Liberar el pago al profesional?';
    if (!confirm(msg)) return;
    try { await api(`/api/admin/orders/${b.dataset.id}/resolve`, { method: 'POST', body: { action: b.dataset.a } }); toast('Hecho'); viewAdmin(); } catch (e) { toast(e.message, 'err'); }
  }));
}
