# threejs-tactical-fps

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/0xberuuu/threejs-tactical-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/0xberuuu/threejs-tactical-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

BREACHLINE — a round-based tactical first-person shooter in the style Counter-Strike made famous, built on three.js 0.187.0 from static files with no build step and no network request. Two teams of four fight short rounds on an original dusk container-terminal map: plant or defuse the pulse charge, or eliminate the enemy team. Money earned between rounds buys better guns, grenades and kevlar in the buy menu. Single-player against seven bots that follow lane plans, hold angles, rotate on sound, retake sites and defuse. Original map, art, sounds and names throughout.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=81sbep4r&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>

## The game

You are a Vanguard attacking the Meridian Yard container terminal at dusk,
with three bot teammates, against four Sentinel defender bots.

- **Rounds**: first team to 5 rounds wins (max 9). Rounds are won by
  eliminating the enemy team, detonating the pulse charge, defusing it, or
  running the clock out on defence.
- **Objective**: carry the pulse charge to Site A (Fuel Depot) or Site B
  (Crane Platform) and hold E to plant it. Defenders hold E at the planted
  charge to defuse. The charge beeps faster as detonation nears.
- **Economy**: $800 to start, $300 per kill, $1,400+ per round win, with a
  rising loss bonus. Spend it in the buy menu (B) during freeze time: SMG,
  rifle, marksman rifle, frag and smoke grenades, kevlar.
- **Gunplay**: hitscan with headshot multipliers, recoil and bloom, spread
  that punishes firing on the move, crouching, jumping, and AABB collision.
  Stopping to aim pays.
- **Bots**: waypoint navigation over a hand-built nav graph, vision cones
  and hearing, burst fire with reaction times, lane plans, hold positions,
  rotations on sound, retakes, plants and defuses.
- **Presentation**: dusk palette with sodium lamps, procedural canvas
  textures, synthesized Web Audio sound, tracers, impact sparks, smoke
  clouds, camera shake, kill feed, minimap, and a scoreboard.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Click | Fire |
| R | Reload |
| 1 / 2 | Primary / sidearm |
| Q / G | Frag / smoke grenade |
| Ctrl | Crouch |
| Space | Jump |
| Shift | Walk slowly |
| E (hold) | Plant / defuse |
| B | Buy menu (freeze time) |
| Tab | Scoreboard |

## Screenshot staging (deterministic frames for captures)

```sh
http://localhost:8080/?shot=start&seed=1
http://localhost:8080/?shot=buy&seed=1
http://localhost:8080/?shot=play&seed=1
http://localhost:8080/?shot=end&seed=1
```

## Layout

- `game/index.html` — shell, HUD markup, import map for three.js
- `game/src/` — one module per job: `main.js` (boot + fixed-step loop),
  `state.js` (the one store), `mapdata.js` (map + nav graph), `world.js`
  (meshes + lighting), `physics.js` (collision + line of sight),
  `player.js`, `weapons.js`, `combat.js` (hitscan + grenades + effects),
  `bots.js`, `rounds.js` (flow + economy), `characters.js` (meshes +
  viewmodel), `hud.js`, `input.js`, `audio.js`, `palette.js`, `rng.js`
- `game/vendor/three/` — three.js 0.187.0, byte for byte from the kit
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged
- `main.ts` — hands the game in: copies `game/` + `screenshots/` to
  `/output` and writes `dossier.json`
- `screenshots/` — real renders of the game's own code

## Licence

MIT — see LICENSE. three.js is MIT-licensed by its authors; its LICENSE
ships in `game/vendor/three/`.
