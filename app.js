'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
};

const DEFAULTS = { wpm: 140, size: 44, margin: 6, lh: 1.35, guide: 30, theme: 'dark', align: 'left', mirrorX: false, mirrorY: false, countdown: true, cam: false, facing: 'user', q: '1080', mic: 3 };
let S = { ...DEFAULTS, ...store.get('prompteur.settings', {}) };

const SAMPLE = `Bienvenue dans votre prompteur.

Touchez l'écran pour lancer ou mettre en pause le défilement.

Glissez du doigt vers le haut ou vers le bas pour avancer ou revenir en arrière, même pendant la lecture.

Réglez la vitesse avec les boutons moins et plus. Elle est exprimée en mots par minute, et le temps restant s'affiche en haut de l'écran.

[Respirez. Les indications entre crochets s'affichent en couleur et ne comptent pas dans le temps de lecture.]

Le bouton réglages permet de changer la taille du texte, les marges, la position de la ligne de lecture et le thème, ou d'activer le mode miroir pour un prompteur à vitre.

L'écran reste allumé pendant la lecture.

Bon tournage !`;

// Fenêtre de confirmation maison : confirm()/alert() peuvent bloquer l'écran
// dans une appli installée sur l'écran d'accueil de l'iPhone.
function ask(msg, { ok = 'OK', cancel = 'Annuler', danger = false } = {}) {
  return new Promise(resolve => {
    const d = $('#dialog'), okB = $('#dialog-ok'), noB = $('#dialog-cancel');
    $('#dialog-msg').textContent = msg;
    okB.textContent = ok;
    okB.classList.toggle('danger', danger);
    noB.hidden = !cancel;
    if (cancel) noB.textContent = cancel;
    const done = v => { d.hidden = true; okB.onclick = noB.onclick = null; resolve(v); };
    okB.onclick = () => done(true);
    noB.onclick = () => done(false);
    d.hidden = false;
  });
}

// ---------- Données ----------
let scripts = store.get('prompteur.scripts', null);
if (!Array.isArray(scripts)) scripts = [{ id: uid(), text: SAMPLE, updated: Date.now() }];
scripts = scripts.filter(s => s && s.text && s.text.trim());
const saveScripts = () => store.set('prompteur.scripts', scripts);
saveScripts();
const getScript = id => scripts.find(s => s.id === id);

const stripCues = t => t.replace(/\[[^\]\n]*\]/g, ' ');
const countWords = t => stripCues(t).split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
const titleOf = t => {
  const l = stripCues(t).split('\n').map(x => x.trim()).find(Boolean);
  return l ? (l.length > 60 ? l.slice(0, 57) + '…' : l) : 'Sans titre';
};
const fmt = sec => { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---------- Navigation ----------
let view = 'library';
let current = null;

function show(v, id, push = true) {
  if (view === 'prompter' && v !== 'prompter') leavePrompter();
  if (view === 'editor' && v !== 'editor') leaveEditor();
  view = v;
  if (id !== undefined) current = id;
  $$('.view').forEach(el => el.classList.toggle('active', el.id === v));
  if (v === 'library') renderLibrary();
  if (v === 'editor') enterEditor();
  if (v === 'prompter') enterPrompter();
  if (push) history.pushState({ v, id: current }, '');
}

addEventListener('popstate', e => {
  let st = e.state || { v: 'library' };
  if (st.v !== 'library' && !getScript(st.id)) st = { v: 'library' };
  show(st.v, st.id, false);
});
$$('[data-back]').forEach(b => b.addEventListener('click', () => history.back()));

// Hauteur réelle de l'écran (clavier iOS / barres du navigateur)
const vv = window.visualViewport;
function fitViewport() {
  document.documentElement.style.setProperty('--app-h', (vv ? vv.height : innerHeight) + 'px');
  if (scrollY) scrollTo(0, 0);
}
(vv || window).addEventListener('resize', fitViewport);
fitViewport();

// ---------- Bibliothèque ----------
function renderLibrary() {
  scripts.sort((a, b) => b.updated - a.updated);
  const list = $('#list');
  list.innerHTML = '';
  $('#empty').hidden = scripts.length > 0;
  for (const s of scripts) {
    const w = countWords(s.text);
    const li = document.createElement('li');
    li.className = 'card';
    li.innerHTML = `<button class="card-main"><span class="card-title"></span><span class="card-meta">${w} mots · ≈ ${fmt(w / S.wpm * 60)}</span></button><button class="card-play" aria-label="Lancer">${ICON.play}</button>`;
    li.querySelector('.card-title').textContent = titleOf(s.text);
    li.querySelector('.card-main').onclick = () => show('editor', s.id);
    li.querySelector('.card-play').onclick = () => show('prompter', s.id);
    list.append(li);
  }
}

$('#new').onclick = () => {
  const s = { id: uid(), text: '', updated: Date.now() };
  scripts.push(s);
  show('editor', s.id);
};

// ---------- Éditeur ----------
const ta = $('#text');

function enterEditor() {
  const s = getScript(current);
  ta.value = s.text;
  ta.scrollTop = 0;
  editorStats();
  if (!s.text) ta.focus();
}
function editorStats() {
  const w = countWords(ta.value);
  $('#stats').textContent = `${w} mot${w > 1 ? 's' : ''} · ≈ ${fmt(w / S.wpm * 60)} à ${S.wpm} mots/min`;
  $('#launch').disabled = w === 0;
}
ta.addEventListener('input', () => {
  const s = getScript(current);
  if (!s) return;
  s.text = ta.value;
  s.updated = Date.now();
  saveScripts();
  editorStats();
});
function leaveEditor() {
  ta.blur();
  const s = getScript(current);
  if (s && !s.text.trim()) { scripts = scripts.filter(x => x !== s); saveScripts(); }
}
$('#del').onclick = async () => {
  if (!(await ask('Supprimer ce script ?', { ok: 'Supprimer', danger: true }))) return;
  scripts = scripts.filter(x => x.id !== current);
  saveScripts();
  history.back();
};
$('#launch').onclick = () => show('prompter', current);

// ---------- Prompteur ----------
const pv = $('#prompter'), stage = $('#stage'), ptext = $('#ptext'), sheet = $('#sheet');
const P = { pos: 0, h: 0, words: 0, guideY: 0, lineH: 0, playing: false, counting: false, last: 0, raf: 0, cd: 0, ptr: null, remain: '' };

function enterPrompter() {
  const s = getScript(current);
  ptext.innerHTML = esc(s.text.trim()).replace(/\[([^\]\n]*)\]/g, '<span class="cue">[$1]</span>');
  P.words = countWords(s.text);
  P.pos = 0; P.h = 0;
  pause();
  closeSheet();
  applySettings();
  keepAwake(true);
  if (S.cam) camOn();
  const de = document.documentElement;
  if (de.requestFullscreen && !document.fullscreenElement) de.requestFullscreen().catch(() => {});
}
function leavePrompter() {
  if (isRec()) recStop();
  camStop();
  pause();
  closeSheet();
  keepAwake(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

const maxPos = () => Math.max(0, P.h - P.lineH);
const pxPerSec = () => (P.words ? (S.wpm / 60) * (P.h / P.words) : 0);

function layout() {
  if (view !== 'prompter') return;
  const ratio = P.h ? P.pos / P.h : 0;
  P.h = ptext.offsetHeight;
  P.lineH = S.size * S.lh;
  P.guideY = $('#flip').clientHeight * S.guide / 100;
  P.pos = clamp(ratio * P.h, 0, maxPos());
  render();
}
function render() {
  ptext.style.transform = `translate3d(0,${(P.guideY - P.lineH / 2 - P.pos).toFixed(2)}px,0)`;
  const max = maxPos();
  $('#progress').style.transform = `scaleX(${max ? P.pos / max : 0})`;
  const v = pxPerSec();
  const r = v ? '−' + fmt((max - P.pos) / v) : '';
  if (r !== P.remain) $('#remain').textContent = P.remain = r;
}

function tick(t) {
  if (!P.playing) return;
  const dt = Math.min(0.1, (t - P.last) / 1000);
  P.last = t;
  if (!(P.ptr && P.ptr.moved)) P.pos += pxPerSec() * dt;
  if (P.pos >= maxPos()) { P.pos = maxPos(); render(); pause(); return; }
  render();
  P.raf = requestAnimationFrame(tick);
}
function start() {
  cancelCountdown();
  P.playing = true;
  P.last = performance.now();
  pv.classList.add('playing');
  P.raf = requestAnimationFrame(tick);
  updatePlayBtn();
}
function play() {
  if (!P.words) return;
  if (P.pos >= maxPos() - 1) P.pos = 0;
  closeSheet();
  if (S.countdown && P.pos < 1) countdown(start); else start();
}
function pause() {
  P.playing = false;
  cancelAnimationFrame(P.raf);
  cancelCountdown();
  pv.classList.remove('playing');
  updatePlayBtn();
  render();
}
const toggle = () => (P.playing || P.counting ? pause() : play());

function countdown(done) {
  const el = $('#count');
  let n = 3;
  const showN = () => { el.textContent = n; el.animate?.([{ transform: 'scale(1.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300, easing: 'ease-out' }); };
  P.counting = true;
  el.hidden = false;
  pv.classList.add('playing');
  updatePlayBtn();
  showN();
  P.cd = setInterval(() => { if (--n <= 0) { cancelCountdown(); done(); } else showN(); }, 1000);
}
function cancelCountdown() {
  clearInterval(P.cd);
  P.counting = false;
  $('#count').hidden = true;
}
function updatePlayBtn() { $('#play').innerHTML = P.playing || P.counting ? ICON.pause : ICON.play; }

function nudge(d) { P.pos = clamp(P.pos + d * P.lineH * 2, 0, maxPos()); render(); }

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 900);
}
function setSpeed(v) { S.wpm = clamp(v, 40, 300); applySettings(); toast(`${S.wpm} mots/min`); }

$('#play').onclick = toggle;
$('#restart').onclick = () => { pause(); P.pos = 0; render(); };
$('#slower').onclick = () => setSpeed(S.wpm - 10);
$('#faster').onclick = () => setSpeed(S.wpm + 10);

// Toucher : tap = lecture/pause, glisser = déplacer le texte
stage.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  P.ptr = { y: e.clientY, pos: P.pos, moved: false };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', e => {
  const p = P.ptr;
  if (!p) return;
  let dy = e.clientY - p.y;
  if (!p.moved) {
    if (Math.abs(dy) < 10) return;
    p.moved = true;
    p.y = e.clientY;
    dy = 0;
  }
  P.pos = clamp(p.pos - dy * (S.mirrorY ? -1 : 1), 0, maxPos());
  render();
});
const endPtr = isTap => () => {
  const p = P.ptr;
  P.ptr = null;
  if (!p) return;
  P.last = performance.now();
  if (isTap && !p.moved) sheetOpen() ? closeSheet() : toggle();
};
stage.addEventListener('pointerup', endPtr(true));
stage.addEventListener('pointercancel', endPtr(false));
stage.addEventListener('wheel', e => {
  e.preventDefault();
  P.pos = clamp(P.pos + e.deltaY * (S.mirrorY ? -1 : 1), 0, maxPos());
  render();
}, { passive: false });

// Clavier et télécommandes Bluetooth (qui envoient espace / flèches / page suivante)
document.addEventListener('keydown', e => {
  if (view !== 'prompter' || !$('#result').hidden || !$('#dialog').hidden) return;
  const k = e.key;
  if (k === ' ' || k === 'Enter') toggle();
  else if (k === 'ArrowDown' || k === 'PageDown') nudge(1);
  else if (k === 'ArrowUp' || k === 'PageUp') nudge(-1);
  else if (k === 'ArrowRight' || k === '+') setSpeed(S.wpm + 10);
  else if (k === 'ArrowLeft' || k === '-') setSpeed(S.wpm - 10);
  else if (k === 'Escape') { if (sheetOpen()) closeSheet(); else history.back(); }
  else return;
  e.preventDefault();
  if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
});

new ResizeObserver(() => layout()).observe(stage);

// ---------- Réglages ----------
const sheetOpen = () => sheet.classList.contains('open');
const closeSheet = () => sheet.classList.remove('open');
$('#settings').onclick = () => (sheetOpen() ? closeSheet() : sheet.classList.add('open'));
$('#sheet-close').onclick = closeSheet;

const OUT = { wpm: v => v + ' mots/min', size: v => v + ' px', margin: v => v + ' %', lh: v => (+v).toFixed(2), guide: v => v + ' %', mic: v => '×' + v };

function applySettings() {
  const st = pv.style;
  st.setProperty('--size', S.size + 'px');
  st.setProperty('--lh', S.lh);
  st.setProperty('--margin', S.margin + 'vw');
  st.setProperty('--guide', S.guide + '%');
  pv.classList.remove('t-dark', 't-light', 't-yellow');
  pv.classList.add('t-' + S.theme);
  ptext.style.textAlign = S.align;
  pv.classList.toggle('cam', S.cam);
  $('#cam-btn').classList.toggle('on', S.cam);
  $('#cam-flip').hidden = $('#rec').hidden = !S.cam;
  $('#flip').style.transform = S.cam ? 'none' : `scale(${S.mirrorX ? -1 : 1},${S.mirrorY ? -1 : 1})`;
  $('#speed').textContent = S.wpm;
  if (C.audio) C.audio.gain.gain.value = S.mic;
  store.set('prompteur.settings', S);
  syncSheet();
  layout();
}
function syncSheet() {
  $$('#sheet [data-k]').forEach(el => {
    const k = el.dataset.k;
    if (el.type === 'range') el.value = S[k];
    else if (el.type === 'checkbox') el.checked = S[k];
    else [...el.children].forEach(b => b.classList.toggle('on', b.dataset.v === S[k]));
  });
  $$('#sheet output[data-o]').forEach(o => { o.textContent = OUT[o.dataset.o](S[o.dataset.o]); });
}
$$('#sheet input[type=range]').forEach(el => el.addEventListener('input', () => { S[el.dataset.k] = +el.value; applySettings(); }));
$$('#sheet input[type=checkbox]').forEach(el => el.addEventListener('change', () => { S[el.dataset.k] = el.checked; applySettings(); }));
$$('#sheet .seg button').forEach(b => b.addEventListener('click', () => {
  const k = b.parentNode.dataset.k;
  if (S[k] === b.dataset.v) return;
  S[k] = b.dataset.v;
  applySettings();
  if (k === 'q' && S.cam && !isRec()) camOn();
}));
$('#reset').onclick = () => { S = { ...DEFAULTS }; applySettings(); };

// ---------- Écran toujours allumé ----------
let lock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !lock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (isRec()) recStop();
    pause();
  } else if (view === 'prompter') {
    keepAwake(true);
    if (AC && AC.state !== 'running') AC.resume().catch(() => {});
    const track = C.stream && C.stream.getVideoTracks()[0];
    if (S.cam && (!track || track.readyState === 'ended')) camOn();
  }
});

// ---------- Caméra et enregistrement ----------
const camV = $('#cam');
const C = { stream: null, rec: null, chunks: [], t0: 0, timer: 0, blob: null, url: '', saved: false, req: 0 };
const MIME = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
  .find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
const isRec = () => !!C.rec && C.rec.state === 'recording';

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
  $('#cam-btn').hidden = true;
  S.cam = false;
}

// ---------- Son : amplification maison (compresseur + volume + limiteur) ----------
// iOS exige que le moteur audio démarre pendant un toucher : audioCtx() est appelé dans les gestes.
let AC = null;
function audioCtx() {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state !== 'running') AC.resume().catch(() => {});
  } catch { AC = null; }
  return AC;
}
const setParams = (node, params) => { for (const k in params) node[k].value = params[k]; return node; };
function buildAudio() {
  teardownAudio();
  const tracks = C.stream ? C.stream.getAudioTracks() : [];
  if (!AC || !tracks.length) return;
  try {
    const src = AC.createMediaStreamSource(new MediaStream(tracks));
    const comp = setParams(AC.createDynamicsCompressor(), { threshold: -24, knee: 20, ratio: 3, attack: 0.005, release: 0.25 });
    const gain = AC.createGain();
    gain.gain.value = S.mic;
    const lim = setParams(AC.createDynamicsCompressor(), { threshold: -4, knee: 0, ratio: 20, attack: 0.001, release: 0.1 });
    const an = AC.createAnalyser();
    an.fftSize = 1024;
    const dest = AC.createMediaStreamDestination();
    src.connect(comp).connect(gain).connect(lim);
    lim.connect(dest);
    lim.connect(an);
    C.audio = { src, gain, lim, an, dest, buf: new Float32Array(an.fftSize) };
  } catch { C.audio = null; }
}
function teardownAudio() {
  if (!C.audio) return;
  try { C.audio.src.disconnect(); C.audio.lim.disconnect(); } catch {}
  C.audio = null;
}
// Barre de niveau du micro (dans les réglages et pendant l'enregistrement)
setInterval(() => {
  if (!C.audio || view !== 'prompter' || !(sheetOpen() || isRec())) return;
  const { an, buf } = C.audio;
  an.getFloatTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  const db = 20 * Math.log10(peak || 1e-6);
  const color = db > -2 ? '#ff3b30' : db > -24 ? '#34c759' : '#ffb020';
  $$('.meter i').forEach(i => { i.style.width = clamp((db + 50) * 2, 0, 100) + '%'; i.style.background = color; });
}, 100);

async function camOn() {
  if (!$('#result').hidden) return; // pas de caméra pendant la relecture
  audioCtx();
  const req = ++C.req;
  camStop();
  const [w, h] = S.q === '720' ? [1280, 720] : [1920, 1080];
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: S.facing, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30, max: 30 } },
      // Sans ces options, le micro passe en mode « appel téléphonique » : son étouffé et qui pompe.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    if (req !== C.req) return;
    S.cam = false;
    applySettings();
    ask('Impossible d’accéder à la caméra. Autorisez la caméra et le micro dans Réglages > Safari, puis réessayez.', { cancel: null });
    return;
  }
  // L'utilisateur a quitté ou coupé la caméra pendant la demande d'autorisation
  if (req !== C.req || view !== 'prompter' || !S.cam) { stream.getTracks().forEach(t => t.stop()); return; }
  C.stream = stream;
  buildAudio();
  camV.srcObject = stream;
  camV.classList.toggle('mirror', S.facing === 'user');
  camV.play().catch(() => {});
}
function camStop() {
  teardownAudio();
  if (C.stream) C.stream.getTracks().forEach(t => t.stop());
  C.stream = null;
  camV.srcObject = null;
}

$('#cam-btn').onclick = () => {
  if (isRec()) return;
  S.cam = !S.cam;
  applySettings();
  if (S.cam) camOn(); else { C.req++; camStop(); }
};
$('#cam-flip').onclick = () => {
  if (isRec()) return;
  S.facing = S.facing === 'user' ? 'environment' : 'user';
  applySettings();
  camOn();
};

function recTick() {
  $('#rec-clock').textContent = '● ' + fmt((Date.now() - C.t0) / 1000);
}
function recStart() {
  if (!C.stream) { toast('Caméra pas encore prête'); return; }
  if (P.pos >= maxPos() - 1) P.pos = 0;
  closeSheet();
  const go = () => {
    if (!C.stream) return;
    C.chunks = [];
    const opts = { videoBitsPerSecond: S.q === '720' ? 5e6 : 8e6, audioBitsPerSecond: 128000 };
    if (MIME) opts.mimeType = MIME;
    // Son amplifié si le moteur audio tourne ; sinon son brut (jamais de vidéo muette).
    const boosted = C.audio && AC && AC.state === 'running';
    const stream = boosted ? new MediaStream([...C.stream.getVideoTracks(), ...C.audio.dest.stream.getAudioTracks()]) : C.stream;
    try { C.rec = new MediaRecorder(stream, opts); }
    catch { C.rec = new MediaRecorder(stream); }
    C.rec.ondataavailable = e => { if (e.data && e.data.size) C.chunks.push(e.data); };
    C.rec.onstop = recDone;
    C.rec.start(); // sans découpage : plus fiable sur Safari
    C.t0 = Date.now();
    recTick();
    C.timer = setInterval(recTick, 500);
    $('#rec').classList.add('on');
    $('#rec-time').hidden = false;
    start();
  };
  if (S.countdown) countdown(go); else go();
}
function recStop() {
  if (isRec()) C.rec.stop();
  pause();
}
function recDone() {
  clearInterval(C.timer);
  $('#rec').classList.remove('on');
  $('#rec-time').hidden = true;
  const blob = new Blob(C.chunks, { type: (C.rec && C.rec.mimeType) || MIME || 'video/mp4' });
  C.chunks = [];
  C.rec = null;
  if (!blob.size) { toast('L’enregistrement a échoué'); return; }
  // On libère la caméra pendant la relecture : caméra + lecture vidéo en même temps peuvent figer l'iPhone.
  C.req++;
  camStop();
  if (C.url) URL.revokeObjectURL(C.url);
  C.blob = blob;
  C.saved = false;
  C.url = URL.createObjectURL(blob);
  $('#result-video').src = C.url;
  $('#result').hidden = false;
}
function closeResult() {
  $('#result').hidden = true;
  const v = $('#result-video');
  v.pause();
  v.removeAttribute('src');
  v.load();
  if (C.url) URL.revokeObjectURL(C.url);
  C.url = '';
  C.blob = null;
  if (S.cam && view === 'prompter') camOn();
}

$('#rec').onclick = () => {
  audioCtx();
  if (isRec()) recStop();
  else if (P.counting) pause();
  else recStart();
};
$('#save-video').onclick = async () => {
  if (!C.blob) return;
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const ext = C.blob.type.includes('mp4') ? 'mp4' : 'webm';
  const name = `prompteur-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
  const file = new File([C.blob], name, { type: C.blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); C.saved = true; toast('C’est fait'); }
    catch (e) { if (e.name !== 'AbortError') toast('Partage impossible'); }
  } else {
    const a = document.createElement('a');
    a.href = C.url;
    a.download = name;
    a.click();
    C.saved = true;
  }
};
$('#discard').onclick = async () => {
  if (await ask('Supprimer cette vidéo ?', { ok: 'Supprimer', danger: true })) closeResult();
};
$('#result-done').onclick = async () => {
  if (!C.saved && !(await ask('Cette vidéo n’a pas été enregistrée dans Photos. La supprimer ?', { ok: 'Supprimer', cancel: 'Garder', danger: true }))) return;
  closeResult();
};

// ---------- Installation ----------
const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
const banner = $('#install');
let installEvt = null;
if (!standalone && !store.get('prompteur.noInstall', false)) {
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    $('#install-txt').textContent = 'Pour installer : touchez Partager, puis « Sur l’écran d’accueil ».';
    banner.hidden = false;
  }
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvt = e;
    $('#install-txt').textContent = 'Installez le prompteur sur votre téléphone.';
    $('#install-go').hidden = false;
    banner.hidden = false;
  });
}
$('#install-go').onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null;
  banner.hidden = true;
};
$('#install-x').onclick = () => { banner.hidden = true; store.set('prompteur.noInstall', true); };

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- Démarrage ----------
history.replaceState({ v: 'library' }, '');
applySettings();
updatePlayBtn();
renderLibrary();
