// The court section: six players run one play. The guard dribbles up and passes to the wing, the wing lobs to the
// cutting big man, he dunks, the arena reacts and everyone jogs back. Everything is computed from the time alone,
// so it can stop and restart anywhere. It stops off screen, has a pause button, and holds one frame under reduced motion.

const svg = document.querySelector('[data-court-scene]');

if (svg) {
  const NS = 'http://www.w3.org/2000/svg';
  const LOOP = 7.8;
  const LEN = { upperArm: 48, forearm: 46, thigh: 60, shin: 60, torso: 88 };
  const RIM = { x: 1168, y: 198 };
  const BALL_R = 17;

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (u) => u * u * (3 - 2 * u);
  const mix = (a, b, u) => a + (b - a) * u;
  const mixP = (a, b, u) => [mix(a[0], b[0], u), mix(a[1], b[1], u)];
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const make = (name, attrs = {}, parent = null) => {
    const el = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (parent) parent.append(el);
    return el;
  };
  const at = (keys, t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (t < keys[i + 1][0]) return mix(keys[i][1], keys[i + 1][1], span(t, keys[i][0], keys[i + 1][0]));
    }
    return keys[keys.length - 1][1];
  };
  const atSmooth = (keys, t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (t < keys[i + 1][0]) return mix(keys[i][1], keys[i + 1][1], smooth(span(t, keys[i][0], keys[i + 1][0])));
    }
    return keys[keys.length - 1][1];
  };

  const TEAM = {
    home: { limb: '#f7f1e8', far: '#a59b8e', jersey: '#ff7a1a', shorts: '#c65a10', shoe: '#ff7a1a', number: '#160b03' },
    away: { limb: '#c3cbd3', far: '#77818c', jersey: '#3f5a73', shorts: '#2c4154', shoe: '#c3cbd3', number: '#f7f1e8' },
  };

  // back to front, so nearer players are drawn over farther ones
  const PLAYERS = {
    E: { team: 'away', no: 5, floor: 482, s: 0.76,
      x: [[0, 650], [2.7, 925], [3.8, 960], [5, 1010], [5.4, 1000], [7.8, 620]],
      modes: [[0, 'guard'], [5, 'swing']] },
    B: { team: 'home', no: 11, floor: 500, s: 0.8,
      x: [[0, 520], [2.2, 775], [2.7, 800], [3.75, 860], [5, 900], [5.5, 890], [7.8, 540]],
      modes: [[0, 'swing'], [2.42, 'catch'], [2.7, 'dribble'], [3.55, 'catch'], [3.8, 'pass'], [4.15, 'idle'], [4.8, 'cheer'], [5.7, 'swing']] },
    F: { team: 'away', no: 14, floor: 522, s: 0.86,
      x: [[0, 1010], [3, 1000], [4.15, 1000], [4.9, 1010], [5.5, 1000], [7.8, 800]],
      jump: [[4.2, 0], [4.48, 46], [4.78, 0]],
      modes: [[0, 'guard'], [4.2, 'up'], [4.85, 'idle'], [5.5, 'swing']] },
    C: { team: 'home', no: 23, floor: 540, s: 0.9,
      x: [[0, 830], [2, 880], [3.2, 930], [4.15, 1072], [4.52, 1092], [5, 1104], [5.6, 1080], [7.8, 720]],
      jump: [[4.15, 0], [4.5, 100], [4.76, 94], [5.06, 0]],
      modes: [[0, 'swing'], [4.1, 'up'], [5.05, 'cheer'], [5.8, 'swing']] },
    D: { team: 'away', no: 8, floor: 566, s: 0.96,
      x: [[0, 305], [2.2, 610], [3, 650], [4.9, 900], [5.4, 900], [7.8, 500]],
      modes: [[0, 'guard'], [5.2, 'swing']] },
    A: { team: 'home', no: 7, floor: 596, s: 1.04,
      x: [[0, 170], [2.2, 470], [2.5, 490], [4.8, 770], [5.3, 780], [7.8, 360]],
      modes: [[0, 'dribble'], [2.0, 'catch'], [2.25, 'pass'], [2.6, 'swing'], [4.8, 'cheer'], [5.6, 'swing']] },
  };
  const ORDER = ['E', 'B', 'F', 'C', 'D', 'A'];

  // the joint between root and target; side picks which way it bends
  function joint(root, target, l1, l2, side) {
    const dx = target[0] - root[0];
    const dy = target[1] - root[1];
    const len = Math.hypot(dx, dy) || 1;
    const d = clamp(len, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const ux = dx / len;
    const uy = dy / len;
    return [root[0] + ux * along - uy * h * side, root[1] + uy * along + ux * h * side];
  }
  const reach = (root, target, max) => {
    const dx = target[0] - root[0];
    const dy = target[1] - root[1];
    const d = Math.hypot(dx, dy) || 1;
    return d <= max ? target : [root[0] + (dx / d) * max, root[1] + (dy / d) * max];
  };

  function bounce(t) {
    const phase = (t % 0.46) / 0.46;
    return Math.abs(2 * phase - 1);
  }

  function pose(p, t) {
    const { s } = p;
    const x = at(p.x, t);
    const vx = (at(p.x, t + 0.04) - at(p.x, t - 0.04)) / 0.08;
    const moving = Math.abs(vx) > 18;
    const f = moving ? Math.sign(vx) : 1;
    const h = p.jump ? atSmooth(p.jump, t) : 0;
    const ph = (x / (150 * s)) * Math.PI * 2;
    const currentMode = (() => { let m = p.modes[0]; p.modes.forEach((k) => { if (t >= k[0]) m = k; }); return m; })();
    const guarding = currentMode[1] === 'guard';
    const hipH = (guarding ? 94 : 106) + (moving && h < 4 ? Math.abs(Math.sin(ph)) * 5 : 0);
    const lean = ((moving ? 10 : guarding ? 8 : 3) * f * Math.PI) / 180;
    const hip = [x, p.floor - hipH * s - h];
    const hipF = [x - 5 * s * f, hip[1]];
    const chest = [hip[0] + Math.sin(lean) * LEN.torso * s, hip[1] - Math.cos(lean) * LEN.torso * s];
    const shF = [chest[0] - 7 * s * f, chest[1] + 3 * s];
    const head = [chest[0] + Math.sin(lean) * 34 * s + 3 * s * f, chest[1] - Math.cos(lean) * 34 * s];

    // feet
    let fN;
    let fF;
    if (h > 4) {
      fN = [hip[0] + 22 * s * f, hip[1] + 100 * s];
      fF = [hipF[0] - 14 * s * f, hip[1] + 92 * s];
    } else if (moving) {
      fN = [x + Math.cos(ph) * 42 * s, p.floor - Math.max(0, Math.sin(ph)) * 32 * s];
      fF = [x - Math.cos(ph) * 42 * s, p.floor - Math.max(0, -Math.sin(ph)) * 32 * s];
    } else {
      const w = guarding ? 38 : 24;
      fN = [x + w * s * f, p.floor];
      fF = [x - w * s * f, p.floor];
    }
    const legMax = (LEN.thigh + LEN.shin) * s - 0.5;
    fN = reach(hip, fN, legMax);
    fF = reach(hipF, fF, legMax);
    const kN = joint(hip, fN, LEN.thigh * s, LEN.shin * s, -f);
    const kF = joint(hipF, fF, LEN.thigh * s, LEN.shin * s, -f);

    // hands, for one mode
    const hands = (mode) => {
      const swing = Math.cos(ph);
      switch (mode) {
        case 'swing': return [[chest[0] - swing * 44 * s, chest[1] + 72 * s], [shF[0] + swing * 44 * s, shF[1] + 72 * s]];
        case 'dribble': {
          const up = bounce(t);
          return [[hip[0] + 50 * s * f, hip[1] + (6 + (1 - up) * 18) * s], [shF[0] - 26 * s * f, shF[1] + 62 * s]];
        }
        case 'catch': return [[chest[0] + 58 * s * f, chest[1] - 2 * s], [shF[0] + 52 * s * f, shF[1] - 8 * s]];
        case 'pass': return [[chest[0] + 84 * s * f, chest[1] - 14 * s], [shF[0] + 74 * s * f, shF[1] - 12 * s]];
        case 'up': return [[chest[0] + 26 * s * f, chest[1] - 90 * s], [shF[0] + 30 * s * f, shF[1] - 72 * s]];
        case 'guard': return [[chest[0] + 44 * s * f, chest[1] - 44 * s], [shF[0] - 34 * s * f, shF[1] - 34 * s]];
        case 'cheer': return [[chest[0] + 24 * s * f, chest[1] - 90 * s], [shF[0] - 22 * s * f, shF[1] - 88 * s]];
        default: return [[chest[0] + 16 * s * f, chest[1] + 84 * s], [shF[0] - 12 * s * f, shF[1] + 84 * s]];
      }
    };
    let index = 0;
    p.modes.forEach((k, i) => { if (t >= k[0]) index = i; });
    const now = hands(p.modes[index][1]);
    const before = index > 0 ? hands(p.modes[index - 1][1]) : now;
    const u = smooth(span(t, p.modes[index][0], p.modes[index][0] + 0.18));
    const armMax = (LEN.upperArm + LEN.forearm) * s - 0.5;
    const hN = reach(chest, mixP(before[0], now[0], u), armMax);
    const hF = reach(shF, mixP(before[1], now[1], u), armMax);
    const eN = joint(chest, hN, LEN.upperArm * s, LEN.forearm * s, f);
    const eF = joint(shF, hF, LEN.upperArm * s, LEN.forearm * s, f);

    return { x, f, s, h, hip, hipF, chest, shF, head, fN, fF, kN, kF, hN, hF, eN, eF, lean };
  }

  // the ball: a list of who has it when
  const FLOOR_LOOSE = 540;
  function ball(t) {
    const hold = (name, a) => {
      const p = PLAYERS[name];
      const q = pose(p, t);
      const r = BALL_R * q.s;
      const up = bounce(t - a);
      const lift = 1 - (1 - up) * (1 - up);
      const floor = p.floor - r;
      const top = q.hN[1] + r * 1.05;
      return { x: q.hN[0], y: mix(floor, top, lift), s: q.s, floor: p.floor };
    };
    const inHands = (name, moment) => {
      const q = pose(PLAYERS[name], moment);
      return [(q.hN[0] + q.hF[0]) / 2, (q.hN[1] + q.hF[1]) / 2, q.s, PLAYERS[name].floor];
    };
    const flight = (from, to, a, b, arc) => {
      const u = span(t, a, b);
      const x = mix(from[0], to[0], u);
      const y = mix(from[1], to[1], u) - arc * 4 * u * (1 - u);
      return { x, y, s: mix(from[2], to[2], u), floor: mix(from[3], to[3], u) };
    };
    if (t < 2.0) return hold('A', 0);
    if (t < 2.3) { const q = inHands('A', t); return { x: q[0], y: q[1], s: q[2], floor: q[3] }; }
    if (t < 2.68) return flight(inHands('A', 2.3), inHands('B', 2.68), 2.3, 2.68, 46);
    if (t < 3.55) return hold('B', 2.68);
    if (t < 3.85) { const q = inHands('B', t); return { x: q[0], y: q[1], s: q[2], floor: q[3] }; }
    if (t < 4.5) {
      const end = pose(PLAYERS.C, 4.5);
      return flight(inHands('B', 3.85), [end.hN[0] + 6, end.hN[1] - 12, end.s, PLAYERS.C.floor], 3.85, 4.5, 118);
    }
    if (t < 4.74) {
      const q = pose(PLAYERS.C, t);
      const u = smooth(span(t, 4.5, 4.74));
      return { x: mix(q.hN[0] + 6, RIM.x, u), y: mix(q.hN[1] - 12, RIM.y - 12, u), s: q.s, floor: FLOOR_LOOSE };
    }
    const r = BALL_R * 0.9;
    const low = FLOOR_LOOSE - r;
    const x = mix(RIM.x, RIM.x - 170, span(t, 4.74, 6.9));
    if (t < 5.08) { const u = span(t, 4.74, 5.08); return { x, y: mix(RIM.y - 12, low, u * u), s: 0.9, floor: FLOOR_LOOSE }; }
    if (t < 5.6) { const u = span(t, 5.08, 5.6); return { x, y: low - 104 * 4 * u * (1 - u), s: 0.9, floor: FLOOR_LOOSE }; }
    if (t < 5.92) { const u = span(t, 5.6, 5.92); return { x, y: low - 36 * 4 * u * (1 - u), s: 0.9, floor: FLOOR_LOOSE }; }
    return { x, y: low, s: 0.9, floor: FLOOR_LOOSE };
  }

  // ---- build the drawing
  const q = (name) => svg.querySelector(`[data-c="${name}"]`);
  const crowd = q('crowd');
  const seatColours = ['#3b342c', '#4a4036', '#5a4a3a', '#2f2a25', '#6e5238'];
  for (let row = 0; row < 5; row += 1) {
    for (let i = 0; i < 84; i += 1) {
      const n = (i * 37 + row * 11) % 5;
      make('circle', {
        cx: (-540 + i * 30 + (row % 2 ? 15 : 0) + ((i * 7) % 5)).toFixed(0),
        cy: (250 + row * 34 + ((i * 13) % 6)).toFixed(0),
        r: (9 + row * 0.9).toFixed(1),
        fill: seatColours[n],
      }, crowd);
    }
  }

  const actors = {};
  ORDER.forEach((id) => {
    const p = PLAYERS[id];
    const c = TEAM[p.team];
    const g = make('g', { 'stroke-linecap': 'round', fill: 'none' }, q('players'));
    const line = (stroke, width) => make('line', { stroke, 'stroke-width': width * p.s }, g);
    const parts = {
      shadow: make('ellipse', { rx: 70 * p.s, ry: 9 * p.s, fill: 'url(#court-shadow)', stroke: 'none' }, g),
      farArmU: line(c.far, 15), farArmL: line(c.far, 13), farThigh: line(c.far, 22), farShin: line(c.far, 17),
      farShoe: line(c.shorts, 12), shortsF: line(c.shorts, 26),
      nearThigh: line(c.limb, 23), nearShin: line(c.limb, 18), nearShoe: line(c.shoe, 12), shortsN: line(c.shorts, 28),
      torso: line(c.jersey, 40),
    };
    parts.head = make('circle', { r: 21 * p.s, fill: c.limb, stroke: 'none' }, g);
    parts.number = make('text', { class: 'court__num', 'text-anchor': 'middle', fill: c.number, stroke: 'none', 'font-size': 25 * p.s }, g);
    parts.number.textContent = p.no;
    parts.nearArmU = line(c.limb, 16);
    parts.nearArmL = line(c.limb, 14);
    actors[id] = parts;
  });

  const sparks = Array.from({ length: 22 }, (_, i) => {
    const angle = -Math.PI * (0.05 + (0.9 * i) / 21);
    const speed = 170 + ((i * 61) % 170);
    const el = make('circle', { r: i % 3 === 0 ? 3.6 : 2.3, fill: i % 2 ? '#ffb27a' : '#ff7a1a', opacity: 0 }, q('sparks'));
    return { el, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  });

  const set = (el, a, b) => {
    el.setAttribute('x1', a[0].toFixed(1)); el.setAttribute('y1', a[1].toFixed(1));
    el.setAttribute('x2', b[0].toFixed(1)); el.setAttribute('y2', b[1].toFixed(1));
  };

  const narrow = matchMedia('(max-width: 899px)');
  let camera = 700;
  let crowdAtRest = false;

  function render(t) {
    ORDER.forEach((id) => {
      const o = pose(PLAYERS[id], t);
      const a = actors[id];
      set(a.farArmU, o.shF, o.eF); set(a.farArmL, o.eF, o.hF);
      set(a.farThigh, o.hipF, o.kF); set(a.farShin, o.kF, o.fF);
      set(a.farShoe, o.fF, [o.fF[0] + 18 * o.s * o.f, o.fF[1]]);
      set(a.nearThigh, o.hip, o.kN); set(a.nearShin, o.kN, o.fN);
      set(a.nearShoe, o.fN, [o.fN[0] + 18 * o.s * o.f, o.fN[1]]);
      set(a.shortsN, o.hip, mixP(o.hip, o.kN, 0.52)); set(a.shortsF, o.hipF, mixP(o.hipF, o.kF, 0.52));
      set(a.torso, o.hip, o.chest);
      set(a.nearArmU, o.chest, o.eN); set(a.nearArmL, o.eN, o.hN);
      a.head.setAttribute('cx', o.head[0].toFixed(1)); a.head.setAttribute('cy', o.head[1].toFixed(1));
      const mid = mixP(o.hip, o.chest, 0.42);
      a.number.setAttribute('transform', `translate(${mid[0].toFixed(1)} ${(mid[1] + 9 * o.s).toFixed(1)})`);
      const air = clamp(o.h / 120);
      a.shadow.setAttribute('cx', o.x.toFixed(1));
      a.shadow.setAttribute('cy', (PLAYERS[id].floor + 5).toFixed(1));
      a.shadow.setAttribute('opacity', (0.75 - air * 0.45).toFixed(2));
    });

    const b = ball(t);
    q('ball').setAttribute('transform', `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) scale(${b.s.toFixed(3)}) rotate(${((t * 300) % 360).toFixed(0)})`);
    const lift = clamp((b.floor - b.y) / 360);
    q('ballShadow').setAttribute('cx', b.x.toFixed(1));
    q('ballShadow').setAttribute('cy', (b.floor + 4).toFixed(1));
    q('ballShadow').setAttribute('rx', (22 * b.s * (1 - lift * 0.6)).toFixed(1));
    q('ballShadow').setAttribute('opacity', (0.7 - lift * 0.5).toFixed(2));

    // the whole scene fades through the restart
    const fade = (t < 0.3 ? span(t, 0, 0.3) : 1 - span(t, 7.35, 7.7));
    q('players').setAttribute('opacity', fade.toFixed(2));
    q('ballLayer').setAttribute('opacity', fade.toFixed(2));

    // net, rim, burst, crowd, score
    const SCORE = 4.72;
    const since = t - SCORE;
    const ripple = since > 0 ? Math.exp(-4.5 * since) * Math.sin(17 * since) : 0;
    const pull = since > -0.2 && since < 0.1 ? 0.08 : 0;
    q('net').setAttribute('transform', `translate(${RIM.x} ${RIM.y}) scale(${(1 - ripple * 0.1).toFixed(3)} ${(1 + ripple * 0.26 + pull).toFixed(3)}) translate(${-RIM.x} ${-RIM.y})`);
    const dunk = since > -0.1 ? Math.exp(-6 * Math.max(0, since)) * Math.cos(26 * Math.max(0, since)) : 0;
    q('rim').setAttribute('transform', `rotate(${(dunk * -4).toFixed(2)} ${RIM.x + 44} ${RIM.y})`);
    q('board').setAttribute('transform', `translate(${(dunk * 1.5).toFixed(2)} 0)`);
    sparks.forEach((spark) => {
      if (since < 0 || since > 0.85) { spark.el.setAttribute('opacity', '0'); return; }
      spark.el.setAttribute('cx', (RIM.x + spark.vx * since).toFixed(1));
      spark.el.setAttribute('cy', (RIM.y + spark.vy * since + 300 * since * since).toFixed(1));
      spark.el.setAttribute('opacity', (1 - since / 0.85).toFixed(2));
    });
    const roar = since > 0 ? Math.exp(-1.3 * since) : 0;
    if (roar > 0.004 || !crowdAtRest) {
      crowd.setAttribute('transform', `translate(0 ${(-Math.abs(Math.sin(since * 9)) * 7 * roar).toFixed(2)})`);
      crowd.setAttribute('opacity', (0.55 + roar * 0.45).toFixed(2));
      q('beams').setAttribute('opacity', (0.55 + roar * 0.45).toFixed(2));
      crowdAtRest = roar <= 0.004;
    }
    const scored = since > 0 && t < 7.5;
    const home = q('home');
    const text = scored ? '64' : '62';
    if (home.textContent !== text) home.textContent = text;
    const pop = q('points');
    pop.setAttribute('opacity', (since < 0 ? 0 : Math.min(smooth(span(since, 0, 0.2)), 1 - span(since, 1.2, 1.6))).toFixed(2));
    pop.setAttribute('transform', `translate(${RIM.x - 118} ${(RIM.y - 8 - smooth(span(since, 0, 0.4)) * 26).toFixed(1)})`);

    // what the play is called, shown as it happens
    const tag = (name, a, b) => q(name).setAttribute('opacity', Math.min(span(t, a, a + 0.14), 1 - span(t, b, b + 0.2)).toFixed(2));
    tag('tagPass', 2.3, 2.95);
    tag('tagAssist', 3.85, 4.5);

    // on a narrow screen the camera follows the ball
    if (narrow.matches) {
      camera += (clamp(b.x, 320, 1120) - camera) * 0.09;
      svg.setAttribute('viewBox', `${(camera - 320).toFixed(1)} 0 640 640`);
    } else if (svg.getAttribute('viewBox') !== '0 0 1440 640') {
      svg.setAttribute('viewBox', '0 0 1440 640');
    }
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const button = document.querySelector('[data-court-pause]');
  const STILL = 4.6;
  let time = 0;
  let last = 0;
  let frame = 0;
  let paused = false;
  let onScreen = false;

  const tick = (now) => {
    time = (time + Math.min(0.05, (now - last) / 1000)) % LOOP;
    last = now;
    render(time);
    frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    const run = !paused && onScreen && !document.hidden && !reduced.matches;
    if (run && !frame) { last = performance.now(); frame = requestAnimationFrame(tick); }
    if (!run && frame) { cancelAnimationFrame(frame); frame = 0; }
    if (reduced.matches) { camera = clamp(RIM.x, 320, 1120); render(STILL); }
  };
  if (button) {
    button.addEventListener('click', () => {
      paused = !paused;
      button.setAttribute('aria-pressed', String(paused));
      button.setAttribute('aria-label', paused ? 'Play the animation' : 'Pause the animation');
      sync();
    });
    button.hidden = reduced.matches;
  }
  reduced.addEventListener('change', () => { if (button) button.hidden = reduced.matches; sync(); });
  document.addEventListener('visibilitychange', sync);
  new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    sync();
  }, { threshold: 0.05 }).observe(svg);

  render(reduced.matches ? STILL : 0);
  sync();
}
