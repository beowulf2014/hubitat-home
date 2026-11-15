// Voice parser unit tests against the made-up demo house (no network, no devices touched): node scripts/test-voice.mjs
import fs from 'node:fs'; import vm from 'node:vm';
import { DEMO_CONFIG } from './demo-hub.mjs';
const ctxObj = { self: {} }; vm.runInNewContext(fs.readFileSync(new URL('../public/voice.js', import.meta.url), 'utf8'), ctxObj);
const { parse } = ctxObj.self.HHVoice;
const devices = DEMO_CONFIG.devices.map((d) => ({ ...d, speeds: d.kind === 'fan' ? ['low', 'medium', 'high'] : undefined }));
const rooms = [...new Set(devices.map((d) => d.room))];
const ctx = { devices, rooms, thermo: true };
const name = (id) => devices.find((d) => d.id === id)?.name;
const cases = [
  ['turn on the kitchen lights', { type: 'device', id: '21', action: 'on' }],
  ['kitchen lights off', { type: 'device', id: '21', action: 'off' }],
  ['turn off the office light', { type: 'device', id: '41', action: 'off' }],
  ['office fan to high', { type: 'speed', id: '42', speed: 'high' }],
  ['turn on the front porch light', { type: 'device', id: '61', action: 'on' }],
  ['closet light off', { type: 'device', id: '33', action: 'off' }],
  ['turn off the office', { type: 'room', room: 'Office', action: 'off' }],
  ['away mode on', { type: 'away', action: 'on' }],
  ['all off', { type: 'alloff' }],
];
let pass = 0;
for (const [t, exp] of cases) {
  const r = parse(t, ctx);
  const good = Object.entries(exp).every(([k, v]) => r[k] === v);
  if (good) pass++;
  console.log(`${good ? 'PASS' : 'FAIL'}  "${t}" -> ${JSON.stringify(r).slice(0, 140)}${r.id ? ' (' + name(r.id) + ')' : ''}`);
}
console.log(`test-voice: ${pass}/${cases.length} passed`); process.exit(pass === cases.length ? 0 : 1);
