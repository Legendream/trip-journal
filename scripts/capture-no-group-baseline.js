// 把「沒分組」行程的匯出設定檔與提示詞存成基準檔（規則 7：這些輸出不能因分組功能而改變）。
// 用法：node scripts/capture-no-group-baseline.js <generator-app.js 路徑> <輸出資料夾>
// 基準檔是用分組功能加入前（main b6d8c41）的 generator-app.js 產生的。
const fs = require('fs'), path = require('path');
const { loadGenerator, root } = require('./lib/gen-sandbox');

const SAMPLE_TRIP_TEXT = '4/15 抵達仙台，住仙台國際飯店\n4/16 松島遊船';

function capture(appPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'generator/schema-example.json'), 'utf8'));

  // 路線 1：匯入既有設定檔 → 匯出
  let g = loadGenerator({ appPath });
  g.ctx.__cfg = JSON.parse(JSON.stringify(cfg));
  g.run('importLoadedConfig(__cfg)');
  fs.writeFileSync(path.join(outDir, 'schema-example.export.json'), JSON.stringify(g.run('collectConfig()'), null, 2) + '\n');

  // 路線 2：當成 AI 回傳的 JSON 匯入 → 匯出
  g = loadGenerator({ appPath });
  g.ctx.__cfg = JSON.parse(JSON.stringify(cfg));
  g.run('applyParsedData(__cfg)');
  fs.writeFileSync(path.join(outDir, 'schema-example.ai-import.export.json'), JSON.stringify(g.run('collectConfig()'), null, 2) + '\n');

  // 提示詞
  g = loadGenerator({ appPath });
  g.el('trip-text').value = SAMPLE_TRIP_TEXT;
  fs.writeFileSync(path.join(outDir, 'prompt.txt'), g.run('buildPrompt()'));
}

if (require.main === module) {
  const [appPath, outDir] = process.argv.slice(2);
  if (!appPath || !outDir) { console.log('用法：node scripts/capture-no-group-baseline.js <generator-app.js> <輸出資料夾>'); process.exit(1); }
  capture(path.resolve(appPath), path.resolve(outDir));
  console.log('已存到 ' + outDir);
}
module.exports = { capture, SAMPLE_TRIP_TEXT };
