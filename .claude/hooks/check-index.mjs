#!/usr/bin/env node
// index.html を編集した直後に走る最小チェック。
// test/p5/verify.sh の「速い部分」＝ <script> の JS 構文と <div> の開閉バランスだけを見る。
// 等価性検証(path/sim)は数秒かかるので hook には入れない。従来どおり verify.sh を手で回す。
//
// 正典が index.html 1枚しかない構成なので、壊れた編集をそのまま積み上げると
// 復旧が git 頼みになる。編集した瞬間に気づけることだけをここで担保する。
import fs from "node:fs";
import vm from "node:vm";

let file;
try {
  const payload = JSON.parse(fs.readFileSync(0, "utf8"));
  file = payload.tool_response?.filePath ?? payload.tool_input?.file_path;
} catch {
  process.exit(0); // stdin が読めない/JSON でない場合は黙って通す
}

// リポジトリ直下の index.html 以外（test/, dev/, archive/ など）は対象外
if (!file || !/(^|\/)index\.html$/.test(file) || /\/(archive|dev|test)\//.test(file)) process.exit(0);

let html;
try {
  html = fs.readFileSync(file, "utf8");
} catch {
  process.exit(0);
}

const errors = [];

const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  errors.push("<script> ブロックが見つからない（ファイルが壊れている可能性）");
} else {
  try {
    new vm.Script(m[1]);
  } catch (e) {
    errors.push(`JS 構文エラー: ${e.message}`);
  }
}

const open = (html.match(/<div\b/g) || []).length;
const close = (html.match(/<\/div>/g) || []).length;
if (open !== close) {
  errors.push(`<div> の開閉が不一致: <div>=${open} </div>=${close}`);
}

if (errors.length) {
  console.error(
    `index.html ガードレールが問題を検出しました:\n- ${errors.join("\n- ")}\n` +
      "直前の編集を修正してください。復旧が必要なら `git diff index.html` で差分を確認できます。"
  );
  process.exit(2); // PostToolUse の exit 2 = ブロッキングエラー。stderr が Claude に返る
}
