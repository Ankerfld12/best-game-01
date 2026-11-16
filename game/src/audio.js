// audio.js — every sound in EMBERFALL is synthesised with WebAudio at the moment it
// plays: no audio files, no network, nothing to load. White-noise bursts through
// band-pass filters make the gunshots (each weapon gets its own body pitch), and
// filtered oscillator sweeps make the beeps, ticks and stings. The context is
// created lazily and resumed on the first user gesture, as browsers require.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return true;
  }

  // A burst of decaying white noise through a band-pass: the crack and body of a
  // shot, a pop, or an explosion.
  function noise({ at = 0, dur = 0.12, freq = 1800, q = 0.8, gain = 0.5, sweepTo = 0 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + at;
    const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    if (sweepTo > 0) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    source.connect(filter).connect(amp).connect(master);
    source.start(t0);
  }

  // A plain oscillator blip: UI clicks, channel beeps, hit ticks, round stings.
  function tone({ at = 0, dur = 0.08, freq = 880, type = 'square', gain = 0.16, sweepTo = 0 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo > 0) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(amp).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const shotPitch = { spark: 1500, wasp: 1750, scatter: 700, longbow: 1200, needle: 950 };
  return {
    unlock() { ensure(); },
    shot(weaponId, distant = false) {
      const base = shotPitch[weaponId] ?? 1200;
      const scale = distant ? 0.35 : 1;
      noise({ dur: 0.11, freq: base, q: 0.6, gain: 0.5 * scale });
      noise({ dur: 0.05, freq: base * 2.6, q: 1.4, gain: 0.25 * scale });
      tone({ dur: 0.05, freq: base * 0.4, type: 'triangle', gain: 0.2 * scale, sweepTo: base * 0.2 });
    },
    dryFire() { tone({ dur: 0.04, freq: 1400, gain: 0.1 }); },
    reloadStart() { tone({ dur: 0.05, freq: 500, gain: 0.14 }); noise({ dur: 0.06, freq: 900, gain: 0.12 }); },
    reloadEnd() { tone({ at: 0, dur: 0.05, freq: 760, gain: 0.16 }); tone({ at: 0.07, dur: 0.05, freq: 1050, gain: 0.16 }); },
    hit(head) {
      tone({ dur: 0.05, freq: head ? 1560 : 1180, gain: 0.18 });
      if (head) tone({ at: 0.05, dur: 0.07, freq: 1980, gain: 0.14 });
    },
    hurt() { noise({ dur: 0.09, freq: 420, q: 1, gain: 0.3 }); },
    kill() { tone({ dur: 0.07, freq: 880, gain: 0.16 }); tone({ at: 0.07, dur: 0.1, freq: 1320, gain: 0.16 }); },
    buy() { tone({ dur: 0.05, freq: 990, gain: 0.14 }); tone({ at: 0.05, dur: 0.08, freq: 1480, gain: 0.12 }); },
    denied() { tone({ dur: 0.09, freq: 220, type: 'sawtooth', gain: 0.1 }); },
    plantBeep(final = false) { tone({ dur: final ? 0.22 : 0.07, freq: final ? 1560 : 1040, gain: 0.16 }); },
    coreTick() { tone({ dur: 0.04, freq: 1240, gain: 0.07 }); },
    explosion() {
      noise({ dur: 0.9, freq: 300, q: 0.4, gain: 0.9, sweepTo: 60 });
      tone({ dur: 0.7, freq: 90, type: 'sine', gain: 0.5, sweepTo: 38 });
    },
    fragBoom() { noise({ dur: 0.45, freq: 500, q: 0.5, gain: 0.7, sweepTo: 90 }); },
    flashPop() { noise({ dur: 0.16, freq: 3200, q: 0.7, gain: 0.4 }); tone({ dur: 0.2, freq: 2400, gain: 0.06, sweepTo: 3000 }); },
    throwWhoosh() { noise({ dur: 0.14, freq: 800, q: 1.2, gain: 0.1, sweepTo: 1600 }); },
    roundWin() { tone({ dur: 0.12, freq: 660, type: 'triangle', gain: 0.2 }); tone({ at: 0.12, dur: 0.2, freq: 990, type: 'triangle', gain: 0.2 }); },
    roundLose() { tone({ dur: 0.14, freq: 440, type: 'triangle', gain: 0.2 }); tone({ at: 0.14, dur: 0.24, freq: 294, type: 'triangle', gain: 0.2 }); },
    step() { noise({ dur: 0.05, freq: 300, q: 0.8, gain: 0.05 }); },
  };
}
