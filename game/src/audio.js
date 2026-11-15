// Procedural sound: every effect is synthesized with the Web Audio API, so
// the game ships no audio files and makes no network request. Sounds are
// positioned by volume and stereo pan from the listener's point of view.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const length = ctx.sampleRate * 0.5;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function panFor(listener, pos) {
    if (!pos || !listener) return 0;
    const dx = pos.x - listener.x;
    const dz = pos.z - listener.z;
    const dist = Math.hypot(dx, dz) || 1;
    const rightX = Math.cos(listener.yaw);
    const rightZ = -Math.sin(listener.yaw);
    return Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / dist));
  }

  function gainFor(listener, pos, base) {
    if (!pos || !listener) return base;
    const dist = Math.hypot(pos.x - listener.x, pos.z - listener.z);
    return base / (1 + dist * 0.06);
  }

  function burst({ at, duration, filterFrom, filterTo, gain, type = 'lowpass', pan = 0 }) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(filterFrom, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), at + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(filter).connect(g).connect(panner).connect(master);
    source.start(at);
    source.stop(at + duration + 0.05);
  }

  function tone({ at, from, to, duration, gain, type = 'sine', pan = 0 }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(g).connect(panner).connect(master);
    osc.start(at);
    osc.stop(at + duration + 0.05);
  }

  const players = {
    shot(at, gain, pan, heavy) {
      burst({ at, duration: heavy ? 0.22 : 0.14, filterFrom: 3200, filterTo: 220, gain: gain * (heavy ? 0.9 : 0.6), pan });
      tone({ at, from: heavy ? 160 : 220, to: 50, duration: 0.1, gain: gain * 0.35, type: 'triangle', pan });
    },
    reload(at, gain, pan) {
      tone({ at, from: 900, to: 500, duration: 0.05, gain: gain * 0.25, type: 'square', pan });
      tone({ at: at + 0.28, from: 700, to: 400, duration: 0.05, gain: gain * 0.25, type: 'square', pan });
    },
    empty(at, gain, pan) {
      tone({ at, from: 1400, to: 900, duration: 0.04, gain: gain * 0.2, type: 'square', pan });
    },
    hit(at, gain) {
      tone({ at, from: 1900, to: 1500, duration: 0.05, gain: gain * 0.3, type: 'sine' });
    },
    headshot(at, gain) {
      tone({ at, from: 2400, to: 1800, duration: 0.07, gain: gain * 0.35, type: 'sine' });
      tone({ at: at + 0.06, from: 2400, to: 1800, duration: 0.07, gain: gain * 0.3, type: 'sine' });
    },
    explosion(at, gain, pan) {
      burst({ at, duration: 0.9, filterFrom: 900, filterTo: 45, gain, pan });
      tone({ at, from: 120, to: 28, duration: 0.8, gain: gain * 0.8, type: 'sine', pan });
    },
    beep(at, gain, pan) {
      tone({ at, from: 1250, to: 1250, duration: 0.09, gain: gain * 0.4, type: 'square', pan });
    },
    plant(at, gain, pan) {
      tone({ at, from: 600, to: 900, duration: 0.15, gain: gain * 0.3, type: 'square', pan });
      tone({ at: at + 0.2, from: 600, to: 900, duration: 0.15, gain: gain * 0.3, type: 'square', pan });
    },
    defuse(at, gain, pan) {
      tone({ at, from: 900, to: 600, duration: 0.15, gain: gain * 0.3, type: 'square', pan });
      tone({ at: at + 0.2, from: 900, to: 600, duration: 0.15, gain: gain * 0.3, type: 'square', pan });
    },
    win(at, gain) {
      tone({ at, from: 520, to: 520, duration: 0.12, gain: gain * 0.3, type: 'triangle' });
      tone({ at: at + 0.13, from: 660, to: 660, duration: 0.12, gain: gain * 0.3, type: 'triangle' });
      tone({ at: at + 0.26, from: 880, to: 880, duration: 0.22, gain: gain * 0.35, type: 'triangle' });
    },
    lose(at, gain) {
      tone({ at, from: 420, to: 420, duration: 0.14, gain: gain * 0.3, type: 'triangle' });
      tone({ at: at + 0.15, from: 330, to: 330, duration: 0.14, gain: gain * 0.3, type: 'triangle' });
      tone({ at: at + 0.3, from: 260, to: 260, duration: 0.26, gain: gain * 0.3, type: 'triangle' });
    },
    step(at, gain, pan) {
      burst({ at, duration: 0.05, filterFrom: 500, filterTo: 120, gain: gain * 0.16, pan });
    },
    bounce(at, gain, pan) {
      tone({ at, from: 300, to: 180, duration: 0.06, gain: gain * 0.25, type: 'triangle', pan });
    },
    buy(at, gain) {
      tone({ at, from: 1000, to: 1400, duration: 0.08, gain: gain * 0.25, type: 'sine' });
    },
  };

  return {
    unlock() {
      ensure();
    },
    // Drain the state's queued sound events once per rendered frame.
    playQueued(state, listener) {
      if (!ctx || state.sounds.length === 0) return;
      const now = ctx.currentTime;
      for (const event of state.sounds) {
        const fn = players[event.name];
        if (!fn) continue;
        const pan = panFor(listener, event.pos);
        const gain = gainFor(listener, event.pos, event.gain ?? 1);
        fn(now, gain, pan, event.heavy);
      }
      state.sounds.length = 0;
    },
  };
}

// Queue a sound event from the simulation. The audio module drains it.
export function queueSound(state, name, pos, gain, heavy) {
  state.sounds.push({ name, pos: pos || null, gain: gain ?? 1, heavy: !!heavy });
}
