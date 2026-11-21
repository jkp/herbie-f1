<img src="assets/icon.svg" width="64" height="64" alt="">

# herbie-f1

A 3D Formula One racing game in the browser (three.js + TypeScript + Vite). Race five AI drivers over three laps of Silverstone.

## Play

```fish
npm install
npm run dev
```

Open the printed URL, press **Enter**.

| Key | Action |
| --- | --- |
| ↑ / W | Throttle |
| ↓ / S / Space | Brake, reverse when stopped |
| ← → / A D | Steer |
| C | Chase / cockpit / TV camera |
| R | Put the car back on the track |
| M | Mute engine |

Gamepads work too (left stick, RT throttle, LT brake). On an iPad or phone, on-screen ◀ ▶ / GAS / BRAKE buttons appear; tap to start.

URL options: `?laps=5&opponents=8&countdown=0`.

## Code

| File | What |
| --- | --- |
| `src/track.ts` | Centreline geometry, projection onto the track |
| `src/silverstone.ts` | Silverstone centreline from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT) |
| `src/car.ts` | Car physics: power, drag, downforce grip, braking, steering |
| `src/ai.ts` | Speed profile and pure-pursuit AI drivers |
| `src/race.ts` | Grid, countdown, laps, collisions, barriers, standings |
| `src/scene.ts` | Track, scenery and car meshes |
| `src/main.ts` | Render loop, input, camera, HUD, engine sound |

Simulation code has no three.js dependency, so it runs headless in tests.

## Tests

```fish
npm test        # unit + full-race integration sim
npm run e2e     # Playwright: load the game and drive
```
