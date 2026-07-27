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
  const style = new Proxy({}, { get: () => '', set: () => true });
  const classList = { add(){}, remove(){}, toggle(){return false;}, contains(){return false;} };
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style, classList,
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

const elCache = {};
const documentStub = {
  getElementById(id){ return elCache[id] || (elCache[id] = makeEl('div')); },
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
try { global.navigator = windowStub.navigator; } catch (e) { try { Object.defineProperty(global, 'navigator', { value: windowStub.navigator, configurable: true }); } catch (e2) {} }
global.alert = windowStub.alert;
global.confirm = windowStub.confirm;
global.prompt = windowStub.prompt;
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
