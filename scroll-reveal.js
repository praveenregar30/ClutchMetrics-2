// Dashboards: each card settles in as it scrolls into view (once), and the chart animations inside it
// (bars, shot marks, radar) start then instead of off-screen at page load. Off under reduced motion.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduced && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('reveal-on');
  const seen = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-seen');
      seen.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.04 });
  const watch = () => document.querySelectorAll('.main .block:not(.is-seen)').forEach((el) => seen.observe(el));
  watch();
  // sections shown later (a game loads, the player report appears) are picked up too
  new MutationObserver(watch).observe(document.querySelector('.main') || document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  // safety: if anything stays unrevealed (printing, odd browsers), show it after a while
  setTimeout(() => document.querySelectorAll('.main .block:not(.is-seen)').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) el.classList.add('is-seen');
  }), 2500);
}
