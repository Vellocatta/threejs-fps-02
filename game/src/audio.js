// All sound is synthesized with WebAudio: no audio files, no network. One AudioContext,
// lazy-created on the first user gesture, and a small set of one-shot synth voices.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function noiseBuffer(duration) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration = 0.12, frequency = 1200, gain = 0.5, type = 'lowpass', when = 0 }) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration + 0.02);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  function tone({ frequency = 440, end = 0, duration = 0.1, gain = 0.3, type = 'square', when = 0 }) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (end > 0) osc.frequency.exponentialRampToValueAtTime(end, t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    shot(kind) {
      if (kind === 'shotgun') { burst({ duration: 0.22, frequency: 700, gain: 0.7 }); tone({ frequency: 160, end: 50, duration: 0.16, gain: 0.4, type: 'sawtooth' }); }
      else if (kind === 'smg') { burst({ duration: 0.08, frequency: 1600, gain: 0.35 }); tone({ frequency: 220, end: 90, duration: 0.07, gain: 0.2, type: 'sawtooth' }); }
      else if (kind === 'pistol') { burst({ duration: 0.1, frequency: 1400, gain: 0.45 }); tone({ frequency: 200, end: 70, duration: 0.09, gain: 0.25, type: 'sawtooth' }); }
      else { burst({ duration: 0.13, frequency: 1100, gain: 0.55 }); tone({ frequency: 180, end: 60, duration: 0.12, gain: 0.35, type: 'sawtooth' }); }
    },
    distantShot() { burst({ duration: 0.16, frequency: 500, gain: 0.18 }); },
    dryFire() { tone({ frequency: 900, duration: 0.04, gain: 0.15 }); },
    reload() { tone({ frequency: 500, duration: 0.05, gain: 0.2 }); tone({ frequency: 700, duration: 0.05, gain: 0.2, when: 0.25 }); tone({ frequency: 420, duration: 0.06, gain: 0.22, when: 0.55 }); },
    hit() { tone({ frequency: 1400, duration: 0.05, gain: 0.25, type: 'sine' }); },
    kill() { tone({ frequency: 1200, duration: 0.07, gain: 0.3, type: 'sine' }); tone({ frequency: 1800, duration: 0.09, gain: 0.3, type: 'sine', when: 0.07 }); },
    hurt() { tone({ frequency: 110, end: 60, duration: 0.18, gain: 0.4, type: 'sawtooth' }); },
    plantBeep() { tone({ frequency: 880, duration: 0.09, gain: 0.3, type: 'sine' }); },
    planted() { tone({ frequency: 660, duration: 0.12, gain: 0.3, type: 'sine' }); tone({ frequency: 990, duration: 0.16, gain: 0.3, type: 'sine', when: 0.14 }); },
    defuseBeep() { tone({ frequency: 1200, duration: 0.06, gain: 0.25, type: 'sine' }); },
    explosion() {
      burst({ duration: 0.9, frequency: 300, gain: 0.9 });
      tone({ frequency: 90, end: 30, duration: 0.8, gain: 0.7, type: 'sine' });
      burst({ duration: 0.3, frequency: 3000, gain: 0.3, type: 'highpass' });
    },
    bounce() { tone({ frequency: 300, end: 180, duration: 0.06, gain: 0.2, type: 'triangle' }); },
    roundWin() { [523, 659, 784].forEach((f, i) => tone({ frequency: f, duration: 0.18, gain: 0.25, type: 'triangle', when: i * 0.12 })); },
    roundLose() { [392, 330, 262].forEach((f, i) => tone({ frequency: f, duration: 0.2, gain: 0.22, type: 'triangle', when: i * 0.13 })); },
    buy() { tone({ frequency: 700, duration: 0.06, gain: 0.2, type: 'sine' }); tone({ frequency: 1050, duration: 0.08, gain: 0.2, type: 'sine', when: 0.06 }); },
    step() { burst({ duration: 0.04, frequency: 400, gain: 0.06 }); },
  };
}
