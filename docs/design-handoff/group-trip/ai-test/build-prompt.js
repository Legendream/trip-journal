// 由 generator-app.js 現有的 PARSE_PROMPT 組出「分組版」提示詞，輸出 prompt.txt
// 用法：node build-prompt.js   （在 ai-test 資料夾內）
const fs = require('fs'), path = require('path');
const here = __dirname;
const src = fs.readFileSync(path.join(here, '../../../../generator/generator-app.js'), 'utf8');
const m = src.match(/const PARSE_PROMPT = `([\s\S]*?)`;/);
if (!m) throw new Error('找不到 PARSE_PROMPT');
const base = eval('`' + m[1] + '`');
const { groups } = JSON.parse(fs.readFileSync(path.join(here, 'groups.json'), 'utf8'));
const list = groups.map(g => `- ${g.name}：${g.members.join('、')}`).join('\n');
const section = fs.readFileSync(path.join(here, 'group-section.txt'), 'utf8').replace('{分組清單}', list);
const anchor = 'JSON Schema（嚴格遵守）：';
if (!base.includes(anchor)) throw new Error('找不到插入點');
const prompt = base.replace(anchor, section + anchor);
const draft = fs.readFileSync(path.join(here, 'draft.txt'), 'utf8');
fs.writeFileSync(path.join(here, 'prompt.txt'), prompt + draft);
console.log('prompt.txt 已產生，' + (prompt + draft).length + ' 字');
