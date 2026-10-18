'use strict';
/* Filas deslizables de precios de referencia en la portada: una por oficio, con una tarjeta con foto por trabajo
   (rango de mano de obra) que enlaza a su página de precio. Flechas para desplazar y «Ver todos» por oficio. */

// Fotos de Unsplash (licencia Unsplash, uso gratuito): id de la foto y autor, por trabajo
const PRICE_PHOTOS = {
  'desatasco-fregadero': ['1662922487611-410bf8d1497f', 'Serena Naclerio'],
  'cambiar-grifo': ['1585704032915-c3400ca199e7', 'Erik Mclean'],
  'reparar-fuga': ['1596394723269-b2cbca4e6313', 'Elimende Inagella'],
  'cambiar-cisterna': ['1676210134050-6f12c6898395', 'Timur Shakerzianov'],
  'cambiar-sifon': ['1654440122140-f1fc995ddb34', 'Daniel Dan'],
  'instalar-termo': ['1676210134188-4c05dd172f89', 'Timur Shakerzianov'],
  'instalar-lavadora': ['1626806787461-102c1bfaaea1', 'PlanetCare'],
  'cambiar-diferencial': ['1576446470246-499c738d1c8e', 'Mark Kats'],
  'cambiar-magnetotermico': ['1544724569-5f546fd6f2b5', 'Markus Spiske'],
  'punto-luz-enchufe': ['1610056494071-9373f12bf769', 'Kelly Sikkema'],
  'revision-cuadro': ['1758101755915-462eddc23f57', 'Toolmash Expo'],
  'boletin-electrico': ['1621905251189-08b45d6a269e', 'Emmanuel Ikwuegbu'],
  'instalar-lampara': ['1563973153236-794eef98609f', 'an_vision'],
  'punto-recarga': ['1600490819528-42405785433a', 'Evnex Ltd'],
  'revision-gas': ['1761758674188-2b8e4c89c5e2', 'Gabriel Vasiliu'],
  'reparar-caldera': ['1676210134190-3f2c0d5cf58d', 'Timur Shakerzianov'],
  'cambiar-caldera': ['1650551182991-b07558247564', 'Immo Wegmann'],
  'instalar-cocina-gas': ['1608454770647-01dc0f7dd97d', 'Myko Makh'],
  'apertura-puerta': ['1677951570313-b0750351c461', 'Dima Solomin'],
  'cambiar-bombin': ['1563845104292-41c1b4825255', 'Raychan'],
  'cambiar-cerradura': ['1538766017398-415434a31a5b', 'Jan Tinneberg'],
  'pintar-habitacion': ['1562259949-e8e7689d7828', 'Theme Photos'],
  'pintar-piso': ['1717281234297-3def5ae3eee1', 'Ernys'],
  'quitar-gotele': ['1768839725085-829e6ac7ac26', 'Sasun Bughdaryan'],
  'lacar-puerta': ['1577670552647-6ce12a463e7d', 'Yucel M'],
  'reforma-bano': ['1584622650111-993a426fbf0a', 'Lotus Design N Print'],
  'tapar-grietas': ['1694415847950-973e7dcca94d', 'Lallaoke'],
  'tabique-pladur': ['1482731215275-a1f151646268', 'H&CO'],
  'ajustar-puerta': ['1544641724-73f0d1bee38b', 'Jon Tyson'],
  'montar-armario': ['1558997519-83ea9252edf8', 'Rumman Amin'],
  'reparar-persiana': ['1527030126234-095ace44080f', 'Wade Lambert'],
  'instalar-split': ['1718203862467-c33159fdc504', 'Everett Pachmann'],
  'mantenimiento-split': ['1737012197886-7d5a52ded45b', 'Birmingham Airduct Cleaning Services'],
  'recarga-gas-aire': ['1698479603408-1a66a6d9e80f', 'Kettenreaktion'],
  'montar-mueble': ['1571018400279-7f33252d0ad6', 'David Schultz'],
  'colgar-cuadros': ['1513519245088-0e12902e5a38', 'Jonny Caspari'],
};
const unsplash = (id, w) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${Math.round(w * 0.75)}&fit=crop&auto=format&q=70`;

function renderPriceRows(el, groups) {
  const eur = (v) => v.toLocaleString('es-ES');
  const pros = (g) => (g.pros ? `${g.pros} ${g.pros === 1 ? 'profesional' : 'profesionales'}` : '');
  el.innerHTML = `
    <div class="pfilter" role="group" aria-label="Filtrar por oficio">
      <button type="button" class="pchip" data-f="" aria-pressed="true">Todos</button>
      ${groups.map((g, gi) => `<button type="button" class="pchip" data-f="${gi}" aria-pressed="false">${tradeIcon(g.trade)}${esc(g.trade)}</button>`).join('')}
    </div>` + groups.map((g, gi) => `
    <section class="prow" data-g="${gi}" aria-labelledby="prow-${gi}">
      <div class="prow-head">
        <h3 id="prow-${gi}"><a href="/precios/${esc(g.slug)}">${esc(g.trade)} <span aria-hidden="true">›</span></a></h3>
        <div class="prow-nav">
          <button type="button" class="prow-arrow" data-d="-1" aria-label="Ver trabajos anteriores de ${esc(g.trade)}">‹</button>
          <button type="button" class="prow-arrow" data-d="1" aria-label="Ver más trabajos de ${esc(g.trade)}">›</button>
          <a class="prow-all" href="/precios/${esc(g.slug)}">Ver todos</a>
        </div>
      </div>
      <div class="prow-track">
        ${g.items.map((it) => {
          const ph = PRICE_PHOTOS[it.slug];
          return `
          <article class="pcard" style="--h:${tradeHue(g.trade)}">
            <a class="pcard-link" href="/precios/${esc(g.slug)}/${esc(it.slug)}">
              <div class="pcard-img">
                ${ph
                  ? `<img src="${unsplash(ph[0], 480)}" srcset="${unsplash(ph[0], 480)} 480w, ${unsplash(ph[0], 900)} 900w" sizes="(max-width: 700px) 260px, 320px" alt="" loading="lazy" title="Foto: ${esc(ph[1])} / Unsplash">`
                  : `<span class="pcard-ph">${tradeIcon(g.trade)}</span>`}
                ${g.pros ? `<span class="pcard-badge">${pros(g)}</span>` : ''}
              </div>
              <div class="pcard-body">
                <h4>${esc(it.name)}</h4>
                <p>${esc(it.note || '')}</p>
              </div>
              <div class="pcard-foot">
                ${g.reviews ? `<span class="pcard-rate">★ ${dec(g.rating)} <span>· (${g.reviews})</span></span>` : '<span class="pcard-rate"><span>Sin reseñas aún</span></span>'}
                <b>${eur(it.min)}–${eur(it.max)} €</b>
              </div>
            </a>
            <a class="pcard-ask" href="#/pedir?${qs({ q: it.name })}" aria-label="Pedir presupuestos para: ${esc(it.name)}" title="Pedir presupuestos">${icon('sparkles')}</a>
          </article>`;
        }).join('')}
      </div>
    </section>`).join('') +
    `<p class="prow-credit">Fotos de <a href="https://unsplash.com" target="_blank" rel="noopener">Unsplash</a>. La valoración es la media de los profesionales de cada oficio en Oficio Cerca.</p>`;

  // Filtro por oficio: muestra solo esa fila y despliega todas sus tarjetas
  const chips = el.querySelectorAll('.pchip');
  chips.forEach((c) => (c.onclick = () => {
    const f = c.dataset.f;
    chips.forEach((x) => x.setAttribute('aria-pressed', x === c));
    el.classList.toggle('is-filtered', f !== '');
    el.querySelectorAll('.prow').forEach((row) => (row.hidden = f !== '' && row.dataset.g !== f));
    c.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }));

  el.querySelectorAll('.prow').forEach((row) => {
    const track = row.querySelector('.prow-track');
    const arrows = row.querySelectorAll('.prow-arrow');
    const sync = () => {
      arrows[0].disabled = track.scrollLeft < 4;
      arrows[1].disabled = track.scrollLeft + track.clientWidth > track.scrollWidth - 4;
    };
    arrows.forEach((b) => (b.onclick = () => track.scrollBy({ left: Number(b.dataset.d) * track.clientWidth * 0.8, behavior: 'smooth' })));
    track.addEventListener('scroll', sync, { passive: true });
    new ResizeObserver(sync).observe(track);
    sync();
  });
}
