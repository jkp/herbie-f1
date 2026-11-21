import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildTrack, pointAt, wrapAngle, type Track, type TrackDef } from './track';
import { CIRCUITS } from './circuits';
import { TEAMS, type Team } from './grid';
import { createRace, stepRace, standings, DIFFICULTIES, type Race } from './race';
import { makeCrew, makePodium, PODIUM_STEPS } from './scene';
import { People, type Person } from './people';
import { pitTimeline } from './pitstop';
import { reachWith } from './ik';
import { CALENDAR, championship, newCareer, nextSeason, numberProblem, offers, recordRace, rookieOf, seasonOver, type Career } from './career';
import { pitBox } from './race';
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
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.75;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc4d6e6, 350, 2200);
// physical sky, also used as the environment for reflections on the paint
const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(50), THREE.MathUtils.degToRad(140));
const sky = new Sky(); sky.scale.setScalar(10000);
Object.assign(sky.material.uniforms, { turbidity: { value: 3 }, rayleigh: { value: 1.2 }, mieCoefficient: { value: 0.004 }, mieDirectionalG: { value: 0.8 } });
sky.material.uniforms.sunPosition.value.copy(SUN_DIR);
scene.add(sky);
{
  const pmrem = new THREE.PMREMGenerator(renderer), env = new THREE.Scene(), envSky = new Sky();
  envSky.scale.setScalar(1000); envSky.material.uniforms.sunPosition.value.copy(SUN_DIR); env.add(envSky);
  scene.environment = pmrem.fromScene(env).texture;
  scene.environmentIntensity = 0.2; // the raw sky is far brighter than the sun light it accompanies
}
scene.add(new THREE.HemisphereLight(0xdbeafe, 0x4b6b3a, 0.35));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 600 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
/** Keep the shadow-casting area centred on what the camera is looking at. */
function aimSun(x: number, z: number) {
  sun.target.position.set(x, 0, z);
  sun.position.set(x + SUN_DIR.x * 300, SUN_DIR.y * 300, z + SUN_DIR.z * 300);
}
const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 4000);
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
  race = career && mode === 'career'
    ? createRace(track, { ...OPTS, player: career.code, difficulty: career.difficulty, laps: career.laps, rookie: rookieOf(career) })
    : createRace(track, { ...OPTS, player: driver, difficulty, laps });
  carMeshes = race.racers.map(r => { const m = makeCar(r.team, r.number); scene.add(m); return m; });
  seatDriver();
  lastPos = race.racers.indexOf(race.player) + 1; // so the grid slot doesn't flash as a gain
  camPos.set(0, 0, 0);
}

// --- menus: home → track → car → driver → race ---
const MENU_SCREENS = ['home', 'tracks', 'teams', 'drivers', 'settings', 'career-new', 'career-team', 'career-hub', 'season-review'];
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
  if (mode === 'quick') introSub = '';
  audio.start();
  playIntro();
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
const teamCard = (t: Team, onClick: () => void, label = esc(t.name), sub = t.drivers.map(d => esc(d.name)).join(' · ')) => button(
  `<span class="livery" style="background:${hex(t.color)}"></span><b>${label}</b><small>${sub}</small><span class="pace" title="Car pace"><i style="width:${Math.round((t.pace - 0.9) / 0.1 * 100)}%"></i></span>`,
  onClick, 'card');
$('teamlist').replaceChildren(...TEAMS.map(t => teamCard(t, () => showDrivers(t))));
function pills(el: string, items: string[], selected: number, pick: (i: number) => void, rerender = renderSettings) {
  $(el).replaceChildren(...items.map((label, i) => {
    const b = button(label, () => { pick(i); rerender(); });
    b.setAttribute('aria-pressed', String(i === selected));
    return b;
  }));
}
const LAP_CHOICES = [3, 5, 10, 15];
function renderSettings() {
  pills('difflist', DIFFICULTIES.map(d => d.name), difficulty, i => { difficulty = i; });
  const help = DIFFICULTIES[difficulty].assist;
  $('assist-note').textContent = help.steer ? 'Driving help: auto-braking, steering help and extra grip.'
    : help.brake ? 'Driving help: auto-braking for corners.' : 'No driving help.';
  pills('lapslist', LAP_CHOICES.map(n => `${n} laps`), LAP_CHOICES.indexOf(laps), i => { laps = LAP_CHOICES[i]; });
}
$('start-btn').onclick = startRace;
$('race-btn').onclick = () => { mode = 'quick'; showMenu('tracks'); };

// --- career ---
const SAVE = 'herbie-f1-career';
let mode: 'quick' | 'career' = 'quick';
let career: Career | null = (() => { try { return JSON.parse(localStorage.getItem(SAVE) ?? 'null'); } catch { return null; } })();
function saveCareer() { try { if (career) localStorage.setItem(SAVE, JSON.stringify(career)); else localStorage.removeItem(SAVE); } catch { /* private mode: career lasts this visit */ } }
const draft = { difficulty: 3, laps: 15 };
function renderCareerNew() {
  pills('c-diff', DIFFICULTIES.map(d => d.name), draft.difficulty, i => { draft.difficulty = i; }, renderCareerNew);
  pills('c-laps', LAP_CHOICES.map(n => `${n} laps`), LAP_CHOICES.indexOf(draft.laps), i => { draft.laps = LAP_CHOICES[i]; }, renderCareerNew);
}
$('career-btn').onclick = () => {
  mode = 'career';
  if (career) return showHub();
  renderCareerNew(); $('career-error').textContent = ''; showMenu('career-new'); $('c-name').focus();
};
$('c-next').onclick = () => {
  const name = ($('c-name') as HTMLInputElement).value.trim(), num = Number(($('c-number') as HTMLInputElement).value);
  const problem = !name ? 'Type your driver name.' : numberProblem(num);
  $('career-error').textContent = problem ?? '';
  if (problem) return;
  $('c-teamlist').replaceChildren(...TEAMS.map(t => teamCard(t, () => {
    career = newCareer({ name, number: num, team: t.name, difficulty: draft.difficulty, laps: draft.laps });
    saveCareer();
    playContract(t, `Welcome to ${t.name}`, `${name} · #${num} · age 17 · season 1`);
  }, esc(t.name), `Replace ${esc(t.drivers[1].name)}`)));
  showMenu('career-team');
};
function showHub() {
  const c = career!, next = CALENDAR[c.round], team = TEAMS.find(t => t.name === c.team)!;
  const table = championship(c), pos = table.findIndex(e => e.code === c.code) + 1;
  loadTrack(next);
  $('hub-info').innerHTML = `<span class="livery" style="background:${hex(team.color)}"></span><big>${esc(c.name)} #${c.number}</big>
    <small>${esc(c.team)} · Season ${c.season} · Age ${c.age}</small><small>Championship: P${pos} · ${c.points[c.code] ?? 0} pts</small>`;
  $('hub-next').innerHTML = `${outline(next)}<b>${esc(next.gp)}</b><small>Round ${c.round + 1} of ${CALENDAR.length} · ${esc(next.name)} · ${c.laps} laps</small>`;
  $('standings').innerHTML = table.map((e, k) => `<tr class="${e.code === c.code ? 'me' : ''}"><td>${k + 1}</td><td>${e.code}</td><td>${esc(e.name)}</td><td class="team">${esc(e.team)}</td><td class="pts">${e.points}</td></tr>`).join('');
  showMenu('career-hub');
}
$('hub-race').onclick = () => {
  const c = career!;
  introSub = `Round ${c.round + 1} of ${CALENDAR.length} · ${def.name} · ${c.laps} laps`;
  startRace();
};
$('hub-reset').onclick = () => {
  if (!confirm('Start a new career? Your current one will be lost.')) return;
  career = null; saveCareer(); $('career-btn').click();
};
function showReview() {
  const c = career!, table = championship(c), pos = table.findIndex(e => e.code === c.code) + 1;
  $('review-info').innerHTML = pos === 1
    ? `<b>World Champion!</b> ${esc(c.name)} wins the season ${c.season} title with ${c.points[c.code]} points.`
    : `Season ${c.season}: <b>P${pos}</b> in the championship with ${c.points[c.code] ?? 0} points.`;
  const sign = (t: Team) => {
    const moving = t.name !== c.team;
    nextSeason(c, t.name); saveCareer();
    if (moving) playContract(t, 'CONTRACT SIGNED', `${c.name} joins ${t.name} for season ${c.season}`);
    else showHub();
  };
  const current = TEAMS.find(t => t.name === c.team)!;
  $('offerlist').replaceChildren(
    ...offers(c).map(n => TEAMS.find(t => t.name === n)!).map(t => teamCard(t, () => sign(t), `Sign for ${esc(t.name)}`, 'Wants you next season')),
    teamCard(current, () => sign(current), `Stay at ${esc(current.name)}`, 'Another season with the team'));
  showMenu('season-review');
}
$('continue').onclick = () => (seasonOver(career!) ? showReview() : showHub());

function playContract(t: Team, title: string, sub: string) {
  const car = makeCar(t, career?.number ?? 1), box = pitBox(track, TEAMS.indexOf(t));
  car.position.set(box.x, 0, box.z); scene.add(car);
  playCut({
    length: 6,
    update(time) {
      car.rotation.y = time * 0.6;
      const a = -box.heading + 0.8;
      camera.position.set(box.x + Math.cos(a) * 8, 2.2, box.z + Math.sin(a) * 8);
      camera.lookAt(box.x, 0.6, box.z);
    },
    end() { scene.remove(car); showHub(); },
  }, title, sub);
}
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
  const wear = p.car.grip / DIFFICULTIES[race.difficulty].assist.grip; // leave out easy-mode bonus grip
  const tyre = Math.round((wear - 0.74) / 0.26 * 100); // 0.74 is fully worn
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
  const inCareer = mode === 'career' && !!career;
  if (inCareer) { recordRace(career!, order.map(r => r.code)); saveCareer(); }
  $('again').classList.toggle('hidden', inCareer); $('home-btn').classList.toggle('hidden', inCareer);
  $('continue').classList.toggle('hidden', !inCareer);
  $('resrows').innerHTML = order.map((r, k) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${k + 1}</td><td>${esc(r.name)}</td><td class="team">${esc(r.team.name)}</td><td>${
    r === winner ? fmt(r.finishTime) : r.finished ? `+${(r.finishTime - winner.finishTime).toFixed(3)}s` : `${r.completed}/${race.laps} laps`
  }</td><td>Best ${fmt(r.bestLap)}</td></tr>`).join('');
  $('results').classList.remove('hidden');
}

// --- cutscenes: letterboxed camera moves with a caption; tap or Enter skips ---
interface Cut { t: number; length: number; pause?: boolean; update: (t: number) => void; end: () => void } // pause: hold the race
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

function playIntro() {
  const grid = race.racers, me = carMeshes[grid.indexOf(race.player)].position;
  const front = pointAt(track, 25), back = pointAt(track, -30 - grid.length * 8);
  playCut({
    length: 5.5, pause: true,
    update(t) {
      // sweep down the grid from the front row, then settle behind the player
      const k = Math.min(1, t / 4.5), e = k * k * (3 - 2 * k);
      const p = pointAt(track, 25 + (back.i === front.i ? 0 : (-30 - grid.length * 8 - 25) * e));
      const off = 14 - 8 * e;
      camera.position.set(p.x - Math.sin(p.heading) * off, 4 + 3 * (1 - e), p.z + Math.cos(p.heading) * off);
      camera.lookAt(me.x * e + p.x * (1 - e), 0.5, me.z * e + p.z * (1 - e));
    },
    end() { camPos.set(0, 0, 0); },
  }, def.gp, introSub || `${def.name} · ${race.laps} laps`);
}
let introSub = '';

function playPodium() {
  const top = standings(race).slice(0, 3), mine = top.indexOf(race.player);
  const box = pitBox(track, 4, race.pitSide), side = race.pitSide;
  const podium = makePodium(top.map(r => r.color), !people);
  // the top three in their race suits: winner dancing, the others celebrating and chatting
  const celebrants = people ? top.map((r, k) => {
    const m = people!.make({ suit: r.team.livery[0], gloves: r.team.livery[1] });
    const [z, h] = PODIUM_STEPS[k];
    m.root.position.set(0, h, z); m.root.rotation.y = Math.PI / 2; // model faces +z; podium front is +x
    m.play(['Dance_Loop', 'Jump_Loop', 'Idle_Talking_Loop'][k], 0); m.update(k * 0.7);
    podium.add(m.root); return m;
  }) : [];
  // out beyond the garages, facing the track
  podium.position.set(box.x - Math.sin(box.heading) * side * 40, 0, box.z + Math.cos(box.heading) * side * 40);
  podium.rotation.y = -box.heading + side * Math.PI / 2;
  scene.add(podium);
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.15, 0.25), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), mine >= 0 ? 400 : 0);
  const bits = Array.from({ length: confetti.count }, (_, k) => ({ x: Math.random() * 12 - 6, y: Math.random() * 10, z: Math.random() * 12 - 6, s: 0.6 + Math.random(), k }));
  bits.forEach(b => confetti.setColorAt(b.k, new THREE.Color().setHSL(Math.random(), 0.9, 0.6)));
  confetti.position.copy(podium.position); scene.add(confetti);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  playCut({
    length: 7,
    update(t) {
      const a = podium.rotation.y + Math.sin(t * 0.3) * 0.45;
      camera.position.set(podium.position.x + Math.cos(-a) * 7.5, 2.1, podium.position.z + Math.sin(-a) * 7.5);
      camera.lookAt(podium.position.x, 1.5, podium.position.z);
      for (const b of bits) {
        const y = ((b.y - t * b.s) % 10 + 10) % 10;
        q.setFromEuler(new THREE.Euler(t * 3 * b.s, b.k, t * 2));
        confetti.setMatrixAt(b.k, m.compose(new THREE.Vector3(b.x + Math.sin(t + b.k) * 0.3, y, b.z), q, new THREE.Vector3(1, 1, 1)));
      }
      confetti.instanceMatrix.needsUpdate = true;
      celebrants.forEach(c => c.update(1 / 60));
    },
    end() { scene.remove(podium, confetti); showResults(); },
  }, mine >= 0 ? `YOU FINISHED P${mine + 1}!` : 'PODIUM', top.map((r, k) => `${k + 1} ${r.code}`).join('  ·  '));
}

function startPitScene() {
  const p = race.player, mesh = carMeshes[race.racers.indexOf(p)];
  if (!people) return startSimplePitScene();
  const T = pitTimeline(p.stopTime), box = mesh.position.clone(), heading = race.player.car.heading;
  const fwd = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
  // the crew, laid out in the car's frame (nose +x, right +z), all facing the car
  const crewRoot = new THREE.Group(); crewRoot.position.copy(box); crewRoot.rotation.y = -heading; scene.add(crewRoot);
  const style = { suit: p.team.livery[0], legs: 0x23252b, helmet: p.team.livery[1] };
  const place = (x: number, z: number, clip: string, face: number) => {
    const m = people!.make(style); m.root.position.set(x, 0, z); m.root.rotation.y = face; m.play(clip, 0);
    m.update(Math.random() * 2); // out of step with each other
    crewRoot.add(m.root); return m;
  };
  const faceIn = (z: number) => (z > 0 ? Math.PI : 0); // model faces +z
  const crew: Person[] = [];
  const tyreProps: { held: THREE.Object3D; old: THREE.Object3D; wheel: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  const wheels = mesh.userData.wheels as THREE.Object3D[];
  for (const [x, z] of [[1.85, 0.82], [1.85, -0.82], [-1.75, 0.82], [-1.75, -0.82]]) {
    const out = Math.sign(z);
    crew.push(place(x, out * 1.45, 'Fixing_Kneeling', faceIn(out)));        // wheel gun
    crew.push(place(x - 0.75, out * 1.9, 'Idle_Loop', faceIn(out)));         // takes the old wheel
    crew.push(place(x + 0.75, out * 1.9, 'Idle_Talking_Loop', faceIn(out))); // brings the new wheel
    const wheel = wheels.find(w => Math.abs(w.parent!.position.x - x) < 0.1 && Math.sign(w.parent!.position.z) === out)!;
    const held = wheel.clone(), old = wheel.clone();
    held.position.set(x + 0.75, 0.75, out * 1.55); old.position.set(x - 0.75, 0.55, out * 1.6); old.visible = false;
    crewRoot.add(held, old);
    tyreProps.push({ held, old, wheel, from: new THREE.Vector3(x + 0.75, 0.75, out * 1.55), to: new THREE.Vector3(x, 0.36, z) });
  }
  crew.push(place(3.9, 0, 'Push_Loop', -Math.PI / 2));   // front jack
  crew.push(place(-3.3, 0, 'Push_Loop', Math.PI / 2));   // rear jack
  crew.push(place(0.1, 1.35, 'Crouch_Idle_Loop', Math.PI), place(0.1, -1.35, 'Crouch_Idle_Loop', 0)); // stabilisers
  const jackMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.7, roughness: 0.35 });
  for (const [x, len] of [[3.45, 0.9], [-2.75, 0.8]]) {
    const jack = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.08), jackMat); jack.position.set(x, 0.35, 0); jack.rotation.z = x > 0 ? -0.35 : 0.35; crewRoot.add(jack);
  }
  // release light on a gantry ahead of the car
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 2 });
  const gantry = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), jackMat); gantry.position.set(5.4, 1.3, -1.9);
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 0.35), lightMat); light.position.set(5.3, 2.5, -1.9);
  crewRoot.add(gantry, light);

  const ease = (k: number) => k * k * (3 - 2 * k), clamp01 = (k: number) => Math.max(0, Math.min(1, k));
  playCut({
    length: T.end,
    update(t) {
      // in down the pit lane, stop on the marks, out again on the green
      const along = t < T.arrive ? -22 * (1 - ease(clamp01(t / T.arrive))) : t > T.go ? 14 * clamp01((t - T.go) / (T.end - T.go)) ** 2 : 0;
      const lift = t > T.jackUp && t < T.jackDown ? 0.09 * clamp01((t - T.jackUp) / 0.12) : 0;
      mesh.position.copy(box).addScaledVector(fwd, along); mesh.position.y = lift;
      for (const pr of tyreProps) {
        const swapping = t > T.wheelsOff && t < T.wheelsOn;
        pr.wheel.visible = !swapping;
        pr.old.visible = t > T.wheelsOff;
        // new wheel moves from the crewman's hands onto the hub just before it's tightened
        const k = clamp01((t - (T.wheelsOn - 0.3)) / 0.3);
        pr.held.position.lerpVectors(pr.from, pr.to, ease(k)); pr.held.position.y += lift;
        pr.held.visible = t < T.wheelsOn;
      }
      lightMat.color.setHex(t > T.go ? 0x22ff44 : 0xff2222); lightMat.emissive.setHex(t > T.go ? 0x00ff22 : 0xff0000);
      crew.forEach(c => c.update(1 / 60));
      if (t > T.arrive && t < T.go) $('cut-sub').textContent = `Stationary ${(t - T.arrive).toFixed(1)}s`;
      if (t >= T.go) $('cut-sub').textContent = `Stationary ${p.stopTime.toFixed(1)}s · fresh tyres`;
      // low camera off the front corner, crew side
      const cam = new THREE.Vector3(4.6, 1.2, 4.2 - t * 0.15).applyAxisAngle(new THREE.Vector3(0, 1, 0), -heading).add(box);
      camera.position.copy(cam); camera.lookAt(mesh.position.x, 0.5, mesh.position.z);
    },
    end() {
      scene.remove(crewRoot);
      mesh.position.y = 0;
      for (const pr of tyreProps) pr.wheel.visible = true;
      // the rest of the 20 s pit loss happens off camera
      while (race.player.pitTimer > 0) stepRace(race, STEP, { throttle: 0, brake: 0, steer: 0 });
      flash('PIT EXIT');
    },
  }, 'PIT STOP', `${p.team.name} crew`);
}

/** Stand-in pit stop while the people models are still loading. */
function startSimplePitScene() {
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

// --- people: loaded in the background; until then the old stand-ins are used ---
let people: People | null = null;
People.load().then(p => { people = p; if (race && !driverRig) seatDriver(); }).catch(e => console.warn('people models unavailable', e));

/** The player's driver: seated in the car, hands on a working steering wheel. */
let driverRig: { person: Person; wheel: THREE.Group; spin: THREE.Group; grips: THREE.Object3D[]; display: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; t: number }; leds: THREE.Mesh[] } | null = null;
function seatDriver() {
  driverRig = null;
  if (!people || !race) return;
  const p = race.player, car = carMeshes[race.racers.indexOf(p)];
  const person = people.make({ suit: p.team.livery[0], helmet: p.team.livery[1], gloves: 0x1a1a1a });
  // F1 drivers lie back: tilt the seated pose back, then line the head up where the helmet sits
  const seat = new THREE.Group(); seat.rotation.z = 0.5; seat.add(person.root);
  person.root.rotation.y = Math.PI / 2; // model faces +z, car faces +x
  car.add(seat);
  person.play('Driving_Loop', 0); person.update(0.01);
  for (const m of car.userData.helmet as THREE.Mesh[]) m.visible = false;
  const local = (o: THREE.Object3D) => car.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
  car.updateMatrixWorld(true);
  seat.position.add(new THREE.Vector3(0.3, 0.84, 0).sub(local(person.bone('Head'))));
  car.updateMatrixWorld(true);
  const hl = local(person.bone('hand_l')), hr = local(person.bone('hand_r'));
  // steering wheel where the hands are: F1-style rectangle with grips, screen and rev lights
  const wheel = new THREE.Group(), spin = new THREE.Group();
  wheel.position.copy(hl).add(hr).multiplyScalar(0.5); wheel.position.x += 0.04; wheel.rotation.z = 0.35;
  const half = Math.max(0.12, Math.abs(hl.z - hr.z) / 2);
  const carbon = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.45, metalness: 0.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, half * 2 - 0.02), carbon);
  const grips = [-1, 1].map(s => { const g = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.13, 10), rubber); g.position.z = s * half; return g; });
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.04), new THREE.MeshBasicMaterial({ map: tex }));
  screen.rotation.y = -Math.PI / 2; screen.position.set(-0.016, 0.01, 0);
  const leds = Array.from({ length: 12 }, (_, k) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.008), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    l.position.set(-0.016, 0.055, (k - 5.5) * 0.011); return l;
  });
  spin.add(plate, ...grips, screen, ...leds); wheel.add(spin); car.add(wheel);
  driverRig = { person, wheel, spin, grips: hl.z < hr.z ? grips : [...grips].reverse(), display: { ctx: c.getContext('2d')!, tex, t: 0 }, leds };
}
function updateDriver(dt: number) {
  if (!driverRig) return;
  const c = race.player.car, { person, spin, grips, display, leds } = driverRig;
  person.update(dt);
  spin.rotation.x = -c.steer * 1.2; // wheel turns about 70° each way at full lock
  spin.updateWorldMatrix(true, true);
  for (const [k, side] of (['l', 'r'] as const).entries())
    reachWith(person.bone(`upperarm_${side}`), person.bone(`lowerarm_${side}`), person.bone(`hand_${side}`), grips[k].getWorldPosition(new THREE.Vector3()));
  const { gear, rpm } = gearFor(c.speed), lit = Math.round((rpm - 4000) / 8500 * leds.length);
  leds.forEach((l, k) => (l.material as THREE.MeshBasicMaterial).color.setHex(k >= lit ? 0x222222 : k < 4 ? 0x22c55e : k < 8 ? 0xef4444 : 0x60a5fa));
  if ((display.t -= dt) <= 0) {
    display.t = 0.1;
    const g = display.ctx; g.fillStyle = '#000'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#facc15'; g.font = '900 44px system-ui'; g.textAlign = 'center'; g.fillText(gear === 0 ? 'R' : String(gear), 64, 44);
    g.fillStyle = '#fff'; g.font = '700 13px system-ui'; g.fillText(`${Math.round(Math.abs(c.speed) * 3.6)}`, 64, 60);
    display.tex.needsUpdate = true;
  }
}

// --- loop ---
let camYaw = 0, acc = 0, prev = performance.now(), menuSpin = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
  if (screen === 'menu') {
    menuSpin += dt * 0.05;
    const p = pointAt(track, 0);
    camera.position.set(p.x + Math.cos(menuSpin) * 260, 120, p.z + Math.sin(menuSpin) * 260);
    camera.lookAt(p.x, 0, p.z);
    aimSun(p.x, p.z);
    if (cut) { cut.t += dt; cut.update(cut.t); if (cut.t >= cut.length) endCut(); }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }

  const ctl = screen === 'race' && !cut ? readControls() : { throttle: 0, brake: 0, steer: 0 };
  acc += dt;
  while (acc >= STEP) { if (!cut?.pause) stepRace(race, STEP, ctl); acc -= STEP; }
  if (screen === 'race' && race.phase === 'finished' && !cut) { screen = 'results'; playPodium(); }

  race.racers.forEach((r, k) => {
    const m = carMeshes[k], { car } = r;
    m.position.set(car.x, 0, car.z); m.rotation.y = -car.heading;
    for (const w of m.userData.wheels as THREE.Mesh[]) w.rotation.z -= car.speed * dt / 0.36;
    for (const f of m.userData.front as THREE.Group[]) f.rotation.y = -car.steer * maxSteerAngle(car.speed) * 2;
  });
  updateDriver(dt);

  const c = race.player.car, fx = Math.cos(c.heading), fz = Math.sin(c.heading);
  if (race.player.pitTimer > 0 && !cut && screen === 'race') startPitScene();
  if (cut) {
    cut.t += dt;
    cut.update(cut.t);
    if (cut.t >= cut.length) endCut();
  } else if (camMode === 1) {
    // driver's eyes: just in front of the head bone, looking down the road over the wheel
    const eye = driverRig ? driverRig.person.bone('Head').getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(c.x, 1.0, c.z);
    camera.position.set(eye.x + fx * 0.12, eye.y + 0.07, eye.z + fz * 0.12);
    camera.lookAt(c.x + fx * 30, 0.5, c.z + fz * 30);
  } else if (camMode === 2) {
    // TV camera: fixed trackside point ahead of the car, hops forward as it passes
    const tv = pointAt(track, Math.ceil(race.player.s / 250) * 250);
    camera.position.set(tv.x - Math.sin(tv.heading) * 30, 9, tv.z + Math.cos(tv.heading) * 30);
    camera.lookAt(c.x, 0.5, c.z);
  } else {
    // fixed distance behind; only the camera's direction lags, so it swings out a little in corners
    if (!camPos.lengthSq()) camYaw = c.heading;
    camYaw += wrapAngle(c.heading - camYaw) * (1 - Math.exp(-dt * 6));
    camPos.set(c.x - Math.cos(camYaw) * 7.5, 2.6, c.z - Math.sin(camYaw) * 7.5);
    camLook.set(c.x + fx * 6, 1, c.z + fz * 6);
    camera.position.copy(camPos); camera.lookAt(camLook);
  }
  // a wider view as speed builds sells the speed
  const fov = (camMode === 1 ? 72 : 62) + Math.min(14, Math.abs(c.speed) * 0.15);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  aimSun(c.x, c.z);

  updateHud(dt);
  audio.update(gearFor(c.speed).rpm, ctl.throttle);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
loadTrack(CIRCUITS[0]);
showMenu('home');
requestAnimationFrame(frame);

// e2e tests and console debugging
Object.assign(window, { __game: { get race() { return race; }, touch, stats: () => ({ fans: world?.userData.fans ?? 0, calls: renderer.info.render.calls, driver: !!driverRig, people: !!people }), three: { renderer, scene, sky } } });
