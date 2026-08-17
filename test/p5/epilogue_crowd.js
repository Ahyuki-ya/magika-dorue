// 同一マスの同居数を実測する。
// ゲームロジックには「1マス1体」の排他が無い（isPassable しか見ていない）ので、
// モンスター/勇者は同じマスに何体でも重なれる。描画はタイル中心固定なので、
// 重なった分はそのまま隠れて「1体に見える」。その隠れ具合を数える。
// 使い方: node test/p5/harness.js index.html crowd
(function () {
  function setupRoom(monCount, mtype) {
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
    heroLevel = 1; heroPower = 20;
    heroBaseAtk = 5; heroBaseAgi = 5; heroBaseHp = 10;
    gold = 0; isWaveStarted = true; isPaused = false; isGameRunning = true; isFastMode = false;
    heroes.length = 0; monsters.length = 0;

    // 部屋の中にばらまく（実プレイの「掘って湧かせた直後」に相当）
    for (let i = 0; i < monCount; i++) {
      const mx = cx - 4 + (i % 9), my = cy - 2 + Math.floor(i / 9) % 4;
      const e = effStat(mtype);
      const m = makeEntity(mx, my, { hp: e.hp, maxHp: e.hp, atk: e.atk, agi: e.agi,
        range: e.range, atkRange: e.atkRange, isHero: false, mtype, color: MONSTER_COLORS[mtype] });
      m.fertile = false; m.isBaby = false;
      monsters.push(m);
    }
    return { cx, cy };
  }

  // 全エンティティをマス単位で数え、同居数のヒストグラムを返す。
  // hiddenOld = サブセル配置が無かった頃に隠れていた体数（マスあたり n-1 体）
  // hiddenNew = サブセル配置後に実際に描かれない体数（席あふれ分のみ）
  function census() {
    const bucket = new Map();
    const all = monsters.filter(m => m.hp > 0).concat(heroes.filter(h => h.hp > 0));
    for (const e of all) {
      const k = e.y * COLS + e.x;
      let a = bucket.get(k);
      if (!a) { a = []; bucket.set(k, a); }
      a.push(e);
    }
    let maxN = 0, occupied = 0, hiddenOld = 0, hiddenNew = 0, minGap = Infinity;
    let heroHiddenBad = 0;                  // 席が足りているのに隠れた勇者＝席順の不具合
    const hist = {};
    for (const arr of bucket.values()) {
      const n = arr.length;
      // 勇者は席を優先して取るので、同じマスの勇者が上限以下なら必ず全員描かれるはず
      const heroesHere = arr.filter(e => e.isHero);
      if (heroesHere.length <= 4) heroHiddenBad += heroesHere.filter(e => e.hiddenInCrowd).length;
      occupied++;
      hiddenOld += n - 1;
      if (n > maxN) maxN = n;
      hist[n] = (hist[n] || 0) + 1;
      // 席を持った個体どうしが十分に離れているか（＝分割できているか）を測る
      const seated = arr.filter(e => !e.hiddenInCrowd);
      hiddenNew += n - seated.length;
      for (let i = 0; i < seated.length; i++)
        for (let j = i + 1; j < seated.length; j++) {
          const dx = seated[i].ox - seated[j].ox, dy = seated[i].oy - seated[j].oy;
          const d = Math.hypot(dx, dy);
          if (d < minGap) minGap = d;
        }
    }
    return { total: all.length, occupied, hiddenOld, hiddenNew, maxN, hist, heroHiddenBad,
             minGap: minGap === Infinity ? null : minGap };
  }

  function runCase(label, opts) {
    const o = Object.assign({ monCount: 40, mtype: 'slime', heroCount: 3, sec: 40 }, opts);
    const { cx, cy } = setupRoom(o.monCount, o.mtype);

    // 勇者を上から順次入れる（モンスターが群がる＝集中が起きる状況をつくる）
    for (let i = 0; i < o.heroCount; i++) {
      const hp = Math.max(1, Math.round(10 * HERO_HP_MULT)) * 40;   // 長く生存させて群がりを持続させる
      const h = makeEntity(cx, SKY_LAYERS + i, { hp, maxHp: hp, atk: 1, agi: 5,
        range: HERO_SEARCH_RANGE, isHero: true, heroType: 'normal', isEnraged: false, color: '#3498db' });
      heroes.push(h);
    }

    const FI = FRAME_INTERVAL;
    const frames = Math.round(o.sec * 1000 / FI);
    const samples = [];
    for (let t = 0; t < frames; t++) {
      HARNESS.setClock(HARNESS.getClock() + FI);
      const ts = HARNESS.getClock();
      lastFrameTime = ts - FI - 1;
      gameLoop(ts);
      if (t % 10 === 0) samples.push(census());
    }
    // 平均・最大をまとめる
    const avg = (f) => samples.reduce((s, c) => s + f(c), 0) / samples.length;
    const avgTotal = avg(c => c.total);
    const avgOld = avg(c => c.hiddenOld);
    const avgNew = avg(c => c.hiddenNew);
    const maxN = samples.reduce((s, c) => Math.max(s, c.maxN), 0);
    const gaps = samples.map(c => c.minGap).filter(v => v !== null);
    const histAll = {};
    for (const c of samples) for (const k in c.hist) histAll[k] = (histAll[k] || 0) + c.hist[k];
    const tiles = Object.values(histAll).reduce((a, b) => a + b, 0);
    const share = {};
    for (const k in histAll) share[k] = +(histAll[k] / tiles * 100).toFixed(1);
    return { label,
             avgTotal: +avgTotal.toFixed(1),
             hiddenPctBefore: +(avgOld / avgTotal * 100).toFixed(1),   // 従来（マス中心固定）
             hiddenPctAfter:  +(avgNew / avgTotal * 100).toFixed(1),   // サブセル配置後
             maxSameTile: maxN,
             heroHiddenBad: samples.reduce((s, c) => s + c.heroHiddenBad, 0),   // 0 でなければ席順の不具合
             minSeatGapPx: gaps.length ? +Math.min(...gaps).toFixed(2) : null,
             tileShareByCount: share };
  }

  // 実フレームの描画座標(rx, ry, ds)をそのまま吐く。盤面の見た目を目視で確かめるため。
  // indirect eval 下では require が使えないので標準出力に流す（呼び出し側でリダイレクト）。
  function dumpFrame() {
    const all = monsters.filter(m => m.hp > 0).concat(heroes.filter(h => h.hp > 0));
    const pts = all.filter(e => !e.hiddenInCrowd)
      .map(e => ({ rx: +e.rx.toFixed(2), ry: +e.ry.toFixed(2),
                   x: e.x, y: e.y, hero: !!e.isHero, mtype: e.mtype || null }));
    const tiles = new Map();
    for (const e of all) { const k = e.y * COLS + e.x; tiles.set(k, (tiles.get(k) || 0) + 1); }
    console.log(JSON.stringify({
      TILE_SIZE, COLS,
      tiles: [...tiles].map(([k, n]) => ({ x: k % COLS, y: (k / COLS) | 0, n })),
      pts
    }));
  }

  // assignSubcells 自体のコスト。描画は上限9体/マスで頭打ちになるので、
  // 混雑時はここで増えた分より drawEntity で減る分のほうが大きい。
  function benchAssign() {
    setupRoom(100, 'slime');
    for (let t = 0; t < 60; t++) {                       // ばらけさせてから測る
      HARNESS.setClock(HARNESS.getClock() + FRAME_INTERVAL);
      lastFrameTime = HARNESS.getClock() - FRAME_INTERVAL - 1;
      gameLoop(HARNESS.getClock());
    }
    const N = 2000;
    const t0 = HARNESS.realNow();
    for (let i = 0; i < N; i++) assignSubcells();
    const ms = (HARNESS.realNow() - t0) / N;
    const drawn = monsters.filter(m => !m.hiddenInCrowd).length + heroes.filter(h => !h.hiddenInCrowd).length;
    return { entities: monsters.length + heroes.length, drawnPerFrame: drawn,
             assignMsPerFrame: +ms.toFixed(4), budget16msPct: +(ms / 16.7 * 100).toFixed(2) };
  }

  // 個体は同居数によらず原寸で描く。席間隔に対して各種の実寸が収まるかを突き合わせる。
  // 幅は drawEntity の実装値：スライム 2*1.1*5、ゴブリン 2*0.75*4.5、ゴーレム 2*5.5、
  // レイス 2*1.7*5、勇者 2*8（オーラは 2*1.8*8 = 28.8 で別枠）。
  const BODY_W = { slime: 11, goblin: 6.75, golem: 11, wraith: 17, hero: 16 };
  function fitCheck(minGap) {
    const r = {};
    for (const k in BODY_W) {
      const clear = +(minGap - BODY_W[k]).toFixed(2);
      r[k] = clear >= 0 ? `収まる（隙間 ${clear}px）` : `${(-clear).toFixed(2)}px 食い込む`;
    }
    return r;
  }

  const out = [];
  out.push(runCase('slime40_hero3', { monCount: 40, mtype: 'slime', heroCount: 3 }));
  if (process.env.CROWD_DUMP) { dumpFrame(); return; }   // 直前ケースの最終フレームだけを出力
  out.push(runCase('slime80_hero3', { monCount: 80, mtype: 'slime', heroCount: 3 }));
  out.push(runCase('goblin60_hero5', { monCount: 60, mtype: 'goblin', heroCount: 5 }));
  out.push(runCase('slime40_hero0', { monCount: 40, mtype: 'slime', heroCount: 0 }));
  const worstGap = Math.min(...out.map(r => r.minSeatGapPx).filter(v => v !== null));
  console.log(JSON.stringify({ cases: out, worstSeatGapPx: +worstGap.toFixed(2),
                               fitAtWorstGap: fitCheck(worstGap), bench: benchAssign() }, null, 2));
})();
