// 全軌道テスト：手組みの決定的シナリオでgameLoopをNティック回し、
// 全エンティティの(x,y,hp,cd)系列＋Math.random消費回数をハッシュ化して出力。
// baseline版と最適化版で完全一致すれば統合レベルの保存則1/2が担保される。
(function () {
  try {
    // 1) マップ生成（Math.randomを消費：baseline/最適化で同一）
    generateMap();

    // 2) 地下に通路と部屋を決定的に掘る（石=1 → 0）
    for (let y = SKY_LAYERS; y < ROWS; y++) {
      // 中央シャフト
      if (map[y][ENTRANCE_X] === 1 || map[y][ENTRANCE_X] === 3) map[y][ENTRANCE_X] = 0;
      // 数本の横坑
      if (y % 4 === 0) {
        for (let x = 2; x < COLS - 2; x++) if (map[y][x] === 1) map[y][x] = 0;
      }
    }
    // 下部に部屋
    const roomTop = ROWS - 6;
    for (let y = roomTop; y < ROWS - 1; y++)
      for (let x = 4; x < COLS - 4; x++) if (map[y][x] !== 4) map[y][x] = 0;

    // 3) 城を部屋中央へ
    const cx = ENTRANCE_X, cy = ROWS - 3;
    map[cy][cx] = 5;
    castlePos = { x: cx, y: cy };
    castleHp = CASTLE_MAX_HP;

    // 4) 状態初期化
    gameMode = 'standard';
    if (typeof leverage === 'object') { leverage.active = false; leverage.mult = 1; }
    heroLevel = 3;
    gold = 0; diamond = 0; totalEarnedGold = 0;
    isWaveStarted = true;
    isPaused = false;
    isFastMode = false;
    isGameRunning = true;

    // 5) エンティティ配置（makeEntityはgetJitterでRNG消費）
    heroes.length = 0; monsters.length = 0;
    function mkHero(x, y, props) {
      return makeEntity(x, y, Object.assign({
        isHero: true, hp: 30, maxHp: 30, atk: 3, agi: 4, range: 8,
        color: '#3498db', heroType: 'normal', isEnraged: false,
        hasPotion: false, potionUsed: false,
      }, props));
    }
    function mkMon(x, y, mt, props) {
      return makeEntity(x, y, Object.assign({
        isHero: false, mtype: mt, hp: 12, maxHp: 12, atk: 2, agi: 3, range: 4,
        color: '#2ecc71', isBaby: false, fertile: false,
      }, props));
    }
    heroes.push(mkHero(ENTRANCE_X, SKY_LAYERS));
    heroes.push(mkHero(ENTRANCE_X, SKY_LAYERS + 1, { agi: 6 }));
    heroes.push(mkHero(ENTRANCE_X, SKY_LAYERS, { heroType: 'speed', agi: 8 }));
    monsters.push(mkMon(cx - 1, cy, 'slime', { fertile: true }));
    monsters.push(mkMon(cx + 1, cy, 'slime', { fertile: true }));
    monsters.push(mkMon(cx, cy - 1, 'goblin', { agi: 5 }));
    monsters.push(mkMon(cx - 2, cy - 1, 'golem', { agi: 1, hp: 30, maxHp: 30 }));

    // 6) 駆動
    const FI = FRAME_INTERVAL;
    const snaps = [];
    const N = 1000;
    for (let t = 0; t < N; t++) {
      HARNESS.setClock(HARNESS.getClock() + FI);
      const ts = HARNESS.getClock();
      // フレームゲートを通すため lastFrameTime を十分過去に
      lastFrameTime = ts - FI - 1;
      gameLoop(ts);

      // スナップショット（決定的順序）
      const all = [];
      for (const h of heroes) all.push('H' + h.x + ',' + h.y + ',' + h.hp + ',' + Math.round(h.cd));
      for (const mo of monsters) all.push('M' + mo.mtype + mo.x + ',' + mo.y + ',' + mo.hp + ',' + Math.round(mo.cd));
      snaps.push(heroes.length + '/' + monsters.length + ':' + all.join(' '));
    }

    let h = 2166136261 >>> 0;
    const joined = snaps.join(';');
    for (let i = 0; i < joined.length; i++) { h ^= joined.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    process.stdout.write(JSON.stringify({
      ticks: N, hash: h.toString(16), rngCount: HARNESS.rngCount,
      finalHeroes: heroes.length, finalMonsters: monsters.length,
      lastSnap: snaps[N - 1].slice(0, 200),
    }) + '\n');
  } catch (e) {
    process.stdout.write('SIM_ERROR ' + (e && e.stack || e) + '\n');
  }
})();
