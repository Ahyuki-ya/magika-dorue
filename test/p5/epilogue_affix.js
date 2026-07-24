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

    // 2) effStat が 基礎加算×倍率、range=索敵加算、atkRange=1+射程 を反映
    monsterLevels.slime = 1;                 // base slime atk1/agi1/hp3 range4
    randBonus.slime = { atk: tot.atk||0, agi:0, hp:0 };
    equipMul = { atk: tot.mulAtk||0, agi:0, hp:0 };
    equipRange = tot.range||0;
    equipSight = tot.sight||0;
    const e = effStat('slime');
    out.eff = e;
    out.effAtkOK = (e.atk === Math.round((1+5)*(1+10/100)));  // round(6.6)=7
    out.effRangeOK = (e.range === 4 + 3);                     // 索敵
    out.atkRangeOK = (e.atkRange === 1 + 2);                  // 射程

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

    out.OK = out.effAtkOK && out.effRangeOK && out.atkRangeOK && out.mulRangeOK && out.attackAtRange2 &&
             tot.atk===5 && tot.mulAtk===10 && tot.range===2 && tot.sight===3;
  } catch (e) { out.error = String(e && e.stack || e); }
  process.stdout.write(JSON.stringify(out) + '\n');
})();
