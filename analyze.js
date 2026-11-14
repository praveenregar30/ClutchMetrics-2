// "Analyse a video": upload a game video to the ClutchMetrics analysis server, follow its progress, open results.
// Used by the coach and the player dashboards: <section data-analyze="coach|player"> ... </section>

import { SERVER, serverHeaders, serverFetch, serverVideoUrl } from './config.js';
import { openCourtMapper } from './court-map.js?v=1';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes > 1e8 ? 0 : 1)} MB`;
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const root = document.querySelector('[data-analyze]');
const role = root?.dataset.analyze || 'coach';
let limits = { max_upload_mb: 4096, max_seconds: 0, formats: ['.mp4', '.mov'] };   // max_seconds 0 = whole video
let file = null;
let polling = null;
let mapNext = null;      // the video just uploaded: open the court mapping window as soon as its pictures are ready

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
        ${role === 'player' ? `<div class="field"><label for="my-team">Your team</label><select id="my-team" name="my_team" required data-my-team><option value="a">Team A</option><option value="b">Team B</option></select></div>
        <div class="field"><label for="my-number">Your jersey number</label><input id="my-number" name="my_number" required inputmode="numeric" pattern="[0-9]{1,2}" maxlength="2" placeholder="e.g. 7" autocomplete="off" aria-describedby="my-number-help"><p class="fine" id="my-number-help">So your report can find you in the video.</p></div>` : ''}
        <div class="field"><label for="m-title">Title <span class="opt">optional</span></label><input id="m-title" name="title" maxlength="60" placeholder="e.g. League round 3" autocomplete="off"></div>
        <div class="field"><label for="m-date">Date <span class="opt">optional</span></label><input id="m-date" name="date" type="date"></div>
      </div>
      <div class="upload__go">
        <button class="mini-btn mini-btn--primary" type="submit" data-submit disabled>Upload and analyse</button>
        <button class="mini-btn" type="button" data-cancel-upload hidden>Cancel upload</button>
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
    $('[data-drop-sub]', root).textContent = `MP4, MOV, AVI, MKV or WebM, up to ${limits.max_upload_mb >= 1024 ? `${limits.max_upload_mb / 1024} GB` : `${limits.max_upload_mb} MB`}. ${limits.max_seconds ? `The first ${clock(limits.max_seconds)} is analysed.` : 'The whole video is analysed (about 10 minutes of analysis per minute of video).'} It is converted automatically.`;
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
    $('[data-drop-sub]', root).textContent = `${mb(f.size)} · ${clock(d)}${limits.max_seconds && d > limits.max_seconds ? ` (the first ${clock(limits.max_seconds)} will be analysed)` : ` · analysis takes about ${Math.max(5, Math.round(d / 6))} min`}`;
    URL.revokeObjectURL(probe.src);
  };
  probe.onerror = () => { $('[data-drop-sub]', root).textContent = `${mb(f.size)} · the server will convert this format`; };
  probe.src = URL.createObjectURL(f);
  status.textContent = '';
  updateSubmit();
}

function updateSubmit() {
  const teamSelect = $('[data-my-team]', root);
  if (teamSelect) {
    // the "Your team" choices show the team names as they are typed
    teamSelect.options[0].textContent = $('#team-a', root).value.trim() || 'Team A';
    teamSelect.options[1].textContent = $('#team-b', root).value.trim() || 'Team B';
  }
  const number = $('#my-number', root);
  const numberOk = !number || /^\d{1,2}$/.test(number.value.trim());
  const ready = file && $('#team-a', root).value.trim() && $('#team-b', root).value.trim() && numberOk;
  $('[data-submit]', root).disabled = !ready;
}

// ---------------------------------------------------------------- uploading
const PIECE_LIMIT = 8 * 1024 * 1024;   // above this, send the video in pieces (the cloud proxy refuses requests over ~10 MB)
const PIECE_SIZE = 8 * 1024 * 1024;

// Sends the file piece by piece (each retried up to 3 times). Returns the upload token, or null if cancelled/failed.
async function uploadPieces(f, bar, status, cancel) {
  const token = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  let current = null; let stopped = false;
  cancel.onclick = () => { stopped = true; current?.abort(); };
  const send = (offset, blob, headers) => new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    current = xhr;
    xhr.open('POST', `${SERVER}/api/upload-part?token=${token}&offset=${offset}`);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      const p = (offset + e.loaded) / f.size;
      bar.firstElementChild.style.width = `${p * 100}%`;
      status.textContent = `Uploading… ${Math.round(p * 100)}% (${mb(offset + e.loaded)} of ${mb(f.size)})`;
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? 'ok' : `status ${xhr.status}: ${(() => { try { return JSON.parse(xhr.responseText).detail; } catch { return ''; } })()}`);
    xhr.onerror = () => resolve('network');
    xhr.onabort = () => resolve('abort');
    xhr.send(blob);
  });
  status.textContent = 'Uploading…';
  for (let offset = 0; offset < f.size; offset += PIECE_SIZE) {
    const blob = f.slice(offset, offset + PIECE_SIZE);
    let result = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await send(offset, blob, await serverHeaders());      // fresh login token for every piece
      if (result === 'ok' || result === 'abort' || stopped) break;
    }
    if (stopped || result === 'abort') { bar.hidden = true; status.textContent = 'Upload cancelled. Nothing was sent for analysis.'; return null; }
    if (result !== 'ok') {
      bar.hidden = true;
      status.textContent = result === 'network' ? 'The upload failed: the analysis server could not be reached.' : `The upload failed (${result}).`;
      return null;
    }
  }
  status.textContent = 'Uploaded. Starting the analysis…';
  return token;
}

async function upload(form) {
  const status = $('[data-upload-status]', root);
  const bar = $('[data-upload-bar]', root);
  const data = new FormData(form);
  data.set('file', file);
  data.set('role', role);
  bar.hidden = false;
  $('[data-submit]', root).disabled = true;
  const cancel = $('[data-cancel-upload]', root);
  cancel.hidden = false;

  // Videos go up in 8 MB pieces: the cloud address refuses single requests over about 10 MB
  if (file.size > PIECE_LIMIT) {
    const pieces = await uploadPieces(file, bar, status, cancel);
    if (!pieces) { cancel.hidden = true; updateSubmit(); return; }
    data.delete('file');
    data.set('parts', pieces);
    data.set('filename', file.name);
  }

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${SERVER}/api/jobs`);
  Object.entries(await serverHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
  cancel.onclick = () => xhr.abort();
  xhr.onloadend = () => { cancel.hidden = true; };
  xhr.onabort = () => { bar.hidden = true; status.textContent = 'Upload cancelled. Nothing was sent for analysis.'; updateSubmit(); };
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const p = e.loaded / e.total;
    bar.firstElementChild.style.width = `${p * 100}%`;
    status.textContent = `Uploading… ${Math.round(p * 100)}% (${mb(e.loaded)} of ${mb(e.total)})`;
  };
  xhr.onload = () => {
    bar.hidden = true;
    if (xhr.status >= 200 && xhr.status < 300) {
      status.textContent = 'Uploaded. In about a minute a window opens where you map the court on a few pictures. The analysis keeps running meanwhile.';
      try { mapNext = JSON.parse(xhr.responseText).id; } catch { mapNext = null; }
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
      : `<a class="mini-btn" href="player-dashboard.html?match=${j.id}">Open my report</a>`;
    const state = j.status === 'done' ? `<span class="tag tag--done">Ready</span>`
      : j.status === 'failed' ? `<span class="tag tag--fail">Failed</span>`
      : j.status === 'queued' ? `<span class="tag">Waiting${j.queue_position ? ` (#${j.queue_position})` : ''}</span>`
      : `<span class="tag tag--run">${j.progress}%</span>`;
    return `<article class="job" data-job="${j.id}">
      <div class="job__main"><b>${esc(j.title)}</b><span>${esc(j.teams.join(' vs '))} · ${when.format(new Date(j.created * 1000))}${j.duration_s ? ` · ${clock(j.duration_s)} of video` : ''}</span></div>
      <div class="job__state">${state}${j.status === 'done' ? open : ''}${j.status === 'running' || j.status === 'queued' ? `<button class="mini-btn" type="button" data-cancel="${j.id}" data-title="${esc(j.title)}">Cancel</button>` : ''}</div>
      ${j.status === 'running' || j.status === 'queued' ? `<div class="job__progress"><div class="bar"><i style="width:${j.progress}%"></i></div><span>${esc(j.step_text)}</span></div>` : ''}
      ${j.court_can_map ? `<div class="job__court"><span class="tag tag--map">Court not mapped yet</span><button class="mini-btn mini-btn--primary" type="button" data-map="${j.id}">Map the court (${j.court_pictures} pictures)</button></div>` : ''}
      ${j.status === 'failed' ? `<p class="job__msg">${esc(j.message)}</p>` : ''}
      <div class="job__watch" hidden></div>
    </article>`;
  }).join('')}`;
  clearTimeout(polling);
  if (jobs.some((j) => j.status === 'running' || j.status === 'queued')) polling = setTimeout(loadJobs, 5000);
  const ready = mapNext && jobs.find((j) => j.id === mapNext);
  if (ready && (ready.court_can_map || ready.status === 'done' || ready.status === 'failed' || ready.court !== 'none')) {
    mapNext = null;
    if (ready.court_can_map) map(ready.id);
  }
}

async function cancelJob(button) {
  const id = button.dataset.cancel;
  if (!confirm(`Cancel the analysis of "${button.dataset.title}"? The video is deleted from the server and this can't be undone.`)) return;
  const status = $('[data-upload-status]', root);
  button.disabled = true;
  try {
    const res = await serverFetch(`/api/jobs/${id}/cancel`, { method: 'POST' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.detail || `status ${res.status}`);
    if (mapNext === id) mapNext = null;
    status.textContent = `"${button.dataset.title}" was cancelled.`;
  } catch (err) {
    status.textContent = `Could not cancel: ${err.message}`;
    button.disabled = false;
  }
  loadJobs();
}

function map(id) {
  if (document.querySelector('dialog.cmap[open]')) return;
  openCourtMapper(id, {
    onFinish: (state) => {
      $('[data-upload-status]', root).textContent = state === 'skipped'
        ? 'Court mapping skipped. The analysis continues without court stats.'
        : 'Court mapping sent. The analysis now includes speed, distance, heatmaps and shot positions.';
      loadJobs();
    },
  });
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
  $('[data-jobs]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-watch]');
    if (b) watch(b.dataset.watch, b);
    const m = e.target.closest('[data-map]');
    if (m) map(m.dataset.map);
    const c = e.target.closest('[data-cancel]');
    if (c) cancelJob(c);
  });
  if (await checkServer()) loadJobs();
  else $('[data-submit]', root).disabled = true;
}

start();
