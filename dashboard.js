// ClutchMetrics coach dashboard. Reads data/match.json, written by the analysis model's exporter
// (format in data/MATCH_FORMAT.md), and draws every view from it. "Your team" and the shot filters live in
// the address, so a view can be shared or reloaded.

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

const state = { data: null, team: 0, shotTeam: 'mine', player: 'all', result: 'all', playKind: 'all', heat: 'team',
  sort: { key: 'pts', dir: 'descending' } };
const mine = () => state.team;
const theirs = () => 1 - state.team;
const role = (team) => (team === state.team ? 'team' : 'opp');
const code = (team) => state.data.teams[team].code;

// ---------------------------------------------------------------- the address
function readUrl() {
  const p = new URLSearchParams(location.search);
  return { team: p.get('team'), player: p.get('player') || 'all', result: p.get('result') || 'all', shotTeam: p.get('shots') || 'mine' };
}
function writeUrl() {
  const p = new URLSearchParams();
  p.set('team', code(state.team));
  if (state.shotTeam !== 'mine') p.set('shots', state.shotTeam);
  if (state.player !== 'all') p.set('player', state.player);
  if (state.result !== 'all') p.set('result', state.result);
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
  $('[data-clip]').textContent = `Analysed clip: ${clock(d.clip.duration_s)} of play (from ${clock(d.clip.source_start_s)} in the source video).`;

  const tv = d.tv_score.readings;
  const last = tv[tv.length - 1];
  $('[data-scorebox]').innerHTML = `
    <div class="scorebox__main" aria-label="Points scored in the clip: ${esc(me.code)} ${me.points}, ${esc(op.code)} ${op.points}">
      <span class="scorebox__team"><i class="swatch swatch--team"></i>${esc(me.code)}</span>
      <b>${me.points}<span>–</span>${op.points}</b>
      <span class="scorebox__team">${esc(op.code)}<i class="swatch swatch--opp"></i></span>
    </div>
    <span class="scorebox__note">Points in the clip${last ? ` · TV scoreboard at the end: ${esc(d.teams[0].code)} ${last[1]}–${last[2]} ${esc(d.teams[1].code)}` : ''}</span>`;

  const tiles = [
    { label: 'Points', a: me.points, b: op.points, show: (t) => whole.format(t.points),
      note: (t) => `${t.points_confirmed} confirmed by the TV scoreboard` },
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
      <span class="kpi__delta ${lead}">${k.note(me)}</span>
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
  const note = p.made && !p.confirmed ? ' (not confirmed)' : '';
  return { kind: what + note, detail: `${p.player}${p.distance_m ? ` · ${one.format(p.distance_m)} m from the basket` : ''}` };
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
      if (p.made) svgEl('circle', { class: `mark__dot${p.confirmed ? '' : ' is-open'}`, cx, cy: y, r: 7 }, g);
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

  $('[data-timeline-legend]').innerHTML = `<span><i class="swatch swatch--team"></i>${esc(code(mine()))}</span><span><i class="swatch swatch--opp"></i>${esc(code(theirs()))}</span><span><i class="dot dot--grey"></i>Made</span><span><i class="cross"></i>Missed</span><span><i class="ring ring--grey"></i>Made, not confirmed</span>`;

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
  placed.forEach((s, i) => {
    const { x, y } = toCourt(s);
    const g = svgEl('g', { class: `shot shot--${role(s.team)} ${s.made ? 'shot--made' : 'shot--miss'}${s.made && !s.confirmed ? ' is-open' : ''}`, style: `--i: ${i}` }, layer);
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
  $('[data-zones]').innerHTML = rows.map((r) => `<tr>
      <th scope="row">${r.z}<span class="zone-bar" aria-hidden="true"><i style="width:${(r.p / best) * 100}%"></i></span></th>
      <td class="num">${r.m}/${r.a}</td><td class="num">${r.p}</td></tr>`).join('')
    + `<tr class="zones__total"><th scope="row">All shots</th><td class="num">${made}/${all.length}</td><td class="num">${pts}</td></tr>`;
  const unplaced = all.filter((s) => s.x === null);
  $('[data-shots-unplaced]').textContent = unplaced.length
    ? `Not drawn, because the shooter's position could not be measured: ${unplaced.map((s) => `${clock(s.t)} ${s.player}, ${s.made ? `${s.points} points` : 'missed'}`).join('; ')}.`
    : '';
  document.querySelectorAll('[data-players] tr').forEach((tr) => tr.classList.toggle('is-picked', tr.dataset.key === state.player));
  document.querySelectorAll('[data-shots-for]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shotsFor === state.player)));
}

function wireShots() {
  const court = $('[data-court]'); const tip = $('[data-tip]'); const svg = $('[data-court-svg]');
  svg.addEventListener('pointermove', (e) => {
    const g = e.target.closest('.shot');
    if (!g) { tip.hidden = true; return; }
    const s = state.data.shots[Number(g.dataset.index)];
    const value = s.made ? `${s.points} points${s.confirmed ? ', confirmed by the TV scoreboard' : ', not confirmed'}` : `${s.value || 2}-point attempt`;
    tip.innerHTML = `<b>${esc(s.player)} · ${s.made ? 'Made' : 'Missed'}</b><span>${s.zone}, ${one.format(s.distance_m)} m · ${clock(s.t)} · ${value}${s.near_line ? ' · close to the line' : ''}</span>`;
    const scale = svg.getBoundingClientRect().width / 1500;
    const { x, y } = toCourt(s);
    placeTip(tip, court, x * scale, y * scale);
    tip.hidden = false;
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
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
      <td class="who"><b>No. ${esc(p.no)}</b><span>${esc(code(p.team))}</span></td>
      <td class="num">${clock(p.seconds)}</td><td class="num"><b>${p.pts}</b></td>
      <td class="num">${p.fgm}/${p.fga}</td><td class="num">${p.tpm}/${p.tpa}</td>
      <td class="num">${p.passes}</td><td class="num">${p.received}</td><td class="num">${p.int}</td>
      <td class="num">${cell(p.ball_s, (v) => `${one.format(v)} s`)}</td>
      <td class="num">${whole.format(p.distance_m)} m</td><td class="num">${cell(p.top_kmh, (v) => `${one.format(v)}`)}</td>
      <td class="views"><button class="mini-btn" type="button" data-shots-for="${key}" aria-pressed="false" aria-label="Show shots for number ${esc(p.no)}">Shots</button><button class="mini-btn" type="button" data-map-for="${key}" aria-label="Show where number ${esc(p.no)} moved">Map</button></td>
    </tr>`;
  }).join('') + (u.seconds ? `<tr class="row--muted">
      <td class="who"><b>Not identified</b><span>Number not readable</span></td>
      <td class="num">${clock(u.seconds)}</td><td class="num">${u.pts || 0}</td><td class="num">${u.fgm || 0}/${u.fga || 0}</td><td class="num">${u.tpm || 0}/${u.tpa || 0}</td>
      <td class="num">${u.passes || 0}</td><td class="num">${u.received || 0}</td><td class="num">${u.int || 0}</td>
      <td class="num">${one.format(u.ball_s || 0)} s</td><td class="num">${whole.format(u.distance_m || 0)} m</td><td class="num">–</td><td></td></tr>` : '');
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

function renderHeat() {
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
  const max = Math.max(...grid.flat(), 0.001);
  const total = grid.flat().reduce((a, v) => a + v, 0);
  const svg = svgEl('svg', { viewBox: '-20 -20 2840 1540', role: 'img', 'aria-label': `Heatmap of where ${label} spent time on the court` });
  box.prepend(svg);
  drawFullCourt(svg);
  const cells = svgEl('g', { class: `heat__cells heat--${role(team)}` }, svg);
  grid.forEach((row, r) => row.forEach((v, c) => {
    if (v <= 0) return;
    const rect = svgEl('rect', { x: c * 100 + 4, y: r * 100 + 4, width: 92, height: 92, rx: 10, style: `opacity:${(0.18 + 0.82 * Math.sqrt(v / max)).toFixed(3)}` }, cells);
    rect.dataset.v = v; rect.dataset.c = c; rect.dataset.r = r;
  }));
  svgEl('path', { class: 'fc__line fc__line--top', d: 'M0 0H2800V1500H0Z' }, svg);
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
  const rows = [['Passes', 'passes'], ['Interceptions', 'interceptions'], ['Field goals made', 'fgm'], ['Three-pointers made', 'tpm'], ['Points in the clip', 'points'], ['Distance (m)', 'distance_m']];
  $('[data-tally]').innerHTML = `<table class="table table--tally"><thead><tr><th scope="col"></th><th scope="col" class="num">${esc(me.code)}</th><th scope="col" class="num">${esc(op.code)}</th></tr></thead><tbody>${
    rows.map(([l, k]) => `<tr><th scope="row">${l}</th><td class="num${me[k] > op[k] ? ' is-lead' : ''}">${whole.format(me[k])}</td><td class="num${op[k] > me[k] ? ' is-lead' : ''}">${whole.format(op[k])}</td></tr>`).join('')}</tbody></table>
    <p class="fine">Ball holder known in ${whole.format(state.data.quality.ball_holder_known_pct)}% of frames; between holders the last team in control keeps it.</p>`;
}

// ---------------------------------------------------------------- passing network
function renderNetwork() {
  const net = state.data.pass_network[mine()];
  const box = $('[data-net]');
  const tip = $('[data-net-tip]');
  box.querySelector('svg')?.remove();
  const W = Math.max(Math.round(box.clientWidth) || 420, 260); const H = Math.min(W, 380);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `Passing network of ${state.data.teams[mine()].name}` });
  box.prepend(svg);
  const defs = svgEl('defs', {}, svg);
  const mk = svgEl('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
  svgEl('path', { d: 'M0 0L10 5L0 10z', class: 'net__head' }, mk);
  const n = net.nodes.length;
  const R = Math.min(W, H) / 2 - 40; const cx = W / 2; const cy = H / 2;
  const pos = Object.fromEntries(net.nodes.map((no, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
    return [no, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }];
  }));
  const maxC = Math.max(...net.edges.map((e) => e.count), 1);
  net.edges.forEach((e) => {
    const a = pos[e.from]; const b = pos[e.to];
    const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len; const uy = dy / len; const nr = 24;
    const sx = a.x + ux * nr; const sy = a.y + uy * nr; const ex = b.x - ux * (nr + 4); const ey = b.y - uy * (nr + 4);
    const bend = 26; const mx = (sx + ex) / 2 - uy * bend; const my = (sy + ey) / 2 + ux * bend;
    const g = svgEl('g', { class: 'net__edge', tabindex: '0' }, svg);
    g.setAttribute('aria-label', `Number ${e.from} to number ${e.to}: ${e.count} pass${e.count > 1 ? 'es' : ''}`);
    svgEl('path', { class: 'net__hit', d: `M${sx} ${sy}Q${mx} ${my} ${ex} ${ey}` }, g);
    svgEl('path', { class: `net__line net__line--${role(mine())}`, d: `M${sx} ${sy}Q${mx} ${my} ${ex} ${ey}`, 'stroke-width': 1.5 + (4.5 * e.count) / maxC, 'marker-end': 'url(#arrow)' }, g);
    const show = () => { tip.innerHTML = `<b>#${esc(e.from)} → #${esc(e.to)}</b><span>${e.count} pass${e.count > 1 ? 'es' : ''}</span>`; tip.hidden = false; const s = svg.getBoundingClientRect().width / W; placeTip(tip, box, mx * s, my * s); };
    g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
    g.addEventListener('pointerleave', () => { tip.hidden = true; }); g.addEventListener('blur', () => { tip.hidden = true; });
  });
  net.nodes.forEach((no) => {
    const p = pos[no];
    svgEl('circle', { class: `net__node net__node--${role(mine())}`, cx: p.x, cy: p.y, r: 22 }, svg);
    const t = svgEl('text', { class: 'net__no', x: p.x, y: p.y + 5, 'text-anchor': 'middle' }, svg); t.textContent = no;
  });
  if (!n) { const t = svgEl('text', { class: 'empty-shots', x: W / 2, y: H / 2, 'text-anchor': 'middle' }, svg); t.textContent = 'No passes between identified players'; }
  const total = net.edges.reduce((a, e) => a + e.count, 0);
  $('[data-net-sub]').textContent = `${state.data.teams[mine()].name}: ${total} passes between identified players. Thicker arrows mean more passes.`;
  $('[data-pairs]').innerHTML = net.edges.slice(0, 6).map((e) => `<tr><th scope="row">#${esc(e.from)} → #${esc(e.to)}</th><td class="num">${e.count}</td></tr>`).join('');
}

// ---------------------------------------------------------------- all plays
function renderPlays() {
  const kinds = { all: () => true, shot: (p) => p.type === 'shot', pass: (p) => p.type === 'pass', interception: (p) => p.type === 'interception' };
  $('[data-seg="playKind"]').innerHTML = [['all', 'All'], ['shot', 'Shots'], ['pass', 'Passes'], ['interception', 'Interceptions']]
    .map(([v, l]) => `<button type="button" data-value="${v}" aria-pressed="${String(state.playKind === v)}">${l}</button>`).join('');
  $('[data-plays]').innerHTML = allPlays().filter(kinds[state.playKind]).map((p) => {
    const text = playText(p);
    return `<tr><td><button class="mini-btn" type="button" data-t="${p.t}" aria-label="Watch ${clock(p.t)}">▶ ${clock(p.t)}</button></td>
      <td><i class="swatch swatch--${role(p.team)}"></i> ${esc(code(p.team))}</td><td>${esc(text.kind)}</td><td class="muted">${esc(text.detail)}</td></tr>`;
  }).join('');
  const q = state.data.quality;
  $('[data-about]').innerHTML = `<h3>About these numbers</h3><ul>${[
    `Jersey numbers are known for ${whole.format(q.players_with_number_pct)}% of the time players are on court; the rest is listed as "Not identified".`,
    ...q.notes].map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
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
    const res = await fetch('data/match.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    state.data = await res.json();
    if (!state.data.teams?.length) throw new Error('no teams in the file');
  } catch (err) {
    const box = $('[data-load-error]');
    box.textContent = `The match data could not load (${err.message}). Check that data/match.json exists, and open the site through a web server, not by double-clicking the file.`;
    box.hidden = false;
    $('[data-title]').textContent = 'No match data';
    return;
  }
  $('[data-sample]').hidden = !state.data.sample;
  const url = readUrl();
  const t = state.data.teams.findIndex((x) => x.code === url.team);
  Object.assign(state, { team: t >= 0 ? t : 0, player: url.player, result: url.result, shotTeam: ['mine', 'theirs', 'both'].includes(url.shotTeam) ? url.shotTeam : 'mine' });
  $('[data-video]').src = state.data.video;
  buildTeamSwitch();
  wireShots();
  wirePlayers();
  $('[data-heat-select]').addEventListener('change', (e) => { state.heat = e.target.value; renderHeat(); });
  $('[data-moments]').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) watch(Number(b.dataset.t)); });
  $('[data-plays]').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) watch(Number(b.dataset.t)); });
  $('[data-seg="playKind"]').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.playKind = b.dataset.value; renderPlays(); } });
  renderAll(true);
  trackSections();
  let timer;
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => { renderTimeline(); renderNetwork(); }, 150); });
}

start();
