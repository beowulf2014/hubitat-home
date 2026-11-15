'use strict';
// First-run setup wizard and "House setup" editor. Talks only to this Worker's /api/setup/* and /api/people.
(() => {
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }
const copyDonate = $('#copyDonate');
if (copyDonate) copyDonate.addEventListener('click', async () => { const a = $('#donateAddr').textContent.trim(); try { await navigator.clipboard.writeText(a); toast('Copied ' + a); } catch { toast('Couldn’t copy. Press and hold the address to copy it.'); } });

// ---------- password-manager ignore (same rule as the app): every field here is not a login ----------
const PM = { autocomplete: 'off', 'data-lpignore': 'true', 'data-1p-ignore': '', 'data-bwignore': '', 'data-form-type': 'other' };
function harden(el) {
  if (!el || !/^(input|select|textarea)$/i.test(el.tagName)) return;
  for (const [k, v] of Object.entries(PM)) el.setAttribute(k, v);
}
const hardenAll = (root = document) => root.querySelectorAll('input,select,textarea').forEach(harden);
new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { harden(n); hardenAll(n); } }))).observe(document.body, { childList: true, subtree: true });
hardenAll();

const KEY = localStorage.getItem('hh_key') || '';
let mode = 'first'; // 'first' (fresh install) or 'edit' (already set up, signed in)
let needsCode = false;
let hubDevices = [];   // from the hub (inferDevice list)
let hubOk = false;
const sel = new Map(); // id -> {on, name, room, kind}
let cfg = { house: 'Home', tz: '', lat: null, lon: null, place: '', units: 'F', thermostatId: null, awayId: null, awayName: 'Away Mode', features: { energy: true, thermoPlan: true, alerts: true, protect: false, voice: true }, rules: [] };

async function call(path, body, method) {
  const headers = { 'content-type': 'application/json' };
  if (KEY) headers['x-key'] = KEY;
  const code = $('#setupCodeIn').value.trim(); if (code) headers['x-setup-code'] = code;
  const r = await fetch(path, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify({ ...body, setupCode: code || undefined }) : undefined, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}

// ---------- steps ----------
let steps = [], cur = 0;
function buildSteps() {
  steps = mode === 'first' ? [...(needsCode ? ['code'] : []), 'hub', 'devices', 'place', 'features', 'alerts', 'finish'] : ['hub', 'devices', 'place', 'features', 'alerts', 'people', 'finish'];
  $('#wSteps').innerHTML = steps.map((s, i) => `<button type="button" data-i="${i}">${i + 1}. ${esc(document.querySelector(`[data-step="${s}"]`).dataset.title)}</button>`).join('');
}
function show(i) {
  cur = Math.max(0, Math.min(steps.length - 1, i));
  document.querySelectorAll('.wstep').forEach((el) => el.classList.toggle('on', el.dataset.step === steps[cur]));
  $('#wSteps').querySelectorAll('button').forEach((b, j) => { b.classList.toggle('on', j === cur); b.classList.toggle('done', j < cur); });
  $('#backBtn').disabled = cur === 0;
  $('#nextBtn').classList.toggle('hidden', cur === steps.length - 1);
  const s = steps[cur];
  if (s === 'devices') renderDevices();
  if (s === 'features') renderFeatures();
  if (s === 'alerts') renderRules();
  if (s === 'people') loadPeople();
  scrollTo({ top: 0, behavior: 'smooth' });
}
function canLeave(s) {
  if (s === 'code' && !$('#setupCodeIn').value.trim()) return 'Enter your setup code.';
  if (s === 'hub' && !hubOk) return 'Test the connection first.';
  if (s === 'devices' && ![...sel.values()].some((v) => v.on) && !$('#thermoPick').value) return 'Pick at least one device.';
  if (s === 'place' && !$('#tzPick').value) return 'Pick a time zone.';
  return null;
}
$('#nextBtn').addEventListener('click', () => { collect(); const why = canLeave(steps[cur]); if (why) return toast(why); show(cur + 1); });
$('#backBtn').addEventListener('click', () => { collect(); show(cur - 1); });
$('#wSteps').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; const i = Number(b.dataset.i); collect();
  for (let k = 0; k < i; k++) { const why = canLeave(steps[k]); if (why) { show(k); return toast(why); } }
  show(i);
});

// ---------- hub ----------
async function testHub() {
  const out = $('#hubResult'); out.className = 'status'; out.textContent = 'Testing…'; $('#testHub').disabled = true;
  try {
    const j = await call('/api/setup/test', { hubUrl: $('#makerLink').value.trim(), hubToken: $('#makerAccess').value.trim() });
    hubDevices = j.devices; hubOk = true;
    out.className = 'status ok'; out.textContent = `✓ Connected to ${j.host}. Found ${j.count} device${j.count === 1 ? '' : 's'} you can use.`;
    mergeDevices();
  } catch (e) { hubOk = false; out.className = 'status err'; out.textContent = e.message; }
  finally { $('#testHub').disabled = false; }
}
$('#testHub').addEventListener('click', testHub);

// ---------- devices ----------
const KIND_LBL = { light: 'Light', fan: 'Fan', plug: 'Plug', switch: 'Switch' };
function mergeDevices() {
  const known = new Map((cfg.devices || []).map((d) => [d.id, d]));
  for (const h of hubDevices) {
    if (h.kind === 'thermostat') continue;
    if (sel.has(h.id)) continue;
    const k = known.get(h.id);
    sel.set(h.id, k ? { on: true, name: k.name, room: k.room, kind: k.kind } : { on: mode === 'first', name: h.label, room: h.room || 'Other', kind: h.kind });
  }
  const thermos = hubDevices.filter((h) => h.kind === 'thermostat');
  $('#thermoPick').innerHTML = '<option value="">None</option>' + thermos.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
  $('#thermoPick').value = cfg.thermostatId && thermos.some((t) => t.id === cfg.thermostatId) ? cfg.thermostatId : (mode === 'first' && thermos.length === 1 ? thermos[0].id : '');
  const sw = hubDevices.filter((h) => h.kind && h.kind !== 'thermostat');
  $('#awayPick').innerHTML = '<option value="">None</option>' + sw.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
  $('#awayPick').value = cfg.awayId && sw.some((t) => t.id === cfg.awayId) ? cfg.awayId : '';
  if (mode === 'first') { const g = sw.find((t) => /\baway\b|\bgone\b/i.test(t.label)); if (g && !cfg.awayId) { $('#awayPick').value = g.id; const s = sel.get(g.id); if (s) s.on = false; } }
  $('#awayLabel').value = cfg.awayName || 'Away Mode';
}
function renderDevices() {
  const f = $('#devFilter').value.trim().toLowerCase();
  roomOptions();
  const list = hubDevices.filter((h) => h.kind && h.kind !== 'thermostat' && (!f || (h.label + ' ' + (sel.get(h.id)?.name || '') + ' ' + (sel.get(h.id)?.room || '')).toLowerCase().includes(f)));
  if (!list.length) { $('#devList').innerHTML = `<p class="muted">${hubDevices.length ? 'No devices match.' : 'Connect your hub first.'}</p>`; return; }
  $('#devList').innerHTML = list.map((h) => {
    const s = sel.get(h.id);
    const kinds = Object.entries(KIND_LBL).map(([k, l]) => `<option value="${k}"${s.kind === k ? ' selected' : ''}>${l}</option>`).join('');
    const meta = [h.type, h.setLevel ? 'dimmer' : '', h.speeds ? 'fan speeds' : '', h.power ? 'watts' : '', h.energy ? 'kWh' : ''].filter(Boolean).join(' · ');
    return `<div class="drow${s.on ? '' : ' off'}" data-id="${h.id}"><input type="checkbox" data-f="on" aria-label="Show ${esc(h.label)}"${s.on ? ' checked' : ''}>
      <div class="dfields"><input class="dname" type="text" data-f="name" value="${esc(s.name)}" maxlength="60" aria-label="Tile name">
      <input type="text" data-f="room" list="roomNames" value="${esc(s.room)}" maxlength="40" aria-label="Room" placeholder="Room">
      <select data-f="kind" aria-label="Kind">${kinds}</select></div><span class="dmeta">#${h.id}${meta ? ' · ' + esc(meta) : ''}</span></div>`;
  }).join('');
}
$('#devList').addEventListener('input', (e) => {
  const row = e.target.closest('.drow'); if (!row) return; const s = sel.get(row.dataset.id); const f = e.target.dataset.f;
  if (f === 'on') { s.on = e.target.checked; row.classList.toggle('off', !s.on); } else if (f) s[f] = e.target.value;
});
function roomOptions() { $('#roomNames').innerHTML = [...new Set([...sel.values()].map((v) => v.room).filter(Boolean))].map((r) => `<option value="${esc(r)}">`).join(''); }
$('#devList').addEventListener('change', (e) => { if (e.target.dataset.f === 'room') roomOptions(); });
$('#devFilter').addEventListener('input', renderDevices);
$('#selAll').addEventListener('click', () => { document.querySelectorAll('#devList .drow').forEach((r) => (sel.get(r.dataset.id).on = true)); renderDevices(); });
$('#selNone').addEventListener('click', () => { document.querySelectorAll('#devList .drow').forEach((r) => (sel.get(r.dataset.id).on = false)); renderDevices(); });

// ---------- place ----------
const COUNTRIES = [['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['AU', 'Australia'], ['NZ', 'New Zealand'], ['IE', 'Ireland'], ['DE', 'Germany'], ['NL', 'Netherlands'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['BE', 'Belgium'], ['CH', 'Switzerland'], ['ZA', 'South Africa'], ['MX', 'Mexico']];
$('#placeCountry').innerHTML = COUNTRIES.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
const phoneTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } })();
let zones = []; try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = [phoneTz, 'UTC']; }
if (!zones.includes(phoneTz)) zones.unshift(phoneTz);
$('#tzPick').innerHTML = zones.map((z) => `<option value="${z}">${z.replace(/_/g, ' ')}</option>`).join('');
function showPlace() {
  $('#placeResult').className = 'status' + (cfg.lat != null ? ' ok' : '');
  $('#placeResult').textContent = cfg.lat != null ? `✓ ${cfg.place || 'Location set'} (${cfg.lat.toFixed(2)}, ${cfg.lon.toFixed(2)})` : 'No location yet (optional, but needed for outdoor temperature).';
}
$('#findPlace').addEventListener('click', async () => {
  $('#placeResult').className = 'status'; $('#placeResult').textContent = 'Looking up…';
  try {
    const j = await call('/api/setup/geo', { q: $('#placeQ').value.trim(), country: $('#placeCountry').value });
    cfg.lat = j.lat; cfg.lon = j.lon; cfg.place = j.place; if (j.tz && zones.includes(j.tz)) $('#tzPick').value = j.tz; showPlace();
  } catch (e) { $('#placeResult').className = 'status err'; $('#placeResult').textContent = e.message; }
});
$('#geoBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('This browser can’t share location.');
  $('#placeResult').className = 'status'; $('#placeResult').textContent = 'Asking for your location…';
  navigator.geolocation.getCurrentPosition((p) => {
    cfg.lat = Math.round(p.coords.latitude * 100) / 100; cfg.lon = Math.round(p.coords.longitude * 100) / 100; cfg.place = 'This phone’s location';
    if (zones.includes(phoneTz)) $('#tzPick').value = phoneTz; showPlace();
  }, (e) => { $('#placeResult').className = 'status err'; $('#placeResult').textContent = 'Location not available: ' + e.message; }, { timeout: 15000, maximumAge: 600000 });
});

// ---------- features ----------
const FEATS = [
  ['energy', 'Energy view', 'Live watts and today / week / month kWh from devices that report power or energy. Uses at most one small storage write a day.'],
  ['thermoPlan', 'Thermostat “Set for tonight”', 'One-time plans: e.g. 70° at 10 PM, back to 76° at 7 AM. Needs a thermostat.'],
  ['alerts', 'Phone alerts', 'Push alerts from your alert rules (next step) and when a thermostat plan runs.'],
  ['voice', 'Voice control', 'A mic button: “turn off the kitchen”, “office fan to high”. Uses your browser’s speech recognition.'],
  ['protect', 'UniFi Protect button', 'A camera button in the header that opens the UniFi Protect app on your phone.'],
];
function renderFeatures() {
  const hasT = !!$('#thermoPick').value;
  $('#featList').innerHTML = FEATS.map(([k, t, d]) => {
    const na = k === 'thermoPlan' && !hasT;
    return `<label class="feat${na ? ' na' : ''}"><input type="checkbox" data-k="${k}"${cfg.features[k] && !na ? ' checked' : ''}${na ? ' disabled' : ''}><span><b>${t}</b><small>${d}${na ? ' (pick a thermostat on the Devices step to use this)' : ''}</small></span></label>`;
  }).join('');
}
$('#featList').addEventListener('change', (e) => { const k = e.target.dataset.k; if (k) cfg.features[k] = e.target.checked; });

// ---------- alert rules ----------
const hr = (h) => new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' });
for (const id of ['#ruleFrom', '#ruleTo']) $(id).innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${hr(h)}</option>`).join('');
$('#ruleFrom').value = '0'; $('#ruleTo').value = '3';
const chosen = () => hubDevices.filter((h) => sel.get(h.id)?.on);
const nameOf = (id) => sel.get(id)?.name || hubDevices.find((h) => h.id === id)?.label || `Device ${id}`;
function renderRules() {
  const ch = chosen();
  $('#ruleDev').innerHTML = ch.length ? ch.map((h) => `<option value="${h.id}">${esc(nameOf(h.id))}</option>`).join('') : '<option value="">Pick devices first</option>';
  cfg.rules = cfg.rules.filter((r) => sel.get(r.deviceId)?.on);
  $('#ruleList').innerHTML = cfg.rules.length ? cfg.rules.map((r, i) => `<div class="rule"><span><b>${esc(nameOf(r.deviceId))}</b><br><small>${r.type === 'leftOn' ? `on for over ${r.minutes} minutes` : `on between ${hr(r.from)} and ${hr(r.to)}`}</small></span><button class="btn sm" type="button" data-del="${i}">Remove</button></div>`).join('') : '<p class="muted">No rules yet.</p>';
  if (!cfg.features.alerts) $('#ruleList').insertAdjacentHTML('afterbegin', '<p class="muted">Phone alerts are turned off on the Features step, so these rules won’t send anything until you turn them on.</p>');
}
$('#ruleType').addEventListener('change', () => { const b = $('#ruleType').value === 'onBetween'; $('#ruleHoursBox').classList.toggle('hidden', !b); $('#ruleMinsBox').classList.toggle('hidden', b); });
$('#ruleAddBtn').addEventListener('click', () => {
  const deviceId = $('#ruleDev').value; if (!deviceId) return toast('Pick a device.');
  if ($('#ruleType').value === 'leftOn') {
    const m = Number($('#ruleMins').value); if (!Number.isInteger(m) || m < 5 || m > 1440) return toast('Minutes must be 5 to 1440.');
    cfg.rules = cfg.rules.filter((r) => !(r.type === 'leftOn' && r.deviceId === deviceId));
    cfg.rules.push({ type: 'leftOn', deviceId, minutes: m });
  } else {
    const from = Number($('#ruleFrom').value), to = Number($('#ruleTo').value); if (from === to) return toast('Pick two different hours.');
    cfg.rules.push({ type: 'onBetween', deviceId, from, to });
  }
  renderRules();
});
$('#ruleList').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (!b) return; cfg.rules.splice(Number(b.dataset.del), 1); renderRules(); });

// ---------- people (edit mode) ----------
async function loadPeople() {
  try {
    const j = await call('/api/people');
    $('#peopleList').innerHTML = j.people.map((p) => `<div class="rule"><span><b>${esc(p.name)}</b>${p.you ? ' <small>(you)</small>' : ''}</span>${p.you ? '' : `<button class="btn sm" type="button" data-rm="${p.id}" data-name="${esc(p.name)}">Remove</button>`}</div>`).join('');
  } catch (e) { $('#peopleList').textContent = e.message; }
}
$('#peopleList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  if (!confirm(`Remove ${b.dataset.name}? Their link will stop working.`)) return;
  try { await call('/api/people/' + b.dataset.rm, null, 'DELETE'); toast('Removed'); loadPeople(); } catch (er) { toast(er.message); }
});
$('#addPerson').addEventListener('click', async () => {
  try {
    const j = await call('/api/people', { name: $('#personLabel').value.trim() });
    $('#personLinkOut').textContent = j.link; $('#personLink').classList.remove('hidden'); $('#personLabel').value = ''; loadPeople();
  } catch (e) { toast(e.message); }
});
const copy = async (txt) => { try { await navigator.clipboard.writeText(txt); toast('Copied'); } catch { toast('Couldn’t copy. Press and hold the link to copy it.'); } };
$('#copyPerson').addEventListener('click', () => copy($('#personLinkOut').textContent));
$('#copyLink').addEventListener('click', () => copy($('#linkOut').textContent));

// ---------- collect + save ----------
function collect() {
  cfg.thermostatId = $('#thermoPick').value || null;
  cfg.awayId = $('#awayPick').value || null;
  cfg.awayName = $('#awayLabel').value.trim() || 'Away Mode';
  cfg.house = $('#houseLabel').value.trim() || 'Home';
  cfg.tz = $('#tzPick').value; cfg.units = $('#unitPick').value;
}
function buildConfig() {
  collect();
  const devices = [];
  if (cfg.thermostatId) devices.push({ id: cfg.thermostatId, name: hubDevices.find((h) => h.id === cfg.thermostatId)?.label || 'Thermostat', room: 'Climate', kind: 'thermostat' });
  const prevT = (cfg.devices || []).find((d) => d.kind === 'thermostat' && d.id === cfg.thermostatId);
  if (prevT && devices[0]) { devices[0].name = prevT.name; devices[0].room = prevT.room; }
  for (const h of hubDevices) { const s = sel.get(h.id); if (s && s.on && h.id !== cfg.awayId) devices.push({ id: h.id, name: s.name.trim() || h.label, room: (s.room || '').trim() || 'Other', kind: s.kind }); }
  const rooms = []; for (const d of devices) if (!rooms.includes(d.room)) rooms.push(d.room);
  return { ...cfg, devices, rooms, features: { ...cfg.features, thermoPlan: cfg.features.thermoPlan && !!cfg.thermostatId } };
}
$('#saveBtn').addEventListener('click', async () => {
  const out = $('#saveResult'); out.className = 'status'; out.textContent = 'Saving…'; $('#saveBtn').disabled = true;
  try {
    const j = await call('/api/setup/save', { hubUrl: $('#makerLink').value.trim(), hubToken: $('#makerAccess').value.trim(), yourName: $('#yourLabel').value.trim(), config: buildConfig() });
    cfg = { ...cfg, ...j.config };
    if (j.link) {
      const k = new URL(j.link).hash.replace(/^#k=/, ''); localStorage.setItem('hh_key', k);
      $('#linkOut').textContent = j.link; $('#openLink').href = j.link; $('#linkBox').classList.remove('hidden');
      out.className = 'status ok'; out.textContent = '✓ All set! Save your private link below.';
      $('#saveBtn').classList.add('hidden'); $('#finFirst').classList.add('hidden'); $('#backBtn').disabled = true; $('#wSteps').classList.add('hidden');
    } else { out.className = 'status ok'; out.textContent = '✓ Saved. Your dashboard will pick up the changes on its next refresh.'; $('#makerAccess').value = ''; }
  } catch (e) { out.className = 'status err'; out.textContent = e.message; }
  finally { $('#saveBtn').disabled = false; }
});

// ---------- boot ----------
(async () => {
  let st = { configured: false, needsCode: false };
  try { st = await (await fetch('/api/setup/status', { cache: 'no-store' })).json(); } catch {}
  needsCode = !!st.needsCode;
  if (st.configured) {
    if (!KEY) { document.body.innerHTML = '<main class="lockmsg"><h2>Already set up</h2><p class="muted">Open the app from your private link, then go to Settings → House setup.</p></main>'; return; }
    mode = 'edit';
    try {
      const j = await call('/api/setup/config');
      cfg = { ...cfg, ...j.config, features: { ...cfg.features, ...j.config.features } };
      $('#hubSaved').classList.remove('hidden'); $('#hubSaved').className = 'status ok';
      $('#hubSaved').textContent = j.hub.connected ? `✓ Connected to ${j.hub.host}. Leave the boxes below empty to keep the current connection.` : 'Hub not connected.';
      if (j.hub.fromEnv) $('#hubSaved').textContent += ' (Set by HUB_BASE / HUB_TOKEN Worker secrets.)';
    } catch (e) { document.body.innerHTML = `<main class="lockmsg"><h2>Can’t open setup</h2><p class="muted">${esc(e.message)}</p></main>`; return; }
    $('#wTitle').textContent = 'House setup'; $('#wSub').textContent = 'Change devices, rooms, location, features, alerts and people.';
    $('#finTitle').textContent = 'Save changes'; $('#finFirst').classList.add('hidden'); $('#saveBtn').textContent = 'Save changes';
    $('#toApp').classList.remove('hidden');
  } else {
    $('#tzPick').value = phoneTz;
  }
  $('#houseLabel').value = cfg.house || 'Home';
  if (cfg.tz) $('#tzPick').value = cfg.tz;
  $('#unitPick').value = cfg.units || 'F';
  showPlace();
  buildSteps(); show(0);
  if (mode === 'edit') testHub();
})();
})();
