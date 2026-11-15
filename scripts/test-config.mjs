import assert from 'node:assert/strict';
import { parseMakerUrl, inferDevice, sanitizeConfig } from '../src/config.js';
import { DEMO_DEVICES, DEMO_CONFIG } from './demo-hub.mjs';

let p = parseMakerUrl('https://cloud.hubitat.com/api/aaaa-bbbb/apps/12/devices/all?access_token=abcd-1234-efgh');
assert.equal(p.base, 'https://cloud.hubitat.com/api/aaaa-bbbb/apps/12'); assert.equal(p.token, 'abcd-1234-efgh'); assert.equal(p.error, null);
p = parseMakerUrl('https://cloud.hubitat.com/api/aaaa-bbbb/apps/12/devices/all', 'zzzz-9999-yyyy');
assert.equal(p.token, 'zzzz-9999-yyyy');
assert.ok(parseMakerUrl('http://192.168.1.20/apps/api/7/devices/all?access_token=abcdefgh').local);
assert.ok(parseMakerUrl('not a url').error);
assert.ok(parseMakerUrl('https://example.com/nothing').error);

const inf = DEMO_DEVICES.map(inferDevice);
const k = Object.fromEntries(inf.map((d) => [d.label, d.kind]));
assert.equal(k['Hallway Thermostat'], 'thermostat');
assert.equal(k['Living Room Fan'], 'fan');
assert.equal(k['TV Plug'], 'plug');
assert.equal(k['Kitchen Lights'], 'light');
assert.equal(k['Away Switch'], 'switch');
assert.deepEqual(inf.find((d) => d.label === 'Office Fan').speeds, ['low', 'medium', 'high']);
assert.equal(inf.find((d) => d.label === 'Kitchen Lights').setLevel, true);

const c = sanitizeConfig({ ...DEMO_CONFIG, devices: [...DEMO_CONFIG.devices, { id: '999', name: 'Ghost', room: 'X', kind: 'light' }, { id: '11', name: '<b>dup</b>' }], rules: [...DEMO_CONFIG.rules, { type: 'leftOn', deviceId: '999', minutes: 10 }, { type: 'onBetween', deviceId: '61', from: 2, to: 2 }] }, inf);
assert.ok(!c.devices.some((d) => d.id === '999'), 'unknown device dropped');
assert.equal(c.devices.filter((d) => d.id === '11').length, 1, 'duplicates dropped');
assert.equal(c.devices.find((d) => d.id === '10').kind, 'thermostat');
assert.equal(c.rules.length, 3, 'bad rules dropped');
assert.equal(c.tz, 'America/New_York');
assert.equal(sanitizeConfig({ tz: 'Mars/Base' }, inf).tz, 'UTC');
assert.equal(sanitizeConfig({ ...DEMO_CONFIG, thermostatId: null }, inf).features.thermoPlan, false);
assert.ok(!/[<>]/.test(JSON.stringify(sanitizeConfig({ ...DEMO_CONFIG, house: '<script>' }, inf))));
console.log('test-config: ok');
