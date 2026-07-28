// 経済（ゴールド／ダイヤ収支）の解析。テンポ調整後の「時間あたりソース」と
// 「目標到達に必要なシンク」の比を出す。ゲーム内の実関数（goldCostFor / mstatsAt /
// spawnHero / extraOreAt / rollRarityIndex / expToNext）をそのまま呼ぶ。
//
// 使い方: node test/p5/harness.js index.html econ [seed]
//
// 主要な式：
//   行動レート rate = (1000/interval) × units / threshold
//   拮抗の必要同時攻撃数 c* = √(HP_h·DPS_h / (HP_m·DPS_m))
//   ★予備を含む必要総数  N* = (c*)² / c   （c=同時に殴れる数。近接は幾何的に最大4）
//     ← 前線が倒れても後続が詰めるなら、勇者が死ぬまでに倒せる体数がこれ。
(function () {
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;
  const r3 = v => Math.round(v * 1000) / 1000;
  const INTERVAL_N = 1000 / TARGET_FPS;              // 22.22ms
  const INTERVAL_F = 1000 / 60;                      // 16.67ms
  const atkRateN = agi => (1000 / INTERVAL_N) * atkUnits(agi) / ACTION_THRESHOLD;
  const movRateN = agi => (1000 / INTERVAL_N) * moveUnits(agi) / ACTION_THRESHOLD;
  const atkRateF = agi => (1000 / INTERVAL_F) * atkUnits(agi) / FAST_THRESHOLD;
  const movRateF = agi => (1000 / INTERVAL_F) * moveUnits(agi) / FAST_THRESHOLD;

  // ============================================================
  // 0) 勇者ステータスの実測（spawnHero を本物で回して平均を取る）
  //    heroPower の配分・rageBonus 累積・装備購入まで本物の経路を通す。
  // ============================================================
  const LV_MAX_PROBE = 120, TRIALS = 40;
  const acc = [];                                     // acc[lv] = {atk,agi,hp,maxHp,n}
  for (let i = 0; i <= LV_MAX_PROBE; i++) acc[i] = { atk: 0, agi: 0, hp: 0, maxHp: 0, n: 0 };
  gameMode = 'standard';
  if (typeof leverage === 'object') { leverage.active = false; leverage.mult = 1; }
  isGameRunning = true; isWaveStarted = true; isPaused = true;
  castlePos = null;
  for (let t = 0; t < TRIALS; t++) {
    heroLevel = 0; heroPower = 20; heroGold = 0;
    rageBonus.atk = 0; rageBonus.agi = 0; rageBonus.hp = 0;
    heroes.length = 0; monsters.length = 0;
    for (let lv = 1; lv <= LV_MAX_PROBE; lv++) {
      spawnHero();
      const h = heroes[heroes.length - 1];
      const a = acc[lv];
      a.atk += h.atk; a.agi += h.agi; a.hp += h.maxHp; a.n++;
      heroes.length = 0;                              // 溜めない（装備判定に影響しない）
    }
  }
  const heroAt = lv => {
    const a = acc[Math.min(LV_MAX_PROBE, Math.max(1, lv))];
    return { lv, atk: a.atk / a.n, agi: a.agi / a.n, hp: a.hp / a.n };
  };
  const heroDps = lv => { const h = heroAt(lv); return h.atk * atkRateN(h.agi); };

  // ============================================================
  // 1) 収入クロック：1体あたりの周期と G/分
  //    周期 = HERO_SPAWN_SEC（実時間のsetInterval）＋ 進入移動 ＋ 戦闘
  //    ※勇者の家(HERO_HOUSE_GAP=30)があるので移動距離は概ね30マス以内に収まる
  // ============================================================
  function cycle(lv, travelTiles, fast) {
    const h = heroAt(lv);
    const mv = fast ? movRateF(h.agi) : movRateN(h.agi);
    return (fast ? HERO_SPAWN_SEC_FAST : HERO_SPAWN_SEC) + travelTiles / mv;
  }
  // 旧設定（コミット15e4032前）の再現：threshold=100・HP倍率なし・報酬倍率なし・間隔10/5
  const OLD_THRESH = 100;
  function movRateOld(agi) { return (1000 / INTERVAL_N) * moveUnits(agi) / OLD_THRESH; }
  function cycleOld(lv, travelTiles) { return 10 + travelTiles / movRateOld(heroAt(lv).agi); }

  const incomeRows = [];
  for (const lv of [5, 10, 20, 30, 50]) {
    const travel = 30;                                 // 家の間隔ぶん
    const cNow = cycle(lv, travel, false), cFast = cycle(lv, travel, true), cOld = cycleOld(lv, travel);
    const gStd = 25 * KILL_REWARD_MULT;                // standard 非怒り
    const gOldStd = 25;
    incomeRows.push({
      '勇者Lv': lv,
      '周期(旧・秒)': r1(cOld), '周期(現・秒)': r1(cNow), '周期(現・早送り秒)': r1(cFast),
      'G/分(旧)': r1(60 * gOldStd / cOld),
      'G/分(現)': r1(60 * gStd / cNow),
      'G/分(現・早送り)': r1(60 * gStd / cFast),
      '収入の変化倍率': r2((gStd / cNow) / (gOldStd / cOld)),
      '討伐数/分(旧)': r2(60 / cOld), '討伐数/分(現)': r2(60 / cNow),
      '討伐数の変化倍率': r2(cOld / cNow),
    });
  }
  // hard の討伐報酬（baseReward = 10 + floor(lv/5)）× L × KILL_REWARD_MULT
  const hardIncome = [];
  for (const L of [2, 3, 5, 10]) {
    for (const lv of [10, 30]) {
      const base = 10 + Math.floor(lv / 5);
      const g = base * L * KILL_REWARD_MULT;
      const c = cycle(lv, 30, false);
      hardIncome.push({ L, '勇者Lv': lv, '1体の報酬G': g, '周期(秒)': r1(c),
                        'G/分': r1(60 * g / c), 'G/分(早送り)': r1(60 * g / cycle(lv, 30, true)) });
    }
  }

  // ============================================================
  // 2) モンスターのレベル上げコスト（goldCostFor の累計）
  // ============================================================
  const cum = [0, 0];                                  // cum[N] = Lv1→N の累計G
  for (let lv = 1; lv < 120; lv++) cum[lv + 1] = cum[lv] + goldCostFor(lv);
  const gPerSecStd = (25 * KILL_REWARD_MULT) / cycle(20, 30, false);      // 代表：勇者Lv20相当
  const gPerSecFast = (25 * KILL_REWARD_MULT) / cycle(20, 30, true);
  const levelRows = [5, 10, 20, 50, 100].map(N => ({
    '目標Lv': N,
    '1種の累計G': cum[N], '4種ぶん': cum[N] * 4,
    ['波数(1種・G/波=' + (25 * KILL_REWARD_MULT) + ')']: Math.ceil(cum[N] / (25 * KILL_REWARD_MULT)),
    '分(1種・通常)': r1(cum[N] / gPerSecStd / 60),
    '分(4種・通常)': r1(cum[N] * 4 / gPerSecStd / 60),
    '分(4種・早送り)': r1(cum[N] * 4 / gPerSecFast / 60),
    '必要ダイヤ(1種・上限5→N)': Math.max(0, N - 5),
    '必要ダイヤ(4種)': Math.max(0, N - 5) * 4,
  }));

  // ============================================================
  // 3) ダイヤの供給
  //    standard: p(lv) = min(0.01·lv, 1) [%]
  //    hard    : p = min((0.01·lv + 1)·L , min(5L,100)) [%]（非怒り）
  // ============================================================
  function diaStd(lv) { return Math.min(0.01 * lv, 1) / 100; }
  function diaHard(lv, L) { return Math.min((lv * 0.01 + 1) * L, Math.min(5 * L, 100)) / 100; }
  function cumDia(f, N) { let s = 0; for (let lv = 1; lv <= N; lv++) s += f(lv); return s; }
  const diaRows = [];
  for (const N of [30, 50, 100, 200, 500]) {
    const secStd = (() => { let s = 0; for (let lv = 1; lv <= N; lv++) s += cycle(lv, 30, false); return s; })();
    const secFast = (() => { let s = 0; for (let lv = 1; lv <= N; lv++) s += cycle(lv, 30, true); return s; })();
    diaRows.push({
      '討伐数N': N,
      '💎standard': r3(cumDia(diaStd, N)),
      '💎hard L=2': r2(cumDia(lv => diaHard(lv, 2), N)),
      '💎hard L=5': r2(cumDia(lv => diaHard(lv, 5), N)),
      '💎hard L=10': r2(cumDia(lv => diaHard(lv, 10), N)),
      'かかる時間(分・通常)': r1(secStd / 60), 'かかる時間(分・早送り)': r1(secFast / 60),
    });
  }
  // 目標ダイヤ数に必要な討伐数と時間
  function heroesFor(f, target) {
    let s = 0, lv = 0;
    while (s < target && lv < 200000) { lv++; s += f(lv); }
    return lv;
  }
  function minutesFor(nHeroes, fast) {
    let s = 0;
    for (let lv = 1; lv <= nHeroes; lv++) s += cycle(Math.min(lv, LV_MAX_PROBE), 30, fast);
    return s / 60;
  }
  const diaTargets = [];
  for (const [name, need] of [['ショップ全解放', 107], ['1種を上限50へ', 45], ['4種を上限50へ', 180], ['4種を上限20へ', 60]]) {
    const nStd = heroesFor(diaStd, need), nH5 = heroesFor(lv => diaHard(lv, 5), need);
    diaTargets.push({
      '目標': name, '必要💎': need,
      '必要討伐数(standard)': nStd, '所要(時間・standard早送り)': r1(minutesFor(Math.min(nStd, 20000), true) / 60),
      '必要討伐数(hard L=5)': nH5, '所要(分・hard早送り)': r1(minutesFor(nH5, true)),
    });
  }

  // ============================================================
  // 4) 勇者の伸び vs プレイヤーの戦力（必要モンスター数 N* = (c*)²/c, c=4）
  //    「モンスターLvが上限5で止まったまま」と「上限を解放した場合」を並べる
  // ============================================================
  function monStat(mt, lv) { const s = mstatsAt(mt, lv); return { hp: s.hp, dps: s.atk * atkRateN(s.agi), agi: s.agi, atk: s.atk }; }
  function cStar(hlv, mt, mlv) {
    const h = heroAt(hlv), m = monStat(mt, mlv);
    return Math.sqrt((h.hp * h.atk * atkRateN(h.agi)) / (m.hp * m.dps));
  }
  const raceRows = [];
  for (const hlv of [5, 10, 20, 30, 50, 80, 100]) {
    const row = { '勇者Lv': hlv, 'atk': r1(heroAt(hlv).atk), 'HP': r1(heroAt(hlv).hp), 'DPS': r1(heroDps(hlv)) };
    for (const mlv of [5, 10, 20, 50]) {
      const cs = cStar(hlv, 'golem', mlv);
      row[`c*(ゴーレムLv${mlv})`] = r2(cs);
      row[`必要体数N*(Lv${mlv})`] = Math.ceil(cs * cs / 4);
    }
    raceRows.push(row);
  }
  // 「必要体数を4体（＝隣接だけで足りる）に抑えるのに必要なモンスターLv」
  const needLvRows = [];
  for (const hlv of [5, 10, 20, 30, 50, 80, 100]) {
    const row = { '勇者Lv': hlv };
    for (const mt of ['slime', 'golem', 'wraith']) {
      let need = null;
      for (let mlv = 1; mlv <= MAX_LEVEL; mlv++) if (cStar(hlv, mt, mlv) <= 2) { need = mlv; break; }
      row[`必要Lv(${mt}) c*≤2`] = need === null ? '>100' : need;
      row[`必要💎(${mt})`] = need === null ? '-' : Math.max(0, need - 5);
      row[`必要累計G(${mt})`] = need === null ? '-' : cum[need];
    }
    raceRows.push;
    needLvRows.push(row);
  }
  // 供給と需要の突き合わせ：勇者Lv N の時点で得られている💎 と、そこで必要な上限解放数
  const matchRows = [];
  for (const hlv of [10, 20, 30, 50, 80, 100]) {
    let needLv = null;
    for (let mlv = 1; mlv <= MAX_LEVEL; mlv++) if (cStar(hlv, 'golem', mlv) <= 2) { needLv = mlv; break; }
    const needDia = needLv === null ? Infinity : Math.max(0, needLv - 5);
    matchRows.push({
      '勇者Lv(=討伐数)': hlv,
      '欲しいモンスターLv': needLv === null ? '>100' : needLv,
      '必要💎(1種のみ)': needDia === Infinity ? '∞' : needDia,
      '入手済💎(standard)': r3(cumDia(diaStd, hlv)),
      '入手済💎(hard L=5)': r2(cumDia(lv => diaHard(lv, 5), hlv)),
      '充足率(standard)': needDia ? r3(cumDia(diaStd, hlv) / needDia) : '-',
      '充足率(hard L=5)': needDia ? r2(cumDia(lv => diaHard(lv, 5), hlv) / needDia) : '-',
      '必要累計G(1種)': needLv === null ? '-' : cum[needLv],
      '稼いだG(累計)': hlv * 25 * KILL_REWARD_MULT,
    });
  }

  // ============================================================
  // 5) 宝石鉱脈と宝具の鍛錬コスト
  //    pGem(depth) = 0.005 × min(1, depth/1000) × L（深度20以上）
  //    掘削1マス=1G、鉱脈からは8〜20G（平均14G）が戻る
  // ============================================================
  const gemRows = [];
  for (const depth of [20, 50, 100, 200, 500, 1000]) {
    const y = depth + SKY_LAYERS + 1;
    const p = extraOreAt(y).pGem;                     // leverage.mult=1（standard）
    const tiles = p > 0 ? 1 / p : Infinity;
    gemRows.push({
      '深度': depth, '鉱脈率%': r3(p * 100),
      '1個あたり掘削マス': p > 0 ? Math.round(tiles) : '∞',
      '1個あたり純コストG': p > 0 ? Math.round(tiles - 14) : '∞',
      '10個(Lv MAX)の純コストG': p > 0 ? Math.round((tiles - 14) * 10) : '∞',
      '20個(昇格1段)の純コストG': p > 0 ? Math.round((tiles - 14) * 20) : '∞',
      '20個ぶんの所要時間(分・G/分=' + r1(60 * gPerSecStd) + ')': p > 0 ? r1((tiles - 14) * 20 / gPerSecStd / 60) : '∞',
    });
  }
  // レア度分布（standard・L=1）と「同ランク10個」に必要な総ドロップ数
  const rarRows = [];
  for (const depth of [50, 200, 500, 1000]) {
    const N = 40000, cnt = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) cnt[rollRarityIndex(depth, 1)]++;
    const keys = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const row = { '深度': depth };
    keys.forEach((k, i) => {
      const p = cnt[i] / N;
      row[k + '%'] = r2(p * 100);
      row[k + ' 10個に必要な総ドロップ'] = p > 0 ? Math.round(10 / p) : '∞';
    });
    rarRows.push(row);
  }
  // 鍛錬の経験値要件（同ランク素材Lv1を何個でMAXか＝設計値MAT_TO_MAXの検算）
  const forgeRows = [];
  for (const k of ['common', 'uncommon', 'rare', 'epic', 'legendary']) {
    const cap = lvCapOf(k), unit = EXP_UNIT_BY_RARITY[k];
    let total = 0; for (let lv = 1; lv < cap; lv++) total += expToNext(k, lv);
    forgeRows.push({
      'ランク': k, 'Lv上限': cap, '素材1個の経験値': unit,
      'MAXまでの総経験値': total, '同ランク素材の必要個数': r1(total / unit),
      '昇格に追加で必要な同ランク': PROMOTE_COST,
      '1段昇格の総個数(自分含む)': r1(total / unit) + PROMOTE_COST + 1,
    });
  }
  // 深度を下げるコスト（掘削1G/マス＋あくま部屋移動50G/10行）
  const depthCost = [50, 100, 200, 500, 1000].map(d => ({
    '深度': d,
    'あくま部屋移動回数(10行/回)': Math.ceil(d / DIG_RANGE_BELOW_CASTLE),
    '移動コストG': Math.ceil(d / DIG_RANGE_BELOW_CASTLE) * 50,
    'シャフト掘削G(最低)': d,
    '最低合計G': Math.ceil(d / DIG_RANGE_BELOW_CASTLE) * 50 + d,
    '所要時間(分・通常)': r1((Math.ceil(d / DIG_RANGE_BELOW_CASTLE) * 50 + d) / gPerSecStd / 60),
  }));

  // ============================================================
  // 6) モンスター1体=掘削1G。数で押す戦術の費用
  // ============================================================
  const armyRows = [];
  for (const hlv of [10, 20, 30, 50, 80, 100]) {
    const cs = cStar(hlv, 'golem', 5);
    const n = Math.ceil(cs * cs / 4);
    armyRows.push({
      '勇者Lv': hlv, 'モンスターLv5で必要な体数N*': n, '調達コストG(1G/体)': n,
      '1体討伐の収入G': 25 * KILL_REWARD_MULT,
      '収支G': 25 * KILL_REWARD_MULT - n,
      '破綻するか': n > 25 * KILL_REWARD_MULT ? 'YES' : 'no',
    });
  }

  process.stdout.write(JSON.stringify({
    定数: {
      TIME_SCALE, ACTION_THRESHOLD, FAST_THRESHOLD, ATK_UNITS_CAP,
      MONSTER_HP_MULT, HERO_HP_MULT, CASTLE_MAX_HP, KILL_REWARD_MULT,
      HERO_SPAWN_SEC, HERO_SPAWN_SEC_FAST, MAX_LEVEL,
      早送り倍率: r2(atkRateF(5) / atkRateN(5)),
    },
    '1_収入クロック(standard)': incomeRows,
    '1b_収入(hard)': hardIncome,
    '2_レベル上げコスト': levelRows,
    '3_ダイヤ供給': diaRows,
    '3b_ダイヤ目標到達': diaTargets,
    '4_勇者vs戦力': raceRows,
    '4b_必要モンスターLv': needLvRows,
    '4c_供給と需要の突き合わせ': matchRows,
    '5_宝石鉱脈': gemRows,
    '5b_レア度分布': rarRows,
    '5c_鍛錬コスト': forgeRows,
    '5d_深度コスト': depthCost,
    '6_数で押す費用': armyRows,
  }, null, 1) + '\n');
})();
