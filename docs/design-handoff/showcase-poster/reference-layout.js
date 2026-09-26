/**
 * 行程海報 v2：版面參考實作（從 Claude Design 畫布的「主版元件」匯出）
 *
 * 用途：對照 spec.md 改寫 generator/template-src.html 的 drawShowcaseCanvas()。
 * 這份程式只「算座標」，不畫圖。輸出的 L（layout）裡每個元素都有 y、高度、字級、行高、截斷行數。
 *
 * 移植時請注意：
 * 1. em() / lines() 是用字元寬度估算的；實作請改成 ctx.measureText 逐字計算換行與截斷。
 * 2. SAMPLES 是設計稿用的假資料（取自 current-poster.html），實作時換成真實行程資料。
 * 3. 照片範例假設為 720×960 直式；實作時用真實照片尺寸做 cover 裁切：
 *    縮放 = max(720 / 圖寬, P / 圖高)，裁切起點 = (縮放後長邊 − 框的長邊) × 焦點（上/左 0、中 0.5、下/右 1）。
 * 4. props：sample（範例名）、themeA、themeB（主題色）、photoPos（top | center | bottom）。
 *
 * 快速試跑：node reference-layout.js trip11
 */
class DCLogic { constructor(props) { this.props = props || {}; this.state = {}; } setState(s) { Object.assign(this.state, s); } }

class Component extends DCLogic {
  renderVals() {
    const A = this.props.themeA ?? '#c94b72';
    const B = this.props.themeB ?? '#e06a8a';
    const sample = this.props.sample ?? 'day';

    // ---------- 色彩：由主題色推導 ----------
    const INK = '#100c0f';
    const rgb = h => { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
    const hex = c => '#' + c.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
    const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v * (1 - t) + y[i] * t)); };
    const lum = h => rgb(h).map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    let k = 0.40;
    while (Math.min(cr('#ffffff', mix(A, INK, k)), cr('#ffffff', mix(B, INK, k))) < 9 && k < 0.95) k += 0.05;
    const bgTop = mix(A, INK, k), bgBot = mix(B, INK, k);
    const worst = lum(bgTop) > lum(bgBot) ? bgTop : bgBot;
    let s = 0.30;
    while (cr(mix(B, '#ffffff', s), worst) < 5.5 && s < 0.95) s += 0.05;
    const acc = mix(B, '#ffffff', s);
    const t = { A, B, bgTop, bgBot, acc };

    // ---------- 文字寬度估算（正式版請用 ctx.measureText） ----------
    const em = str => { let w = 0; for (const ch of String(str)) { const c = ch.codePointAt(0); if (c === 0xFE0F) continue; if (c >= 0x1F000 || (c >= 0x2600 && c <= 0x27BF)) w += 1.2; else if (c >= 0x2E80) w += 1; else if (ch === ' ') w += 0.3; else if (/[A-Z0-9%&]/.test(ch)) w += 0.64; else w += 0.54; } return w; };
    const lines = (str, f, w) => Math.max(1, Math.ceil(em(str) * f * 1.06 / w));

    // ---------- 範例資料（取自 current-poster.html） ----------
    const TITLE = '東北賞櫻之旅 2026';
    const DAY2 = { trip: TITLE, day: 2, total: 8, dateText: '4/16（四）', theme: '仙台市區賞櫻', acts: ['瑞鳳殿', '榴岡公園', '仙台東照宮', '仙台市區購物'], hotel: 'ホテル京阪仙台', caption: '' };
    const LONGDAY = { trip: TITLE, day: 5, total: 12, dateText: '10/3（五）', theme: '京都嵐山・嵯峨野一日散策與伏見稻荷夜拜', acts: ['天龍寺（世界遺產・曹源池庭園）', '嵐山竹林小徑', '野宮神社', '常寂光寺', '渡月橋', '嵐山小火車 Sagano Romantic Train', '保津川遊船', '% ARABICA Kyoto Arashiyama', '伏見稻荷大社 千本鳥居夜間參拜'], hotel: 'Hotel The Celestine Kyoto Gion（京都祇園セレスティンホテル）', caption: '竹林的風聲比照片更好看' };
    const TRIP8 = [['4/15', '三', '抵達仙台', '✈️'], ['4/16', '四', '仙台市區賞櫻', '🌸'], ['4/17', '五', '平泉 & 北上夜櫻', '🏛️'], ['4/18', '六', '青森市區', '🐟'], ['4/19', '日', '弘前全日賞櫻', '🌸'], ['4/20', '一', '松島溫泉・一之坊', '♨️'], ['4/21', '二', '松島巡禮 & 仙台 Outlet', '⛵'], ['4/22', '三', '返家', '🏠']];
    const EMO = ['✈️', '🌸', '🏯', '⛩️', '🍜', '🚅', '♨️', '🗻', '🛍️', '🏠'];
    const TRIP_N = n => Array.from({ length: n }, (_, i) => [(1 + Math.floor(i / 30)) + '/' + ((i % 30) + 1), '一二三四五六日'[i % 7], i % 3 === 0 ? '大阪環球影城一整天暢玩哈利波特園區' : '市區散步', EMO[i % EMO.length]]);
    const SAMPLES = {
      day: { kind: 'day', ...DAY2 },
      dayPhoto: { kind: 'dayPhoto', ...DAY2 },
      longday: { kind: 'dayPhoto', ...LONGDAY },
      trip8: { kind: 'trip', trip: TITLE, days: TRIP8 },
      trip11: { kind: 'trip', trip: '關西親子自由行 2026', days: TRIP_N(11) },
      trip20: { kind: 'trip', trip: '關西親子自由行 2026', days: TRIP_N(20) },
      trip30: { kind: 'trip', trip: '歐洲打工度假第一個月', days: TRIP_N(30) }
    };
    const S = SAMPLES[sample] || SAMPLES.day;

    // ---------- 版面常數 ----------
    const PAD = 48, CW = 624, LIMIT = 1016; // LIMIT = footer 頂 1056 − 40
    const WHITE = '#ffffff';

    // 底部群組（住宿、一句話）由下往上排，貼齊 LIMIT
    const bottomCluster = (o) => {
      let cur = LIMIT; const r = { hotel: !!S.hotel, cap: !!S.caption, hotelF: o.hotelF, hotelLH: o.hotelLH, capF: o.capF, capLH: o.capLH };
      if (S.caption) { const n = Math.min(2, lines('「' + S.caption + '」', o.capF, CW)); r.capY = cur - n * o.capLH; cur = r.capY; }
      if (S.hotel) { if (S.caption) cur -= o.gap; r.hotelY = cur - o.hotelLH; cur = r.hotelY; }
      r.top = cur; r.any = !!(S.caption || S.hotel);
      return r;
    };
    // 景點清單：由大到小試字級，都放不下就截斷並顯示「＋N 個景點」
    // 每個景點最多 2 行（文字寬 592 = 624 − 圓點 12 − 間距 20）
    const TW = 592;
    const fitList = (acts, top, limit, tiers) => {
      const avail = limit - top, n = acts.length;
      const need = x => acts.reduce((s, a) => s + Math.min(2, lines(a, x.f, TW)) * x.lh, 0) + (n - 1) * x.g;
      let tier = tiers.find(x => need(x) <= avail);
      const fits = !!tier;
      let items = acts.map(a => ({ text: a, more: false }));
      if (!fits) {
        tier = tiers[tiers.length - 1];
        // 由上往下放，保留最後一行給「＋N 個景點」
        let y = 0, k = 0;
        while (k < n && y + Math.min(2, lines(acts[k], tier.f, TW)) * tier.lh + tier.g + tier.lh <= avail) { y += Math.min(2, lines(acts[k], tier.f, TW)) * tier.lh + tier.g; k++; }
        items = acts.slice(0, k).map(a => ({ text: a, more: false })).concat([{ text: '＋' + (n - k) + ' 個景點', more: true }]);
      }
      let y = top;
      const rows = items.map(it => {
        const h = (it.more ? 1 : Math.min(2, lines(it.text, tier.f, TW))) * tier.lh;
        const r = { y: Math.round(y), h, f: tier.f, lh: tier.lh, dotTop: Math.round((tier.lh - 12) / 2), text: it.text, dot: it.more ? 'transparent' : acc, color: it.more ? acc : WHITE };
        y += h + tier.g; return r;
      });
      return { fits, tier, rows };
    };

    let L = {};
    if (S.kind === 'day') {
      const tf = lines(S.theme, 64, CW) <= 2 ? 64 : 52;
      const tl = Math.min(2, lines(S.theme, tf, CW)), tlh = Math.round(tf * 1.2);
      L = { themeY: 272, themeF: tf, themeLH: tlh, themeLines: tl, themeH: tl * tlh, themeText: S.theme };
      const b = bottomCluster({ hotelF: 30, hotelLH: 44, capF: 32, capLH: 46, gap: 20 });
      const listTop = 272 + tl * tlh + 44;
      const fl = fitList(S.acts, listTop, b.any ? b.top - 40 : LIMIT, [{ f: 48, lh: 64, g: 24 }, { f: 40, lh: 54, g: 14 }, { f: 34, lh: 48, g: 10 }, { f: 30, lh: 42, g: 8 }, { f: 28, lh: 38, g: 6 }]);
      Object.assign(L, b, { acts: fl.rows });
    } else if (S.kind === 'dayPhoto') {
      const n = S.acts.length;
      let P = n <= 4 ? 520 : n <= 6 ? 440 : 400, out = null;
      for (; P >= 320; P -= 80) {
        const tf = lines(S.theme, 56, CW) <= 2 ? 56 : 48;
        const tl = Math.min(2, lines(S.theme, tf, CW)), tlh = Math.round(tf * 1.2);
        const themeY = P + 80;
        const b = bottomCluster({ hotelF: 28, hotelLH: 40, capF: 30, capLH: 42, gap: 12 });
        const listTop = themeY + tl * tlh + 32;
        const fl = fitList(S.acts, listTop, b.any ? b.top - 32 : LIMIT, [{ f: 36, lh: 50, g: 12 }, { f: 32, lh: 44, g: 8 }, { f: 28, lh: 40, g: 6 }]);
        out = { P, metaY: P + 28, themeY, themeF: tf, themeLH: tlh, themeLines: tl, themeH: tl * tlh, themeText: S.theme, ...b, acts: fl.rows };
        if (fl.fits) break;
      }
      if (P < 320) P = 320;
      // 照片位置：上 0／中 0.5／下 1（範例照片為 720×960 直式）
      const focus = { top: 0, center: 0.5, bottom: 1 }[this.props.photoPos ?? 'center'] ?? 0.5;
      out.photoOff = -Math.round((960 - out.P) * focus);
      const at = out.P / 1280;
      out.fadeY = out.P - 160; out.fadeTo = mix(bgTop, bgBot, at); out.fadeFrom = out.fadeTo + '00';
      L = out;
    } else {
      const days = S.days, n = days.length;
      const tf = lines(S.trip, 56, CW) <= 2 ? 56 : 48;
      const tl = Math.min(2, lines(S.trip, tf, CW)), tlh = Math.round(tf * 1.2);
      const subY = 64 + tl * tlh + 12;
      const top = subY + 36 + 40, avail = LIMIT - top;
      const first = days[0], last = days[n - 1];
      L = { themeY: 64, themeF: tf, themeLH: tlh, themeLines: tl, themeH: tl * tlh, themeText: S.trip, subY, sub: first[0] + '（' + first[1] + '）→ ' + last[0] + '（' + last[1] + '）・' + n + ' 天' };
      const line = '1px solid rgba(255,255,255,0.12)';
      let rows = [];
      if (n <= 14) {
        // 單欄：名稱最多 2 行，列高依內容而定（每列上下留白至少 8）
        const tiers = n <= 9
          ? [{ f: 36, lh: 44, date: true }, { f: 32, lh: 40, date: true }, { f: 30, lh: 38, date: false }, { f: 28, lh: 36, date: false }]
          : [{ f: 34, lh: 44, date: false }, { f: 30, lh: 40, date: false }, { f: 28, lh: 36, date: false }];
        const geo = x => { const dW = n <= 9 ? 76 : Math.round(x.f * 2.4), eW = n <= 9 ? 60 : Math.round(x.f * 1.7); return { dW, eW, nameW: 624 - dW - eW }; };
        const contentH = (x, maxL) => days.map(d => Math.min(maxL, lines(d[2], x.f, geo(x).nameW)) * x.lh + (x.date ? 28 : 0));
        let tier = tiers.find(x => contentH(x, 2).reduce((a, b) => a + b, 0) + n * 16 <= avail), maxL = 2;
        if (!tier) { tier = tiers[tiers.length - 1]; maxL = 1; }
        const hs = contentH(tier, maxL), sum = hs.reduce((a, b) => a + b, 0);
        const pad = Math.min((avail - sum) / n, n <= 9 ? 32 : 36);
        const g = geo(tier);
        let y = top;
        rows = days.map((d, i) => { const h = hs[i] + pad; const r = { x: 48, y: Math.round(y), w: 624, h: Math.round(h), dW: g.dW, dF: n <= 9 ? 28 : Math.round(tier.f * 0.8), eW: g.eW, eF: n <= 9 ? 40 : Math.round(tier.f * 1.1), f: tier.f, lh: tier.lh, clamp: maxL, showDate: tier.date, date: d[0] + '（' + d[1] + '）', name: d[2], emoji: d[3], dLabel: 'D' + (i + 1), color: WHITE, border: i < n - 1 ? line : 'none' }; y += h; return r; });
      } else {
        const over = n > 30;
        const cells = over ? days.slice(0, 29) : days.slice();
        const m = over ? 30 : n, per = Math.ceil(m / 2), rh = avail / per;
        const two = rh >= 2 * 32 + 6;
        const f = two ? 26 : Math.max(22, Math.min(28, Math.floor(rh * 0.5)));
        const lh = two ? 32 : Math.round(f * 1.3);
        const mk = (i, label, emoji, name, color) => ({ x: 48 + Math.floor(i / per) * (296 + 32), y: Math.round(top + (i % per) * rh), w: 296, h: Math.round(rh), dW: Math.round(f * 2.3), dF: Math.round(f * 0.85), eW: Math.round(f * 1.5), eF: Math.round(f * 1.05), f, lh, clamp: two ? 2 : 1, showDate: false, date: '', name, emoji, dLabel: label, color, border: (i % per) < per - 1 ? line : 'none' });
        rows = cells.map((d, i) => mk(i, 'D' + (i + 1), d[3], d[2], WHITE));
        if (over) rows.push(mk(29, '…', '', '還有 ' + (n - 29) + ' 天', acc));
      }
      L.rows = rows;
    }

    return {
      t, S, L,
      showBar: S.kind !== 'dayPhoto',
      isPhoto: S.kind === 'dayPhoto',
      isDay: S.kind === 'day',
      isTrip: S.kind === 'trip',
      hasActs: S.kind !== 'trip',
      hasDayTitle: true
    };
  }
}

function computeShowcaseLayout(props) {
  const c = new Component(props);
  c.props = props || {};
  return c.renderVals();
}

if (typeof module !== "undefined") module.exports = { computeShowcaseLayout };
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  const out = computeShowcaseLayout({ sample: process.argv[2] || "day", photoPos: process.argv[3] || "center" });
  console.log(JSON.stringify(out, null, 2));
}
