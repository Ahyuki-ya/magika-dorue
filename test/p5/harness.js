'use strict';
// Phase 5 等価性ハーネス
// 使い方: node harness.js <index.html path> <mode> [seed]
//   mode = "path"  : 経路探索オラクル（多数のランダムマップ×全開始セルの一手をJSON出力）
//   mode = "sim"   : gameLoopドライバ（Nティック軌道＋乱数消費回数をJSON出力）
// 決定的LCGで Math.random を差し替え、Date.now/performance.now も制御下に置く。

const fs = require('fs');
const path = require('path');

const htmlPath = process.argv[2];
const mode = process.argv[3] || 'path';
const seed = parseInt(process.argv[4] || '12345', 10);

const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no <script>'); process.exit(2); }
const scriptBody = m[1];

// ---- 決定的乱数（LCG）＋消費カウンタ ----
let rngState = seed >>> 0;
let rngCount = 0;
function lcg() {
  rngState = (Math.imul(1664525, rngState) + 1013904223) >>> 0;
  rngCount++;
  return rngState / 2 ** 32;
}

// ---- 制御下の時計 ----
let clockMs = 0; // ハーネスが進める壁時計相当
const realRandom = Math.random;
Math.random = lcg;
Date.now = () => clockMs;
const perfNow = () => clockMs;

// ---- DOMスタブ（Proxyで何でも受ける makeEl）----
function makeEl(tag) {
  // style: 従来どおり「読みは常に空文字・書きは黙って捨てる」。
  // ただし setProperty/removeProperty だけは実際に記録する（CSS変数によるテーマ切替の検証用）。
  // 通常のプロパティ読みは今までどおり '' を返すので、既存の path/sim の挙動は変わらない。
  const styleProps = {};
  // style は代入した値を覚える（以前は捨てていたため、el.style.display = 'grid' のような
  // 「表示の出し分け」をテストから確認できず、画面が出ないバグを取り逃がした）。
  const style = new Proxy({}, {
    get: (t, p) => {
      if (p === 'setProperty') return (k, v) => { styleProps[k] = String(v); };
      if (p === 'removeProperty') return (k) => { delete styleProps[k]; };
      if (p === 'getPropertyValue') return (k) => (k in styleProps ? styleProps[k] : '');
      return p in t ? t[p] : '';
    },
    set: (t, p, v) => { t[p] = String(v); return true; },
  });
  // classList は実際に持っているクラスを覚える。
  // 以前は contains() が常に false だったため「クラスを見て分岐するコード」を
  // テストできず、画面の display 切り替えの取り違えを取り逃がした。
  const _cls = new Set();
  const classList = {
    add(...n){ n.forEach(c => _cls.add(c)); },
    remove(...n){ n.forEach(c => _cls.delete(c)); },
    toggle(c, on){ const v = on === undefined ? !_cls.has(c) : !!on; v ? _cls.add(c) : _cls.delete(c); return v; },
    contains(c){ return _cls.has(c); },
    get value(){ return [..._cls].join(' '); },
  };
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style, classList, __styleProps: styleProps,
    children: [], dataset: {},
    _text: '', _html: '',
    width: 600, height: 800,
    clientWidth: 600, clientHeight: 800, offsetWidth: 600, offsetHeight: 800,
    value: '',
    appendChild(c){ this.children.push(c); return c; },
    removeChild(c){ const i=this.children.indexOf(c); if(i>=0)this.children.splice(i,1); return c; },
    remove(){},
    insertBefore(c){ this.children.push(c); return c; },
    setAttribute(){}, getAttribute(){return null;}, removeAttribute(){},
    addEventListener(){}, removeEventListener(){},
    getContext(){ return makeCtx(); },
    querySelector(){ return makeEl('div'); },
    querySelectorAll(){ return []; },
    getBoundingClientRect(){ return {left:0,top:0,right:600,bottom:800,width:600,height:800}; },
    focus(){}, blur(){}, click(){}, scrollIntoView(){}, closest(){return null;},
    cloneNode(){ return makeEl(this.tagName); },
  };
  Object.defineProperty(el, 'textContent', { get(){return this._text;}, set(v){this._text=String(v);} });
  Object.defineProperty(el, 'innerHTML', { get(){return this._html;}, set(v){this._html=String(v);} });
  Object.defineProperty(el, 'innerText', { get(){return this._text;}, set(v){this._text=String(v);} });
  return el;
}
function makeCtx() {
  return new Proxy({
    canvas: { width: 600, height: 800 },
    createRadialGradient(){ return { addColorStop(){} }; },
    createLinearGradient(){ return { addColorStop(){} }; },
    createPattern(){ return {}; },
    getImageData(){ return { data: [] }; },
    measureText(){ return { width: 10 }; },
  }, {
    get(t, p) { if (p in t) return t[p]; return () => {}; },
    set(){ return true; },
  });
}

// 実HTMLの id → class を拾っておき、スタブ要素に同じクラスを持たせる。
// これで「クラスを見て分岐するコード」（例: 画面ごとの display の出し分け）を
// テストから実際に動かせる。
const ID_CLASSES = (() => {
  const map = {};
  for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const tag = m[0];
    const id = (tag.match(/\sid="([^"]+)"/) || [])[1];
    if (!id) continue;
    const cls = (tag.match(/\sclass="([^"]*)"/) || [])[1];
    if (cls) map[id] = cls.trim().split(/\s+/);
  }
  return map;
})();

const elCache = {};
const documentStub = {
  getElementById(id){
    if (!elCache[id]) {
      const e = makeEl('div');
      (ID_CLASSES[id] || []).forEach(c => e.classList.add(c));
      elCache[id] = e;
    }
    return elCache[id];
  },
  querySelector(){ return makeEl('div'); },
  querySelectorAll(){ return []; },
  createElement(tag){ return makeEl(tag); },
  createElementNS(ns, tag){ return makeEl(tag); },
  addEventListener(){}, removeEventListener(){},
  body: makeEl('body'),
  documentElement: makeEl('html'),
  head: makeEl('head'),
  hidden: false,
  visibilityState: 'visible',
};
const rafQueue = [];
const windowStub = {
  innerWidth: 1200, innerHeight: 900,
  devicePixelRatio: 1,
  addEventListener(){}, removeEventListener(){},
  requestAnimationFrame(cb){ rafQueue.push(cb); return rafQueue.length; },
  cancelAnimationFrame(){},
  localStorage: (() => {
    const store = {};
    return {
      getItem:(k)=> (k in store ? store[k] : null),
      setItem:(k,v)=>{ store[k]=String(v); },
      removeItem:(k)=>{ delete store[k]; },
      clear:()=>{ for(const k in store) delete store[k]; },
    };
  })(),
  matchMedia(){ return { matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }; },
  performance: { now: perfNow },
  AudioContext: undefined,
  webkitAudioContext: undefined,
  navigator: { userAgent: 'node', vibrate(){} },
  alert(){}, confirm(){ return true; }, prompt(){ return null; },
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
};

// グローバルへ流し込み
global.window = windowStub;
global.document = documentStub;
global.localStorage = windowStub.localStorage;
global.requestAnimationFrame = windowStub.requestAnimationFrame;
global.cancelAnimationFrame = windowStub.cancelAnimationFrame;
global.performance = windowStub.performance;
global.matchMedia = windowStub.matchMedia;
// getComputedStyle: 未知のプロパティは空文字。display は 'block'（＝要素は表示されている扱い）
const computedStyleStub = () => new Proxy({ display: 'block' }, { get: (t, p) => (p in t ? t[p] : '') });
windowStub.getComputedStyle = computedStyleStub;
global.getComputedStyle = computedStyleStub;
try { global.navigator = windowStub.navigator; } catch (e) { try { Object.defineProperty(global, 'navigator', { value: windowStub.navigator, configurable: true }); } catch (e2) {} }
global.alert = windowStub.alert;
global.confirm = windowStub.confirm;
global.prompt = windowStub.prompt;
// MutationObserver: 電光掲示板（#message の変化を拾って流し直す）が使う。
// スタブは監視するだけで発火しない＝掲示板の見た目はテスト対象外、という割り切り。
global.MutationObserver = class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} takeRecords(){ return []; } };
windowStub.MutationObserver = global.MutationObserver;
global.AudioContext = undefined;
global.webkitAudioContext = undefined;
const __realNow = require('perf_hooks').performance.now.bind(require('perf_hooks').performance);
// htmlPath / readFile はエピローグからソースを静的検査するためのもの（indirect eval 下では require が使えない）
global.HARNESS = { lcg, get rngCount(){return rngCount;}, setClock:(v)=>{clockMs=v;}, getClock:()=>clockMs, rafQueue, realNow: __realNow,
                   htmlPath, readFile:(p)=>fs.readFileSync(p, 'utf8') };

// ---- テストエピローグを読み込んで連結 ----
const epilogue = fs.readFileSync(path.join(__dirname, 'epilogue_' + mode + '.js'), 'utf8');
const full = scriptBody + '\n;\n' + epilogue;

try {
  // eval で同一スコープに展開（let/const をエピローグから参照するため）
  (0, eval)(full);
} catch (e) {
  console.error('EPILOGUE_ERROR', e && e.stack || e);
  process.exit(3);
}
