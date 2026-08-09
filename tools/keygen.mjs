#!/usr/bin/env node
// 署名鍵ペアを生成し、Worker 用の秘密鍵と index.html 用の公開鍵を出力する。
//   node tools/keygen.mjs [kid]
// openssl は不要（WebCrypto だけで完結する）。
//
// ★ 本番鍵とテスト鍵は必ず別に作り、別の kid を割り当てること。
//    テスト鍵の公開鍵を本番 index.html に載せてはいけない
//    （Stripe テストカードで本物のライセンスが発行できてしまう）。
//    推奨: 本番 kid=1、テスト kid=200。
import { webcrypto as wc } from 'node:crypto';

const kid = Number(process.argv[2] || 1);
if (!Number.isInteger(kid) || kid < 1 || kid > 255) {
  console.error('kid は 1〜255 の整数で指定してください（本番=1 / テスト=200 を推奨）');
  process.exit(1);
}

const pair = await wc.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
);
const pkcs8 = Buffer.from(await wc.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const pub = await wc.subtle.exportKey('jwk', pair.publicKey);
const salt = Buffer.from(wc.getRandomValues(new Uint8Array(32))).toString('base64url');

console.log(`
=== kid = ${kid} の鍵ペアを生成しました ===

--- 1) Worker のシークレット（この3つを wrangler で設定） ---

  npx wrangler secret put SIGNING_KEY_PKCS8_B64
  ${pkcs8}

  npx wrangler secret put LID_SALT
  ${salt}

  # KID は機密ではないので wrangler.toml の [vars] でよい
  KID = "${kid}"

--- 2) index.html の LICENSE_PUBKEYS に追記する行 ---

        ${kid}: { kty:'EC', crv:'P-256', x:'${pub.x}', y:'${pub.y}' },

--- 3) tools/mint.mjs / tools/lid.mjs 用（.env などに控える。コミット禁止） ---

  MD_SIGNING_KEY="${pkcs8}"
  MD_LID_SALT="${salt}"
  MD_KID=${kid}

★ 秘密鍵と LID_SALT はリポジトリに絶対にコミットしないこと。
★ 鍵を失うと以後の発行ができなくなる（既発行分は公開鍵がある限り生き続ける）。
`);
