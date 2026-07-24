// レベル上限（cap）システムの動作確認。
(function () {
  const out = {};
  try {
    // 1) 何も保存していない状態の初期上限は5
    localStorage.removeItem('magika_monstercaps');
    localStorage.removeItem('magika_monsterlevels');
    const fresh = loadMonsterCaps();
    out.freshCapsAll5 = ['slime','goblin','golem','wraith'].every(mt => fresh[mt] === 5);

    // 2) ゴールドで上限を超えて上げられない
    Object.assign(monsterCap, loadMonsterCaps());
    monsterLevels.slime = 5; monsterCap.slime = 5;
    gold = 999999;
    if (typeof msgDiv === 'undefined') { /* stub側で存在 */ }
    levelUp('slime');
    out.goldBlockedAtCap = (monsterLevels.slime === 5);

    // 3) ダイヤで上限+1（引継ぎダイヤ=非live）
    saveCarryDiamond(3);
    raiseCapDiamond('slime', false);
    out.capAfterDiamond = loadMonsterCaps().slime;      // 6 を期待
    out.diamondSpent = (loadCarryDiamond() === 2);

    // 4) 上限が上がったのでゴールドで6まで上げられる
    Object.assign(monsterCap, loadMonsterCaps());
    gold = 999999;
    levelUp('slime');
    out.goldLevelAfterCapRaise = monsterLevels.slime;   // 6 を期待

    // 5) 旧セーブ救済：レベルが上限より高ければ上限を引き上げ
    localStorage.setItem('magika_monsterlevels', JSON.stringify({slime:30,goblin:1,golem:1,wraith:1}));
    localStorage.removeItem('magika_monstercaps');
    out.migratedCapSlime = loadMonsterCaps().slime;     // 30 を期待

    out.OK = out.freshCapsAll5 && out.goldBlockedAtCap && out.capAfterDiamond===6 &&
             out.diamondSpent && out.goldLevelAfterCapRaise===6 && out.migratedCapSlime===30;
  } catch (e) { out.error = String(e && e.stack || e); }
  process.stdout.write(JSON.stringify(out) + '\n');
})();
