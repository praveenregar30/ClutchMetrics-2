// The hero's animation: a player dribbles, jumps, shoots, and the ball drops through the net.
// Poses are keyframed as hip, hand and foot positions; elbows and knees come from two-bone IK.
// It stops off screen and in a hidden tab, has a pause button, and holds one still frame under reduced motion.

const svg = document.querySelector('[data-scene]');

if (svg) {
  const $ = (name) => svg.querySelector(`[data-p="${name}"]`);
  const LOOP = 5.2;
  const FLOOR = 556;
  const BALL_R = 17;
  const BALL_FLOOR = FLOOR - BALL_R;
  const RELEASE = 2.35;
  const ARRIVE = 3.25;
  const RIM = { x: 598, y: 192 };
  const LEN = { upperArm: 48, forearm: 46, thigh: 60, shin: 60, torso: 88 };

  const pose = (t, hip, lean, hN, hF, fN, fF) => ({ t, hip, lean, hN, hF, fN, fF });
  const FEET = [[276, FLOOR], [196, FLOOR]];
  const LAND = [[292, FLOOR], [212, FLOOR]];
  const KEYS = [
    pose(0, [236, 446], 14, [304, 458], [206, 440], ...FEET),
    pose(1.5, [236, 446], 14, [304, 458], [206, 440], ...FEET),
    pose(1.85, [240, 474], 8, [286, 392], [278, 404], ...FEET),
    pose(2.1, [240, 446], 2, [272, 300], [258, 318], ...FEET),
    pose(RELEASE, [246, 368], -3, [290, 204], [266, 246], [268, 490], [226, 498]),
    pose(2.6, [248, 382], -2, [300, 212], [270, 270], [270, 496], [228, 504]),
    pose(2.95, [252, 474], 12, [306, 330], [220, 420], ...LAND),
    pose(3.4, [250, 440], 5, [300, 392], [214, 440], ...LAND),
    pose(4.6, [248, 436], 4, [296, 440], [206, 440], [288, FLOOR], [210, FLOOR]),
    pose(LOOP, [236, 446], 14, [304, 458], [206, 440], ...FEET),
  ];

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (u) => u * u * (3 - 2 * u);
  const mix = (a, b, u) => a + (b - a) * u;
  const mixPoint = (a, b, u) => [mix(a[0], b[0], u), mix(a[1], b[1], u)];
  const span = (t, a, b) => clamp((t - a) / (b - a));

  function poseAt(t) {
    let i = 0;
    while (i < KEYS.length - 2 && t >= KEYS[i + 1].t) i += 1;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const u = smooth(span(t, a.t, b.t));
    return {
      hip: mixPoint(a.hip, b.hip, u),
      lean: mix(a.lean, b.lean, u),
      hN: mixPoint(a.hN, b.hN, u),
      hF: mixPoint(a.hF, b.hF, u),
      fN: mixPoint(a.fN, b.fN, u),
      fF: mixPoint(a.fF, b.fF, u),
    };
  }

  // the joint between root and target; side picks which way it bends
  function joint(root, target, l1, l2, side) {
    const dx = target[0] - root[0];
    const dy = target[1] - root[1];
    const d = clamp(Math.hypot(dx, dy) || 1, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    return [root[0] + ux * along - uy * h * side, root[1] + uy * along + ux * h * side];
  }

  // the end of a limb, pulled in when the target is out of reach
  function reach(root, target, max) {
    const dx = target[0] - root[0];
    const dy = target[1] - root[1];
    const d = Math.hypot(dx, dy) || 1;
    if (d <= max) return target;
    return [root[0] + (dx / d) * max, root[1] + (dy / d) * max];
  }

  const line = (el, a, b) => {
    el.setAttribute('x1', a[0].toFixed(1));
    el.setAttribute('y1', a[1].toFixed(1));
    el.setAttribute('x2', b[0].toFixed(1));
    el.setAttribute('y2', b[1].toFixed(1));
  };

  function dribble(t) {
    const phase = (t / 0.5) % 1;
    const tri = Math.abs(2 * phase - 1);
    const lift = 1 - (1 - tri) * (1 - tri);
    return BALL_FLOOR - (BALL_FLOOR - 463) * lift;
  }

  // the ball's flight, from the release point to the rim
  const FROM = [294, 186];
  function flight(t) {
    const u = span(t, RELEASE, ARRIVE);
    const x = mix(FROM[0], RIM.x, u);
    const apex = 62;
    const y = (1 - u) * (1 - u) * FROM[1] + 2 * (1 - u) * u * (2 * apex - (FROM[1] + RIM.y - 12) / 2) + u * u * (RIM.y - 12);
    return [x, y];
  }

  function ballAfterRim(t) {
    const x = mix(RIM.x, 508, span(t, 3.4, 4.7));
    if (t < 3.72) {
      const u = span(t, ARRIVE, 3.72);
      return [x, mix(RIM.y - 12, BALL_FLOOR, u * u)];
    }
    if (t < 4.28) {
      const u = span(t, 3.72, 4.28);
      return [x, BALL_FLOOR - 118 * 4 * u * (1 - u)];
    }
    if (t < 4.62) {
      const u = span(t, 4.28, 4.62);
      return [x, BALL_FLOOR - 38 * 4 * u * (1 - u)];
    }
    return [x, BALL_FLOOR];
  }

  const parts = {};
  ['farArmU', 'farArmL', 'farThigh', 'farShin', 'farShoe', 'nearArmU', 'nearArmL', 'nearThigh', 'nearShin', 'nearShoe',
    'torso', 'shortsN', 'shortsF', 'head', 'number', 'playerShadow', 'ball', 'ballShadow', 'net', 'trail', 'flash', 'score', 'rimFront',
    'pool', 'sparks', 'trackCorners', 'trackLabel', 'trackBall', 'arcTag']
    .forEach((name) => { parts[name] = $(name); });

  // the burst at the rim: each spark keeps one direction and speed
  const SPARKS = Array.from({ length: 18 }, (_, i) => {
    const angle = -Math.PI * (0.08 + (0.84 * i) / 17);
    const speed = 150 + ((i * 53) % 130);
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('r', i % 3 === 0 ? '3.4' : '2.2');
    el.setAttribute('fill', i % 2 ? '#ffb27a' : '#ff7a1a');
    el.setAttribute('opacity', '0');
    parts.sparks.append(el);
    return { el, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  });

  // write a reading only when it changes, and mark it for a moment
  const readings = {};
  document.querySelectorAll('[data-read] b').forEach((el) => {
    const key = [...el.attributes].find((x) => x.name.startsWith('data-read-')).name.replace('data-read-', '');
    readings[key] = el;
  });
  const write = (key, text) => {
    const el = readings[key];
    if (!el || el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('is-new');
    void el.offsetWidth;
    if (text !== '\u2013') el.classList.add('is-new');
  };

  function render(t) {
    const p = poseAt(t);
    const rad = (p.lean * Math.PI) / 180;
    const chest = [p.hip[0] + Math.sin(rad) * LEN.torso, p.hip[1] - Math.cos(rad) * LEN.torso];
    const shoulderN = chest;
    const shoulderF = [chest[0] - 7, chest[1] + 3];
    const hipF = [p.hip[0] - 6, p.hip[1]];
    const head = [chest[0] + Math.sin(rad) * 34 + 3, chest[1] - Math.cos(rad) * 34];
    const armMax = LEN.upperArm + LEN.forearm - 0.5;
    const legMax = LEN.thigh + LEN.shin - 0.5;

    let handN = p.hN;
    let ballAt;
    if (t < 1.5) {
      const by = dribble(t);
      handN = [304, clamp(by - BALL_R, 446, 472)];
      ballAt = [304, by];
    }
    handN = reach(shoulderN, handN, armMax);
    const handF = reach(shoulderF, p.hF, armMax);
    const footN = reach(p.hip, p.fN, legMax);
    const footF = reach(hipF, p.fF, legMax);
    const elbowN = joint(shoulderN, handN, LEN.upperArm, LEN.forearm, 1);
    const elbowF = joint(shoulderF, handF, LEN.upperArm, LEN.forearm, 1);
    const kneeN = joint(p.hip, footN, LEN.thigh, LEN.shin, -1);
    const kneeF = joint(hipF, footF, LEN.thigh, LEN.shin, -1);

    line(parts.farArmU, shoulderF, elbowF);
    line(parts.farArmL, elbowF, handF);
    line(parts.farThigh, hipF, kneeF);
    line(parts.farShin, kneeF, footF);
    line(parts.farShoe, footF, [footF[0] + 18, footF[1]]);
    line(parts.nearArmU, shoulderN, elbowN);
    line(parts.nearArmL, elbowN, handN);
    line(parts.nearThigh, p.hip, kneeN);
    line(parts.nearShin, kneeN, footN);
    line(parts.nearShoe, footN, [footN[0] + 18, footN[1]]);
    line(parts.torso, p.hip, chest);
    line(parts.shortsN, p.hip, mixPoint(p.hip, kneeN, 0.55));
    line(parts.shortsF, hipF, mixPoint(hipF, kneeF, 0.55));
    parts.head.setAttribute('cx', head[0].toFixed(1));
    parts.head.setAttribute('cy', head[1].toFixed(1));
    const mid = mixPoint(p.hip, chest, 0.34);
    parts.number.setAttribute('transform', `translate(${mid[0].toFixed(1)} ${mid[1].toFixed(1)}) rotate(${p.lean.toFixed(1)})`);

    const air = clamp((FLOOR - Math.max(footN[1], footF[1])) / 70);
    parts.playerShadow.setAttribute('transform', `translate(${p.hip[0].toFixed(1)} ${FLOOR + 6}) scale(${(1 - air * 0.35).toFixed(2)} 1)`);
    parts.playerShadow.setAttribute('opacity', (0.6 - air * 0.3).toFixed(2));

    // the ball
    if (!ballAt) {
      if (t < RELEASE) ballAt = [handN[0] + 3, handN[1] - BALL_R - 1];
      else if (t < ARRIVE) ballAt = flight(t);
      else ballAt = ballAfterRim(t);
    }
    let spin = t * 240;
    if (t >= RELEASE && t < ARRIVE) spin = -600 * (t - RELEASE);
    const ballFade = t < 0.14 ? span(t, 0, 0.14) : 1 - span(t, 4.85, 5.1);
    parts.ball.setAttribute('transform', `translate(${ballAt[0].toFixed(1)} ${ballAt[1].toFixed(1)}) rotate(${(spin % 360).toFixed(1)})`);
    parts.ball.setAttribute('opacity', ballFade.toFixed(2));
    const lift = clamp((BALL_FLOOR - ballAt[1]) / 320);
    parts.ballShadow.setAttribute('transform', `translate(${ballAt[0].toFixed(1)} ${FLOOR + 6}) scale(${(1 - lift * 0.6).toFixed(2)} 1)`);
    parts.ballShadow.setAttribute('opacity', (ballFade * (0.55 - lift * 0.4)).toFixed(2));

    // the arc the analysis draws behind the ball
    const end = Math.min(t, ARRIVE);
    const trailFade = 1 - span(t, 3.7, 4.3);
    if (t >= RELEASE) {
      let d = '';
      for (let i = 0; i <= 28; i += 1) {
        const at = flight(mix(RELEASE, end, i / 28));
        d += `${i ? 'L' : 'M'}${at[0].toFixed(1)} ${at[1].toFixed(1)}`;
      }
      parts.trail.setAttribute('d', d);
    }
    parts.trail.setAttribute('opacity', (t < RELEASE ? 0 : trailFade * 0.75).toFixed(2));

    // the net, the rim and the score react to the shot
    const since = t - (ARRIVE + 0.04);
    const ripple = since > 0 ? Math.exp(-5 * since) * Math.sin(16 * since) : 0;
    const scaleY = 1 + ripple * 0.24 + (since > 0 && since < 0.2 ? 0.1 * (1 - since / 0.2) : 0);
    const scaleX = 1 - ripple * 0.1;
    parts.net.setAttribute('transform', `translate(${RIM.x} ${RIM.y}) scale(${scaleX.toFixed(3)} ${scaleY.toFixed(3)}) translate(${-RIM.x} ${-RIM.y})`);
    parts.rimFront.setAttribute('transform', `translate(0 ${(ripple * 2.5).toFixed(2)})`);

    const pulse = span(t, ARRIVE, ARRIVE + 0.6);
    parts.flash.setAttribute('opacity', (t < ARRIVE ? 0 : (1 - pulse) * 0.8).toFixed(2));
    parts.flash.setAttribute('transform', `translate(${RIM.x} ${RIM.y}) scale(${(1 + pulse * 1.3).toFixed(2)})`);

    const rise = smooth(span(t, ARRIVE, ARRIVE + 0.35));
    const out = 1 - span(t, 4.3, 4.7);
    parts.score.setAttribute('opacity', (t < ARRIVE ? 0 : Math.min(rise, out)).toFixed(2));
    parts.score.setAttribute('transform', `translate(${RIM.x - 96} ${(RIM.y - 12 - rise * 22).toFixed(1)})`);

    // the model's view: a box that tracks the player, a ring that tracks the ball, a reading for the arc
    const xs = [head[0], handN[0], handF[0], footN[0], footF[0], kneeN[0], kneeF[0], elbowN[0], elbowF[0]];
    const ys = [head[1] - 21, handN[1], handF[1], footN[1], footF[1]];
    const left = Math.min(...xs) - 22;
    const right = Math.max(...xs) + 26;
    const top = Math.min(...ys) - 14;
    const bottom = Math.max(...ys) + 12;
    const c = 20;
    parts.trackCorners.setAttribute('d', `M${left} ${top + c}V${top}H${left + c}M${right - c} ${top}H${right}V${top + c}M${right} ${bottom - c}V${bottom}H${right - c}M${left + c} ${bottom}H${left}V${bottom - c}`);
    parts.trackLabel.setAttribute('x', left.toFixed(1));
    parts.trackLabel.setAttribute('y', (top - 9).toFixed(1));
    const follow = t >= RELEASE - 0.1 && t < 3.3 ? Math.min(span(t, RELEASE - 0.1, RELEASE), 1 - span(t, 3.18, 3.3)) : 0;
    parts.trackBall.setAttribute('opacity', follow.toFixed(2));
    parts.trackBall.setAttribute('transform', `translate(${ballAt[0].toFixed(1)} ${ballAt[1].toFixed(1)})`);
    parts.arcTag.setAttribute('opacity', (t < RELEASE ? 0 : Math.min(span(t, RELEASE + 0.3, RELEASE + 0.5), trailFade)).toFixed(2));

    // the burst and the light on the score
    SPARKS.forEach((spark) => {
      const age = t - ARRIVE;
      if (age < 0 || age > 0.75) { spark.el.setAttribute('opacity', '0'); return; }
      spark.el.setAttribute('cx', (RIM.x + spark.vx * age).toFixed(1));
      spark.el.setAttribute('cy', (RIM.y + spark.vy * age + 260 * age * age).toFixed(1));
      spark.el.setAttribute('opacity', (1 - age / 0.75).toFixed(2));
    });
    parts.pool.setAttribute('opacity', (0.72 + (t < ARRIVE ? 0 : (1 - span(t, ARRIVE, ARRIVE + 0.9)) * 0.9)).toFixed(2));

    // the panel beside the player says what is happening
    let action = 'Dribbling';
    if (t >= 1.5) action = 'Going up to shoot';
    if (t >= RELEASE) action = 'Ball in the air';
    if (t >= ARRIVE) action = 'Shot made';
    if (t >= 4.7) action = 'Back in play';
    write('action', action);
    write('arc', t >= RELEASE + 0.3 && t < 4.7 ? '4.2 m' : '\u2013');
    write('result', t >= ARRIVE && t < 4.7 ? 'Made, +2' : '\u2013');
    write('points', t >= ARRIVE ? '21' : '19');
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const button = document.querySelector('[data-scene-pause]');
  let time = 0;
  let last = 0;
  let frame = 0;
  let paused = false;
  let onScreen = true;

  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time = (time + dt) % LOOP;
    render(time);
    frame = requestAnimationFrame(tick);
  };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; };
  const sync = () => {
    const run = !paused && onScreen && !document.hidden && !reduced.matches;
    if (run && !frame) { last = performance.now(); frame = requestAnimationFrame(tick); }
    if (!run && frame) stop();
    if (reduced.matches && !paused) render(2.9);
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
  }).observe(svg);

  render(reduced.matches ? 2.9 : 0);
  sync();
}

// The dashboard's shot chart plots itself the first time it scrolls into view: dots, bars, then figures.
const chart = document.querySelector('[data-plot]');
if (chart && !matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  chart.classList.add('is-waiting');
  chart.querySelectorAll('[data-shot]').forEach((el, i) => el.style.setProperty('--i', String(i)));
  const counts = [...chart.querySelectorAll('[data-count]')];
  const io = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    io.disconnect();
    chart.classList.remove('is-waiting');
    chart.classList.add('is-plotted');
    const start = performance.now();
    const run = (now) => {
      const u = Math.min(1, (now - start) / 1100);
      const eased = 1 - (1 - u) ** 3;
      counts.forEach((el) => {
        const value = Number(el.dataset.count);
        const places = Number(el.dataset.places || 0);
        el.textContent = (value * eased).toFixed(places) + (el.dataset.unit || '');
      });
      if (u < 1) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
  }, { threshold: 0.25 });
  // the court, never the whole panel: on a phone the panel is taller than the screen
  io.observe(chart.querySelector('.game__court') || chart);
}
