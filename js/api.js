/* ==========================================================================
 * Moon Courier Crisis — сетевой слой клиента (опциональный).
 *
 * Если страница отдана сервером (node server.js), клиент переключается в
 * режим «server-authoritative»: состояние берётся из REST API, а решения
 * (назначить/спасти/улучшить/скорость) отправляются на сервер POST-запросами.
 * При открытии index.html напрямую (file://) API отключён — игра работает
 * полностью офлайн, как раньше.
 * ========================================================================== */
var Api = (function () {
  'use strict';

  var enabled = false;
  var pollTimer = null;
  var POLL_MS = 300;
  var listeners = [];

  function isServed() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  function req(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; });
    }).catch(function () {
      return { status: 0, data: null };
    });
  }

  // Проверяет доступность API и запускает polling состояния.
  function init(onGame) {
    if (!isServed()) return Promise.resolve(false);
    return req('GET', '/api/health').then(function (r) {
      if (r.status !== 200) return false;
      enabled = true;
      pollTimer = setInterval(function () {
        req('GET', '/api/game').then(function (g) {
          if (g.status === 200) onGame(g.data.game);
        });
      }, POLL_MS);
      return true;
    });
  }

  function getGame() { return req('GET', '/api/game'); }
  function newGame(seed) { return req('POST', '/api/game', { seed: seed }); }
  function importState(data) { return req('POST', '/api/game', { import: data }); }

  function assign(orderId, roverId) { return req('POST', '/api/orders/' + encodeURIComponent(orderId) + '/assign', { roverId: roverId }); }
  function rescue(roverId) { return req('POST', '/api/rovers/' + encodeURIComponent(roverId) + '/rescue'); }
  function upgrade(roverId, upgradeId) { return req('POST', '/api/rovers/' + encodeURIComponent(roverId) + '/upgrade', { upgrade: upgradeId }); }
  function setSpeed(speed) { return req('POST', '/api/speed', { speed: speed }); }
  function startDemo(targetDay) { return req('POST', '/api/demo', { targetDay: targetDay }); }

  // После мутаций сервер возвращает актуальный снапшот — применяем его сразу.
  function applyMutation(r, onGame) {
    if (r.status === 200 && r.data && r.data.game) onGame(r.data.game);
    return r;
  }

  function isEnabled() { return enabled; }

  return {
    init: init,
    isEnabled: isEnabled,
    getGame: getGame,
    newGame: newGame,
    importState: importState,
    assign: assign,
    rescue: rescue,
    upgrade: upgrade,
    setSpeed: setSpeed,
    startDemo: startDemo,
    applyMutation: applyMutation
  };
})();
