// Writes data/games.json: sample games in the format the coach dashboard reads.
// Replace games.json with your model's output in the same shape (see data/README.md).
// Run from the project folder: node data/make-sample-data.mjs
import fs from 'node:fs';

let seed = 2026;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (weights) => { let r = rand() * weights.reduce((a, b) => a + b[1], 0); for (const [v, w] of weights) { r -= w; if (r <= 0) return v; } return weights[0][0]; };
const round1 = (n) => Math.round(n * 10) / 10;

const ROSTER = [
  { no: 7, pos: 'Point guard', starter: true, usage: 15, skill: 1.06, three: 0.42 },
  { no: 11, pos: 'Shooting guard', starter: true, usage: 13, skill: 1.0, three: 0.55 },
  { no: 23, pos: 'Small forward', starter: true, usage: 12, skill: 0.98, three: 0.35 },
  { no: 32, pos: 'Power forward', starter: true, usage: 10, skill: 1.02, three: 0.12 },
  { no: 44, pos: 'Center', starter: true, usage: 9, skill: 1.08, three: 0.02 },
  { no: 3, pos: 'Guard', starter: false, usage: 6, skill: 0.95, three: 0.45 },
  { no: 15, pos: 'Forward', starter: false, usage: 5, skill: 0.96, three: 0.25 },
  { no: 20, pos: 'Forward', starter: false, usage: 4, skill: 0.93, three: 0.2 },
  { no: 9, pos: 'Guard', starter: false, usage: 3, skill: 0.9, three: 0.4 },
  { no: 50, pos: 'Center', starter: false, usage: 2, skill: 0.95, three: 0 },
];
const GAMES = [
  { number: 10, date: '2026-10-06', opponent: 'Hawks', home: true },
  { number: 11, date: '2026-10-13', opponent: 'Titans', home: false },
  { number: 12, date: '2026-10-20', opponent: 'Comets', home: true },
  { number: 13, date: '2026-10-27', opponent: 'Rangers', home: false },
  { number: 14, date: '2026-11-03', opponent: 'Storm', home: true },
];

// court in feet: x across (-25 to 25), y from the baseline (0 to 47); the rim is at (0, 5.25)
const RIM = { x: 0, y: 5.25 };
const zoneOf = (x, y) => {
  const d = Math.hypot(x - RIM.x, y - RIM.y);
  const corner = y < 14 && Math.abs(x) >= 22;
  if (corner || (y >= 14 && d >= 23.75)) return corner ? 'Corner 3' : 'Above-break 3';
  if (Math.abs(x) <= 8 && y <= 19) return 'Paint';
  return 'Mid-range';
};
const place = (zone) => {
  for (let i = 0; i < 200; i += 1) {
    let x; let y;
    if (zone === 'Paint') { x = (rand() * 2 - 1) * 7.5; y = 1 + rand() * 16; }
    else if (zone === 'Mid-range') { const a = rand() * Math.PI; const r = 9 + rand() * 13; x = Math.cos(a) * r; y = RIM.y + Math.sin(a) * r; }
    else if (zone === 'Corner 3') { x = (rand() < 0.5 ? -1 : 1) * (22.3 + rand() * 2.2); y = 1 + rand() * 11; }
    else { const a = 0.35 + rand() * (Math.PI - 0.7); const r = 24.2 + rand() * 4; x = Math.cos(a) * r; y = RIM.y + Math.sin(a) * r; }
    if (Math.abs(x) <= 24.5 && y >= 0.5 && y <= 33 && zoneOf(x, y) === zone) return { x: round1(x), y: round1(y) };
  }
  return { x: 0, y: 4 };
};
const MAKE = { Paint: 0.58, 'Mid-range': 0.4, 'Corner 3': 0.39, 'Above-break 3': 0.34 };

const games = GAMES.map((g, gi) => {
  const form = 0.94 + rand() * 0.14;
  const shots = [];
  const players = ROSTER.map((p) => {
    const attempts = Math.max(1, Math.round(p.usage * (0.68 + rand() * 0.3)));
    let fgm = 0; let fga = 0; let tpm = 0; let tpa = 0;
    for (let i = 0; i < attempts; i += 1) {
      const zone = rand() < p.three ? pick([['Corner 3', 1], ['Above-break 3', 2.6]]) : pick([['Paint', 2.2], ['Mid-range', 1]]);
      const three = zone.endsWith('3');
      const made = rand() < MAKE[zone] * p.skill * form;
      const q = 1 + Math.floor(rand() * 4);
      const at = place(zone);
      shots.push({ player: p.no, q, ...at, zone, three, made });
      fga += 1; if (made) fgm += 1;
      if (three) { tpa += 1; if (made) tpm += 1; }
    }
    const fta = Math.round(p.usage * 0.18 * rand() * 2);
    const ftm = Math.round(fta * (0.62 + rand() * 0.3));
    const min = p.starter ? 27 + Math.round(rand() * 8) : 6 + Math.round(rand() * 12);
    return {
      no: p.no, pos: p.pos, starter: p.starter, min,
      pts: 2 * (fgm - tpm) + 3 * tpm + ftm,
      reb: Math.round((p.pos.includes('Center') ? 8 : p.pos.includes('forward') || p.pos === 'Forward' ? 5 : 2.5) * (min / 30) * (0.6 + rand() * 0.8)),
      ast: Math.round((p.pos.includes('guard') || p.pos === 'Guard' ? 4 : 1.5) * (min / 30) * (0.5 + rand())),
      tov: Math.round((min / 30) * 2.2 * rand()),
      stl: Math.round((min / 30) * 1.4 * rand()),
      fgm, fga, tpm, tpa, ftm, fta, pm: 0,
    };
  });
  // minutes add up to 200 (5 players on court for 40 minutes)
  let spare = 200 - players.reduce((a, p) => a + p.min, 0);
  for (let i = 0; spare !== 0; i = (i + 1) % players.length) { const step = Math.sign(spare); if (players[i].min + step >= 4) { players[i].min += step; spare -= step; } }

  const team = players.reduce((a, p) => a + p.pts, 0);
  const margin = [7, -5, 12, 3, 7][gi];
  const opp = team - margin;

  // quarters: team points by when the shots fell, free throws spread across them
  const quarters = [1, 2, 3, 4].map((q) => ({ q, team: 0, opp: 0, tov: 0, fouls: 0 }));
  shots.filter((s) => s.made).forEach((s) => { quarters[s.q - 1].team += s.three ? 3 : 2; });
  players.forEach((p) => { for (let i = 0; i < p.ftm; i += 1) quarters[Math.floor(rand() * 4)].team += 1; });
  let left = opp;
  quarters.forEach((q, i) => {
    const share = i === 3 ? left : Math.round(opp * (0.22 + rand() * 0.06));
    q.opp = share; left -= share;
  });
  const tovTotal = players.reduce((a, p) => a + p.tov, 0);
  for (let i = 0; i < tovTotal; i += 1) quarters[Math.floor(rand() * 4)].tov += 1;
  quarters.forEach((q) => { q.fouls = 2 + Math.floor(rand() * 5); });

  // plus-minus: the margin shared by minutes, with some swing between players
  players.forEach((p) => { p.pm = Math.round(margin * (p.min / 40) + (rand() * 2 - 1) * 5); });

  // lineups: five-man groups, minutes add up to 40, plus-minus adds up to the margin
  const lineupDefs = [
    ['Starters', [7, 11, 23, 32, 44]],
    ['Small lineup', [7, 11, 3, 23, 32]],
    ['Big lineup', [7, 23, 32, 44, 50]],
    ['Bench unit', [3, 9, 15, 20, 50]],
    ['Closing five', [7, 11, 23, 15, 44]],
    ['Second unit', [3, 11, 15, 20, 44]],
  ];
  const mins = [14, 6, 5, 6, 5, 4];
  const pms = lineupDefs.map(() => Math.round((rand() * 2 - 0.7) * 6));
  pms[0] += margin - pms.reduce((a, b) => a + b, 0);
  const lineups = lineupDefs.map(([name, nos], i) => ({ name, players: nos, min: mins[i], pm: pms[i] }));

  return { id: `game-${g.number}`, ...g, score: { team, opp }, quarters, players, lineups, shots };
});

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/games.json', `${JSON.stringify({ team: 'ClutchMetrics sample team', sample: true, games }, null, 1)}\n`);
console.log(games.map((g) => `game ${g.number}: ${g.score.team}-${g.score.opp}, ${g.shots.length} shots, ${g.shots.filter((s) => s.made).length} made`).join('\n'));
