'use strict';
(() => {
const $ = (s) => document.querySelector(s);
// House time zone comes from setup (server sends it with every /api/devices); phone zone until then.
let TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
const ICONS = {
  light: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3.5a5.5 5.5 0 0 0-3.3 9.9c.6.5 1 1.2 1 2V16h4.6v-.6c0-.8.4-1.5 1-2A5.5 5.5 0 0 0 12 3.5Z"/><path d="M12 .8v.9M3.6 4.3l.7.6M20.4 4.3l-.7.6M1.5 10h1M21.5 10h1" opacity=".8"/></svg>',
  fan: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><g class="blades"><path d="M12 10.2c-.6-2.6-.3-5.6 1.7-6.9 2.3-1.4 4.7.6 3.7 2.9-.9 2-3 3.3-5.4 4Z"/><path d="M13.6 13c2.5.8 4.8 2.7 4.9 5.1.1 2.7-2.9 3.7-4.3 1.6-1.2-1.8-1.2-4.3-.6-6.7Z"/><path d="M10.4 12.9c-1.9 1.8-4.8 2.9-6.9 1.8-2.4-1.2-1.8-4.3.7-4.5 2.2-.2 4.4.9 6.2 2.7Z"/><circle cx="12" cy="12" r="1.6"/></g></svg>',
  closet: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M6 21V3.5h12V21M4 21h16"/><path d="M6 3.5 13 5v16.5L6 21" /><circle cx="11" cy="13" r=".8" fill="currentColor"/></svg>',
  switch: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><rect x="9.5" y="6" width="5" height="8" rx="1.2"/></svg>',
  plug: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5v4M15 2.5v4M6.5 6.5h11v3a5.5 5.5 0 0 1-11 0v-3ZM12 15v2.5c0 2 1.5 3.5 3.5 3.5h1.5"/></svg>',
};
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const XMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>';

// ---------- no long-press popups (Translate / Touch to Search / selection / context menu) ----------
const isField = (t) => t && t.closest && t.closest('input,textarea,select,[contenteditable="true"]');

// ---------- password-manager ignore (RoboForm / LastPass / 1Password / Bitwarden) ----------
// No real login fields in this app (key arrives via private link → localStorage). Stamp every
// input/textarea/select so PMs don't treat taps as credential entry. Opt out with data-hh-credential.
const PM_ATTRS = {
  autocomplete: 'off',
  'data-lpignore': 'true',
  'data-1p-ignore': '',
  'data-bwignore': '',
  'data-form-type': 'other',
};
function hardenField(el) {
  if (!el || !el.tagName) return;
  const tag = el.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
  if (el.hasAttribute('data-hh-credential')) return; // genuine secret field
  const typ = (el.getAttribute('type') || '').toLowerCase();
  if (typ === 'password' || typ === 'hidden') return;
  // Search boxes should use type=search (PM-friendlier than text)
  if (typ === 'text' && /search|filter|query/i.test((el.id || '') + ' ' + (el.name || '') + ' ' + (el.getAttribute('placeholder') || ''))) {
    el.type = 'search';
  }
  // Rename credential-looking name/id on non-login fields
  for (const attr of ['name', 'id']) {
    const v = el.getAttribute(attr);
    if (!v) continue;
    if (/(^|[_-])(email|user|username|login|password)([_-]|$)/i.test(v) || /^(email|user|username|login|password)$/i.test(v)) {
      el.setAttribute(attr, v.replace(/(email|username|user|login|password)/ig, 'field'));
    }
  }
  for (const [k, val] of Object.entries(PM_ATTRS)) {
    if (k === 'autocomplete') {
      // Don't override a deliberate non-off value on credential fields (already returned above)
      if (!el.hasAttribute('autocomplete') || el.getAttribute('autocomplete') === 'on') el.setAttribute('autocomplete', 'off');
    } else if (val === '') el.setAttribute(k, '');
    else el.setAttribute(k, val);
  }
}
function hardenFields(root = document) {
  root.querySelectorAll?.('input,textarea,select').forEach(hardenField);
  if (root.matches?.('input,textarea,select')) hardenField(root);
}
hardenFields(document);
try {
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach((n) => { if (n.nodeType === 1) hardenFields(n); });
      else if (m.type === 'attributes' && m.target) hardenField(m.target);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['name', 'id', 'type'] });
} catch {}

for (const ev of ['contextmenu', 'selectstart', 'dragstart']) document.addEventListener(ev, (e) => { if (!isField(e.target)) e.preventDefault(); }, { capture: true });
document.addEventListener('selectionchange', () => { const s = getSelection(); if (s && s.rangeCount && !isField(document.activeElement)) s.removeAllRanges(); });
document.querySelectorAll('img').forEach((i) => i.setAttribute('draggable', 'false'));

// ---------- key ----------
const hp = new URLSearchParams(location.hash.slice(1));
if (hp.get('k')) localStorage.setItem('hh_key', hp.get('k'));
const KEY = localStorage.getItem('hh_key') || '';
if (KEY) $('#manifest').href = '/api/manifest?k=' + encodeURIComponent(KEY);

let data = null, room = 'Favorites', pending = {}, devSheetId = null, editing = false, thermoPlan = null;
const FAV = 'Favorites';
const rooms = () => [FAV, 'All', ...(data ? data.rooms : [])];
const findAny = (id) => data && data.devices.find((d) => d.id === id);
const STAR = '<svg viewBox="0 0 24 24"><path d="m12 3.2 2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.5l-5.4 2.9 1.2-5.9L3.4 9.4l6-.7L12 3.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
// ---------- favorites (per person, saved server-side; localStorage for instant load) ----------
let favs = (() => { try { const v = JSON.parse(localStorage.getItem('hh_favs') || 'null'); return Array.isArray(v) ? v.filter((id) => !String(id).startsWith('cam:')) : []; } catch { return []; } })();
const isFav = (id) => favs.includes(id);
function saveFavs() {
  localStorage.setItem('hh_favs', JSON.stringify(favs));
  if (editing) return; // written once on Done
  clearTimeout(saveFavs.t);
  saveFavs.dirty = true;
  saveFavs.t = setTimeout(() => {
    const sent = JSON.stringify(favs);
    api('/api/favorites', { method: 'PUT', body: JSON.stringify({ favorites: favs }) }).then((r) => {
      // Only adopt the server's cleaned list if nothing changed while the request was in flight.
      if (JSON.stringify(favs) === sent) { saveFavs.dirty = false; if (Array.isArray(r.favorites) && JSON.stringify(r.favorites) !== sent) { favs = r.favorites; localStorage.setItem('hh_favs', JSON.stringify(favs)); render(); } }
    }).catch(() => { toast('Couldn’t save favorites. Will retry.'); setTimeout(saveFavs, 5000); });
  }, 300);
}
async function syncFavs() {
  try {
    const r = await api('/api/favorites');
    if (saveFavs.dirty) return; // a local change is being saved; it wins
    if (Array.isArray(r.favorites)) { favs = r.favorites.filter((id) => !String(id).startsWith('cam:')); localStorage.setItem('hh_favs', JSON.stringify(favs)); }
    else if (favs.length) saveFavs(); // nothing on the server yet: upload this phone's list
    render();
  } catch {}
}
function toggleFav(id, { viaLongPress = false } = {}) {
  const d = data && data.devices.find((x) => x.id === id); if (!d) return;
  if (isFav(id)) { favs = favs.filter((x) => x !== id); toast(`Removed ${d.name} from Favorites`); }
  else { favs = [...favs, id]; toast(`Added ${d.name} to Favorites`); }
  if (navigator.vibrate) navigator.vibrate(viaLongPress ? 25 : 8);
  saveFavs(); render();
}
// ---------- layouts (per person; order / size / hidden per tab). Saved to the server only on Done. ----------
let layout = (() => { try { const v = JSON.parse(localStorage.getItem('hh_layout') || 'null'); return v && typeof v === 'object' && v.tabs ? v : { tabs: {} }; } catch { return { tabs: {} }; } })();
let layoutSaved = JSON.stringify(layout), favsAtEdit = null, showHidden = false;
const tabLayout = (tab) => layout.tabs[tab] || {};
const editTab = (tab) => (layout.tabs[tab] = layout.tabs[tab] || {});
const sizeOf = (d, tab = room) => { const s = (tabLayout(tab).sizes || {})[d.id]; if (d.kind === 'thermostat') return s === 'w' ? 'w' : 'l'; return s || 's'; };
const isHidden = (id, tab = room) => (tabLayout(tab).hidden || []).includes(id);
function saveLayoutLocal() { localStorage.setItem('hh_layout', JSON.stringify(layout)); }
async function syncLayout() {
  try {
    const r = await api('/api/layout');
    if (editing) return; // don't clobber an edit in progress
    if (r.layout && r.layout.tabs) { layout = r.layout; if (layout.tabs && layout.tabs.Cameras) delete layout.tabs.Cameras; layoutSaved = JSON.stringify(layout); saveLayoutLocal(); render(); }
    else if (Object.keys(layout.tabs).length) { layoutSaved = '{}'; persistLayout(); } // first run: upload this phone's copy
  } catch {}
}
// One KV write, only when something changed.
function persistLayout() {
  clearTimeout(persistLayout.t);
  persistLayout.t = setTimeout(async () => {
    if (layout.tabs && layout.tabs.Cameras) delete layout.tabs.Cameras;
    for (const [t, v] of Object.entries(layout.tabs)) { // prune empty bits so a no-op edit sends nothing
      if (v.order && !v.order.length) delete v.order; if (v.hidden && !v.hidden.length) delete v.hidden; if (v.sizes && !Object.keys(v.sizes).length) delete v.sizes;
      if (!Object.keys(v).length) delete layout.tabs[t];
    }
    const body = JSON.stringify(layout); if (body === layoutSaved) return;
    try { const r = await api('/api/layout', { method: 'PUT', body: JSON.stringify({ layout }) }); if (r.layout && JSON.stringify(layout) === body) { layout = r.layout; saveLayoutLocal(); } layoutSaved = JSON.stringify(r.layout || layout); }
    catch (e) { toast('Couldn’t save your layout: ' + e.message, 3500); }
  }, 400);
}
function enterEdit() {
  if (editing || !data) return;
  editing = true; showHidden = false; favsAtEdit = JSON.stringify(favs);
  if (navigator.vibrate) navigator.vibrate(15);
  document.body.classList.add('editing-mode'); render();
}
function exitEdit() {
  if (!editing) return;
  editing = false; showHidden = false; document.body.classList.remove('editing-mode');
  saveLayoutLocal(); persistLayout();
  if (JSON.stringify(favs) !== favsAtEdit) saveFavs();
  favsAtEdit = null; render();
}
function moveFav(id, delta) {
  const i = favs.indexOf(id), j = i + delta; if (i < 0 || j < 0 || j >= favs.length) return;
  const f = [...favs]; [f[i], f[j]] = [f[j], f[i]]; favs = f; saveFavs(); render();
}

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'x-key': KEY, 'content-type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) { locked = true; showLock(); throw new Error('unauthorized'); } // stop polling with a dead key
  const j = await r.json().catch(() => ({}));
  if (r.status === 409 && j.setup) { const e = new Error('not set up'); e.setup = true; throw e; }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
function showLock() { $('#lock').classList.remove('hidden'); }
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }
function houseHour() { return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date())); }
const isOn = (d) => (d.id in pending ? pending[d.id].on : d.on);
const curSpeed = (d) => (d.id in pending && pending[d.id].speed) || d.speed;

// ---------- load ----------
// Fresh install with no key yet: send the owner to the setup wizard.
async function checkSetup() {
  if (checkSetup.done) return; checkSetup.done = true;
  try { const r = await fetch('/api/setup/status', { cache: 'no-store' }); const j = await r.json(); if (!j.configured) location.replace('/setup'); } catch {}
}
let loading = false;
let locked = false;
async function load({ manual = false } = {}) {
  if (!KEY) { checkSetup(); return showLock(); }
  if (locked) return;
  if (loading) return; loading = true;
  const dot = $('#hubDot'); dot.classList.add('blink');
  try {
    const j = await api('/api/devices');
    const now = Date.now();
    for (const id in pending) { const d = j.devices.find((x) => x.id === id) || (j.away && j.away.id === id ? j.away : null); if (!d || (d.on === pending[id].on && (!pending[id].speed || d.speed === pending[id].speed)) || now - pending[id].t > 8000) delete pending[id]; }
    data = j; if (j.house && j.house.tz) TZ = j.house.tz; applyFeatures(); if ('thermoPlan' in j) thermoPlan = j.thermoPlan; reconcileThermo(); dot.classList.remove('err'); render();
    if (manual) toast('Up to date');
  } catch (e) { if (e.setup) { location.replace('/setup'); return; } dot.classList.add('err'); if (e.message !== 'unauthorized') { $('#summary').textContent = 'Can’t reach the hub right now'; if (manual) toast('Hub not reachable: ' + e.message); } }
  finally { setTimeout(() => dot.classList.remove('blink'), 400); loading = false; }
}

// ---------- render ----------
function renderChips() {
  const el = $('#chips');
  if (el.childElementCount !== rooms().length) {
    el.innerHTML = rooms().map((r) => `<button class="chip" data-room="${r}">${r === FAV ? '★ Favorites' : r}</button>`).join('');
  }
  el.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.room === room));
}
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l18 18M10.6 5.6A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.3 4M6.6 6.6C3.7 8.4 2 12 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.3-1M9.9 9.9a2.8 2.8 0 0 0 4.2 4.2"/></svg>';
const SIZE_LBL = { s: 'S', w: 'Wide', l: 'Large' };
function editCtl(d) {
  if (!editing) return `<button class="star" data-act="star" aria-label="Favorite">${STAR}</button>`;
  const hid = isHidden(d.id);
  return `<span class="editctl"><button class="ec sz" data-act="size" aria-label="Tile size">${SIZE_LBL[sizeOf(d)]}</button><button class="ec eye" data-act="hide" aria-label="${hid ? 'Show tile' : 'Hide tile'}">${hid ? EYE_OFF : EYE}</button>${room === FAV ? '<button class="ec rm" data-act="remove" aria-label="Remove from Favorites">✕</button>' : ''}</span>`;
}

// ---------- thermostat ----------
const T_RANGE = { cool: [60, 99], heat: [55, 90] }, T_DEADBAND = 3, DIAL_MIN = 50, DIAL_MAX = 100;
let tPend = {}, tTimer = null, tPollTimers = [];
const THERMO_ICON = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0Z"/><path d="M12 10v5.5"/></svg>';
function thermoDev() { return data && data.devices.find((d) => d.kind === 'thermostat'); }
function tState(d = thermoDev()) {
  if (!d || !d.thermo) return null;
  const t = { ...d.thermo };
  for (const k of ['mode', 'fan', 'cool', 'heat']) if (k in tPend) t[{ mode: 'mode', fan: 'fanMode', cool: 'coolingSetpoint', heat: 'heatingSetpoint' }[k]] = tPend[k];
  return t;
}
function reconcileThermo() {
  const d = thermoDev(); if (!d || !d.thermo) return;
  if (tPend.t && Date.now() - tPend.t > 45000) { tPend = {}; return; }
  const m = { mode: d.thermo.mode, fan: d.thermo.fanMode, cool: d.thermo.coolingSetpoint, heat: d.thermo.heatingSetpoint };
  for (const k of ['mode', 'fan', 'cool', 'heat']) if (k in tPend && !tPend.sending && tPend.sent && m[k] === tPend[k]) delete tPend[k];
  if (!['mode', 'fan', 'cool', 'heat'].some((k) => k in tPend)) tPend = {};
}
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
// Queue a change; several taps within ~1.2s become one request.
function thermoChange(ch) {
  const t = tState(); if (!t) return;
  const next = { mode: t.mode, cool: t.coolingSetpoint, heat: t.heatingSetpoint };
  Object.assign(tPend, { t: Date.now(), sent: false });
  const dirty = tPend.dirty || (tPend.dirty = {});
  const before = { heat: tPend.heat, cool: tPend.cool };
  if (ch.mode) { tPend.mode = ch.mode; dirty.mode = 1; }
  if (ch.fan) { tPend.fan = ch.fan; dirty.fan = 1; }
  let raising = false;
  if (ch.cool !== undefined) { tPend.cool = clamp(ch.cool, T_RANGE.cool); if ((tPend.mode || next.mode) === 'auto' && next.heat != null && tPend.cool < (('heat' in tPend ? tPend.heat : next.heat) + T_DEADBAND)) tPend.heat = clamp(tPend.cool - T_DEADBAND, T_RANGE.heat); }
  if (ch.heat !== undefined) { tPend.heat = clamp(ch.heat, T_RANGE.heat); const c = 'cool' in tPend ? tPend.cool : next.cool; if ((tPend.mode || next.mode) === 'auto' && c != null && c < tPend.heat + T_DEADBAND) { tPend.cool = clamp(tPend.heat + T_DEADBAND, T_RANGE.cool); raising = true; } }
  if (raising) tPend.raising = true;
  if (ch.cool !== undefined || ('cool' in tPend && tPend.cool !== before.cool)) dirty.cool = 1;
  if (ch.heat !== undefined || ('heat' in tPend && tPend.heat !== before.heat)) dirty.heat = 1;
  render();
  clearTimeout(tTimer); tTimer = setTimeout(sendThermo, ch.now ? 0 : 1200);
}
async function sendThermo() {
  const d = thermoDev(); if (!d) return;
  // Send only what changed since the last send (the overlay keeps showing earlier values until the hub catches up).
  const dirty = tPend.dirty || {}; const body = {};
  for (const k of ['mode', 'fan', 'cool', 'heat']) if (dirty[k] && k in tPend) body[k] = tPend[k];
  tPend.dirty = {};
  if (!Object.keys(body).length) return;
  if (tPend.raising) body.raising = true;
  tPend.sending = true;
  try { await api(`/api/thermostat/${d.id}`, { method: 'POST', body: JSON.stringify(body) }); tPend.sent = true; tPend.sending = false; tPend.t = Date.now(); delete tPend.raising; pollThermoSoon(); }
  catch (e) { tPend = {}; render(); toast('Thermostat didn’t take that: ' + e.message, 3500); pollThermoSoon(); }
}
// Some thermostat clouds lag: re-read just the thermostat at ~5s and ~20s, then back to normal refresh.
function pollThermoSoon() {
  tPollTimers.forEach(clearTimeout);
  tPollTimers = [5000, 20000].map((ms) => setTimeout(async () => {
    try { const d = thermoDev(); const r = await api(`/api/thermostat/${d.id}`); if (r.thermo) { d.thermo = r.thermo; d.on = r.thermo.mode !== 'off'; reconcileThermo(); render(); } } catch {}
  }, ms));
}
const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : '');
// Odometer: each digit is a 0-9 column slid into place, so a change rolls instead of jumping. data-v holds the plain value.
function roll(el, str) {
  if (!el || el.dataset.v === str) return;
  const old = el.dataset.v; el.dataset.v = str; el.setAttribute('aria-label', str);
  const chars = [...str];
  if (old == null || [...old].length !== chars.length || chars.some((c, i) => /\d/.test(c) !== /\d/.test(old[i]))) {
    el.innerHTML = chars.map((c) => (/\d/.test(c) ? `<span class="od" aria-hidden="true"><span class="odc">${'0123456789'.split('').map((n) => `<span>${n}</span>`).join('')}</span></span>` : `<span class="odx" aria-hidden="true">${c}</span>`)).join('');
    const from = old && /\d/.test(old) ? old : null;
    el.querySelectorAll('.od').forEach((o, i) => { o.firstChild.style.transition = 'none'; o.firstChild.style.transform = `translateY(-${from ? 0 : 0}em)`; });
    void el.offsetWidth; el.querySelectorAll('.od .odc').forEach((c) => (c.style.transition = ''));
  }
  const digits = chars.filter((c) => /\d/.test(c));
  el.querySelectorAll('.od .odc').forEach((c, i) => (c.style.transform = `translateY(-${digits[i]}em)`));
}
// Indoor-temperature color: blue at 60°F, teal around 72°F, orange at 85°F.
function tempColor(f) {
  const stops = [[60, [58, 160, 255]], [72, [63, 214, 196]], [85, [255, 140, 50]]];
  const x = Math.max(60, Math.min(85, f)); let i = x <= 72 ? 0 : 1; const [a, ca] = stops[i], [b, cb] = stops[i + 1]; const k = (x - a) / (b - a);
  return `rgb(${ca.map((v, j) => Math.round(v + (cb[j] - v) * k)).join(',')})`;
}
// Sunrise/sunset for the house location from setup (SunCalc-style NOAA approximation, good to a minute or two).
function sunTimes(ms, lat, lng) {
  const rad = Math.PI / 180, day = 864e5, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009, e = rad * 23.4397;
  const d = ms / day - 0.5 + J1970 - J2000, lw = rad * -lng, phi = rad * lat;
  const n = Math.round(d - J0 - lw / (2 * Math.PI)), ds = J0 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds), C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI, dec = Math.asin(Math.sin(e) * Math.sin(L));
  const Jt = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const w = Math.acos((Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  const a = J0 + (w + lw) / (2 * Math.PI) + n, Js = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L), Jr = Jt - (Js - Jt);
  const ms_ = (j) => (j + 0.5 - J1970) * day; return { rise: ms_(Jr), set: ms_(Js) };
}
function isDaylight(ms = Date.now()) {
  const h = data && data.house;
  if (!h || h.lat == null || h.lon == null) { const hr = houseHour(); return hr >= 7 && hr < 19; } // no location: rough guess
  const s = sunTimes(ms, h.lat, h.lon); if (!isFinite(s.rise) || !isFinite(s.set)) return true; return ms >= s.rise && ms < s.set;
}
function thermoHTML(d) {
  const ctl = editCtl(d);
  const seg = (name, opts) => `<div class="tseg" data-seg="${name}">${opts.map(([v, l]) => `<button class="sg" data-act="t-${name}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const sp = (k, label) => `<div class="tsp" data-sp="${k}"><button class="tsl" data-act="t-menu" aria-label="Change mode and fan">${label}<span class="tchev" aria-hidden="true">▾</span></button><button class="tbtn" data-act="t-step" data-k="${k}" data-d="-1" aria-label="${label} down">−</button><b class="tsv">–</b><button class="tbtn" data-act="t-step" data-k="${k}" data-d="1" aria-label="${label} up">+</button></div>`;
  return `<div class="tile tcard sz-${sizeOf(d)}${editing ? ' editing' : ''}${editing && isHidden(d.id) ? ' is-hidden' : ''}" data-id="${d.id}">${ctl}
    <div class="thead"><span class="tico">${THERMO_ICON}</span><span class="name">${d.name}</span><button class="tbadge" data-act="t-menu" aria-label="Change mode and fan"><span class="tbtxt"></span><span class="tchev" aria-hidden="true">▾</span></button></div>
    <div class="tbody">
      <div class="dial">
        <svg viewBox="0 0 200 200" class="dsvg"><defs><linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#3aa0ff"/><stop offset="1" stop-color="#3fd6c4"/></linearGradient><linearGradient id="th" x1="0" x2="1"><stop offset="0" stop-color="#f5a524"/><stop offset="1" stop-color="#ff6b3d"/></linearGradient></defs>
          <circle class="dtrack" cx="100" cy="100" r="84"/><circle class="dsp heatarc" cx="100" cy="100" r="84"/><circle class="dsp coolarc" cx="100" cy="100" r="84"/><circle class="dnow" r="7" cx="100" cy="16"/></svg>
        <div class="frost"></div><div class="glow"></div><div class="air"><i></i><i></i><i></i><i></i></div>
        <div class="fx" aria-hidden="true"><i style="left:14%;animation-delay:-0.3s;--dx:6px;--sz:4px"></i><i style="left:27%;animation-delay:-2.1s;--dx:-5px;--sz:3px"></i><i style="left:39%;animation-delay:-1.2s;--dx:4px;--sz:5px"></i><i style="left:52%;animation-delay:-3.0s;--dx:-6px;--sz:3px"></i><i style="left:63%;animation-delay:-0.8s;--dx:5px;--sz:4px"></i><i style="left:74%;animation-delay:-2.6s;--dx:-4px;--sz:3px"></i><i style="left:84%;animation-delay:-1.7s;--dx:6px;--sz:4px"></i><i style="left:46%;animation-delay:-3.6s;--dx:-3px;--sz:3px"></i></div>
        <div class="dcenter"><div class="dtemp">–</div><div class="dsub">Indoor</div><div class="dset"></div></div>
      </div>
      <div class="tside">
        <div class="tstate"><span class="tdot"></span><span class="tstxt">–</span></div>
        <div class="tstats"><span class="srow"><svg class="hdrop" viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="hdclip"><path d="M12 2.6C9.2 6.8 5.6 10.4 5.6 14.6a6.4 6.4 0 0 0 12.8 0C18.4 10.4 14.8 6.8 12 2.6Z"/></clipPath></defs><g clip-path="url(#hdclip)"><rect x="0" y="0" width="24" height="24" fill="rgba(58,160,255,.10)"/><g class="hwater"><path class="hwave" d="M-24 0 q3 -1.4 6 0 q3 1.4 6 0 q3 -1.4 6 0 q3 1.4 6 0 q3 -1.4 6 0 q3 1.4 6 0 q3 -1.4 6 0 q3 1.4 6 0 q3 -1.4 6 0 q3 1.4 6 0 V30 H-24Z"/></g></g><path d="M12 2.6C9.2 6.8 5.6 10.4 5.6 14.6a6.4 6.4 0 0 0 12.8 0C18.4 10.4 14.8 6.8 12 2.6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg> <b class="thum">–</b></span><span class="srow"><span class="sky" aria-hidden="true"><svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" fill="#ffc94a"/><g class="rays" stroke="#ffc94a" stroke-width="1.7" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g></svg><svg class="moon" viewBox="0 0 24 24"><path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5Z" fill="#cfd8ff"/><path class="twk" d="M19 4.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5Z" fill="#fff"/></svg></span> <b class="tout">–</b> outside</span><span class="srow cfanrow"><svg class="cfan" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.4"/><g class="blades" fill="currentColor"><path d="M12 12C11 8.8 11.4 5.6 13.6 5.3c1.9-.2 2 2.4-1.6 6.7Z"/><path d="M12 12C11 8.8 11.4 5.6 13.6 5.3c1.9-.2 2 2.4-1.6 6.7Z" transform="rotate(120 12 12)"/><path d="M12 12C11 8.8 11.4 5.6 13.6 5.3c1.9-.2 2 2.4-1.6 6.7Z" transform="rotate(240 12 12)"/></g><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg> <b class="cfs">Off</b> outdoor unit</span></div>
        <div class="comp hidden"><span>Compressor <b class="cpct"></b></span><div class="cbar"><i></i></div></div>
        <div class="thold"></div>
      </div>
    </div>
    <div class="tsps">${sp('heat', 'Heat')}${sp('cool', 'Cool')}</div>
    <div class="tlabel">Mode</div>${seg('mode', [['off', 'Off'], ['cool', 'Cool'], ['heat', 'Heat'], ['auto', 'Auto']])}
    <div class="tlabel">Fan</div>${seg('fan', [['auto', 'Auto'], ['on', 'On'], ['circulate', 'Circulate']])}
    <div class="tplanbox"></div>
  </div>`;
}
const angleFor = (temp) => (Math.max(DIAL_MIN, Math.min(DIAL_MAX, temp)) - DIAL_MIN) / (DIAL_MAX - DIAL_MIN);
function updateThermo(d) {
  const el = document.querySelector(`.tcard[data-id="${d.id}"]`); if (!el) return;
  const t = tState(d); if (!t) { el.querySelector('.tstxt').textContent = 'Not reachable'; return; }
  const mode = t.mode || 'off', op = (t.operatingState || 'idle').toLowerCase();
  const stateKey = mode === 'off' ? 'off' : op.includes('cool') ? 'cooling' : op.includes('heat') ? 'heating' : op.includes('fan') ? 'fan' : 'idle';
  el.dataset.mode = mode; el.dataset.state = stateKey;
  el.classList.toggle('tpending', Object.keys(tPend).some((k) => ['mode', 'fan', 'cool', 'heat'].includes(k)));
  roll(el.querySelector('.dtemp'), t.temperature != null ? Math.round(t.temperature) + '°' : '–');
  if (t.temperature != null) el.style.setProperty('--tc', tempColor(t.temperature));
  const hum = Number(t.humidity); el.querySelector('.hwater').style.transform = `translateY(${(21.1 - (isFinite(hum) ? Math.max(0, Math.min(100, hum)) : 0) / 100 * 18.6).toFixed(2)}px)`;
  el.dataset.sky = isDaylight() ? 'day' : 'night';
  const set = mode === 'cool' ? `Cool to ${t.coolingSetpoint}°` : mode === 'heat' ? `Heat to ${t.heatingSetpoint}°` : mode === 'auto' ? `${t.heatingSetpoint}°–${t.coolingSetpoint}°` : 'Off';
  el.querySelector('.dset').textContent = set;
  el.querySelector('.tbadge .tbtxt').textContent = cap(mode); el.querySelector('.tbadge').dataset.mode = mode;
  el.querySelector('.tstxt').textContent = { cooling: 'Cooling', heating: 'Heating', fan: 'Fan only', idle: 'Idle', off: 'System off' }[stateKey];
  el.querySelector('.thum').textContent = t.humidity != null ? Math.round(t.humidity) + '%' : '–';
  el.querySelector('.tout').textContent = t.outdoorTemperature != null ? Math.round(t.outdoorTemperature) + '°' : '–';
  el.querySelector('.thold').textContent = t.holdStatus ? t.holdStatus : '';
  const cs = Number(t.compressorSpeed) || 0; const comp = el.querySelector('.comp');
  el.querySelector('.cfanrow').classList.toggle('hidden', t.compressorSpeed == null);
  { const pct = cs <= 1 ? Math.round(cs * 100) : Math.round(Math.min(100, cs)); el.classList.toggle('cfan-on', pct > 0); el.querySelector('.cfs').textContent = pct > 0 ? pct + '%' : 'Off';
    if (pct > 0) el.style.setProperty('--cfan-dur', (2.6 - 2.3 * pct / 100).toFixed(2) + 's'); }
  comp.classList.toggle('hidden', !(cs > 0)); if (cs > 0) { const pct = cs <= 1 ? Math.round(cs * 100) : Math.round(cs); comp.querySelector('.cpct').textContent = pct + '%'; comp.querySelector('.cbar i').style.width = Math.min(100, pct) + '%'; el.style.setProperty('--comp-dur', (2.4 - Math.min(100, pct) / 60).toFixed(2) + 's'); }
  // dial: arcs from the bottom-left (start) around to the setpoint; dot = current temp
  const C = 2 * Math.PI * 84, SWEEP = 0.75;
  const arc = (cls, temp, show) => { const a = el.querySelector(cls); a.style.strokeDasharray = `${C * SWEEP * angleFor(temp ?? DIAL_MIN)} ${C}`; a.style.opacity = show ? 1 : 0; };
  arc('.coolarc', t.coolingSetpoint, mode === 'cool' || mode === 'auto');
  arc('.heatarc', t.heatingSetpoint, mode === 'heat' || mode === 'auto');
  const ang = (135 + 270 * angleFor(t.temperature ?? DIAL_MIN)) * Math.PI / 180;
  const dot = el.querySelector('.dnow'); dot.setAttribute('cx', (100 + 84 * Math.cos(ang)).toFixed(1)); dot.setAttribute('cy', (100 + 84 * Math.sin(ang)).toFixed(1));
  // setpoint rows
  el.querySelector('.tsp[data-sp="cool"]').classList.toggle('hidden', !(mode === 'cool' || mode === 'auto'));
  el.querySelector('.tsp[data-sp="heat"]').classList.toggle('hidden', !(mode === 'heat' || mode === 'auto'));
  roll(el.querySelector('.tsp[data-sp="cool"] .tsv'), (t.coolingSetpoint ?? '–') + '°');
  roll(el.querySelector('.tsp[data-sp="heat"] .tsv'), (t.heatingSetpoint ?? '–') + '°');
  el.querySelectorAll('[data-seg="mode"] .sg').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
  el.querySelectorAll('[data-seg="fan"] .sg').forEach((b) => b.classList.toggle('on', b.dataset.v === t.fanMode));
  syncThermoMenu();
  updatePlanBanner(el);
}

function tileHTML(d) {
  if (d.kind === 'thermostat') return thermoHTML(d);
  const ctl = editCtl(d);
  const ring = d.watchMins ? `<svg class="ring" viewBox="0 0 60 60"><circle class="bg" cx="30" cy="30" r="27"/><circle class="fg" cx="30" cy="30" r="27" stroke-dasharray="169.6" stroke-dashoffset="169.6"/></svg>` : '';
  const sub = room === FAV ? `<span class="room">${d.room}</span>` : '';
  const LBL = { low: 'Low', medium: 'Med', high: 'High' };
  const seg = d.speeds ? `<span class="seg" role="group" aria-label="Fan speed">${d.speeds.map((sp) => `<button class="sg" data-act="speed" data-speed="${sp}">${LBL[sp] || sp}</button>`).join('')}</span>` : '';
  return `<div class="tile ${d.kind} sz-${sizeOf(d)}${editing ? ' editing' : ''}${editing && isHidden(d.id) ? ' is-hidden' : ''}" role="button" tabindex="0" data-id="${d.id}"><span class="shine"></span>${ctl}<span class="ico">${ring}${ICONS[d.kind]}</span><span class="name">${d.name}</span>${sub}<span class="stline"><span class="state"></span><span class="pwr" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13.5 2.5 5 13.5h6l-1.5 8 8.5-11h-6l1.5-8Z" fill="currentColor"/></svg><b class="pv"></b></span></span>${seg}${d.speeds ? '' : '<span class="mark"></span>'}</div>`;
}
// Tiles for the current tab: default order, then the saved order (new devices appended), minus hidden ones.
function baseList(tab = room) {
  if (tab === FAV) return favs.map((id) => findAny(id)).filter(Boolean);
  if (tab === 'All') return data.devices;
  return data.devices.filter((d) => d.room === tab);
}
function viewList(tab = room) {
  let list = baseList(tab); const L = tabLayout(tab);
  const custom = tab !== FAV && Array.isArray(L.order) && L.order.length > 0;
  if (custom) { const pos = new Map(L.order.map((id, i) => [id, i])); list = [...list].sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e6 + list.indexOf(a)) - (pos.has(b.id) ? pos.get(b.id) : 1e6 + list.indexOf(b))); }
  const hiddenCount = list.filter((d) => isHidden(d.id, tab)).length;
  if (!(editing && showHidden)) list = list.filter((d) => !isHidden(d.id, tab));
  return { list, hiddenCount, custom };
}
const viewSig = (list) => [room, editing, showHidden, JSON.stringify(tabLayout(room).sizes || {}), JSON.stringify(tabLayout(room).hidden || []), list.map((d) => d.id).join(',')].join('|');
function render() {
  if (!data) return;
  renderChips();
  const grid = $('#grid');
  const { list, hiddenCount, custom } = viewList();
  const sig = viewSig(list);
  $('#editBtn').classList.toggle('done', editing); $('#editBtn').setAttribute('aria-label', editing ? 'Done editing' : 'Edit layout');
  if (grid.dataset.sig !== sig && !dragging) {
    let html = '';
    if (editing) html += `<div class="editbar"><span>Drag to move · tap S/Wide/Large to resize</span><div class="row">${hiddenCount ? `<button class="btn sm" data-act="showhidden">${showHidden ? 'Hide hidden' : `Show hidden (${hiddenCount})`}</button>` : ''}<button class="btn sm" data-act="resettab">Reset this tab</button><button class="btn sm primary" data-act="done">Done</button></div></div>`;
    if (room === FAV && !list.length) {
      html += `<div class="empty"><div class="emptystar">${STAR}</div><h3>No favorites yet</h3><p>Tap the ☆ on any device in All or a room to add it here.</p><button class="btn primary" data-act="goall">Go to All</button></div>`;
    } else if (room === FAV && !editing) {
      html += `<div class="favbar"><span>${list.length} favorite${list.length === 1 ? '' : 's'}${hiddenCount ? ` · ${hiddenCount} hidden` : ''}</span></div>` + list.map(tileHTML).join('');
    } else if (room === 'All' && !custom && !editing) { let last = ''; for (const d of list) { if (d.room !== last) { html += `<div class="roomhead">${d.room}</div>`; last = d.room; } html += tileHTML(d); } }
    else html += list.map(tileHTML).join('');
    grid.innerHTML = html; grid.dataset.sig = sig;
  }
  list.forEach(updateTile);
  // summary + title
  const lightsOn = data.devices.filter((d) => d.kind === 'light' && isOn(d)).length;
  const scope = room === 'All' ? data.devices : list;
  const anyOn = scope.filter(isOn).length;
  $('#viewTitle').textContent = room === 'All' ? 'Home' : room;
  document.querySelectorAll('#grid .tile').forEach((t) => { const st = t.querySelector('.star'); if (st) { const f = isFav(t.dataset.id); st.classList.toggle('on', f); st.setAttribute('aria-pressed', String(f)); } });
  const out = data.house && data.house.outdoor != null && !thermoDev() ? ` · ${Math.round(data.house.outdoor)}° outside` : '';
  $('#summary').textContent = (room === 'All' ? `${lightsOn} light${lightsOn === 1 ? '' : 's'} on` : `${anyOn} of ${list.length} on`) + out;
  if (data.away) {
    const away = { ...data.away, on: data.away.id in pending ? pending[data.away.id].on : data.away.on };
    $('#awayBtn').classList.toggle('on', away.on); $('#awayBtn').setAttribute('aria-pressed', String(away.on));
    $('#awayName').textContent = data.away.name || 'Away Mode';
    $('#awaySub').textContent = away.on ? 'On' : 'Off';
  }
  if (devSheetId) updateDevSheet();
  if (!$('#energySheet').classList.contains('hidden')) drawEnergySheet();
}
// Devices with a "left on" alert rule show a timer ring that fills up to the rule's minutes.
function closetInfo(d) {
  if (!d.watchMins || !isOn(d)) return null;
  const since = d.onSince || (pending[d.id] && pending[d.id].t) || Date.now();
  const ms = Math.max(0, Date.now() - since), limit = d.watchMins * 60000;
  return { ms, limit, mins: Math.floor(ms / 60000), frac: Math.min(1, ms / limit) };
}
// "On between hours" alert rules mark the tile while it's inside the window.
function lateRule(d) {
  if (!data || !data.rules) return null;
  const h = houseHour();
  return data.rules.find((r) => r.type === 'onBetween' && r.deviceId === d.id && (r.from < r.to ? h >= r.from && h < r.to : h >= r.from || h < r.to)) || null;
}
// Show or hide optional parts of the screen based on the features chosen in setup.
function applyFeatures() {
  const f = (data && data.features) || {};
  $('#energyBtn').classList.toggle('hidden', !f.energy);
  $('#camsBtn').classList.toggle('hidden', !f.protect);
  $('#awayBtn').classList.toggle('hidden', !(data && data.away));
  document.body.classList.toggle('no-voice', f.voice === false);
  document.body.classList.toggle('no-plan', !f.thermoPlan);
}
const fmtW = (w) => (w < 1000 ? Math.round(w) + ' W' : (w / 1000).toFixed(1) + ' kW');
function updateTile(d) {
  if (d.kind === 'thermostat') return updateThermo(d);
  const t = document.querySelector(`.tile[data-id="${d.id}"]`); if (!t) return;
  const on = isOn(d);
  const was = t.classList.contains('on');
  t.classList.toggle('on', on);
  t.classList.toggle('pending', d.id in pending && pending[d.id].busy);
  if (on && !was && t.dataset.init) { t.classList.remove('shimmer'); void t.offsetWidth; t.classList.add('shimmer'); setTimeout(() => t.classList.remove('shimmer'), 750); }
  t.dataset.init = '1';
  let state = on ? 'ON' : 'OFF';
  const ci = closetInfo(d);
  const ring = t.querySelector('.ring .fg');
  if (ring) ring.style.strokeDashoffset = String(169.6 * (1 - (ci ? ci.frac : 0)));
  t.classList.toggle('overdue', !!ci && ci.ms >= ci.limit);
  if (ci) state = ci.mins < 1 ? 'ON · just now' : `ON · ${ci.mins} min`;
  const late = on && !!lateRule(d);
  t.classList.toggle('late', late);
  if (late) state = 'ON · late';
  if (d.speeds) {
    const sp = curSpeed(d);
    t.querySelectorAll('.sg').forEach((b) => { const a = on && b.dataset.speed === sp; b.classList.toggle('on', a); b.setAttribute('aria-pressed', String(a)); });
    for (const k of d.speeds) t.classList.toggle('spd-' + k, on && sp === k);
    if (on && d.speeds.includes(sp)) state = 'ON · ' + ({ low: 'Low', medium: 'Medium', high: 'High' }[sp] || sp);
  }
  t.querySelector('.state').textContent = state;
  const pw = t.querySelector('.pwr');
  if (pw) { const w = on && typeof d.power === 'number' && d.power > 0.5 ? d.power : 0; pw.classList.toggle('show', w > 0); if (w > 0) { roll(pw.querySelector('.pv'), fmtW(w)); pw.setAttribute('aria-label', fmtW(w)); } }
  const mk = t.querySelector('.mark'); if (mk) mk.innerHTML = on ? CHECK : XMARK;
}

// ---------- actions ----------
async function setDevice(id, on, { quiet = false } = {}) {
  pending[id] = { on, t: Date.now(), busy: true }; render();
  try { await api(`/api/device/${id}/${on ? 'on' : 'off'}`, { method: 'POST' }); pending[id].busy = false; render(); }
  catch (e) { delete pending[id]; render(); if (!quiet) toast('Couldn’t reach that device: ' + e.message); throw e; }
}
async function setSpeed(id, speed) {
  if (navigator.vibrate) navigator.vibrate(8);
  pending[id] = { on: true, speed, t: Date.now(), busy: true }; render();
  try { await api(`/api/device/${id}/speed/${speed}`, { method: 'POST' }); pending[id].busy = false; render(); refreshSoon(); }
  catch (e) { delete pending[id]; render(); toast('Couldn’t set fan speed: ' + e.message); }
}
function refreshSoon() { clearTimeout(refreshSoon.a); clearTimeout(refreshSoon.b); refreshSoon.a = setTimeout(load, 1500); refreshSoon.b = setTimeout(load, 4500); }
let suppressClick = false;
$('#grid').addEventListener('click', (e) => {
  if (!data) return;
  const act = e.target.closest('[data-act]'); const t = e.target.closest('.tile');
  if (suppressClick) { suppressClick = false; return; }
  if (act) {
    const a = act.dataset.act;
    if (a === 'goall') return goRoom('All');
    if (a === 'done') return exitEdit();
    if (a === 'showhidden') { showHidden = !showHidden; return render(); }
    if (a === 'resettab') { if (confirm(`Reset the ${room} tab to its default layout? (Favorites stay favorited.)`)) { delete layout.tabs[room]; saveLayoutLocal(); render(); toast(`${room} reset`); } return; }
    if (!t) return;
    if (editing && a === 'size') { const d = findAny(t.dataset.id); if (!d) return; const opts = d.kind === 'thermostat' ? ['w', 'l'] : ['s', 'w', 'l']; const cur = sizeOf(d); const next = opts[(opts.indexOf(cur) + 1) % opts.length]; const L = editTab(room); L.sizes = { ...(L.sizes || {}), [d.id]: next }; saveLayoutLocal(); return flipRender(); }
    if (editing && a === 'hide') { const L = editTab(room); const h = new Set(L.hidden || []); h.has(t.dataset.id) ? h.delete(t.dataset.id) : h.add(t.dataset.id); L.hidden = [...h]; saveLayoutLocal(); return flipRender(); }
    if (editing && a !== 'remove') return; // device controls are inert while editing
    if (a === 'star') return toggleFav(t.dataset.id);
    if (a === 'speed') return setSpeed(t.dataset.id, act.dataset.speed);
    if (a === 't-menu') return openThermoMenu();
    if (a === 't-plan') return openPlanSheet();
    if (a === 't-plan-cancel') { e.stopPropagation(); return cancelPlan(); }
    if (a === 't-mode') return thermoChange({ mode: act.dataset.v });
    if (a === 't-fan') return thermoChange({ fan: act.dataset.v });
    if (a === 't-step') { const st = tState(); const k = act.dataset.k; const cur = k === 'cool' ? st.coolingSetpoint : st.heatingSetpoint; if (navigator.vibrate) navigator.vibrate(6); return thermoChange({ [k]: (cur ?? 72) + Number(act.dataset.d) }); }
    if (a === 'up') return moveFav(t.dataset.id, -1);
    if (a === 'down') return moveFav(t.dataset.id, 1);
    if (a === 'remove') { favs = favs.filter((x) => x !== t.dataset.id); saveFavs(); return flipRender(); }
    return;
  }
  if (editing || !t || t.classList.contains('tcard')) return;
  const d = data.devices.find((x) => x.id === t.dataset.id); if (!d) return;
  if (navigator.vibrate) navigator.vibrate(8);
  setDevice(d.id, !isOn(d)).then(refreshSoon, () => {});
});
$('#awayBtn').addEventListener('click', () => { if (!data || !data.away) return; const on = !(data.away.id in pending ? pending[data.away.id].on : data.away.on); setDevice(data.away.id, on).then(() => { toast(`${data.away.name || 'Away Mode'} ${on ? 'on' : 'off'}`); refreshSoon(); }, () => {}); });
// ---------- long-press to edit, drag to reorder (pointer events, FLIP reflow, edge auto-scroll) ----------
let dragging = false;
function flipRender(mutate) {
  const grid = $('#grid'); const before = new Map([...grid.querySelectorAll('.tile')].map((el) => [el.dataset.id, el.getBoundingClientRect()]));
  if (mutate) mutate(); else render();
  flipFrom(before);
}
function flipFrom(before, skip) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const el of document.querySelectorAll('#grid .tile')) {
    if (el === skip) continue; const b = before.get(el.dataset.id); if (!b) continue; const a = el.getBoundingClientRect();
    const dx = b.left - a.left, dy = b.top - a.top; if (!dx && !dy) continue;
    el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}
(() => {
  const grid = $('#grid');
  let lp = null, x0 = 0, y0 = 0, cand = null, ghost = null, ph = null, offX = 0, offY = 0, lastX = 0, lastY = 0, raf = 0, holdT = null;
  const cancelLp = () => { clearTimeout(lp); lp = null; };
  grid.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.tile'); if (!t || e.button > 0) return;
    x0 = e.clientX; y0 = e.clientY;
    if (!editing) { // long-press anywhere on a tile (not its buttons) -> edit mode
      if (e.target.closest('[data-act]')) return;
      cancelLp(); lp = setTimeout(() => { lp = null; suppressClick = true; setTimeout(() => { suppressClick = false; }, 900); enterEdit(); }, 500);
      return;
    }
    if (e.target.closest('[data-act]')) return;
    // In edit mode: a short still hold (touch) or a small move (mouse) starts a drag; moving first = scroll.
    cand = { t, id: t.dataset.id, pid: e.pointerId, type: e.pointerType };
    clearTimeout(holdT); if (e.pointerType !== 'mouse') holdT = setTimeout(() => { if (cand) startDrag(e.clientX, e.clientY); }, 160);
  });
  grid.addEventListener('pointermove', (e) => {
    if (lp && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancelLp();
    if (cand && !dragging) {
      const dist = Math.hypot(e.clientX - x0, e.clientY - y0);
      if (cand.type === 'mouse' && dist > 5) startDrag(e.clientX, e.clientY);
      else if (cand.type !== 'mouse' && dist > 10) { clearTimeout(holdT); cand = null; } // it's a scroll
    }
  });
  const endAll = () => { cancelLp(); clearTimeout(holdT); if (!dragging) cand = null; };
  for (const ev of ['pointerup', 'pointercancel']) grid.addEventListener(ev, endAll);
  addEventListener('scroll', cancelLp, { passive: true });
  // While dragging, stop the page from scrolling under the finger (and pull-to-refresh).
  document.addEventListener('touchmove', (e) => { if (dragging) e.preventDefault(); }, { passive: false });

  function startDrag(x, y) {
    if (!cand || dragging) return;
    const t = cand.t; const r = t.getBoundingClientRect();
    dragging = true; document.body.classList.add('dragging'); if (navigator.vibrate) navigator.vibrate(10);
    offX = x - r.left; offY = y - r.top; lastX = x; lastY = y;
    ghost = t.cloneNode(true); ghost.classList.add('ghost'); ghost.classList.remove('editing');
    Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px' });
    document.body.appendChild(ghost); ph = t; ph.classList.add('placeholder');
    addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
    raf = requestAnimationFrame(tick);
  }
  function onMove(e) { lastX = e.clientX; lastY = e.clientY; }
  function tick() {
    if (!dragging) return;
    ghost.style.left = (lastX - offX) + 'px'; ghost.style.top = (lastY - offY) + 'px';
    const edge = 90, h = innerHeight; let v = 0;
    if (lastY < edge) v = -Math.ceil((edge - lastY) / 6); else if (lastY > h - edge) v = Math.ceil((lastY - (h - edge)) / 6);
    if (v) scrollBy(0, v);
    // hit-test the tile under the finger and move the placeholder there
    ghost.style.display = 'none'; const under = document.elementFromPoint(lastX, lastY); ghost.style.display = '';
    const over = under && under.closest('#grid .tile');
    if (over && over !== ph) {
      const r = over.getBoundingClientRect(); const tiles = [...grid.querySelectorAll('.tile')];
      const after = tiles.indexOf(over) > tiles.indexOf(ph) ? (lastY > r.top + r.height * 0.25 || lastX > r.left + r.width * 0.5) : !(lastY < r.top + r.height * 0.75 && lastX < r.left + r.width * 0.5);
      const before = new Map(tiles.map((el) => [el.dataset.id, el.getBoundingClientRect()]));
      if (after) over.after(ph); else over.before(ph);
      flipFrom(before, ph);
    }
    raf = requestAnimationFrame(tick);
  }
  function onUp() {
    removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
    cancelAnimationFrame(raf);
    const r = ph.getBoundingClientRect(); const g = ghost;
    const fin = () => { g.remove(); ph.classList.remove('placeholder'); dragging = false; document.body.classList.remove('dragging'); commitOrder(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) fin();
    else { g.animate([{ left: g.style.left, top: g.style.top }, { left: r.left + 'px', top: r.top + 'px' }], { duration: 160, easing: 'ease-out' }).onfinish = fin; }
    cand = null; suppressClick = true; setTimeout(() => { suppressClick = false; }, 300);
  }
  function commitOrder() {
    const ids = [...grid.querySelectorAll('.tile')].map((el) => el.dataset.id);
    const order = [...ids, ...baseList().map((d) => d.id).filter((id) => !ids.includes(id))]; // hidden/offscreen ones keep a place at the end
    if (room === FAV) { favs = order.filter((id) => favs.includes(id)); localStorage.setItem('hh_favs', JSON.stringify(favs)); }
    else { editTab(room).order = order; saveLayoutLocal(); }
    $('#grid').dataset.sig = viewSig(viewList().list); // DOM already matches; no rebuild
  }
})();
$('#editBtn').addEventListener('click', () => { if (editing) exitEdit(); }); // header Done (only shown in edit mode)
$('#resetAll').addEventListener('click', () => {
  if (!confirm('Reset every tab to its default layout (order, sizes and hidden tiles)? Favorites stay favorited.')) return;
  layout = { tabs: {} }; saveLayoutLocal(); persistLayout(); render(); toast('All layouts reset');
});
$('#grid').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('tile')) { e.preventDefault(); e.target.click(); } });
function goRoom(name) {
  if (name === room) return;
  const c = document.querySelector(`.chip[data-room="${CSS.escape(name)}"]`);
  const list = rooms();
  const dir = list.indexOf(name) > list.indexOf(room) ? 'left' : 'right';
  const grid = $('#grid'); grid.classList.add('out-' + dir);
  setTimeout(() => {
    room = name; showHidden = false; grid.classList.remove('out-' + dir); grid.classList.add('in-' + dir); render();
    if (c) c.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    requestAnimationFrame(() => requestAnimationFrame(() => grid.classList.remove('in-' + dir)));
  }, 170);
}
$('#chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) goRoom(c.dataset.room); });
// All Off: lights and fans in the current view (plugs and Away Mode are left alone). Tap twice to confirm.
const allOff = $('#allOff');
allOff.addEventListener('click', async () => {
  if (!data) return;
  if (!allOff.classList.contains('confirm')) {
    allOff.classList.add('confirm'); $('#allOffText').textContent = room === 'All' ? 'Tap again: all lights & fans off' : `Tap again: ${room} off`;
    clearTimeout(allOff.t); allOff.t = setTimeout(() => { allOff.classList.remove('confirm'); $('#allOffText').textContent = 'All Off'; }, 3500); return;
  }
  clearTimeout(allOff.t); allOff.classList.remove('confirm'); $('#allOffText').textContent = 'All Off';
  const targets = [...document.querySelectorAll('#grid .tile.on:not(.editing):not(.is-hidden)')].map((t) => data.devices.find((d) => d.id === t.dataset.id)).filter((d) => d && d.kind !== 'plug');
  if (!targets.length) return toast('Nothing to turn off here');
  let fails = 0; const jobs = [];
  targets.forEach((d, i) => setTimeout(() => { const t = document.querySelector(`.tile[data-id="${d.id}"]`); if (t) t.classList.add('sweep'); jobs.push(setDevice(d.id, false, { quiet: true }).catch(() => fails++)); }, i * 110));
  setTimeout(async () => { await Promise.all(jobs); toast(fails ? `${fails} device(s) didn’t respond` : `Turned off ${targets.length}`); refreshSoon(); }, targets.length * 110 + 50);
});

// ---------- pull to refresh ----------
(() => {
  let y0 = null, dy = 0; const ptr = $('#ptr'), main = $('main');
  addEventListener('touchstart', (e) => { if (scrollY <= 0 && !editing && !document.querySelector('.sheet:not(.hidden)')) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  addEventListener('touchmove', (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); const p = Math.min(dy, 110);
    main.style.transition = 'none'; main.style.transform = `translateY(${p * 0.45}px)`; ptr.style.transform = `translate(-50%, ${Math.min(0, -60 + p)}px)`; $('#ptrText').textContent = dy > 80 ? 'Release to refresh' : 'Pull to refresh'; }, { passive: true });
  addEventListener('touchend', async () => { if (y0 == null) return; y0 = null; main.style.transition = ''; main.style.transform = '';
    if (dy > 80) { ptr.classList.add('refreshing'); ptr.style.transform = 'translate(-50%,0)'; $('#ptrText').textContent = 'Checking your hub…'; await load({ manual: true }); await new Promise((r) => setTimeout(r, 500)); ptr.classList.remove('refreshing'); }
    ptr.style.transform = ''; });
})();

// ---------- sheets ----------
// ---------- energy (device watts + kWh usage) ----------
let usage = null, enTimer = null, evPeriod = 'today';
const readKwhRate = () => { const v = localStorage.getItem('hh_kwh_rate'); if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const writeKwhRate = (n) => { if (n == null || n === '') localStorage.removeItem('hh_kwh_rate'); else localStorage.setItem('hh_kwh_rate', String(n)); };
const fmtKwh = (k) => { if (k == null || !isFinite(k)) return '–'; const a = Math.abs(k); if (a === 0) return '0 kWh'; if (a < 0.01) return k.toFixed(3) + ' kWh'; if (a < 10) return k.toFixed(2) + ' kWh'; return (Math.round(k * 10) / 10) + ' kWh'; };
const fmtCost = (kwh, rate) => { if (rate == null || kwh == null || !isFinite(kwh) || !isFinite(rate)) return null; const c = kwh * rate; if (c > 0 && c < 0.01) return '< $0.01'; return '$' + c.toFixed(2); };
const fmtMd = (s) => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
async function loadEnergy() {
  if (!data || !data.features || !data.features.energy) return;
  try { const r = await api('/api/energy'); usage = r && r.usage ? r.usage : usage; } catch { /* keep last */ }
  drawEnergy();
}
function enPoll() { clearInterval(enTimer); enTimer = null; if (document.visibilityState === 'visible') { loadEnergy(); enTimer = setInterval(loadEnergy, 60000); } }
document.addEventListener('visibilitychange', enPoll);
function drawEnergy() {
  const b = $('#energyBtn'); if (!b) return;
  b.classList.add('evonly'); b.setAttribute('aria-label', 'Energy');
  if (!$('#energySheet').classList.contains('hidden')) drawEnergySheet();
}
function liveNow() {
  if (!data) return (usage && usage.live) || { totalW: 0, reporting: 0, devices: [] };
  const list = data.devices.filter((d) => d.kind !== 'thermostat' && typeof d.power === 'number')
    .map((d) => ({ id: d.id, name: d.name, room: d.room, watts: d.power, on: !!d.on }))
    .sort((a, b) => b.watts - a.watts || a.name.localeCompare(b.name));
  return { totalW: Math.round(list.reduce((s, x) => s + Math.max(0, x.watts), 0) * 10) / 10, reporting: list.length, devices: list.filter((x) => x.watts > 0.5) };
}
function evRows(items, kind, rate) {
  if (!items.length) return `<div class="evempty">${kind === 'live' ? 'Nothing drawing power right now.' : 'No usage recorded for this period yet.'}</div>`;
  const max = Math.max(...items.map((x) => (kind === 'live' ? x.watts : x.kwh)), 0.001);
  return items.map((x) => {
    const val = kind === 'live' ? fmtW(x.watts) : fmtKwh(x.kwh);
    const cost = kind !== 'live' && rate != null ? `<span class="evcost">${fmtCost(x.kwh, rate)}</span>` : '';
    const width = Math.max(4, ((kind === 'live' ? x.watts : x.kwh) / max) * 100);
    return `<div class="evrow"><i class="evbar" style="width:${width.toFixed(1)}%"></i><span class="evname"><b>${x.name}</b><small>${x.room}</small></span><span class="evval">${val}${cost}</span></div>`;
  }).join('');
}
function periodNote(p, key) {
  const bits = [];
  if (key === 'today') bits.push('From the first time the app opened today, house time.');
  if (key === 'week') bits.push('This week is Sunday–Saturday, house time.');
  if (key === 'month') bits.push('This calendar month, house time.');
  if (p && p.partial && p.since) bits.push(`History starts ${fmtMd(p.since)}, so this total is partial.`);
  bits.push('kWh totals come from devices that report an energy (kWh) reading. Devices that only report watts appear under Live now.');
  return bits.join(' ');
}
function drawEnergySheet() {
  const live = liveNow();
  const rate = readKwhRate();
  $('#evWatts').textContent = fmtW(live.totalW);
  $('#evWattsSub').textContent = live.reporting ? `${live.devices.length} drawing · ${live.reporting} report watts` : 'no devices reporting watts';
  $('#evLiveList').innerHTML = evRows(live.devices, 'live');

  document.querySelectorAll('#evPeriod .sg').forEach((b) => b.classList.toggle('on', b.dataset.period === evPeriod));
  const p = usage && usage.periods && usage.periods[evPeriod];
  $('#evKwh').textContent = p ? fmtKwh(p.kwh) : '–';
  const costEl = $('#evCost');
  const cost = p && rate != null ? fmtCost(p.kwh, rate) : null;
  costEl.classList.toggle('hidden', !cost);
  costEl.textContent = cost ? `est. ${cost}` : '';
  $('#evNote').textContent = periodNote(p, evPeriod);
  const rows = p ? p.devices.filter((d) => d.kwh > 0.0005) : [];
  $('#evPeriodList').innerHTML = evRows(rows, 'kwh', rate);
}
$('#energyBtn').addEventListener('click', () => { closeSheets(); drawEnergySheet(); openSheet('#energySheet'); loadEnergy(); });
$('#enClose').addEventListener('click', closeSheets);
$('#evPeriod').addEventListener('click', (e) => { const b = e.target.closest('[data-period]'); if (!b) return; evPeriod = b.dataset.period; drawEnergySheet(); });

// ---------- one-time thermostat plan (times in the house time zone) ----------
const TP_TEMP = [60, 85];
let tpForm = { t1: 72, t2: 78, m1: 'cool', m2: 'cool' };
function tpParts(ms = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), time: `${p.hour}:${p.minute}` };
}
function tzShort(ms = Date.now()) { try { const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' }).formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName'); return p ? p.value : ''; } catch { return ''; } }
function tpAddDays(s, n) { const [y, m, d] = s.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d + n)); return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`; }
function tpWallToUtc(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number); const [hh, mm] = timeStr.split(':').map(Number);
  const wanted = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const asWall = (ms) => { const p = tpParts(ms); return Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), p.hour, p.minute, 0); };
  return wanted - (asWall(wanted) - wanted);
}
function tpNext(timeStr, afterMs) {
  const p = tpParts(afterMs); let at = tpWallToUtc(p.date, timeStr);
  return at >= afterMs ? at : tpWallToUtc(tpAddDays(p.date, 1), timeStr);
}
function tpDayLabel(timeStr, afterMs) {
  if (!timeStr) return '';
  const at = tpNext(timeStr, afterMs);
  const d = tpParts(at).date, today = tpParts(afterMs).date;
  const z = tzShort(at);
  if (d === today) return (tpParts(at).hour < 12 ? 'this morning, ' : 'tonight, ') + z;
  if (d === tpAddDays(today, 1)) return (tpParts(at).hour < 12 ? 'tomorrow morning, ' : 'tomorrow, ') + z;
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(at)) + ', ' + z;
}
function tpDefaults() {
  const now = Date.now(), p = tpParts(now);
  let t1 = '22:00', at1 = tpWallToUtc(p.date, t1);
  if (at1 < now + 15 * 60 * 1000) {
    const q = tpParts(now + 30 * 60 * 1000);
    let h = q.hour, m = Math.ceil(q.minute / 15) * 15, date = q.date;
    if (m >= 60) { h += 1; m -= 60; } if (h >= 24) { h -= 24; date = tpAddDays(date, 1); }
    t1 = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; at1 = tpWallToUtc(date, t1);
  }
  const t2 = '07:00';
  return { t1, t2 };
}
function updatePlanBanner(el) {
  const box = el && el.querySelector('.tplanbox'); if (!box) return;
  if (editing || !(data && data.features && data.features.thermoPlan)) { box.innerHTML = ''; return; }
  if (thermoPlan && thermoPlan.summary) {
    box.innerHTML = `<div class="tplan"><span class="tplan-txt"><b>Temporary plan</b>${thermoPlan.summary}</span><button class="btn sm" type="button" data-act="t-plan-cancel">Cancel</button></div>`;
  } else {
    box.innerHTML = `<button class="tplan-set" type="button" data-act="t-plan">Set for tonight</button>`;
  }
}
function syncPlanDays() {
  const t1 = $('#tpTime1').value || '22:00';
  $('#tpDay1').textContent = tpDayLabel(t1, Date.now());
  const at1 = tpNext(t1, Date.now());
  $('#tpDay2').textContent = tpDayLabel($('#tpTime2').value || '07:00', at1 + 1000);
}
function clampTp(n) { return Math.max(TP_TEMP[0], Math.min(TP_TEMP[1], n)); }
function showTpTemps() { $('#tpTemp1Show').textContent = tpForm.t1 + '°'; $('#tpTemp2Show').textContent = tpForm.t2 + '°'; }
function syncTpModes() {
  document.querySelectorAll('.tpmodes .sg').forEach((b) => {
    const n = b.dataset.n; const want = n === '2' ? tpForm.m2 : tpForm.m1;
    b.classList.toggle('on', b.dataset.tpMode === want);
  });
}
function tempForMode(st, mode) {
  const v = mode === 'heat' ? (st && st.heatingSetpoint) : (st && st.coolingSetpoint);
  return clampTp(typeof v === 'number' ? v : (mode === 'heat' ? 70 : 72));
}
function openPlanSheet() {
  if (editing) return;
  const t = tState(); const mode = (t && t.mode) || 'off';
  const defMode = (mode === 'heat' || mode === 'cool') ? mode : 'cool';
  tpForm.m1 = defMode; tpForm.m2 = defMode;
  tpForm.t1 = tempForMode(t, defMode);
  tpForm.t2 = tempForMode(t, defMode);
  const dft = tpDefaults();
  $('#tpTime1').value = dft.t1; $('#tpTime2').value = dft.t2;
  $('#tpBackOn').checked = true; $('#tpStep2').classList.remove('hidden');
  $('#tpErr').textContent = '';
  $('#tpSave').disabled = false;
  showTpTemps(); syncTpModes(); syncPlanDays();
  closeSheets(); openSheet('#planSheet');
}
async function cancelPlan() {
  try {
    await api('/api/thermo-plan', { method: 'DELETE' });
    thermoPlan = null; render(); toast('Plan cancelled');
  } catch (e) { toast('Couldn’t cancel the plan: ' + e.message); }
}
function openThermoMenu() {
  if (editing) return;
  const t = tState(); if (!t) return toast('Thermostat isn’t reachable right now');
  const mode = t.mode || 'off', fan = t.fanMode || 'auto';
  const opts = (name, list, cur) => list.map(([v, l]) => `<button class="sg${v === cur ? ' on' : ''}" data-act="t-${name}" data-v="${v}">${l}</button>`).join('');
  $('#tmMode').innerHTML = opts('mode', [['off', 'Off'], ['cool', 'Cool'], ['heat', 'Heat'], ['auto', 'Auto']], mode);
  $('#tmFan').innerHTML = opts('fan', [['auto', 'Auto'], ['on', 'On'], ['circulate', 'Circulate']], fan);
  closeSheets(); openSheet('#thermoSheet');
}
function syncThermoMenu() {
  if ($('#thermoSheet').classList.contains('hidden')) return;
  const t = tState(); if (!t) return;
  document.querySelectorAll('#tmMode .sg').forEach((b) => b.classList.toggle('on', b.dataset.v === (t.mode || 'off')));
  document.querySelectorAll('#tmFan .sg').forEach((b) => b.classList.toggle('on', b.dataset.v === (t.fanMode || 'auto')));
}
$('#tmClose').addEventListener('click', closeSheets);
$('#tpClose').addEventListener('click', closeSheets);
$('#tpBackOn').addEventListener('change', () => $('#tpStep2').classList.toggle('hidden', !$('#tpBackOn').checked));
$('#tpTime1').addEventListener('input', syncPlanDays);
$('#tpTime2').addEventListener('input', syncPlanDays);
$('#planSheet').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tp-mode]'); if (!b) return;
  const n = b.dataset.n, mode = b.dataset.tpMode;
  if (n === '1') { tpForm.m1 = mode; tpForm.t1 = tempForMode(tState(), mode); }
  else { tpForm.m2 = mode; tpForm.t2 = tempForMode(tState(), mode); }
  showTpTemps(); syncTpModes();
});
function bumpTp(which, d) { tpForm[which] = clampTp(tpForm[which] + d); showTpTemps(); }
$('#tpT1dn').addEventListener('click', () => bumpTp('t1', -1));
$('#tpT1up').addEventListener('click', () => bumpTp('t1', 1));
$('#tpT2dn').addEventListener('click', () => bumpTp('t2', -1));
$('#tpT2up').addEventListener('click', () => bumpTp('t2', 1));
$('#tpSave').addEventListener('click', async () => {
  const time1 = $('#tpTime1').value; if (!time1) { $('#tpErr').textContent = 'Pick a time for tonight.'; return; }
  const steps = [{ temp: tpForm.t1, time: time1, mode: tpForm.m1 }];
  if ($('#tpBackOn').checked) {
    const time2 = $('#tpTime2').value; if (!time2) { $('#tpErr').textContent = 'Pick a time to return to.'; return; }
    steps.push({ temp: tpForm.t2, time: time2, mode: tpForm.m2 });
  }
  $('#tpSave').disabled = true; $('#tpErr').textContent = '';
  try {
    const r = await api('/api/thermo-plan', { method: 'POST', body: JSON.stringify({ steps }) });
    thermoPlan = r.plan; closeSheets(); render(); toast(r.plan && r.plan.summary ? r.plan.summary : 'Plan set');
  } catch (e) { $('#tpErr').textContent = e.message || 'Couldn’t save the plan'; }
  finally { $('#tpSave').disabled = false; }
});
$('#thermoSheet').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 't-mode') { thermoChange({ mode: b.dataset.v, now: true }); syncThermoMenu(); }
  else if (a === 't-fan') { thermoChange({ fan: b.dataset.v, now: true }); syncThermoMenu(); }
});

function openSheet(id) { $('#sheetBg').classList.remove('hidden'); $(id).classList.remove('hidden'); }
function closeSheets() { $('#sheetBg').classList.add('hidden'); document.querySelectorAll('.sheet').forEach((s) => s.classList.add('hidden')); devSheetId = null; }
$('#sheetBg').addEventListener('click', closeSheets); $('#closeSettings').addEventListener('click', closeSheets); $('#devClose').addEventListener('click', closeSheets);

function openDevice(id) {
  devSheetId = String(id); openSheet('#devSheet'); updateDevSheet();
  const t = document.querySelector(`.tile[data-id="${id}"]`); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('focus'); setTimeout(() => t.classList.remove('focus'), 2600); }
}
function updateDevSheet() {
  if (!data) { $('#devName').textContent = 'Loading…'; return; }
  const d = data.devices.find((x) => x.id === devSheetId); if (!d) return;
  const on = isOn(d), ci = closetInfo(d);
  $('#devIco').innerHTML = ICONS[d.kind]; $('#devIco').style.color = on ? 'var(--amber)' : 'var(--muted)';
  $('#devName').textContent = d.name;
  $('#devState').textContent = on ? (ci ? `On for ${ci.mins} minutes` : 'On') : 'Off';
  const b = $('#devToggle'); b.textContent = on ? 'Turn Off' : 'Turn On'; b.classList.toggle('off', !on);
}
$('#devToggle').addEventListener('click', () => { const d = data && data.devices.find((x) => x.id === devSheetId); if (!d) return; const on = !isOn(d);
  setDevice(d.id, on).then(() => { toast(`${d.name} ${on ? 'on' : 'off'}`); refreshSoon(); if (!on) setTimeout(closeSheets, 600); }, () => {}); });

// ---------- settings / alerts ----------
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
async function swReg() { return navigator.serviceWorker ? navigator.serviceWorker.ready : null; }
async function alertState() {
  const st = $('#alertStatus');
  $('#iosHint').classList.toggle('hidden', !(isIOS && !standalone));
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { st.textContent = isIOS && !standalone ? 'Add this app to your Home Screen to turn on alerts.' : 'This browser doesn’t support push alerts.'; $('#enableAlerts').disabled = true; return; }
  const reg = await swReg(); const sub = reg && (await reg.pushManager.getSubscription());
  if (Notification.permission === 'denied') { st.textContent = 'Notifications are blocked for this app in your phone settings.'; return; }
  st.innerHTML = sub ? '✅ Alerts are on for this phone.' : 'Alerts are off on this phone.';
  $('#enableAlerts').textContent = sub ? 'Re-register alerts' : 'Enable alerts';
}
$('#enableAlerts').addEventListener('click', async () => {
  try {
    const perm = await Notification.requestPermission(); if (perm !== 'granted') { toast('Notifications weren’t allowed'); return alertState(); }
    const reg = await swReg(); const { publicKey } = await api('/api/vapid');
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((publicKey.length + 3) % 4)), (c) => c.charCodeAt(0));
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('/api/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    toast('Alerts enabled'); alertState();
  } catch (e) { toast('Couldn’t enable alerts: ' + e.message, 4000); }
});
$('#testAlert').addEventListener('click', async () => {
  try { const r = await api('/api/test-push', { method: 'POST' });
    if (!r.subscriptions) toast('No phones signed up yet. Tap Enable alerts first.', 3500);
    else { const ok = r.results.filter((x) => x.status >= 200 && x.status < 300).length; toast(`Test alert sent to ${ok} of ${r.subscriptions} device(s)`); }
  } catch (e) { toast('Test failed: ' + e.message); }
});

// ---------- UniFi Protect (native app deep link; no in-app streaming) ----------
const PROTECT_APPSTORE = 'https://apps.apple.com/app/unifi-protect/id1392492235';
const PROTECT_PKG = 'com.ubnt.unifi.protect';
// Protect 3.9.0 AndroidManifest (base.apk): AuthenticationActivity is BROWSABLE for
// scheme=unifi-protect host=deeplink_v1 (VIEW). Chrome adds BROWSABLE to intent: URLs, so
// MAIN/LAUNCHER-only intents miss and fall through to Play — use the deeplink host.
const PROTECT_ANDROID = 'intent://deeplink_v1#Intent;scheme=unifi-protect;package=' + PROTECT_PKG + ';end';
// iOS: CFBundleURLSchemes unifi-protect://
const PROTECT_IOS = 'unifi-protect://';
function protectPlatform() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return 'ios';
  return 'other';
}
function protectHref(platform = protectPlatform()) {
  if (platform === 'android') return PROTECT_ANDROID;
  if (platform === 'ios') return PROTECT_IOS;
  return PROTECT_APPSTORE;
}
function openUniFiProtect(e) {
  const platform = protectPlatform();
  // Android: real <a href="intent://…"> must navigate (Chrome user-gesture).
  if (platform === 'android') return;
  if (e) e.preventDefault();
  if (platform === 'ios') {
    const t0 = Date.now();
    const onHide = () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onHide); };
    document.addEventListener('visibilitychange', onHide);
    location.href = PROTECT_IOS;
    const timer = setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (document.visibilityState === 'visible' && Date.now() - t0 < 2500) location.href = PROTECT_APPSTORE;
    }, 1200);
    return;
  }
  location.href = PROTECT_APPSTORE;
}

const camsBtn = $('#camsBtn');
if (camsBtn) {
  camsBtn.setAttribute('href', protectHref());
  camsBtn.addEventListener('click', openUniFiProtect);
}
$('#kwhRate').addEventListener('input', () => {
  const raw = $('#kwhRate').value.trim();
  if (raw === '') writeKwhRate(null);
  else { const n = Number(raw); if (!Number.isFinite(n) || n < 0) return; writeKwhRate(n); }
  if (!$('#energySheet').classList.contains('hidden')) drawEnergySheet();
});
function describeRules() {
  const rules = (data && data.rules) || [];
  if (!rules.length) return 'No alert rules yet. Open House setup → Alerts to add some (for example “closet light left on 30 minutes”).';
  const nm = (id) => (findAny(id) || {}).name || 'A device';
  const hr = (h) => new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' });
  return rules.map((r) => (r.type === 'leftOn' ? `${nm(r.deviceId)} on over ${r.minutes} min` : `${nm(r.deviceId)} on between ${hr(r.from)} and ${hr(r.to)}`)).join(' · ') + '. Thermostat plan changes also send an alert.';
}
$('#settingsBtn').addEventListener('click', async () => {
  openSheet('#settings'); alertState();
  const rate = readKwhRate(); $('#kwhRate').value = rate == null ? '' : String(rate);
  $('#hubStatus').textContent = data ? `Connected · ${data.devices.filter((d) => d.online).length} devices · house time ${tzShort()}` : 'Not connected';
  $('#alertDesc').textContent = describeRules();
  try { const s = await api('/api/status');
    $('#cronStatus').textContent = !s.rules ? 'No alert rules yet. Add some under House setup.' : s.lastCron ? `Alert checks run every 5 min · last logged ${new Date(s.lastCron).toLocaleString([], { timeZone: TZ, hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })} ${tzShort(s.lastCron)}` + (s.lastError ? ` · last error: ${s.lastError}` : '') : 'Alert checks run every 5 min (no run logged yet)';
  } catch {}
});

// ---------- boot ----------
// ---------- version / updates ----------
const LOCAL = self.HH_VERSION || { version: '0.0.0', built: '' };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
let swRegistration = null, updating = false, remoteVer = null;
$('#aboutVer').textContent = 'Version ' + LOCAL.version;
$('#aboutBuilt').textContent = LOCAL.built ? 'Built ' + new Date(LOCAL.built).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '';
const copyDonate = $('#copyDonate');
if (copyDonate) copyDonate.addEventListener('click', async () => { const a = $('#donateAddr').textContent.trim(); try { await navigator.clipboard.writeText(a); toast('Copied ' + a); } catch { toast('Couldn’t copy. Press and hold the address to copy it.'); } });
const fb = $('#feedbackLink');
if (fb) fb.href = 'mailto:hubitat@fataldev.com?subject=' + encodeURIComponent('Hubitat Home feedback (v' + LOCAL.version + ')');
async function fetchRemoteVersion() { const r = await fetch('/api/version', { cache: 'no-store' }); return (await r.json()).version; }
function workerVersion(w, ms = 2500) {
  return new Promise((res) => { if (!w) return res(null); const ch = new MessageChannel(); const t = setTimeout(() => res(null), ms);
    ch.port1.onmessage = (e) => { clearTimeout(t); res(e.data && e.data.version); }; w.postMessage({ type: 'get-version' }, [ch.port2]); });
}
// A waiting worker only counts as an update if it's newer than the one in control (guards against a stale edge copy).
async function waitingIsNewer(reg) {
  if (!reg || !reg.waiting || !navigator.serviceWorker.controller) return null;
  const [wv, cv] = await Promise.all([workerVersion(reg.waiting), workerVersion(navigator.serviceWorker.controller)]);
  return wv && (!cv || newer(wv, cv)) ? wv : null;
}
function waitForWaiting(reg, ms = 8000) {
  return new Promise((res) => {
    if (reg.waiting) return res(reg.waiting);
    const done = () => res(reg.waiting || null); const t = setTimeout(done, ms);
    const watch = (w) => w && w.addEventListener('statechange', () => { if (w.state === 'installed' || w.state === 'redundant') { clearTimeout(t); done(); } });
    watch(reg.installing); reg.addEventListener('updatefound', () => watch(reg.installing), { once: true });
  });
}
function showUpdateReady(ver) {
  remoteVer = ver || remoteVer;
  $('#updBannerVer').textContent = remoteVer ? 'v' + remoteVer : '';
  if (!sessionStorage.getItem('hh_upd_dismissed')) $('#updBanner').classList.remove('hidden');
  $('#updStatus').textContent = 'Update available' + (remoteVer ? ` (v${remoteVer})` : '');
  $('#updNow').classList.remove('hidden');
}
async function applyUpdate() {
  updating = true; $('#updNow').disabled = true; $('#updBannerBtn').disabled = true; $('#updStatus').textContent = 'Updating…';
  const reg = swRegistration || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
  const w = reg && (reg.waiting || await waitForWaiting(reg));
  if (w) { w.postMessage({ type: 'skip-waiting' }); setTimeout(() => location.reload(), 3000); } // controllerchange normally reloads first
  else location.reload();
}
async function checkForUpdate({ quiet = false } = {}) {
  if (!quiet) { $('#updStatus').textContent = 'Checking…'; $('#checkUpd').disabled = true; }
  try {
    const rv = await fetchRemoteVersion();
    const reg = swRegistration || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
    if (reg) { await reg.update().catch(() => {}); }
    if (reg && !reg.waiting && (newer(rv, LOCAL.version) || reg.installing)) await waitForWaiting(reg);
    const wv = await waitingIsNewer(reg);
    if (newer(rv, LOCAL.version) || wv) showUpdateReady(wv && newer(wv, rv) ? wv : (newer(rv, LOCAL.version) ? rv : wv));
    else if (!quiet) { $('#updStatus').textContent = `You're up to date (v${LOCAL.version})`; $('#updNow').classList.add('hidden'); }
  } catch (e) { if (!quiet) $('#updStatus').textContent = 'Couldn’t check for updates: ' + e.message; }
  finally { $('#checkUpd').disabled = false; }
}
$('#checkUpd').addEventListener('click', () => checkForUpdate());
$('#updNow').addEventListener('click', applyUpdate);
$('#updBannerBtn').addEventListener('click', applyUpdate);
$('#updBannerX').addEventListener('click', () => { sessionStorage.setItem('hh_upd_dismissed', '1'); $('#updBanner').classList.add('hidden'); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open-device') openDevice(e.data.id); });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
    swRegistration = reg;
    const hadController = !!navigator.serviceWorker.controller;
    const maybe = async () => { const wv = await waitingIsNewer(reg); if (wv) showUpdateReady(wv); };
    const track = (w) => w && w.addEventListener('statechange', () => { if (w.state === 'installed') maybe(); });
    if (reg.waiting && hadController) maybe();
    track(reg.installing); // an update may already be installing by the time register() resolves
    reg.addEventListener('updatefound', () => track(reg.installing));
    checkForUpdate({ quiet: true }); // banner on open if a newer build is out
  }).catch(() => {});
}
// ---------- hooks for voice.js ----------
window.HH = {
  devices: () => (data ? data.devices : []), rooms: () => (data ? data.rooms : []),
  device: (id) => data && data.devices.find((d) => d.id === id), isOn,
  setDevice, setSpeed, refreshSoon,
  awayId: () => data && data.away && data.away.id, awayOn: () => !!(data && data.away) && (data.away.id in pending ? pending[data.away.id].on : data.away.on),
  thermo: () => tState(), thermoDev, sunTimes, tempColor, loadEnergy, enPolling: () => enTimer !== null, protectHref, protectPlatform, openUniFiProtect, thermoChange: (ch) => thermoChange({ ...ch, now: true }),
  flash(id) { const t = document.querySelector(`.tile[data-id="${id}"]`); if (!t) return; t.classList.remove('vflash'); void t.offsetWidth; t.classList.add('vflash'); setTimeout(() => t.classList.remove('vflash'), 1300); },
  // Voice "all off" (after its own confirm): every light and fan in the house; plugs and Away Mode untouched.
  async allOffAll() {
    const targets = data.devices.filter((d) => d.kind !== 'plug' && d.kind !== 'thermostat' && isOn(d)); let fails = 0;
    await Promise.all(targets.map((d, i) => new Promise((res) => setTimeout(() => { window.HH.flash(d.id); setDevice(d.id, false, { quiet: true }).catch(() => fails++).finally(res); }, i * 110))));
    refreshSoon(); if (fails) throw new Error(`${fails} device(s) didn’t respond`); return targets.length;
  },
};
const qp = new URLSearchParams(location.search);
const deepId = qp.get('device');
if (deepId) history.replaceState(null, '', '/' + location.hash);
load().then(() => { if (!KEY) return; if (deepId) openDevice(deepId); syncFavs(); syncLayout(); enPoll(); });
if (deepId && !data) openDevice(deepId);
setInterval(() => { if (document.visibilityState === 'visible') load(); }, 10000);
setInterval(() => { if (data) data.devices.filter((d) => d.watchMins || lateRule(d)).forEach(updateTile); if (devSheetId) updateDevSheet(); }, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
})();
