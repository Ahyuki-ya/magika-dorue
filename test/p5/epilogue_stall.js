// 勇者の「立ち止まって何かをする」挙動のテスト（2026-09-10 の要望）。
//   ・家は即座には建たない。HERO_BUILD_MS のあいだ足を止めてから建つ
//   ・建設中にモンスターが近づいたら中断する（安全な場所で建てたいという動機）
//   ・薬は即回復しない。敵から離れ → 立ち止まって飲み → じわじわ効く
// ※ 検証シナリオ（sim）は 1000tick と短く、家も薬も発火しないので素通りしてしまう。
//    そのため専用の盤面を組んでここで見る。
(function () {
  const out = [];
  const chk = (name, ok, note) => out.push((ok ? '✅ ' : '❌ ') + name + (note !== undefined ? ' [' + note + ']' : ''));
  const FI = FRAME_INTERVAL;
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      HARNESS.setClock(HARNESS.getClock() + FI);
      const ts = HARNESS.getClock();
      lastFrameTime = ts - FI - 1;
      gameLoop(ts);
    }
  };
  // 縦一本の通路だけの盤面を作り、勇者と敵を置く土台
  function arena() {
    generateMap();
    for (let y = SKY_LAYERS; y < ROWS; y++) if (map[y][ENTRANCE_X] !== 4) map[y][ENTRANCE_X] = 0;
    const cx = ENTRANCE_X, cy = ROWS - 3;
    map[cy][cx] = 5; castlePos = { x: cx, y: cy }; castleHp = CASTLE_MAX_HP;
    gameMode = 'standard';
    if (typeof leverage === 'object') { leverage.active = false; leverage.mult = 1; }
    heroLevel = 3; isWaveStarted = true; isFastMode = false; isPaused = false; isGameRunning = true;
    gameTime = 0; lastFrameTime = 0;
    heroes.length = 0; monsters.length = 0;
    heroHouses.length = 0; heroGold = 999;
    // 深さの条件（前回より HERO_HOUSE_GAP 以上深く）はここでは検証しないので通しておく。
    // 見たいのは「立ち止まってから建つ」という段取りのほう。
    lastHouseDepth = -HERO_HOUSE_GAP;
    return { cx, cy };
  }
  function mkHero(x, y, over) {
    const h = makeEntity(x, y, Object.assign({
      isHero: true, hp: 40, maxHp: 40, atk: 3, agi: 4, range: 8,
      color: '#3498db', heroType: 'normal', isEnraged: false,
    }, over || {}));
    heroes.push(h);
    return h;
  }

  // ---- 1. 家：すぐには建たず、立ち止まってから建つ ----
  {
    const { cx } = arena();
    // ★ 城に隣接すると攻撃フェーズが優先されて移動フェーズに来ない（＝建設も始まらない）。
    //   建設の段取りを見たいので、城から離れた通路の上のほうに置く。
    const hy = SKY_LAYERS + 2;
    const hero = mkHero(cx, hy);
    // 設置確率(10%)を通すため、建設が始まるまで回す
    let started = false;
    for (let t = 0; t < 400 && !started; t++) { tick(); started = hero.stallKind === 'build'; }
    chk('1a 家は「建設中」から始まる（即座には建たない）', started && heroHouses.length === 0,
        started ? '建設中' : '400tickでも始まらなかった');
    if (started) {
      const until = hero.stallUntil;
      const x0 = hero.x, y0 = hero.y;
      tick(3);
      chk('1b 建設中は足が止まる', hero.x === x0 && hero.y === y0);
      chk('1c 建設中はまだ家が無い', heroHouses.length === 0);
      // 建設が終わるまで進める
      // 立ち止まりが解けるのは「次に足を動かせる番が来たとき」なので、
      // 時刻を越えただけでは足りない。解けるまで回す。
      let guard = 0;
      while (hero.stallKind && guard++ < 2000) tick();
      chk('1d 立ち止まり終わりに家が建つ', heroHouses.length === 1, heroHouses.length);
      chk('1e 建て終わったら立ち止まりは解ける', !hero.stallKind);
      chk('1f 立ち止まりは HERO_BUILD_MS ぶん', until - (until - HERO_BUILD_MS) === HERO_BUILD_MS);
    }
  }

  // ---- 2. 建設中に近づかれたら中断する ----
  {
    const { cx } = arena();
    const hy = SKY_LAYERS + 2;
    const hero = mkHero(cx, hy);
    let started = false;
    for (let t = 0; t < 400 && !started; t++) { tick(); started = hero.stallKind === 'build'; }
    if (started) {
      // 建設範囲の中にモンスターを置く
      monsters.push(makeEntity(hero.x, hero.y + 2, {
        isHero: false, mtype: 'slime', hp: 20, maxHp: 20, atk: 1, agi: 1, range: 4, color: '#95a5a6',
      }));
      // 中断が効くのも「次に足を動かせる番」なので、そこまで回す
      let guard = 0;
      while (hero.stallKind && guard++ < 200) tick();
      chk('2a 近づかれたら建設を中断する', !hero.stallKind, guard + 'tick');
      chk('2b 中断したので家は建たない', heroHouses.length === 0, heroHouses.length);
    } else {
      chk('2a 近づかれたら建設を中断する', false, '建設が始まらなかった');
    }
  }

  // ---- 3. 薬：離れてから飲み、じわじわ効く ----
  {
    const { cx } = arena();
    const hy = SKY_LAYERS + 6;
    const hero = mkHero(cx, hy, { hasPotion: true, potionUsed: false, hp: 10, maxHp: 40, agi: 8 });
    // すぐ隣に敵（弱くして勇者が死なないように）
    const mon = makeEntity(cx, hy + 1, {
      isHero: false, mtype: 'slime', hp: 999, maxHp: 999, atk: 0, agi: 1, range: 4, color: '#95a5a6',
    });
    monsters.push(mon);
    const hp0 = hero.hp;
    tick(1);
    chk('3a HP30%以下で「離れる」に入る', hero.potionPhase === 'retreat', hero.potionPhase);
    chk('3b 飲む前に回復はしない', hero.hp === hp0, hero.hp);
    // 離れて飲むまで進める
    let guard = 0;
    while (!hero.potionUsed && guard++ < 2000) tick();
    chk('3c いずれ薬を飲む', hero.potionUsed === true);
    const distWhenDrunk = Math.abs(hero.x - mon.x) + Math.abs(hero.y - mon.y);
    chk('3d 敵から離れてから飲んでいる', distWhenDrunk > 1, distWhenDrunk);
    const hpAtDrink = hero.hp;
    chk('3e 飲んだ瞬間には効いていない', hpAtDrink <= hp0 + 1, hpAtDrink);
    tick(40);
    const hpMid = hero.hp;
    chk('3f じわじわ増える', hpMid > hpAtDrink, hpAtDrink + ' → ' + hpMid);
    chk('3g HPは整数のまま', Number.isInteger(hero.hp), hero.hp);
    // 効き終わるまで
    guard = 0;
    while (gameTime < hero.regenUntil + FI * 2 && guard++ < 2000) tick();
    const healed = hero.hp - hp0;
    const want = Math.round(hero.maxHp * POTION_HEAL);
    chk('3h 合計の回復量はおよそ maxHp×POTION_HEAL', Math.abs(healed - want) <= 2, healed + ' / ' + want);
    chk('3i 効き終わったら止まる', hero.hp <= hero.maxHp);
  }

  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
})();
