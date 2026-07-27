// 宝物の「系統（アーキタイプ）」の検証と、効果の出現率の実測。
//   ・アイコンと名前がペアで一貫しているか（🪨 錆びた剣 のような不一致が出ないこと）
//   ・系統ごとに効果へ重みが乗っているか（剣＝攻撃、盾＝体力…）
//   ・進化が同系統を優先するか／旧セーブ（kind なし）を名前から救済できるか
// 使い方: node test/p5/harness.js index.html kind
(function () {
  const results = [];
  const chk = (name, cond, detail) => results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  const reset = () => ['magika_inventory', 'magika_equipped', 'magika_trade_seen'].forEach(k => localStorage.removeItem(k));

  // ---- 1. カタログの整合 ----
  let pairBroken = [], kindBroken = [], dupName = [];
  const seenNames = new Set();
  for (const rk of RARITY_KEYS) {
    const pool = TREASURE_NAMES[rk];
    if (!Array.isArray(pool)) { pairBroken.push(rk + ':not-array'); continue; }
    for (const e of pool) {
      if (!e.icon || !e.name) pairBroken.push(rk + ':' + e.name);
      if (!TREASURE_KINDS[e.kind]) kindBroken.push(`${e.name}(${e.kind})`);
      const key = rk + '/' + e.name;
      if (seenNames.has(key)) dupName.push(key);
      seenNames.add(key);
    }
  }
  chk('1a 全エントリがアイコン＋名前のペア', pairBroken.length === 0, pairBroken.join(','));
  chk('1b 全エントリの系統が定義済み', kindBroken.length === 0, kindBroken.join(','));
  chk('1c 同レア度内に同名が無い', dupName.length === 0, dupName.join(','));
  chk('1d 系統には表示ラベルと説明がある',
      Object.values(TREASURE_KINDS).every(k => k.label && k.hint && k.weights));

  // ---- 2. ドロップでアイコンと名前が食い違わない ----
  reset();
  const nameToIcon = new Map();
  let mismatch = 0, N = 4000;
  gameMode = 'standard';
  for (let i = 0; i < N; i++) {
    const t = rollTreasure(300 + (i % 700));
    const prev = nameToIcon.get(t.name);
    if (prev === undefined) nameToIcon.set(t.name, t.icon);
    else if (prev !== t.icon) mismatch++;
    const e = treasureEntry(t.rarity, t.name);
    if (!e || e.icon !== t.icon || e.kind !== t.kind) mismatch++;
  }
  chk('2a 名前とアイコンの対応が常に一致', mismatch === 0, `mismatch=${mismatch}/${N}`);
  chk('2b ドロップ品に kind が入る', !!rollTreasure(100).kind);

  // ---- 3. 系統ごとの効果出現率（実測）----
  function affixRate(kind, n, trials) {
    const cnt = {};
    for (let i = 0; i < trials; i++)
      for (const a of rollAffixes(n, 1, kind)) cnt[a.key] = (cnt[a.key] || 0) + 1;
    const out = {};
    for (const k of Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]))
      out[k] = +(cnt[k] / trials * 100).toFixed(1);   // 1個の宝物に付く確率(%)
    return out;
  }
  const T = 20000;
  const rBlade = affixRate('blade', 1, T);
  const rShield = affixRate('shield', 1, T);
  const rRelic = affixRate('relic', 1, T);
  const rFlat = affixRate(null, 1, T);
  // 均等なら「2種で20%」。系統ありでその倍以上（=40%超）を「傾向が効いている」とみなす。
  const top2 = r => Object.keys(r).slice(0, 2).sort();
  chk('3a 刃は攻撃系が上位2つ', (rBlade.atk + rBlade.mulAtk) > 40 && top2(rBlade).join() === 'atk,mulAtk', JSON.stringify(rBlade));
  chk('3b 盾は体力系が上位2つ', (rShield.hp + rShield.mulHp) > 40 && top2(rShield).join() === 'hp,mulHp', JSON.stringify(rShield));
  chk('3c 遺物は初期ゴールドが最上位', Object.keys(rRelic)[0] === 'startGold', JSON.stringify(rRelic));
  chk('3d 刃でも他効果は出る（当たりの幅を残す）', (rBlade.sight || 0) > 1 && (rBlade.hp || 0) > 1);
  chk('3e 系統なしは概ね均等（各10%前後）',
      Object.values(rFlat).every(v => v > 7 && v < 13), JSON.stringify(rFlat));
  chk('3f 複数affixでも重複しない',
      Array.from({ length: 500 }, () => rollAffixes(4, 1, 'crown'))
           .every(as => new Set(as.map(a => a.key)).size === as.length));

  // ---- 4. 進化は同系統を優先 ----
  reset();
  let sameKind = 0, tries = 300;
  for (let i = 0; i < tries; i++) {
    const base = { id: 'b', name: '錆びた剣', icon: '🗡️', rarity: 'common', kind: 'blade',
                   affixes: [{ key: 'atk', value: 1 }], bornDepth: 0, bornRun: 0, createdAt: 0 };
    const ev = evolveTreasure(base, 'uncommon');
    if (ev.kind === 'blade' || !TREASURE_NAMES.uncommon.some(e => e.kind === 'blade')) sameKind++;
  }
  chk('4a 進化先は同系統を優先（無ければ全候補）', sameKind === tries, `${sameKind}/${tries}`);
  const evBlade = evolveTreasure(
    { id:'b', name:'漆黒の刃', icon:'⚔️', rarity:'epic', kind:'blade', affixes:[{key:'atk',value:2}], bornDepth:0, bornRun:0, createdAt:0 },
    'legendary');
  chk('4b 継承した効果は残る', evBlade.affixes.some(a => a.key === 'atk'), JSON.stringify(evBlade.affixes.map(a => a.key)));
  chk('4c 進化後の名前とアイコンもペア一致',
      (e => !!e && e.icon === evBlade.icon)(treasureEntry('legendary', evBlade.name)), `${evBlade.icon} ${evBlade.name}`);

  // ---- 5. 旧セーブ救済（kind を持たない宝物）----
  chk('5a 名前から系統を逆引きできる', kindOfTreasure({ rarity:'common', name:'ひび割れた盾' }) === 'shield');
  chk('5b 未知の名前は null（表示は出さない）', kindOfTreasure({ rarity:'common', name:'謎の何か' }) === null);
  chk('5c 旧仕様のちぐはぐな組み合わせも取引できる',
      validateTradeCode(exportOf({ rarity:'common', name:'錆びた剣', icon:'🪨' })).ok === true);
  function exportOf(part) {                       // 旧バージョン相当の宝物からコードを作る
    reset();
    const t = { id:'tz_old1', name:part.name, icon:part.icon, rarity:part.rarity,
                affixes:[{ key:'atk', value:1 }], bornDepth:10, bornRun:1, createdAt:1 };
    saveInventory([t]);
    const res = exportTreasure(t.id);
    reset();
    return res.code;
  }

  reset();
  const fails = results.filter(r => !r.ok);
  process.stdout.write(JSON.stringify({
    total: results.length, passed: results.length - fails.length, failed: fails.length,
    failures: fails,
    measured: { blade: rBlade, shield: rShield, relic: rRelic, none: rFlat },
    all: results.map(r => (r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ` [${r.detail}]` : '')),
  }, null, 1) + '\n');
})();
