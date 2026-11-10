// Court mapping window: after an upload, the user matches a few spots in each chosen picture to the court diagram.
// From 4+ spots we fit the picture -> court mapping (homography); the server carries it through the video with the
// camera motion it measured, which gives speeds, distances, heatmaps and shot positions.

import { serverFetch } from './config.js';

const L = 28, W = 15;                    // FIBA court, metres; y = 0 is the far sideline (top of the diagram)
const PREDICT_SECONDS = 6;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- court drawing (same lines as court_mapping.py)
function courtLines() {
  const circle = (cx, cy, r, a0 = 0, a1 = 360) => Array.from({ length: 40 }, (_, i) => {
    const a = ((a0 + (a1 - a0) * i / 39) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  const lines = [[[0, 0], [L, 0], [L, W], [0, W], [0, 0]], [[L / 2, 0], [L / 2, W]], circle(L / 2, W / 2, 1.8)];
  const arcEnd = (Math.asin((7.5 - 0.9) / 6.75) * 180) / Math.PI;
  for (const fx of [(x) => x, (x) => L - x]) {
    lines.push([[fx(0), 5.05], [fx(5.8), 5.05], [fx(5.8), 9.95], [fx(0), 9.95]]);
    lines.push(circle(5.8, 7.5, 1.8, -90, 90).map(([x, y]) => [fx(x), y]));
    lines.push([[fx(0), 0.9], [fx(2.99), 0.9], ...circle(1.575, 7.5, 6.75, -arcEnd, arcEnd).map(([x, y]) => [fx(x), y]),
      [fx(2.99), 14.1], [fx(0), 14.1]]);
  }
  return lines;
}
const LINES = courtLines();

// ---------------------------------------------------------------- 3x3 matrix helpers
const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
function inv(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) return null;
  return [[A, -(b * i - c * h), b * f - c * e], [B, a * i - c * g, -(a * f - c * d)], [C, -(a * h - b * g), a * e - b * d]]
    .map((r) => r.map((v) => v / det));
}
const apply = (H, x, y) => { const w = H[2][0] * x + H[2][1] * y + H[2][2]; return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w, w]; };

function normaliser(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const d = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / pts.length || 1;
  const k = Math.SQRT2 / d;
  return [[k, 0, -k * cx], [0, k, -k * cy], [0, 0, 1]];
}

// Picture -> court homography from point pairs (normalised least squares, h33 = 1)
function fitHomography(pairs) {
  const T1 = normaliser(pairs.map((p) => p.img)), T2 = normaliser(pairs.map((p) => p.court));
  const rows = [], rhs = [];
  for (const { img, court } of pairs) {
    const [x, y] = apply(T1, ...img), [u, v] = apply(T2, ...court);
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.push(v);
  }
  // normal equations, Gaussian elimination with partial pivoting
  const M = Array.from({ length: 8 }, (_, i) => [...Array.from({ length: 8 }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)),
    rows.reduce((s, r, k) => s + r[i] * rhs[k], 0)]);
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 9; k++) M[r][k] -= f * M[c][k];
    }
  }
  const h = M.map((r, i) => r[8] / r[i]);
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  const T2i = inv(T2);
  if (!T2i) return null;
  const H = mul(mul(T2i, Hn), T1);
  return H.map((r) => r.map((v) => v / H[2][2]));
}

// The perspective is only fixed by 4 spots of which no 3 lie on one line (spots along one court line all "agree"
// but leave the rest of the court free). True when such 4 spots exist among the pairs.
function wellSpread(pairs) {
  const pts = pairs.map((p) => p.court);
  const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  const ok = (q) => [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]].every(([i, j, k]) => area(q[i], q[j], q[k]) >= 1.5);
  const n = pts.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    if (ok([pts[a], pts[b], pts[c], pts[d]])) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the window
let dialog;

function build() {
  dialog = document.createElement('dialog');
  dialog.className = 'cmap';
  dialog.setAttribute('aria-labelledby', 'cmap-h');
  dialog.innerHTML = `
    <div class="cmap__head">
      <div><h2 id="cmap-h">Map the court</h2><p class="cmap__sub" data-sub></p></div>
      <button class="cmap__x" type="button" data-close aria-label="Close (your progress is kept)">✕</button>
    </div>
    <div class="cmap__steps" data-steps></div>
    <div class="cmap__body" data-body>
      <div class="cmap__pic"><canvas data-pic aria-label="Video picture: click a court spot"></canvas><p class="cmap__loading" data-loading>Loading picture…</p></div>
      <div class="cmap__side">
        <svg class="cmap__court" data-court viewBox="-1.2 -1.2 30.4 17.4" role="img" aria-label="Court diagram: click the matching spot"></svg>
        <p class="cmap__hint" data-hint></p>
        <p class="cmap__fit" data-fit aria-live="polite"></p>
        <div class="cmap__tools">
          <button class="mini-btn" type="button" data-undo>Undo <kbd>U</kbd></button>
          <button class="mini-btn" type="button" data-clear>Clear</button>
          <button class="mini-btn" type="button" data-back>Back</button>
          <button class="mini-btn" type="button" data-skip-pic>Not a court view: skip</button>
        </div>
        <button class="mini-btn mini-btn--primary cmap__accept" type="button" data-accept disabled>Accept picture <kbd>Enter</kbd></button>
      </div>
    </div>
    <div class="cmap__done" data-done hidden></div>
    <div class="cmap__foot">
      <button class="cmap__link" type="button" data-skip-all>Skip court mapping for this video</button>
      <span class="fine">Without mapping, the dashboard has no speed, distance, heatmaps or shot positions.</span>
    </div>`;
  document.body.append(dialog);
}

export async function openCourtMapper(jobId, { onFinish } = {}) {
  if (!dialog) build();
  const $ = (s) => dialog.querySelector(s);
  const status = (text) => { $('[data-fit]').textContent = text; };
  let data;
  try {
    const res = await serverFetch(`/api/jobs/${jobId}/court`, { cache: 'no-store' });
    data = await res.json();
    if (!res.ok) throw new Error(data.detail || `status ${res.status}`);
  } catch (err) {
    alert(`The court pictures could not load: ${err.message}`);
    return;
  }

  const key = `cm-court-${jobId}`;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } })();
  const pics = data.keyframes;
  const results = saved.results || {};          // frame -> 3x3 matrix (original video pixels -> metres) or 'skip'
  let pos = Math.min(saved.pos || 0, pics.length);
  let pairs = [], pending = null, img = null;
  const images = {};
  const keep = () => { try { localStorage.setItem(key, JSON.stringify({ results, pos })); } catch { /* private mode */ } };
  const forget = () => { try { localStorage.removeItem(key); } catch { /* private mode */ } };

  $('[data-sub]').textContent = `${data.title || 'Your video'} · only ${pics.length} picture${pics.length === 1 ? '' : 's'}, picked from the wide camera views`;
  const canvas = $('[data-pic]'), ctx = canvas.getContext('2d');
  const svg = $('[data-court]');

  const picture = async (frame) => {
    if (!images[frame]) {
      images[frame] = (async () => {
        const res = await serverFetch(`/api/jobs/${jobId}/court/${frame}.jpg`);
        if (!res.ok) throw new Error(`picture status ${res.status}`);
        const im = new Image();
        im.src = URL.createObjectURL(await res.blob());
        await im.decode();
        return im;
      })();
    }
    return images[frame];
  };

  // nearest already-mapped picture of the same camera shot, moved here with the camera motion
  // (only from close by: the measured camera motion drifts by metres over 15+ seconds)
  function predicted(i) {
    const k = pics[i];
    const same = pics.filter((p) => p.shot === k.shot && Array.isArray(results[p.frame]) && Math.abs(p.t - k.t) <= PREDICT_SECONDS);
    if (!same.length) return null;
    const near = same.reduce((a, b) => (Math.abs(a.frame - k.frame) <= Math.abs(b.frame - k.frame) ? a : b));
    const Si = inv(near.to_shared);
    return Si ? mul(mul(results[near.frame], Si), k.to_shared) : null;
  }

  const current = () => {
    if (pairs.length >= 4) return wellSpread(pairs) ? { H: fitHomography(pairs), kind: 'fit' } : { H: null, kind: 'line' };
    const p = predicted(pos);
    return p ? { H: p, kind: 'predicted' } : { H: null, kind: null };
  };

  function drawCourt() {
    const pairLandmarks = pairs.map((p) => p.court.join());
    svg.innerHTML = `<rect x="0" y="0" width="${L}" height="${W}" class="cmap__floor"/>
      ${LINES.map((l) => `<polyline points="${l.map((p) => p.join(',')).join(' ')}"/>`).join('')}
      <text x="${L / 2}" y="-0.4" class="cmap__label">far sideline</text><text x="${L / 2}" y="${W + 1}" class="cmap__label">near sideline (camera side)</text>
      ${data.landmarks.map(([x, y]) => `<circle class="cmap__lm${pairLandmarks.includes(`${x},${y}`) ? ' is-used' : ''}${pending ? ' is-live' : ''}" cx="${x}" cy="${y}" r="0.42"/>`).join('')}
      ${pairs.map((p, n) => `<text class="cmap__num" x="${p.court[0] + 0.55}" y="${p.court[1] - 0.45}">${n + 1}</text>`).join('')}`;
  }

  function drawPicture() {
    if (!img) return;
    const s = data.image_scale;
    ctx.drawImage(img, 0, 0);
    const { H, kind } = current();
    const back = H && inv(H);
    if (back) {
      ctx.lineWidth = Math.max(2, canvas.width / 500);
      ctx.strokeStyle = kind === 'fit' ? '#ff4fd8' : '#ffd23f';
      for (const line of LINES) {
        ctx.beginPath();
        let drawing = false;
        for (const [x, y] of line) {
          const [u, v, w] = apply(back, x, y);
          if (w <= 0 || !Number.isFinite(u)) { drawing = false; continue; }
          drawing ? ctx.lineTo(u * s, v * s) : ctx.moveTo(u * s, v * s);
          drawing = true;
        }
        ctx.stroke();
      }
    }
    const r = canvas.width / 110;
    ctx.font = `600 ${r * 2.2}px system-ui, sans-serif`;
    pairs.forEach((p, n) => {
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath(); ctx.arc(p.img[0] * s, p.img[1] * s, r, 0, 7); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText(n + 1, p.img[0] * s + r * 1.2, p.img[1] * s - r * 1.2);
      ctx.fillStyle = '#fff'; ctx.fillText(n + 1, p.img[0] * s + r * 1.2, p.img[1] * s - r * 1.2);
    });
    if (pending) {
      ctx.strokeStyle = '#3fff7a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(pending[0] * s, pending[1] * s, r * 1.6, 0, 7); ctx.stroke();
    }
  }

  function updateText() {
    const { H, kind } = current();
    $('[data-accept]').disabled = !H;
    $('[data-undo]').disabled = !pairs.length && !pending;
    $('[data-clear]').disabled = !pairs.length && !pending;
    $('[data-back]').disabled = pos === 0;
    let hint;
    if (pending) hint = '<b>Now click the same spot on the court diagram.</b>';
    else if (kind === 'predicted' && pairs.length === 0) hint = '<b>Yellow lines</b> are predicted from the camera movement. If they sit on the real court lines, press <b>Accept</b>. If not, click 4 spots to fix them.';
    else if (kind === 'line') hint = '<b>Your spots lie (almost) on one line</b>, so the court cannot be placed yet. Add a spot away from that line, for example a corner of the paint or a sideline end.';
    else if (pairs.length < 4) hint = `Click a court spot in the picture (a line corner or where lines meet), then the same spot on the diagram. <b>${4 - pairs.length} more</b> needed. Pick spots far apart.`;
    else hint = '<b>Pink lines</b> come from your spots. If they sit on the real court lines, press <b>Accept</b>. Add more spots to improve them.';
    $('[data-hint]').innerHTML = `${hint}<br><span class="fine">The basket on the right of the picture is the right basket of the diagram.</span>`;
    if (kind === 'fit' && pairs.length >= 5 && H) {
      const err = Math.max(...pairs.map((p) => { const [x, y] = apply(H, ...p.img); return Math.hypot(x - p.court[0], y - p.court[1]); }));
      status(err > 1 ? `The spots disagree by up to ${err.toFixed(1)} m: one pair is probably wrong. Undo it.` : `Spots agree within ${err.toFixed(1)} m.`);
    } else status('');
    const done = pics.filter((p) => results[p.frame] !== undefined).length;
    $('[data-steps]').innerHTML = pics.map((p, i) => `<span class="${i === pos ? 'is-now' : ''} ${Array.isArray(results[p.frame]) ? 'is-done' : results[p.frame] === 'skip' ? 'is-skip' : ''}" title="Picture ${i + 1} at ${clock(p.t)}"></span>`).join('')
      + `<b>Picture ${Math.min(pos + 1, pics.length)} of ${pics.length}</b><span class="fine">${pos < pics.length ? `at ${clock(pics[pos].t)} in the video · ` : ''}${done} done</span>`;
  }

  const redraw = () => { drawPicture(); drawCourt(); updateText(); };

  async function show(i) {
    pos = i; pairs = []; pending = null; keep();
    if (pos >= pics.length) { finish(); return; }
    $('[data-body]').hidden = false; $('[data-done]').hidden = true;
    $('[data-loading]').hidden = false;
    img = null;
    try {
      img = await picture(pics[pos].frame);
    } catch {
      $('[data-loading]').textContent = 'This picture could not load. Check that the analysis server is running.';
      return;
    }
    if (pos !== i) return;
    $('[data-loading]').hidden = true;
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    redraw();
    pics.slice(i + 1, i + 3).forEach((p) => picture(p.frame).catch(() => {}));   // load the next ones early
  }

  function finish() {
    const mapped = pics.filter((p) => Array.isArray(results[p.frame])).length;
    $('[data-body]').hidden = true; $('[data-steps]').innerHTML = '';
    const box = $('[data-done]');
    box.hidden = false;
    box.innerHTML = mapped
      ? `<h3>All pictures done</h3><p>${mapped} mapped${mapped < pics.length ? `, ${pics.length - mapped} skipped` : ''}. Send the mapping to the analysis server; it is used for the whole video.</p>
         <div class="cmap__tools"><button class="mini-btn" type="button" data-review>Back to the pictures</button><button class="mini-btn mini-btn--primary" type="button" data-send>Send court mapping</button></div><p class="fine" data-send-msg aria-live="polite"></p>`
      : `<h3>No picture mapped</h3><p>Map at least one picture, or skip court mapping for this video.</p><div class="cmap__tools"><button class="mini-btn" type="button" data-review>Back to the pictures</button></div>`;
  }

  async function send(body) {
    const msg = dialog.querySelector('[data-send-msg]');
    if (msg) msg.textContent = 'Sending…';
    try {
      const res = await serverFetch(`/api/jobs/${jobId}/court`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.detail || `status ${res.status}`);
      forget();
      dialog.close();
      onFinish?.(out.court);
    } catch (err) {
      if (msg) msg.textContent = `Could not send: ${err.message}`;
      else alert(`Could not send: ${err.message}`);
    }
  }

  // ---- events (replaced on every open, so handlers always see this job)
  const pointer = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * canvas.width / data.image_scale, ((e.clientY - r.top) / r.height) * canvas.height / data.image_scale];
  };
  canvas.onclick = (e) => { if (img) { pending = pointer(e); redraw(); } };
  svg.onclick = (e) => {
    if (!pending) { status('First click the spot in the picture, then here.'); return; }
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const near = data.landmarks.reduce((a, b) => (Math.hypot(a[0] - p.x, a[1] - p.y) <= Math.hypot(b[0] - p.x, b[1] - p.y) ? a : b));
    if (Math.hypot(near[0] - p.x, near[1] - p.y) > 2) { status('Click one of the dots on the diagram.'); return; }
    pairs.push({ img: pending, court: near }); pending = null; redraw();
  };
  const undo = () => { if (pending) pending = null; else pairs.pop(); redraw(); };
  const accept = () => {
    const { H } = current();
    if (!H) return;
    results[pics[pos].frame] = H;
    show(pos + 1);
  };
  $('[data-undo]').onclick = undo;
  $('[data-clear]').onclick = () => { pairs = []; pending = null; redraw(); };
  $('[data-back]').onclick = () => { if (pos > 0) { delete results[pics[pos - 1].frame]; show(pos - 1); } };
  $('[data-skip-pic]').onclick = () => { results[pics[pos].frame] = 'skip'; show(pos + 1); };
  $('[data-accept]').onclick = accept;
  $('[data-close]').onclick = () => dialog.close();
  $('[data-done]').onclick = (e) => {
    if (e.target.closest('[data-review]')) { const last = pics.length - 1; delete results[pics[last].frame]; show(last); }
    if (e.target.closest('[data-send]')) send({ keyframes: Object.fromEntries(Object.entries(results)) });
  };
  $('[data-skip-all]').onclick = () => {
    if (confirm('Skip court mapping for this video? The analysis continues without speed, distance, heatmaps and shot positions.')) send({ skip: true });
  };
  dialog.onkeydown = (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'Enter' && !$('[data-body]').hidden && !$('[data-accept]').disabled && !e.target.closest('button')) { e.preventDefault(); accept(); }
    if ((e.key === 'u' || e.key === 'U') && !$('[data-body]').hidden) undo();
  };

  if (!data.can_map || data.state !== 'to_map') {
    dialog.showModal();
    $('[data-body]').hidden = true; $('[data-steps]').innerHTML = '';
    $('[data-done]').hidden = false;
    $('[data-done]').innerHTML = data.state === 'mapped' ? '<h3>Already mapped</h3><p>The court of this video has been mapped.</p>'
      : data.state === 'skipped' ? '<h3>Skipped</h3><p>Court mapping was skipped for this video.</p>'
      : '<h3>Too late to map</h3><p>The analysis has already passed the court step.</p>';
    return;
  }
  dialog.showModal();
  show(pos);
}
