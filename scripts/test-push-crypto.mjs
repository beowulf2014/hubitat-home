// Local check: encrypt with our code, decrypt with the reference http_ece lib.
import { encryptPayload, b64u, vapidAuth } from '../src/webpush.js';
import ece from 'http_ece';
import nodeCrypto from 'node:crypto';
const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
const auth = nodeCrypto.randomBytes(16);
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: b64u.enc(ua.getPublicKey()), auth: b64u.enc(auth) } };
const body = await encryptPayload(sub, '{"hello":"world"}');
const out = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
console.log('decrypted:', out.toString());
const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
const pub = b64u.enc(await crypto.subtle.exportKey('raw', k.publicKey));
const a = await vapidAuth(sub.endpoint, jwk, pub, 'mailto:x@example.com');
const [h, c, s] = a.match(/t=([^,]+)/)[1].split('.');
const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.publicKey, b64u.dec(s), new TextEncoder().encode(h + '.' + c));
console.log('vapid sig verifies:', ok);
