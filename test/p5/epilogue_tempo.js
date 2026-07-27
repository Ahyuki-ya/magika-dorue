// テンポの実測：実際に gameLoop を回して「1体の勇者を倒すのに何秒かかるか」を測る。
// 解析式（epilogue_balance）は理想化した殴り合いの近似なので、経路探索・射程・複数体の
// 割り込みを含む実際の値をここで確かめる。通常モードと早送りモードの両方を測る。
// 使い方: node test/p5/harness.js index.html tempo
(function () {
  const out = [];
  // 城の周りにモンスターを置き、勇者1体を上から進入させて決着までのフレーム数を数える
  function runCase(label, opts) {
    const o = Object.assign({ fast: false, monCount: 6, monLv: 1, mtype: 'slime', heroLv: 1, maxSec: 180 }, opts);
    generateMap();
    // 中央に縦シャフトを掘り、下部に部屋を作る
    for (let y = SKY_LAYERS; y < ROWS; y++) if (map[y][ENTRANCE_X] !== 4) map[y][ENTRANCE_X] = 0;
    const cy = ROWS - 4, cx = ENTRANCE_X;
    for (let y = cy - 2; y <= cy + 1; y++)
      for (let x = cx - 3; x <= cx + 3; x++) if (map[y] && map[y][x] !== 4) map[y][x] = 0;
    map[cy][cx] = 5;
    castlePos = { x: cx, y: cy }; castleHp = CASTLE_MAX_HP;
    if (typeof __p5_bumpTerrain === 'function') __p5_bumpTerrain();

    gameMode = 'standard';
    if (typeof leverage === 'object') { leverage.active = false; leverage.mult = 1; }
    heroLevel = o.heroLv; heroPower = 20 + (o.heroLv - 1);
    heroBaseAtk = 5; heroBaseAgi = 5; heroBaseHp = 10;
    gold = 0; totalEarnedGold = 0; defeatedHeroesCount = 0;
    isWaveStarted = true; isPaused = false; isGameRunning = true;
    isFastMode = !!o.fast;
    heroes.length = 0; monsters.length = 0;
    monsterLevels.slime = monsterLevels.goblin = monsterLevels.golem = o.monLv;

    // モンスターを城の周囲に配置
    const spots = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx-2,cy],[cx+2,cy],[cx-1,cy-1],[cx+1,cy-1],[cx,cy-2]];
    for (let i = 0; i < o.monCount; i++) {
      const [mx, my] = spots[i % spots.length];
      const e = effStat(o.mtype);
      monsters.push(makeEntity(mx, my, { hp: e.hp, maxHp: e.hp, atk: e.atk, agi: e.agi,
        range: e.range, atkRange: e.atkRange, isHero: false, mtype: o.mtype, color: '#fff' }));
    }
    // 勇者を1体、シャフトの上端に置く（進入から決着まで測る）
    const e2 = { hp: 10, atk: 5, agi: 5 };
    const hpEff = Math.max(1, Math.round(e2.hp * HERO_HP_MULT));
    heroes.push(makeEntity(cx, SKY_LAYERS, { hp: hpEff, maxHp: hpEff, atk: e2.atk, agi: e2.agi,
      range: HERO_SEARCH_RANGE, isHero: true, heroType: 'normal', isEnraged: false, color: '#3498db' }));

    const FI = o.fast ? 1000 / 60 : FRAME_INTERVAL;
    const maxFrames = Math.round(o.maxSec * 1000 / FI);
    let firstContact = null, decided = null, monLost = 0;
    const monAlive0 = monsters.filter(m => m.hp > 0).length;
    for (let t = 0; t < maxFrames; t++) {
      HARNESS.setClock(HARNESS.getClock() + FI);
      const ts = HARNESS.getClock();
      lastFrameTime = ts - FI - 1;
      gameLoop(ts);
      const h = heroes.find(x => x.hp > 0);
      const mAlive = monsters.filter(m => m.hp > 0).length;
      // 初接触＝勇者HPが減ったか、モンスターが減ったか
      if (firstContact === null && h && (h.hp < h.maxHp || mAlive < monAlive0)) firstContact = t;
      if (decided === null && (!h || mAlive === 0 || castleHp <= 0)) {
        decided = t; monLost = monAlive0 - mAlive;
        break;
      }
    }
    const sec = f => f === null ? null : Math.round(f * FI / 1000 * 10) / 10;
    const h = heroes.find(x => x.hp > 0);
    out.push({
      label,
      '早送り': !!o.fast, 'モンスター': `${o.mtype}Lv${o.monLv}×${o.monCount}`,
      '進入→初接触(秒)': sec(firstContact),
      '交戦→決着(秒)': (firstContact !== null && decided !== null) ? sec(decided - firstContact) : null,
      '決着まで合計(秒)': sec(decided),
      '結果': castleHp <= 0 ? '城陥落' : (!h ? '勇者を討伐' : (monsters.filter(m => m.hp > 0).length === 0 ? 'モンスター全滅' : '時間切れ')),
      '失ったモンスター': monLost,
      '勇者の残りHP': h ? `${Math.max(0, Math.round(h.hp))}/${h.maxHp}` : '0',
    });
  }

  runCase('通常・並のスライム6体', { fast: false, monCount: 6, monLv: 1 });
  runCase('通常・Lv5スライム6体', { fast: false, monCount: 6, monLv: 5 });
  runCase('通常・Lv5ゴーレム4体', { fast: false, monCount: 4, monLv: 5, mtype: 'golem' });
  runCase('早送り・Lv5スライム6体', { fast: true, monCount: 6, monLv: 5 });
  runCase('通常・Lv1スライム2体（負ける想定）', { fast: false, monCount: 2, monLv: 1, maxSec: 120 });

  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
})();
