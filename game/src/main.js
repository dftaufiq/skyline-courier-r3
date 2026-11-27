// Boot and the one loop: input is read every frame, the flight advances in
// fixed 1/60 s steps, the renderer paints what is there. The game moves
// between four screens: title, play, paused, and an end screen (complete,
// crashed or failed). ?seed=N fixes the world. ?shot=cover|rings|landing|
// storm stages that scene instead of running the loop, paints it twice and
// sets window.__shotReady for a screenshot.
import { BEST_KEY, SORTIES } from './config.js';
import { createRandom } from './random.js';
import { createTerrain } from './terrain.js';
import { createFlight } from './flight.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, createParticles, drawFrame } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const terrain = createTerrain(seed);
const renderer = createRenderer(canvas, terrain);
const audio = createAudio();
const particles = createParticles();

let screen = 'title';
let selected = 0;
let flight = createFlight(terrain, SORTIES[0].id, seed);
let best = readBest();
let time = 0;
let last = performance.now();
let accumulator = 0;
let crashedAt = 0;

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score lasts this visit.
  }
}

// The title screen flies itself: a slow scenic orbit over Isla Verde, so
// the menu is a living postcard of the archipelago, not a dead picture.
const menuCam = {
  angle: 0,
  state: {
    x: 5120, y: 420, z: 7600, heading: 0, pitch: 0.03, roll: 0,
    speed: 90, throttle: 0.5, fuel: 100, damage: 0, score: 0,
    timeLeft: 240, sortie: SORTIES[0], rings: [], ringsPassed: 0,
    landings: 0, message: '', messageT: 0, phase: 'flying',
    verticalSpeed: 0, lowWarning: false,
  },
};

function startSortie(index) {
  selected = index;
  flight = createFlight(terrain, SORTIES[index].id, seed);
  screen = 'play';
  audio.start();
  status.textContent = `${SORTIES[index].name}: ${SORTIES[index].brief}`;
}

function endScreen() {
  const st = flight.state;
  if (st.score > best) {
    best = st.score;
    saveBest(best);
  }
  if (st.phase === 'complete') screen = 'complete';
  else if (st.phase === 'crashed') screen = 'crashed';
  else if (st.phase === 'failed') screen = 'failed';
  status.textContent = screen === 'complete'
    ? `Sortie complete — score ${st.score}`
    : `Sortie over — ${st.crashReason}`;
}

const input = createInput(canvas, {
  onPause() {
    if (screen === 'play') screen = 'paused';
    else if (screen === 'paused') screen = 'play';
  },
  onRestart() {
    if (screen !== 'title') startSortie(selected);
  },
  onMute() {
    const muted = audio.toggleMute();
    status.textContent = muted ? 'Sound muted' : 'Sound on';
  },
  onConfirm() {
    if (screen === 'title') startSortie(selected);
    else if (screen === 'complete' || screen === 'crashed' || screen === 'failed') screen = 'title';
  },
  onSortie(i) {
    if (screen === 'title' && i >= 0 && i < SORTIES.length) selected = i;
  },
});

function view() {
  return {
    width: canvas.width,
    height: canvas.height,
    flight: screen === 'title' ? { state: menuCam.state, currentTarget: () => null } : flight,
    screen,
    sorties: SORTIES,
    selected,
    best,
    time,
    particles,
  };
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function frame(now) {
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;
  time += dt;
  if (screen === 'title') {
    // Slow orbit: the camera circles Isla Verde at a gentle bank.
    menuCam.angle += dt * 0.045;
    const a = menuCam.angle;
    menuCam.state.x = 5120 + Math.sin(a) * 2600;
    menuCam.state.z = 5120 + Math.cos(a) * 2600;
    menuCam.state.heading = a + Math.PI;
    menuCam.state.y = 430 + Math.sin(a * 2) * 40;
    menuCam.state.roll = 0.22;
    menuCam.state.pitch = 0.02;
  } else if (screen === 'play') {
    accumulator += dt;
    while (accumulator >= 1 / 60) {
      flight.update(1 / 60, input.read());
      accumulator -= 1 / 60;
      const st = flight.state;
      // Drain one-shot events into sound and particles.
      if (st.events.length) {
        const evs = st.events.slice();
        audio.drainEvents(evs);
        for (const ev of evs) {
          if (ev === 'ring') particles.burst(canvas.width / 2, canvas.height * 0.42, '#ffd23f', 26, 260);
          if (ev === 'crash') particles.smoke(canvas.width / 2, canvas.height * 0.6, 22);
          if (ev === 'land') particles.burst(canvas.width / 2, canvas.height * 0.72, '#ffffff', 14, 120);
        }
      }
      if (st.phase === 'complete' || st.phase === 'crashed' || st.phase === 'failed') {
        endScreen();
        break;
      }
    }
    audio.update(flight.state);
    particles.update(dt);
  }
  drawFrame(renderer, view());
  requestAnimationFrame(frame);
}

function runShot(name) {
  const staged = stageShot(name, flight, terrain);
  if (staged.flight) flight = staged.flight;
  screen = staged.screen;
  let painted = 0;
  function paint() {
    drawFrame(renderer, view());
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

// Expose the live state for the play-test harness (and curious pilots).
window.__skyline = { get flight() { return flight; }, get screen() { return screen; }, startSortie, terrain, seed };
window.addEventListener('resize', resize);
resize();

if (shot) {
  runShot(shot);
} else {
  requestAnimationFrame((now) => {
    last = now;
    requestAnimationFrame(frame);
  });
}
