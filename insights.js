// ClutchMetrics performance intelligence: turns one game's match.json into player profiles, a Player Performance Index
// and evidence-based insights. Everything here is calculated from events the model really detects; nothing is guessed.
//
//   raw metrics      match.json (players, shots, plays, possession, speed, heat), written by the model
//   derived stats    derive():   eFG%, assists, turnovers, sprints, accelerations, attack/defence split, transitions...
//   scores           score():    percentile of each metric among the players of this game, grouped into 4 areas
//   insights         profile():  strengths, weaknesses and improvements, each with its evidence
//   match report     matchReport(): leaders, team comparison, tactical observations, coaching recommendations
//
// Limits (not computed, the model does not detect them): rebounds, free throws in short clips, steals vs intercepted
// passes, defensive assignments, TS%, per-player offensive/defensive rating.

export const CONFIG = {
  minSeconds: 30,            // on court at least this long to get a report
  minShotsForEfficiency: 3,  // shooting efficiency is judged only from this many attempts
  minHandlingForSecurity: 3, // ball security only from this many passes + turnovers
  sprintKmh: 18,             // a sprint starts when speed rises above this
  accelMs2: 2.5,             // a high acceleration / deceleration is at least this (m/s²)
  assistWindowS: 5,          // a pass is an assist when the receiver scores within this many seconds
  transitionWindowS: 4,      // seconds after a change of possession that count as transition
  // Player Performance Index: weighted mean of the area scores (re-weighted when an area has no data)
  weights: { offense: 0.30, defense: 0.20, physical: 0.25, playmaking: 0.25 },
};

const one = (v) => (Math.round(v * 10) / 10).toString();
const pctText = (v) => `${Math.round(v * 100)}%`;
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- derived stats per player
function possessionAt(match, t) {
  const seg = match.possession.find((s) => t >= s.t0 && t < s.t1);
  return seg ? seg.team : null;
}

function speedStats(series, team, match) {
  const out = { sprints: 0, accels: 0, decels: 0, attackM: 0, defenceM: 0, recoveryKmh: null, transitionKmh: null };
  if (!series || series.length < 2) return out;
  let above = series[0][1] >= CONFIG.sprintKmh;
  for (let i = 1; i < series.length; i += 1) {
    const [t0, v0] = series[i - 1]; const [t1, v1] = series[i];
    const dt = t1 - t0;
    if (dt <= 0 || dt > 1.01) { above = v1 >= CONFIG.sprintKmh; continue; }    // off screen in between
    if (!above && v1 >= CONFIG.sprintKmh) out.sprints += 1;
    above = v1 >= CONFIG.sprintKmh;
    const acc = (v1 - v0) / 3.6 / dt;
    if (acc >= CONFIG.accelMs2) out.accels += 1;
    if (acc <= -CONFIG.accelMs2) out.decels += 1;
    const metres = ((v0 + v1) / 2 / 3.6) * dt;
    const owner = possessionAt(match, t0);
    if (owner === team) out.attackM += metres;
    else if (owner === 1 - team) out.defenceM += metres;
  }
  // transitions: the seconds right after the ball changes team
  const changes = [];
  match.possession.forEach((s, i) => {
    const prev = match.possession.slice(0, i).reverse().find((x) => x.team !== null);
    if (s.team !== null && prev && prev.team !== s.team) changes.push({ t: s.t0, to: s.team });
  });
  const windowMean = (list) => {
    const v = series.filter(([t]) => list.some((c) => t >= c.t && t <= c.t + CONFIG.transitionWindowS)).map((q) => q[1]);
    return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  out.transitionKmh = windowMean(changes.filter((c) => c.to === team));        // own team just won the ball
  out.recoveryKmh = windowMean(changes.filter((c) => c.to === 1 - team));     // own team just lost it
  out.transitions = changes.length;
  return out;
}

function zoneShares(grid) {
  // time in each court zone, from the 1 m heat map; both ends count (teams attack and defend)
  if (!grid) return null;
  const z = { paint: 0, midrange: 0, perimeter: 0 };
  grid.forEach((row, r) => row.forEach((v, c) => {
    if (v <= 0) return;
    const x = c + 0.5; const y = r + 0.5;
    const bx = x < 14 ? 1.575 : 26.425;
    const d = Math.hypot(x - bx, y - 7.5);
    const inPaint = (x < 5.8 || x > 22.2) && y > 5.05 && y < 9.95;
    if (inPaint) z.paint += v; else if (d < 6.75) z.midrange += v; else z.perimeter += v;
  }));
  const total = z.paint + z.midrange + z.perimeter;
  return total ? { paint: z.paint / total, midrange: z.midrange / total, perimeter: z.perimeter / total } : null;
}

export function derive(match) {
  const mapped = match.court_mapped !== false;
  const label = (p) => `${match.teams[p.team].code} #${p.no}`;
  const passes = match.plays.filter((p) => p.type === 'pass');
  const made = match.shots.filter((s) => s.made && s.kind === 'field_goal');
  const teamTotals = [0, 1].map((t) => {
    const ps = match.players.filter((p) => p.team === t);
    return { ball: ps.reduce((a, p) => a + (p.ball_s || 0), 0) };
  });
  const rows = match.players.map((p) => {
    const me = label(p);
    const key = `${p.team}-${p.no}`;
    const minutes = p.seconds / 60;
    const myPasses = passes.filter((q) => q.from === me);
    // assist: a pass to an identified team-mate who scores within a few seconds, without passing again first
    const assists = myPasses.filter((q) => !q.to.includes('?') && made.some((s) => s.player === q.to && s.t > q.t && s.t <= q.t + CONFIG.assistWindowS
      && !passes.some((r) => r.from === q.to && r.t > q.t && r.t < s.t))).length;
    const turnovers = match.plays.filter((q) => q.type === 'interception' && q.from === me).length;
    const partners = new Set(myPasses.map((q) => q.to)).size;
    const shots = match.shots.filter((s) => s.kind === 'field_goal' && s.team === p.team && String(s.no) === String(p.no));
    const paintShots = shots.filter((s) => s.zone === 'Paint').length;
    const sp = mapped ? speedStats((match.speed || {})[key], p.team, match) : null;
    const handling = p.passes + turnovers;
    return {
      key, team: p.team, no: p.no, label: me, seconds: p.seconds, minutes,
      raw: p,
      pts: p.pts, fgm: p.fgm, fga: p.fga, tpm: p.tpm, tpa: p.tpa,
      efg: p.fga ? (p.fgm + 0.5 * p.tpm) / p.fga : null,
      fgPct: p.fga ? p.fgm / p.fga : null,
      assists, turnovers, partners, paintShots,
      astTo: turnovers ? assists / turnovers : null,
      security: handling >= CONFIG.minHandlingForSecurity ? p.passes / handling : null,
      ballShare: teamTotals[p.team].ball ? (p.ball_s || 0) / teamTotals[p.team].ball : null,
      ptsPm: minutes ? p.pts / minutes : 0,
      shotsPm: minutes ? p.fga / minutes : 0,
      passesPm: minutes ? p.passes / minutes : 0,
      receivedPm: minutes ? p.received / minutes : 0,
      intPm: minutes ? p.int / minutes : 0,
      distPm: mapped && minutes ? p.distance_m / minutes : null,
      topKmh: mapped ? p.top_kmh || null : null,
      avgKmh: mapped ? p.avg_kmh || null : null,
      sprints: sp ? sp.sprints : null,
      sprintsPm: sp && minutes ? sp.sprints / minutes : null,
      accels: sp ? sp.accels : null, decels: sp ? sp.decels : null,
      accelPm: sp && minutes ? (sp.accels + sp.decels) / minutes : null,
      attackM: sp ? sp.attackM : null, defenceM: sp ? sp.defenceM : null,
      defenceMpm: sp && minutes ? sp.defenceM / minutes : null,
      recoveryKmh: sp ? sp.recoveryKmh : null,
      transitionKmh: sp ? sp.transitionKmh : null,
      zones: mapped ? zoneShares((match.heat?.players || {})[key]) : null,
    };
  });
  // usage (simplified): share of the team's shots, passes and lost balls
  [0, 1].forEach((t) => {
    const team = rows.filter((r) => r.team === t);
    const total = team.reduce((a, r) => a + r.fga + r.raw.passes + r.turnovers, 0);
    team.forEach((r) => { r.usage = total ? (r.fga + r.raw.passes + r.turnovers) / total : null; });
  });
  return { rows, mapped };
}

// ---------------------------------------------------------------- scoring
// Each metric: area, how to read it, when it is reliable, and how to say it.
export const METRICS = {
  ptsPm: { area: 'offense', name: 'Scoring rate', unit: 'pts/min', fmt: (r) => `${r.pts} pts in ${clock(r.seconds)}` },
  efg: { area: 'offense', name: 'Effective FG%', unit: '', ok: (r) => r.fga >= CONFIG.minShotsForEfficiency, fmt: (r) => `${pctText(r.efg)} eFG% (${r.fgm}/${r.fga} FG, ${r.tpm} three${r.tpm === 1 ? '' : 's'})` },
  shotsPm: { area: 'offense', name: 'Shot creation', unit: 'FGA/min', fmt: (r) => `${r.fga} shot${r.fga === 1 ? '' : 's'} in ${clock(r.seconds)}` },
  ballShare: { area: 'offense', name: 'Ball time share', unit: '', fmt: (r) => `${pctText(r.ballShare)} of the team's ball time (${one(r.raw.ball_s || 0)} s)` },
  intPm: { area: 'defense', name: 'Interceptions', unit: '/min', fmt: (r) => `${r.raw.int} interception${r.raw.int === 1 ? '' : 's'}` },
  defenceMpm: { area: 'defense', name: 'Defensive work rate', unit: 'm/min', ok: (r) => r.defenceM !== null, fmt: (r) => `${Math.round(r.defenceM)} m covered while the opponent had the ball` },
  recoveryKmh: { area: 'defense', name: 'Defensive recovery', unit: 'km/h', ok: (r) => r.recoveryKmh !== null, fmt: (r) => `${one(r.recoveryKmh)} km/h in the ${CONFIG.transitionWindowS} s after losing the ball` },
  distPm: { area: 'physical', name: 'Work rate', unit: 'm/min', ok: (r) => r.distPm !== null, fmt: (r) => `${Math.round(r.raw.distance_m)} m covered (${Math.round(r.distPm)} m/min)` },
  topKmh: { area: 'physical', name: 'Top speed', unit: 'km/h', ok: (r) => r.topKmh !== null, fmt: (r) => `top speed ${one(r.topKmh)} km/h` },
  sprintsPm: { area: 'physical', name: 'Sprint frequency', unit: '/min', ok: (r) => r.sprints !== null, fmt: (r) => `${r.sprints} sprint${r.sprints === 1 ? '' : 's'} above ${CONFIG.sprintKmh} km/h` },
  accelPm: { area: 'physical', name: 'Explosiveness', unit: '/min', ok: (r) => r.accels !== null, fmt: (r) => `${r.accels + r.decels} sharp accelerations or stops` },
  transitionKmh: { area: 'physical', name: 'Transition speed', unit: 'km/h', ok: (r) => r.transitionKmh !== null, fmt: (r) => `${one(r.transitionKmh)} km/h in the ${CONFIG.transitionWindowS} s after winning the ball` },
  passesPm: { area: 'playmaking', name: 'Passing volume', unit: '/min', fmt: (r) => `${r.raw.passes} pass${r.raw.passes === 1 ? '' : 'es'} completed` },
  assists: { area: 'playmaking', name: 'Assists', unit: '', fmt: (r) => `${r.assists} assist${r.assists === 1 ? '' : 's'} (pass followed by the receiver's basket)` },
  receivedPm: { area: 'playmaking', name: 'Ball involvement', unit: '/min', fmt: (r) => `${r.raw.received} pass${r.raw.received === 1 ? '' : 'es'} received` },
  security: { area: 'playmaking', name: 'Ball security', unit: '', ok: (r) => r.security !== null, fmt: (r) => `${r.raw.passes} completed passes, ${r.turnovers} lost to an interception` },
  partners: { area: 'playmaking', name: 'Ball movement', unit: 'team-mates', fmt: (r) => `passed to ${r.partners} different team-mate${r.partners === 1 ? '' : 's'}` },
};
export const AREAS = { offense: 'Offense', defense: 'Defense', physical: 'Physical', playmaking: 'Playmaking' };

function percentile(value, values) {
  if (value === null || value === undefined || values.length < 2) return null;
  const below = values.filter((v) => v < value).length;
  const equal = values.filter((v) => v === value).length;
  return Math.round(((below + 0.5 * (equal - 1)) / (values.length - 1)) * 100);
}

export function score(match) {
  const { rows, mapped } = derive(match);
  const eligible = rows.filter((r) => r.seconds >= CONFIG.minSeconds);
  eligible.forEach((r) => { r.pct = {}; });
  Object.entries(METRICS).forEach(([m, def]) => {
    const ok = (r) => r[m] !== null && r[m] !== undefined && (!def.ok || def.ok(r));
    const values = eligible.filter(ok).map((r) => r[m]);
    eligible.forEach((r) => { r.pct[m] = ok(r) ? percentile(r[m], values) : null; });
  });
  eligible.forEach((r) => {
    r.areas = {};
    Object.keys(AREAS).forEach((a) => {
      const vals = Object.entries(METRICS).filter(([, d]) => d.area === a).map(([m]) => r.pct[m]).filter((v) => v !== null);
      r.areas[a] = vals.length ? Math.round(vals.reduce((x, y) => x + y, 0) / vals.length) : null;
    });
    let sum = 0; let w = 0;
    Object.entries(CONFIG.weights).forEach(([a, wt]) => { if (r.areas[a] !== null) { sum += r.areas[a] * wt; w += wt; } });
    r.ppi = w ? Math.round(sum / w) : null;
  });
  return { rows, eligible, mapped };
}

// ---------------------------------------------------------------- strengths, weaknesses, improvements
const IMPROVE = {
  ptsPm: 'Look for more scoring chances: attack closeouts and finish plays you start.',
  efg: 'Improve shot selection: take more shots from the paint or open, set threes.',
  shotsPm: 'Be more aggressive looking for your own shot when the defence sags off.',
  ballShare: 'Demand the ball more: move to open spaces and show for the pass.',
  intPm: 'Read passing lanes: stay between your man and the ball to create interceptions.',
  defenceMpm: 'Raise defensive work rate: keep moving with the ball and help team-mates on defence.',
  recoveryKmh: 'Sprint back on defence the moment the ball is lost.',
  distPm: 'Increase work rate: keep moving off the ball instead of standing.',
  topKmh: 'Work on top speed: short sprint drills (10–20 m).',
  sprintsPm: 'Use more sprints to beat defenders in transition and on cuts.',
  accelPm: 'Work on explosive starts and stops (change-of-pace drills).',
  transitionKmh: 'Run the floor faster after your team wins the ball.',
  passesPm: 'Move the ball more: make the extra pass instead of holding it.',
  assists: 'Look for team-mates in scoring positions after drawing the defence.',
  receivedPm: 'Get more involved: cut and screen to get open for passes.',
  security: 'Protect the ball: make safer passes and avoid passing into traffic.',
  partners: 'Spread the ball: pass to more different team-mates, not only one.',
};
const STRONG = {
  ptsPm: 'Scoring contribution', efg: 'Efficient shooting', shotsPm: 'Shot creation', ballShare: 'Primary ball handler',
  intPm: 'Active hands on defence', defenceMpm: 'Defensive work rate', recoveryKmh: 'Fast defensive recovery',
  distPm: 'High work rate', topKmh: 'Top-end speed', sprintsPm: 'Frequent sprinting', accelPm: 'Explosive movement',
  transitionKmh: 'Runs the floor in transition', passesPm: 'Keeps the ball moving', assists: 'Creates baskets for others',
  receivedPm: 'Always available for the ball', security: 'Secure with the ball', partners: 'Spreads the ball around',
};
const WEAK = {
  ptsPm: 'Limited scoring contribution', efg: 'Low shooting efficiency', shotsPm: 'Few shot attempts', ballShare: 'Rarely has the ball',
  intPm: 'Few defensive disruptions', defenceMpm: 'Low defensive work rate', recoveryKmh: 'Slow defensive recovery',
  distPm: 'Low work rate', topKmh: 'Lower top speed', sprintsPm: 'Few sprints', accelPm: 'Few explosive movements',
  transitionKmh: 'Slow in transition', passesPm: 'Little ball movement', assists: 'No assists created',
  receivedPm: 'Rarely involved in passing', security: 'Loses the ball under pressure', partners: 'Passes to few team-mates',
};
// a weakness is only stated when there was enough playing time / data for it to mean something
const WEAK_OK = {
  ptsPm: (r) => r.seconds >= 60, shotsPm: (r) => r.seconds >= 60, ballShare: (r) => r.seconds >= 60,
  intPm: () => false,                       // interceptions are rare in short clips: never called a weakness
  security: (r) => r.turnovers >= 2,        // one lost ball is not a pattern
  assists: () => false,                     // same for assists
  passesPm: (r) => r.seconds >= 60, receivedPm: (r) => r.seconds >= 60, partners: (r) => r.raw.passes >= 3,
  topKmh: (r) => r.seconds >= 45,
};

export function profile(r, scored) {
  if (!r.pct) {
    return { eligible: false, note: `On court only ${clock(r.seconds)}: not enough time for a report (minimum ${CONFIG.minSeconds} s).` };
  }
  const ord = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
  const rankText = (m) => {
    const all = scored.eligible.filter((x) => x.pct[m] !== null);
    const rank = all.filter((x) => x[m] > r[m]).length + 1;
    const team = all.filter((x) => x.team === r.team);
    const best = team.length > 1 && team.every((x) => x === r || x[m] < r[m]);
    return `ranks ${ord(rank)} of ${all.length} players in this game${best ? ', best in the team' : ''}`;
  };
  const items = Object.entries(METRICS).filter(([m]) => r.pct[m] !== null).map(([m, d]) => ({ m, d, pct: r.pct[m] }));
  const strengths = items.filter((i) => i.pct >= 75 && r[i.m] > 0).sort((a, b) => b.pct - a.pct).slice(0, 3)
    .map((i) => ({ metric: i.m, title: STRONG[i.m], evidence: `${i.d.fmt(r)}: ${rankText(i.m)}` }));
  const weaknesses = items.filter((i) => i.pct <= 25 && (!WEAK_OK[i.m] || WEAK_OK[i.m](r))).sort((a, b) => a.pct - b.pct).slice(0, 3)
    .map((i) => ({ metric: i.m, title: WEAK[i.m], evidence: `${i.d.fmt(r)}: ${rankText(i.m)}` }));
  const improvements = weaknesses.map((w) => IMPROVE[w.metric]);
  return { eligible: true, strengths, weaknesses, improvements, summary: summaryOf(r, strengths, weaknesses) };
}

function summaryOf(r, strengths, weaknesses) {
  const areas = Object.entries(r.areas).filter(([, v]) => v !== null).sort((a, b) => b[1] - a[1]);
  if (!areas.length) return '';
  const best = AREAS[areas[0][0]].toLowerCase();
  const role = r.ballShare !== null && r.ballShare >= 0.35 ? 'a main ball handler' : r.fga >= 2 ? 'a scoring option'
    : r.raw.passes + r.raw.received >= 5 ? 'a connector in ball movement' : 'a role player';
  let s = `${r.label} played ${clock(r.seconds)} as ${role}; strongest area: ${best} (${areas[0][1]}/100).`;
  if (strengths[0]) s += ` Stands out for ${strengths[0].title.toLowerCase()}.`;
  if (weaknesses[0]) s += ` Main thing to work on: ${weaknesses[0].title.toLowerCase()}.`;
  return s;
}

// ---------------------------------------------------------------- the whole game
export function analyse(match) {
  const scored = score(match);
  const profiles = Object.fromEntries(scored.rows.map((r) => [r.key, profile(r, scored)]));
  return { ...scored, profiles, report: matchReport(match, scored) };
}

function leader(rows, m, minimum = 0) {
  const ok = rows.filter((r) => r[m] !== null && r[m] !== undefined && r[m] > minimum);
  return ok.length ? ok.reduce((a, b) => (b[m] > a[m] ? b : a)) : null;
}

export function matchReport(match, scored) {
  const { eligible, rows, mapped } = scored;
  const T = match.teams;
  const leaders = [];
  const add = (title, r, evidence) => { if (r) leaders.push({ title, key: r.key, label: r.label, team: r.team, evidence }); };
  const off = eligible.filter((r) => r.areas.offense !== null).sort((a, b) => b.areas.offense - a.areas.offense)[0];
  add('Highest offensive contribution', off, off && `${off.pts} pts, ${off.fgm}/${off.fga} FG, offense ${off.areas.offense}/100`);
  const dist = leader(eligible, 'distPm');
  if (mapped) {
    const far = rows.reduce((a, b) => ((b.raw.distance_m || 0) > (a.raw.distance_m || 0) ? b : a));
    if (far.raw.distance_m) add('Covered the most ground', far, `${Math.round(far.raw.distance_m)} m in ${clock(far.seconds)} on court`);
  }
  const def = eligible.filter((r) => r.areas.defense !== null).sort((a, b) => b.areas.defense - a.areas.defense)[0];
  add('Strongest defensive involvement', def, def && `${def.raw.int} interception${def.raw.int === 1 ? '' : 's'}${def.defenceM !== null ? `, ${Math.round(def.defenceM)} m on defence` : ''}, defense ${def.areas.defense}/100`);
  const tr = leader(eligible, 'transitionKmh');
  add('Most active in transition', tr, tr && `${one(tr.transitionKmh)} km/h after winning the ball`);
  const mover = leader(rows, 'passesPm');
  add('Main ball mover', mover, mover && `${mover.raw.passes} passes to ${mover.partners} team-mates`);
  const maker = leader(rows, 'assists');
  add('Top playmaker', maker, maker && `${maker.assists} assist${maker.assists === 1 ? '' : 's'}`);
  if (dist && !leaders.some((l) => l.title === 'Highest work rate')) add('Highest work rate', dist, `${Math.round(dist.distPm)} m per minute on court`);

  const teams = [0, 1].map((t) => {
    const tr2 = rows.filter((r) => r.team === t);
    const tm = T[t];
    const passes = tr2.reduce((a, r) => a + r.raw.passes, 0);
    const top = tr2.reduce((a, r) => (r.raw.passes > (a ? a.raw.passes : -1) ? r : a), null);
    const shots = match.shots.filter((s) => s.team === t && s.kind === 'field_goal');
    const turnovers = match.plays.filter((p) => p.type === 'interception' && p.team === 1 - t).length;
    const rec = tr2.filter((r) => r.recoveryKmh !== null);
    const trn = tr2.filter((r) => r.transitionKmh !== null);
    return {
      team: t, code: tm.code, name: tm.name, points: tm.points, possession: tm.ball_control_pct / 100,
      fgm: tm.fgm, fga: tm.fga, tpm: tm.tpm, tpa: tm.tpa, efg: tm.fga ? (tm.fgm + 0.5 * tm.tpm) / tm.fga : null,
      passes: tm.passes, turnovers, assists: tr2.reduce((a, r) => a + r.assists, 0),
      passConcentration: passes && top ? { label: top.label, share: top.raw.passes / passes } : null,
      paintShots: shots.filter((s) => s.zone === 'Paint').length, threeShots: shots.filter((s) => s.value === 3).length,
      shots: shots.length,
      distance: mapped ? tm.distance_m : null,
      recoveryKmh: rec.length ? rec.reduce((a, r) => a + r.recoveryKmh, 0) / rec.length : null,
      transitionKmh: trn.length ? trn.reduce((a, r) => a + r.transitionKmh, 0) / trn.length : null,
    };
  });

  const observations = [];
  const coaching = [[], []];
  teams.forEach((tm, t) => {
    const op = teams[1 - t];
    if (tm.passConcentration && tm.passConcentration.share >= 0.35 && tm.passes >= 6) {
      observations.push(`${tm.name}'s ball movement ran through ${tm.passConcentration.label}: ${pctText(tm.passConcentration.share)} of the team's ${tm.passes} passes.`);
      coaching[t].push(`Involve more passers: ${pctText(tm.passConcentration.share)} of passes came from ${tm.passConcentration.label}, which makes the offence easy to read.`);
    }
    if (tm.shots >= 3 && tm.threeShots / tm.shots >= 0.6) {
      observations.push(`${tm.name} relied on the three-point shot: ${tm.threeShots} of ${tm.shots} attempts, ${tm.tpm} made.`);
      if (tm.tpa && tm.tpm / tm.tpa < 0.34) coaching[t].push(`Shot selection: ${tm.threeShots} of ${tm.shots} shots were threes (${tm.tpm} made). Attack the paint more.`);
    }
    if (tm.shots >= 3 && tm.paintShots / tm.shots >= 0.5) observations.push(`${tm.name} attacked the paint: ${tm.paintShots} of ${tm.shots} shots came from inside the key.`);
    if (tm.turnovers >= 2) coaching[t].push(`Ball security: the ball was intercepted ${tm.turnovers} times. Make safer passes under pressure.`);
    if (tm.recoveryKmh !== null && op.transitionKmh !== null && tm.recoveryKmh < op.transitionKmh - 1.5) {
      observations.push(`${tm.name} were slower back on defence (${one(tm.recoveryKmh)} km/h) than ${op.name} pushed in transition (${one(op.transitionKmh)} km/h).`);
      coaching[t].push(`Transition defence: sprint back as soon as the ball is lost (${one(tm.recoveryKmh)} km/h vs the opponent's ${one(op.transitionKmh)} km/h).`);
    }
    if (tm.possession < 0.45) coaching[t].push(`Possession: ${tm.name} had the ball ${pctText(tm.possession)} of the time. Value each possession and look for good shots.`);
    if (tm.efg !== null && op.efg !== null && tm.fga >= 3 && tm.efg > op.efg + 0.1) observations.push(`${tm.name} shot more efficiently: ${pctText(tm.efg)} eFG% vs ${pctText(op.efg)}.`);
  });
  if (teams[0].distance && teams[1].distance) {
    const [a, b] = teams[0].distance >= teams[1].distance ? [teams[0], teams[1]] : [teams[1], teams[0]];
    if (a.distance > b.distance * 1.08) observations.push(`${a.name} out-worked ${b.name} physically: ${Math.round(a.distance)} m vs ${Math.round(b.distance)} m covered by identified players.`);
  }
  coaching.forEach((list, t) => { if (!list.length) list.push(`No clear team-level problem in this clip for ${teams[t].name}. Keep the current approach and review the individual reports.`); });
  const needs = eligible.filter((r) => r.seconds >= 60 && r.ppi !== null).sort((a, b) => a.ppi - b.ppi).slice(0, 2)
    .map((r) => ({ key: r.key, label: r.label, team: r.team, ppi: r.ppi }));
  return { leaders, teams, observations, coaching, needs };
}
