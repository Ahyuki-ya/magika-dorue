// 【調整用・使い捨て】L倍ボーナスの係数を決めるための解析。
// index.html を変えずに、実測した勇者ステータス（base＋富スケール）に候補式を後付けして
// 「必要総兵力 N* を、その時点の資本（=1Gで1体掘れる）の何割で賄えるか」を L 別に出す。
//   ρ(L) = N*(L) / gold(L)     … ρ が L に対して平坦 ⇔ レバレッジが純粋な分散ダイヤル
// 使い方: node test/p5/harness.js index.html htune
(function () {
  const r2 = v => Math.round(v * 100) / 100;
  const r3 = v => Math.round(v * 1000) / 1000;
  const INTERVAL_N = 1000 / TARGET_FPS;
  const atkRateN = agi => (1000 / INTERVAL_N) * atkUnits(agi) / ACTION_THRESHOLD;
  const TRIALS = 40;

  // 実測：現行コードの (base + 富スケール) を平均で取る。ついでに heroPower も返す
  function measure(lv, goldAmt, L) {
    let a = 0, g = 0, h = 0, P = 0;
    for (let i = 0; i < TRIALS; i++) {
      gameMode = 'hard'; leverage = { active: true, stake: 0, mult: L };
      heroes.length = 0; heroGold = 0;
      rageBonus.atk = rageBonus.agi = rageBonus.hp = 0;
      isGameRunning = true; isWaveStarted = true;
      heroLevel = 0; heroPower = 20; gold = 0;
      for (let k = 1; k < lv; k++) { spawnHero(); heroes.length = 0; }
      gold = goldAmt; heroLevel = lv - 1;
      spawnHero();
      const hh = heroes[heroes.length - 1];
      a += hh.atk; g += hh.agi; h += hh.maxHp; P += heroPower;
    }
    return { atk: a / TRIALS, agi: g / TRIALS, hp: h / TRIALS, power: P / TRIALS };
  }

  // 候補式：pool を L と heroPower から作り、HP 85% / atk 8% / agi 7% に配る
  const HP_R = 0.85, ATK_R = 0.08, AGI_R = 0.07;
  const cands = {
    'なし（現行）':            (L, P) => 0,
    'k=0.05·L·P':              (L, P) => 0.05 * L * P,
    'k=0.10·L·P':              (L, P) => 0.10 * L * P,
    'k=0.15·L·P':              (L, P) => 0.15 * L * P,
    'k=0.25·L·P':              (L, P) => 0.25 * L * P,
    'k=0.6·L·√P':              (L, P) => 0.6 * L * Math.sqrt(P),
    'k=2.0·L·√P':              (L, P) => 2.0 * L * Math.sqrt(P),
    'k=0.10·(L-1)·P':          (L, P) => 0.10 * (L - 1) * P,
    'k=0.15·(L-1)·P':          (L, P) => 0.15 * (L - 1) * P,
  };

  // モンスター（ゴーレム）1体の目盛り
  function mon(lv) {
    const s = mstatsAt('golem', Math.min(lv, MAX_LEVEL));
    return { hp: s.hp, dps: s.atk * atkRateN(s.agi) };
  }

  // gold = mult × S × L（mult=1 開幕 / 5 中盤）
  const out = {};
  for (const heroLv of [10, 20, 30]) {
    for (const goldMult of [1, 5]) {
      const key = `勇者Lv${heroLv}・所持G=${goldMult}×S×L（S=100）`;
      const rows = [];
      for (const name in cands) {
        const row = { 式: name };
        const rho = {};
        for (const L of [2, 3, 5, 10]) {
          const goldAmt = goldMult * 100 * L;
          const m0 = measure(heroLv, goldAmt, L);
          const pool = Math.floor(cands[name](L, m0.power));
          const atk = m0.atk + Math.round(pool * ATK_R);
          const agi = m0.agi + Math.round(pool * AGI_R);
          const hp = m0.hp + Math.round(pool * HP_R) * HERO_HP_MULT;
          const dps = atk * atkRateN(agi);
          const mm = mon(Math.min(20, heroLv));      // 現実的な防衛：モンスターLvは勇者Lv程度（上限20）
          const cStar = Math.sqrt(hp * dps / (mm.hp * mm.dps));
          const nStar = cStar * cStar / 4;
          row[`L${L}:HP`] = Math.round(hp);
          row[`L${L}:N*`] = Math.round(nStar);
          rho[L] = nStar / goldAmt;
        }
        row['ρ(L2)'] = r3(rho[2]); row['ρ(L3)'] = r3(rho[3]);
        row['ρ(L5)'] = r3(rho[5]); row['ρ(L10)'] = r3(rho[10]);
        row['ρ(L10)/ρ(L2)'] = r2(rho[10] / rho[2]);
        rows.push(row);
      }
      out[key] = rows;
    }
  }
  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
})();
