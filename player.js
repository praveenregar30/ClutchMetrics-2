// ClutchMetrics player report. The player's own analyses come from the analysis server; each upload remembers
// which player in the video is "me" (team + jersey number, chosen at upload or fixed here).

import { serverFetch, serverVideoUrl } from './config.js';
import { analyse } from './insights.js?v=1';
import { advancedStats, insightLists, methodNote, ppiCard, radarSvg, radarValues, teamAverageValues } from './insights-ui.js?v=1';

const $ = (sel, root = document) => root.querySelector(sel);
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}, parent) => {
  const el = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (parent) parent.append(el);
  return el;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pct = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });
const one = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const state = { jobs: [], match: null, data: null, me: null, hlKind: 'all', reel: null };
const NO_COURT = 'The court could not be mapped for this video, so speed, distance, heat map and shot positions are not available.';
const courtMapped = (d = state.data) => d.court_mapped !== false;
const keyOf = (me) => `${me.team}-${me.no}`;
const findPlayer = (d, me) => (me ? d.players.find((p) => p.team === me.team && String(p.no) === String(me.no)) : null);
const labelOf = (d, p) => `${d.teams[p.team].code} #${p.no}`;

function placeTip(tip, box, left, top) {
  const w = box.getBoundingClientRect().width;
  const half = Math.min(tip.offsetWidth / 2 || 90, w / 2);
  tip.style.left = `${Math.min(Math.max(left, half), w - half)}px`;
  tip.style.top = `${top}px`;
}

// ---------------------------------------------------------------- plays
function allPlays(d) {
  return [...d.plays, ...d.shots.map((s) => ({ ...s, type: 'shot' }))].sort((a, b) => a.t - b.t);
}
const people = (p) => (p.type === 'shot' ? [p.player] : p.type === 'pass' ? [p.from, p.to] : [p.player, p.from]);
function playText(p) {
  if (p.type === 'pass') return 'Pass';
  if (p.type === 'interception') return 'Interception';
  if (p.kind === 'free_throw') return p.made ? 'Free throw made' : 'Free throw missed';
  if (p.made) return p.points === 3 ? '3-pointer made' : p.points ? `${p.points}-pointer made` : 'Shot made';
  return p.value === 3 ? '3-point miss' : 'Shot missed';
}
// the moment from the player's side: "You passed to AUS #2", "AUS #5 passed to you"
function myText(p, label) {
  const you = (l) => (l === label ? '<b class="you">you</b>' : esc(l));
  if (p.type === 'pass') return p.from === label ? `You passed to ${esc(p.to)}` : `${esc(p.from)} passed to ${you(p.to)}`;
  if (p.type === 'interception') return p.player === label ? `You won the ball from ${esc(p.from)}` : `${esc(p.player)} won the ball from ${you(p.from)}`;
  return `${p.distance_m ? `${one.format(p.distance_m)} m from the basket` : 'Shot'}`;
}
const ICONS = {
  made: '<circle cx="12" cy="12" r="7"/><path d="M5 12h14M12 5c-2.5 2-2.5 12 0 14M12 5c2.5 2 2.5 12 0 14"/>',
  missed: '<path d="M7 7l10 10M17 7 7 17"/>',
  pass: '<path d="M4 12h15M14 7l5 5-5 5"/>',
  received: '<path d="M20 12H5M10 7l-5 5 5 5"/>',
  interception: '<path d="M12 4 20 12 12 20 4 12z"/><path d="M9 12h6"/>',
  lost: '<path d="M12 4 20 12 12 20 4 12z"/><path d="M9 9l6 6M15 9l-6 6"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
function iconFor(p, label) {
  if (p.type === 'shot') return p.made ? 'made' : 'missed';
  if (p.type === 'pass') return p.from === label ? 'pass' : 'received';
  return p.player === label ? 'interception' : 'lost';
}

// ---------------------------------------------------------------- courts and charts
const HALF_COURT = `<rect class="court__floor" width="1500" height="1050"/>
  <path class="court__plank" d="M0 150H1500M0 300H1500M0 450H1500M0 600H1500M0 750H1500M0 900H1500"/>
  <rect class="court__paint" x="505" width="490" height="580"/>
  <path class="court__line" d="M505 0V580H995V0M570 580A180 180 0 0 0 930 580M570 580A180 180 0 0 1 930 580M90 0V299A675 675 0 0 0 1410 299V0M625 157.500A125 125 0 0 0 875 157.500M570 1050A180 180 0 0 1 930 1050M0 0H1500"/>
  <path class="court__board" d="M660 120H840"/>
  <circle class="court__rim" cx="750" cy="157.500" r="22.500"/>`;

function drawFullCourt(svg) {
  const g = svgEl('g', { class: 'fc' }, svg);
  svgEl('rect', { class: 'fc__floor', width: 2800, height: 1500, rx: 8 }, g);
  const arc = (side) => {
    const bx = side ? 2800 - 157.5 : 157.5; const s = side ? -1 : 1;
    return `M${side ? 2800 : 0} 90H${bx + s * 141.5}A675 675 0 0 ${side ? 0 : 1} ${bx + s * 141.5} 1410H${side ? 2800 : 0}`;
  };
  svgEl('path', { class: 'fc__line', d: ['M0 0H2800V1500H0Z', 'M1400 0V1500', 'M1220 750A180 180 0 0 0 1580 750A180 180 0 0 0 1220 750',
    'M0 505H580V995H0', 'M580 570A180 180 0 0 1 580 930', 'M2800 505H2220V995H2800', 'M2220 570A180 180 0 0 0 2220 930', arc(0), arc(1)].join('') }, g);
  svgEl('circle', { class: 'fc__rim', cx: 157.5, cy: 750, r: 22.5 }, g);
  svgEl('circle', { class: 'fc__rim', cx: 2642.5, cy: 750, r: 22.5 }, g);
}

function heatSvg(grid, ariaLabel) {
  const max = Math.max(...grid.flat(), 0.001);
  const svg = svgEl('svg', { viewBox: '-20 -20 2840 1540', role: 'img', 'aria-label': ariaLabel });
  drawFullCourt(svg);
  const cells = svgEl('g', { class: 'heat__cells heat--team' }, svg);
  grid.forEach((row, r) => row.forEach((v, c) => {
    if (v > 0) svgEl('rect', { x: c * 100 + 4, y: r * 100 + 4, width: 92, height: 92, rx: 10, style: `opacity:${(0.18 + 0.82 * Math.sqrt(v / max)).toFixed(3)}` }, cells);
  }));
  svgEl('path', { class: 'fc__line fc__line--top', d: 'M0 0H2800V1500H0Z' }, svg);
  return svg;
}

// ---------------------------------------------------------------- the video and the highlights reel
const video = () => $('[data-video]');
function seek(t, { play = true, scroll = true } = {}) {
  const v = video();
  v.currentTime = Math.max(0, t);
  if (scroll) $('#highlights').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  if (play) v.play().catch(() => {});
}
const CLIP_BEFORE = 2; const CLIP_AFTER = 3;

function stopReel(message) {
  if (state.reel) { video().removeEventListener('timeupdate', state.reel.tick); state.reel = null; }
  $('[data-reel-play]').textContent = 'Play all';
  document.querySelectorAll('[data-reel-list] .is-now').forEach((li) => li.classList.remove('is-now'));
  if (message !== undefined) $('[data-reel-now]').textContent = message;
}

// plays moments[i..] one after another: each from 2 s before to 3 s after the moment
function playReel(moments, i = 0, single = false) {
  stopReel();
  if (!moments.length) return;
  const v = video();
  const items = [...document.querySelectorAll('[data-reel-list] .feed__item')];
  const show = (k) => {
    items.forEach((li, n) => li.classList.toggle('is-now', n === k));
    $('[data-reel-now]').textContent = `${single ? 'Playing' : `Moment ${k + 1} of ${moments.length}`}: ${clock(moments[k].t)} ${playText(moments[k]).toLowerCase()}`;
    items[k]?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  };
  let k = i;
  const tick = () => {
    if (v.currentTime < moments[k].t + CLIP_AFTER) return;
    if (single || k + 1 >= moments.length) { v.pause(); stopReel(single ? '' : `Played all ${plural(moments.length, 'moment')}.`); return; }
    k += 1; show(k); v.currentTime = Math.max(0, moments[k].t - CLIP_BEFORE);
  };
  state.reel = { tick };
  v.addEventListener('timeupdate', tick);
  $('[data-reel-play]').textContent = 'Stop';
  show(k);
  v.currentTime = Math.max(0, moments[k].t - CLIP_BEFORE);
  v.play().catch(() => {});
}

// ---------------------------------------------------------------- the report
function teamRank(d, p, get) {
  const team = d.players.filter((x) => x.team === p.team && get(x) !== null && get(x) !== undefined);
  if (!get(p)) return '';
  const sorted = [...team].sort((a, b) => get(b) - get(a));
  const i = sorted.indexOf(p);
  return i === 0 ? `Most in ${d.teams[p.team].code}` : `${['1st', '2nd', '3rd'][i] || `${i + 1}th`} of ${sorted.length} in ${d.teams[p.team].code}`;
}

function renderHead(d, p) {
  const team = d.teams[p.team]; const opp = d.teams[1 - p.team];
  $('[data-me-no]').textContent = p.no;
  $('[data-meta]').textContent = [d.competition, d.date ? dateFmt.format(new Date(`${d.date}T12:00:00`)) : '', d.venue].filter(Boolean).join(' · ');
  $('[data-me-title]').textContent = `Number ${p.no}, ${team.name}`;
  $('[data-me-sub]').textContent = `${team.name} vs ${opp.name}. You were seen on court for ${clock(p.seconds)} of the ${clock(d.clip.duration_s)} analysed.`;
  const mapped = courtMapped(d);
  const tiles = [
    ['Points', p.pts, teamRank(d, p, (x) => x.pts)],
    ['Field goals', `${p.fgm}/${p.fga}`, p.fga ? `${pct.format(p.fgm / p.fga)} made` : 'No shots'],
    ['Three-pointers', `${p.tpm}/${p.tpa}`, p.tpa ? `${pct.format(p.tpm / p.tpa)} made` : 'No attempts'],
    ['Passes made', p.passes, teamRank(d, p, (x) => x.passes)],
    ['Passes received', p.received, teamRank(d, p, (x) => x.received)],
    ['Interceptions', p.int, teamRank(d, p, (x) => x.int)],
    ['With the ball', p.ball_s === null ? '–' : `${one.format(p.ball_s)} s`, teamRank(d, p, (x) => x.ball_s)],
    ...(mapped ? [['Distance', `${whole.format(p.distance_m)} m`, teamRank(d, p, (x) => x.distance_m)],
      ['Top speed', p.top_kmh ? `${one.format(p.top_kmh)} km/h` : '–', teamRank(d, p, (x) => x.top_kmh)]] : []),
  ];
  $('[data-me-stats]').innerHTML = tiles.map(([l, v, r]) => `<div><dt>${l}</dt><dd>${v}</dd>${r ? `<span>${esc(r)}</span>` : ''}</div>`).join('');
}

function renderVs(d, p) {
  const mates = d.players.filter((x) => x.team === p.team && x !== p);
  const mapped = courtMapped(d);
  const rows = [
    ['Points', (x) => x.pts, (v) => whole.format(v)],
    ['Shots taken', (x) => x.fga, (v) => one.format(v).replace(/\.0$/, '')],
    ['Passes made', (x) => x.passes, (v) => one.format(v).replace(/\.0$/, '')],
    ['Passes received', (x) => x.received, (v) => one.format(v).replace(/\.0$/, '')],
    ['Interceptions', (x) => x.int, (v) => one.format(v).replace(/\.0$/, '')],
    ['Time with the ball', (x) => x.ball_s || 0, (v) => `${one.format(v)} s`],
    ['Time on court', (x) => x.seconds, (v) => clock(v)],
    ...(mapped ? [['Distance', (x) => x.distance_m || 0, (v) => `${whole.format(v)} m`], ['Top speed', (x) => x.top_kmh || 0, (v) => `${one.format(v)} km/h`]] : []),
  ];
  $('[data-vs-sub]').textContent = mates.length
    ? `Each bar is you; the line is the average of your ${plural(mates.length, 'identified team-mate')} in this game.`
    : 'No identified team-mates in this game to compare with.';
  $('[data-vs]').innerHTML = rows.map(([label, get, fmt]) => {
    const mine = get(p);
    const avg = mates.length ? mates.reduce((a, x) => a + get(x), 0) / mates.length : 0;
    const top = Math.max(mine, avg, ...mates.map(get), 0.0001);
    const diff = mine - avg;
    const word = !mates.length ? '' : Math.abs(diff) < 0.05 * top ? 'about average' : diff > 0 ? 'above average' : 'below average';
    return `<div class="vs__row">
      <span class="vs__label">${label}</span>
      <div class="vs__track" role="img" aria-label="${label}: you ${fmt(mine)}, team-mates' average ${fmt(avg)}">
        <span class="vs__bar" style="width:${(mine / top) * 100}%"></span>
        ${mates.length ? `<span class="vs__avg" style="left:${(avg / top) * 100}%"></span>` : ''}
      </div>
      <span class="vs__val"><b>${fmt(mine)}</b><span>${word ? `${word}, avg ${fmt(avg)}` : ''}</span></span>
    </div>`;
  }).join('');
  $('[data-vs]').classList.toggle('is-new', !reduced);
}

function myMoments(d, label) {
  return allPlays(d).filter((q) => people(q).includes(label));
}

function renderHighlights(d, p) {
  const label = labelOf(d, p);
  const all = myMoments(d, label);
  const kinds = [['all', 'All', () => true], ['shot', 'Shots', (q) => q.type === 'shot'], ['pass', 'Passes', (q) => q.type === 'pass'],
    ['interception', 'Ball won or lost', (q) => q.type === 'interception']];
  const seg = $('[data-seg="hlKind"]');
  seg.innerHTML = kinds.map(([v, l, f]) => `<button type="button" data-value="${v}" aria-pressed="${String(state.hlKind === v)}">${l}<span class="count">${all.filter(f).length}</span></button>`).join('');
  const list = all.filter(kinds.find((k) => k[0] === state.hlKind)[2]);
  state.moments = list;
  $('[data-hl-sub]').textContent = all.length
    ? `${plural(all.length, 'moment')} of yours in this game. Play them all one after another, or pick one.`
    : 'The model found no passes, shots or interceptions of yours in this game.';
  $('[data-reel-list]').innerHTML = list.length ? list.map((q, i) => `<li class="feed__item feed__item--team">
      <button class="feed__t" type="button" data-reel-one="${i}" aria-label="Watch ${clock(q.t)}"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z"/></svg>${clock(q.t)}</button>
      <span class="feed__ic feed__ic--${iconFor(q, label)}">${icon(iconFor(q, label))}</span>
      <div class="feed__text"><b>${esc(playText(q))}</b><span>${myText(q, label)}</span></div>
    </li>`).join('') : '<li class="feed__none">No moments of this kind.</li>';
  $('[data-reel-play]').disabled = !list.length;
  stopReel('');
}

function renderShots(d, p) {
  const box = $('[data-pcourt]');
  box.querySelector('svg')?.remove();
  const shots = d.shots.filter((s) => s.team === p.team && String(s.no) === String(p.no) && s.kind === 'field_goal');
  const placed = shots.filter((s) => s.x !== null);
  const made = shots.filter((s) => s.made).length;
  const svg = svgEl('svg', { class: 'court__svg', viewBox: '0 0 1500 1050', role: 'img', 'aria-label': `Your shots: ${made} of ${shots.length} made` });
  svg.innerHTML = HALF_COURT;
  box.prepend(svg);
  const layer = svgEl('g', { class: `shot-layer${reduced ? '' : ' is-new'}` }, svg);
  placed.forEach((s, i) => {
    const x = 750 + s.x * 100; const y = s.y * 100;
    const g = svgEl('g', { class: `shot shot--team ${s.made ? 'shot--made' : 'shot--miss'}`, style: `--i: ${i}`, tabindex: '0', role: 'button' }, layer);
    g.setAttribute('aria-label', `${clock(s.t)}: ${s.made ? 'made' : 'missed'}, ${s.zone}, ${one.format(s.distance_m)} m. Watch.`);
    svgEl('circle', { class: 'shot__hit', cx: x, cy: y, r: 40 }, g);
    if (s.made) svgEl('circle', { class: 'shot__mark', cx: x, cy: y, r: 26 }, g);
    else svgEl('path', { class: 'shot__mark', d: `M${x - 20} ${y - 20}l40 40m0-40l-40 40` }, g);
    const tip = $('[data-pcourt-tip]');
    const show = () => {
      tip.innerHTML = `<b>${s.made ? 'Made' : 'Missed'} · ${clock(s.t)}</b><span>${esc(s.zone)}, ${one.format(s.distance_m)} m${s.made && s.points ? `, ${s.points} points` : ''}. Select to watch.</span>`;
      tip.hidden = false;
      const k = svg.getBoundingClientRect().width / 1500; placeTip(tip, box, x * k, y * k);
    };
    g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
    g.addEventListener('pointerleave', () => { tip.hidden = true; }); g.addEventListener('blur', () => { tip.hidden = true; });
    g.addEventListener('click', () => seek(s.t - CLIP_BEFORE));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seek(s.t - CLIP_BEFORE); } });
  });
  const pts = shots.reduce((a, s) => a + (s.made ? s.points || 0 : 0), 0);
  $('[data-pshots-sub]').textContent = shots.length
    ? `${made} of ${shots.length} made, ${plural(pts, 'point')}.${shots.length > placed.length ? ` ${shots.length - placed.length} not drawn: ${courtMapped(d) ? 'your position could not be measured' : 'the court was not mapped'}.` : ''} Select a shot to watch it.`
    : 'No shots in this game.';
}

function renderPassing(d, p) {
  const label = labelOf(d, p);
  const to = {}; const from = {};
  d.plays.filter((q) => q.type === 'pass').forEach((q) => {
    if (q.from === label) to[q.to] = (to[q.to] || 0) + 1;
    if (q.to === label) from[q.from] = (from[q.from] || 0) + 1;
  });
  const list = (o, none) => {
    const top = Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return top.length ? `<ul class="spot__pairs">${top.map(([who, c]) => `<li><span>${esc(who)}</span><b>${c}</b></li>`).join('')}</ul>` : `<p class="fine">${none}</p>`;
  };
  $('[data-ppass]').innerHTML = `<div><h3 class="pass-h">Passed most to</h3>${list(to, 'No passes to identified team-mates.')}</div>
    <div><h3 class="pass-h">Received most from</h3>${list(from, 'No passes from identified team-mates.')}</div>`;
}

function renderSpeed(d, p) {
  const box = $('[data-pspeed]');
  box.querySelector('svg')?.remove();
  box.querySelector('.fine')?.remove();
  const pts = (d.speed || {})[keyOf(state.me)] || [];
  if (!courtMapped(d) || pts.length < 2) { box.insertAdjacentHTML('beforeend', `<p class="fine">${courtMapped(d) ? 'Not enough speed readings for you in this game.' : NO_COURT}</p>`); return; }
  const W = 640; const H = 200; const L = 40; const R = 10; const T = 16; const B = 26;
  const dur = d.clip.duration_s;
  const top = Math.max(20, ...pts.map((q) => q[1]));
  const x = (t) => L + ((W - L - R) * t) / dur;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Your speed through the game, top ${one.format(p.top_kmh || 0)} km/h. Select a moment to watch it.` });
  [0, 10, 20, 30].filter((v) => v <= top).forEach((v) => {
    svgEl('line', { class: 'gridline', x1: L, x2: W - R, y1: y(v), y2: y(v) }, svg);
    svgEl('text', { class: 'axis-text', x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = v;
  });
  for (let s = 0; s <= dur; s += dur > 90 ? 30 : 15) svgEl('text', { class: 'axis-text', x: x(s), y: H - 6, 'text-anchor': 'middle' }, svg).textContent = clock(s);
  const runs = [[]];
  pts.forEach((q, i) => { if (i && q[0] - pts[i - 1][0] > 2) runs.push([]); runs[runs.length - 1].push(q); });
  runs.filter((r) => r.length > 1).forEach((r) => {
    const line = r.map((q) => `${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join(' ');
    svgEl('polygon', { class: 'speed__area speed--team', points: `${x(r[0][0])},${y(0)} ${line} ${x(r[r.length - 1][0])},${y(0)}` }, svg);
    svgEl('polyline', { class: 'speed__line speed--team', points: line }, svg);
  });
  const best = pts.reduce((a, q) => (q[1] > a[1] ? q : a));
  svgEl('circle', { class: 'speed__top speed--team', cx: x(best[0]), cy: y(best[1]), r: 5 }, svg);
  svgEl('text', { class: 'speed__label', x: Math.min(x(best[0]) + 9, W - 130), y: Math.max(y(best[1]) - 8, 12) }, svg).textContent = `Top ${one.format(best[1])} km/h at ${clock(best[0])}`;
  const head = svgEl('line', { class: 'speed__cursor', x1: 0, x2: 0, y1: T, y2: H - B, style: 'display:none' }, svg);
  box.prepend(svg);
  const tip = $('[data-pspeed-tip]');
  const at = (e) => {
    const r = svg.getBoundingClientRect();
    const t = ((((e.clientX - r.left) * W) / r.width - L) / (W - L - R)) * dur;
    return { q: pts.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a)), r };
  };
  svg.addEventListener('pointermove', (e) => {
    const { q, r } = at(e);
    head.setAttribute('x1', x(q[0])); head.setAttribute('x2', x(q[0])); head.style.display = '';
    tip.innerHTML = `<b>${clock(q[0])}</b><span>${one.format(q[1])} km/h</span>`;
    tip.hidden = false;
    placeTip(tip, box, (x(q[0]) * r.width) / W, 24);
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; head.style.display = 'none'; });
  svg.addEventListener('click', (e) => seek(at(e).q[0] - 1));
}

function renderHeat(d, p) {
  const box = $('[data-pheat]');
  box.replaceChildren();
  const grid = d.heat?.players?.[keyOf(state.me)];
  if (!courtMapped(d) || !grid) { box.innerHTML = `<p class="fine">${courtMapped(d) ? 'No court positions for you in this game.' : NO_COURT}</p>`; return; }
  const total = grid.flat().reduce((a, v) => a + v, 0);
  box.append(heatSvg(grid, `Where you spent time on the court, ${one.format(total)} seconds in total`));
  $('[data-pheat-sub]').textContent = `Time spent in each square metre of the court (${one.format(total)} s in total). Both ends are shown, because teams attack and defend.`;
}

// ---------------------------------------------------------------- across games
async function renderForm() {
  const box = $('[data-form]');
  const sub = $('[data-form-sub]');
  const games = [];
  const recent = state.jobs.slice(0, 10);
  sub.textContent = `Loading your ${plural(recent.length, 'game')}…`;
  const loaded = await Promise.all(recent.map(async (j) => {
    if (j.id === state.match) return { job: j, data: state.data, me: state.me };
    try {
      const res = await serverFetch(`/api/jobs/${j.id}/match.json`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return { job: j, data, me: data.me };
    } catch { return null; }
  }));
  loaded.filter(Boolean).forEach(({ job, data, me }) => {
    const p = findPlayer(data, me);
    if (p) games.push({ job, data, p, when: data.date ? new Date(`${data.date}T12:00:00`) : new Date((job.created || 0) * 1000) });
  });
  games.sort((a, b) => a.when - b.when);
  const metrics = [
    ['Points', (g) => g.p.pts, (v) => whole.format(v)],
    ['Field goal %', (g) => (g.p.fga ? g.p.fgm / g.p.fga : null), (v) => pct.format(v)],
    ['Passes made', (g) => g.p.passes, (v) => whole.format(v)],
    ['Interceptions', (g) => g.p.int, (v) => whole.format(v)],
    ['Distance per minute', (g) => (courtMapped(g.data) && g.p.seconds ? g.p.distance_m / (g.p.seconds / 60) : null), (v) => `${whole.format(v)} m`],
    ['Top speed', (g) => (courtMapped(g.data) ? g.p.top_kmh : null), (v) => `${one.format(v)} km/h`],
  ];
  const skipped = recent.length - games.length;
  sub.textContent = games.length >= 2
    ? `Your numbers in your last ${plural(games.length, 'game')}, oldest to newest. The highlighted point is the game shown above.${skipped ? ` ${plural(skipped, 'game')} without your player picked ${skipped === 1 ? 'is' : 'are'} left out.` : ''}`
    : `Analyse another game and your trend appears here, game by game.${skipped ? ` ${plural(skipped, 'game')} without your player picked ${skipped === 1 ? 'is' : 'are'} left out.` : ''}`;
  box.innerHTML = metrics.map(([label, get, fmt]) => {
    const vals = games.map(get);
    const cur = games.findIndex((g) => g.job.id === state.match);
    const shown = cur >= 0 ? vals[cur] : vals.filter((v) => v !== null).slice(-1)[0];
    const known = vals.filter((v) => v !== null);
    const avg = known.length ? known.reduce((a, v) => a + v, 0) / known.length : null;
    return `<article class="trend">
      <span class="trend__label">${label}</span>
      <span class="trend__value">${shown === null || shown === undefined ? '–' : fmt(shown)}</span>
      <span class="trend__avg">${known.length >= 2 ? `Average ${fmt(avg)} over ${known.length} games` : 'This game'}</span>
      <div class="trend__chart" data-trend="${label}"></div>
    </article>`;
  }).join('');
  if (games.length < 2) return;
  metrics.forEach(([label, get, fmt]) => {
    const vals = games.map(get);
    const holder = box.querySelector(`[data-trend="${label}"]`);
    const W = 260; const H = 70; const P = 8;
    const known = vals.filter((v) => v !== null);
    if (known.length < 2) { holder.innerHTML = '<p class="fine">Not enough games with this number.</p>'; return; }
    const lo = Math.min(...known, 0); const hi = Math.max(...known, lo + 0.0001);
    const x = (i) => P + ((W - 2 * P) * i) / Math.max(vals.length - 1, 1);
    const y = (v) => H - P - ((H - 2 * P) * (v - lo)) / (hi - lo);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H + 18}`, role: 'img', 'aria-label': `${label} by game: ${vals.map((v, i) => `${games[i].data.title}: ${v === null ? 'unknown' : fmt(v)}`).join(', ')}` });
    const pts = vals.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean);
    svgEl('polyline', { class: 'spark', points: pts.map((q) => q.join(',')).join(' ') }, svg);
    vals.forEach((v, i) => {
      if (v === null) return;
      const c = svgEl('circle', { class: `pt${games[i].job.id === state.match ? ' is-current' : ''}`, cx: x(i), cy: y(v), r: games[i].job.id === state.match ? 5 : 3.5 }, svg);
      svgEl('title', {}, c).textContent = `${games[i].data.title}: ${fmt(v)}`;
    });
    svgEl('text', { class: 'axis-text', x: P, y: H + 14 }, svg).textContent = games[0].data.date ? dateFmt.format(games[0].when) : 'First';
    svgEl('text', { class: 'axis-text', x: W - P, y: H + 14, 'text-anchor': 'end' }, svg).textContent = games[games.length - 1].data.date ? dateFmt.format(games[games.length - 1].when) : 'Latest';
    holder.append(svg);
  });
}

// ---------------------------------------------------------------- "which player are you?"
function showWhoami(reason) {
  const d = state.data;
  const box = $('[data-whoami]');
  box.hidden = false;
  $('[data-whoami-text]').textContent = reason;
  let team = state.me ? state.me.team : 0;
  const draw = () => {
    $('[data-whoami-team]').innerHTML = d.teams.map((t, i) => `<button type="button" data-team="${i}" aria-pressed="${String(i === team)}">${esc(t.name)}</button>`).join('');
    const nos = d.players.filter((p) => p.team === team).sort((a, b) => Number(a.no) - Number(b.no));
    $('[data-whoami-nos]').innerHTML = nos.length
      ? nos.map((p) => `<button class="whoami__no" type="button" data-no="${esc(p.no)}" aria-pressed="${String(state.me && state.me.team === team && String(state.me.no) === String(p.no))}"><b>${esc(p.no)}</b><span>${clock(p.seconds)} on court</span></button>`).join('')
      : '<p class="fine">No jersey numbers were read for this team.</p>';
  };
  draw();
  $('[data-whoami-team]').onclick = (e) => { const b = e.target.closest('[data-team]'); if (b) { team = Number(b.dataset.team); draw(); } };
  $('[data-whoami-nos]').onclick = async (e) => {
    const b = e.target.closest('[data-no]');
    if (!b) return;
    const status = $('[data-whoami-status]');
    status.textContent = 'Saving…';
    try {
      const res = await serverFetch(`/api/jobs/${state.match}/me`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team, no: b.dataset.no }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.detail || `status ${res.status}`);
      state.me = out.me;
      status.textContent = '';
      box.hidden = true;
      renderReport();
    } catch (err) {
      status.textContent = `Could not save: ${err.message}. Restart the analysis server if it was started before this feature existed.`;
    }
  };
  box.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

function setParts(visible) { document.querySelectorAll('[data-part]').forEach((el) => { el.hidden = !visible; }); }

// performance profile from insights.js: index, radar against the team average, strengths, weaknesses, advanced stats
function renderProfile(d, p) {
  const ins = analyse(d);
  const key = `${p.team}-${p.no}`;
  const r = ins.rows.find((x) => x.key === key);
  const prof = ins.profiles[key];
  if (!r || !prof.eligible) {
    $('[data-prof-summary]').textContent = prof ? prof.note : 'No profile for this game.';
    ['[data-prof-ppi]', '[data-prof-radar]', '[data-prof-lists]', '[data-prof-adv]', '[data-prof-method]'].forEach((s) => { $(s).innerHTML = ''; });
    return;
  }
  $('[data-prof-summary]').textContent = prof.summary.replace(`${r.label} played`, 'You played').replace(/^(.*?)Stands out/, '$1You stand out').replace('Main thing to work on', 'Your main thing to work on');
  $('[data-prof-ppi]').innerHTML = ppiCard(r);
  $('[data-prof-radar]').innerHTML = radarSvg([{ name: 'You', tone: 'team', values: radarValues(r) }, { name: 'Team-mates average', tone: 'avg', values: teamAverageValues(ins.rows, r.team, r) }], 'Your profile against your team-mates');
  $('[data-prof-lists]').innerHTML = insightLists(prof);
  $('[data-prof-adv]').innerHTML = advancedStats(r, ins.mapped);
  $('[data-prof-method]').innerHTML = methodNote(ins.mapped);
}

function renderReport() {
  const d = state.data;
  const p = findPlayer(d, state.me);
  if (!p) {
    setParts(false);
    showWhoami(state.me
      ? `Number ${state.me.no} of ${d.teams[state.me.team].name} was not read in this video (the model could not see the number clearly enough). Pick another number if you wore a different one, or the player that is you.`
      : 'This game was uploaded without saying which player you are. Pick your team and your jersey number.');
    return;
  }
  setParts(true);
  $('[data-whoami]').hidden = true;
  document.title = `Number ${p.no}, ${d.teams[p.team].name}: your ClutchMetrics report`;
  renderHead(d, p);
  renderProfile(d, p);
  renderVs(d, p);
  renderHighlights(d, p);
  renderShots(d, p);
  renderPassing(d, p);
  renderSpeed(d, p);
  renderHeat(d, p);
  renderForm();
}

// ---------------------------------------------------------------- start
async function myAnalyses() {
  try {
    const res = await serverFetch('/api/jobs', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()).filter((j) => j.status === 'done');
  } catch { return null; }
}

function showEmpty(offline) {
  setParts(false);
  const box = $('[data-empty]');
  $('[data-empty-text]').textContent = offline
    ? 'Your games are kept on the analysis server, which is offline right now. Please try again later.'
    : 'You have not analysed a game yet. Upload a game video below and say which player you are; when the analysis is ready your report opens here. Only you can see your videos and results.';
  box.hidden = false;
  document.querySelectorAll('.side__nav a:not([href="#analyze"])').forEach((a) => a.setAttribute('hidden', ''));
}

function trackSections() {
  const links = [...document.querySelectorAll('.side__nav a')];
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    links.forEach((a) => {
      const here = a.getAttribute('href') === `#${e.target.id}`;
      a.classList.toggle('is-here', here);
      if (here) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }), { rootMargin: '-30% 0px -60% 0px' });
  links.forEach((a) => { const s = document.querySelector(a.getAttribute('href')); if (s) io.observe(s); });
}

async function start() {
  if (!document.querySelector('[data-dashboard="player"]')) return;
  const asked = new URLSearchParams(location.search).get('match');
  const jobs = await myAnalyses();
  state.jobs = jobs || [];
  state.match = asked && state.jobs.some((j) => j.id === asked) ? asked : state.jobs[0]?.id || null;
  const select = $('[data-match-select]');
  select.innerHTML = state.jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join('') || '<option value="">No games yet</option>';
  select.value = state.match || '';
  select.addEventListener('change', () => { if (select.value) location.search = `?match=${select.value}`; });
  if (!state.match) { showEmpty(jobs === null); return; }
  try {
    const res = await serverFetch(`/api/jobs/${state.match}/match.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    setParts(false);
    const box = $('[data-load-error]');
    box.textContent = `This game could not load (${err.message}). The analysis server may be offline.`;
    box.hidden = false;
    return;
  }
  state.me = state.data.me || state.jobs.find((j) => j.id === state.match)?.me || null;
  serverVideoUrl(state.data.video).then((src) => { video().src = src; })
    .catch(() => { $('[data-reel-now]').textContent = 'The video could not load from the analysis server.'; });
  $('[data-seg="hlKind"]').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { state.hlKind = b.dataset.value; renderHighlights(state.data, findPlayer(state.data, state.me)); }
  });
  $('[data-reel-play]').addEventListener('click', () => { if (state.reel) { video().pause(); stopReel(''); } else playReel(state.moments); });
  $('[data-reel-list]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-reel-one]');
    if (b) playReel(state.moments, Number(b.dataset.reelOne), true);
  });
  $('[data-whoami-open]').addEventListener('click', () => showWhoami('Pick the player that is you in this game. Your choice is saved for this game.'));
  renderReport();
  trackSections();
}

start();
