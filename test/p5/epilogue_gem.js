// 宝石鉱脈(8)ポップ率の実測。深度ごとに generateRow を多数回まわし出現率を測る。
(function () {
  function rate(depthTarget, mode) {
    gameMode = mode;
    if (typeof shopData === 'object') shopData.wraith = false; // 闇水晶を混ぜない
    maxDepth = 0;                     // levTreasureFactor=1（宝石鉱脈には無関係だが念のため）
    const y = SKY_LAYERS + 1 + depthTarget;
    const N = 200000;
    let gems = 0, cells = 0;
    for (let i = 0; i < N / 20; i++) {   // generateRow は COLS(=20) セル生成
      const row = generateRow(y);
      for (const t of row) { cells++; if (t === 8) gems++; }
    }
    return +(gems / cells * 100).toFixed(3); // %
  }
  const out = {
    std_d100: rate(100, 'standard'),
    std_d500: rate(500, 'standard'),
    std_d1000: rate(1000, 'standard'),
    hard_d1000: rate(1000, 'hard'),
    std_d2000_cap: rate(2000, 'standard'), // 1000超は頭打ち0.5%
  };
  process.stdout.write(JSON.stringify(out) + '\n');
})();
