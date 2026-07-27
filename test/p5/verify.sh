#!/bin/zsh
# 等価性検証ハーネス
# 使い方: test/p5/verify.sh [対象index.html] [比較基準のgit ref]
#   対象     省略時 = リポジトリ直下の index.html
#   比較基準 省略時 = HEAD（＝直前のコミットに対して挙動が変わっていないかを見る）
# 対象と基準で経路探索オラクル(path)・全軌道(sim)を走らせ、完全一致を判定する。
#
# 使い分け:
#   ・純最適化・リファクタ・UI追加 → path も sim も一致すること（これがリグレッションガード）
#   ・バランス調整など「意図して挙動を変える」変更 → sim は不一致になるのが正しい。
#     その場合でも **path（経路探索の一手）は一致すべき**。経路ロジックを壊していない証拠になる。
#     経路探索の黄金ハッシュ a72aec6f は Phase 5 以降ずっと不変（`verify.sh index.html 89ca12a` で確認できる）。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
TARGET="${1:-$ROOT/index.html}"
BASE_REF="${2:-HEAD}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$ROOT" show "$BASE_REF:index.html" > "$TMP/baseline_index.html"

echo "== 構文チェック (node --check) =="
node -e '
const fs=require("fs"),vm=require("vm");
const h=fs.readFileSync(process.argv[1],"utf8");
const m=h.match(/<script>([\s\S]*?)<\/script>/);
if(!m){console.error("no script");process.exit(2);}
try{ new vm.Script(m[1]); console.log("  OK 構文"); }catch(e){ console.error("  NG 構文:",e.message); process.exit(1);}
' "$TARGET"

run(){ node "$DIR/harness.js" "$1" "$2"; }
GP=$(run "$TMP/baseline_index.html" path); TP=$(run "$TARGET" path)
GS=$(run "$TMP/baseline_index.html" sim);  TS=$(run "$TARGET" sim)

FAIL=
echo "== 経路探索オラクル (path) =="; echo "  gold  : $GP"; echo "  target: $TP"
[ "$GP" = "$TP" ] && echo "  ✅ 一致" || { echo "  ❌ 不一致"; FAIL=1; }
echo "== 全軌道 (sim) =="; echo "  gold  : $GS"; echo "  target: $TS"
[ "$GS" = "$TS" ] && echo "  ✅ 一致" || { echo "  ❌ 不一致"; FAIL=1; }

echo "== div開閉バランス =="
node -e 'const fs=require("fs");const h=fs.readFileSync(process.argv[1],"utf8");const o=(h.match(/<div\b/g)||[]).length,c=(h.match(/<\/div>/g)||[]).length;console.log("  <div>="+o+" </div>="+c+(o===c?" ✅":" ❌"));if(o!==c)process.exit(1);' "$TARGET"

[ -n "$FAIL" ] && { echo "RESULT: ❌ FAIL"; exit 1; } || echo "RESULT: ✅ PASS"
