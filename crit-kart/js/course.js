// Course definitions and track building. A track is a closed loop of 4 m segments.
(function () {
  'use strict';
  const C = (globalThis.Crit = globalThis.Crit || {});

  const UNIT = 100;        // render units per metre
  const SEG_LEN = 400;     // render units per segment (4 m)
  const VEXAG = 3.5;       // vertical exaggeration of scenery hills (physics uses the real grade)
  const CURVE_SCALE = 0.16; // matched to the ~9 m road: Zwift-style sweeping bends
  const NARROW = 0.88;     // below this width factor the road gets walls

  // pieces: [segments, turn in degrees per segment (+ = right), grade %, width factor (1 = full), feature]
  // features: 'bumps' (speed bumps), 'cones' (slalom), 'potholes', 'barrels' (rows with a gap)
  const COURSES = [
    {
      id: 'meadow', name: 'Sunny Meadows Crit', blurb: 'Rolling park loop with speed bumps, a cone slalom and a tight pinch.', theme: 'meadow',
      pieces: [
        [16, 0, 0], [12, 3, 0], [14, 0, 2, 1, 'bumps'], [12, -2.5, 3.5], [12, 0, 3.5, 0.75, 'cones'], [10, 3.5, 0],
        [10, 0, -4], [8, -5, -3, 0.6], [12, -2, -3], [8, 0, -2, 1, 'potholes'], [12, 3, 0], [15, 0, 0],
      ],
    },
    {
      id: 'candy', lapScale: 0.75, name: 'Candy Canyon', blurb: 'Steep climb through a narrow gorge of barrels, then a fast hairpin descent.', theme: 'candy',
      pieces: [
        [12, 0, 0], [10, -3.5, 2], [16, 0, 7, 0.6, 'barrels'], [12, 3.5, 6], [14, 0, 8, 0.8], [12, -3, -8],
        [10, -6, -9, 0.7], [10, 0, -9, 1, 'bumps'], [14, 4, -5], [10, 0, -3], [12, -2.5, 0, 1, 'cones'], [10, 0, 0], [12, 3, 0],
      ],
    },
    {
      id: 'neon', name: 'Neon Harbor Night Crit', blurb: 'The technical one: chicane, tunnel with bumps, potholes and barrel gates.', theme: 'neon',
      pieces: [
        [14, 0, 0], [8, 5, 0], [6, -5, 0], [8, 5, 0], [10, 0, 0, 1, 'potholes'], [9, 4.5, 0], [12, 0, 2, 0.6, 'bumps'], [10, 0, 4],
        [8, -4, 0], [10, 0, -3, 1, 'cones'], [12, 0, -3], [10, 4.5, 0], [10, 0, 0, 0.8, 'barrels'], [6, 0, 0],
      ],
    },
  ];

  COURSES.push({
    id: 'city', name: 'Downtown Dash', theme: 'city',
    blurb: 'City-block crit. Parked SUVs with opening doors, traffic that drifts into the road, and cars crossing at the junction.',
    pieces: [
      [14, 0, 0, 1, 'parked'], [12, 0, 0, 1, 'parked'],           // side A: parked cars (doors!)
      [8, 11.25, 0],
      [22, 0, 0, 1, 'junction'],                                  // side B: cross traffic at the junction
      [8, 11.25, 0],
      [10, 0, 2.5], [10, 0, -2.5], [8, 0, 0, 1, 'potholes'],      // side C: a small bridge hump, then potholes
      [8, 11.25, 0],
      [14, 0, 0, 0.78, 'cones'], [10, 0, 0, 1, 'traffic'],        // side D: roadworks squeeze, then moving traffic
      [8, 11.25, 0],
    ],
  });

  const THEMES = {
    meadow: {
      sky: ['#5ec8ff', '#e3f8ff'], sun: '#fff7a8', grass: ['#5fcf4f', '#54c244'], road: ['#5d6472', '#565d6b'],
      rumble: ['#ff5a5f', '#ffffff'], lane: '#ffffff', hills: ['#8fdc8a', '#6fcf78'], fog: '#e3f8ff', scenery: ['tree', 'tree', 'bush', 'sign'],
    },
    candy: {
      sky: ['#ff9fe0', '#fff0fb'], sun: '#fff3a0', grass: ['#ffd6f1', '#ffc7ea'], road: ['#7b5d92', '#74558b'],
      rumble: ['#ff6ec7', '#ffffff'], lane: '#fff3a0', hills: ['#ffb8e6', '#ff9ad8'], fog: '#fff0fb', scenery: ['lolly', 'cane', 'lolly', 'sign'],
    },
    city: {
      sky: ['#7fb6ff', '#e6f1ff'], sun: '#fff3b0', grass: ['#c9ccd6', '#bfc3ce'], road: ['#3d4252', '#383d4b'],
      rumble: ['#d9dce4', '#ffffff'], lane: '#ffd43b', hills: ['#9db0d4', '#8196c2'], fog: '#e6f1ff', scenery: ['building'], city: true, skyline: true,
    },
    neon: {
      sky: ['#0b0d33', '#4b2087'], sun: '#ff7ae8', grass: ['#18244d', '#131e43'], road: ['#2b305c', '#262b55'],
      rumble: ['#00f0ff', '#ff2bd6'], lane: '#00f0ff', hills: ['#2a2f78', '#3a2a8a'], fog: '#4b2087', scenery: ['lamp', 'lamp', 'sign', 'bush'], stars: true,
    },
  };

  // obstacle hit radii (in half-road-width units), used by the sim and the renderer
  const OBSTACLE_RADIUS = { cone: 0.12, barrel: 0.15, pothole: 0.15, bump: 9 };
  // Vehicle sizes: len = metres along the road, wid = half-width in road-half-width units (the road is ~9 m wide), w/h = sprite units
  const VEHICLE_TYPES = {
    suv: { len: 5.0, wid: 0.25, w: 215, h: 200 },
    sedan: { len: 4.5, wid: 0.21, w: 190, h: 150 },
    van: { len: 5.4, wid: 0.24, w: 205, h: 225 },
  };
  const CAR_COLORS = ['#c92a2a', '#1c7ed6', '#2f9e44', '#f08c00', '#495057', '#e8e8ef', '#9c36b5', '#1b1f2a', '#ffd43b'];

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
    let deg = new Float64Array(N), grade = new Float64Array(N), width = new Float64Array(N).fill(1);
    let k = 0;
    for (const [n, d, g, w] of def.pieces) for (let i = 0; i < n; i++, k++) { deg[k] = d; grade[k] = g / 100; width[k] = w === undefined ? 1 : w; }
    deg = smoothCircular(deg, 4, 2);
    grade = smoothCircular(grade, 5, 2);
    width = smoothCircular(width, 3, 2);
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
      if (width[i] > NARROW) { scenery.push({ off: -1.1, type: 'post', scale: 1, hue: i }); scenery.push({ off: 1.1, type: 'post', scale: 1, hue: i + 1 }); }
      {
        const side = rnd() < 0.5 ? -1 : 1;
        scenery.push({ off: side * (1.3 + rnd() * 1.0), type: theme.scenery[Math.floor(rnd() * theme.scenery.length)], scale: 0.8 + rnd() * 0.6, hue: Math.floor(rnd() * 360) });
        if (rnd() < 0.55) scenery.push({ off: -side * (1.3 + rnd() * 1.2), type: theme.scenery[Math.floor(rnd() * theme.scenery.length)], scale: 0.8 + rnd() * 0.6, hue: Math.floor(rnd() * 360) });
      }
      if (theme.city) { // buildings form a continuous facade; trees and lamps sit on the pavement
        scenery.length = 0;
        if (i % 2 === 0) for (const side of [-1, 1]) scenery.push({ off: side * (2.2 + rnd() * 0.2), type: 'building', scale: 0.8 + rnd() * 0.8, hue: Math.floor(rnd() * 360) });
        if (i % 3 === 0) for (const side of [-1, 1]) scenery.push({ off: side * 1.3, type: 'streettree', scale: 0.9 + rnd() * 0.3, hue: i });
        if (i % 7 === 0) for (const side of [-1, 1]) scenery.push({ off: side * 1.16, type: 'streetlamp', scale: 1, hue: i });
      }
      const w1 = width[i], w2 = width[(i + 1) % N];
      segs.push({
        i, curve: deg[i] * CURVE_SCALE, deg: deg[i], grade: grade[i], w1, w2, walls: (w1 + w2) / 2 < NARROW,
        y1: ys[i] * VEXAG, y2: ys[i + 1] * VEXAG, alt: i % 2, scenery,
        p1: { world: { y: ys[i] * VEXAG, z: i * SEG_LEN }, camera: {}, screen: {} },
        p2: { world: { y: ys[i + 1] * VEXAG, z: (i + 1) * SEG_LEN }, camera: {}, screen: {} },
      });
    }

    // Obstacles from the piece features. Positions are metres along the lap, x is in half-road-width units.
    const obstacles = [], decals = [], traffic = { parked: [], moving: [], junctions: [] };
    const add = (seg, type, x) => obstacles.push({ s: seg * (SEG_LEN / UNIT) + 2, x, type, down: false, downT: 0 });
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    let k0 = 0;
    for (const [n, , , , feature] of def.pieces) {
      const feats = (feature || '').split('+');
      if (feats.includes('bumps')) for (let j = 2; j < n - 1; j += 6) add(k0 + j, 'bump', 0);
      if (feats.includes('cones')) { let c = 0; for (let j = 2; j < n - 1; j += 3, c++) add(k0 + j, 'cone', c % 2 ? 0.45 : -0.45); }
      if (feats.includes('potholes')) for (const f of [0.2, 0.5, 0.8]) add(k0 + Math.floor(n * f), 'pothole', (rnd() * 2 - 1) * 0.7);
      if (feats.includes('barrels')) {
        add(k0 + Math.floor(n * 0.3), 'barrel', -0.62); add(k0 + Math.floor(n * 0.3), 'barrel', -0.2); // gap on the right
        add(k0 + Math.floor(n * 0.7), 'barrel', 0.62); add(k0 + Math.floor(n * 0.7), 'barrel', 0.2);   // gap on the left
      }
      if (feats.includes('parked')) for (let j = 1; j < n - 1; j += 2) if (rnd() < 0.85 && (k0 + j) * (SEG_LEN / UNIT) > 24) traffic.parked.push({ s: (k0 + j) * (SEG_LEN / UNIT) + 2, x: rnd() < 0.15 ? -0.93 : 0.93, type: pick(['suv', 'suv', 'sedan', 'van', 'suv']), color: pick(CAR_COLORS), door: rnd() < 0.6, pullOut: rnd() < 0.3 });
      if (feats.includes('traffic')) for (const f of [0.25, 0.7]) traffic.moving.push({ s: (k0 + Math.floor(n * f)) * (SEG_LEN / UNIT), x: 0.5, type: pick(['suv', 'suv', 'sedan', 'van']), color: pick(CAR_COLORS), vs: 5.5 + rnd() * 2 });
      if (feats.includes('junction')) {
        const sj = (k0 + Math.floor(n / 2)) * (SEG_LEN / UNIT) + 2;
        traffic.junctions.push({ s: sj });
        decals.push({ type: 'crosswalk', s: sj - 5 }, { type: 'crosswalk', s: sj + 5 }, { type: 'signal', s: sj - 7, side: -1 }, { type: 'signal', s: sj - 7, side: 1 }, { type: 'signal', s: sj + 7, side: -1 }, { type: 'signal', s: sj + 7, side: 1 });
      }
      k0 += n;
    }

    // Minimap polyline from integrated heading, closure error spread along the loop.
    const pts = []; let th = 0, px = 0, py = 0;
    for (let i = 0; i < N; i++) { pts.push([px, py]); th += (deg[i] * Math.PI) / 180; px += Math.cos(th); py += Math.sin(th); }
    const ex = px, ey = py;
    const map = pts.map(([x, y], i) => [x - (ex * i) / N, y - (ey * i) / N]);

    const length = (N * SEG_LEN) / UNIT;
    const mod = (s) => { const t = N * SEG_LEN; return (((s * UNIT) % t) + t) % t; };
    const idx = (s) => Math.floor(mod(s) / SEG_LEN);
    // Smooth lookups: blend linearly between segment centres so grade/bend/width never step at segment boundaries
    // (stepped values made the bike jerk and the riders' lean flicker every 4 m).
    const lerpAt = (arr, s) => { const f = mod(s) / SEG_LEN - 0.5, i0 = Math.floor(f), t = f - i0; return arr[(i0 + N) % N] * (1 - t) + arr[(i0 + 1 + N) % N] * t; };
    return {
      def, theme, N, segs, length, map, ys, trackLen: N * SEG_LEN, obstacles, decals, traffic,
      segIndex: idx,
      gradeAt(s) { return lerpAt(grade, s); },
      curveAt(s) { return lerpAt(deg, s); },
      widthAt(s) { return lerpAt(width, s); },
      wallsAt(s) { return lerpAt(width, s) < NARROW; },
      elevationAt(s) { const z = mod(s), i = Math.floor(z / SEG_LEN); return (ys[i] + (z / SEG_LEN - i) * (ys[i + 1] - ys[i])) / UNIT; },
      // item box rows (metres along the lap)
      boxRows: [0.16, 0.4, 0.64, 0.88].map((f) => f * length),
    };
  }

  Object.assign(C, { VEHICLE_TYPES, CAR_COLORS, UNIT, SEG_LEN, VEXAG, NARROW, OBSTACLE_RADIUS, COURSES, THEMES, buildTrack });
})();
