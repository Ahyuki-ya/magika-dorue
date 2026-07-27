// Phase 3 取引コード（道A・焼却付き譲渡）の単体検証。
// 指示書の受け入れ条件1〜5＋周辺ガード（traded の扱い・所持上限）を機械チェックする。
// 使い方: node test/p5/harness.js index.html trade
(function () {
  const results = [];
  function chk(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  }
  const KEYS = ['magika_inventory', 'magika_equipped', 'magika_trade_seen'];
  function snapshot() { const s = {}; for (const k of KEYS) s[k] = localStorage.getItem(k); return s; }
  function restore(s) { for (const k of KEYS) { if (s[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, s[k]); } }
  function reset() { for (const k of KEYS) localStorage.removeItem(k); }

  // ---- 0. 基本：発行したコードの形式 ----
  reset();
  const t1 = rollTreasure(600);
  chk('0a addTreasure が成功', addTreasure(t1) === true);
  const ex1 = exportTreasure(t1.id);
  chk('0b 発行成功', ex1.ok, ex1.reason);
  chk('0c 形式 MGKT1.<payload>.<sum>', /^MGKT1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/.test(ex1.code || ''), (ex1.code || '').slice(0, 24));
  chk('0d 元の宝物が traded になる', loadInventory().find(x => x.id === t1.id).traded === true);
  chk('0e traded は装備不可（canExport=false）', canExportTreasure(loadInventory().find(x => x.id === t1.id)) === false);
  chk('0f 再エクスポート不可', exportTreasure(t1.id).ok === false);

  // ---- 1. 受け入れ条件1: 発行→同一ブラウザで受領 → 二重受領で拒否 ----
  const imp1 = importTreasure(ex1.code);
  chk('1 同一ブラウザ受領は二重受領で拒否', imp1.ok === false && /二重受領/.test(imp1.reason || ''), imp1.reason);

  // ---- 4. 受け入れ条件4: 別プレイヤー（localStorage を空に）で正常受領 ----
  const playerA = snapshot();
  reset();                                    // = 別ブラウザ相当
  const imp2 = importTreasure(ex1.code);
  chk('4a 別プレイヤーは受領成功', imp2.ok, imp2.reason);
  chk('4b 宝物庫に入る', loadInventory().length === 1 && loadInventory()[0].id === t1.id);
  chk('4c 受領品に traded は付かない', !loadInventory()[0].traded);
  chk('4d 受領品は装備・譲渡可能', canExportTreasure(loadInventory()[0]) === true);
  chk('4e 内容が同一（レア度/名前/効果）',
      loadInventory()[0].rarity === t1.rarity && loadInventory()[0].name === t1.name
      && JSON.stringify(loadInventory()[0].affixes) === JSON.stringify(t1.affixes));
  chk('4f seen に記録される', loadTradeSeen().includes(t1.id));
  const imp2b = importTreasure(ex1.code);
  chk('4g 同じコードの2回目は拒否', imp2b.ok === false && /二重受領/.test(imp2b.reason || ''), imp2b.reason);
  // 受領側で焼却済みにしてから再受領 → seen で拒否（inventory から消しても通らない）
  deleteTreasure(t1.id);
  const imp2c = importTreasure(ex1.code);
  chk('4h 削除後も seen で拒否', imp2c.ok === false && /受け取り済み/.test(imp2c.reason || ''), imp2c.reason);
  restore(playerA);
  chk('4i 元プレイヤー側は取引済みのまま', loadInventory().find(x => x.id === t1.id).traded === true);

  // ---- 2. 受け入れ条件2: 1文字改変 → チェックサム不一致 ----
  reset();
  const parts = ex1.code.split('.');
  const pay = parts[1];
  // payload の1文字を別の base64url 文字へ差し替え
  const i = Math.floor(pay.length / 2);
  const alt = pay[i] === 'A' ? 'B' : 'A';
  const broken = `${parts[0]}.${pay.slice(0, i)}${alt}${pay.slice(i + 1)}.${parts[2]}`;
  const v2 = validateTradeCode(broken);
  chk('2a payload 1文字改変で拒否', v2.ok === false && /チェックサム/.test(v2.reason || ''), v2.reason);
  const v2b = validateTradeCode(`${parts[0]}.${pay}.${parts[2].slice(0, 7)}${parts[2][7] === '0' ? '1' : '0'}`);
  chk('2b checksum 1文字改変で拒否', v2b.ok === false && /チェックサム/.test(v2b.reason || ''), v2b.reason);
  chk('2c バージョン違いで拒否', validateTradeCode(`MGKT9.${pay}.${parts[2]}`).ok === false);
  chk('2d 区切り数が違うと拒否', validateTradeCode(`MGKT1.${pay}`).ok === false);
  chk('2e 空文字で拒否', validateTradeCode('').ok === false);

  // ---- 3. 受け入れ条件3: affix 値域外・ホワイトリスト外を拒否 ----
  function forge(mut) {                        // 正しいチェックサム付きの偽コードを作る
    const base = JSON.parse(b64urlDecode(pay));
    mut(base);
    const p = b64urlEncode(JSON.stringify(base));
    return `MGKT1.${p}.${fnv1a(p + TRADE_CONFIG.SALT)}`;
  }
  const fBig = forge(o => { o.affixes[0].value = 9999; });
  const r3a = validateTradeCode(fBig);
  chk('3a affix 値が上限超で拒否', r3a.ok === false && /範囲外/.test(r3a.reason || ''), r3a.reason);
  const fNeg = forge(o => { o.affixes[0].value = -5; });
  chk('3b affix 値が下限未満で拒否', validateTradeCode(fNeg).ok === false, validateTradeCode(fNeg).reason);
  const fKey = forge(o => { o.affixes[0].key = 'godMode'; });
  chk('3c 存在しない effect key を拒否', validateTradeCode(fKey).ok === false, validateTradeCode(fKey).reason);
  const fRar = forge(o => { o.rarity = 'god'; });   // 名前も affix 数も合わなくなる
  chk('3d レア度の書き換えを拒否', validateTradeCode(fRar).ok === false, validateTradeCode(fRar).reason);
  const fRar2 = forge(o => { o.rarity = 'ultra'; });
  chk('3e 未定義レア度を拒否', validateTradeCode(fRar2).ok === false, validateTradeCode(fRar2).reason);
  const fName = forge(o => { o.name = 'チート剣'; });
  chk('3f 表に無い名前を拒否', validateTradeCode(fName).ok === false, validateTradeCode(fName).reason);
  const fIcon = forge(o => { o.icon = '💩'; });
  chk('3g 表に無いアイコンを拒否', validateTradeCode(fIcon).ok === false, validateTradeCode(fIcon).reason);
  const fCount = forge(o => { o.affixes = o.affixes.concat([{ key: 'startGold', value: 10 }, { key: 'atk', value: 1 }, { key: 'hp', value: 1 }, { key: 'agi', value: 1 }]); });
  chk('3h affix 個数の水増しを拒否', validateTradeCode(fCount).ok === false, validateTradeCode(fCount).reason);
  const fDup = forge(o => { const k = o.affixes[0].key; o.affixes = o.affixes.map(() => ({ key: k, value: o.affixes[0].value })); });
  chk('3i 同一 affix の重複を拒否（affix数2以上のみ）',
      o_affixLen() < 2 || validateTradeCode(fDup).ok === false, validateTradeCode(fDup).reason);
  function o_affixLen() { return JSON.parse(b64urlDecode(pay)).affixes.length; }
  const fType = forge(o => { o.affixes[0].value = 'つよい'; });
  chk('3j value の型不正を拒否', validateTradeCode(fType).ok === false, validateTradeCode(fType).reason);
  const fNaN = forge(o => { o.affixes = [{ key: o.affixes[0].key, value: Infinity }].concat(o.affixes.slice(1)); });
  chk('3k Infinity を拒否（JSON化で null になる）', validateTradeCode(fNaN).ok === false, validateTradeCode(fNaN).reason);
  // 正規のコードは（seen をクリアすれば）通る＝上の拒否が過剰でない
  reset();
  chk('3z 正規コードは通る', validateTradeCode(ex1.code).ok === true, validateTradeCode(ex1.code).reason);

  // ---- 5. 受け入れ条件5: 不正コードを大量に投げてもクラッシュしない ----
  let crash = null, rejected = 0;
  const junk = ['', ' ', 'MGKT1', 'MGKT1..', 'MGKT1.!!!.zzzzzzzz', '....', 'null', '{}',
                'MGKT1.' + 'A'.repeat(5000) + '.deadbeef', 'MGKT1.QQ.0', '\n\t', '<script>alert(1)</script>'];
  for (let n = 0; n < 200; n++) {
    let s = junk[n % junk.length];
    if (n >= junk.length) {                    // ランダム文字列も混ぜる
      s = '';
      const len = 1 + Math.floor(Math.random() * 80);
      for (let k = 0; k < len; k++) s += String.fromCharCode(32 + Math.floor(Math.random() * 90));
    }
    try { if (validateTradeCode(s).ok === false) rejected++; }
    catch (e) { crash = String(e && e.message || e); break; }
  }
  chk('5 不正コード200本でクラッシュせず全拒否', crash === null && rejected === 200, crash || `rejected=${rejected}`);

  // ---- 6. 所持上限（INV_MAX）----
  reset();
  const inv = [];
  for (let n = 0; n < TRADE_CONFIG.INV_MAX; n++) inv.push(rollTreasure(100));
  saveInventory(inv);
  chk('6a 満杯でドロップ拒否', addTreasure(rollTreasure(100)) === false);
  chk('6b 満杯で受領拒否', validateTradeCode(ex1.code).ok === false && /満杯/.test(validateTradeCode(ex1.code).reason || ''));
  saveInventory(inv.slice(0, TRADE_CONFIG.INV_MAX - 1));
  chk('6c 1枠空けば受領できる', validateTradeCode(ex1.code).ok === true);

  // ---- 7. traded 品の隔離（合成 fodder・装備効果から除外）----
  reset();
  const pack = [];
  const c0 = TREASURE_NAMES.common[0];
  for (let n = 0; n < 12; n++) { const t = rollTreasure(0); t.rarity = 'common'; t.name = c0.name; t.icon = c0.icon; t.kind = c0.kind; pack.push(t); }
  saveInventory(pack);
  chk('7a 同レア11個で合成可', canSynthesize(loadInventory()[0]) === true);
  const burned = loadInventory().map((t, k) => (k > 0 && k < 12 ? Object.assign({}, t, { traded: true }) : t));
  saveInventory(burned);
  chk('7b traded は fodder に数えない', canSynthesize(loadInventory()[0]) === false);
  chk('7c traded 自身は核にできない', canSynthesize(loadInventory()[1]) === false);
  chk('7d synthesize も null を返す', synthesize(loadInventory()[1].id) === null);
  // 装備中に traded になった場合（データ細工）でも効果は乗らない
  const one = burned[1];
  saveEquipped([one.id]);
  chk('7e traded 装備は効果に加算されない', Object.keys(equippedAffixTotals()).length === 0);
  saveInventory([Object.assign({}, one, { traded: false })]);
  chk('7f 通常品なら加算される', Object.keys(equippedAffixTotals()).length > 0);

  // ---- 8. FNV-1a の既知値（実装差の検出）----
  chk('8 fnv1a("") = 811c9dc5', fnv1a('') === '811c9dc5', fnv1a(''));
  chk('8b fnv1a("a") = e40c292c', fnv1a('a') === 'e40c292c', fnv1a('a'));
  chk('8c base64url 往復（日本語）', b64urlDecode(b64urlEncode('魔王の宝冠✨')) === '魔王の宝冠✨');
  chk('8d base64url に +/= を含まない', !/[+/=]/.test(b64urlEncode('あ'.repeat(50))));

  // ---- 9. UI 経路のスモーク（DOMスタブ上で例外を出さないこと。confirm スタブは常に true）----
  reset();
  const t9 = rollTreasure(700);
  addTreasure(t9);
  let uiErr = null;
  try {
    showTreasury(); renderTreasuryAll();
    tzShowDetail(t9.id);
    tzExport(t9.id);                             // 発行 → 発行モーダル表示
    tradeCopyCode();                             // clipboard/execCommand なし環境でも落ちない
    const code9 = document.getElementById('tradeExportCode').value;
    chk('9a 発行モーダルにコードが入る', /^MGKT1\./.test(code9 || ''), (code9 || '').slice(0, 12));
    tradeCloseExport();
    tzDelete(t9.id);                             // confirm=true → 削除
    chk('9b 削除で宝物庫が空になる', loadInventory().length === 0);
    tradeOpenImport();
    document.getElementById('tradeImportInput').value = code9;
    tradeDoImport();                             // 別プレイヤー扱い（seen も消してある）
    chk('9c UI 経路で受領できる', loadInventory().length === 1 && loadInventory()[0].id === t9.id);
    document.getElementById('tradeImportInput').value = code9;
    tradeDoImport();                             // 2回目は拒否メッセージ
    chk('9d 2回目の受領は増えない', loadInventory().length === 1);
    tradeCloseImport(); tzCloseDetail();
    showScreenOnly('titleScreen');               // モーダル一括クローズを通す
  } catch (e) { uiErr = String(e && e.stack || e); }
  chk('9 UI 経路で例外なし', uiErr === null, uiErr);

  reset();
  const fails = results.filter(r => !r.ok);
  process.stdout.write(JSON.stringify({
    total: results.length, passed: results.length - fails.length, failed: fails.length,
    failures: fails, all: results.map(r => (r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ` [${r.detail}]` : '')),
  }, null, 1) + '\n');
})();
