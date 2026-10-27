// UI, input (trainer power, Zwift Ride controls, keyboard) and the game loop.
(function () {
  'use strict';
  const C = globalThis.Crit;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('critkart.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('critkart.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  const cfg = {
    course: store.get('course', 'meadow'), laps: store.get('laps', 12), ftp: store.get('ftp', 200), weight: store.get('weight', 75),
    difficulty: store.get('difficulty', 1), gradeFeel: store.get('gradeFeel', 0.7), invertSteer: store.get('invertSteer', false),
  };
  const state = { mode: 'menu', paused: false, race: null, toasts: [], incoming: 0, powerSum: 0, powerT: 0, maxPower: 0, resultsShown: false };
  const trainer = { link: null, connected: false, power: 0, cadence: 0, lastSeen: 0 };
  const ride = { link: null, connected: false, idle: null, held: 0, latest: {}, map: store.get('steerMap', null), use: false, bound: store.get('boundBtn', null), cal: null };
  const keys = {};
  const kb = { steer: 0, power: 0 };

  const renderer = new C.Renderer($('game'));
  window.addEventListener('resize', () => renderer.resize());

  const hasBle = !!navigator.bluetooth;
  const logLines = [];
  const log = (s) => { logLines.push(s); if (logLines.length > 14) logLines.shift(); $('log').textContent = logLines.join('\n'); };

  // ---------- Trainer ----------
  $('btnTrainer').addEventListener('click', async () => {
    if (!hasBle) return setStatus('trainerStatus', 'Web Bluetooth not available — use Chrome or Edge over https/localhost.', true);
    try {
      trainer.link = new C.TrainerLink({
        onStatus: (s) => { setStatus('trainerStatus', s); log('trainer: ' + s); },
        onDisconnect: () => { trainer.connected = false; },
        onData: (d) => { trainer.connected = true; trainer.power = d.power; if (d.cadence != null) trainer.cadence = d.cadence; trainer.lastSeen = performance.now(); },
      });
      setStatus('trainerStatus', 'Connecting…');
      await trainer.link.connect();
      trainer.connected = true;
    } catch (e) { setStatus('trainerStatus', 'Trainer: ' + e.message, true); }
  });

  // ---------- Zwift Ride controls ----------
  $('btnRide').addEventListener('click', async () => {
    if (!hasBle) return setStatus('rideStatus', 'Web Bluetooth not available — use Chrome or Edge over https/localhost.', true);
    try {
      ride.link = new C.ZwiftRideLink({
        onStatus: (s) => { setStatus('rideStatus', s); log('controls: ' + s); ride.connected = true; },
        onRaw: (s) => log(s),
        onMessage: onRideMessage,
      });
      setStatus('rideStatus', 'Connecting… (close Zwift / Companion first: only one app can hold the controls)');
      await ride.link.connect();
    } catch (e) { setStatus('rideStatus', 'Controls: ' + e.message, true); }
  });

  function onRideMessage(msg) {
    if (msg.buttonMap != null) {
      if (ride.idle === null) ride.idle = msg.buttonMap;
      const now = (msg.buttonMap ^ ride.idle) >>> 0;
      const fresh = (now & ~ride.held) >>> 0;
      ride.held = now;
      if (fresh) for (let b = 0; b < 32; b++) if (fresh & (1 << b)) onRideButton(b);
    }
    for (const a of msg.analog) {
      ride.latest[a.loc] = a.val;
      if (ride.cal && ride.cal.stage) (ride.cal.samples[ride.cal.stage][a.loc] = ride.cal.samples[ride.cal.stage][a.loc] || []).push(a.val);
    }
  }
  function onRideButton(bit) {
    log(`button bit ${bit}`);
    if (ride.binding) { ride.bound = bit; store.set('boundBtn', bit); ride.binding = false; setStatus('rideStatus', `Item button bound to bit ${bit}`); return; }
    if (ride.bound === null || ride.bound === bit) ride.use = true;
  }
  $('btnBind').addEventListener('click', () => {
    if (!ride.connected) return setStatus('rideStatus', 'Connect the controls first', true);
    ride.binding = true; setStatus('rideStatus', 'Press the controller button you want to use for items…');
  });
  $('btnUnbind').addEventListener('click', () => { ride.bound = null; store.set('boundBtn', null); setStatus('rideStatus', 'Any button now fires items'); });

  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  function runCalibration() {
    if (!ride.connected) return setStatus('rideStatus', 'Connect the controls first', true);
    const cal = ride.cal = { stage: null, samples: { neutral: {}, left: {}, right: {} } };
    const steps = [['neutral', 'Hold the bars straight…', 2000], ['left', 'Turn the bars fully LEFT and hold…', 2600], ['right', 'Turn the bars fully RIGHT and hold…', 2600]];
    let i = 0;
    const next = () => {
      if (i >= steps.length) { cal.stage = null; finishCalibration(cal); return; }
      const [stage, msg, ms] = steps[i++]; cal.stage = null; setStatus('rideStatus', msg + ' (get ready)');
      setTimeout(() => { cal.stage = stage; setStatus('rideStatus', msg); setTimeout(next, ms); }, 900);
    };
    next();
  }
  function finishCalibration(cal) {
    const S = cal.samples, locs = new Set([...Object.keys(S.neutral), ...Object.keys(S.left), ...Object.keys(S.right)]);
    const c = {}, ml = {}, mr = {};
    for (const l of locs) { c[l] = S.neutral[l] ? mean(S.neutral[l]) : 0; ml[l] = S.left[l] ? mean(S.left[l]) : c[l]; mr[l] = S.right[l] ? mean(S.right[l]) : c[l]; }
    let locL = null, locR = null, bl = 0.5, br = 0.5;
    for (const l of locs) { if (Math.abs(ml[l] - c[l]) > bl) { bl = Math.abs(ml[l] - c[l]); locL = l; } if (Math.abs(mr[l] - c[l]) > br) { br = Math.abs(mr[l] - c[l]); locR = l; } }
    ride.cal = null;
    if (locL === null && locR === null) { setStatus('rideStatus', 'No steering movement detected. Check the log below, then try again.', true); return; }
    if (locL === null) locL = locR; if (locR === null) locR = locL;
    ride.map = { locL, locR, cL: c[locL], cR: c[locR], dL: ml[locL] - c[locL], dR: mr[locR] - c[locR] };
    store.set('steerMap', ride.map);
    setStatus('rideStatus', `Steering calibrated (axis ${locL === locR ? locL : locL + '/' + locR}). Try it in the log.`);
  }
  $('btnCal').addEventListener('click', runCalibration);

  function rideSteer() {
    const m = ride.map; if (!m) return 0;
    const L = ride.latest[m.locL], R = ride.latest[m.locR];
    let s = 0;
    if (m.locL === m.locR) {
      const d = (L === undefined ? m.cL : L) - m.cL;
      if (d * m.dR > 0) s = Math.min(1, d / m.dR); else if (d * m.dL > 0) s = -Math.min(1, d / m.dL);
    } else {
      const l = clamp(((L === undefined ? m.cL : L) - m.cL) / (m.dL || 1), 0, 1), r = clamp(((R === undefined ? m.cR : R) - m.cR) / (m.dR || 1), 0, 1);
      s = r - l;
    }
    if (Math.abs(s) < 0.06) return 0;
    return clamp(s, -1, 1);
  }

  // ---------- Keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT/.test(e.target.tagName)) return;
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (state.mode === 'race' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') && !e.repeat) ride.use = true;
    if (e.code === 'Escape' && state.mode === 'race') state.paused = !state.paused;
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // ---------- Menu wiring ----------
  const courseSel = $('course');
  C.COURSES.forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; courseSel.appendChild(o); });
  const bind = (id, key, num) => {
    const el = $(id); el.value = cfg[key];
    el.addEventListener('input', () => { cfg[key] = num ? Number(el.value) : el.value; store.set(key, cfg[key]); if (key === 'course') makeDemo(); refreshLabels(); });
  };
  bind('course', 'course'); bind('laps', 'laps', true); bind('ftp', 'ftp', true); bind('weight', 'weight', true); bind('difficulty', 'difficulty', true); bind('gradeFeel', 'gradeFeel', true);
  $('invert').checked = cfg.invertSteer; $('invert').addEventListener('change', () => { cfg.invertSteer = $('invert').checked; store.set('invertSteer', cfg.invertSteer); });
  function refreshLabels() {
    const def = C.COURSES.find((c) => c.id === cfg.course);
    const t = C.buildTrack(def), len = Math.round(t.length);
    $('courseBlurb').textContent = `${def.blurb} Lap ${len} m • ${cfg.laps} laps = ${(len * cfg.laps / 1000).toFixed(1)} km — about ${(C.estimateLapTime(t, cfg.ftp, cfg.weight + 9) * cfg.laps / 60).toFixed(1)} min riding at ${cfg.ftp} W solo (less in the draft).`;
    $('lapsVal').textContent = cfg.laps; $('diffVal').textContent = cfg.difficulty.toFixed(2) + '×'; $('feelVal').textContent = Math.round(cfg.gradeFeel * 100) + '%';
  }
  function setStatus(id, msg, bad) { const el = $(id); el.textContent = msg; el.className = 'status' + (bad ? ' bad' : ''); }
  if (!hasBle) $('bleWarn').hidden = false;

  let demo = null;
  function makeRace() {
    const def = C.COURSES.find((c) => c.id === cfg.course) || C.COURSES[0];
    return new C.Race({ track: C.buildTrack(def), laps: cfg.laps, mass: cfg.weight + 9, pace: cfg.ftp * 0.88, difficulty: cfg.difficulty });
  }
  function makeDemo() { demo = makeRace(); if (state.mode === 'menu') state.race = demo; }

  $('btnStart').addEventListener('click', () => startRace());
  $('btnAgain').addEventListener('click', () => startRace());
  $('btnMenu').addEventListener('click', () => toMenu());
  function startRace() {
    state.race = makeRace(); state.mode = 'race'; state.paused = false; state.toasts = []; state.powerSum = 0; state.powerT = 0; state.maxPower = 0; state.resultsShown = false;
    kb.power = cfg.ftp * 0.9; ride.use = false;
    $('menu').hidden = true; $('results').hidden = true;
  }
  function toMenu() {
    state.mode = 'menu'; $('menu').hidden = false; $('results').hidden = true; makeDemo();
    if (trainer.link) trainer.link.setGrade(0);
  }

  // ---------- Game loop ----------
  function toast(msg, color) { state.toasts.push({ msg, color, life: 2.4 }); if (state.toasts.length > 4) state.toasts.shift(); }

  function handleEvents(race) {
    for (const e of race.events) {
      if (e.type === 'pickup' && e.rider.isPlayer) toast(`Got ${C.ITEMS[e.item].name}!`, '#ffe14d');
      else if (e.type === 'use' && e.rider.isPlayer) toast(C.ITEMS[e.item].name + '!', '#9ee7ff');
      else if (e.type === 'hit' && e.rider.isPlayer) toast('OUCH! You got hit!', '#ff6b6b');
      else if (e.type === 'hit' && !e.rider.isPlayer && e.source !== 'banana') toast(`${e.rider.name} got bombed!`, '#ffd7e8');
      else if (e.type === 'blocked' && e.rider.isPlayer) toast('Shield blocked it!', '#9ee7ff');
      else if (e.type === 'incoming') state.incoming = 3;
      else if (e.type === 'notarget') toast('No target ahead', '#ccc');
      else if (e.type === 'lap') toast(`Lap ${e.lap} / ${race.laps}`, '#fff');
      else if (e.type === 'finish' && e.rider.isPlayer) { toast(`FINISHED — P${e.place}!`, '#7dff9b'); state.finishedAt = performance.now(); }
    }
    race.events.length = 0;
  }

  function showResults(race) {
    state.resultsShown = true;
    const rows = race.results().map((r) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.place}</td><td><i style="background:${r.color}"></i>${r.name}</td><td>${r.time != null ? C.fmtTime(r.time) : '+' + Math.round(r.behind) + ' m to go'}</td></tr>`).join('');
    const avg = state.powerT ? Math.round(state.powerSum / state.powerT) : 0;
    $('resultsBody').innerHTML = rows;
    $('resultsStats').textContent = `Your average power ${avg} W (${(avg / cfg.weight).toFixed(2)} W/kg) • max ${Math.round(state.maxPower)} W`;
    $('results').hidden = false;
    if (trainer.link) trainer.link.setGrade(0);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const race = state.race;
    if (state.mode === 'race' && !state.paused) {
      const fresh = trainer.connected && now - trainer.lastSeen < 3000;
      kb.steer += (((keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0)) - kb.steer) * Math.min(1, dt * 9);
      if (!trainer.connected) kb.power = clamp(kb.power + (((keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0)) * 90) * dt, 0, 1500);
      let steer = ride.connected && ride.map ? rideSteer() : kb.steer;
      if (ride.connected && ride.map && Math.abs(kb.steer) > 0.1) steer = kb.steer;
      if (cfg.invertSteer) steer = -steer;
      const power = trainer.connected ? (fresh ? trainer.power : 0) : kb.power;
      const input = { power, steer, use: ride.use };
      ride.use = false;
      for (let rem = dt; rem > 1e-4; rem -= 1 / 60) { race.update(Math.min(rem, 1 / 60), input); input.use = false; }
      handleEvents(race);
      if (race.state !== 'countdown' && !race.player.finished) { state.powerSum += power * dt; state.powerT += dt; state.maxPower = Math.max(state.maxPower, power); }
      if (trainer.link && race.state !== 'countdown') trainer.link.setGrade(race.player.grade * 100 * cfg.gradeFeel);
      for (const t of state.toasts) t.life -= dt;
      state.toasts = state.toasts.filter((t) => t.life > 0);
      state.incoming = Math.max(0, state.incoming - dt);
      if (!state.resultsShown && (race.state === 'finished' || (race.player.finished && now - state.finishedAt > 3500))) showResults(race);
    }
    if (race) {
      const p = race.player;
      renderer.render(race, state.paused ? 0 : dt, {
        power: p.pw, cadence: trainer.connected ? trainer.cadence : (p.v > 0.5 ? clamp(p.pw / 3.2 + 40, 40, 130) : 0), ftp: cfg.ftp, weight: cfg.weight,
        toasts: state.toasts, incoming: state.incoming > 0, paused: state.paused, menu: state.mode === 'menu',
        useHint: ride.connected ? (ride.bound === null ? 'Press a controller button' : 'Press your item button') : 'Space = use item',
      });
    }
    requestAnimationFrame(frame);
  }

  refreshLabels(); makeDemo();
  window.CritDebug = { state, cfg, trainer, ride, startRace, toMenu };
  requestAnimationFrame(frame);
})();
