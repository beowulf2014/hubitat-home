// Daily kWh baselines and period math. Pure functions — no KV, no I/O.
// Week is Sunday–Saturday in the house time zone (caller passes already-local YYYY-MM-DD).

export const ENERGY_KEEP_DAYS = 400;

export function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function weekStart(s) {
  const [y, m, d] = s.split('-').map(Number);
  return addDays(s, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

export function monthStart(s) { return `${s.slice(0, 8)}01`; }

export function pruneDays(days, today, keep = ENERGY_KEEP_DAYS) {
  const cutoff = addDays(today, -keep);
  const out = {};
  for (const d of Object.keys(days || {})) if (d >= cutoff) out[d] = days[d];
  return out;
}

// Usage between startDate (inclusive) and today, from daily counter snapshots + the current reading.
// If the counter drops, the new value is treated as fresh since the reset (pre-reset usage that
// wasn't snapshotted is lost). Missing mid-period days are spanned by the next snapshot.
export function periodKwh(days, id, startDate, today, current) {
  const val = (rec, i) => {
    const v = rec && rec[i];
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const dates = Object.keys(days || {}).filter((d) => val(days[d], id) != null).sort();
  const onStart = dates.includes(startDate) ? startDate : null;
  const before = dates.filter((d) => d < startDate).pop() || null;
  const inPeriod = dates.filter((d) => d >= startDate && d <= today);

  const points = [];
  let partial = false;
  if (onStart) points.push({ date: startDate, val: val(days[startDate], id) });
  else if (before) points.push({ date: before, val: val(days[before], id) });
  else if (inPeriod.length) { points.push({ date: inPeriod[0], val: val(days[inPeriod[0]], id) }); partial = true; }
  else if (current != null && Number.isFinite(Number(current))) {
    return { kwh: 0, partial: true };
  } else {
    return { kwh: null, partial: true };
  }

  for (const d of inPeriod) {
    if (points[points.length - 1].date === d) continue;
    points.push({ date: d, val: val(days[d], id) });
  }
  if (current != null && Number.isFinite(Number(current))) {
    points.push({ date: today, val: Number(current) });
  }
  if (points.length < 2) return { kwh: 0, partial: true };

  let kwh = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].val, b = points[i].val;
    kwh += b < a ? b : b - a;
  }
  return { kwh: Math.round(kwh * 1000) / 1000, partial };
}

export function collectReadings(devices) {
  const out = {};
  for (const d of devices || []) {
    const n = Number(d && d.energy);
    if (d && d.id != null && Number.isFinite(n)) out[String(d.id)] = Math.round(n * 1000) / 1000;
  }
  return out;
}

export function buildUsage({ devices, rec, today, wrote = false }) {
  const days = (rec && rec.days) || {};
  const readings = collectReadings(devices);
  const live = [];
  for (const d of devices || []) {
    if (d.kind === 'thermostat') continue;
    const w = Number(d.power);
    if (!Number.isFinite(w)) continue;
    live.push({ id: String(d.id), name: d.name, room: d.room, watts: w, on: !!d.on });
  }
  live.sort((a, b) => b.watts - a.watts || a.name.localeCompare(b.name));
  const totalW = Math.round(live.reduce((s, x) => s + Math.max(0, x.watts), 0) * 10) / 10;

  const period = (start) => {
    const items = [];
    let total = 0, partial = !rec?.since || rec.since > start;
    for (const d of devices || []) {
      const cur = readings[String(d.id)];
      if (cur == null) continue;
      const r = periodKwh(days, String(d.id), start, today, cur);
      if (r.kwh == null) continue;
      if (r.partial) partial = true;
      items.push({ id: String(d.id), name: d.name, room: d.room, kwh: r.kwh });
      total += r.kwh;
    }
    items.sort((a, b) => b.kwh - a.kwh || a.name.localeCompare(b.name));
    return { kwh: Math.round(total * 1000) / 1000, partial, since: rec?.since || today, start, devices: items };
  };

  return {
    today,
    snapshot: {
      wrote: !!wrote,
      since: rec?.since || today,
      last: rec?.last || null,
      storedDays: Object.keys(days).length,
      writes: rec?.writes || 0,
    },
    live: { totalW, reporting: live.length, devices: live.filter((x) => x.watts > 0.5) },
    periods: { today: period(today), week: period(weekStart(today)), month: period(monthStart(today)) },
  };
}
