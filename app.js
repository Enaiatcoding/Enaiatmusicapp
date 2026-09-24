"use strict";
const $ = id => document.getElementById(id);
const audio = $("audio");
let tracks = [], order = [], idx = -1, shuffle = false, repeat = 0, curURL = null;

/* ---------- IndexedDB (songs saved on the device, work offline) ---------- */
const dbp = new Promise((res, rej) => {
  const r = indexedDB.open("enaiat-music", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("songs", { keyPath: "id", autoIncrement: true });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const store = async mode => (await dbp).transaction("songs", mode).objectStore("songs");
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function load() {
  tracks = await req((await store("readonly")).getAll());
  render();
}
async function addFiles(files) {
  let added = 0;
  const list = files.filter(f => f.type.startsWith("audio") || /\.(mp3|wav|ogg|m4a|aac|flac|opus|weba|mp4)$/i.test(f.name));
  if (!list.length) return toast("No audio files found");
  for (const f of list) {
    toast("Adding " + (added + 1) + " of " + list.length + "…", true);
    const name = f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ");
    await req((await store("readwrite")).add({ name, type: f.type, size: f.size, blob: f }));
    added++;
  }
  await load();
  toast(added + (added === 1 ? " song added" : " songs added"));
}
async function removeTrack(id) {
  const wasPlaying = tracks[idx] && tracks[idx].id === id;
  await req((await store("readwrite")).delete(id));
  if (wasPlaying) { audio.pause(); audio.removeAttribute("src"); idx = -1; setInfo(); }
  await load();
  idx = tracks.findIndex(t => t.id === (window._cur || -1)); render();
}

/* ---------- UI ---------- */
let toastT;
function toast(msg, keep) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); if (!keep) toastT = setTimeout(() => t.classList.remove("show"), 2200);
}
const ICON = {
  play: '<svg viewBox="0 0 24 24" class="fill"><path d="M7 4v16l14-8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" class="fill"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>'
};
const fmt = s => isFinite(s) ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "0:00";
function render() {
  const q = $("search").value.trim().toLowerCase();
  const ul = $("tracks"); ul.innerHTML = "";
  tracks.forEach((t, i) => {
    if (q && !t.name.toLowerCase().includes(q)) return;
    const li = document.createElement("li");
    if (i === idx) li.className = "now";
    li.innerHTML = `<div class="n">${i === idx && !audio.paused ? "♫" : i + 1}</div><div class="t"><b></b><small>${(t.size / 1048576).toFixed(1)} MB</small></div><button class="x" aria-label="Delete song"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>`;
    li.querySelector("b").textContent = t.name;
    li.onclick = () => play(i);
    li.querySelector(".x").onclick = e => { e.stopPropagation(); if (confirm("Delete this song?")) removeTrack(t.id); };
    ul.appendChild(li);
  });
  $("count").textContent = tracks.length + (tracks.length === 1 ? " song" : " songs");
  $("empty").style.display = tracks.length ? "none" : "block";
}
function setInfo() {
  const t = tracks[idx];
  $("title").textContent = t ? t.name : "No song playing";
  $("sub").textContent = t ? "Enaiat Music App" : "Add music to get started";
  document.title = t ? t.name + " · Enaiat Music App" : "Enaiat Music App";
}
function syncPlay() {
  $("play").innerHTML = audio.paused ? ICON.play : ICON.pause;
  $("play").classList.toggle("live", !audio.paused);
  if ("mediaSession" in navigator) { navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing"; msPos(); }
  $("disc").classList.toggle("on", !audio.paused);
  render();
}

/* ---------- Playback ---------- */
function play(i) {
  if (!tracks[i]) return;
  idx = i; window._cur = tracks[i].id;
  if (curURL) URL.revokeObjectURL(curURL);
  curURL = URL.createObjectURL(tracks[i].blob);
  audio.src = curURL;
  setInfo(); setupViz();
  audio.play().catch(() => {});
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: tracks[i].name, artist: "Enaiat Music App", artwork: [{ src: "logo.png", sizes: "512x512", type: "image/png" }] });
  }
}
function step(d) {
  if (!tracks.length) return;
  if (shuffle && d > 0) return play(Math.floor(Math.random() * tracks.length));
  play((idx + d + tracks.length) % tracks.length);
}
$("play").onclick = () => {
  if (idx < 0 && tracks.length) return play(0);
  audio.paused ? audio.play() : audio.pause();
};
$("next").onclick = () => step(1);
$("prev").onclick = () => audio.currentTime > 3 ? (audio.currentTime = 0) : step(-1);
$("shuffle").onclick = e => { shuffle = !shuffle; e.currentTarget.classList.toggle("on", shuffle); };
$("repeat").onclick = e => {
  repeat = (repeat + 1) % 3;
  e.currentTarget.classList.toggle("on", repeat > 0);
  e.currentTarget.dataset.mode = repeat;
};
audio.onplay = audio.onpause = syncPlay;
audio.onended = () => {
  if (repeat === 2) { audio.currentTime = 0; audio.play(); }
  else if (repeat === 1 || idx < tracks.length - 1 || shuffle) step(1);
  else syncPlay();
};
audio.ontimeupdate = () => {
  if (audio.duration) $("seek").value = (audio.currentTime / audio.duration) * 1000;
  $("cur").textContent = fmt(audio.currentTime);
};
function msPos() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState || !isFinite(audio.duration)) return;
  try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate || 1 }); } catch (e) {}
}
audio.onloadedmetadata = () => { $("dur").textContent = fmt(audio.duration); msPos(); };
audio.onseeked = msPos;
$("seek").oninput = e => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; };
let lastVol = 0.8;
const VOL = {
  on: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
  off: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/></svg>'
};
function syncVol() {
  const off = audio.muted || audio.volume === 0;
  $("mute").innerHTML = off ? VOL.off : VOL.on;
  $("vol").value = off ? 0 : audio.volume;
}
$("mute").onclick = () => {
  if (audio.muted || audio.volume === 0) { audio.muted = false; if (audio.volume === 0) audio.volume = lastVol; }
  else { lastVol = audio.volume; audio.muted = true; }
  syncVol();
};
$("vol").oninput = e => {
  audio.muted = false; audio.volume = +e.target.value;
  if (audio.volume) lastVol = audio.volume;
  syncVol(); try { localStorage.setItem("enaiat-vol", audio.volume); } catch (x) {}
};
try { audio.volume = parseFloat(localStorage.getItem("enaiat-vol") ?? "0.8"); } catch (x) { audio.volume = 0.8; }
if (isNaN(audio.volume)) audio.volume = 0.8;
{ const v = audio.volume; audio.volume = 0.37; if (Math.abs(audio.volume - 0.37) > .01) $("vol").style.display = "none"; audio.volume = v; }
syncVol();
$("search").oninput = render;
$("folderInput").onchange = e => { const f = Array.from(e.target.files); e.target.value = ""; addFiles(f); };
$("fileInput").onchange = e => { const f = Array.from(e.target.files); e.target.value = ""; addFiles(f); };
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => audio.play());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
  navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
}
if ("mediaSession" in navigator) {
  const hd = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
  hd("seekto", d => { audio.currentTime = d.seekTime; });
  hd("seekbackward", d => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); });
  hd("seekforward", d => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); });
  hd("stop", () => { audio.pause(); audio.currentTime = 0; });
}
addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" && e.target.type !== "range") return;
  if (e.code === "Space") { e.preventDefault(); $("play").click(); }
  if (e.code === "ArrowRight") step(1);
  if (e.code === "ArrowLeft") step(-1);
});
addEventListener("dragover", e => e.preventDefault());
addEventListener("drop", e => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); });

/* ---------- Visualizer ---------- */
let actx, analyser, srcNode;
const COARSE = matchMedia("(pointer:coarse)").matches;
function setupViz() {
  if (COARSE) return;
  if (actx) { actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = actx.createAnalyser(); analyser.fftSize = 128;
    srcNode = actx.createMediaElementSource(audio);
    srcNode.connect(analyser); analyser.connect(actx.destination);
  } catch (e) { actx = null; }
}
let cols = ["#22d3ee", "#3b5bff", "#c04cff"];
const cv = $("viz"), cx = cv.getContext("2d");
function draw() {
  requestAnimationFrame(draw);
  const w = cv.width, h = cv.height;
  cx.clearRect(0, 0, w, h);
  const n = 40, bw = w / n;
  const g = cx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, cols[0]); g.addColorStop(.5, cols[1]); g.addColorStop(1, cols[2]);
  cx.fillStyle = g;
  const data = new Uint8Array(64);
  if (!audio.paused) {
    if (analyser) analyser.getByteFrequencyData(data);
    else { const t = performance.now(); for (let i = 0; i < 64; i++) data[i] = (Math.sin(t / 260 + i * .55) * .5 + .5) * (150 + 80 * Math.sin(t / 700 + i * .3)); }
  }
  for (let i = 0; i < n; i++) {
    const v = data[i] / 255, bh = Math.max(4, v * h);
    cx.beginPath(); cx.roundRect(i * bw + 2, h - bh, bw - 4, bh, 3); cx.fill();
  }
}
draw();

/* ---------- Weather / particle effects ---------- */
const fx = $("fx"), fc = fx.getContext("2d");
let fxMode = "", parts = [], W = 0, H = 0, flash = 0, fxRaf;
const R = (a, b) => a + Math.random() * (b - a);
const CONF = ["#ff5f9e", "#ffd93d", "#4dd0ff", "#7cff6b", "#c084fc"];
function fxResize() { const d = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; fx.width = W * d; fx.height = H * d; fc.setTransform(d, 0, 0, d, 0, 0); }
addEventListener("resize", fxResize); fxResize();
const circ = (x, y, r) => { fc.beginPath(); fc.arc(x, y, r, 0, 7); };
const FX = {
  snow: { n: 110, make: () => ({ x: R(0, W), y: R(-H, H), r: R(1.5, 4), vy: R(.6, 2), vx: R(-.4, .4), p: R(0, 6) }),
    step(p) { p.p += .02; p.x += p.vx + Math.sin(p.p) * .5; p.y += p.vy; if (p.y > H + 5) { p.y = -5; p.x = R(0, W); } },
    draw(p) { fc.fillStyle = "rgba(255,255,255,.85)"; circ(p.x, p.y, p.r); fc.fill(); } },
  rain: { n: 150, make: () => ({ x: R(0, W), y: R(0, H), l: R(12, 24), vy: R(14, 24) }),
    step(p) { p.y += p.vy; p.x -= 1.5; if (p.y > H) { p.y = -24; p.x = R(0, W + 40); } },
    draw(p) { fc.strokeStyle = "rgba(170,210,255,.45)"; fc.lineWidth = 1; fc.beginPath(); fc.moveTo(p.x, p.y); fc.lineTo(p.x - 1.5, p.y + p.l); fc.stroke(); } },
  sakura: { n: 45, make: () => ({ x: R(0, W), y: R(-H, H), r: R(4, 8), vy: R(.7, 1.5), vx: R(.3, 1), a: R(0, 6), va: R(-.03, .03), p: R(0, 6) }),
    step(p) { p.p += .02; p.x += p.vx + Math.sin(p.p); p.y += p.vy; p.a += p.va; if (p.y > H + 10 || p.x > W + 10) { p.y = -10; p.x = R(-50, W); } },
    draw(p) { fc.save(); fc.translate(p.x, p.y); fc.rotate(p.a); fc.fillStyle = "rgba(255,182,210,.85)"; fc.beginPath(); fc.ellipse(0, 0, p.r, p.r * .55, 0, 0, 7); fc.fill(); fc.restore(); } },
  fireflies: { n: 45, make: () => ({ x: R(0, W), y: R(0, H), vx: R(-.4, .4), vy: R(-.4, .4), p: R(0, 6) }),
    step(p) { p.p += .03; p.x += p.vx + Math.sin(p.p) * .3; p.y += p.vy + Math.cos(p.p) * .3; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1; },
    draw(p) { fc.shadowBlur = 14; fc.shadowColor = "#eaff7a"; fc.fillStyle = `rgba(234,255,122,${.35 + .55 * Math.abs(Math.sin(p.p))})`; circ(p.x, p.y, 2.5); fc.fill(); fc.shadowBlur = 0; } },
  bubbles: { n: 40, make: () => ({ x: R(0, W), y: R(0, H), r: R(4, 18), vy: R(.4, 1.4), p: R(0, 6) }),
    step(p) { p.p += .02; p.x += Math.sin(p.p) * .5; p.y -= p.vy; if (p.y < -20) { p.y = H + 20; p.x = R(0, W); } },
    draw(p) { fc.strokeStyle = "rgba(255,255,255,.45)"; fc.fillStyle = "rgba(255,255,255,.08)"; fc.lineWidth = 1.5; circ(p.x, p.y, p.r); fc.fill(); fc.stroke(); } },
  confetti: { n: 80, make: () => ({ x: R(0, W), y: R(-H, H), w: R(5, 10), h: R(3, 6), vy: R(1, 3), a: R(0, 6), va: R(-.1, .1), c: CONF[Math.floor(R(0, 5))] }),
    step(p) { p.y += p.vy; p.a += p.va; p.x += Math.sin(p.a) * .6; if (p.y > H + 10) { p.y = -10; p.x = R(0, W); } },
    draw(p) { fc.save(); fc.translate(p.x, p.y); fc.rotate(p.a); fc.fillStyle = p.c; fc.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); fc.restore(); } },
  warp: { n: 140, make: () => ({ a: R(0, 6.28), d: R(2, Math.max(W, H) / 2) }),
    step(p) { p.d *= 1.035; if (p.d > Math.max(W, H)) { p.d = R(2, 12); p.a = R(0, 6.28); } },
    draw(p) { const cx = W / 2, cy = H / 2, c = Math.cos(p.a), s = Math.sin(p.a); fc.strokeStyle = `rgba(200,220,255,${Math.min(1, p.d / 200)})`; fc.lineWidth = Math.min(3, p.d / 120 + .5); fc.beginPath(); fc.moveTo(cx + c * p.d, cy + s * p.d); fc.lineTo(cx + c * p.d * 1.06, cy + s * p.d * 1.06); fc.stroke(); } },
  embers: { n: 70, make: () => ({ x: R(0, W), y: R(0, H), r: R(1, 3), vy: R(.6, 2), p: R(0, 6) }),
    step(p) { p.p += .05; p.x += Math.sin(p.p) * .6; p.y -= p.vy; if (p.y < -10) { p.y = H + 10; p.x = R(0, W); } },
    draw(p) { fc.fillStyle = `rgba(255,${Math.floor(R(100, 190))},40,${Math.max(0, p.y / H)})`; circ(p.x, p.y, p.r); fc.fill(); } }
};
FX.storm = FX.rain;
function fxLoop() {
  fxRaf = requestAnimationFrame(fxLoop);
  if (document.hidden) return;
  fc.clearRect(0, 0, W, H);
  const e = FX[fxMode]; if (!e) return;
  for (const p of parts) { e.step(p); e.draw(p); }
  if (fxMode === "storm") {
    if (Math.random() < .006) flash = 1;
    if (flash > .02) { fc.fillStyle = `rgba(200,220,255,${flash * .3})`; fc.fillRect(0, 0, W, H); flash *= .88; }
  }
}
function setFx(k) {
  cancelAnimationFrame(fxRaf); fxMode = k; parts = []; fc.clearRect(0, 0, W, H);
  const e = FX[k];
  if (!e || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  const n = Math.round(e.n * (innerWidth <= 820 ? .55 : 1));
  for (let i = 0; i < n; i++) parts.push(e.make());
  fxLoop();
}

/* ---------- Themes ---------- */
const THEMES = [
  ["enaiat", "Enaiat Blue", "#22d3ee,#3b5bff,#c04cff"],
  ["disco", "Disco Party", "#ff3df2,#ffd400,#00e5ff", 1],
  ["neon", "Neon Lights", "#39ff14,#00f0ff,#ff00e6", 1],
  ["sunset", "Sunset", "#ffb347,#ff5e62,#b24bf3"],
  ["forest", "Forest", "#7cffb2,#1fbf75,#0fa3b1"],
  ["rose", "Rose", "#ffc2d9,#ff6fa5,#c86bff"],
  ["light", "Daylight", "#0ea5e9,#4f46e5,#c026d3"],
  ["rgb", "RGB Gaming", "#ff2e2e,#2eff6a,#2e6bff", 1],
  ["synth", "Synthwave", "#ff71ce,#b967ff,#01cdfe", 1],
  ["aurora", "Aurora", "#5fffc4,#38bdf8,#a78bfa", 1],
  ["galaxy", "Galaxy", "#a78bfa,#6d28d9,#f472b6", 1],
  ["cyber", "Cyberpunk", "#fcee0a,#ff2a6d,#05d9e8"],
  ["matrix", "Matrix", "#00ff41,#00c030,#008f11"],
  ["lava", "Lava", "#ffd200,#ff5a00,#e60023"],
  ["ocean", "Deep Ocean", "#4df3ff,#1e90ff,#00c6a7"],
  ["gold", "Royal Gold", "#fff1a8,#f5b301,#b8860b"],
  ["candy", "Candy", "#ff5fa2,#a855f7,#38bdf8"],
  ["ice", "Ice", "#00b4d8,#0077b6,#7209b7"],
  ["snow", "Falling Snow", "#cfeaff,#6db3ff,#b9a7ff", 1],
  ["rain", "Rainy Night", "#7fd6ff,#3b82f6,#64748b", 1],
  ["storm", "Thunderstorm", "#a5b4fc,#6366f1,#facc15", 1],
  ["sakura", "Sakura Petals", "#ffc6dd,#ff8fb8,#ffd6a5", 1],
  ["fireflies", "Fireflies", "#eaff7a,#7bd94a,#2fb5a0", 1],
  ["bubbles", "Bubbles", "#9df0ff,#3bb8ff,#7c8cff", 1],
  ["confetti", "Confetti Party", "#ff5f9e,#ffd93d,#4dd0ff", 1],
  ["warp", "Star Warp", "#000000,#7aa2ff,#c084fc", 1],
  ["embers", "Fire Embers", "#ffcf5a,#ff6a00,#ff2d2d", 1],
  ["amoled", "Pure Black", "#ffffff,#9aa4d6,#5b6bff"]
];
function setTheme(k) {
  document.documentElement.dataset.theme = k;
  setFx(k);
  try { localStorage.setItem("enaiat-theme", k); } catch (e) {}
  const cs = getComputedStyle(document.documentElement);
  cols = ["--a1", "--a2", "--a3"].map(v => cs.getPropertyValue(v).trim());
  setTimeout(() => { document.querySelector("meta[name=theme-color]").content = getComputedStyle(document.body).backgroundColor; }, 600);
  const c = "#050816";
  document.querySelector('meta[name=theme-color]').content = c;
  document.querySelectorAll(".th").forEach(b => b.classList.toggle("sel", b.dataset.k === k));
}
THEMES.forEach(([k, name, cols, live]) => {
  const b = document.createElement("button");
  b.className = "th"; b.dataset.k = k; b.innerHTML = name + (live ? "<em>Live</em>" : "");
  b.style.background = `linear-gradient(135deg,${cols})`;
  b.onclick = () => { setTheme(k); $("sheet").hidden = true; toast(name + " theme on"); };
  $("themes").appendChild(b);
});
const FLAGS = [
  ["af", "Afghanistan", "linear-gradient(90deg,#000 0 33.3%,#d32011 33.3% 66.6%,#007a36 66.6%)", "#ff4b3a", "#00b85a", "#ffd166"],
  ["ir", "Iran", "linear-gradient(180deg,#239f40 0 33.3%,#fff 33.3% 66.6%,#da0000 66.6%)", "#2fd06b", "#e63946", "#9cf0b8"],
  ["tj", "Tajikistan", "linear-gradient(180deg,#c00 0 28.5%,#fff 28.5% 71.5%,#060 71.5%)", "#ff3b3b", "#2fbf5f", "#ffd23f"],
  ["uz", "Uzbekistan", "linear-gradient(180deg,#0099b5 0 33%,#fff 33% 67%,#1eb53a 67%)", "#22c3e0", "#1eb53a", "#ff4d4d"],
  ["pk", "Pakistan", "linear-gradient(90deg,#fff 0 25%,#01411c 25%)", "#2fbf6a", "#0b8f4a", "#7ee2a1"],
  ["in", "India", "linear-gradient(180deg,#f93 0 33.3%,#fff 33.3% 66.6%,#138808 66.6%)", "#ff9933", "#138808", "#4d7cff"],
  ["tr", "Turkey", "radial-gradient(circle at 36% 50%,#fff 0 13%,transparent 14%),#e30a17", "#ff3b4a", "#e30a17", "#ff8a95"],
  ["sa", "Saudi Arabia", "linear-gradient(#006c35,#006c35)", "#2fd07a", "#00a651", "#8cf0b5"],
  ["ae", "UAE", "linear-gradient(90deg,#f00 0 25%,transparent 25%),linear-gradient(180deg,#00732f 0 33%,#fff 33% 67%,#000 67%)", "#ff3b3b", "#00a651", "#9aa4d6"],
  ["us", "USA", "linear-gradient(90deg,#3c3b6e 0 40%,transparent 40%),repeating-linear-gradient(180deg,#b22234 0 7.7%,#fff 7.7% 15.4%)", "#ff4d5e", "#3c5bd6", "#8fa3ff"],
  ["uk", "United Kingdom", "linear-gradient(90deg,transparent 45%,#c8102e 45% 55%,transparent 55%),linear-gradient(180deg,transparent 42%,#c8102e 42% 58%,transparent 58%),#012169", "#ff4d5e", "#2a4bd6", "#8fa3ff"],
  ["de", "Germany", "linear-gradient(180deg,#000 0 33.3%,#d00 33.3% 66.6%,#ffce00 66.6%)", "#ff5252", "#ffce00", "#9aa0a6"],
  ["fr", "France", "linear-gradient(90deg,#0055a4 0 33.3%,#fff 33.3% 66.6%,#ef4135 66.6%)", "#4d7cff", "#e63946", "#9fb7ff"],
  ["se", "Sweden", "linear-gradient(90deg,transparent 30%,#fecc02 30% 43%,transparent 43%),linear-gradient(180deg,transparent 42%,#fecc02 42% 58%,transparent 58%),#006aa7", "#2aa4e8", "#fecc02", "#7ad0ff"],
  ["it", "Italy", "linear-gradient(90deg,#009246 0 33.3%,#fff 33.3% 66.6%,#ce2b37 66.6%)", "#2fd06b", "#e63946", "#a7f0c0"],
  ["ru", "Russia", "linear-gradient(180deg,#fff 0 33.3%,#0039a6 33.3% 66.6%,#d52b1e 66.6%)", "#3a6bff", "#d52b1e", "#8fa3ff"],
  ["br", "Brazil", "radial-gradient(circle,#002776 0 22%,#ffdf00 23% 42%,transparent 43%),#009c3b", "#2fd06b", "#ffdf00", "#3a6bff"],
  ["jp", "Japan", "radial-gradient(circle,#bc002d 0 26%,transparent 27%),#fff", "#ff3b5c", "#bc002d", "#ff8fa8"]
];
let fcss = "";
const hd = document.createElement("div"); hd.className = "sec"; hd.textContent = "Country flags"; $("themes").appendChild(hd);
FLAGS.forEach(([k, name, fl, a, b, c]) => {
  fcss += `[data-theme=f-${k}]{--bg:color-mix(in srgb,${b} 12%,#05060a);--bg2:color-mix(in srgb,${b} 32%,#05060a);--a1:${a};--a2:${b};--a3:${c};--flag:${fl}}`;
  const t = document.createElement("button");
  t.className = "th flag"; t.dataset.k = "f-" + k; t.style.background = fl; t.innerHTML = "<span>" + name + "</span>";
  t.onclick = () => { setTheme("f-" + k); $("sheet").hidden = true; toast(name + " theme on"); };
  $("themes").appendChild(t);
});
fcss += "[data-theme^=f-] .bg::after{content:'';position:absolute;inset:0;background:var(--flag);opacity:.3;filter:blur(36px);transform:scale(1.25)}";
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: fcss }));
$("themeBtn").onclick = () => $("sheet").hidden = false;
$("closeSheet").onclick = () => $("sheet").hidden = true;
$("sheet").onclick = e => { if (e.target.id === "sheet") $("sheet").hidden = true; };
let saved = "enaiat"; try { saved = localStorage.getItem("enaiat-theme") || "enaiat"; } catch (e) {}
setTheme(saved);

load();
