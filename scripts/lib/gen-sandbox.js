// 在 Node 裡載入 generator-app.js（用假的 DOM），讓資料層邏輯可以不開瀏覽器測試。
// 日期固定，genId 的結果才可重現。
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '../..');

function makeEl() {
  const el = {
    value: '', innerHTML: '', textContent: '', checked: false, disabled: false,
    type: 'text', className: '', style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    appendChild() {}, focus() {}, click() {}, contains() { return false; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    parentNode: { insertBefore() {}, appendChild() {}, removeChild() {} },
  };
  return el;
}

// appPath：要載入的 generator-app.js（預設是目前的版本）；groupPath：group-trip.js（舊版沒有就略過）
function loadGenerator({ appPath = path.join(root, 'generator/generator-app.js'),
                         groupPath = path.join(root, 'generator/group-trip.js'),
                         uiPath = path.join(root, 'generator/group-ui.js') } = {}) {
  const els = new Map();
  const fixedNow = 1700000000000;
  class FixedDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(fixedNow); }
    static now() { return fixedNow; }
  }
  const store = {};
  const sandbox = {
    console, Date: FixedDate, Math, JSON, Array, Object, String, Number, Set, Map, Promise, RegExp, Error,
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: {}, location: { hostname: 'localhost' }, alert() {}, confirm() { return true; },
    window: {}, TextDecoder, TextEncoder, atob: s => Buffer.from(s, 'base64').toString('binary'),
    document: {
      getElementById(id) { if (!els.has(id)) els.set(id, makeEl()); return els.get(id); },
      querySelector() { return makeEl(); }, querySelectorAll() { return []; },
      addEventListener() {}, createElement() { return makeEl(); }, body: makeEl(),
    },
  };
  sandbox.scrollTo = () => {}; sandbox.scrollY = 0; sandbox.pageYOffset = 0; sandbox.requestAnimationFrame = f => 0;
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  if (fs.existsSync(groupPath)) vm.runInContext(fs.readFileSync(groupPath, 'utf8'), ctx, { filename: groupPath });
  if (fs.existsSync(uiPath)) vm.runInContext(fs.readFileSync(uiPath, 'utf8'), ctx, { filename: uiPath });
  vm.runInContext(fs.readFileSync(appPath, 'utf8'), ctx, { filename: appPath });
  return { ctx, run: code => vm.runInContext(code, ctx), el: id => sandbox.document.getElementById(id) };
}

module.exports = { loadGenerator, root };
