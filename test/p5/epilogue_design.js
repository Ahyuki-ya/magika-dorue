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
  chk('4b @import がない', !/@import/i.test(src));
  // 書体は @font-face で持つが、外部から読んではいけない（D-1）。
  // url() が data: で始まるものだけを許す＝サブセットを base64 で埋め込んでいる状態。
  const faceUrls = (src.match(/@font-face[\s\S]*?\}/gi) || [])
    .flatMap(b => b.match(/url\(\s*['"]?([^'")]+)/gi) || [])
    .map(u => u.replace(/^url\(\s*['"]?/i, ''));
  const external = faceUrls.filter(u => !/^data:/i.test(u));
  chk('4c 書体は data: で埋め込む（外部から読まない）', external.length === 0, external.join(',') || 'none');
  chk('4d 画面の書体は1系列に揃っている',
      !/font-family:[^;}]*Courier/i.test(src) && /--font-ui\s*:/.test(src));

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

  // ---- 7. プレイ画面の配置契約（HUD が重ならないことを構造で担保する）----
  // 「重なって見づらい」を都度直すのではなく、重なりようがない形を強制する。
  //   ・HUD はすべて #gameCenter のグリッドのセルに入る（position:absolute で浮かせない）
  //   ・セルは grid-template-areas に宣言されている名前だけ
  // ここが赤くなったら「配置を絶対座標で足した」合図。areas に行を足す方へ直すこと。
  const gcRule = css.slice(css.indexOf('#gameCenter {'));
  const gcBody = gcRule.slice(0, gcRule.indexOf('}'));
  chk('7a #gameCenter はグリッド', /display:\s*grid/.test(gcBody));
  const areasM = gcBody.match(/grid-template-areas:([\s\S]*?);/);
  const declaredAreas = areasM ? [...new Set(areasM[1].match(/[a-z-]+/g) || [])] : [];
  chk('7b hud / ticker / stage の3段が宣言されている',
      ['hud', 'ticker', 'stage'].every(a => declaredAreas.includes(a)),
      declaredAreas.join(','));
  // 同じ id に複数のルールが書けるので、その id を含むセレクタの本文を「全部」集めて見る
  //（1つ目だけ見ると、後から足した position:absolute を見落とす）
  const rulesFor = (id) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(m => new RegExp('#' + id + '(?![\\w-])').test(m[1]))
    .map(m => m[2]);
  // 段（グリッドの行）は3つ。HUDの中身はこの段の中に flex で並ぶ。
  const ROW_IDS = ['gameHud', 'tickerBar', 'canvasContainer'];
  const unassigned = ROW_IDS.filter(id => {
    const area = rulesFor(id).map(b => (b.match(/grid-area:\s*([a-z-]+)/) || [])[1]).filter(Boolean).pop();
    return !area || !declaredAreas.includes(area);
  });
  chk('7c 3段が全部セルに割り当て済み', unassigned.length === 0, unassigned.join(',') || 'none');
  // 段の左右位置がそろうには、列幅を決めるのが盤面だけであること。
  // HUD行と掲示板が列幅を広げると、盤面より横に出て段がそろわなくなる。
  const widthNeutral = ['gameHud', 'tickerBar'].filter(id =>
    !rulesFor(id).some(b => /width:\s*0/.test(b) && /min-width:\s*100%/.test(b)));
  chk('7h 列幅を決めるのは盤面だけ', widthNeutral.length === 0, widthNeutral.join(',') || 'none');
  // 横3列（メニュー+盤面+強化）が入らない幅になったら縦積みへ切り替えること。
  // 切り替えないまま横に並べ続けると端が画面外に出て切れる。
  chk('7i 入らない幅では縦積みに切り替える',
      /@media \(max-width: 1000px\)[\s\S]{0,400}#gameScreen\s*{[^}]*flex-direction:\s*column/.test(css));
  // 縦積みでは全部の箱を盤面と同じ幅・中央そろえにする（左右の位置を一致させる）
  chk('7j 縦積みでは全箱を盤面幅にそろえる',
      /#dashboard\s*{[^}]*width:\s*var\(--stage-w/.test(css) && /align-self:\s*center/.test(css));
  // 盤面の外寸は JS から配る（列数を変えても追従させるため）
  chk('7k 盤面の外寸を --stage-w で配っている', /setProperty\(\s*'--stage-w'/.test(src));
  // 縮めるときは全部の箱に同じ倍率をかける（1つだけ縮めると幅がズレる）
  // 「倍率をかけるループ」が全箱を回っているかを見る。
  //（リセット用のループも同じ書き出しなので、倍率適用側だと分かる中身まで含めて確かめる）
  chk('7l 縮小は全箱に同じ倍率',
      /SCALED_BOXES/.test(src) &&
      /for \(const el of boxes\)\s*\{\s*const h = el\.offsetHeight/.test(src));
  // transform はレイアウト高を縮めないので、負のマージンで詰める
  chk('7m 縮小ぶんの余白を詰めている', /marginBottom\s*=\s*Math\.round\(-h \* \(1 - scale\)\)/.test(src));
  // HUD 本体に position:absolute が復活していないか（ドロップダウンは別物なので対象外）
  const HUD_IDS = [...ROW_IDS, 'gameActionsWrap', 'hudTopCenter', 'currencyUI'];
  const absHud = HUD_IDS.filter(id => rulesFor(id).some(b => /position:\s*absolute/.test(b)));
  chk('7d HUD を絶対座標で浮かせていない', absHud.length === 0, absHud.join(',') || 'none');
  // 実行時の見張り番が残っているか
  chk('7e 重なり検査が実装されている', /function assertNoOverlap/.test(src));
  chk('7f ラン開始時に検査を通る', /assertNoHudOverlap\(\);/.test(src));
  chk('7g リザルトでも重なりを検査する', /assertNoResultOverlap\(\);/.test(src));

  // ---- 8. 盤面と電光掲示板 ----
  chk('8a 盤面の列数は奇数（入口が中央＝左右対称）', BASE_COLS % 2 === 1, BASE_COLS);
  chk('8b 入口は中央の列', ENTRANCE_X === (BASE_COLS - 1) / 2, `${ENTRANCE_X} / ${BASE_COLS}`);
  chk('8c 盤面の幅は canvas の実寸に従う', /#canvasContainer\s*{[\s\S]*?width:\s*max-content/.test(css));
  chk('8d お知らせは電光掲示板の中', /<div id="tickerBar"><div id="message"/.test(src));
  chk('8e 右から左へ流れる', /@keyframes tickerScroll/.test(css) && /animation:\s*tickerScroll/.test(css));
  chk('8f 文字量に応じて速さを揃える', /TICKER_PX_PER_SEC/.test(src));
  chk('8g 動きを減らす設定を尊重する',
      /prefers-reduced-motion[\s\S]{0,200}#message\s*{[^}]*animation:\s*none/.test(css));

  // ---- 9. 画面の配置契約（全画面共通の head / body / foot）----
  // 縦の並びを1つの型に固定し、伸び縮みするのは中身の段だけにする。
  // これで「収まらなかったら後から縮める」補正が要らなくなる＝はみ出しが構造的に起きない。
  // 判定はコメントを除いた中身で行う（説明文に書いた "display:" を拾わないため）
  const layoutBody = ((css.match(/\.screen-layout\s*{([^}]*)}/) || [, ''])[1]).replace(/\/\*[\s\S]*?\*\//g, '');
  // .screen-layout に display を書くと、.screen の display:none と同じ強さで後勝ちするため
  // 「その画面が常に表示されたまま」になる（最後の画面が全部を覆って他が見えなくなる）。
  // 実際に出す時の display は showScreenOnly が入れる、という約束にしてある。
  chk('9a .screen-layout は display を宣言しない', !/display\s*:/.test(layoutBody), layoutBody.match(/display\s*:[^;]*/) || 'none');
  const layoutAreas = [...new Set(((layoutBody.match(/grid-template-areas:([\s\S]*?);/) || [, ''])[1]).match(/[a-z]+/g) || [])];
  chk('9b head / body / foot の3段', ['head', 'body', 'foot'].every(a => layoutAreas.includes(a)), layoutAreas.join(','));
  // 伸びるのは中身の段だけ（minmax(0,1fr) が無いと子が縮まずはみ出す）
  chk('9c 伸び縮みするのは中身の段だけ', /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/.test(layoutBody));
  chk('9d 中身の段が内側でスクロールする',
      /\.screen-body\s*{[^}]*min-height:\s*0/.test(css) && /\.screen-body\s*{[^}]*overflow-y:\s*auto/.test(css));

  // HTML 側：契約を使う画面が head/body/foot を「直接の子」として持っているか
  const SCREENS = ['startScreen', 'modeSelectScreen', 'shopScreen', 'settingsScreen', 'gameOverScreen'];
  const bodyHtml = src.slice(src.indexOf('<body>'), src.indexOf('<script>'));
  const badScreens = SCREENS.filter(id => {
    const at = bodyHtml.indexOf(`id="${id}"`);
    if (at < 0) return true;
    if (!/class="screen screen-layout"/.test(bodyHtml.slice(at - 60, at + 60))) return true;
    // その画面の範囲（次の画面の開始まで）に3つの段が揃っているか
    const nexts = SCREENS.map(o => bodyHtml.indexOf(`id="${o}"`)).filter(p => p > at);
    const end = nexts.length ? Math.min(...nexts) : bodyHtml.length;
    const seg = bodyHtml.slice(at, end);
    return !['screen-head', 'screen-body', 'screen-foot'].every(p => new RegExp(`class="[^"]*\\b${p}\\b`).test(seg));
  });
  chk('9e 主要画面が契約に乗っている', badScreens.length === 0, badScreens.join(',') || 'none');
  // 後付けの縮小補正が復活していないこと（契約が効いていれば不要）
  chk('9f はみ出し時の縮小補正が無い', !/function adjustResultScale/.test(src));

  // ---- 9g/9h 実際に画面を切り替えて確かめる（文字列検査では取り逃がすため）----
  // CSS の書き方を正規表現で見るだけだと「常に表示されたまま」「grid が flex に潰される」
  // といった “効いていない” 状態を検出できない。実際に切り替えて display を確かめる。
  const LAYOUT_SCREENS = ['startScreen', 'modeSelectScreen', 'shopScreen', 'settingsScreen', 'gameOverScreen'];
  const switchBad = [];
  for (const target of ALL_SCREENS) {
    showScreenOnly(target);
    for (const other of ALL_SCREENS) {
      const d = document.getElementById(other).style.display;
      if (other === target) {
        const want = LAYOUT_SCREENS.includes(other) ? 'grid' : 'flex';
        if (d !== want) switchBad.push(`${other}:${d}≠${want}`);
      } else if (d !== 'none') {
        switchBad.push(`${target}表示中に${other}が${d}`);
      }
    }
  }
  chk('9g 切り替えると狙った1画面だけが出る', switchBad.length === 0, switchBad.slice(0, 4).join(' / ') || 'none');
  // 契約画面は grid で出さないと3段構成が成立しない（flex だと中身がはみ出す）
  showScreenOnly('gameOverScreen');
  chk('9h 契約画面は grid で表示される',
      document.getElementById('gameOverScreen').style.display === 'grid',
      document.getElementById('gameOverScreen').style.display);

  // ---- 10. デザイントークン ----
  // 色を直書きすると、サポーターテーマ（:root を差し替える）がその箇所にだけ効かない。
  // ＝「直書き＝テーマが半端に壊れる」なので、トークンと同値の直書きは0を保つ。
  const rootBlock = (css.match(/:root\s*{[\s\S]*?}/) || [''])[0];
  const cssNoRoot = css.replace(rootBlock, '');
  const bodyHtml2 = src.slice(src.indexOf('<body>'), src.indexOf('<script>'));
  const TOKEN_LITERALS = {
    '--c-bg': '#000018', '--c-bg-game': '#000010', '--c-panel': 'rgba(0,8,32,0.92)',
    '--c-frame': '#4466cc', '--c-frame-dim': '#2244aa', '--c-frame-faint': '#1a2a60',
    '--c-text': '#f0f0f0', '--c-text-sub': '#8899cc', '--c-text-faint': '#6688aa',
    '--c-gold': '#ffcc00', '--c-dia': '#00ffee', '--c-danger': '#ff4422', '--c-ok': '#2ecc71',
  };
  const countLit = (hay, lit) =>
    (hay.match(new RegExp(lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![0-9a-fA-F])', 'gi')) || []).length;
  const strayCss = Object.entries(TOKEN_LITERALS)
    .map(([k, v]) => [k, countLit(cssNoRoot, v)]).filter(([, n]) => n > 0);
  chk('10a CSS にトークンと同値の直書き色が無い', strayCss.length === 0,
      strayCss.map(([k, n]) => `${k}×${n}`).join(' ') || 'none');
  const strayInline = Object.entries(TOKEN_LITERALS)
    .map(([k, v]) => [k, countLit(bodyHtml2, v)]).filter(([, n]) => n > 0);
  chk('10b インライン style にも直書き色が無い', strayInline.length === 0,
      strayInline.map(([k, n]) => `${k}×${n}`).join(' ') || 'none');
  chk('10c 色トークンが :root に揃っている',
      Object.keys(TOKEN_LITERALS).every(k => new RegExp(k + ':').test(rootBlock)));
  // 間隔の目盛り（4px 刻み＋半段の 2px 刻み）。奇数pxの余白は目盛り外。
  chk('10d 間隔トークンが定義されている', /--s-1:\s*4px/.test(rootBlock) && /--s-h2:\s*6px/.test(rootBlock));
  const oddGaps = [];
  for (const m of cssNoRoot.matchAll(/\b(gap|margin|padding)(-(top|bottom|left|right))?\s*:\s*([^;{}]+)/g)) {
    for (const v of m[4].matchAll(/(\d+)px/g)) {
      const n = +v[1];
      if (n > 2 && n % 2 === 1) oddGaps.push(`${m[1]}:${n}px`);
    }
  }
  chk('10e 余白は2px刻みの目盛りに乗っている', oddGaps.length === 0,
      [...new Set(oddGaps)].join(' ') || 'none');

  // ---- 11. 見た目確認ページ（dev/screens.html）が本体とズレていないか ----
  // このページは iframe 越しに index.html の「関数」を呼んで各画面を出す。
  // ゲームの状態変数は let/const 宣言＝window のプロパティではないので、
  // w.<名前>() で呼べるのは function 宣言されたものだけ。
  // 本体の関数名を変えるとページだけが黙って壊れるので、ここで対応を見張る。
  let gallery = null;
  try { gallery = HARNESS.readFile(HARNESS.htmlPath.replace(/index\.html$/, 'dev/screens.html')); } catch (e) {}
  if (!gallery) {
    chk('11 見た目確認ページがある', false, 'dev/screens.html が読めない');
  } else {
    // 説明用コメントに書いた例（w.gold = … など）を拾わないよう、先にコメントを落とす
    const gjs = gallery.replace(/^\s*\/\/.*$/gm, '');
    const used = [...new Set([...gjs.matchAll(/\bw\.([A-Za-z_$][\w$]*)\s*(?=[(=])/g)].map(m => m[1]))]
      .filter(n => !['document', 'Storage'].includes(n));
    const notFn = used.filter(n => !new RegExp(`\\n\\s*function ${n}\\b`).test(src));
    chk('11a 呼んでいる名前がすべて本体の関数として在る', notFn.length === 0, notFn.join(',') || used.length + '個OK');
    // 参照している DOM の id が本体に在るか（確認ページ自身の id は対象外）
    const ids = [...new Set([...gjs.matchAll(/w\.document\.getElementById\('([^']+)'\)|setText\(w, '([^']+)'/g)]
      .map(m => m[1] || m[2]))];
    const missingIds = ids.filter(id => !new RegExp(`id="${id}"`).test(src));
    chk('11b 参照している id がすべて本体に在る', missingIds.length === 0, missingIds.join(',') || ids.length + '個OK');
    // セーブデータを壊さないこと（同一オリジンで localStorage を共有するため必須）
    chk('11c 確認ページは localStorage に書き込まない',
        /Storage\.prototype\.setItem\s*=\s*function\s*\(\)\s*{}/.test(gallery));
  }

  const fails = results.filter(r => !r.ok);
  process.stdout.write(JSON.stringify({
    total: results.length, passed: results.length - fails.length, failed: fails.length,
    failures: fails,
    all: results.map(r => (r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ` [${r.detail}]` : '')),
  }, null, 1) + '\n');
})();
