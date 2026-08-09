// Magika・Dorue ライセンス発行 Worker
// 依存パッケージなし。Stripe REST を fetch で直接叩く（取得するのは Checkout Session 1本だけ）。
// 状態を一切持たない: KV / D1 / R2 を使わず、ライセンスの実体は署名付き文字列そのもの。
//
// エンドポイント
//   GET /health                                  デプロイ確認
//   GET /success?session_id=cs_...               決済後の受け取りページ（Stripe の success_url）
//
// 必要なシークレット（wrangler secret put）
//   STRIPE_SECRET_KEY        sk_live_... / sk_test_...
//   SIGNING_KEY_PKCS8_B64    ECDSA P-256 秘密鍵（PKCS#8 DER の base64）
//   LID_SALT                 lid 導出用ソルト
// 必要な変数（wrangler.toml の [vars]）
//   KID, PRICE_FLAGS, GAME_URL, CONTACT, STRIPE_API_VERSION

const enc = new TextEncoder();
const DOMAIN = enc.encode('magika-dorue/license/v1');

// Stripe の Checkout Session ID。総当りリクエストで Stripe API を叩かせないための足切り。
const SESSION_ID_RE = /^cs_(test_|live_)?[A-Za-z0-9]{10,80}$/;

// ---------- base64 ----------
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
function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- トークン発行（冪等） ----------
// lid は session.id、iat は session.created から決まるので、同じセッションなら常に同じ内容になる。
// ECDSA の署名値自体は乱数を含むため毎回変わるが、署名対象が同一なのでどちらも有効であり、
// lid が同じである以上ライセンスとしては同一物として扱われる（＝再発行が DB なしで成立する）。
async function mintToken(env, session, flags) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(env.LID_SALT + '|' + session.id));
  const lid = new Uint8Array(digest).slice(0, 8);

  const payload = new Uint8Array(15);
  payload[0] = 1;                                                     // v
  payload[1] = Number(env.KID);                                       // kid
  payload[2] = flags;                                                 // flags
  new DataView(payload.buffer).setUint32(3, session.created, false);  // iat (BE)
  payload.set(lid, 7);                                                // lid

  const key = await crypto.subtle.importKey(
    'pkcs8', b64Decode(env.SIGNING_KEY_PKCS8_B64),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const msg = new Uint8Array(DOMAIN.length + payload.length);
  msg.set(DOMAIN, 0);
  msg.set(payload, DOMAIN.length);

  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, msg);
  return { token: `MD1.${b64uEncode(payload)}.${b64uEncode(new Uint8Array(sig))}`, lid: toHex(lid) };
}

// ---------- Stripe ----------
async function fetchSession(env, sessionId) {
  const url = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`;
  const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  // API バージョンは必ず固定する。未固定だと将来の Stripe 側変更で line_items の形が変わって壊れる。
  if (env.STRIPE_API_VERSION) headers['Stripe-Version'] = env.STRIPE_API_VERSION;
  const res = await fetch(url, { headers });
  if (!res.ok) return { error: `stripe_${res.status}`, body: await res.text() };
  return { session: await res.json() };
}

// 商品 → flags。金額では判定しない（任意金額商品で破綻するため）。
// キーは product ID(prod_…) と price ID(price_…) のどちらでもよい。
//
// ★ product ID を推奨する。Stripe の価格は変更できず、値上げすると新しい price ID が発番される。
//   price ID で判定していると、値上げした瞬間に「課金されたのにコードが出ない」事故になる。
//   product ID は価格を変えても不変なので、この事故が起きない。
function flagsForSession(env, session) {
  let map;
  try { map = JSON.parse(env.PRICE_FLAGS || '{}'); } catch { return null; }
  const items = session.line_items && session.line_items.data;
  if (!items || !items.length) return null;
  const has = (k) => k && Object.prototype.hasOwnProperty.call(map, k);
  let flags = 0, matched = 0;
  for (const it of items) {
    const price = it.price;
    if (!price) continue;
    // price.product は未 expand なら文字列、expand 済みならオブジェクト。両方受ける。
    const prod = price.product && (typeof price.product === 'string' ? price.product : price.product.id);
    const key = has(price.id) ? price.id : (has(prod) ? prod : null);
    if (key) { flags |= Number(map[key]); matched++; }
  }
  return matched > 0 ? flags : null;
}

// ---------- ページ ----------
const CSS = `
:root{color-scheme:dark}
body{margin:0;padding:32px 16px;background:#000018;color:#f0f0f0;
     font-family:"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;line-height:1.7}
main{max-width:560px;margin:0 auto}
h1{font-size:1.25rem;color:#ffcc00;margin:0 0 4px}
p{font-size:.9rem;color:#cfe3ff}
.sub{color:#8899cc;font-size:.8rem}
textarea{width:100%;box-sizing:border-box;height:5.5em;background:#050a20;color:#cfe3ff;
         border:1px solid #4466cc;border-radius:2px;padding:10px;font-family:ui-monospace,monospace;
         font-size:.85rem;word-break:break-all;resize:vertical}
button,a.btn{display:block;width:100%;box-sizing:border-box;margin-top:10px;padding:12px;
             background:#1a3a2a;color:#f0f0f0;border:1px solid #2ecc71;border-radius:2px;
             font-size:.95rem;cursor:pointer;text-align:center;text-decoration:none}
a.btn{background:#3a3210;border-color:#ffcc00}
ol{font-size:.85rem;color:#cfe3ff;padding-left:1.3em}
.err{border-left:3px solid #ff4422;padding-left:12px}
code{background:#050a20;padding:2px 6px;border-radius:2px;font-size:.85rem;word-break:break-all}
`;

function page(title, bodyHtml, status) {
  return new Response(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><main>${bodyHtml}</main></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
        'Referrer-Policy': 'no-referrer',
      },
    }
  );
}

function successPage(env, token, lid) {
  const gameUrl = env.GAME_URL || '';
  return page('ライセンスコード — Magika・Dorue', `
<h1>ご支援ありがとうございます</h1>
<p>以下のコードをゲーム内の「サポーターコードを入力」に貼り付けてください。</p>
<textarea id="code" readonly onclick="this.select()">${esc(token)}</textarea>
<button id="copy" type="button">コードをコピー</button>
${gameUrl ? `<a class="btn" href="${esc(gameUrl)}">ゲームへ戻る</a>` : ''}
<ol>
  <li>コードをコピーする</li>
  <li>ゲームの「その他設定」→「サポーターコードを入力」を開く</li>
  <li>貼り付けて「有効化」</li>
</ol>
<p class="sub">このページはブックマークしておけば、同じコードをいつでも取り出せます。
コードを紛失した場合は購入時のメールアドレスを添えて${env.CONTACT ? ` ${esc(env.CONTACT)} まで` : 'ご連絡ください'}。</p>
<p class="sub">ライセンス ID: <code>${esc(lid)}</code></p>
<script>
document.getElementById('copy').addEventListener('click', async function () {
  var ta = document.getElementById('code');
  try { await navigator.clipboard.writeText(ta.value); }
  catch (e) { ta.select(); document.execCommand('copy'); }
  this.textContent = 'コピーしました';
});
</script>`, 200);
}

// 決済は成立しているのに発行できなかったとき用。
// ここで cs_ を必ず見せる — これが無いと利用者は問い合わせる手がかりを失う。
function paidButFailedPage(env, sessionId, code) {
  return page('発行に失敗しました — Magika・Dorue', `
<div class="err">
<h1>コードの発行に失敗しました</h1>
<p><b>お支払いは完了しています。</b>お手数ですが、以下の購入 ID を添えてご連絡ください。
折り返し同じコードをお送りします。</p>
<p>購入 ID: <code>${esc(sessionId)}</code><br>エラー: <code>${esc(code)}</code></p>
${env.CONTACT ? `<p>連絡先: <code>${esc(env.CONTACT)}</code></p>` : ''}
<p class="sub">このページを閉じる前に、購入 ID を控えてください。</p>
</div>`, 500);
}

// ---------- ルーティング ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
    }

    // デプロイ済みの署名鍵に対応する「公開鍵」を返す。index.html に貼る値そのもの。
    // 公開鍵は秘密ではない（出荷 HTML に埋め込まれる前提のもの）ので、露出しても問題ない。
    // これがあると、鍵生成時の出力を失っても復旧でき、かつ
    // 「HTML に貼った公開鍵が、実際に署名している秘密鍵と対か」を確認できる。
    if (url.pathname === '/pubkey') {
      try {
        const key = await crypto.subtle.importKey(
          'pkcs8', b64Decode(env.SIGNING_KEY_PKCS8_B64),
          { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']
        );
        const jwk = await crypto.subtle.exportKey('jwk', key);
        // x と y だけを取り出す。d（秘密指数）は絶対に載せない。
        const pub = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
        const kid = Number(env.KID);
        return new Response(JSON.stringify({
          kid,
          jwk: pub,
          snippet: `        ${kid}: { kty:'EC', crv:'P-256', x:'${pub.x}', y:'${pub.y}' },`,
        }, null, 2), {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      } catch (e) {
        console.error('pubkey failed', e && e.stack || e);
        return new Response('{"error":"unavailable"}', { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
    if (url.pathname !== '/success') {
      return page('Not Found', '<h1>404</h1>', 404);
    }
    if (request.method !== 'GET') {
      return page('Method Not Allowed', '<h1>405</h1>', 405);
    }

    // 設定ミスは「決済後に初めて発覚する」のが最悪なので、Stripe を呼ぶ前に落とす。
    const kid = Number(env.KID);
    if (!Number.isInteger(kid) || kid < 1 || kid > 255) {
      console.error('config error: KID is invalid', env.KID);
      return page('設定エラー', '<div class="err"><h1>設定エラー</h1><p>時間をおいて再度お試しください。</p></div>', 500);
    }
    if (!env.STRIPE_SECRET_KEY || !env.SIGNING_KEY_PKCS8_B64 || !env.LID_SALT) {
      console.error('config error: missing secret');
      return page('設定エラー', '<div class="err"><h1>設定エラー</h1><p>時間をおいて再度お試しください。</p></div>', 500);
    }

    const sessionId = url.searchParams.get('session_id') || '';
    if (!SESSION_ID_RE.test(sessionId)) {
      return page('リクエストが不正です', '<div class="err"><h1>リクエストが不正です</h1><p>購入完了ページのリンクからアクセスしてください。</p></div>', 400);
    }

    const r = await fetchSession(env, sessionId);
    if (r.error) {
      console.error('stripe fetch failed', sessionId, r.error, r.body);
      // 404 はセッションが存在しない＝利用者側の入力ミスなので、決済成立を示唆しない文面にする。
      if (r.error === 'stripe_404') {
        return page('見つかりません', '<div class="err"><h1>購入情報が見つかりません</h1><p>購入完了ページのリンクからアクセスしてください。</p></div>', 404);
      }
      return paidButFailedPage(env, sessionId, r.error);
    }

    const session = r.session;
    if (session.payment_status !== 'paid') {
      return page('お支払いが未完了です', `
<div class="err"><h1>お支払いが未完了です</h1>
<p>決済が完了するとコードが発行されます。完了後にこのページを再読み込みしてください。</p>
<p class="sub">状態: <code>${esc(session.payment_status || 'unknown')}</code></p></div>`, 402);
    }

    const flags = flagsForSession(env, session);
    if (flags === null || flags === 0) {
      console.error('unknown price', sessionId, JSON.stringify(session.line_items || {}));
      return paidButFailedPage(env, sessionId, 'unknown_price');
    }

    try {
      const { token, lid } = await mintToken(env, session, flags);
      return successPage(env, token, lid);
    } catch (e) {
      console.error('mint failed', sessionId, e && e.stack || e);
      return paidButFailedPage(env, sessionId, 'mint_failed');
    }
  },
};
