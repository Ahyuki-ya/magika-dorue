// ハードモード（レバレッジ経済）の実測ものさし。
//   ・解析：勇者ステータス（富スケール／L倍ボーナス込み）を spawnHero 本物で回して平均を取る
//   ・実走：gameLoop を回して「L別に何レベルの勇者まで耐えられるか」を測る
// 使い方: node test/p5/harness.js index.html hard [seed]
//
// 主要な式：
//   DPS = atk × atkRate(agi),  atkRate = (1000/interval)·atkUnits(agi)/threshold
//   必要同時攻撃数 c* = √(HP_h·DPS_h / (HP_m·DPS_m))
//   拮抗の決着時間 T_battle = √(HP_h·HP_m / (DPS_h·DPS_m))
//   予備込みの必要総数 N* = c*²/c  （c=同時に殴れる数。近接の幾何上限は約4）
(function () {
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;
  const r3 = v => Math.round(v * 1000) / 1000;
  const INTERVAL_N = 1000 / TARGET_FPS;
  const atkRateN = agi => (1000 / INTERVAL_N) * atkUnits(agi) / ACTION_THRESHOLD;

  // ------------------------------------------------------------
  // 共通：ハードのランを1つ組み立てる（マップ・城・軍）
  // ------------------------------------------------------------
  function setupHard(o) {
    generateMap();
    const cy = Math.min(ROWS - 4, SKY_LAYERS + 1 + o.depth);
    expandMap(cy + DIG_RANGE_BELOW_CASTLE);
    const cx = ENTRANCE_X;
    for (let y = SKY_LAYERS; y <= cy; y++) if (map[y] && map[y][cx] !== 4) map[y][cx] = 0;
    for (let y = cy - 2; y <= cy + 2; y++)
      for (let x = cx - 4; x <= cx + 4; x++) if (map[y] && map[y][x] !== 4) map[y][x] = 0;
    map[cy][cx] = 5;
    castlePos = { x: cx, y: cy }; castleHp = CASTLE_MAX_HP;
    maxDepth = cy - SKY_LAYERS;
    if (typeof __p5_bumpTerrain === 'function') __p5_bumpTerrain();

    gameMode = 'hard';
    leverage = { active: true, stake: o.stake, mult: o.mult };
    gold = o.stake * o.mult;
    totalEarnedGold = 0; totalEarnedDiamond = 0; diamond = 0;
    defeatedHeroesCount = 0; heroGold = 0; sessionBreeds = 0;
    heroLevel = 0; heroPower = 20;
    heroBaseAtk = 5; heroBaseAgi = 5; heroBaseHp = 10;
    rageBonus.atk = rageBonus.agi = rageBonus.hp = 0;
    heroes.length = 0; monsters.length = 0;
    heroSpawn = null;
    isWaveStarted = true; isPaused = false; isGameRunning = true;
    isFastMode = !!o.fast;
    for (const mt of ALL_MTYPES) monsterLevels[mt] = Math.min(o.monLv, monsterCap[mt]);
    return { cx, cy };
  }

  // 城の周りの壁を掘って兵に換える（1G/マス・gold を実際に消費＝富スケールに効く）
  function digAround(cx, cy, R, budget) {
    let spent = 0;
    for (let pass = 0; pass < 3; pass++) {
      for (let r = 1; r <= R; r++) {
        for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
          if (spent >= budget) return spent;
          if (!map[y] || x < 1 || y < SKY_LAYERS + 1 || x >= COLS - 1 || y >= ROWS - 1) continue;
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
          const t = map[y][x];
          if (t !== 1 && t !== 2 && t !== 6 && t !== 7) continue;   // 宝石鉱脈(8)は掘らない＝兵にならない
          const before = monsters.length;
          dig({ offsetX: x * TILE_SIZE + 1, offsetY: y * TILE_SIZE + 1 });
          if (monsters.length > before) spent++;
        }
      }
    }
    return spent;
  }

  // ------------------------------------------------------------
  // 1) 勇者ステータスの実測（L別・所持ゴールド別）
  //    spawnHero を本物で回し、同じ (Lv, gold, L) を TRIALS 回引いて平均を取る
  // ------------------------------------------------------------
  const TRIALS = 24;
  function heroStatAt(lv, goldAmt, L) {
    let a = 0, g = 0, h = 0;
    for (let i = 0; i < TRIALS; i++) {
      gameMode = L > 1 ? 'hard' : 'standard';
      leverage = { active: L > 1, stake: 0, mult: L > 1 ? L : 1 };
      heroes.length = 0; heroGold = 0;
      rageBonus.atk = rageBonus.agi = rageBonus.hp = 0;
      isGameRunning = true; isWaveStarted = true;
      // 目標 Lv-1 まで空回し（heroPower と rageBonus を本物の経路で積む）
      heroLevel = 0; heroPower = 20; gold = 0;
      for (let k = 1; k < lv; k++) { spawnHero(); heroes.length = 0; }
      gold = goldAmt;
      heroLevel = lv - 1;
      spawnHero();
      const hh = heroes[heroes.length - 1];
      a += hh.atk; g += hh.agi; h += hh.maxHp;
    }
    return { atk: a / TRIALS, agi: g / TRIALS, hp: h / TRIALS };
  }

  // 参照するモンスター（ゴーレム＝盾役）の目盛り
  function monRef(mt, lv) {
    const s = mstatsAt(mt, Math.min(lv, MAX_LEVEL));
    return { hp: s.hp, dps: s.atk * atkRateN(s.agi) };
  }

  const statRows = [];
  for (const cfg of [
    { lv: 5,  L: 1, gold: 0,     tag: 'standard（比較）' },
    { lv: 5,  L: 2, gold: 200,   tag: 'S=100' },
    { lv: 5,  L: 3, gold: 300,   tag: 'S=100' },
    { lv: 5,  L: 5, gold: 500,   tag: 'S=100' },
    { lv: 5,  L: 10, gold: 1000, tag: 'S=100' },
    { lv: 10, L: 1, gold: 0,     tag: 'standard（比較）' },
    { lv: 10, L: 2, gold: 200,   tag: 'S=100' },
    { lv: 10, L: 5, gold: 500,   tag: 'S=100' },
    { lv: 10, L: 10, gold: 1000, tag: 'S=100' },
    { lv: 20, L: 2, gold: 1000,  tag: 'S=100・稼いだ後' },
    { lv: 20, L: 5, gold: 2500,  tag: 'S=100・稼いだ後' },
    { lv: 20, L: 10, gold: 5000, tag: 'S=100・稼いだ後' },
    { lv: 20, L: 10, gold: 30000, tag: 'S=3000（全力）' },
  ]) {
    const s = heroStatAt(cfg.lv, cfg.gold, cfg.L);
    const dps = s.atk * atkRateN(s.agi);
    const m = monRef('golem', 10);
    const cStar = Math.sqrt(s.hp * dps / (m.hp * m.dps));
    statRows.push({
      '勇者Lv': cfg.lv, L: cfg.L, '所持G': cfg.gold, 条件: cfg.tag,
      atk: r1(s.atk), agi: r1(s.agi), HP: Math.round(s.hp), DPS: r1(dps),
      'c*(vsゴーレムLv10)': r2(cStar),
      'N*=c*²/4': Math.ceil(cStar * cStar / 4),
      'T_battle(秒)': r1(Math.sqrt(s.hp * m.hp / (dps * m.dps))),
    });
  }

  // ------------------------------------------------------------
  // 1b) 実走：必要兵力 N* の実測（解析式 N*=c*²/4 の裏取り）
  //     「勇者1体を城で受けて、城を落とされずに討伐できる最小のモンスター数」を二分探索。
  //     経路・射程・幾何（同時に殴れる数）込みの実値。ρ = N*/開始資本 が L に対して
  //     平坦なら、レバレッジは「増収と増難が釣り合った純粋な分散ダイヤル」になる。
  // ------------------------------------------------------------
  function oneFight(heroLv, L, goldAmt, monLv, N, mtype) {
    // 盤面：縦シャフト＋城の部屋（9×5）。部屋の中なら複数体が同時に殴れる
    generateMap();
    const cy = Math.min(ROWS - 4, SKY_LAYERS + 1 + 30);
    expandMap(cy + DIG_RANGE_BELOW_CASTLE);
    const cx = ENTRANCE_X;
    for (let y = SKY_LAYERS; y <= cy; y++) if (map[y] && map[y][cx] !== 4) map[y][cx] = 0;
    for (let y = cy - 2; y <= cy + 2; y++)
      for (let x = cx - 4; x <= cx + 4; x++) if (map[y] && map[y][x] !== 4) map[y][x] = 0;
    map[cy][cx] = 5;
    castlePos = { x: cx, y: cy }; castleHp = CASTLE_MAX_HP;
    maxDepth = cy - SKY_LAYERS;
    if (typeof __p5_bumpTerrain === 'function') __p5_bumpTerrain();

    gameMode = 'hard';
    leverage = { active: true, stake: goldAmt / L, mult: L };
    heroes.length = 0; monsters.length = 0;
    heroGold = 0; defeatedHeroesCount = 0;
    rageBonus.atk = rageBonus.agi = rageBonus.hp = 0;
    isWaveStarted = true; isPaused = false; isGameRunning = true; isFastMode = false;
    heroSpawn = { x: cx, y: SKY_LAYERS };
    for (const mt of ALL_MTYPES) monsterLevels[mt] = Math.min(monLv, MAX_LEVEL);

    // 勇者：目標 Lv まで空回し（heroPower・rageBonus を本物の経路で積む）
    heroLevel = 0; heroPower = 20; gold = 0;
    for (let k = 1; k < heroLv; k++) { spawnHero(); heroes.length = 0; }
    gold = goldAmt; heroLevel = heroLv - 1;
    // 軍を城の周りに配置（部屋 → 部屋の外周 → シャフト の順に詰める）
    const spots = [];
    for (let r = 1; r <= 4; r++)
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 4; x <= cx + 4; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
        if (map[y] && map[y][x] === 0) spots.push([x, y]);
      }
    for (let i = 0; i < N; i++) {
      const [mx, my] = spots[i % spots.length];
      const e = effStat(mtype);
      monsters.push(makeEntity(mx, my, { hp: e.hp, maxHp: e.hp, atk: e.atk, agi: e.agi,
        range: e.range, atkRange: e.atkRange, isHero: false, mtype, color: '#fff' }));
    }
    spawnHero();                                       // 湧きは heroSpawn（シャフト上端）
    const FI = FRAME_INTERVAL, maxFrames = Math.round(150 * 1000 / FI);
    for (let t = 0; t < maxFrames; t += 5) {
      for (let k = 0; k < 5; k++) {
        HARNESS.setClock(HARNESS.getClock() + FI);
        lastFrameTime = HARNESS.getClock() - FI - 1;
        gameLoop(HARNESS.getClock());
      }
      if (castleHp <= 0) return false;                 // 負け
      if (!heroes.some(h => h.hp > 0)) return true;    // 勝ち
    }
    return false;                                      // 時間切れ＝討伐しきれない＝負け扱い
  }

  // 勝率が半分を超える最小 N（候補は粗いグリッド。reps 回引いて多数決）
  const N_GRID = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
  function needArmy(heroLv, L, goldAmt, monLv, mtype, reps) {
    let lo = 0, hi = N_GRID.length - 1, ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      let win = 0;
      for (let i = 0; i < reps; i++) if (oneFight(heroLv, L, goldAmt, monLv, N_GRID[mid], mtype)) win++;
      if (win * 2 > reps) { ans = N_GRID[mid]; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
  }

  const needRows = [];
  for (const heroLv of [10, 20]) {
    for (const L of [2, 3, 5, 10]) {
      const S = 100, capital = S * L;
      for (const goldMult of [1, 5]) {                 // 開幕（G=S×L）と中盤（G=5×S×L）
        const goldAmt = goldMult * capital;
        const need = needArmy(heroLv, L, goldAmt, 10, 'golem', 3);
        needRows.push({
          '勇者Lv': heroLv, L, 'S': S, 開始資本: capital, '所持G': goldAmt,
          '防衛': 'ゴーレムLv10',
          '必要兵力N*(実測)': need === null ? '>256' : need,
          'ρ=N*/所持G': need === null ? null : r3(need / goldAmt),
          'ρ=N*/開始資本': need === null ? null : r3(need / capital),
        });
      }
    }
  }
  // ρ の L 依存（開始資本基準）。1.0 に近いほど「レバレッジ＝純粋な分散」
  const rhoTrend = {};
  for (const heroLv of [10, 20]) for (const gm of [1, 5]) {
    const sel = needRows.filter(r => r['勇者Lv'] === heroLv && r['所持G'] === gm * 100 * r.L);
    const base = sel.find(r => r.L === 2);
    rhoTrend[`勇者Lv${heroLv}・G=${gm}×S×L`] = sel.reduce((acc, r) => {
      acc[`L${r.L}`] = (base && base['ρ=N*/開始資本'] && r['ρ=N*/開始資本'])
        ? r2(r['ρ=N*/開始資本'] / base['ρ=N*/開始資本']) : null;
      return acc;
    }, {});
  }

  // ------------------------------------------------------------
  // 2) 実走：L別に「何レベルの勇者まで耐えられるか」
  //    政策 policy: 'reinvest' = 波の合間にゴールドを掘削・Lv上げに再投資
  //                 'hoard'    = 貯め込む（＝富スケールで勇者が強くなる）
  // ------------------------------------------------------------
  function runHard(label, opts) {
    const o = Object.assign({
      stake: 100, mult: 2, monLv: 10, depth: 30, digR: 4, digBudget: 60,
      policy: 'reinvest', maxHeroLv: 40, fast: false,
    }, opts);
    const { cx, cy } = setupHard(o);
    const army0 = digAround(cx, cy, o.digR, o.digBudget);
    const FI = o.fast ? 1000 / 60 : FRAME_INTERVAL;
    const step = frames => {
      for (let t = 0; t < frames; t++) {
        HARNESS.setClock(HARNESS.getClock() + FI);
        const ts = HARNESS.getClock();
        lastFrameTime = ts - FI - 1;
        gameLoop(ts);
        if (castleHp <= 0) return false;
      }
      return true;
    };
    const spawnSec = o.fast ? HERO_SPAWN_SEC_FAST : HERO_SPAWN_SEC;
    let reached = 0, peak = army0, timeSec = 0, minCastle = CASTLE_MAX_HP;
    const marks = [];
    for (let lv = 1; lv <= o.maxHeroLv; lv++) {
      // 波の合間の再投資
      if (o.policy === 'reinvest') {
        // 手持ちの3割を掘削（兵の補充）に、残りで Lv 上げを1段だけ狙う
        digAround(cx, cy, o.digR, Math.max(0, Math.floor(gold * 0.3)));
        for (const mt of ALL_MTYPES) {
          const lvNow = monsterLevels[mt];
          if (lvNow < monsterCap[mt] && gold > goldCostFor(lvNow + 1) * 3) levelUp(mt);
        }
      }
      if (!step(Math.round(spawnSec * 1000 / FI))) break;
      spawnHero();
      const h = heroes[heroes.length - 1];
      const hDps = h.atk * atkRateN(h.agi);
      const monAlive0 = monsters.filter(m => m.hp > 0).length;
      const maxFrames = Math.round(120 * 1000 / FI);
      let cleared = false;
      for (let t = 0; t < maxFrames; t += 15) {
        if (!step(15)) break;
        peak = Math.max(peak, monsters.filter(m => m.hp > 0).length);
        minCastle = Math.min(minCastle, castleHp);
        if (!heroes.some(x => x.hp > 0)) { cleared = true; break; }
      }
      timeSec = HARNESS.getClock() / 1000;
      if (lv === 1 || lv % 5 === 0) {
        marks.push({
          Lv: lv, atk: h.atk, agi: h.agi, HP: h.maxHp, DPS: r1(hDps),
          兵: monAlive0, '失った兵': monAlive0 - monsters.filter(m => m.hp > 0).length,
          城: Math.max(0, castleHp), G: Math.round(gold), モンスターLv: monsterLevels.golem,
        });
      }
      if (castleHp <= 0) break;
      if (!cleared) break;                                  // 120秒で倒せない＝処理落ち
      reached = lv;
    }
    const cap = o.stake * o.mult;
    return {
      label, L: o.mult, S: o.stake, 開始資本: cap, 政策: o.policy,
      モンスターLv初期: o.monLv, 初期兵: army0,
      '耐えた勇者Lv': reached,
      結果: castleHp <= 0 ? '城陥落' : (reached >= o.maxHeroLv ? `Lv${o.maxHeroLv}まで完走` : '時間切れ(処理落ち)'),
      討伐数: defeatedHeroesCount,
      経過秒: Math.round(timeSec),
      '手持ちG': Math.round(gold), '純益ΔB': Math.round(gold - cap),
      '💎': totalEarnedDiamond,
      同時最大兵: peak, 最終兵: monsters.filter(m => m.hp > 0).length,
      城HP: Math.max(0, castleHp) + '/' + CASTLE_MAX_HP,
      節目: marks,
    };
  }

  const runs = [];
  for (const L of [2, 3, 5, 10]) {
    runs.push(runHard(`L${L}・S100・monLv10・再投資`, { mult: L, stake: 100, monLv: 10, policy: 'reinvest' }));
  }
  for (const L of [2, 10]) {
    runs.push(runHard(`L${L}・S100・monLv10・貯め込み`, { mult: L, stake: 100, monLv: 10, policy: 'hoard' }));
  }
  runs.push(runHard('L10・S3000・monLv20・再投資', { mult: 10, stake: 3000, monLv: 20, digR: 5, digBudget: 200, policy: 'reinvest' }));
  runs.push(runHard('L2・S3000・monLv20・再投資', { mult: 2, stake: 3000, monLv: 20, digR: 5, digBudget: 200, policy: 'reinvest' }));

  // L別サマリ（1本ずつなので乱数のブレは残る。傾向を見る用）
  const summary = runs.map(r => ({
    label: r.label, L: r.L, 開始資本: r.開始資本, 初期兵: r.初期兵,
    '耐えた勇者Lv': r['耐えた勇者Lv'], 結果: r.結果, 討伐数: r.討伐数,
    '純益ΔB': r['純益ΔB'], '純益/資本': r2(r['純益ΔB'] / r.開始資本),
  }));

  process.stdout.write(JSON.stringify({
    定数: {
      HERO_GOLD_SCALE: typeof HERO_GOLD_SCALE !== 'undefined' ? HERO_GOLD_SCALE : null,
      RAGE_GOLD_SCALE: typeof RAGE_GOLD_SCALE !== 'undefined' ? RAGE_GOLD_SCALE : null,
      LEV_HERO_SCALE: typeof LEV_HERO_SCALE !== 'undefined' ? LEV_HERO_SCALE : '(未実装)',
      LEV_HERO_HP_RATIO: typeof LEV_HERO_HP_RATIO !== 'undefined' ? LEV_HERO_HP_RATIO : '(未実装)',
      HERO_HP_MULT, MONSTER_HP_MULT: typeof MONSTER_HP_MULT !== 'undefined' ? MONSTER_HP_MULT : null,
      KILL_REWARD_MULT, CASTLE_MAX_HP, LEV_TIERS: LEV_TIERS.join('/'),
    },
    '勇者ステータス（解析・実測平均）': statRows,
    '必要兵力N*（実測・二分探索）': needRows,
    'ρのL依存（L=2基準）': rhoTrend,
    'L別サマリ': summary,
    実走: runs,
  }, null, 1) + '\n');
})();
