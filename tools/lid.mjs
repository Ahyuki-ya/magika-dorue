#!/usr/bin/env node
// Stripe の Checkout Session ID から lid（失効リストに載せる16桁hex）を算出する。
//
//   MD_LID_SALT=... node tools/lid.mjs cs_live_a1b2c3...
//
// 【返金したときの手順】
//   1. Stripe ダッシュボードで該当の Checkout Session ID（cs_...）を控える
//   2. このスクリプトで lid を出す
//   3. index.html の REVOKED_LIDS にその hex を追加
//   4. GitHub Pages へ再デプロイ
// LID_SALT は Worker のシークレットなので、この salt を手元にも控えておかないと
// 失効が実行できない。keygen.mjs の出力を .env などに保管しておくこと。
import { deriveLid, lidHex } from './license.mjs';

const salt = process.env.MD_LID_SALT;
const ids = process.argv.slice(2);
if (!salt || ids.length === 0) {
  console.error('使い方: MD_LID_SALT=<salt> node tools/lid.mjs <cs_...> [cs_... ...]');
  process.exit(1);
}
for (const id of ids) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) {
    console.error(`${id} : Checkout Session ID の形式ではありません（cs_ で始まる）`);
    continue;
  }
  console.log(`${id}\n  lid = ${lidHex(await deriveLid(salt, id))}`);
}
