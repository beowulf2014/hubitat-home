import assert from 'node:assert/strict';
import { addDays, weekStart, monthStart, pruneDays, periodKwh, collectReadings, buildUsage } from '../src/energy.js';

assert.equal(addDays('2026-11-11', -3), '2026-11-08');
assert.equal(addDays('2026-03-01', -1), '2026-02-28');
assert.equal(weekStart('2026-11-11'), '2026-11-08'); // Wednesday → Sunday
assert.equal(weekStart('2026-11-08'), '2026-11-08');
assert.equal(weekStart('2026-11-07'), '2026-11-01');
assert.equal(monthStart('2026-11-11'), '2026-11-01');

const pruned = pruneDays({ '2025-01-01': { 1: 1 }, '2026-11-11': { 1: 2 } }, '2026-11-11', 400);
assert.deepEqual(Object.keys(pruned), ['2026-11-11']);

// First install: only today's snapshot, current == baseline → 0, partial
assert.deepEqual(periodKwh({ '2026-11-11': { a: 10 } }, 'a', '2026-11-11', '2026-11-11', 10), { kwh: 0, partial: false });
assert.deepEqual(periodKwh({}, 'a', '2026-11-11', '2026-11-11', 10), { kwh: 0, partial: true });
// Today grew after the morning snapshot
assert.deepEqual(periodKwh({ '2026-11-11': { a: 10 } }, 'a', '2026-11-11', '2026-11-11', 12.25), { kwh: 2.25, partial: false });

// Week with a gap (no snapshots Tue–Thu): span to next snapshot
const days = {
  '2026-11-08': { a: 100 },
  '2026-11-09': { a: 102 },
  '2026-11-12': { a: 110 },
};
assert.equal(periodKwh(days, 'a', '2026-11-08', '2026-11-12', 115).kwh, 15);
assert.equal(periodKwh(days, 'a', '2026-11-08', '2026-11-12', 115).partial, false);

// Period starts mid-month; use snapshot on start date, not earlier leftover
const month = { '2026-10-31': { a: 90 }, '2026-11-01': { a: 100 }, '2026-11-11': { a: 108 } };
assert.equal(periodKwh(month, 'a', '2026-11-01', '2026-11-11', 110).kwh, 10);

// No snapshot on period start: use last before (slight pre-period overcount) — 110-90=20
assert.equal(periodKwh({ '2026-10-31': { a: 90 }, '2026-11-11': { a: 108 } }, 'a', '2026-11-01', '2026-11-11', 110).kwh, 20);

// History starts after period start → partial, count from first snapshot
const late = periodKwh({ '2026-11-11': { a: 100 } }, 'a', '2026-11-01', '2026-11-11', 105);
assert.equal(late.kwh, 5);
assert.equal(late.partial, true);

// Counter reset: drop is treated as fresh since the reset
assert.equal(periodKwh({ '2026-11-11': { a: 100 } }, 'a', '2026-11-11', '2026-11-11', 3).kwh, 3);
// Reset between days: day1 100→102, then reset, day3 starts at 3, now 8 → 2 + 3 + 5 = 10
assert.equal(periodKwh({ '2026-11-08': { a: 100 }, '2026-11-09': { a: 102 }, '2026-11-11': { a: 3 } }, 'a', '2026-11-08', '2026-11-11', 8).kwh, 10);

const devices = [
  { id: '1', name: 'Kitchen', room: 'Kitchen', kind: 'light', on: false, power: 0, energy: 12.5 },
  { id: '2', name: 'Fan', room: 'Living Room', kind: 'fan', on: true, power: 52, energy: 73.714 },
  { id: '3', name: 'Plug', room: 'Office', kind: 'plug', on: true, power: 4.2 }, // watts only
  { id: '10', name: 'Thermostat', room: 'Climate', kind: 'thermostat', on: true },
];
assert.deepEqual(collectReadings(devices), { '1': 12.5, '2': 73.714 });
const rec = { since: '2026-11-11', last: '2026-11-11', writes: 1, days: { '2026-11-11': { '1': 12, '2': 73 } } };
const u = buildUsage({ devices, rec, today: '2026-11-11', wrote: false });
assert.equal(u.live.totalW, 56.2);
assert.equal(u.live.reporting, 3);
assert.equal(u.live.devices[0].name, 'Fan');
assert.equal(u.live.devices[1].name, 'Plug');
assert.equal(u.periods.today.kwh, 1.214); // 0.5 + 0.714
assert.equal(u.snapshot.writes, 1);
assert.equal(u.periods.week.partial, true); // since is after week start
assert.ok(!u.live.devices.find((d) => d.name === 'Thermostat'));

console.log('test-energy: ok');
