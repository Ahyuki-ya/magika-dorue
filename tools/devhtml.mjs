#!/usr/bin/env node
// テスト鍵を埋め込んだ「ローカル確認専用」の index.dev.html を作る。
//   node tools/devhtml.mjs https://magika-dorue-license.magika-dorue.workers.dev
//
// 公開鍵は Worker の /pubkey から取るので、手打ちによる打ち間違いが起きない
// （base64url は大文字小文字を区別するため、43文字を手入力するのは事実上不可能）。
//
// ★ index.dev.html は .gitignore 済み。出荷物ではない。
//   テスト鍵(kid>=200)を index.html に直接書くと、Stripe のテストカードで
//   本物のライセンスが発行できるようになる（仕様書 §4.4.2）。だから本体は汚さない。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerUrl = (process.argv[2] || '').replace(/\/$/, '');
if (!workerUrl) {
  console.error('使い方: node tools/devhtml.mjs https://<worker>.workers.dev');
  process.exit(1);
}

const res = await fetch(workerUrl + '/pubkey');
if (!res.ok) {
  console.error(`/pubkey が ${res.status} を返しました。Worker のデプロイとシークレット設定を確認してください。`);
  process.exit(1);
}
const { kid, snippet } = await res.json();
if (kid < 200) {
  console.error(`kid=${kid} は本番鍵です。テスト用 Worker（kid>=200）を指定してください。`);
  process.exit(1);
}

const src = readFileSync(join(root, 'index.html'), 'utf8');
const anchor = '    const LICENSE_PUBKEYS = {\n';
if (!src.includes(anchor)) {
  console.error('index.html に LICENSE_PUBKEYS が見つかりません。');
  process.exit(1);
}
const out = src.replace(anchor, anchor + snippet + '\n');
writeFileSync(join(root, 'index.dev.html'), out);

console.log(`index.dev.html を作りました（kid=${kid} を埋め込み済み）`);
console.log('ローカルサーバを立てて http://localhost:8765/index.dev.html を開いてください。');
console.log('※ このファイルはテスト専用です。コミットしないでください（.gitignore 済み）。');
