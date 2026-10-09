// 檢查 AI 回傳的分組行程 JSON：判讀提醒 A-1～A-5，並與 expected.json 比對
// 用法：node check.js <AI 回傳的 json 檔>
const fs = require('fs'), path = require('path');
const here = __dirname;
const file = process.argv[2];
if (!file) { console.log('用法：node check.js <AI 回傳的 json 檔>'); process.exit(1); }

let raw = fs.readFileSync(file, 'utf8');
const fence = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/); if (fence) raw = fence[1];
raw = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
const out = JSON.parse(raw);
const { year, groups } = JSON.parse(fs.readFileSync(path.join(here, 'groups.json'), 'utf8'));
const exp = JSON.parse(fs.readFileSync(path.join(here, 'expected.json'), 'utf8'));

const ALL = [...new Set(groups.flatMap(g => g.members))];
const key = s => [...s].sort().join('、');
const ALLKEY = key(ALL);
function resolve(w) {
  if (w == null || (Array.isArray(w) && !w.length)) return { set: new Set(ALL), unknown: [] };
  const set = new Set(), unknown = [];
  (Array.isArray(w) ? w : [w]).forEach(s => {
    const g = groups.find(g => g.name === s);
    if (g) g.members.forEach(m => set.add(m));
    else if (ALL.includes(s)) set.add(s);
    else unknown.push(s);
  });
  return { set, unknown };
}
const label = set => {
  const k = key(set);
  if (!k) return '（無）';
  if (k === ALLKEY) return '全員';
  const g = groups.find(g => key(g.members) === k);
  return g ? g.name : k;
};
const toDate = d => { const [m, dd] = d.split('/').map(Number); return new Date(year, m - 1, dd); };
const fmt = t => `${t.getMonth() + 1}/${t.getDate()}`;
const addDay = (d, n) => { const t = toDate(d); t.setDate(t.getDate() + n); return fmt(t); };

const days = out.days || [];
const cards = days.map(c => {
  const r = resolve(c.with);
  return { c, date: c.date, set: r.set, unknown: r.unknown,
    acts: (c.acts || []).map(a => {
      const ra = a.with ? resolve(a.with) : { set: r.set, unknown: [] };
      return { a, set: ra.set, unknown: ra.unknown };
    }) };
});

// ── 判讀提醒 ──
const alerts = [];
const push = (id, msg) => alerts.push(`${id}  ${msg}`);
cards.forEach(k => {
  k.unknown.forEach(s => push('A-1', `${k.date} 日卡：找不到「${s}」`));
  k.acts.forEach(x => x.unknown.forEach(s => push('A-1', `${k.date}「${x.a.name}」：找不到「${s}」`)));
});
(out.hotels || []).forEach(h => resolve(h.with).unknown.forEach(s => push('A-1', `住宿「${h.name}」：找不到「${s}」`)));
const dates = [...new Set(cards.map(k => k.date))];
dates.forEach(d => ALL.forEach(m => {
  const n = cards.filter(k => k.date === d && k.set.has(m)).length;
  if (n > 1) push('A-2', `${m} ${d} 出現 ${n} 次`);
}));
ALL.forEach(m => {
  const mine = cards.filter(k => k.set.has(m)).map(k => toDate(k.date).getTime());
  if (!mine.length) { push('A-3', `${m} 沒有任何卡`); return; }
  for (let t = Math.min(...mine); t <= Math.max(...mine); t += 864e5) {
    if (!mine.includes(t)) push('A-3', `${fmt(new Date(t))} 沒有 ${m} 的行程`);
  }
});
cards.filter(k => key(k.set) === ALLKEY).forEach(k => {
  const boundary = [-1, 1].some(n => {
    const nd = addDay(k.date, n), cs = cards.filter(x => x.date === nd);
    return cs.length && !cs.some(x => key(x.set) === ALLKEY);
  });
  if (!boundary) return;
  groups.forEach(g => {
    if (!k.acts.some(x => key(x.set) === key(g.members))) push('A-4', `${k.date} ${g.name} 沒有活動`);
  });
});
cards.forEach(k => {
  if (k.c.unsure) push('A-5', `${k.date}（${label(k.set)}）日卡 AI 沒把握`);
  k.acts.forEach(x => { if (x.a.unsure) push('A-5', `${k.date}「${x.a.name}」AI 沒把握`); });
});

// ── 與預期比對 ──
const res = [];
const ok = (b, msg) => res.push(`${b ? '✓' : '✗'}  ${msg}`);
const names = (out.members || []).map(m => m.name);
ok(key(names) === ALLKEY, `成員代號照抄：${names.join('、') || '（無）'}`);
const used = new Set();
exp.cards.forEach(e => {
  const want = [e.with, ...(e.alt || [])].map(w => key(resolve(w).set));
  const i = cards.findIndex((k, j) => !used.has(j) && k.date === e.date && want.includes(key(k.set)));
  if (i < 0) { ok(false, `${e.date} 缺一張「${label(resolve(e.with).set)}」卡`); return; }
  used.add(i);
  const dayOk = cards[i].c.day === e.day;
  ok(dayOk, `${e.date}「${label(cards[i].set)}」卡${dayOk ? '' : `，day 應為 ${e.day}，實際 ${cards[i].c.day}`}`);
});
cards.forEach((k, j) => { if (!used.has(j)) ok(false, `多出一張卡：${k.date}「${label(k.set)}」${k.c.theme || ''}`); });
exp.acts.forEach(e => {
  const re = new RegExp(e.match, 'i');
  const hits = cards.filter(k => k.date === e.date).flatMap(k => k.acts)
    .filter(x => re.test([x.a.name, x.a.sub, x.a.time].join(' ')));
  if (!hits.length) { ok(false, `${e.date} 找不到符合 /${e.match}/ 的活動`); return; }
  const want = key(resolve(e.with).set);
  const good = hits.filter(x => key(x.set) === want);
  if (e.time) ok(hits.some(x => x.a.time === e.time), `${e.date}「${hits[0].a.name}」time 應為 ${e.time}，實際 ${hits.map(x => x.a.time || '（空）').join('／')}`);
  ok(good.length === hits.length, `${e.date}「${hits[0].a.name}」等 ${hits.length} 筆應為「${label(resolve(e.with).set)}」` +
    (good.length === hits.length ? '' : `，實際：${hits.map(x => label(x.set)).join('／')}`));
});
(exp.hotels || []).forEach(e => {
  const want = key(resolve(e.with).set);
  const hs = cards.filter(k => k.date === e.date && k.c.hotel);
  const good = hs.some(k => key(k.c.hotel.with ? resolve(k.c.hotel.with).set : k.set) === want);
  ok(good, `${e.date} 日卡住宿應只屬於「${label(resolve(e.with).set)}」` + (good ? '' : `，實際：${hs.map(k => (k.c.hotel.name || '') + '→' + label(k.c.hotel.with ? resolve(k.c.hotel.with).set : k.set)).join('／') || '（無住宿）'}`));
});
(exp.flights || []).forEach(e => {
  const re = new RegExp(e.match, 'i'), want = key(resolve(e.with).set);
  const fs_ = cards.filter(k => k.date === e.date && k.c.flight && re.test(k.c.flight.num || ''));
  if (!fs_.length) return; // 沒有 flight 物件不算錯（活動裡有就夠）
  const who = k => label(k.c.flight.with ? resolve(k.c.flight.with).set : k.set);
  const good = fs_.every(k => key(k.c.flight.with ? resolve(k.c.flight.with).set : k.set) === want);
  ok(good, `${e.date} 航班 ${fs_[0].c.flight.num} 應只屬於「${label(resolve(e.with).set)}」` + (good ? '' : `，實際：${fs_.map(who).join('／')}`));
});
exp.unsureDates.forEach(d => {
  const has = cards.some(k => k.date === d && (k.c.unsure || k.acts.some(x => x.a.unsure)));
  ok(has, `${d} 有標 unsure`);
});

console.log('\n判讀提醒（產生器會顯示的）');
console.log(alerts.length ? alerts.join('\n') : '（無）');
const pass = res.filter(s => s.startsWith('✓')).length;
console.log(`\n與預期比對：${pass}/${res.length}`);
console.log(res.join('\n'));
