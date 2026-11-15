// One-time thermostat plan (not a recurring schedule). Times are in the house time zone (config.tz).
export let TZ = 'UTC';
export function setPlanTz(tz) { if (tz && isValidTz(tz)) TZ = tz; return TZ; }
export function isValidTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }
export function tzAbbr(ms = Date.now(), tz = TZ) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName');
  return p ? p.value : '';
}
export const PLAN_KEY = 'thermo:plan';
export const PLAN_TEMP = [60, 85];
export const DEFAULT_NIGHT = '22:00';
export const DEFAULT_MORNING = '07:00';

export function tzParts(ms = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
}

export function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Interpret a house wall-clock date + HH:MM as a UTC epoch (handles CST/CDT).
export function wallToUtc(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  if (![y, mo, d, hh, mm].every((n) => Number.isFinite(n))) return NaN;
  const wanted = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const asWall = (ms) => {
    const p = tzParts(ms);
    return Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), p.hour, p.minute, 0);
  };
  return wanted - (asWall(wanted) - wanted);
}

export function utcToWall(ms) {
  const p = tzParts(ms);
  return { date: p.date, time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` };
}

export function formatClock(ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)) + ' ' + tzAbbr(ms);
}

export function formatDay(ms, now = Date.now()) {
  const d = tzParts(ms).date;
  const today = tzParts(now).date;
  if (d === today) return 'tonight';
  if (d === addDays(today, 1)) return d.endsWith('') && tzParts(ms).hour < 12 ? 'tomorrow morning' : 'tomorrow';
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms));
}

export function defaultPlanTimes(now = Date.now()) {
  const p = tzParts(now);
  let step1 = wallToUtc(p.date, DEFAULT_NIGHT);
  if (!(step1 >= now + 15 * 60 * 1000)) {
    // Next 15-minute slot at least 30 minutes from now, in house time.
    const later = new Date(now + 30 * 60 * 1000);
    const q = tzParts(+later);
    let min = q.minute;
    const rounded = Math.ceil(min / 15) * 15;
    let h = q.hour, m = rounded, date = q.date;
    if (m >= 60) { h += 1; m -= 60; }
    if (h >= 24) { h -= 24; date = addDays(date, 1); }
    step1 = wallToUtc(date, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  const s1 = tzParts(step1);
  let step2 = wallToUtc(s1.date, DEFAULT_MORNING);
  if (step2 <= step1) step2 = wallToUtc(addDays(s1.date, 1), DEFAULT_MORNING);
  return { step1, step2 };
}

// Given a HH:MM, pick the soonest house-time occurrence at or after `afterMs`.
export function nextOccurrence(timeStr, afterMs) {
  const p = tzParts(afterMs);
  let at = wallToUtc(p.date, timeStr);
  if (at >= afterMs) return at;
  return wallToUtc(addDays(p.date, 1), timeStr);
}

export function parseAt(raw, now = Date.now()) {
  if (raw == null) return NaN;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'object' && raw.date && raw.time) return wallToUtc(String(raw.date), String(raw.time));
  if (typeof raw === 'string') {
    const iso = Date.parse(raw);
    if (Number.isFinite(iso) && /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw.trim())) return iso;
    const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})$/);
    if (m) return wallToUtc(m[1], m[2].length === 4 ? '0' + m[2] : m[2]);
    if (/^\d{1,2}:\d{2}$/.test(raw.trim())) return nextOccurrence(raw.trim().length === 4 ? '0' + raw.trim() : raw.trim(), now);
  }
  return NaN;
}

function asIntTemp(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) && !(typeof v === 'string' && /^\d+$/.test(v.trim()) && Number.isInteger(Number(v)))) {
    // allow numeric strings and integers only
  }
  const i = Number(v);
  if (!Number.isInteger(i) && i !== Number.parseInt(v, 10)) return null;
  const t = Number.parseInt(v, 10);
  if (!Number.isInteger(t) || t < PLAN_TEMP[0] || t > PLAN_TEMP[1]) return null;
  return t;
}

export function defaultStepMode(currentMode) {
  return currentMode === 'heat' || currentMode === 'cool' ? currentMode : 'cool';
}

function stepModeOf(s, fallback) {
  const m = s && (s.mode || s.side);
  if (m === 'heat' || m === 'cool') return m;
  return fallback;
}

export function validatePlan(body, now = Date.now(), { mode } = {}) {
  if (!body || typeof body !== 'object') return { error: 'bad body' };
  const raw = Array.isArray(body.steps) ? body.steps : null;
  if (!raw || raw.length < 1 || raw.length > 2) return { error: 'provide one or two steps' };
  const fallback = defaultStepMode(mode);
  const steps = [];
  let prev = now;
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] || {};
    const temp = asIntTemp(s.temp);
    if (temp == null) return { error: `temp must be a whole number ${PLAN_TEMP[0]}–${PLAN_TEMP[1]}°F` };
    const want = s.mode || s.side;
    if (want != null && want !== 'cool' && want !== 'heat') return { error: 'each step must be Cool or Heat' };
    const at = parseAt(s.at ?? (s.date && s.time ? { date: s.date, time: s.time } : s.time), i === 0 ? now : prev + 1000);
    if (!Number.isFinite(at)) return { error: 'invalid time' };
    if (at < now - 5000) return { error: 'times must be in the future' };
    if (i > 0 && at <= steps[i - 1].at) return { error: 'the return time must be after the first time' };
    steps.push({ temp, at, mode: stepModeOf(s, fallback), done: false });
    prev = at;
  }
  return { ok: true, steps };
}

export function buildPlan({ steps, who, now = Date.now() }) {
  return {
    created: now,
    createdBy: who || null,
    tz: TZ,
    steps: steps.map((s) => ({ temp: s.temp, at: s.at, mode: s.mode, done: false })),
  };
}

export function pickDueStep(plan, now = Date.now()) {
  if (!plan || !Array.isArray(plan.steps)) return { run: null, skip: [] };
  const pending = plan.steps.map((s, i) => ({ ...s, i })).filter((s) => !s.done && s.at <= now);
  if (!pending.length) return { run: null, skip: [] };
  pending.sort((a, b) => a.at - b.at || a.i - b.i);
  const run = pending[pending.length - 1];
  const skip = pending.slice(0, -1);
  return { run, skip };
}

export function applyPlanAfterRun(plan, { run, skip }, now = Date.now()) {
  const doneIdx = new Set([run.i, ...skip.map((s) => s.i)]);
  const steps = plan.steps.map((s, i) => {
    if (!doneIdx.has(i)) return s;
    return { ...s, done: true, doneAt: now, skipped: i !== run.i };
  });
  return { plan: { ...plan, steps }, allDone: steps.every((s) => s.done) };
}

export function modeName(m) { return m === 'heat' ? 'Heat' : 'Cool'; }

// Commands to run a step against the thermostat's current mode.
// If the step's Cool/Heat differs from current mode (including Off or Auto),
// setThermostatMode is sent first, then the matching setpoint. Mode is never left as auto/off.
export function stepCommands(currentMode, step) {
  const want = step && (step.mode === 'heat' || step.mode === 'cool') ? step.mode : null;
  if (!want) return { error: 'step needs Cool or Heat' };
  const temp = step.temp;
  if (temp == null) return { error: 'step needs a temperature' };
  const cmds = [];
  if (currentMode !== want) cmds.push(`setThermostatMode/${want}`);
  cmds.push(want === 'heat' ? `setHeatingSetpoint/${temp}` : `setCoolingSetpoint/${temp}`);
  return { cmds, mode: want, temp };
}

export function planSummary(plan, now = Date.now()) {
  if (!plan || !plan.steps || !plan.steps.length) return '';
  const remaining = plan.steps.filter((s) => !s.done);
  const show = remaining.length ? remaining : plan.steps;
  return show.map((s, i) => {
    const clock = formatClock(s.at);
    const label = `${modeName(s.mode)} ${s.temp}° at ${clock}`;
    if (i === 0) return label;
    return `back to ${label}`;
  }).filter(Boolean).join(' · ');
}

export function decoratePlan(plan, now = Date.now()) {
  if (!plan || !plan.steps) return null;
  return {
    ...plan,
    summary: planSummary(plan, now),
    steps: plan.steps.map((s) => ({ ...s, label: formatClock(s.at), day: formatDay(s.at, now) })),
  };
}
