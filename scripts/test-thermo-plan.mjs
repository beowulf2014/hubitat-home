import assert from 'node:assert/strict';
import {
  wallToUtc, utcToWall, setPlanTz, formatClock, defaultPlanTimes, nextOccurrence,
  parseAt, validatePlan, buildPlan, pickDueStep, applyPlanAfterRun,
  stepCommands, planSummary, decoratePlan, defaultStepMode, PLAN_TEMP,
} from '../src/thermo-plan.js';

setPlanTz('America/New_York'); // any IANA zone works; tests use Eastern

assert.equal(wallToUtc('2026-11-15', '22:00'), Date.parse('2026-11-16T03:00:00.000Z'));
assert.equal(wallToUtc('2026-11-16', '07:00'), Date.parse('2026-11-16T12:00:00.000Z'));
assert.equal(wallToUtc('2026-07-15', '22:00'), Date.parse('2026-07-16T02:00:00.000Z'));
assert.deepEqual(utcToWall(Date.parse('2026-11-16T03:00:00.000Z')), { date: '2026-11-15', time: '22:00' });
assert.equal(formatClock(wallToUtc('2026-11-15', '22:00')), '10:00 PM EST');

const afternoon = wallToUtc('2026-11-15', '15:00');
const def = defaultPlanTimes(afternoon);
assert.equal(def.step1, wallToUtc('2026-11-15', '22:00'));
assert.equal(def.step2, wallToUtc('2026-11-16', '07:00'));
assert.equal(nextOccurrence('07:00', wallToUtc('2026-11-15', '22:00')), wallToUtc('2026-11-16', '07:00'));
assert.equal(parseAt({ date: '2026-11-15', time: '22:00' }), wallToUtc('2026-11-15', '22:00'));

assert.equal(defaultStepMode('heat'), 'heat');
assert.equal(defaultStepMode('cool'), 'cool');
assert.equal(defaultStepMode('auto'), 'cool');
assert.equal(defaultStepMode('off'), 'cool');

const now = afternoon;
let v = validatePlan({
  steps: [
    { temp: 70, mode: 'heat', at: { date: '2026-11-15', time: '22:00' } },
    { temp: 76, mode: 'cool', at: { date: '2026-11-16', time: '07:00' } },
  ],
}, now, { mode: 'off' });
assert.equal(v.ok, true);
assert.equal(v.steps[0].mode, 'heat');
assert.equal(v.steps[1].mode, 'cool');

// Off is allowed; missing step mode defaults from current (or Cool)
v = validatePlan({ steps: [{ temp: 72, at: { date: '2026-11-15', time: '22:00' } }] }, now, { mode: 'off' });
assert.equal(v.ok, true);
assert.equal(v.steps[0].mode, 'cool');
v = validatePlan({ steps: [{ temp: 70, at: { date: '2026-11-15', time: '22:00' } }] }, now, { mode: 'heat' });
assert.equal(v.steps[0].mode, 'heat');
v = validatePlan({ steps: [{ temp: 72, at: { date: '2026-11-15', time: '22:00' } }] }, now, { mode: 'auto' });
assert.equal(v.steps[0].mode, 'cool');

assert.ok(validatePlan({ steps: [{ temp: 50, mode: 'cool', at: { date: '2026-11-15', time: '22:00' } }] }, now).error.includes('temp'));
assert.ok(validatePlan({ steps: [{ temp: 72, mode: 'cool', at: { date: '2026-11-15', time: '10:00' } }] }, now).error.includes('future'));
assert.ok(validatePlan({
  steps: [
    { temp: 72, mode: 'heat', at: { date: '2026-11-15', time: '22:00' } },
    { temp: 76, mode: 'cool', at: { date: '2026-11-15', time: '21:00' } },
  ],
}, now).error.includes('after'));
assert.ok(validatePlan({ steps: [{ temp: 72, mode: 'auto', at: { date: '2026-11-15', time: '22:00' } }] }, now).error.includes('Cool or Heat'));

const two = buildPlan({
  steps: [
    { temp: 70, at: wallToUtc('2026-11-15', '22:00'), mode: 'heat' },
    { temp: 76, at: wallToUtc('2026-11-16', '07:00'), mode: 'cool' },
  ],
  who: 'Alex', now,
});
assert.equal(two.steps[0].mode, 'heat');
assert.equal(pickDueStep(two, wallToUtc('2026-11-15', '21:59')).run, null);
let due = pickDueStep(two, wallToUtc('2026-11-15', '22:01'));
assert.equal(due.run.temp, 70);
due = pickDueStep(two, wallToUtc('2026-11-16', '07:05'));
assert.equal(due.run.temp, 76);
assert.equal(due.run.mode, 'cool');
assert.equal(due.skip[0].mode, 'heat');
const after = applyPlanAfterRun(two, due, wallToUtc('2026-11-16', '07:05'));
assert.equal(after.allDone, true);

assert.deepEqual(stepCommands('cool', { mode: 'cool', temp: 76 }), { cmds: ['setCoolingSetpoint/76'], mode: 'cool', temp: 76 });
assert.deepEqual(stepCommands('heat', { mode: 'heat', temp: 70 }), { cmds: ['setHeatingSetpoint/70'], mode: 'heat', temp: 70 });
assert.deepEqual(stepCommands('cool', { mode: 'heat', temp: 70 }), { cmds: ['setThermostatMode/heat', 'setHeatingSetpoint/70'], mode: 'heat', temp: 70 });
assert.deepEqual(stepCommands('off', { mode: 'heat', temp: 70 }), { cmds: ['setThermostatMode/heat', 'setHeatingSetpoint/70'], mode: 'heat', temp: 70 });
assert.deepEqual(stepCommands('auto', { mode: 'cool', temp: 76 }), { cmds: ['setThermostatMode/cool', 'setCoolingSetpoint/76'], mode: 'cool', temp: 76 });
assert.ok(stepCommands('cool', { temp: 72 }).error);

const sum = planSummary(two, afternoon);
assert.equal(sum, 'Heat 70° at 10:00 PM EST · back to Cool 76° at 7:00 AM EST');
assert.equal(decoratePlan(two, afternoon).summary, sum);
assert.equal(PLAN_TEMP[0], 60);

console.log('test-thermo-plan: ok');
