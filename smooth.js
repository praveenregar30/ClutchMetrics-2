// Inertia scrolling for the dashboards (Lenis, MIT, vendored in vendor/lenis.js): the mouse wheel glides to a stop.
// Only with a mouse (fine pointer) and when motion is allowed. Popups, lists and tables keep their own scrolling.

const allowed = matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches;

if (allowed && document.querySelector('.main')) {
  const { default: Lenis } = await import('./vendor/lenis.js');
  const TOPBAR = 68;       // room for the glass top bar when jumping to a section
  const lenis = new Lenis({
    lerp: 0.12,            // light inertia: follows the wheel closely, then eases out
    wheelMultiplier: 1,
    smoothWheel: true,
    // leave these to the browser: dialogs (spotlight, search, court mapping), side-scrolling tables and lists
    prevent: (node) => Boolean(node.closest?.('dialog, .scroll, .reel__list, .moments, .palette__list, select, textarea')),
  });
  document.documentElement.classList.add('lenis-on');
  const frame = (time) => { lenis.raf(time); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);

  // section links glide with the same motion
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    const target = a && a.getAttribute('href').length > 1 && document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    lenis.scrollTo(target, { offset: -TOPBAR });
    history.replaceState(null, '', a.getAttribute('href'));
  });

  // "watch this moment" and similar jumps in the dashboards use scrollIntoView: route page-level ones through Lenis
  const native = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function scrollIntoView(options) {
    const pageJump = options && typeof options === 'object' && options.behavior === 'smooth' && (options.block || 'start') === 'start'
      && !this.closest('dialog, .scroll, .reel__list, .palette__list');
    if (pageJump) lenis.scrollTo(this, { offset: -TOPBAR });
    else native.call(this, options);
  };

  // a modal on top: pause page scrolling under it
  const sync = () => (document.querySelector('dialog[open]') ? lenis.stop() : lenis.start());
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
  // ...and keep the wheel from moving the page when the pointer is on the dimmed area beside the popup
  addEventListener('wheel', (e) => {
    const open = document.querySelector('dialog[open]');
    if (!open) return;
    // a wheel on the backdrop is reported on the dialog itself: check the pointer is really inside its box
    const r = open.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) e.preventDefault();
  }, { passive: false, capture: true });
}
