// P5 パフォーマンス確認：浅いマップ vs 深いマップで経路探索コストが同オーダーか。
// getNextStepTowardsCastle（フローフィールド）と getNextStepTowards（ホライズン）を計測。
(function () {
  const realNow = HARNESS.realNow;
  function buildOpenMap(rows) {
    ROWS = rows;
    map = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < COLS; x++) {
        if (y < SKY_LAYERS) row.push(4);
        else row.push(0); // 全掘削済み（最悪ケース：BFSが広く展開しうる）
      }
      map.push(row);
    }
    const cx = ENTRANCE_X, cy = rows - 2;
    map[cy][cx] = 5; castlePos = { x: cx, y: cy };
    if (typeof __p5_bumpTerrain === 'function') __p5_bumpTerrain();
  }

  function measure(rows, iters) {
    buildOpenMap(rows);
    // 城直行（フローフィールド）：浅部の勇者が遠い城を目指す最悪ケース
    const eCastle = { x: ENTRANCE_X, y: SKY_LAYERS, isHero: true, range: 8 };
    // 追跡（ホライズン）：range4モンスターが射程内の近い敵を追う（典型ケース）
    const eChase = { x: 5, y: rows - 5, isHero: false, range: 4 };
    const tx = 8, ty = rows - 5;

    // ウォームアップ（フローフィールド初回構築を計測外に）
    getNextStepTowardsCastle(eCastle);
    getNextStepTowards(eChase, tx, ty, true);

    let t0 = realNow();
    for (let i = 0; i < iters; i++) getNextStepTowardsCastle(eCastle);
    const tCastle = realNow() - t0;

    t0 = realNow();
    for (let i = 0; i < iters; i++) getNextStepTowards(eChase, tx, ty, true);
    const tChase = realNow() - t0;

    return { rows, castleMs: +tCastle.toFixed(2), chaseMs: +tChase.toFixed(2) };
  }

  const ITER = 200000;
  const shallow = measure(25, ITER);
  const deep = measure(250, ITER);
  process.stdout.write(JSON.stringify({
    iters: ITER,
    shallow, deep,
    castleRatio: +(deep.castleMs / shallow.castleMs).toFixed(2),
    chaseRatio: +(deep.chaseMs / shallow.chaseMs).toFixed(2),
    note: 'ratioが1付近＝深度非依存',
  }) + '\n');
})();
