/* ==========================================================================
 * Moon Courier Crisis — слой хранения данных.
 * Структурированное хранилище: localStorage под ключом moonCourier:v1.
 * Схема (все сущности — коллекции в одном снапшоте):
 *   meta/version  — версия схемы
 *   rovers[]      — парк роверов (батарея, грузоподъёмность, статус, миссия)
 *   orders[]      — заказы (вес, награда, дедлайн, статус, привязка к роверу)
 *   deliveries[]  — выполненные доставки (профит, время, в срок/опоздание)
 *   events[]      — журнал событий (журнал)
 *   stats{}       — агрегированная статистика
 * Плюс экспорт/импорт в JSON, чтобы данные можно было переносить между браузерами.
 * ========================================================================== */
var Store = (function () {
  'use strict';

  var KEY = 'moonCourier:v1';

  function save(snapshot) {
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot));
      return true;
    } catch (e) {
      console.error('Не удалось сохранить:', e);
      return false;
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.rovers || !data.orders) return null;
      return data;
    } catch (e) {
      console.error('Не удалось загрузить:', e);
      return null;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
  }

  function hasSave() {
    return !!load();
  }

  function exportJson(snapshot) {
    return JSON.stringify(snapshot, null, 2);
  }

  function importJson(text) {
    var data = JSON.parse(text);
    if (!data || !data.rovers || !data.orders) throw new Error('Непохоже на сохранение Moon Courier Crisis.');
    return data;
  }

  return { save: save, load: load, clear: clear, hasSave: hasSave, exportJson: exportJson, importJson: importJson };
})();
