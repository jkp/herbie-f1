import * as THREE from 'three';
import { buildTrack, pointAt } from './track';
import { SILVERSTONE } from './silverstone';
import { createRace, stepRace, standings, type Race } from './race';
import { gearFor, maxSteerAngle, type Controls } from './car';
import { buildWorld, makeCar } from './scene';

const params = new URLSearchParams(location.search);
const OPTS = {
  laps: Number(params.get('laps') ?? 3),
  opponents: Number(params.get('opponents') ?? 5),
  countdown: Number(params.get('countdown') ?? 4),
};
const STEP = 1 / 120;
const $ = (id: string) => document.getElementById(id)!;

const track = buildTrack(SILVERSTONE);

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
const world = buildWorld(track, 20);
scene.add(world);

let screen: 'menu' | 'race' | 'results' = 'menu';
let camMode = 0; // 0 chase, 1 cockpit, 2 TV
function newRace() {
  carMeshes.forEach(m => scene.remove(m));
  race = createRace(track, OPTS);
  carMeshes = race.racers.map(r => { const m = makeCar(r.color); scene.add(m); return m; });
  lastPos = race.racers.length;
}

// --- input ---
const keys = new Set<string>();
function startRace() {
  if (screen === 'race') return;
  newRace(); screen = 'race';
  document.body.classList.remove('menu'); $('menu').classList.add('hidden'); $('results').classList.add('hidden');
  audio.start();
}
$('menu').addEventListener('click', startRace);
$('results').addEventListener('click', startRace);
addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.code === 'Enter') startRace();
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyM') audio.toggle();
  if (e.code === 'KeyR' && screen === 'race') resetPlayer();
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

function resetPlayer() {
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
const mapPath = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.n; i++) { minX = Math.min(minX, track.xs[i]); maxX = Math.max(maxX, track.xs[i]); minZ = Math.min(minZ, track.zs[i]); maxZ = Math.max(maxZ, track.zs[i]); }
  const sc = 190 / Math.max(maxX - minX, maxZ - minZ), ox = 110 - (minX + maxX) / 2 * sc, oz = 110 - (minZ + maxZ) / 2 * sc;
  const path = new Path2D();
  for (let i = 0; i < track.n; i += 4) path.lineTo(track.xs[i] * sc + ox, track.zs[i] * sc + oz);
  path.closePath();
  return { path, tx: (x: number) => x * sc + ox, tz: (z: number) => z * sc + oz };
})();
let lastPos = 6, msgTimer = 0;
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
  const leader = order[0];
  $('rows').innerHTML = order.map((r, k) => {
    const gap = k === 0 ? 'Leader' : r.finished && leader.finished ? `+${(r.finishTime - leader.finishTime).toFixed(1)}s`
      : `+${((leader.total - r.total) / Math.max(30, Math.abs(r.car.speed))).toFixed(1)}s`;
    return `<div class="row${r.isPlayer ? ' me' : ''}"><b>${k + 1}</b><span class="stripe" style="background:#${r.color.toString(16).padStart(6, '0')}"></span><span>${r.name}</span><span class="gap">${gap}</span></div>`;
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
  $('verdict').textContent = pos === 1 ? 'You won the British Grand Prix!' : `You finished P${pos}`;
  $('resrows').innerHTML = order.map((r, k) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${k + 1}</td><td>${r.name}</td><td>${
    r === winner ? fmt(r.finishTime) : r.finished ? `+${(r.finishTime - winner.finishTime).toFixed(3)}s` : `${r.completed}/${race.laps} laps`
  }</td><td>Best ${fmt(r.bestLap)}</td></tr>`).join('');
  $('results').classList.remove('hidden');
}

// --- loop ---
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
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

  const ctl = screen === 'race' ? readControls() : { throttle: 0, brake: 0, steer: 0 };
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
  if (camMode === 1) {
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
requestAnimationFrame(frame);

// e2e tests and console debugging
Object.assign(window, { __game: { get race() { return race; }, touch } });
