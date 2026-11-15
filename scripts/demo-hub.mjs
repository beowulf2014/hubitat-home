// A pretend Hubitat Maker API with made-up devices, for local testing and screenshots.
// Nothing here is a real house. Run: node scripts/demo-hub.mjs  (listens on 127.0.0.1:8788)
// Maker API link to paste in the wizard: http://127.0.0.1:8788/apps/api/7/devices/all?access_token=demo-token-1234
// (needs DEV_ALLOW_HTTP=1 in .dev.vars because it's plain http)
import http from 'node:http';

const sw = (id, label, extra = {}) => ({ id: String(id), name: label, label, type: extra.type || 'Generic Zigbee Switch', capabilities: extra.caps || ['Switch', 'Refresh'], commands: extra.cmds || ['on', 'off', 'refresh'], attributes: { switch: 'off', ...(extra.attrs || {}) } });
const dim = (id, label, extra = {}) => sw(id, label, { type: 'Generic Z-Wave Dimmer', caps: ['Switch', 'SwitchLevel', 'Refresh'], cmds: ['on', 'off', 'setLevel', 'refresh'], ...extra, attrs: { level: 100, ...(extra.attrs || {}) } });
const fan = (id, label, extra = {}) => sw(id, label, { type: 'Generic Fan Controller', caps: ['Switch', 'FanControl'], cmds: ['on', 'off', 'setSpeed'], ...extra, attrs: { speed: 'off', supportedFanSpeeds: '["low","medium","high","on","off","auto"]', ...(extra.attrs || {}) } });
const plug = (id, label, attrs = {}) => sw(id, label, { type: 'Generic Zigbee Outlet', caps: ['Switch', 'PowerMeter', 'EnergyMeter'], attrs: { power: 0, energy: 0, ...attrs } });

export const DEMO_DEVICES = [
  { id: '10', name: 'Hallway Thermostat', label: 'Hallway Thermostat', type: 'Demo Thermostat', capabilities: ['Thermostat', 'TemperatureMeasurement', 'RelativeHumidityMeasurement', 'Refresh'], commands: ['setThermostatMode', 'setCoolingSetpoint', 'setHeatingSetpoint', 'setThermostatFanMode', 'refresh'],
    attributes: { temperature: 71, humidity: 44, thermostatMode: 'heat', heatingSetpoint: 70, coolingSetpoint: 76, thermostatSetpoint: 70, thermostatOperatingState: 'heating', thermostatFanMode: 'auto' } },
  dim(11, 'Living Room Lamp', { attrs: { switch: 'on', power: 9.5 } }),
  fan(12, 'Living Room Fan'),
  plug(13, 'TV Plug', { switch: 'on', power: 86.2, energy: 41.3 }),
  dim(21, 'Kitchen Lights', { attrs: { switch: 'on', power: 42, energy: 12.6 } }),
  plug(22, 'Coffee Maker Plug', { power: 0, energy: 18.9 }),
  sw(23, 'Pantry Light', { attrs: { switch: 'on' } }),
  dim(31, 'Bedroom Light'),
  fan(32, 'Bedroom Fan', { attrs: { switch: 'on', speed: 'low' } }),
  sw(33, 'Closet Light'),
  dim(41, 'Office Light', { attrs: { switch: 'on', power: 11 } }),
  fan(42, 'Office Fan', { attrs: { switch: 'on', speed: 'medium' } }),
  plug(43, 'Desk Plug', { switch: 'on', power: 132.4, energy: 77.1 }),
  sw(51, 'Garage Light'),
  dim(61, 'Front Porch Light', { attrs: { switch: 'on', energy: 3.2, power: 7 } }),
  dim(62, 'Back Porch Light'),
  sw(90, 'Away Switch', { type: 'Virtual Switch' }),
];

// Ready-made config the wizard would produce for the demo hub (used by tests and screenshots).
export const DEMO_CONFIG = {
  house: 'Home', tz: 'America/New_York', lat: 40.71, lon: -74.01, place: 'Demo City', units: 'F',
  thermostatId: '10', awayId: '90', awayName: 'Away Mode',
  devices: [
    { id: '10', name: 'Thermostat', room: 'Climate', kind: 'thermostat' },
    { id: '11', name: 'Living Room Lamp', room: 'Living Room', kind: 'light' },
    { id: '12', name: 'Living Room Fan', room: 'Living Room', kind: 'fan' },
    { id: '13', name: 'TV Plug', room: 'Living Room', kind: 'plug' },
    { id: '21', name: 'Kitchen Lights', room: 'Kitchen', kind: 'light' },
    { id: '22', name: 'Coffee Maker', room: 'Kitchen', kind: 'plug' },
    { id: '23', name: 'Pantry Light', room: 'Kitchen', kind: 'light' },
    { id: '31', name: 'Bedroom Light', room: 'Bedroom', kind: 'light' },
    { id: '32', name: 'Bedroom Fan', room: 'Bedroom', kind: 'fan' },
    { id: '33', name: 'Closet Light', room: 'Bedroom', kind: 'light' },
    { id: '41', name: 'Office Light', room: 'Office', kind: 'light' },
    { id: '42', name: 'Office Fan', room: 'Office', kind: 'fan' },
    { id: '43', name: 'Desk Plug', room: 'Office', kind: 'plug' },
    { id: '51', name: 'Garage Light', room: 'Outside', kind: 'light' },
    { id: '61', name: 'Front Porch Light', room: 'Outside', kind: 'light' },
    { id: '62', name: 'Back Porch Light', room: 'Outside', kind: 'light' },
  ],
  features: { energy: true, thermoPlan: true, alerts: true, protect: false, voice: true },
  rules: [{ type: 'leftOn', deviceId: '23', minutes: 30 }, { type: 'leftOn', deviceId: '33', minutes: 20 }, { type: 'onBetween', deviceId: '61', from: 1, to: 5 }],
};

const TOKEN = 'demo-token-1234';
const PREFIX = '/apps/api/7';
export function startDemoHub(port = 8788, { log = true } = {}) {
  const devs = JSON.parse(JSON.stringify(DEMO_DEVICES));
  const byId = (id) => devs.find((d) => d.id === String(id));
  const commands = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (u.searchParams.get('access_token') !== TOKEN) return send(401, { error: 'unauthorized' });
    if (!u.pathname.startsWith(PREFIX)) return send(404, { error: 'not found' });
    const p = u.pathname.slice(PREFIX.length).split('/').filter(Boolean).map(decodeURIComponent);
    if (p[0] !== 'devices') return send(404, { error: 'not found' });
    if (p[1] === 'all' || p.length === 1) return send(200, devs);
    const d = byId(p[1]); if (!d) return send(404, { error: 'no device' });
    if (p.length === 2) return send(200, { ...d, attributes: Object.entries(d.attributes).map(([name, currentValue]) => ({ name, currentValue })) });
    if (p[2] === 'events') return send(200, [{ name: 'switch', value: d.attributes.switch, date: new Date(Date.now() - 25 * 60e3).toISOString() }]);
    const [cmd, arg] = [p[2], p[3]]; commands.push(`${d.id}/${cmd}${arg ? '/' + arg : ''}`); if (log) console.log('demo hub command:', d.label, cmd, arg || '');
    const a = d.attributes;
    if (cmd === 'on') a.switch = 'on'; else if (cmd === 'off') a.switch = 'off';
    else if (cmd === 'setLevel') { a.switch = 'on'; a.level = Number(arg); }
    else if (cmd === 'setSpeed') { a.speed = arg; a.switch = 'on'; }
    else if (cmd === 'setThermostatMode') a.thermostatMode = arg;
    else if (cmd === 'setCoolingSetpoint') a.coolingSetpoint = Number(arg);
    else if (cmd === 'setHeatingSetpoint') a.heatingSetpoint = Number(arg);
    else if (cmd === 'setThermostatFanMode') a.thermostatFanMode = arg;
    return send(200, { ok: true });
  });
  srv.commands = commands;
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startDemoHub(Number(process.env.PORT || 8788));
  console.log(`Demo hub on http://127.0.0.1:${process.env.PORT || 8788}${PREFIX}/devices/all?access_token=${TOKEN}`);
}
