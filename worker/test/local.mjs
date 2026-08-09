// Worker のローカル検証。Stripe API を差し替えて全経路を通す。
// Cloudflare にも Stripe にも繋がずに動くので、デプロイ前に必ずこれを通すこと。
//   cd worker && node test/local.mjs
import worker from '../src/index.js';
import { webcrypto as wc } from 'node:crypto';
import { verify } from '../../tools/license.mjs';

const results = [];
const chk = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });

// ---- テスト用の鍵と env ----
const pair = await wc.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pkcs8 = Buffer.from(await wc.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const jwk = await wc.subtle.exportKey('jwk', pair.publicKey);
const PUB = { 200: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } };

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  SIGNING_KEY_PKCS8_B64: pkcs8,
  LID_SALT: 'test-salt-0123456789abcdef',
  KID: '200',
  PRICE_FLAGS: '{"price_ADFREE":1,"price_SUPPORTER":7,"prod_ADFREE_BYPROD":1}',
  GAME_URL: 'https://example.invalid/game/',
  CONTACT: 'support@example.invalid',
  STRIPE_API_VERSION: '2099-01-01',
};

// ---- Stripe スタブ ----
let stripeCalls = [];
let stripeHandler = () => ({ status: 200, body: {} });
globalThis.fetch = async (url, init) => {
  stripeCalls.push({ url: String(url), headers: init && init.headers });
  const r = stripeHandler(String(url));
  return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status });
};

const SESSION_PAID = {
  id: 'cs_test_abcdef1234567890', created: 1754700000, payment_status: 'paid',
  line_items: { data: [{ price: { id: 'price_SUPPORTER' } }] },
};

const call = (path) => worker.fetch(new Request('https://w.example' + path), ENV);
const text = async (res) => await res.text();

// ---- 1. /health ----
{
  const res = await call('/health');
  chk('1a /health が 200', res.status === 200, res.status);
  chk('1b /health の本文', (await text(res)) === 'ok');
}

// ---- 1.5 /pubkey ----
{
  const res = await call('/pubkey');
  const body = JSON.parse(await text(res));
  chk('1c /pubkey が 200', res.status === 200, res.status);
  chk('1d 実際に署名する鍵と対の公開鍵を返す', body.jwk.x === jwk.x && body.jwk.y === jwk.y);
  chk('1e kid を返す', body.kid === 200, body.kid);
  chk('1f index.html に貼れる形を返す', /^\s+200: \{ kty:'EC', crv:'P-256', x:'.+', y:'.+' \},$/.test(body.snippet), body.snippet);
  // 最重要: 秘密指数 d を絶対に漏らさない
  const raw = JSON.stringify(body);
  chk('1g 秘密指数 d を含まない', !('d' in body.jwk) && !raw.includes(jwk.d), Object.keys(body.jwk).join(','));
  chk('1h 秘密鍵そのものを含まない', !raw.includes(pkcs8));
}

// ---- 2. 入力の足切り（Stripe を呼ばないこと） ----
for (const [name, path] of [
  ['session_id なし', '/success'],
  ['形式違い', '/success?session_id=abc123'],
  ['短すぎる', '/success?session_id=cs_x'],
  ['記号混入', '/success?session_id=cs_test_../../etc'],
]) {
  stripeCalls = [];
  const res = await call(path);
  chk(`2 400 を返す（${name}）`, res.status === 400, res.status);
  chk(`2 Stripe を呼ばない（${name}）`, stripeCalls.length === 0, stripeCalls.length);
}
{
  const res = await call('/nope');
  chk('2 未知のパスは 404', res.status === 404, res.status);
}

// ---- 3. 設定ミスは Stripe を呼ぶ前に落ちる ----
for (const [name, patch] of [
  ['KID 未設定', { KID: undefined }],
  ['KID が数値でない', { KID: 'abc' }],
  ['KID が範囲外', { KID: '999' }],
  ['署名鍵なし', { SIGNING_KEY_PKCS8_B64: undefined }],
  ['LID_SALT なし', { LID_SALT: undefined }],
]) {
  stripeCalls = [];
  const res = await worker.fetch(new Request('https://w.example/success?session_id=cs_test_abcdef1234567890'), { ...ENV, ...patch });
  chk(`3 500 で止まる（${name}）`, res.status === 500, res.status);
  chk(`3 Stripe を呼ばない（${name}）`, stripeCalls.length === 0, stripeCalls.length);
}

// ---- 4. 正常系 ----
let token1 = null;
{
  stripeCalls = [];
  stripeHandler = () => ({ status: 200, body: SESSION_PAID });
  const res = await call('/success?session_id=cs_test_abcdef1234567890');
  const html = await text(res);
  chk('4a 200 を返す', res.status === 200, res.status);
  chk('4b no-store', res.headers.get('cache-control') === 'no-store');
  chk('4c noindex', res.headers.get('x-robots-tag') === 'noindex');
  chk('4d line_items を expand している', /expand%5B%5D=line_items|expand\[\]=line_items/.test(stripeCalls[0].url), stripeCalls[0].url);
  chk('4e Authorization を送る', stripeCalls[0].headers.Authorization === 'Bearer sk_test_dummy');
  chk('4f Stripe-Version を固定している', stripeCalls[0].headers['Stripe-Version'] === '2099-01-01');

  token1 = (html.match(/MD1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/) || [])[0];
  chk('4g トークンが埋まっている', !!token1, (token1 || '').slice(0, 16));
  chk('4h 長さが 111', token1 && token1.length === 111, token1 && token1.length);

  const r = await verify(token1, PUB);
  chk('4i 公開鍵で検証が通る', r !== null);
  chk('4j flags が price から決まる', r && r.flags === 7, r && r.flags);
  chk('4k iat = session.created', r && r.iat === 1754700000, r && r.iat);
  chk('4l kid = env.KID', r && r.kid === 200, r && r.kid);
  chk('4m lid が本文に出る（失効に使える）', r && html.includes(r.lid), r && r.lid);
  chk('4n 戻りリンクが GAME_URL', html.includes('https://example.invalid/game/'));
  chk('4o 秘密が漏れていない', !html.includes(pkcs8) && !html.includes(ENV.LID_SALT) && !html.includes('sk_test_dummy'));
}

// ---- 5. 冪等性（同じセッションなら同じ lid） ----
{
  const res2 = await call('/success?session_id=cs_test_abcdef1234567890');
  const token2 = ((await text(res2)).match(/MD1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/) || [])[0];
  const a = await verify(token1, PUB), b = await verify(token2, PUB);
  chk('5a lid が一致する', a.lid === b.lid, `${a.lid} / ${b.lid}`);
  chk('5b iat が一致する', a.iat === b.iat);
  chk('5c payload が同一（署名値だけ変わる）',
      token1.split('.')[1] === token2.split('.')[1] && token1 !== token2);
}

// ---- 6. 商品ごとの flags ----
{
  stripeHandler = () => ({ status: 200, body: { ...SESSION_PAID, line_items: { data: [{ price: { id: 'price_ADFREE' } }] } } });
  const t = ((await text(await call('/success?session_id=cs_test_abcdef1234567890'))).match(/MD1\.[\w-]+\.[\w-]+/) || [])[0];
  chk('6a 広告オフは flags=1', (await verify(t, PUB)).flags === 1);

  stripeHandler = () => ({ status: 200, body: { ...SESSION_PAID, line_items: { data: [{ price: { id: 'price_ADFREE' } }, { price: { id: 'price_SUPPORTER' } }] } } });
  const t2 = ((await text(await call('/success?session_id=cs_test_abcdef1234567890'))).match(/MD1\.[\w-]+\.[\w-]+/) || [])[0];
  chk('6b 複数商品は OR される', (await verify(t2, PUB)).flags === 7);

  // product ID での判定（値上げで price ID が変わっても壊れないようにするため）
  stripeHandler = () => ({ status: 200, body: { ...SESSION_PAID, line_items: { data: [{ price: { id: 'price_UNLISTED', product: 'prod_ADFREE_BYPROD' } }] } } });
  const t3 = ((await text(await call('/success?session_id=cs_test_abcdef1234567890'))).match(/MD1\.[\w-]+\.[\w-]+/) || [])[0];
  chk('6c product ID で判定できる', t3 && (await verify(t3, PUB)).flags === 1, t3 && (await verify(t3, PUB)).flags);

  // expand 済みで product がオブジェクトになっている場合
  stripeHandler = () => ({ status: 200, body: { ...SESSION_PAID, line_items: { data: [{ price: { id: 'price_UNLISTED', product: { id: 'prod_ADFREE_BYPROD' } } }] } } });
  const t4 = ((await text(await call('/success?session_id=cs_test_abcdef1234567890'))).match(/MD1\.[\w-]+\.[\w-]+/) || [])[0];
  chk('6d product が展開済みでも判定できる', t4 && (await verify(t4, PUB)).flags === 1);

  // price ID が一致すればそちらを優先（product が別の値でも price 側が勝つ）
  stripeHandler = () => ({ status: 200, body: { ...SESSION_PAID, line_items: { data: [{ price: { id: 'price_SUPPORTER', product: 'prod_ADFREE_BYPROD' } }] } } });
  const t5 = ((await text(await call('/success?session_id=cs_test_abcdef1234567890'))).match(/MD1\.[\w-]+\.[\w-]+/) || [])[0];
  chk('6e price ID が優先される', t5 && (await verify(t5, PUB)).flags === 7);

  // どちらも未登録なら発行しない
  stripeHandler = () => ({ status: 200, body: { ...SESSION_PAID, line_items: { data: [{ price: { id: 'price_X', product: 'prod_Y' } }] } } });
  chk('6f どちらも未登録なら 500', (await call('/success?session_id=cs_test_abcdef1234567890')).status === 500);
}

// ---- 7. 決済未完了 ----
{
  stripeHandler = () => ({ status: 200, body: { ...SESSION_PAID, payment_status: 'unpaid' } });
  const res = await call('/success?session_id=cs_test_abcdef1234567890');
  const html = await text(res);
  chk('7a 402 を返す', res.status === 402, res.status);
  chk('7b トークンを出さない', !/MD1\./.test(html));
}

// ---- 8. 失敗経路 ----
{
  stripeHandler = () => ({ status: 404, body: { error: {} } });
  const res = await call('/success?session_id=cs_test_abcdef1234567890');
  const html = await text(res);
  chk('8a Stripe 404 → 404', res.status === 404, res.status);
  chk('8b 決済成立を示唆しない', !html.includes('お支払いは完了'), html.slice(0, 120));

  stripeHandler = () => ({ status: 500, body: { error: {} } });
  const res2 = await call('/success?session_id=cs_test_abcdef1234567890');
  const html2 = await text(res2);
  chk('8c Stripe 500 → 500', res2.status === 500, res2.status);
  chk('8d 決済完了を明記する', html2.includes('お支払いは完了'));
  chk('8e 購入 ID を出す', html2.includes('cs_test_abcdef1234567890'));
  chk('8f 連絡先を出す', html2.includes('support@example.invalid'));

  stripeHandler = () => ({ status: 200, body: { ...SESSION_PAID, line_items: { data: [{ price: { id: 'price_UNKNOWN' } }] } } });
  const res3 = await call('/success?session_id=cs_test_abcdef1234567890');
  const html3 = await text(res3);
  chk('8g 未知の price → 500', res3.status === 500, res3.status);
  chk('8h 未知の price でも購入 ID を出す', html3.includes('cs_test_abcdef1234567890'));
  chk('8i トークンを出さない', !/MD1\./.test(html3));

  stripeHandler = () => ({ status: 200, body: { ...SESSION_PAID, line_items: { data: [] } } });
  chk('8j line_items が空でも落ちない', (await call('/success?session_id=cs_test_abcdef1234567890')).status === 500);
}

// ---- 9. HTML エスケープ ----
{
  stripeHandler = () => ({ status: 500, body: {} });
  const res = await worker.fetch(
    new Request('https://w.example/success?session_id=cs_test_abcdef1234567890'),
    { ...ENV, CONTACT: '<script>alert(1)</script>' });
  const html = await text(res);
  chk('9a env 由来の文字列をエスケープする', !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'));
}

const fails = results.filter(r => !r.ok);
for (const r of results) console.log((r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ` [${r.detail}]` : ''));
console.log(`\ntotal=${results.length} passed=${results.length - fails.length} failed=${fails.length}`);
process.exit(fails.length ? 1 : 0);
