// Tiny synthesized sound effects (Web Audio, no asset files).
(function () {
  'use strict';
  const C = (globalThis.Crit = globalThis.Crit || {});
  let ctx = null, master = null, enabled = true;

  function ensure() {
    if (!ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.22; master.connect(ctx.destination);
      } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, o = {}) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime + (o.delay || 0), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + o.slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.4, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.03);
  }

  function noise(dur, vol, delay = 0) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime + delay, n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1800; g.gain.value = vol;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(master); src.start(t);
  }

  const arp = (notes, step, o) => notes.forEach((f, i) => tone(f, step * 1.6, Object.assign({ delay: i * step }, o)));

  const sounds = {
    tick: () => tone(660, 0.14, { vol: 0.35 }),
    go: () => { tone(1320, 0.45, { vol: 0.4 }); tone(660, 0.45, { vol: 0.25 }); },
    pickup: () => arp([660, 880, 1175], 0.06, { type: 'triangle', vol: 0.45 }),
    banana: () => tone(420, 0.25, { type: 'sawtooth', slide: -250, vol: 0.3 }),
    rocket: () => { noise(0.45, 0.5); tone(300, 0.45, { type: 'sawtooth', slide: 700, vol: 0.25 }); },
    golden: () => { noise(0.4, 0.4); arp([880, 1175, 1568], 0.07, { type: 'triangle', vol: 0.4 }); },
    boost: () => tone(300, 0.5, { type: 'square', slide: 1000, vol: 0.28 }),
    shield: () => arp([880, 1320], 0.08, { type: 'sine', vol: 0.5 }),
    hit: () => { noise(0.5, 0.7); tone(300, 0.5, { type: 'sawtooth', slide: -240, vol: 0.4 }); },
    blocked: () => { tone(1500, 0.12, { type: 'triangle', vol: 0.5 }); tone(1900, 0.2, { type: 'triangle', vol: 0.4, delay: 0.08 }); },
    incoming: () => { tone(900, 0.12, { type: 'sawtooth', vol: 0.35 }); tone(900, 0.12, { type: 'sawtooth', vol: 0.35, delay: 0.2 }); },
    lap: () => arp([784, 988], 0.09, { type: 'triangle', vol: 0.4 }),
    bestLap: () => arp([784, 988, 1319], 0.08, { type: 'triangle', vol: 0.45 }),
    up: () => tone(600, 0.12, { type: 'triangle', slide: 300, vol: 0.3 }),
    down: () => tone(500, 0.14, { type: 'triangle', slide: -250, vol: 0.25 }),
    finish: () => arp([523, 659, 784, 1047, 784, 1047], 0.11, { type: 'square', vol: 0.3 }),
    bump: () => { tone(110, 0.16, { type: 'sine', slide: -40, vol: 0.6 }); noise(0.08, 0.3); },
    clunk: () => { tone(220, 0.12, { type: 'triangle', slide: -120, vol: 0.5 }); noise(0.12, 0.35); },
    error: () => tone(200, 0.3, { type: 'sawtooth', vol: 0.3 }),
  };

  C.audio = {
    play(name) { try { sounds[name] && sounds[name](); } catch (e) { /* audio is optional */ } },
    unlock: ensure,
    set enabled(v) { enabled = !!v; },
    get enabled() { return enabled; },
  };
})();
