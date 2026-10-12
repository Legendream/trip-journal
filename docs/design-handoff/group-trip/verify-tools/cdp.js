// 最小的 Chrome DevTools Protocol 驅動（Node 24 內建 WebSocket）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let port = 9400 + Math.floor(Math.random() * 400);
async function launch({ width = 390, height = 844 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const p = port++;
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + p, '--user-data-dir=' + dir,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${p}/json`)).json(); if (targets.length) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  const api = {
    logs,
    async goto(url) { await send('Page.navigate', { url }); await new Promise(r => setTimeout(r, 1200)); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
    async setClock(iso) { // 固定「現在」：覆寫 Date
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const R=Date,off=new R('${iso}').getTime()-R.now();class D extends R{constructor(...a){a.length?super(...a):super(R.now()+off)}static now(){return R.now()+off}};window.Date=D;})()` });
    },
    async sleep(ms) { await new Promise(r => setTimeout(r, ms)); },
    async close() { try { await send('Browser.close'); } catch (e) {} ws.close(); proc.kill(); },
  };
  return api;
}
module.exports = { launch };
