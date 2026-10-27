// Course definitions and track building. A track is a closed loop of 4 m segments.
(function () {
  'use strict';
  const C = (globalThis.Crit = globalThis.Crit || {});

  const UNIT = 100;        // render units per metre
  const SEG_LEN = 400;     // render units per segment (4 m)
  const VEXAG = 5;         // vertical exaggeration for the cartoon look (physics uses real grade)
  const CURVE_SCALE = 0.45;

  // pieces: [segments, turn in degrees per segment (+ = right), grade %]
  const COURSES = [
    {
      id: 'meadow', name: 'Sunny Meadows Crit', blurb: 'Rolling park loop. Fast, friendly, one short kicker.', theme: 'meadow',
      pieces: [[16, 0, 0], [10, 4, 0], [14, 0, 2], [10, -3, 3.5], [12, 0, 3.5], [8, 5, 0], [10, 0, -4], [12, -2, -3], [8, 0, -2], [10, 4, 0], [15, 0, 0]],
    },
    {
      id: 'candy', name: 'Candy Canyon', blurb: 'Steep sugary climb, fast chicane descent. Legs will hurt.', theme: 'candy',
      pieces: [[12, 0, 0], [8, -5, 2], [16, 0, 7], [10, 5, 6], [14, 0, 8], [10, -4, -8], [16, 0, -9], [12, 6, -5], [10, 0, -3], [12, -3, 0], [10, 0, 0], [10, 4, 0]],
    },
    {
      id: 'neon', name: 'Neon Harbor Night Crit', blurb: 'Technical night circuit. Tight corners, short punchy rise.', theme: 'neon',
      pieces: [[14, 0, 0], [7, 6, 0], [10, 0, 0], [7, 6, 0], [12, 0, 2], [10, 0, 4], [6, -5, 0], [10, 0, -3], [12, 0, -3], [8, 6, 0], [10, 0, 0], [6, 0, 0]],
    },
  ];

  const THEMES = {
    meadow: {
      sky: ['#5ec8ff', '#e3f8ff'], sun: '#fff7a8', grass: ['#5fcf4f', '#54c244'], road: ['#5d6472', '#565d6b'],
      rumble: ['#ff5a5f', '#ffffff'], lane: '#ffffff', hills: ['#8fdc8a', '#6fcf78'], fog: '#e3f8ff', scenery: ['tree', 'tree', 'bush', 'sign'],
    },
    candy: {
      sky: ['#ff9fe0', '#fff0fb'], sun: '#fff3a0', grass: ['#ffd6f1', '#ffc7ea'], road: ['#7b5d92', '#74558b'],
      rumble: ['#ff6ec7', '#ffffff'], lane: '#fff3a0', hills: ['#ffb8e6', '#ff9ad8'], fog: '#fff0fb', scenery: ['lolly', 'cane', 'lolly', 'sign'],
    },
    neon: {
      sky: ['#0b0d33', '#4b2087'], sun: '#ff7ae8', grass: ['#18244d', '#131e43'], road: ['#2b305c', '#262b55'],
      rumble: ['#00f0ff', '#ff2bd6'], lane: '#00f0ff', hills: ['#2a2f78', '#3a2a8a'], fog: '#4b2087', scenery: ['lamp', 'lamp', 'sign', 'bush'], stars: true,
    },
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smoothCircular(arr, w, passes) {
    const n = arr.length;
    let src = Float64Array.from(arr);
    for (let p = 0; p < passes; p++) {
      const dst = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = -w; k <= w; k++) s += src[(i + k + n * 4) % n];
        dst[i] = s / (2 * w + 1);
      }
      src = dst;
    }
    return src;
  }

  function buildTrack(def) {
    const N = def.pieces.reduce((a, p) => a + p[0], 0);
    let deg = new Float64Array(N), grade = new Float64Array(N);
    let k = 0;
    for (const [n, d, g] of def.pieces) for (let i = 0; i < n; i++, k++) { deg[k] = d; grade[k] = g / 100; }
    deg = smoothCircular(deg, 4, 2);
    grade = smoothCircular(grade, 5, 2);
    // Close the loop: turn exactly 360 degrees overall, climb exactly as much as we descend.
    const dBias = (360 - deg.reduce((a, b) => a + b, 0)) / N;
    for (let i = 0; i < N; i++) deg[i] += dBias;
    const gMean = grade.reduce((a, b) => a + b, 0) / N;
    for (let i = 0; i < N; i++) grade[i] -= gMean;

    const ys = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) ys[i + 1] = ys[i] + grade[i] * SEG_LEN;

    const theme = THEMES[def.theme];
    const rnd = mulberry32(def.id.length * 7919 + N);
    const segs = [];
    for (let i = 0; i < N; i++) {
      const scenery = [];
      if (i % 2 === 0) {
        const side = rnd() < 0.5 ? -1 : 1;
        scenery.push({ off: side * (1.35 + rnd() * 1.4), type: theme.scenery[Math.floor(rnd() * theme.scenery.length)], scale: 0.8 + rnd() * 0.6, hue: Math.floor(rnd() * 360) });
        if (rnd() < 0.45) scenery.push({ off: -side * (1.3 + rnd() * 1.6), type: theme.scenery[Math.floor(rnd() * theme.scenery.length)], scale: 0.8 + rnd() * 0.6, hue: Math.floor(rnd() * 360) });
      }
      segs.push({
        i, curve: deg[i] * CURVE_SCALE, deg: deg[i], grade: grade[i],
        y1: ys[i] * VEXAG, y2: ys[i + 1] * VEXAG, alt: Math.floor(i / 2) % 2, scenery,
        p1: { world: { y: 0, z: i * SEG_LEN }, camera: {}, screen: {} },
        p2: { world: { y: 0, z: (i + 1) * SEG_LEN }, camera: {}, screen: {} },
      });
      segs[i].p1.world.y = ys[i] * VEXAG; segs[i].p2.world.y = ys[i + 1] * VEXAG;
    }

    // Minimap polyline from integrated heading, closure error spread along the loop.
    const pts = []; let th = 0, px = 0, py = 0;
    for (let i = 0; i < N; i++) { pts.push([px, py]); th += (deg[i] * Math.PI) / 180; px += Math.cos(th); py += Math.sin(th); }
    const ex = px, ey = py;
    const map = pts.map(([x, y], i) => [x - (ex * i) / N, y - (ey * i) / N]);

    const length = (N * SEG_LEN) / UNIT;
    const mod = (s) => { const t = N * SEG_LEN; return (((s * UNIT) % t) + t) % t; };
    return {
      def, theme, N, segs, length, map, ys, trackLen: N * SEG_LEN,
      segIndex: (s) => Math.floor(mod(s) / SEG_LEN),
      gradeAt(s) { return grade[Math.floor(mod(s) / SEG_LEN)]; },
      curveAt(s) { return deg[Math.floor(mod(s) / SEG_LEN)]; },
      elevationAt(s) { return ys[Math.floor(mod(s) / SEG_LEN)] / UNIT; },
      // item box rows (metres along the lap)
      boxRows: [0.16, 0.4, 0.64, 0.88].map((f) => f * length),
    };
  }

  Object.assign(C, { UNIT, SEG_LEN, VEXAG, COURSES, THEMES, buildTrack });
})();
