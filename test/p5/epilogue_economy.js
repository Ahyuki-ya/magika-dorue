// 経済（ゴールド／ダイヤ収支）の実測。
// テンポ調整で「時間あたりの収入」が変わったので、育成が現実的な速度で進むかを確かめる。
//   ・収入モデル: 1波あたりのサイクル時間（登場間隔＋侵攻時間＋交戦時間）と報酬
//   ・シンク    : モンスターのLv上げ（goldCostFor の累計）、掘削 1G/マス
//   ・ダイヤ    : ドロップ期待値（standard/hard×L）と、上限解放・ショップの必要数
//   ・戦力天井  : Lv上限（ダイヤ解放）で頭打ちのモンスター vs 波ごとに伸びる勇者
// 使い方: node test/p5/harness.js index.html economy
(function () {
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;
  const INTERVAL = 1000 / TARGET_FPS;
  const moveRate = agi => (1000 / INTERVAL) * moveUnits(agi) / ACTION_THRESHOLD;   // マス/秒
  const atkRate  = agi => (1000 / INTERVAL) * atkUnits(agi)  / ACTION_THRESHOLD;   // 回/秒

  // ---- 勇者の期待ステータス（spawnHero の期待値・normal タイプ） ----
  function heroAt(lv) {
    let power = 20;
    for (let l = 1; l <= lv; l++) power += (l % 10 === 0) ? 0 : (l % 5 === 0 ? 5 : 1);
    const rb = Math.floor(lv / 10) * 5;
    const each = power / 3 + rb;
    return { lv, atk: each, agi: each, hp: each * HERO_HP_MULT, power };
  }

  // ---- 1波のサイクル時間 ----
  // 登場間隔 + 地表から城まで降りる時間 + 交戦時間。深度が深いほど侵攻が長い＝収入は薄まる。
  function cycleSec(heroLv, depth, fast) {
    const h = heroAt(heroLv);
    const iv = fast ? 1000 / 60 : INTERVAL;
    const th = fast ? FAST_THRESHOLD : ACTION_THRESHOLD;
    const mv = (1000 / iv) * moveUnits(h.agi) / th;
    const spawn = fast ? HERO_SPAWN_SEC_FAST : HERO_SPAWN_SEC;
    const travel = depth / mv;
    const battle = 3;                       // epilogue_tempo の実測（交戦2.8秒前後）
    return spawn + travel + battle;
  }
  function goldPerKill(mode, heroLv, L) {
    const base = mode === 'standard' ? 25 : 10 + Math.floor(heroLv / 5);
    return Math.round(base * (mode === 'standard' ? 1 : L) * KILL_REWARD_MULT);
  }

  const income = [];
  for (const [mode, L] of [['standard', 1], ['hard', 2], ['hard', 5], ['hard', 10]]) {
    for (const depth of [10, 50, 150]) {
      const hl = 20;                        // 中盤想定
      const sec = cycleSec(hl, depth, false);
      const g = goldPerKill(mode, hl, L);
      income.push({
        mode: mode + (mode === 'hard' ? `(L${L})` : ''), depth,
        '1波の秒数': r1(sec), '1体の報酬G': g,
        'G/分': r1(g / sec * 60),
        'G/分(早送り)': r1(g / cycleSec(hl, depth, true) * 60),
      });
    }
  }
  // 調整前との比較（threshold 100・報酬×1・間隔10秒・当時は早送りも実質1.33倍）
  const oldRate = agi => 45 * (4 * Math.log2(agi + 1)) / 100;
  const oldCycle = depth => 10 + depth / oldRate(heroAt(20).agi) + 0.3;
  const beforeAfter = {
    '調整前 G/分(standard, 深度50)': r1(25 / oldCycle(50) * 60),
    '調整後 G/分(standard, 深度50)': r1(goldPerKill('standard', 20, 1) / cycleSec(20, 50, false) * 60),
  };
  beforeAfter['倍率'] = r2(parseFloat(beforeAfter['調整後 G/分(standard, 深度50)']) / parseFloat(beforeAfter['調整前 G/分(standard, 深度50)']));

  // ---- モンスターのLv上げコスト ----
  function cumGold(toLv) { let s = 0; for (let lv = 1; lv < toLv; lv++) s += goldCostFor(lv); return s; }
  const gpm = goldPerKill('standard', 20, 1) / cycleSec(20, 50, false) * 60;   // standard・深度50 の基準収入
  const levelCost = [5, 10, 20, 30, 50].map(lv => ({
    'Lv1→': lv, '累計G(1種)': cumGold(lv), '3種そろえる': cumGold(lv) * 3,
    '必要な討伐数': Math.ceil(cumGold(lv) / goldPerKill('standard', 20, 1)),
    '所要(分・1種)': r1(cumGold(lv) / gpm),
    '所要(分・3種)': r1(cumGold(lv) * 3 / gpm),
  }));

  // ---- ダイヤの供給 ----
  // standard: min(0.01×heroLevel, 1)%  /  hard: min((heroLevel×0.01+1)×L, min(5L,100))%
  function diaExpected(mode, L, waves) {
    let sum = 0;
    for (let hl = 1; hl <= waves; hl++) {
      let pct;
      if (mode === 'standard') pct = Math.min(0.01 * hl, 1);
      else pct = Math.min((hl * 0.01 + 1) * L, Math.min(5 * L, 100));
      sum += pct / 100;
    }
    return sum;
  }
  const diamonds = [];
  for (const [mode, L] of [['standard', 1], ['hard', 2], ['hard', 5], ['hard', 10]]) {
    diamonds.push({
      mode: mode + (mode === 'hard' ? `(L${L})` : ''),
      '50波で💎': r2(diaExpected(mode, L, 50)),
      '100波で💎': r2(diaExpected(mode, L, 100)),
      '200波で💎': r2(diaExpected(mode, L, 200)),
      '1💎に必要な波数(序盤50波平均)': r1(50 / Math.max(1e-9, diaExpected(mode, L, 50))),
    });
  }
  const shopTotal = SHOP_ITEMS.reduce((s, it) => s + it.costs.reduce((a, b) => a + b, 0), 0);
  const step = DIAMOND_CAP_STEP;
  const capDia = to => Math.ceil(Math.max(0, to - MONSTER_CAP_INIT) / step);
  const diaSinks = {
    'ショップ全解放💎': shopTotal,
    [`Lv上限 ${MONSTER_CAP_INIT}→50 (1💎=+${step})`]: capDia(50),
    [`Lv上限 ${MONSTER_CAP_INIT}→100(最大)`]: capDia(100),
    '3種すべて上限100まで': capDia(100) * 3,
    '合計（ショップ＋3種を最大）': shopTotal + capDia(100) * 3,
  };

  // ---- 戦力の天井：Lv上限で頭打ちのモンスター vs 伸び続ける勇者 ----
  // c* = √(HP_h·DPS_h / (HP_m·DPS_m))：勇者1体に必要な同時攻撃数。
  // 通路で同時に殴れるのは現実的に 3〜4 体なので、c* がそれを超えた波が「守れなくなる目安」。
  function cStar(heroLv, mLv, mt) {
    const h = heroAt(heroLv);
    const s = mstatsAt(mt, mLv);
    const dpsH = h.atk * atkRate(h.agi), dpsM = s.atk * atkRate(s.agi);
    return Math.sqrt((h.hp * dpsH) / (s.hp * dpsM));
  }
  const ceiling = [];
  for (const capLv of [MONSTER_CAP_INIT, 30, 50, 75, 100]) {
    let breakWave = null;
    for (let hl = 1; hl <= 400; hl++) {
      if (cStar(hl, capLv, 'golem') > 4) { breakWave = hl; break; }   // 同時4体を超えたら破綻とみなす
    }
    ceiling.push({
      'モンスターLv': capLv, '必要💎(1種・上限解放)': Math.ceil(Math.max(0, capLv - MONSTER_CAP_INIT) / DIAMOND_CAP_STEP),
      '破綻する波': breakWave === null ? '400波でも耐える' : breakWave,
      'c*(波50)': r2(cStar(50, capLv, 'golem')),
      'c*(波100)': r2(cStar(100, capLv, 'golem')),
    });
  }

  // ---- 宝具（宝石鉱脈）の供給 ----
  // 本体の generateRow と同じ式で測る（ハードコードすると本体の変更に追従できないため extraOreAt を使う）
  function gemPer1000(depth, L) {
    const y = SKY_LAYERS + 1 + depth;
    return Math.min(0.4, extraOreAt(y).pGem * L) * 1000;
  }
  const forgeNeed = MAT_TO_MAX;                    // Lv MAX に必要な同ランク数
  const promoteNeed = PROMOTE_COST;                // 昇格に必要な同ランク数
  const treasure = [100, 300, 500, 1000].map(depth => {
    const per1000 = gemPer1000(depth, 1);
    const digs = (forgeNeed + promoteNeed) / per1000 * 1000;
    return {
      depth, '1000マス掘って宝具': r2(per1000),
      '宝具1個の掘削G': Math.round(1000 / per1000),
      '昇格まで(計20個)の掘削G': Math.round(digs),
      '所要(分)': r1(digs / moveRate(5) / 60),
    };
  });
  // 鍛冶にかかるゴールド（銀行から）
  const forgeCost = RARITY_KEYS.filter(k => k !== 'god').map(k => ({
    ランク: RARITY_BY_KEY[k].name,
    '素材10個の鍛冶代': FORGE_FEE_UNIT * ((RARITY_ORDER[k] || 0) + 1) * MAT_TO_MAX,
    '昇格費用': promoteGoldCost(k),
    '1段階の合計G': FORGE_FEE_UNIT * ((RARITY_ORDER[k] || 0) + 1) * MAT_TO_MAX + promoteGoldCost(k),
  }));

  process.stdout.write(JSON.stringify({
    定数: { TIME_SCALE, KILL_REWARD_MULT, HERO_SPAWN_SEC, MONSTER_CAP_INIT, DIAMOND_CAP_STEP,
            MAT_TO_MAX, PROMOTE_COST, FORGE_FEE_UNIT },
    収入: income, 調整前後: beforeAfter, Lv上げ: levelCost,
    ダイヤ供給: diamonds, ダイヤ消費: diaSinks, 戦力天井: ceiling, 宝具供給: treasure, 鍛冶コスト: forgeCost,
  }, null, 1) + '\n');
})();
