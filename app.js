// app.js - camera, MediaPipe pose tracking, drawing and dashboard.
import {
  PoseLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import {
  SquatAnalyzer,
  CONFIG,
  angleDeg,
  torsoLeanDeg,
  heelDelta,
} from './squat-logic.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// MediaPipe landmark indexes for each body side
const LEFT = { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, foot: 31 };
const RIGHT = { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, foot: 32 };

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');
const chart = $('chart');
const cctx = chart.getContext('2d');

const analyzer = new SquatAnalyzer();
let landmarker = null;
let running = false;
let stream = null;
let rafId = 0;
let lastVideoTime = -1;
let startedAt = 0;
let elapsed = 0;
let side = 'left';
let mirror = true;
let target = 5;
let history = [];
let cueTimer = 0;
let W = 640;
let H = 480;

const FLAG_LABEL = { depth: 'DEPTH', back: 'BACK', heels: 'HEELS' };
const FLAG_MSG = {
  depth: 'Thoda aur neeche jayein (hips parallel tak)',
  back: 'Seena upar rakhein, aage na jhukein',
  heels: 'Edi (heels) zameen par rakhein',
};

/* ---------------- helpers ---------------- */
function setStatus(text) {
  $('statusMsg').textContent = text || '';
}

function showCue(text, bad = false, ms = 2600) {
  const cue = $('cue');
  cue.textContent = text;
  cue.classList.toggle('bad', bad);
  clearTimeout(cueTimer);
  cueTimer = setTimeout(() => (cue.textContent = ''), ms);
}

function speak(text) {
  if (!$('voiceChk').checked || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}

const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
};

/* ---------------- model + camera ---------------- */
async function loadModel() {
  if (landmarker) return;
  setStatus('AI model load ho raha hai… (pehli baar thora time lagta hai)');
  const vision = await FilesetResolver.forVisionTasks(WASM);
  const make = (delegate) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  try {
    landmarker = await make('GPU');
  } catch (e) {
    console.warn('GPU delegate failed, using CPU', e);
    landmarker = await make('CPU');
  }
}

async function startCamera() {
  stopAll(false);
  $('startBtn').disabled = true;
  try {
    await loadModel();
    setStatus('Camera ki permission dein…');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    mirror = true;
    video.classList.add('mirror');
    video.srcObject = stream;
    await video.play();
    beginSession();
  } catch (err) {
    console.error(err);
    $('startBtn').disabled = false;
    if (err && err.name === 'NotAllowedError') {
      setStatus('Camera permission block hai. Browser ke address bar se camera allow karein.');
    } else if (err && err.name === 'NotFoundError') {
      setStatus('Koi camera nahi mila. Camera lagayein ya "Test with video file" use karein.');
    } else {
      setStatus('Error: ' + (err && err.message ? err.message : err));
    }
  }
}

async function startFile(file) {
  stopAll(false);
  try {
    await loadModel();
    mirror = false;
    video.classList.remove('mirror');
    video.srcObject = null;
    video.src = URL.createObjectURL(file);
    video.loop = false;
    await video.play();
    beginSession();
  } catch (err) {
    console.error(err);
    setStatus('Video play nahi ho saki: ' + (err && err.message ? err.message : err));
  }
}

function beginSession() {
  W = video.videoWidth || 640;
  H = video.videoHeight || 480;
  canvas.width = W;
  canvas.height = H;
  $('videoWrap').style.aspectRatio = `${W} / ${H}`;
  resetStats();
  running = true;
  startedAt = performance.now();
  lastVideoTime = -1;
  $('startBtn').disabled = true;
  $('stopBtn').disabled = false;
  setStatus('Seedhe khade ho jayein, phir squat shuru karein');
  loop();
}

function stopAll(keepStats = true) {
  running = false;
  cancelAnimationFrame(rafId);
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.pause();
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('startBtn').disabled = false;
  $('stopBtn').disabled = true;
  if (!keepStats) resetStats();
  renderLive();
}

/* ---------------- main loop ---------------- */
function loop() {
  if (!running) return;
  rafId = requestAnimationFrame(loop);
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const t = stream ? (now - startedAt) / 1000 : video.currentTime;
  elapsed = t;

  const res = landmarker.detectForVideo(video, now);
  const lm = res.landmarks && res.landmarks[0];
  ctx.clearRect(0, 0, W, H);

  if (!lm) {
    setStatus('Koi insaan nahi mila. Camera ke saamne side-on khade hon.');
    renderLive();
    return;
  }

  chooseSide(lm);
  const idx = side === 'left' ? LEFT : RIGHT;
  const P = (k) => ({
    x: lm[idx[k]].x * W,
    y: lm[idx[k]].y * H,
    v: lm[idx[k]].visibility ?? 1,
  });
  const sh = P('shoulder');
  const hip = P('hip');
  const kn = P('knee');
  const an = P('ankle');
  const he = P('heel');
  const ft = P('foot');

  if (Math.min(hip.v, kn.v, an.v) < 0.5) {
    setStatus('Poora body nazar aana chahiye (hip, knee, ankle). Thora peeche hatein.');
    renderLive();
    return;
  }

  const kneeAngle = angleDeg(hip, kn, an);
  const lean = torsoLeanDeg(sh, hip);
  const heelD = heelDelta(hip, kn, an, he, ft);

  const rep = analyzer.update({ t, kneeAngle, lean, heelD });
  drawSkeleton({ sh, hip, kn, an, he, ft }, analyzer.angle);

  setStatus(analyzer.phase === 'idle' ? 'Seedhe khade ho jayein, phir squat shuru karein' : '');

  history.push({ t, a: analyzer.angle });
  while (history.length && history[0].t < t - 15) history.shift();

  if (rep) onRep(rep);
  renderLive();
}

function chooseSide(lm) {
  const score = (idx) =>
    [idx.shoulder, idx.hip, idx.knee, idx.ankle, idx.heel, idx.foot].reduce(
      (s, i) => s + (lm[i].visibility ?? 1),
      0
    );
  const l = score(LEFT);
  const r = score(RIGHT);
  // hysteresis so the side doesn't flicker
  if (side === 'left' && r > l + 1) side = 'right';
  else if (side === 'right' && l > r + 1) side = 'left';
}

/* ---------------- rep handling ---------------- */
function onRep(rep) {
  renderReps();
  let msg;
  if (rep.good) {
    msg = 'Good rep!';
    showCue(`Rep ${rep.index}: Good rep! (${rep.score})`);
  } else {
    msg = FLAG_MSG[rep.flags[0]] || 'Form thori behtar karein';
    showCue(`Rep ${rep.index}: ${msg}`, true);
  }
  const clean = analyzer.reps.filter((r) => r.good).length;
  if (analyzer.done) {
    const summary = `Set complete. ${clean} clean reps out of ${target}.`;
    setTimeout(() => showCue(`Set complete: ${clean}/${target} clean reps`, clean < target, 6000), 2700);
    speak(`Rep ${rep.index}. ${rep.good ? 'Good rep.' : englishCue(rep.flags[0])} ${summary}`);
    setStatus('Set complete! Dobara karne ke liye Reset dabayein.');
  } else {
    speak(`Rep ${rep.index}. ${rep.good ? 'Good rep.' : englishCue(rep.flags[0])}`);
  }
}

function englishCue(flag) {
  return (
    { depth: 'Go deeper.', back: 'Keep your chest up.', heels: 'Keep your heels down.' }[flag] ||
    'Check your form.'
  );
}

function resetStats() {
  analyzer.reset();
  analyzer.target = target;
  history = [];
  elapsed = 0;
  showCue('');
  renderReps();
  renderLive();
}

/* ---------------- drawing on the video ---------------- */
function drawSkeleton(p, angle) {
  const X = (x) => (mirror ? W - x : x);
  const line = (a, b, color) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(X(a.x), a.y);
    ctx.lineTo(X(b.x), b.y);
    ctx.stroke();
  };
  ctx.lineWidth = Math.max(3, W / 170);
  ctx.lineCap = 'round';
  line(p.sh, p.hip, '#4ade80');
  line(p.hip, p.kn, '#4ade80');
  line(p.kn, p.an, '#4ade80');
  line(p.an, p.he, '#fb923c');
  line(p.an, p.ft, '#fb923c');
  line(p.he, p.ft, '#fb923c');

  const r = Math.max(4, W / 130);
  ctx.fillStyle = '#ffffff';
  [p.sh, p.hip, p.kn, p.an, p.he, p.ft].forEach((pt) => {
    ctx.beginPath();
    ctx.arc(X(pt.x), pt.y, r, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.font = `700 ${Math.round(W / 26)}px system-ui, sans-serif`;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,.7)';
  ctx.fillStyle = angle <= CONFIG.depthTarget ? '#4ade80' : '#ffffff';
  const label = Math.round(angle) + '°';
  ctx.strokeText(label, X(p.kn.x) + 16, p.kn.y - 10);
  ctx.fillText(label, X(p.kn.x) + 16, p.kn.y - 10);
}

/* ---------------- dashboard ---------------- */
function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}
// knee angle (60..180) -> gauge degrees (0 = right end, 180 = left end)
const toGauge = (v) => ((Math.min(180, Math.max(60, v)) - 60) / 120) * 180;
function arcPath(vFrom, vTo) {
  const [x1, y1] = polar(60, 60, 45, toGauge(vFrom));
  const [x2, y2] = polar(60, 60, 45, toGauge(vTo));
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A 45 45 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}
function initGauge() {
  $('gBg').setAttribute('d', arcPath(180, 60));
  $('gOk').setAttribute('d', arcPath(CONFIG.depthTarget, 60));
  $('depthTarget').textContent = `target ≤${CONFIG.depthTarget}°`;
}

function renderReps() {
  const reps = analyzer.reps;
  const clean = reps.filter((r) => r.good).length;

  $('cleanNum').textContent = clean;
  $('cleanOf').textContent = '/ ' + target;
  $('dots').innerHTML = Array.from({ length: target }, (_, i) => {
    const r = reps[i];
    return `<i class="${r ? (r.good ? 'good' : 'bad') : ''}"></i>`;
  }).join('');

  const avg = reps.length ? Math.round(reps.reduce((s, r) => s + r.score, 0) / reps.length) : null;
  $('scoreNum').textContent = avg ?? '—';
  $('ringFg').style.strokeDasharray = `${((avg ?? 0) / 100) * 213.6} 213.6`;

  $('repGrid').innerHTML = Array.from({ length: target }, (_, i) => {
    const r = reps[i];
    if (!r) {
      return `<div class="rep empty"><div class="rl">REP ${i + 1}</div><div class="rs">&nbsp;</div><div class="rt">&nbsp;</div></div>`;
    }
    const label = r.good
      ? 'GOOD'
      : FLAG_LABEL[r.flags[0]] + (r.flags.length > 1 ? ` +${r.flags.length - 1}` : '');
    return `<div class="rep ${r.good ? 'good' : 'bad'}"><div class="rl">REP ${r.index}</div><div class="rs">${r.score}</div><div class="rt">${label}</div></div>`;
  }).join('');

  $('avgLower').textContent = reps.length
    ? 'avg lowering ' + (reps.reduce((s, r) => s + r.lowerTime, 0) / reps.length).toFixed(1) + 's'
    : 'avg lowering —';
}

function renderLive() {
  // live badge
  const live = $('live');
  live.classList.toggle('off', !running);
  $('liveText').textContent = (running ? 'LIVE ' : 'STOPPED ') + fmtTime(elapsed);

  // depth gauge
  const a = analyzer.angle;
  if (a === null) {
    $('depthVal').textContent = '--°';
    setNeedle(180);
  } else {
    $('depthVal').textContent = Math.round(a) + '°';
    $('depthVal').style.color = a <= CONFIG.depthTarget ? 'var(--green)' : 'var(--text)';
    setNeedle(a);
  }
  drawChart();
}

function setNeedle(v) {
  const [x, y] = polar(60, 60, 38, toGauge(v));
  const n = $('needle');
  n.setAttribute('x2', x.toFixed(1));
  n.setAttribute('y2', y.toFixed(1));
}

function drawChart() {
  const dpr = window.devicePixelRatio || 1;
  const w = chart.clientWidth;
  const h = chart.clientHeight;
  if (chart.width !== Math.round(w * dpr) || chart.height !== Math.round(h * dpr)) {
    chart.width = Math.round(w * dpr);
    chart.height = Math.round(h * dpr);
  }
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.clearRect(0, 0, w, h);

  const padL = 62, padR = 8, padT = 14, padB = 20;
  const T = 15;
  const tNow = history.length ? history[history.length - 1].t : elapsed;
  const t0 = tNow - T;
  const x = (t) => padL + ((t - t0) / T) * (w - padL - padR);
  const Y = (a) => padT + ((190 - a) / 150) * (h - padT - padB);

  cctx.font = '11px system-ui, sans-serif';
  cctx.textBaseline = 'middle';

  // reference lines
  [[170, 'standing'], [CONFIG.depthTarget, 'parallel']].forEach(([ang, name]) => {
    cctx.strokeStyle = 'rgba(125,141,176,.45)';
    cctx.setLineDash([4, 4]);
    cctx.beginPath();
    cctx.moveTo(padL, Y(ang));
    cctx.lineTo(w - padR, Y(ang));
    cctx.stroke();
    cctx.setLineDash([]);
    cctx.fillStyle = '#7d8db0';
    cctx.textAlign = 'left';
    cctx.fillText(name, 4, Y(ang));
  });

  // rep shading
  analyzer.reps.forEach((r) => {
    if (r.tEnd < t0) return;
    const x1 = Math.max(x(r.tStart), padL);
    const x2 = x(r.tEnd);
    cctx.fillStyle = r.good ? 'rgba(74,222,128,.16)' : 'rgba(248,113,113,.18)';
    cctx.fillRect(x1, padT, Math.max(2, x2 - x1), h - padT - padB);
    cctx.fillStyle = r.good ? '#4ade80' : '#f87171';
    cctx.textAlign = 'left';
    cctx.fillText(String(r.index), x1 + 4, padT + 8);
    if (r.tMin >= t0) {
      cctx.beginPath();
      cctx.arc(x(r.tMin), Y(r.minAngle), 3.5, 0, Math.PI * 2);
      cctx.fill();
    }
  });

  // axis labels
  cctx.fillStyle = '#7d8db0';
  cctx.textAlign = 'center';
  [[0, 'now'], [5, '-5s'], [10, '-10s'], [15, '-15s']].forEach(([s, lab]) =>
    cctx.fillText(lab, Math.min(w - 16, Math.max(padL + 8, x(tNow - s))), h - 7)
  );

  if (history.length < 2) {
    cctx.textAlign = 'center';
    cctx.fillText('Movement ka intezar…', w / 2, h / 2);
    return;
  }

  // angle line
  cctx.strokeStyle = '#60a5fa';
  cctx.lineWidth = 2;
  cctx.lineJoin = 'round';
  cctx.beginPath();
  history.forEach((p, i) => {
    const px = x(p.t);
    const py = Y(Math.min(190, Math.max(40, p.a)));
    i ? cctx.lineTo(px, py) : cctx.moveTo(px, py);
  });
  cctx.stroke();
  const last = history[history.length - 1];
  cctx.fillStyle = '#e6edf7';
  cctx.beginPath();
  cctx.arc(x(last.t), Y(Math.min(190, Math.max(40, last.a))), 3.5, 0, Math.PI * 2);
  cctx.fill();
}

/* ---------------- events ---------------- */
$('startBtn').addEventListener('click', startCamera);
$('stopBtn').addEventListener('click', () => {
  stopAll(true);
  setStatus('Stopped. Dobara shuru karne ke liye Start dabayein.');
});
$('resetBtn').addEventListener('click', () => {
  resetStats();
  if (running) setStatus('Seedhe khade ho jayein, phir squat shuru karein');
});
$('targetSel').addEventListener('change', (e) => {
  target = parseInt(e.target.value, 10);
  resetStats();
});
$('fileInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) startFile(f);
  e.target.value = '';
});
video.addEventListener('ended', () => {
  if (!stream && running) {
    stopAll(true);
    setStatus('Video khatam. Result upar dashboard mein dekhein.');
  }
});
window.addEventListener('resize', drawChart);

analyzer.target = target;
initGauge();
renderReps();
renderLive();
