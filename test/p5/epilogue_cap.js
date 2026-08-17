// レベル上限（cap）システムの動作確認。
// 期待値は MONSTER_CAP_INIT / DIAMOND_CAP_STEP から導く（数値を直書きしない）。
// 直書きしていたせいで、初期上限 5→20・1💎あたり +1→+5 に変えたときにこのテストだけ取り残された。
(function () {
  const out = {};
  try {
    out.capInit = MONSTER_CAP_INIT;
    out.capStep = DIAMOND_CAP_STEP;

    // 1) 何も保存していない状態の初期上限は MONSTER_CAP_INIT（ハイブリッドを含む全種）
    localStorage.removeItem('magika_monstercaps');
    localStorage.removeItem('magika_monsterlevels');
    const fresh = loadMonsterCaps();
    out.freshCapsAllInit = ALL_MTYPES.every(mt => fresh[mt] === MONSTER_CAP_INIT);

    // 2) ゴールドで上限を超えて上げられない
    Object.assign(monsterCap, loadMonsterCaps());
    monsterLevels.slime = MONSTER_CAP_INIT; monsterCap.slime = MONSTER_CAP_INIT;
    gold = 999999;
    levelUp('slime');
    out.goldBlockedAtCap = (monsterLevels.slime === MONSTER_CAP_INIT);

    // 3) ダイヤ1個で上限 +DIAMOND_CAP_STEP（引継ぎダイヤ=非live）
    saveCarryDiamond(3);
    raiseCapDiamond('slime', false);
    out.capAfterDiamond = loadMonsterCaps().slime;      // MONSTER_CAP_INIT + DIAMOND_CAP_STEP
    out.diamondSpent = (loadCarryDiamond() === 2);

    // 4) 上限が上がったぶんゴールドでさらに1レベル上げられる
    Object.assign(monsterCap, loadMonsterCaps());
    gold = 999999;
    levelUp('slime');
    out.goldLevelAfterCapRaise = monsterLevels.slime;   // MONSTER_CAP_INIT + 1

    // 5) 旧セーブ救済：レベルが上限より高ければ上限を引き上げ
    const high = MAX_LEVEL - 10;
    localStorage.setItem('magika_monsterlevels', JSON.stringify({slime:high, goblin:1, golem:1, wraith:1}));
    localStorage.removeItem('magika_monstercaps');
    out.migratedCapSlime = loadMonsterCaps().slime;     // high を期待

    out.OK = out.freshCapsAllInit && out.goldBlockedAtCap &&
             out.capAfterDiamond === MONSTER_CAP_INIT + DIAMOND_CAP_STEP &&
             out.diamondSpent &&
             out.goldLevelAfterCapRaise === MONSTER_CAP_INIT + 1 &&
             out.migratedCapSlime === high;
  } catch (e) { out.error = String(e && e.stack || e); }
  process.stdout.write(JSON.stringify(out) + '\n');
})();
