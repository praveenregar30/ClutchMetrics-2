// Scroll-driven effects. Every value follows the scrollbar, so nothing plays by itself and scrolling back reverses it.
// Under reduced motion nothing here runs and the page shows every section in its finished state.

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (u) => 1 - (1 - u) ** 3;

// the analysis timeline: 79 shots across 4 quarters, 37 of them made, the same every load
const timeline = document.querySelector('[data-timeline]');
if (timeline) {
  const quarters = [21, 18, 22, 18];
  let seed = 14;
  const next = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  let made = 0;
  let seen = 0;
  quarters.forEach((count, q) => {
    const row = timeline.querySelector(`[data-quarter="${q}"]`);
    for (let i = 0; i < count; i += 1) {
      const left = (i + 0.2 + next() * 0.6) / count;
      const remaining = 79 - seen;
      const isMade = next() < (37 - made) / remaining;
      if (isMade) made += 1;
      seen += 1;
      const tick = document.createElement('i');
      tick.className = `tick${isMade ? ' tick--made' : ''}`;
      tick.style.left = `${(left * 100).toFixed(1)}%`;
      tick.style.setProperty('--at', ((q + left) / 4).toFixed(3));
      row.append(tick);
    }
  });
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduced) {
  const wide = matchMedia('(min-width: 1024px)');
  const processLive = matchMedia('(min-width: 1024px) and (min-height: 640px)');

  const app = document.querySelector('.app.ui');
  const cards = [...document.querySelectorAll('#logins .card')];
  const word = document.querySelector('.close__word');

  const process = document.querySelector('[data-process]');
  const steps = process ? [...process.querySelectorAll('.step')] : [];
  const screens = process ? [...process.querySelectorAll('.screen')] : [];
  const rail = process && process.querySelector('.steps');
  const discs = steps.map((step) => step.querySelector('.step__disc'));
  let stops = [];

  const measure = () => {
    if (!rail) return;
    const top = rail.getBoundingClientRect().top;
    stops = discs.map((disc) => {
      const box = disc.getBoundingClientRect();
      return box.top - top + box.height / 2;
    });
    if (stops.length) {
      rail.style.setProperty('--rail-top', `${stops[0].toFixed(1)}px`);
      rail.style.setProperty('--rail-h', `${(stops[stops.length - 1] - stops[0]).toFixed(1)}px`);
    }
  };

  function renderProcess(vh) {
    if (!process) return;
    if (!processLive.matches) {
      process.classList.remove('is-live');
      screens.forEach((screen) => { screen.inert = false; screen.style.removeProperty('--p'); });
      return;
    }
    if (!process.classList.contains('is-live')) { process.classList.add('is-live'); measure(); }
    const box = process.getBoundingClientRect();
    const P = clamp(-box.top / Math.max(1, box.height - vh));
    const active = Math.min(screens.length - 1, Math.floor(P * screens.length));
    steps.forEach((step, i) => {
      step.classList.toggle('is-on', i === active);
      step.classList.toggle('is-done', i < active);
    });
    screens.forEach((screen, i) => {
      const on = i === active;
      screen.classList.toggle('is-on', on);
      screen.inert = !on;
      const p = clamp(((P * screens.length) - i) * 1.3);
      screen.style.setProperty('--p', p.toFixed(3));
      screen.querySelectorAll('[data-count]').forEach((el) => {
        const value = Math.round(Number(el.dataset.count) * p);
        const text = value + (el.dataset.unit || '');
        if (el.textContent !== text) el.textContent = text;
      });
    });
    if (stops.length) {
      const along = clamp(P * (stops.length - 1) * 1.15, 0, stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(along));
      const y = stops[i] + (stops[i + 1] - stops[i]) * (along - i);
      rail.style.setProperty('--ball-y', `${y.toFixed(1)}px`);
      rail.style.setProperty('--ball-turn', `${(P * 900).toFixed(0)}deg`);
      rail.style.setProperty('--rail-fill', (along / (stops.length - 1)).toFixed(3));
    }
  }

  function render() {
    const vh = innerHeight;

    if (app) {
      if (wide.matches) {
        const box = app.getBoundingClientRect();
        const p = easeOut(clamp((vh - box.top) / (vh * 0.75)));
        app.style.transform = `perspective(1500px) rotateX(${((1 - p) * 20).toFixed(2)}deg) scale(${(0.9 + 0.1 * p).toFixed(4)})`;
      } else {
        app.style.removeProperty('transform');
      }
    }

    cards.forEach((card, i) => {
      if (!wide.matches) { card.style.removeProperty('transform'); card.style.removeProperty('opacity'); return; }
      const box = card.closest('section').getBoundingClientRect();
      const p = easeOut(clamp((vh - box.top) / (vh * 0.8)));
      const side = i === 0 ? -1 : 1;
      card.style.transform = `translateX(${(side * (1 - p) * 72).toFixed(1)}px)`;
      card.style.opacity = (0.25 + 0.75 * p).toFixed(3);
    });

    renderProcess(vh);

    if (word) {
      const remaining = document.documentElement.scrollHeight - vh - scrollY;
      const p = easeOut(clamp(1 - remaining / (vh * 0.85)));
      word.style.transform = `scale(${(0.26 + 0.74 * p).toFixed(4)})`;
    }
  }

  let queued = false;
  const request = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  };
  const refresh = () => { measure(); request(); };

  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', refresh);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
  refresh();

  // a soft light that follows the pointer over the two login panels
  if (matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('#logins .panel').forEach((panel) => {
      const glow = document.createElement('span');
      glow.className = 'panel__glow';
      glow.setAttribute('aria-hidden', 'true');
      panel.append(glow);
      panel.addEventListener('pointermove', (event) => {
        const box = panel.getBoundingClientRect();
        glow.style.setProperty('--mx', `${(event.clientX - box.left).toFixed(0)}px`);
        glow.style.setProperty('--my', `${(event.clientY - box.top).toFixed(0)}px`);
      }, { passive: true });
    });
  }
}
