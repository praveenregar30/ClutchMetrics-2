// ClutchMetrics coach dashboard. Reads data/games.json (format in data/README.md) and draws every view from it.
// The chosen game and the shot filters live in the address, so a view can be shared or reloaded.

const $ = (sel, root = document) => root.querySelector(sel);
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}, parent) => {
  const el = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (parent) parent.append(el);
  return el;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const pct = new Intl.NumberFormat(undefined, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const one = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const toDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
const ratio = (a, b) => (b ? a / b : 0);
const playerLabel = (p) => `No. ${p.no}`;

const state = { data: null, game: null, player: 'all', q: 'all', result: 'all', sort: { key: 'pts', dir: 'descending' } };

// ---------------------------------------------------------------- the address
function readUrl() {
  const p = new URLSearchParams(location.search);
  return { game: p.get('game'), player: p.get('player') || 'all', q: p.get('q') || 'all', result: p.get('result') || 'all' };
}
function writeUrl() {
  const p = new URLSearchParams();
  p.set('game', state.game.number);
  if (state.player !== 'all') p.set('player', state.player);
  if (state.q !== 'all') p.set('q', state.q);
  if (state.result !== 'all') p.set('result', state.result);
  history.replaceState(null, '', `${location.pathname}?${p}${location.hash}`);
}

// ---------------------------------------------------------------- numbers for a game
function totals(game) {
  const sum = (key) => game.players.reduce((a, p) => a + p[key], 0);
  return {
    pts: game.score.team, fgm: sum('fgm'), fga: sum('fga'), tpm: sum('tpm'), tpa: sum('tpa'),
    reb: sum('reb'), ast: sum('ast'), tov: sum('tov'),
  };
}

// ---------------------------------------------------------------- overview
function renderOverview() {
  const g = state.game;
  const games = state.data.games;
  $('[data-game-title]').textContent = `Game ${g.number} vs ${g.opponent}`;
  $('[data-game-meta]').textContent = `${g.home ? 'Home' : 'Away'} · ${dateFmt.format(toDate(g.date))}`;
  const win = g.score.team > g.score.opp;
  const result = $('[data-result]');
  result.className = `result ${win ? 'result--win' : 'result--loss'}`;
  result.innerHTML = `<span class="result__tag">${win ? 'Won' : 'Lost'}</span>${g.score.team}–${g.score.opp}`;
  result.setAttribute('aria-label', `${win ? 'Won' : 'Lost'} ${g.score.team} to ${g.score.opp}`);

  const t = totals(g);
  const others = games.filter((x) => x !== g).map(totals);
  const avg = (fn) => (others.length ? others.reduce((a, x) => a + fn(x), 0) / others.length : fn(t));
  const tiles = [
    { label: 'Points', value: whole.format(t.pts), now: t.pts, base: avg((x) => x.pts), fmt: (d) => one.format(d) },
    { label: 'Field goals', value: pct.format(ratio(t.fgm, t.fga)), now: ratio(t.fgm, t.fga), base: avg((x) => ratio(x.fgm, x.fga)), fmt: (d) => `${one.format(d * 100)} pts` },
    { label: 'Three-pointers', value: pct.format(ratio(t.tpm, t.tpa)), now: ratio(t.tpm, t.tpa), base: avg((x) => ratio(x.tpm, x.tpa)), fmt: (d) => `${one.format(d * 100)} pts` },
    { label: 'Rebounds', value: whole.format(t.reb), now: t.reb, base: avg((x) => x.reb), fmt: (d) => one.format(d) },
    { label: 'Assists', value: whole.format(t.ast), now: t.ast, base: avg((x) => x.ast), fmt: (d) => one.format(d) },
    { label: 'Turnovers', value: whole.format(t.tov), now: t.tov, base: avg((x) => x.tov), fmt: (d) => one.format(d), lowerIsBetter: true },
  ];
  const up = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2 11 10H1z"/></svg>';
  const down = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10 1 2h10z"/></svg>';
  $('[data-kpis]').innerHTML = tiles.map((k) => {
    const d = k.now - k.base;
    const better = k.lowerIsBetter ? d < 0 : d > 0;
    const same = Math.abs(d) < 0.0005;
    const word = same ? 'same as average' : `${d > 0 ? 'above' : 'below'} average`;
    return `<article class="kpi">
      <span class="kpi__label">${k.label}</span>
      <span class="kpi__value">${k.value}</span>
      <span class="kpi__delta ${same ? '' : better ? 'is-good' : 'is-bad'}">${same ? '' : d > 0 ? up : down}<span>${same ? '' : `<b>${k.fmt(Math.abs(d))}</b> `}${word}</span></span>
    </article>`;
  }).join('');
}

// ---------------------------------------------------------------- shot chart
const ZONES = ['Paint', 'Mid-range', 'Corner 3', 'Above-break 3'];
const toCourt = (s) => ({ x: (s.x + 25) * 10, y: s.y * 10 });

function filteredShots() {
  return state.game.shots.filter((s) => (state.player === 'all' || String(s.player) === state.player)
    && (state.q === 'all' || String(s.q) === state.q)
    && (state.result === 'all' || (state.result === 'made') === s.made));
}

function renderShots(animate) {
  const layer = $('[data-shot-layer]');
  layer.replaceChildren();
  layer.classList.toggle('shot-layer', true);
  layer.classList.toggle('is-new', Boolean(animate) && !reduced);
  const shots = filteredShots();
  shots.forEach((s, i) => {
    const { x, y } = toCourt(s);
    const g = svgEl('g', { class: `shot ${s.made ? 'shot--made' : 'shot--miss'}`, style: `--i: ${i}` }, layer);
    g.dataset.index = String(state.game.shots.indexOf(s));
    svgEl('circle', { class: 'shot__hit', cx: x, cy: y, r: 13 }, g);
    if (s.made) svgEl('circle', { class: 'shot__mark', cx: x, cy: y, r: 7.5 }, g);
    else svgEl('path', { class: 'shot__mark', d: `M${x - 6} ${y - 6}l12 12m0-12l-12 12` }, g);
  });
  if (!shots.length) {
    const t = svgEl('text', { class: 'empty-shots', x: 250, y: 300, 'text-anchor': 'middle' }, layer);
    t.textContent = 'No shots match these filters';
  }

  const made = shots.filter((s) => s.made).length;
  const who = state.player === 'all' ? 'All players' : `No. ${state.player}`;
  const when = state.q === 'all' ? 'all quarters' : `quarter ${state.q}`;
  const summary = shots.length ? `${who}, ${when}: ${made} of ${shots.length} made (${pct.format(ratio(made, shots.length))})` : `${who}, ${when}: no shots`;
  $('[data-shot-summary]').textContent = summary;
  $('[data-court-desc]').textContent = `Half court. ${summary}. The table beside it lists the same shots by zone.`;

  // the table by zone: the same shots, readable without the picture
  const rows = ZONES.map((z) => {
    const zs = shots.filter((s) => s.zone === z);
    const m = zs.filter((s) => s.made).length;
    return { z, m, a: zs.length };
  });
  const best = Math.max(...rows.map((r) => ratio(r.m, r.a)), 0.01);
  $('[data-zones]').innerHTML = rows.map((r) => `<tr>
      <th scope="row">${r.z}<span class="zone-bar" aria-hidden="true"><i style="width:${(ratio(r.m, r.a) / best) * 100}%"></i></span></th>
      <td class="num">${r.m}/${r.a}</td>
      <td class="num">${r.a ? pct.format(ratio(r.m, r.a)) : '–'}</td>
    </tr>`).join('') + `<tr class="zones__total"><th scope="row">All zones</th><td class="num">${made}/${shots.length}</td><td class="num">${shots.length ? pct.format(ratio(made, shots.length)) : '–'}</td></tr>`;

  document.querySelectorAll('[data-players] tr').forEach((tr) => tr.classList.toggle('is-picked', tr.dataset.no === state.player));
  document.querySelectorAll('[data-shots-for]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shotsFor === state.player)));
}

function shotTooltip() {
  const court = $('[data-court]');
  const tip = $('[data-tip]');
  const svg = $('[data-court-svg]');
  const show = (target) => {
    const g = target.closest('.shot');
    if (!g) { tip.hidden = true; return; }
    const s = state.game.shots[Number(g.dataset.index)];
    const feet = Math.round(Math.hypot(s.x, s.y - 5.25));
    tip.innerHTML = `<b>No. ${s.player} · ${s.made ? 'Made' : 'Missed'}</b><span>${s.zone}, ${feet} ft · Q${s.q} · ${s.three ? '3' : '2'} points</span>`;
    const box = court.getBoundingClientRect();
    const scale = svg.getBoundingClientRect().width / 500;
    const { x, y } = toCourt(s);
    const left = Math.min(Math.max(x * scale, 90), box.width - 90);
    tip.style.left = `${left}px`;
    tip.style.top = `${y * scale}px`;
    tip.hidden = false;
  };
  svg.addEventListener('pointermove', (e) => show(e.target));
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
}

function buildFilters() {
  const select = $('[data-player-select]');
  select.innerHTML = `<option value="all">All players</option>${state.game.players.map((p) => `<option value="${p.no}">${playerLabel(p)} · ${esc(p.pos)}</option>`).join('')}`;
  if (state.player !== 'all' && !state.game.players.some((p) => String(p.no) === state.player)) state.player = 'all';
  select.value = state.player;

  const quarters = [...new Set(state.game.shots.map((s) => s.q))].sort((a, b) => a - b);
  const seg = (name, options) => {
    const box = $(`[data-seg="${name}"]`);
    box.innerHTML = options.map(([v, label, aria]) => `<button type="button" data-value="${v}" aria-pressed="${String(state[name] === v)}"${aria ? ` aria-label="${aria}"` : ''}>${label}</button>`).join('');
  };
  seg('q', [['all', 'All', 'All quarters'], ...quarters.map((q) => [String(q), q > 4 ? `OT${q - 4}` : `Q${q}`, q > 4 ? `Overtime ${q - 4}` : `Quarter ${q}`])]);
  seg('result', [['all', 'All', 'All shots'], ['made', 'Made', 'Made shots'], ['missed', 'Missed', 'Missed shots']]);
}

function wireFilters() {
  $('[data-player-select]').addEventListener('change', (e) => { state.player = e.target.value; writeUrl(); renderShots(true); });
  document.querySelectorAll('[data-seg]').forEach((box) => {
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state[box.dataset.seg] = b.dataset.value;
      box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      writeUrl();
      renderShots(true);
    });
  });
}

// ---------------------------------------------------------------- players
const COLS = [
  { key: 'no', label: 'Player', sort: (p) => p.no, left: true },
  { key: 'min', label: 'MIN', title: 'Minutes', sort: (p) => p.min },
  { key: 'pts', label: 'PTS', title: 'Points', sort: (p) => p.pts },
  { key: 'reb', label: 'REB', title: 'Rebounds', sort: (p) => p.reb },
  { key: 'ast', label: 'AST', title: 'Assists', sort: (p) => p.ast },
  { key: 'tov', label: 'TOV', title: 'Turnovers', sort: (p) => p.tov },
  { key: 'fg', label: 'FG', title: 'Field goals made of attempted', sort: (p) => ratio(p.fgm, p.fga) },
  { key: 'tp', label: '3P', title: 'Three-pointers made of attempted', sort: (p) => ratio(p.tpm, p.tpa) },
  { key: 'ft', label: 'FT', title: 'Free throws made of attempted', sort: (p) => ratio(p.ftm, p.fta) },
  { key: 'pm', label: '+/−', title: 'Plus-minus', sort: (p) => p.pm },
];

function renderPlayers() {
  const arrow = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8 1 2h8z"/></svg>';
  $('[data-players-head]').innerHTML = `<tr>${COLS.map((c) => `<th scope="col" class="${c.left ? '' : 'num'}"${state.sort.key === c.key ? ` aria-sort="${state.sort.dir}"` : ''}><button class="sort" type="button" data-sort="${c.key}"${c.title ? ` aria-label="Sort by ${c.title.toLowerCase()}"` : ' aria-label="Sort by jersey number"'}>${c.label}${arrow}</button></th>`).join('')}<th scope="col"><span class="visually-hidden">Shot chart</span></th></tr>`;
  const col = COLS.find((c) => c.key === state.sort.key);
  const dir = state.sort.dir === 'ascending' ? 1 : -1;
  const rows = [...state.game.players].sort((a, b) => (col.sort(a) - col.sort(b)) * dir || b.pts - a.pts);
  const frac = (m, a) => `${m}/${a}`;
  $('[data-players]').innerHTML = rows.map((p) => `<tr data-no="${p.no}">
      <td class="who"><b>${playerLabel(p)}</b><span>${esc(p.pos)}${p.starter ? ' · Starter' : ''}</span></td>
      <td class="num">${p.min}</td><td class="num"><b>${p.pts}</b></td><td class="num">${p.reb}</td><td class="num">${p.ast}</td><td class="num">${p.tov}</td>
      <td class="num">${frac(p.fgm, p.fga)}</td><td class="num">${frac(p.tpm, p.tpa)}</td><td class="num">${frac(p.ftm, p.fta)}</td>
      <td class="num ${p.pm >= 0 ? 'pm-pos' : 'pm-neg'}">${signed(p.pm)}</td>
      <td><button class="mini-btn" type="button" data-shots-for="${p.no}" aria-pressed="false" aria-label="Show shots for number ${p.no}">Shots</button></td>
    </tr>`).join('');
  renderShots(false);
}

function wirePlayers() {
  $('[data-players-head]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const key = b.dataset.sort;
    state.sort = state.sort.key === key
      ? { key, dir: state.sort.dir === 'descending' ? 'ascending' : 'descending' }
      : { key, dir: key === 'no' || key === 'tov' ? 'ascending' : 'descending' };
    renderPlayers();
    $(`[data-sort="${key}"]`).focus();
  });
  $('[data-players]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-shots-for]');
    if (!b) return;
    state.player = state.player === b.dataset.shotsFor ? 'all' : b.dataset.shotsFor;
    $('[data-player-select]').value = state.player;
    writeUrl();
    renderShots(true);
    if (state.player !== 'all') $('#shots').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  });
}

// ---------------------------------------------------------------- lineups
function renderLineups(animate) {
  const box = $('[data-lineups]');
  const rows = [...state.game.lineups].sort((a, b) => b.pm - a.pm);
  const max = Math.max(...rows.map((l) => Math.abs(l.pm)), 1);
  box.classList.toggle('is-new', Boolean(animate) && !reduced);
  box.innerHTML = rows.map((l) => {
    const w = (Math.abs(l.pm) / max) * 36;
    const pos = l.pm >= 0;
    const label = `<span class="lineup__val" style="${pos ? `left:calc(50% + ${w}% + 8px)` : `right:calc(50% + ${w}% + 8px)`}">${signed(l.pm)}</span>`;
    return `<div class="lineup">
      <div class="lineup__name"><b>${esc(l.name)}</b><span>${l.min} min · No. ${l.players.join(', ')}</span></div>
      <div class="lineup__track" role="img" aria-label="${esc(l.name)}: ${pos ? 'plus' : 'minus'} ${Math.abs(l.pm)} in ${l.min} minutes">
        ${l.pm ? `<span class="lineup__bar lineup__bar--${pos ? 'pos' : 'neg'}" style="width:${w}%"></span>` : ''}${label}
      </div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------- quarters
function renderQuarters(animate) {
  const qs = state.game.quarters;
  const box = $('[data-quarters]');
  box.parentElement.classList.toggle('is-new', Boolean(animate) && !reduced);
  const W = Math.max(Math.round(box.clientWidth) || 520, 280); const H = 220; const top = 22; const bottom = 28; const left = 28;
  const max = Math.ceil(Math.max(...qs.flatMap((q) => [q.team, q.opp])) / 10) * 10;
  const y = (v) => top + (H - top - bottom) * (1 - v / max);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Points by quarter. ${qs.map((q) => `${q.q > 4 ? `Overtime ${q.q - 4}` : `Quarter ${q.q}`}: your team ${q.team}, opponent ${q.opp}`).join('. ')}.` });
  [0, max / 2, max].forEach((v) => {
    svgEl('line', { class: 'gridline', x1: left, x2: W, y1: y(v), y2: y(v) }, svg);
    const t = svgEl('text', { class: 'axis-text', x: left - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg);
    t.textContent = v;
  });
  const slot = (W - left) / qs.length;
  const bw = Math.min(40, slot * 0.3);
  const bar = (x, v, cls) => {
    const h = y(0) - y(v);
    const r = Math.min(4, h / 2);
    svgEl('path', { class: cls, d: `M${x} ${y(0)}V${y(v) + r}Q${x} ${y(v)} ${x + r} ${y(v)}H${x + bw - r}Q${x + bw} ${y(v)} ${x + bw} ${y(v) + r}V${y(0)}Z` }, svg);
    const t = svgEl('text', { class: 'val', x: x + bw / 2, y: y(v) - 6, 'text-anchor': 'middle' }, svg);
    t.textContent = v;
  };
  qs.forEach((q, i) => {
    const cx = left + slot * i + slot / 2;
    bar(cx - bw - 1, q.team, 'bar-team');
    bar(cx + 1, q.opp, 'bar-opp');
    const t = svgEl('text', { class: 'axis-text', x: cx, y: H - 6, 'text-anchor': 'middle' }, svg);
    t.textContent = q.q > 4 ? `OT${q.q - 4}` : `Q${q.q}`;
  });
  box.replaceChildren(svg);

  $('[data-q-head]').innerHTML = `<tr><th scope="col">Quarter</th>${qs.map((q) => `<th scope="col" class="num">${q.q > 4 ? `OT${q.q - 4}` : `Q${q.q}`}</th>`).join('')}</tr>`;
  const row = (label, key) => `<tr><th scope="row">${label}</th>${qs.map((q) => `<td class="num">${q[key]}</td>`).join('')}</tr>`;
  $('[data-q-body]').innerHTML = `<tr><th scope="row">Margin</th>${qs.map((q) => `<td class="num">${signed(q.team - q.opp)}</td>`).join('')}</tr>${row('Turnovers', 'tov')}${row('Fouls', 'fouls')}`;
}

// ---------------------------------------------------------------- season line
function renderSeason() {
  const games = state.data.games;
  const box = $('[data-season]');
  const tip = $('[data-season-tip]');
  box.querySelector('svg')?.remove();
  const W = Math.max(Math.round(box.clientWidth) || 900, 300); const H = W < 600 ? 230 : 260; const top = 20; const bottom = 34; const left = 36; const right = 80;
  const values = games.flatMap((g) => [g.score.team, g.score.opp]);
  const lo = Math.floor((Math.min(...values) - 5) / 10) * 10;
  const hi = Math.ceil((Math.max(...values) + 5) / 10) * 10;
  const x = (i) => left + (games.length === 1 ? (W - left - right) / 2 : ((W - left - right) * i) / (games.length - 1));
  const y = (v) => top + (H - top - bottom) * (1 - (v - lo) / (hi - lo));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Points scored and allowed by game' });
  box.prepend(svg);
  const step = (W - left - right) / Math.max(games.length - 1, 1);
  const span = (i) => { const a = Math.max(x(i) - step / 2 + 4, left + 4); const b = Math.min(x(i) + step / 2 - 4, W - 4); return { x: a, width: b - a }; };
  games.forEach((g, i) => svgEl('rect', { class: `band${g === state.game ? ' is-current' : ''}`, ...span(i), y: top - 8, height: H - top - bottom + 8, rx: 8 }, svg));
  const ticks = 4;
  for (let k = 0; k <= ticks; k += 1) {
    const v = lo + ((hi - lo) * k) / ticks;
    svgEl('line', { class: 'gridline', x1: left, x2: W - right + 20, y1: y(v), y2: y(v) }, svg);
    const t = svgEl('text', { class: 'axis-text', x: left - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg);
    t.textContent = whole.format(v);
  }
  const path = (key) => games.map((g, i) => `${i ? 'L' : 'M'}${x(i)} ${y(g.score[key])}`).join('');
  svgEl('path', { class: 'series series--opp', d: path('opp') }, svg);
  svgEl('path', { class: 'series series--team', d: path('team') }, svg);
  const cross = svgEl('line', { class: 'crosshair', y1: top - 8, y2: H - bottom, visibility: 'hidden' }, svg);
  games.forEach((g, i) => {
    svgEl('circle', { class: 'pt pt--opp', cx: x(i), cy: y(g.score.opp), r: 5 }, svg);
    svgEl('circle', { class: 'pt pt--team', cx: x(i), cy: y(g.score.team), r: 5 }, svg);
    const t = svgEl('text', { class: `axis-text${g === state.game ? ' is-current' : ''}`, x: x(i), y: H - 10, 'text-anchor': 'middle' }, svg);
    t.textContent = `G${g.number}`;
  });
  // direct labels at the line ends, nudged apart when close
  const last = games.length - 1;
  let ty = y(games[last].score.team); let oy = y(games[last].score.opp);
  if (Math.abs(ty - oy) < 16) { const mid = (ty + oy) / 2; ty = mid + (ty <= oy ? -9 : 9); oy = mid + (oy < ty ? -9 : 9); }
  const endLabel = (v, yy, text) => { const t = svgEl('text', { class: 'end-label', x: x(last) + 12, y: yy + 4 }, svg); t.textContent = `${text} ${v}`; };
  endLabel(games[last].score.team, ty, 'Scored');
  endLabel(games[last].score.opp, oy, 'Allowed');

  // a hit area per game: hover shows the numbers, click or Enter opens the game
  games.forEach((g, i) => {
    const hit = svgEl('rect', { class: 'hit', ...span(i), y: top - 8, height: H - top - bottom + 8, tabindex: '0', role: 'button',
      'aria-label': `Game ${g.number} vs ${g.opponent}, ${shortDate.format(toDate(g.date))}: scored ${g.score.team}, allowed ${g.score.opp}. Open this game.` }, svg);
    svgEl('rect', { class: 'focus-ring', ...span(i), y: top - 8, height: H - top - bottom + 8, rx: 8 }, svg);
    const show = () => {
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      const win = g.score.team > g.score.opp;
      tip.innerHTML = `<b>Game ${g.number} vs ${esc(g.opponent)}</b><span>${shortDate.format(toDate(g.date))} · ${win ? 'Won' : 'Lost'} ${signed(g.score.team - g.score.opp)}</span><br><span>Scored</span> ${g.score.team} · <span>Allowed</span> ${g.score.opp}`;
      const scale = svg.getBoundingClientRect().width / W;
      tip.style.left = `${Math.min(Math.max(x(i) * scale, 100), box.getBoundingClientRect().width - 100)}px`;
      tip.style.top = `${y(Math.max(g.score.team, g.score.opp)) * scale}px`;
      tip.hidden = false;
    };
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', show);
    hit.addEventListener('blur', hide);
    const open = () => { if (g === state.game) return; state.player = 'all'; state.q = 'all'; state.result = 'all'; selectGame(g.number, true); };
    hit.addEventListener('click', open);
    hit.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

// ---------------------------------------------------------------- the whole page
function selectGame(number, animate) {
  const games = state.data.games;
  state.game = games.find((g) => String(g.number) === String(number)) || games[games.length - 1];
  $('[data-game-select]').value = String(state.game.number);
  document.title = `Game ${state.game.number} vs ${state.game.opponent}: ClutchMetrics coach dashboard`;
  buildFilters();
  renderOverview();
  renderPlayers();
  renderShots(animate);
  renderLineups(animate);
  renderQuarters(animate);
  renderSeason();
  writeUrl();
}

function trackSections() {
  const links = [...document.querySelectorAll('.side__nav a')];
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => {
        const here = a.getAttribute('href') === `#${e.target.id}`;
        a.classList.toggle('is-here', here);
        if (here) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  links.forEach((a) => { const s = document.querySelector(a.getAttribute('href')); if (s) io.observe(s); });
}

async function start() {
  if (!document.querySelector('[data-dashboard]')) return;
  try {
    const res = await fetch('data/games.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    state.data = await res.json();
    if (!state.data.games?.length) throw new Error('no games in the file');
  } catch (err) {
    const box = $('[data-load-error]');
    box.textContent = `The game data could not load (${err.message}). Check that data/games.json exists, and open the site through a web server, not by double-clicking the file.`;
    box.hidden = false;
    $('[data-game-title]').textContent = 'No game data';
    return;
  }
  $('[data-sample]').hidden = !state.data.sample;
  const url = readUrl();
  Object.assign(state, { player: url.player, q: url.q, result: url.result });
  $('[data-game-select]').innerHTML = [...state.data.games].reverse()
    .map((g) => `<option value="${g.number}">Game ${g.number} vs ${esc(g.opponent)} · ${shortDate.format(toDate(g.date))}</option>`).join('');
  $('[data-game-select]').addEventListener('change', (e) => { state.player = 'all'; state.q = 'all'; state.result = 'all'; selectGame(e.target.value, true); });
  wireFilters();
  wirePlayers();
  shotTooltip();
  selectGame(url.game, true);
  trackSections();
  let t;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { renderSeason(); renderQuarters(false); }, 150); });
}

start();
