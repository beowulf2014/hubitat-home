// Break-glass: create a new private link from the command line (for example if you lost yours).
// Usage: node scripts/add-person.mjs "Name" https://hubitat-home.<you>.workers.dev
// Needs `npx wrangler login` first. Writes one KV entry (key hash + name); the key itself is printed once and never stored.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
const [name = 'Me', origin = 'https://YOUR-WORKER.workers.dev'] = process.argv.slice(2);
const key = crypto.randomBytes(32).toString('base64url');
const hash = crypto.createHash('sha256').update(key).digest('hex');
const meta = JSON.stringify({ name: name.slice(0, 30) });
execFileSync('npx', ['wrangler', 'kv', 'key', 'put', `key:${hash}`, meta, '--metadata', meta, '--binding', 'KV', '--remote'], { stdio: 'inherit' });
console.log(`\nPrivate link for ${name} (shown once, keep it private):\n${origin.replace(/\/$/, '')}/#k=${key}\n`);
