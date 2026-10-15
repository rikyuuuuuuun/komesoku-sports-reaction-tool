/*
 * ヒリヒリ・ハンデ帳 — ハンデ計算エンジン
 *
 * 考え方
 *   1. 各自の「実力推定」= 最近のスコア(パー比)の重み付き平均。
 *      直近ほど重く、自己申告の平均スコアを「最初の2ラウンド分」として混ぜる。
 *   2. 実力推定の差をそのままハンデにする → 全員のネット期待値が揃う。
 *      勝敗はその日の出来(ブレ)で決まるので、毎回接戦になる。
 *   3. 1ラウンドの影響は小さく、推定から±clip打を超える大叩き/ベストはカット。
 *      だから「前回ビリ → 今回は確実に1位」にはならないし、わざと崩しても得しない。
 *   4. スコアのブレが大きい人は一発がある分だけ有利なので、
 *      モンテカルロで全員の優勝確率が揃うようにハンデを微調整する。
 *
 * ブラウザでは window.GolfHC、Node では module.exports で使える。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GolfHC = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    window: 16,          // 実力推定に使う直近ラウンド数
    decay: 0.9,          // 1ラウンド古くなるごとの重み(0.9 ≒ 7ラウンドで半分)
    priorWeight: 2,      // 自己申告平均スコアを何ラウンド分として扱うか
    clip: 8,             // 実力推定から±何打を超えた分をカットするか
    sigmaDefault: 4.5,   // ラウンドごとのブレ(標準偏差)の初期値
    sigmaPriorWeight: 1.5,
    reward: 0,           // 上手い人ボーナス(0〜0.3)。ハンデをこの割合だけ縮める
    step: 0.5,           // ハンデの刻み
    balance: true,       // 優勝確率が揃うよう微調整する
    sims: 4000,          // シミュレーション回数
    close: 2,            // 「接戦」とみなす1位と2位の差(打)
    par: 72
  };

  function withDefaults(s) {
    var out = {};
    for (var k in DEFAULTS) out[k] = DEFAULTS[k];
    if (s) for (var j in s) if (s[j] !== undefined && s[j] !== null && s[j] !== '') out[j] = s[j];
    return out;
  }

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function sortRounds(rounds) {
    return rounds.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  // 1人分のパー比スコアの履歴(古い順)
  function history(pid, sortedRounds) {
    var out = [];
    for (var i = 0; i < sortedRounds.length; i++) {
      var r = sortedRounds[i];
      var entries = r.entries || [];
      for (var j = 0; j < entries.length; j++) {
        var e = entries[j];
        if (e.pid === pid && isNum(e.gross)) {
          out.push({ diff: e.gross - (isNum(r.par) ? r.par : 72), roundId: r.id, date: r.date });
        }
      }
    }
    return out;
  }

  function weightedEstimate(prior, clipped, s) {
    var vals = clipped.slice(-s.window);
    var n = vals.length;
    var num = 0, den = 0;
    for (var i = 0; i < n; i++) {
      var w = Math.pow(s.decay, n - 1 - i);
      num += w * vals[i];
      den += w;
    }
    var pw = s.priorWeight * Math.pow(s.decay, n);
    return { est: (num + pw * prior) / (den + pw), sumW: den, priorW: pw, vals: vals };
  }

  // 実力推定。est はパー比(+20 なら パー72で平均92 相当)
  function estimatePlayer(player, sortedRounds, settings) {
    var s = withDefaults(settings);
    var prior = (isNum(player.baseline) ? player.baseline : 100) - 72;
    var hist = history(player.id, sortedRounds);
    var clipped = [];
    var cur = prior;
    for (var i = 0; i < hist.length; i++) {
      // 「その時点の実力推定」から大きく外れた分はカット(大叩き・まぐれの影響を抑える)
      clipped.push(clamp(hist[i].diff, cur - s.clip, cur + s.clip));
      cur = weightedEstimate(prior, clipped, s).est;
    }
    var fin = weightedEstimate(prior, clipped, s);
    var n = fin.vals.length;
    var ss = 0;
    for (var k = 0; k < n; k++) {
      var w = Math.pow(s.decay, n - 1 - k);
      ss += w * Math.pow(fin.vals[k] - fin.est, 2);
    }
    var sigma = Math.sqrt((s.sigmaPriorWeight * s.sigmaDefault * s.sigmaDefault + ss) / (s.sigmaPriorWeight + fin.sumW));
    sigma = clamp(sigma, 2.5, 9);
    // 推定そのものの不確かさ(ラウンド数が少ない人ほど大きい)も含めたブレ
    var sigmaEff = Math.sqrt(sigma * sigma * (1 + 1 / (fin.sumW + fin.priorW)));
    return {
      id: player.id,
      est: fin.est,
      sigma: sigma,
      sigmaEff: sigmaEff,
      rounds: hist.length,
      lastDiff: hist.length ? hist[hist.length - 1].diff : null
    };
  }

  // 再現性のある乱数(同じ入力なら同じハンデになる)
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function normals(rand, count) {
    var out = new Float64Array(count);
    for (var i = 0; i < count; i += 2) {
      var u = rand() || 1e-12, v = rand();
      var r = Math.sqrt(-2 * Math.log(u));
      out[i] = r * Math.cos(2 * Math.PI * v);
      if (i + 1 < count) out[i + 1] = r * Math.sin(2 * Math.PI * v);
    }
    return out;
  }

  // ネットスコアをシミュレーションして、優勝確率と接戦度を出す
  function simulate(ests, hcps, Z, sims, closeLimit) {
    var n = ests.length;
    var wins = new Float64Array(n);
    var close = 0, oneStroke = 0, marginSum = 0;
    var net = new Float64Array(n);
    for (var s = 0; s < sims; s++) {
      var best = Infinity, second = Infinity;
      for (var i = 0; i < n; i++) {
        // 実際のスコアは整数なので丸める
        net[i] = Math.round(ests[i].est + ests[i].sigmaEff * Z[s * n + i]) - hcps[i];
        if (net[i] < best) { second = best; best = net[i]; }
        else if (net[i] < second) second = net[i];
      }
      var tied = 0;
      for (var t = 0; t < n; t++) if (net[t] === best) tied++;
      for (var u = 0; u < n; u++) if (net[u] === best) wins[u] += 1 / tied;
      var margin = tied > 1 ? 0 : second - best;
      marginSum += margin;
      if (margin <= closeLimit) close++;
      if (margin <= 1) oneStroke++;
    }
    var p = [];
    for (var k = 0; k < n; k++) p.push(wins[k] / sims);
    return { winProb: p, closeProb: close / sims, oneStrokeProb: oneStroke / sims, meanMargin: marginSum / sims };
  }
  function roundTo(x, step) { return Math.round(x / step) * step; }

  /*
   * 今日のハンデを計算する。
   *   players: [{id, name, baseline}]  baseline = 自己申告の平均スコア(パー72換算)
   *   rounds:  [{id, date, par, entries:[{pid, gross}]}]
   *   pids:    今日の参加者
   * 戻り値の hcp を グロスから引いたものがネット。
   */
  function computeHandicaps(players, rounds, pids, settings) {
    var s = withDefaults(settings);
    var byId = {};
    players.forEach(function (p) { byId[p.id] = p; });
    var field = pids.filter(function (id) { return byId[id]; });
    var sorted = sortRounds(rounds);
    var ests = field.map(function (id) { return estimatePlayer(byId[id], sorted, s); });
    var n = ests.length;
    if (n === 0) return { players: [], winProb: [], closeProb: 0, oneStrokeProb: 0, meanMargin: 0 };

    var minEst = Math.min.apply(null, ests.map(function (e) { return e.est; }));
    var base = ests.map(function (e) { return e.est - minEst; });
    var h = base.slice();

    var sims = n > 1 ? s.sims : 0;
    var seed = hashString(field.join(',') + '|' + sorted.length + '|' + ests.map(function (e) { return e.est.toFixed(3); }).join(','));
    var Z = sims ? normals(mulberry32(seed), sims * n) : null;

    if (s.balance && n > 1) {
      // 優勝確率が 1/n より高い人はハンデを減らし、低い人は増やす
      var target = 1 / n;
      for (var iter = 0; iter < 40; iter++) {
        var simRes = simulateContinuous(ests, h, Z, sims);
        var maxGap = 0;
        for (var i = 0; i < n; i++) {
          var gap = simRes[i] - target;
          maxGap = Math.max(maxGap, Math.abs(gap));
          h[i] = clamp(h[i] - 6 * gap, base[i] - 3, base[i] + 3);
        }
        if (maxGap < 0.004) break;
      }
    }

    var minH = Math.min.apply(null, h);
    var reward = clamp(s.reward, 0, 0.5);
    var hcps = h.map(function (x) { return Math.max(0, roundTo((x - minH) * (1 - reward), s.step)); });
    var minR = Math.min.apply(null, hcps);
    hcps = hcps.map(function (x) { return x - minR; });

    var stats = n > 1 ? simulate(ests, hcps, Z, sims, s.close) : { winProb: [1], closeProb: 1, oneStrokeProb: 1, meanMargin: 0 };
    return {
      players: ests.map(function (e, i) {
        return {
          id: e.id,
          est: e.est,
          sigma: e.sigma,
          rounds: e.rounds,
          hcp: hcps[i],
          winProb: stats.winProb[i],
          expectedNet: e.est + s.par - hcps[i]
        };
      }),
      closeProb: stats.closeProb,
      oneStrokeProb: stats.oneStrokeProb,
      meanMargin: stats.meanMargin
    };
  }

  // 調整用:丸めない連続値で優勝確率を出す(調整が滑らかに収束する)
  function simulateContinuous(ests, h, Z, sims) {
    var n = ests.length;
    var wins = new Float64Array(n);
    for (var s = 0; s < sims; s++) {
      var best = Infinity, bi = 0;
      for (var i = 0; i < n; i++) {
        var v = ests[i].est + ests[i].sigmaEff * Z[s * n + i] - h[i];
        if (v < best) { best = v; bi = i; }
      }
      wins[bi]++;
    }
    var p = [];
    for (var k = 0; k < n; k++) p.push(wins[k] / sims);
    return p;
  }

  // ラウンドの順位付け(ネットの少ない順、同点は同順位)
  function rankEntries(entries) {
    var list = entries.filter(function (e) { return isNum(e.gross); }).map(function (e) {
      var hcp = isNum(e.hcp) ? e.hcp : 0;
      return { pid: e.pid, gross: e.gross, hcp: hcp, net: e.gross - hcp };
    });
    list.sort(function (a, b) { return a.net - b.net || a.gross - b.gross; });
    for (var i = 0; i < list.length; i++) {
      list[i].rank = i > 0 && list[i].net === list[i - 1].net ? list[i - 1].rank : i + 1;
    }
    return list;
  }

  // 通算成績
  function standings(players, rounds, settings) {
    var sorted = sortRounds(rounds);
    var rows = {};
    players.forEach(function (p) {
      rows[p.id] = { id: p.id, rounds: 0, wins: 0, rankSum: 0, lastRanks: [] };
    });
    sorted.forEach(function (r) {
      var ranked = rankEntries(r.entries || []);
      var size = ranked.length;
      ranked.forEach(function (e) {
        var row = rows[e.pid];
        if (!row) return;
        row.rounds++;
        if (e.rank === 1) row.wins++;
        // 人数が違うラウンドを比べられるよう 0(1位)〜1(最下位) に正規化
        row.rankSum += size > 1 ? (e.rank - 1) / (size - 1) : 0;
        row.lastRanks.push(e.rank + '/' + size);
      });
    });
    return players.map(function (p) {
      var row = rows[p.id];
      var est = estimatePlayer(p, sorted, settings);
      return {
        id: p.id,
        rounds: row.rounds,
        wins: row.wins,
        avgRankPos: row.rounds ? row.rankSum / row.rounds : null,
        lastRanks: row.lastRanks.slice(-5),
        est: est.est,
        sigma: est.sigma
      };
    });
  }

  return {
    DEFAULTS: DEFAULTS,
    withDefaults: withDefaults,
    sortRounds: sortRounds,
    estimatePlayer: estimatePlayer,
    computeHandicaps: computeHandicaps,
    rankEntries: rankEntries,
    standings: standings,
    _internal: { mulberry32: mulberry32, normals: normals, history: history }
  };
});
