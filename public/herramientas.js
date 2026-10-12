'use strict';
/* Herramientas gratuitas: «¿Cuánto cuesta?» y «¿Está bien este presupuesto?». Sin registro. Usa utilidades de app.js. */

const eurTxt = (n) => `${Number(n).toLocaleString('es-ES')} €`;
const rangeTxt = (m) => `${eurTxt(m.min)} – ${eurTxt(m.max)}`;
const matchCard = (m, extra = '') => `
  <div class="osec">
    <div class="muted small">${tradeIcon(m.trade)} ${esc(m.trade)}</div>
    <h2>${esc(m.name)}</h2>
    <div class="bigrange">${rangeTxt(m)}</div>
    <p class="muted">Mano de obra, sin materiales ni IVA. ${esc(m.note)}.</p>
    ${extra}
    <p class="small"><a href="/precios/${esc(m.trade_slug)}/${esc(m.slug)}">Ver más sobre este trabajo →</a></p>
  </div>`;
const toolDisclaimer = '<p class="muted small">Referencia orientativa elaborada por Oficio Cerca; no es un presupuesto. El precio real depende de la zona, la complejidad y el profesional.</p>';

function viewPresupuestador(query) {
  $app.innerHTML = `
    <div class="wrap narrow">
      <h1>¿Cuánto cuesta arreglarlo?</h1>
      <p class="muted">Cuéntanos qué necesitas y te damos el rango habitual de mano de obra en España. Gratis y sin registro.</p>
      <form class="toolform" id="ef">
        <label class="sr-only" for="eq">Qué necesitas</label>
        <textarea id="eq" rows="2" maxlength="300" placeholder="Ej.: Instalar un aire acondicionado split en el salón">${esc(query.q || '')}</textarea>
        <button class="btn big">Calcular</button>
      </form>
      <div class="quick">${['Se ha atascado el fregadero', 'Cambiar un grifo', 'Cambiar el diferencial', 'Instalar un split', 'Pintar una habitación'].map((t) => `<button type="button" class="chip-btn">${esc(t)}</button>`).join('')}</div>
      <div class="toolres" id="eres" aria-live="polite"></div>
    </div>`;
  const form = document.getElementById('ef'), res = document.getElementById('eres');
  const run = async (text) => {
    text = String(text || '').trim();
    if (text.length < 3) return toast('Cuéntanos qué necesitas', 'err');
    res.innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    try {
      const d = await api('/api/tools/estimate', { method: 'POST', body: { text } });
      const m = d.matches[0];
      if (!m) {
        res.innerHTML = `<div class="osec"><h2>No tengo una referencia para eso</h2><p class="muted">Todavía no cubro ese tipo de trabajo. Cuéntaselo al asistente y los profesionales de tu zona te enviarán presupuestos reales.</p><a class="btn" href="#/pedir?${qs({ q: text })}">Pedir presupuestos</a></div>`;
        return;
      }
      const real = d.measured ? `<div class="est">${icon('info')}<span>Medido en Oficio Cerca: la mitad de los ${d.measured.n} presupuestos aceptados de ${esc(m.trade.toLowerCase())} estuvo entre <b>${eurTxt(d.measured.p25)}</b> y <b>${eurTxt(d.measured.p75)}</b>.</span></div>` : '';
      res.innerHTML = matchCard(m, real) +
        (d.matches.length > 1 ? `<div class="osec"><h3>¿Te referías a otra cosa?</h3><div class="chips-links">${d.matches.slice(1).map((x) => `<a href="#" data-q="${esc(x.name)}">${esc(x.name)} · ${rangeTxt(x)}</a>`).join('')}</div></div>` : '') +
        `<div class="pro-cta small"><div><h3>¿Quieres el precio real?</h3><p>Recibe presupuestos de profesionales de tu zona. Gratis y sin compromiso.</p></div><a class="btn light" href="#/pedir?${qs({ q: text })}">Pedir presupuestos</a></div>` + toolDisclaimer;
      res.querySelectorAll('[data-q]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); document.getElementById('eq').value = a.dataset.q; run(a.dataset.q); }));
    } catch (e) { res.innerHTML = ''; toast(e.message, 'err'); }
  };
  form.onsubmit = (e) => { e.preventDefault(); run(document.getElementById('eq').value); };
  document.getElementById('eq').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
  document.querySelectorAll('.quick button').forEach((b) => (b.onclick = () => { document.getElementById('eq').value = b.textContent; run(b.textContent); }));
  if (query.q) run(query.q);
}

function viewComparador(query) {
  $app.innerHTML = `
    <div class="wrap narrow">
      <h1>¿Está bien este presupuesto?</h1>
      <p class="muted">Dinos qué trabajo es y cuánto te han pedido, y lo comparamos con el rango habitual en España. Gratis y sin registro.</p>
      <form class="toolform" id="cmp">
        <label>Trabajo<input id="cq" maxlength="300" required placeholder="Ej.: Cambiar el bombín de la puerta" value="${esc(query.q || '')}"></label>
        <label>Importe que te han pedido (€)<input id="ca" type="number" min="1" step="1" required placeholder="Ej.: 180" value="${esc(query.amount || '')}"></label>
        <button class="btn big">Comparar</button>
      </form>
      <div class="toolres" id="cres" aria-live="polite"></div>
    </div>`;
  const res = document.getElementById('cres');
  document.getElementById('cmp').onsubmit = async (e) => {
    e.preventDefault();
    res.innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    try {
      const d = await api('/api/tools/compare', { method: 'POST', body: { text: document.getElementById('cq').value, amount: document.getElementById('ca').value } });
      if (!d.match) {
        res.innerHTML = `<div class="osec"><h2>No tengo una referencia para ese trabajo</h2><p class="muted">Prueba a describirlo de otra forma, o pide presupuestos y compara precios reales.</p><a class="btn" href="#/pedir?${qs({ q: document.getElementById('cq').value })}">Pedir presupuestos</a></div>`;
        return;
      }
      res.innerHTML = `
        <div class="verdict ${esc(d.verdict.level)}"><h2>${esc(d.verdict.label)}</h2><p>${esc(d.verdict.text)}</p></div>
        ${matchCard(d.match, `<p>Te han pedido <b>${eurTxt(d.amount)}</b>.</p>`)}
        <div class="pro-cta small"><div><h3>¿Quieres otro presupuesto?</h3><p>Compara con precios reales de profesionales de tu zona.</p></div><a class="btn light" href="#/pedir?${qs({ q: document.getElementById('cq').value })}">Pedir presupuestos</a></div>${toolDisclaimer}`;
    } catch (err) { res.innerHTML = ''; toast(err.message, 'err'); }
  };
  if (query.q && query.amount) document.getElementById('cmp').requestSubmit();
}
