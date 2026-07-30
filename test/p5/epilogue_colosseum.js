// コロシアムモードの検証と、バランスの目盛り。
// 使い方: node test/p5/harness.js index.html colosseum
//
// 前半＝仕様の単体検証（盤面・wave・経済・無効化した要素）。
// 後半＝実測（wave別の勇者の物量／実際に何waveまで耐えられるか）。
// 設計の根拠は コロシアムモード_設計案.md。数値をいじったらここを見る。
(function () {
  const checks = [];
  const ok = (name, cond, info) => checks.push((cond ? '✅ ' : '❌ ') + name + (info !== undefined ? ' [' + JSON.stringify(info) + ']' : ''));
  let failed = 0;
  const expect = (name, cond, info) => { if (!cond) failed++; ok(name, cond, info); };

  // ---- 共通：コロシアムのランを開始した状態を作る ----
  function enterArena() {
    localStorage.clear();
    enterGameScreen('colosseum');
  }
  // 門から城予定地まで一直線に掘って、城を置く（＝プレイヤーの最初の手番の再現）。
  // gateIdx は colGates の添字（0=北 1=東 2=南 3=西）。dist は門から何マス内側に城を置くか。
  function digFromGateAndPlaceCastle(gateIdx, dist) {
    const g = colGates[gateIdx];
    gold = Math.max(gold, 500);
    for (let i = 1; i <= dist; i++) {
      const x = g.x + g.dx * i, y = g.y + g.dy * i;
      dig({ offsetX: x * TILE_SIZE + 1, offsetY: y * TILE_SIZE + 1 });
    }
    const cx = g.x + g.dx * dist, cy = g.y + g.dy * dist;
    isPlacingCastle = true;
    placeCastle({ offsetX: cx * TILE_SIZE + 1, offsetY: cy * TILE_SIZE + 1 });
    return { x: cx, y: cy };
  }
  // 城まで置いて「防衛が始まった状態」を作る（多くの検証はここから始まる）
  function enterArenaReady(gateIdx, dist) {
    enterArena();
    digFromGateAndPlaceCastle(gateIdx === undefined ? 0 : gateIdx, dist === undefined ? 8 : dist);
  }
  // 2点間を L 字に掘って繋げる（別の門を開通させる用）
  function digPath(x0, y0, x1, y1) {
    const stepX = Math.sign(x1 - x0), stepY = Math.sign(y1 - y0);
    for (let x = x0; x !== x1 + stepX && stepX; x += stepX) dig({ offsetX: x * TILE_SIZE + 1, offsetY: y0 * TILE_SIZE + 1 });
    for (let y = y0; y !== y1 + stepY && stepY; y += stepY) dig({ offsetX: x1 * TILE_SIZE + 1, offsetY: y * TILE_SIZE + 1 });
  }

  // ============================================================
  // 1. 盤面
  // ============================================================
  enterArena();
  expect('1a 盤面は 21×21', COLS === 21 && ROWS === 21, { COLS, ROWS });
  expect('1b 開始時は城が未配置（自分で掘って置く）', castlePos === null && isWaveStarted === false);
  expect('1c 城HPは 150', castleHp === COL_CASTLE_HP, castleHp);

  {
    let outerWall = 0, outerOpen = 0;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) {
        if (map[y][x] === 3) outerWall++; else outerOpen++;
      }
    }
    // 外周のマス数 = 4×21 − 4 = 80。うち門が4マスなので壁は76
    expect('1d 外周は門4マスを除いて破壊不能の壁(3)', outerWall === 76 && outerOpen === 4, { outerWall, outerOpen });
    expect('1e 外壁は掘れない（dig の対象タイルに3は含まれない）', !isPassable(0, 0) && map[0][0] === 3);
  }

  {
    // 内側は全部が壁＝兵の総在庫361マス。通路はプレイヤーが掘って作る（迷路づくり）
    let diggable = 0, open = 0;
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      const t = map[y][x];
      if (t === 1 || t === 2 || t === 6 || t === 7 || t === 8) diggable++;
      else if (t === 0) open++;
    }
    expect('1f 内側は全マスが壁＝361マスの在庫', diggable === 361, diggable);
    expect('1g 初期通路は無い（穴は門の4マスだけ）', open === 0, open);
  }

  {
    expect('1h 門は四辺の中央4カ所だけが穴', colGates.length === 4 && colGates.every(g => map[g.y][g.x] === 0),
      colGates.map(g => `${g.name}(${g.x},${g.y})`));
    expect('1i 城が無いうちは開通した門もゼロ', colOpenGates().length === 0);
  }

  {
    // 鉱石は中心ほど良質（設計の芯：追い詰められて中心を掘ると切り札が出る）
    const band = { inner: { copper: 0, n: 0 }, mid: { copper: 0, n: 0 }, outer: { copper: 0, n: 0 } };
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      if (map[y][x] === 0 || map[y][x] === 5) continue;
      const r = Math.max(Math.abs(x - COL_C), Math.abs(y - COL_C));
      const b = r <= 3 ? band.inner : r <= 6 ? band.mid : band.outer;
      b.n++; if (map[y][x] === 6) b.copper++;
    }
    const rate = b => b.n ? b.copper / b.n : 0;
    expect('1j 銅（ゴーレム）は中心ほど濃い', rate(band.inner) > rate(band.mid) && rate(band.mid) > rate(band.outer),
      { 内: +rate(band.inner).toFixed(2), 中: +rate(band.mid).toFixed(2), 外: +rate(band.outer).toFixed(2) });
  }

  {
    const gems = [];
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (map[y][x] === 8) gems.push({ x, y });
    const allInBand = gems.every(g => {
      const r = Math.max(Math.abs(g.x - COL_C), Math.abs(g.y - COL_C));
      return r >= 5 && r <= 8;
    });
    expect('1k 宝石鉱脈はちょうど4個', gems.length === COL_GEM_TILES, gems.length);
    expect('1l 宝石鉱脈は r5〜8 に配置される', allInBand, gems);
  }

  // ============================================================
  // 1'. 城の配置と「開通した門」＝攻め口（このモードの中心の緊張）
  // ============================================================
  {
    enterArena();
    // 掘っていない場所には置けない
    isPlacingCastle = true;
    placeCastle({ offsetX: 5 * TILE_SIZE + 1, offsetY: 5 * TILE_SIZE + 1 });
    expect("1'a 掘っていない場所には城を置けない", castlePos === null && isWaveStarted === false);

    // 北の門から6マス掘って城を置く
    const c = digFromGateAndPlaceCastle(0, 6);
    expect("1'b 門から掘り進んだ場所に城を置ける", castlePos && castlePos.x === c.x && castlePos.y === c.y, castlePos);
    expect("1'c 置いた瞬間に防衛が始まる（第1波の準備）", isWaveStarted === true && colPrepRemaining > 0,
      { isWaveStarted, prep: colPrepRemaining });
    expect("1'd 開通したのは掘った1門だけ", colOpenGates().length === 1 && colOpenGates()[0].name === '北',
      colOpenGates().map(g => g.name));
    expect("1'e 勇者はその門からしか来ない", colNextGates.every(g => g.name === '北'), colNextGates.map(g => g.name));
  }

  {
    // 掘り広げて別の門に繋がると、そこも攻め口になる（兵力と引き換えのリスク）
    enterArena();
    digFromGateAndPlaceCastle(0, 6);
    const before = colOpenGates().length;
    // 城(10,6)から東の門(20,10)の**隣**まで掘り抜く（門そのものは既に穴・外壁は掘れない）
    digPath(COL_C, 6, COLS - 2, COL_C);
    const after = colOpenGates().map(g => g.name);
    expect("1'f 掘って繋げた門が新しい攻め口になる", after.length > before && after.includes('東'),
      { before, after });
    // 次の wave の候補にも入る
    colWave = 20; colStartPrep();               // 終盤は最大4方向
    expect("1'g 開通した門が wave の候補に入る",
      colNextGates.length >= 1 && colNextGates.every(g => after.includes(g.name)),
      colNextGates.map(g => g.name));
    expect("1'h 開通していない門からは来ない",
      colNextGates.every(g => g.name !== '南' && g.name !== '西'), colNextGates.map(g => g.name));
  }

  {
    // 1門しか開けていなければ、waveが進んでも1方向のまま
    enterArena();
    digFromGateAndPlaceCastle(3, 5);            // 西の門だけ
    colWave = 30; colStartPrep();
    expect("1'i 開通が1門なら終盤でも1方向から",
      colNextGates.length === 1 && colNextGates[0].name === '西', colNextGates.map(g => g.name));
  }

  // ============================================================
  // 2. wave の構成
  // ============================================================
  expect('2a 体数カーブ 1+floor((N-1)/3)、上限8',
    colWaveHeroCount(1) === 1 && colWaveHeroCount(4) === 2 && colWaveHeroCount(7) === 3 &&
    colWaveHeroCount(22) === 8 && colWaveHeroCount(50) === 8,
    [1, 4, 7, 22, 50].map(colWaveHeroCount));
  expect('2b 門の数は 1→2→4 と開いていく',
    colWaveGateCount(6) === 1 && colWaveGateCount(7) === 2 && colWaveGateCount(15) === 2 && colWaveGateCount(16) === 4,
    [6, 7, 15, 16].map(colWaveGateCount));
  expect('2c 勇者の総合力は wave だけで決まる（設計表と一致）',
    colHeroPowerAt(10) === 33 && colHeroPowerAt(20) === 46 && colHeroPowerAt(30) === 59,
    [10, 20, 30].map(colHeroPowerAt));

  {
    // 稼ぎに連動しない（＝記録が比較可能）：ゴールドを変えても同じ wave なら同じ強さ
    enterArenaReady();
    gold = 10; colNextInfo = { wave: 12, n: 1, boss: false }; colNextGates = [colGates[0]];
    colSpawnWave();
    const poor = heroes[heroes.length - 1];
    const poorStat = { atk: poor.atk, agi: poor.agi, hp: poor.maxHp };
    enterArenaReady();
    gold = 99999; colNextInfo = { wave: 12, n: 1, boss: false }; colNextGates = [colGates[0]];
    colSpawnWave();
    const rich = heroes[heroes.length - 1];
    const richStat = { atk: rich.atk, agi: rich.agi, hp: rich.maxHp };
    // 振り分けは乱数なので合計で比較する
    const sum = s => s.atk + s.agi + Math.round(s.hp / HERO_HP_MULT);
    expect('2d 勇者の強さがプレイヤーの富に連動しない（hardの富スケールは無効）',
      sum(poorStat) === sum(richStat), { poorStat, richStat });
  }

  {
    // ボスは10の倍数waveの1体だけ
    enterArenaReady();
    colNextInfo = { wave: 10, n: 4, boss: true }; colNextGates = [colGates[0]];
    colSpawnWave();
    const bosses = heroes.filter(h => h.isEnraged).length;
    expect('2e ボスwaveでも怒り勇者は1体だけ', bosses === 1 && heroes.length === 4, { bosses, n: heroes.length });
    expect('2f 同waveの勇者は全員 Lv = wave', heroLevel === 10, heroLevel);
  }

  {
    // 同じ門に複数体でも重ならないよう通路方向へずれる
    enterArenaReady();
    colNextInfo = { wave: 13, n: 5, boss: false }; colNextGates = [colGates[0]];
    colSpawnWave();
    const pos = heroes.map(h => `${h.x},${h.y}`);
    expect('2g 同じ門の複数体は通路に沿ってずれる', new Set(pos).size >= 4, pos);
    expect('2h 湧いた位置はすべて通行可能', heroes.every(h => isPassable(h.x, h.y)), pos);
  }

  // ============================================================
  // 3. 経済
  // ============================================================
  {
    enterArenaReady();
    expect('3a 実レベルは Lv1 スタート（記録の公平性）',
      monsterLevels.slime === 1 && monsterLevels.goblin === 1 && monsterLevels.golem === 1, Object.assign({}, monsterLevels));
    expect('3b レベル上限（💎解放ぶん）は反映される', monsterCap.slime === MONSTER_CAP_INIT, monsterCap.slime);
    expect('3c レバレッジは無効', leverage.active === false && leverage.mult === 1, leverage);
  }

  {
    // 討伐報酬 = 15 + wave（倍率補正なし）
    enterArenaReady();
    monsterLevels.golem = 60;                       // 一撃で倒せるようにする
    colNextInfo = { wave: 7, n: 1, boss: false }; colNextGates = [colGates[0]];
    colSpawnWave();
    const h = heroes[0];
    h.hp = 1;
    const g0 = gold;
    const e = effStat('golem');
    const m = makeEntity(h.x, h.y + (h.y === 0 ? 1 : -1), { hp: e.hp, maxHp: e.hp, atk: 9999, agi: e.agi,
      range: e.range, atkRange: 1, isHero: false, mtype: 'golem', color: '#fff' });
    m.acd = ACTION_THRESHOLD * 2; m.cd = 0;
    monsters.push(m);
    updateEntity(m, heroes, ACTION_THRESHOLD);
    expect('3d 討伐報酬は 15 + wave', gold - g0 === 15 + 7, { gained: gold - g0, wave: colWave });
    expect('3e 討伐でダイヤは出ない（記録更新でのみ支給）', totalEarnedDiamond === 0, totalEarnedDiamond);
  }

  {
    // 城の修復と wave 突破時の自然回復
    enterArenaReady();
    castleHp = 50; gold = COL_REPAIR_COST;
    heroes.length = 0;
    colPrepRemaining = COL_PREP_SEC;
    colRepairCastle();
    expect('3f 100Gで全回復できる', castleHp === COL_CASTLE_HP && gold === 0, { castleHp, gold });
    castleHp = 50; gold = COL_REPAIR_COST;
    colNextInfo = { wave: 3, n: 1, boss: false }; colNextGates = [colGates[0]];
    colSpawnWave();
    colRepairCastle();
    expect('3g 勇者がいる間は修復できない', castleHp === 50 && gold === COL_REPAIR_COST, { castleHp, gold });
    heroes.length = 0;
    const before = castleHp;
    colOnWaveCleared();
    expect('3h wave突破で城が +20 回復', castleHp === before + COL_CASTLE_HEAL, { before, after: castleHp });
  }

  {
    // 早出しボーナス
    enterArenaReady();
    const g0 = gold;
    colPrepRemaining = 6; colNextInfo = { wave: 1, n: 1, boss: false }; colNextGates = [colGates[0]];
    colSkipPrep();
    expect('3i 早出しは 残り秒×5G のボーナス', gold - g0 === 30, { gained: gold - g0 });
    expect('3j 早出しで即座に wave が始まる', colWave === 1 && heroes.length === 1, { colWave, n: heroes.length });
  }

  // ============================================================
  // 4. 精算（ゴールドは銀行に入らない／💎は記録の差分のみ）
  // ============================================================
  {
    localStorage.clear();
    saveCarryOver(500);
    enterGameScreen('colosseum');
    gold = 4000; colWave = 12; diamond = 0; totalEarnedDiamond = 0;
    triggerGameOver();
    expect('4a コロシアムのゴールドは銀行に入らない', loadCarryOver() === 500, loadCarryOver());
    expect('4b 最高記録が保存される', loadColBest() === 12, loadColBest());
    expect('4c 💎は floor(wave/5) 個（wave12→2個）', totalEarnedDiamond === 2, totalEarnedDiamond);
    expect('4d 実レベルは保存されない（Lv1スタートを壊さない）',
      loadMonsterLevels().golem === 1, loadMonsterLevels().golem);

    // 2周目：記録を更新しなければ💎は増えない
    enterGameScreen('colosseum');
    colWave = 9; totalEarnedDiamond = 0;
    triggerGameOver();
    expect('4e 記録を更新しなければ💎は増えない', totalEarnedDiamond === 0, totalEarnedDiamond);
    expect('4f 記録は下がらない', loadColBest() === 12, loadColBest());

    // 3周目：記録更新なら差分だけ
    enterGameScreen('colosseum');
    colWave = 21; totalEarnedDiamond = 0;
    triggerGameOver();
    expect('4g 記録更新は差分だけ支給（12→21 で floor(21/5)-floor(12/5)=2）', totalEarnedDiamond === 2, totalEarnedDiamond);
  }

  // ============================================================
  // 5. 兵站（掘削と繁殖）
  // ============================================================
  {
    enterArenaReady();
    gold = 500;
    // 城の斜め＝繁殖枠を掘る。dig() は実際のUI経路（隣接制約・ゴールド消費込み）で呼ぶ
    const digAt = (x, y) => dig({ offsetX: x * TILE_SIZE + 1, offsetY: y * TILE_SIZE + 1 });
    // 城の周りを広げていく（隣接制約があるので内側から。標本を稼ぐため広めに）
    let fertile = 0, spawned = 0;
    for (let r = 1; r <= 6; r++)
      for (let y = castlePos.y - r; y <= castlePos.y + r; y++)
        for (let x = castlePos.x - r; x <= castlePos.x + r; x++) {
          if (x < 1 || y < 1 || x >= COLS - 1 || y >= ROWS - 1) continue;
          if (Math.max(Math.abs(x - castlePos.x), Math.abs(y - castlePos.y)) !== r) continue;
          const before = monsters.length;
          digAt(x, y);
          if (monsters.length > before) { spawned++; if (monsters[monsters.length - 1].fertile) fertile++; }
        }
    // コロシアムでは掘削で fertile を付けない（fertile は城に張り付いて指令に従わないので、
    // 繁殖に必要な2体は勇者の登場時だけが補充する）
    expect('5a 掘削では fertile を付けない（指令に従える兵として湧く）',
      spawned > 40 && fertile === 0, { spawned, fertile });
  }

  {
    // 【回帰テスト】繁殖は掘削の枠を食わない。
    // 共通枠にしていたときは、繁殖が毎フレーム自動判定されるぶん戦闘で空いた枠を先に埋めてしまい、
    // 全waveで兵が上限に張り付いて「掘っても兵が湧かない」＝このモードの芯が死んでいた。
    enterArenaReady();
    gold = 100000;
    const digAt = (x, y) => dig({ offsetX: x * TILE_SIZE + 1, offsetY: y * TILE_SIZE + 1 });
    // 繁殖枠を埋め切る：城の周囲を掘って fertile を確保し、勇者を何度も湧かせて繁殖させる
    for (let pass = 0; pass < 3; pass++)
      for (let r = 1; r <= 2; r++)
        for (let y = COL_C - r; y <= COL_C + r; y++)
          for (let x = COL_C - r; x <= COL_C + r; x++) {
            if (Math.max(Math.abs(x - COL_C), Math.abs(y - COL_C)) !== r) continue;
            digAt(x, y);
          }
    const FI = FRAME_INTERVAL;
    for (let k = 0; k < 12; k++) {
      colNextInfo = { wave: 1, n: 1, boss: false }; colNextGates = [colGates[0]];
      colSpawnWave();
      heroes.length = 0;                                  // 戦闘は起こさせない（繁殖だけ回す）
      for (let t = 0; t < 200; t++) {
        HARNESS.setClock(HARNESS.getClock() + FI);
        lastFrameTime = HARNESS.getClock() - FI - 1;
        gameLoop(HARNESS.getClock());
      }
    }
    const bred = monsters.filter(m => m.fromBreed && m.hp > 0).length;
    expect('5b 繁殖は専用枠で頭打ちになる', bred <= COL_BREED_POP, { bred, cap: COL_BREED_POP });
    expect('5c 繁殖が埋まっても掘削の枠は残っている（掘る楽しさの担保）',
      monsters.length < COL_ARMY_CAP, { 兵: monsters.length, cap: COL_ARMY_CAP });
    // 実際に掘れることを確かめる（枠が残っている ＝ 掘れば兵が増える）
    const before = monsters.length;
    let dug = 0;
    for (let r = 3; r <= 5 && dug < 10; r++)
      for (let y = COL_C - r; y <= COL_C + r && dug < 10; y++)
        for (let x = COL_C - r; x <= COL_C + r && dug < 10; x++) {
          if (Math.max(Math.abs(x - COL_C), Math.abs(y - COL_C)) !== r) continue;
          const n0 = monsters.length; digAt(x, y);
          if (monsters.length > n0) dug++;
        }
    expect('5d 繁殖が満杯でも掘れば兵が増える', monsters.length > before && dug >= 5,
      { before, after: monsters.length, dug });
  }

  {
    // 指令が無ければカオスにランダムウォーク（城へは吸い寄せられない）。
    // ※ 以前は「コロシアムでは全個体が城へ集まる」実装だったが、それでは迷路の途中で
    //   迎撃せず、掘った通路の形に意味が無くなるので廃止した（指令機能で置き換え）。
    enterArenaReady(0, 8);                    // 北の門(10,0)から掘って城は(10,8)
    gold = 500;
    // 通路を横に広げて、うろつく余地を作る
    for (let y = 2; y <= 6; y++) for (let dx of [-1, 1])
      dig({ offsetX: (COL_C + dx) * TILE_SIZE + 1, offsetY: y * TILE_SIZE + 1 });
    const e = effStat('slime');
    const far = makeEntity(COL_C, 2, { hp: e.hp, maxHp: e.hp, atk: e.atk, agi: 30,
      range: 1, atkRange: 1, isHero: false, mtype: 'slime', color: '#fff', fertile: false });
    monsters.length = 0; monsters.push(far);
    heroes.length = 0;
    const atCastle = () => Math.max(Math.abs(far.x - castlePos.x), Math.abs(far.y - castlePos.y)) <= 1;
    let visited = new Set(), stuckAtCastle = 0;
    for (let i = 0; i < 600; i++) {
      updateEntity(far, heroes, ACTION_THRESHOLD);
      visited.add(`${far.x},${far.y}`);
      if (atCastle()) stuckAtCastle++;
    }
    expect('5e 指令が無ければランダムに動き回る（城に吸い寄せられない）',
      visited.size >= 4 && stuckAtCastle < 500, { 訪れたマス: visited.size, 城の隣にいたtick: stuckAtCastle });
  }

  {
    // ===== 指令（種別ごとの集合地点） =====
    // 指令が無い種はランダムウォーク、指令を出した種は指定地点の3×3で待機する。
    // 迷路の要所に兵を張れるかどうかが、このモードの「迷路を作る楽しさ」の要。
    enterArenaReady(0, 10);                   // 北の門(10,0)から掘って城は(10,10)
    gold = 500;
    expect('5g 指令は最初は空（＝ランダムウォーク）', Object.keys(colRally).length === 0 && colRallyOf('slime') === null);

    // 通路の途中(10,3)を集合地点に指令する
    colToggleRallyMode('slime');
    expect('5h 🚩で指令モードに入る', colRallyMode === 'slime', colRallyMode);
    const handled = colHandleRallyClick({ offsetX: COL_C * TILE_SIZE + 1, offsetY: 3 * TILE_SIZE + 1 });
    expect('5i 指令モード中のクリックは掘削にならない', handled === true);
    expect('5j 集合地点が設定される', colRally.slime && colRally.slime.x === COL_C && colRally.slime.y === 3, colRally.slime);
    expect('5k 設定したら指令モードは抜ける', colRallyMode === null);

    // 城の隣に置いたスライムが、指令地点まで歩いて行く
    const e = effStat('slime');
    const s = makeEntity(COL_C, COL_C - 1, { hp: e.hp, maxHp: e.hp, atk: e.atk, agi: 30,
      range: 1, atkRange: 1, isHero: false, mtype: 'slime', color: '#fff', fertile: false });
    monsters.length = 0; monsters.push(s);
    heroes.length = 0;
    const d0 = Math.abs(s.y - 3);
    for (let i = 0; i < 400; i++) updateEntity(s, heroes, ACTION_THRESHOLD);
    const d1 = Math.max(Math.abs(s.x - COL_C), Math.abs(s.y - 3));
    expect('5l 指令した種は集合地点へ向かい3×3で待機する', d1 <= 1, { 城からの距離: d0, 指令地点までの距離: d1, pos: `${s.x},${s.y}` });

    // fertile な個体は繁殖のため城を優先する（繁殖条件が城の3×3なので）
    s.fertile = true;
    s.x = COL_C; s.y = 3;
    for (let i = 0; i < 400; i++) updateEntity(s, heroes, ACTION_THRESHOLD);
    const dc = Math.max(Math.abs(s.x - castlePos.x), Math.abs(s.y - castlePos.y));
    expect('5m fertile な個体は指令より繁殖（城）を優先する', dc <= 1, { 城までの距離: dc, pos: `${s.x},${s.y}` });

    // 同じ場所をもう一度クリック → 解除
    s.fertile = false;
    colToggleRallyMode('slime');
    colHandleRallyClick({ offsetX: COL_C * TILE_SIZE + 1, offsetY: 3 * TILE_SIZE + 1 });
    expect('5n 同じ場所をもう一度クリックで解除', !colRally.slime && colRallyOf('slime') === null);

    // 掘っていない場所には置けない
    colToggleRallyMode('golem');
    colHandleRallyClick({ offsetX: 2 * TILE_SIZE + 1, offsetY: 2 * TILE_SIZE + 1 });
    expect('5o 掘っていない場所には指令できない', !colRally.golem && colRallyMode === 'golem', colRally.golem || null);
    colRallyMode = null;

    // 【回帰テスト】勇者が湧いても fertile は各種2体までしか増えない。
    // これが無いと、勇者の登場ごとに最大6体ぶん付与され、fertile は繁殖しないと消えないので
    // 城に張り付く個体が際限なく増え、途中から「指令にもランダムウォークにも従わない」状態になる。
    enterArenaReady(0, 10);
    gold = 2000;
    for (let r = 1; r <= 3; r++)                       // 城の周りを掘って兵を出す
      for (let y = castlePos.y - r; y <= castlePos.y + r; y++)
        for (let x = castlePos.x - r; x <= castlePos.x + r; x++) {
          if (Math.max(Math.abs(x - castlePos.x), Math.abs(y - castlePos.y)) !== r) continue;
          dig({ offsetX: x * TILE_SIZE + 1, offsetY: y * TILE_SIZE + 1 });
        }
    const fertileCount = () => {
      const c = {};
      for (const mt of ALL_MTYPES) c[mt] = monsters.filter(m => m.mtype === mt && !m.isBaby && m.fertile && m.hp > 0).length;
      return c;
    };
    for (let k = 0; k < 20; k++) {                     // 勇者を20体ぶん湧かせる（＝最大120体ぶんの付与機会）
      colNextInfo = { wave: 1, n: 1, boss: false }; colNextGates = [colGates[0]];
      colSpawnWave();
      heroes.length = 0;                               // 戦闘も繁殖も起こさない（付与だけを見る）
    }
    const fc = fertileCount();
    expect('5q 勇者が何度湧いても fertile は各種2体まで',
      ALL_MTYPES.every(mt => fc[mt] <= 2), fc);
    expect('5r 指令に従える個体（fertileでない成体）が残っている',
      monsters.filter(m => !m.isBaby && !m.fertile && m.hp > 0).length > 10,
      monsters.filter(m => !m.isBaby && !m.fertile && m.hp > 0).length);

    // standard では指令は効かない（コロシアム限定の機能）
    localStorage.clear();
    enterGameScreen('standard');
    colRally = { slime: { x: 5, y: 5 } };
    expect('5p standard では指令は無効', colRallyOf('slime') === null);
    colRally = {};
  }

  {
    // 繁殖は消費型：勇者の出現が fertile を再供給する（＝繁殖レートが勇者の数に連動する）
    enterArenaReady();
    const e = effStat('slime');
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const m = makeEntity(COL_C + dx, COL_C + dy, { hp: e.hp, maxHp: e.hp, atk: e.atk, agi: e.agi,
        range: e.range, atkRange: 1, isHero: false, mtype: 'slime', color: '#fff', fertile: false, isBaby: false });
      monsters.push(m);
    }
    const before = monsters.filter(m => m.fertile).length;
    colNextInfo = { wave: 1, n: 1, boss: false }; colNextGates = [colGates[0]];
    colSpawnWave();
    const after = monsters.filter(m => m.fertile).length;
    expect('5f 勇者の出現が fertile を再供給する', after > before, { before, after });
  }

  // ============================================================
  // 6. 他モードを壊していないこと
  // ============================================================
  {
    localStorage.clear();
    enterGameScreen('standard');
    expect('6a standard は 20列に戻る', COLS === BASE_COLS && ROWS === INITIAL_ROWS, { COLS, ROWS });
    expect('6b standard の城HPは 40 のまま', castleMaxHp() === CASTLE_MAX_HP, castleMaxHp());
    expect('6c standard は城を自分で置く（開始時は未配置）', castlePos === null && isWaveStarted === false);
    expect('6d standard の空判定は SKY_LAYERS のまま', skyLimit() === SKY_LAYERS, skyLimit());
    enterGameScreen('colosseum');
    expect('6e コロシアムに空は無い', skyLimit() === 0, skyLimit());
  }

  // ============================================================
  // 7. 実測：wave別の物量（設計表の裏取り）
  // ============================================================
  const waveTable = [];
  for (const w of [1, 5, 10, 15, 20, 25, 30, 40, 50]) {
    enterArenaReady();
    colWave = w - 1; colStartPrep();               // 本番と同じ経路（開通した門から候補を決める）
    colSpawnWave();
    const alive = heroes.filter(h => h.hp > 0);
    const rate = a => (1000 / FRAME_INTERVAL) * atkUnits(a) / ACTION_THRESHOLD;
    const totalHp = alive.reduce((s, h) => s + h.maxHp, 0);
    const totalDps = alive.reduce((s, h) => s + h.atk * rate(h.agi), 0);
    waveTable.push({
      wave: w, 体数: alive.length, 門: colWaveGateCount(w), 開通門: colOpenGates().length,
      '1体のHP': Math.round(totalHp / alive.length),
      '総HP': totalHp, '総DPS': Math.round(totalDps),
    });
  }

  // モンスター側の目盛り（Lv別・24体想定）
  const defTable = [];
  for (const lv of [1, 5, 10, 15, 20, 30, 50]) {
    monsterLevels.golem = Math.min(lv, MAX_LEVEL);
    const s = mstatsAt('golem', monsterLevels.golem);
    const rate = (1000 / FRAME_INTERVAL) * atkUnits(s.agi) / ACTION_THRESHOLD;
    defTable.push({ 'ゴーレムLv': lv, atk: s.atk, HP: s.hp, DPS: Math.round(s.atk * rate * 10) / 10,
      '24体の総DPS': Math.round(s.atk * rate * 24), '24体の総HP': s.hp * 24 });
  }

  // ============================================================
  // 8. 実測：実際に何wave耐えられるか（掘って戦う）
  // ============================================================
  function runArena(label, opts) {
    const o = Object.assign({ monLv: 10, digR: 4, maxWave: 60, fast: false, openAll: false, rally: 'none' }, opts);
    // openAll=false: 北の門から掘って城を(10,8)＝1門だけ開通した「守りやすいが在庫が遠い」形
    // openAll=true : 城を中央(10,10)に置き、四方へ通路を掘って全門を開通させた「兵は取りやすいが四方から来る」形
    enterArenaReady(0, o.openAll ? COL_C : 8);
    isFastMode = !!o.fast;
    gold = 100000;                                   // 掘削コストは検証の対象外なので潤沢にする
    for (const mt of ALL_MTYPES) monsterLevels[mt] = Math.min(o.monLv, monsterCap[mt]);
    if (o.openAll) {
      for (const g of colGates) {                    // 城から各門へ一直線に掘り抜く
        for (let i = 1; i < COL_C; i++) {
          const x = COL_C + (g.x - COL_C ? Math.sign(g.x - COL_C) * i : 0);
          const y = COL_C + (g.y - COL_C ? Math.sign(g.y - COL_C) * i : 0);
          dig({ offsetX: x * TILE_SIZE + 1, offsetY: y * TILE_SIZE + 1 });
        }
      }
    }
    // 城の周囲 digR マスを掘る（＝壁を兵に換える）。隣接制約があるので内側から数パス回す
    const cx = castlePos.x, cy = castlePos.y;
    for (let pass = 0; pass < 3; pass++) {
      for (let r = 1; r <= o.digR; r++) {
        for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
          if (x < 1 || y < 1 || x >= COLS - 1 || y >= ROWS - 1) continue;
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
          dig({ offsetX: x * TILE_SIZE + 1, offsetY: y * TILE_SIZE + 1 });
        }
      }
    }
    const army0 = monsters.length;
    const gates0 = colOpenGates().length;            // 掘った結果いくつの門が開通したか
    // 指令（集合地点）。'none'=指令なし（ランダムウォーク）／'castle'=全種を城へ／
    // 'gate'=開通門ごとに城との中間点へ種を割り振る（迷路の要所で迎撃する形）
    colRally = {};
    if (o.rally === 'castle') {
      for (const mt of ALL_MTYPES) colRally[mt] = { x: castlePos.x, y: castlePos.y };
    } else if (o.rally === 'gate') {
      const open = colOpenGates();
      ALL_MTYPES.forEach((mt, i) => {
        const g = open[i % open.length];
        const mx = Math.round((castlePos.x + g.x) / 2), my = Math.round((castlePos.y + g.y) / 2);
        colRally[mt] = isPassable(mx, my) ? { x: mx, y: my } : { x: castlePos.x, y: castlePos.y };
      });
    }
    const FI = o.fast ? 1000 / 60 : FRAME_INTERVAL;
    const step = (frames) => {
      for (let t = 0; t < frames; t++) {
        HARNESS.setClock(HARNESS.getClock() + FI);
        const ts = HARNESS.getClock();
        lastFrameTime = ts - FI - 1;
        gameLoop(ts);
        if (castleHp <= 0) return false;
      }
      return true;
    };
    let reached = 0, peakMonsters = army0;
    for (let w = 1; w <= o.maxWave; w++) {
      colWave = w - 1; colStartPrep();               // 本番と同じ経路（開通した門からのみ）
      colSpawnWave();
      // 1waveあたり最大90秒。全滅させられなければ時間切れとして扱う
      const maxFrames = Math.round(90 * 1000 / FI);
      let cleared = false;
      for (let t = 0; t < maxFrames; t += 30) {
        if (!step(30)) break;
        peakMonsters = Math.max(peakMonsters, monsters.filter(m => m.hp > 0).length);
        if (!heroes.some(h => h.hp > 0)) { cleared = true; break; }
      }
      if (castleHp <= 0) break;
      if (!cleared) break;
      reached = w;
      if (!step(Math.round(COL_PREP_SEC * 1000 / FI))) break;   // 準備時間（繁殖が回る）
    }
    return {
      label, 'モンスターLv': o.monLv, '掘った範囲(r)': o.digR, '初期兵力': army0,
      '開通した門': gates0, '指令': o.rally,
      '到達wave': reached, '同時最大モンスター': peakMonsters,
      '討伐数': defeatedHeroesCount,
      '結果': castleHp <= 0 ? '城陥落' : (reached >= o.maxWave ? `${o.maxWave}wave完走` : '時間切れ'),
      '繁殖の総数': sessionBreeds,
      '城HP': Math.max(0, castleHp) + '/' + COL_CASTLE_HP,
    };
  }

  const runs = [];
  runs.push(runArena('Lv1・1門・周り4マス（素手）', { monLv: 1, digR: 4, maxWave: 25 }));
  runs.push(runArena('Lv10・1門・周り4マス', { monLv: 10, digR: 4, maxWave: 60 }));
  runs.push(runArena('Lv20・1門・周り4マス（💎ゼロの天井）', { monLv: 20, digR: 4, maxWave: 60 }));
  runs.push(runArena('Lv20・1門・周り6マス（掘り広げた）', { monLv: 20, digR: 6, maxWave: 60 }));
  // 四方すべてを開通させた形：兵は取りやすいが、攻め口が4つになる（このモードの中心のトレードオフ）
  runs.push(runArena('Lv20・4門・周り4マス', { monLv: 20, digR: 4, maxWave: 60, openAll: true }));
  runs.push(runArena('Lv20・4門・周り6マス', { monLv: 20, digR: 6, maxWave: 60, openAll: true }));
  // 指令の効果：同じ条件で「指令なし／全種を城へ／門との中間点に張る」を比べる
  runs.push(runArena('Lv20・1門・r4・指令=城', { monLv: 20, digR: 4, maxWave: 60, rally: 'castle' }));
  runs.push(runArena('Lv20・1門・r4・指令=門との中間', { monLv: 20, digR: 4, maxWave: 60, rally: 'gate' }));
  runs.push(runArena('Lv20・4門・r4・指令=城', { monLv: 20, digR: 4, maxWave: 60, openAll: true, rally: 'castle' }));
  runs.push(runArena('Lv20・4門・r4・指令=門との中間', { monLv: 20, digR: 4, maxWave: 60, openAll: true, rally: 'gate' }));

  process.stdout.write(JSON.stringify({
    failed,
    checks,
    '勇者の物量（wave別）': waveTable,
    '防衛側の目盛り（ゴーレム）': defTable,
    '実走：何wave耐えられるか': runs,
  }, null, 1) + '\n');
})();
