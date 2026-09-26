#!/usr/bin/env node
'use strict';
// Builds a standalone test page (__itin_test.html) from the template with a
// mock in-memory Firebase, to verify collaborative itinerary editing locally.
const fs = require('fs');
const path = require('path');

const TMPL = path.join(__dirname, '..', 'generator', 'generator-template.js');
const cfg  = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'generator', 'schema-example.json'), 'utf8'));

let html = Buffer.from(fs.readFileSync(TMPL, 'utf8').match(/B64 = '([^']+)'/)[1], 'base64').toString('utf8');

// 1. strip the two firebase CDN <script> tags (we inject a mock instead)
html = html.replace(/  <script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"><\/script>\n/g, '');

// 2. mock firebase global, injected right before the app's inline script
const MOCK = `<script>
(function(){
  const store = {};
  const listeners = []; // {path, cb}
  function seg(p){ return p.split('/').filter(Boolean); }
  function getAt(p){ let n = store; for (const s of seg(p)) { if (n == null) return null; n = n[s]; } return n === undefined ? null : n; }
  function setAt(p, v){
    const parts = seg(p); let n = store;
    for (let i=0;i<parts.length-1;i++){ n[parts[i]] = n[parts[i]] || {}; n = n[parts[i]]; }
    if (v === null || v === undefined) delete n[parts[parts.length-1]]; else n[parts[parts.length-1]] = v;
  }
  function fire(changed){
    listeners.forEach(l => {
      // fire if the listener path is an ancestor-or-equal of (or descendant of) the changed path
      if (changed.indexOf(l.path) === 0 || l.path.indexOf(changed) === 0) {
        l.cb({ val: () => getAt(l.path) });
      }
    });
  }
  function ref(p){
    return {
      on: (ev, cb) => { listeners.push({path:p, cb}); setTimeout(() => cb({ val: () => getAt(p) }), 0); },
      set: (v) => { setAt(p, v); fire(p); return Promise.resolve(); },
      update: (v) => { const cur = getAt(p) || {}; setAt(p, Object.assign({}, cur, v)); fire(p); return Promise.resolve(); },
      remove: () => { setAt(p, null); fire(p); return Promise.resolve(); },
      push: (v) => { const k = 'k' + Math.random().toString(36).slice(2,9); setAt(p + '/' + k, v); fire(p); return { key: k }; },
    };
  }
  window.firebase = { initializeApp(){}, database(){ return { ref }; } };
})();
</script>
`;
html = html.replace('<script>\n// ─── Trip Config', MOCK + '<script>\n// ─── Trip Config');

// 3. token replacement
const m = cfg.meta;
cfg.firebase = { apiKey: 'AIza-mock-key-for-test', databaseURL: 'https://mock.firebaseio.com' };
const map = {
  '__THEME_COLOR__': m.themeColor, '__THEME_ACCENT__': m.themeAccent, '__THEME_LIGHT__': m.themeLight,
  '__BG_COLOR__': m.bgColor, '__BG_PALE__': m.bgPale,
  '__SHORT_TITLE__': m.shortTitle, '__TRIP_TITLE__': m.title, '__TRIP_SUBTITLE__': m.subtitle,
  '__DATE_PILL__': m.datePill, '__DURATION_PILL__': m.durationPill, '__PEOPLE_PILL__': m.peoplePill,
  '__TRIP_PIN__': '0000',
};
for (const [k,v] of Object.entries(map)) html = html.split(k).join(v);
html = html.replace('__TRIP_CONFIG__', JSON.stringify(cfg));

fs.writeFileSync(path.join(__dirname, '..', '__itin_test.html'), html, 'utf8');
console.log('Wrote __itin_test.html (' + html.length + ' bytes)');
