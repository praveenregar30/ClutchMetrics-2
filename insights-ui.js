// Drawing the performance intelligence (insights.js) on the coach and player dashboards:
// radar chart, Player Performance Index card, strengths / weaknesses / improvements, advanced stats, zones, method.

import { AREAS, CONFIG, METRICS } from './insights.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
const one = (v) => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toString());
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const avg = (vals) => { const v = vals.filter((x) => x !== null && x !== undefined); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

// ---------------------------------------------------------------- radar
export const RADAR_AXES = [
  ['Scoring', (r) => r.pct.ptsPm],
  ['Shooting', (r) => r.pct.efg],
  ['Playmaking', (r) => r.areas.playmaking],
  ['Defense', (r) => r.areas.defense],
  ['Work rate', (r) => r.pct.distPm],
  ['Athleticism', (r) => avg([r.pct.topKmh, r.pct.sprintsPm, r.pct.accelPm])],
];

// series: [{ name, tone: 'team' | 'opp' | 'avg', values: [0..100 | null per axis] }]
export function radarSvg(series, title) {
  const R = 118; const n = RADAR_AXES.length;
  const at = (i, v) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [Math.cos(a) * R * v / 100, Math.sin(a) * R * v / 100]; };
  const rings = [25, 50, 75, 100].map((v) => `<polygon class="radar__ring" points="${RADAR_AXES.map((_, i) => at(i, v).join(',')).join(' ')}"/>`).join('');
  const spokes = RADAR_AXES.map((_, i) => `<line class="radar__spoke" x1="0" y1="0" x2="${at(i, 100)[0]}" y2="${at(i, 100)[1]}"/>`).join('');
  const labels = RADAR_AXES.map(([name], i) => {
    const [x, y] = at(i, 122);
    const anchor = Math.abs(x) < 8 ? 'middle' : x > 0 ? 'start' : 'end';
    const vals = series.map((s) => (s.values[i] === null ? 'n/a' : s.values[i])).join(' / ');
    return `<text class="radar__label" x="${x + (anchor === 'start' ? 6 : anchor === 'end' ? -6 : 0)}" y="${y + (y > 10 ? 16 : y < -10 ? -6 : 5)}" text-anchor="${anchor}">${name}<tspan class="radar__val" x="${x + (anchor === 'start' ? 6 : anchor === 'end' ? -6 : 0)}" dy="15">${vals}</tspan></text>`;
  }).join('');
  const shapes = series.map((s) => {
    const pts = s.values.map((v, i) => at(i, v ?? 0));
    return `<g class="radar__series radar--${s.tone}"><polygon points="${pts.map((p) => p.join(',')).join(' ')}"/>${
      pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4"><title>${esc(s.name)}, ${RADAR_AXES[i][0]}: ${s.values[i] ?? 'no data'}</title></circle>`).join('')}</g>`;
  }).join('');
  const aria = `${title}: ${series.map((s) => `${s.name}: ${RADAR_AXES.map(([name], i) => `${name} ${s.values[i] ?? 'no data'}`).join(', ')}`).join('; ')}`;
  return `<figure class="radar"><svg viewBox="-215 -170 430 345" role="img" aria-label="${esc(aria)}">${rings}${spokes}${shapes}${labels}</svg>
    ${series.length > 1 ? `<figcaption class="legend">${series.map((s) => `<span><i class="radar-key radar-key--${s.tone}"></i>${esc(s.name)}</span>`).join('')}</figcaption>` : ''}</figure>`;
}

export function radarValues(r) { return RADAR_AXES.map(([, get]) => get(r) ?? null); }

export function teamAverageValues(rows, team, except) {
  const mates = rows.filter((x) => x.team === team && x !== except && x.pct);
  return RADAR_AXES.map(([, get]) => avg(mates.map(get)));
}

// ---------------------------------------------------------------- PPI
export function ppiCard(r) {
  const tone = (v) => (v === null ? '' : v >= 67 ? 'is-high' : v <= 33 ? 'is-low' : '');
  return `<div class="ppi">
    <div class="ppi__main"><span class="ppi__label">Player Performance Index</span><b class="ppi__value ${tone(r.ppi)}">${r.ppi ?? '–'}</b><span class="ppi__of">/ 100</span></div>
    <div class="ppi__areas">${Object.entries(AREAS).map(([a, name]) => `<div class="ppi__area">
      <span>${name}</span><div class="ppi__bar" role="img" aria-label="${name} ${r.areas[a] ?? 'no data'} out of 100"><i style="width:${r.areas[a] ?? 0}%"></i></div><b>${r.areas[a] ?? 'n/a'}</b></div>`).join('')}</div>
  </div>`;
}

// ---------------------------------------------------------------- strengths and weaknesses
export function insightLists(p) {
  if (!p.eligible) return `<p class="fine">${esc(p.note)}</p>`;
  const list = (items, cls, none) => (items.length ? `<ul class="ins ins--${cls}">${items.map((i) => `<li><b>${esc(i.title)}</b><span>${esc(i.evidence)}</span></li>`).join('')}</ul>` : `<p class="fine">${none}</p>`);
  return `<div class="ins-grid">
    <section><h4 class="ins-h ins-h--good">Strengths</h4>${list(p.strengths, 'good', 'No standout strength in this clip.')}</section>
    <section><h4 class="ins-h ins-h--bad">Weaknesses</h4>${list(p.weaknesses, 'bad', 'No clear weakness in this clip.')}</section>
    <section><h4 class="ins-h">Areas for improvement</h4>${p.improvements.length ? `<ul class="ins ins--todo">${p.improvements.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="fine">Keep doing what works; review again after more games.</p>'}</section>
  </div>`;
}

// ---------------------------------------------------------------- advanced stats
export function advancedStats(r, mapped) {
  const groups = [
    ['Offense', [
      ['Points', r.pts], ['FG', `${r.fgm}/${r.fga}`], ['FG%', pct(r.fgPct)], ['eFG%', pct(r.efg), 'Effective FG%: (FGM + 0.5 × 3PM) / FGA'],
      ['3P', `${r.tpm}/${r.tpa}`], ['Ball time share', pct(r.ballShare)], ['Usage (simplified)', pct(r.usage), "Share of the team's shots, passes and lost balls"],
    ]],
    ['Playmaking', [
      ['Passes', r.raw.passes], ['Received', r.raw.received], ['Assists', r.assists, `Pass to an identified team-mate who scores within ${CONFIG.assistWindowS} s`],
      ['Lost to interception', r.turnovers], ['AST/TO', r.astTo === null ? (r.assists ? `${r.assists}/0` : '–') : one(r.astTo)], ['Different receivers', r.partners],
    ]],
    ['Defense', [
      ['Interceptions', r.raw.int], ['Metres on defence', r.defenceM === null ? '–' : Math.round(r.defenceM), 'Distance while the opponent had the ball'],
      ['Recovery speed', r.recoveryKmh === null ? '–' : `${one(r.recoveryKmh)} km/h`, `Average speed in the ${CONFIG.transitionWindowS} s after the team lost the ball`],
    ]],
    ...(mapped ? [['Physical', [
      ['Distance', `${Math.round(r.raw.distance_m)} m`], ['Per minute', r.distPm === null ? '–' : `${Math.round(r.distPm)} m`],
      ['Average speed', r.avgKmh ? `${one(r.avgKmh)} km/h` : '–'], ['Top speed', r.topKmh ? `${one(r.topKmh)} km/h` : '–'],
      ['Sprints', r.sprints ?? '–', `Rises above ${CONFIG.sprintKmh} km/h`], ['Sharp accel. / stops', r.accels === null ? '–' : `${r.accels} / ${r.decels}`, `At least ${CONFIG.accelMs2} m/s²`],
      ['Metres in attack', r.attackM === null ? '–' : Math.round(r.attackM)], ['Transition speed', r.transitionKmh === null ? '–' : `${one(r.transitionKmh)} km/h`, `Average speed in the ${CONFIG.transitionWindowS} s after the team won the ball`],
    ]]] : []),
  ];
  return `<div class="adv">${groups.map(([name, rows]) => `<section class="adv__group"><h4>${name}</h4><dl>${
    rows.map(([k, v, tip]) => `<div${tip ? ` title="${esc(tip)}"` : ''}><dt>${k}${tip ? '<i class="adv__q" aria-hidden="true">?</i>' : ''}</dt><dd>${v}</dd></div>`).join('')}</dl></section>`).join('')}
    ${r.zones ? zonesBar(r.zones) : ''}</div>`;
}

export function zonesBar(z) {
  const parts = [['Paint', z.paint, 'paint'], ['Mid-range', z.midrange, 'mid'], ['Perimeter', z.perimeter, 'per']];
  return `<section class="adv__group adv__zones"><h4>Time by court zone</h4>
    <div class="zbar" role="img" aria-label="Time by court zone: ${parts.map(([n, v]) => `${n} ${pct(v)}`).join(', ')}">${parts.map(([n, v, c]) => `<i class="zbar--${c}" style="width:${(v * 100).toFixed(1)}%" title="${n}: ${pct(v)}"></i>`).join('')}</div>
    <div class="legend">${parts.map(([n, v, c]) => `<span><i class="zkey zbar--${c}"></i>${n} <b>${pct(v)}</b></span>`).join('')}</div></section>`;
}

// ---------------------------------------------------------------- method
export function methodNote(mapped) {
  const w = Object.entries(CONFIG.weights).map(([a, v]) => `${AREAS[a]} ${Math.round(v * 100)}%`).join(', ');
  const byArea = Object.entries(AREAS).map(([a, name]) => `<li><b>${name}:</b> ${Object.values(METRICS).filter((m) => m.area === a).map((m) => m.name).join(', ')}</li>`).join('');
  return `<details class="method"><summary>How these scores are calculated</summary>
    <p>Every number comes from events the model detects in the video. Each metric is ranked against all players of <b>this game</b> who were on court at least ${CONFIG.minSeconds} s (per-minute rates, so playing time is fair), giving 0–100. An area score is the average of its metrics; the <b>Player Performance Index</b> is the weighted average of the areas: ${w}. Areas without data are left out, not guessed.</p>
    <ul>${byArea}</ul>
    <p>Reliability rules: shooting efficiency needs ${CONFIG.minShotsForEfficiency}+ shots; ball security needs ${CONFIG.minHandlingForSecurity}+ passes or lost balls; interceptions and assists are never called a weakness (too rare in short clips); weaknesses about involvement need 60 s on court.${mapped ? '' : ' This video has no court mapping, so physical metrics are not available.'}</p>
    <p>Not measured, because the model cannot detect them reliably yet: rebounds, free-throw attempts (so no TS%), steals versus intercepted passes, defensive assignments, and per-player offensive/defensive ratings. Scores describe this clip only, relative to the players in it.</p>
  </details>`;
}
