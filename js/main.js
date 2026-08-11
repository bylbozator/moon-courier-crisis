/* ==========================================================================
 * Moon Courier Crisis — точка входа: игровой цикл, события, автосохранение.
 * URL-параметры:
 *   ?seed=123       — фиксированный сид
 *   ?demo=3         — автопрогон ботом до начала дня 3 (для скриншотов/демо)
 *   ?demo=end       — автопрогон ботом до финала и показать итоги
 * ========================================================================== */
(function () {
  'use strict';

  var C = CONFIG, Core_ = Core, L = Logic;

  var params = new URLSearchParams(location.search);
  var settings = { speed: 1, paused: false };
  var game = null;
  var ui = { selectedOrderId: null, selectedRoverForOrder: null };
  var lastUi = 0, lastSave = 0;
  var demoDone = false;
  var SERVER_MODE = false;   // true — игра обслуживается node server.js (REST API)

  // Снапшот с сервера: восстанавливаем состояние и перерисовываем.
  function onServerState(snap) {
    game = Core_.restore(snap);
    if (game.over && !game._endShown) {
      game._endShown = true;
      UI.showEnd(game);
    }
  }

  function initialSeed() {
    var s = params.has('seed') ? parseInt(params.get('seed'), 10) : null;
    if (params.has('demo') && s == null) s = 20240812;
    return s;
  }

  // ---------- инициализация ----------
  function startNew(seed) {
    if (SERVER_MODE) {
      Api.newGame(seed).then(function (r) {
        if (r.status !== 200) { UI.showToast('Ошибка сервера при создании партии.', 'warn'); return; }
        onServerState(r.data.game);
        ui = { selectedOrderId: null, selectedRoverForOrder: null };
        settings = { speed: 1, paused: false };
        UI.hideModal();
        maybeDemoServer();
      });
      return;
    }
    game = Core_.createGame({ seed: seed });
    ui = { selectedOrderId: null, selectedRoverForOrder: null };
    settings = { speed: 1, paused: false };
    UI.hideModal();
    maybeDemo();
  }

  function loadSave() {
    if (SERVER_MODE) {
      Api.getGame().then(function (r) {
        if (r.status !== 200) { UI.showToast('Нет партии на сервере.', 'warn'); return; }
        onServerState(r.data.game);
        ui = { selectedOrderId: null, selectedRoverForOrder: null };
        UI.hideModal();
        UI.showToast('Игра загружена с сервера.', 'info');
      });
      return;
    }
    var data = Store.load();
    if (!data) { UI.showToast('Нет сохранения.', 'warn'); return; }
    game = Core_.restore(data);
    ui = { selectedOrderId: null, selectedRoverForOrder: null };
    UI.hideModal();
    UI.showToast('Игра загружена.', 'info');
  }

  function maybeDemo() {
    if (!params.has('demo') || !game || demoDone || SERVER_MODE) return;
    demoDone = true;
    var target = params.get('demo') === 'end' ? Infinity
      : parseFloat(params.get('demo')) * C.CYCLE.hoursPerDay;
    var timer = setInterval(function () {
      if (game.over) { clearInterval(timer); UI.render(game, ui); UI.showEnd(game); return; }
      botTurn(game);
      for (var i = 0; i < 4; i++) Core_.tick(game, 0.5); // 2 часа за тик
      if (game.clockH >= target) {
        clearInterval(timer);
        settings.paused = true;
        UI.render(game, ui);
        if (params.get('demo') === 'end') UI.showEnd(game);
      }
    }, 40);
  }

  // Демо в server-режиме: бот и ускорение крутит сервер (POST /api/demo).
  function maybeDemoServer() {
    if (!params.has('demo') || !game || demoDone || !SERVER_MODE) return;
    demoDone = true;
    var target = params.get('demo') === 'end' ? 999 : parseFloat(params.get('demo'));
    Api.startDemo(target);
  }

  // Простой бот для демо: назначает заказы, спасает застрявших.
  function botTurn(g) {
    var open = g.orders.filter(function (o) { return o.status === 'new'; })
      .sort(function (a, b) { return a.deadline - b.deadline; });
    open.forEach(function (o) {
      if (o.status !== 'new') return;
      var imp = L.isImpossible(o, g.rovers);
      if (imp.impossible) return;
      var target = L.targetById(o.targetId);
      var best = null, bestNeed = 1e18;
      g.rovers.forEach(function (r) {
        if (r.status !== 'idle') return;
        var c = L.checkFeasible(r, o, g.clockH);
        if (!c.ok) return;
        var need = L.energyNeeded(r, target, o.weight);
        var eta = L.outboundHours(r, target, o.weight);
        if (g.clockH + eta > o.deadline + 4) return;
        if (need < bestNeed) { bestNeed = need; best = r; }
      });
      if (best) Core_.assignRover(g, o.id, best.id);
    });
    g.rovers.forEach(function (r) { if (r.status === 'stuck') Core_.rescueRover(g, r.id); });
  }

  // ---------- цикл ----------
  var last = null;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!game) return;
    if (!last) last = ts;
    var dtReal = (ts - last) / 1000;
    last = ts;

    if (!SERVER_MODE && !settings.paused && !game.over) {
      var dtHours = dtReal * settings.speed / C.CYCLE.realSecPerGameHour;
      Core_.tick(game, dtHours);
    }

    MoonMap.render(game, { selectedOrderId: ui.selectedOrderId });

    if (ts - lastUi > 250) {
      lastUi = ts;
      UI.render(game, ui);
    }
    if (!SERVER_MODE && ts - lastSave > 3000) {
      lastSave = ts;
      Store.save(Core_.snapshot(game));
    }
    if (game.over && !game._endShown) {
      game._endShown = true;
      UI.showEnd(game);
    }
  }

  // ---------- события ----------
  function assignSelected(orderEl) {
    var sel = orderEl.querySelector('[data-role="order-rover"]');
    var roverId = sel ? sel.value : (orderEl.dataset.rover || '');
    if (SERVER_MODE) {
      Api.assign(orderEl.dataset.order, roverId).then(function (r) {
        var d = r.data || {};
        UI.showToast(d.ok ? ('Ровер отправлен. ' + (d.reason || '')) : (d.reason || 'Ошибка сервера.'), d.ok ? 'good' : 'warn');
        Api.applyMutation(r, onServerState);
        UI.render(game, ui);
      });
      return;
    }
    var res = Core_.assignRover(game, orderEl.dataset.order, roverId);
    if (res.ok) {
      UI.showToast('Ровер отправлен. ' + res.reason, 'good');
    } else {
      UI.showToast(res.reason, 'warn');
    }
    UI.render(game, ui);
  }

  function onSelectChange(ev) {
    var sel = ev.target;
    if (!sel.matches('[data-role="order-rover"]')) return;
    ui.selectedRoverForOrder = sel.value;
    var order = sel.closest('.order');
    ui.selectedOrderId = order ? order.dataset.order : null;
    UI.render(game, ui);
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el || !game) return;
    var act = el.dataset.action;
    if (act === 'select') { ui.selectedOrderId = el.dataset.order; ui.selectedRoverForOrder = null; UI.render(game, ui); }
    else if (act === 'assign') { assignSelected(el.closest('.order') || el); }
    else if (act === 'rescue') {
      if (SERVER_MODE) {
        Api.rescue(el.dataset.rover).then(function (r) {
          var d = r.data || {};
          UI.showToast(d.ok ? 'Эвакуация запущена.' : (d.reason || 'Ошибка сервера.'), d.ok ? 'good' : 'warn');
          Api.applyMutation(r, onServerState);
          UI.render(game, ui);
        });
      } else {
        var resc = Core_.rescueRover(game, el.dataset.rover);
        UI.showToast(resc.ok ? 'Эвакуация запущена.' : resc.reason, resc.ok ? 'good' : 'warn');
        UI.render(game, ui);
      }
    }
    else if (act === 'upgrade') {
      if (SERVER_MODE) {
        Api.upgrade(el.dataset.rover, el.dataset.upgrade).then(function (r) {
          var d = r.data || {};
          UI.showToast(d.ok ? 'Улучшение установлено.' : (d.reason || 'Ошибка сервера.'), d.ok ? 'good' : 'warn');
          Api.applyMutation(r, onServerState);
          UI.render(game, ui);
        });
      } else {
        var upg = Core_.buyUpgrade(game, el.dataset.rover, el.dataset.upgrade);
        UI.showToast(upg.ok ? 'Улучшение установлено.' : upg.reason, upg.ok ? 'good' : 'warn');
        UI.render(game, ui);
      }
    }
    else if (act === 'speed') {
      settings.speed = parseFloat(el.dataset.speed);
      settings.paused = settings.speed === 0;
      if (SERVER_MODE) Api.setSpeed(settings.speed);
      UI.render(game, ui);
    }
    else if (act === 'newgame') { UI.showNewGame(Store.hasSave()); }
    else if (act === 'continue') { loadSave(); }
    else if (act === 'start') {
      var seedVal = parseInt(document.getElementById('seed-in').value, 10);
      startNew(isNaN(seedVal) ? Math.floor(Math.random() * 1e5) : seedVal);
    }
    else if (act === 'close') { UI.hideModal(); }
    else if (act === 'help') { UI.showHelp(); }
    else if (act === 'save') {
      if (SERVER_MODE) {
        UI.showToast('Сохранено на сервере (пишется автоматически).', 'good');
      } else {
        Store.save(Core_.snapshot(game));
        UI.showToast('Сохранено.', 'good');
      }
    }
    else if (act === 'load') { loadSave(); }
    else if (act === 'export') {
      var blob = new Blob([Store.exportJson(Core_.snapshot(game))], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'moon-courier-save.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }
    else if (act === 'import') { document.getElementById('import-file').click(); }
  });

  document.addEventListener('change', onSelectChange);

  document.getElementById('import-file').addEventListener('change', function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = Store.importJson(reader.result);
        if (SERVER_MODE) {
          Api.importState(data).then(function (r) {
            if (r.status === 200 && r.data && r.data.game) onServerState(r.data.game);
            UI.hideModal();
            UI.showToast('Импортировано.', 'good');
            UI.render(game, ui);
          });
        } else {
          game = Core_.restore(data);
          UI.hideModal();
          UI.showToast('Импортировано.', 'good');
          UI.render(game, ui);
        }
      } catch (e) {
        UI.showToast('Ошибка импорта: ' + e.message, 'warn');
      }
    };
    reader.readAsText(f);
    ev.target.value = '';
  });

  // подсказки на карте
  var tip = document.getElementById('map-tip');
  var cv = document.getElementById('map');
  cv.addEventListener('mousemove', function (ev) {
    var p = MoonMap.toMap(ev.clientX, ev.clientY);
    var info = MoonMap.hitTest(game, p.x, p.y);
    if (!info) { tip.classList.remove('show'); return; }
    var text = '';
    if (info.type === 'target') {
      var z = C.ZONES.filter(function (x) { return x.id === info.target.zoneId; })[0];
      text = '<b>' + info.target.name + '</b><br>зона: ' + z.name + ' · риск ' + Math.round(z.risk * 100) + '%';
    } else if (info.type === 'rover') {
      text = '<b>' + info.rover.name + '</b><br>батарея ' + Math.floor(info.rover.battery) + ' кВт·ч · ' +
        ({ idle: 'на базе', enroute: 'в пути', returning: 'возвращается', stuck: 'застрял' }[info.rover.status] || info.rover.status);
    } else if (info.type === 'zone') {
      text = '<b>' + info.zone.name + '</b><br>риск ' + Math.round(info.zone.risk * 100) + '% · скорость ×' + info.zone.terrain.toFixed(2);
    } else if (info.type === 'base') {
      text = '<b>База «Тихо-1»</b><br>здесь заряжаются роверы и живут пайки';
    }
    tip.innerHTML = text;
    tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - 220) + 'px';
    tip.style.top = ev.clientY + 14 + 'px';
    tip.classList.add('show');
  });
  cv.addEventListener('mouseleave', function () { tip.classList.remove('show'); });

  // ---------- старт ----------
  var cv = document.getElementById('map');
  MoonMap.init(cv);

  Api.init(onServerState).then(function (ok) {
    SERVER_MODE = ok;
    var initialSeedVal = initialSeed();
    if (SERVER_MODE) {
      Api.getGame().then(function (r) {
        if (r.status === 200) {
          onServerState(r.data.game);
          UI.showNewGame(true);
          maybeDemoServer();
        } else {
          startNew(initialSeedVal != null && !isNaN(initialSeedVal) ? initialSeedVal : Math.floor(Math.random() * 99999));
        }
      });
    } else {
      var saved = Store.load();
      if (initialSeedVal != null && !isNaN(initialSeedVal)) {
        startNew(initialSeedVal);
      } else if (saved && !params.has('demo')) {
        game = Core_.restore(saved);
        UI.showNewGame(true);
      } else {
        startNew(Math.floor(Math.random() * 99999));
      }
    }
  });

  requestAnimationFrame(loop);
  if (game) UI.render(game, ui);
  if (params.has('modal') && !SERVER_MODE) UI.showNewGame(Store.hasSave());

  // для отладки из консоли
  window.__game = function () { return game; };
  window.__seed = initialSeed();
})();
