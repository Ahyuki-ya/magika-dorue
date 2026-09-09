# AIプレイ実験 — 要件

Magika・Dorue を AI（Claude Sonnet）に実際にプレイさせ、プレイ記録をまとめる仕組みの要件。
ユーザーが隙間時間に指示を出すと、規定の**実時間**だけプレイして記録を残す。

## この実験で知りたいこと（ユーザー確定）

1. **バランスの数字** — 到達wave・収支・兵力推移。[引き継ぎ_2026-08-17.md](引き継ぎ_2026-08-17.md) の
   「⚠ 未検証：バランス」を埋める
2. **不具合・詰みの発見** — 例外・進行不能・想定外の状態
3. **人間らしい攻略の発見** — 「このビルドが強い」「この順に解放すべき」

**「面白いか・分かりにくいか」の体験レビューは対象外**（ユーザーが選択から外した）。
これは重要で、**実ブラウザで画面を見る必要がない**ことを意味する。全部ヘッドレスで回せる。

---

## 1. 実行環境：ヘッドレス（Node）一択

`test/p5/harness.js` が `index.html` の最初の `<script>` を抜き出し、DOMスタブ＋決定的LCG上で
`(0, eval)` する。実測したコスト（このMac）:

| | 実時間 |
|---|---|
| コロシアム フル1ラン | **6〜14秒**（≈ 0.24秒/wave・実時間の70〜100倍速） |
| `sim`（1000tick） | 0.13 秒 |

**実時間30分の枠で数百ラン回せる。** ブラウザ＋スクリーンショットで1ランやるより3桁安い。
**シミュレーション速度はボトルネックにならない。LLMのレイテンシが支配的。**

### 🔴 大前提：ドライバは必ず `epilogue_*.js` として書く

`(0, eval)` は**グローバルスコープ**で評価される。JSの仕様上、

- `function` 宣言 → `globalThis` に乗る → **外から呼べる**
- **`let` / `const` 宣言 → eval専用の宣言的環境に入り、`globalThis` に乗らない**

つまり `gold` / `monsters` / `heroes` / `castleHp` / `map` といった**状態変数は、
同一 eval に連結された `epilogue_*.js` からしか読めない。** `harness.js` 側から後付けで
`(0,eval)('gold')` しても届かない（別の環境レコードになる）。

`dev/screens.html` が `w.enterGameScreen(...)` のように**関数しか触っていない**のはこの制約のため。
**AIドライバの本体は必ずエピローグ側に置く。**

### 既にある土台

| ファイル | 何が使えるか |
|---|---|
| [epilogue_colosseum.js:533](test/p5/epilogue_colosseum.js) `runArena()` | **フル1ランの駆動器。** `enterGameScreen` → `dig` → `placeCastle` → waveループ。ひな型そのもの |
| [epilogue_hard.js:237](test/p5/epilogue_hard.js) `runHard()` | **唯一「方策」の概念がある**（`policy:'reinvest'` が波の合間に再投資）。ベースラインの比較対象に最適 |
| [epilogue_balance.js](test/p5/epilogue_balance.js) / `epilogue_econ.js` | 解析式でDPS・必要体数・収支を出す。AIに渡すヒントの土台 |

時間を進める中核（`epilogue_colosseum.js:576-586`）:

```js
const step = (frames) => {
  for (let t = 0; t < frames; t++) {
    HARNESS.setClock(HARNESS.getClock() + FI);
    lastFrameTime = HARNESS.getClock() - FI - 1;   // ★ gameLoop 冒頭の間引きを素通りさせる
    gameLoop(HARNESS.getClock());
    if (castleHp <= 0) return false;
  }
  return true;
};
```

`rafQueue` は**消化していない**。`gameLoop(ts)` を直接呼ぶ。

---

## 2. 設計の核：AIを内側のループに入れない

ゲームは45fps。1フレームごとにLLMに判断させると1ランで数万ターンになり成立しない。

> **AIは「方策」を書く。ドライバがそれをヘッドレスで全速力で走らせ、軌跡を返す。
> AIは軌跡を読んで方策を直し、また走らせる。**

LLMの1ターン ＝ 1ラン以上。Sonnet で数百ラン回してもトークンが現実的な量に収まる。
そして3つの目的すべてに効く:

| 目的 | この形でどう効くか |
|---|---|
| バランスの数字 | 方策を固定して条件だけ振れば、既存の実測表と同じ形の比較表が出る |
| 不具合・詰み | 長時間・多数ランで例外と進行不能を拾う（§3-4の停止判定） |
| 攻略の発見 | **方策を書き換えて到達waveが伸びるかを繰り返す＝探索そのもの** |

### 🔴 この形を選ぶ最大の理由：非同期にすると時限爆弾が起きる

**`harness.js` は `global.setTimeout` / `global.setInterval` を潰していない。**
（`windowStub.setTimeout(){ return 0; }` は `window.setTimeout` としてしか効かない）

ゲーム本体は素の `setInterval` を呼ぶ — `colStartPrep()` の準備カウントダウン、
`startHeroCountdown()` の次wave予告。**エピローグが完全同期で走っている今は
イベントループが空かないので発火しない。**

> **LLMに問い合わせて `await` した瞬間に、本物の1秒タイマーが火を噴いて
> `colSpawnWave()` や `spawnHero()` が壁時計で走り出す。**

同期の「方策を渡して全速力で走らせる」形なら**この問題が一切起きない**。
非同期の対話的プレイ（§2補足）をやるなら、`HARNESS.getClock()` に連動する
フェイクタイマーの新設が**前提条件**になる。

### 補足：ステップ実行モード（第2段階・コスト高）

「waveごとに状況を見て次の一手を決める」対話的な実行。攻略の当たりをつける段階や、詰みの再現に使う。
**ただし上のフェイクタイマーに加えて、`(0,eval)` の戻り値を `await` する harness 改造が要る**
（現状は同期に呼んで戻り値を捨てている）。**第1段階では作らない。**

---

## 3. 作るもの

```
test/p5/epilogue_agent.js    # 新規。同一evalに連結される側＝ここが本体
test/p5/agent/               # CLI・方策・結果の置き場（epilogue から読む必要はない）
  policies/                  # ベースライン方策
  runs/                      # 結果 JSON（.gitignore 対象にするか要判断）
```

`test/p5/harness.js` は**第1段階では変更しない**（回帰テストの土台なので触ると全部に影響する）。
ただし §3-5 の2点だけは harness 側の小改造が要る。

### 3-1. 行動 API（ラッパを新規に作る）

**現状、行動関数はすべて `{offsetX, offsetY}` を要求し、タイル座標版が存在しない。**
全エピローグが `dig({ offsetX: x*TILE_SIZE+1, offsetY: y*TILE_SIZE+1 })` を手書きしている。

**さらに `dig()` は常に `undefined` を返す。失敗理由は `msgDiv.innerText` に日本語で出るだけ。**
（既存エピローグは `monsters.length` の増減で成否を推定している）

→ **`{ok, reason, cost, spawned}` を返す薄いラッパをエピローグ側に作る**（ゲーム本体には足さない）:

| ラッパ | 中身 | 前提条件 |
|---|---|---|
| `digTile(x,y)` | `dig(ev)` | `isGameRunning` ／ 通常は城から `DIG_RANGE_BELOW_CASTLE` 以内 ／ コロシアムは `monsters.length < COL_ARMY_CAP` ／ タイルが `1,2,6,7,8` ／ **上下左右のいずれかが `isPassable`** ／ `gold >= 1` |
| `placeCastleTile(x,y)` | `placeCastle(ev)` | `map[y][x]===0` ／ 門または入口から到達可能 ／ 初回0G・以降50G |
| `rallyTile(mt,x,y)` | `colToggleRallyMode(mt)` → `colHandleRallyClick(ev)` | コロシアムのみ。**`colHandleRallyClick` は唯一 boolean を返す** |
| `levelUpSafe(mt)` | `levelUp(mt)` | `monsterLevels[mt] < monsterCap[mt]` ／ `gold >= goldCostFor(lv)` |
| `buyBreedNode(key, live)` | そのまま | 親ノード解放済み ／ `requires` ／ 💎残高。**`live=true` がラン中** |
| `retreatCashOut()` | そのまま | `confirm()` はスタブが常に true を返すので**無人で撤退できる** |

⚠ `live` 経路と非live経路で**通貨源が違う**（ラン中の `diamond` か `magika_diamond` の残高か）。

### 3-2. 合法手の列挙 `legalActions()`（新規）

**現状「今掘れるタイル一覧」を返す関数が無い。** AIに無効手を延々と出させないために要る。

- 掘れるタイル（隣接制約 ＋ gold ＋ 軍上限 ＋ タイル種）
- 上げられる種別（Lv上限とゴールドを満たすもの）
- 置ける城の位置
- 買えるショップ／交配ノード

### 3-3. 観測 `observe()`（新規）

**「プレイヤーが画面で見えている情報」を仕様にする。** HUD更新関数が読んでいる変数がそのまま定義になる
（`updateGoldUI` / `updateHeroStatsUI` / `updateLevelPanel` / `updateColArmyUI` / `updateColWaveUI` /
`updateColPrepUI` / `updateColRepairBtn`）。

`monsters` を全部JSONで出すとトークンが飛ぶので**要約**にする:

- 資源: `gold` / `diamond` / `castleHp`/`COL_CASTLE_HP`
- 戦力: 種別ごとの `{成体数, ちび数, Lv, 上限}`（16種あるが**0体の種は省く**）／`fertile` 数
- 盤面: 21×21 の文字グリッド（通路・鉱石種・宝石・城・門・指令旗）／深度／`colOpenGates()`
- 敵: `colWave` / `colNextInfo`（次wave の体数・ボスの有無）/ `colPrepRemaining` / 勇者の位置と残HP
- 解放状況: `shopData` / `breedData`（解放済みノードのみ）
- **`msgDiv.innerText`** — 直前の行動へのゲームからの返答が日本語で入っている
- 先読み: `colWaveHeroCount(w)` / `colHeroPowerAt(w)` は**決定論なので次wave以降を予測できる**

### 3-4. 停止判定（不具合・詰みの検出）

**これが「不具合・詰みの発見」の本体。** 以下を異常として記録し、そのランを停止する:

- 例外が投げられた（**`gameLoop` の繁殖ループは `try/catch` で握り潰す箇所がある**のでドライバ側で拾う）
- 一定フレーム進めても `gold` / `colWave` / `monsters.length` / `castleHp` が**どれも変化しない**（進行不能）
- モンスター数が性能予算（80〜100体）を大きく超えた
- **`fertile` な成体が増え続けて減らない**（前セッションで実際に起きた不具合の形。教訓③）
- ちびが生まれ続けて成体にならない
- 到達waveが打ち切り上限に達した（＝壊れ性能。これも「発見」）

⚠ **ゲーム本体に wave 上限は無い。** `runArena` の `maxWave:60` と「1wave 90秒」はテスト側の打ち切り。

### 3-5. harness.js に要る最小の改造（2点だけ）

第1段階でもこの2つは避けられない:

1. **`HARNESS.reseed(s)`** — 現状シードは起動時1回きり。N ラン回して統計を取るのに要る
2. **`rafQueue` の掃除** — `gameLoop` 末尾が毎フレーム `requestAnimationFrame` を push するのに
   誰も消化しない。**長時間ランで際限なく伸びてメモリを食う。** step 内で `rafQueue.length = 0`
   を叩くか、no-op に切り替えるオプションを足す

`localStorage` はメモリ実装なので `clear()` でラン間初期化できる（`runArena` が既にそうしている）。
ただし `raiseCapDiamond` / `buyShopItem` は**即座に永続化する**ので、恒久アンロックを扱うなら
**セーブのスナップショット／リストア**が要る。

### 3-6. 決定性とシード

`HARNESS.lcg` は決定的。**シードを結果に必ず記録する**こと。同じシード＋同じ方策で同じ結果が出ることを
最初に確認する（ここが揺れるとすべての比較が無意味になる）。
比較は**複数シードの中央値**で見る（1シードの当たり外れで判断しない）。

---

## 4. 起動のしかたと時間の区切り

```
/play 30m                       # 30分だけ回して記録をまとめる
/play 30m --focus balance       # 何を知りたいかを指定
/play 30m --mode colosseum
```

- スキル（`.claude/skills/`）として置き、`/play` で呼べるようにする
- 時間は**壁時計で区切る**。残り時間を見ながらランを積み、**尽きたら必ず記録を書いて終わる**
  （書きかけで落ちないよう、ランごとに逐次 `runs/` へ追記する）
- モデルは **Sonnet**。方策の生成と軌跡の読解が仕事で、深い推論は要らない
- **トークンの上限も切れるようにする**（実時間だけだと、失敗ループで浪費しうる）

---

## 5. 出力：プレイ記録

`AIプレイ記録_<日付>.md` に、以下を必ず含める:

1. **条件** — 日付・実時間・ラン数・シード・対象モード・`index.html` のコミットハッシュ
2. **戦績表** — 既存の実測表と**同じ形**にする（`runArena` の戻り値がそのまま列になる）

   | 方策 | モンスターLv | 交配の解放 | 初期兵力 | 到達wave | 同時最大 | 繁殖の総数 | 結果 |
   |---|---|---|---|---|---|---|---|

3. **見つけた攻略** — 何を変えたら何waveから何waveになったか。**因果を1つずつ切り分けたものだけ**書く
4. **見つけた不具合・詰み** — **再現するシードと方策を必ず添える**
5. **数字にならなかった所感** — 「これは変では」と思ったこと。**推測であることを明記させる**

⚠ **AIに「面白かった」を語らせない。** 体験レビューは今回の対象外で、ヘッドレスでは
そもそも見えていない。**見ていないものについて書かせない**のが、この記録を信用できるものにする要。

---

## 6. 最初に測るべきこと

[引き継ぎ_2026-08-17.md](引き継ぎ_2026-08-17.md) の「⚠ 未検証：バランス」がそのまま最初の題目:

1. **交配を解放した状態と、していない状態の到達waveの差**
2. **銅レイス** `wraith+golem`（攻 base3/slope1.2 に HP base4/slope1.4 と索敵12 が乗る）の終盤性能
3. **シャドウゴーレム** `golem+wraith`（硬いまま攻撃 slope 0.5→1.2）
4. **交配確率60%＋fertile供給増で、繁殖の総量そのものが増えていないか**
5. **深き継承（💎40）が実際に効く組はどれか**（max を取るので何も動かない組がある）

既存の実測（現行 `index.html`・交配なし）が比較の基準になる:
Lv20・1門・r4 で **到達31wave**、指令=門との中間で **60wave完走**。

---

## 7. 落とし穴（先に知らないと必ず踏む）

| # | 落とし穴 |
|---|---|
| 1 | **`let`/`const` は `globalThis` に乗らない。** ドライバは必ずエピローグ側 |
| 2 | **`global.setTimeout`/`setInterval` が潰されていない。** `await` を入れた瞬間に本物のタイマーが発火する |
| 3 | **`rafQueue` が無限に伸びる。** 長時間ランでメモリを食う |
| 4 | **`activeMtypes()` の配列長が乱数消費に直結する。** 交配の「解放あり／なし」は同じシードでも別の乱数列になる。**複数シードの中央値で見ること** |
| 5 | **`gold = 100000` は資金繰りを消す。** `runArena` は掘削コストを対象外にするためそうしている。資金繰り込みで測るなら開始20Gから（これ自体が未検証項目） |
| 6 | **早送り（`isFastMode`）は勇者の攻撃レートも上がる。** 城HPの評価が変わるので条件に含めるか固定するか決めておく |
| 7 | **`dig()` は成否を返さない。** ラッパで `{ok, reason}` を作る |
| 8 | **`localStorage` はラン間で汚染される。** `raiseCapDiamond` / `buyShopItem` は即永続化する |
| 9 | **リザルトDOMは rAF ベースでまず0を書く。** 戦績は**DOMではなく変数から直読み**する |
| 10 | **indirect eval 下では `require` が使えない。** Node18+ のグローバル `fetch` と `process` は使える |
| 11 | **`test/p5/harness.js` を安易に触らない。** 回帰テストの土台 |

---

## 8. 先に決めておくこと

- `runs/` の生成物を git に入れるか（入れないなら `.gitignore` へ）
- **standard / hard にも `runArena` 相当が要る**（現状あるのはコロシアム用のみ。`epilogue_hard.js` の
  `runHard()` が近い）。**最初はコロシアムだけで始めるのが早い** —
  記録が比較可能になるよう設計されたモードなので、攻略の発見にも一番向いている
- ベースライン方策（ランダム／貪欲／`epilogue_hard.js` の reinvest）を先に固めるか。
  **AIの手が良かったのかを言うには比較対象が要る**
