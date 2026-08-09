#!/usr/bin/env node
// ローカルでライセンストークンを発行する（Stripe も Cloudflare も使わない）。
// 実装順序の手順1〜3（署名層とゲーム側分岐）を、外部サービス抜きで完結させるためのもの。
//
//   MD_SIGNING_KEY=... MD_KID=1 node tools/mint.mjs --flags 0x07
//   MD_SIGNING_KEY=... MD_KID=1 node tools/mint.mjs --preset supporter
//   ... --session cs_test_abc123     # Stripe セッション相当の lid を再現（MD_LID_SALT が要る）
//
// --flags を省いた場合は supporter(0x07) を発行する。
import { mint, deriveLid, lidHex, verify, FLAG } from './license.mjs';
import { webcrypto as wc } from 'node:crypto';

const argv = process.argv.slice(2);
function opt(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

const PRESETS = { adfree: FLAG.AD_FREE, supporter: FLAG.AD_FREE | FLAG.COSMETICS | FLAG.CREDITS };

const pkcs8B64 = process.env.MD_SIGNING_KEY;
const kid = Number(process.env.MD_KID || 1);
if (!pkcs8B64) {
  console.error('MD_SIGNING_KEY が未設定です（tools/keygen.mjs の出力を使ってください）');
  process.exit(1);
}

const preset = opt('preset');
const flags = preset ? PRESETS[preset] : Number(opt('flags', '0x07'));
if (!Number.isInteger(flags) || flags < 0 || flags > 255) {
  console.error(`flags が不正です: ${opt('flags')}（preset: ${Object.keys(PRESETS).join(' / ')}）`);
  process.exit(1);
}

const iat = Number(opt('iat', Math.floor(Date.now() / 1000)));
const session = opt('session');
let lid;
if (session) {
  if (!process.env.MD_LID_SALT) { console.error('--session には MD_LID_SALT が要ります'); process.exit(1); }
  lid = await deriveLid(process.env.MD_LID_SALT, session);
} else {
  lid = wc.getRandomValues(new Uint8Array(8));
}

const token = await mint({ pkcs8B64, kid, flags, iat, lid });

// 自己検証（秘密鍵から公開鍵を復元して通ることを確かめる）
const priv = await wc.subtle.importKey('pkcs8', Buffer.from(pkcs8B64, 'base64'),
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const jwk = await wc.subtle.exportKey('jwk', priv);
const ok = await verify(token, { [kid]: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } });

console.log(`token   : ${token}`);
console.log(`length  : ${token.length}  (仕様値 111)`);
console.log(`kid=${kid} flags=0x${flags.toString(16).padStart(2, '0')} iat=${iat} lid=${lidHex(lid)}`);
console.log(`selftest: ${ok ? 'OK 署名検証を通過' : 'NG 検証に失敗'}`);
if (!ok) process.exit(1);
