// 地圖連結解析測試（Node 執行，不需瀏覽器）：用已知答案檢查「連結 → 座標」，
// 並確認產生器（mapUrlLatLon）與 App 模板（_extractLatLon）結果相同。
// 用法：node scripts/test-map-link.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');

const fnSrc = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
};
const gen = fs.readFileSync(path.join(root, 'generator/generator-app.js'), 'utf8');
const tpl = fs.readFileSync(path.join(root, 'generator/template-src.html'), 'utf8');
const G = new Function(fnSrc(gen, '_placeIdLatLon') + fnSrc(gen, 'mapUrlLatLon') + 'return { mapUrlLatLon, _placeIdLatLon };')();
const T = new Function(fnSrc(tpl, '_placeIdLatLon') + fnSrc(tpl, '_extractLatLon') + 'return { _extractLatLon };')();

// 兩點距離（公尺）
const dist = (a, b) => {
  const R = 6371000, r = x => x * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// 岩手飯店：舊格式連結（有 !3d!4d），已知座標 39.2774255, 141.1229489
const IWATE = 'https://www.google.com/maps/place/ANA+Holiday+Inn+Iwate+Kitakami+by+IHG/@39.2774255,141.1229489,17z/data=!3m1!4b1!4m9!3m8!1s0x5f8f44f0b7e8947b:0xe15a64d1316724cd!5m2!4m1!1i2!8m2!3d39.2774255!4d141.1229489!16s%2Fg%2F1tg9sj0w';
// 同一個地點，把座標拿掉、只留地點代碼（模擬新版分享連結）
const IWATE_NOCOORD = 'https://www.google.com/maps/place/ANA+Holiday+Inn+Iwate+Kitakami+by+IHG/data=!4m2!3m1!1s0x5f8f44f0b7e8947b:0xe15a64d1316724cd!18m1!1e1';
// Claire 回報的吉隆坡國際機場新版分享連結（maps.app.goo.gl/eLJ3MErJZuDBjcqR9 展開後）
const KLIA = 'https://www.google.com/maps/place/%E5%90%89%E9%9A%86%E5%9D%A1%E5%9C%8B%E9%9A%9B%E6%A9%9F%E5%A0%B4+(KUL)64000,+KLIA,+64000+Sepang,+Selangor,+%E9%A6%AC%E4%BE%86%E8%A5%BF%E4%BA%9E/data=!4m2!3m1!1s0x31cdbf80d4a21211:0x982778bb67b5fa0b!18m1!1e1?utm_source=mstt_1&entry=gps';
const SEARCH = 'https://www.google.com/maps/search/kuala+lumpur/data=!3m1!1s0x31cc49c701efeae7:0xf4d98e5b2f1c287d';

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('✓ ' + name); } catch (e) { fail++; console.log('✗ ' + name + '\n    ' + e.message); } };

test('P4 舊格式連結照用連結內的座標', () => {
  assert.deepStrictEqual(G.mapUrlLatLon(IWATE), { lat: 39.2774255, lon: 141.1229489 });
});
test('新格式（只有地點代碼）換算位置與已知座標差 100 公尺內', () => {
  const p = G.mapUrlLatLon(IWATE_NOCOORD);
  assert.ok(p, '換算不出位置');
  const d = dist(p, { lat: 39.2774255, lon: 141.1229489 });
  assert.ok(d < 100, `差 ${Math.round(d)} 公尺`);
});
test('P1 吉隆坡國際機場連結換算到機場範圍內（不是台灣）', () => {
  const p = G.mapUrlLatLon(KLIA);
  assert.ok(p && p.lat > 2.70 && p.lat < 2.80 && p.lon > 101.65 && p.lon < 101.75, JSON.stringify(p));
});
test('P5 搜尋結果連結不用地點代碼換算', () => {
  assert.strictEqual(G._placeIdLatLon(SEARCH), null);
  assert.strictEqual(G.mapUrlLatLon(SEARCH), null);
});
test('P6 產生器與 App 模板的解析結果相同', () => {
  for (const u of [IWATE, IWATE_NOCOORD, KLIA, SEARCH]) assert.deepStrictEqual(T._extractLatLon(u), G.mapUrlLatLon(u), u);
});

console.log(`\n${pass} 通過、${fail} 失敗`);
if (fail) process.exit(1);
