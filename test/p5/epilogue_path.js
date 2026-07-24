// 経路探索オラクル：多数のランダムマップ×全開始セルで一手を収集しJSON出力。
// baseline版と最適化版で完全一致すれば保存則1（軌道一致）の中核が担保される。
(function () {
  // マップ生成専用の決定的RNG（Math.randomとは独立）
  let s = 987654321 >>> 0;
  const rnd = () => { s = (Math.imul(1103515245, s) + 12345) >>> 0; return s / 2 ** 32; };

  const results = [];
  const NUM_MAPS = 40;
  const H = 24; // 生成マップ高さ（SKY_LAYERS=2含む）

  function genMap(density) {
    ROWS = H;
    const mm = [];
    for (let y = 0; y < ROWS; y++) {
      const row = [];
      for (let x = 0; x < COLS; x++) {
        if (y < SKY_LAYERS) { row.push(4); continue; } // 空
        // 入口列は掘れた通路にして地上と地下を接続
        if (x === ENTRANCE_X && y <= SKY_LAYERS) { row.push(0); continue; }
        row.push(rnd() < density ? 0 : 1);
      }
      mm.push(row);
    }
    return mm;
  }

  const fakeEntity = (x, y) => ({ x, y, isHero: true, range: 8 });

  for (let mi = 0; mi < NUM_MAPS; mi++) {
    const density = 0.35 + 0.4 * rnd(); // 0.35〜0.75
    map = genMap(density);
    // 城を地下のランダムな通行可セルに置く（なければ強制的に開ける）
    let cx, cy, tries = 0;
    do {
      cx = Math.floor(rnd() * COLS);
      cy = SKY_LAYERS + Math.floor(rnd() * (ROWS - SKY_LAYERS));
      tries++;
    } while (map[cy][cx] === 1 && tries < 50);
    map[cy][cx] = 5;
    castlePos = { x: cx, y: cy };
    if (typeof __p5_bumpTerrain === 'function') __p5_bumpTerrain(); // マップ差し替え通知

    // 追跡ターゲット（別の通行可セル）
    let tx, ty, t2 = 0;
    do { tx = Math.floor(rnd()*COLS); ty = SKY_LAYERS + Math.floor(rnd()*(ROWS-SKY_LAYERS)); t2++; }
    while ((!isPassable(tx,ty) || (tx===cx&&ty===cy)) && t2 < 80);

    // 地形変更（掘削）を模擬：数セルを通行可に変えて再テスト（P5-2 dirty検証用）
    for (let round = 0; round < 2; round++) {
      if (round === 1) {
        // 掘削シミュレーション：ランダムに10セルを0へ。最適化版は無効化フックを呼ぶ
        for (let k = 0; k < 10; k++) {
          const dx = Math.floor(rnd()*COLS), dy = SKY_LAYERS + Math.floor(rnd()*(ROWS-SKY_LAYERS));
          if (map[dy][dx] === 1) map[dy][dx] = 0;
        }
        if (typeof __p5_bumpTerrain === 'function') __p5_bumpTerrain();
      }
      for (let y = SKY_LAYERS; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (!isPassable(x, y)) continue;
          const e = fakeEntity(x, y);
          const a = getNextStepTowardsCastle(e);
          const b = getNextStepTowards(fakeEntity(x, y), tx, ty, false);
          const c = getNextStepTowards(fakeEntity(x, y), tx, ty, true);
          results.push(
            (a ? a.x + ',' + a.y : 'N') + '|' +
            (b ? b.x + ',' + b.y : 'N') + '|' +
            (c ? c.x + ',' + c.y : 'N')
          );
        }
      }
    }
  }

  // FNVハッシュで要約 + 件数
  let h = 2166136261 >>> 0;
  const joined = results.join(';');
  for (let i = 0; i < joined.length; i++) { h ^= joined.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  process.stdout.write(JSON.stringify({ count: results.length, hash: h.toString(16), sample: results.slice(0, 6) }) + '\n');
})();
