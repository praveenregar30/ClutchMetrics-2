// Dashboards: as each card scrolls into view (once), its text and charts build up:
//   - heading, description, then items one after another (tiles, cards, rows, list items)
//   - numbers count up to their value
//   - bars grow, lines draw themselves, heat maps sweep in, network players pop in
// Chart animations that already exist (shot marks, radar) wait until the card is seen. Off under reduced motion.
// Anything drawn again later (filters, team switch) simply appears: nothing animates twice.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// items that come in one after another inside a card (first ones only, so long tables are not slow)
const STAGGER = [
  '.card__head h2', '.card__head .card__sub', '.game-head h1', '.game-head .eyebrow', '.game-head__sub', '.me-head__text h1',
  '.kpi', '.leader', '.obs li', '.ins li', '.feed__item', '.moment', '.table tbody tr', '.me-stats > div', '.vs__row',
  '.run', '.trend', '.ppi', '.radar', '.spot__pairs li', '.whoami__no', '.adv__group', '.legend',
].join(',');
const MAX_STAGGER = 14;
const COUNT_UP = '.kpi__value, .ppi__value, .me-stats dd, .control__nums b';   // plain-text numbers only
const DRAW = '.speed__line, .trend .spark, .net__line, .sp-line';

if (!reduced && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('reveal-on');

  const countUp = (el) => {
    const text = el.textContent;
    const parts = text.split(/(\d+(?:\.\d+)?)/);
    if (parts.length < 2) return;
    const targets = parts.map((p, i) => (i % 2 ? { v: Number(p), places: (p.split('.')[1] || '').length } : p));
    const start = performance.now(); const dur = 900;
    const frame = (now) => {
      const k = Math.min(1, (now - start) / dur); const ease = 1 - (1 - k) ** 3;
      el.textContent = targets.map((t) => (typeof t === 'string' ? t : (t.v * ease).toFixed(t.places))).join('');
      if (k < 1) requestAnimationFrame(frame); else el.textContent = text;
    };
    requestAnimationFrame(frame);
  };

  const draw = (path) => {
    let len;
    try { len = path.getTotalLength(); } catch { return; }
    if (!len) return;
    path.style.transition = 'none';
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    path.getBoundingClientRect();
    path.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.22, 1, .36, 1) .15s';
    path.style.strokeDashoffset = '0';
    path.addEventListener('transitionend', () => { path.style.strokeDasharray = ''; path.style.strokeDashoffset = ''; path.style.transition = ''; }, { once: true });
  };

  const reveal = (block) => {
    [...block.querySelectorAll(STAGGER)].slice(0, MAX_STAGGER).forEach((el, i) => el.style.setProperty('--i', i));
    block.querySelectorAll(COUNT_UP).forEach(countUp);
    block.querySelectorAll(DRAW).forEach(draw);
    block.classList.add('is-seen');
    // after the entrance, stop applying stagger delays (later hovers and redraws must be instant)
    setTimeout(() => block.classList.add('is-settled'), 1600);
  };

  const seen = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      seen.unobserve(e.target);
      reveal(e.target);
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.04 });
  const watch = () => document.querySelectorAll('.main .block:not(.is-seen)').forEach((el) => seen.observe(el));
  // start once the game data is on the page (or a message is shown), so the first section's entrance plays on real
  // content; never wait longer than 4 s
  const ready = () => document.querySelector('.kpi, .me-stats > div, [data-empty]:not([hidden]), [data-load-error]:not([hidden]), [data-whoami]:not([hidden])');
  const began = performance.now();
  const begin = () => {
    if (!ready() && performance.now() - began < 4000) { setTimeout(begin, 100); return; }
    watch();
    // sections shown later (a game loads, the player report appears) are picked up too
    new MutationObserver(watch).observe(document.querySelector('.main') || document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  };
  begin();
}
