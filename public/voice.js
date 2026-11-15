'use strict';
// Hubitat Home voice control: client-side parser + animated listening sheet.
// Parser is pure (no DOM) so it can be unit-tested in Node: self.HHVoice.parse(text, ctx).
(function (root) {
  const NUM = { one: '1', two: '2', three: '3', four: '4', first: '1', second: '2' };
  const FILLER = new Set(['the', 'a', 'an', 'please', 'my', 'can', 'you', 'could', 'would', 'hey', 'ok', 'okay', 'set', 'to', 'in', 'of', 'and', 'now', 'turn', 'switch', 'put', 'make', 'it', 'is', 'up', 'down']);
  const ON_W = ['on', 'enable', 'start', 'activate'];
  const OFF_W = ['off', 'disable', 'stop', 'deactivate', 'kill', 'shut'];
  const SPEEDS = { low: 'low', slow: 'low', medium: 'medium', med: 'medium', mid: 'medium', middle: 'medium', high: 'high', fast: 'high', max: 'high', full: 'high' };

  const ALIAS = { lite: 'light', lites: 'light', lite_: 'light', fam: 'family', livingroom: 'living', bedroom: 'bedroom', bathroom: 'bathroom' };
  const stem = (w) => (ALIAS[w] ? ALIAS[w] : w === 'lights' ? 'light' : w === 'fans' ? 'fan' : w === 'plugs' ? 'plug' : w === 'lamps' ? 'lamp' : w === 'closets' ? 'closet' : NUM[w] || w);
  const tokens = (s) => String(s).toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(stem);
  function lev(a, b) {
    if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  const wsim = (a, b) => { if (a === b) return 1; if (a.length < 3 || b.length < 3) return 0; const r = 1 - lev(a, b) / Math.max(a.length, b.length); return r >= 0.7 ? r : 0; };
  // Dice-style similarity between query tokens and a candidate name.
  function score(q, name) {
    const c = tokens(name); if (!q.length || !c.length) return 0;
    const used = new Set(); let m = 0;
    for (const ct of c) { let best = 0, bi = -1; q.forEach((qt, i) => { if (used.has(i)) return; const s = wsim(qt, ct); if (s > best) { best = s; bi = i; } }); if (bi >= 0) { used.add(bi); m += best; } }
    return (2 * m) / (q.length + c.length);
  }

  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, '1': 1, '2': 2, '3': 3, '4': 4 };
  function firstNumber(words) {
    for (let i = 0; i < words.length; i++) {
      const w = words[i].replace(/°|degrees?/g, '');
      if (/^\d{1,3}$/.test(w)) return Number(w);
      if (TENS[w]) { const o = ONES[words[i + 1]]; return TENS[w] + (o && o < 10 ? o : 0); }
      if (ONES[w] && !/^\d$/.test(w)) return ONES[w];
    }
    return null;
  }
  const TW = ['thermostat', 'ac', 'air', 'conditioner', 'conditioning', 'hvac', 'furnace', 'climate'];
  function parseThermo(raw, lower, action) {
    const rawWords = lower.replace(/[^a-z0-9°\s']/g, ' ').split(/\s+/).filter(Boolean);
    const has = (w) => raw.includes(w);
    const isAC = /\ba\s*\/?\s*c\b/.test(lower) || has('ac');
    const tword = isAC || TW.some(has);
    const heatW = has('heat') || has('heating') || has('warm') || has('warmer');
    const coolW = has('cool') || has('cooling') || has('cooler');
    // "what's the temperature", "how hot is it", "what's the thermostat at"
    if ((has('what') || has('whats') || has('how') || lower.startsWith("what's")) && (has('temperature') || has('temp') || has('hot') || has('cold') || has('warm') || tword)) return { type: 'tstat', op: 'query' };
    if ((has('temperature') || has('temp')) && raw.length <= 3 && firstNumber(rawWords) === null) return { type: 'tstat', op: 'query' };
    // fan: "fan on", "fan auto", "thermostat fan circulate"
    if (has('fan') && (raw[0] === 'fan' || tword) && (has('circulate') || has('auto') || has('on') || has('circulation'))) {
      return { type: 'tstat', op: 'fan', fan: has('circulate') || has('circulation') ? 'circulate' : has('auto') ? 'auto' : 'on' };
    }
    if (has('fan') && !tword) return null;
    const n = firstNumber(rawWords);
    // up/down
    const up = has('up') || has('warmer') || has('raise') || has('higher'), down = has('down') || has('cooler') || has('lower');
    if ((tword || has('temperature') || has('temp')) && (up || down) && !(up && down)) {
      const d = n && n <= 10 ? n : 1;
      return { type: 'tstat', op: 'delta', delta: up ? d : -d, which: heatW ? 'heat' : coolW ? 'cool' : null };
    }
    // set to N: "set the thermostat to 72", "set it to 72", "set the AC to 74", "heat to 68"
    const setLike = has('set') || has('make') || raw.includes('to') || lower.includes('degrees');
    if (n !== null && n >= 40 && n <= 110 && (tword || heatW || coolW || has('temperature') || has('temp') || (setLike && (has('it') || raw.length <= 4)))) {
      return { type: 'tstat', op: 'set', value: n, which: heatW ? 'heat' : (coolW || isAC) ? 'cool' : null };
    }
    // modes
    if (has('mode') || tword || heatW || coolW) {
      if (has('auto') && (has('mode') || tword)) return { type: 'tstat', op: 'mode', mode: 'auto' };
      if (action === 'off' && (tword || heatW || coolW)) return { type: 'tstat', op: 'mode', mode: 'off' };
      if (has('mode') && has('off')) return { type: 'tstat', op: 'mode', mode: 'off' };
      if (heatW && (has('mode') || action === 'on')) return { type: 'tstat', op: 'mode', mode: 'heat' };
      if ((coolW && (has('mode') || action === 'on')) || (isAC && action === 'on')) return { type: 'tstat', op: 'mode', mode: 'cool' };
      if (tword && action === 'on') return { type: 'tstat', op: 'mode', mode: 'cool' };
      if (tword && !action) return { type: 'tstat', op: 'query' };
    }
    return null;
  }

  function parse(text, ctx) {
    const devices = ctx.devices || [], rooms = ctx.rooms || [];
    const raw = tokens(text);
    if (!raw.length) return { type: 'none', reason: 'empty' };
    const has = (w) => raw.includes(w);
    let action = null;
    if (has('toggle') || has('flip')) action = 'toggle';
    else if (raw.some((w) => OFF_W.includes(w))) action = 'off';
    else if (raw.some((w) => ON_W.includes(w))) action = 'on';
    else if (/\bturn(ed)? of\b/.test(String(text).toLowerCase())) action = 'off'; // common mis-hearing of "turn off"
    const speedWord = raw.find((w) => SPEEDS[w]);

    // Thermostat
    if (ctx.thermo && !has('away')) { const tr = parseThermo(raw, String(text).toLowerCase(), action); if (tr) return tr; }

    // Away Mode
    if (has('away') || (has('gone') && has('mode'))) return { type: 'away', action: action || 'toggle' };

    // Query = what's left after command words
    const q = raw.filter((w) => !FILLER.has(w) && !ON_W.includes(w) && !OFF_W.includes(w) && w !== 'toggle' && w !== 'flip' && w !== 'speed' && !SPEEDS[w]);

    // All off: "all off", "everything off", "turn off all the lights", "lights off"
    const allish = has('all') || has('everything') || has('house') || has('whole');
    if (action === 'off' && (allish || (q.length === 1 && q[0] === 'light') || !q.length)) {
      const qq = q.filter((w) => !['all', 'everything', 'house', 'whole', 'light', 'fan'].includes(w));
      if (!qq.length) return { type: 'alloff' };
    }

    // Fan speed
    if (speedWord) {
      const fans = devices.filter((d) => d.speeds);
      const qs = q.filter((w) => w !== 'fan');
      let target = null;
      if (fans.length === 1 && (!qs.length || score(q, fans[0].name) >= 0.5 || score(qs, fans[0].room) >= 0.6)) target = fans[0];
      else { const r = fans.map((d) => ({ d, s: Math.max(score(q, d.name), score(qs, d.room)) })).sort((a, b) => b.s - a.s); if (r[0] && r[0].s >= 0.5) target = r[0].d; }
      if (!target) {
        const other = devices.find((d) => d.kind === 'fan' && score(q, d.name) >= 0.8);
        if (other) return { type: 'none', reason: `${other.name} doesn't have speed settings` };
        return { type: 'none', reason: 'no-fan' };
      }
      return { type: 'speed', id: target.id, name: target.name, speed: SPEEDS[speedWord] };
    }

    if (!q.length) return { type: 'none', reason: 'no-target' };
    const cands = [
      ...devices.filter((d) => d.kind !== 'thermostat').map((d) => ({ kind: 'device', id: d.id, name: d.name, s: score(q, d.name) + 0.001 })),
      ...rooms.filter((r) => r !== 'Climate').map((r) => ({ kind: 'room', id: r, name: r, s: score(q, r) })),
    ].filter((c) => c.s >= 0.5).sort((a, b) => b.s - a.s);
    if (!cands.length) return { type: 'none', reason: 'no-match', query: q.join(' ') };
    const top = cands[0];
    let close = cands.filter((c) => top.s - c.s < 0.12);
    // A device and the room it's in scoring the same: the device is the more specific match ("porch" -> Porch Light).
    const devRooms = new Set(close.filter((c) => c.kind === 'device').map((c) => devices.find((d) => d.id === c.id).room));
    close = close.filter((c) => !(c.kind === 'room' && devRooms.has(c.id) && c.s <= top.s));
    if (close.length === 1) { const t = close[0]; if (t.kind === 'room') return { type: 'room', room: t.id, action: action || 'toggle' }; return { type: 'device', id: t.id, name: t.name, action: action || 'toggle' }; }
    if (close.length > 1 && top.s < 0.99) return { type: 'choose', action: action || 'toggle', choices: close.slice(0, 3).map(({ kind, id, name }) => ({ kind, id, name })) };
    if (top.kind === 'room') return { type: 'room', room: top.id, action: action || 'toggle' };
    return { type: 'device', id: top.id, name: top.name, action: action || 'toggle' };
  }
  root.HHVoice = { parse, tokens, score };
})(typeof self !== 'undefined' ? self : globalThis);

// ---------- UI ----------
(function () {
  if (typeof document === 'undefined') return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const fab = document.getElementById('micBtn');
  if (!SR || !fab || !window.HH) { if (fab) fab.remove(); return; }
  fab.classList.remove('hidden');
  const $ = (s) => document.querySelector(s);
  const sheet = $('#voice'), bg = $('#voiceBg'), tx = $('#vTranscript'), msg = $('#vMsg'), chips = $('#vChips');
  let rec = null, finalText = '', closeT = null, active = false;

  function setState(s) { sheet.dataset.state = s; }
  function open() {
    clearTimeout(closeT); finalText = ''; tx.textContent = 'Listening…'; tx.classList.add('hint'); msg.textContent = ''; chips.innerHTML = '';
    bg.classList.remove('hidden'); sheet.classList.remove('hidden'); setState('listening'); active = true;
  }
  function close() { clearTimeout(closeT); active = false; try { rec && rec.abort(); } catch {} bg.classList.add('hidden'); sheet.classList.add('hidden'); }
  function closeSoon(ms = 1500) { clearTimeout(closeT); closeT = setTimeout(close, ms); }
  function fail(text) { setState('fail'); msg.textContent = text; void sheet.offsetWidth; closeSoon(2200); }
  function ok(text) { setState('success'); msg.textContent = text; closeSoon(1500); }
  bg.addEventListener('click', close); $('#vClose').addEventListener('click', close);

  function start() {
    open();
    rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let gotResult = false;
    rec.onresult = (e) => {
      let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
      tx.classList.remove('hint'); tx.textContent = (finalText + ' ' + interim).trim() || 'Listening…';
      sheet.classList.remove('bump'); void sheet.offsetWidth; sheet.classList.add('bump');
      gotResult = true;
    };
    rec.onerror = (e) => {
      if (!active) return;
      const m = { 'not-allowed': 'Microphone access is blocked. Allow the mic for this app in your phone settings, then try again.', 'service-not-allowed': 'Voice isn’t available here. Allow the mic for this app and try again.', 'no-speech': 'I didn’t hear anything. Tap the mic and try again.', 'audio-capture': 'No microphone found.', network: 'Voice needs an internet connection.' };
      if (e.error === 'aborted') return;
      fail(m[e.error] || 'Voice didn’t work: ' + e.error);
    };
    rec.onend = () => { if (!active || sheet.dataset.state !== 'listening') return; const t = (finalText || tx.textContent || '').trim(); if (!gotResult || !t || t === 'Listening…') return fail('I didn’t catch that. Try “turn off the office light.”'); handle(t); };
    try { rec.start(); } catch (e) { fail('Couldn’t start the microphone.'); }
  }
  fab.addEventListener('click', () => { if (navigator.vibrate) navigator.vibrate(10); start(); });

  function describe(r) { return r.action === 'on' ? 'on' : r.action === 'off' ? 'off' : 'toggled'; }
  async function run(r) {
    const H = window.HH;
    try {
      if (r.type === 'device') { const d = H.device(r.id); const on = r.action === 'toggle' ? !H.isOn(d) : r.action === 'on'; await H.setDevice(r.id, on); H.flash(r.id); ok(`${d.name} ${on ? 'on' : 'off'}`); }
      else if (r.type === 'speed') { await H.setSpeed(r.id, r.speed); H.flash(r.id); ok(`${r.name} on ${r.speed === 'medium' ? 'Medium' : r.speed[0].toUpperCase() + r.speed.slice(1)}`); }
      else if (r.type === 'tstat') return runThermo(r);
      else if (r.type === 'away') { const cur = H.awayOn(); const on = r.action === 'toggle' ? !cur : r.action === 'on'; await H.setDevice(H.awayId(), on); ok(`Away Mode ${on ? 'on' : 'off'}`); }
      else if (r.type === 'room') {
        const list = H.devices().filter((d) => d.room === r.room && d.kind !== 'plug' && d.kind !== 'thermostat');
        let on = r.action === 'on'; if (r.action === 'toggle') on = !list.some((d) => H.isOn(d));
        const targets = on ? list.filter((d) => d.kind !== 'fan' && !H.isOn(d)) : list.filter((d) => H.isOn(d));
        if (!targets.length) return ok(`${r.room} is already ${on ? 'on' : 'off'}`);
        await Promise.all(targets.map((d, i) => new Promise((res) => setTimeout(() => { H.setDevice(d.id, on, { quiet: true }).catch(() => {}).finally(res); H.flash(d.id); }, i * 110))));
        ok(`${r.room}: ${targets.length} ${on ? 'on' : 'off'}`);
      }
      H.refreshSoon();
    } catch (e) { fail('That didn’t go through: ' + e.message); }
  }
  function speak(t) { try { if (!('speechSynthesis' in window)) return; const u = new SpeechSynthesisUtterance(t); u.lang = 'en-US'; u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {} }
  function runThermo(r) {
    const H = window.HH, t = H.thermo(), dev = H.thermoDev();
    if (!t || !dev) return fail('I can’t reach the thermostat right now.');
    const mode = t.mode || 'off';
    if (r.op === 'query') {
      const set = mode === 'cool' ? `cooling to ${t.coolingSetpoint}` : mode === 'heat' ? `heating to ${t.heatingSetpoint}` : mode === 'auto' ? `set to ${t.heatingSetpoint} to ${t.coolingSetpoint}` : 'the system is off';
      const said = `It’s ${Math.round(t.temperature)} degrees inside, ${set}.` + (t.humidity != null ? ` Humidity ${t.humidity}%.` : '');
      H.flash(dev.id); speak(said.replace('It’s', 'It is')); setState('success'); msg.textContent = said.replace(/ degrees/g, '°'); closeSoon(4000); return;
    }
    if (r.op === 'mode') { H.thermoChange({ mode: r.mode }); H.flash(dev.id); return ok(r.mode === 'off' ? 'Thermostat off' : `Thermostat: ${r.mode[0].toUpperCase() + r.mode.slice(1)} mode`); }
    if (r.op === 'fan') { H.thermoChange({ fan: r.fan }); H.flash(dev.id); return ok(`Thermostat fan: ${r.fan[0].toUpperCase() + r.fan.slice(1)}`); }
    if (mode === 'off') return fail('The thermostat is off. Say “cool mode” or “heat mode” first.');
    let which = r.which || (mode === 'heat' ? 'heat' : 'cool');
    if (mode === 'cool' && which === 'heat') return fail('It’s in cool mode. Say “heat mode” first.');
    if (mode === 'heat' && which === 'cool') return fail('It’s in heat mode. Say “cool mode” first.');
    const cur = which === 'cool' ? t.coolingSetpoint : t.heatingSetpoint;
    const val = r.op === 'set' ? r.value : (cur ?? 72) + r.delta;
    const [lo, hi] = which === 'cool' ? [60, 99] : [55, 90];
    if (val < lo || val > hi) return fail(`${which === 'cool' ? 'Cooling' : 'Heating'} can be set from ${lo}° to ${hi}°.`);
    H.thermoChange({ [which]: val }); H.flash(dev.id);
    return ok(`${which === 'cool' ? 'Cooling' : 'Heating'} to ${val}°`);
  }
  function handle(text) {
    setState('thinking'); tx.textContent = text;
    setTimeout(() => {
      const H = window.HH; if (!H.devices().length) return fail('Still connecting to the hub. Try again in a moment.');
      const r = self.HHVoice.parse(text, { devices: H.devices(), rooms: H.rooms(), thermo: !!H.thermoDev() });
      if (r.type === 'none') return fail(r.reason && r.reason.includes(' ') ? r.reason + '.' : 'I couldn’t match that to a device. Try “turn on the kitchen lights.”');
      if (r.type === 'choose') {
        setState('choose'); msg.textContent = 'Which one did you mean?';
        chips.innerHTML = r.choices.map((c, i) => `<button class="vchip" data-i="${i}">${c.name}</button>`).join('');
        chips.onclick = (e) => { const b = e.target.closest('.vchip'); if (!b) return; const c = r.choices[+b.dataset.i]; chips.innerHTML = ''; setState('thinking');
          run(c.kind === 'room' ? { type: 'room', room: c.id, action: r.action } : { type: 'device', id: c.id, name: c.name, action: r.action }); };
        return;
      }
      if (r.type === 'alloff') {
        setState('choose'); msg.textContent = 'Turn off all lights and fans? (Plugs and Away Mode stay as they are.)';
        chips.innerHTML = '<button class="vchip warn" data-c="1">Yes, all off</button><button class="vchip" data-c="0">Cancel</button>';
        chips.onclick = (e) => { const b = e.target.closest('.vchip'); if (!b) return; if (b.dataset.c !== '1') return close(); chips.innerHTML = ''; setState('thinking');
          window.HH.allOffAll().then((n) => ok(n ? `Turned off ${n}` : 'Everything was already off'), (er) => fail('That didn’t go through: ' + er.message)); };
        return;
      }
      run(r);
    }, 450);
  }
})();
