/* ==========================================================================
 * Moon Courier Crisis — API-бэкенд (Node, только встроенные модули, без npm).
 *
 * - REST API для игрового состояния (server-authoritative симуляция);
 * - раздаёт статику (index.html, js/, css/), так что весь проект живёт
 *   на одном сервере: http://localhost:8080
 * - хранение: JSON-файл data/save.json (слой можно заменить на SQLite/Postgres).
 *
 * Запуск:  node server.js   (порт: PORT или 8080)
 * Тесты:   node tests/api.test.js
 * ========================================================================== */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var C = require('./js/config.js').CONFIG;
var L = require('./js/logic.js').Logic;
var Core = require('./js/core.js').Core;

var ROOT = __dirname;
var VERSION = '1.0.0';
var SIM_TICK_MS = 250;          // интервал тиков серверной симуляции
var SIM_TICK_HOURS = 0.125;     // игровых часов за тик при скорости 1
var MAX_BODY_BYTES = 2 * 1024 * 1024;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ---------------------------------------------------------------------------
// Приложение: состояние, симуляция, персистентность
// ---------------------------------------------------------------------------
function createApp(opts) {
  opts = opts || {};
  var dataFile = opts.dataFile || path.join(ROOT, 'data', 'save.json');

  var game = null;
  var speed = 1;               // 0 = пауза, 1/2/4 = ускорение
  var demoTarget = null;       // автопрогон ботом до этого часа (день * hoursPerDay)
  var saveTimer = null;
  var simTimer = null;

  function persist() {
    if (!game) return;
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(Core.snapshot(game), null, 2));
  }

  function load() {
    if (!fs.existsSync(dataFile)) return null;
    try {
      var raw = fs.readFileSync(dataFile, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function restart(seed) {
    game = Core.createGame({ seed: seed });
    speed = 1;
    demoTarget = null;
    persist();
    return game;
  }

  function replaceState(data) {
    game = Core.restore(data);
    speed = 1;
    demoTarget = null;
    persist();
    return game;
  }

  // Простой бот для автопрогона демо (как в js/main.js).
  function botTurn() {
    var open = game.orders.filter(function (o) { return o.status === 'new'; })
      .sort(function (a, b) { return a.deadline - b.deadline; });
    open.forEach(function (o) {
      if (o.status !== 'new') return;
      var imp = L.isImpossible(o, game.rovers);
      if (imp.impossible) return;
      var target = L.targetById(o.targetId);
      var best = null, bestNeed = 1e18;
      game.rovers.forEach(function (r) {
        if (r.status !== 'idle') return;
        var c = L.checkFeasible(r, o, game.clockH);
        if (!c.ok) return;
        var need = L.energyNeeded(r, target, o.weight);
        var eta = L.outboundHours(r, target, o.weight);
        if (game.clockH + eta > o.deadline + 4) return;
        if (need < bestNeed) { bestNeed = need; best = r; }
      });
      if (best) Core.assignRover(game, o.id, best.id);
    });
    game.rovers.forEach(function (r) { if (r.status === 'stuck') Core.rescueRover(game, r.id); });
  }

  function tickSim() {
    if (!game || speed <= 0 || game.over) return;
    if (demoTarget != null) botTurn();
    Core.tick(game, SIM_TICK_HOURS * speed);
    if (demoTarget != null && game.clockH >= demoTarget) {
      speed = 0;
      demoTarget = null;
      persist();
    }
  }

  function startSim() {
    if (simTimer) return;
    simTimer = setInterval(tickSim, SIM_TICK_MS);
    saveTimer = setInterval(persist, 1000);
  }

  function stopSim() {
    if (simTimer) clearInterval(simTimer);
    if (saveTimer) clearInterval(saveTimer);
    simTimer = null;
    saveTimer = null;
  }

  var initial = load();
  if (initial && initial.version != null) game = Core.restore(initial);
  startSim();

  // -------------------------------------------------------------------------
  // HTTP-маршруты
  // -------------------------------------------------------------------------
  function requireGame(res) {
    if (!game) {
      sendJson(res, 404, { ok: false, error: 'Нет активной партии. Создайте: POST /api/game.' });
      return false;
    }
    return true;
  }

  function sendJson(res, status, obj) {
    var body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  }

  function handleApi(method, pathname, query, body, res) {
    // ---- health / config ----
    if (pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, version: VERSION });
    }
    if (pathname === '/api/config') {
      return sendJson(res, 200, { ok: true, config: C });
    }

    // ---- игра ----
    if (pathname === '/api/game') {
      if (method === 'GET') {
        if (!requireGame(res)) return;
        return sendJson(res, 200, { game: Core.snapshot(game) });
      }
      if (method === 'POST') {
        var seed = body && body.seed != null ? body.seed : Math.floor(Math.random() * 1e9);
        if (body && body.import) replaceState(body.import);
        else restart(seed);
        return sendJson(res, 200, { ok: true, game: Core.snapshot(game) });
      }
      return sendJson(res, 405, { ok: false, error: 'Метод не поддерживается.' });
    }

    // ---- подресурсы состояния ----
    if (pathname === '/api/orders') {
      if (!requireGame(res)) return;
      return sendJson(res, 200, { orders: game.orders });
    }
    if (pathname === '/api/rovers') {
      if (!requireGame(res)) return;
      return sendJson(res, 200, { rovers: game.rovers });
    }
    if (pathname === '/api/deliveries') {
      if (!requireGame(res)) return;
      return sendJson(res, 200, { deliveries: game.deliveries });
    }
    if (pathname === '/api/events') {
      if (!requireGame(res)) return;
      return sendJson(res, 200, { events: game.events });
    }
    if (pathname === '/api/stats') {
      if (!requireGame(res)) return;
      return sendJson(res, 200, { stats: game.stats });
    }

    // ---- управление скоростью ----
    if (pathname === '/api/speed' && method === 'POST') {
      var sp = body && body.speed;
      if (sp !== 0 && sp !== 1 && sp !== 2 && sp !== 4) {
        return sendJson(res, 400, { ok: false, error: 'speed должен быть 0, 1, 2 или 4.' });
      }
      speed = sp;
      return sendJson(res, 200, { ok: true, speed: speed });
    }

    // ---- демо-автопрогон ----
    if (pathname === '/api/demo' && method === 'POST') {
      if (!requireGame(res)) return;
      var day = body && body.targetDay;
      if (!day || typeof day !== 'number' || day <= 0) {
        return sendJson(res, 400, { ok: false, error: 'Укажите targetDay (число).' });
      }
      demoTarget = day * C.CYCLE.hoursPerDay;
      speed = 1;
      return sendJson(res, 200, { ok: true, targetDay: day });
    }

    // ---- действия игрока: /api/orders/:id/assign ----
    var m = pathname.match(/^\/api\/orders\/([^/]+)\/assign$/);
    if (m && method === 'POST') {
      if (!requireGame(res)) return;
      var oid = decodeURIComponent(m[1]);
      var rid = body && body.roverId;
      if (!rid) return sendJson(res, 400, { ok: false, error: 'Укажите roverId.' });
      var result = Core.assignRover(game, oid, rid);
      if (!result.ok) return sendJson(res, 400, { ok: false, reason: result.reason });
      persist();
      return sendJson(res, 200, { ok: true, reason: result.reason, game: Core.snapshot(game) });
    }

    // ---- /api/rovers/:id/rescue ----
    m = pathname.match(/^\/api\/rovers\/([^/]+)\/rescue$/);
    if (m && method === 'POST') {
      if (!requireGame(res)) return;
      var rid2 = decodeURIComponent(m[1]);
      var result2 = Core.rescueRover(game, rid2);
      if (!result2.ok) return sendJson(res, 400, { ok: false, reason: result2.reason });
      persist();
      return sendJson(res, 200, { ok: true, reason: result2.reason, game: Core.snapshot(game) });
    }

    // ---- /api/rovers/:id/upgrade ----
    m = pathname.match(/^\/api\/rovers\/([^/]+)\/upgrade$/);
    if (m && method === 'POST') {
      if (!requireGame(res)) return;
      var rid3 = decodeURIComponent(m[1]);
      var up = body && body.upgrade;
      var result3 = Core.buyUpgrade(game, rid3, up);
      if (!result3.ok) return sendJson(res, 400, { ok: false, reason: result3.reason });
      persist();
      return sendJson(res, 200, { ok: true, reason: result3.reason, game: Core.snapshot(game) });
    }

    sendJson(res, 404, { ok: false, error: 'Неизвестный маршрут: ' + method + ' ' + pathname });
  }

  function serveStatic(pathname, res) {
    var rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    var file = path.normalize(path.join(ROOT, rel));
    if (file.indexOf(ROOT) !== 0) {
      sendJson(res, 403, { ok: false, error: 'Доступ запрещён.' });
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      sendJson(res, 404, { ok: false, error: 'Файл не найден.' });
      return;
    }
    var ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  }

  function route(req, res) {
    var parsed = url.parse(req.url, true);
    var pathname = decodeURIComponent(parsed.pathname);

    // парсим JSON-тело для POST/PUT
    if (req.method === 'POST') {
      var chunks = [];
      var size = 0;
      req.on('data', function (chunk) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) { res.writeHead(413).end(); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', function () {
        var body = null;
        var raw = Buffer.concat(chunks).toString('utf8');
        if (raw) {
          try { body = JSON.parse(raw); } catch (e) { body = null; }
        }
        routeParsed(req, res, pathname, parsed.query, body);
      });
      return;
    }
    routeParsed(req, res, pathname, parsed.query, null);
  }

  function routeParsed(req, res, pathname, query, body) {
    if (pathname === '/api/health' || pathname.indexOf('/api/') === 0) {
      handleApi(req.method, pathname, query, body, res);
      return;
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'Метод не поддерживается.' });
      return;
    }
    serveStatic(pathname, res);
  }

  var server = http.createServer(route);
  return { server: server, stop: stopSim, persist: persist, state: function () { return game; } };
}

// ---------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------
if (require.main === module) {
  var port = parseInt(process.env.PORT || '8080', 10);
  var app = createApp();
  app.server.listen(port, function () {
    console.log('Moon Courier Crisis API запущен: http://localhost:' + port);
    console.log('Здоровье:      GET /api/health');
    console.log('Состояние:     GET /api/game  |  Новая партия: POST /api/game {"seed":123}');
    console.log('Спецификация:  README.md → раздел «API бэкенд»');
  });
}

module.exports = { createApp: createApp, VERSION: VERSION };
