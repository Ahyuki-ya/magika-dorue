// 課金ライセンス（MD1 トークン）の単体検証。
// 使い方: node test/p5/harness.js index.html license
//
// 実鍵ペアをその場で生成して LICENSE_PUBKEYS に注入し、Worker と同じ手順で署名したトークンを
// verifyLicense に食わせる。Stripe も Cloudflare も要らない（実装順序の手順1〜3をここで閉じる）。
(async function () {
  const results = [];
  function chk(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  }
  function done() {
    const fails = results.filter(r => !r.ok);
    process.stdout.write(JSON.stringify({
      total: results.length, passed: results.length - fails.length, failed: fails.length,
      failures: fails, all: results.map(r => (r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ` [${r.detail}]` : '')),
    }, null, 1) + '\n');
  }

  try {
    const enc = new TextEncoder();

    // ---- 発行側（worker/src/index.js の mintToken と同じ手順） ----
    function b64u(bytes) {
      let s = ''; for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function makePayload({ v = 1, kid = 1, flags = 0x07, iat = 1754700000, lid, len = 15 }) {
      const p = new Uint8Array(len);
      p[0] = v; p[1] = kid; p[2] = flags;
      new DataView(p.buffer).setUint32(3, iat, false);
      p.set(lid || new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 7);
      return p;
    }
    async function sign(priv, payload, domainStr) {
      const dom = enc.encode(domainStr === undefined ? 'magika-dorue/license/v1' : domainStr);
      const msg = new Uint8Array(dom.length + payload.length);
      msg.set(dom, 0); msg.set(payload, dom.length);
      return new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, msg));
    }
    async function token(priv, opts = {}) {
      const p = makePayload(opts);
      return `MD1.${b64u(p)}.${b64u(await sign(priv, p, opts.domain))}`;
    }

    async function newKey(kid) {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
      LICENSE_PUBKEYS[kid] = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
      return pair.privateKey;
    }

    const k1 = await newKey(1);

    // ---- 0. base64url ヘルパのリグレッション（バイト版へ載せ替えた影響がないこと） ----
    const sample = 'あいう🎮 abc/+=?';
    chk('0a 文字列 b64url が往復する', b64urlDecode(b64urlEncode(sample)) === sample);
    chk('0b パディングを含まない', !/=/.test(b64urlEncode(sample)));
    chk('0c バイト版が往復する',
        Array.from(b64urlDecodeBytes(b64urlEncodeBytes(new Uint8Array([0, 255, 128, 1])))).join(',') === '0,255,128,1');
    const tz = rollTreasure(600);
    addTreasure(tz);
    chk('0d 既存の取引コードが今も発行できる', /^MGKT1\./.test((exportTreasure(tz.id) || {}).code || ''));
    deleteTreasure(tz.id);

    // ---- 1. 正常系 ----
    const t1 = await token(k1, { flags: 0x07, iat: 1754700000 });
    chk('1a 長さが仕様どおり 111 文字', t1.length === 111, t1.length);
    const r1 = await verifyLicense(t1);
    chk('1b 検証に成功する', r1 !== null);
    chk('1c flags が読める', r1 && r1.flags === 0x07, r1 && r1.flags);
    chk('1d iat が読める（uint32 BE）', r1 && r1.iat === 1754700000, r1 && r1.iat);
    chk('1e lid が16桁hex', r1 && /^[0-9a-f]{16}$/.test(r1.lid), r1 && r1.lid);
    chk('1f kid が読める', r1 && r1.kid === 1);
    chk('1g 2106年まで表現できる', (await verifyLicense(await token(k1, { iat: 4294967295 }))).iat === 4294967295);

    // ---- 2. 改ざん検知 ----
    const parts = t1.split('.');
    const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
    chk('2a payload 1文字改変を拒否', await verifyLicense(`MD1.${flip(parts[1], 5)}.${parts[2]}`) === null);
    chk('2b signature 1文字改変を拒否', await verifyLicense(`MD1.${parts[1]}.${flip(parts[2], 10)}`) === null);
    chk('2c 別の鍵で署名したものを拒否', await verifyLicense(await token(await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']).then(p => p.privateKey))) === null);
    chk('2d flags だけ書き換えても通らない',
        await verifyLicense(`MD1.${b64u(makePayload({ flags: 0xff }))}.${parts[2]}`) === null);

    // ---- 3. 形式・バージョン・鍵 ----
    chk('3a プレフィクス違いを拒否', await verifyLicense(t1.replace('MD1.', 'MD2.')) === null);
    chk('3b 区切りが3つでないものを拒否', await verifyLicense(`MD1.${parts[1]}`) === null);
    chk('3c 空文字を拒否', await verifyLicense('') === null);
    chk('3d null を拒否（例外を投げない）', await verifyLicense(null) === null);
    chk('3e 未知の v を拒否', await verifyLicense(await token(k1, { v: 2 })) === null);
    chk('3f 未知の kid を拒否', await verifyLicense(await token(k1, { kid: 99 })) === null);
    chk('3g payload 長が違うものを拒否', await verifyLicense(await token(k1, { len: 16 })) === null);
    chk('3h base64url 外の文字を拒否', await verifyLicense(`MD1.${parts[1].slice(0, -1)}*.${parts[2]}`) === null);
    chk('3i 壊れた base64 で例外を投げない', await verifyLicense('MD1.!!!.???') === null);

    // ドメイン分離：同じ鍵を別用途（トレードコード等）に使い回しても署名が流用できない
    chk('3j 別ドメインで署名したものを拒否',
        await verifyLicense(await token(k1, { domain: 'magika-dorue/trade/v1' })) === null);

    // ---- 4. コピペ事故への耐性 ----
    chk('4a 改行・空白を吸収する', (await verifyLicense(` ${parts[0]}.${parts[1]}\n.${parts[2]} \t`)) !== null);
    chk('4b 大文字小文字は区別する（小文字化は拒否）', await verifyLicense(t1.toLowerCase()) === null);
    chk('4c 取引コード(MGKT1)をライセンスとして受理しない',
        await verifyLicense('MGKT1.eyJhIjoxfQ.deadbeef') === null);
    chk('4d ライセンスを取引コードとして受理しない', validateTradeCode(t1).ok === false);

    // ---- 5. 未知ビットの無視（将来の特典追加で古いクライアントが壊れないこと） ----
    const rF = await verifyLicense(await token(k1, { flags: 0xf7 }));
    chk('5a 未知ビット付きでも検証は通る', rF !== null);
    applyLicense(rF);
    chk('5b 既知の3ビットだけを見る', LIC.adFree && LIC.cosmetics && LIC.credits);

    // ---- 6. LIC への落とし込みとテーマ ----
    const themeProps = document.documentElement.__styleProps;
    applyLicense(await verifyLicense(await token(k1, { flags: 0x01 })));   // 広告オフのみ
    chk('6a adFree だけ立つ', LIC.adFree === true && LIC.cosmetics === false && LIC.credits === false);
    chk('6b 広告 SDK を読み込まない', shouldLoadAds() === false);
    chk('6c テーマは適用されない', Object.keys(themeProps).length === 0, JSON.stringify(themeProps));

    applyLicense(await verifyLicense(await token(k1, { flags: 0x07 })));   // サポーター
    chk('6d cosmetics で CSS 変数が上書きされる', Object.keys(themeProps).length === Object.keys(SUPPORTER_THEME).length);
    chk('6e 上書き値が SUPPORTER_THEME と一致', themeProps['--c-frame'] === SUPPORTER_THEME['--c-frame'], themeProps['--c-frame']);

    applyLicense(null);
    chk('6f 解除で LIC が全部落ちる', !LIC.adFree && !LIC.cosmetics && !LIC.credits && LIC.lid === null);
    chk('6g 解除で CSS 変数が消える', Object.keys(themeProps).length === 0, JSON.stringify(themeProps));
    chk('6h 解除で広告を読み込む', shouldLoadAds() === true);

    // ---- 7. 失効リスト ----
    const tRev = await token(k1, { lid: new Uint8Array([0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0xa7, 0xb8]) });
    chk('7a 失効前は有効', await verifyLicense(tRev) !== null);
    REVOKED_LIDS.add('a1b2c3d4e5f6a7b8');
    chk('7b 失効させると拒否', await verifyLicense(tRev) === null);
    chk('7c 他のライセンスは巻き込まれない', await verifyLicense(t1) !== null);
    REVOKED_LIDS.delete('a1b2c3d4e5f6a7b8');

    // ---- 8. 永続化（保存 → 起動時ロード → 削除） ----
    localStorage.removeItem(LICENSE_KEY);
    const act = await activateLicense(`  ${t1}  `);
    chk('8a 有効化に成功', act.ok === true, act.reason);
    chk('8b localStorage キーが magika_ 規約に沿う', LICENSE_KEY === 'magika_license', LICENSE_KEY);
    chk('8c 空白を除去して保存する', localStorage.getItem(LICENSE_KEY) === t1);
    applyLicense(null);                                    // 起動直後の状態に戻す
    await loadLicense();
    chk('8d 起動時ロードで復元される', LIC.cosmetics === true && LIC.lid === (await verifyLicense(t1)).lid);
    const bad = await activateLicense('MD1.xxx.yyy');
    chk('8e 不正コードは拒否し理由を細分化しない', bad.ok === false && bad.reason === 'コードが正しくありません', bad.reason);
    chk('8f 拒否しても既存ライセンスは残る', localStorage.getItem(LICENSE_KEY) === t1 && LIC.cosmetics === true);
    clearLicense();
    chk('8g 削除で localStorage から消える', localStorage.getItem(LICENSE_KEY) === null);
    chk('8h 削除で特典が落ちる', LIC.cosmetics === false);

    // 失効済みトークンが保存されていたら起動時に自動で外れる（返金後の再訪を想定）
    REVOKED_LIDS.add((await verifyLicense(t1)).lid);
    localStorage.setItem(LICENSE_KEY, t1);
    await loadLicense();
    chk('8i 失効済みは起動時に自動で外れる', LIC.cosmetics === false && localStorage.getItem(LICENSE_KEY) === null);
    REVOKED_LIDS.clear();

    // ---- 9. 鍵ローテーション（旧 kid を消さずに増やす） ----
    const k2 = await newKey(2);
    const tOld = t1, tNew = await token(k2, { kid: 2, flags: 0x07 });
    chk('9a 新しい kid のトークンが通る', await verifyLicense(tNew) !== null);
    chk('9b 旧 kid のトークンも通り続ける', await verifyLicense(tOld) !== null);
    chk('9c kid と鍵の組み合わせ違いは拒否', await verifyLicense(await token(k1, { kid: 2 })) === null);
    delete LICENSE_PUBKEYS[2];
    chk('9d 公開鍵を消すとその kid だけ無効になる',
        await verifyLicense(tNew) === null && await verifyLicense(tOld) !== null);

    // ---- 10. UI 経路スモーク ----
    let uiErr = null;
    try {
      clearLicense();
      renderLicenseUI();
      licOpenInput();
      chk('10a 未購入時の欄に購入導線が出る', /コードを入力/.test(document.getElementById('licSection').innerHTML));
      document.getElementById('licInput').value = t1;
      await licDoActivate();
      chk('10b UI 経路で有効化できる', LIC.cosmetics === true);
      chk('10c 反映にリロードを要求しない（同期的に LIC が立つ）', LIC.credits === true);
      renderSettings();
      licOpenInput();
      licRemove();                                   // harness の confirm は true
      chk('10d UI 経路で削除できる', LIC.cosmetics === false && localStorage.getItem(LICENSE_KEY) === null);
      licCloseInput();
      showScreenOnly('titleScreen');
    } catch (e) { uiErr = String(e && e.stack || e); }
    chk('10 UI 経路で例外なし', uiErr === null, uiErr);

    // ---- 11. 出荷物の静的検査 ----
    const src = HARNESS.readFile(HARNESS.htmlPath);
    const pubBlock = (src.match(/const LICENSE_PUBKEYS = \{([\s\S]*?)\n    \};/) || [])[1] || '';
    const liveKids = (pubBlock.match(/^\s*(\d+)\s*:/gm) || []).map(s => parseInt(s, 10));
    chk('11a テスト用 kid(200番台) を出荷物に載せていない',
        !liveKids.some(k => k >= 200), liveKids.join(','));
    chk('11b 秘密鍵らしきものが混ざっていない', !/"d"\s*:|'d'\s*:/.test(pubBlock));
    chk('11c localStorage キーが magika_ 接頭辞', /const LICENSE_KEY = 'magika_/.test(src));
    // 広告SDKを足すときの落とし穴：ハーネスは最初の <script> を本体とみなす
    chk('11d 最初の <script> がゲーム本体である',
        (src.match(/<script>([\s\S]*?)<\/script>/) || ['', ''])[1].indexOf('function verifyLicense') > 0);
    chk('11e ライセンス層が外部リソースを引かない',
        !/fetch\(|XMLHttpRequest/.test(src.slice(src.indexOf('const LICENSE_KEY'), src.indexOf('const ACHIEVEMENTS'))));
  } catch (e) {
    chk('FATAL 例外なく完走する', false, String(e && e.stack || e));
  }

  try { localStorage.removeItem(LICENSE_KEY); } catch (e) {}
  done();
})();
