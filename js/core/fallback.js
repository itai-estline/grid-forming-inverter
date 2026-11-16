// Static fallback (no WebGL, prefers-reduced-motion, or ?static=1): a normal scrolling page
// generated from content/home.json, same header, menu and footer.
import { HEADLINES, PATHS } from './config.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pad = (n) => String(n).padStart(2, '0');

export function buildFallback(content, reason) {
  const body = document.body;
  body.classList.remove('is-loading');
  body.classList.add('is-static');
  document.querySelector('[data-loader]')?.remove();
  for (const sel of ['#gl', '.scrim', '[data-station]', '[data-counter]', '[data-headline]', '[data-labels]', '[data-hint]', '[data-track]', '[data-closing]', '[data-intro-cue]']) {
    const n = document.querySelector(sel); if (n) n.remove();
  }
  const site = content.site;
  const main = document.querySelector('[data-static]');
  main.hidden = false;
  main.innerHTML = '';

  const hero = el('header', 'st-hero');
  hero.appendChild(el('p', 'st-eyebrow', site.logo));
  hero.appendChild(el('h1', 'st-headline', HEADLINES.s01.label));
  hero.appendChild(el('p', 'st-intro', 'This is the plain version of the page: the same stations as the 3D journey, one after another.'));
  main.appendChild(hero);

  const list = el('ol', 'st-list');
  for (const s of content.stations) {
    const li = el('li', 'st-item'); li.id = s.id;
    const fig = el('figure', 'st-fig');
    const img = new Image();
    img.src = PATHS.stationImage(s.id);
    img.alt = '';
    img.width = 1600; img.height = 1000;
    img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => img.remove());
    fig.appendChild(img);
    li.appendChild(fig);
    const txt = el('div', 'st-text');
    txt.appendChild(el('p', 'st-n', `${pad(s.n)} / ${pad(content.stations.length)}`));
    txt.appendChild(el('h2', 'st-title', s.title));
    const cap = el('p', 'st-caption');
    s.caption.forEach((line, k) => { if (k) cap.appendChild(document.createElement('br')); cap.appendChild(document.createTextNode(line)); });
    txt.appendChild(cap);
    const meta = el('p', 'st-meta');
    if (s.number) meta.appendChild(el('span', 'st-num', s.number.value));
    const src = s.number ? s.number.source : s.source;
    if (src) meta.appendChild(el('span', 'st-src', `Source: ${src}${s.number && s.source && s.source !== s.number.source ? '. ' + s.source : ''}`));
    if (s.illustrative) meta.appendChild(el('span', 'chip ill-chip', site.illustrativeLabel));
    if (s.tierNote) meta.appendChild(el('span', 'tier-note', s.tierNote));
    txt.appendChild(meta);
    if (s.deeper) { const a = el('a', 'deeper'); a.href = s.deeper.href; a.appendChild(el('span', null, s.deeper.label)); a.appendChild(el('span', 'arrow', '→')); txt.appendChild(a); }
    li.appendChild(txt);
    list.appendChild(li);
  }
  main.appendChild(list);

  const foot = el('footer', 'st-footer');
  foot.id = 'details';
  foot.appendChild(el('h2', 'st-headline small', HEADLINES.s16.label));
  const links = el('ul', 'closing-links');
  for (const m of site.menu) { const l = el('li'); const a = el('a', null, m.title); a.href = m.href; l.appendChild(a); links.appendChild(l); }
  foot.appendChild(links);
  foot.appendChild(el('p', 'closing-credit', site.credit));
  const tools = el('p', 'closing-tools'); tools.appendChild(el('span', 'k', 'Tools')); tools.appendChild(document.createTextNode(' ' + site.tools)); foot.appendChild(tools);
  main.appendChild(foot);

  // header menu still works; skip link goes to the footer links
  const skip = document.querySelector('[data-skip]');
  if (skip) skip.setAttribute('href', '#details');
  const sound = document.querySelector('[data-sound-btn]'); if (sound) sound.remove();
  const panel = document.querySelector('[data-menu-panel]'); if (panel) panel.id = 'menu-panel';
  const btn = document.querySelector('[data-menu-btn]'); if (btn) btn.setAttribute('aria-controls', 'menu-panel');
  const menuList = document.querySelector('[data-menu-list]');
  if (menuList && !menuList.children.length) for (const m of site.menu) { const l = el('li'); const a = el('a', null, m.title); a.href = m.href; l.appendChild(a); menuList.appendChild(l); }
  if (btn && panel) {
    let open = false;
    const set = (o) => { open = o; panel.hidden = !o; btn.setAttribute('aria-expanded', String(o)); };
    btn.addEventListener('click', () => { set(!open); if (open) panel.querySelector('a')?.focus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { set(false); btn.focus(); } });
  }
  const h = location.hash && document.getElementById(location.hash.slice(1));
  if (h) h.scrollIntoView();
  document.documentElement.dataset.mode = 'static';
  if (reason) document.documentElement.dataset.staticReason = reason;
}
