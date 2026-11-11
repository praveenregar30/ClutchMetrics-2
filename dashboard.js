// ClutchMetrics coach dashboard. Reads data/match.json, written by the analysis model's exporter
// (format in data/MATCH_FORMAT.md), and draws every view from it. "Your team" and the shot filters live in
// the address, so a view can be shared or reloaded.

import { savedCopies, savedCopyNote, serverFetch, serverVideoUrl } from './config.js?v=2';
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
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pct = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });
const one = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const ratio = (a, b) => (b ? a / b : 0);
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

const state = { data: null, match: null, team: 0, shotTeam: 'mine', player: 'all', result: 'all', playKind: 'all', playTeam: 'both',
  find: '', feedAll: false, heat: 'team', spot: null, rateTeam: 'mine', cmpA: null, cmpB: null, ins: null, sort: { key: 'pts', dir: 'descending' } };
const mine = () => state.team;
const theirs = () => 1 - state.team;
const role = (team) => (team === state.team ? 'team' : 'opp');
const code = (team) => state.data.teams[team].code;

// ---------------------------------------------------------------- the address
function readUrl() {
  const p = new URLSearchParams(location.search);
  return { match: p.get('match'), team: p.get('team'), player: p.get('player') || 'all', result: p.get('result') || 'all', shotTeam: p.get('shots') || 'mine', spot: p.get('spot') };
}
function writeUrl() {
  const p = new URLSearchParams();
  if (state.match) p.set('match', state.match);
  p.set('team', code(state.team));
  if (state.shotTeam !== 'mine') p.set('shots', state.shotTeam);
  if (state.player !== 'all') p.set('player', state.player);
  if (state.result !== 'all') p.set('result', state.result);
  if (state.spot) p.set('spot', state.spot);
  history.replaceState(null, '', `${location.pathname}?${p}${location.hash}`);
}

function placeTip(tip, box, left, top) {
  const w = box.getBoundingClientRect().width;
  const half = Math.min(tip.offsetWidth / 2 || 90, w / 2);
  tip.style.left = `${Math.min(Math.max(left, half), w - half)}px`;
  tip.style.top = `${top}px`;
}

// jumps the video to a moment, a second early so the play can be seen building
function watch(t) {
  const v = $('[data-video]');
  v.currentTime = Math.max(0, t - 1);
  $('#video').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  v.play().catch(() => {});
}

// ---------------------------------------------------------------- overview
function renderOverview() {
  const d = state.data;
  const me = d.teams[mine()]; const op = d.teams[theirs()];
  $('[data-meta]').textContent = [d.competition, d.date ? dateFmt.format(new Date(`${d.date}T12:00:00`)) : '', d.venue].filter(Boolean).join(' · ');
  $('[data-title]').textContent = `${me.name} vs ${op.name}`;
  const tv = d.tv_score.readings;
  const last = tv[tv.length - 1];
  $('[data-clip]').textContent = `Analysed clip: ${clock(d.clip.duration_s)} of play`
    + (last ? ` · TV scoreboard at the end: ${d.teams[0].code} ${last[1]}–${last[2]} ${d.teams[1].code}` : '');

  $('[data-scorebox]').innerHTML = `
    <span class="pick__label">Points in the clip</span>
    <div class="scorebox__main" aria-label="Points scored in the clip: ${esc(me.code)} ${me.points}, ${esc(op.code)} ${op.points}">
      <span class="scorebox__team"><i class="swatch swatch--team"></i>${esc(me.code)}</span>
      <b>${me.points}<span>–</span>${op.points}</b>
      <span class="scorebox__team">${esc(op.code)}<i class="swatch swatch--opp"></i></span>
    </div>`;

  const tiles = [
    { label: 'Points', a: me.points, b: op.points, show: (t) => whole.format(t.points), note: () => '' },
    { label: 'Field goals', a: ratio(me.fgm, me.fga), b: ratio(op.fgm, op.fga), show: (t) => `${t.fgm}/${t.fga}`,
      note: (t) => (t.fga ? `${pct.format(ratio(t.fgm, t.fga))} made` : 'No shots') },
    { label: 'Three-pointers', a: ratio(me.tpm, me.tpa), b: ratio(op.tpm, op.tpa), show: (t) => `${t.tpm}/${t.tpa}`,
      note: (t) => (t.tpa ? `${pct.format(ratio(t.tpm, t.tpa))} made` : 'No attempts') },
    { label: 'Ball control', a: me.ball_control_pct, b: op.ball_control_pct, show: (t) => `${whole.format(t.ball_control_pct)}%`, note: () => 'Share of the time' },
    { label: 'Passes', a: me.passes, b: op.passes, show: (t) => whole.format(t.passes), note: () => 'Completed to a team-mate' },
    { label: 'Interceptions', a: me.interceptions, b: op.interceptions, show: (t) => whole.format(t.interceptions), note: () => 'Ball won from the opponent' },
  ];
  $('[data-kpis]').innerHTML = tiles.map((k) => {
    const lead = k.a > k.b ? 'is-good' : '';
    return `<article class="kpi">
      <span class="kpi__label">${k.label}</span>
      <span class="kpi__value">${k.show(me)}</span>
      ${k.note(me) ? `<span class="kpi__delta ${lead}">${k.note(me)}</span>` : ''}
      <span class="kpi__opp"><i class="swatch swatch--opp"></i>${esc(op.code)} <b>${k.show(op)}</b></span>
    </article>`;
  }).join('');
}

function buildTeamSwitch() {
  const box = $('[data-team-seg]');
  box.innerHTML = state.data.teams.map((t, i) => `<button type="button" data-value="${i}" aria-pressed="${String(i === state.team)}" aria-label="View as ${esc(t.name)}">${esc(t.code)}</button>`).join('');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || Number(b.dataset.value) === state.team) return;
    state.team = Number(b.dataset.value);
    state.player = 'all';
    box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderAll(true);
  });
}

// ---------------------------------------------------------------- video and timeline
function playText(p) {
  if (p.type === 'pass') return { kind: 'Pass', detail: `${p.from} → ${p.to}` };
  if (p.type === 'interception') return { kind: 'Interception', detail: `${p.player} won it from ${p.from}` };
  const what = p.kind === 'free_throw' ? 'Free throw' : p.made ? (p.points === 3 ? '3-pointer made' : `${p.points || ''}${p.points ? '-pointer' : 'Shot'} made`) : (p.value === 3 ? '3-point miss' : 'Shot missed');
  return { kind: what, detail: `${p.player}${p.distance_m ? ` · ${one.format(p.distance_m)} m from the basket` : ''}` };
}

function allPlays() {
  const shots = state.data.shots.map((s) => ({ ...s, type: 'shot' }));
  return [...state.data.plays, ...shots].sort((a, b) => a.t - b.t);
}

function renderTimeline() {
  const d = state.data;
  const box = $('[data-timeline]');
  const tip = $('[data-timeline-tip]');
  box.querySelector('svg')?.remove();
  const W = Math.max(Math.round(box.clientWidth) || 800, 300);
  const left = 96; const right = 12; const H = 150;
  const dur = d.clip.duration_s;
  const x = (t) => left + ((W - left - right) * t) / dur;
  const lanes = { shot: 24, interception: 58, pass: 92, control: 124 };
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Timeline of the clip: shots, interceptions, passes and ball control' });
  box.prepend(svg);
  [['Shots', lanes.shot], ['Interceptions', lanes.interception], ['Passes', lanes.pass], ['Ball control', lanes.control]].forEach(([name, y]) => {
    const t = svgEl('text', { class: 'axis-text', x: 0, y: y + 4 }, svg); t.textContent = name;
    svgEl('line', { class: 'gridline', x1: left, x2: W - right, y1: y, y2: y }, svg);
  });
  for (let s = 0; s <= dur; s += dur > 90 ? 20 : 10) {
    const t = svgEl('text', { class: 'axis-text', x: x(s), y: H - 2, 'text-anchor': 'middle' }, svg); t.textContent = clock(s);
  }
  d.possession.forEach((seg) => {
    if (seg.team === null) return;
    svgEl('rect', { class: `ctrl ctrl--${role(seg.team)}`, x: x(seg.t0), y: lanes.control - 7, width: Math.max(x(seg.t1) - x(seg.t0), 1), height: 14 }, svg);
  });
  const head = svgEl('line', { class: 'playhead', x1: left, x2: left, y1: 8, y2: lanes.control + 10 }, svg);

  allPlays().forEach((p) => {
    const cx = x(p.t);
    const g = svgEl('g', { class: `mark mark--${role(p.team)}`, tabindex: '0', role: 'button' }, svg);
    const text = playText(p);
    g.setAttribute('aria-label', `${clock(p.t)} ${code(p.team)} ${text.kind}: ${text.detail}. Watch.`);
    if (p.type === 'shot') {
      const y = lanes.shot;
      svgEl('circle', { class: 'mark__hit', cx, cy: y, r: 14 }, g);
      if (p.made) svgEl('circle', { class: 'mark__dot', cx, cy: y, r: 7 }, g);
      else svgEl('path', { class: 'mark__x', d: `M${cx - 5} ${y - 5}l10 10m0-10l-10 10` }, g);
    } else if (p.type === 'interception') {
      const y = lanes.interception;
      svgEl('circle', { class: 'mark__hit', cx, cy: y, r: 14 }, g);
      svgEl('path', { class: 'mark__dot', d: `M${cx} ${y - 7}l7 7-7 7-7-7z` }, g);
    } else {
      const y = lanes.pass;
      svgEl('rect', { class: 'mark__hit', x: cx - 6, y: y - 12, width: 12, height: 24 }, g);
      svgEl('rect', { class: 'mark__dot', x: cx - 2, y: y - 8, width: 4, height: 16, rx: 2 }, g);
    }
    const show = () => {
      tip.innerHTML = `<b>${clock(p.t)} · ${esc(code(p.team))} ${esc(text.kind)}</b><span>${esc(text.detail)}</span>`;
      tip.hidden = false;
      const scale = svg.getBoundingClientRect().width / W;
      placeTip(tip, box, cx * scale, (lanes[p.type] - 10) * scale);
    };
    const hide = () => { tip.hidden = true; };
    g.addEventListener('pointerenter', show); g.addEventListener('pointerleave', hide);
    g.addEventListener('focus', show); g.addEventListener('blur', hide);
    g.addEventListener('click', () => watch(p.t));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); watch(p.t); } });
  });

  // clicking empty timeline space also jumps there
  svg.addEventListener('click', (e) => {
    if (e.target.closest('.mark')) return;
    const r = svg.getBoundingClientRect();
    const t = (((e.clientX - r.left) * (W / r.width)) - left) / (W - left - right) * dur;
    if (t >= 0 && t <= dur) { $('[data-video]').currentTime = t; }
  });
  const v = $('[data-video]');
  const move = () => { const px = x(Math.min(v.currentTime || 0, dur)); head.setAttribute('x1', px); head.setAttribute('x2', px); };
  v.ontimeupdate = move;
  move();

  $('[data-timeline-legend]').innerHTML = `<span><i class="swatch swatch--team"></i>${esc(code(mine()))}</span><span><i class="swatch swatch--opp"></i>${esc(code(theirs()))}</span><span><i class="dot dot--grey"></i>Made</span><span><i class="cross"></i>Missed</span>`;

  // key moments: every shot and interception as a button
  const keys = allPlays().filter((p) => p.type !== 'pass');
  $('[data-moments]').innerHTML = keys.map((p) => {
    const text = playText(p);
    return `<button class="moment moment--${role(p.team)}" type="button" data-t="${p.t}"><span class="moment__t">${clock(p.t)}</span><b>${esc(code(p.team))} · ${esc(text.kind)}</b><span>${esc(text.detail)}</span></button>`;
  }).join('');
}

// ---------------------------------------------------------------- shot chart (FIBA half court, 1 m = 100 units)
const ZONES = ['Paint', 'Mid-range', 'Corner 3', 'Above-break 3'];
const toCourt = (s) => ({ x: 750 + s.x * 100, y: s.y * 100 });

function shotTeams() {
  return state.shotTeam === 'mine' ? [mine()] : state.shotTeam === 'theirs' ? [theirs()] : [0, 1];
}
function filteredShots() {
  const teams = shotTeams();
  return state.data.shots.filter((s) => s.kind === 'field_goal' && teams.includes(s.team)
    && (state.player === 'all' || `${s.team}-${s.no}` === state.player)
    && (state.result === 'all' || (state.result === 'made') === s.made));
}

function buildShotFilters() {
  const seg = (name, options) => {
    $(`[data-seg="${name}"]`).innerHTML = options.map(([v, label, aria]) => `<button type="button" data-value="${v}" aria-pressed="${String(state[name] === v)}"${aria ? ` aria-label="${aria}"` : ''}>${label}</button>`).join('');
  };
  seg('shotTeam', [['mine', esc(code(mine())), `${code(mine())} shots`], ['theirs', esc(code(theirs())), `${code(theirs())} shots`], ['both', 'Both', 'Both teams']]);
  seg('result', [['all', 'All', 'All shots'], ['made', 'Made', 'Made shots'], ['missed', 'Missed', 'Missed shots']]);
  const teams = shotTeams();
  const ps = state.data.players.filter((p) => teams.includes(p.team));
  const select = $('[data-player-select]');
  select.innerHTML = `<option value="all">All players</option>${ps.map((p) => `<option value="${p.team}-${p.no}">${esc(code(p.team))} #${esc(p.no)}</option>`).join('')}`;
  if (state.player !== 'all' && !ps.some((p) => `${p.team}-${p.no}` === state.player)) state.player = 'all';
  select.value = state.player;
}

function renderShots(animate) {
  const layer = $('[data-shot-layer]');
  layer.replaceChildren();
  layer.classList.add('shot-layer');
  layer.classList.toggle('is-new', Boolean(animate) && !reduced);
  const all = filteredShots();
  const placed = all.filter((s) => s.x !== null);
  $('[data-court]').classList.toggle('is-unmapped', !courtMapped());
  placed.forEach((s, i) => {
    const { x, y } = toCourt(s);
    const g = svgEl('g', { class: `shot shot--${role(s.team)} ${s.made ? 'shot--made' : 'shot--miss'}`, style: `--i: ${i}` }, layer);
    g.dataset.index = String(state.data.shots.indexOf(s));
    svgEl('circle', { class: 'shot__hit', cx: x, cy: y, r: 40 }, g);
    if (s.made) svgEl('circle', { class: 'shot__mark', cx: x, cy: y, r: 22 }, g);
    else svgEl('path', { class: 'shot__mark', d: `M${x - 18} ${y - 18}l36 36m0-36l-36 36` }, g);
  });
  if (!placed.length) {
    const t = svgEl('text', { class: 'empty-shots', x: 750, y: 760, 'text-anchor': 'middle' }, layer);
    t.textContent = 'No shots match these filters';
  }
  const made = all.filter((s) => s.made).length;
  const pts = all.reduce((a, s) => a + (s.made ? s.points || 0 : 0), 0);
  const who = state.player === 'all' ? (state.shotTeam === 'both' ? 'Both teams' : code(shotTeams()[0])) : `${code(Number(state.player[0]))} #${state.player.split('-')[1]}`;
  const summary = all.length ? `${who}: ${made} of ${all.length} made, ${pts} points` : `${who}: no shots`;
  $('[data-shot-summary]').textContent = summary;
  $('[data-court-desc]').textContent = `FIBA half court. ${summary}. The table beside it lists the same shots by zone.`;
  const rows = ZONES.map((z) => {
    const zs = all.filter((s) => s.zone === z);
    return { z, m: zs.filter((s) => s.made).length, a: zs.length, p: zs.reduce((a, s) => a + (s.made ? s.points || 0 : 0), 0) };
  });
  const best = Math.max(...rows.map((r) => r.p), 1);
  drawZones(rows);
  $('[data-zones]').innerHTML = rows.map((r) => `<tr data-zone="${r.z}">
      <th scope="row">${r.z}<span class="zone-bar" aria-hidden="true"><i style="width:${(r.p / best) * 100}%"></i></span></th>
      <td class="num">${r.m}/${r.a}${r.a ? `<span class="zone-pct">${pct.format(r.m / r.a)}</span>` : ''}</td><td class="num">${r.p}</td></tr>`).join('')
    + `<tr class="zones__total"><th scope="row">All shots</th><td class="num">${made}/${all.length}</td><td class="num">${pts}</td></tr>`;
  const unplaced = all.filter((s) => s.x === null);
  $('[data-shots-unplaced]').textContent = unplaced.length
    ? `${courtMapped() ? '' : `${NO_COURT} `}Not drawn, because the shooter's position could not be measured: ${unplaced.map((s) => `${clock(s.t)} ${s.player}, ${s.made ? (s.points ? `${s.points} points` : 'made, value unknown') : 'missed'}`).join('; ')}.`
    : '';
  document.querySelectorAll('[data-players] tr').forEach((tr) => tr.classList.toggle('is-picked', tr.dataset.key === state.player));
  document.querySelectorAll('[data-shots-for]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shotsFor === state.player)));
}

// Court areas shaded by how often shots there went in (the zones table holds the same information as text)
const ZONE_PATHS = {
  Paint: 'M505 0H995V580H505Z',
  'Mid-range': 'M90 0V299A675 675 0 0 0 1410 299V0ZM505 0H995V580H505Z',
  'Corner 3': 'M0 0H90V299H0ZM1410 0H1500V299H1410Z',
  'Above-break 3': 'M0 299H90V0H1410V299H1500V1050H0ZM90 0V299A675 675 0 0 0 1410 299V0Z',
};
const ZONE_LABEL = { Paint: [750, 430], 'Mid-range': [300, 330], 'Above-break 3': [210, 830] };
function drawZones(rows) {
  const layer = $('[data-zone-layer]');
  layer.replaceChildren();
  const tone = state.shotTeam === 'both' ? 'both' : role(shotTeams()[0]);
  rows.forEach((r) => {
    const share = r.a ? r.m / r.a : 0;
    const path = svgEl('path', { class: `zone zone--${tone}${r.a ? '' : ' is-empty'}`, d: ZONE_PATHS[r.z], 'fill-rule': 'evenodd',
      style: `fill-opacity:${r.a ? (0.12 + 0.5 * share).toFixed(2) : 0}` }, layer);
    path.dataset.zone = r.z;
    if (r.a && ZONE_LABEL[r.z]) {
      const [x, y] = ZONE_LABEL[r.z];
      const t = svgEl('text', { class: 'zone__label', x, y, 'text-anchor': 'middle' }, layer);
      t.textContent = `${r.m}/${r.a}`;
      const u = svgEl('text', { class: 'zone__pct', x, y: y + 46, 'text-anchor': 'middle' }, layer);
      u.textContent = pct.format(share);
    }
  });
  layer.dataset.rows = JSON.stringify(rows);
}

function wireShots() {
  const court = $('[data-court]'); const tip = $('[data-tip]'); const svg = $('[data-court-svg]');
  const hotZone = (z) => $('[data-zone-layer]').querySelectorAll('.zone').forEach((q) => q.classList.toggle('is-hot', q.dataset.zone === z));
  svg.addEventListener('pointermove', (e) => {
    const g = e.target.closest('.shot');
    const zone = !g && e.target.closest('.zone');
    hotZone(zone ? zone.dataset.zone : null);
    if (zone) {
      const r = JSON.parse($('[data-zone-layer]').dataset.rows).find((x) => x.z === zone.dataset.zone);
      tip.innerHTML = `<b>${esc(r.z)}</b><span>${r.a ? `${r.m} of ${r.a} made (${pct.format(r.m / r.a)}), ${r.p} points` : 'No shots from here'}</span>`;
      const box = svg.getBoundingClientRect();
      placeTip(tip, court, e.clientX - box.left, e.clientY - box.top);
      tip.hidden = false;
      return;
    }
    if (!g) { tip.hidden = true; return; }
    const s = state.data.shots[Number(g.dataset.index)];
    const value = s.made ? `${s.points} points` : `${s.value || 2}-point attempt`;
    tip.innerHTML = `<b>${esc(s.player)} · ${s.made ? 'Made' : 'Missed'}</b><span>${s.zone}, ${one.format(s.distance_m)} m · ${clock(s.t)} · ${value}${s.near_line ? ' · close to the line' : ''}</span>`;
    const scale = svg.getBoundingClientRect().width / 1500;
    const { x, y } = toCourt(s);
    placeTip(tip, court, x * scale, y * scale);
    tip.hidden = false;
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; hotZone(null); });
  $('[data-zones]').addEventListener('pointerover', (e) => hotZone(e.target.closest('tr')?.dataset.zone || null));
  $('[data-zones]').addEventListener('pointerleave', () => hotZone(null));
  svg.addEventListener('click', (e) => { const g = e.target.closest('.shot'); if (g) watch(state.data.shots[Number(g.dataset.index)].t); });
  $('[data-player-select]').addEventListener('change', (e) => { state.player = e.target.value; writeUrl(); renderShots(true); });
  ['shotTeam', 'result'].forEach((name) => $(`[data-seg="${name}"]`).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state[name] = b.dataset.value;
    if (name === 'shotTeam') { state.player = 'all'; buildShotFilters(); }
    $(`[data-seg="${name}"]`).querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.value === state[name])));
    writeUrl();
    renderShots(true);
  }));
}

function showPlayerShots(key) {
  state.shotTeam = Number(key[0]) === mine() ? 'mine' : 'theirs';
  state.player = state.player === key ? 'all' : key;
  buildShotFilters();
  writeUrl();
  renderShots(true);
  if (state.player !== 'all') $('#shots').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- players
const COLS = [
  { key: 'no', label: 'Player', sort: (p) => Number(p.no) || 999, left: true },
  { key: 'seconds', label: 'TIME', title: 'Time seen on court', sort: (p) => p.seconds },
  { key: 'pts', label: 'PTS', title: 'Points', sort: (p) => p.pts },
  { key: 'fg', label: 'FG', title: 'Field goals made of attempted', sort: (p) => p.fgm * 100 + p.fga },
  { key: 'tp', label: '3P', title: 'Three-pointers made of attempted', sort: (p) => p.tpm * 100 + p.tpa },
  { key: 'passes', label: 'PASS', title: 'Passes made', sort: (p) => p.passes },
  { key: 'received', label: 'REC', title: 'Passes received', sort: (p) => p.received },
  { key: 'int', label: 'INT', title: 'Interceptions', sort: (p) => p.int },
  { key: 'ball_s', label: 'BALL', title: 'Seconds with the ball', sort: (p) => p.ball_s },
  { key: 'distance_m', label: 'DIST', title: 'Metres covered', sort: (p) => p.distance_m },
  { key: 'top_kmh', label: 'TOP', title: 'Top speed in km/h', sort: (p) => p.top_kmh || 0 },
];

function renderPlayers() {
  const team = mine();
  $('[data-players-title]').textContent = `Players: ${state.data.teams[team].name}`;
  const arrow = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8 1 2h8z"/></svg>';
  $('[data-players-head]').innerHTML = `<tr>${COLS.map((c) => `<th scope="col" class="${c.left ? '' : 'num'}"${state.sort.key === c.key ? ` aria-sort="${state.sort.dir}"` : ''}${c.title ? ` title="${c.title}"` : ''}><button class="sort" type="button" data-sort="${c.key}" aria-label="Sort by ${c.title ? c.title.toLowerCase() : 'jersey number'}">${c.label}${arrow}</button></th>`).join('')}<th scope="col"><span class="visually-hidden">Views</span></th></tr>`;
  const col = COLS.find((c) => c.key === state.sort.key);
  const dir = state.sort.dir === 'ascending' ? 1 : -1;
  const rows = state.data.players.filter((p) => p.team === team).sort((a, b) => (col.sort(a) - col.sort(b)) * dir || b.pts - a.pts);
  const u = state.data.teams[team].unidentified || {};
  const cell = (v, fmt = (x) => x) => (v === null || v === undefined ? '–' : fmt(v));
  $('[data-players]').innerHTML = rows.map((p) => {
    const key = `${p.team}-${p.no}`;
    return `<tr data-key="${key}">
      <td class="who"><button class="who-btn" type="button" data-spot="${key}" aria-label="Open the spotlight for number ${esc(p.no)}"><b>No. ${esc(p.no)}</b><span>${esc(code(p.team))}</span></button></td>
      <td class="num">${clock(p.seconds)}</td><td class="num"><b>${p.pts}</b></td>
      <td class="num">${p.fgm}/${p.fga}</td><td class="num">${p.tpm}/${p.tpa}</td>
      <td class="num">${p.passes}</td><td class="num">${p.received}</td><td class="num">${p.int}</td>
      <td class="num">${cell(p.ball_s, (v) => `${one.format(v)} s`)}</td>
      <td class="num">${cell(p.distance_m, (v) => `${whole.format(v)} m`)}</td><td class="num">${cell(p.top_kmh, (v) => `${one.format(v)}`)}</td>
      <td class="views"><button class="mini-btn" type="button" data-shots-for="${key}" aria-pressed="false" aria-label="Show shots for number ${esc(p.no)}">Shots</button><button class="mini-btn" type="button" data-map-for="${key}" aria-label="Show where number ${esc(p.no)} moved">Map</button></td>
    </tr>`;
  }).join('') + (u.seconds ? `<tr class="row--muted">
      <td class="who"><b>Not identified</b><span>Number not readable</span></td>
      <td class="num">${clock(u.seconds)}</td><td class="num">${u.pts || 0}</td><td class="num">${u.fgm || 0}/${u.fga || 0}</td><td class="num">${u.tpm || 0}/${u.tpa || 0}</td>
      <td class="num">${u.passes || 0}</td><td class="num">${u.received || 0}</td><td class="num">${u.int || 0}</td>
      <td class="num">${one.format(u.ball_s || 0)} s</td><td class="num">${courtMapped() ? `${whole.format(u.distance_m || 0)} m` : '–'}</td><td class="num">–</td><td></td></tr>` : '');
  renderShots(false);
}

function wirePlayers() {
  $('[data-players-head]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const key = b.dataset.sort;
    state.sort = state.sort.key === key ? { key, dir: state.sort.dir === 'descending' ? 'ascending' : 'descending' }
      : { key, dir: key === 'no' ? 'ascending' : 'descending' };
    renderPlayers();
    $(`[data-sort="${key}"]`).focus();
  });
  $('[data-players]').addEventListener('click', (e) => {
    const s = e.target.closest('[data-shots-for]');
    if (s) showPlayerShots(s.dataset.shotsFor);
    const m = e.target.closest('[data-map-for]');
    if (m) { state.heat = m.dataset.mapFor; $('[data-heat-select]').value = state.heat; renderHeat(); $('#movement').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }
  });
}

// ---------------------------------------------------------------- full court drawing (metres, 1 m = 100 units)
function drawFullCourt(svg) {
  const g = svgEl('g', { class: 'fc' }, svg);
  svgEl('rect', { class: 'fc__floor', width: 2800, height: 1500, rx: 8 }, g);
  const arc = (side) => {
    const bx = side ? 2800 - 157.5 : 157.5; const s = side ? -1 : 1;
    return `M${side ? 2800 : 0} 90H${bx + s * 141.5}A675 675 0 0 ${side ? 0 : 1} ${bx + s * 141.5} 1410H${side ? 2800 : 0}`;
  };
  const d = [
    'M0 0H2800V1500H0Z', 'M1400 0V1500', 'M1220 750A180 180 0 0 0 1580 750A180 180 0 0 0 1220 750',
    'M0 505H580V995H0', 'M580 570A180 180 0 0 1 580 930', 'M2800 505H2220V995H2800', 'M2220 570A180 180 0 0 0 2220 930',
    arc(0), arc(1),
  ].join('');
  svgEl('path', { class: 'fc__line', d }, g);
  svgEl('circle', { class: 'fc__rim', cx: 157.5, cy: 750, r: 22.5 }, g);
  svgEl('circle', { class: 'fc__rim', cx: 2642.5, cy: 750, r: 22.5 }, g);
  return g;
}

// ---------------------------------------------------------------- heatmap
function buildHeatSelect() {
  const sel = $('[data-heat-select]');
  const opts = [['team', `${code(mine())}: whole team`], ['opp', `${code(theirs())}: whole team`],
    ...state.data.players.filter((p) => p.team === mine()).map((p) => [`${p.team}-${p.no}`, `${code(p.team)} #${p.no}`]),
    ...state.data.players.filter((p) => p.team === theirs()).map((p) => [`${p.team}-${p.no}`, `${code(p.team)} #${p.no}`])];
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  if (!opts.some(([v]) => v === state.heat)) state.heat = 'team';
  sel.value = state.heat;
}

const NO_COURT = 'The court could not be mapped automatically for this video, so speed, distance, heatmaps and shot positions are not available. Everything else on this page is measured.';
const courtMapped = () => state.data.court_mapped !== false;

function heatSvg(grid, team, ariaLabel) {
  const max = Math.max(...grid.flat(), 0.001);
  const svg = svgEl('svg', { viewBox: '-20 -20 2840 1540', role: 'img', 'aria-label': ariaLabel });
  drawFullCourt(svg);
  const cells = svgEl('g', { class: `heat__cells heat--${role(team)}` }, svg);
  grid.forEach((row, r) => row.forEach((v, c) => {
    if (v <= 0) return;
    const rect = svgEl('rect', { x: c * 100 + 4, y: r * 100 + 4, width: 92, height: 92, rx: 10, style: `opacity:${(0.18 + 0.82 * Math.sqrt(v / max)).toFixed(3)}` }, cells);
    rect.dataset.v = v; rect.dataset.c = c; rect.dataset.r = r;
  }));
  svgEl('path', { class: 'fc__line fc__line--top', d: 'M0 0H2800V1500H0Z' }, svg);
  return svg;
}

function renderHeat() {
  if (!courtMapped()) {
    $('[data-heat]').querySelector('svg')?.remove();
    $('[data-heat-sub]').textContent = NO_COURT;
    $('[data-heat-key]').innerHTML = '';
    $('[data-heat-select]').closest('.pick').hidden = true;
    return;
  }
  const d = state.data.heat;
  const box = $('[data-heat]');
  const tip = $('[data-heat-tip]');
  box.querySelector('svg')?.remove();
  let grid; let team; let label;
  if (state.heat === 'team' || state.heat === 'opp') {
    team = state.heat === 'team' ? mine() : theirs();
    grid = d.teams[team]; label = `${state.data.teams[team].name}, all players`;
  } else {
    team = Number(state.heat[0]); grid = d.players[state.heat] || [];
    label = `${code(team)} #${state.heat.split('-')[1]}`;
  }
  const total = grid.flat().reduce((a, v) => a + v, 0);
  const svg = heatSvg(grid, team, `Heatmap of where ${label} spent time on the court`);
  box.prepend(svg);
  svg.addEventListener('pointermove', (e) => {
    const rect = e.target.closest('rect[data-v]');
    if (!rect) { tip.hidden = true; return; }
    const v = Number(rect.dataset.v);
    tip.innerHTML = `<b>${one.format(v)} s here</b><span>${pct.format(v / total)} of ${esc(label)}'s time</span>`;
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / 2840;
    placeTip(tip, box, (Number(rect.dataset.c) * 100 + 70) * scale, (Number(rect.dataset.r) * 100 + 20) * scale);
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
  $('[data-heat-sub]').textContent = `${label}: time spent in each square metre of the court (${one.format(total)} s in total). Both ends of the court are shown, because teams attack and defend.`;
  $('[data-heat-key]').innerHTML = `<span>Less time</span><i class="ramp ramp--${role(team)}" aria-hidden="true"></i><span>More time</span>`;
}

// ---------------------------------------------------------------- distance and speed
function renderRuns(animate) {
  if (!courtMapped()) { $('[data-runs]').innerHTML = `<p class="fine">${NO_COURT}</p>`; return; }
  const ps = state.data.players.filter((p) => p.team === mine()).sort((a, b) => b.distance_m - a.distance_m);
  const max = Math.max(...ps.map((p) => p.distance_m), 1);
  const box = $('[data-runs]');
  box.classList.toggle('is-new', Boolean(animate) && !reduced);
  box.innerHTML = ps.map((p) => `<div class="run">
      <span class="run__no">#${esc(p.no)}</span>
      <div class="run__track" role="img" aria-label="Number ${esc(p.no)}: ${whole.format(p.distance_m)} metres, top speed ${p.top_kmh ? one.format(p.top_kmh) : 'unknown'} km/h">
        <span class="run__bar" style="width:${(p.distance_m / max) * 100}%"></span>
      </div>
      <span class="run__val"><b>${whole.format(p.distance_m)} m</b><span>${p.top_kmh ? `top ${one.format(p.top_kmh)} km/h` : 'top –'}</span></span>
    </div>`).join('');
}

// ---------------------------------------------------------------- ball control and tally
function renderControl(animate) {
  const me = state.data.teams[mine()]; const op = state.data.teams[theirs()];
  const box = $('[data-control]');
  box.classList.toggle('is-new', Boolean(animate) && !reduced);
  box.innerHTML = `<div class="control__nums"><span><b>${whole.format(me.ball_control_pct)}%</b> ${esc(me.code)}</span><span>${esc(op.code)} <b>${whole.format(op.ball_control_pct)}%</b></span></div>
    <div class="control__bar" role="img" aria-label="Ball control: ${esc(me.code)} ${whole.format(me.ball_control_pct)} percent, ${esc(op.code)} ${whole.format(op.ball_control_pct)} percent">
      <span class="control__me" style="width:${me.ball_control_pct}%"></span><span class="control__op" style="width:${op.ball_control_pct}%"></span>
    </div>`;
  const rows = [['Passes', 'passes'], ['Interceptions', 'interceptions'], ['Field goals made', 'fgm'], ['Three-pointers made', 'tpm'], ['Points in the clip', 'points'], ...(courtMapped() ? [['Distance (m)', 'distance_m']] : [])];
  $('[data-tally]').innerHTML = `<table class="table table--tally"><thead><tr><th scope="col"></th><th scope="col" class="num">${esc(me.code)}</th><th scope="col" class="num">${esc(op.code)}</th></tr></thead><tbody>${
    rows.map(([l, k]) => `<tr><th scope="row">${l}</th><td class="num${me[k] > op[k] ? ' is-lead' : ''}">${whole.format(me[k])}</td><td class="num${op[k] > me[k] ? ' is-lead' : ''}">${whole.format(op[k])}</td></tr>`).join('')}</tbody></table>
    <p class="fine">Ball holder known in ${whole.format(state.data.quality.ball_holder_known_pct)}% of frames; between holders the last team in control keeps it.</p>`;
}

// ---------------------------------------------------------------- players by key ("team-no") and label ("AUS #4")
const player = (key) => state.data.players.find((p) => `${p.team}-${p.no}` === key);
const labelOf = (p) => `${code(p.team)} #${p.no}`;
function keyOf(label) {
  const m = /^(\S+) #(\S+)$/.exec(label || '');
  if (!m) return null;
  const team = state.data.teams.findIndex((t) => t.code === m[1]);
  return team >= 0 && player(`${team}-${m[2]}`) ? `${team}-${m[2]}` : null;
}
// a player's name as a button that opens their spotlight (unknown players stay plain text)
const nameBtn = (label) => {
  const key = keyOf(label);
  return key ? `<button class="name-btn" type="button" data-spot="${key}">${esc(label)}</button>` : `<span class="name-unknown">${esc(label)}</span>`;
};
const people = (p) => (p.type === 'shot' ? [p.player] : p.type === 'pass' ? [p.from, p.to] : [p.player, p.from]);
const ICONS = {
  made: '<circle cx="12" cy="12" r="7"/><path d="M5 12h14M12 5c-2.5 2-2.5 12 0 14M12 5c2.5 2 2.5 12 0 14"/>',
  missed: '<path d="M7 7l10 10M17 7 7 17"/>',
  pass: '<path d="M4 12h15M14 7l5 5-5 5"/>',
  interception: '<path d="M12 4 20 12 12 20 4 12z"/><path d="M9 12h6"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const iconFor = (p) => (p.type === 'shot' ? (p.made ? 'made' : 'missed') : p.type);
function playDetail(p) {
  if (p.type === 'pass') return `${nameBtn(p.from)} <span aria-hidden="true">→</span><span class="visually-hidden">to</span> ${nameBtn(p.to)}`;
  if (p.type === 'interception') return `${nameBtn(p.player)} won it from ${nameBtn(p.from)}`;
  return `${nameBtn(p.player)}${p.distance_m ? `, ${one.format(p.distance_m)} m from the basket` : ''}`;
}

// ---------------------------------------------------------------- passing network
function renderNetwork() {
  const net = state.data.pass_network[mine()];
  const box = $('[data-net]');
  const tip = $('[data-net-tip]');
  box.querySelector('svg')?.remove();
  const W = Math.max(Math.round(box.clientWidth) || 420, 260); const H = Math.min(W, 400);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `Passing network of ${state.data.teams[mine()].name}` });
  box.prepend(svg);
  const defs = svgEl('defs', {}, svg);
  const mk = svgEl('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
  svgEl('path', { d: 'M0 0L10 5L0 10z', class: 'net__head' }, mk);
  const n = net.nodes.length;
  // involvement: passes made + received; bigger circle = more involved
  const inv = Object.fromEntries(net.nodes.map((no) => [no, { out: 0, in: 0 }]));
  net.edges.forEach((e) => { inv[e.from].out += e.count; inv[e.to].in += e.count; });
  const maxInv = Math.max(...net.nodes.map((no) => inv[no].out + inv[no].in), 1);
  const rad = (no) => 17 + 13 * Math.sqrt((inv[no].out + inv[no].in) / maxInv);
  const R = Math.min(W, H) / 2 - 46; const cx = W / 2; const cy = H / 2;
  const pos = Object.fromEntries(net.nodes.map((no, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
    return [no, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }];
  }));
  const maxC = Math.max(...net.edges.map((e) => e.count), 1);
  const edges = svgEl('g', {}, svg);
  net.edges.forEach((e) => {
    const a = pos[e.from]; const b = pos[e.to];
    const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len; const uy = dy / len;
    const sx = a.x + ux * rad(e.from); const sy = a.y + uy * rad(e.from); const ex = b.x - ux * (rad(e.to) + 4); const ey = b.y - uy * (rad(e.to) + 4);
    const bend = 26; const mx = (sx + ex) / 2 - uy * bend; const my = (sy + ey) / 2 + ux * bend;
    const g = svgEl('g', { class: 'net__edge', tabindex: '0' }, edges);
    g.dataset.from = e.from; g.dataset.to = e.to;
    g.setAttribute('aria-label', `Number ${e.from} to number ${e.to}: ${e.count} pass${e.count > 1 ? 'es' : ''}`);
    svgEl('path', { class: 'net__hit', d: `M${sx} ${sy}Q${mx} ${my} ${ex} ${ey}` }, g);
    svgEl('path', { class: `net__line net__line--${role(mine())}`, d: `M${sx} ${sy}Q${mx} ${my} ${ex} ${ey}`, 'stroke-width': 1.5 + (4.5 * e.count) / maxC, 'marker-end': 'url(#arrow)' }, g);
    const show = () => { tip.innerHTML = `<b>#${esc(e.from)} → #${esc(e.to)}</b><span>${e.count} pass${e.count > 1 ? 'es' : ''}</span>`; tip.hidden = false; const s = svg.getBoundingClientRect().width / W; placeTip(tip, box, mx * s, my * s); };
    g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
    g.addEventListener('pointerleave', () => { tip.hidden = true; }); g.addEventListener('blur', () => { tip.hidden = true; });
  });
  // hovering or focusing a player lights up only their passes
  const focus = (no) => {
    svg.classList.toggle('is-focus', no !== null);
    svg.querySelectorAll('.net__edge').forEach((g) => g.classList.toggle('is-on', no !== null && (g.dataset.from === no || g.dataset.to === no)));
    svg.querySelectorAll('.net__player').forEach((g) => {
      const other = g.dataset.no;
      const linked = no !== null && (other === no || net.edges.some((e) => (e.from === no && e.to === other) || (e.to === no && e.from === other)));
      g.classList.toggle('is-on', linked);
    });
  };
  net.nodes.forEach((no) => {
    const p = pos[no];
    const key = `${mine()}-${no}`;
    const g = svgEl('g', { class: 'net__player', tabindex: '0', role: 'button' }, svg);
    g.dataset.no = no;
    if (player(key)) g.dataset.spot = key;
    g.setAttribute('aria-label', `Number ${no}: ${inv[no].out} passes made, ${inv[no].in} received. Open the spotlight.`);
    svgEl('circle', { class: `net__node net__node--${role(mine())}`, cx: p.x, cy: p.y, r: rad(no) }, g);
    const t = svgEl('text', { class: 'net__no', x: p.x, y: p.y + 5, 'text-anchor': 'middle' }, g); t.textContent = no;
    const show = () => {
      focus(no);
      tip.innerHTML = `<b>#${esc(no)}</b><span>${inv[no].out} made, ${inv[no].in} received. Select for the spotlight.</span>`;
      tip.hidden = false;
      const s = svg.getBoundingClientRect().width / W; placeTip(tip, box, p.x * s, (p.y - rad(no)) * s);
    };
    const hide = () => { focus(null); tip.hidden = true; };
    g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
    g.addEventListener('pointerleave', hide); g.addEventListener('blur', hide);
    g.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && g.dataset.spot) { e.preventDefault(); openSpot(g.dataset.spot); } });
  });
  if (!n) { const t = svgEl('text', { class: 'empty-shots', x: W / 2, y: H / 2, 'text-anchor': 'middle' }, svg); t.textContent = 'No passes between identified players'; }
  const total = net.edges.reduce((a, e) => a + e.count, 0);
  $('[data-net-sub]').textContent = `${state.data.teams[mine()].name}: ${total} passes between identified players. Bigger circles were more involved; point at a player to see only their passes.`;
  $('[data-pairs]').innerHTML = net.edges.slice(0, 6).map((e) => `<tr><th scope="row">#${esc(e.from)} → #${esc(e.to)}</th><td class="num">${e.count}</td></tr>`).join('');
}

// ---------------------------------------------------------------- all plays: a compact feed with filters
const FEED_FIRST = 12;
const KINDS = [['all', 'All'], ['shot', 'Shots'], ['pass', 'Passes'], ['interception', 'Interceptions']];

function feedPlays() {
  const team = state.playTeam === 'both' ? null : state.playTeam === 'mine' ? mine() : theirs();
  const find = state.find.replace(/[^0-9a-z]/gi, '');
  return allPlays().filter((p) => (team === null || p.team === team)
    && (!find || people(p).some((l) => (l || '').split('#')[1] === find)));
}

function renderPlays() {
  const base = feedPlays();
  const count = (k) => (k === 'all' ? base.length : base.filter((p) => p.type === k).length);
  $('[data-seg="playKind"]').innerHTML = KINDS.map(([v, l]) => `<button type="button" data-value="${v}" aria-pressed="${String(state.playKind === v)}">${l}<span class="count">${count(v)}</span></button>`).join('');
  $('[data-seg="playTeam"]').innerHTML = [['both', 'Both'], ['mine', esc(code(mine()))], ['theirs', esc(code(theirs()))]]
    .map(([v, l]) => `<button type="button" data-value="${v}" aria-pressed="${String(state.playTeam === v)}">${l}</button>`).join('');
  const list = base.filter((p) => state.playKind === 'all' || p.type === state.playKind);
  const shown = state.feedAll ? list : list.slice(0, FEED_FIRST);
  $('[data-plays]').innerHTML = shown.length ? shown.map((p) => {
    const text = playText(p);
    return `<li class="feed__item feed__item--${role(p.team)}">
      <button class="feed__t" type="button" data-t="${p.t}" aria-label="Watch ${clock(p.t)}"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z"/></svg>${clock(p.t)}</button>
      <span class="feed__ic feed__ic--${iconFor(p)}">${icon(iconFor(p))}</span>
      <div class="feed__text"><b>${esc(text.kind)}<span class="feed__team">${esc(code(p.team))}</span></b><span>${playDetail(p)}</span></div>
    </li>`;
  }).join('') : `<li class="feed__none">No plays match. ${state.find ? `Nobody with number ${esc(state.find)} ${state.playKind === 'all' ? 'made a play' : 'made one of these'}.` : ''}</li>`;
  const more = $('[data-feed-more]');
  more.hidden = list.length <= FEED_FIRST;
  more.textContent = state.feedAll ? 'Show fewer' : `Show all ${list.length} plays`;
  more.setAttribute('aria-expanded', String(state.feedAll));
  const q = state.data.quality;
  $('[data-about]').innerHTML = `<h3>About these numbers</h3><ul>${[
    `Jersey numbers are known for ${whole.format(q.players_with_number_pct)}% of the time players are on court; the rest is listed as "Not identified".`,
    ...q.notes.filter((t) => !/confirm/i.test(t))].map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function wireFeed() {
  ['playKind', 'playTeam'].forEach((name) => $(`[data-seg="${name}"]`).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { state[name] = b.dataset.value; renderPlays(); }
  }));
  $('[data-feed-find]').addEventListener('input', (e) => { state.find = e.target.value.trim(); renderPlays(); });
  $('[data-feed-more]').addEventListener('click', () => { state.feedAll = !state.feedAll; renderPlays(); });
  $('[data-plays]').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) watch(Number(b.dataset.t)); });
}

// ---------------------------------------------------------------- player spotlight
const ORD = ['1st', '2nd', '3rd'];
function rankLine(p, get, higherIsBetter = true) {
  const team = state.data.players.filter((x) => x.team === p.team && get(x) !== null && get(x) !== undefined);
  if (get(p) === null || get(p) === undefined || !get(p)) return '';
  const sorted = [...team].sort((a, b) => (get(b) - get(a)) * (higherIsBetter ? 1 : -1));
  const i = sorted.findIndex((x) => x === p);
  if (i === 0) return `Most in ${code(p.team)}`;
  return `${ORD[i] || `${i + 1}th`} of ${sorted.length} in ${code(p.team)}`;
}

function spotShots(p) {
  const src = $('[data-court-svg]').cloneNode(true);
  src.removeAttribute('aria-labelledby');
  src.querySelectorAll('desc').forEach((d) => d.remove());
  src.querySelectorAll('[data-shot-layer], [data-zone-layer]').forEach((g) => g.replaceChildren());
  src.querySelectorAll('*').forEach((el) => [...el.attributes].forEach((a) => { if (a.name.startsWith('data-')) el.removeAttribute(a.name); }));
  [...src.attributes].forEach((a) => { if (a.name.startsWith('data-')) src.removeAttribute(a.name); });
  const shots = state.data.shots.filter((s) => s.team === p.team && s.no === p.no && s.kind === 'field_goal');
  const placed = shots.filter((s) => s.x !== null);
  src.setAttribute('role', 'img');
  src.setAttribute('aria-label', `Shots by ${labelOf(p)}: ${shots.filter((s) => s.made).length} of ${shots.length} made`);
  const layer = svgEl('g', {}, src);
  placed.forEach((s) => {
    const { x, y } = toCourt(s);
    const g = svgEl('g', { class: `shot shot--${role(s.team)} ${s.made ? 'shot--made' : 'shot--miss'}` }, layer);
    if (s.made) svgEl('circle', { class: 'shot__mark', cx: x, cy: y, r: 26 }, g);
    else svgEl('path', { class: 'shot__mark', d: `M${x - 20} ${y - 20}l40 40m0-40l-40 40` }, g);
  });
  return { svg: src, shots, placed };
}

function speedChart(p, key) {
  const pts = (state.data.speed || {})[key] || [];
  if (pts.length < 2) return null;
  const W = 640; const H = 170; const L = 40; const R = 10; const T = 14; const B = 26;
  const dur = state.data.clip.duration_s;
  const top = Math.max(20, ...pts.map((q) => q[1]));
  const x = (t) => L + ((W - L - R) * t) / dur;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Speed of ${labelOf(p)} through the clip, top ${one.format(p.top_kmh || 0)} km/h. Select a moment to watch it.` });
  [0, 10, 20, 30].filter((v) => v <= top).forEach((v) => {
    svgEl('line', { class: 'gridline', x1: L, x2: W - R, y1: y(v), y2: y(v) }, svg);
    const t = svgEl('text', { class: 'axis-text', x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg); t.textContent = v;
  });
  for (let s = 0; s <= dur; s += dur > 90 ? 30 : 15) {
    const t = svgEl('text', { class: 'axis-text', x: x(s), y: H - 6, 'text-anchor': 'middle' }, svg); t.textContent = clock(s);
  }
  // break the line where the player was off screen for more than 2 s
  const runs = [[]];
  pts.forEach((q, i) => { if (i && q[0] - pts[i - 1][0] > 2) runs.push([]); runs[runs.length - 1].push(q); });
  runs.filter((r) => r.length > 1).forEach((r) => {
    const line = r.map((q) => `${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join(' ');
    svgEl('polygon', { class: `speed__area speed--${role(p.team)}`, points: `${x(r[0][0])},${y(0)} ${line} ${x(r[r.length - 1][0])},${y(0)}` }, svg);
    svgEl('polyline', { class: `speed__line speed--${role(p.team)}`, points: line }, svg);
  });
  const best = pts.reduce((a, q) => (q[1] > a[1] ? q : a));
  svgEl('circle', { class: `speed__top speed--${role(p.team)}`, cx: x(best[0]), cy: y(best[1]), r: 5 }, svg);
  const lab = svgEl('text', { class: 'speed__label', x: Math.min(x(best[0]) + 9, W - 120), y: Math.max(y(best[1]) - 8, 12) }, svg);
  lab.textContent = `${one.format(best[1])} km/h at ${clock(best[0])}`;
  const head = svgEl('line', { class: 'speed__cursor', x1: 0, x2: 0, y1: T, y2: H - B }, svg);
  head.style.display = 'none';
  svg.dataset.dur = dur; svg.dataset.l = L; svg.dataset.r = R; svg.dataset.w = W;
  return { svg, pts, x, head };
}

function spotProfile(key) {
  const r = state.ins.rows.find((x) => x.key === key);
  const prof = state.ins.profiles[key];
  if (!r || !prof.eligible) return `<section class="spot__part"><h3>Performance profile</h3><p class="fine">${esc(prof ? prof.note : 'No profile for this player.')}</p></section>`;
  return `<section class="spot__part" aria-labelledby="spot-prof-h">
      <h3 id="spot-prof-h">Performance profile</h3>
      <p class="prof-summary">${esc(prof.summary)}</p>
      ${ppiCard(r)}
      ${radarSvg([{ name: r.label, tone: role(r.team), values: radarValues(r) }, { name: `${code(r.team)} average`, tone: 'avg', values: teamAverageValues(state.ins.rows, r.team, r) }], `Profile of ${r.label} against the team average`)}
      ${insightLists(prof)}
    </section>
    <section class="spot__part" aria-labelledby="spot-adv-h">
      <h3 id="spot-adv-h">Advanced stats</h3>
      ${advancedStats(r, state.ins.mapped)}
    </section>`;
}

function spotHtml(p, key, mates) {
  const i = mates.indexOf(key);
  const prev = mates[(i - 1 + mates.length) % mates.length]; const next = mates[(i + 1) % mates.length];
  const mapped = courtMapped();
  const stats = [
    ['Points', p.pts, rankLine(p, (x) => x.pts)],
    ['Field goals', `${p.fgm}/${p.fga}`, p.fga ? `${pct.format(p.fgm / p.fga)} made` : 'No shots'],
    ['Three-pointers', `${p.tpm}/${p.tpa}`, p.tpa ? `${pct.format(p.tpm / p.tpa)} made` : 'No attempts'],
    ['Passes made', p.passes, rankLine(p, (x) => x.passes)],
    ['Passes received', p.received, rankLine(p, (x) => x.received)],
    ['Interceptions', p.int, rankLine(p, (x) => x.int)],
    ['With the ball', p.ball_s === null ? '–' : `${one.format(p.ball_s)} s`, rankLine(p, (x) => x.ball_s)],
    ...(mapped ? [['Distance', `${whole.format(p.distance_m)} m`, rankLine(p, (x) => x.distance_m)],
      ['Top speed', p.top_kmh ? `${one.format(p.top_kmh)} km/h` : '–', rankLine(p, (x) => x.top_kmh)]] : []),
  ];
  const label = labelOf(p);
  const passesTo = {}; const passesFrom = {};
  state.data.plays.filter((q) => q.type === 'pass').forEach((q) => {
    if (q.from === label) passesTo[q.to] = (passesTo[q.to] || 0) + 1;
    if (q.to === label) passesFrom[q.from] = (passesFrom[q.from] || 0) + 1;
  });
  const top3 = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const pairList = (o, none) => (top3(o).length ? `<ul class="spot__pairs">${top3(o).map(([who, c]) => `<li>${nameBtn(who)}<b>${c}</b></li>`).join('')}</ul>` : `<p class="fine">${none}</p>`);
  const moments = allPlays().filter((q) => people(q).includes(label));
  return `
    <header class="spot__head spot--${role(p.team)}">
      <span class="spot__no" aria-hidden="true">${esc(p.no)}</span>
      <div class="spot__who">
        <h2 id="spot-h">${esc(state.data.teams[p.team].name)}, number&nbsp;${esc(p.no)}</h2>
        <p>${p.pts} point${p.pts === 1 ? "" : "s"} · ${p.passes} pass${p.passes === 1 ? "" : "es"} · ${clock(p.seconds)} on court</p>
      </div>
      <div class="spot__nav">
        <button class="spot__btn" type="button" data-spot="${prev}" aria-label="Previous player: number ${esc(player(prev).no)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
        <button class="spot__btn" type="button" data-spot="${next}" aria-label="Next player: number ${esc(player(next).no)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
        <button class="spot__btn" type="button" data-spot-close aria-label="Close the spotlight" autofocus><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
    </header>
    <dl class="spot__stats">${stats.map(([l, v, r]) => `<div><dt>${l}</dt><dd>${v}</dd>${r ? `<span>${esc(r)}</span>` : ''}</div>`).join('')}</dl>
    ${spotProfile(key)}
    <section class="spot__part" aria-labelledby="spot-shots-h">
      <h3 id="spot-shots-h">Shots</h3>
      <div class="spot__court" data-spot-court></div>
      <p class="fine" data-spot-shot-note></p>
    </section>
    ${mapped ? `<section class="spot__part" aria-labelledby="spot-speed-h">
      <h3 id="spot-speed-h">Speed through the clip</h3>
      <div class="spot__speed" data-spot-speed><div class="tip" data-spot-tip role="tooltip" hidden></div></div>
      <p class="fine">Select a moment on the line to watch it. Gaps are times the player was off screen.</p>
    </section>
    <section class="spot__part" aria-labelledby="spot-heat-h">
      <h3 id="spot-heat-h">Where they played</h3>
      <div class="spot__heat" data-spot-heat></div>
    </section>` : `<p class="fine">${NO_COURT}</p>`}
    <section class="spot__part spot__passing" aria-labelledby="spot-pass-h">
      <h3 id="spot-pass-h" class="visually-hidden">Passing</h3>
      <div><h4>Passed most to</h4>${pairList(passesTo, 'No passes to identified team-mates.')}</div>
      <div><h4>Received most from</h4>${pairList(passesFrom, 'No passes from identified team-mates.')}</div>
    </section>
    <section class="spot__part" aria-labelledby="spot-moments-h">
      <h3 id="spot-moments-h">Every moment (${moments.length})</h3>
      <ol class="feed feed--spot">${moments.map((q) => `<li class="feed__item feed__item--${role(q.team)}">
        <button class="feed__t" type="button" data-spot-watch="${q.t}" aria-label="Watch ${clock(q.t)}"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z"/></svg>${clock(q.t)}</button>
        <span class="feed__ic feed__ic--${iconFor(q)}">${icon(iconFor(q))}</span>
        <div class="feed__text"><b>${esc(playText(q).kind)}</b><span>${playDetail(q)}</span></div></li>`).join('') || '<li class="feed__none">No plays found for this player.</li>'}</ol>
    </section>`;
}

function openSpot(key) {
  const p = player(key);
  if (!p) return;
  const dialog = $('[data-spot-dialog]');
  const mates = state.data.players.filter((x) => x.team === p.team).sort((a, b) => Number(a.no) - Number(b.no)).map((x) => `${x.team}-${x.no}`);
  const body = $('[data-spot-body]');
  body.innerHTML = spotHtml(p, key, mates);
  const { svg, shots, placed } = spotShots(p);
  $('[data-spot-court]', body).append(svg);
  const made = shots.filter((s) => s.made).length;
  $('[data-spot-shot-note]', body).textContent = shots.length
    ? `${made} of ${shots.length} made, ${shots.reduce((a, s) => a + (s.made ? s.points || 0 : 0), 0)} points.${shots.length > placed.length ? ` ${shots.length - placed.length} not drawn: the position could not be measured.` : ''}`
    : 'No shots in this clip.';
  if (courtMapped()) {
    const grid = state.data.heat.players[key];
    if (grid) $('[data-spot-heat]', body).append(heatSvg(grid, p.team, `Where number ${p.no} spent time on the court`));
    else $('[data-spot-heat]', body).innerHTML = '<p class="fine">No court positions for this player.</p>';
    const chart = speedChart(p, key);
    const box = $('[data-spot-speed]', body);
    if (!chart) box.innerHTML = '<p class="fine">Not enough speed readings for this player.</p>';
    else {
      box.prepend(chart.svg);
      const tip = $('[data-spot-tip]', body);
      const at = (e) => {
        const r = chart.svg.getBoundingClientRect(); const W = Number(chart.svg.dataset.w);
        const ux = ((e.clientX - r.left) * W) / r.width;
        const t = ((ux - Number(chart.svg.dataset.l)) / (W - Number(chart.svg.dataset.l) - Number(chart.svg.dataset.r))) * state.data.clip.duration_s;
        const q = chart.pts.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a));
        return { q, r, W };
      };
      chart.svg.addEventListener('pointermove', (e) => {
        const { q, r, W } = at(e);
        const px = chart.x(q[0]);
        chart.head.setAttribute('x1', px); chart.head.setAttribute('x2', px); chart.head.style.display = '';
        tip.innerHTML = `<b>${clock(q[0])}</b><span>${one.format(q[1])} km/h</span>`;
        tip.hidden = false;
        placeTip(tip, box, (px * r.width) / W, 24);
      });
      chart.svg.addEventListener('pointerleave', () => { tip.hidden = true; chart.head.style.display = 'none'; });
      chart.svg.addEventListener('click', (e) => { dialog.close(); watch(at(e).q[0]); });
    }
  }
  state.spot = key;
  writeUrl();
  if (!dialog.open) dialog.showModal();
  else $('[data-spot-close]', body).focus();
  body.scrollTop = 0;
}

function wireSpot() {
  const dialog = $('[data-spot-dialog]');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-spot]');
    if (b && b.dataset.spot) { e.preventDefault(); openSpot(b.dataset.spot); }
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-spot-close]')) dialog.close();
    const w = e.target.closest('[data-spot-watch]');
    if (w) { dialog.close(); watch(Number(w.dataset.spotWatch)); }
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    const nav = dialog.querySelectorAll('.spot__nav [data-spot]');
    if (e.key === 'ArrowLeft' && nav[0]) { e.preventDefault(); openSpot(nav[0].dataset.spot); }
    if (e.key === 'ArrowRight' && nav[1]) { e.preventDefault(); openSpot(nav[1].dataset.spot); }
  });
  dialog.addEventListener('close', () => { state.spot = null; writeUrl(); });
}

// ---------------------------------------------------------------- match report (insights.js)
function renderReport() {
  const { report } = state.ins;
  $('[data-leaders]').innerHTML = report.leaders.map((l) => `<button class="leader leader--${role(l.team)}" type="button" data-spot="${l.key}">
      <span class="leader__title">${esc(l.title)}</span><b>${esc(l.label)}</b><span class="leader__ev">${esc(l.evidence)}</span></button>`).join('')
    || '<p class="fine">Not enough identified players for leaders in this clip.</p>';
  const [a, b] = [report.teams[mine()], report.teams[theirs()]];
  const f = (v, kind) => (v === null || v === undefined ? '–' : kind === 'pct' ? `${Math.round(v * 100)}%` : kind === 'kmh' ? `${one.format(v)} km/h` : kind === 'm' ? `${whole.format(v)} m` : v);
  const rows = [
    ['Points', 'points'], ['Field goals', null, (t) => `${t.fgm}/${t.fga}`], ['eFG%', 'efg', null, 'pct'],
    ['Three-pointers', null, (t) => `${t.tpm}/${t.tpa}`], ['Ball control', 'possession', null, 'pct'],
    ['Passes', 'passes'], ['Assists', 'assists'], ['Lost to interceptions', 'turnovers', null, null, true],
    ['Shots from the paint', null, (t) => `${t.paintShots} of ${t.shots}`],
    ...(state.ins.mapped ? [['Distance (identified players)', 'distance', null, 'm'], ['Speed after winning the ball', 'transitionKmh', null, 'kmh'], ['Speed after losing the ball', 'recoveryKmh', null, 'kmh']] : []),
  ];
  $('[data-team-table]').innerHTML = `<thead><tr><th scope="col"></th><th scope="col" class="num"><i class="swatch swatch--team"></i> ${esc(a.code)}</th><th scope="col" class="num"><i class="swatch swatch--opp"></i> ${esc(b.code)}</th></tr></thead><tbody>${
    rows.map(([label, k, get, kind, lowerBetter]) => {
      const va = get ? get(a) : a[k]; const vb = get ? get(b) : b[k];
      const lead = (x, y) => (k && typeof x === 'number' && typeof y === 'number' && x !== y && (lowerBetter ? x < y : x > y) ? ' is-lead' : '');
      return `<tr><th scope="row">${label}</th><td class="num${lead(va, vb)}">${get ? va : f(va, kind)}</td><td class="num${lead(vb, va)}">${get ? vb : f(vb, kind)}</td></tr>`;
    }).join('')}</tbody>`;
  $('[data-observations]').innerHTML = (report.observations.length ? report.observations : ['No strong team pattern stands out in this short clip.']).map((o) => `<li>${esc(o)}</li>`).join('');
  $('[data-coach-team]').textContent = state.data.teams[mine()].name;
  $('[data-coaching]').innerHTML = report.coaching[mine()].map((o) => `<li>${esc(o)}</li>`).join('');
}

// ---------------------------------------------------------------- player ratings and comparison
function renderRatings() {
  const { eligible, rows, profiles } = state.ins;
  $('[data-seg="rateTeam"]').innerHTML = [['mine', esc(code(mine()))], ['theirs', esc(code(theirs()))], ['both', 'Both']]
    .map(([v, l]) => `<button type="button" data-value="${v}" aria-pressed="${String(state.rateTeam === v)}">${l}</button>`).join('');
  const teams = state.rateTeam === 'both' ? [0, 1] : [state.rateTeam === 'mine' ? mine() : theirs()];
  const list = eligible.filter((r) => teams.includes(r.team)).sort((x, y) => (y.ppi ?? -1) - (x.ppi ?? -1));
  const bar = (v) => `<span class="mini-score"><i style="width:${v ?? 0}%"></i></span><b>${v ?? 'n/a'}</b>`;
  $('[data-ratings]').innerHTML = list.map((r, i) => `<tr>
      <td class="who"><button class="who-btn" type="button" data-spot="${r.key}"><b>${i + 1}. No. ${esc(r.no)}</b><span><i class="swatch swatch--${role(r.team)}"></i> ${esc(code(r.team))} · ${clock(r.seconds)}</span></button></td>
      <td><div class="ppi-cell">${bar(r.ppi)}</div></td>
      <td class="num">${r.areas.offense ?? 'n/a'}</td><td class="num">${r.areas.defense ?? 'n/a'}</td><td class="num">${r.areas.physical ?? 'n/a'}</td><td class="num">${r.areas.playmaking ?? 'n/a'}</td>
      <td class="muted">${esc(profiles[r.key].strengths[0]?.title || '–')}</td></tr>`).join('')
    + rows.filter((r) => !r.pct && teams.includes(r.team)).map((r) => `<tr class="row--muted"><td class="who"><b>No. ${esc(r.no)}</b><span>${esc(code(r.team))} · ${clock(r.seconds)}</span></td><td colspan="6">On court too briefly for a rating (minimum ${30} s)</td></tr>`).join('');
  // comparison
  const opts = eligible.slice().sort((x, y) => x.team - y.team || Number(x.no) - Number(y.no));
  if (!state.cmpA || !opts.some((r) => r.key === state.cmpA)) state.cmpA = eligible.filter((r) => r.team === mine()).sort((x, y) => y.ppi - x.ppi)[0]?.key || null;
  if (!state.cmpB || !opts.some((r) => r.key === state.cmpB)) state.cmpB = eligible.filter((r) => r.team === theirs()).sort((x, y) => y.ppi - x.ppi)[0]?.key || null;
  ['a', 'b'].forEach((slot) => {
    const sel = $(`[data-cmp="${slot}"]`);
    sel.innerHTML = opts.map((r) => `<option value="${r.key}">${esc(r.label)} (PPI ${r.ppi ?? '–'})</option>`).join('');
    sel.value = slot === 'a' ? state.cmpA : state.cmpB;
  });
  renderCompare();
  $('[data-method]').innerHTML = methodNote(state.ins.mapped);
}

function renderCompare() {
  const box = $('[data-compare]');
  const A = state.ins.eligible.find((r) => r.key === state.cmpA); const B = state.ins.eligible.find((r) => r.key === state.cmpB);
  if (!A || !B) { box.innerHTML = '<p class="fine">Not enough identified players to compare.</p>'; return; }
  const metrics = [
    ['PPI', (r) => r.ppi], ['Points', (r) => r.pts], ['eFG%', (r) => (r.efg === null ? null : Math.round(r.efg * 100)), '%'],
    ['Passes', (r) => r.raw.passes], ['Assists', (r) => r.assists], ['Interceptions', (r) => r.raw.int],
    ...(state.ins.mapped ? [['Distance (m)', (r) => Math.round(r.raw.distance_m)], ['Top speed (km/h)', (r) => r.topKmh], ['Sprints', (r) => r.sprints]] : []),
  ];
  box.innerHTML = `<div class="compare__radar">${radarSvg([{ name: A.label, tone: 'team', values: radarValues(A) }, { name: B.label, tone: 'opp', values: radarValues(B) }], `Comparison of ${A.label} and ${B.label}`)}</div>
    <table class="table table--compare"><thead><tr><th scope="col"></th><th scope="col" class="num"><i class="radar-key radar-key--team"></i> ${esc(A.label)}</th><th scope="col" class="num"><i class="radar-key radar-key--opp"></i> ${esc(B.label)}</th></tr></thead><tbody>${
      metrics.map(([label, get, unit]) => { const a = get(A); const b = get(B); const lead = (x, y) => (x !== null && y !== null && x > y ? ' is-lead' : '');
        const show = (v) => (v === null || v === undefined ? '–' : `${typeof v === 'number' && !Number.isInteger(v) ? one.format(v) : v}${unit || ''}`);
        return `<tr><th scope="row">${label}</th><td class="num${lead(a, b)}">${show(a)}</td><td class="num${lead(b, a)}">${show(b)}</td></tr>`; }).join('')}</tbody></table>`;
}

function wireRatings() {
  $('[data-seg="rateTeam"]').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.rateTeam = b.dataset.value; renderRatings(); } });
  ['a', 'b'].forEach((slot) => $(`[data-cmp="${slot}"]`).addEventListener('change', (e) => { state[slot === 'a' ? 'cmpA' : 'cmpB'] = e.target.value; renderCompare(); }));
}

// ---------------------------------------------------------------- the whole page
function renderAll(animate) {
  document.title = `${state.data.teams[mine()].name} vs ${state.data.teams[theirs()].name}: ClutchMetrics coach dashboard`;
  renderOverview();
  renderTimeline();
  buildShotFilters();
  renderPlayers();
  renderShots(animate);
  buildHeatSelect();
  renderHeat();
  renderRuns(animate);
  renderControl(animate);
  renderNetwork();
  renderPlays();
  renderReport();
  renderRatings();
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

// The signed-in user's finished analyses (the server only returns their own); null when the server is offline
async function myAnalyses() {
  try {
    const res = await serverFetch('/api/jobs', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()).filter((j) => j.status === 'done');
  } catch { return null; }
}

// The match picker: only the signed-in user's own analyses
function buildMatchPicker(mine) {
  const select = $('[data-match-select]');
  select.innerHTML = (mine || []).map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join('');
  if (!state.match) select.insertAdjacentHTML('afterbegin', '<option value="" selected>No analysis yet</option>');
  select.value = state.match || '';
  select.addEventListener('change', () => {
    const p = new URLSearchParams();
    if (select.value) p.set('match', select.value);
    location.search = p.toString();
  });
}

// Nothing of the user's to show yet: hide the analysis sections, keep the upload section
function showEmpty(serverOffline) {
  ['#overview', '#report', '#video', '#shots', '#players', '#ratings', '#movement', '#ball', '#plays'].forEach((id) => {
    $(id).hidden = true;
    document.querySelector(`.side__nav a[href="${id}"]`)?.setAttribute('hidden', '');
  });
  const box = $('[data-empty]');
  box.querySelector('[data-empty-text]').textContent = serverOffline
    ? 'Your analyses are kept on the analysis server, which is offline right now. Please try again later.'
    : 'You have not analysed a game yet. Upload a game video below; when the analysis is ready it opens here. Only you can see your videos and results.';
  box.hidden = false;
  document.title = 'Your dashboard: ClutchMetrics';
}

async function start() {
  if (!document.querySelector('[data-dashboard]')) return;
  const url = readUrl();
  state.match = url.match && /^[a-f0-9]{12}$/.test(url.match) ? url.match : null;
  let mine = await myAnalyses();
  // server off: use the saved copies of this account's finished analyses, if any
  if (mine === null) { const saved = await savedCopies(); if (saved && saved.length) { mine = saved; state.saved = saved; } }
  // open the user's latest analysis when none is chosen; with none at all, show the empty state
  if (!state.match && mine && mine.length) state.match = mine[0].id;
  buildMatchPicker(mine);
  if (!state.match) { showEmpty(mine === null); return; }
  try {
    const copy = state.saved && state.saved.find((g) => g.id === state.match);
    const res = copy ? await fetch(`results/${copy.token}/match.json`, { cache: 'no-cache' })
      : state.match ? await serverFetch(`/api/jobs/${state.match}/match.json`, { cache: 'no-store' })
        : await fetch('data/match.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    state.data = await res.json();
    if (!state.data.teams?.length) throw new Error('no teams in the file');
  } catch (err) {
    const box = $('[data-load-error]');
    box.textContent = state.match
      ? `This uploaded match could not load (${err.message}). The analysis server may be offline, or this analysis belongs to another account.`
      : `The match data could not load (${err.message}). Check that data/match.json exists, and open the site through a web server, not by double-clicking the file.`;
    box.hidden = false;
    $('[data-title]').textContent = 'No match data';
    return;
  }
  const t = state.data.teams.findIndex((x) => x.code === url.team);
  Object.assign(state, { team: t >= 0 ? t : 0, player: url.player, result: url.result, shotTeam: ['mine', 'theirs', 'both'].includes(url.shotTeam) ? url.shotTeam : 'mine' });
  if (state.data.static_copy) {
    $('[data-video]').src = state.data.video;
    savedCopyNote($('.match-bar'));
  } else if (state.match) {
    // uploaded matches stream from the analysis server; load the video with the ngrok header
    serverVideoUrl(state.data.video).then((src) => { $('[data-video]').src = src; })
      .catch(() => { $('[data-video]').replaceWith(Object.assign(document.createElement('p'), { className: 'fine', textContent: 'The video could not load from the analysis server.' })); });
  } else {
    $('[data-video]').src = state.data.video;
  }
  buildTeamSwitch();
  wireShots();
  wirePlayers();
  $('[data-heat-select]').addEventListener('change', (e) => { state.heat = e.target.value; renderHeat(); });
  $('[data-moments]').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) watch(Number(b.dataset.t)); });
  state.ins = analyse(state.data);
  wireFeed();
  wireSpot();
  wireRatings();
  renderAll(true);
  if (url.spot && player(url.spot)) openSpot(url.spot);
  trackSections();
  let timer;
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => { renderTimeline(); renderNetwork(); }, 150); });
}

start();
