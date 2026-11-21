import * as THREE from 'three';
import { buildTrack, pointAt, type Track, type TrackDef } from './track';
import { CIRCUITS } from './circuits';
import { TEAMS, type Team } from './grid';
import { createRace, stepRace, standings, DIFFICULTIES, type Race } from './race';
import { makeCrew } from './scene';
import { gearFor, maxSteerAngle, type Controls } from './car';
import { buildWorld, makeCar } from './scene';

const params = new URLSearchParams(location.search);
const OPTS = {
  size: params.has('size') ? Number(params.get('size')) : undefined,
  countdown: Number(params.get('countdown') ?? 4),
};
const STEP = 1 / 120;
const $ = (id: string) => document.getElementById(id)!;

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

// --- three.js setup ---
const renderer = new THREE.WebGLRenderer({ canvas: $('gl') as HTMLCanvasElement, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc7ef);
scene.fog = new THREE.Fog(0x9cc7ef, 300, 1800);
scene.add(new THREE.HemisphereLight(0xdff1ff, 0x4f6b3a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(300, 500, 200); scene.add(sun);
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 4000);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

let race!: Race;
let carMeshes: THREE.Group[] = [];
let def: TrackDef, track!: Track, world: THREE.Group | null = null;
let driver = 'VER', difficulty = 3, laps = 15;

function loadTrack(d: TrackDef) {
  if (def === d) return;
  def = d; track = buildTrack(d);
  if (world) { scene.remove(world); world.traverse(o => (o as THREE.Mesh).geometry?.dispose()); }
  world = buildWorld(track); scene.add(world);
  mapPath = makeMapPath(track);
}

let screen: 'menu' | 'race' | 'results' = 'menu';
let camMode = 0; // 0 chase, 1 cockpit, 2 TV
function clearCars() { carMeshes.forEach(m => scene.remove(m)); carMeshes = []; }
function newRace() {
  clearCars();
  race = createRace(track, { ...OPTS, player: driver, difficulty, laps });
  carMeshes = race.racers.map(r => { const m = makeCar(r.color); scene.add(m); return m; });
  lastPos = race.racers.length;
  camPos.set(0, 0, 0);
}

// --- menus: home → track → car → driver → race ---
const MENU_SCREENS = ['home', 'tracks', 'teams', 'drivers', 'settings'];
function showMenu(id: string) {
  screen = 'menu';
  document.body.classList.add('menu');
  $('results').classList.add('hidden'); $('menu').classList.remove('hidden');
  for (const m of MENU_SCREENS) $(m).classList.toggle('hidden', m !== id);
  $(id).querySelector<HTMLElement>('.choices button, .primary')?.focus();
  if (id === 'settings') renderSettings();
}
function startRace() {
  newRace(); screen = 'race';
  document.body.classList.remove('menu'); $('menu').classList.add('hidden'); $('results').classList.add('hidden');
  audio.start();
}
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const esc = (t: string) => t.replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`);
function button(html: string, onClick: () => void, cls = '') {
  const b = document.createElement('button'); b.className = cls; b.innerHTML = html; b.onclick = onClick; return b;
}
function outline(d: TrackDef) {
  const xs = d.points.map(p => p[0]), zs = d.points.map(p => p[1]);
  const minX = Math.min(...xs), minZ = Math.min(...zs), sc = 84 / Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ);
  const pts = d.points.map(([x, z]) => `${((x - minX) * sc + 8).toFixed(1)},${((z - minZ) * sc + 8).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="${pts}" /><circle cx="${((d.points[0][0] - minX) * sc + 8).toFixed(1)}" cy="${((d.points[0][1] - minZ) * sc + 8).toFixed(1)}" r="4" /></svg>`;
}
$('tracklist').replaceChildren(...CIRCUITS.map(d => button(
  `${outline(d)}<b>${esc(d.name)}</b><small>${esc(d.gp)} · ${(d.officialLength / 1000).toFixed(3)} km</small>`,
  () => { loadTrack(d); showMenu('teams'); }, 'card')));
function showDrivers(t: Team) {
  $('driverlist').replaceChildren(...t.drivers.map(d => button(
    `<span class="num" style="color:${hex(t.color)}">${d.number}</span><b>${esc(d.name)}</b><small>${esc(t.name)}</small>`,
    () => { driver = d.code; showMenu('settings'); }, 'card')));
  showMenu('drivers');
}
$('teamlist').replaceChildren(...TEAMS.map(t => button(
  `<span class="livery" style="background:${hex(t.color)}"></span><b>${esc(t.name)}</b><small>${t.drivers.map(d => esc(d.name)).join(' · ')}</small><span class="pace" title="Car pace"><i style="width:${Math.round((t.pace - 0.9) / 0.1 * 100)}%"></i></span>`,
  () => showDrivers(t), 'card')));
function pills(el: string, items: string[], selected: number, pick: (i: number) => void) {
  $(el).replaceChildren(...items.map((label, i) => {
    const b = button(label, () => { pick(i); renderSettings(); });
    b.setAttribute('aria-pressed', String(i === selected));
    return b;
  }));
}
const LAP_CHOICES = [3, 5, 10, 15];
function renderSettings() {
  pills('difflist', DIFFICULTIES.map(d => d.name), difficulty, i => { difficulty = i; });
  pills('lapslist', LAP_CHOICES.map(n => `${n} laps`), LAP_CHOICES.indexOf(laps), i => { laps = LAP_CHOICES[i]; });
}
$('start-btn').onclick = startRace;
$('race-btn').onclick = () => showMenu('tracks');
document.querySelectorAll<HTMLElement>('[data-back]').forEach(b => { b.onclick = () => showMenu(b.dataset.back!); });
$('again').onclick = startRace;
$('home-btn').onclick = () => { clearCars(); showMenu('home'); };

// --- input ---
const keys = new Set<string>();
addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyM') audio.toggle();
  if (e.code === 'KeyR' && screen === 'race') resetPlayer();
  if (e.code === 'KeyB' || e.code === 'KeyP') toggleBox();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// Touch: each finger maps to the control under it, so a thumb can slide between ◀ and ▶.
const touch: Record<number, string> = {};
const touchLayer = $('touch');
function trackFinger(e: PointerEvent) {
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-ctl]');
  if (el) touch[e.pointerId] = el.dataset.ctl!; else delete touch[e.pointerId];
  syncTouchButtons();
}
function liftFinger(e: PointerEvent) { delete touch[e.pointerId]; syncTouchButtons(); }
function syncTouchButtons() {
  const held = new Set(Object.values(touch));
  touchLayer.querySelectorAll<HTMLElement>('[data-ctl]').forEach(b => b.classList.toggle('on', held.has(b.dataset.ctl!)));
}
touchLayer.addEventListener('pointerdown', e => { e.preventDefault(); trackFinger(e); });
touchLayer.addEventListener('pointermove', e => { if (e.pointerId in touch || e.pointerType !== 'mouse') trackFinger(e); });
touchLayer.addEventListener('pointerup', liftFinger);
touchLayer.addEventListener('pointercancel', liftFinger);
touchLayer.querySelector('[data-act=cam]')!.addEventListener('pointerdown', () => { camMode = (camMode + 1) % 3; });
touchLayer.querySelector('[data-act=box]')!.addEventListener('pointerdown', toggleBox);
touchLayer.querySelector('[data-act=reset]')!.addEventListener('pointerdown', () => { if (screen === 'race') resetPlayer(); });

function readControls(): Controls {
  const k = (...c: string[]) => c.some(x => keys.has(x)) ? 1 : 0;
  const ctl = {
    throttle: k('ArrowUp', 'KeyW'),
    brake: k('ArrowDown', 'KeyS', 'Space'),
    steer: k('ArrowRight', 'KeyD') - k('ArrowLeft', 'KeyA'),
  };
  const held = new Set(Object.values(touch));
  if (held.has('gas')) ctl.throttle = 1;
  if (held.has('brake')) ctl.brake = 1;
  if (held.size) ctl.steer += (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  const pad = navigator.getGamepads?.().find(p => p);
  if (pad) {
    const ax = pad.axes[0] ?? 0;
    if (Math.abs(ax) > 0.08) ctl.steer = ax;
    ctl.throttle = Math.max(ctl.throttle, pad.buttons[7]?.value ?? 0);
    ctl.brake = Math.max(ctl.brake, pad.buttons[6]?.value ?? 0);
  }
  return ctl;
}

function toggleBox() {
  const p = race?.player;
  if (screen !== 'race' || !p || p.finished || p.pitTimer > 0) return;
  p.boxRequested = !p.boxRequested;
  if (p.boxRequested) flash('BOX, BOX');
}

function resetPlayer() {
  if (race.player.pitTimer > 0) return;
  const r = race.player, p = pointAt(track, r.s);
  r.car.x = p.x; r.car.z = p.z; r.car.heading = p.heading; r.car.speed = 0; r.car.steer = 0;
  r.lateral = 0;
}

// --- engine audio: two detuned oscillators through a low-pass ---
const audio = (() => {
  let ctx: AudioContext | null = null, gain: GainNode, oscs: OscillatorNode[] = [], muted = false;
  return {
    start() {
      if (ctx) return;
      try {
        ctx = new AudioContext();
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
        gain = ctx.createGain(); gain.gain.value = 0;
        lp.connect(gain).connect(ctx.destination);
        oscs = (['sawtooth', 'square'] as OscillatorType[]).map((type, i) => {
          const o = ctx!.createOscillator(); o.type = type; o.detune.value = i * 9; o.connect(lp); o.start(); return o;
        });
      } catch { ctx = null; }
    },
    toggle() { muted = !muted; },
    update(rpm: number, throttle: number) {
      if (!ctx) return;
      const f = rpm / 60 * 2; // 4-stroke V6: firing frequency ≈ 3 × rev/s, halved for a deeper tone
      oscs.forEach((o, i) => o.frequency.setTargetAtTime(f * (i ? 0.5 : 1), ctx!.currentTime, 0.03));
      gain.gain.setTargetAtTime(muted ? 0 : 0.035 + 0.05 * throttle, ctx.currentTime, 0.05);
    },
  };
})();

// --- HUD ---
const fmt = (t: number) => {
  if (!t) return '–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
const mapCanvas = $('map') as HTMLCanvasElement, map = mapCanvas.getContext('2d')!;
let mapPath: ReturnType<typeof makeMapPath>;
function makeMapPath(track: Track) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.n; i++) { minX = Math.min(minX, track.xs[i]); maxX = Math.max(maxX, track.xs[i]); minZ = Math.min(minZ, track.zs[i]); maxZ = Math.max(maxZ, track.zs[i]); }
  const sc = 190 / Math.max(maxX - minX, maxZ - minZ), ox = 110 - (minX + maxX) / 2 * sc, oz = 110 - (minZ + maxZ) / 2 * sc;
  const path = new Path2D();
  for (let i = 0; i < track.n; i += 4) path.lineTo(track.xs[i] * sc + ox, track.zs[i] * sc + oz);
  path.closePath();
  return { path, tx: (x: number) => x * sc + ox, tz: (z: number) => z * sc + oz };
}
let lastPos = 20, msgTimer = 0;
function flash(text: string) { $('msg').textContent = text; $('msg').style.opacity = '1'; msgTimer = 2; }

function updateHud(dt: number) {
  const p = race.player, order = standings(race), pos = order.indexOf(p) + 1, n = race.racers.length;
  const lap = Math.min(race.laps, Math.max(1, p.completed + 1));
  const { gear, rpm } = gearFor(p.car.speed);
  $('speed').textContent = String(Math.round(Math.abs(p.car.speed) * 3.6));
  $('gear').textContent = gear === 0 ? 'R' : p.car.speed < 0.3 ? 'N' : String(gear);
  ($('rpm').firstElementChild as HTMLElement).style.width = `${(rpm - 4000) / 8500 * 100}%`;
  $('pos').textContent = `${pos}/${n}`;
  $('lap').textContent = `${lap}/${race.laps}`;
  $('towerlap').textContent = `${lap}/${race.laps}`;
  $('cur').textContent = fmt(race.phase === 'countdown' ? 0.0001 : race.time - p.lapStart);
  $('last').textContent = fmt(p.lastLap);
  $('best').textContent = fmt(p.bestLap);
  const tyre = Math.round((p.car.grip - 0.74) / 0.26 * 100); // 0.74 is fully worn
  $('tyres').textContent = `${tyre}%`;
  $('tyres').style.color = tyre > 60 ? '' : tyre > 30 ? '#facc15' : '#ef4444';
  $('box').classList.toggle('on', p.boxRequested);
  touchLayer.querySelector('[data-act=box]')!.classList.toggle('on', p.boxRequested);
  const leader = order[0];
  $('rows').innerHTML = order.map((r, k) => {
    const gap = k === 0 ? 'Leader' : r.finished && leader.finished ? `+${(r.finishTime - leader.finishTime).toFixed(1)}s`
      : `+${((leader.total - r.total) / Math.max(30, Math.abs(r.car.speed))).toFixed(1)}s`;
    return `<div class="row${r.isPlayer ? ' me' : ''}"><b>${k + 1}</b><span class="stripe" style="background:#${r.color.toString(16).padStart(6, '0')}"></span><span>${r.code}</span><span class="gap">${gap}</span></div>`;
  }).join('');

  // start lights: one per second, all out on go
  const lights = $('lights');
  lights.style.display = race.phase === 'countdown' ? 'flex' : 'none';
  const lit = Math.min(5, Math.floor((OPTS.countdown - race.countdown) / (OPTS.countdown / 5)) + 1);
  [...lights.children].forEach((l, k) => l.classList.toggle('on', k < lit));

  if (race.phase === 'racing' && pos < lastPos) flash(`P${pos}`);
  lastPos = pos;
  msgTimer -= dt; if (msgTimer <= 0) $('msg').style.opacity = '0';

  map.clearRect(0, 0, 220, 220);
  map.lineWidth = 5; map.strokeStyle = 'rgba(255,255,255,.85)'; map.lineJoin = 'round'; map.stroke(mapPath.path);
  for (const r of [...race.racers].sort((a, b) => Number(a.isPlayer) - Number(b.isPlayer))) {
    map.fillStyle = '#' + r.color.toString(16).padStart(6, '0');
    map.beginPath(); map.arc(mapPath.tx(r.car.x), mapPath.tz(r.car.z), r.isPlayer ? 6 : 4, 0, Math.PI * 2); map.fill();
    if (r.isPlayer) { map.strokeStyle = '#000'; map.lineWidth = 2; map.stroke(); }
  }
}

function showResults() {
  const order = standings(race), pos = order.indexOf(race.player) + 1, winner = order[0];
  $('verdict').textContent = pos === 1 ? `You won the ${def.gp}!` : `You finished P${pos}`;
  $('resrows').innerHTML = order.map((r, k) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${k + 1}</td><td>${esc(r.name)}</td><td class="team">${esc(r.team.name)}</td><td>${
    r === winner ? fmt(r.finishTime) : r.finished ? `+${(r.finishTime - winner.finishTime).toFixed(3)}s` : `${r.completed}/${race.laps} laps`
  }</td><td>Best ${fmt(r.bestLap)}</td></tr>`).join('');
  $('results').classList.remove('hidden');
}

// --- cutscenes: letterboxed camera moves with a caption; tap or Enter skips ---
interface Cut { t: number; length: number; update: (t: number) => void; end: () => void }
let cut: Cut | null = null;
function playCut(c: Omit<Cut, 't'>, title: string, sub = '') {
  cut = { ...c, t: 0 };
  $('cut-title').textContent = title; $('cut-sub').textContent = sub;
  document.body.classList.add('cut'); $('cutscene').classList.remove('hidden');
}
function endCut() {
  if (!cut) return;
  const c = cut; cut = null;
  document.body.classList.remove('cut'); $('cutscene').classList.add('hidden');
  c.end();
}
$('cutscene').addEventListener('click', endCut);
addEventListener('keydown', e => { if (cut && (e.code === 'Enter' || e.code === 'Space')) endCut(); });

function startPitScene() {
  const p = race.player, mesh = carMeshes[race.racers.indexOf(p)];
  const crew = makeCrew(p.color); crew.position.copy(mesh.position); crew.rotation.y = mesh.rotation.y; scene.add(crew);
  const wheels = mesh.userData.wheels as THREE.Mesh[], on = 1.6, off = on + p.stopTime;
  playCut({
    length: 6.5,
    update(t) {
      // wheels off and back on during the stationary time
      const k = t < on || t > off ? 0 : Math.min(1, (t - on) * 5, (off - t) * 5);
      for (const w of wheels) w.position.z = Math.sign(w.parent!.position.z) * k * 0.7;
      if (t > off) $('cut-sub').textContent = `Fresh tyres · stationary ${p.stopTime.toFixed(1)}s`;
      const a = mesh.rotation.y + 2.2 + t * 0.25;
      camera.position.set(mesh.position.x + Math.cos(a) * 7, 2.4, mesh.position.z + Math.sin(a) * 7);
      camera.lookAt(mesh.position.x, 0.6, mesh.position.z);
    },
    end() {
      for (const w of wheels) w.position.z = 0;
      scene.remove(crew);
      // the rest of the 20 s pit loss happens off camera
      while (race.player.pitTimer > 0) stepRace(race, STEP, { throttle: 0, brake: 0, steer: 0 });
      flash('PIT EXIT');
    },
  }, 'PIT STOP', `${p.team.name} crew · new tyres`);
}

// --- loop ---
let acc = 0, prev = performance.now(), menuSpin = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
  if (screen === 'menu') {
    menuSpin += dt * 0.05;
    const p = pointAt(track, 0);
    camera.position.set(p.x + Math.cos(menuSpin) * 260, 120, p.z + Math.sin(menuSpin) * 260);
    camera.lookAt(p.x, 0, p.z);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }

  const ctl = screen === 'race' && !cut ? readControls() : { throttle: 0, brake: 0, steer: 0 };
  acc += dt;
  while (acc >= STEP) { stepRace(race, STEP, ctl); acc -= STEP; }
  if (screen === 'race' && race.phase === 'finished') { screen = 'results'; showResults(); }

  race.racers.forEach((r, k) => {
    const m = carMeshes[k], { car } = r;
    m.position.set(car.x, 0, car.z); m.rotation.y = -car.heading;
    for (const w of m.userData.wheels as THREE.Mesh[]) w.rotation.z -= car.speed * dt / 0.36;
    for (const f of m.userData.front as THREE.Group[]) f.rotation.y = -car.steer * maxSteerAngle(car.speed) * 2;
  });

  const c = race.player.car, fx = Math.cos(c.heading), fz = Math.sin(c.heading);
  if (race.player.pitTimer > 0 && !cut && screen === 'race') startPitScene();
  if (cut) {
    cut.t += dt;
    cut.update(cut.t);
    if (cut.t >= cut.length) endCut();
  } else if (camMode === 1) {
    camera.position.set(c.x - fx * 0.3, 1.25, c.z - fz * 0.3);
    camera.lookAt(c.x + fx * 30, 0.4, c.z + fz * 30);
  } else if (camMode === 2) {
    // TV camera: fixed trackside point ahead of the car, hops forward as it passes
    const tv = pointAt(track, Math.ceil(race.player.s / 250) * 250);
    camera.position.set(tv.x - Math.sin(tv.heading) * 30, 9, tv.z + Math.cos(tv.heading) * 30);
    camera.lookAt(c.x, 0.5, c.z);
  } else {
    const k = 1 - Math.exp(-dt * 7);
    camPos.lerp(new THREE.Vector3(c.x - fx * 8.5, 3, c.z - fz * 8.5), camPos.lengthSq() ? k : 1);
    camLook.set(c.x + fx * 5, 1, c.z + fz * 5);
    camera.position.copy(camPos); camera.lookAt(camLook);
  }

  updateHud(dt);
  audio.update(gearFor(c.speed).rpm, ctl.throttle);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
loadTrack(CIRCUITS[0]);
showMenu('home');
requestAnimationFrame(frame);

// e2e tests and console debugging
Object.assign(window, { __game: { get race() { return race; }, touch } });
