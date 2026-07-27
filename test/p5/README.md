# Phase 5 等価性ハーネス

経路探索・時間系の保守的最適化（Phase 5, magi_CLAUDE.md「その8」）が**挙動を1ビットも変えていない**ことを機械照合するテスト。単一HTMLの `<script>` を抽出し、DOMスタブ＋決定的LCG上で実行する。

## 実行
```sh
test/p5/verify.sh                 # リポジトリ直下 index.html を Phase 5 直前(89ca12a)と照合
test/p5/verify.sh path/to.html    # 対象を指定
test/p5/verify.sh path/to.html <ref>  # 黄金基準のコミットを指定
```
Node 18+ 必要。`✅ PASS` なら経路探索の一手・全軌道・乱数消費が baseline と完全一致。

## 構成
- `harness.js` — DOMスタブ・LCG・時計制御。`node harness.js <html> <mode> [seed]`。mode = `path|sim|pause|perf`。
- `epilogue_path.js` — 経路探索オラクル。40マップ×全開始セル×掘削2ラウンドの一手をハッシュ化（保存則1の中核）。
- `epilogue_sim.js` — 手組みシナリオを1000tick駆動し全エンティティ(x,y,hp,cd)＋乱数消費回数をハッシュ化（統合レベル）。
- `epilogue_pause.js` — P5-6 ポーズ修正の正当性（ポーズ中 gameTime 凍結）。
- `epilogue_perf.js` — 深度25 vs 250 の経路探索コスト比（深度非依存の実測）。
- `epilogue_trade.js` — **Phase 3 取引コード（道A）の単体検証**。`node harness.js ../../index.html trade` で52項目。形式/チェックサム/ホワイトリスト/二重受領/所持上限/traded隔離/UI経路スモーク。`failed: 0` を維持すること。
- `epilogue_forge.js` — **宝具のレベル・鍛錬・昇格の検証**（`... forge`）。49項目。Lv補正の値／ランク別上限／経験値設計（全ランクで同ランク10個＝Lv MAX）／鍛錬の拒否条件／昇格の条件・継承・**消費はLv昇順**／UI経路スモーク。`table` に各ランクの必要経験値が出る。
- `epilogue_kind.js` — **宝具の系統（アーキタイプ）の検証と出現率の実測**（`... kind`）。18項目。アイコンと名前のペア整合／系統別の効果出現率／進化の同系統優先／旧セーブ救済。`measured` に系統別の実測%が出るのでバランス調整に使える。
- `epilogue_design.js` — **Phase 4 デザイン強化の検証**（`... design`）。26項目。タイルプリレンダが起動時1回かつ乱数非消費／深度トーンの単調性と上限／描画ループにグラデ・パターン・`shadowBlur` が無いこと（性能予算 D-2/D-3）／外部リソースなし（D-1）／全レア度のクラスとバッジ（D-4）／描画とリザルト演出で例外なし。**canvas描画やCSSを足したらここを緑に保つ。**

## 黄金基準ハッシュ（Phase 5 直前 = 89ca12a）
- path: `a72aec6f`（19926サンプル）
- sim : `f554277b` / rngCount 458
