// Entry point for every detail page (PLAN 7.1).
// Fills the shared header and footer, builds the "On this page" list,
// enhances footnotes and tables, adds the "Illustrative model" badge to
// widgets, and lazily loads the chart and part-viewer modules.

import { NAV, SITE } from './nav.js';

const doc = document;
const body = doc.body;
const currentPage = (body.dataset.page || '').trim();
const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');

doc.documentElement.classList.add('js');

/* ---------- small DOM helper ---------- */

function el(tag, attrs, ...kids) {
  const node = doc.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v; // only used with static strings below
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    node.append(kid);
  }
  return node;
}

const GLYPH =
  '<svg class="site-glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
  '<rect x="2.5" y="4.5" width="19" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
  '<path d="M6 12c1.2-4.6 3.3-4.6 4.5 0s3.300 4.600 4.500 0 2.100-3.200 3-1.600" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
  '</svg>';

const CHEVRON =
  '<svg class="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">' +
  '<path d="M2.500 4.500 6 8l3.500-3.500" fill="none" stroke="currentColor" stroke-width="1.500" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function isCurrent(href) {
  return currentPage && href === currentPage + '.html';
}

/* ---------- header ---------- */

function buildHeader() {
  const header = doc.querySelector('[data-site-header]');
  if (!header) return;
  header.textContent = '';

  const logo = el('a', { class: 'site-logo', href: SITE.home, 'aria-label': SITE.logo + ', home' });
  /* review 3: no icon, just the name */
  logo.append(el('span', { text: SITE.logo }));

  const back = el('a', { class: 'site-back', href: SITE.home });
  back.append(el('span', { class: 'arrow', 'aria-hidden': 'true', text: '←' }), ' ' + SITE.backLabel);

  const toggle = el('button', {
    class: 'site-nav__toggle', type: 'button',
    'aria-expanded': 'false', 'aria-controls': 'site-nav-panel'
  });
  toggle.append(
    el('span', { class: 'long', text: SITE.menuLabel }),
    el('span', { class: 'short', text: 'Menu' })
  );
  toggle.insertAdjacentHTML('beforeend', CHEVRON);

  const list = el('ol', { class: 'site-nav__list' });
  NAV.forEach((item, i) => {
    const a = el('a', { href: item.href, 'aria-current': isCurrent(item.href) ? 'page' : null });
    a.append(
      el('span', { class: 'n', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') }),
      el('span', { class: 't-full', text: item.title }),
      el('span', { class: 't-short', text: item.short || item.title })
    );
    list.append(el('li', null, a));
  });

  const panelBack = el('a', { class: 'site-nav__back', href: SITE.home });
  panelBack.append(el('span', { class: 'arrow', 'aria-hidden': 'true', text: '←' }), ' ' + SITE.backLabel);

  const panel = el('div', { class: 'site-nav__panel', id: 'site-nav-panel' }, list, panelBack);
  const nav = el('nav', { class: 'site-nav', 'aria-label': 'Detail pages' }, toggle, panel);
  const bar = el('div', { class: 'site-header__bar' }, logo, back, nav);
  header.append(bar);

  /* inline row when it fits, menu button when it does not */
  let mode = '';
  let open = false;

  function setOpen(next, focusToggle) {
    open = next && mode === 'menu';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    nav.toggleAttribute('data-open', open);
    panel.hidden = mode === 'menu' && !open;
    if (!open && focusToggle) toggle.focus();
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    header.dataset.nav = mode;
    setOpen(false);
  }

  function fit() {
    const wasOpen = open;
    // Try the inline row first and see if it overflows the bar.
    header.dataset.nav = 'inline';
    panel.hidden = false;
    const overflows = bar.scrollWidth > bar.clientWidth + 1 || window.innerWidth < 1100;
    mode = '';
    setMode(overflows ? 'menu' : 'inline');
    if (wasOpen) setOpen(true);
  }

  fit();
  if ('ResizeObserver' in window) {
    let raf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    }).observe(header);
  } else {
    window.addEventListener('resize', fit);
  }
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(fit).catch(() => {});

  toggle.addEventListener('click', () => setOpen(!open));

  const links = () => Array.from(panel.querySelectorAll('a')).filter(a => a.offsetParent !== null);

  nav.addEventListener('keydown', e => {
    if (mode !== 'menu') return;
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false, true);
      return;
    }
    const items = links();
    const idx = items.indexOf(doc.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      const all = links();
      (all[idx + 1] || all[0]).focus();
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      if (idx <= 0) toggle.focus();
      else items[idx - 1].focus();
    } else if (e.key === 'Home' && open && idx >= 0) {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End' && open && idx >= 0) {
      e.preventDefault();
      items[items.length - 1].focus();
    }
  });

  // Close when focus or a click leaves the menu.
  nav.addEventListener('focusout', e => {
    if (open && e.relatedTarget && !nav.contains(e.relatedTarget)) setOpen(false);
  });
  doc.addEventListener('pointerdown', e => {
    if (open && !nav.contains(e.target)) setOpen(false);
  });
}

/* ---------- footer ---------- */

function buildFooter() {
  const footer = doc.querySelector('[data-site-footer]');
  if (!footer) return;
  footer.textContent = '';

  const list = el('ul', { class: 'site-footer__list' });
  NAV.forEach(item => {
    list.append(el('li', null,
      el('a', { href: item.href, 'aria-current': isCurrent(item.href) ? 'page' : null, text: item.title })));
  });

  const tools = el('p', { class: 'tools' });
  tools.append(el('span', { class: 'k', text: 'Tools' }), ' ' + SITE.tools);

  const links = el('p', { class: 'site-footer__links' },
    el('a', { href: 'sources.html', text: 'Sources' }),
    el('a', { href: SITE.home, text: SITE.backLabel })
  );

  footer.append(el('div', { class: 'site-footer__inner' },
    el('div', { class: 'site-footer__credit' },
      el('p', { class: 'credit', text: SITE.credit }), tools, links),
    el('nav', { class: 'site-footer__nav', 'aria-label': 'All detail pages' },
      el('p', { class: 'k', text: 'All chapters' }), list)
  ));
}

/* ---------- "On this page" ---------- */

function slugify(text) {
  return text.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function buildToc() {
  const page = doc.querySelector('.page');
  if (!page) return;
  const entries = [];
  page.querySelectorAll('h2').forEach(h2 => {
    if (h2.closest('.toc, figure, aside, .vcard')) return;
    let id = h2.id;
    let target = h2;
    if (!id) {
      const sec = h2.closest('section[id], article[id]:not(.page)');
      if (sec && sec.querySelector('h2') === h2) {
        id = sec.id;
        target = sec;
      }
    }
    if (!id) return; // PLAN: only headings that have (or sit in a section with) an id
    entries.push({ id, target, text: h2.textContent.trim() });
  });
  if (entries.length < 2) return;

  const ol = el('ol');
  const linkFor = new Map();
  entries.forEach(entry => {
    const a = el('a', { href: '#' + entry.id, text: entry.text });
    linkFor.set(entry, a);
    ol.append(el('li', null, a));
  });
  const details = el('details', null, el('summary', { text: 'On this page' }), ol);
  const toc = el('nav', { class: 'toc', 'aria-label': 'On this page' }, details);

  const head = page.querySelector('.page-head');
  if (head && head.parentNode === page) head.after(toc);
  else page.prepend(toc);
  page.classList.add('has-toc');

  // Open as a sidebar on wide screens, collapsed above the text on narrow ones.
  const mqWide = window.matchMedia('(min-width: 1200px)');
  const sync = () => { details.open = mqWide.matches; };
  sync();
  mqWide.addEventListener('change', sync);
  // Keep it open while it is the sidebar (the summary is just a label there).
  details.addEventListener('toggle', () => { if (mqWide.matches && !details.open) details.open = true; });
  ol.addEventListener('click', e => {
    if (e.target.closest('a') && !mqWide.matches) details.open = false;
  });

  // Mark the section being read.
  let raf = 0;
  let active = null;
  function spy() {
    raf = 0;
    const line = 140;
    let now = null;
    for (const entry of entries) {
      if (entry.target.getBoundingClientRect().top <= line) now = entry;
      else break;
    }
    if (now === active) return;
    if (active) linkFor.get(active).removeAttribute('aria-current');
    active = now;
    if (active) linkFor.get(active).setAttribute('aria-current', 'location');
  }
  window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(spy); }, { passive: true });
  spy();
}

/* ---------- footnotes ---------- */

function enhanceFootnotes() {
  const markers = doc.querySelectorAll('sup.fn a[href^="#"]');
  if (!markers.length) return;

  const pop = el('div', { class: 'fn-pop', role: 'tooltip', id: 'fn-pop', hidden: true });
  body.append(pop);
  let hideTimer = 0;
  let owner = null;

  function show(a) {
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    const note = doc.getElementById(id);
    if (!note) return;
    clearTimeout(hideTimer);
    pop.textContent = '';
    const num = el('span', { class: 'n', text: a.textContent.trim() });
    const copy = el('div', { class: 'fn-pop__text' });
    note.childNodes.forEach(n => copy.append(n.cloneNode(true)));
    copy.querySelectorAll('a[href^="#fnref"], a[aria-label="Back to text"]').forEach(n => n.remove());
    copy.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    pop.append(num, copy);
    pop.hidden = false;
    owner = a;
    a.setAttribute('aria-describedby', 'fn-pop');

    const r = a.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const vw = doc.documentElement.clientWidth;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(12, Math.min(left, vw - pw - 12));
    let top = r.bottom + 10;
    if (top + ph > window.innerHeight - 12 && r.top - ph - 10 > 12) top = r.top - ph - 10;
    pop.style.left = Math.round(left + window.scrollX) + 'px';
    pop.style.top = Math.round(top + window.scrollY) + 'px';
  }

  function hide(now) {
    clearTimeout(hideTimer);
    const run = () => {
      pop.hidden = true;
      if (owner) owner.removeAttribute('aria-describedby');
      owner = null;
    };
    if (now) run();
    else hideTimer = setTimeout(run, 140);
  }

  markers.forEach(a => {
    a.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') show(a); });
    a.addEventListener('pointerleave', () => hide(false));
    a.addEventListener('focus', () => show(a));
    a.addEventListener('blur', () => hide(false));
    a.addEventListener('click', () => hide(true));
  });
  pop.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  pop.addEventListener('pointerleave', () => hide(false));
  doc.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) hide(true); });
}

/* ---------- tables: make overflowing wrappers keyboard scrollable ---------- */

function enhanceTables() {
  const wraps = doc.querySelectorAll('.table-wrap');
  if (!wraps.length) return;
  const check = wrap => {
    const scrolls = wrap.scrollWidth > wrap.clientWidth + 1;
    wrap.toggleAttribute('data-scrolls', scrolls);
    if (scrolls) {
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      if (!wrap.hasAttribute('aria-label') && !wrap.hasAttribute('aria-labelledby')) {
        const cap = wrap.querySelector('caption');
        wrap.setAttribute('aria-label', (cap ? cap.textContent.trim() + '. ' : '') + 'Table, scrolls sideways');
      }
    } else {
      wrap.removeAttribute('tabindex');
    }
  };
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(list => list.forEach(e => check(e.target)));
    wraps.forEach(w => ro.observe(w));
  } else {
    wraps.forEach(check);
  }
}

/* ---------- widgets: "Illustrative model" badge ---------- */

function badgeWidgets() {
  doc.querySelectorAll('figure.widget[data-illustrative]').forEach(fig => {
    if (fig.querySelector(':scope > .badge')) return;
    fig.prepend(el('span', { class: 'badge illustrative', text: SITE.illustrativeLabel }));
  });
}

/* ---------- in-page links when a <base> element is present (dev demo page) ---------- */

function fixBaseAnchors() {
  if (!doc.querySelector('base[href]')) return;
  doc.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
    const raw = a.getAttribute('href');
    e.preventDefault();
    if (raw.length > 1) {
      location.hash = raw;
      const target = doc.getElementById(decodeURIComponent(raw.slice(1)));
      if (target) {
        if (!target.matches('a, button, input, [tabindex]')) target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView();
      }
    } else {
      window.scrollTo(0, 0);
    }
  });
}

/* ---------- lazy charts and part viewers ---------- */

function lazyFigures() {
  const charts = Array.from(doc.querySelectorAll('figure.chart[data-chart]'));
  if (charts.length) {
    let mod = null;
    const load = () => (mod || (mod = import('./charts.js')));
    const render = fig => load().then(m => m.renderChart(fig)).catch(err => {
      console.warn('[detail] chart module failed to load', err);
    });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          obs.unobserve(entry.target);
          render(entry.target);
        });
      }, { rootMargin: '400px 0px' });
      charts.forEach(fig => io.observe(fig));
      // Printing needs every chart drawn, visible or not.
      window.addEventListener('beforeprint', () => charts.forEach(render));
    } else {
      charts.forEach(render);
    }
  }

  const viewers = Array.from(doc.querySelectorAll('figure.part-viewer'));
  if (viewers.length) {
    // The module itself is small (it shows the posters at once) and only
    // pulls in three.js when a viewer scrolls into view.
    import('./part-viewer.js')
      .then(m => m.initPartViewers(viewers, { reducedMotion: mqReduce }))
      .catch(err => console.warn('[detail] part viewer module failed to load', err));
  }
}

/* ---------- boot ---------- */

function safely(fn) {
  try { fn(); } catch (err) { console.warn('[detail] ' + fn.name + ' failed', err); }
}

[buildHeader, buildFooter, buildToc, enhanceFootnotes, enhanceTables, badgeWidgets, fixBaseAnchors, lazyFigures]
  .forEach(safely);
