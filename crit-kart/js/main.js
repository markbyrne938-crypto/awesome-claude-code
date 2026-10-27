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
  const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

  const cfg = {
    course: store.get('course', 'meadow'), laps: store.get('laps', 12), ftp: store.get('ftp', 200), weight: store.get('weight', 75),
    difficulty: store.get('difficulty', 1), gradeFeel: store.get('gradeFeel', 0.7), invertSteer: store.get('invertSteer', false),
    mode: store.get('mode', 'single'), sens: store.get('sens', 1), sound: store.get('sound', true),
  };
  const state = {
    mode: 'menu', paused: false, pauseMsg: '', race: null, toasts: [], incoming: 0, resultsShown: false, finishedAt: 0, champ: null,
    powerSum: 0, powerT: 0, maxPower: 0, powerLog: [], sampleSum: 0, sampleN: 0, sampleT: 0, lapTimes: [], lastTick: null,
    place: 0, placeCand: 0, placeTimer: 0, wake: null,
  };
  const trainer = { link: null, connected: false, power: 0, cadence: 0, lastSeen: 0, reconnecting: false };
  const ride = { link: null, connected: false, idle: null, held: 0, latest: {}, msgs: 0, map: store.get('steerMap', null), use: false, bound: store.get('boundBtn', null), cal: null, binding: false };
  const keys = {};
  const kb = { steer: 0, power: 0 };

  const renderer = new C.Renderer($('game'));
  window.addEventListener('resize', () => renderer.resize());
  C.audio.enabled = cfg.sound;
  const play = (n) => C.audio.play(n);

  const hasBle = !!navigator.bluetooth;
  const logLines = [];
  const log = (s) => {
    const t = new Date().toISOString().slice(11, 23);
    logLines.push(`${t} ${s}`); if (logLines.length > 60) logLines.shift();
    const el = $('log'); el.textContent = logLines.slice(-18).join('\n'); el.scrollTop = el.scrollHeight;
  };
  function setStatus(id, msg, bad) { const el = $(id); el.textContent = msg; el.className = 'status' + (bad ? ' bad' : ''); }
  $('btnCopyLog').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(logLines.join('\n')); log('(log copied to clipboard)'); } catch (e) { log('copy failed — select the text manually'); }
  });
  $('btnClearLog').addEventListener('click', () => { logLines.length = 0; $('log').textContent = ''; });

  // ---------- Trainer ----------
  function trainerCallbacks() {
    return {
      onStatus: (s) => { setStatus('trainerStatus', s); log('trainer: ' + s); },
      onDisconnect: () => {
        trainer.connected = false;
        if (state.mode === 'race' && state.race && state.race.state !== 'finished') { pauseGame('Trainer disconnected — reconnecting…'); play('error'); }
        reconnectTrainer();
      },
      onData: (d) => {
        if (!(d.power >= 0 && d.power < 2500)) return; // ignore garbage / spikes
        trainer.connected = true; trainer.power = d.power; if (d.cadence != null) trainer.cadence = d.cadence; trainer.lastSeen = performance.now();
      },
    };
  }
  async function reconnectTrainer() {
    if (trainer.reconnecting || !trainer.link) return;
    trainer.reconnecting = true;
    for (let i = 1; i <= 6 && !trainer.connected; i++) {
      await new Promise((r) => setTimeout(r, 1500 * i));
      try { await trainer.link.reconnect(); trainer.connected = true; trainer.lastSeen = performance.now(); log('trainer: reconnected'); if (state.paused) state.pauseMsg = 'Trainer reconnected — press Resume'; break; }
      catch (e) { log(`trainer: reconnect ${i} failed (${e.message})`); }
    }
    if (!trainer.connected && state.paused) state.pauseMsg = 'Could not reconnect. Check the trainer, then Quit and reconnect it from the menu.';
    trainer.reconnecting = false;
  }
  $('btnTrainer').addEventListener('click', async () => {
    if (!hasBle) return setStatus('trainerStatus', 'Web Bluetooth not available — use Chrome or Edge over https/localhost.', true);
    try {
      if (trainer.link) trainer.link.disconnect();
      trainer.link = new C.TrainerLink(trainerCallbacks());
      setStatus('trainerStatus', 'Connecting…');
      await trainer.link.connect();
      trainer.connected = true; trainer.lastSeen = performance.now();
    } catch (e) { setStatus('trainerStatus', 'Trainer: ' + e.message, true); trainer.link = null; trainer.connected = false; }
  });

  // ---------- Zwift Ride controls ----------
  $('btnRide').addEventListener('click', async () => {
    if (!hasBle) return setStatus('rideStatus', 'Web Bluetooth not available — use Chrome or Edge over https/localhost.', true);
    try {
      if (ride.link) ride.link.disconnect();
      ride.idle = null; ride.held = 0; ride.latest = {}; ride.msgs = 0;
      ride.link = new C.ZwiftRideLink({
        onStatus: (s) => { setStatus('rideStatus', s); log('controls: ' + s); },
        onDisconnect: () => { ride.connected = false; },
        onRaw: (s) => log(s),
        onMessage: onRideMessage,
      });
      setStatus('rideStatus', 'Connecting… (close Zwift / Companion first: only one app can hold the controls)');
      await ride.link.connect();
      ride.connected = true;
    } catch (e) { setStatus('rideStatus', 'Controls: ' + e.message, true); ride.connected = false; }
  });

  function onRideMessage(msg) {
    ride.msgs++;
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
    if (state.mode === 'race' && !state.paused && (ride.bound === null || ride.bound === bit)) ride.use = true;
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
      setTimeout(() => { cal.stage = stage; setStatus('rideStatus', msg); play('tick'); setTimeout(next, ms); }, 900);
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
    if (locL === null && locR === null) { setStatus('rideStatus', 'No steering movement detected. Check the log below, then try again.', true); play('error'); return; }
    if (locL === null) locL = locR;
    if (locR === null) locR = locL;
    ride.map = { locL, locR, cL: c[locL], cR: c[locR], dL: ml[locL] - c[locL], dR: mr[locR] - c[locR] };
    store.set('steerMap', ride.map);
    setStatus('rideStatus', `Steering calibrated (axis ${locL === locR ? locL : locL + '/' + locR}). Check the test bar above.`);
    play('bestLap');
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

  let liveT = 0;
  function updateLivePanel(dt) {
    liveT += dt; if (liveT < 0.1) return; liveT = 0;
    const held = []; for (let b = 0; b < 32; b++) if (ride.held & (1 << b)) held.push(b);
    $('liveBtns').textContent = ride.connected ? (held.length ? held.join(', ') : 'none held') : 'not connected';
    const an = Object.entries(ride.latest); $('liveAnalog').textContent = an.length ? an.map(([k, v]) => `#${k}=${v}`).join('  ') : '–';
    $('liveCount').textContent = ride.msgs;
    $('liveCal').textContent = ride.map ? 'calibrated' : (an.length ? 'press Calibrate' : 'not calibrated');
    $('steerDot').style.left = (50 + 50 * rideSteer()) + '%';
  }

  // ---------- Keyboard / window ----------
  function toggleFullscreen() { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch (e) { /* ignore */ } }
  function setSound(on) { cfg.sound = on; C.audio.enabled = on; store.set('sound', on); $('sound').checked = on; }
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (state.mode === 'race' && !state.paused && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') && !e.repeat) ride.use = true;
    if ((e.code === 'Escape' || e.code === 'KeyP') && state.mode === 'race' && !state.resultsShown) (state.paused ? resumeGame() : pauseGame(''));
    if (e.code === 'KeyM') setSound(!cfg.sound);
    if (e.code === 'KeyF') toggleFullscreen();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'race' && !state.resultsShown) pauseGame('Paused while the tab was hidden');
    else if (!document.hidden && state.mode === 'race') acquireWake();
  });
  async function acquireWake() { try { if (navigator.wakeLock && !state.wake) { state.wake = await navigator.wakeLock.request('screen'); state.wake.addEventListener('release', () => { state.wake = null; }); } } catch (e) { /* optional */ } }
  function releaseWake() { try { state.wake && state.wake.release(); } catch (e) { /* ignore */ } state.wake = null; }
  $('btnFull').addEventListener('click', toggleFullscreen);

  function pauseGame(msg) { if (state.mode !== 'race') return; state.paused = true; state.pauseMsg = msg || ''; }
  function resumeGame() { state.paused = false; state.pauseMsg = ''; ride.use = false; }
  $('btnResume').addEventListener('click', resumeGame);
  $('btnRestart').addEventListener('click', () => startRace());
  $('btnQuit').addEventListener('click', () => toMenu());

  // ---------- Menu wiring ----------
  const courseSel = $('course');
  C.COURSES.forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; courseSel.appendChild(o); });
  const bind = (id, key, num) => {
    const el = $(id); el.value = cfg[key];
    el.addEventListener('input', () => { cfg[key] = num ? Number(el.value) : el.value; store.set(key, cfg[key]); if (key === 'course') makeDemo(); refreshLabels(); });
  };
  bind('course', 'course'); bind('laps', 'laps', true); bind('ftp', 'ftp', true); bind('weight', 'weight', true); bind('difficulty', 'difficulty', true);
  bind('gradeFeel', 'gradeFeel', true); bind('mode', 'mode'); bind('sens', 'sens', true);
  $('invert').checked = cfg.invertSteer; $('invert').addEventListener('change', () => { cfg.invertSteer = $('invert').checked; store.set('invertSteer', cfg.invertSteer); });
  $('sound').checked = cfg.sound; $('sound').addEventListener('change', () => { setSound($('sound').checked); play('pickup'); });
  function refreshLabels() {
    const def = C.COURSES.find((c) => c.id === cfg.course) || C.COURSES[0];
    const est = (d) => C.estimateLapTime(C.buildTrack(d), cfg.ftp, cfg.weight + 9) * lapsFor(d) / 60;
    if (cfg.mode === 'champ') {
      $('courseBlurb').textContent = `Championship: ${C.COURSES.map((c) => c.name).join(' → ')}. ${C.COURSES.map((c) => lapsFor(c)).join(' / ')} laps (about ${C.COURSES.map((c) => est(c).toFixed(0)).join(' / ')} min at ${cfg.ftp} W). Points 10-8-6-5-4-3-2-1.`;
    } else {
      const t = C.buildTrack(def), len = Math.round(t.length);
      $('courseBlurb').textContent = `${def.blurb} Lap ${len} m • ${lapsFor(def)} laps = ${(len * lapsFor(def) / 1000).toFixed(1)} km — about ${est(def).toFixed(1)} min at ${cfg.ftp} W (less in the draft).`;
    }
    courseSel.disabled = cfg.mode === 'champ';
    $('lapsVal').textContent = cfg.laps; $('diffVal').textContent = cfg.difficulty.toFixed(2) + '×'; $('feelVal').textContent = Math.round(cfg.gradeFeel * 100) + '%'; $('sensVal').textContent = cfg.sens.toFixed(1) + '×';
  }
  if (!hasBle) $('bleWarn').hidden = false;

  const lapsFor = (def) => Math.max(2, Math.round(cfg.laps * (def.lapScale || 1)));
  const currentCourseId = () => (state.champ ? state.champ.rounds[state.champ.round] : cfg.course);
  function makeRace() {
    const def = C.COURSES.find((c) => c.id === currentCourseId()) || C.COURSES[0];
    return new C.Race({ track: C.buildTrack(def), laps: lapsFor(def), mass: cfg.weight + 9, pace: cfg.ftp * 0.8, difficulty: cfg.difficulty });
  }
  function makeDemo() { if (state.mode === 'menu') state.race = makeRace(); }

  $('btnStart').addEventListener('click', () => { state.champ = cfg.mode === 'champ' ? newChamp() : null; startRace(); });
  $('btnAgain').addEventListener('click', () => {
    if (state.champ && state.champ.round === state.champ.rounds.length - 1 && state.champ.finalShown) state.champ = newChamp(); // new championship after the final
    startRace();
  });
  $('btnNext').addEventListener('click', () => { commitRound(); state.champ.round++; startRace(); });
  $('btnMenu').addEventListener('click', () => toMenu());
  const newChamp = () => ({ round: 0, rounds: C.COURSES.map((c) => c.id), pts: {}, pending: null, finalShown: false });

  function startRace() {
    C.audio.unlock();
    state.race = makeRace(); state.mode = 'race'; state.paused = false; state.pauseMsg = ''; state.toasts = []; state.resultsShown = false;
    state.powerSum = state.powerT = state.maxPower = 0; state.powerLog = []; state.sampleSum = state.sampleN = state.sampleT = 0; state.lapTimes = []; state.lastTick = null;
    state.place = state.placeCand = 0; state.placeTimer = 0;
    kb.power = cfg.ftp * 0.9; ride.use = false;
    $('menu').hidden = true; $('results').hidden = true; $('pause').hidden = true;
    const def = C.COURSES.find((c) => c.id === currentCourseId());
    toast(state.champ ? `Round ${state.champ.round + 1}/${state.champ.rounds.length}: ${def.name}` : def.name, '#fff', 3.5);
    acquireWake();
  }
  function toMenu() {
    state.mode = 'menu'; state.paused = false; state.champ = null; $('menu').hidden = false; $('results').hidden = true; $('pause').hidden = true; makeDemo(); releaseWake();
    if (trainer.link) trainer.link.setGrade(0);
  }

  // ---------- Game loop ----------
  function toast(msg, color, life = 2.4) { state.toasts.push({ msg, color, life }); if (state.toasts.length > 4) state.toasts.shift(); }

  function handleEvents(race) {
    for (const e of race.events) {
      const mine = e.rider && e.rider.isPlayer;
      if (e.type === 'go') play('go');
      else if (e.type === 'pickup' && mine) { toast(`Got ${C.ITEMS[e.item].name}!`, '#ffe14d'); play('pickup'); }
      else if (e.type === 'use' && mine) { toast(C.ITEMS[e.item].name + '!', '#9ee7ff'); play(e.item); }
      else if (e.type === 'hit' && mine) { toast('OUCH! You got hit!', '#ff6b6b'); play('hit'); }
      else if (e.type === 'hit' && !mine && e.source !== 'banana') toast(`${e.rider.name} got bombed!`, '#ffd7e8');
      else if (e.type === 'blocked' && mine) { toast('Shield blocked it!', '#9ee7ff'); play('blocked'); }
      else if (e.type === 'obstacle' && mine) {
        toast({ bump: 'Speed bump!', cone: 'Cone! Weave!', pothole: 'Pothole!', barrel: 'Barrel crash!' }[e.kind], '#ffd9a0', 1.4);
        play(e.kind === 'bump' ? 'bump' : 'clunk');
      } else if (e.type === 'incoming') { state.incoming = 3; play('incoming'); }
      else if (e.type === 'notarget') toast('No target ahead', '#ccc');
      else if (e.type === 'lap') {
        state.lapTimes.push(e.lapTime);
        const best = Math.min(...state.lapTimes), isBest = e.lapTime <= best && state.lapTimes.length > 1;
        if (!e.final) { toast(`Lap ${e.lap}/${race.laps}  ${C.fmtTime(e.lapTime)}${isBest ? '  ★ best' : ''}`, isBest ? '#ffe14d' : '#fff'); play(isBest ? 'bestLap' : 'lap'); }
      } else if (e.type === 'finish' && mine) { toast(`FINISHED — P${e.place}!`, '#7dff9b', 3); play('finish'); state.finishedAt = performance.now(); }
    }
    race.events.length = 0;
  }

  // position change toasts, debounced so jostling in the pack doesn't spam
  function trackPlace(race, dt) {
    const place = race.rank(race.player) + 1;
    if (!state.place) { state.place = place; state.placeCand = place; return; }
    if (place !== state.placeCand) { state.placeCand = place; state.placeTimer = 0; return; }
    state.placeTimer += dt;
    if (state.placeTimer > 1.2 && place !== state.place) {
      if (!race.player.finished) { toast(place < state.place ? `▲ Up to P${place}` : `▼ Down to P${place}`, place < state.place ? '#8cffb0' : '#ffb3b3', 1.6); play(place < state.place ? 'up' : 'down'); }
      state.place = place;
    }
  }

  function normalizedPower(log) {
    if (log.length < 30) return null;
    const roll = []; let sum = 0;
    for (let i = 0; i < log.length; i++) { sum += log[i]; if (i >= 30) sum -= log[i - 30]; if (i >= 29) roll.push(sum / 30); }
    return Math.pow(mean(roll.map((v) => Math.pow(v, 4))), 0.25);
  }

  function drawPowerChart() {
    const cv = $('powerChart'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height, log = state.powerLog;
    ctx.clearRect(0, 0, W, H);
    if (!log.length) return;
    const top = Math.max(cfg.ftp * 1.4, ...log), bw = W / log.length;
    log.forEach((p, i) => { ctx.fillStyle = C.zoneColor(p / cfg.ftp); const h = (p / top) * (H - 6); ctx.fillRect(i * bw, H - h, Math.ceil(bw) + 0.5, h); });
    ctx.setLineDash([6, 4]); ctx.strokeStyle = '#1b1b2f'; ctx.lineWidth = 2; const y = H - (cfg.ftp / top) * (H - 6); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#1b1b2f'; ctx.fillText(`FTP ${cfg.ftp} W`, 6, y - 4);
  }

  function roundPoints(results) { const out = {}; results.forEach((r, i) => { out[r.name] = POINTS[i] || 0; }); return out; }
  function commitRound() {
    const c = state.champ; if (!c || !c.pending) return;
    for (const [n, p] of Object.entries(c.pending)) c.pts[n] = (c.pts[n] || 0) + p;
    c.pending = null;
  }

  function showResults(race) {
    state.resultsShown = true; state.paused = false; $('pause').hidden = true;
    const res = race.results(), champ = state.champ;
    if (champ) champ.pending = roundPoints(res);
    $('resultsBody').innerHTML = res.map((r) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.place}</td><td><i style="background:${r.color}"></i>${r.name}</td><td>${r.time != null ? C.fmtTime(r.time) : '+' + Math.round(r.behind) + ' m to go'}</td>${champ ? `<td class="pts">+${champ.pending[r.name]}</td>` : ''}</tr>`).join('');
    const avg = state.powerT ? Math.round(state.powerSum / state.powerT) : 0, np = normalizedPower(state.powerLog);
    const best = state.lapTimes.length ? C.fmtTime(Math.min(...state.lapTimes)) : '–';
    const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    $('resultsStats').innerHTML = stat(avg + ' W', 'avg power') + stat(np ? Math.round(np) + ' W' : '–', 'normalized') + stat((avg / cfg.weight).toFixed(2), 'W/kg') + stat(Math.round(state.maxPower) + ' W', 'max') + stat(best, 'best lap');
    const player = res.find((r) => r.isPlayer);
    $('resultsTitle').textContent = player.place === 1 ? '🏆 YOU WON!' : player.place <= 3 ? 'PODIUM!' : 'RESULTS';
    // championship panel
    const box = $('champBox'); box.hidden = !champ;
    const last = champ && champ.round === champ.rounds.length - 1;
    $('btnNext').hidden = !(champ && !last);
    $('btnAgain').textContent = champ && last ? 'New championship' : champ ? 'Retry this round' : 'Race again';
    if (champ) {
      champ.finalShown = last;
      const totals = {}; for (const r of res) totals[r.name] = (champ.pts[r.name] || 0) + champ.pending[r.name];
      const rows = res.slice().sort((a, b) => totals[b.name] - totals[a.name]);
      $('champTitle').textContent = last ? 'Final championship standings' : `Standings after round ${champ.round + 1}/${champ.rounds.length}`;
      $('champBody').innerHTML = rows.map((r, i) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><i style="background:${r.color}"></i>${r.name}</td><td class="pts">${totals[r.name]} pts</td></tr>`).join('');
      if (last) { commitRound(); const w = rows[0]; $('resultsTitle').textContent = w.isPlayer ? '🏆 CHAMPION!' : `${w.name} wins the title`; }
    }
    $('results').hidden = false; drawPowerChart();
    if (trainer.link) trainer.link.setGrade(0);
    releaseWake();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const race = state.race;
    const staleTrainer = trainer.link && now - trainer.lastSeen > 3000;
    if (state.mode === 'race' && !state.paused && race) {
      const fresh = trainer.connected && !staleTrainer;
      kb.steer += (((keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0)) - kb.steer) * Math.min(1, dt * 9);
      if (!trainer.link) kb.power = clamp(kb.power + (((keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0)) * 90) * dt, 0, 1500);
      let steer = ride.connected && ride.map ? rideSteer() : kb.steer;
      if (ride.connected && ride.map && Math.abs(kb.steer) > 0.1) steer = kb.steer;
      if (cfg.invertSteer) steer = -steer;
      steer = clamp(steer * cfg.sens, -1, 1);
      const power = trainer.link ? (fresh ? trainer.power : 0) : kb.power; // a dropped trainer never silently becomes keyboard power
      const input = { power, steer, use: ride.use };
      ride.use = false;
      for (let rem = dt; rem > 1e-4; rem -= 1 / 60) { race.update(Math.min(rem, 1 / 60), input); input.use = false; }
      handleEvents(race);
      if (race.state === 'countdown') {
        const c = Math.ceil(-race.time);
        if (c <= 3 && c !== state.lastTick) { state.lastTick = c; play('tick'); }
      } else if (!race.player.finished) {
        state.powerSum += power * dt; state.powerT += dt; state.maxPower = Math.max(state.maxPower, power);
        state.sampleSum += power * dt; state.sampleT += dt;
        if (state.sampleT >= 1) { state.powerLog.push(state.sampleSum / state.sampleT); state.sampleSum = state.sampleT = 0; }
        trackPlace(race, dt);
      }
      if (trainer.link && race.state !== 'countdown') trainer.link.setGrade(race.player.grade * 100 * cfg.gradeFeel);
      for (const t of state.toasts) t.life -= dt;
      state.toasts = state.toasts.filter((t) => t.life > 0);
      state.incoming = Math.max(0, state.incoming - dt);
      if (!state.resultsShown && (race.state === 'finished' || (race.player.finished && now - state.finishedAt > 3500))) showResults(race);
    }
    $('pause').hidden = !(state.paused && state.mode === 'race');
    if (state.paused) $('pauseMsg').textContent = state.pauseMsg || (trainer.link && staleTrainer ? 'No power signal from the trainer.' : 'Take a breather. The race is frozen.');
    if (!$('menu').hidden) updateLivePanel(dt);

    if (race) {
      const p = race.player;
      renderer.render(race, state.paused ? 0 : dt, {
        power: p.pw, cadence: trainer.link ? (trainer.connected ? trainer.cadence : 0) : (p.v > 0.5 ? clamp(p.pw / 3.2 + 40, 40, 130) : 0), ftp: cfg.ftp, weight: cfg.weight,
        toasts: state.toasts, incoming: state.incoming > 0, menu: state.mode === 'menu',
        warning: race.state === 'racing' && staleTrainer && !state.paused ? '⚠ NO POWER SIGNAL' : '',
        chips: [
          trainer.link ? { label: trainer.connected && !staleTrainer ? 'Trainer' : 'Trainer ✗', state: trainer.connected && !staleTrainer ? 'ok' : 'bad' } : { label: 'Keyboard power', state: 'off' },
          ride.connected ? { label: ride.map ? 'Controls' : 'Controls (uncalibrated)', state: ride.map ? 'ok' : 'off' } : { label: 'Keyboard steer', state: 'off' },
        ],
        useHint: ride.connected ? (ride.bound === null ? 'Press a controller button' : 'Press your item button') : 'Space = use item',
      });
    }
    requestAnimationFrame(frame);
  }

  refreshLabels(); makeDemo();
  window.CritDebug = { renderer, state, cfg, trainer, ride, startRace, toMenu, showResults, onRideMessage, rideSteer };
  requestAnimationFrame(frame);
})();
