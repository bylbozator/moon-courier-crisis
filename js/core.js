/* ==========================================================================
 * Moon Courier Crisis — игровой движок (чистое состояние, без DOM/хранилища).
 * Может работать и в браузере, и в Node (для автотестов/автопрогона).
 * ========================================================================== */
var Core = (function () {
  'use strict';

  var C = (function () {
    if (typeof CONFIG !== 'undefined') return CONFIG;
    if (typeof module !== 'undefined' && module.exports) return require('./config.js').CONFIG;
    return null;
  })();
  var L = (function () {
    if (typeof Logic !== 'undefined') return Logic;
    if (typeof module !== 'undefined' && module.exports) return require('./logic.js').Logic;
    return null;
  })();

  // Детерминированный ГПСЧ (mulberry32), чтобы можно было воспроизвести партию.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeId(game, prefix) {
    return prefix + '_' + (game._seq++);
  }

  // ---------- генерация заказов ----------
  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function makeOrder(rng, clockH, day, seq) {
    var weightClass = pick(rng, C.CYCLE.weightClasses);
    var weight = Math.round(weightClass.min + rng() * (weightClass.max - weightClass.min));
    var target = pick(rng, C.TARGETS);
    var deadline = clockH + Math.round(C.CYCLE.minDeadlineH + rng() * (C.CYCLE.maxDeadlineH - C.CYCLE.minDeadlineH));
    var reward = L.makeReward(target, weight, deadline - clockH, rng);
    return {
      id: 'o' + day + '_' + seq,
      targetId: target.id,
      zoneId: target.zoneId,
      weight: weight,
      reward: reward,
      deadline: deadline,
      status: 'new',            // new | assigned | delivered | late_delivered | failed | lost | expired | impossible
      roverId: null,
      assignedAt: null,
      deliveredAt: null,
      timeOnRouteH: null,
      onTime: null,
      profit: null,
      createdDay: day
    };
  }

  function makeImpossibleOrder(rng, clockH, day) {
    var target = pick(rng, C.TARGETS);
    var deadline = clockH + Math.round(C.CYCLE.minDeadlineH + rng() * (C.CYCLE.maxDeadlineH - C.CYCLE.minDeadlineH));
    return {
      id: 'o' + day + '_bulk',
      targetId: target.id,
      zoneId: target.zoneId,
      weight: C.CYCLE.impossibleWeight,
      reward: L.makeReward(target, C.CYCLE.impossibleWeight, deadline - clockH, rng),
      deadline: deadline,
      status: 'new',
      roverId: null,
      assignedAt: null,
      deliveredAt: null,
      timeOnRouteH: null,
      onTime: null,
      profit: null,
      createdDay: day
    };
  }

  // ---------- состояние ----------
  function newRover(tpl) {
    return {
      id: tpl.id,
      name: tpl.name,
      battery: tpl.battery,
      batteryMax: tpl.battery,
      capacity: tpl.capacity,
      capacityBase: tpl.capacity,
      speed: tpl.speed,
      color: tpl.color,
      status: 'idle',           // idle | enroute | returning | stuck
      mission: null,
      x: C.MAP.base.x, y: C.MAP.base.y,
      incidentActive: null,
      upgrades: { battery: false, capacity: false }
    };
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
    var rng = mulberry32(seed);

    var game = {
      seed: seed,
      rng: rng,
      _seq: 0,
      clockH: 0,                 // общее игровое время, часы
      credits: 120,              // стартовый бюджет
      rating: 100,
      day: 1,
      over: false,
      won: null,
      rovers: C.ROVER_TEMPLATES.map(newRover),
      orders: [],
      deliveries: [],
      events: [],
      stats: {
        delivered: 0, onTime: 0, late: 0, failed: 0, lost: 0, rescued: 0,
        profit: 0, spent: 0, maxProfitPerOrder: 0
      }
    };

    spawnOrders(game, 1);
    return game;
  }

  function pushEvent(game, type, message, severity) {
    game.events.push({
      id: makeId(game, 'ev'),
      day: game.day,
      clockH: Math.round(game.clockH * 10) / 10,
      type: type,
      message: message,
      severity: severity || 'info'
    });
    if (game.events.length > 400) game.events.splice(0, game.events.length - 400);
  }

  function spawnOrders(game, day) {
    var n = C.CYCLE.ordersPerDay;
    for (var i = 0; i < n; i++) {
      game.orders.push(makeOrder(game.rng, game.clockH, day, i + 1));
    }
    if (day === C.CYCLE.impossibleDay) {
      var imp = makeImpossibleOrder(game.rng, game.clockH, day);
      game.orders.push(imp);
      pushEvent(game, 'order', 'Сверхтяжёлый контейнер на базе: ' + imp.weight + ' кг. Грузоподъёмность всех роверов не позволяет его вывезти.', 'danger');
    }
    pushEvent(game, 'day', 'День ' + day + '. Новые заказы: ' + n + ' шт.', 'info');
  }

  // ---------- действия игрока ----------
  function assignRover(game, orderId, roverId) {
    var order = findOrder(game, orderId);
    var rover = findRover(game, roverId);
    if (!order || !rover) return { ok: false, reason: 'Не найдено.' };
    var check = L.checkFeasible(rover, order, game.clockH);
    if (!check.ok) return check;

    var target = L.targetById(order.targetId);
    var zone = L.zoneById(target.zoneId);
    var lr = L.clamp(L.loadRatio(order.weight, rover.capacity), 0, 1);

    order.status = 'assigned';
    order.assignedAt = game.clockH;
    order.roverId = rover.id;
    order.zoneId = target.zoneId;

    rover.status = 'enroute';
    rover.mission = {
      orderId: order.id,
      targetId: target.id,
      zoneId: target.zoneId,
      cargoWeight: order.weight,
      phase: 'outbound',
      legA: { x: C.MAP.base.x, y: C.MAP.base.y },
      legB: { x: target.x, y: target.y },
      legKm: L.roundTripKm(target) / 2,
      traveledKm: 0,
      speed: rover.speed * zone.terrain * (1 - C.PHYSICS.loadSpeedPenalty * lr),
      stormUntil: 0
    };
    pushEvent(game, 'assign',
      rover.name + ' принял заказ «' + target.name + '» (' + order.weight + ' кг, ~' +
      Math.ceil(L.travelHours(rover, target, order.weight)) + ' ч туда-обратно).', 'info');
    return { ok: true };
  }

  function rescueRover(game, roverId) {
    var rover = findRover(game, roverId);
    if (!rover || rover.status !== 'stuck') return { ok: false, reason: 'Ровер не застрял.' };
    if (game.credits < C.PHYSICS.rescueFee) return { ok: false, reason: 'Не хватает кредитов на эвакуацию (' + C.PHYSICS.rescueFee + ').' };
    game.credits -= C.PHYSICS.rescueFee;
    game.stats.spent += C.PHYSICS.rescueFee;
    game.stats.rescued += 1;
    game.rating = L.applyRating(game.rating, L.ratingDelta('rescue'));

    var backKm = L.dist(rover.x, rover.y, C.MAP.base.x, C.MAP.base.y);
    rover.status = 'returning';
    rover.battery = Math.max(rover.battery, rover.batteryMax * C.PHYSICS.rescueBatteryPct);
    rover.incidentActive = null;
    rover.mission = {
      orderId: null,
      targetId: null,
      cargoWeight: 0,
      phase: 'returning',
      legA: { x: rover.x, y: rover.y },
      legB: { x: C.MAP.base.x, y: C.MAP.base.y },
      legKm: Math.max(backKm, 1),
      traveledKm: 0,
      speed: rover.speed,
      stormUntil: 0,
      rescuing: true
    };
    pushEvent(game, 'rescue', 'Эвакуация ' + rover.name + '. Списано ' + C.PHYSICS.rescueFee + ' кредитов, рейтинг −' + Math.abs(L.ratingDelta('rescue')) + '.', 'danger');
    return { ok: true };
  }

  function buyUpgrade(game, roverId, upgradeId) {
    var rover = findRover(game, roverId);
    if (!rover) return { ok: false, reason: 'Ровер не найден.' };
    var up = C.UPGRADES.filter(function (u) { return u.id === upgradeId; })[0];
    if (!up) return { ok: false, reason: 'Нет такого улучшения.' };
    if (rover.upgrades[upgradeId]) return { ok: false, reason: 'Уже установлено.' };
    if (game.credits < up.cost) return { ok: false, reason: 'Не хватает кредитов (' + up.cost + ').' };
    game.credits -= up.cost;
    game.stats.spent += up.cost;
    rover.upgrades[upgradeId] = true;
    if (up.battery) { rover.batteryMax += up.battery; rover.battery += up.battery; }
    if (up.capacity) rover.capacity += up.capacity;
    pushEvent(game, 'upgrade', rover.name + ': установлено «' + up.name + '» (−' + up.cost + ' кредитов).', 'info');
    return { ok: true };
  }

  // ---------- симуляция ----------
  function tick(game, dtHours) {
    if (game.over) return;
    game.clockH += dtHours;
    game.day = Math.floor(game.clockH / C.CYCLE.hoursPerDay) + 1;

    // подзарядка на базе
    game.rovers.forEach(function (r) {
      if (r.status === 'idle' && r.battery < r.batteryMax) {
        r.battery = Math.min(r.batteryMax, r.battery + C.PHYSICS.chargingRate * dtHours);
        r.x = C.MAP.base.x; r.y = C.MAP.base.y;
      }
    });

    // движение роверов
    game.rovers.forEach(function (r) {
      if (r.status === 'enroute' || r.status === 'returning') moveRover(game, r, dtHours);
    });

    // истечение дедлайнов
    game.orders.forEach(function (o) {
      if (o.status === 'new' && game.clockH > o.deadline) {
        var imp = L.isImpossible(o, game.rovers);
        if (imp.impossible) {
          o.status = 'impossible';
          game.stats.failed += 1;
          pushEvent(game, 'fail', 'Контейнер «' + L.targetById(o.targetId).name + '» (' + o.weight + ' кг) не может быть доставлен: ' + imp.reason, 'danger');
        } else {
          o.status = 'failed';
          game.stats.failed += 1;
          game.rating = L.applyRating(game.rating, L.ratingDelta('failed'));
          pushEvent(game, 'fail', 'Заказ «' + L.targetById(o.targetId).name + '» истёк по сроку. Рейтинг −' + Math.abs(L.ratingDelta('failed')) + '.', 'danger');
        }
      }
    });

    // смена дня
    var prevDay = Math.floor((game.clockH - dtHours) / C.CYCLE.hoursPerDay) + 1;
    if (game.day > prevDay && !game.over) {
      spawnOrders(game, game.day);
      game.credits -= C.CYCLE.upkeepPerDay;
      game.stats.spent += C.CYCLE.upkeepPerDay;
      pushEvent(game, 'upkeep', 'Техобслуживание базы: −' + C.CYCLE.upkeepPerDay + ' кредитов.', 'info');
    }

    // финал
    var finishedAt = C.CYCLE.totalDays * C.CYCLE.hoursPerDay;
    if (game.clockH >= finishedAt && !game.over) {
      game.over = true;
      game.won = game.rating >= C.CYCLE.passRating;
      pushEvent(game, 'end', game.won ? 'База устояла! Рейтинг ' + game.rating + ' — миссия выполнена.' : 'База потеряла доверие. Рейтинг ' + game.rating + '.', game.won ? 'good' : 'danger');
    }
    if (game.rating <= 0 && !game.over) {
      game.over = true;
      game.won = false;
      pushEvent(game, 'end', 'Рейтинг базы упал до нуля — контракт расторгнут.', 'danger');
    }
  }

  function moveRover(game, rover, dtHours) {
    var m = rover.mission;
    if (!m) return;

    var slow = 1;
    if (m.stormUntil > game.clockH) slow = 0.45;
    var kmThisTick = m.speed * slow * dtHours;
    var lr = L.clamp(L.loadRatio(m.cargoWeight, rover.capacity), 0, 1);
    var zone = L.zoneById(m.zoneId) || L.zoneById('perimeter');
    var perKm = C.PHYSICS.baseEnergyPerKm * (1 + C.PHYSICS.loadEnergyPenalty * lr) * (1 / zone.terrain);
    rover.battery -= perKm * kmThisTick;
    m.traveledKm += kmThisTick;

    // позиция на текущем отрезке
    var t = L.clamp(m.traveledKm / m.legKm, 0, 1);
    rover.x = m.legA.x + (m.legB.x - m.legA.x) * t;
    rover.y = m.legA.y + (m.legB.y - m.legA.y) * t;

    // конец отрезка
    if (m.traveledKm >= m.legKm) {
      if (m.phase === 'outbound') {
        arriveOutbound(game, rover);
      } else {
        rover.status = 'idle';
        rover.mission = null;
        rover.x = C.MAP.base.x; rover.y = C.MAP.base.y;
        rover.incidentActive = null;
        pushEvent(game, 'arrive', rover.name + ' вернулся на базу.', 'info');
      }
      return;
    }

    // батарея кончилась в пути
    if (rover.battery <= 0) {
      if (m.phase === 'outbound') {
        var order = findOrder(game, m.orderId);
        if (order && order.status === 'assigned') {
          order.status = 'failed';
          order.roverId = null;
          game.stats.failed += 1;
          game.rating = L.applyRating(game.rating, L.ratingDelta('failed'));
          pushEvent(game, 'fail', rover.name + ' встал на полпути — батарея разряжена. Заказ провален.', 'danger');
        }
      }
      rover.status = 'stuck';
      rover.mission = null;
      rover.battery = 0;
      rover.incidentActive = null;
      pushEvent(game, 'stuck', rover.name + ' застрял на поверхности. Эвакуация (' + C.PHYSICS.rescueFee + ' кредитов, рейтинг −' + Math.abs(L.ratingDelta('rescue')) + ').', 'danger');
      return;
    }

    // инциденты на пути к точке
    if (m.phase === 'outbound') {
      rollIncidentForRover(game, rover, dtHours);
    }
  }

  function arriveOutbound(game, rover) {
    var m = rover.mission;
    var order = findOrder(game, m.orderId);
    var target = L.targetById(m.targetId);
    if (order && order.status === 'assigned') {
      var onTime = game.clockH <= order.deadline;
      order.status = onTime ? 'delivered' : 'late_delivered';
      order.deliveredAt = game.clockH;
      order.timeOnRouteH = game.clockH - order.assignedAt;
      order.onTime = onTime;
      var profit = L.profitFor(order, rover, onTime);
      order.profit = profit;
      game.credits += profit;
      game.stats.profit += profit;
      game.stats.delivered += 1;
      if (onTime) game.stats.onTime += 1; else game.stats.late += 1;
      game.stats.maxProfitPerOrder = Math.max(game.stats.maxProfitPerOrder, profit);
      game.rating = L.applyRating(game.rating, L.ratingDelta(onTime ? 'onTime' : 'late'));
      game.deliveries.push({
        id: makeId(game, 'd'),
        orderId: order.id,
        roverId: rover.id,
        targetId: m.targetId,
        weight: order.weight,
        reward: onTime ? order.reward : L.lateReward(order),
        cost: Math.round(L.deliveryCost(rover, target, order.weight)),
        profit: profit,
        onTime: onTime,
        hours: order.timeOnRouteH,
        clockH: game.clockH,
        day: game.day
      });
      pushEvent(game, 'delivery',
        (onTime ? 'Доставлено в срок: ' : 'Опоздание: ') + target.name + ' (' + order.weight + ' кг). ' +
        (profit >= 0 ? '+' : '') + profit + ' кредитов. Рейтинг ' + (onTime ? '+' : '') + L.ratingDelta(onTime ? 'onTime' : 'late') + '.',
        onTime && profit >= 0 ? 'good' : 'warn');
    }

    // начало возврата
    rover.mission = {
      orderId: null,
      targetId: m.targetId,
      cargoWeight: 0,
      phase: 'returning',
      legA: { x: target.x, y: target.y },
      legB: { x: C.MAP.base.x, y: C.MAP.base.y },
      legKm: L.roundTripKm(target) / 2,
      traveledKm: 0,
      speed: rover.speed * L.zoneById(target.zoneId).terrain,
      stormUntil: 0
    };
    rover.status = 'returning';
    rover.incidentActive = null;

    // хватит ли батареи на возврат
    var needReturn = L.energyNeeded(rover, target, 0) / 2;
    if (rover.battery < needReturn) {
      rover.status = 'stuck';
      rover.mission = null;
      pushEvent(game, 'stuck', rover.name + ' доставил груз, но не может вернуться — батарея на нуле. Эвакуация обязательна (' + C.PHYSICS.rescueFee + ' кредитов).', 'danger');
    }
  }

  function rollIncidentForRover(game, rover, dtHours) {
    var m = rover.mission;
    var order = findOrder(game, m.orderId);
    if (!order) return;
    var zone = L.zoneById(order.zoneId);
    var lr = L.clamp(L.loadRatio(order.weight, rover.capacity), 0, 1);
    var chance = C.PHYSICS.incidentChancePerHour * zone.risk * (1 + lr);
    // подгоняем шанс под величину шага, чтобы скорость симуляции не влияла на частоту
    var scaled = chance * Math.min(dtHours, 2);
    if (game.rng() >= scaled) return;
    var inc = L.rollIncident(order, rover, game.rng);
    if (!inc) return;
    if (inc.cargoLost) {
      order.status = 'lost';
      order.roverId = null;
      order.profit = 0;
      game.stats.lost += 1;
      game.stats.failed += 1;
      game.rating = L.applyRating(game.rating, L.ratingDelta('lostCargo'));
      m.cargoWeight = 0;
      rover.incidentActive = inc;
      pushEvent(game, 'incident', inc.text + ' Груз «' + L.targetById(order.targetId).name + '» потерян. Рейтинг −' + Math.abs(L.ratingDelta('lostCargo')) + '.', 'danger');
      return;
    }
    rover.incidentActive = inc;
    if (inc.batteryPct) rover.battery -= rover.batteryMax * inc.batteryPct;
    if (inc.speedFactor) m.stormUntil = game.clockH + (inc.durationH || 2);
    pushEvent(game, 'incident', inc.text + ' (' + rover.name + ').', 'warn');
  }

  // ---------- поиск ----------
  function findRover(game, id) {
    return game.rovers.filter(function (r) { return r.id === id; })[0];
  }
  function findOrder(game, id) {
    return game.orders.filter(function (o) { return o.id === id; })[0];
  }

  // ---------- снапшоты для сохранения ----------
  function snapshot(game) {
    return JSON.parse(JSON.stringify({
      version: 1,
      seed: game.seed,
      _seq: game._seq,
      clockH: game.clockH,
      credits: game.credits,
      rating: game.rating,
      day: game.day,
      over: game.over,
      won: game.won,
      rovers: game.rovers,
      orders: game.orders,
      deliveries: game.deliveries,
      events: game.events,
      stats: game.stats
    }));
  }

  function restore(data) {
    return {
      seed: data.seed,
      rng: mulberry32(data.seed),
      _seq: data._seq || 0,
      clockH: data.clockH,
      credits: data.credits,
      rating: data.rating,
      day: data.day,
      over: data.over,
      won: data.won,
      rovers: data.rovers,
      orders: data.orders,
      deliveries: data.deliveries,
      events: data.events,
      stats: data.stats
    };
  }

  return {
    createGame: createGame,
    tick: tick,
    assignRover: assignRover,
    rescueRover: rescueRover,
    buyUpgrade: buyUpgrade,
    findRover: findRover,
    findOrder: findOrder,
    snapshot: snapshot,
    restore: restore
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Core: Core };
}
