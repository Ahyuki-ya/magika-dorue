// ライセンストークンの共有プリミティブ（Node 18+ / 依存なし）
// クライアント(index.html)・Worker(worker/src/index.js) と **同じ定義** を持つ。
// ここを変えたら3か所すべてを揃えること。差分が出ると署名が通らなくなる。
import { webcrypto as wc } from 'node:crypto';

export const DOMAIN_STR = 'magika-dorue/license/v1';
export const DOMAIN = new TextEncoder().encode(DOMAIN_STR);
export const PAYLOAD_LEN = 15;
export const SIG_LEN = 64;
export const PREFIX = 'MD1';

export const FLAG = { AD_FREE: 0x01, COSMETICS: 0x02, CREDITS: 0x04 };

export function b64uEncode(bytes) {
  return Buffer.from(bytes).toString('base64url');
}
export function b64uDecode(s) {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

/** lid = SHA-256(salt + '|' + sessionId) の先頭8バイト。Worker と同一の導出。 */
export async function deriveLid(salt, sessionId) {
  const d = await wc.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + sessionId));
  return new Uint8Array(d).slice(0, 8);
}

export function lidHex(lid) {
  return Array.from(lid).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function buildPayload({ kid, flags, iat, lid }) {
  const p = new Uint8Array(PAYLOAD_LEN);
  p[0] = 1;                       // v
  p[1] = kid;
  p[2] = flags;
  new DataView(p.buffer).setUint32(3, iat, false);   // BE
  p.set(lid, 7);
  return p;
}

/** DOMAIN ‖ payload を署名対象にする（ドメイン分離） */
export function signingInput(payload) {
  const msg = new Uint8Array(DOMAIN.length + payload.length);
  msg.set(DOMAIN, 0);
  msg.set(payload, DOMAIN.length);
  return msg;
}

export async function importPrivateKey(pkcs8B64) {
  return wc.subtle.importKey(
    'pkcs8', Buffer.from(pkcs8B64, 'base64'),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
}

export async function mint({ pkcs8B64, kid, flags, iat, lid }) {
  const payload = buildPayload({ kid, flags, iat, lid });
  const key = await importPrivateKey(pkcs8B64);
  const sig = await wc.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput(payload));
  return `${PREFIX}.${b64uEncode(payload)}.${b64uEncode(new Uint8Array(sig))}`;
}

/** 検証（index.html の verifyLicense と同じ手順）。不正なら null。 */
export async function verify(token, pubJwkByKid, revokedLids = new Set()) {
  try {
    const parts = String(token).replace(/\s+/g, '').split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return null;
    const payload = b64uDecode(parts[1]);
    const sig = b64uDecode(parts[2]);
    if (payload.length !== PAYLOAD_LEN || sig.length !== SIG_LEN) return null;
    const v = payload[0], kid = payload[1], flags = payload[2];
    if (v !== 1) return null;
    const jwk = pubJwkByKid[kid];
    if (!jwk) return null;
    const key = await wc.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await wc.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, signingInput(payload));
    if (!ok) return null;
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const hex = lidHex(payload.slice(7));
    if (revokedLids.has(hex)) return null;
    return { flags, iat: dv.getUint32(3, false), lid: hex, kid };
  } catch { return null; }
}
