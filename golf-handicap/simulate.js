/*
 * シーズンを何度もシミュレーションして、ハンデ方式の「接戦度」を比べる。
 *   node simulate.js
 * 実力差のある4人(平均 84 / 90 / 97 / 104、ブレも人それぞれ)が毎回一緒に回る想定。
 */
'use strict';
const HC = require('./handicap.js');

const TRUE = [
  { id: 'a', mean: 12, sd: 3.0 },
  { id: 'b', mean: 18, sd: 4.0 },
  { id: 'c', mean: 25, sd: 5.0 },
  { id: 'd', mean: 32, sd: 6.5 }
];

function rng(seed) {
  const r = HC._internal.mulberry32(seed);
  return () => {
    const u = r() || 1e-12, v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

const METHODS = {
  // ハンデなし
  none: () => TRUE.map(() => 0),
  // 前回の結果だけで差を埋める(よくあるやり方)
  lastRound: (players, rounds) => {
    if (!rounds.length) return TRUE.map(() => 0);
    const last = rounds[rounds.length - 1].entries;
    const min = Math.min(...last.map((e) => e.gross));
    return TRUE.map((t) => last.find((e) => e.pid === t.id).gross - min);
  },
  // このアプリの方式
  app: (players, rounds) => {
    const res = HC.computeHandicaps(players, rounds, TRUE.map((t) => t.id), { sims: 1500 });
    return TRUE.map((t) => res.players.find((p) => p.id === t.id).hcp);
  }
};

function season(method, seed, nRounds) {
  const z = rng(seed);
  // 自己申告の平均スコアは ±4打くらいズレている想定
  const players = TRUE.map((t) => ({ id: t.id, baseline: Math.round(72 + t.mean + 4 * z()) }));
  const rounds = [];
  const log = [];
  for (let k = 0; k < nRounds; k++) {
    const hcps = METHODS[method](players, rounds);
    const entries = TRUE.map((t, i) => ({ pid: t.id, gross: Math.round(72 + t.mean + t.sd * z()), hcp: hcps[i] }));
    const ranked = HC.rankEntries(entries);
    rounds.push({ id: 'r' + k, date: '2026-01-' + String(k).padStart(3, '0'), par: 72, createdAt: k, entries });
    log.push(ranked);
  }
  return log;
}

function evaluate(method, seasons, nRounds, warmup) {
  const wins = {};
  TRUE.forEach((t) => (wins[t.id] = 0));
  let counted = 0, close = 0, oneStroke = 0;
  let lastThenWin = 0, lastCount = 0, winThenWin = 0, winCount = 0;
  for (let s = 0; s < seasons; s++) {
    const log = season(method, 1000 + s, nRounds);
    for (let k = warmup; k < log.length; k++) {
      const ranked = log[k];
      counted++;
      const firsts = ranked.filter((e) => e.rank === 1);
      firsts.forEach((e) => (wins[e.pid] += 1 / firsts.length));
      const margin = firsts.length > 1 ? 0 : ranked[1].net - ranked[0].net;
      if (margin <= 2) close++;
      if (margin <= 1) oneStroke++;
      const prev = log[k - 1];
      const maxRank = Math.max(...prev.map((e) => e.rank));
      prev.forEach((pe) => {
        const now = ranked.find((e) => e.pid === pe.pid);
        if (pe.rank === maxRank) { lastCount++; if (now.rank === 1) lastThenWin++; }
        if (pe.rank === 1) { winCount++; if (now.rank === 1) winThenWin++; }
      });
    }
  }
  const shares = TRUE.map((t) => wins[t.id] / counted);
  return {
    method,
    winShares: shares.map((x) => (x * 100).toFixed(1) + '%').join(' / '),
    spread: ((Math.max(...shares) - Math.min(...shares)) * 100).toFixed(1) + 'pt',
    closeRate: ((close / counted) * 100).toFixed(1) + '%',
    oneStrokeRate: ((oneStroke / counted) * 100).toFixed(1) + '%',
    lastThenWin: ((lastThenWin / lastCount) * 100).toFixed(1) + '%',
    winThenWin: ((winThenWin / winCount) * 100).toFixed(1) + '%'
  };
}

if (require.main === module) {
  const seasons = Number(process.argv[2] || 60);
  const rows = Object.keys(METHODS).map((m) => evaluate(m, seasons, 24, 4));
  console.log(`4人 × 24ラウンド × ${seasons}シーズン(最初の4ラウンドは除外)`);
  console.log('理想: 各人の優勝率 25% 前後、前回ビリ/前回優勝が次に勝つ率も 25% 前後');
  console.table(rows);
}

module.exports = { evaluate };
