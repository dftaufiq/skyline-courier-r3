// Skyline Courier flight model + sorties. One plane, one archipelago, three
// ways to fly it. All speeds in knots, altitudes in metres, headings in
// radians clockwise from north. The renderer only reads this state; it never
// writes it.
import {
  STALL_SPEED, MAX_SPEED, CLIMB_RATE, SINK_RATE, TURN_RATE,
  FUEL_BURN, FUEL_IDLE, SORTIES, AIRSTRIPS,
} from './config.js';
import { createRandom } from './random.js';

const KNOT_TO_MS = 0.514444;
const DEG = Math.PI / 180;

export function createFlight(terrain, sortieId, seed) {
  const sortie = SORTIES.find((s) => s.id === sortieId) ?? SORTIES[0];
  const rand = createRandom(seed * 7 + 11);
  const state = {
    sortie,
    phase: 'flying', // flying | landed | crashed | complete | failed
    x: 5120,
    y: 320,
    z: 7600,
    heading: 0, // north, toward Isla Verde
    pitch: 0,
    roll: 0,
    speed: 110,
    throttle: 0.62,
    fuel: sortie.fuel,
    damage: 0,
    score: 0,
    timeLeft: sortie.timeLimit,
    elapsed: 0,
    ringsPassed: 0,
    landings: 0,
    delivered: false,
    message: '',
    messageT: 0,
    crashReason: '',
    windGust: 0,
    events: [], // one-shot strings the audio layer drains
  };

  // Rings: a tour of the archipelago, each one visible from the last.
  const ringStops = [
    { x: 5120, z: 6200, y: 300 },
    { x: 4200, z: 4800, y: 380 },
    { x: 2900, z: 3300, y: 520 },
    { x: 4200, z: 3300, y: 340 },
    { x: 6200, z: 3600, y: 300 },
    { x: 7400, z: 3600, y: 260 },
    { x: 7000, z: 5600, y: 320 },
    { x: 5600, z: 7000, y: 280 },
    { x: 3300, z: 7300, y: 240 },
  ];
  const ringCount = sortie.rings;
  state.rings = ringStops.slice(0, ringCount).map((r, i) => ({
    ...r,
    radius: 55,
    passed: false,
    index: i,
  }));
  state.nextRing = state.rings[0] ?? null;
  state.targetStrip = AIRSTRIPS[0];
  state.visitedStrips = new Set();
  // Storm courier: the satchel goes to Turtle Bay, guided by 3 rings.
  if (sortie.id === 'storm') {
    state.rings = [
      { x: 4600, z: 6600, y: 300, radius: 55, passed: false, index: 0 },
      { x: 3900, z: 7000, y: 260, radius: 55, passed: false, index: 1 },
      { x: 3300, z: 7300, y: 220, radius: 55, passed: false, index: 2 },
    ];
    state.nextRing = state.rings[0];
    state.targetStrip = AIRSTRIPS[2];
  }

  function say(text) {
    state.message = text;
    state.messageT = 3.2;
    state.events.push(`say:${text}`);
  }

  function update(dt, input) {
    if (state.phase === 'landed') {
      // Sit on the runway a moment — the landing should read — then roll on.
      state.landedT -= dt;
      state.speed = 0;
      if (state.landedT <= 0 && state.resumeAfterLanding) {
        state.phase = 'flying';
        state.resumeAfterLanding = false;
        state.y = terrain.heightAt(state.x, state.z) + 4;
        state.speed = 62;
        state.throttle = 0.7;
        say(`NEXT: ${state.targetStrip.name.toUpperCase()} — throttle up!`);
      }
      return;
    }
    if (state.phase !== 'flying') return;
    state.elapsed += dt;
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      state.phase = 'failed';
      state.crashReason = 'OUT OF TIME — the mail is late';
      state.events.push('fail');
      return;
    }
    if (state.messageT > 0) state.messageT -= dt;

    // Wind: slow gusts that push the nose and the altitude around.
    const gust = Math.sin(state.elapsed * 0.7) * 0.6 + Math.sin(state.elapsed * 1.9) * 0.4;
    state.windGust = gust * sortie.wind;

    // Throttle: W/S or Shift/Ctrl, eased toward the target.
    const throttleTarget = input.throttle;
    state.throttle += (throttleTarget - state.throttle) * Math.min(1, dt * 2.2);
    if (state.fuel <= 0) state.throttle = 0;

    // Fuel burns with the throttle.
    state.fuel = Math.max(0, state.fuel - (FUEL_IDLE + (FUEL_BURN - FUEL_IDLE) * state.throttle) * dt);

    // Pitch and roll answer the stick at once, and ease back when released.
    const pitchTarget = input.pitch * 0.42;
    const rollTarget = input.roll * 1.05;
    state.pitch += (pitchTarget - state.pitch) * Math.min(1, dt * 3.2);
    state.roll += (rollTarget - state.roll) * Math.min(1, dt * 3.2);

    // Speed: throttle pulls it up, drag and climb pull it down.
    const targetSpeed = 42 + state.throttle * (MAX_SPEED - 42) - Math.max(0, state.pitch) * 260;
    state.speed += (targetSpeed - state.speed) * Math.min(1, dt * 0.55);
    if (input.brake) state.speed -= 34 * dt;
    state.speed = Math.max(28, state.speed);

    // Heading turns with the bank; the wind nudges it.
    state.heading += Math.sin(state.roll) * TURN_RATE * dt * (0.35 + state.speed / MAX_SPEED);
    state.heading += state.windGust * 0.012 * dt;
    state.heading = (state.heading + Math.PI * 2) % (Math.PI * 2);

    // Altitude: pitch and throttle climb, gravity and stall sink.
    const ms = state.speed * KNOT_TO_MS;
    let vy = Math.sin(state.pitch) * ms * 1.15;
    vy += (state.throttle - 0.45) * CLIMB_RATE;
    vy -= SINK_RATE * (1 - state.throttle * 0.6);
    if (state.speed < STALL_SPEED) vy -= (STALL_SPEED - state.speed) * 0.35; // the wing gives up
    vy += state.windGust * 1.4;
    if (input.brake) vy -= 2.5;
    state.y += vy * dt;
    state.verticalSpeed = vy;

    // Move over the ground.
    const fx = Math.sin(state.heading);
    const fz = -Math.cos(state.heading);
    state.x += fx * ms * Math.cos(state.pitch) * dt;
    state.z += fz * ms * Math.cos(state.pitch) * dt;
    // Stay inside the map; the sea is endless, the map is not.
    state.x = Math.max(-7800, Math.min(7800, state.x));
    state.z = Math.max(-7800, Math.min(7800, state.z));

    // Rings: fly through the glowing hoop.
    if (state.nextRing) {
      const r = state.nextRing;
      const d = Math.hypot(state.x - r.x, state.y - r.y, state.z - r.z);
      if (d < r.radius * 0.85) {
        r.passed = true;
        state.ringsPassed += 1;
        state.score += 150;
        state.events.push('ring');
        say(`RING ${state.ringsPassed}/${state.rings.length} — +150`);
        state.nextRing = state.rings.find((q) => !q.passed) ?? null;
        if (!state.nextRing && sortie.id === 'rings') finishSortie();
        if (!state.nextRing && sortie.id === 'storm') {
          say('FOLLOW THE BEACON — land at Turtle Bay');
        }
      }
    }

    // Ground: runway, beach, sea or rock — each reads differently.
    const ground = terrain.heightAt(state.x, state.z);
    const agl = state.y - ground;
    if (agl <= 0) {
      const strip = terrain.stripAt(state.x, state.z);
      const aligned = strip
        ? Math.abs(angleDiff(state.heading, strip.strip.heading * DEG)) < 0.45
          || Math.abs(angleDiff(state.heading, (strip.strip.heading + 180) * DEG)) < 0.45
        : false;
      const gentle = Math.abs(state.verticalSpeed) < 4.5 && state.speed < 105;
      if (strip && aligned && gentle) {
        landOn(strip.strip);
      } else if (strip && aligned) {
        // A hard arrival: the plane bounces, the airframe complains.
        state.damage += 22;
        state.y = ground + 12;
        state.speed *= 0.55;
        state.verticalSpeed = 5;
        state.events.push('hard');
        say('HARD LANDING! Damage +22 — ease her down next time');
        if (state.damage >= 100) crash('AIRFRAME GAVE OUT after the hard landing');
      } else if (ground <= 1) {
        crash('DITCHED IN THE SEA');
      } else {
        crash('TERRAIN STRIKE — Koro claims another mail plane');
      }
    }
    // Low-altitude warning, so a crash never comes out of nowhere.
    state.lowWarning = agl < 60 && state.verticalSpeed < -2;
  }

  function landOn(strip) {
    state.phase = 'landed';
    state.landedT = 2.6;
    state.resumeAfterLanding = false;
    state.speed = 0;
    state.y = terrain.heightAt(state.x, state.z);
    state.events.push('land');
    if (state.fuel < 100) state.fuel = 100; // the ground crew refuels you
    if (sortie.id === 'hop') {
      if (!state.visitedStrips.has(strip.name)) {
        state.visitedStrips.add(strip.name);
        state.landings += 1;
        state.score += 400;
        say(`${strip.name.toUpperCase()} — LANDED! +400 (${state.landings}/3)`);
      } else {
        say(`${strip.name.toUpperCase()} — down safe, already counted`);
      }
      if (state.landings >= 3) {
        finishSortie();
        return;
      }
      state.targetStrip = nextUnvisitedStrip();
      state.resumeAfterLanding = true;
    } else if (sortie.id === 'storm') {
      if (strip.name === 'Turtle Bay' && !state.nextRing) {
        state.delivered = true;
        state.score += 600;
        finishSortie();
      } else {
        say(`${strip.name.toUpperCase()} — refuelled. Turtle Bay is the goal.`);
        state.resumeAfterLanding = true;
      }
    } else {
      state.score += 200;
      say(`${strip.name.toUpperCase()} — nice landing! +200, refuelled`);
      state.resumeAfterLanding = true;
    }
  }

  function nextUnvisitedStrip() {
    return AIRSTRIPS.find((s) => !state.visitedStrips.has(s.name)) ?? AIRSTRIPS[0];
  }

  function finishSortie() {
    const timeBonus = Math.max(0, Math.round(state.timeLeft)) * 2;
    state.score += timeBonus;
    state.phase = 'complete';
    state.events.push('complete');
    say(`SORTIE COMPLETE — time bonus +${timeBonus}`);
  }

  function crash(reason) {
    state.phase = 'crashed';
    state.crashReason = reason;
    state.events.push('crash');
  }

  function angleDiff(a, b) {
    let d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // Where the pilot should look next: ring, strip or beacon.
  function currentTarget() {
    if (state.nextRing) return { kind: 'ring', x: state.nextRing.x, y: state.nextRing.y, z: state.nextRing.z, label: `RING ${state.ringsPassed + 1}/${state.rings.length}` };
    if (sortie.id === 'hop' || sortie.id === 'storm') {
      const s = state.targetStrip;
      return { kind: 'strip', x: s.x, y: 14, z: s.z, label: s.name.toUpperCase() };
    }
    return null;
  }

  return { state, update, currentTarget, rand };
}
