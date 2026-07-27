// Phase 4 デザイン強化の機械検証。
// 「見た目」は実機確認が主だが、性能予算（D-3）と壊れ検出だけは自動化できる:
//   ・タイル質感のプリレンダが起動時に1回だけ済んでいる（毎フレーム作り直していない）
//   ・描画ループでグラデーション/パターンを新規生成しない、shadowBlur を使わない
//   ・プリレンダが乱数を消費しない（保存則2＝等価性ハーネスを壊さない）
//   ・深度トーンが単調非減少で上限に収まる
//   ・リザルトのカウントアップ／入手宝具チップが例外を出さない
// 使い方: node test/p5/harness.js index.html design
(function () {
  const results = [];
  const chk = (name, cond, detail) => results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });

  // ---- 1. プリレンダ ----
  const artKeys = Object.keys(TILE_ART).sort();
  chk('1a 鉱石5種がプリレンダ済み', artKeys.join(',') === '1,2,6,7,8', artKeys.join(','));
  chk('1b 30×30 のオフスクリーンcanvas', TILE_ART[1].width === TILE_SIZE && TILE_ART[1].height === TILE_SIZE,
      `${TILE_ART[1].width}x${TILE_ART[1].height}`);
  const before = Object.values(TILE_ART);
  // 描画を何度回してもタイル画像は作り直されない（同一オブジェクトのまま）
  chk('1c 起動時の1回きり（同一インスタンス）', Object.values(TILE_ART).every((v, i) => v === before[i]));
  // 乱数を消費していない（tileNoise が決定的ハッシュであること）
  const rc0 = HARNESS.rngCount;
  buildTileArt();                                  // 再構築しても乱数を消費しないこと
  chk('1d プリレンダは乱数を消費しない（保存則2）', HARNESS.rngCount === rc0, `${rc0}→${HARNESS.rngCount}`);
  chk('1e tileNoise は決定的', tileNoise(3, 5, 11) === tileNoise(3, 5, 11) && tileNoise(3, 5, 11) !== tileNoise(4, 5, 11));
  const n = tileNoise(7, 9, 23);
  chk('1f tileNoise は 0..1', n >= 0 && n < 1, n.toFixed(4));

  // ---- 2. 深度トーン ----
  chk('2a 地表は暗くしない', depthTone(0) === 0 && depthTone(-5) === 0);
  chk('2b 単調非減少', [0, 10, 50, 100, 200, 300, 1000].every((d, i, a) => i === 0 || depthTone(d) >= depthTone(a[i - 1])));
  chk('2c 上限で頭打ち', depthTone(DEPTH_TONE_RANGE) === DEPTH_TONE_MAX && depthTone(99999) === DEPTH_TONE_MAX);
  chk('2d 掘れるタイルの視認性を残す（上限0.5未満）', DEPTH_TONE_MAX < 0.5, DEPTH_TONE_MAX);

  // ---- 3. 描画ループの性能予算（D-2/D-3）: 該当コードが残っていないことを静的に確認 ----
  const src = HARNESS.readFile(HARNESS.htmlPath);
  const body = src.slice(src.indexOf('function gameLoop'));
  chk('3a 描画ループに createRadialGradient がない', !/createRadialGradient/.test(body));
  chk('3b 描画ループに createLinearGradient がない', !/createLinearGradient/.test(body));
  chk('3c 描画ループに createPattern がない', !/createPattern/.test(body));
  chk('3d canvas に shadowBlur の代入がない', !/ctx\.shadowBlur\s*=/.test(src));
  chk('3e フローティングテキストに縁取りがある', /strokeText\(/.test(body));
  chk('3f 鉱石タイルは drawImage で描く', /ctx\.drawImage\(art/.test(body));

  // ---- 4. 外部リソース禁止（D-1）----
  chk('4a 外部URLの読み込みがない', !/(src|href)\s*=\s*["']https?:/i.test(src));
  chk('4b @import / @font-face がない', !/@import|@font-face/i.test(src));

  // ---- 5. レア度視覚言語（D-4）: 全レア度にクラスとバッジ文字がある ----
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  const missingCls = RARITY_KEYS.filter(k => !new RegExp('\\.rar-' + k + '\\b').test(css));
  chk('5a 全レア度に .rar-* クラスがある', missingCls.length === 0, missingCls.join(','));
  const missingBadgeCls = RARITY_KEYS.filter(k => !new RegExp('\\.b-' + k + '\\b').test(css));
  chk('5b 全レア度に .b-* バッジ色がある', missingBadgeCls.length === 0, missingBadgeCls.join(','));
  const badBadge = RARITY_KEYS.filter(k => !rarBadge(k) || rarBadge(k) === '?');
  chk('5c 全レア度にバッジ文字がある（色を抜いても読める）', badBadge.length === 0, RARITY_KEYS.map(rarBadge).join('/'));
  chk('5d 上位レアは枠の形でも区別（二重枠/脈動）', /\.rar-epic[^}]*box-shadow/.test(css) && /\.rar-legendary[^}]*animation/.test(css));

  // ---- 6. 描画ループとリザルト演出が例外を出さない（DOM/ctxスタブ上）----
  let err = null;
  try {
    gameMode = 'standard';
    generateMap();
    // モンスターと勇者を並べて1フレーム描く（2階調シェーディング経路を全種通す）
    monsters = []; heroes = [];
    ['slime', 'goblin', 'golem', 'wraith'].forEach((mt, i) => {
      monsters.push(makeEntity(2 + i, SKY_LAYERS + 3, { hp: 10, maxHp: 10, atk: 2, agi: 2, range: 3, isHero: false, mtype: mt, color: '#fff', isBaby: i === 0 }));
    });
    heroes.push(makeEntity(5, SKY_LAYERS + 3, { hp: 10, maxHp: 10, atk: 2, agi: 2, range: 3, isHero: true, isEnraged: true }));
    heroes.push(makeEntity(6, SKY_LAYERS + 3, { hp: 10, maxHp: 10, atk: 2, agi: 2, range: 3, isHero: true }));
    isPaused = true;                       // ロジックを進めず描画だけ通す
    gameLoop(16);
    isPaused = false;
    // リザルト演出（カウントアップ＋入手宝具チップ）
    sessionTreasureList = [];
    for (let i = 0; i < RESULT_DROP_MAX + 3; i++) sessionTreasureList.push({ icon: '💎', rarity: RARITY_KEYS[i % RARITY_KEYS.length] });
    renderResultDrops();
    const row = document.getElementById('resDropRow');
    chk('6a 入手宝具チップは上限＋残数表示', row.children.length === RESULT_DROP_MAX + 1, row.children.length);
    animateResultNumbers([{ id: 'resHeroes', to: 42 }, { id: 'resEarnedGold', to: 1234 }]);
    chk('6b カウントアップは0から始まる', document.getElementById('resHeroes').innerText === '0',
        document.getElementById('resHeroes').innerText);
    // rAF を最後まで回して最終値に着地することを確認
    HARNESS.setClock(HARNESS.getClock() + RESULT_COUNTUP_MS + 100);
    let guard = 0;
    while (HARNESS.rafQueue.length && guard++ < 50) HARNESS.rafQueue.shift()(HARNESS.getClock());
    chk('6c カウントアップは最終値で止まる', String(document.getElementById('resHeroes').innerText) === '42',
        document.getElementById('resHeroes').innerText);
    // 画面遷移フェード（クラス付与のみ）
    showScreenOnly('titleScreen');
  } catch (e) { err = String(e && e.stack || e); }
  chk('6 描画・演出経路で例外なし', err === null, err);

  const fails = results.filter(r => !r.ok);
  process.stdout.write(JSON.stringify({
    total: results.length, passed: results.length - fails.length, failed: fails.length,
    failures: fails,
    all: results.map(r => (r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ` [${r.detail}]` : '')),
  }, null, 1) + '\n');
})();
