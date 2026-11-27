// All sound is synthesised with WebAudio — no audio files, no network.
// The engine is two detuned oscillators whose pitch follows the throttle,
// the wind is filtered noise that grows with speed, and events are short
// blips: a chime for a ring, a thud for a landing, a crunch for a crash.
export function createAudio() {
  let ctx = null;
  let engineOscA = null;
  let engineOscB = null;
  let engineGain = null;
  let windSource = null;
  let windGain = null;
  let windFilter = null;
  let muted = false;
  let started = false;

  function ensure() {
    if (ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      engineOscA = ctx.createOscillator();
      engineOscB = ctx.createOscillator();
      engineOscA.type = 'sawtooth';
      engineOscB.type = 'square';
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineOscA.connect(engineFilter);
      engineOscB.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(ctx.destination);
      engineOscA.start();
      engineOscB.start();
      // Wind: a looped noise buffer through a band-pass filter.
      const len = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
      windSource = ctx.createBufferSource();
      windSource.buffer = buffer;
      windSource.loop = true;
      windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 700;
      windFilter.Q.value = 0.6;
      windGain = ctx.createGain();
      windGain.gain.value = 0;
      windSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(ctx.destination);
      windSource.start();
    } catch {
      ctx = null;
    }
  }

  function blip(freq, dur, type, vol, slideTo) {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  function update(state) {
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const flying = state.phase === 'flying';
    const target = muted || !flying ? 0 : 0.045 + state.throttle * 0.05;
    engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
    const base = 52 + state.throttle * 46 + state.speed * 0.12;
    engineOscA.frequency.setTargetAtTime(base, ctx.currentTime, 0.08);
    engineOscB.frequency.setTargetAtTime(base * 1.5 + 3, ctx.currentTime, 0.08);
    windGain.gain.setTargetAtTime(muted || !flying ? 0 : 0.012 + (state.speed / 210) * 0.05, ctx.currentTime, 0.15);
    windFilter.frequency.setTargetAtTime(500 + state.speed * 4, ctx.currentTime, 0.15);
  }

  function drainEvents(events) {
    if (!ctx) return;
    for (const ev of events) {
      if (muted) break;
      if (ev === 'ring') {
        blip(880, 0.18, 'sine', 0.16);
        setTimeout(() => blip(1318, 0.24, 'sine', 0.14), 90);
      } else if (ev === 'land') {
        blip(140, 0.22, 'sine', 0.25, 60);
      } else if (ev === 'hard') {
        blip(90, 0.3, 'sawtooth', 0.22, 45);
      } else if (ev === 'crash') {
        blip(70, 0.7, 'sawtooth', 0.3, 28);
        blip(55, 0.9, 'square', 0.2, 30);
      } else if (ev === 'complete') {
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'sine', 0.15), i * 110));
      } else if (ev === 'fail') {
        blip(330, 0.4, 'sine', 0.15, 220);
      }
    }
    events.length = 0;
  }

  return {
    start() {
      ensure();
      started = true;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    update,
    drainEvents,
    toggleMute() {
      muted = !muted;
      return muted;
    },
    get muted() {
      return muted;
    },
    get started() {
      return started;
    },
  };
}
