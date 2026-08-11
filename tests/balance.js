'use strict';
var CONFIG = require('../js/config.js').CONFIG;
var Logic = require('../js/logic.js').Logic;
var Core = require('../js/core.js').Core;

function smartAutoplay(seed) {
  var g = Core.createGame({ seed: seed });
  var guard = 0;
  while (!g.over && guard < 1e7) {
    guard++;
    var step = 0.5;
    var open = g.orders.filter(function (o) { return o.status === 'new'; });
    open.sort(function (a, b) { return a.deadline - b.deadline; });
    open.forEach(function (o) {
      if (o.status !== 'new') return;
      var imp = Logic.isImpossible(o, g.rovers);
      if (imp.impossible) return;
      var target = Logic.targetById(o.targetId);
      var best = null, bestNeed = 1e18;
      g.rovers.forEach(function (r) {
        if (r.status !== 'idle') return;
        var c = Logic.checkFeasible(r, o, g.clockH);
        if (!c.ok) return;
        var need = Logic.energyNeeded(r, target, o.weight);
        var eta = Logic.outboundHours(r, target, o.weight);
        if (g.clockH + eta > o.deadline + 4) return; // безнадёжно поздно
        if (need < bestNeed) { bestNeed = need; best = r; }
      });
      if (best) Core.assignRover(g, o.id, best.id);
    });
    g.rovers.forEach(function (r) { if (r.status === 'stuck') Core.rescueRover(g, r.id); });
    Core.tick(g, step);
  }
  return g;
}

var wins = 0, total = 0, profitSum = 0;
for (var s = 1; s <= 60; s++) {
  var g = smartAutoplay(s * 1000);
  total++;
  if (g.won) wins++;
  profitSum += g.stats.profit;
  if (s <= 5) {
    console.log('seed=' + s * 1000 + ' won=' + g.won + ' rating=' + g.rating +
      ' del=' + g.stats.delivered + ' onTime=' + g.stats.onTime + ' late=' + g.stats.late +
      ' failed=' + g.stats.failed + ' lost=' + g.stats.lost + ' resc=' + g.stats.rescued +
      ' profit=' + g.stats.profit + ' credits=' + g.credits);
  }
}
console.log('Win rate (умный игрок): ' + wins + '/' + total + ' = ' + (100 * wins / total).toFixed(0) + '%, средний доход ' + Math.round(profitSum / total));
