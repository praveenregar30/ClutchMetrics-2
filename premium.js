// Premium touches for the dashboards: cursor light on cards, ambient video glow, glass top bar with reading
// progress, quick search (Ctrl+K), loading screen. Purely presentational: it reads what the dashboard already shows.

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('.main');

if (main) {
  // ---------------------------------------------------------------- loading screen (hidden once scroll-reveal.js marks the data ready)
  main.insertAdjacentHTML('beforebegin', `<div class="loading-game" aria-hidden="true">
    <svg viewBox="-18 -18 36 36"><circle r="17" fill="#ff7a1a"/><path d="M-17 0H17M0-17V17M-12-12Q-4 0-12 12M12-12Q4 0 12 12" fill="none" stroke="#160b03" stroke-width="1.8"/></svg><i></i><span>Loading your game…</span></div>`);

  // ---------------------------------------------------------------- cursor light
  let lit = null;
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.('.kpi, .leader, .trend') || e.target.closest?.('.card');
    const card = e.target.closest?.('.card');
    [el, card].forEach((t) => {
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', `${e.clientX - r.left}px`);
      t.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
    if (lit && lit !== card && lit !== el) { lit.style.setProperty('--mx', '-999px'); lit.style.setProperty('--my', '-999px'); }
    lit = card || el;
  }, { passive: true });

  // ---------------------------------------------------------------- ambient video glow
  const video = $('[data-video]');
  const wrap = video?.closest('.video-wrap');
  if (wrap) {
    const box = document.createElement('div');
    box.className = 'ambient';
    wrap.before(box);
    const glow = document.createElement('canvas');
    glow.className = 'ambient__glow'; glow.width = 32; glow.height = 18; glow.setAttribute('aria-hidden', 'true');
    box.append(glow, wrap);
    const ctx = glow.getContext('2d');
    let timer = 0;
    const paint = () => {
      if (video.readyState < 2) return;
      try { ctx.drawImage(video, 0, 0, 32, 18); box.classList.add('is-lit'); } catch { /* frame not readable: no glow */ }
    };
    const run = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) paint(); }, 120); };
    video.addEventListener('play', run);
    ['pause', 'ended'].forEach((t) => video.addEventListener(t, () => { clearInterval(timer); paint(); }));
    ['loadeddata', 'seeked'].forEach((t) => video.addEventListener(t, paint));
  }

  // ---------------------------------------------------------------- glass top bar
  const bar = document.createElement('div');
  bar.className = 'topbar';
  bar.innerHTML = `<span class="topbar__title" data-tb-title></span><span class="topbar__score" data-tb-score hidden></span>
    <span class="topbar__section" data-tb-section></span>
    <button class="topbar__find" type="button" data-find-open aria-label="Search sections and players"><span>Search</span><kbd>Ctrl K</kbd></button>
    <i class="topbar__bar" aria-hidden="true"></i>`;
  document.body.append(bar);
  const head = $('#overview .game-head') || $('.me-head') || $('.match-bar');
  let headGone = false;
  if (head) new IntersectionObserver(([e]) => { headGone = !e.isIntersecting && e.boundingClientRect.top < 0; sync(); }, { threshold: 0 }).observe(head);
  function sync() {
    const title = ($('[data-title]') || $('[data-me-title]'))?.textContent || '';
    const ready = title && !/^Loading/.test(title);
    bar.classList.toggle('is-on', headGone && ready);
    $('[data-tb-title]', bar).textContent = title;
    const score = $('.scorebox__main');
    const s = $('[data-tb-score]', bar);
    s.hidden = !score;
    if (score) s.textContent = score.textContent.replace(/\s+/g, ' ').trim();
    $('[data-tb-section]', bar).textContent = $('.side__nav a.is-here')?.textContent.trim() || '';
  }
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.setProperty('--read', max > 0 ? (scrollY / max).toFixed(4) : 0);
      sync();
    });
  }, { passive: true });

  // ---------------------------------------------------------------- quick search (Ctrl+K)
  const dialog = document.createElement('dialog');
  dialog.className = 'palette';
  dialog.setAttribute('aria-label', 'Search sections and players');
  dialog.innerHTML = `<input class="palette__input" type="search" placeholder="Jump to a section or a player number…" autocomplete="off" aria-label="Search" data-find-input>
    <ul class="palette__list" role="listbox" data-find-list></ul>
    <div class="palette__foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>`;
  document.body.append(dialog);
  const input = $('[data-find-input]', dialog); const list = $('[data-find-list]', dialog);
  let items = []; let active = 0;

  function collect() {
    const out = [];
    document.querySelectorAll('.side__nav a:not([hidden])').forEach((a) => out.push({ group: 'Sections', name: a.textContent.trim(), hint: 'Go to', run: () => a.click() }));
    // team codes: plays-feed names read "AUS #5"; table buttons carry the code in their small line
    const teams = {};
    document.querySelectorAll('.main .name-btn[data-spot], .main .who-btn[data-spot]').forEach((b) => {
      const code = (b.classList.contains('name-btn') ? b.textContent : b.querySelector('span')?.textContent || '').trim().split(/[\s·]/)[0];
      if (/^[A-Z0-9]{2,4}$/.test(code)) teams[b.dataset.spot] = code;
    });
    const seen = new Set();
    document.querySelectorAll('.main [data-spot]').forEach((b) => {
      const key = b.dataset.spot;
      if (!key || seen.has(key)) return;
      seen.add(key);
      const no = key.split('-')[1];
      const team = teams[key] || '';
      out.push({ group: 'Players', name: `${team ? `${team} ` : ''}No. ${no}`, hint: 'Open spotlight', words: `#${no} number ${no} player ${team}`, run: () => b.click() });
    });
    return out;
  }
  function draw() {
    const q = input.value.trim().toLowerCase().replace(/^#/, '');
    const shown = items.filter((it) => !q || `${it.name} ${it.words || ''}`.toLowerCase().includes(q));
    active = Math.min(active, Math.max(shown.length - 1, 0));
    let group = '';
    list.innerHTML = shown.length ? shown.map((it, i) => `${it.group !== group ? `<li class="palette__group" role="presentation">${group = it.group}</li>` : ''}
      <li class="palette__item${i === active ? ' is-active' : ''}" role="option" aria-selected="${i === active}" data-i="${i}"><b>${esc(it.name)}</b><span>${esc(it.hint)}</span></li>`).join('')
      : '<li class="palette__none">Nothing matches. Try a section name or a jersey number.</li>';
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    return shown;
  }
  function open() {
    if (dialog.open) return;
    items = collect(); active = 0; input.value = '';
    dialog.showModal(); draw(); input.focus();
  }
  function choose(i) {
    const it = draw()[i];
    if (!it) return;
    dialog.close();
    it.run();
  }
  input.addEventListener('input', () => { active = 0; draw(); });
  dialog.addEventListener('keydown', (e) => {
    const n = draw().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(n, 1); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + Math.max(n, 1)) % Math.max(n, 1); draw(); }
    if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  });
  list.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) choose(Number(li.dataset.i)); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-find-open]')) open(); });

  // ---------------------------------------------------------------- sidebar: sliding highlight, game card, account
  const nav = $('.side__nav');
  const pill = $('.side__pill', nav || undefined);
  const desktop = matchMedia('(min-width: 1024px)');
  let lastHere = null;
  function placePill() {
    const here = nav && $('a.is-here:not([hidden])', nav);
    if (!nav || !pill) return;
    if (nav.classList.contains('has-pill') !== desktop.matches) nav.classList.toggle('has-pill', desktop.matches);
    if (!here) { if (pill.classList.contains('is-on')) pill.classList.remove('is-on'); return; }
    // the link's position inside the scrolling nav
    const top = here.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
    const first = !pill.classList.contains('is-on');
    if (first) pill.style.transition = 'none';
    pill.style.setProperty('--y', `${top}px`);
    pill.style.setProperty('--h', `${here.offsetHeight}px`);
    pill.classList.add('is-on');
    if (first) { pill.getBoundingClientRect(); pill.style.transition = ''; }
    if (here !== lastHere) {
      lastHere = here;
      // keep the current section visible: in the desktop list, and in the phone row of chips
      const nr = nav.getBoundingClientRect(); const hr = here.getBoundingClientRect();
      if (desktop.matches ? (hr.top < nr.top || hr.bottom > nr.bottom) : (hr.left < nr.left || hr.right > nr.right)) {
        nav.scrollTo({ top: desktop.matches ? nav.scrollTop + hr.top - nr.top - nr.height / 2 : 0, left: desktop.matches ? 0 : nav.scrollLeft + hr.left - nr.left - 16, behavior: 'smooth' });
      }
    }
  }
  if (nav) {
    // only changes on the links themselves (the highlight's own class changes must not call it again)
    new MutationObserver((records) => { if (records.some((r) => r.target.tagName === 'A')) placePill(); }).observe(nav, { attributes: true, attributeFilter: ['class', 'hidden'], subtree: true });
    desktop.addEventListener('change', placePill);
    placePill();
    addEventListener('resize', placePill, { passive: true });
  }

  // the game on screen, as a card under the logo
  const card = $('[data-side-match]');
  function fillCard() {
    if (!card) return;
    const title = ($('[data-title]') || $('[data-me-title]'))?.textContent.trim() || '';
    const ok = title && !/^Loading/.test(title) && !$('[data-empty]:not([hidden])');
    card.hidden = !ok;
    if (!ok) return;
    $('[data-side-title]', card).textContent = title;
    card.title = title;
    const score = $('.scorebox__main');
    const s = $('[data-side-score]', card);
    s.hidden = !score;
    if (score) s.textContent = score.textContent.replace(/\s+/g, ' ').trim();
  }
  new MutationObserver(fillCard).observe(main, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  fillCard();

  // account: initials from the e-mail address, full address on hover
  const email = $('.side__user [data-email]');
  const avatar = $('[data-avatar]');
  function fillUser() {
    const text = email?.textContent.trim() || '';
    if (!text || !avatar) return;
    email.title = text;
    const words = text.split('@')[0].split(/[._\-+\d]+/).filter(Boolean);
    avatar.textContent = ((words[0]?.[0] || text[0]) + (words[1]?.[0] || '')).toUpperCase();
  }
  if (email) new MutationObserver(fillUser).observe(email, { childList: true, characterData: true, subtree: true });
  fillUser();
}
