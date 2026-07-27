// 戦闘バランスの実測（調整用のものさし）。
// 本作の戦闘は「cd += 4·log2(agi+1) を毎フレーム加算し、閾値を超えたら1行動」なので
//   行動レート rate = (1000/interval) × 4·log2(agi+1) / threshold  [回/秒]
//   DPS = atk × rate
// 隣接して殴り合う設計なので、勇者1体に同時に殴りかかれる数を c とすると
//   勇者がモンスター c 体を全滅させる時間  T_lose = c × HP_m / DPS_h
//   モンスター c 体が勇者を倒す時間        T_win  = HP_h / (c × DPS_m)
//   互角になる c（= 必要な同時攻撃数）     c* = sqrt( HP_h·DPS_h / (HP_m·DPS_m) )   ← ランチェスター二次法則と同じ形
// 使い方: node test/p5/harness.js index.html balance
(function () {
  const FPS_NORMAL = TARGET_FPS, INTERVAL_NORMAL = 1000 / TARGET_FPS;
  const INTERVAL_FAST = 1000 / 60, THRESH_FAST = FAST_THRESHOLD;
  // 攻撃レートは上限つき（atkUnits）、移動レートは敏捷比例（moveUnits）
  const rate = (agi, interval, threshold) => (1000 / interval) * atkUnits(agi) / threshold;
  const mrate = (agi, interval, threshold) => (1000 / interval) * moveUnits(agi) / threshold;
  const rNorm = agi => rate(agi, INTERVAL_NORMAL, ACTION_THRESHOLD);
  const rMoveNorm = agi => mrate(agi, INTERVAL_NORMAL, ACTION_THRESHOLD);
  const rFast = agi => rate(agi, INTERVAL_FAST, THRESH_FAST);
  const r2 = v => Math.round(v * 100) / 100;

  // ---- 勇者のステータス（spawnHero の期待値を再現）----
  // heroPower は Lv1..N で +1（Lv%5==0 は +5、Lv%10==0 は +0）、初期20。
  // 期待値としてタイプ normal（重み1:1:1）で3等分する。
  function heroAt(lv) {
    let power = 20;
    for (let l = 1; l <= lv; l++) power += (l % 10 === 0) ? 0 : (l % 5 === 0 ? 5 : 1);
    const each = power / 3;
    // 怒り勇者(10の倍数)ごとに rageBonus が全ステータス+5ずつ累積し、以降の勇者に乗る
    const rb = Math.floor(lv / 10) * 5;
    return { lv, atk: each + rb, agi: each + rb, hp: each + rb, power };
  }

  const heroRows = [1, 5, 10, 20, 30, 50].map(lv => {
    const h = heroAt(lv);
    return {
      lv, atk: r2(h.atk), agi: r2(h.agi), hp: r2(h.hp * HERO_HP_MULT),
      '攻撃/秒': r2(rNorm(h.agi)), DPS: r2(h.atk * rNorm(h.agi)),
      '1マス移動(秒)': r2(1 / rMoveNorm(h.agi)),
    };
  });

  // ---- モンスター（実効ステータス。装備なし・Lvのみ）----
  const monRows = [];
  for (const mt of ['slime', 'goblin', 'golem', 'wraith']) {
    for (const lv of [1, 5, 10, 20, 50]) {
      const s = mstatsAt(mt, lv);
      monRows.push({ mt, lv, atk: s.atk, agi: s.agi, hp: s.hp,
                     '行動/秒': r2(rNorm(s.agi)), DPS: r2(s.atk * rNorm(s.agi)) });
    }
  }

  // ---- 交戦の指標（勇者Lv × 同レベル帯のモンスター）----
  // 「勇者が1体を溶かす時間」が短すぎると、育成の結果を見る間もなく戦闘が終わる
  const duel = [];
  for (const [hlv, mlv] of [[1, 1], [5, 5], [10, 10], [20, 20], [30, 30], [50, 50]]) {
    const h = heroAt(hlv);
    h.hp *= HERO_HP_MULT;                        // 勇者HP倍率を反映
    const dpsH = h.atk * rNorm(h.agi);
    for (const mt of ['slime', 'golem']) {
      const s = mstatsAt(mt, mlv);
      const dpsM = s.atk * rNorm(s.agi);
      const cStar = Math.sqrt((h.hp * dpsH) / (s.hp * dpsM));
      duel.push({
        '勇者Lv': hlv, mt, 'Lv': mlv,
        '勇者が1体を倒す秒': r2(s.hp / dpsH),
        '勇者を倒すのに必要な体数c*': r2(cStar),
        'c*体での決着(秒)': r2(cStar * s.hp / dpsH),
        '1体が勇者を倒す秒': r2(h.hp / dpsM),
      });
    }
  }

  // ---- 早送り倍率と時間の階層 ----
  const speed = {
    '通常FPS': FPS_NORMAL, '通常interval(ms)': r2(INTERVAL_NORMAL), '通常threshold': ACTION_THRESHOLD,
    '早送りFPS': 60, '早送りinterval(ms)': r2(INTERVAL_FAST), '早送りthreshold': THRESH_FAST,
    '早送り倍率': r2(rFast(5) / rNorm(5)),
    '勇者スポーン間隔(通常/早送り 秒)': HERO_SPAWN_SEC + ' / ' + HERO_SPAWN_SEC_FAST,
    'モンスターHP倍率': MONSTER_HP_MULT, '勇者HP倍率': HERO_HP_MULT,
    '攻撃レート上限(units)': ATK_UNITS_CAP, '討伐報酬倍率': KILL_REWARD_MULT,
    'ちび成長(秒)': r2(BABY_GROW_MS / 1000),
  };

  // ---- 時間の階層（agi=5 の標準的なキャラで）----
  const tiers = {
    '1攻撃(秒)': r2(1 / rNorm(5)),
    '1マス移動(秒)': r2(1 / rMoveNorm(5)),
    '画面縦断(20マス, 秒)': r2(20 / rMoveNorm(5)),
    '深度100mを走破(秒)': r2(100 / rMoveNorm(5)),
  };

  process.stdout.write(JSON.stringify({ speed, tiers, heroRows, monRows, duel }, null, 1) + '\n');
})();
