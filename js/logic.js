/* ==========================================================================
 * Moon Courier Crisis — чистая логика (без DOM и хранилищ).
 * Все функции можно вызывать из Node для тестов.
 * ========================================================================== */
var Logic = (function () {
  'use strict';

  var C = (function () {
    if (typeof CONFIG !== 'undefined') return CONFIG;
    if (typeof module !== 'undefined' && module.exports) return require('./config.js').CONFIG;
    return null;
  })();

  function zoneById(id) {
    return C.ZONES.filter(function (z) { return z.id === id; })[0];
  }
  function targetById(id) {
    return C.TARGETS.filter(function (t) { return t.id === id; })[0];
  }

  function dist(ax, ay, bx, by) {
    return Math.sqrt(Math.pow(bx - ax, 2) + Math.pow(by - ay, 2));
  }

  // Маршрут туда и обратно, км.
  function roundTripKm(target) {
    return 2 * dist(C.MAP.base.x, C.MAP.base.y, target.x, target.y) * C.MAP.scaleKmPerPx;
  }

  // Доля загрузки ровера (0..1). >1 — не влезает.
  function loadRatio(weight, capacity) {
    return weight / capacity;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // Энергопотребление ровера на маршруте туда+обратно, кВт·ч.
  // Тяжёлый груз и сложный рельеф увеличивают расход.
  function energyNeeded(rover, target, weight) {
    var zone = zoneById(target.zoneId);
    var km = roundTripKm(target);
    var lr = loadRatio(weight, rover.capacity);
    var perKm = C.PHYSICS.baseEnergyPerKm * (1 + C.PHYSICS.loadEnergyPenalty * lr) * (1 / zone.terrain);
    return km * perKm;
  }

  // Время поездки туда и обратно, часов (с учётом рельефа и тяжести груза).
  function travelHours(rover, target, weight) {
    var zone = zoneById(target.zoneId);
    var km = roundTripKm(target);
    var lr = clamp(loadRatio(weight, rover.capacity), 0, 1);
    var speed = rover.speed * zone.terrain * (1 - C.PHYSICS.loadSpeedPenalty * lr);
    return km / Math.max(speed, 1);
  }

  // Сколько времени займёт путь только до точки (без возврата).
  function outboundHours(rover, target, weight) {
    return travelHours(rover, target, weight) / 2;
  }

  // Проверка: можно ли поручить заказ этому роверу прямо сейчас.
  // Возвращает { ok: true } или { ok: false, reason: '...' }.
  function checkFeasible(rover, order, clockH) {
    if (!rover) return { ok: false, reason: 'Выберите ровер.' };
    if (rover.status !== 'idle') {
      var busy = { enroute: 'уже в пути', returning: 'возвращается', stuck: 'застрял и требует эвакуации', charging: 'на подзарядке' }[rover.status];
      return { ok: false, reason: 'Ровер занят: ' + (busy || rover.status) + '.' };
    }
    if (clockH > order.deadline) return { ok: false, reason: 'Срок заказа уже истёк.' };
    if (order.weight > rover.capacity) {
      return { ok: false, reason: 'Вес ' + order.weight + ' кг превышает грузоподъёмность (' + rover.capacity + ' кг).' };
    }
    var target = targetById(order.targetId);
    var need = energyNeeded(rover, target, order.weight);
    if (need > rover.battery) {
      return {
        ok: false,
        reason: 'Батареи не хватит: нужно ' + Math.ceil(need) + ' кВт·ч, есть ' + Math.floor(rover.battery) + '.'
      };
    }
    return { ok: true, reason: 'Можно. ' + Math.ceil(need) + ' кВт·ч, ~' + Math.ceil(travelHours(rover, target, order.weight)) + ' ч туда-обратно.' };
  }

  // Простая (видимая игроку) оценка риска маршрута в процентах.
  function routeRisk(order, rover) {
    var zone = zoneById(order.zoneId);
    var lr = rover ? loadRatio(order.weight, rover.capacity) : 0.5;
    var pct = zone.risk * 100 * (1 + lr);
    return Math.round(clamp(pct, 0, 95));
  }

  // Невозможен ли заказ в принципе (для текущего парка роверов).
  function isImpossible(order, rovers) {
    var maxCap = 0, maxBat = 0;
    rovers.forEach(function (r) {
      maxCap = Math.max(maxCap, r.capacity);
      maxBat = Math.max(maxBat, r.battery);
    });
    if (order.weight > maxCap) return { impossible: true, reason: 'Тяжелее всех роверов базы (' + maxCap + ' кг).' };
    var target = targetById(order.targetId);
    var dummy = { capacity: maxCap, battery: maxBat, speed: 999 };
    if (energyNeeded(dummy, target, order.weight) > maxBat) {
      return { impossible: true, reason: 'Не хватит батареи даже на идеальном ровере.' };
    }
    return { impossible: false };
  }

  // Экономика доставки.
  function deliveryCost(rover, target, weight) {
    var km = roundTripKm(target);
    var lr = loadRatio(weight, rover.capacity);
    return km * C.PHYSICS.costPerKm * (1 + lr);
  }

  function onTimeReward(order) {
    var r = order.reward;
    return r;
  }
  function lateReward(order) {
    return Math.round(order.reward * C.PHYSICS.lateRewardFactor);
  }

  function profitFor(order, rover, onTime) {
    var target = targetById(order.targetId);
    var gross = onTime ? onTimeReward(order) : lateReward(order);
    return Math.round(gross - deliveryCost(rover, target, order.weight));
  }

  // Генерация награды заказа: база точки + вес + случайность, премии за риск и срочность.
  function makeReward(target, weight, deadlineH, rng) {
    rng = rng || Math.random;
    var zone = zoneById(target.zoneId);
    var base = target.baseReward + weight * C.PHYSICS.rewardWeightPerKg;
    var rnd = rng() * C.PHYSICS.rewardRandomMax;
    var urgency = (C.CYCLE.maxDeadlineH - deadlineH) / (C.CYCLE.maxDeadlineH - C.CYCLE.minDeadlineH);
    var v = base + rnd;
    v *= 1 + zone.risk * C.PHYSICS.riskPremium;
    v *= 1 + clamp(urgency, 0, 1) * C.PHYSICS.urgencyPremium;
    return Math.round(v);
  }

  // Инцидент за игровой час на маршруте. Вероятность = риск зоны * (1 + доля загрузки).
  function rollIncident(order, rover, rng) {
    var zone = zoneById(order.zoneId);
    var lr = clamp(loadRatio(order.weight, rover.capacity), 0, 1);
    var chance = C.PHYSICS.incidentChancePerHour * zone.risk * (1 + lr);
    if (rng() >= chance) return null;
    // выбор инцидента с весами
    var pool = C.INCIDENTS;
    var total = 0;
    pool.forEach(function (i) { total += i.weight; });
    var roll = rng() * total, acc = 0;
    for (var i = 0; i < pool.length; i++) {
      acc += pool[i].weight;
      if (roll <= acc) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function ratingDelta(kind) {
    return C.RATING[kind] || 0;
  }

  function applyRating(current, delta) {
    return clamp(current + delta, 0, C.RATING.cap);
  }

  // Связка «заказ -> зона», чтобы не дублировать данные в заказе.
  function zoneOfOrder(order) {
    return zoneById(order.zoneId);
  }

  return {
    zoneById: zoneById,
    targetById: targetById,
    dist: dist,
    roundTripKm: roundTripKm,
    loadRatio: loadRatio,
    clamp: clamp,
    energyNeeded: energyNeeded,
    travelHours: travelHours,
    outboundHours: outboundHours,
    checkFeasible: checkFeasible,
    routeRisk: routeRisk,
    isImpossible: isImpossible,
    deliveryCost: deliveryCost,
    lateReward: lateReward,
    profitFor: profitFor,
    makeReward: makeReward,
    rollIncident: rollIncident,
    ratingDelta: ratingDelta,
    applyRating: applyRating,
    zoneOfOrder: zoneOfOrder
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Logic: Logic };
}
