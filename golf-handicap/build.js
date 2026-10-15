/*
 * index.html に handicap.js と app.js を埋め込んで、1ファイルで動く HTML を作る。
 *   node build.js   → dist/hirihiri-handicap.html
 * できたファイルはスマホやPCのブラウザで開くだけで使える(データはその端末に保存)。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const inline = (code) => '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';

let body = read('index.html')
  .replace('<script src="handicap.js"></script>', () => inline(read('handicap.js')))
  .replace('<script src="app.js"></script>', () => inline(read('app.js')));

// index.html は head/body を省いた形なので、単体で開けるように包む
const headEnd = body.indexOf('</style>') + '</style>'.length;
const head = body.slice(0, headEnd);
const rest = body.slice(headEnd);
const html = '<!doctype html>\n<html lang="ja">\n<head>\n' + head + '\n</head>\n<body>' + rest + '</body>\n</html>\n';

fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist', 'hirihiri-handicap.html'), html);
console.log('dist/hirihiri-handicap.html', Buffer.byteLength(html), 'bytes');
