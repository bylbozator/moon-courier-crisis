/* ==========================================================================
 * Moon Courier Crisis — отрисовка карты Луны (HTML5 Canvas, top-down).
 * ========================================================================== */
var MoonMap = (function () {
  'use strict';

  var C = typeof CONFIG !== 'undefined' ? CONFIG : null;
  var cv, ctx;
  var W = 0, H = 0;

  function init(canvas) {
    cv = canvas;
    ctx = canvas.getContext('2d');
    W = C.MAP.width;
    H = C.MAP.height;
    cv.width = W; cv.height = H;
    return cv;
  }

  // Логические координаты экрана -> координаты карты.
  function toMap(clientX, clientY) {
    var r = cv.getBoundingClientRect();
    var x = (clientX - r.left) / r.width * W;
    var y = (clientY - r.top) / r.height * H;
    return { x: x, y: y };
  }

  function drawStars(seed) {
    var rng = function () {
      var a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }();
    for (var i = 0; i < 120; i++) {
      var x = rng() * W, y = rng() * H, s = rng() * 1.4 + 0.3;
      ctx.fillStyle = 'rgba(255,255,255,' + (rng() * 0.5 + 0.15) + ')';
      ctx.fillRect(x, y, s, s);
    }
  }

  function drawSurface() {
    var g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 620);
    g.addColorStop(0, '#1a2336');
    g.addColorStop(0.6, '#131a2b');
    g.addColorStop(1, '#0a0e1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // декоративные кратеры
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    [[820, 120, 55], [120, 90, 40], [880, 560, 70], [60, 620, 30], [940, 300, 26], [200, 610, 48]].forEach(function (cr) {
      ctx.beginPath();
      ctx.arc(cr[0], cr[1], cr[2], 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cr[0], cr[1], cr[2] * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  function drawZones() {
    C.ZONES.forEach(function (z) {
      var isRing = z.kind === 'ring';
      ctx.beginPath();
      if (isRing) ctx.arc(C.MAP.base.x, C.MAP.base.y, z.r, 0, Math.PI * 2);
      else ctx.arc(z.cx, z.cy, z.r, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(z.color, 0.12);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(z.color, 0.45);
      ctx.lineWidth = 1.5;
      ctx.setLineDash(isRing ? [8, 6] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      var lx = isRing ? C.MAP.base.x - 30 : z.cx;
      var ly = isRing ? C.MAP.base.y - z.r - 14 : z.cy + z.r + 4;
      ctx.font = '600 13px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(z.name, lx, ly);
      var riskPct = Math.round(z.risk * 100);
      ctx.font = '600 12px "Segoe UI", sans-serif';
      ctx.fillStyle = z.risk > 0.5 ? '#ff7b72' : z.risk > 0.25 ? '#e9b35f' : '#7ee787';
      ctx.fillText('риск ' + riskPct + '% · скорость x' + z.terrain.toFixed(2), lx, ly + 15);
    });
  }

  function drawBase() {
    var b = C.MAP.base;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = '#0f1626';
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 2;
    ctx.fillRect(-16, -16, 32, 32);
    ctx.strokeRect(-16, -16, 32, 32);
    ctx.fillStyle = '#58a6ff';
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
    ctx.font = '600 13px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#58a6ff';
    ctx.fillText(b.name, b.x, b.y + 32);
  }

  function drawTargets(game, selectedOrderId) {
    C.TARGETS.forEach(function (t) {
      var zone = C.ZONES.filter(function (z) { return z.id === t.zoneId; })[0];
      var selected = false;
      game.orders.forEach(function (o) {
        if (o.targetId === t.id && o.id === selectedOrderId) selected = true;
      });
      var pulse = selected ? (Math.sin(Date.now() / 180) * 0.5 + 0.5) : 0;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = zone.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (selected) {
        ctx.beginPath();
        ctx.arc(t.x, t.y, 12 + pulse * 7, 0, Math.PI * 2);
        ctx.strokeStyle = hexToRgba(zone.color, 0.8);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.font = '500 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(t.name, t.x + 11, t.y + 4);
    });
  }

  function drawRovers(game) {
    game.rovers.forEach(function (r) {
      if (r.mission && (r.status === 'enroute' || r.status === 'returning')) {
        var tgt = C.TARGETS.filter(function (t) { return t.id === r.mission.targetId; })[0];
        if (r.mission.phase === 'outbound' && tgt) {
          ctx.beginPath();
          ctx.moveTo(C.MAP.base.x, C.MAP.base.y);
          ctx.lineTo(tgt.x, tgt.y);
          ctx.strokeStyle = hexToRgba(r.color, 0.25);
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      ctx.save();
      ctx.translate(r.x, r.y);
      var rad = 11;
      ctx.beginPath();
      ctx.arc(0, 0, rad + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fillStyle = r.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, rad * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
      ctx.restore();

      ctx.font = '600 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(r.name, r.x, r.y - rad - 6);

      var pct = Math.round(r.battery / r.batteryMax * 100);
      ctx.font = '500 10px "Segoe UI", sans-serif';
      ctx.fillStyle = r.status === 'stuck' ? '#ff7b72' : pct > 40 ? '#7ee787' : pct > 15 ? '#e9b35f' : '#ff7b72';
      ctx.fillText(pct + '%', r.x, r.y + rad + 14);
    });
  }

  // Подсказка под курсором.
  function hitTest(game, mx, my) {
    var info = null;
    C.TARGETS.forEach(function (t) {
      if (Math.hypot(mx - t.x, my - t.y) < 18) {
        info = { type: 'target', target: t };
      }
    });
    if (info) return info;
    game.rovers.forEach(function (r) {
      if (Math.hypot(mx - r.x, my - r.y) < 18) {
        info = { type: 'rover', rover: r };
      }
    });
    if (info) return info;
    if (Math.hypot(mx - C.MAP.base.x, my - C.MAP.base.y) < 30) {
      return { type: 'base' };
    }
    var z = null;
    C.ZONES.forEach(function (zone) {
      if (zone.kind === 'ring') {
        var d = Math.hypot(mx - C.MAP.base.x, my - C.MAP.base.y);
        if (d <= zone.r) z = zone;
      } else {
        if (Math.hypot(mx - zone.cx, my - zone.cy) <= zone.r) z = zone;
      }
    });
    if (z) return { type: 'zone', zone: z };
    return null;
  }

  function render(game, opts) {
    if (!game) return;
    opts = opts || {};
    drawSurface();
    drawZones();
    drawTargets(game, opts.selectedOrderId);
    drawBase();
    drawRovers(game);
    // лёгкая сетка
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (var x = 0; x <= W; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (var y = 0; y <= H; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    drawStars(C.MAP.seedStar || 1234);
  }

  function hexToRgba(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  return { init: init, render: render, hitTest: hitTest, toMap: toMap };
})();
