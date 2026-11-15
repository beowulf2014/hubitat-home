// House configuration: stored in KV under `config` (non-secret) and `secrets` (never sent to a browser).
// Everything here is generic; nothing about any particular house is baked in.

export const CONFIG_KEY = 'config';
export const SECRETS_KEY = 'secrets';
export const KINDS = ['light', 'fan', 'plug', 'switch', 'thermostat'];
export const THERMO_DEFAULTS = { modes: ['off', 'cool', 'heat', 'auto'], fans: ['auto', 'on', 'circulate'], cool: [60, 99], heat: [55, 90], deadband: 3 };
export const DEFAULT_FEATURES = { energy: true, thermoPlan: true, alerts: true, protect: false, voice: true };
export const MAX_DEVICES = 150;
export const MAX_RULES = 40;

const str = (v, max = 60) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '');
const idStr = (v) => { const s = String(v ?? '').trim(); return /^\d{1,9}$/.test(s) ? s : null; };
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const int = (v, lo, hi, d) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : d; };

export function isValidTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Accept any Maker API link (the "Get All Devices" example URL is easiest) or a bare base URL.
// Returns { base, token } where base ends at .../apps/<appId> (no trailing slash).
export function parseMakerUrl(raw, tokenIn = '') {
  const out = { base: null, token: str(tokenIn, 200) || null, error: null };
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { out.error = 'That doesn’t look like a web address. Copy one of the example links from the Maker API page.'; return out; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') { out.error = 'The address must start with https://'; return out; }
  const t = u.searchParams.get('access_token'); if (t && !out.token) out.token = t;
  const m = u.pathname.match(/^(.*?\/apps\/(?:api\/)?\d+)(?:\/|$)/);
  if (!m) { out.error = 'Couldn’t find “/apps/<number>” in that address. Copy a full example link from the Maker API page.'; return out; }
  out.base = `${u.protocol}//${u.host}${m[1]}`;
  const host = u.hostname;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(host) || host === 'localhost' || host.endsWith('.local')) {
    out.local = true; // Cloudflare can't reach a hub on your home network; the cloud link is needed.
  }
  if (out.token && !/^[A-Za-z0-9-]{8,100}$/.test(out.token)) { out.error = 'The access token has unexpected characters. Copy it again from the Maker API page.'; }
  return out;
}

// Guess a tile kind from what the hub says about a device.
export function inferDevice(h) {
  const caps = (h.capabilities || []).map((c) => (typeof c === 'string' ? c : c && c.name) || '').map((c) => c.toLowerCase());
  const cmds = (h.commands || []).map((c) => (typeof c === 'string' ? c : c && (c.command || c.name)) || '');
  const attrs = h.attributes && !Array.isArray(h.attributes) ? h.attributes : Object.fromEntries((h.attributes || []).map((a) => [a.name, a.currentValue]));
  const label = String(h.label || h.name || `Device ${h.id}`);
  const type = String(h.type || '');
  const has = (c) => caps.includes(c.toLowerCase());
  const isThermo = has('Thermostat') || 'thermostatMode' in attrs;
  const isSwitch = has('Switch') || 'switch' in attrs || cmds.includes('on');
  const isFan = has('FanControl') || cmds.includes('setSpeed') || /\bfan\b/i.test(label);
  const isDimmer = has('SwitchLevel') || cmds.includes('setLevel');
  let kind = null;
  if (isThermo) kind = 'thermostat';
  else if (isSwitch) kind = isFan ? 'fan' : /plug|outlet|receptacle/i.test(label + ' ' + type) ? 'plug' : (isDimmer || /light|lamp|bulb|sconce|chandelier|pendant|can|vanity/i.test(label + ' ' + type)) ? 'light' : 'switch';
  let speeds = null;
  if (cmds.includes('setSpeed')) {
    let s = attrs.supportedFanSpeeds;
    if (typeof s === 'string') { try { s = JSON.parse(s); } catch { s = null; } }
    speeds = Array.isArray(s) ? s.map(String).filter((x) => /^[a-z-]{2,20}$/.test(x) && !['on', 'off', 'auto'].includes(x)).slice(0, 6) : ['low', 'medium', 'high'];
    if (!speeds.length) speeds = null;
  }
  return {
    id: String(h.id), label: label.slice(0, 60), type: type.slice(0, 60), kind,
    setLevel: !!isDimmer && kind !== 'fan', speeds,
    power: 'power' in attrs, energy: 'energy' in attrs, room: str(h.room || '', 40) || null,
  };
}

function cleanRule(r, ids) {
  if (!r || typeof r !== 'object') return null;
  const deviceId = idStr(r.deviceId); if (!deviceId || !ids.has(deviceId)) return null;
  const id = /^[a-z0-9]{1,12}$/.test(r.id || '') ? r.id : Math.random().toString(36).slice(2, 10);
  if (r.type === 'leftOn') return { id, type: 'leftOn', deviceId, minutes: int(r.minutes, 5, 24 * 60, 30) };
  if (r.type === 'onBetween') {
    const from = int(r.from, 0, 23, 0), to = int(r.to, 0, 23, 3);
    if (from === to) return null;
    return { id, type: 'onBetween', deviceId, from, to };
  }
  return null;
}

// Validate a config posted from the wizard against the devices the hub actually has.
// `hubDevices` is the inferDevice() list (or null to trust ids already in the config).
export function sanitizeConfig(input, hubDevices) {
  const c = input && typeof input === 'object' ? input : {};
  const known = hubDevices ? new Map(hubDevices.map((d) => [d.id, d])) : null;
  const thermostatId = idStr(c.thermostatId);
  const devices = [];
  const seen = new Set();
  for (const d of Array.isArray(c.devices) ? c.devices : []) {
    const id = idStr(d && d.id); if (!id || seen.has(id)) continue;
    const h = known ? known.get(id) : null; if (known && !h) continue;
    let kind = KINDS.includes(d.kind) ? d.kind : (h && h.kind) || 'switch';
    if (kind === 'thermostat' && id !== thermostatId) kind = 'switch';
    if (id === thermostatId) kind = 'thermostat';
    const name = str(d.name, 60) || (h && h.label) || `Device ${id}`;
    const room = str(d.room, 40) || 'Other';
    const dev = { id, name, room, kind, setLevel: kind === 'light' ? (h ? !!h.setLevel : !!d.setLevel) : false };
    const speeds = h ? h.speeds : Array.isArray(d.speeds) ? d.speeds.map(String).filter((x) => /^[a-z-]{2,20}$/.test(x)).slice(0, 6) : null;
    if (kind === 'fan' && speeds && speeds.length) dev.speeds = speeds;
    devices.push(dev); seen.add(id);
    if (devices.length >= MAX_DEVICES) break;
  }
  if (thermostatId && !seen.has(thermostatId) && (!known || known.has(thermostatId))) {
    devices.unshift({ id: thermostatId, name: (known && known.get(thermostatId)?.label) || 'Thermostat', room: 'Climate', kind: 'thermostat', setLevel: false });
    seen.add(thermostatId);
  }
  const rooms = [];
  for (const r of Array.isArray(c.rooms) ? c.rooms : []) { const s = str(r, 40); if (s && !rooms.includes(s)) rooms.push(s); }
  for (const d of devices) if (!rooms.includes(d.room)) rooms.push(d.room);
  const ids = new Set(devices.map((d) => d.id));
  const awayId = idStr(c.awayId);
  const f = c.features || {};
  const features = {
    energy: bool(f.energy, DEFAULT_FEATURES.energy),
    thermoPlan: bool(f.thermoPlan, DEFAULT_FEATURES.thermoPlan) && !!thermostatId,
    alerts: bool(f.alerts, DEFAULT_FEATURES.alerts),
    protect: bool(f.protect, DEFAULT_FEATURES.protect),
    voice: bool(f.voice, DEFAULT_FEATURES.voice),
  };
  const rules = (Array.isArray(c.rules) ? c.rules : []).map((r) => cleanRule(r, ids)).filter(Boolean).slice(0, MAX_RULES);
  const lat = Number(c.lat), lon = Number(c.lon);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return {
    v: 1,
    house: str(c.house, 40) || 'Home',
    tz: isValidTz(c.tz) ? c.tz : 'UTC',
    lat: hasLoc ? Math.round(lat * 100) / 100 : null, // ~1 km: plenty for weather, less precise than an address
    lon: hasLoc ? Math.round(lon * 100) / 100 : null,
    place: str(c.place, 60),
    units: c.units === 'C' ? 'C' : 'F',
    rooms: rooms.slice(0, 40),
    devices,
    thermostatId: thermostatId && ids.has(thermostatId) ? thermostatId : null,
    awayId: awayId && (!known || known.has(awayId)) ? awayId : null,
    awayName: str(c.awayName, 40) || 'Away Mode',
    features,
    rules,
  };
}
