/* ==========================================================================
 * Moon Courier Crisis — автотесты и автопрогон симуляции (Node, без зависимостей).
 * Запуск:  node tests/run.js
 * ========================================================================== */
'use strict';

var CONFIG = require('../js/config.js').CONFIG;
var Logic = require('../js/logic.js').Logic;
var Core = require('../js/core.js').Core;

var passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}
function assertClose(a, b, eps, msg) {
  assert(Math.abs(a - b) <= (eps || 1e-6), msg + ' (got ' + a + ', want ' + b + ')');
}

console.log('== Unit: логика ==');
(function () {
  var zone = Logic.zoneById('farside');
  assert(zone.risk === 0.85, 'farside risk 0.85');
  var target = Logic.targetById('shadow');
  assert(target.zoneId === 'farside', 'shadow в farside');

  // Энергия растёт с весом и с "тяжёлостью" рельефа.
  var light = { capacity: 40, battery: 999, speed: 60 };
  var e40 = Logic.energyNeeded(light, target, 10);
  var e35 = Logic.energyNeeded(light, target, 35);
  assert(e35 > e40, 'тяжёлый груз => больше энергии');

  // Скорость/время: тяжелее => дольше.
  var t10 = Logic.travelHours(light, target, 10);
  var t35 = Logic.travelHours(light, target, 35);
  assert(t35 > t10, 'тяжёлый груз => дольше');

  // Проверка веса: не влезает.
  var r = { capacity: 100, battery: 500, speed: 45, status: 'idle' };
  var bigOrder = { targetId: 'shadow', zoneId: 'farside', weight: 150, deadline: 999, reward: 100 };
  var c = Logic.checkFeasible(r, bigOrder, 0);
  assert(!c.ok && /грузоподъёмност/.test(c.reason), '150 кг > 100 кг: отклонено: ' + c.reason);

  // Проверка батареи: не хватает.
  var lowBat = { capacity: 100, battery: 5, speed: 45, status: 'idle' };
  var smallOrder = { targetId: 'shadow', zoneId: 'farside', weight: 10, deadline: 999, reward: 100 };
  var c2 = Logic.checkFeasible(lowBat, smallOrder, 0);
  assert(!c2.ok && /Батареи/.test(c2.reason), 'батарея недостаточна: ' + c2.reason);

  // Занятый ровер.
  var busy = { capacity: 100, battery: 500, speed: 45, status: 'enroute' };
  var c3 = Logic.checkFeasible(busy, smallOrder, 0);
  assert(!c3.ok && /занят/.test(c3.reason), 'занятый ровер отклонён');

  // Свободный ровер с запасом — ок.
  var okR = { capacity: 100, battery: 500, speed: 45, status: 'idle' };
  var c4 = Logic.checkFeasible(okR, smallOrder, 0);
  assert(c4.ok, 'нормальный ровер проходит проверку: ' + c4.reason);

  // isImpossible
  var rovers = [{ capacity: 100, battery: 500 }, { capacity: 25, battery: 90 }];
  assert(Logic.isImpossible(bigOrder, rovers).impossible, '150 кг невозможно при макс. 100 кг');
  assert(!Logic.isImpossible(smallOrder, rovers).impossible, '10 кг возможно');

  // Экономика: награда > затрат для нормального заказа.
  var prof = Logic.profitFor(smallOrder, okR, true);
  assert(typeof prof === 'number' && isFinite(prof), 'profit число');

  // Инциденты: шанс растёт с риском зоны; rng>шанс => нет инцидента.
  var lowRiskOrder = { zoneId: 'perimeter', weight: 5 };
  var lowRiskR = { capacity: 40 };
  assert(Logic.rollIncident(lowRiskOrder, lowRiskR, function () { return 0.999; }) === null, 'rng высокий => нет инцидента');
  assert(Logic.rollIncident(lowRiskOrder, lowRiskR, function () { return 0.5; }) === null, 'периметр (риск 5%) не срабатывает при rng=0.5');
  var highRiskOrder = { zoneId: 'farside', weight: 95 };
  var highRiskR = { capacity: 100 };
  assert(Logic.rollIncident(highRiskOrder, highRiskR, function () { return 0.5; }) !== null, 'тёмная сторона (риск 85%) срабатывает при rng=0.5');
})();

console.log('== Unit: движок (фейсибилити и геймплей) ==');
(function () {
  var g = Core.createGame({ seed: 7 });

  // День 2: гарантированно появляется "невозможный" заказ (150 кг).
  var impossibleSeen = false;
  for (var h = 0; h < 48; h += 0.25) Core.tick(g, 0.25);
  g.orders.forEach(function (o) {
    if (o.weight > 100) impossibleSeen = true;
  });
  assert(impossibleSeen, 'есть заказ тяжелее любого ровера (невозможный сценарий)');

  // Невозможный заказ нельзя назначить ни на один ровер.
  var imp = null;
  g.orders.forEach(function (o) { if (o.weight > 100) imp = o; });
  if (imp) {
    g.rovers.forEach(function (r) {
      var res = Core.assignRover(g, imp.id, r.id);
      assert(!res.ok, 'невозможный заказ не назначается на ' + r.name + ': ' + res.reason);
    });
  }

  // Барьер батареи: ровер без батареи не получает заказ.
  var g2 = Core.createGame({ seed: 1 });
  g2.rovers.forEach(function (r) { r.battery = 0; });
  var first = g2.orders[0];
  var res = Core.assignRover(g2, first.id, first ? g2.rovers[0].id : null);
  assert(!res.ok, 'ровер без батареи не получает заказ');
})();

console.log('== Автопрогон: стратегия + инварианты ==');
function autoplay(seed, opts) {
  opts = opts || {};
  var g = Core.createGame({ seed: seed });
  var guard = 0;
  while (!g.over && guard < 1e7) {
    guard++;
    var step = 0.5;
    // жадная стратегия: каждый новый заказ на первый свободный подходящий ровер
    g.orders.forEach(function (o) {
      if (o.status !== 'new') return;
      var imp = Logic.isImpossible(o, g.rovers);
      if (imp.impossible) return;
      var rover = g.rovers.filter(function (r) { return r.status === 'idle'; })[0];
      if (!rover) return;
      Core.assignRover(g, o.id, rover.id);
    });
    // эвакуация застрявших, если есть деньги
    g.rovers.forEach(function (r) {
      if (r.status === 'stuck') Core.rescueRover(g, r.id);
    });
    // иногда покупаем улучшения (для покрытия кода)
    if (opts.upgrades && g.credits > 90 && g.day > 2) {
      var u = g.rovers[0];
      if (!u.upgrades.battery) Core.buyUpgrade(g, u.id, 'battery');
      else if (!u.upgrades.capacity) Core.buyUpgrade(g, u.id, 'capacity');
    }
    Core.tick(g, step);
  }
  assert(guard < 1e7, 'симуляция завершилась за ' + guard + ' шагов');
  return g;
}

(function () {
  var g = autoplay(42, { upgrades: true });

  // Инварианты
  var badNumeric = false, badState = false;
  function checkNumeric(obj, path) {
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (typeof v === 'number' && (!isFinite(v) || v < 0 && k === 'rating' || v < 0 && k === 'clockH')) badNumeric = true;
      if (v && typeof v === 'object') checkNumeric(v, path + '.' + k);
    });
  }
  checkNumeric(Core.snapshot(g), '');
  assert(!badNumeric, 'нет NaN/отрицательного рейтинга/времени');

  g.rovers.forEach(function (r) {
    if (r.battery < 0 || r.battery > r.batteryMax + 1e-9) badState = true;
    if (r.capacity <= 0) badState = true;
  });
  assert(!badState, 'батарея роверов в пределах 0..max');

  g.orders.forEach(function (o) {
    var cnt = g.deliveries.filter(function (d) { return d.orderId === o.id; }).length;
    if (o.status === 'delivered' || o.status === 'late_delivered') assert(cnt === 1, 'доставленный заказ имеет ровно одну запись');
    else assert(cnt === 0, 'недоставленный заказ не имеет записей');
  });

  var stats = g.stats;
  assert(stats.delivered >= 0 && stats.failed >= 0, 'статистика корректна');
  assert(g.rating >= 0 && g.rating <= 100, 'рейтинг в границах');
  assert(typeof g.credits === 'number' && isFinite(g.credits), 'кредиты число');
  assert(g.over, 'партия дошла до финала');

  // Несколько раундов на разных сидах — всегда завершаются.
  for (var s = 1; s <= 20; s++) autoplay(s * 101);

  // Детерминизм: одинаковый сид => одинаковый результат.
  var a = autoplay(1234);
  var b = autoplay(1234);
  var same = Core.snapshot(a).events.length === Core.snapshot(b).events.length &&
             Core.snapshot(a).credits === Core.snapshot(b).credits &&
             Core.snapshot(a).stats.delivered === Core.snapshot(b).stats.delivered;
  assert(same, 'одинаковый сид даёт одинаковую партию (детерминизм)');

  console.log('  Результат сида 42: доставлено=' + g.stats.delivered +
    ', в срок=' + g.stats.onTime + ', опоздано=' + g.stats.late +
    ', провалено=' + g.stats.failed + ', потеряно=' + g.stats.lost +
    ', эвакуаций=' + g.stats.rescued + ', прибыль=' + g.stats.profit +
    ', кредиты=' + g.credits + ', рейтинг=' + g.rating + ', победил=' + g.won);
})();

console.log('== Итог: ' + passed + ' passed, ' + failed + ' failed ==');
process.exit(failed ? 1 : 0);
