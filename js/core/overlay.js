// DOM overlay over the canvas (PLAN 4.5): counter, station text, chips, menu, sound pill,
// progress track, drag hint, projected labels, closing panel, loading screen, aria-live.
import { HEADLINES, SCROLL } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function createOverlay(content, api) {
  // api: { goTo(index), toggleSound() -> bool }
  const stations = content.stations;
  const site = content.site;
  const N = stations.length;
  const body = document.body;
  const refs = {
    counterN: $('[data-counter-n]'), counterT: $('[data-counter-total]'), counter: $('[data-counter]'),
    station: $('[data-station]'), inner: $('[data-station-inner]'), title: $('[data-title]'), caption: $('[data-caption]'), meta: $('[data-meta]'),
    headline: $('[data-headline]'), labels: $('[data-labels]'), hint: $('[data-hint]'), hintText: $('[data-hint-text]'),
    closing: $('[data-closing]'), credit: $('[data-credit]'), tools: $('[data-tools]'), closingLinks: $('[data-closing-links]'),
    track: $('[data-track]'), ticks: $('[data-track-ticks]'), fill: $('[data-track-fill]'), marker: $('[data-track-marker]'),
    announce: $('[data-announce]'), loader: $('[data-loader]'), loaderBar: $('[data-loader-bar]'), loaderFill: $('[data-loader-fill]'),
    menuBtn: $('[data-menu-btn]'), menuPanel: $('[data-menu-panel]'), menuList: $('[data-menu-list]'), menuLabel: $('[data-menu-label]'), menuTitle: $('[data-menu-title]'),
    soundBtn: $('[data-sound-btn]'), soundLabel: $('[data-sound-label]'), skip: $('[data-skip]'), introCue: $('[data-intro-cue]'), logo: $('[data-logo]')
  };

  refs.counterT.textContent = pad(N);
  refs.logo.textContent = site.logo;
  refs.introCue.textContent = site.intro;
  refs.credit.textContent = site.credit;
  refs.tools.textContent = site.tools;
  refs.menuLabel.textContent = site.menuLabel;
  refs.menuTitle.textContent = site.menuLabel;

  // ---- menu ----
  for (const m of site.menu) {
    const li = el('li'); const a = el('a', null, m.title); a.href = m.href; li.appendChild(a); refs.menuList.appendChild(li);
    const li2 = el('li'); const a2 = el('a', null, m.title); a2.href = m.href; li2.appendChild(a2); refs.closingLinks.appendChild(li2);
  }
  let menuOpen = false;
  function setMenu(open, focusFirst) {
    menuOpen = open;
    refs.menuPanel.hidden = !open;
    refs.menuBtn.setAttribute('aria-expanded', String(open));
    body.classList.toggle('menu-open', open);
    if (open && focusFirst) { const a = refs.menuList.querySelector('a'); a && a.focus(); }
    if (!open && focusFirst === false) refs.menuBtn.focus();
  }
  refs.menuBtn.addEventListener('click', () => setMenu(!menuOpen, true));
  refs.skip.addEventListener('click', (e) => { e.preventDefault(); setMenu(true, true); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) { e.preventDefault(); setMenu(false, false); } });
  document.addEventListener('pointerdown', (e) => { if (menuOpen && !refs.menuPanel.contains(e.target) && !refs.menuBtn.contains(e.target)) setMenu(false); });

  // ---- sound ----
  refs.soundBtn.addEventListener('click', () => {
    const on = api.toggleSound();
    refs.soundBtn.setAttribute('aria-pressed', String(on));
    refs.soundLabel.textContent = on ? 'Sound on' : 'Sound off';
    body.classList.toggle('sound-on', on);
  });

  // ---- track ----
  const tickEls = [];
  stations.forEach((s, i) => {
    const li = el('li', 'tick');
    if (i > 0 && stations[i - 1].act !== s.act) li.classList.add('act-start');
    const b = el('button', 'tick-btn');
    b.type = 'button';
    b.setAttribute('aria-label', `${pad(s.n)} ${s.title}`);
    b.dataset.index = i;
    const tip = el('span', 'tick-tip', `${pad(s.n)} · ${s.title}`);
    b.appendChild(el('i', 'tick-mark'));
    b.appendChild(tip);
    b.addEventListener('click', () => api.goTo(i));
    li.appendChild(b);
    refs.ticks.appendChild(li);
    tickEls.push(li);
  });

  // ---- station text ----
  let shown = -1;
  let swapTimer = 0;
  function fillStation(i) {
    const s = stations[i];
    refs.title.textContent = s.title;
    refs.caption.innerHTML = '';
    s.caption.forEach((line, k) => { if (k) refs.caption.appendChild(document.createElement('br')); refs.caption.appendChild(document.createTextNode(line)); });
    const meta = refs.meta; meta.innerHTML = '';
    if (s.deeper) {
      const a = el('a', 'deeper'); a.href = s.deeper.href;
      a.appendChild(el('span', null, s.deeper.label)); a.appendChild(el('span', 'arrow', '→'));
      meta.appendChild(a);
    }
    const srcText = s.number ? s.number.source : s.source;
    if (srcText) {
      const chip = el('button', 'chip source-chip'); chip.type = 'button';
      chip.setAttribute('aria-expanded', 'false');
      const tipId = `src-${s.id}`;
      chip.setAttribute('aria-describedby', tipId);
      if (s.number) chip.appendChild(el('span', 'num', s.number.value));
      else chip.appendChild(el('span', 'i', 'i'));
      chip.appendChild(el('span', 'chip-k', 'Source'));
      const tip = el('span', 'source-tip'); tip.id = tipId; tip.setAttribute('role', 'tooltip');
      tip.textContent = s.number && s.source && s.number.source !== s.source ? `${s.number.source}. ${s.source}.` : srcText;
      const wrap = el('span', 'chip-wrap'); wrap.appendChild(chip); wrap.appendChild(tip);
      chip.addEventListener('click', () => { const o = !wrap.classList.contains('open'); wrap.classList.toggle('open', o); chip.setAttribute('aria-expanded', String(o)); });
      chip.addEventListener('blur', () => { wrap.classList.remove('open'); chip.setAttribute('aria-expanded', 'false'); });
      meta.appendChild(wrap);
    }
    if (s.illustrative) meta.appendChild(el('span', 'chip ill-chip', site.illustrativeLabel));
    if (s.tierNote) meta.appendChild(el('span', 'tier-note', s.tierNote));
    refs.counterN.textContent = pad(s.n);
    refs.hintText.textContent = s.hint || '';
    body.dataset.station = s.id;
    body.classList.toggle('has-hint', !!s.hint);
    body.classList.toggle('hint-vertical', !!s.hint && /up or down/.test(s.hint));
    body.style.setProperty('--hint-op', hintUsed[s.id] ? '0.55' : '1');
    body.classList.toggle('is-closing', !!s.closing);
    refs.closing.hidden = !s.closing;
    body.classList.toggle('is-intro', i === 0);
  }
  const hintUsed = {};

  function setStation(i, instant) {
    if (i === shown) return;
    const first = shown < 0;
    shown = i;
    tickEls.forEach((t, k) => { t.classList.toggle('current', k === i); t.querySelector('button').toggleAttribute('aria-current', k === i); if (k === i) t.querySelector('button').setAttribute('aria-current', 'step'); });
    clearTimeout(swapTimer);
    if (first || instant) { fillStation(i); refs.inner.classList.remove('swap-out'); }
    else {
      refs.inner.classList.add('swap-out');
      swapTimer = setTimeout(() => { fillStation(i); refs.inner.classList.remove('swap-out'); }, 260);
    }
    refs.announce.textContent = `Station ${stations[i].n} of ${N}: ${stations[i].title}`;
    buildHeadline(i);
  }

  // ---- big split headline (DOM part: blocks with depth 0) ----
  let headlineFor = null;
  let portrait = false;
  function buildHeadline(i) {
    const id = stations[i].id;
    const h = HEADLINES[id];
    const key = h ? id + (portrait ? 'p' : 'l') : null;
    if (key === headlineFor) return;
    headlineFor = key;
    refs.headline.innerHTML = '';
    if (!h) return;
    for (const b of (portrait ? h.portrait : h.landscape)) {
      if (b.depth) continue;
      const w = el('span', 'hl-word', b.text);
      w.style.left = (b.x * 100) + '%';
      w.style.top = (b.y * 100) + '%';
      refs.headline.appendChild(w);
    }
  }

  // ---- labels projected from the scene ----
  const labelPool = [];
  function setLabels(list) {
    // list: [{ text, x, y, tone, opacity }] in CSS px
    for (let k = 0; k < Math.max(list.length, labelPool.length); k++) {
      let e = labelPool[k];
      if (!e) { e = el('span', 'scene-label'); refs.labels.appendChild(e); labelPool.push(e); }
      const L = list[k];
      if (!L) { e.style.opacity = '0'; continue; }
      if (e.textContent !== L.text) e.textContent = L.text;
      e.dataset.tone = L.tone || 'ink';
      e.style.transform = `translate(${L.x.toFixed(1)}px, ${L.y.toFixed(1)}px) translate(-50%, -100%)`;
      e.style.opacity = L.opacity.toFixed(3);
    }
  }

  // ---- per-frame ----
  function frame(p, f, nearestIndex) {
    const a = Math.abs(f);
    const t = Math.min(1, Math.max(0, (a - SCROLL.textFadeStart) / (SCROLL.textFadeEnd - SCROLL.textFadeStart)));
    const op = 1 - t * t * (3 - 2 * t);
    refs.station.style.opacity = op.toFixed(3);
    refs.station.style.transform = `translateY(${(f * -18).toFixed(1)}px)`;
    // headline fades with distance from s01 / s16
    const hl = 1 - Math.min(1, a / 0.45);
    refs.headline.style.opacity = hl.toFixed(3);
    refs.headline.style.transform = `translateY(${(f * -60).toFixed(1)}px)`;
    refs.closing.style.opacity = stations[nearestIndex].closing ? op.toFixed(3) : '0';
    refs.introCue.style.opacity = nearestIndex === 0 ? op.toFixed(3) : '0';
    // track
    const frac = p / (N - 1);
    refs.fill.style.transform = `scaleX(${frac.toFixed(4)})`;
    refs.marker.style.left = `${(frac * 100).toFixed(3)}%`;
  }

  function setPortrait(v) { if (portrait === v) return; portrait = v; body.classList.toggle('portrait', v); headlineFor = null; if (shown >= 0) buildHeadline(shown); }
  function hintDragged(id) { hintUsed[id] = true; body.style.setProperty('--hint-op', '0.55'); }

  // ---- loader ----
  function setLoad(f) {
    const v = Math.round(Math.min(1, Math.max(0, f)) * 100);
    refs.loaderFill.style.transform = `scaleX(${v / 100})`;
    refs.loaderBar.setAttribute('aria-valuenow', String(v));
  }
  function hideLoader() {
    body.classList.remove('is-loading');
    refs.loader.classList.add('done');
    setTimeout(() => refs.loader.remove(), 1200);
  }

  return { setStation, frame, setLabels, setPortrait, hintDragged, setLoad, hideLoader, isMenuOpen: () => menuOpen, setMenu };
}
