// Hubitat Home (public edition): installable phone dashboard for a Hubitat hub, running on your own Cloudflare account.
// - Serves the PWA from ./public (Workers Assets) and proxies the Hubitat Maker API at /api/*.
// - All house settings live in KV `config` (set by the first-run wizard at /setup.html).
// - Hub URL/token, push (VAPID) private key live in KV `secrets` and are never sent to a browser.
// - Access keys: KV `key:<sha256 of key>` with metadata {name}. The key itself is never stored.
// - One cron (*/5): optional thermostat refresh every 15 min, one-time thermostat plans, and your alert rules.
import { CONFIG_KEY, SECRETS_KEY, THERMO_DEFAULTS as THERMO, parseMakerUrl, inferDevice, sanitizeConfig, isValidTz } from './config.js';
import { pruneDays, collectReadings, buildUsage, addDays } from './energy.js';
import { PLAN_KEY, setPlanTz, validatePlan, buildPlan, pickDueStep, applyPlanAfterRun, stepCommands, decoratePlan, modeName, tzAbbr } from './thermo-plan.js';
import { sendPush, b64u } from './webpush.js';
import { VERSION_INFO } from './version.js';

const STATE_KEY = 'state';
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

// ---------- simple per-IP rate limits (in-memory per isolate: free, no KV writes) ----------
const RL = new Map();
function hit(bucket, max, windowMs, count = true) {
  const now = Date.now();
  let e = RL.get(bucket);
  if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; RL.set(bucket, e); }
  if (count) e.n++;
  if (RL.size > 5000) for (const [k, v] of RL) if (v.reset < now) RL.delete(k);
  return e.n > max;
}
const LIMITS = { badKey: [20, 10 * 60e3], setup: [30, 10 * 60e3], api: [300, 60e3], cmd: [60, 60e3] };
const tooMany = (ms = 60) => json({ error: 'Too many requests. Wait a minute and try again.' }, 429, { 'retry-after': String(ms) });

// ---------- config + secrets (isolate cache, KV edge cache) ----------
let cfgCache = { t: 0, v: undefined };
let secCache = { t: 0, v: undefined };
async function getConfig(env, fresh = false) {
  if (!fresh && cfgCache.v !== undefined && Date.now() - cfgCache.t < 30000) return cfgCache.v;
  const v = await env.KV.get(CONFIG_KEY, fresh ? { type: 'json' } : { type: 'json', cacheTtl: 60 });
  cfgCache = { t: Date.now(), v: v || null };
  if (v && v.tz) setPlanTz(v.tz);
  return cfgCache.v;
}
async function getSecrets(env, fresh = false) {
  if (!fresh && secCache.v !== undefined && Date.now() - secCache.t < 30000) return secCache.v;
  const v = (await env.KV.get(SECRETS_KEY, fresh ? { type: 'json' } : { type: 'json', cacheTtl: 60 })) || {};
  // Optional advanced override: wrangler secrets HUB_BASE / HUB_TOKEN win over the wizard's values.
  if (env.HUB_BASE) v.hubBase = env.HUB_BASE;
  if (env.HUB_TOKEN) v.hubToken = env.HUB_TOKEN;
  secCache = { t: Date.now(), v };
  return v;
}

async function sha256hex(s) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function keyOwner(env, key) {
  if (typeof key !== 'string' || key.length < 20 || key.length > 200) return null;
  const h = await sha256hex(key);
  const { value, metadata } = await env.KV.getWithMetadata(`key:${h}`, { type: 'json', cacheTtl: 60 });
  const name = (metadata && metadata.name) || (value && value.name);
  return name ? { name, hash: h } : null;
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const newKey = () => b64u.enc(crypto.getRandomValues(new Uint8Array(32)));
async function addKey(env, name) {
  const key = newKey();
  await env.KV.put(`key:${await sha256hex(key)}`, JSON.stringify({ name }), { metadata: { name } });
  return key;
}

// ---------- Maker API ----------
async function hubRaw(base, token, path) {
  const url = `${base}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' }, cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`Hub responded ${res.status}`);
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}
async function hub(env, path) {
  const s = await getSecrets(env);
  if (!s.hubBase || !s.hubToken) throw new Error('Hub not set up yet');
  return hubRaw(s.hubBase, s.hubToken, path);
}

// ---------- time in the house time zone ----------
function houseParts(tz, ms = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

async function getState(env) {
  const s = (await env.KV.get(STATE_KEY, 'json')) || {};
  return { watch: s.watch || {}, night: s.night || {}, lastCron: s.lastCron || null, lastCronHour: s.lastCronHour || null, lastError: s.lastError || null, lastErrorHour: s.lastErrorHour || null };
}

// ---------- energy: lazy daily kWh baselines (≤1 KV write per house-time day, no cron) ----------
const ENERGY_KEY = 'energy:daily';
let energyHist = { t: 0, v: null };
let energySnapInflight = null;
async function loadEnergyHist(env) {
  if (energyHist.v && Date.now() - energyHist.t < 60000) return energyHist.v;
  const rec = (await env.KV.get(ENERGY_KEY, { type: 'json', cacheTtl: 60 })) || { days: {}, last: null, since: null, writes: 0 };
  energyHist = { t: Date.now(), v: rec };
  return rec;
}
async function maybeSnapshot(env, readings, today) {
  if (!readings || !Object.keys(readings).length) {
    try { return { rec: await loadEnergyHist(env), wrote: false }; } catch { return { rec: { days: {}, last: null, since: null, writes: 0 }, wrote: false }; }
  }
  const fresh = energyHist.v && energyHist.v.last === today && energyHist.v.days && energyHist.v.days[today];
  if (fresh) return { rec: energyHist.v, wrote: false };
  if (energySnapInflight) return energySnapInflight;
  energySnapInflight = (async () => {
    const rec = (await env.KV.get(ENERGY_KEY, { type: 'json' })) || { days: {}, last: null, since: null, writes: 0 };
    if (rec.last === today && rec.days && rec.days[today]) { energyHist = { t: Date.now(), v: rec }; return { rec, wrote: false }; }
    rec.days = pruneDays(rec.days || {}, today);
    rec.days[today] = { ...readings };
    rec.last = today;
    if (!rec.since) rec.since = today;
    rec.writes = (rec.writes || 0) + 1;
    await env.KV.put(ENERGY_KEY, JSON.stringify(rec));
    energyHist = { t: Date.now(), v: rec };
    return { rec, wrote: true };
  })();
  try { return await energySnapInflight; } finally { energySnapInflight = null; }
}

// When a device last turned on, from Hubitat's event history (fallback: now).
async function lastOnTime(env, id) {
  try {
    const ev = await hub(env, `/devices/${id}/events`);
    if (Array.isArray(ev)) {
      const e = ev.find((x) => x.name === 'switch');
      if (e && e.value === 'on' && e.date) { const t = Date.parse(e.date); if (!isNaN(t)) return t; }
    }
  } catch {}
  return Date.now();
}

// Normalize a thermostat from /devices/all (attributes object) or /devices/<id> (attributes array).
function thermoState(h) {
  if (!h) return null;
  let a = h.attributes || {};
  if (Array.isArray(a)) a = Object.fromEntries(a.map((x) => [x.name, x.currentValue]));
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
  return {
    temperature: num(a.temperature), humidity: num(a.humidity), outdoorTemperature: num(a.outdoorTemperature),
    mode: a.thermostatMode || null, coolingSetpoint: num(a.coolingSetpoint), heatingSetpoint: num(a.heatingSetpoint),
    setpoint: num(a.thermostatSetpoint), operatingState: a.thermostatOperatingState || null, fanMode: a.thermostatFanMode || null,
    holdStatus: a.holdStatus || null,
  };
}

// Outdoor temperature from Open-Meteo (free, no key) for the house location. Edge-cached 10 min; no cron, no KV.
async function outdoorWeather(cfg) {
  if (!cfg || cfg.lat == null || cfg.lon == null) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${cfg.lat}&longitude=${cfg.lon}&current=temperature_2m&temperature_unit=${cfg.units === 'C' ? 'celsius' : 'fahrenheit'}`;
  try {
    const r = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true } });
    if (!r.ok) return null;
    const j = await r.json();
    const t = j && j.current && Number(j.current.temperature_2m);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}
function withWeather(t, wx) {
  if (!t) return t;
  if (wx != null) return { ...t, outdoorTemperature: wx, outdoorSource: 'open-meteo', thermostatOutdoorTemperature: t.outdoorTemperature };
  return { ...t, outdoorSource: 'thermostat' };
}

const leftOnRules = (cfg) => (cfg.features.alerts ? cfg.rules.filter((r) => r.type === 'leftOn') : []);
const watchMins = (cfg, id) => { const r = leftOnRules(cfg).find((x) => x.deviceId === id); return r ? r.minutes : null; };

async function readDevices(env, cfg) {
  const [all, wx] = await Promise.all([hub(env, '/devices/all'), outdoorWeather(cfg)]);
  const map = Object.fromEntries((Array.isArray(all) ? all : []).map((d) => [String(d.id), d]));
  const state = await getState(env);
  const devices = cfg.devices.map((d) => {
    const h = map[d.id];
    if (d.kind === 'thermostat') { const t = withWeather(thermoState(h), wx); return { id: d.id, name: d.name, room: d.room, kind: d.kind, on: !!t && t.mode !== 'off', online: !!h, thermo: t }; }
    const on = h?.attributes?.switch === 'on';
    const out = { id: d.id, name: d.name, room: d.room, kind: d.kind, on, online: !!h };
    if (d.speeds) { out.speeds = d.speeds; out.speed = h?.attributes?.speed || null; }
    const pw = h?.attributes?.power; if (pw !== undefined && pw !== null && pw !== '' && isFinite(Number(pw))) out.power = Number(pw);
    const en = h?.attributes?.energy; if (en !== undefined && en !== null && en !== '' && isFinite(Number(en))) out.energy = Number(en);
    const wm = watchMins(cfg, d.id);
    if (wm) { out.watchMins = wm; if (on && state.watch[d.id]) out.onSince = state.watch[d.id].onSince; }
    return out;
  });
  await Promise.all(devices.filter((d) => d.watchMins && d.on && !d.onSince).map(async (d) => { d.onSince = await lastOnTime(env, d.id); }));
  if (cfg.features.energy) { try { await maybeSnapshot(env, collectReadings(devices), houseParts(cfg.tz).date); } catch {} }
  let thermoPlan = null;
  if (cfg.features.thermoPlan) { try { thermoPlan = decoratePlan(await getThermoPlan(env)); } catch {} }
  const away = cfg.awayId ? { id: cfg.awayId, name: cfg.awayName, on: map[cfg.awayId]?.attributes?.switch === 'on' } : null;
  return {
    devices, rooms: cfg.rooms, away, serverTime: Date.now(), thermoPlan,
    house: { name: cfg.house, tz: cfg.tz, tzAbbr: tzAbbr(Date.now(), cfg.tz), lat: cfg.lat, lon: cfg.lon, units: cfg.units, outdoor: wx },
    features: cfg.features, rules: cfg.features.alerts ? cfg.rules : [],
  };
}

function commandFor(cfg, id, action) {
  if (cfg.awayId && id === cfg.awayId) return [action];
  const d = cfg.devices.find((x) => x.id === id);
  if (!d || d.kind === 'thermostat') return null; // thermostat only via /api/thermostat
  if (action === 'off') return ['off'];
  if (d.setLevel) return ['setLevel', '100']; // lights go to full brightness; setLevel also turns them on
  return ['on'];
}

// ---------- push ----------
const getSubs = async (env) => (await env.KV.get('subs', 'json')) || {};
async function removeSub(env, key) { const m = await getSubs(env); if (m[key]) { delete m[key]; await env.KV.put('subs', JSON.stringify(m)); } }
async function pushAll(env, payload) {
  const s = await getSecrets(env);
  if (!s.vapidPrivateJwk || !s.vapidPublic) return [];
  const results = [];
  for (const [key, sub] of Object.entries(await getSubs(env))) {
    try {
      const r = await sendPush(sub, payload, { privateJwk: s.vapidPrivateJwk, publicKey: s.vapidPublic, subject: s.vapidSubject || 'mailto:admin@example.com' });
      if (r.status === 404 || r.status === 410) await removeSub(env, key);
      results.push({ endpointHost: new URL(sub.endpoint).host, status: r.status, error: r.text || undefined });
    } catch (e) { results.push({ endpointHost: new URL(sub.endpoint).host, error: String(e.message || e) }); }
  }
  return results;
}
async function makeVapid() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { vapidPrivateJwk: await crypto.subtle.exportKey('jwk', k.privateKey), vapidPublic: b64u.enc(await crypto.subtle.exportKey('raw', k.publicKey)) };
}

// ---------- alert rules (cron + dry run) ----------
async function checkAlerts(env, cfg, { dry = false } = {}) {
  const rules = cfg.features.alerts ? cfg.rules : [];
  if (!rules.length) return { dry, skipped: 'no alert rules' }; // nothing to watch: no hub call, no KV
  const now = Date.now();
  const all = await hub(env, '/devices/all');
  const sw = Object.fromEntries(all.map((d) => [String(d.id), d.attributes?.switch]));
  const name = (id) => cfg.devices.find((d) => d.id === id)?.name || `Device ${id}`;
  const state = await getState(env);
  const before = JSON.stringify(state);
  const alerts = [];
  const hp = houseParts(cfg.tz, now);

  const watched = new Set();
  for (const r of rules.filter((x) => x.type === 'leftOn')) {
    const id = r.deviceId; watched.add(id);
    if (sw[id] === 'on') {
      if (!state.watch[id]) state.watch[id] = { onSince: await lastOnTime(env, id), notified: false };
      const c = state.watch[id];
      const mins = Math.floor((now - c.onSince) / 60000);
      if (!c.notified && mins >= r.minutes) {
        alerts.push({ title: `${name(id)} left on`, body: `On for ${mins} minutes. Tap to turn it off.`, tag: `lefton-${id}`, deviceId: id, url: `/?device=${id}` });
        c.notified = true;
      }
    } else if (state.watch[id]) delete state.watch[id];
  }
  for (const id of Object.keys(state.watch)) if (!watched.has(id)) delete state.watch[id];

  for (const r of rules.filter((x) => x.type === 'onBetween')) {
    const inWin = r.from < r.to ? hp.hour >= r.from && hp.hour < r.to : hp.hour >= r.from || hp.hour < r.to;
    if (!inWin || sw[r.deviceId] !== 'on') continue;
    const night = r.from > r.to && hp.hour < r.to ? addDays(hp.date, -1) : hp.date; // overnight windows count as one night
    if (state.night[r.id] === night) continue;
    const fmt = (h) => new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' });
    alerts.push({ title: `${name(r.deviceId)} is still on`, body: `It's between ${fmt(r.from)} and ${fmt(r.to)}. Tap to turn it off.`, tag: `night-${r.id}-${night}`, deviceId: r.deviceId, url: `/?device=${r.deviceId}` });
    state.night[r.id] = night;
  }
  const ruleIds = new Set(rules.map((r) => r.id));
  for (const k of Object.keys(state.night)) if (!ruleIds.has(k)) delete state.night[k];

  const results = [];
  if (!dry) for (const a of alerts) results.push({ alert: a.title, sent: await pushAll(env, a) });

  // KV write only on change, plus an hourly heartbeat.
  const hourTag = `${hp.date}T${hp.hour}`;
  const changed = JSON.stringify(state) !== before;
  if (!dry && (changed || state.lastCronHour !== hourTag)) {
    state.lastCron = now; state.lastCronHour = hourTag; state.lastError = null;
    await env.KV.put(STATE_KEY, JSON.stringify(state));
  }
  return { dry, house: hp, watched: Object.keys(state.watch).length, alerts, results };
}

// ---------- one-time thermostat plan ----------
async function getThermoPlan(env) {
  try { return await env.KV.get(PLAN_KEY, { type: 'json' }); } catch { return null; }
}
async function runThermoPlan(env, cfg) {
  if (!cfg.thermostatId || !cfg.features.thermoPlan) return { skipped: true };
  const plan = await getThermoPlan(env);
  if (!plan || !plan.steps) return { skipped: true };
  const now = Date.now();
  const picked = pickDueStep(plan, now);
  if (!picked.run) return { skipped: true };
  const TID = cfg.thermostatId;
  let mode = 'off';
  try { const t = thermoState(await hub(env, `/devices/${TID}`)); mode = (t && t.mode) || 'off'; }
  catch (e) { console.log('thermo plan: could not read thermostat', String(e.message || e)); return { error: 'read failed' }; }
  const cmd = stepCommands(mode, picked.run);
  if (cmd.error) return { deferred: cmd.error };
  try {
    for (const c of cmd.cmds) await hub(env, `/devices/${TID}/${c}`);
    try { await hub(env, `/devices/${TID}/refresh`); } catch {}
  } catch (e) { console.log('thermo plan: command failed', String(e.message || e)); return { error: String(e.message || e) }; }
  const next = applyPlanAfterRun(plan, picked, now);
  if (next.allDone) await env.KV.delete(PLAN_KEY);
  else await env.KV.put(PLAN_KEY, JSON.stringify(next.plan));
  try {
    const label = `${modeName(cmd.mode)} ${cmd.temp}°`;
    await pushAll(env, { title: `Thermostat set to ${label}`, body: `${label} · temporary plan`, tag: 'thermo-plan', url: '/' });
  } catch {}
  return { ok: true, temp: cmd.temp, mode: cmd.mode, cmds: cmd.cmds, allDone: next.allDone };
}

// ---------- first-run setup + house settings ----------
// Before setup: anyone with the URL can run the wizard, so set a SETUP_CODE secret (the Deploy button asks for one)
// and the wizard will require it. After setup: only someone with an access key can change settings.
async function setupGate(req, env, url, body, ip) {
  const cfg = await getConfig(env, true);
  if (cfg) {
    const who = await keyOwner(env, req.headers.get('x-key') || '');
    if (!who) { hit(`bad:${ip}`, ...LIMITS.badKey); return { error: json({ error: 'unauthorized' }, 401) }; }
    return { cfg, who };
  }
  if (env.SETUP_CODE) {
    const code = String((body && body.setupCode) || req.headers.get('x-setup-code') || '').trim();
    if (!safeEqual(code, String(env.SETUP_CODE).trim())) { hit(`bad:${ip}`, ...LIMITS.badKey); return { error: json({ error: 'Setup code is wrong. It’s the SETUP_CODE you chose when you deployed.' }, 403) }; }
  }
  return { cfg: null, who: null };
}
function hubCreds(env, body, saved) {
  const hubUrl = body && typeof body.hubUrl === 'string' ? body.hubUrl.trim() : '';
  const tokenIn = body && typeof body.hubToken === 'string' ? body.hubToken.trim() : '';
  if (!hubUrl && !tokenIn) {
    if (saved && saved.hubBase && saved.hubToken) return { base: saved.hubBase, token: saved.hubToken, saved: true };
    return { error: 'Paste your Maker API link first.' };
  }
  if (!hubUrl && tokenIn && saved && saved.hubBase) return { base: saved.hubBase, token: tokenIn };
  const p = parseMakerUrl(hubUrl, tokenIn);
  if (p.error) return { error: p.error };
  if (!p.token) return { error: 'No access token found. Paste the full example link (it ends with access_token=…), or fill in the Access token box.' };
  if (!env.DEV_ALLOW_HTTP) {
    if (p.local) return { error: 'That is your hub’s local (home network) address, which Cloudflare can’t reach. On the Maker API page, copy a link from the “Cloud Endpoints” section instead.' };
    if (!p.base.startsWith('https://')) return { error: 'The Maker API link must start with https:// (use the Cloud Endpoints link).' };
  }
  return { base: p.base, token: p.token };
}
async function testHub(base, token) {
  let all;
  try { all = await hubRaw(base, token, '/devices/all'); }
  catch (e) {
    const m = String(e.message || e);
    if (/401|403/.test(m)) return { error: 'The hub refused the access token. Copy it again from the Maker API page.' };
    if (/404/.test(m)) return { error: 'The hub didn’t recognise that address. Check the app number in the link.' };
    return { error: `Couldn’t reach the hub (${m}). Make sure the Maker API “Cloud Endpoints” are turned on.` };
  }
  if (!Array.isArray(all)) return { error: 'The hub answered, but not with a device list. Is this a Maker API link?' };
  // Hubitat rooms (newer firmware), used only to pre-fill room names in the wizard. Optional.
  const roomOf = {};
  try {
    const rooms = await hubRaw(base, token, '/rooms');
    if (Array.isArray(rooms)) for (const r of rooms) {
      const ids = r && (r.deviceIds || r.devices);
      if (r && r.name && Array.isArray(ids)) for (const d of ids) roomOf[String(d && typeof d === 'object' ? d.id : d)] = String(r.name).slice(0, 40);
    }
  } catch {}
  return { devices: all.map((h) => inferDevice({ ...h, room: h.room || roomOf[String(h.id)] })).filter((d) => d.kind) };
}

async function setupApi(req, env, url, p, ip) {
  if (p === '/api/setup/status') {
    const cfg = await getConfig(env, true);
    return json({ configured: !!cfg, needsCode: !cfg && !!env.SETUP_CODE });
  }
  if (hit(`setup:${ip}`, ...LIMITS.setup)) return tooMany(120);
  const body = req.method === 'POST' ? await req.json().catch(() => null) : null;
  const gate = await setupGate(req, env, url, body, ip);
  if (gate.error) return gate.error;

  if (p === '/api/setup/config' && req.method === 'GET') {
    if (!gate.cfg) return json({ config: null });
    const s = await getSecrets(env, true);
    let hubHost = null; try { hubHost = new URL(s.hubBase).host; } catch {}
    return json({ config: gate.cfg, hub: { connected: !!(s.hubBase && s.hubToken), host: hubHost, fromEnv: !!(env.HUB_BASE || env.HUB_TOKEN) }, you: gate.who.name });
  }
  if (p === '/api/setup/test' && req.method === 'POST') {
    const c = hubCreds(env, body, gate.cfg ? await getSecrets(env, true) : null);
    if (c.error) return json({ error: c.error }, 400);
    const t = await testHub(c.base, c.token);
    if (t.error) return json({ error: t.error }, 400);
    return json({ ok: true, count: t.devices.length, devices: t.devices, host: new URL(c.base).host });
  }
  if (p === '/api/setup/geo' && req.method === 'POST') {
    const q = String((body && body.q) || '').trim().slice(0, 60);
    const country = /^[A-Za-z]{2}$/.test((body && body.country) || '') ? body.country.toUpperCase() : 'US';
    if (!q) return json({ error: 'Enter a zip / postal code or a town name.' }, 400);
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json&countryCode=${country}`, { cf: { cacheTtl: 86400, cacheEverything: true } });
      const j = await r.json();
      const hit0 = j && Array.isArray(j.results) && j.results[0];
      if (!hit0) return json({ error: 'Couldn’t find that place. Try your town name, or use “Use my location”.' }, 404);
      return json({ lat: hit0.latitude, lon: hit0.longitude, tz: hit0.timezone, place: [hit0.name, hit0.admin1, hit0.country_code].filter(Boolean).join(', ') });
    } catch { return json({ error: 'Place lookup is unavailable right now. Use “Use my location” or try again later.' }, 502); }
  }
  if (p === '/api/setup/save' && req.method === 'POST') {
    if (!body || typeof body.config !== 'object') return json({ error: 'missing config' }, 400);
    const saved = await getSecrets(env, true);
    const c = hubCreds(env, body, gate.cfg ? saved : null);
    if (c.error) return json({ error: c.error }, 400);
    const t = await testHub(c.base, c.token);
    if (t.error) return json({ error: t.error }, 400);
    const cfg = sanitizeConfig(body.config, t.devices);
    if (!cfg.devices.length) return json({ error: 'Pick at least one device to show.' }, 400);
    if (!isValidTz(cfg.tz)) return json({ error: 'Pick a time zone.' }, 400);
    const raw = (await env.KV.get(SECRETS_KEY, { type: 'json' })) || {};
    const secrets = { ...raw };
    if (!c.saved) { secrets.hubBase = c.base; secrets.hubToken = c.token; }
    if (!raw.vapidPrivateJwk || !raw.vapidPublic) Object.assign(secrets, await makeVapid());
    secrets.vapidSubject = raw.vapidSubject || url.origin;
    await env.KV.put(SECRETS_KEY, JSON.stringify(secrets));
    secCache = { t: 0, v: undefined };
    let key = null;
    if (!gate.cfg) {
      const name = String((body && body.yourName) || 'Me').replace(/[^\p{L}\p{N} '._-]/gu, '').trim().slice(0, 30) || 'Me';
      key = await addKey(env, name);
    }
    await env.KV.put(CONFIG_KEY, JSON.stringify(cfg));
    cfgCache = { t: Date.now(), v: cfg }; setPlanTz(cfg.tz);
    if (cfg.thermostatId !== (gate.cfg && gate.cfg.thermostatId)) { try { await env.KV.delete(PLAN_KEY); } catch {} }
    return json({ ok: true, config: cfg, ...(key ? { key, link: `${url.origin}/#k=${key}` } : {}) });
  }
  return json({ error: 'not found' }, 404);
}

// ---------- API ----------
async function api(req, env, url, ctx) {
  const p = url.pathname;
  const ip = req.headers.get('cf-connecting-ip') || 'local';

  if (p === '/api/version') return json({ name: 'Hubitat Home', ...VERSION_INFO });
  if (p.startsWith('/api/setup/')) return setupApi(req, env, url, p, ip);

  if (p === '/api/manifest') {
    const k = url.searchParams.get('k');
    const start = k && !hit(`bad:${ip}`, ...LIMITS.badKey, false) && (await keyOwner(env, k)) ? `/#k=${k}` : '/';
    return new Response(JSON.stringify({
      name: 'Hubitat Home', short_name: 'Hubitat Home', id: '/', start_url: start, scope: '/', display: 'standalone',
      background_color: '#121315', theme_color: '#121315', orientation: 'any',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' } });
  }

  // Everything else needs an access key.
  if (hit(`api:${ip}`, ...LIMITS.api)) return tooMany();
  if (hit(`bad:${ip}`, ...LIMITS.badKey, false)) return tooMany(600);
  const key = req.headers.get('x-key') || url.searchParams.get('k') || '';
  const owner = await keyOwner(env, key);
  if (!owner) { hit(`bad:${ip}`, ...LIMITS.badKey); return json({ error: 'unauthorized' }, 401); }
  const who = owner.name;
  const cfg = await getConfig(env);
  if (!cfg) return json({ error: 'not set up', setup: true }, 409);
  const BY_ID = Object.fromEntries(cfg.devices.map((d) => [d.id, d]));
  const isCmd = req.method !== 'GET';
  if (isCmd && hit(`cmd:${ip}`, ...LIMITS.cmd)) return tooMany();

  if (p === '/api/devices' && req.method === 'GET') return json(await readDevices(env, cfg));

  if (p === '/api/energy') {
    if (!cfg.features.energy) return json({ available: false, usage: null });
    const devs = await readDevices(env, cfg);
    let usage = null;
    try {
      const today = houseParts(cfg.tz).date;
      const { rec, wrote } = await maybeSnapshot(env, collectReadings(devs.devices), today);
      usage = buildUsage({ devices: devs.devices, rec, today, wrote });
    } catch {}
    return json({ available: false, usage });
  }

  // People / access keys. Names only; keys are shown once at creation.
  if (p === '/api/people') {
    if (req.method === 'GET') {
      const out = []; let cursor;
      do {
        const r = await env.KV.list({ prefix: 'key:', cursor });
        for (const k of r.keys) out.push({ id: k.name.slice(4, 16), name: (k.metadata && k.metadata.name) || '(unnamed)', you: k.name === `key:${owner.hash}` });
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor);
      return json({ people: out });
    }
    if (req.method === 'POST') {
      const b = await req.json().catch(() => null);
      const name = String((b && b.name) || '').replace(/[^\p{L}\p{N} '._-]/gu, '').trim().slice(0, 30);
      if (!name) return json({ error: 'Give this person a name.' }, 400);
      const list = await env.KV.list({ prefix: 'key:' });
      if (list.keys.length >= 20) return json({ error: 'That’s the limit of 20 people.' }, 400);
      if (list.keys.some((k) => (k.metadata && k.metadata.name || '').toLowerCase() === name.toLowerCase())) return json({ error: 'Someone already has that name. Pick another.' }, 400);
      const k = await addKey(env, name);
      return json({ ok: true, name, link: `${url.origin}/#k=${k}` });
    }
    return json({ error: 'method not allowed' }, 405);
  }
  const pm = p.match(/^\/api\/people\/([0-9a-f]{12})$/);
  if (pm && req.method === 'DELETE') {
    if (owner.hash.startsWith(pm[1])) return json({ error: 'You can’t remove your own access from here.' }, 400);
    const list = await env.KV.list({ prefix: `key:${pm[1]}` });
    for (const k of list.keys) await env.KV.delete(k.name);
    return json({ ok: true, removed: list.keys.length });
  }

  // Layout: per person {tabs: {<tab>: {order:[ids], sizes:{id:'s'|'w'|'l'}, hidden:[ids]}}}. Client writes once per edit session.
  if (p === '/api/layout') {
    const k = `layout:${who}`;
    if (req.method === 'GET') return json({ name: who, layout: await env.KV.get(k, 'json') });
    if (req.method === 'PUT') {
      const raw = await req.text(); if (raw.length > 20000) return json({ error: 'layout too large' }, 413);
      let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
      const tabsIn = body && body.layout && body.layout.tabs; if (!tabsIn || typeof tabsIn !== 'object') return json({ error: 'layout.tabs required' }, 400);
      const okTabs = new Set(['Favorites', 'All', ...cfg.rooms]); const ids = (a) => (Array.isArray(a) ? [...new Set(a.map(String))].filter((id) => BY_ID[id]).slice(0, 200) : []);
      const tabs = {};
      for (const [t, v] of Object.entries(tabsIn)) {
        if (!okTabs.has(t) || !v || typeof v !== 'object') continue;
        const o = {}; const order = ids(v.order); const hidden = ids(v.hidden);
        const sizes = {}; for (const [id, sz] of Object.entries(v.sizes || {})) { if (BY_ID[id] && ['s', 'w', 'l'].includes(sz)) sizes[id] = BY_ID[id].kind === 'thermostat' && sz === 's' ? 'w' : sz; }
        if (order.length) o.order = order; if (hidden.length) o.hidden = hidden; if (Object.keys(sizes).length) o.sizes = sizes;
        if (Object.keys(o).length) tabs[t] = o;
      }
      const clean = { tabs };
      const prev = JSON.stringify(await env.KV.get(k, 'json'));
      if (prev !== JSON.stringify(clean)) await env.KV.put(k, JSON.stringify(clean));
      return json({ name: who, layout: clean });
    }
    return json({ error: 'method not allowed' }, 405);
  }

  // Favorites: per person, ordered list of device ids.
  if (p === '/api/favorites') {
    const k = `fav:${who}`;
    if (req.method === 'GET') return json({ name: who, favorites: await env.KV.get(k, 'json') });
    if (req.method === 'PUT') {
      const body = await req.json().catch(() => null);
      if (!body || !Array.isArray(body.favorites)) return json({ error: 'favorites must be an array' }, 400);
      const clean = [...new Set(body.favorites.map(String))].filter((id) => BY_ID[id]).slice(0, 200);
      const prev = JSON.stringify(await env.KV.get(k, 'json'));
      if (prev !== JSON.stringify(clean)) await env.KV.put(k, JSON.stringify(clean));
      return json({ name: who, favorites: clean });
    }
    return json({ error: 'method not allowed' }, 405);
  }

  const TID = cfg.thermostatId;
  // One-time thermostat plan (not a recurring schedule). Times in the house time zone.
  if (p === '/api/thermo-plan') {
    if (!TID || !cfg.features.thermoPlan) return json({ error: 'Thermostat plans are turned off in setup.' }, 404);
    if (req.method === 'GET') return json({ plan: decoratePlan(await getThermoPlan(env)), tz: cfg.tz });
    if (req.method === 'DELETE') {
      const prev = await getThermoPlan(env);
      if (prev) await env.KV.delete(PLAN_KEY);
      return json({ ok: true, cancelled: !!prev, plan: null });
    }
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const body = await req.json().catch(() => null);
    let mode = null;
    try { const t = thermoState(await hub(env, `/devices/${TID}`)); mode = (t && t.mode) || 'off'; } catch {}
    const v = validatePlan(body, Date.now(), { mode });
    if (v.error) return json({ error: v.error }, 400);
    const plan = buildPlan({ steps: v.steps, who, now: Date.now() });
    await env.KV.put(PLAN_KEY, JSON.stringify(plan));
    return json({ ok: true, plan: decoratePlan(plan), tz: cfg.tz });
  }

  // Thermostat: GET = single-device read; POST = validated batch {mode?, fan?, cool?, heat?}.
  if (TID && (p === `/api/thermostat/${TID}` || p === '/api/thermostat')) {
    if (req.method === 'GET') { const [h, wx] = await Promise.all([hub(env, `/devices/${TID}`), outdoorWeather(cfg)]); return json({ id: TID, thermo: withWeather(thermoState(h), wx) }); }
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const b = await req.json().catch(() => null);
    if (!b || typeof b !== 'object') return json({ error: 'bad body' }, 400);
    const cmds = [];
    const int = (v, [lo, hi]) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
    if (b.mode !== undefined) { if (!THERMO.modes.includes(b.mode)) return json({ error: 'bad mode' }, 400); cmds.push(`setThermostatMode/${b.mode}`); }
    if (b.fan !== undefined) { if (!THERMO.fans.includes(b.fan)) return json({ error: 'bad fan mode' }, 400); cmds.push(`setThermostatFanMode/${b.fan}`); }
    let heat = null, cool = null;
    if (b.heat !== undefined) { heat = int(b.heat, THERMO.heat); if (heat === null) return json({ error: `heat setpoint must be ${THERMO.heat[0]}-${THERMO.heat[1]}` }, 400); }
    if (b.cool !== undefined) { cool = int(b.cool, THERMO.cool); if (cool === null) return json({ error: `cool setpoint must be ${THERMO.cool[0]}-${THERMO.cool[1]}` }, 400); }
    if (heat !== null && cool !== null && cool < heat + THERMO.deadband) return json({ error: `cool must be at least heat + ${THERMO.deadband}` }, 400);
    const sp = [];
    if (heat !== null) sp.push(`setHeatingSetpoint/${heat}`);
    if (cool !== null) sp.push(`setCoolingSetpoint/${cool}`);
    if (heat !== null && cool !== null && b.raising) sp.reverse();
    cmds.push(...sp);
    if (!cmds.length) return json({ error: 'nothing to do' }, 400);
    const paths = cmds.map((c) => `/devices/${TID}/${c}`);
    if (url.searchParams.get('dry') === '1') return json({ dry: true, hubPaths: paths });
    for (const pth of paths) await hub(env, pth);
    return json({ ok: true, sent: cmds.length });
  }

  const sm = p.match(/^\/api\/device\/(\d+)\/speed\/([a-z-]+)$/);
  if (sm && req.method === 'POST') {
    const [, id, speed] = sm; const d = BY_ID[id];
    if (!d || !d.speeds || !d.speeds.includes(speed)) return json({ error: 'unsupported speed' }, 400);
    const path = `/devices/${id}/setSpeed/${speed}`;
    if (url.searchParams.get('dry') === '1') return json({ dry: true, id, speed, hubPath: path });
    await hub(env, path);
    return json({ ok: true, id, speed });
  }
  const m = p.match(/^\/api\/device\/(\d+)\/(on|off)$/);
  if (m && req.method === 'POST') {
    const [, id, action] = m;
    const cmd = commandFor(cfg, id, action);
    if (!cmd) return json({ error: 'unknown device' }, 404);
    const path = `/devices/${id}/${cmd.join('/')}`;
    if (url.searchParams.get('dry') === '1') return json({ dry: true, id, action, hubPath: path });
    await hub(env, path);
    if (watchMins(cfg, id)) { // keep the left-on timer accurate when toggled from the app
      const st = await getState(env);
      if (action === 'on' && !st.watch[id]) { st.watch[id] = { onSince: Date.now(), notified: false }; await env.KV.put(STATE_KEY, JSON.stringify(st)); }
      if (action === 'off' && st.watch[id]) { delete st.watch[id]; await env.KV.put(STATE_KEY, JSON.stringify(st)); }
    }
    return json({ ok: true, id, action });
  }

  if (p === '/api/vapid') { const s = await getSecrets(env); return json({ publicKey: s.vapidPublic || null }); }
  if (p === '/api/subscribe' && req.method === 'POST') {
    const sub = await req.json().catch(() => null);
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth || !/^https:\/\//.test(sub.endpoint)) return json({ error: 'bad subscription' }, 400);
    const map = await getSubs(env);
    if (Object.keys(map).length >= 50) return json({ error: 'too many devices subscribed' }, 400);
    map[(await sha256hex(sub.endpoint)).slice(0, 32)] = { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, added: Date.now() };
    await env.KV.put('subs', JSON.stringify(map));
    return json({ ok: true });
  }
  if (p === '/api/unsubscribe' && req.method === 'POST') {
    const { endpoint } = (await req.json().catch(() => null)) || {};
    if (endpoint) await removeSub(env, (await sha256hex(endpoint)).slice(0, 32));
    return json({ ok: true });
  }
  if (p === '/api/test-push' && req.method === 'POST') {
    const results = await pushAll(env, { title: 'Hubitat Home test alert', body: 'Alerts are working. Tap to open the app.', tag: 'test', url: '/' });
    return json({ ok: true, subscriptions: results.length, results });
  }
  if (p === '/api/status') {
    const st = await getState(env);
    return json({ lastCron: st.lastCron, lastError: st.lastError || null, watching: Object.keys(st.watch).length, rules: cfg.features.alerts ? cfg.rules.length : 0, subscriptions: Object.keys(await getSubs(env)).length, you: who });
  }
  if (p === '/api/check') return json(await checkAlerts(env, cfg, { dry: url.searchParams.get('dry') !== '0' }));

  return json({ error: 'not found' }, 404);
}

const SEC_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(req, env, url, ctx); }
      catch (e) { return json({ error: String(e.message || e) }, 502); }
    }
    const res = await env.ASSETS.fetch(req);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SEC_HEADERS)) out.headers.set(k, v);
    return out;
  },
  async scheduled(event, env, ctx) {
    const cfg = await getConfig(env);
    if (!cfg) return; // not set up yet: do nothing at all
    // Every third 5-min tick (~15 min): ask the thermostat for fresh readings (no setpoint/mode change, no KV).
    const sched = Date.parse(event.scheduledTime);
    if (cfg.thermostatId && Number.isFinite(sched) && (new Date(sched).getUTCMinutes() % 15) < 5) {
      ctx.waitUntil(hub(env, `/devices/${cfg.thermostatId}/refresh`).catch((e) => console.log('thermostat refresh failed:', String(e.message || e))));
    }
    try { await runThermoPlan(env, cfg); } catch (e) { console.log('thermo plan failed:', String(e.message || e)); }
    try { await checkAlerts(env, cfg); }
    catch (e) {
      const st = await getState(env);
      st.lastError = `${new Date().toISOString()} ${String(e.message || e)}`.slice(0, 300);
      const hp = houseParts(cfg.tz); const hourTag = `${hp.date}T${hp.hour}`;
      if (st.lastErrorHour !== hourTag) { st.lastErrorHour = hourTag; await env.KV.put(STATE_KEY, JSON.stringify(st)); }
    }
  },
};
