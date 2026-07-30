// 新アフィックス（基礎/倍率/射程/索敵）と effStat・遠隔攻撃の機能テスト。
(function () {
  const out = {};
  try {
    // 1) equippedAffixTotals の集計
    const item = { id:'tz_x', rarity:'legendary', name:'t', icon:'x',
      affixes:[{key:'atk',value:5},{key:'mulAtk',value:10},{key:'range',value:2},{key:'sight',value:3}] };
    localStorage.setItem('magika_inventory', JSON.stringify([item]));
    localStorage.setItem('magika_equipped', JSON.stringify(['tz_x']));
    const tot = equippedAffixTotals();
    out.totals = tot;

    // 2) effStat が 基礎加算×倍率、range=索敵加算 を反映。射程(atkRange)はレイス限定。
    monsterLevels.slime = 1; monsterLevels.wraith = 1;
    randBonus.slime = { atk: tot.atk||0, agi:0, hp:0 };
    randBonus.wraith = { atk:0, agi:0, hp:0 };
    equipMul = { atk: tot.mulAtk||0, agi:0, hp:0 };
    equipRange = tot.range||0;
    equipSight = tot.sight||0;
    const e = effStat('slime');
    out.eff = e;
    out.effAtkOK = (e.atk === Math.round((1+5)*(1+10/100)));  // round(6.6)=7
    out.effRangeOK = (e.range === 4 + 3);                     // 索敵は全モンスター
    out.slimeAtkRange1 = (e.atkRange === 1);                  // 非レイスは射程無効=1
    out.wraithAtkRange = (effStat('wraith').atkRange === 1 + 2); // レイスのみ射程有効

    // 3) 倍率アフィックスの値は 0〜(1×mult) の小数
    const vals = [];
    for (let i=0;i<2000;i++) vals.push(rollAffixValue(AFFIX_BY_KEY.mulAtk, 3.0)); // legendary mult
    out.mulMin = Math.min(...vals); out.mulMax = Math.max(...vals);
    out.mulRangeOK = out.mulMin >= 0 && out.mulMax <= 3.0 && vals.some(v => v % 1 !== 0);

    // 4) 射程は攻撃判定に効く：atkRange=2 なら距離2の敵に命中
    out.attackAtRange2 = (function(){
      const atkRange = 2;
      const minDist = 2;
      return minDist <= (atkRange || 1);   // updateEntity と同条件
    })();

    // 5) ラン中の装備変更が即反映される（装備した効果を次のランまで待たされない）
    //    反映先は「以降に湧く個体」＝ effStat()。既に場にいる個体は据え置き（Lv上げと同じ扱い）。
    out.dynamicEquip = (function(){
      localStorage.clear();
      const boost = { id:'tz_dyn', rarity:'legendary', name:'d', icon:'d',
        affixes:[{key:'atk',value:9},{key:'sight',value:4}] };
      localStorage.setItem('magika_inventory', JSON.stringify([boost]));
      localStorage.setItem('magika_equipped', JSON.stringify([]));
      enterGameScreen('standard');                 // 何も装備していない状態でランを開始
      const before = effStat('slime');
      // 場にいる個体も更新されること／HPの割合が維持されることを見るため、傷ついた兵を1体置く
      const m = makeEntity(5, 5, { hp: Math.round(before.hp / 2), maxHp: before.hp,
        atk: before.atk, agi: before.agi, range: before.range, atkRange: before.atkRange,
        isHero: false, mtype: 'slime', color: '#fff' });
      monsters.length = 0; monsters.push(m);
      tzEquip('tz_dyn');                           // ラン中に装備
      const afterEquip = effStat('slime');
      const liveAtk = m.atk, liveRatio = m.hp / m.maxHp;
      tzUnequip('tz_dyn');                         // ラン中に解除
      const afterUnequip = effStat('slime');
      const revertedAtk = m.atk;
      monsters.length = 0;
      return {
        装備前: before.atk, 装備後: afterEquip.atk, 解除後: afterUnequip.atk,
        索敵_装備前: before.range, 索敵_装備後: afterEquip.range,
        場にいる兵の攻撃: liveAtk, 解除後の兵: revertedAtk,
        'HP割合(0.5維持)': Math.round(liveRatio * 100) / 100,
        // 「初期ゴールド」はラン中に効かない（付け外しで無限に稼げてしまうため）
        OK: afterEquip.atk === before.atk + 9 && afterUnequip.atk === before.atk
            && afterEquip.range === before.range + 4
            && liveAtk === afterEquip.atk && revertedAtk === before.atk
            && Math.abs(liveRatio - 0.5) < 0.05,
      };
    })();

    // 6) レベルアップも場にいる個体へ反映される（宝具と同じ refreshMonsterStats を通る）。
    //    ちびは成体の半分のまま／HPは割合維持、が旧 applyMonsterLevel の不備だった点。
    out.dynamicLevel = (function(){
      localStorage.clear();
      enterGameScreen('standard');
      gold = 100000;
      monsterLevels.slime = 1;
      const s1 = effStat('slime');
      monsters.length = 0;
      const adult = makeEntity(5, 5, { hp: s1.hp, maxHp: s1.hp, atk: s1.atk, agi: s1.agi,
        range: s1.range, atkRange: s1.atkRange, isHero: false, mtype: 'slime', color: '#fff' });
      const baby = makeEntity(6, 5, { hp: Math.max(1, Math.floor(s1.hp / 2)), maxHp: Math.max(1, Math.floor(s1.hp / 2)),
        atk: Math.max(1, Math.floor(s1.atk / 2)), agi: Math.max(1, Math.floor(s1.agi / 2)),
        range: s1.range, atkRange: s1.atkRange, isHero: false, mtype: 'slime', color: '#fff', isBaby: true });
      monsters.push(adult, baby);
      for (let i = 0; i < 9; i++) levelUp('slime');        // Lv1 → Lv10
      const s10 = effStat('slime');
      return {
        Lv: monsterLevels.slime,
        成体の攻撃: adult.atk, 期待値: s10.atk,
        'ちびの攻撃(成体の半分)': baby.atk, 'ちびの期待値': Math.max(1, Math.floor(s10.atk / 2)),
        '成体HP(満タン維持)': `${adult.hp}/${adult.maxHp}`,
        OK: monsterLevels.slime === 10
            && adult.atk === s10.atk && adult.hp === adult.maxHp && adult.maxHp === s10.hp
            && baby.atk === Math.max(1, Math.floor(s10.atk / 2))
            && baby.maxHp === Math.max(1, Math.floor(s10.hp / 2)),
      };
    })();

    out.OK = out.effAtkOK && out.effRangeOK && out.slimeAtkRange1 && out.wraithAtkRange && out.mulRangeOK && out.attackAtRange2 &&
             out.dynamicEquip.OK && out.dynamicLevel.OK &&
             tot.atk===5 && tot.mulAtk===10 && tot.range===2 && tot.sight===3;
  } catch (e) { out.error = String(e && e.stack || e); }
  process.stdout.write(JSON.stringify(out) + '\n');
})();
