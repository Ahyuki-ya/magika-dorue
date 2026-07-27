// ミニマップ（一定縮尺）と勇者追尾カメラの検証。
//   ・ミニマップは常に MINIMAP_ROWS 行だけを写す（深く掘っても潰れない）
//   ・カメラ中心が範囲の中央に来る／マップ端ではクランプされる
//   ・追尾は「あくま部屋に最も近い勇者」を選び、手動スクロールで解除される
// 使い方: node test/p5/harness.js index.html camera
(function () {
  const results = [];
  const chk = (name, cond, detail) => results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  const c = document.getElementById('canvasContainer');
  const y0 = SKY_LAYERS + 1;
  // ハーネスの DOM スタブは clientHeight=800 固定
  const viewRows = c.clientHeight / TILE_SIZE;

  gameMode = 'standard';
  generateMap();
  expandMap(y0 + 400);
  const rows = map.length;

  // ---- 1. ミニマップの範囲 ----
  chk('1a 縦の表示マス数は固定', MINIMAP_ROWS === 100, MINIMAP_ROWS);
  c.scrollTop = (y0 + 200) * TILE_SIZE;
  const r1 = minimapRange();
  chk('1b マップが十分長ければ常に MINIMAP_ROWS 行', r1.shown === MINIMAP_ROWS, JSON.stringify(r1));
  const center1 = r1.top + r1.shown / 2;
  const camCenter1 = (c.scrollTop + c.clientHeight / 2) / TILE_SIZE;
  chk('1c カメラ中心が範囲の中央に来る', Math.abs(center1 - camCenter1) <= 1, `${center1} vs ${camCenter1}`);
  c.scrollTop = 0;
  const r2 = minimapRange();
  chk('1d 上端ではクランプされる', r2.top === 0 && r2.shown === MINIMAP_ROWS, JSON.stringify(r2));
  c.scrollTop = rows * TILE_SIZE;                 // 行き過ぎた位置
  const r3 = minimapRange();
  chk('1e 下端でも範囲外に出ない', r3.top + r3.shown <= rows && r3.top >= 0, JSON.stringify(r3));
  chk('1f 深度が変わっても縮尺は一定',
      [0, 100, 200, 300].every(d => { c.scrollTop = (y0 + d) * TILE_SIZE; return minimapRange().shown === MINIMAP_ROWS; }));
  // マップが短いうち（序盤）は全体を写す
  const savedMap = map;
  map = savedMap.slice(0, 40);
  chk('1g マップが短いうちは全体を写す', minimapRange().shown === 40, minimapRange().shown);
  map = savedMap;

  // ---- 2. 描画が例外なく通る（DOM/ctx スタブ上）----
  let drawErr = null;
  try {
    castlePos = { x: 10, y: y0 + 150 }; castleHp = CASTLE_MAX_HP;
    heroHouses = [{ x: 5, y: y0 + 120 }];
    heroes = [];
    [100, 148, 152, 260].forEach((d, i) => heroes.push(makeEntity(10, y0 + d,
      { hp: 20, maxHp: 20, atk: 3, agi: 3, range: 4, isHero: true, isEnraged: i === 1 })));
    c.scrollTop = (y0 + 150) * TILE_SIZE;
    positionMinimap();
    drawMinimap();
    cameraFollow = true; drawMinimap(); cameraFollow = false;   // 追尾マーカー経路も通す
  } catch (e) { drawErr = String(e && e.stack || e); }
  chk('2 ミニマップ描画で例外なし', drawErr === null, drawErr);

  // ---- 3. 追尾対象の選び方 ----
  const near = followTarget();
  chk('3a あくま部屋に最も近い勇者を選ぶ',
      !!near && Math.abs(near.y - castlePos.y) <= 2, near && `heroY=${near.y} castleY=${castlePos.y}`);
  const saveCastle = castlePos;
  castlePos = null;
  const deep = followTarget();
  chk('3b 城が無ければ最深の勇者', !!deep && deep.y === Math.max(...heroes.map(h => h.y)), deep && deep.y);
  castlePos = saveCastle;
  heroes.forEach(h => { h.hp = 0; });
  chk('3c 生存者がいなければ null', followTarget() === null);
  heroes = [];
  chk('3d 勇者ゼロでも落ちない', followTarget() === null);

  // ---- 4. 追尾カメラの動き ----
  heroes = [makeEntity(10, y0 + 300, { hp: 20, maxHp: 20, atk: 3, agi: 3, range: 4, isHero: true })];
  castlePos = { x: 10, y: y0 + 300 };
  c.scrollTop = 0;
  setFollow(true);
  chk('4a setFollow(true) で ON', cameraFollow === true);
  updateFollowCamera(true);                        // 一気に寄せる
  const want = (y0 + 300) * TILE_SIZE + TILE_SIZE / 2 - c.clientHeight / 2;
  chk('4b 対象が画面中央に来る', Math.abs(c.scrollTop - want) <= 2, `${c.scrollTop} vs ${want}`);
  c.scrollTop = 0;
  updateFollowCamera(false);                       // 滑らかモードは一気には着かない
  chk('4c 滑らかモードは徐々に寄る', c.scrollTop > 0 && c.scrollTop < want, c.scrollTop);
  let guard = 0;
  while (Math.abs(c.scrollTop - want) > 2 && guard++ < 500) updateFollowCamera(false);
  chk('4d 繰り返せば目標に収束する', Math.abs(c.scrollTop - want) <= 2, `${c.scrollTop} (${guard}回)`);
  setFollow(false);
  const before = c.scrollTop;
  heroes[0].y += 20; heroes[0].ry = heroes[0].y * TILE_SIZE;
  updateFollowCamera(false);
  chk('4e OFF なら勝手に動かない', c.scrollTop === before);
  chk('4f トグルで反転する', (() => { const a = cameraFollow; toggleFollow(); const b = cameraFollow; toggleFollow(); return a !== b && cameraFollow === a; })());
  // マップ端では行き過ぎない
  setFollow(true);
  heroes[0].y = map.length - 1; heroes[0].ry = heroes[0].y * TILE_SIZE;
  updateFollowCamera(true);
  const maxTop = Math.max(0, map.length * TILE_SIZE - c.clientHeight);
  chk('4g 端でクランプされる', c.scrollTop <= maxTop + 0.5 && c.scrollTop >= 0, `${c.scrollTop} <= ${maxTop}`);
  setFollow(false);

  // ---- 5. スクロールバーを出さない（CSS）----
  const src = HARNESS.readFile(HARNESS.htmlPath);
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  chk('5a webkit スクロールバーを消している', /#canvasContainer::-webkit-scrollbar\s*{[^}]*display:\s*none/.test(css));
  chk('5b Firefox/Edge 向けの指定もある', /#canvasContainer\s*{[^}]*scrollbar-width:\s*none/.test(css));
  chk('5c 縦スクロール自体は残っている', /#canvasContainer\s*{[\s\S]*?overflow-y:\s*auto/.test(css));

  const fails = results.filter(r => !r.ok);
  process.stdout.write(JSON.stringify({
    total: results.length, passed: results.length - fails.length, failed: fails.length,
    failures: fails,
    all: results.map(r => (r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ` [${r.detail}]` : '')),
  }, null, 1) + '\n');
})();
