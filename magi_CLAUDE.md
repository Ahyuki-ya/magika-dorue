# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Magika・Dorue** — a single-file browser dungeon-defense game where the player acts as a demon lord. The player digs stone tiles to spawn monsters, places a demon castle, and defends against waves of increasingly powerful heroes.

No build tools, no dependencies, no server required. Open any `.html` file directly in a browser to play.

## Versioning Convention

> **2026-07-24 更新:** リポジトリを git 化し GitHub リモート（`Ahyuki-ya/magika-dorue`, public）に接続。バージョン管理は git に一本化した。

**`index.html` が唯一の正典（作業ファイル兼公開ファイ）。** これを直接編集し、コミット＆プッシュする。GitHub Pages が自動で公開する（https://ahyuki-ya.github.io/magika-dorue/ ）。以前の「手動アップロード」「コピーして番号を上げる」運用は廃止。

- 意味のある変更ごとに `index.html` を編集 → `git commit` → `git push origin main`
- スナップショットは git 履歴が担う。ファイルを複製して番号を増やす必要はない
- 過去の `magiNN.html` / 名前付き変種 / `magi_claudN.html` はすべて **`archive/` に退避**（バックアップとして git 追跡下に残す。編集しない）
- `index.html` の内容系譜: かつての `magi_claud.html → … → magi_claud6.html` を経て、現行 `index.html` は `magi_claud6.html` 相当

> **Roadmap:** 大型改修の要件ドラフトは [FABLE_要件定義_大型改修.md](FABLE_要件定義_大型改修.md)。①ハードモードのレバレッジ化＝**Phase 1 実装済み**（2026-07-24, 下記 Recent Session Changes 参照）。②レア度付き宝物＋インベントリ＋時価売却／③取引コード／④オンライン市場は未着手。設計思想の全経緯はメモリ `leverage-design.md`。

## Architecture

Everything lives in a single `.html` file: CSS in `<style>`, logic in `<script>`, no external files. (~2127 lines as of latest session)

### Screen Flow
Three `<div class="screen">` sections toggled via `display: flex/none`:
1. **startScreen** — title + carry-over display + mode selection
2. **gameScreen** — main play area (canvas + level-up panel)
3. **gameOverScreen** — results + return to title

### Map System
`map[][]` is a 2D grid (20 cols × dynamic rows, `TILE_SIZE = 30px`):
| Value | Tile | Behavior |
|---|---|---|
| 0 | Empty | Passable |
| 1 | Stone | Dig → spawns slime (costs 1G) |
| 2 | Moss stone | Dig → spawns goblin (costs 1G) |
| 3 | Dungeon entrance ceiling | Impassable |
| 4 | Sky | Passable, heroes start here |
| 5 | Demon castle | Player's base; game over when destroyed |
| 6 | Copper ore | Dig → spawns golem (costs 1G) |

Ore density is controlled by `oreProbAt(y)`:
```javascript
function oreProbAt(y) {
    const depth = y - (SKY_LAYERS + 1);
    const d = Math.min(1.0, depth / 200);
    return { pCopper: 0.33 * d, pMoss: 0.33 * d };
}
```
Depth 0 = 0% ore, depth 200 (y=203) = 33% copper / 33% moss / 34% stone.

Map starts at `INITIAL_ROWS = 23` and grows dynamically via `expandMap()` as the player digs. Moss propagation runs both in `generateMap()` and per-row in `expandMap()`.

### Entity System
All entities (heroes and monsters) share the same object shape:
```
{ x, y,          // grid position
  rx, ry,        // render position (lerp-smoothed at 0.22 factor)
  hp, maxHp, atk, agi,
  cd,            // action cooldown
  range,         // enemy search radius (Manhattan distance)
  isHero, color, mtype }
```

**Action resolution**: each frame, `entity.cd += Math.log2(agi + 1) * 4`. When `cd >= ACTION_THRESHOLD` (100 normally, 60 in fast mode), the entity acts (attack if adjacent enemy, else BFS move).

**Pathfinding**: optimised parent-tracking BFS (no `[...path]` spread):
- `bfsTraceback(parent, currX, currY, foundX, foundY)` — traces back through flat Int32Array
- `getNextStepTowardsCastle(entity)` — heroes/monsters → castle
- `getNextStepTowards(entity, tx, ty, monsterOnly)` — generic target
- Uses flat `Int32Array(ROWS * COLS)` with head-pointer queue (no `.shift()`)

### Monster Types
Defined in `MONSTER_STATS` with 5 levels each (Fibonacci upgrade costs: 5/8/13/21G):
- **slime** — balanced, short range (4)
- **goblin** — fast, long range (10)
- **golem** — tanky, short range (3–4)

Random upgrades (cost increases per use) add per-session stat bonuses to `randBonus[mt]`. These do **not** carry over between runs.

### Monster AI (priority order, per action)
1. **Attack** — adjacent enemy (dist ≤ 1) → attack
2. **Chase** — enemy within `range` → BFS toward enemy
3. **Fertile** — no enemy in range + `fertile === true` → BFS to castle, wait within 1 tile
4. **Random walk** — weighted by 4-tile lookahead in each direction

### Hero Scaling
Heroes arrive in waves. Each hero: `heroLevel++`, `heroPower += 1` (or +5 every 5th, +0 every 10th). Stats distributed randomly across atk/agi/hp using type-weighted rolls.

Hero types: `normal`, `attack`, `defense`, `speed`, `rage` (forced every 10th level). Rage heroes gain a bonus from `Math.floor(gold / 2.5)` and carry all equipment.

**Stuck detection**: if a hero stays at the same grid position for ≥2 seconds, it enters castle-rush mode for 5 seconds (BFS directly to castle, bypasses normal AI). Tracked via `entity.lastMoveTime`, `entity.lastX/Y`, `entity.castleRushUntil`.

Equipment modifiers: shield (+25% HP), boots (+25% agi), potion (one-time 50% HP restore at ≤30% HP). Heroes spend `heroGold` (internal, hidden from player) earned by killing monsters.

### Game Modes
Selected on the title screen; stored in `let gameMode = 'standard' | 'hard'`.

| | スタンダード | ハード |
|---|---|---|
| 勇者撃破報酬 | 固定 **25G** | `10 + floor(heroLevel/5)` G |
| 怒り勇者撃破 | **+heroGold ボーナス**（heroGoldは減らない） | なし |
| ゲーム内容 | 緩め | 現行バランス |

### Persistence (localStorage)
- `magika_carryover` — accumulated gold carried into the next run
- `magika_monsterlevels` — monster level upgrades carried into the next run
- `magika_runcount` — total number of runs

Random bonuses (`randBonus`) and hero gold (`heroGold`) and rage bonus (`rageBonus`) reset each session.

### Breeding System
**fertile フラグの付与（2ルート）:**
1. 掘削時：10% の確率で `fertile = true`
2. 勇者登場時：
   - スライム 確定2体
   - ゴブリン 確定2体
   - ランダムで1種2体（ゴーレムが選ばれることもある）

**繁殖発生（毎フレーム）:**
- ちびが種別ごと `BREED_MAX = 8` 体未満
- castle の1マス以内に同種 fertile 成体が2体以上 → 子供1体生成

**子供のステータス:** `floor((レベル基準値 + randBonus) / 2)`、最低1。`isBaby: true`、0.55倍サイズ。

**成長:** 20秒後に現在レベル＋randBonus のフルステータス成体に置換。親の個別ステータスは引き継がない。

### Rendering
Canvas draw order per frame: map tiles → monsters → heroes → particles → floating texts. Smooth movement via lerp (rx/ry updated toward grid target at 0.22 per frame). Fast mode: 60 FPS + lower action threshold.

### Mobile Support
- `<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">`
- `adjustMobileScale()`: applies `transform: scale(vw/640)` to `#gameCenter` on screens < 640px
- Touch events on canvas:
  - **掘削モード (⛏)**: 1本指=掘削, 2本指=スクロール
  - **探索モード (👁)**: 1本指=スクロール
  - モードボタンは `position: fixed` の丸ボタンとして FAB 上部に表示（モバイルのみ）
- Canvas 座標変換は `canvasOffset(clientX, clientY)` で scale 補正済み
- Level panel: モバイルでは固定底ドロワー + FABボタン (`#levelPanelFAB`)、デスクトップでは常時表示

### UI Layout
- `#heroStatsUI`: `position: absolute; top: 0; left: 0` — 勇者Lv・ステータス・深度
- `#goldUI`: `position: absolute; top: 0; right: 0` — 所持ゴールド
- `#speedBtn`: `position: absolute; top: 36px; right: 0` — 早送りトグル
- `#pauseBtn`: `position: absolute; top: 62px; right: 0` — ポーズトグル
- `#dashboard`: あくま部屋作成ボタン、凡例
- `#levelPanel`: 強化パネル (180px固定幅、スライム/ゴブリン/ゴーレム)
- `#levelPanelFAB`: モバイル用強化パネル開閉ボタン (right:16px, bottom:16px)
- `#digModeBtn`: モバイル掘削モード (right:24px, bottom:88px)
- `#exploreModeBtn`: モバイル探索モード (right:24px, bottom:136px)

## Performance Notes
- BFS は parent-tracking 方式（`Int32Array` + head-pointer queue）で最適化済み
- `[...curr.path]` スプレッドは完全に除去
- 体感スローダウンの目安: モンスター **80〜100体** 付近（主因はcanvas描画 + `shadowBlur`）
- ゴーレムの `ctx.shadowBlur` が最重の描画処理

## Recent Session Changes (2026-07-24)

作業ファイルは **`index.html`（git正典・GitHub接続済み）** に一本化。旧スナップショットは `archive/` へ退避。

### リポジトリ整理・GitHub接続
- git 化し `Ahyuki-ya/magika-dorue`（public）へ接続。`index.html` を唯一の正典（作業＆Pages公開）に。旧 magi*.html は全て `archive/`。GitHubアカウントは login `Ahyuki-ya` / 表示名 `ei721605`。

### Phase 1: ハードモードの「負債レバレッジ」化（ロードマップ①・実装済み）
> 設計思想の全経緯とλ較正方針はメモリ `leverage-design.md` 参照。数値定数はすべて後でシミュレーションで調整可。

- **モード分離**: スタンダードは**引継ぎゴールド非連動**（`enterGameScreen` で開始gold=`20+shopStartGold*15`、`triggerGameOver` で銀行不変）。レバレッジ経済は**ハード専用**。ダイヤは両モードで引継ぎ継続。
- **負債レバレッジ（証拠金取引モデル）**:
  - モード選択のハード→`#hardConfig` パネルで**借入額 D をスライダー選択**（0〜`LEV_MAX_DEBT=5000`）。L・開始ゴールド・銀行残高をライブ表示。`startHardRun()`→`enterGameScreen('hard', D)`
  - D を**開始ゴールドに注入**（`gold = 20 + shopStartGold*15 + D`）
  - **報酬倍率 L = c·√D（逓減型, `LEV_C=0.3`）** を討伐G・ダイヤ率に乗算（`levMultOf`）。逓減型の理由: 線形/逓増は全員最大借入で判断消失。逓減なら最適借入が腕(K)で決まり最大純益∝K²＝最強常に得＋選ぶ楽しさ両立
  - **複利返済 `R(t)=D·(1+r)^(t−grace)`**（`LEV_R=0.05`/wave, `LEV_GRACE=3`, t=heroLevel=ウェーブ数）。`levRepayment()`
- **🏳 撤退（利確）ボタン**（HUD常時・ハード限定, `retreatCashOut`）: 確認ダイアログで純益提示→`triggerGameOver(true)`。城陥落は強制清算。**精算 `levSettle`: ΔB = 手持ちgold − R を引継ぎ銀行へ加算（マイナス=真の負債を次ランへ持ち越し可）**
- **レバレッジHUD `#levHUD`**（返済R・純益・ゾーン表示, `updateLevHUD`）。ゾーン=ρ判定（稼ぎ時/最適点付近/赤字ゾーン）
- **2軸分離**: 深度スコア（`maxDepth`/`resDepth`/`maxDepthEver`）＝栄光・競争軸で常に深潜を称える。お金＝複利で最適利確点が存在する商人軸。同じ一掘りが栄光に＋・お金に−＝利確ジレンマ
- **ρ駆動EV負スポーン**: `levRho()=限界負債d(t)/限界稼ぎm(t)`（d=R·r既知, m=直近3ウェーブ獲得G実測=`levEarnWindow`）。`levTreasureFactor()` が ρ<0.7=素/0.7〜1.0=1→3倍/ρ>1=3→15倍で `generateRow` の宝石鉱脈(8)・闇水晶(7)湧きを変調（動的層生成に自然統合）。**期待宝価値の目安 λ·d（`LEV_LAMBDA=0.6`）＝赤字ゾーンで毎wave(1−λ)を確定搾取、宝の山は高分散クラスタで見せる**。厳密なλ較正はシミュレーション待ち
- **リザルト**: `#resLevBox`（借入D・×L・複利返済R・手持ち・純益ΔB）。撤退時は 🏳 WITHDRAWN、陥落時は 💀 表示切替
- **検証**: node構文OK・div 160/160・全参照ID/ハンドラ存在確認・DOMスタブ全ロード成功・精算/モード分離/ρカーブの数値ロジックテスト合格
- **未実装（次段）**: バランス較正（利確ジレンマの交差点を面白い深度に寄せる）／Phase2で宝石湧き口をレア度・アフィックス付き「宝物」＋インベントリ＋時価売却へ格上げ

## Recent Session Changes (2026-07-02 その4)

作業ファイル: `magi_claud6.html`（`magi_claud5.html` のスナップショットとして作成）。

### リザルト画面のはみ出し修正（倍率の動的縮小）
- **症状:** リザルト画面(`gameOverScreen`)の内容が縦に長い（統計8項目）と、`.screen` の固定高さ＋`justify-content:center` で画面外にはみ出し、`body { overflow:hidden }` により切れてスクロールもできなかった
- **修正:** `adjustResultScale()` を新設。`.result-container` の自然な高さ(`offsetHeight`)を測り、`window.innerHeight * 0.98` を超える場合のみ `transform: scale()`（`transformOrigin: center center`、下限0.4倍）で縮小して画面内に収める。`adjustMobileScale()` と同じ transform スケール方式
- 呼び出し: `triggerGameOver()` 内（`showScreenOnly` でレイアウト確定後）と `resize` イベント。非表示時は `offsetHeight===0` で何もしないため安全

### メニュー導線をゲーム内ドロワー化（プレイしながら体験）
- **狙い:** 左サイドパネル/モバイルメニューの「お買い物・その他設定」を、ゲーム画面を離れず（＝ポーズせず）展開して体験できるようにする。従来は `openSubScreen()` が全画面へ切替＋`isPaused=true` で中断していた
- **新UI: ゲーム内スライドドロワー `#inGamePanel`**（`#gameScreen` の子・`position:absolute; inset:0; z-index:200`）
  - 左からスライドイン（`@keyframes igSlideIn`）、幅 `min(400px, 92vw)`。半透明バックドロップ `.ig-backdrop`（クリックで閉じる）越しに**戦闘が進行中のまま見える**
  - ヘッダに「🛒 お買い物 / ⚙ 記録」タブと ✕ 閉じるボタン。`openInGamePanel(which)` / `switchInGameTab(which)` / `closeInGamePanel()` で制御。状態フラグ `isInGamePanelOpen` / `inGamePanelTab`
  - 呼び出し元を差し替え: 左サイドパネル・モバイル `#menuPopover` の2ボタン → `openInGamePanel()`。**メインメニュー(`startScreen`)からのショップ/設定は従来どおり全画面 `openSubScreen()`**（プレイ外なので）
- **ライブなダイヤ経済:** ゲーム内ショップは引継ぎダイヤではなく**実行中の `diamond`（HUD表示と同一）**を通貨源にする。購入時は `diamond -= cost` → `saveShop()` + `saveCarryDiamond(diamond)` で即永続化（中断コピー対策）→ `applyLiveShopEffect(key)` で即時反映（初期ゴールド=即+15G / 成長促進=`BABY_GROW_MS`更新 / 繁殖上限=毎フレーム参照で自動 / レイス=`refreshInGameUnlocks`）。ダイヤ獲得時(`updateGoldUI`)にショップ表示中なら残高・購入可否を追従再描画
- **描画関数の共通化:** `renderShop`/`renderSettings` を `renderShopInto(list, diamondEl, live)` / `renderSettingsInto(grid, list)` に分離し、全画面版（`renderShop`/`renderSettings`）とゲーム内版（`renderShopLive`/`renderSettingsLive`）が同じ描画ロジックを共有。`buyShopItem(key, live)` に `live` 引数を追加（全画面版=引継ぎダイヤ、ゲーム内版=ライブダイヤ）。`updateMuteButtons` に `igMuteBtn` を追加。`triggerGameOver` 冒頭で `closeInGamePanel()`
- **検証:** DOMスタブ上でドロワー開閉・タブ切替・ライブ購入（ゴールド即+15/ダイヤ減算/レベル加算/引継ぎ永続化）・ダイヤ不足時ガード・全画面ショップ非破壊 を確認。`node --check` 構文OK、div開閉バランス 144/144

---

## Recent Session Changes (2026-07-02)

作業ファイルの進行: `magi_claud3.html` → `magi_claud4.html` → `magi_claud5.html`（それぞれ前版のスナップショットとして作成）。

### ダイヤショップ実装（メインメニュー「お買い物」開通）
- localStorage key: `magika_shop` — `{ startGold, breedCap, growSpeed, wraith }`
- 恒久強化4種（価格はフィボナッチ準拠）:
  | 項目 | 効果 | 段階 | 価格(💎) |
  |---|---|---|---|
  | 初期ゴールド増加 | 開始所持金 +15G/段階 | 5 | 3/5/8/13/21 |
  | 繁殖上限アップ | `BREED_MAX` +2/段階 | 2 | 5/13 |
  | ちび成長促進 | 20秒→16秒→12秒 | 2 | 5/13 |
  | シャドウレイス解禁 | 第4モンスター解禁 | 1 | 21 |
- レイス解禁は**深度100到達（`magika_records.maxDepthEver >= 100`）+ 購入**の両方が条件
- 購入通貨は引継ぎダイヤ（`magika_diamond`）を直接読み書き

### 深度コンテンツ拡張
- 新タイル **7: 闇水晶** — レイス解禁時のみ生成。深度100から出現、深度300で12%上限まで線形上昇。掘るとシャドウレイス召喚
- 新タイル **8: 宝石鉱脈** — 深度20から出現（0.4%〜深度200で1.2%）。掘ると+10〜30G、10%で💎1
- 確率は `extraOreAt(y)` に分離。**既存の `oreProbAt(y)` は不変更**（先行ロールで上乗せする方式）。初期マップ(深度〜19)には影響なし
- 第4モンスター **シャドウレイス (wraith)**: 低HP・高攻撃・射程12のガラスキャノン
  - atk [3,4,5,6,8] / agi [2,2,3,3,4] / hp [1,2,2,3,3] / range 12固定
  - RAND_WEIGHTS: [4,1,1]（攻撃特化）、heroGoldGain: 3、色 `#b39ddb`
  - 強化パネル・凡例・繁殖・引継ぎレベルは解禁時のみ表示（`activeMtypes()` で分岐）
  - `magika_monsterlevels` に wraith を追加（旧データは `Object.assign` でデフォルト補完）

### ボス演出・ウェーブ強化
- 怒り勇者登場時: 警告バナー `#bossWarning`（点滅）+ キャンバス枠の赤フラッシュ + 警報SE
- 怒り勇者生存中: 専用ボスHPバー `#bossHpUI` をキャンバス上部に表示（`updateBossHpUI()` を gameLoop から毎フレーム呼び出し、表示切替は状態変化時のみDOM更新）
- 撃破時: `spawnBurst()` で大量パーティクル + 大型「BOSS 撃破!!」テキスト（`spawnFloatingText` に size 引数追加）
- 次勇者予告: カウントダウンを msgDiv から `#nextHeroUI`（heroStatsUI内）へ移動。次が10の倍数Lvなら「⚠ 次: 怒りの勇者」赤点滅

### サウンド（WebAudio・外部ファイル不要）
- オシレータ+ノイズ生成のレトロ8bit風SE 14種: dig/spawn/gem/heroKill/bossKill/bossWarn/breed/grow/levelup/castleHit/gameover/buy/error
- `playSE(name)` はミュート判定+try-catchでゲーム進行に影響させない。AudioContextはユーザー操作時に遅延初期化
- ミュートボタン（ゲーム内 top:88px + 設定画面）、localStorage key: `magika_mute`

### 実績・記録（メインメニュー「その他設定」開通）
- localStorage key: `magika_records` — `{ kills, breeds, maxDepthEver, maxHeroLevel, diamondsEarned }`
- 累計討伐/最深記録/累計繁殖/最高勇者Lv/累計ダイヤの記録チップ + 実績11種の一覧表示
- 保存タイミング: 基本はゲームオーバー時に集約。**maxDepthEver のみあくま部屋設置時に即時保存**（レイス解禁条件のリロード対策）

### ゲーム画面のメニュー導線（磨き込み）
- **デスクトップ**: 左サイドパネル `#sidePanelLeft` に「お買い物 / その他設定 / タイトルへ」の導線（モードは含めない）。タイトルの畳みボタン `#sidePanelCollapseBtn`（«）で `display:none` にし、開くハンドル `#sidePanelOpenHandle`（☰）を表示。`toggleSidePanel()` で開閉、状態を localStorage `magika_sidepanel` に保存、`enterGameScreen` で `initSidePanelState()` により復元
- **モバイル**: 左パネル非表示。左下メニューFAB `#menuFAB`（☰）+ ポップオーバー `#menuPopover` で同じ導線
- ゲーム内サブ画面アクセス（新規JS）:
  - `openSubScreen(which)`: ゲーム中なら中断状態(`wasPausedBeforeSub`)を記録して `isPaused=true`、`subScreenFrom='game'`。メニュー経由なら `'menu'`
  - `backFromSubScreen()`: `subScreenFrom` に応じてゲーム復帰 or メインメニューへ。ゲーム復帰時は中断前のポーズ状態を尊重し、`refreshInGameUnlocks()` でショップ解禁要素（レイス等）を即時反映
  - `quitToTitle()`: ゲーム中は confirm で確認後 `location.reload()`
  - `toggleMenuPopover()` / `closeMenuPopover()`: モバイルメニュー開閉
- **レイアウトのはみ出し対策**: `#gameScreen` を `overflow:auto`、`#canvasContainer` の高さを `min(600px, calc(100vh - 210px))`（モバイルは transform scale 前提で `height:600px` に上書き）、`#shopScreen, #settingsScreen` を `overflow-y:auto; justify-content:flex-start`

### 重大バグ修正：画面の横並び事故
**症状:** メインメニュー(`startScreen`)とゲーム画面(`gameScreen`)が同時に横並び表示される。
**原因:** `.screen` は `display:none/flex` の切り替えだけで排他しており `position` 指定がなく、body が `display:flex` のため `display:flex` の画面が2つあると横に並ぶ構造だった。どこか1関数でも前画面を `none` にし忘れると必ず事故る。
**修正:**
- `.screen` に `position:absolute; inset:0; z-index:1` を付与（`#gameScreen` は `z-index:2`）。複数表示状態でも「重なる」だけで崩れない
- 確実な排他制御として `showScreenOnly(id, displayMode)` を新設。`ALL_SCREENS` 配列を回して指定以外を全て `none` にする
- 全画面遷移関数を `showScreenOnly` 経由に統一: `showMainMenu` / `showModeSelect` / `showShop` / `showSettings` / `enterGameScreen` / `backFromSubScreen`(ゲーム復帰) / `triggerGameOver`
- 補足: ユーザーが指摘した「モード選択が出る」現象も、この横並び事故（メインメニュー残存）が原因で修正済み。左サイドパネルにモード選択は含まれない

### その他のバグ修正
- リザルト画面「最終所持ゴールド」項目のHTML構造破損を修復（開始タグ・ラベル欠落で孤立スパン化していた）
- `#levelPanel` 閉じ直後の余分な `</div>` を除去（div開閉バランス整合）
- **randBonus の反映漏れを統一**: `levelUp`/`levelDown` の既存モンスター反映、および掘削時の新規召喚に `randBonus` が含まれていなかった（`randomUpgrade`・繁殖成長は含んでいた）。全経路で `基準値 + randBonus` に統一
- 勇者ステータスUIの通常時カラーをレトロRPGテーマ（`#4466cc` / `rgba(0,8,32,0.92)`）に整合

### 検証
- Node による構文チェック(`node --check`) + DOMスタブ上でのトップレベル実行・ロジックテスト（鉱石分布・ショップ購入ガード・実績判定・4種強化パネル）
- 画面排他制御: showMainMenu→showModeSelect→enterGameScreen→openSubScreen→back→gameOver の全遷移で「表示画面が常に1つだけ」を確認
- 左パネル: 畳む/開く/localStorage保存/復元 のロジックテスト、div開閉バランス パス

---

## Recent Session Changes (2026-06-02)

作業ファイル: `magi_claud2.html`（`magi_claud.html` のスナップショットとして作成）

### ダイヤモンド通貨の追加
- `let diamond`, `let totalEarnedDiamond` 変数追加
- localStorage key: `magika_diamond`（ゲームオーバー時に累積引継ぎ）
- **ドロップ確率（勇者撃破時）:**
  - Standard: `min(0.01 × heroLevel, 1)` %
  - Hard（通常）: `min(heroLevel × 0.01 + 1, 5)` %
  - Hard（怒り勇者）: `min(heroLevel × 0.01 + 1, heroGold)` %（上限100%）
- UI: ゴールドの左に `💎 X` 表示（`#currencyUI` flex コンテナで並列）
- リザルト画面: 獲得ダイヤ・累積引継ぎダイヤを表示
- タイトル画面の引継ぎ表示にダイヤ数を追加
- `resetCarryOver()` で `magika_diamond` も削除

### 画面階層の変更
タイトル → メインメニュー → モード選択 の3階層に分割:
- `#titleScreen`: タイトル文字のみ + スタートボタン
- `#startScreen`: メインメニュー（ゲームをプレイ・お買い物・その他設定）
- `#modeSelectScreen`: スタンダード/ハード選択・引継ぎ表示・リセット
- お買い物・その他設定は `disabled`（準備中）
- `showMainMenu()` / `showModeSelect()` 関数追加

### UIテーマ: レトロRPG風
- 背景: 深いネイビー `#000018`
- フレーム/枠線: RPGウィンドウ青 `#4466cc`（二重枠風）
- テキスト: 白 `#f0f0f0`
- ゴールド: NESゴールド `#ffcc00`
- ダイヤ: シアン `#00ffee`
- ボタン: ダークネイビー地 + 青枠（角なし・`border-radius: 2px`）
- キャンバス枠: 二重青枠（RPGウィンドウ風 `box-shadow` で実現）
- あくま部屋タイル: 濃紺 `#1a1060` + 青枠 `#4466cc`
- タイトル: 白文字 + 青いドロップシャドウ `3px 3px 0 #000066`

---

## Recent Session Changes (2026-05-16)
- タイトルから「γ版」を削除 → **Magika・Dorue**
- 鉱石分布を `oreProbAt(y)` に統一（全行で線形連続）
- 深度表示をあくま部屋の実深度に修正
- magi_claud1.html から引継ぎ: 引継ぎ回数・rageBonus・可変英雄撃破報酬
- ポーズボタン追加 (`isPaused` フラグ)
- モバイル対応: viewport meta、タッチ操作、レイアウトスケーリング
- 強化パネル: モバイルで底ドロワー、デスクトップで常時表示
- 掘削/探索モードボタン追加（モバイルのみ表示）
- タイトル画面: スタンダード/ハードモード選択に変更
- スタンダードモード: 撃破報酬25G固定、怒り勇者撃破で+heroGoldボーナス
- BFS最適化: `[...curr.path]` → parent-tracking方式（約100倍軽量化）
- 勇者スタック検出: 2秒停滞→5秒城直行モード
- 繁殖: 勇者登場時にスライム・ゴブリン各2体を確定fertile化
