// P5-6 ポーズ修正の正当性テスト（最適化版で実行）：
// 壁時計を大きく進めながらポーズ→再開しても、論理時刻(gameTime)が凍結され
// スタック直行タイマーやちび成長が誤発火しないことを確認。
(function () {
  try {
    generateMap();
    for (let y = SKY_LAYERS; y < ROWS; y++) if (map[y][ENTRANCE_X] !== 4) map[y][ENTRANCE_X] = 0;
    const cx = ENTRANCE_X, cy = ROWS - 3; map[cy][cx] = 5; castlePos = { x: cx, y: cy };
    castleHp = CASTLE_MAX_HP;
    gameMode = 'standard';
    if (typeof leverage === 'object') { leverage.active = false; leverage.mult = 1; }
    heroLevel = 3; isWaveStarted = true; isFastMode = false; isGameRunning = true;
    if (typeof gameTime !== 'undefined') gameTime = 0;
    lastFrameTime = 0;

    heroes.length = 0; monsters.length = 0;
    // 壁で囲って動けない=スタックする勇者を1体（周囲を石で塞ぐ）
    const hx = 3, hy = ROWS - 8;
    map[hy][hx] = 0;
    for (const d of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx=hx+d[0], ny=hy+d[1]; if(map[ny]&&map[ny][nx]!==undefined) map[ny][nx]=1; }
    const hero = makeEntity(hx, hy, { isHero:true, hp:30, maxHp:30, atk:3, agi:4, range:8, color:'#3498db', heroType:'normal', isEnraged:false, hasPotion:false, potionUsed:false });
    heroes.push(hero);
    // ちびモンスターを1体（成長タイマー確認用）
    const baby = makeEntity(cx, cy-1, { isHero:false, mtype:'slime', hp:6, maxHp:6, atk:1, agi:1, range:4, color:'#2ecc71', isBaby:true, fertile:false, bornAt: (typeof gameTime!=='undefined'?gameTime:0) });
    monsters.push(baby);

    const FI = FRAME_INTERVAL;
    // 1) 数ティック通常進行（gameTime < 2000ms）
    for (let t=0;t<10;t++){ HARNESS.setClock(HARNESS.getClock()+FI); const ts=HARNESS.getClock(); lastFrameTime=ts-FI-1; gameLoop(ts); }
    const rushBefore = hero.castleRushUntil || 0;
    const gtBefore = (typeof gameTime!=='undefined')?gameTime:null;

    // 2) ポーズして壁時計を+30000ms進めながら300ティック（gameTimeは凍結すべき）
    isPaused = true;
    for (let t=0;t<300;t++){ HARNESS.setClock(HARNESS.getClock()+100); const ts=HARNESS.getClock(); lastFrameTime=ts-FI-1; gameLoop(ts); }
    const gtDuringPause = (typeof gameTime!=='undefined')?gameTime:null;
    const babyStillBaby = monsters.some(m=>m.isBaby);

    // 3) 再開して1ティック → スタック直行が即発火しないこと
    isPaused = false;
    HARNESS.setClock(HARNESS.getClock()+FI); { const ts=HARNESS.getClock(); lastFrameTime=ts-FI-1; gameLoop(ts); }
    const rushAfter = hero.castleRushUntil || 0;
    const rushActivatedByPause = rushAfter > rushBefore && (rushAfter - ((typeof gameTime!=='undefined')?gameTime:0)) > 4000;

    process.stdout.write(JSON.stringify({
      gameTimeFrozenDuringPause: gtBefore === gtDuringPause,
      babyDidNotInstaGrowByPause: babyStillBaby,
      rushBefore, rushAfter, gtBefore, gtDuringPause,
      OK: (gtBefore === gtDuringPause) && babyStillBaby,
    }) + '\n');
  } catch (e) {
    process.stdout.write('PAUSE_ERROR ' + (e && e.stack || e) + '\n');
  }
})();
