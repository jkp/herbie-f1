import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TIMES, WEATHER } from './conditions';
import { buildTrack, pointAt, wrapAngle, type Track, type TrackDef } from './track';
import { CIRCUITS } from './circuits';
import { TEAMS, type Team } from './grid';
import { createRace, stepRace, standings, DIFFICULTIES, COMPOUNDS, PIT, tyreLife, type Race } from './race';
import { makeCrew, makePodium, PODIUM_STEPS } from './scene';
import { People, SKIN_TONES, HAIRSTYLES, HAIR_COLOURS, type Person, type PersonStyle } from './people';
import { pitTimeline } from './pitstop';
import { reachWith } from './ik';
import { wheelAngle, tiltSteer } from './tilt';
import { type Look, CALENDAR, championship, newCareer, nextSeason, numberProblem, offers, recordRace, rookieOf, seasonOver, type Career } from './career';
import { pitBox } from './race';
import { gearFor, maxSteerAngle, type Controls } from './car';
import { buildWorld, buildFloodlights, makeCar, makeRain, loadCarModel, carModelLoaded, type City } from './scene';
import { makeRelief, type Relief, type Terrain } from './relief';
import { boxAt, type Racer } from './race';
import { makeReplay, type Frame } from './replay';

const params = new URLSearchParams(location.search);
const OPTS = {
  size: params.has('size') ? Number(params.get('size')) : undefined,
  countdown: Number(params.get('countdown') ?? 4),
};
// effects: ambient occlusion and bloom on a computer; bloom only on tablets and phones (?quality=low|high overrides)
const QUALITY = params.get('quality') ?? (matchMedia('(pointer: coarse)').matches ? 'low' : 'high');
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
scene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), envSky = new Sky();
envSky.scale.setScalar(1000); envScene.add(envSky);
const hemi = new THREE.HemisphereLight(0xdbeafe, 0x4b6b3a, 0.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 600 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
/** Keep the shadow-casting area centred on what the camera is looking at. */
function aimSun(x: number, z: number, y = 0) {
  sun.target.position.set(x, y, z);
  sun.position.set(x + SUN_DIR.x * 300, y + SUN_DIR.y * 300, z + SUN_DIR.z * 300);
}
const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 4000);
// post-processing: soft contact shadows (ambient occlusion), glow on bright lights, then tone mapping
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const ao = QUALITY === 'high' ? new GTAOPass(scene, camera, 1, 1) : null;
if (ao) { ao.blendIntensity = 0.8; ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, scale: 1 }); composer.addPass(ao); }
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
function resize() {
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
}

// --- time of day and weather ---
let timeOfDay = 1, weather = 0;
const rain = makeRain(); rain.visible = false; scene.add(rain);
// see-through effects that must not cast ambient occlusion: hidden while that pass reads the depth
const seeThrough: THREE.Object3D[] = [rain];
if (ao) {
  const aoRender = ao.render.bind(ao);
  ao.render = (...a: Parameters<GTAOPass['render']>) => {
    const was = seeThrough.map(o => o.visible); seeThrough.forEach(o => { o.visible = false; });
    aoRender(...a); seeThrough.forEach((o, k) => { o.visible = was[k]; });
  };
}
let lit: { time: number; weather: number } | null = null;
/** Sky, sun, ambient light, fog, floodlights, rain and wet tarmac for a time of day and weather. */
function applyConditions(time: number, wx: number) {
  const T = TIMES[time], W = WEATHER[wx], night = T.sun < 0, overcast = W.cloud;
  // the sun (or at night, the floodlights' key light from high above)
  SUN_DIR.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - (night ? 65 : Math.max(T.sun, 2))), THREE.MathUtils.degToRad(T.azimuth));
  const sunCol = night ? 0xeef2ff : T.sun < 8 ? 0xff9a50 : T.sun < 25 ? 0xffe2b8 : 0xfff4e0;
  sun.color.setHex(sunCol);
  sun.intensity = (night ? 1.5 : T.sun < 8 ? 1.7 : 2.2) * (1 - overcast * 0.7);
  sun.shadow.intensity = 1 - overcast * 0.75;
  hemi.intensity = night ? 0.3 : 0.35 + overcast * 0.45; // at night, spill from the floodlights so the cockpit isn't black
  hemi.color.setHex(night ? 0x2a3550 : overcast ? 0xb8c0c8 : T.sun < 8 ? 0xffc8a8 : 0xdbeafe);
  // sky: the physical sky by day, a plain dark or grey dome otherwise
  const u = sky.material.uniforms, eu = envSky.material.uniforms;
  for (const x of [u, eu]) {
    x.sunPosition.value.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - T.sun), THREE.MathUtils.degToRad(T.azimuth));
    x.turbidity.value = T.sun < 8 ? 6 : 3 + overcast * 8; x.rayleigh.value = T.sun < 8 ? 2.5 : 1.2 - overcast * 0.8;
    x.mieCoefficient.value = T.sun < 8 ? 0.01 : 0.004 + overcast * 0.01;
  }
  const plain = night || W.rain;
  sky.visible = !plain;
  const fogCol = night ? (W.rain ? 0x10141c : 0x070a12) : W.rain ? 0x8b939c : overcast ? 0xb9c1c9 : T.sun < 8 ? 0xe0a982 : T.sun < 25 ? 0xd2dbe4 : 0xc4d6e6;
  scene.background = plain ? new THREE.Color(fogCol) : null;
  const fog = scene.fog as THREE.Fog;
  fog.color.setHex(fogCol); fog.near = W.rain ? 90 : night ? 250 : 350 - overcast * 100; fog.far = W.rain ? 1000 : night ? 1600 : 2200 - overcast * 500;
  // reflections: from the sky by day; dim at night
  envSky.visible = true;
  envScene.background = plain ? new THREE.Color(night ? 0x0c1220 : 0x8b939c) : null;
  envSky.visible = !plain;
  scene.environment?.dispose(); scene.environment = pmrem.fromScene(envScene).texture;
  scene.environmentIntensity = night ? 0.6 : plain ? 0.8 : 0.2 + overcast * 0.3;
  renderer.toneMappingExposure = night ? 0.95 : W.rain ? 0.9 : overcast ? 0.85 : 0.75;
  // glow on the floodlights; by day the whole bright sky would bloom into a milky veil
  bloom.enabled = night; bloom.strength = 0.8; bloom.threshold = 1.2;
  rain.visible = W.rain;
  lit = { time, weather: wx };
  dressWorld();
}
/** The parts of the conditions that live on the circuit: floodlights, and wet or dry tarmac. Re-run when a circuit's scenery loads. */
function dressWorld() {
  if (!world || !lit) return;
  const night = TIMES[lit.time].sun < 0, wet = WEATHER[lit.weather].rain;
  let flood = world.getObjectByName('floodlights');
  if (night && !flood) { flood = buildFloodlights(track, relief.ys); world.add(flood); }
  if (flood) flood.visible = night;
  // lit windows in the city at night (the facade texture has one window per 64-px tile, at 14..50 × 14..48)
  const walls = world.getObjectByName('buildings') as THREE.Mesh | undefined;
  if (walls) {
    const m = walls.material as THREE.MeshStandardMaterial;
    if (night && !m.emissiveMap) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff'; g.fillRect(14, 22, 36, 26);
      m.emissiveMap = new THREE.CanvasTexture(c); m.emissiveMap.wrapS = m.emissiveMap.wrapT = THREE.RepeatWrapping; m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      m.emissive.setHex(0xffc477); m.needsUpdate = true;
    }
    m.emissiveIntensity = night ? 0.9 : 0;
  }
  world.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
    if (m?.name !== 'asphalt') return;
    m.userData.dry ??= { roughness: m.roughness, color: m.color.getHex() };
    m.roughness = wet ? 0.12 : m.userData.dry.roughness;
    m.color.setHex(wet ? 0x5a5d62 : m.userData.dry.color);
  });
}

addEventListener('resize', resize); resize();

let race!: Race;
let carMeshes: THREE.Group[] = [];
let def: TrackDef, track!: Track, world: THREE.Group | null = null, relief!: Relief; // flat until the circuit's terrain loads
let driver = 'VER', difficulty = 3, laps = 15, startTyre = 1;

function loadTrack(d: TrackDef) {
  if (def === d) return;
  def = d; track = buildTrack(d); relief = makeRelief(track);
  if (world) { scene.remove(world); world.traverse(o => (o as THREE.Mesh).geometry?.dispose()); }
  world = null;
  mapPath = makeMapPath(track);
  // the real surroundings (buildings, tunnels, forests) and landscape load per circuit; the scenery is built once they arrive
  const want = d;
  Promise.all([CITY[`./buildings/${d.id}.json`](), TERRAIN[`./terrain/${d.id}.json`]()]).then(([c, ter]) => {
    if (def !== want) return;
    relief = makeRelief(track, ter.default);
    world = buildWorld(track, c.default, d.urban, relief); scene.add(world); dressWorld();
  });
}
const CITY = import.meta.glob<{ default: City }>('./buildings/*.json');
const TERRAIN = import.meta.glob<{ default: Terrain }>('./terrain/*.json');

let screen: 'menu' | 'race' | 'results' = 'menu';
let camMode = 0; // 0 chase, 1 cockpit, 2 TV
function clearCars() { carMeshes.forEach(m => scene.remove(m)); carMeshes = []; }
function newRace() {
  clearCars();
  race = career && mode === 'career'
    ? createRace(track, { ...OPTS, player: career.code, difficulty: career.difficulty, laps: career.laps, rookie: rookieOf(career), tyre: startTyre, weather })
    : createRace(track, { ...OPTS, player: driver, difficulty, laps, tyre: startTyre, weather });
  applyConditions(timeOfDay, weather);
  carMeshes = race.racers.map(r => {
    const m = makeCar(r.team, r.number);
    // the red light under the rear wing that flashes in the wet
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.16), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0 }));
    light.position.set(-2.32, 0.5, 0); m.add(light); m.userData.rainLight = light.material;
    scene.add(m); return m;
  });
  seatDriver();
  replay = makeReplay(race.racers.length + 1); // + the safety car
  incident = newIncidents(); debris.clear();
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
const LAP_CHOICES = [3, 5, 10, 15, 20, 25, 30];
const tyrePills = (el: string, rerender: () => void) => pills(el, COMPOUNDS.map(c => c.name), startTyre, i => { startTyre = i; }, rerender);
/** Time of day and weather pills; the menu backdrop previews them. */
function skyPills(timeEl: string, wxEl: string) {
  const again = () => skyPills(timeEl, wxEl);
  pills(timeEl, TIMES.map(t => t.name), timeOfDay, i => { timeOfDay = i; applyConditions(timeOfDay, weather); }, again);
  pills(wxEl, WEATHER.map(w => w.name), weather, i => { weather = i; applyConditions(timeOfDay, weather); }, again);
}
function renderSettings() {
  pills('difflist', DIFFICULTIES.map(d => d.name), difficulty, i => { difficulty = i; });
  const help = DIFFICULTIES[difficulty].assist;
  $('assist-note').textContent = help.steer ? 'Driving help: auto-braking, steering help and extra grip.'
    : help.brake ? 'Driving help: auto-braking for corners.' : 'No driving help.';
  pills('lapslist', LAP_CHOICES.map(n => `${n} laps`), LAP_CHOICES.indexOf(laps), i => { laps = LAP_CHOICES[i]; });
  tyrePills('tyrelist', renderSettings);
  skyPills('timelist', 'weatherlist');
}
$('start-btn').onclick = startRace;
$('race-btn').onclick = () => { mode = 'quick'; showMenu('tracks'); };

// --- career ---
const SAVE = 'herbie-f1-career';
let mode: 'quick' | 'career' = 'quick';
let career: Career | null = (() => { try { return JSON.parse(localStorage.getItem(SAVE) ?? 'null'); } catch { return null; } })();
function saveCareer() { try { if (career) localStorage.setItem(SAVE, JSON.stringify(career)); else localStorage.removeItem(SAVE); } catch { /* private mode: career lasts this visit */ } }
const draft = { difficulty: 3, laps: 15, look: { skin: 0, hair: 0, hairColor: 0 } as Look };
/** How a driver with this look appears out of the car, in a team's colours. */
const lookStyle = (look: Look, suit: number, gloves = 0x16171a): PersonStyle =>
  ({ suit, gloves, skin: SKIN_TONES[look.skin], hair: look.hair, hairColor: HAIR_COLOURS[look.hairColor].color });
function renderCareerNew() {
  const L = draft.look, again = renderCareerNew;
  pills('c-hair', HAIRSTYLES, L.hair, i => { L.hair = i; }, again);
  pills('c-haircol', HAIR_COLOURS.map(c => c.name), L.hairColor, i => { L.hairColor = i; }, again);
  pills('c-skin', SKIN_TONES.map(() => ''), L.skin, i => { L.skin = i; }, again);
  [...$('c-skin').children].forEach((b, i) => { (b as HTMLElement).style.background = hex(SKIN_TONES[i]); b.setAttribute('aria-label', `Skin tone ${i + 1}`); });
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
    career = newCareer({ name, number: num, team: t.name, difficulty: draft.difficulty, laps: draft.laps, look: { ...draft.look } });
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
  const hubTyres = () => tyrePills('hub-tyres', hubTyres); hubTyres();
  skyPills('hub-time', 'hub-weather');
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
  const car = makeCar(t, career?.number ?? 1), box = pitBox(track, TEAMS.indexOf(t)), y = relief.trackY(boxAt(TEAMS.indexOf(t)));
  car.position.set(box.x, y, box.z); scene.add(car);
  // the new signing, in the team's kit, next to the car
  const me = people && career ? people.make(lookStyle(career.look ?? draft.look, t.livery[0], t.livery[1])) : null;
  if (me) { me.root.position.set(box.x + Math.sin(box.heading) * 2.4, y, box.z - Math.cos(box.heading) * 2.4); me.root.rotation.y = Math.PI / 2 - box.heading + 0.6; me.play('Idle_Talking_Loop', 0); scene.add(me.root); }
  playCut({
    length: 6,
    update(time) {
      car.rotation.y = time * 0.6; me?.update(1 / 60);
      const a = -box.heading + 0.8;
      camera.position.set(box.x + Math.cos(a) * 8, y + 2.2, box.z + Math.sin(a) * 8);
      camera.lookAt(box.x, y + 0.6, box.z);
    },
    end() { scene.remove(car); if (me) scene.remove(me.root); showHub(); },
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
  if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) pickTyre(Number(e.code.slice(5)) - 1);
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
// TILT: steer by turning the iPad like a steering wheel. iPad asks for motion permission on the first tap; however it's
// held when switched on is straight ahead.
const tilt = { on: false, zero: null as number | null, steer: 0 };
const tiltBtn = touchLayer.querySelector<HTMLElement>('[data-act=tilt]')!;
tiltBtn.addEventListener('click', async () => {
  if (!tilt.on) {
    const ask = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (ask && await ask().catch(() => 'denied') !== 'granted') { flash('MOTION NOT ALLOWED'); return; }
  }
  tilt.on = !tilt.on; tilt.zero = null; tilt.steer = 0;
  tiltBtn.classList.toggle('on', tilt.on); tiltBtn.setAttribute('aria-pressed', String(tilt.on));
  if (tilt.on) flash('TILT TO STEER');
});
addEventListener('devicemotion', e => {
  if (!tilt.on || !e.accelerationIncludingGravity) return;
  const angle = wheelAngle(e.accelerationIncludingGravity, window.screen.orientation?.angle ?? Number((window as { orientation?: number }).orientation ?? 0)) // older iPads only have window.orientation;
  if (angle == null) { tilt.steer = 0; return; }
  tilt.zero ??= angle;
  tilt.steer = tiltSteer(angle, tilt.zero);
});
// iPad Safari ignores user-scalable=no, so two thumbs on the controls pinch-zoom the page and touch-action:none then stops you zooming back out.
const noZoom = (e: Event) => e.preventDefault();
for (const type of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(type, noZoom, { passive: false });
document.addEventListener('touchmove', e => { if (!document.body.classList.contains('menu')) e.preventDefault(); }, { passive: false });

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
  if (tilt.on) ctl.steer = Math.max(-1, Math.min(1, ctl.steer + tilt.steer));
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
  place(race.player.s, 0);
}
/** Put a racer (the player unless said) at `s` metres round the lap, `lat` right of the centreline, stopped. */
function place(s: number, lat: number, r: Racer = race.player) {
  const p = pointAt(track, s);
  let ds = p.i === r.i ? 0 : track.cum[p.i] - track.cum[r.i];
  if (ds > track.length / 2) ds -= track.length; if (ds < -track.length / 2) ds += track.length;
  r.total += ds; r.s = track.cum[p.i]; r.i = p.i;
  Object.assign(r.car, { x: p.x - Math.sin(p.heading) * lat, z: p.z + Math.cos(p.heading) * lat, heading: p.heading, speed: 0, steer: 0, spin: 0 });
  r.lateral = lat; r.inPitLane = false;
}

// tyre choice while you're in the pit lane, before the crew fit them
$('tyrebtns').replaceChildren(...COMPOUNDS.map((c, i) => {
  const b = button(c.name, () => pickTyre(i)); b.style.borderColor = hex(c.color); return b;
}));
function pickTyre(i: number) { if (race?.player.inPitLane && race.player.boxRequested) race.player.nextCompound = i; }

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
let lastPos = 20, msgTimer = 0, boxCalled = false, punctureCalled = false, warnedLap = -1;
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
  const life = tyreLife(p.compound, race.laps), tyre = Math.max(0, Math.min(100, Math.round((1 - (p.total - p.tyreFrom) / track.length / life) * 100)));
  $('tyres').textContent = p.punctured ? 'PUNCTURE' : `${COMPOUNDS[p.compound].name[0]} ${tyre}%`;
  $('tyres').style.color = p.punctured || tyre <= 15 ? '#ef4444' : tyre > 40 ? '' : '#facc15';
  if (p.punctured && !punctureCalled) flash('PUNCTURE! BOX NOW');
  punctureCalled = p.punctured;
  if (p.boxRequested && !boxCalled && race.phase === 'racing') flash('BOX, BOX · PIT THIS LAP');
  boxCalled = p.boxRequested;
  // the lap before a planned stop, a heads-up
  if (!p.boxRequested && p.pits < p.pitLaps.length && p.completed + 2 >= p.pitLaps[p.pits] && warnedLap !== p.completed && race.phase === 'racing') {
    warnedLap = p.completed; flash('PIT NEXT LAP');
  }
  // the way in: distance countdown and arrows on the road (not on World Class and Legendary)
  const help = DIFFICULTIES[race.difficulty].pit, rel = race.pit.rel(p.s), side = race.pit.side;
  const toEntry = PIT.a - rel, guided = p.boxRequested && help !== 'call' && !p.inPitLane && toEntry > -60 && toEntry < 700;
  const pitText = p.inPitLane && rel > PIT.b && rel < PIT.c ? 'PIT LANE · 80 km/h' : guided
    ? (help === 'auto' ? 'AUTO PIT · ' : '') + (side > 0 ? `PIT ENTRY ${Math.max(0, Math.round(toEntry))} m ▶` : `◀ PIT ENTRY ${Math.max(0, Math.round(toEntry))} m`) : '';
  $('pitinfo').textContent = pitText; $('pitinfo').classList.toggle('hidden', !pitText || !!cut);
  const arrows = world?.getObjectByName('pitArrows');
  if (arrows) arrows.visible = guided || (p.boxRequested && help !== 'call' && p.inPitLane && rel < PIT.b);
  const picking = p.inPitLane && p.boxRequested && rel > PIT.b && !cut; // once you're on the limiter, not while steering in
  $('tyrepick').classList.toggle('hidden', !picking);
  if (picking) [...$('tyrebtns').children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === p.nextCompound)));
  $('box').classList.toggle('on', p.boxRequested);
  touchLayer.querySelector('[data-act=box]')!.classList.toggle('on', p.boxRequested);
  // flags: the safety car, or a yellow for a car spinning (or a wreck sliding) in the next 500 m
  const L = track.length, yellow = race.racers.some(r => r !== p && (r.car.spin !== 0 || r.out && r.car.speed > 0) && ((r.s - p.s) % L + L) % L < 500);
  const flagText = race.safety ? 'SAFETY CAR' : yellow ? 'YELLOW FLAG' : '';
  $('flag').textContent = flagText; $('flag').classList.toggle('hidden', !flagText);
  const leader = order[0];
  $('rows').innerHTML = order.map((r, k) => {
    const gap = r.out ? 'OUT' : k === 0 ? 'Leader' : r.finished && leader.finished ? `+${(r.finishTime - leader.finishTime).toFixed(1)}s`
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
  $('verdict').textContent = race.player.out ? `You crashed out of the ${def.gp}` : pos === 1 ? `You won the ${def.gp}!` : `You finished P${pos}`;
  const inCareer = mode === 'career' && !!career;
  if (inCareer) { recordRace(career!, order.map(r => r.code)); saveCareer(); }
  $('again').classList.toggle('hidden', inCareer); $('home-btn').classList.toggle('hidden', inCareer);
  $('continue').classList.toggle('hidden', !inCareer);
  $('resrows').innerHTML = order.map((r, k) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${k + 1}</td><td>${esc(r.name)}</td><td class="team">${esc(r.team.name)}</td><td>${
    r.out ? 'DNF' : r === winner ? fmt(r.finishTime) : r.finished ? `+${(r.finishTime - winner.finishTime).toFixed(3)}s` : `${r.completed}/${race.laps} laps`
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
      const y = relief.groundY(p.x - Math.sin(p.heading) * off, p.z + Math.cos(p.heading) * off);
      camera.position.set(p.x - Math.sin(p.heading) * off, y + 4 + 3 * (1 - e), p.z + Math.cos(p.heading) * off);
      camera.lookAt(me.x * e + p.x * (1 - e), me.y + 0.5, me.z * e + p.z * (1 - e));
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
    const m = people!.make(r.isPlayer && mode === 'career' && career ? lookStyle(career.look ?? draft.look, r.team.livery[0], r.team.livery[1]) : { suit: r.team.livery[0], gloves: r.team.livery[1] });
    const [z, h] = PODIUM_STEPS[k];
    m.root.position.set(0, h, z); m.root.rotation.y = Math.PI / 2; // model faces +z; podium front is +x
    m.play(['Dance_Loop', 'Jump_Loop', 'Idle_Talking_Loop'][k], 0); m.update(k * 0.7);
    podium.add(m.root); return m;
  }) : [];
  // out beyond the garages, facing the track
  const px = box.x - Math.sin(box.heading) * side * 40, pz = box.z + Math.cos(box.heading) * side * 40;
  podium.position.set(px, relief.groundY(px, pz), pz);
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
      camera.position.set(podium.position.x + Math.cos(-a) * 7.5, podium.position.y + 2.1, podium.position.z + Math.sin(-a) * 7.5);
      camera.lookAt(podium.position.x, podium.position.y + 1.5, podium.position.z);
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
    length: T.go + 0.8,
    update(t) {
      // in down the pit lane and onto the marks; you drive it out yourself once the light goes green
      const along = t < T.arrive ? -22 * (1 - ease(clamp01(t / T.arrive))) : 0;
      const lift = t > T.jackUp && t < T.jackDown ? 0.09 * clamp01((t - T.jackUp) / 0.12) : 0;
      mesh.position.copy(box).addScaledVector(fwd, along); mesh.position.y = box.y + lift;
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
      if (t >= T.go) $('cut-sub').textContent = `Stationary ${p.stopTime.toFixed(1)}s · ${COMPOUNDS[p.nextCompound].name.toLowerCase()}s on`;
      // low camera off the front corner, crew side
      const cam = new THREE.Vector3(4.6, 1.2, 4.2 - t * 0.15).applyAxisAngle(new THREE.Vector3(0, 1, 0), -heading).add(box);
      camera.position.copy(cam); camera.lookAt(mesh.position.x, box.y + 0.5, mesh.position.z);
    },
    end() {
      scene.remove(crewRoot);
      mesh.position.y = box.y;
      for (const pr of tyreProps) pr.wheel.visible = true;
      while (race.player.pitTimer > 0) stepRace(race, STEP, { throttle: 0, brake: 0, steer: 0 });
      flash('GO GO GO');
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
      camera.position.set(mesh.position.x + Math.cos(a) * 7, mesh.position.y + 2.4, mesh.position.z + Math.sin(a) * 7);
      camera.lookAt(mesh.position.x, mesh.position.y + 0.6, mesh.position.z);
    },
    end() {
      for (const w of wheels) w.position.z = 0;
      scene.remove(crew);
      while (race.player.pitTimer > 0) stepRace(race, STEP, { throttle: 0, brake: 0, steer: 0 });
      flash('GO GO GO');
    },
  }, 'PIT STOP', `${p.team.name} crew · new tyres`);
}

// --- the Blender car: loaded in the background; races started before it arrives use the procedural car ---
loadCarModel().catch(e => console.warn('car model unavailable', e));

// --- people: loaded in the background; until then the old stand-ins are used ---
let people: People | null = null;
People.load().then(p => { people = p; if (race && !driverRig) seatDriver(); }).catch(e => console.warn('people models unavailable', e));

/** The player's driver: seated in the car, hands on a working steering wheel. */
let driverRig: { person: Person; wheel: THREE.Group; spin: THREE.Group; hands: { side: 'l' | 'r'; bone: THREE.Bone; wrist: THREE.Vector3; rot: THREE.Quaternion }[]; display: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; t: number }; leds: THREE.Mesh[] } | null = null;
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
  // palms (between wrist and knuckles) are where the grips go
  const palm = (side: string) => local(person.bone(`hand_${side}`)).add(local(person.bone(`middle_01_${side}`))).multiplyScalar(0.5);
  const pl = palm('l'), pr = palm('r');
  // steering wheel where the hands are: F1-style rectangle with grips, screen and rev lights
  const wheel = new THREE.Group(), spin = new THREE.Group();
  wheel.position.copy(pl).add(pr).multiplyScalar(0.5); wheel.rotation.z = 0.35;
  const half = Math.max(0.1, Math.abs(pl.z - pr.z) / 2);
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
  car.updateMatrixWorld(true);
  // lock each hand to the wheel as it is now (wheel straight): wrist position and hand orientation in the wheel's frame
  const spinQ = spin.getWorldQuaternion(new THREE.Quaternion()).invert();
  const hands = (['l', 'r'] as const).map(side => {
    const bone = person.bone(`hand_${side}`), wrist = spin.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    const grip = grips[(side === 'l') === (pl.z < pr.z) ? 0 : 1];
    grip.position.copy(spin.worldToLocal(car.localToWorld((side === 'l' ? pl : pr).clone())));
    return { side, bone, wrist, rot: spinQ.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())) };
  });
  driverRig = { person, wheel, spin, hands, display: { ctx: c.getContext('2d')!, tex, t: 0 }, leds };
}
function updateDriver(dt: number) {
  if (!driverRig) return;
  const c = race.player.car, { person, spin, hands, display, leds } = driverRig;
  person.update(dt);
  spin.rotation.x = c.steer * 0.8; // turns the same way as the car; ~45° at full lock keeps the arms out of the driver's view
  spin.updateWorldMatrix(true, true);
  const spinQ = spin.getWorldQuaternion(new THREE.Quaternion()), pq = new THREE.Quaternion();
  for (const h of hands) {
    // arms reach the wrist's spot on the wheel, then the hand turns with the wheel so it stays wrapped round the grip
    reachWith(person.bone(`upperarm_${h.side}`), person.bone(`lowerarm_${h.side}`), h.bone, spin.localToWorld(h.wrist.clone()));
    h.bone.parent!.getWorldQuaternion(pq);
    h.bone.quaternion.copy(pq.invert().multiply(spinQ.clone().multiply(h.rot)));
  }
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

// --- the career driver preview: its own little renderer beside the form ---
const avatar = (() => {
  let r: THREE.WebGLRenderer | null = null, person: Person | null = null, key = '', spin = 0;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 240 / 300, 0.1, 20);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.4));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2); keyLight.position.set(1.5, 3, 2.5); sc.add(keyLight);
  cam.position.set(0, 1.42, 2.3); cam.lookAt(0, 1.3, 0);
  return {
    update(dt: number) {
      if (!people || $('career-new').classList.contains('hidden')) return;
      r ??= new THREE.WebGLRenderer({ canvas: $('c-avatar') as HTMLCanvasElement, antialias: true, alpha: true });
      r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1;
      const k = JSON.stringify(draft.look);
      if (k !== key) {
        key = k; if (person) sc.remove(person.root);
        person = people.make(lookStyle(draft.look, 0xe10600, 0x111111)); person.play('Idle_Loop', 0); sc.add(person.root);
      }
      spin += dt * 0.5; person!.root.rotation.y = Math.sin(spin) * 0.6;
      person!.update(dt); r.render(sc, cam);
    },
  };
})();

// --- spray: misty puffs thrown up behind each car's rear wheels in the rain ---
const spray = (() => {
  const N = 900, tex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: 0xeef2f6, transparent: true, depthWrite: false, opacity: 0.5 }), N);
  mesh.frustumCulled = false; mesh.count = 0; scene.add(mesh); seeThrough.push(mesh);
  const P = Array.from({ length: N }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 9, life: 1 }));
  let next = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  return {
    update(dt: number, raining: boolean) {
      for (const r of race.racers) {
        // spray in the wet; tyre smoke from a car spinning, whatever the weather
        const c = r.car, sp = Math.abs(c.speed), smoke = c.spin !== 0;
        if (!raining && !smoke || sp < (smoke ? 3 : 12) || r.pitTimer > 0) continue;
        const fx = Math.cos(c.heading), fz = Math.sin(c.heading);
        for (let k = 0; k < Math.min(3, sp / 20); k++) {
          const p = P[next]; next = (next + 1) % N;
          const side = (k % 2 ? 1 : -1) * 0.8;
          Object.assign(p, { x: c.x - fx * 2.2 - fz * side, y: relief.trackY(r.s) + 0.3, z: c.z - fz * 2.2 + fx * side,
            vx: fx * sp * 0.35 + (Math.random() - 0.5) * 2, vy: 1.5 + Math.random() * 2, vz: fz * sp * 0.35 + (Math.random() - 0.5) * 2, age: 0, life: 0.5 + Math.random() * 0.5 });
        }
      }
      let n = 0;
      q.copy(camera.quaternion);
      for (const p of P) {
        if (p.age >= p.life) continue;
        p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= 0.96; p.vz *= 0.96;
        const k = p.age / p.life, s = 0.8 + k * 3.2;
        mesh.setMatrixAt(n++, m.compose(v.set(p.x, p.y, p.z), q, sc.set(s, s * 0.7, s)));
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.35;
    },
  };
})();

// --- the safety car: a silver GT with a light bar ---
const safetyCar = (() => {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xc4c8cc, metalness: 0.8, roughness: 0.3, clearcoat: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0d1014, roughness: 0.1, metalness: 0.6 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xff9900, emissiveIntensity: 0 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.62, 1.95), paint); body.position.y = 0.62;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2, 0.48, 1.6), glass); cabin.position.set(-0.5, 1.15, 0);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 1.3), lamp); bar.position.set(-0.5, 1.44, 0);
  g.add(body, cabin, bar);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  for (const [x, z] of [[1.45, 0.88], [1.45, -0.88], [-1.45, 0.88], [-1.45, -0.88]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 16), tyre); w.rotation.x = Math.PI / 2; w.position.set(x, 0.34, z); g.add(w);
  }
  g.traverse(o => { o.castShadow = true; });
  g.visible = false; g.userData.lamp = lamp; scene.add(g);
  return g;
})();
function showSafetyCar(f: Frame | null, now: number) {
  safetyCar.visible = !!f?.on;
  if (!f?.on) return;
  safetyCar.position.set(f.x, relief.trackY(f.s), f.z); safetyCar.rotation.set(0, -f.heading, 0);
  (safetyCar.userData.lamp as THREE.MeshStandardMaterial).emissiveIntensity = Math.floor(now / 300) % 2 ? 6 : 0.5;
}
const safetyFrame = (): Frame => {
  const sc = race.safety;
  if (!sc) return { x: 0, z: 0, heading: 0, steer: 0, s: 0, on: false };
  const p = pointAt(track, sc.s);
  return { x: p.x, z: p.z, heading: p.heading, steer: 0, s: sc.s, on: true };
};

// --- debris: bits of carbon and bodywork thrown off in a hit, left lying on the track ---
const debris = (() => {
  const N = 160, mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.035, 0.18), new THREE.MeshStandardMaterial({ roughness: 0.5 }), N);
  mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; scene.add(mesh);
  const P = Array.from({ length: N }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, a: 0, ground: 0 }));
  let next = 0, used = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  return {
    get count() { return used; },
    burst(r: Racer) {
      const c = r.car, ground = relief.trackY(r.s), fx = Math.cos(c.heading), fz = Math.sin(c.heading);
      for (let k = 0; k < 12; k++) {
        const p = P[next];
        Object.assign(p, { x: c.x + fx * 2, y: ground + 0.4, z: c.z + fz * 2, vx: fx * c.speed * 0.4 + (Math.random() - 0.5) * 8, vy: 2 + Math.random() * 5,
          vz: fz * c.speed * 0.4 + (Math.random() - 0.5) * 8, spin: 6 + Math.random() * 10, a: Math.random() * 6, ground });
        mesh.setColorAt(next, col.setHex(k % 3 ? 0x1c1d21 : r.color));
        next = (next + 1) % N; used = Math.min(N, used + 1);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    update(dt: number) {
      for (let k = 0; k < used; k++) {
        const p = P[k];
        if (p.y > p.ground + 0.02 || p.vy > 0) { p.vy -= 9.8 * dt; p.a += p.spin * dt; } else { p.vy = 0; p.y = p.ground + 0.02; p.vx *= 0.85; p.vz *= 0.85; }
        p.x += p.vx * dt; p.y = Math.max(p.ground + 0.02, p.y + p.vy * dt); p.z += p.vz * dt;
        mesh.setMatrixAt(k, m.compose(v.set(p.x, p.y, p.z), q.setFromEuler(e.set(p.a, p.a * 0.7, 0)), one));
      }
      mesh.count = used; mesh.instanceMatrix.needsUpdate = true;
    },
    clear() { used = 0; mesh.count = 0; },
  };
})();

// --- TV replays: the last seconds of every car, shown from trackside cameras, in slow motion for the big moments ---
let replay = makeReplay(1), replaying = false;
/** A trackside TV camera ahead of the action, looking at it; zoomed in to keep the car a good size in the shot. */
function tvShot(s: number, x: number, y: number, z: number, spacing = 250, zoom = false) {
  const post = Math.ceil(s / spacing) * spacing, tv = pointAt(track, post);
  const tx = tv.x - Math.sin(tv.heading) * 30, tz = tv.z + Math.cos(tv.heading) * 30;
  camera.position.set(tx, Math.max(relief.groundY(tx, tz), relief.trackY(post)) + 9, tz);
  camera.lookAt(x, y + 0.5, z);
  if (zoom) { camera.fov = Math.max(8, Math.min(55, 2 * Math.atan(7 / camera.position.distanceTo(v3.set(x, y, z))) * 180 / Math.PI)); camera.updateProjectionMatrix(); }
}
const v3 = new THREE.Vector3();
/** Play back race time `from`..`to` following racer `focus`, at `rate(time)` × real speed, then `then`. Holds the race meanwhile. */
function playReplay(from: number, to: number, focus: Racer, sub: string, rate: (time: number) => number, then: () => void) {
  from = Math.max(from, replay.from); to = Math.min(to, replay.to);
  const k = race.racers.indexOf(focus);
  let clock = from, last = 0;
  replaying = true;
  playCut({
    length: 600, pause: true,
    update(t) {
      clock += (t - last) * rate(clock); last = t;
      if (clock >= to && cut) cut.length = 0;
      race.racers.forEach((_, i) => {
        const f = replay.sample(clock, i), m = carMeshes[i];
        m.position.set(f.x, relief.trackY(f.s), f.z); m.rotation.set(0, -f.heading, 0);
      });
      showSafetyCar(replay.sample(clock, race.racers.length), performance.now());
      const f = replay.sample(clock, k);
      tvShot(f.s, f.x, relief.trackY(f.s), f.z, 160, true);
    },
    end() { replaying = false; then(); },
  }, 'REPLAY', sub);
}
const newIncidents = () => ({ spinAt: -1, outAt: new Map<Racer, number>(), safetyFor: null as Racer | null, safetyAt: 0, hadSafety: false, damage: new Map<Racer, number>() });
let incident = newIncidents();
/** Spot the moments worth a flash or a replay: your spins and crashes, damage, a crash that brings out the safety car. */
function watchIncidents() {
  const p = race.player, I = incident;
  for (const r of race.racers) {
    if (r.damage > (I.damage.get(r) ?? 0) + 0.05) { debris.burst(r); if (r.isPlayer && !r.out) flash('FRONT WING DAMAGE'); }
    I.damage.set(r, r.damage);
    if (r.out && !I.outAt.has(r)) {
      I.outAt.set(r, race.time);
      if (r.isPlayer) flash('CRASHED OUT');
      else if (race.safety && !I.safetyFor) { I.safetyFor = r; I.safetyAt = race.time; }
    }
  }
  if (race.safety && !I.hadSafety) flash('SAFETY CAR');
  if (!race.safety && I.hadSafety && race.phase === 'racing') flash('GREEN FLAG');
  I.hadSafety = !!race.safety;
  if (p.out || screen !== 'race') return;
  if (p.car.spin && I.spinAt < 0) { I.spinAt = race.time; flash('SPIN!'); }
  if (I.spinAt >= 0 && !p.car.spin) {
    const from = I.spinAt - 3; I.spinAt = -1;
    return playReplay(from, race.time, p, 'Spin!', () => 0.5, () => {});
  }
  const sc = I.safetyFor;
  if (sc && race.time - I.safetyAt > 2.5) {
    I.safetyFor = null;
    playReplay(I.outAt.get(sc)! - 3, race.time, sc, `${sc.name} crashes out · safety car`, () => 0.5, () => {});
  }
}
$('watch').onclick = () => {
  const p = race.player, out = incident.outAt.get(p);
  const end = out ?? (p.finished ? p.finishTime : race.time);
  playReplay(end - (out ? 3 : 12), end + (out ? 6 : 2), p, out ? 'Crashed out' : 'The finish',
    t => (!out && t > end - 2.5 ? 0.35 : out ? 0.5 : 1), () => {});
};

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
    composer.render(dt);
    avatar.update(dt);
    requestAnimationFrame(frame);
    return;
  }

  const ctl = screen === 'race' && !cut ? readControls() : { throttle: 0, brake: 0, steer: 0 };
  acc += dt;
  while (acc >= STEP) { if (!cut?.pause) stepRace(race, STEP, ctl); acc -= STEP; }
  // the replay keeps everything from the start until just after you take the flag (or crash out)
  const p = race.player, outAt = incident.outAt.get(p);
  if (!cut?.pause && race.phase !== 'countdown' && (!p.finished || race.time < p.finishTime + 3))
    replay.record(race.time, [...race.racers.map(r => ({ x: r.car.x, z: r.car.z, heading: r.car.heading, steer: r.car.steer, s: r.s, on: true })), safetyFrame()]);
  if (!cut) watchIncidents();
  if (screen === 'race' && race.phase === 'finished' && !cut) {
    if (!p.out) { screen = 'results'; playPodium(); }
    else if (outAt !== undefined && (p.car.speed === 0 || race.time - outAt > 4)) {
      // crashed out: once the car's stopped, the crash again in slow motion, then the results
      screen = 'results'; playReplay(outAt - 3, race.time, p, 'Crashed out', () => 0.5, showResults);
    }
  }

  race.racers.forEach((r, k) => {
    const m = carMeshes[k], { car } = r;
    // on the road's real height, nose up the slope (the car's nose is +x, so pitch is about z)
    const along = Math.cos(car.heading - pointAt(track, r.s).heading);
    m.position.set(car.x, relief.trackY(r.s), car.z); m.rotation.set(0, -car.heading, Math.atan(relief.slope(r.s)) * along);
    for (const w of m.userData.wheels as THREE.Mesh[]) w.rotation.z -= car.speed * dt / 0.36;
    for (const f of m.userData.front as THREE.Group[]) f.rotation.y = -car.steer * maxSteerAngle(car.speed) * 2;
    (m.userData.stripe as THREE.MeshStandardMaterial).color.setHex(COMPOUNDS[r.compound].color);
    (m.userData.rainLight as THREE.MeshStandardMaterial).emissiveIntensity = rain.visible && Math.floor(now / 250) % 2 ? 4 : 0;
  });
  updateDriver(dt);
  showSafetyCar(safetyFrame(), now);
  debris.update(dt);

  const c = race.player.car, fx = Math.cos(c.heading), fz = Math.sin(c.heading), cy = relief.trackY(race.player.s);
  if (race.player.pitTimer > 0 && !cut && screen === 'race') startPitScene();
  if (cut) {
    cut.t += dt;
    cut.update(cut.t);
    if (cut.t >= cut.length) endCut();
  } else if (camMode === 1) {
    // driver's eyes: just in front of the head bone, looking down the road over the wheel
    const eye = driverRig ? driverRig.person.bone('Head').getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(c.x, cy + 1.0, c.z);
    camera.position.set(eye.x + fx * 0.12, eye.y + 0.07, eye.z + fz * 0.12);
    camera.lookAt(c.x + fx * 30, relief.trackY(race.player.s + 30) + 0.5, c.z + fz * 30);
  } else if (camMode === 2) {
    // TV camera: fixed trackside point ahead of the car, hops forward as it passes
    tvShot(race.player.s, c.x, cy, c.z);
  } else {
    // fixed distance behind; only the camera's direction lags, so it swings out a little in corners
    if (!camPos.lengthSq()) camYaw = c.heading;
    camYaw += wrapAngle(c.heading - camYaw) * (1 - Math.exp(-dt * 6));
    // height follows the road: never below the car, nor the ground behind it on a descent
    const bx = c.x - Math.cos(camYaw) * 7.5, bz = c.z - Math.sin(camYaw) * 7.5;
    camPos.set(bx, Math.max(cy, relief.groundY(bx, bz), relief.trackY(race.player.s - 7.5)) + 2.6, bz);
    camLook.set(c.x + fx * 6, relief.trackY(race.player.s + 6) + 1, c.z + fz * 6);
    camera.position.copy(camPos); camera.lookAt(camLook);
  }
  // a wider view as speed builds sells the speed
  const fov = (camMode === 1 ? 72 : 62) + Math.min(14, Math.abs(c.speed) * 0.15);
  if (!replaying && Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  aimSun(c.x, c.z, cy);

  updateHud(dt);
  audio.update(gearFor(c.speed).rpm, ctl.throttle);
  spray.update(dt, rain.visible);
  if (rain.visible) { const u = (rain.material as THREE.ShaderMaterial).uniforms; u.uTime.value = now / 1000; u.uCam.value.copy(camera.position); }
  composer.render(dt);
  requestAnimationFrame(frame);
}
loadTrack(CIRCUITS[0]);
applyConditions(timeOfDay, weather);
showMenu('home');
requestAnimationFrame(frame);

// e2e tests and console debugging
Object.assign(window, { __game: { get race() { return race; }, touch, place,
  conditions: () => ({ time: TIMES[lit?.time ?? 0].name, weather: WEATHER[lit?.weather ?? 0].name, sun: TIMES[lit?.time ?? 0].sun, raining: rain.visible, floodlights: !!world?.getObjectByName('floodlights')?.visible }),
  stats: () => ({ pitArrows: !!world?.getObjectByName('pitArrows')?.visible, buildings: world?.userData.buildings ?? 0, tunnels: world?.userData.tunnels ?? 0, fans: world?.userData.fans ?? 0, forest: world?.userData.forest ?? 0, trees: world?.userData.trees ?? 0, carY: race ? carMeshes[race.racers.indexOf(race.player)]?.position.y ?? 0 : 0, calls: renderer.info.render.calls, driver: !!driverRig, people: !!people, carModel: carModelLoaded(), blenderCars: carMeshes.filter(m => m.userData.blender).length, safetyCar: safetyCar.visible, debris: debris.count }), three: { renderer, scene, sky } } });
