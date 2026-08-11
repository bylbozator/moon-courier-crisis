/* ==========================================================================
 * Moon Courier Crisis — рендер DOM-интерфейса (без состояния, читает игру).
 * Все клики идут через event delegation: data-action / data-*.
 * ========================================================================== */
var UI = (function () {
  'use strict';

  var C = typeof CONFIG !== 'undefined' ? CONFIG : null;
  var L = typeof Logic !== 'undefined' ? Logic : null;

  function fmtClock(h) {
    var day = Math.floor(h / C.CYCLE.hoursPerDay) + 1;
    var rem = h - (day - 1) * C.CYCLE.hoursPerDay;
    var hh = Math.floor(rem);
    var mm = Math.floor((rem - hh) * 60);
    return 'День ' + day + ' · ' + pad(hh) + ':' + pad(mm);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hLeft(deadline, now) {
    var d = deadline - now;
    return d <= 0 ? 0 : d;
  }
  function zoneColor(id) {
    var z = C.ZONES.filter(function (x) { return x.id === id; })[0];
    return z ? z.color : '#999';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  var STATUS_LABEL = {
    new: 'Новый', assigned: 'В пути', enroute: 'В пути', delivered: 'Доставлен',
    late_delivered: 'С опозданием', failed: 'Провален', lost: 'Груз потерян',
    expired: 'Истёк', impossible: 'Невозможно'
  };

  function render(game, ui) {
    renderTopbar(game);
    renderOrders(game, ui);
    renderRovers(game);
    renderLog(game);
  }

  // ---------- верхняя панель ----------
  function renderTopbar(game) {
    var el = document.getElementById('ui-topbar');
    var ratingColor = game.rating >= 60 ? '#7ee787' : game.rating >= 30 ? '#e9b35f' : '#ff7b72';
    el.innerHTML =
      '<div class="tb-title">Moon Courier Crisis</div>' +
      '<div class="tb-clock">' + fmtClock(game.clockH) + '</div>' +
      '<div class="tb-credits">Кредиты: <b>' + Math.floor(game.credits) + '</b></div>' +
      '<div class="tb-rating"><span>Рейтинг базы</span>' +
      '<div class="bar"><div class="bar-fill" style="width:' + game.rating + '%;background:' + ratingColor + '"></div></div>' +
      '<b style="color:' + ratingColor + '">' + Math.floor(game.rating) + '</b></div>' +
      '<div class="tb-seed" title="Сид партии (воспроизводимость)">сид ' + game.seed + '</div>' +
      '<div class="tb-btns">' +
      '<button data-action="speed" data-speed="0">⏸</button>' +
      '<button data-action="speed" data-speed="1">1×</button>' +
      '<button data-action="speed" data-speed="2">2×</button>' +
      '<button data-action="speed" data-speed="4">4×</button>' +
      '<button data-action="help">?</button>' +
      '<button data-action="save">Сохр.</button>' +
      '<button data-action="load">Загр.</button>' +
      '<button data-action="newgame">Новая</button>' +
      '</div>';
  }

  // ---------- заказы ----------
  function renderOrders(game, ui) {
    var el = document.getElementById('ui-orders');
    if (!game.orders.length) { el.innerHTML = '<div class="empty">Заказов пока нет.</div>'; return; }
    var html = game.orders.map(function (o) {
      return orderCard(game, o, ui);
    }).join('');
    el.innerHTML = '<div class="section-title">Заказы</div>' + html;
  }

  function orderCard(game, o, ui) {
    var t = L.targetById(o.targetId);
    var zc = zoneColor(o.zoneId);
    var risk = L.routeRisk(o, null);
    var left = hLeft(o.deadline, game.clockH);
    var dlColor = left <= 6 ? '#ff7b72' : left <= 12 ? '#e9b35f' : '#7ee787';
    var sel = ui.selectedOrderId === o.id ? ' sel' : '';
    var body = '';
    var badge = '<span class="badge" style="background:' + zc + '">' + esc(t.name) + '</span>';

    if (o.status === 'new') {
      var imp = L.isImpossible(o, game.rovers);
      if (imp.impossible) {
        body = '<div class="o-block">' +
          '<div class="o-line"><span class="o-stat">Вес <b>' + o.weight + '</b> кг</span>' +
          '<span class="o-stat">Награда <b>' + o.reward + '</b></span>' +
          '<span class="o-stat" style="color:' + dlColor + '">Дедлайн <b>' + fmtShort(left) + '</b></span></div>' +
          '<div class="o-note danger">Невозможно доставить: ' + esc(imp.reason) + ' Контейнер сдают в утиль без штрафа рейтинга.</div>' +
          '</div>';
      } else {
        var opts = game.rovers.map(function (r) {
          var fc = L.checkFeasible(r, o, game.clockH);
          var lbl = r.name + ' · ' + Math.floor(r.battery) + '/' + r.batteryMax + ' кВт·ч';
          return '<option value="' + r.id + '"' + (ui.selectedRoverForOrder === r.id ? ' selected' : '') +
            (fc.ok ? '' : ' data-blocked="' + esc(fc.reason) + '"') + '>' + esc(lbl) + '</option>';
        }).join('');
        var selRover = game.rovers.filter(function (r) { return r.id === ui.selectedRoverForOrder; })[0];
        var check = selRover ? L.checkFeasible(selRover, o, game.clockH) : { ok: false, reason: 'Выберите ровер' };
        body = '<div class="o-line"><span class="o-stat">Вес <b>' + o.weight + '</b> кг</span>' +
          '<span class="o-stat">Награда <b>' + o.reward + '</b></span>' +
          '<span class="o-stat">Риск <b style="color:' + (risk > 50 ? '#ff7b72' : '#e9b35f') + '">' + risk + '%</b></span>' +
          '<span class="o-stat" style="color:' + dlColor + '">Дедлайн <b>' + fmtShort(left) + '</b></span></div>' +
          '<div class="o-controls">' +
          '<select data-role="order-rover" data-order="' + o.id + '">' + opts + '</select>' +
          '<button class="go" data-action="assign" data-order="' + o.id + '" data-rover="' + (selRover ? selRover.id : '') + '">Отправить</button>' +
          '</div>' +
          '<div class="o-note ' + (check.ok ? 'ok' : 'warn') + '">' + (check.ok ? check.reason : check.reason) + '</div>';
      }
    } else if (o.status === 'assigned') {
      var rover = game.rovers.filter(function (r) { return r.id === o.roverId; })[0];
      body = '<div class="o-line"><span class="o-stat">Вес <b>' + o.weight + '</b> кг</span>' +
        '<span class="o-stat">Награда <b>' + o.reward + '</b></span></div>' +
        '<div class="o-note info">В пути: ' + esc(rover ? rover.name : '?') + ' (туда).</div>';
    } else if (o.status === 'delivered' || o.status === 'late_delivered') {
      body = '<div class="o-line"><span class="o-stat">Вес <b>' + o.weight + '</b> кг</span>' +
        '<span class="o-stat">Профит <b class="' + (o.profit >= 0 ? 'good' : 'bad') + '">' + (o.profit >= 0 ? '+' : '') + o.profit + '</b></span>' +
        '<span class="o-stat">Время <b>' + (o.timeOnRouteH != null ? o.timeOnRouteH.toFixed(1) : '—') + ' ч</b></span></div>';
    } else if (o.status === 'impossible') {
      body = '<div class="o-line"><span class="o-stat">Вес <b>' + o.weight + '</b> кг</span>' +
        '<span class="o-stat">Награда <b>' + o.reward + '</b></span></div>' +
        '<div class="o-note danger">Невозможно доставить — грузоподъёмность всех роверов ниже. Влияния на рейтинг нет.</div>';
    } else {
      body = '<div class="o-line"><span class="o-stat">Вес <b>' + o.weight + '</b> кг</span>' +
        '<span class="o-stat">Награда <b>' + o.reward + '</b></span></div>' +
        '<div class="o-note danger">' + (STATUS_LABEL[o.status] || o.status) + '</div>';
    }

    return '<div class="order' + sel + '" data-action="select" data-order="' + o.id + '">' +
      '<div class="o-head"><span class="o-badge">' + badge + '</span>' +
      '<span class="o-status ' + o.status + '">' + (STATUS_LABEL[o.status] || o.status) + '</span></div>' + body + '</div>';
  }

  function fmtShort(hours) {
    hours = Math.max(0, hours);
    if (hours >= 48) return Math.floor(hours / 24) + ' дн';
    if (hours >= 1) return Math.round(hours) + ' ч';
    return Math.round(hours * 60) + ' мин';
  }

  // ---------- роверы ----------
  function renderRovers(game) {
    var el = document.getElementById('ui-rovers');
    el.innerHTML = '<div class="section-title">Роверы</div>' + game.rovers.map(function (r) {
      return roverCard(game, r);
    }).join('');
  }

  function roverCard(game, r) {
    var batPct = Math.round(r.battery / r.batteryMax * 100);
    var batColor = r.status === 'stuck' ? '#ff7b72' : batPct > 40 ? '#7ee787' : batPct > 15 ? '#e9b35f' : '#ff7b72';
    var capPct = 0;
    var statusText = { idle: 'На базе', enroute: 'В пути →', returning: '← На базу', stuck: 'Застрял!' }[r.status] || r.status;
    var statusCls = { idle: 's-idle', enroute: 's-enroute', returning: 's-returning', stuck: 's-stuck' }[r.status] || '';
    var extra = '';

    if (r.mission && (r.status === 'enroute' || r.status === 'returning')) {
      var t = L.targetById(r.mission.targetId);
      capPct = Math.round(r.mission.cargoWeight / r.capacity * 100);
      extra += '<div class="r-mission">Миссия: ' + esc(t ? t.name : 'на базу') +
        ' · груз ' + r.mission.cargoWeight + ' кг · ' +
        (r.mission.rescuing ? 'эвакуация' : r.mission.phase === 'outbound' ? 'туда' : 'обратно') + '</div>';
    }
    if (r.incidentActive) {
      extra += '<div class="r-incident">' + esc(r.incidentActive.text) + '</div>';
    }
    if (r.status === 'stuck') {
      extra += '<div class="r-controls"><button class="go danger" data-action="rescue" data-rover="' + r.id + '">Эвакуировать (' + C.PHYSICS.rescueFee + ' кр.)</button></div>';
    }
    if (r.status === 'idle') {
      var upBtns = C.UPGRADES.map(function (u) {
        var owned = r.upgrades[u.id];
        return '<button class="up" data-action="upgrade" data-rover="' + r.id + '" data-upgrade="' + u.id + '"' +
          (owned ? ' disabled' : '') + ' title="' + esc(u.desc) + '">' + esc(u.name) + ' ' + (owned ? '✓' : '· ' + u.cost + ' кр.') + '</button>';
      }).join('');
      extra += '<div class="r-controls">' + upBtns + '</div>';
    }

    return '<div class="rover">' +
      '<div class="r-head"><span class="r-dot" style="background:' + r.color + '"></span>' +
      '<b>' + esc(r.name) + '</b><span class="status ' + statusCls + '">' + statusText + '</span></div>' +
      '<div class="r-row"><span>Батарея ' + Math.floor(r.battery) + '/' + r.batteryMax + ' кВт·ч</span><b style="color:' + batColor + '">' + batPct + '%</b></div>' +
      '<div class="bar"><div class="bar-fill" style="width:' + batPct + '%;background:' + batColor + '"></div></div>' +
      '<div class="r-row"><span>Грузоподъёмность ' + r.capacity + ' кг</span>' +
      (capPct > 0 ? '<b>' + capPct + '%</b>' : '') + '</div>' +
      '<div class="bar thin"><div class="bar-fill" style="width:' + capPct + '%;background:#d2a8ff"></div></div>' +
      extra + '</div>';
  }

  // ---------- журнал ----------
  function renderLog(game) {
    var el = document.getElementById('ui-log');
    var items = game.events.slice(-40).reverse().map(function (e) {
      var sev = { info: '#8b949e', good: '#7ee787', warn: '#e9b35f', danger: '#ff7b72' }[e.severity] || '#8b949e';
      return '<div class="ev"><span class="ev-time" style="color:' + sev + '">' + fmtClock(e.clockH) + '</span>' +
        '<span>' + esc(e.message) + '</span></div>';
    }).join('');
    el.innerHTML = '<div class="section-title">Журнал событий</div>' +
      '<div class="ev-list">' + (items || '<div class="empty">Пока тихо.</div>') + '</div>';
  }

  // ---------- модалки ----------
  function showModal(html) {
    var overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = html;
    overlay.classList.add('open');
  }
  function hideModal() {
    document.getElementById('modal-overlay').classList.remove('open');
  }

  function showNewGame(hasSave) {
    showModal(
      '<div class="modal">' +
      '<h2>Moon Courier Crisis</h2>' +
      '<p>Вы — диспетчер лунной базы. Доставляйте пайки роверами, следите за весом, батареей и риском маршрута. Продержитесь 7 дней с рейтингом ≥ ' + C.CYCLE.passRating + ' и заработайте максимум кредитов.</p>' +
      '<label>Сид партии (можно указать свой):<input id="seed-in" type="text" value="' + Math.floor(Math.random() * 99999) + '"></label>' +
      '<div class="modal-btns">' +
      (hasSave ? '<button data-action="continue">Продолжить</button>' : '') +
      '<button class="primary" data-action="start">Новая игра</button>' +
      '<button data-action="close">Отмена</button>' +
      '</div>' +
      '<div class="modal-io">' +
      '<button data-action="export">Экспорт данных (JSON)</button>' +
      '<button data-action="import">Импорт (JSON)</button>' +
      '</div>' +
      '</div>'
    );
    var seedEl = document.getElementById('seed-in');
    if (seedEl) { seedEl.focus(); seedEl.select(); }
  }

  function showEnd(game) {
    var s = game.stats;
    var ok = game.won;
    showModal(
      '<div class="modal end ' + (ok ? 'good' : 'bad') + '">' +
      '<h2>' + (ok ? 'База устояла!' : 'Миссия провалена') + '</h2>' +
      '<p>' + (ok ? 'Вы продержались 7 дней. Кредиты, честь базы и пайки — на месте.' : 'Рейтинг базы рухнул. Кредиты закончились, и контракт расторгнут.') + '</p>' +
      '<table class="stats">' +
      '<tr><td>Итоговый рейтинг</td><td><b>' + Math.floor(game.rating) + '</b></td></tr>' +
      '<tr><td>Кредиты на счету</td><td><b>' + Math.floor(game.credits) + '</b></td></tr>' +
      '<tr><td>Доставлено / всего</td><td><b>' + s.delivered + ' / ' + (s.delivered + s.failed) + '</b></td></tr>' +
      '<tr><td>В срок / с опозданием</td><td><b>' + s.onTime + ' / ' + s.late + '</b></td></tr>' +
      '<tr><td>Потеряно грузов</td><td><b>' + s.lost + '</b></td></tr>' +
      '<tr><td>Эвакуаций роверов</td><td><b>' + s.rescued + '</b></td></tr>' +
      '<tr><td>Чистая прибыль</td><td><b>' + s.profit + '</b></td></tr>' +
      '</table>' +
      '<div class="modal-btns"><button class="primary" data-action="start">Играть снова</button><button data-action="close">Смотреть карту</button></div>' +
      '</div>'
    );
  }

  function showHelp() {
    showModal(
      '<div class="modal">' +
      '<h2>Как играть</h2>' +
      '<ul>' +
      '<li><b>Цель:</b> 7 дней продержать рейтинг базы ≥ ' + C.CYCLE.passRating + ' и заработать максимум.</li>' +
      '<li>Выберите заказ, назначьте ровер и жмите <b>Отправить</b>.</li>' +
      '<li><b>Вес:</b> груз тяжелее — дольше путь и выше расход батареи.</li>' +
      '<li><b>Батарея:</b> ровер не выедет, если не хватит на весь маршрут туда и обратно. На базе заряжается бесплатно.</li>' +
      '<li><b>Риск:</b> красные зоны — бури, завалы, потеря груза. Инциденты могут посадить батарею в пути.</li>' +
      '<li><b>Дедлайн:</b> опоздание — половина награды и −' + Math.abs(C.RATING.late) + ' рейтинга. Просроченный заказ — −' + Math.abs(C.RATING.failed) + '.</li>' +
      '<li><b>Рейтинг:</b> своевременная доставка +' + C.RATING.onTime + ', потеря груза −' + Math.abs(C.RATING.lostCargo) + ', эвакуация −' + Math.abs(C.RATING.rescue) + ' и ' + C.PHYSICS.rescueFee + ' кр.</li>' +
      '<li>Часть заказов <b>невозможна</b> (вес больше грузоподъёмности) — на рейтинг не влияет.</li>' +
      '</ul>' +
      '<div class="modal-btns"><button class="primary" data-action="close">Понятно</button></div>' +
      '</div>'
    );
  }

  function showToast(msg, kind) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  return {
    render: render,
    showModal: showModal,
    hideModal: hideModal,
    showNewGame: showNewGame,
    showEnd: showEnd,
    showHelp: showHelp,
    showToast: showToast
  };
})();
