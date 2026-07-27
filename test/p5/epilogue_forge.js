// 宝具の鍛錬（強化合成）と昇格の検証。
//   ・Lv で効果値が伸びる（Lv1 = 基礎値、Lv MAX = 2倍）
//   ・素材の経験値と必要経験値の設計（同ランク MAT_TO_MAX 個で Lv1→MAX）
//   ・昇格は「Lv MAX ＋ 同ランク PROMOTE_COST 個」、系統と効果を引き継ぐ
//   ・旧セーブ（lv/exp なし）は Lv1 扱い
// 使い方: node test/p5/harness.js index.html forge
(function () {
  const results = [];
  const chk = (name, cond, detail) => results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  const reset = () => ['magika_inventory', 'magika_equipped', 'magika_trade_seen'].forEach(k => localStorage.removeItem(k));
  // 指定ランク・Lvの宝具を作る（affix は固定して比較しやすくする）
  function make(rarity, lv, affixes) {
    const e = TREASURE_NAMES[rarity][0];
    return { id: 'f_' + rarity + '_' + Math.round(Math.random() * 1e9).toString(36),
             name: e.name, icon: e.icon, rarity, kind: e.kind, lv: lv || 1, exp: 0,
             affixes: affixes || [{ key: 'atk', value: 10 }], bornDepth: 0, bornRun: 1, createdAt: 1 };
  }

  // ---- 1. Lv による効果値の伸び ----
  const t1 = make('epic', 1, [{ key: 'atk', value: 10 }, { key: 'mulAtk', value: 1.2 }]);
  const cap = lvCapOf('epic');
  chk('1a Lv1 は基礎値のまま', affixValueAt(t1, t1.affixes[0]) === 10);
  const tMax = Object.assign({}, t1, { lv: cap });
  chk('1b Lv MAX で約2倍（加算系）', affixValueAt(tMax, t1.affixes[0]) === 20, affixValueAt(tMax, t1.affixes[0]));
  chk('1c Lv MAX で約2倍（倍率系・小数2桁）', affixValueAt(tMax, t1.affixes[1]) === 2.4, affixValueAt(tMax, t1.affixes[1]));
  const tMid = Object.assign({}, t1, { lv: Math.ceil((1 + cap) / 2) });
  const mid = affixValueAt(tMid, t1.affixes[0]);
  chk('1d 中間Lvは単調に増える', mid > 10 && mid < 20, mid);
  chk('1e ランクごとに Lv 上限が違う',
      lvCapOf('common') < lvCapOf('rare') && lvCapOf('rare') < lvCapOf('legendary'),
      RARITY_KEYS.map(k => `${k}:${lvCapOf(k)}`).join(' '));
  chk('1f 旧セーブ（lv/exp なし）は Lv1 扱い',
      lvOf({ rarity: 'epic' }) === 1 && expOf({ rarity: 'epic' }) === 0);
  chk('1g Lv は上限でクランプ', lvOf({ rarity: 'common', lv: 999 }) === lvCapOf('common'));

  // ---- 2. 装備効果に Lv が乗る ----
  reset();
  const eq1 = make('rare', 1, [{ key: 'atk', value: 8 }]);
  saveInventory([eq1]); saveEquipped([eq1.id]);
  const atk1 = equippedAffixTotals().atk;
  const inv = loadInventory(); inv[0].lv = lvCapOf('rare'); saveInventory(inv);
  const atkMax = equippedAffixTotals().atk;
  chk('2a 装備効果は Lv で伸びる', atk1 === 8 && atkMax === 16, `${atk1}→${atkMax}`);

  // ---- 3. 経験値の設計（同ランク MAT_TO_MAX 個で Lv1→MAX）----
  for (const rk of RARITY_KEYS) {
    const capR = lvCapOf(rk);
    let total = 0;
    for (let l = 1; l < capR; l++) total += expToNext(rk, l);
    const unit = EXP_UNIT_BY_RARITY[rk];
    const need = Math.round(total / unit * 10) / 10;
    chk(`3-${rk} 同ランク素材 約${MAT_TO_MAX}個で MAX（実測 ${need} 個）`,
        Math.abs(need - MAT_TO_MAX) <= 1.0, `total=${total} unit=${unit}`);
  }
  chk('3z 必要経験値は後半ほど重い',
      expToNext('epic', 1) < expToNext('epic', 10) && expToNext('epic', 10) < expToNext('epic', 19));
  chk('3y MAX では次が0', expToNext('epic', lvCapOf('epic')) === 0);
  chk('3x 育った素材ほど経験値が多い',
      matExpOf(make('rare', 1)) < matExpOf(make('rare', 8)),
      `${matExpOf(make('rare', 1))} < ${matExpOf(make('rare', 8))}`);
  chk('3w 高ランク素材ほど経験値が多い', matExpOf(make('epic', 1)) > matExpOf(make('common', 1)));

  // ---- 4. 鍛える（forgeTreasure）----
  reset();
  const base = make('common', 1);
  const mats = Array.from({ length: MAT_TO_MAX }, () => make('common', 1));
  saveInventory([base, ...mats]);
  const r1 = forgeTreasure(base.id, [mats[0].id]);
  chk('4a 素材1個で経験値が入る', r1.ok && r1.gained === EXP_UNIT_BY_RARITY.common, JSON.stringify(r1.gained));
  chk('4b 使った素材は消える', loadInventory().length === MAT_TO_MAX, loadInventory().length);
  const rest = loadInventory().filter(t => t.id !== base.id).map(t => t.id);
  const r2 = forgeTreasure(base.id, rest);
  chk('4c 残り全部を食わせると Lv MAX', r2.ok && r2.to === lvCapOf('common'), `${r2.from}→${r2.to}`);
  chk('4d MAX では経験値を持ち越さない', expOf(loadInventory().find(t => t.id === base.id)) === 0);
  chk('4e MAX をさらに鍛えようとすると拒否', forgeTreasure(base.id, []).ok === false);
  chk('4f 素材未選択は拒否', (() => {
      reset(); const b = make('rare', 1); saveInventory([b, make('rare', 1)]);
      return forgeTreasure(b.id, []).ok === false;
  })());
  chk('4g 存在しない素材IDは無視される', (() => {
      reset(); const b = make('rare', 1), m = make('common', 1); saveInventory([b, m]);
      const r = forgeTreasure(b.id, [m.id, 'nope']);
      return r.ok && r.gained === EXP_UNIT_BY_RARITY.common;
  })());
  chk('4h 装備中は素材にできない', (() => {
      reset(); const b = make('rare', 1), m = make('common', 1);
      saveInventory([b, m]); saveEquipped([m.id]);
      return forgeTreasure(b.id, [m.id]).ok === false;
  })());
  chk('4i ベース自身は素材にできない', (() => {
      reset(); const b = make('rare', 1); saveInventory([b]);
      return forgeTreasure(b.id, [b.id]).ok === false;
  })());

  // ---- 5. 昇格（promoteTreasure）----
  reset();
  const pb = make('rare', 1, [{ key: 'atk', value: 5 }, { key: 'mulAtk', value: 0.8 }]);
  const pm = Array.from({ length: PROMOTE_COST }, () => make('rare', 1));
  saveInventory([pb, ...pm]);
  chk('5a Lv MAX でなければ昇格できない', canPromote(loadInventory()[0]) === false);
  chk('5b 実行しても null', promoteTreasure(pb.id) === null);
  let iv = loadInventory(); iv[0].lv = lvCapOf('rare'); saveInventory(iv);
  chk('5c Lv MAX なら昇格できる', canPromote(loadInventory()[0]) === true);
  const made = promoteTreasure(pb.id);
  chk('5d 一段上のランクになる', !!made && made.rarity === 'epic', made && made.rarity);
  chk('5e Lv は1に戻る', !!made && lvOf(made) === 1 && expOf(made) === 0);
  // 上位に同系統があればそれを、無ければ「傾向が最も近い系統」を引き継ぐ
  const upSame = TREASURE_NAMES.epic.some(e => e.kind === pb.kind);
  chk('5f 系統を引き継ぐ（無ければ近い系統）',
      !!made && (upSame ? made.kind === pb.kind
                        : made.kind === nearestKindEntry(TREASURE_NAMES.epic, pb.kind).kind),
      made && `${pb.kind} → ${made.kind}（上位に同系統: ${upSame}）`);
  // 主要系統は全ランクにあるので、必ず同系統のまま上がれる
  for (const k of ['blade', 'shield', 'orb']) {
    const chain = RARITY_KEYS.every(rk => TREASURE_NAMES[rk].some(e => e.kind === k));
    chk(`5f-${k} 主要系統は全ランクに存在する`, chain);
  }
  chk('5g 元の効果種を引き継ぐ',
      !!made && ['atk', 'mulAtk'].every(k => made.affixes.some(a => a.key === k)),
      made && made.affixes.map(a => a.key).join(','));
  chk('5h 効果の数は新ランクの規定数',
      !!made && made.affixes.length === RARITY_BY_KEY.epic.affixCount);
  chk('5i ベースと素材が消えて新品だけ残る',
      loadInventory().length === 1 && loadInventory()[0].id === made.id, loadInventory().length);
  chk('5j 素材が足りなければ昇格不可', (() => {
      reset(); const b = make('epic', lvCapOf('epic'));
      saveInventory([b, make('epic', 1)]);
      return canPromote(loadInventory()[0]) === false && promoteTreasure(b.id) === null;
  })());
  // 昇格の消費は「育っていないもの」から＝鍛えた宝具が巻き込まれない
  chk('5L 消費されるのは Lv の低い10個', (() => {
    reset();
    const b = make('rare', lvCapOf('rare'));
    const lvs = [5, 1, 9, 2, 8, 3, 7, 4, 6, 1, 12, 11];        // 12個・Lvばらばら
    saveInventory([b, ...lvs.map(l => make('rare', l))]);
    const doomed = promoteMaterialIds('rare', b.id).slice(0, PROMOTE_COST)
      .map(id => lvOf(loadInventory().find(t => t.id === id))).sort((x, y) => x - y);
    const survive = lvs.slice().sort((x, y) => x - y).slice(PROMOTE_COST);   // 残るはずの上位2つ
    promoteTreasure(b.id);
    const left = loadInventory().filter(t => t.rarity === 'rare').map(t => lvOf(t)).sort((x, y) => x - y);
    return JSON.stringify(left) === JSON.stringify(survive)
        && JSON.stringify(doomed) === JSON.stringify(lvs.slice().sort((x, y) => x - y).slice(0, PROMOTE_COST));
  })(), 'Lv昇順で消費');
  chk('5k 神（最上位）は昇格できない', (() => {
      reset();
      const b = make('god', lvCapOf('god'));
      const ms = Array.from({ length: PROMOTE_COST }, () => make('god', 1));
      saveInventory([b, ...ms]);
      return canPromote(loadInventory()[0]) === false;
  })());

  // ---- 6. UI 経路のスモーク（DOMスタブ・confirm は常に true）----
  reset();
  let uiErr = null;
  try {
    const b = make('uncommon', 1);
    const ms = Array.from({ length: 12 }, () => make('common', 1));
    saveInventory([b, ...ms]);
    forgeOpen(b.id);
    chk('6a 鍛冶場がベースを掴む', forgeBaseId === b.id);   // ※DOMスタブでは style を読めないため状態で確認
    forgeAutoSelect('next');
    chk('6b 「次のLvまで」で素材が選ばれる', forgeSelected.size > 0, forgeSelected.size);
    forgeDoForge();
    chk('6c 鍛えると Lv が上がる', lvOf(loadInventory().find(t => t.id === b.id)) > 1,
        lvOf(loadInventory().find(t => t.id === b.id)));
    forgeAutoSelect('max');
    forgeDoForge();
    chk('6d 「MAXまで」で Lv MAX に届く（素材が足りる範囲で）',
        lvOf(loadInventory().find(t => t.id === b.id)) >= 2);
    forgeClose();
    chk('6e 閉じると状態がクリアされる', forgeBaseId === null && forgeSelected.size === 0);
    // 昇格まで通す
    reset();
    const pb2 = make('common', lvCapOf('common'));
    saveInventory([pb2, ...Array.from({ length: PROMOTE_COST }, () => make('common', 1))]);
    forgeOpen(pb2.id);
    forgeDoPromote();
    chk('6f UI から昇格できる', loadInventory().length === 1 && loadInventory()[0].rarity === 'uncommon',
        JSON.stringify(loadInventory().map(t => t.rarity)));
    forgeClose();
    // 宝具庫の描画も通す
    renderTreasuryAll();
    tzShowDetail(loadInventory()[0].id);
    tzCloseDetail();
  } catch (e) { uiErr = String(e && e.stack || e); }
  chk('6 UI 経路で例外なし', uiErr === null, uiErr);

  reset();
  const fails = results.filter(r => !r.ok);
  process.stdout.write(JSON.stringify({
    total: results.length, passed: results.length - fails.length, failed: fails.length,
    failures: fails,
    table: RARITY_KEYS.map(k => {
      let total = 0; for (let l = 1; l < lvCapOf(k); l++) total += expToNext(k, l);
      return `${RARITY_BY_KEY[k].name}: Lv1-${lvCapOf(k)} / 素材1個=${EXP_UNIT_BY_RARITY[k]}exp / MAXまで${total}exp`;
    }),
    all: results.map(r => (r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ` [${r.detail}]` : '')),
  }, null, 1) + '\n');
})();
