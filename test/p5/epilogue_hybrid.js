// 異種交配（ハイブリッド）システムの検証。
//   1. 名前とアイコン（mtype="body+coat"・MAT_PREFIX/FORM_NOUN からの合成・素材の色）
//   2. ステータス合成規則（本改修の核）：素材が贈るステータスだけ max・射程は体・非対称性
//   3. 深き継承（rebuildHybridGrowth）：実際に値が動く組を自分で計算して確認
//   4. 場にいる個体への即反映（本作の確定方針）：HPは割合維持・ちびは半分
//   5. スキルツリー（magika_breed）：根・方向12・強化枝3・価格・前提条件
//   6. 交配の発生（繁殖ループ）：未解放ではMath.random()を消費しないこと（🔴最重要）
//   7. fertile 供給の拡張（ノードの隠れ特典・宝具「繁殖の祝福」）
//   8. 旧セーブ互換
//   9. UI経路のスモーク（例外が出ないことだけ）
// 使い方: node test/p5/harness.js index.html hybrid
(function () {
  const results = [];
  const chk = (name, cond, detail) => results.push({
    name, ok: !!cond, detail: detail === undefined ? '' : String(detail),
  });

  function resetSaves() {
    ['magika_breed', 'magika_shop', 'magika_diamond', 'magika_records', 'magika_monsterlevels', 'magika_monstercaps']
      .forEach(k => localStorage.removeItem(k));
  }

  // 城の周りに小さな部屋を作り、繁殖ループを直接ドライブできる状態を作る
  // （test/p5/epilogue_tempo.js / epilogue_crowd.js と同じ手筋）
  function mkArena() {
    generateMap();
    for (let y = SKY_LAYERS; y < ROWS; y++) if (map[y][ENTRANCE_X] !== 4) map[y][ENTRANCE_X] = 0;
    const cy = ROWS - 5, cx = ENTRANCE_X;
    for (let y = cy - 3; y <= cy + 2; y++)
      for (let x = cx - 5; x <= cx + 5; x++) if (map[y] && map[y][x] !== 4) map[y][x] = 0;
    map[cy][cx] = 5;
    castlePos = { x: cx, y: cy }; castleHp = CASTLE_MAX_HP;
    if (typeof __p5_bumpTerrain === 'function') __p5_bumpTerrain();

    gameMode = 'standard';
    if (typeof leverage === 'object') { leverage.active = false; leverage.mult = 1; }
    gold = 0; isWaveStarted = true; isPaused = false; isGameRunning = true; isFastMode = false;
    heroes.length = 0; monsters.length = 0;
    return { cx, cy };
  }

  // gameLoop を1フレームぶんだけ進める（他のエピローグと同じ時計制御）
  function tick() {
    HARNESS.setClock(HARNESS.getClock() + FRAME_INTERVAL);
    const ts = HARNESS.getClock();
    lastFrameTime = ts - FRAME_INTERVAL - 1;
    gameLoop(ts);
  }

  // 城(cx,cy)からの相対位置(dx,dy)に fertile な成体を1体置く
  function mkFertile(mt, cx, cy, dx, dy) {
    const e = effStat(mt);
    const m = makeEntity(cx + (dx || 0), cy + (dy || 0), {
      hp: e.hp, maxHp: e.hp, atk: e.atk, agi: e.agi, range: e.range, atkRange: e.atkRange,
      isHero: false, mtype: mt, color: MONSTER_COLORS[mt], fertile: true, isBaby: false,
    });
    monsters.push(m);
    return m;
  }

  // Math.random を一時的に固定値へ差し替え、必ず元に戻す
  // （HARNESS.lcg 自体は差し替えない＝rngCount のカウント経路を壊さない）
  function withFixedRandom(value, fn) {
    const orig = Math.random;
    Math.random = () => value;
    try { return fn(); } finally { Math.random = orig; }
  }

  // ============================================================
  // 1. 名前とアイコン
  // ============================================================
  chk('1a HYBRID_MTYPES は12種', HYBRID_MTYPES.length === 12, HYBRID_MTYPES.length);
  chk('1b ALL_MTYPES は16種', ALL_MTYPES.length === 16, ALL_MTYPES.length);
  chk('1c 12種すべての名前 = MAT_PREFIX[coat] + FORM_NOUN[body]',
      HYBRID_MTYPES.every(mt => MONSTER_NAMES[mt] === MAT_PREFIX[coatOf(mt)] + FORM_NOUN[bodyOf(mt)]),
      HYBRID_MTYPES.filter(mt => MONSTER_NAMES[mt] !== MAT_PREFIX[coatOf(mt)] + FORM_NOUN[bodyOf(mt)]));
  chk('1d goblin+golem = 銅ゴブリン', MONSTER_NAMES['goblin+golem'] === '銅ゴブリン', MONSTER_NAMES['goblin+golem']);
  chk('1e golem+goblin = 苔ゴーレム', MONSTER_NAMES['golem+goblin'] === '苔ゴーレム', MONSTER_NAMES['golem+goblin']);
  chk('1f 色は素材(coat)の色', MONSTER_COLORS['goblin+golem'] === MONSTER_COLORS['golem'], MONSTER_COLORS['goblin+golem']);

  // ============================================================
  // 2. ステータス合成規則（本改修の核）
  // ============================================================
  chk('2a 銅ゴブリンの敏捷はどのLvでも苔ゴブリンと同値',
      [1, 25, 50, 100].every(lv => mstatsAt('goblin+golem', lv).agi === mstatsAt('goblin', lv).agi),
      [1, 25, 50, 100].map(lv => `Lv${lv}:${mstatsAt('goblin+golem', lv).agi}/${mstatsAt('goblin', lv).agi}`));
  {
    const hy = mstatsAt('goblin+golem', 50), pure = mstatsAt('goblin', 50);
    chk('2b 銅ゴブリンのatkは苔ゴブリンより大きい(Lv50)', hy.atk > pure.atk, `${hy.atk} > ${pure.atk}`);
    chk('2c 銅ゴブリンのhpは苔ゴブリンより大きい(Lv50)', hy.hp > pure.hp, `${hy.hp} > ${pure.hp}`);
    chk('2d 銅ゴブリンのrangeは10（ゴブリンの体の索敵距離）', hy.range === 10, hy.range);
  }
  {
    const a = mstatsAt('goblin+golem', 50), b = mstatsAt('golem+goblin', 50);
    chk('2e 非対称性：goblin+golem と golem+goblin は異なる', JSON.stringify(a) !== JSON.stringify(b), { a, b });
    chk('2f rangeは10と4で違う', a.range === 10 && b.range === 4, { 'goblin+golem': a.range, 'golem+goblin': b.range });
  }
  chk('2g MONSTER_GROWTH[goblin+golem] の値', (() => {
    const g = MONSTER_GROWTH['goblin+golem'];
    return g.base.atk === 2 && g.base.agi === 2 && g.base.hp === 4 &&
           g.slope.atk === 0.6 && g.slope.agi === 1.0 && g.slope.hp === 1.4 && g.range === 10;
  })(), MONSTER_GROWTH['goblin+golem']);
  chk('2h MONSTER_GROWTH[golem+goblin] の値', (() => {
    const g = MONSTER_GROWTH['golem+goblin'];
    return g.base.atk === 2 && g.base.agi === 2 && g.base.hp === 4 &&
           g.slope.atk === 0.5 && g.slope.agi === 1.0 && g.slope.hp === 1.4 && g.range === 4;
  })(), MONSTER_GROWTH['golem+goblin']);

  // ============================================================
  // 3. 深き継承（rebuildHybridGrowth）
  // ============================================================
  {
    // goblin+golem: MAT_GIFT2[golem]=['agi'] が deep で加わるが、
    // slope.agi は非deepでも既に body(goblin=1.0) が採用されているので max(1.0, golem 0.2) は動かない。
    rebuildHybridGrowth(false);
    const agiShallow = MONSTER_GROWTH['goblin+golem'].slope.agi;
    rebuildHybridGrowth(true);
    const agiDeep = MONSTER_GROWTH['goblin+golem'].slope.agi;
    chk('3a goblin+golem の slope.agi はこの組では深き継承で変わらない',
        agiShallow === agiDeep && agiDeep === 1.0, `${agiShallow} → ${agiDeep}`);

    // slime+goblin: 非deepの贈り物は MAT_GIFT[goblin]=['agi']。
    // deep で MAT_GIFT2[goblin]=['atk'] が加わり、slope.atk が body(slime 0.5) から
    // max(slime 0.5, goblin 0.6)=0.6 へ実際に動く（自分で導出して選んだ組）。
    rebuildHybridGrowth(false);
    const atkShallow = MONSTER_GROWTH['slime+goblin'].slope.atk;
    rebuildHybridGrowth(true);
    const atkDeep = MONSTER_GROWTH['slime+goblin'].slope.atk;
    chk('3b slime+goblin の slope.atk は深き継承で 0.5→0.6 に実際に動く',
        atkShallow === 0.5 && atkDeep === 0.6, `${atkShallow} → ${atkDeep}`);
  }
  rebuildHybridGrowth(false);   // 🔴 必ず戻す（後続の項目に影響させない）
  chk('3c テストの最後に rebuildHybridGrowth(false) へ戻した',
      MONSTER_GROWTH['slime+goblin'].slope.atk === 0.5 && MONSTER_GROWTH['goblin+golem'].slope.atk === 0.6,
      { 'slime+goblin.atk': MONSTER_GROWTH['slime+goblin'].slope.atk, 'goblin+golem.atk': MONSTER_GROWTH['goblin+golem'].slope.atk });

  // ============================================================
  // 4. 場にいる個体への即反映（本作の確定方針）
  // ============================================================
  {
    monsters.length = 0;
    const mt = 'goblin+golem';
    monsterLevels[mt] = 10;
    const e0 = effStat(mt);
    const adult = makeEntity(5, 5, { hp: e0.hp, maxHp: e0.hp, atk: e0.atk, agi: e0.agi,
      range: e0.range, atkRange: e0.atkRange, isHero: false, mtype: mt, color: MONSTER_COLORS[mt],
      fertile: false, isBaby: false });
    adult.hp = Math.max(1, Math.round(adult.maxHp * 0.5));   // 半分のHPで置く

    const half = v => Math.max(1, Math.floor(v / 2));
    const baby = makeEntity(6, 5, { hp: half(e0.hp), maxHp: half(e0.hp), atk: half(e0.atk), agi: half(e0.agi),
      range: e0.range, atkRange: e0.atkRange, isHero: false, mtype: mt, color: MONSTER_COLORS[mt],
      fertile: false, isBaby: true, bornAt: 0 });
    monsters.push(adult, baby);

    const ratioBefore = adult.hp / adult.maxHp;
    const atkBefore = adult.atk, maxHpBefore = adult.maxHp;

    monsterLevels[mt] = 60;
    refreshMonsterStats();

    chk('4a レベルを上げて refreshMonsterStats すると atk が上がる', adult.atk > atkBefore, `${atkBefore} → ${adult.atk}`);
    chk('4b レベルを上げて refreshMonsterStats すると maxHp が上がる', adult.maxHp > maxHpBefore, `${maxHpBefore} → ${adult.maxHp}`);
    const ratioAfter = adult.hp / adult.maxHp;
    chk('4c HPは割合を維持する（半分で置いたら半分のまま）',
        Math.abs(ratioAfter - ratioBefore) < 0.02, `${ratioBefore.toFixed(3)} → ${ratioAfter.toFixed(3)}`);
    chk('4d ちびは成体の半分になる',
        baby.atk === half(adult.atk) && baby.agi === half(adult.agi) && baby.maxHp === half(adult.maxHp),
        { babyAtk: baby.atk, halfAdultAtk: half(adult.atk), babyMaxHp: baby.maxHp, halfAdultMaxHp: half(adult.maxHp) });

    monsterLevels[mt] = 1;   // 後始末
    monsters.length = 0;
  }

  // ============================================================
  // 5. スキルツリー
  // ============================================================
  {
    resetSaves();
    breedData = loadBreed();
    shopData = loadShop();

    chk('5a 初期状態の loadBreed() は既定値相当',
        breedData.root === 0 && Object.keys(breedData.nodes).length === 0 &&
        breedData.rate === 0 && breedData.cap === 0 && breedData.deep === 0, breedData);
    chk('5b 初期状態で unlockedHybrids() は空配列', unlockedHybrids().length === 0, unlockedHybrids());
    chk('5c 🔴 初期状態で activeMtypes() は [slime,goblin,golem] と完全一致',
        JSON.stringify(activeMtypes()) === JSON.stringify(['slime', 'goblin', 'golem']), activeMtypes());

    saveCarryDiamond(9999);
    const dia0 = loadCarryDiamond();

    // root未購入では方向ノードが買えない（親の前提）
    buyBreedNode('goblin+golem', false);
    chk('5d root未購入では方向ノードが買えない',
        !breedData.nodes['goblin+golem'] && loadCarryDiamond() === dia0);

    // records.breeds < 50 では root が買えない
    saveRecords(Object.assign({}, RECORD_DEFAULTS, { breeds: 10 }));
    buyBreedNode('root', false);
    chk('5e records.breeds<50 では root が買えない（ダイヤも減らない）',
        breedData.root === 0 && loadCarryDiamond() === dia0);

    // records.breeds >= 50 かつダイヤ十分なら root が買える。ダイヤ-30・永続化。
    saveRecords(Object.assign({}, RECORD_DEFAULTS, { breeds: 50 }));
    const diaBeforeRoot = loadCarryDiamond();
    buyBreedNode('root', false);
    chk('5f records.breeds>=50 で root が買える・ダイヤ-30・magika_breedへ永続化',
        breedData.root === 1 && loadCarryDiamond() === diaBeforeRoot - 30 &&
        JSON.parse(localStorage.getItem('magika_breed')).root === 1,
        { root: breedData.root, dia: loadCarryDiamond() });

    // 影が絡むノードは shopData.wraith が要る
    shopData.wraith = false;
    const diaBeforeWraithNode = loadCarryDiamond();
    buyBreedNode('goblin+wraith', false);
    chk('5g shopData.wraith=false では goblin+wraith が買えない',
        !breedData.nodes['goblin+wraith'] && loadCarryDiamond() === diaBeforeWraithNode);
    shopData.wraith = true;
    buyBreedNode('goblin+wraith', false);
    chk('5h shopData.wraith=true なら goblin+wraith が買える',
        breedData.nodes['goblin+wraith'] === 1 && loadCarryDiamond() === diaBeforeWraithNode - 30);

    // deep は解放済みハイブリッドが3種未満だと買えない、3種以上で買える
    buyBreedNode('deep', false);
    chk('5i ハイブリッド1種（3種未満）では deep が買えない', breedData.deep === 0);
    buyBreedNode('goblin+golem', false);
    buyBreedNode('deep', false);
    chk('5j ハイブリッド2種（3種未満）では deep が買えない', breedData.deep === 0);
    buyBreedNode('golem+goblin', false);
    buyBreedNode('deep', false);
    chk('5k ハイブリッド3種以上で deep が買える', breedData.deep === 1);

    // rate を2段階買うと crossRate()===0.60、未購入なら 0.30
    chk('5l rate未購入では crossRate()===0.30', crossRate() === 0.30, crossRate());
    buyBreedNode('rate', false);
    buyBreedNode('rate', false);
    chk('5m rateを2段階買うと crossRate()===0.60', crossRate() === 0.60, crossRate());

    // breedNodeCost の値
    chk('5n breedNodeCost の値（goblin+golem=20, golem+goblin=15, wraith+goblin=25, goblin+wraith=30）',
        breedNodeCost('goblin+golem') === 20 && breedNodeCost('golem+goblin') === 15 &&
        breedNodeCost('wraith+goblin') === 25 && breedNodeCost('goblin+wraith') === 30,
        { 'goblin+golem': breedNodeCost('goblin+golem'), 'golem+goblin': breedNodeCost('golem+goblin'),
          'wraith+goblin': breedNodeCost('wraith+goblin'), 'goblin+wraith': breedNodeCost('goblin+wraith') });
  }

  // ============================================================
  // 6. 交配の発生（繁殖ループ）
  // ============================================================
  {
    // ---- 未解放：Math.random() の消費回数が増えないこと（🔴最重要）----
    resetSaves();
    breedData = loadBreed();               // root=0
    shopData = loadShop();                 // wraith=false
    const { cx, cy } = mkArena();
    mkFertile('slime', cx, cy, 0, 0);
    mkFertile('goblin', cx, cy, 1, 0);
    const before = HARNESS.rngCount;
    tick();
    const after = HARNESS.rngCount;
    chk('6a 🔴 未解放なら繁殖ループはMath.random()を1回も消費しない', after === before, { before, after });
  }

  {
    // ---- 解放済み＋乱数を成功側に固定：ハイブリッドのちびが生まれる ----
    localStorage.removeItem('magika_breed');
    breedData = loadBreed();
    breedData.root = 1;
    breedData.nodes = { 'slime+goblin': 1 };
    const { cx, cy } = mkArena();
    const parentSlime = mkFertile('slime', cx, cy, 0, 0);
    const parentGoblin = mkFertile('goblin', cx, cy, 1, 0);
    withFixedRandom(0, tick);   // crossRate()=0.30 なので 0 は必ず成功側
    const babies = monsters.filter(m => m.isBaby);
    chk('6b 解放済み・成功固定でハイブリッドのちびが1体生まれ、mtypeが解放したノードと一致',
        babies.length === 1 && babies[0].mtype === 'slime+goblin',
        babies.map(m => m.mtype));
    chk('6c 両親のfertileが両方falseになる',
        parentSlime.fertile === false && parentGoblin.fertile === false,
        { slime: parentSlime.fertile, goblin: parentGoblin.fertile });
  }

  {
    // ---- 解放済み＋乱数を失敗側に固定：従来どおり同種のちびが生まれる ----
    localStorage.removeItem('magika_breed');
    breedData = loadBreed();
    breedData.root = 1;
    breedData.nodes = { 'slime+goblin': 1 };
    const { cx, cy } = mkArena();
    const slime1 = mkFertile('slime', cx, cy, 0, 0);
    const slime2 = mkFertile('slime', cx, cy, -1, 0);
    const goblin1 = mkFertile('goblin', cx, cy, 1, 0);   // 交配候補を作るために同居させる
    withFixedRandom(0.99, tick);   // crossRate()=0.30 なので 0.99 は必ず失敗側
    const babies = monsters.filter(m => m.isBaby);
    chk('6d 失敗固定なら従来どおり同種(slime)のちびが生まれる',
        babies.length === 1 && babies[0].mtype === 'slime', babies.map(m => m.mtype));
    chk('6e 交配候補だった goblin は消費されない（fertileのまま）', goblin1.fertile === true, goblin1.fertile);
  }

  {
    // ---- ハイブリッド成体2体（同種）で繁殖が成立する ----
    localStorage.removeItem('magika_breed');
    breedData = loadBreed();
    breedData.root = 1;
    breedData.nodes = { 'slime+goblin': 1 };
    const { cx, cy } = mkArena();
    mkFertile('slime+goblin', cx, cy, 0, 0);
    mkFertile('slime+goblin', cx, cy, 1, 0);
    tick();
    const babies = monsters.filter(m => m.isBaby);
    chk('6f ハイブリッド成体2体（同種）で繁殖が成立する（isHybridの子）',
        babies.length === 1 && isHybrid(babies[0].mtype) && babies[0].mtype === 'slime+goblin',
        babies.map(m => m.mtype));
  }

  {
    // ---- ハイブリッド×別種では交配が成立しない（方向ノードは純血ペアにしか定義されていない）----
    localStorage.removeItem('magika_breed');
    breedData = loadBreed();
    breedData.root = 1;
    breedData.nodes = { 'slime+goblin': 1, 'golem+goblin': 1 };
    const { cx, cy } = mkArena();
    const a = mkFertile('slime+goblin', cx, cy, 0, 0);
    const b = mkFertile('golem+goblin', cx, cy, 1, 0);
    const n0 = monsters.length;
    tick();
    chk('6g ハイブリッド×別種では交配が成立しない（頭数不変・両方fertileのまま）',
        monsters.length === n0 && a.fertile === true && b.fertile === true,
        { n0, n1: monsters.length, aFertile: a.fertile, bFertile: b.fertile });
  }

  // ============================================================
  // 7. fertile 供給
  // ============================================================
  {
    resetSaves();
    breedData = loadBreed();
    shopData = loadShop();
    gameMode = 'standard';
    monsters.length = 0;
    treasureFertile = 0;

    chk('7a 未解放・宝具なしで fertileNeedOf(slime)===2', fertileNeedOf('slime') === 2, fertileNeedOf('slime'));

    breedData.root = 1;
    breedData.nodes = { 'slime+goblin': 1 };
    chk('7b slime+goblinを解放すると crossFertileBonus(slime)===1 かつ crossFertileBonus(goblin)===1',
        crossFertileBonus('slime') === 1 && crossFertileBonus('goblin') === 1,
        { slime: crossFertileBonus('slime'), goblin: crossFertileBonus('goblin') });
    chk('7c fertileNeedOf(slime)===3', fertileNeedOf('slime') === 3, fertileNeedOf('slime'));

    treasureFertile = 2;
    chk('7d treasureFertile=2で fertileNeedOf(slime)===5', fertileNeedOf('slime') === 5, fertileNeedOf('slime'));
    treasureFertile = 0;

    chk('7e AFFIX_TYPES に key===fertile が存在する（「繁殖の祝福」）', AFFIX_TYPES.some(a => a.key === 'fertile'));
    chk('7f TREASURE_KINDS.censer.weights.fertile が定義されている',
        TREASURE_KINDS.censer && TREASURE_KINDS.censer.weights && typeof TREASURE_KINDS.censer.weights.fertile === 'number',
        TREASURE_KINDS.censer && TREASURE_KINDS.censer.weights);
  }

  // ============================================================
  // 8. 旧セーブ互換
  // ============================================================
  {
    localStorage.removeItem('magika_breed');
    let errBreed = null, fresh = null;
    try { fresh = loadBreed(); } catch (e) { errBreed = e; }
    chk('8a magika_breedが無くてもloadBreed()は例外を投げず既定値を返す',
        !errBreed && fresh && fresh.root === 0 && Object.keys(fresh.nodes).length === 0 &&
        fresh.rate === 0 && fresh.cap === 0 && fresh.deep === 0, fresh);

    localStorage.setItem('magika_monsterlevels', JSON.stringify({ slime: 5, goblin: 3, golem: 7, wraith: 1 }));
    const lv = loadMonsterLevels();
    chk('8b 旧セーブ（ハイブリッドのキーが無い）でも loadMonsterLevels() は全16種のキーを返し、ハイブリッドは1',
        ALL_MTYPES.every(mt => mt in lv) && HYBRID_MTYPES.every(mt => lv[mt] === 1),
        HYBRID_MTYPES.map(mt => `${mt}:${lv[mt]}`).join(','));

    localStorage.removeItem('magika_monstercaps');
    const caps = loadMonsterCaps();
    chk('8c loadMonsterCaps()も全16種でMONSTER_CAP_INITになる',
        ALL_MTYPES.every(mt => caps[mt] === MONSTER_CAP_INIT),
        ALL_MTYPES.map(mt => `${mt}:${caps[mt]}`).join(','));
  }

  // ============================================================
  // 9. UI経路のスモーク（例外が出ないことだけ・存在の検査はしない）
  // ============================================================
  {
    resetSaves();
    breedData = loadBreed();
    shopData = loadShop();
    let err = null;
    try {
      renderBreedInto(document.getElementById('breedList9a'), document.getElementById('breedDia9a'), true);
      renderBreedInto(document.getElementById('breedList9b'), document.getElementById('breedDia9b'), false);

      breedData.root = 1;
      breedData.nodes = { 'goblin+golem': 1 };
      renderBreedInto(document.getElementById('breedList9c'), document.getElementById('breedDia9c'), true);
      renderBreedInto(document.getElementById('breedList9d'), document.getElementById('breedDia9d'), false);

      syncHybridLevelCards();
      updateLevelPanel();

      renderShopInto(document.getElementById('shopList9a'), document.getElementById('shopDia9a'), true);
      renderShopInto(document.getElementById('shopList9b'), document.getElementById('shopDia9b'), false);
    } catch (e) { err = String(e && e.stack || e); }
    chk('9a-e UI経路（renderBreedInto/syncHybridLevelCards/updateLevelPanel/renderShopInto）で例外なし',
        err === null, err);
  }

  {
    // drawCoat / traceFormSilhouette は gameLoop 内のローカル関数なので、外からは直接呼べない
    // （harnessのeval同一スコープにも出てこない）。12種すべてのハイブリッドを場に出して
    // gameLoop を1回回し（monsters.forEach(drawEntity) 経由で内部的に呼ばれる）、
    // 描画経路で例外が出ないことだけを見る。
    const { cx, cy } = mkArena();
    let err = null;
    try {
      HYBRID_MTYPES.forEach((mt, i) => {
        const dx = (i % 5) - 2, dy = Math.floor(i / 5) - 1;
        mkFertile(mt, cx, cy, dx, dy);
      });
      tick();
    } catch (e) { err = String(e && e.stack || e); }
    chk('9f drawCoat/traceFormSilhouette（12種すべて・gameLoop経由）で例外なし', err === null, err);
  }

  // ---- 後始末：localStorage を触った項目を元に戻す ----
  resetSaves();
  breedData = loadBreed();
  shopData = loadShop();
  treasureFertile = 0;
  monsters.length = 0;
  heroes.length = 0;

  const fails = results.filter(r => !r.ok);
  process.stdout.write(JSON.stringify({
    total: results.length,
    passed: results.length - fails.length,
    failed: fails.length,
    checks: results.map(r => (r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ` [${r.detail}]` : '')),
  }, null, 1) + '\n');
})();
