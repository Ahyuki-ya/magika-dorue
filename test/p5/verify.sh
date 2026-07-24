#!/bin/zsh
# Phase 5 等価性検証ハーネス
# 使い方: test/p5/verify.sh [対象index.html] [黄金基準のgit ref]
#   対象     省略時 = リポジトリ直下の index.html
#   黄金基準 省略時 = 89ca12a（Phase 5 直前のコミット）
# 対象と黄金基準で経路探索オラクル(path)・全軌道(sim)を走らせ、完全一致を判定する。
# 「挙動を1ビットも変えない」純最適化のリグレッションガード。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
TARGET="${1:-$ROOT/index.html}"
BASE_REF="${2:-89ca12a}"

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
