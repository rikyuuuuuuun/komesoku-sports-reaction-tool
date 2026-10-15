'use strict';
const test = require('node:test');
const assert = require('node:assert');
const HC = require('../handicap.js');
const { evaluate } = require('../simulate.js');

const players = [
  { id: 'a', name: 'A', baseline: 84 },
  { id: 'b', name: 'B', baseline: 92 },
  { id: 'c', name: 'C', baseline: 100 }
];

test('ラウンドがなければ自己申告の平均スコア差がハンデになる', () => {
  const res = HC.computeHandicaps(players, [], ['a', 'b', 'c'], { balance: false });
  const h = Object.fromEntries(res.players.map((p) => [p.id, p.hcp]));
  assert.deepStrictEqual(h, { a: 0, b: 8, c: 16 });
});

test('一番上手い人のハンデは0、ハンデは0.5刻み', () => {
  const res = HC.computeHandicaps(players, [], ['a', 'b', 'c']);
  assert.strictEqual(Math.min(...res.players.map((p) => p.hcp)), 0);
  res.players.forEach((p) => assert.strictEqual(p.hcp * 2, Math.round(p.hcp * 2)));
});

test('優勝確率がほぼ均等になる', () => {
  const res = HC.computeHandicaps(players, [], ['a', 'b', 'c']);
  res.players.forEach((p) => assert.ok(Math.abs(p.winProb - 1 / 3) < 0.05, `${p.id}: ${p.winProb}`));
});

test('同じ入力なら同じハンデ(再現性)', () => {
  const a = HC.computeHandicaps(players, [], ['a', 'b', 'c']);
  const b = HC.computeHandicaps(players, [], ['a', 'b', 'c']);
  assert.deepStrictEqual(a.players.map((p) => p.hcp), b.players.map((p) => p.hcp));
});

test('1回の大叩きでハンデは大きく動かない', () => {
  const rounds = [];
  for (let i = 0; i < 5; i++) {
    rounds.push({ id: 'r' + i, date: '2026-05-0' + i, par: 72, entries: [{ pid: 'a', gross: 84 }, { pid: 'b', gross: 92 }] });
  }
  const before = HC.computeHandicaps(players, rounds, ['a', 'b'], { balance: false });
  const disaster = rounds.concat([{ id: 'x', date: '2026-05-09', par: 72, entries: [{ pid: 'a', gross: 84 }, { pid: 'b', gross: 115 }] }]);
  const after = HC.computeHandicaps(players, disaster, ['a', 'b'], { balance: false });
  const hb = (r) => r.players.find((p) => p.id === 'b').hcp;
  const move = hb(after) - hb(before);
  assert.ok(move > 0 && move <= 1.5, `move=${move}`);
});

test('パーが違うコースもパー比で比べる', () => {
  const r70 = [{ id: 'r', date: '2026-01-01', par: 70, entries: [{ pid: 'a', gross: 82 }] }];
  const r72 = [{ id: 'r', date: '2026-01-01', par: 72, entries: [{ pid: 'a', gross: 84 }] }];
  const e70 = HC.estimatePlayer(players[0], r70, {});
  const e72 = HC.estimatePlayer(players[0], r72, {});
  assert.strictEqual(e70.est, e72.est);
});

test('順位はネットの少ない順、同点は同順位', () => {
  const ranked = HC.rankEntries([
    { pid: 'a', gross: 85, hcp: 0 },
    { pid: 'b', gross: 93, hcp: 8 },
    { pid: 'c', gross: 99, hcp: 16 }
  ]);
  assert.deepStrictEqual(ranked.map((e) => [e.pid, e.rank]), [['c', 1], ['a', 2], ['b', 2]]);
});

test('シーズンを通して全員に優勝のチャンスがあり、前回ビリが次に勝ちすぎない', () => {
  const r = evaluate('app', 30, 20, 4);
  const shares = r.winShares.split(' / ').map(parseFloat);
  shares.forEach((s) => assert.ok(s > 17 && s < 33, r.winShares));
  assert.ok(parseFloat(r.lastThenWin) < 36, r.lastThenWin);
});
