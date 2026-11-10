// Scroll-driven effects. Every value follows the scrollbar, so nothing plays by itself and scrolling back reverses it.
// Under reduced motion nothing here runs and the page shows every section in its finished state.

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (u) => 1 - (1 - u) ** 3;

// the analysis timeline: the 38 plays the model found in Australia vs India (1:50 of play), in four slices of 27.5 s
const timeline = document.querySelector('[data-timeline]');
if (timeline) {
  const made = [29.5, 56.1, 76.3, 90.9, 109.3];
  const missed = [65.1, 68.8];
  const plays = [2.3, 7.2, 10.4, 20.9, 26.7, 27.8, 33.7, 37.3, 39.5, 41.5, 45.9, 49.5, 51.6, 58.1, 59.3, 61.3, 62, 63.4, 71.6, 74.5,
    78.9, 81.5, 84.3, 86, 88.8, 93.9, 97.3, 101.3, 102.8, 108, 108.7];
  const slice = 110 / 4;
  [...plays.map((t) => [t, 'tick tick--play']), ...missed.map((t) => [t, 'tick']), ...made.map((t) => [t, 'tick tick--made'])].forEach(([t, cls]) => {
    const q = Math.min(3, Math.floor(t / slice));
    const left = (t - q * slice) / slice;
    const tick = document.createElement('i');
    tick.className = cls;
    tick.style.left = `${(4 + left * 92).toFixed(1)}%`;
    tick.style.setProperty('--at', (t / 110).toFixed(3));
    timeline.querySelector(`[data-quarter="${q}"]`).append(tick);
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
