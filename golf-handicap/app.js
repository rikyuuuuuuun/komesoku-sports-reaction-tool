/* ヒリヒリ・ハンデ帳 — 画面 */
(function () {
  'use strict';
  var HC = window.GolfHC;
  var LS_KEY = 'golf-hc-v1';
  var DRAFT_KEY = 'golf-hc-draft-v1';

  // ---------- 保存先 ----------
  // claude.ai のアーティファクトとして開いたときは仲間と共有のDB、それ以外はこの端末の localStorage

  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function stripId(o) {
    var out = {};
    for (var k in o) if (k !== 'id') out[k] = o[k];
    return out;
  }

  function dbStore(db) {
    var st = { players: null, rounds: null, settings: null };
    var cb = function () {};
    function emit() {
      if (st.players && st.rounds && st.settings) cb({ players: st.players, rounds: st.rounds, settings: st.settings });
    }
    function onErr(e) { toast('共有データの読み込みが止まりました。ページを開き直してください。(' + (e && e.code) + ')'); }
    function docs(snap) { return snap.docs.map(function (d) { var o = Object.assign({}, d.data()); o.id = d.id; return o; }); }
    return {
      kind: 'shared',
      subscribe: function (fn) {
        cb = fn;
        db.collection('players').onSnapshot(function (s) { st.players = docs(s); emit(); }, onErr);
        db.collection('rounds').onSnapshot(function (s) { st.rounds = docs(s); emit(); }, onErr);
        db.doc('config/settings').onSnapshot(function (d) { st.settings = d.exists ? Object.assign({}, d.data()) : {}; emit(); }, onErr);
      },
      savePlayer: function (p) { return db.doc('players/' + p.id).set(stripId(p)); },
      deletePlayer: function (id) { return db.doc('players/' + id).delete(); },
      saveRound: function (r) { return db.doc('rounds/' + r.id).set(stripId(r)); },
      deleteRound: function (id) { return db.doc('rounds/' + id).delete(); },
      saveSettings: function (s) { return db.doc('config/settings').set(s); }
    };
  }

  function localStore() {
    var mem = { players: [], rounds: [], settings: {} };
    try { var raw = localStorage.getItem(LS_KEY); if (raw) mem = JSON.parse(raw); } catch (e) { /* 保存できない環境ではメモリのみ */ }
    var cb = function () {};
    function commit() {
      try { localStorage.setItem(LS_KEY, JSON.stringify(mem)); } catch (e) { /* noop */ }
      cb({ players: mem.players.slice(), rounds: mem.rounds.slice(), settings: Object.assign({}, mem.settings) });
      return Promise.resolve();
    }
    function upsert(list, item) {
      var i = list.findIndex(function (x) { return x.id === item.id; });
      if (i >= 0) list[i] = item; else list.push(item);
    }
    return {
      kind: 'local',
      subscribe: function (fn) { cb = fn; commit(); },
      savePlayer: function (p) { upsert(mem.players, p); return commit(); },
      deletePlayer: function (id) { mem.players = mem.players.filter(function (p) { return p.id !== id; }); return commit(); },
      saveRound: function (r) { upsert(mem.rounds, r); return commit(); },
      deleteRound: function (id) { mem.rounds = mem.rounds.filter(function (r) { return r.id !== id; }); return commit(); },
      saveSettings: function (s) { mem.settings = s; return commit(); }
    };
  }

  // ---------- 状態 ----------
  var S = {
    store: null,
    loaded: false,
    data: { players: [], rounds: [], settings: {} },
    demo: false,
    tab: 'today',
    draft: loadDraft(),
    lastSaved: null,
    confirm: null,     // 削除確認中のID
    exportText: '',
    importText: '',
    pendingRender: false
  };

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function loadDraft() {
    var d = null;
    try { d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { /* noop */ }
    return Object.assign({ pids: null, date: todayStr(), course: '', par: 72, gross: {} }, d || {});
  }
  function saveDraft() {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(S.draft)); } catch (e) { /* noop */ }
  }

  // サンプル(DBが空のときだけ画面に出す。保存はしない)
  function demoData() {
    var players = [
      { id: 'demo-1', name: 'ケンジ', baseline: 86, demo: true },
      { id: 'demo-2', name: 'ゆうた', baseline: 93, demo: true },
      { id: 'demo-3', name: 'まさし', baseline: 99, demo: true },
      { id: 'demo-4', name: 'たくや', baseline: 108, demo: true }
    ];
    var trueMean = [85, 94, 98, 106], sd = [3, 4, 5, 6.5];
    var rand = HC._internal.mulberry32(20261015);
    var z = HC._internal.normals(rand, 64);
    var rounds = [];
    var courses = ['房総カントリー', '鶴舞CC', '大多喜城GC', '房総カントリー', '平川CC', '鶴舞CC', '房総カントリー', '大多喜城GC'];
    for (var k = 0; k < 8; k++) {
      var ids = players.map(function (p) { return p.id; });
      var hc = HC.computeHandicaps(players, rounds, ids, { sims: 1500 });
      var entries = players.map(function (p, i) {
        return { pid: p.id, gross: Math.round(trueMean[i] + sd[i] * z[k * 4 + i]), hcp: hc.players[i].hcp };
      });
      var date = new Date(2026, 4 + Math.floor(k / 2), 6 + (k % 2) * 14);
      rounds.push({
        id: 'demo-r' + k, demo: true, course: courses[k], par: 72, createdAt: k, entries: entries,
        date: date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
      });
    }
    return { players: players, rounds: rounds };
  }

  var demoCache = null;
  function view() {
    if (S.demo) {
      var d = demoCache || (demoCache = demoData());
      return { players: d.players, rounds: d.rounds, settings: S.data.settings };
    }
    return S.data;
  }
  function settings() { return HC.withDefaults(view().settings); }
  var hcMemo = { key: '', value: null };
  function handicapsFor(pids, extraRounds) {
    var v = view();
    var rounds = extraRounds ? v.rounds.concat(extraRounds) : v.rounds;
    var key = JSON.stringify([pids, v.players, rounds, v.settings]);
    if (hcMemo.key === key) return hcMemo.value;
    var value = HC.computeHandicaps(v.players, rounds, pids, settings());
    hcMemo = { key: key, value: value };
    return value;
  }
  function activePlayers() { return view().players.filter(function (p) { return !p.archived; }).sort(byName); }
  function byName(a, b) { return (a.createdAt || 0) - (b.createdAt || 0) || String(a.name).localeCompare(String(b.name), 'ja'); }
  function playerName(id) {
    var p = view().players.find(function (x) { return x.id === id; });
    return p ? p.name : '(削除済み)';
  }

  // ---------- 小物 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtH(h) { return (Math.round(h * 10) / 10).toFixed(h % 1 ? 1 : 0); }
  function fmtPct(p) { return Math.round(p * 100) + '%'; }
  function fmtDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? Number(m[2]) + '/' + Number(m[3]) : esc(s);
  }
  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }
  function guard(promise, okMsg) {
    return Promise.resolve(promise).then(function () { if (okMsg) toast(okMsg); }).catch(function (e) {
      var code = e && e.code;
      if (code === 'invalid_argument') toast('保存できませんでした。閲覧のみの権限の可能性があります。');
      else if (code === 'quota_exceeded') toast('保存容量がいっぱいです。古いラウンドを削除してください。');
      else toast('保存できませんでした。通信を確認してもう一度お試しください。');
    });
  }

  function lastHcp(pid) {
    var rs = HC.sortRounds(view().rounds);
    for (var i = rs.length - 1; i >= 0; i--) {
      var e = (rs[i].entries || []).find(function (x) { return x.pid === pid; });
      if (e && typeof e.hcp === 'number') return e.hcp;
    }
    return null;
  }

  function todayPids() {
    var act = activePlayers().map(function (p) { return p.id; });
    if (!S.draft.pids) return act;
    return S.draft.pids.filter(function (id) { return act.indexOf(id) >= 0; });
  }

  // ---------- 今日のハンデ ----------
  function renderToday() {
    var act = activePlayers();
    var out = [];
    if (S.demo) {
      out.push('<div class="banner"><span>いまはサンプルの4人で表示しています。メンバーを登録すると消えます。</span><button class="btn sm primary" data-action="goto" data-tab="members">メンバーを登録する</button></div>');
    }
    if (S.lastSaved) out.push(renderLastSaved());
    if (act.length < 2) {
      out.push('<section class="card"><div class="card-h"><h2>今日のハンデ</h2></div><div class="empty">ハンデを出すにはメンバーが2人以上必要です。「メンバー」タブで仲間を登録してください。</div></section>');
      return out.join('');
    }
    var pids = todayPids();
    out.push('<section class="card"><div class="card-h"><h2>今日回るメンバー</h2><span class="sub">タップで参加/不参加</span></div><div class="card-b"><div class="chips">' +
      act.map(function (p) {
        var on = pids.indexOf(p.id) >= 0;
        return '<button class="chip" data-action="toggle-pid" data-id="' + esc(p.id) + '" aria-pressed="' + on + '">' + esc(p.name) + '</button>';
      }).join('') + '</div></div></section>');

    if (pids.length < 2) {
      out.push('<section class="card"><div class="empty">2人以上選ぶとハンデが出ます。</div></section>');
      return out.join('');
    }
    var s = settings();
    var res = handicapsFor(pids);
    var rows = res.players.slice().sort(function (a, b) { return a.hcp - b.hcp; });
    var n = rows.length;
    var maxP = Math.max.apply(null, rows.map(function (r) { return r.winProb; }));
    var scale = Math.min(1, Math.max(2 / n, maxP * 1.15));
    var spread = Math.max.apply(null, rows.map(function (r) { return r.winProb; })) - Math.min.apply(null, rows.map(function (r) { return r.winProb; }));

    out.push('<section class="card"><div class="card-h"><h2>今日のハンデ</h2><span class="sub">ネット = グロス − ハンデ</span></div>' +
      '<div class="meter">' +
        '<div><span class="k">ヒリヒリ度</span><span class="v hot">' + Math.round(res.closeProb * 100) + '<small>%</small></span><span class="k">1位と2位が' + s.close + '打差以内になる確率</span></div>' +
        '<div><span class="k">1位と2位の差</span><span class="v">' + res.meanMargin.toFixed(1) + '<small>打</small></span><span class="k">予想の平均</span></div>' +
        '<div><span class="k">優勝確率の差</span><span class="v">' + Math.round(spread * 100) + '<small>pt</small></span><span class="k">一番高い人と低い人</span></div>' +
      '</div>' +
      '<div class="sc-scroll"><table class="sc"><thead><tr><th>名前</th><th class="r">ハンデ</th><th class="r">前回比</th><th>優勝確率</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var prev = lastHcp(r.id);
        var d = '';
        if (prev !== null) {
          var diff = Math.round((r.hcp - prev) * 10) / 10;
          d = diff === 0 ? '<span class="muted">±0</span>' : '<span class="' + (diff > 0 ? 'delta-up' : 'delta-down') + '">' + (diff > 0 ? '+' : '−') + fmtH(Math.abs(diff)) + '</span>';
        } else d = '<span class="muted">初</span>';
        return '<tr><td class="name">' + esc(playerName(r.id)) + '</td><td class="num big">' + fmtH(r.hcp) + '</td><td class="num" style="font-size:16px">' + d + '</td>' +
          '<td><div class="prob"><div class="bar" aria-hidden="true"><i style="width:' + (r.winProb / scale * 100).toFixed(1) + '%"></i><b style="left:calc(' + (1 / n / scale * 100).toFixed(1) + '% - 1px)"></b></div><span>' + fmtPct(r.winProb) + '</span></div></td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="card-b"><p class="small muted">黄色の線が「全員同じ確率」のライン(' + fmtPct(1 / n) + ')。前回比は、その人が前回のラウンドで使ったハンデとの差です。</p></div></section>');

    out.push(renderEntry(res, s));
    return out.join('');
  }

  function renderEntry(res, s) {
    var d = S.draft;
    var hcpOf = {};
    res.players.forEach(function (p) { hcpOf[p.id] = p.hcp; });
    var rows = res.players.map(function (p) {
      var g = d.gross[p.id];
      return '<tr><td class="name">' + esc(playerName(p.id)) + '</td>' +
        '<td class="r"><input class="gross" id="gross-' + esc(p.id) + '" data-gross="' + esc(p.id) + '" type="number" inputmode="numeric" min="50" max="200" placeholder="—" value="' + (g == null ? '' : esc(g)) + '" aria-label="' + esc(playerName(p.id)) + 'のグロス"></td>' +
        '<td class="num">' + fmtH(p.hcp) + '</td>' +
        '<td class="num big" data-net="' + esc(p.id) + '">' + (isValidGross(g) ? fmtH(g - p.hcp) : '<span class="muted">—</span>') + '</td></tr>';
    }).join('');
    return '<section class="card"><div class="card-h"><h2>スコアを入れる</h2><span class="sub">上がったらグロスを入力</span></div>' +
      '<div class="card-b"><div class="form-row">' +
        '<div class="field"><label for="f-date">日付</label><input type="date" id="f-date" data-draft="date" value="' + esc(d.date) + '"></div>' +
        '<div class="field" style="flex-basis:180px"><label for="f-course">コース</label><input type="text" id="f-course" data-draft="course" placeholder="例:房総カントリー" value="' + esc(d.course) + '"></div>' +
        '<div class="field" style="flex:0 1 90px"><label for="f-par">パー</label><input type="number" id="f-par" data-draft="par" inputmode="numeric" min="54" max="80" value="' + esc(d.par) + '"></div>' +
      '</div></div>' +
      '<div class="sc-scroll"><table class="sc"><thead><tr><th>名前</th><th class="r">グロス</th><th class="r">ハンデ</th><th class="r">ネット</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="card-b"><div id="live">' + renderLive(res) + '</div>' +
      '<div class="actions"><button class="btn primary" data-action="save-round" id="save-round">このラウンドを記録</button>' +
      '<button class="btn ghost sm" data-action="clear-scores">入力を消す</button></div>' +
      (S.demo ? '<p class="small muted">サンプル表示中は記録できません。</p>' : '') +
      '</div></section>';
  }

  function isValidGross(g) { return typeof g === 'number' && isFinite(g) && g >= 50 && g <= 200; }

  function currentEntries(res) {
    return res.players.filter(function (p) { return isValidGross(S.draft.gross[p.id]); }).map(function (p) {
      return { pid: p.id, gross: S.draft.gross[p.id], hcp: p.hcp };
    });
  }

  function renderLive(res) {
    var entries = currentEntries(res);
    if (entries.length < 2) return '<p class="small muted">2人以上入力すると順位が出ます。</p>';
    var ranked = HC.rankEntries(entries);
    var top = ranked[0], second = ranked[1];
    var margin = second.net - top.net;
    var line = margin === 0 ? '同点で並んでいます' : '2位と' + fmtH(margin) + '打差';
    return '<div class="result-hero"><span class="eyebrow">いまの順位</span><span class="who"><span class="flag">▶</span> ' +
      ranked.filter(function (e) { return e.rank === 1; }).map(function (e) { return esc(playerName(e.pid)); }).join('・') + '</span>' +
      '<span class="small muted">' + line + ' / ' + ranked.map(function (e) { return e.rank + '位 ' + esc(playerName(e.pid)) + '(' + fmtH(e.net) + ')'; }).join('、') + '</span></div>';
  }

  function renderLastSaved() {
    var L = S.lastSaved;
    var ranked = HC.rankEntries(L.round.entries);
    var winners = ranked.filter(function (e) { return e.rank === 1; });
    var margin = ranked.length > 1 ? ranked[1].net - ranked[0].net : 0;
    var rows = ranked.map(function (e) {
      var nx = L.next[e.pid];
      var diff = nx == null ? null : Math.round((nx - e.hcp) * 10) / 10;
      var dtxt = diff == null ? '' : diff === 0 ? '<span class="muted">±0</span>' : '<span class="' + (diff > 0 ? 'delta-up' : 'delta-down') + '">' + (diff > 0 ? '+' : '−') + fmtH(Math.abs(diff)) + '</span>';
      return '<tr class="' + (e.rank === 1 ? 'rank1' : '') + '"><td class="num">' + e.rank + '</td><td class="name">' + esc(playerName(e.pid)) + '</td><td class="num">' + e.gross + '</td><td class="num">' + fmtH(e.net) + '</td><td class="num" style="font-size:16px">' + (nx == null ? '—' : fmtH(nx) + ' ' + dtxt) + '</td></tr>';
    }).join('');
    return '<section class="card"><div class="card-h"><h2>記録しました</h2><button class="btn ghost sm" data-action="dismiss-saved">閉じる</button></div>' +
      '<div class="card-b"><div class="result-hero"><span class="eyebrow">' + fmtDate(L.round.date) + ' ' + esc(L.round.course || '') + '</span>' +
      '<span class="who"><span class="flag">▶</span> ' + winners.map(function (e) { return esc(playerName(e.pid)); }).join('・') + ' の優勝</span>' +
      '<span class="small muted">' + (margin === 0 ? '同点優勝' : '2位とネット' + fmtH(margin) + '打差') + '</span></div></div>' +
      '<div class="sc-scroll"><table class="sc"><thead><tr><th>順位</th><th>名前</th><th class="r">グロス</th><th class="r">ネット</th><th class="r">次回ハンデ</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="card-b"><p class="small muted">次回ハンデは同じメンバーで回った場合の目安です。1回の結果で動くのは1打前後なので、負けた人が次に必ず勝てるわけではありません。</p></div></section>';
  }

  // ---------- 成績 ----------
  function renderRecords() {
    var v = view();
    var out = [];
    if (S.demo) out.push('<div class="banner"><span>サンプルの成績を表示しています。</span></div>');
    if (!v.rounds.length) {
      out.push('<section class="card"><div class="card-h"><h2>通算成績</h2></div><div class="empty">まだラウンドの記録がありません。「今日のハンデ」でスコアを入れて記録すると、ここに優勝回数や調子が出ます。</div></section>');
      return out.join('');
    }
    var s = settings();
    var st = HC.standings(v.players, v.rounds, s).filter(function (r) { return r.rounds > 0; });
    // 均等なら何回優勝しているはずか(ラウンドごとに 1/人数 を足す)
    var expected = {};
    v.rounds.forEach(function (r) {
      var k = (r.entries || []).length;
      (r.entries || []).forEach(function (e) { expected[e.pid] = (expected[e.pid] || 0) + (k ? 1 / k : 0); });
    });
    st.sort(function (a, b) { return b.wins - a.wins || a.avgRankPos - b.avgRankPos; });
    out.push('<section class="card"><div class="card-h"><h2>通算成績</h2><span class="sub">' + v.rounds.length + 'ラウンド</span></div>' +
      '<div class="sc-scroll"><table class="sc"><thead><tr><th>名前</th><th class="r">回数</th><th class="r">優勝</th><th class="r">均等なら</th><th class="r">実力推定</th><th>最近の順位</th></tr></thead><tbody>' +
      st.map(function (r) {
        return '<tr><td class="name">' + esc(playerName(r.id)) + '</td><td class="num">' + r.rounds + '</td><td class="num big">' + r.wins + '</td>' +
          '<td class="num muted">' + (expected[r.id] || 0).toFixed(1) + '</td>' +
          '<td class="num">' + (72 + r.est).toFixed(1) + '</td>' +
          '<td><div class="ranks">' + r.lastRanks.map(function (x) { return '<span class="' + (x.split('/')[0] === '1' ? 'w' : '') + '">' + esc(x) + '</span>'; }).join('') + '</div></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card-b"><p class="small muted">「均等なら」は全員の優勝確率が同じだった場合の優勝回数。実力推定はパー72に直した平均スコアの見込みで、ハンデはこの差から作られます。</p></div></section>');

    var rounds = HC.sortRounds(v.rounds).reverse();
    out.push('<section class="card"><div class="card-h"><h2>ラウンド履歴</h2><span class="sub">新しい順</span></div><div class="round-list">' +
      rounds.map(function (r) {
        var ranked = HC.rankEntries(r.entries || []);
        var margin = ranked.length > 1 ? ranked[1].net - ranked[0].net : 0;
        var confirming = S.confirm === 'round:' + r.id;
        return '<div class="round"><div class="round-h"><div><span class="d">' + fmtDate(r.date) + '</span> <span class="small muted">' + esc(r.course || '') + ' パー' + esc(r.par) + ' ・ 1位と2位の差 ' + fmtH(margin) + '打</span></div>' +
          (S.demo ? '' : confirming
            ? '<div class="actions"><span class="small">このラウンドを削除しますか?</span><button class="btn sm danger" data-action="delete-round" data-id="' + esc(r.id) + '">削除する</button><button class="btn sm ghost" data-action="cancel-confirm">やめる</button></div>'
            : '<button class="btn sm ghost" data-action="ask-delete-round" data-id="' + esc(r.id) + '">削除</button>') +
          '</div><div class="sc-scroll"><table class="sc"><thead><tr><th>順位</th><th>名前</th><th class="r">グロス</th><th class="r">ハンデ</th><th class="r">ネット</th></tr></thead><tbody>' +
          ranked.map(function (e) {
            return '<tr class="' + (e.rank === 1 ? 'rank1' : '') + '"><td class="num">' + e.rank + '</td><td class="name">' + esc(playerName(e.pid)) + '</td><td class="num">' + e.gross + '</td><td class="num">' + fmtH(e.hcp) + '</td><td class="num">' + fmtH(e.net) + '</td></tr>';
          }).join('') + '</tbody></table></div></div>';
      }).join('') + '</div></section>');
    return out.join('');
  }

  // ---------- メンバー ----------
  function renderMembers() {
    var v = view();
    var s = settings();
    var sorted = HC.sortRounds(v.rounds);
    var out = [];
    out.push('<section class="card"><div class="card-h"><h2>メンバーを追加</h2></div><div class="card-b">' +
      '<form id="add-form" class="form-row" autocomplete="off">' +
        '<div class="field" style="flex-basis:160px"><label for="add-name">名前</label><input type="text" id="add-name" maxlength="20" placeholder="例:たかし" required></div>' +
        '<div class="field" style="flex:0 1 150px"><label for="add-base">だいたいの平均スコア</label><input type="number" id="add-base" inputmode="numeric" min="60" max="160" value="100" required></div>' +
        '<div class="field" style="flex:0 0 auto;justify-content:flex-end"><span class="lbl">&nbsp;</span><button class="btn primary" type="submit">追加</button></div>' +
      '</form>' +
      '<p class="small muted">平均スコアは最初のハンデを決めるための目安です(パー72換算)。ラウンドを重ねるほど実際のスコアに置き換わっていきます。</p>' +
      (S.demo ? '<p class="small">最初の1人を追加するとサンプルは消えます。</p>' : '') +
      '</div></section>');

    var list = v.players.slice().sort(byName);
    if (!list.length) return out.join('');
    out.push('<section class="card"><div class="card-h"><h2>メンバー</h2><span class="sub">' + list.filter(function (p) { return !p.archived; }).length + '人 参加中</span></div>' +
      '<div class="sc-scroll"><table class="sc"><thead><tr><th>名前</th><th class="r">申告平均</th><th class="r">回数</th><th class="r">実力推定</th><th>状態</th></tr></thead><tbody>' +
      list.map(function (p) {
        var e = HC.estimatePlayer(p, sorted, s);
        var confirming = S.confirm === 'player:' + p.id;
        var ctrl;
        if (S.demo) ctrl = '<span class="tag">例</span>';
        else if (confirming) ctrl = '<div class="actions"><button class="btn sm danger" data-action="delete-player" data-id="' + esc(p.id) + '">削除する</button><button class="btn sm ghost" data-action="cancel-confirm">やめる</button></div>';
        else ctrl = '<div class="actions"><button class="btn sm" data-action="toggle-archive" data-id="' + esc(p.id) + '">' + (p.archived ? 'お休み中 → 戻す' : '参加中') + '</button>' +
          (e.rounds === 0 ? '<button class="btn sm ghost" data-action="ask-delete-player" data-id="' + esc(p.id) + '">削除</button>' : '') + '</div>';
        return '<tr' + (p.archived ? ' style="opacity:.6"' : '') + '><td class="name">' + esc(p.name) + '</td>' +
          '<td class="r">' + (S.demo ? '<span class="num">' + esc(p.baseline) + '</span>' : '<input class="base" type="number" inputmode="numeric" min="60" max="160" id="base-' + esc(p.id) + '" data-base="' + esc(p.id) + '" value="' + esc(p.baseline) + '" aria-label="' + esc(p.name) + 'の申告平均">') + '</td>' +
          '<td class="num">' + e.rounds + '</td><td class="num">' + (72 + e.est).toFixed(1) + '</td><td>' + ctrl + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card-b"><p class="small muted">記録のある人は削除できないので「お休み」にしてください。お休み中の人は今日のメンバー候補に出ません。</p></div></section>');
    return out.join('');
  }

  // ---------- しくみ・設定 ----------
  function renderRules() {
    var s = settings();
    function opt(key, value, label) {
      return '<option value="' + value + '"' + (Number(s[key]) === Number(value) ? ' selected' : '') + '>' + label + '</option>';
    }
    var out = [];
    out.push('<section class="card"><div class="card-h"><h2>なぜ毎回接戦になるのか</h2></div><div class="card-b howto">' +
      '<div><span class="n">1</span><div><h3>実力の差をそのまま埋める</h3><p>最近のスコアの重み付き平均で「実力推定」を出し、その差をハンデにします。全員のネットの見込みが揃うので、勝敗はその日の出来で決まります。</p></div></div>' +
      '<div><span class="n">2</span><div><h3>1回の結果ではほとんど動かない</h3><p>直近ほど重く数えますが、1ラウンドで動くハンデは1打前後です。前回ビリでも今回は「少しだけ」有利になるだけで、優勝が約束されることはありません。</p></div></div>' +
      '<div><span class="n">3</span><div><h3>大叩きもまぐれもカット</h3><p>実力推定から' + s.clip + '打以上外れたスコアは' + s.clip + '打差として数えます。わざと崩してハンデを稼ぐ作戦は効きません。</p></div></div>' +
      '<div><span class="n">4</span><div><h3>優勝確率で最後の微調整</h3><p>スコアのブレが大きい人は一発がある分だけ有利です。毎回' + s.sims + '回シミュレーションして、全員の優勝確率が揃うようにハンデを0.5打単位で整えます。</p></div></div>' +
      '</div></section>');

    out.push('<section class="card"><div class="card-h"><h2>シミュレーションでの比較</h2><span class="sub">実力差のある4人 × 24ラウンド × 200シーズン</span></div>' +
      '<div class="sc-scroll"><table class="sc"><thead><tr><th>方式</th><th class="r">各人の優勝率</th><th class="r">前回ビリが次に優勝</th><th class="r">2打差以内の決着</th></tr></thead><tbody>' +
      '<tr><td class="name">ハンデなし</td><td class="num" style="font-size:16px">88 / 11 / 1 / 0%</td><td class="num">1%</td><td class="num">22%</td></tr>' +
      '<tr><td class="name">前回の差を埋める</td><td class="num" style="font-size:16px">19 / 23 / 27 / 31%</td><td class="num">49%</td><td class="num">34%</td></tr>' +
      '<tr class="rank1"><td class="name">このアプリ</td><td class="num" style="font-size:16px">22 / 24 / 26 / 28%</td><td class="num">28%</td><td class="num">41%</td></tr>' +
      '</tbody></table></div>' +
      '<div class="card-b"><p class="small muted">理想は全員25%。「前回の差を埋める」方式だと、前回ビリの人が約半分の確率で次に勝ってしまいます。このアプリでは誰が勝つか読めないまま、決着の4割が2打差以内になります。</p></div></section>');

    out.push('<section class="card"><div class="card-h"><h2>ハンデの設定</h2><span class="sub">' + (S.store && S.store.kind === 'shared' ? 'メンバー全員に反映されます' : 'この端末に保存されます') + '</span></div><div class="card-b">' +
      '<div class="form-row">' +
        '<div class="field"><label for="set-decay">最近の調子の反映</label><select id="set-decay" data-setting="decay">' + opt('decay', 0.8, '強め(直近重視)') + opt('decay', 0.9, '標準') + opt('decay', 0.95, 'ゆっくり') + '</select></div>' +
        '<div class="field"><label for="set-clip">大叩き・まぐれのカット</label><select id="set-clip" data-setting="clip">' + opt('clip', 6, '±6打') + opt('clip', 8, '±8打(標準)') + opt('clip', 10, '±10打') + '</select></div>' +
      '</div><div class="form-row">' +
        '<div class="field"><label for="set-reward">上手い人ボーナス</label><select id="set-reward" data-setting="reward">' + opt('reward', 0, 'なし(完全に均等)') + opt('reward', 0.1, 'ハンデを10%減らす') + opt('reward', 0.2, 'ハンデを20%減らす') + opt('reward', 0.3, 'ハンデを30%減らす') + '</select></div>' +
        '<div class="field"><label for="set-step">ハンデの刻み</label><select id="set-step" data-setting="step">' + opt('step', 0.5, '0.5打') + opt('step', 1, '1打') + '</select></div>' +
      '</div>' +
      '<label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="set-balance" data-setting="balance"' + (s.balance ? ' checked' : '') + '> 優勝確率が揃うように微調整する(おすすめ)</label>' +
      '<p class="small muted">「上手い人ボーナス」を入れると、練習して上手くなった人が少し勝ちやすくなります。完全に運勝負にしたくないときに。</p>' +
      '</div></section>');

    var shared = S.store && S.store.kind === 'shared';
    out.push('<section class="card"><div class="card-h"><h2>データ</h2><span class="sub">' + (shared ? '共有リンクを開いた仲間と同じデータを見ています' : 'この端末のブラウザだけに保存しています') + '</span></div><div class="card-b">' +
      '<p class="small muted">' + (shared ? '仲間に「共有」から編集できる権限(Contributor 以上)で送ると、誰のスマホからでもスコアを記録できます。' : '別の端末へ移すときは、書き出したテキストを向こうで読み込んでください。') + '</p>' +
      '<div class="actions"><button class="btn sm" data-action="export">書き出す(コピー)</button></div>' +
      (S.exportText ? '<textarea id="export-text" readonly>' + esc(S.exportText) + '</textarea>' : '') +
      '<div class="field"><label for="import-text">読み込み(書き出したテキストを貼り付け)</label><textarea id="import-text" data-import placeholder="{&quot;players&quot;: …}">' + esc(S.importText) + '</textarea></div>' +
      (S.confirm === 'import'
        ? '<div class="actions"><span class="small">今のデータに追加・上書きします。よろしいですか?</span><button class="btn sm danger" data-action="do-import">読み込む</button><button class="btn sm ghost" data-action="cancel-confirm">やめる</button></div>'
        : '<div class="actions"><button class="btn sm" data-action="ask-import">読み込む</button></div>') +
      '</div></section>');
    return out.join('');
  }

  // ---------- 描画 ----------
  function render() {
    var mode = document.getElementById('mode');
    if (S.store) mode.textContent = S.store.kind === 'shared' ? '仲間と共有中' : 'この端末に保存';
    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === S.tab));
    });
    if (!S.loaded) return;
    var html = S.tab === 'records' ? renderRecords() : S.tab === 'members' ? renderMembers() : S.tab === 'rules' ? renderRules() : renderToday();
    document.getElementById('view').innerHTML = html;
  }

  // 入力中に共有データが更新されてもフォーカスを奪わない
  function safeRender() {
    var a = document.activeElement;
    if (a && a.closest && a.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { S.pendingRender = true; return; }
    render();
  }

  function updateLive() {
    var pids = todayPids();
    if (pids.length < 2) return;
    var res = handicapsFor(pids);
    res.players.forEach(function (p) {
      var cell = document.querySelector('[data-net="' + CSS.escape(p.id) + '"]');
      var g = S.draft.gross[p.id];
      if (cell) cell.innerHTML = isValidGross(g) ? fmtH(g - p.hcp) : '<span class="muted">—</span>';
    });
    var live = document.getElementById('live');
    if (live) live.innerHTML = renderLive(res);
  }

  // ---------- 操作 ----------
  function saveRound() {
    if (S.demo) { toast('サンプル表示中は記録できません。先にメンバーを登録してください。'); return; }
    var pids = todayPids();
    var res = handicapsFor(pids);
    var entries = currentEntries(res);
    if (entries.length < 2) { toast('2人以上のグロスを入力してください(50〜200)。'); return; }
    var par = Number(S.draft.par);
    if (!(par >= 54 && par <= 80)) { toast('パーは54〜80の数字で入れてください。'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(S.draft.date)) { toast('日付を入れてください。'); return; }
    var round = { id: newId('r'), date: S.draft.date, course: String(S.draft.course || '').slice(0, 40), par: par, createdAt: Date.now(), entries: entries };
    var nextRes = handicapsFor(entries.map(function (e) { return e.pid; }), [round]);
    var next = {};
    nextRes.players.forEach(function (p) { next[p.id] = p.hcp; });
    var btn = document.getElementById('save-round');
    if (btn) btn.disabled = true;
    S.store.saveRound(round).then(function () {
      S.lastSaved = { round: round, next: next };
      S.draft.gross = {};
      saveDraft();
      toast('ラウンドを記録しました');
      render();
      window.scrollTo({ top: 0 });
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      guard(Promise.reject(e));
    });
  }

  function addPlayer(name, base) {
    name = String(name || '').trim().slice(0, 20);
    if (!name) { toast('名前を入れてください。'); return; }
    if (!(base >= 60 && base <= 160)) { toast('平均スコアは60〜160で入れてください。'); return; }
    if (!S.demo && S.data.players.some(function (p) { return p.name === name; })) { toast('同じ名前のメンバーがいます。'); return; }
    var p = { id: newId('p'), name: name, baseline: base, createdAt: Date.now() };
    var wasDemo = S.demo;
    S.demo = false;
    if (wasDemo) S.draft.pids = null;
    guard(S.store.savePlayer(p), name + 'さんを追加しました');
    var nm = document.getElementById('add-name');
    if (nm) { nm.value = ''; nm.focus(); }
  }

  function doExport() {
    var d = S.data;
    var payload = { app: 'hirihiri-handicap', version: 1, players: d.players, rounds: d.rounds, settings: d.settings };
    S.exportText = JSON.stringify(payload);
    var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(S.exportText) : Promise.reject();
    p.then(function () { toast('コピーしました'); }).catch(function () { toast('下のテキストを選択してコピーしてください'); });
    render();
    var ta = document.getElementById('export-text');
    if (ta) ta.select();
  }

  function doImport() {
    var obj;
    try { obj = JSON.parse(S.importText); } catch (e) { toast('読み込めませんでした。書き出したテキストをそのまま貼り付けてください。'); return; }
    if (!obj || !Array.isArray(obj.players) || !Array.isArray(obj.rounds)) { toast('メンバーとラウンドのデータが見つかりません。'); return; }
    S.demo = false;
    var jobs = [];
    obj.players.forEach(function (p) {
      if (p && p.id && p.name) jobs.push(function () { return S.store.savePlayer({ id: String(p.id), name: String(p.name).slice(0, 20), baseline: Number(p.baseline) || 100, createdAt: p.createdAt || Date.now(), archived: !!p.archived }); });
    });
    obj.rounds.forEach(function (r) {
      if (r && r.id && Array.isArray(r.entries)) jobs.push(function () {
        return S.store.saveRound({ id: String(r.id), date: String(r.date), course: String(r.course || ''), par: Number(r.par) || 72, createdAt: r.createdAt || 0,
          entries: r.entries.map(function (e) { return { pid: String(e.pid), gross: Number(e.gross), hcp: Number(e.hcp) || 0 }; }) });
      });
    });
    if (obj.settings && typeof obj.settings === 'object') jobs.push(function () { return S.store.saveSettings(obj.settings); });
    // 1件ずつ順番に書く
    var chain = Promise.resolve();
    jobs.forEach(function (j) { chain = chain.then(j); });
    S.confirm = null;
    S.importText = '';
    guard(chain, 'メンバー' + obj.players.length + '人、ラウンド' + obj.rounds.length + '件を読み込みました');
    render();
  }

  function onClick(ev) {
    var t = ev.target.closest('[data-tab], [data-action]');
    if (!t) return;
    var tab = t.getAttribute('data-tab');
    var act = t.getAttribute('data-action');
    if (tab && (!act || act === 'goto')) {
      S.tab = tab;
      S.confirm = null;
      render();
      window.scrollTo({ top: 0 });
      return;
    }
    var id = t.getAttribute('data-id');
    var v = view();
    switch (act) {
      case 'toggle-pid': {
        var pids = todayPids();
        var i = pids.indexOf(id);
        if (i >= 0) pids.splice(i, 1); else pids.push(id);
        S.draft.pids = pids;
        saveDraft();
        render();
        break;
      }
      case 'save-round': saveRound(); break;
      case 'clear-scores': S.draft.gross = {}; saveDraft(); render(); break;
      case 'dismiss-saved': S.lastSaved = null; render(); break;
      case 'ask-delete-round': S.confirm = 'round:' + id; render(); break;
      case 'ask-delete-player': S.confirm = 'player:' + id; render(); break;
      case 'ask-import': S.confirm = 'import'; render(); break;
      case 'cancel-confirm': S.confirm = null; render(); break;
      case 'delete-round': S.confirm = null; guard(S.store.deleteRound(id), 'ラウンドを削除しました'); break;
      case 'delete-player': S.confirm = null; guard(S.store.deletePlayer(id), 'メンバーを削除しました'); break;
      case 'toggle-archive': {
        var p = v.players.find(function (x) { return x.id === id; });
        if (p) guard(S.store.savePlayer(Object.assign({}, p, { archived: !p.archived })));
        break;
      }
      case 'export': doExport(); break;
      case 'do-import': doImport(); break;
    }
  }

  function onInput(ev) {
    var el = ev.target;
    var g = el.getAttribute('data-gross');
    if (g) {
      var val = el.value === '' ? null : Number(el.value);
      if (val == null) delete S.draft.gross[g]; else S.draft.gross[g] = val;
      saveDraft();
      updateLive();
      return;
    }
    var dk = el.getAttribute('data-draft');
    if (dk) {
      S.draft[dk] = dk === 'par' ? Number(el.value) : el.value;
      saveDraft();
      return;
    }
    if (el.hasAttribute('data-import')) { S.importText = el.value; }
  }

  function onChange(ev) {
    var el = ev.target;
    var key = el.getAttribute('data-setting');
    if (key) {
      var next = Object.assign({}, S.data.settings);
      next[key] = el.type === 'checkbox' ? el.checked : Number(el.value);
      if (S.demo) { S.data.settings = next; render(); return; }
      guard(S.store.saveSettings(next), '設定を変更しました');
      return;
    }
    var b = el.getAttribute('data-base');
    if (b) {
      var p = S.data.players.find(function (x) { return x.id === b; });
      var val = Number(el.value);
      if (!p) return;
      if (!(val >= 60 && val <= 160)) { toast('平均スコアは60〜160で入れてください。'); el.value = p.baseline; return; }
      if (val !== p.baseline) guard(S.store.savePlayer(Object.assign({}, p, { baseline: val })), p.name + 'さんの申告平均を' + val + 'にしました');
    }
  }

  function onSubmit(ev) {
    if (ev.target.id !== 'add-form') return;
    ev.preventDefault();
    addPlayer(document.getElementById('add-name').value, Number(document.getElementById('add-base').value));
  }

  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('focusout', function () {
    setTimeout(function () {
      var a = document.activeElement;
      var typing = a && a.closest && a.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
      if (S.pendingRender && !typing) { S.pendingRender = false; render(); }
    }, 0);
  });

  // ---------- 起動 ----------
  function start(store) {
    S.store = store;
    store.subscribe(function (data) {
      S.data = data;
      S.loaded = true;
      S.demo = data.players.length === 0;
      safeRender();
    });
    render();
  }

  var use = window.claude && typeof window.claude.use === 'function' ? window.claude.use('db') : Promise.resolve(null);
  Promise.resolve(use).then(function (db) { start(db ? dbStore(db) : localStore()); }, function () { start(localStore()); });
})();
