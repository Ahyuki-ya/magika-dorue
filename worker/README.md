# ライセンス発行 Worker

`Magika・Dorue 課金機能 仕様書.md` の §5 の実装。状態を持たない（KV / D1 / R2 なし・依存パッケージなし）。

## セットアップ

### 1. 鍵を2組つくる

```sh
node tools/keygen.mjs 200   # テスト用
node tools/keygen.mjs 1     # 本番用
```

**本番とテストで必ず別の鍵・別の kid を使う。** 同じ鍵だと Stripe のテストカードで
本物のライセンスが発行できてしまう。テスト鍵の公開鍵は `index.html` に載せない。

出力された `MD_SIGNING_KEY` / `MD_LID_SALT` は手元にも控えておく。
控えないと返金時に失効させる `lid` を計算できなくなる（`tools/lid.mjs` 参照）。

### 2. wrangler.toml を埋める

`GAME_URL` / `CONTACT` / `PRICE_FLAGS` / `STRIPE_API_VERSION` を実際の値に置き換える。
`STRIPE_API_VERSION` は Stripe ダッシュボードに表示されているバージョン文字列をそのまま貼る。

### 3. デプロイ前にローカル検証

```sh
cd worker
node test/local.mjs      # 54項目。Stripe を差し替えて全経路を通す
```

Cloudflare にも Stripe にも繋がずに動く。**デプロイ前に必ずこれを通す。**

### 4. シークレットを設定してデプロイ

`wrangler.toml` に2環境あるため、**`--env` を必ず明示する。**
省略すると wrangler が警告を出し、意図しない環境を触る事故になる。

| 環境 | フラグ | Worker 名 |
|---|---|---|
| テスト | `--env=""` | `magika-dorue-license` |
| 本番 | `--env production` | `magika-dorue-license-prod` |

```sh
npx wrangler login                                      # ブラウザが開く
npx wrangler secret put STRIPE_SECRET_KEY   --env=""
npx wrangler secret put SIGNING_KEY_PKCS8_B64 --env=""
npx wrangler secret put LID_SALT            --env=""
npx wrangler deploy --env=""
curl https://magika-dorue-license.<subdomain>.workers.dev/health   # → ok
```

ログの確認は `npx wrangler tail --env=""`。§5.9 のエラーページが出たときはここに原因が残る。

### 5. Stripe Payment Link

- 商品を3つ作る（広告オフ ￥500 / サポーターパック ￥1,500 / 任意金額 `custom_unit_amount` 最低 1,500）
- 各 Payment Link の `success_url` を
  `https://<worker>.workers.dev/success?session_id={CHECKOUT_SESSION_ID}` にする
- 発行された price ID を `wrangler.toml` の `PRICE_FLAGS` に書く（**金額ではなく price ID で判定する**）
- クレジット掲載名は Payment Link のカスタムフィールドで任意入力にする（Worker は読まない。§10 参照）

## 運用

### コード紛失時の再発行

Stripe ダッシュボードで Checkout Session を特定し、
`https://<worker>/success?session_id=cs_...` を開く。`lid` も `iat` も決定的に導出されるので、
いつ実行しても同じライセンスが得られる。

### 返金したライセンスの失効

```sh
MD_LID_SALT=<salt> node tools/lid.mjs cs_live_xxxxx
```

出力された 16 桁 hex を `index.html` の `REVOKED_LIDS` に追加して再デプロイする。
（`lid` は受け取りページの末尾にも表示されるので、利用者から聞き出すこともできる。）

### 鍵ローテーション

1. `node tools/keygen.mjs 2` で新しい鍵を作る
2. `index.html` の `LICENSE_PUBKEYS` に `kid: 2` を**追加**する（`kid: 1` は消さない）
3. Worker のシークレットと `KID` を更新
4. 以降の発行は kid=2。既発行の kid=1 はそのまま有効

旧鍵の公開鍵を消してよいのは、その鍵で出したライセンスを全部無効にすると決めたときだけ。
