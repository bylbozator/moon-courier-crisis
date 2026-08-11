/* ==========================================================================
 * Moon Courier Crisis — интеграционные тесты REST API.
 * Запуск:  node tests/api.test.js
 *
 * Проверяем: маршруты, HTTP-статусы, валидацию действий игрока,
 * персистентность (состояние переживает рестарт сервера) и раздачу статики.
 * ========================================================================== */
'use strict';

var os = require('os');
var path = require('path');
var fs = require('fs');

var appMod = require('../server.js');
var Logic = require('../js/logic.js').Logic;

var PASS = 0, FAIL = 0;
function check(name, cond, extra) {
  if (cond) { PASS++; console.log('  ok  ' + name); }
  else { FAIL++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

function req(base, method, pathname, body) {
  var opts = { method: method, headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  return fetch(base + pathname, opts).then(function (res) {
    return res.json().then(function (data) {
      return { status: res.status, data: data };
    }).catch(function () { return { status: res.status, data: null }; });
  });
}

function pickFeasible(game) {
  // Первый заказ и ровер, которые можно назначить прямо сейчас.
  for (var i = 0; i < game.orders.length; i++) {
    var o = game.orders[i];
    if (o.status !== 'new') continue;
    for (var j = 0; j < game.rovers.length; j++) {
      var r = game.rovers[j];
      if (r.status !== 'idle') continue;
      var c = Logic.checkFeasible(r, o, game.clockH);
      if (c.ok) return { order: o, rover: r };
    }
  }
  return null;
}

function portOf(server) {
  return server.address().port;
}

async function main() {
  var dataFile = path.join(os.tmpdir(), 'moon-courier-api-test-' + Date.now() + '.json');

  var app = appMod.createApp({ dataFile: dataFile });
  var server = app.server.listen(0);
  await new Promise(function (r) { server.on('listening', r); });
  var base = 'http://127.0.0.1:' + portOf(server);

  console.log('\n== REST API ==');

  // 1. health
  var r = await req(base, 'GET', '/api/health');
  check('GET /api/health → 200 {ok:true}', r.status === 200 && r.data.ok === true);

  // 2. нет партии
  r = await req(base, 'GET', '/api/game');
  check('GET /api/game без партии → 404', r.status === 404);

  // 3. создание партии
  r = await req(base, 'POST', '/api/game', { seed: 42 });
  check('POST /api/game {seed:42} → 200, seed=42', r.status === 200 && r.data.game.seed === 42);
  check('  ... 3 ровера', r.data.game.rovers.length === 3);
  check('  ... заказы на день 1', r.data.game.orders.length >= 2);

  // 4. чтение состояния
  r = await req(base, 'GET', '/api/game');
  check('GET /api/game → та же партия (seed=42)', r.status === 200 && r.data.game.seed === 42);
  check('  ... clockH >= 0', typeof r.data.game.clockH === 'number' && r.data.game.clockH >= 0);

  // 5. подресурсы
  r = await req(base, 'GET', '/api/orders');
  check('GET /api/orders → массив', r.status === 200 && Array.isArray(r.data.orders));
  r = await req(base, 'GET', '/api/rovers');
  check('GET /api/rovers → 3 ровера', r.status === 200 && r.data.rovers.length === 3);
  r = await req(base, 'GET', '/api/stats');
  check('GET /api/stats → объект', r.status === 200 && r.data.stats && typeof r.data.stats.delivered === 'number');
  r = await req(base, 'GET', '/api/events');
  check('GET /api/events → массив', r.status === 200 && Array.isArray(r.data.events));

  // 6. валидация назначения: несуществующий ровер
  r = await req(base, 'POST', '/api/orders/o1_1/assign', { roverId: 'nope' });
  check('назначение несуществующему роверу → 400', r.status === 400 && r.data.ok === false);

  // 7. валидация: без roverId
  r = await req(base, 'POST', '/api/orders/o1_1/assign', {});
  check('назначение без roverId → 400', r.status === 400 && r.data.ok === false);

  // 8. корректное назначение
  var g = (await req(base, 'GET', '/api/game')).data.game;
  var p = pickFeasible(g);
  if (p) {
    r = await req(base, 'POST', '/api/orders/' + p.order.id + '/assign', { roverId: p.rover.id });
    var okAssign = r.status === 200 && r.data.ok === true;
    check('назначение подходящего заказа → 200 {ok:true}', okAssign, 'status=' + r.status);
    if (okAssign) {
      var st = r.data.game.orders.filter(function (o) { return o.id === p.order.id; })[0];
      check('  ... заказ в статусе assigned', st && st.status === 'assigned');
      var rv = r.data.game.rovers.filter(function (x) { return x.id === p.rover.id; })[0];
      check('  ... ровер в пути (enroute)', rv && rv.status === 'enroute');
    }
  } else {
    check('назначение подходящего заказа → 200', false, 'нет подходящей пары');
  }

  // 9. эвакуация незастрявшего ровера → отклонено
  r = await req(base, 'POST', '/api/rovers/pulsar/rescue');
  check('эвакуация незастрявшего ровера → 400', r.status === 400 && r.data.ok === false);

  // 10. апгрейд
  r = await req(base, 'POST', '/api/rovers/pulsar/upgrade', { upgrade: 'battery' });
  check('апгрейд батареи → 200', r.status === 200 && r.data.ok === true);
  r = await req(base, 'POST', '/api/rovers/pulsar/upgrade', { upgrade: 'battery' });
  check('повторный апгрейд → 400', r.status === 400 && r.data.ok === false);
  r = await req(base, 'POST', '/api/rovers/pulsar/upgrade', { upgrade: 'nope' });
  check('неизвестный апгрейд → 400', r.status === 400 && r.data.ok === false);

  // 11. скорость
  r = await req(base, 'POST', '/api/speed', { speed: 2 });
  check('POST /api/speed {speed:2} → 200', r.status === 200 && r.data.speed === 2);
  r = await req(base, 'POST', '/api/speed', { speed: 9 });
  check('POST /api/speed {speed:9} → 400', r.status === 400 && r.data.ok === false);

  // 12. сброс партии
  r = await req(base, 'POST', '/api/game', { seed: 7 });
  check('сброс партии {seed:7} → 200, seed=7', r.status === 200 && r.data.game.seed === 7);

  // 13. неизвестный маршрут
  r = await req(base, 'GET', '/api/whatever');
  check('GET /api/whatever → 404 JSON', r.status === 404 && r.data && r.data.error);

  // 14. статика
  var html = await fetch(base + '/').then(function (res) { return res.text(); });
  check('GET / → HTML с канвасом', html.indexOf('<canvas') !== -1 && html.indexOf('Moon') !== -1);
  var js = await fetch(base + '/js/core.js').then(function (res) { return res.text(); });
  check('GET /js/core.js → JS', js.indexOf('createGame') !== -1);
  r = await req(base, 'GET', '/nope.js');
  check('GET /nope.js → 404', r.status === 404);

  // 15. импорт состояния (как экспорт из клиента)
  var snap = (await req(base, 'GET', '/api/game')).data.game;
  snap.seed = 777;
  r = await req(base, 'POST', '/api/game', { import: snap });
  check('POST /api/game {import} → состояние восстановлено (seed=777)', r.status === 200 && r.data.game.seed === 777);

  // 16. персистентность: рестарт сервера с тем же файлом
  var oldPort = portOf(server);
  app.stop();
  await new Promise(function (r2) { server.close(r2); });

  var app2 = appMod.createApp({ dataFile: dataFile });
  var server2 = app2.server.listen(0);
  await new Promise(function (r2) { server2.on('listening', r2); });
  var base2 = 'http://127.0.0.1:' + portOf(server2);
  r = await req(base2, 'GET', '/api/game');
  check('после рестарта сервера партия сохранена (seed=777)', r.status === 200 && r.data.game.seed === 777);

  app2.stop();
  await new Promise(function (r2) { server2.close(r2); });
  try { fs.unlinkSync(dataFile); } catch (e) {}

  console.log('\nИтого: ' + PASS + ' passed, ' + FAIL + ' failed');
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('Ошибка тестов API:', e);
  process.exit(1);
});
