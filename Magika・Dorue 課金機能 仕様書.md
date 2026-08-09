# Magika・Dorue 課金機能 仕様書

**対象**: サポーターパック / 広告off
**版**: v1.1
**最終更新**: 2026-08-09

> **v1.1 の位置づけ**: 実装（`worker/` · `tools/` · `index.html` のライセンス層 · `test/p5/epilogue_license.js`）が
> 済んだ状態に合わせて記述を確定させた版。コードと本文が食い違ったらコードが正しい。
> 主な変更は §11 の一覧を参照。

---

## 1. スコープと前提

### 1.1 対象範囲

本仕様書は Magika・Dorue における有料機能（サポーターパック、広告off）の設計を定める。ゲームプレイのバランス・進行に関わる仕様は対象外。

### 1.2 決定事項（本仕様の前提）

| 項目 | 決定 | 理由 |
|---|---|---|
| 課金対象 | ビジュアル・音楽等の cosmetic のみ | ゲーム性能への影響を排し、P2W とバランス設計汚染を回避 |
| ゲーム内通貨 | **導入しない**。アイテム/機能を直接販売 | 資金決済法上の前払式支払手段への該当を回避 |
| ランダム排出 | **導入しない** | 景表法（ガチャ規制）・賭博性の論点を回避 |
| 課金形態 | 買い切り（非消費型・永続） | 実行時サーバを不要にできる |
| 認証 | **なし**（ベアラトークン方式） | ログイン基盤・DB が不要になる |
| インフラ | Cloudflare Workers | 実行時サーバ不在、購入時のみ起動 |
| ホスティング | ゲーム本体は GitHub Pages のまま | 既存制約（単一 HTML / ビルドツールなし）を維持 |
| 署名鍵 | **本番とテストで別鍵・別 kid**（本番=1 / テスト=200） | 同一鍵だと Stripe のテストカードで本物のライセンスが発行できてしまう |

### 1.3 維持される既存制約

- ゲーム本体は単一 HTML ファイル
- ビルドツール不使用、CDN 依存なし
- localStorage による永続化
- GitHub Pages 互換

**課金機能はこれらの制約を破らない。** 公開鍵は HTML に直書きし、検証は WebCrypto（ブラウザ標準）のみで完結する。

### 1.4 明示的な非目標

- **不正利用の完全防止**: cosmetic の実体はクライアントに配信される以上、DevTools による解放は原理的に防げない。cosmetic のために DevTools を開く層は課金しないため、実売上の毀損は軽微と判断する。**この防御に工数を割かない。**
- **デバイス単位のライセンス管理**: トークンは譲渡可能なベアラトークンとする。広範に共有された場合は失効（§4.6）で対処する。

---

## 2. 全体アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│ 購入時のみ動作（Cloudflare Workers）              │
│                                                  │
│  Stripe Payment Link                             │
│         │ 決済完了 → success_url へリダイレクト   │
│         ▼                                        │
│  Worker /success?session_id=cs_xxx               │
│         │ 1. Stripe API でセッション検証           │
│         │ 2. payment_status === 'paid' を確認     │
│         │ 3. 秘密鍵でトークンを署名生成             │
│         ▼                                        │
│  受け取りページ（コード表示 + コピーボタン）        │
└─────────────────────────────────────────────────┘
                    │ ユーザーがコピペ
                    ▼
┌─────────────────────────────────────────────────┐
│ 常時（GitHub Pages · 静的）                       │
│                                                  │
│  ゲーム本体 HTML                                  │
│    公開鍵（埋め込み）で署名検証                    │
│         ▼                                        │
│    localStorage に保存 → 以降オフラインで動作      │
└─────────────────────────────────────────────────┘
```

### 2.1 設計の要点

- **DB・KV・ストレージを一切使用しない。** ライセンスの実体は署名付き文字列そのものであり、サーバ側に保存する状態がない。
- **Worker の呼び出し回数は購入数と同じ。** 月間数十回のオーダーであり、Cloudflare 無料枠（100,000 req/日）に対して無視できる。
- **受け取りページを Worker 自身が返すことで CORS が発生しない。** ゲーム本体（GitHub Pages）は Worker と通信しない。
- **トークンは冪等に生成される**（§5.3）。同じ success_url を再訪すれば同一のトークンが再取得できるため、コード紛失時の一次的な救済手段になる。

---

## 3. 商品構成

| ID | 名称 | 価格 | 内容 | flags |
|---|---|---|---|---|
| `adfree` | 広告オフ | ￥500 | 広告非表示 | `0x01` |
| `supporter` | サポーターパック | ￥1,500 | 広告オフ + サポーター表記 + 専用テーマ | `0x07` |
| `supporter_pwyw` | サポーターパック（任意金額） | ￥1,500〜 | 同上 | `0x07` |

### 3.1 価格設計の根拠

個人開発の支援モデルでは、少数の高額支援が売上の大半を構成する。￥500 のみでは上振れを拾えず、高額帯のみでは母数が取れないため、**下限（機能的対価）+ 支援帯 + 任意金額** の3構成とする。

`supporter_pwyw` は Stripe の `custom_unit_amount`（最低額 1,500）で実装する。

### 3.2 サポーター特典

1. **ゲーム内クレジット表記** — 記録画面にサポーター名を掲載。実装コストがほぼゼロで支援動機を最も強く押すため、**初回リリースに必ず含める**
2. **専用カラーテーマ** — `:root` の CSS 変数を上書きする（実装済み: `SUPPORTER_THEME` / `applySupporterTheme()`）
3. **専用 SE テーマ** — WebAudio オシレータのパラメータセット差し替え（未実装）

cosmetic は「パレット + 波形パラメータのセット = 1テーマ」を最小単位として定義し、低コストで量産できる形にする。

#### 3.2.1 テーマの効き方についての実測（v1.1 で判明）

「パレット定数の差し替えで済む」という v1.0 の見積もりは**外れている**。`index.html` の色指定を実測すると:

| 場所 | `var(--c-*)` 参照 | 生の hex | rgba() |
|---|---|---|---|
| `<style>` | 33 | 275 | 82 |
| body のインライン style | 24 | 72 | — |

さらに `--c-bg` / `--c-bg-game` / `--c-frame-dim` / `--c-text-faint` は**参照回数 0**（宣言されているだけの死んだ変数）。
変数を使っているのは後から足した UI（宝具庫・取引・コロシアム・サポーター欄）に偏っており、
**中核 UI とゲーム盤面（canvas はリテラル色）はテーマ切替の影響を受けない。**

したがって:

- テーマ機構そのものは実装・テスト済みで正しく動く（`epilogue_license.js` の 6d/6e/6g）
- ただし**現状で切り替わるのは画面の一部だけ**。売り物にするなら、先に約 350 箇所の色を変数へ寄せる作業が要る
- **初回リリースの cosmetic は「クレジット表記」だけにするのが妥当。** テーマは変数化を済ませてから2弾目として出す
- 変数化は挙動を変えない純粋なリファクタなので、`test/p5/verify.sh` の path/sim 一致で安全に進められる

---

## 4. ライセンストークン仕様

### 4.1 形式

```
MD1.<payload_b64url>.<signature_b64url>
```

- 区切り文字はピリオド（`.`）
- base64url、**パディングなし**（`=` を含まない）
- 全長: 4 + 20 + 1 + 86 = **111 文字**
- 大文字小文字を区別する

**例**
```
MD1.AQEHaLPQAKG3xNXvcJoR.MEUCIQD...（86文字）
```

#### 4.1.1 バイナリペイロードを採用する理由

| 方式 | 全長 | 可読性 | 拡張性 |
|---|---|---|---|
| バイナリ（採用） | 約 111 文字 | 低 | バージョンで管理 |
| JSON | 約 175 文字 | 高 | 高 |

手入力コピペを伴う UX において 60 文字の差は無視できないため、バイナリを採用する。可読性の欠如は、`v` によるレイアウト管理（§4.2）とデバッグ用デコーダで補う。

### 4.2 ペイロード（15 バイト固定）

| offset | size | フィールド | 型 | 説明 |
|---|---|---|---|---|
| 0 | 1 | `v` | uint8 | スキーマバージョン。現行 `1` |
| 1 | 1 | `kid` | uint8 | 署名鍵 ID |
| 2 | 1 | `flags` | uint8 | 権利ビットフィールド |
| 3 | 4 | `iat` | uint32 BE | 発行時刻（Unix 秒） |
| 7 | 8 | `lid` | bytes | ライセンス ID |

**`v` と `kid` を必ず含めること。** これがないと、鍵漏洩時や仕様変更時に既発行トークンを一括無効化するしか手がなくなる。1バイトのコストで最大の運用リスクを消せる。

#### 4.2.1 flags（ビットフィールド）

| bit | 値 | 定数 | 意味 |
|---|---|---|---|
| 0 | `0x01` | `AD_FREE` | 広告非表示 |
| 1 | `0x02` | `COSMETICS` | サポーター専用テーマ解放 |
| 2 | `0x04` | `CREDITS` | クレジット掲載対象 |
| 3-7 | — | — | 予約（将来の特典追加用） |

段階的な tier 番号ではなくフラグとすることで、特典の組み合わせを後から自由に定義できる。クライアントは**未知のビットを無視する**こと。

#### 4.2.2 iat の用途

- クレジット掲載の順序付け
- 「特定時期以前の購入者への追加特典」等のグランドファザリング

**有効期限は持たない。** 買い切り永続ライセンスであり、`iat` は失効判定に使用しない。

#### 4.2.3 lid（ライセンス ID）

Stripe セッション ID から決定的に導出する（§5.3）。用途は以下の2点。

- 失効リスト（§4.6）による個別無効化
- 重複検知（同一ライセンスの複数登録を UI 上で識別）

### 4.3 署名

| 項目 | 値 |
|---|---|
| アルゴリズム | ECDSA P-256 / SHA-256 |
| 署名形式 | raw `r‖s`（64 バイト固定） |
| 署名対象 | `DOMAIN ‖ payload` |

**DOMAIN 文字列**（ドメイン分離）
```
magika-dorue/license/v1
```

UTF-8 バイト列としてペイロードの前に連結してから署名する。同じ鍵を将来別用途（トレードコード等）で使い回した場合の、署名の相互流用を防ぐ。

> **注**: WebCrypto の `crypto.subtle.sign/verify` は ECDSA について raw `r‖s` を扱う（DER ではない）。OpenSSL 等の外部ツールで検証する場合は形式変換が必要。

### 4.4 鍵管理

#### 4.4.1 鍵生成

**openssl は使わない。** WebCrypto だけで完結する `tools/keygen.mjs` を用意した（v1.0 の openssl + 変換スクリプト方式は、PEM → PKCS#8 の変換手順が本文とコメントに分散していて事故りやすかった）。

```bash
node tools/keygen.mjs 200   # テスト用
node tools/keygen.mjs 1     # 本番用
```

出力されるもの:

- `SIGNING_KEY_PKCS8_B64` — Worker のシークレット
- `LID_SALT` — 32 バイトのランダム値
- `index.html` の `LICENSE_PUBKEYS` にそのまま貼れる1行
- `tools/mint.mjs` / `tools/lid.mjs` 用の環境変数

**秘密鍵と `LID_SALT` は手元にも控える。** 控えないと失効（§4.6）が実行できなくなる。

#### 4.4.2 本番鍵とテスト鍵の分離（必須）

Stripe のテストモードでも決済フローは同じように成立するため、**テスト Worker と本番 Worker が同じ署名鍵を使うと、テストカード `4242…` で本物のライセンスが無限に発行できる。**

| 環境 | kid | 公開鍵を `index.html` に載せるか |
|---|---|---|
| 本番 | 1 | **載せる** |
| テスト | 200 | **載せない** |

テスト時は、ブラウザのコンソールから実行時に注入して確認する（出荷ファイルは汚さない）。

```js
LICENSE_PUBKEYS[200] = { kty:'EC', crv:'P-256', x:'…', y:'…' };
```

`test/p5/epilogue_license.js` の 11a が「出荷物に 200 番台の kid が載っていないこと」を機械チェックする。

#### 4.4.3 鍵のプラットフォーム非依存性

**秘密鍵は Cloudflare の機能（KMS 等）に依存させず、環境変数として渡す。** これにより、Worker を丸ごと別プロバイダへ移設しても既発行トークンがすべて生き続ける。

#### 4.4.4 鍵ローテーション手順

1. 新しい鍵ペアを生成し、`kid = 2` を割り当てる
2. ゲーム HTML の公開鍵テーブルに `kid: 2` を**追加**する（`kid: 1` は削除しない）
3. Worker のシークレット `SIGNING_KEY_PKCS8_B64` と `KID` を更新
4. 以降の新規発行は `kid = 2`。既存の `kid = 1` トークンは引き続き有効

**旧鍵の公開鍵をテーブルから削除するのは、その鍵で発行したライセンスをすべて無効化すると決めたときのみ。**

### 4.5 検証手順（クライアント）

1. 入力文字列から空白文字をすべて除去
2. `.` で3分割。要素数が3でない、または先頭が `MD1` でなければ**不正**
3. payload / signature が base64url の文字種 `[A-Za-z0-9_-]+` のみでなければ**不正**
4. payload / signature を base64url デコード
5. payload が 15 バイト、signature が 64 バイトでなければ**不正**
6. `v` が既知のバージョンでなければ**不正**
7. `kid` に対応する公開鍵がテーブルになければ**不正**
8. `DOMAIN ‖ payload` に対する署名を検証。失敗なら**不正**
9. `lid` が失効リストに含まれていれば**不正**
10. 成功時、`flags` / `iat` / `lid` / `kid` を返す

**v1.0 からの変更点**

- **手順3を追加。** `atob` は実装によって不正文字に寛容なので、文字種チェックで先に弾く。既存の `validateTradeCode` も同じ流儀（コードベースの既存規約に合わせた）。
- **失効チェックを署名検証の後ろに移した**（v1.0 は手順7で署名前だった）。署名未検証の payload を信用して分岐しないため。拒否方向なので v1.0 でも安全ではあったが、順序として素直になる。

例外は全て捕捉して `null` を返す。**失敗理由は呼び出し元に返さない**（§6.4）。

### 4.6 失効

実行時サーバがないため、失効リストは**ゲーム HTML に埋め込む**。

```js
const REVOKED_LIDS = new Set([
  // "a1b2c3d4e5f6a7b8",
]);
```

失効を反映するには HTML を再デプロイする必要がある。運用上、失効は「返金処理を行った」「広範に流出した」等の例外的ケースに限られるため、この制約は許容する。

#### 4.6.1 lid の求め方（v1.1 で追加）

**v1.0 にはこの手順が無く、失効が実行不可能だった。** Stripe ダッシュボードにあるのは `cs_…` であって `lid` ではなく、`lid = SHA-256(LID_SALT | cs_…)[0:8]` の `LID_SALT` は Worker のシークレットなので手元では計算できない。

そのため2つの経路を用意した。

```bash
MD_LID_SALT=<salt> node tools/lid.mjs cs_live_xxxxx
#   cs_live_xxxxx
#     lid = 86441e2467c4a968
```

加えて、**受け取りページの末尾に `lid` を表示する。** 利用者から聞き出すこともできる（`lid` は失効の識別子でしかなく、秘密ではない）。

**返金したときの手順**

1. Stripe ダッシュボードで該当の Checkout Session ID を控える
2. `tools/lid.mjs` で `lid` を出す
3. `index.html` の `REVOKED_LIDS` に 16 桁 hex を追加
4. GitHub Pages へ再デプロイ

保存済みの失効トークンは、次回起動時の `loadLicense()` で自動的に localStorage から消える。

**失効リストのサイズが増え続ける設計であることに留意。** 数十件を超える規模になった場合は、`iat` 以降のトークンのみ有効とするカットオフ方式への切り替えを検討する。

---

## 5. Cloudflare 実装

### 5.1 構成

| コンポーネント | 役割 |
|---|---|
| Cloudflare Workers | 受け取りページ配信 + トークン生成 |
| Stripe Payment Link | 決済 UI・領収書発行 |
| GitHub Pages | ゲーム本体、特商法・利用規約ページ |

**KV / D1 / R2 は使用しない。**

### 5.2 エンドポイント

#### `GET /success?session_id={CHECKOUT_SESSION_ID}`

Stripe Payment Link の `success_url` に設定する。

**処理**
1. **Stripe を呼ぶ前に設定を検証**。`KID` が 1〜255 の整数でない、シークレットが未設定なら 500。
   設定ミスが「決済後に初めて発覚する」のが最悪なので、必ず先に落とす
2. `session_id` を取得。`/^cs_(test_|live_)?[A-Za-z0-9]{10,80}$/` に一致しなければ 400。
   総当りリクエストで Stripe API を叩かせないための足切り
3. Stripe API で Checkout Session を取得（`expand[]=line_items`、`Stripe-Version` を固定）
4. Stripe が 404 → 404（**決済成立を示唆しない文面**にする）。それ以外の失敗 → §5.9 のエラーページ
5. `payment_status !== 'paid'` なら 402 を返し、決済未完了の旨を表示
6. `line_items[].price.id` を flags にマッピング（§5.4）。未知の price なら §5.9 のエラーページ + ログ
7. トークンを生成（§5.3）。失敗したら §5.9 のエラーページ + ログ
8. コード・コピーボタン・`lid` を含む HTML を返す

**レスポンスヘッダ**
```
Cache-Control: no-store
X-Robots-Tag: noindex
Referrer-Policy: no-referrer
```

#### `GET /health`

デプロイ確認用。`200 OK` のみ返す。

### 5.3 トークン生成（冪等）

```js
const enc = new TextEncoder();
const DOMAIN = enc.encode('magika-dorue/license/v1');

function b64uEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64Decode(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function mintToken(env, session, flags) {
  // --- lid: session.id から決定的に導出 ---
  const digest = await crypto.subtle.digest(
    'SHA-256', enc.encode(env.LID_SALT + '|' + session.id)
  );
  const lid = new Uint8Array(digest).slice(0, 8);

  // --- payload 組み立て ---
  const payload = new Uint8Array(15);
  payload[0] = 1;                    // v
  payload[1] = Number(env.KID);      // kid
  payload[2] = flags;                // flags
  new DataView(payload.buffer).setUint32(3, session.created, false); // iat
  payload.set(lid, 7);

  // --- 署名 ---
  const key = await crypto.subtle.importKey(
    'pkcs8', b64Decode(env.SIGNING_KEY_PKCS8_B64),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const msg = new Uint8Array(DOMAIN.length + payload.length);
  msg.set(DOMAIN, 0);
  msg.set(payload, DOMAIN.length);

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, msg
  );

  return `MD1.${b64uEncode(payload)}.${b64uEncode(new Uint8Array(sig))}`;
}
```

**冪等性について**: `lid` は `session.id` から、`iat` は `session.created` から導出するため、同じセッションに対しては常に同一のトークンが生成される。DB を持たずに再発行が成立する。

> **`iat` の意味に注意**: `session.created` は Checkout Session が作られた時刻＝**決済ページを開いた時刻**であり、決済が完了した時刻ではない。Payment Link 経由なら実用上ほぼ同じだが、厳密には購入完了時刻ではない。`iat` の用途はクレジット掲載の順序付けとグランドファザリング（§4.2.2）なので実害はない。決済完了時刻を使うと冪等性のために `payment_intent` の追加取得が要るため、あえて `created` を選んでいる。

> ECDSA の署名値そのものは乱数を含むため毎回変化するが、**署名対象が同一である以上、どちらの署名も有効**であり、`lid` が同一なので重複ライセンスにはならない。

### 5.4 price → flags マッピング

金額では判定しない。金額判定は任意金額商品で破綻する。

**判定キーは product ID(`prod_…`) を推奨する。** price ID(`price_…`) でも判定できるが、以下の理由で product ID のほうが安全。

> **Stripe の価格は変更できない。** ￥500 を ￥600 にすると Stripe は**新しい price ID を発番する**。price ID で判定していると、値上げした瞬間にマッピングが外れ、**購入者は課金されたのにコードが発行されない**（§5.9 の失敗経路に落ちる）。product ID は価格を変えても不変なので、この事故が起きない。
>
> v1.0 は「price ID で判定する」としていたが、これは金額判定を避ける点では正しく、**price ID の安定性については踏み込めていなかった**。v1.1 で product ID 優先に改めた。

ID はテストモードと本番で別物になるため、**コードに埋め込まず `wrangler.toml` の変数として持つ**（v1.0 はコード内の定数だった）。

```toml
[vars]                    # テスト
PRICE_FLAGS = '{"prod_xxxxTEST_ADFREE":1,"prod_xxxxTEST_SUPPORTER":7,"prod_xxxxTEST_PWYW":7}'

[env.production.vars]     # 本番
PRICE_FLAGS = '{"prod_xxxxLIVE_ADFREE":1,"prod_xxxxLIVE_SUPPORTER":7,"prod_xxxxLIVE_PWYW":7}'
```

**判定の順序**

1. `line_items[].price.id` がマップにあればそれを使う
2. なければ `line_items[].price.product` を見る（未 expand なら文字列、expand 済みならオブジェクト。両方受ける）
3. 全件を走査して flags を OR する（複数商品を1回の決済に入れられるようにするため）
4. 1件も一致しなければ「未知の商品」として §5.9 のエラーページを返す

price ID を明示した場合はそちらが優先される。特定の価格だけ別の特典にしたい、といった例外を後から差し込める。

### 5.5 シークレット

`wrangler secret put` で設定する。`wrangler.toml` に平文で書かないこと。

| 名前 | 内容 |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe シークレットキー（`sk_live_...`） |
| `SIGNING_KEY_PKCS8_B64` | ECDSA 秘密鍵（PKCS#8 DER の base64） |
| `LID_SALT` | lid 導出用ソルト（32 バイト以上のランダム文字列） |

以下は機密ではないので `wrangler.toml` の `[vars]` に置く。

| 名前 | 内容 |
|---|---|
| `KID` | 現行の鍵 ID。本番 `"1"` / テスト `"200"` |
| `PRICE_FLAGS` | price ID → flags の JSON（§5.4） |
| `STRIPE_API_VERSION` | Stripe ダッシュボードに表示されている API バージョン。**必ず固定する**（未固定だと将来の Stripe 側変更で `line_items` の形が変わって壊れる） |
| `GAME_URL` | 受け取りページから戻るリンク先 |
| `CONTACT` | 問い合わせ先。§5.9 のエラーページに出る |

### 5.6 Stripe SDK の利用

Workers 環境では Node の HTTP スタックが使えないため、fetch ベースの HTTP クライアントを指定する。

```js
import Stripe from 'stripe';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
});
```

SDK を使わず `fetch` で Stripe REST API を直接叩く選択肢もある。今回は Checkout Session の取得1本のみのため、**依存を持たない直接 fetch 実装を推奨する**（`GET https://api.stripe.com/v1/checkout/sessions/{id}?expand[]=line_items`、Authorization: Bearer）。

### 5.7 Webhook を使わない理由

`success_url` 方式は、Stripe の webhook 署名検証・リトライ処理・冪等性管理をすべて不要にする。

**トレードオフ**: ユーザーが決済完了後に success ページへ到達しなかった場合（ブラウザを閉じた等）、コードを受け取れない。この場合の救済は §5.8 の手動再発行で対応する。将来的にメール配信（Resend 等）を追加する場合は webhook が必要になる。

### 5.8 コード紛失時の再発行

1. ユーザーから購入時のメールアドレスまたは領収書番号を受領
2. Stripe ダッシュボードで該当 Checkout Session を特定
3. `https://<worker>/success?session_id=cs_xxx` を開き、同一トークンを取得して送付

決定的生成のため、いつ実行しても同じコードが得られる。

### 5.9 決済成立後に発行が失敗した場合（v1.1 で追加）

**v1.0 にはこの経路の設計が無く、「金は取られたがコードが無い」状態で利用者が手詰まりになる穴があった。**

Stripe の 5xx・未知の price・署名失敗のいずれでも、以下を含むページを返す。

- **お支払いは完了している旨**（これを書かないと二重購入を招く）
- **購入 ID（`cs_…`）** — これが無いと利用者は問い合わせる手がかりを失う
- エラー種別（`stripe_500` / `unknown_price` / `mint_failed`）
- 連絡先（`CONTACT`）

Stripe が 404 を返した場合だけは扱いが違う。セッションが存在しない＝リンクの打ち間違いであり、決済は成立していない。**決済成立を示唆しない文面**にすること。

問い合わせを受けたら §5.8 の手順で同一コードを再発行して送る。

---

## 6. クライアント実装

実装は `index.html` の「ライセンス（サポーターパック / 広告オフ）」節（取引コードの直後）にある。以下は設計意図の記述であり、コードが正典。

### 6.1 公開鍵テーブル

```js
const LICENSE_PUBKEYS = {
  1: { kty: 'EC', crv: 'P-256', x: '...', y: '...' },
};
```

### 6.2 検証関数

```js
const LIC_DOMAIN = new TextEncoder().encode('magika-dorue/license/v1');

function b64uDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyLicense(input) {
  try {
    const parts = String(input).replace(/\s+/g, '').split('.');
    if (parts.length !== 3 || parts[0] !== 'MD1') return null;

    const payload = b64uDecode(parts[1]);
    const sig     = b64uDecode(parts[2]);
    if (payload.length !== 15 || sig.length !== 64) return null;

    const v = payload[0], kid = payload[1], flags = payload[2];
    if (v !== 1) return null;

    const jwk = LICENSE_PUBKEYS[kid];
    if (!jwk) return null;

    const dv  = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const iat = dv.getUint32(3, false);
    const lid = Array.from(payload.slice(7))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    if (REVOKED_LIDS.has(lid)) return null;

    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    );

    const msg = new Uint8Array(LIC_DOMAIN.length + payload.length);
    msg.set(LIC_DOMAIN, 0);
    msg.set(payload, LIC_DOMAIN.length);

    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, sig, msg
    );
    return ok ? { flags, iat, lid, kid } : null;
  } catch (e) {
    return null;
  }
}
```

### 6.3 永続化とゲーム側の分岐

**localStorage キー**: `magika_license`（トークン文字列をそのまま保存。空白は除去してから保存する）

> v1.0 は `magidorue_license` としていたが、既存キーは全て `magika_` 接頭辞（`magika_mute` / `magika_shop` / `magika_records` / `magika_inventory` / `magika_trade_seen` …）なので規約に合わせた。`epilogue_license.js` の 8b/11c がこれを固定する。

起動時に検証し、以下のフラグに落とす。

```js
let LIC = { adFree: false, cosmetics: false, credits: false };

async function loadLicense() {
  const t = localStorage.getItem('magidorue_license');
  if (!t) return;
  const r = await verifyLicense(t);
  if (!r) { localStorage.removeItem('magidorue_license'); return; }
  LIC.adFree    = !!(r.flags & 0x01);
  LIC.cosmetics = !!(r.flags & 0x02);
  LIC.credits   = !!(r.flags & 0x04);
}
```

**ゲームロジックは `LIC.*` のみを参照する。** トークンの構造をゲーム側に漏らさないことで、将来のフォーマット変更を検証層に閉じ込められる。

### 6.4 コード入力 UI

- 設置箇所: サイドバー（折りたたみ可能セクション）内の「サポーター」項目
- 入力欄はテキストエリア（1行だと 111 文字が見切れる）
- 検証失敗時のメッセージは**理由を細分化しない**。「コードが正しくありません」で統一する
- 検証成功時は即座に反映し、リロードを要求しない

### 6.5 既存コードとの関係（v1.1 で追加）

- **base64url ヘルパを共有する。** 既存の `b64urlEncode` / `b64urlDecode`（取引コード用）は string↔string で、ライセンスはバイト列が要る。同名で別物を作ると事故るため、バイト版 `b64urlEncodeBytes` / `b64urlDecodeBytes` を土台にし、文字列版をその上へ載せ替えた。挙動は不変で、`verify.sh` の path/sim 一致と `epilogue_trade.js` 53項目で担保している
- **取引コードとは混ざらない。** 既存プレフィクスは `MGKT1`（FNV-1a チェックサム、改ざん防止なし）、ライセンスは `MD1`（ECDSA 署名）。プレフィクスも検証方式も別。相互に受理しないことを 4c/4d でテストしている（→ §10 未決6 の解決）
- **`LIC.*` 以外をゲームロジックから参照しない。** トークンの構造を検証層に閉じ込めることで、将来のフォーマット変更の影響範囲を限定する

### 6.6 既知の落とし穴

- **base64url は大文字小文字を区別する。** 入力を `toLowerCase()` してはならない。モバイルの自動大文字化を止めるため、入力欄には `autocapitalize="off"` / `autocorrect="off"` を付ける
- **メールクライアントによる自動改行**でコードが分割される可能性がある。空白除去処理（§4.5-1）で吸収する
- **`crypto.subtle` は secure context でのみ利用可能。** `http://` での動作確認は失敗する。ローカル検証は `localhost` を使う（localhost は secure context として扱われる）
- **`verifyLicense` は非同期。** 起動時の `loadLicense()` は `.catch(() => {})` で受け、失敗をゲーム本体に波及させない

---

## 7. 広告仕様

### 7.1 位置づけ

**広告本体の収益は副次的なものとする。** この規模での AdSense 収益は月数百〜数千円のオーダーであり、課金の代替にはならない。広告の主目的は「サポーターパックを購入する動機を作ること」に置く。

### 7.2 配置ルール

| 画面 | 広告 |
|---|---|
| ウェーブ間の待機画面 | 可 |
| ゲームオーバー画面 | 可 |
| **プレイ中** | **禁止** |
| タイトル / 設定 / 記録 | 不可（体験を損なうため） |

タワーディフェンスは配置判断に集中を要するため、**プレイ中の割り込みは離脱に直結する。** インタースティシャル・自動再生動画は使用しない。

### 7.3 導線

広告枠の近傍に「広告を消す」導線を静かに配置する。**煽り・カウントダウン・閉じにくい UI は使わない。** 支援モデルと押し売りは相性が最悪であり、クレジット表記の価値を毀損する。

### 7.4 実装上の注意

- 広告 SDK の読み込みは `shouldLoadAds()`（= `!LIC.adFree`）を入口にする。DOM の非表示ではなくスクリプト自体を読み込まないこと。この関数は実装済みで、広告導入時はここに繋ぐだけでよい
- **広告の `<script>` タグは、ゲーム本体の `<script>` より後ろに置くこと。** `test/p5/harness.js` は HTML 内の**最初の `<script>`** をゲーム本体とみなして抽出する（`html.match(/<script>([\s\S]*?)<\/script>/)`）。前に置くとテスト基盤が丸ごと壊れる。`epilogue_license.js` の 11d がこの順序を固定する
- AdSense は薄いコンテンツの単一ページサイトを審査で弾くことがある。**ゲーム説明・更新履歴・開発ノートのページを事前に用意しておく**（CLAUDE.md の内容を開発ノートとして流用可能）
- 広告 SDK は CDN 読み込みを伴うため、「CDN 依存なし」制約の唯一の例外となる。この例外を明示的に受け入れる

---

## 8. 法務要件

> 以下は設計判断のための整理であり、法的助言ではない。仕様確定後に専門家の確認を得ること。

### 8.1 適用が外れる規制と、その根拠

| 規制 | 該当性 | 根拠 |
|---|---|---|
| 資金決済法（前払式支払手段） | **非該当** | ゲーム内通貨を介さず、アイテム/機能を直接販売するため |
| 景品表示法（ガチャ規制） | **非該当** | ランダム排出を行わないため |
| 賭博罪 | **非該当** | ランダム性・換金性のいずれも持たないため |

**この3点は §1.2 の設計判断に依存している。** 将来、通貨導入またはランダム排出を検討する場合は、本節の結論が失効することに留意。

### 8.2 必須対応

#### 特定商取引法に基づく表示

有料サービスを提供する以上、事業者情報の表示義務が生じる。

- 販売事業者名（氏名）
- 所在地
- 連絡先
- 販売価格、支払方法、支払時期
- 提供時期
- 返品・キャンセルに関する事項

個人名・自宅住所の公開を避けたい場合、バーチャルオフィスの契約が必要。**リリース前に決めておくこと。**

#### 利用規約

永続ライセンスを販売するため、以下を明記する。

- **サービス終了時の取り扱い**（返金の有無）
- ライセンスの譲渡・再配布の可否
- 不正利用時のライセンス失効条項（§4.6 の運用根拠となる）
- 特典内容の変更・追加に関する条項

#### 消費税

課税売上 1,000 万円以下の期間は免税事業者を選択可能。**インボイス登録を行うと免税事業者ではなくなる**点に留意。当面は登録しない判断が現実的だが、法人相手の取引が発生する場合は再検討する。

### 8.3 ページ配置

特商法表示・利用規約・プライバシーポリシーは GitHub Pages 上の別ページとして配置し、購入導線とゲーム内フッタの両方からリンクする。

---

## 9. 実装順序

各ステップは独立して検証可能であること。

| # | 内容 | 完了条件 | 状態 |
|---|---|---|---|
| 1 | 鍵ペア生成ツール | ローカルで署名 → 検証が通る | ✅ `tools/keygen.mjs` |
| 2 | トークン生成/検証ロジックの実装 | 手動生成したトークンをゲームが受理する | ✅ `tools/mint.mjs` / `verifyLicense` |
| 3 | ゲーム側 `LIC.*` 分岐と入力 UI | 記録画面から有効化・解除ができる | ✅ 65項目のテストが緑 |
| 3.5 | 本番鍵の生成と `LICENSE_PUBKEYS` への記載 | 本番 kid=1 の公開鍵が入っている | ⬜ **鍵は未生成・テーブルは空** |
| 4 | Cloudflare Worker デプロイ | `/health` が応答する | ⬜ コードは `worker/` に用意済み |
| 5 | Stripe Payment Link 作成、テストモードで結合 | テスト決済 → コード取得 → ゲーム反映が通る | ⬜ |
| 6 | 特商法・利用規約・開発ノートページ整備 | 全ページが公開されリンクされている | ⬜ |
| 7 | 本番リリース（**広告なし**・cosmetic はクレジット表記のみ） | 実売上データの取得開始 | ⬜ |
| 8 | CSS の色を変数へ寄せる → 専用テーマを2弾目として出す | テーマ切替で画面全体が変わる（§3.2.1） | ⬜ |
| 9 | 広告導入 | — | ⬜ |

**手順 3.5 が残っている点に注意。** 現状 `LICENSE_PUBKEYS` は空なので、**どんなコードを入れても必ず弾かれる**。本番鍵を生成して1行貼るまで、課金機能は動作しない（これは意図した安全側の初期状態）。

### 9.0 テスト

```sh
node test/p5/harness.js index.html license   # 65項目。failed: 0 を維持すること
test/p5/verify.sh                            # path/sim がリグレッションしていないこと
```

`epilogue_license.js` は実鍵ペアをその場で生成して `LICENSE_PUBKEYS` に注入するため、Stripe も Cloudflare も鍵ファイルも要らない。改ざん検知・ドメイン分離・失効・鍵ローテーション・永続化・UI 経路まで含めて、外部サービス抜きで閉じる。

### 9.1 手順 1〜3 を先行させる理由

トークン層はゲーム本体に一切依存しない。Stripe / Cloudflare の設定に着手する前に、署名・検証だけをローカルで完成させられる。**外部サービスの設定ミスと、暗号処理のバグを切り分けられる**のが最大の利点。

### 9.2 広告を最後にする理由

広告なしで一度リリースすることで、「広告を消したくなる程度」を実データで測る基準が得られる。先に入れると調整の基準そのものが存在しない。

---

## 10. 未決事項

| # | 項目 | 状態 |
|---|---|---|
| 1 | メール配信の要否 | **未決**。追加すると webhook が必要になり、Worker が状態を持ち始める。§5.8 の手動再発行で足りるかを実運用で判断 |
| 2 | 独自ドメインの要否 | **未決**。`*.workers.dev` を購入導線に出すことの心理的抵抗を許容するか |
| 3 | cosmetic テーマの具体内容 | **確定（方針変更）**。§3.2.1 のとおり、CSS の変数化が済んでいないためテーマは2弾目に回す。初回は**クレジット表記のみ** |
| 4 | クレジット表記の名義入力方法 | **確定**。§10.1 |
| 5 | 広告ネットワークの選定 | **未決**。AdSense / 他。審査要件と規約制約の比較 |
| 6 | トレードコードとのフォーマット共通化 | **確定**。§6.5。共通化するのは base64url のバイト版ヘルパのみ。`MGKT1` と `MD1` は検証方式ごと別物として共存させる |

### 10.1 未決事項 4 の結論（v1.1 で確定）

**「Worker がステートレスであること」と名義収集は衝突しない。** 名義の掲載は人手の作業であり、リアルタイム性を要求しないため。

1. Stripe Payment Link のカスタムフィールドに「クレジット掲載名（任意・20文字以内）」を追加する
2. **Worker はこのフィールドを読まないし保存もしない**
3. 開発者が定期的に Stripe ダッシュボードを見て、`index.html` の `SUPPORTERS` 配列に手で追記する
4. 再デプロイで反映。`LIC.credits` が立っている利用者には記録画面に一覧が出る

掲載は次回デプロイまで遅れるが、支援へのお礼という性質上それで足りる。Worker に状態を持たせる（＝ KV の導入・webhook・冪等性管理）代償に見合わない。

**運用上の注意**: 名義は利用者が自由入力するテキストなので、掲載前に必ず目視する。ゲーム側は `escapeHtml()` を通しているが、それは XSS 対策であって内容の妥当性判断ではない。

---

## 11. v1.0 からの変更点（v1.1）

実装して初めて分かった問題と、それに対する決定。

| # | 内容 | 分類 |
|---|---|---|
| 1 | **本番鍵とテスト鍵の分離を必須化**（§1.2 / §4.4.2）。同一鍵だと Stripe のテストカードで本物のライセンスが発行できた | 脆弱性 |
| 2 | **失効の実行手段を追加**（§4.6.1）。v1.0 は `lid` の算出手段が無く、§4.6 が実行不可能だった | 欠落 |
| 3 | **決済成立後に発行が失敗した場合のページを追加**（§5.9）。v1.0 はこの経路が未設計で、利用者が手詰まりになった | 欠落 |
| 4 | localStorage キーを `magidorue_license` → **`magika_license`** に変更（§6.3）。既存の命名規約に違反していた | 規約違反 |
| 5 | base64url ヘルパをバイト版へ載せ替え（§6.5）。既存の `b64urlEncode` と同名で別物を作る事故を回避 | 設計 |
| 6 | 検証手順に**文字種チェックを追加**し、**失効判定を署名検証の後ろへ移した**（§4.5） | 堅牢性 |
| 7 | 鍵生成を openssl から **`tools/keygen.mjs`** へ置き換え（§4.4.1）。v1.0 の手順は変換ステップが分散していた | 運用 |
| 8 | `PRICE_FLAGS` と `STRIPE_API_VERSION` を**環境変数化・固定化**（§5.4 / §5.5） | 運用 |
| 9 | `session_id` の形式チェックと**設定の事前検証**を追加（§5.2）。`KID` 未設定で全トークンが無効になる事故を防ぐ | 堅牢性 |
| 10 | **専用テーマは初回リリースから外す**（§3.2.1）。CSS の変数化率が実測 15% 程度で、切り替えても画面の一部しか変わらないため | 見積もり訂正 |
| 11 | 広告 `<script>` の配置制約を明記（§7.4）。テストハーネスが最初の `<script>` を本体とみなす | 落とし穴 |
| 12 | 未決事項 4・6 を確定（§10.1 / §6.5） | 決定 |
| 13 | **判定キーを price ID から product ID 優先へ**（§5.4）。Stripe の価格は変更不可で、値上げすると price ID が変わり「課金されたのにコードが出ない」事故になる | 設計 |

### 11.1 追加された成果物

| パス | 内容 |
|---|---|
| `tools/license.mjs` | 署名・検証の共有プリミティブ |
| `tools/keygen.mjs` | 鍵ペア生成（openssl 不要） |
| `tools/mint.mjs` | ローカルでのトークン発行（Stripe 不要） |
| `tools/lid.mjs` | 失効用の `lid` 算出 |
| `worker/src/index.js` | 発行 Worker（依存パッケージなし） |
| `worker/wrangler.toml` | テスト / 本番の2環境 |
| `worker/README.md` | セットアップと運用手順 |
| `index.html` | ライセンス検証層・`LIC.*`・入力 UI・サポーター欄 |
| `test/p5/epilogue_license.js` | 65項目の単体検証 |

---

## 付録 A: 変更履歴

| 版 | 日付 | 内容 |
|---|---|---|
| 1.0 | 2026-08-09 | 初版。GCP 前提から Cloudflare Workers 前提へ変更 |
| 1.1 | 2026-08-09 | 実装に合わせて確定。鍵分離の必須化・失効手段の追加・発行失敗ページの追加ほか（§11） |
