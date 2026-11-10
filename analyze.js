// "Analyse a video": upload a game video to the ClutchMetrics analysis server, follow its progress, open results.
// Used by the coach and the player dashboards: <section data-analyze="coach|player"> ... </section>

import { SERVER, serverHeaders, serverFetch, serverVideoUrl } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes > 1e8 ? 0 : 1)} MB`;
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const root = document.querySelector('[data-analyze]');
const role = root?.dataset.analyze || 'coach';
let limits = { max_upload_mb: 1024, max_seconds: 180, formats: ['.mp4', '.mov'] };
let file = null;
let polling = null;

function template() {
  root.innerHTML = `
    <div class="card__head">
      <div>
        <h2 id="analyze-h">Analyse a video</h2>
        <p class="card__sub">Upload a game video. The model finds the players, jersey numbers, the ball, passes and shots, then builds ${role === 'coach' ? 'a full dashboard' : 'your report'}.</p>
      </div>
      <span class="server" data-server-state><i></i>Checking the analysis server…</span>
    </div>
    <form class="upload" data-upload novalidate>
      <label class="drop" data-drop>
        <input type="file" accept="video/*,.mkv,.avi,.wmv" data-file>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.500 8.500 12 4l4.500 4.500"/><path d="M4 15v3.500A1.500 1.500 0 0 0 5.500 20h13a1.500 1.500 0 0 0 1.500-1.500V15"/></svg>
        <b data-drop-title>Drop a video here, or choose a file</b>
        <span data-drop-sub>MP4, MOV, AVI, MKV or WebM. It is converted automatically.</span>
      </label>
      <div class="upload__fields">
        <div class="field"><label for="team-a">Team A (lighter jersey)</label><input id="team-a" name="team_a" required maxlength="30" placeholder="e.g. Australia" autocomplete="off"></div>
        <div class="field"><label for="team-b">Team B (darker jersey)</label><input id="team-b" name="team_b" required maxlength="30" placeholder="e.g. India" autocomplete="off"></div>
        <div class="field"><label for="m-title">Title <span class="opt">optional</span></label><input id="m-title" name="title" maxlength="60" placeholder="e.g. League round 3" autocomplete="off"></div>
        <div class="field"><label for="m-date">Date <span class="opt">optional</span></label><input id="m-date" name="date" type="date"></div>
      </div>
      <div class="upload__go">
        <button class="mini-btn mini-btn--primary" type="submit" data-submit disabled>Upload and analyse</button>
        <p class="fine" data-upload-status aria-live="polite"></p>
      </div>
      <div class="bar" data-upload-bar hidden><i></i></div>
    </form>
    <div class="jobs" data-jobs aria-live="polite"></div>`;
}

// ---------------------------------------------------------------- server status
async function checkServer() {
  const badge = $('[data-server-state]', root);
  try {
    const res = await serverFetch('/api/health', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    limits = await res.json();
    badge.className = 'server is-on';
    badge.innerHTML = `<i></i>Analysis server online${limits.queue ? ` · ${limits.queue} waiting` : ''}`;
    $('[data-drop-sub]', root).textContent = `MP4, MOV, AVI, MKV or WebM, up to ${limits.max_upload_mb} MB. The first ${clock(limits.max_seconds)} is analysed. It is converted automatically.`;
    return true;
  } catch {
    badge.className = 'server is-off';
    badge.innerHTML = '<i></i>Analysis server offline';
    $('[data-upload-status]', root).textContent = 'The analysis server is not running right now, so uploads are paused. The built-in match still works.';
    return false;
  }
}

// ---------------------------------------------------------------- choosing a file
function pick(f) {
  const status = $('[data-upload-status]', root);
  const ext = `.${(f.name.split('.').pop() || '').toLowerCase()}`;
  if (!f.type.startsWith('video/') && !limits.formats.includes(ext)) { status.textContent = `"${f.name}" is not a video file.`; return; }
  if (f.size > limits.max_upload_mb * 1e6) { status.textContent = `This file is ${mb(f.size)}; the limit is ${limits.max_upload_mb} MB. Trim it first.`; return; }
  file = f;
  $('[data-drop-title]', root).textContent = f.name;
  $('[data-drop-sub]', root).textContent = `${mb(f.size)} · reading length…`;
  const probe = document.createElement('video');
  probe.preload = 'metadata';
  probe.onloadedmetadata = () => {
    const d = probe.duration;
    $('[data-drop-sub]', root).textContent = `${mb(f.size)} · ${clock(d)}${d > limits.max_seconds ? ` (the first ${clock(limits.max_seconds)} will be analysed)` : ''}`;
    URL.revokeObjectURL(probe.src);
  };
  probe.onerror = () => { $('[data-drop-sub]', root).textContent = `${mb(f.size)} · the server will convert this format`; };
  probe.src = URL.createObjectURL(f);
  status.textContent = '';
  updateSubmit();
}

function updateSubmit() {
  const ready = file && $('#team-a', root).value.trim() && $('#team-b', root).value.trim();
  $('[data-submit]', root).disabled = !ready;
}

// ---------------------------------------------------------------- uploading
async function upload(form) {
  const status = $('[data-upload-status]', root);
  const bar = $('[data-upload-bar]', root);
  const data = new FormData(form);
  data.set('file', file);
  data.set('role', role);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${SERVER}/api/jobs`);
  Object.entries(await serverHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
  bar.hidden = false;
  $('[data-submit]', root).disabled = true;
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const p = e.loaded / e.total;
    bar.firstElementChild.style.width = `${p * 100}%`;
    status.textContent = `Uploading… ${Math.round(p * 100)}% (${mb(e.loaded)} of ${mb(e.total)})`;
  };
  xhr.onload = () => {
    bar.hidden = true;
    if (xhr.status >= 200 && xhr.status < 300) {
      status.textContent = 'Uploaded. The analysis has started; you can leave this page and come back later.';
      form.reset(); file = null;
      $('[data-drop-title]', root).textContent = 'Drop a video here, or choose a file';
      loadJobs();
    } else {
      let msg = `status ${xhr.status}`;
      try { msg = JSON.parse(xhr.responseText).detail || msg; } catch { /* not JSON */ }
      status.textContent = `The upload failed: ${msg}`;
      updateSubmit();
    }
  };
  xhr.onerror = () => { bar.hidden = true; status.textContent = 'The upload failed: the analysis server could not be reached.'; updateSubmit(); };
  status.textContent = 'Uploading…';
  xhr.send(data);
}

// ---------------------------------------------------------------- list of analyses
async function loadJobs() {
  const box = $('[data-jobs]', root);
  let jobs = [];
  try {
    const res = await serverFetch('/api/jobs', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    jobs = await res.json();
  } catch { box.innerHTML = ''; return; }
  if (!jobs.length) { box.innerHTML = '<p class="fine">No uploaded videos yet.</p>'; return; }
  box.innerHTML = `<h3 class="sub-h">Uploaded videos</h3>${jobs.map((j) => {
    const open = role === 'coach' ? `<a class="mini-btn" href="coach-dashboard.html?match=${j.id}">Open dashboard</a>`
      : `<button class="mini-btn" type="button" data-watch="${j.id}">Watch analysis</button>`;
    const state = j.status === 'done' ? `<span class="tag tag--done">Ready</span>`
      : j.status === 'failed' ? `<span class="tag tag--fail">Failed</span>`
      : j.status === 'queued' ? `<span class="tag">Waiting${j.queue_position ? ` (#${j.queue_position})` : ''}</span>`
      : `<span class="tag tag--run">${j.progress}%</span>`;
    return `<article class="job" data-job="${j.id}">
      <div class="job__main"><b>${esc(j.title)}</b><span>${esc(j.teams.join(' vs '))} · ${when.format(new Date(j.created * 1000))}${j.duration_s ? ` · ${clock(j.duration_s)} of video` : ''}</span></div>
      <div class="job__state">${state}${j.status === 'done' ? open : ''}</div>
      ${j.status === 'running' || j.status === 'queued' ? `<div class="job__progress"><div class="bar"><i style="width:${j.progress}%"></i></div><span>${esc(j.step_text)}</span></div>` : ''}
      ${j.status === 'failed' ? `<p class="job__msg">${esc(j.message)}</p>` : ''}
      <div class="job__watch" hidden></div>
    </article>`;
  }).join('')}`;
  clearTimeout(polling);
  if (jobs.some((j) => j.status === 'running' || j.status === 'queued')) polling = setTimeout(loadJobs, 5000);
}

// players watch the finished analysis right here
async function watch(id, button) {
  const box = $(`[data-job="${id}"] .job__watch`, root);
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<p class="fine">Loading the analysis…</p>';
  try {
    const match = await (await serverFetch(`/api/jobs/${id}/match.json`)).json();
    const src = await serverVideoUrl(match.video);
    const [a, b] = match.teams;
    box.innerHTML = `<video class="video" controls playsinline src="${src}"></video>
      <table class="table table--tally"><thead><tr><th scope="col"></th><th scope="col" class="num">${esc(a.code)}</th><th scope="col" class="num">${esc(b.code)}</th></tr></thead><tbody>
      ${[['Points', 'points'], ['Field goals made', 'fgm'], ['Passes', 'passes'], ['Interceptions', 'interceptions'], ['Ball control %', 'ball_control_pct']]
        .map(([l, k]) => `<tr><th scope="row">${l}</th><td class="num">${Math.round(a[k])}</td><td class="num">${Math.round(b[k])}</td></tr>`).join('')}</tbody></table>`;
  } catch {
    box.innerHTML = '<p class="fine">The analysis could not load. Check that the analysis server is running.</p>';
  }
  button.blur();
}

async function start() {
  if (!root) return;
  template();
  const form = $('[data-upload]', root);
  const input = $('[data-file]', root);
  const drop = $('[data-drop]', root);
  input.addEventListener('change', () => input.files[0] && pick(input.files[0]));
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) pick(f); });
  form.addEventListener('input', updateSubmit);
  form.addEventListener('submit', (e) => { e.preventDefault(); if (file) upload(form); });
  $('[data-jobs]', root).addEventListener('click', (e) => { const b = e.target.closest('[data-watch]'); if (b) watch(b.dataset.watch, b); });
  if (await checkServer()) loadJobs();
  else $('[data-submit]', root).disabled = true;
}

start();
