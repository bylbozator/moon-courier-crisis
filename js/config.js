/* ==========================================================================
 * Moon Courier Crisis — конфигурация баланса, карты, роверов и заказов.
 * Чистые данные: файл можно подключать и в браузер, и в Node (для тестов).
 * ========================================================================== */

var CONFIG = (function () {
  'use strict';

  var MAP = {
    width: 1000,
    height: 650,
    base: { x: 500, y: 330, name: 'База «Тихо-1»' },
    scaleKmPerPx: 1            // 1 пиксель карты = 1 км маршрута
  };

  // Зоны карты: цвет, риск (0..1, шанс инцидента в час) и рельеф
  // (множитель скорости: <1 — медленно, >1 — быстрее; энергия обратно пропорциональна).
  var ZONES = [
    { id: 'perimeter', name: 'Периметр базы',  color: '#7ee787', risk: 0.05, terrain: 1.00, cx: 500, cy: 330, r: 150, kind: 'ring' },
    { id: 'plains',     name: 'Равнина Спокойствия', color: '#8bd0ff', risk: 0.18, terrain: 1.15, cx: 690, cy: 340, r: 170 },
    { id: 'crater',     name: 'Кратер Смирнов',      color: '#e9b35f', risk: 0.35, terrain: 0.80, cx: 280, cy: 300, r: 150 },
    { id: 'highlands',  name: 'Горы Тавр',           color: '#d08bff', risk: 0.55, terrain: 0.65, cx: 540, cy: 90,  r: 130 },
    { id: 'farside',    name: 'Пик вечной тьмы',     color: '#ff7b72', risk: 0.85, terrain: 0.70, cx: 180, cy: 520, r: 140 }
  ];

  // Точки доставки (аванпосты).
  var TARGETS = [
    { id: 'alpha',     name: 'Аванпост «Альфа»',          zoneId: 'plains',    x: 715, y: 260, baseReward: 55 },
    { id: 'bravo',     name: 'Станция «Браво»',           zoneId: 'plains',    x: 780, y: 465, baseReward: 60 },
    { id: 'smirnov',   name: 'Доки «Смирнов»',            zoneId: 'crater',    x: 300, y: 160, baseReward: 70 },
    { id: 'cratercamp',name: 'Лагерь «Дно кратера»',      zoneId: 'crater',    x: 210, y: 300, baseReward: 75 },
    { id: 'taurus',    name: 'Обсерватория «Тавр»',       zoneId: 'highlands', x: 520, y: 55,  baseReward: 85 },
    { id: 'relay',     name: 'Ретранслятор-3',            zoneId: 'highlands', x: 690, y: 120, baseReward: 80 },
    { id: 'shadow',    name: 'Аванпост «Тень»',           zoneId: 'farside',   x: 150, y: 520, baseReward: 100 }
  ];

  // Стартовые роверы. Батарея в кВт·ч, грузоподъёмность в кг, скорость в км/ч.
  var ROVER_TEMPLATES = [
    { id: 'pulsar',   name: 'Пульсар', battery: 130, capacity: 40,  speed: 60, color: '#e3b341' },
    { id: 'goliath',  name: 'Голиаф', battery: 180, capacity: 100, speed: 45, color: '#f47067' },
    { id: 'sputnik',  name: 'Спутник', battery: 90,  capacity: 25,  speed: 55, color: '#79c0ff' }
  ];

  // Физика и баланс.
  var PHYSICS = {
    baseEnergyPerKm: 0.12,     // кВт·ч на км при пустой загрузке, ровный рельеф
    loadEnergyPenalty: 0.8,    // при полной загрузке энергия растёт в (1 + 0.8) раз
    loadSpeedPenalty: 0.35,    // при полной загрузке скорость падает на 35%
    costPerKm: 0.05,           // расходы на техобслуживание, кредитов за км
    chargingRate: 40,          // кВт·ч/час на базе
    rescueFee: 60,             // кредитов за эвакуацию
    rescueHours: 3,            // время эвакуации
    rescueBatteryPct: 0.1,     // батарея после эвакуации (доля от ёмкости)
    incidentChancePerHour: 0.5,// множитель: риск зоны * нагрузка * этот коэффициент
    lateRewardFactor: 0.5,     // награда при опоздании
    rewardWeightPerKg: 1.2,    // кредитов за кг груза
    rewardRandomMax: 25,       // случайная добавка к награде
    urgencyPremium: 0.35,      // премия за короткий дедлайн (макс. доля)
    riskPremium: 0.8           // премия за рискованную зону (доля от риска)
  };

  // Влияние на рейтинг базы (кап 0..100).
  var RATING = {
    onTime: 2,
    late: -3,
    failed: -10,
    lostCargo: -15,
    rescue: -8,
    cap: 100
  };

  // Дневной цикл и цель игры.
  var CYCLE = {
    hoursPerDay: 24,
    realSecPerGameHour: 2,     // 1 игровой час = 2 реальных секунды
    ordersPerDay: 2,           // сколько заказов появляется в начале дня
    totalDays: 7,              // сколько дней нужно продержаться
    minDeadlineH: 20,          // минимальный дедлайн заказа (часов)
    maxDeadlineH: 48,          // максимальный дедлайн
    upkeepPerDay: 15,          // ежедневные расходы базы (кредитов)
    passRating: 60,            // рейтинг для прохождения
    weightClasses: [           // гамма весов заказов (кг)
      { min: 5,  max: 25 },
      { min: 30, max: 60 },
      { min: 70, max: 95 }
    ],
    impossibleWeight: 150,     // спец. заказ, тяжелее грузоподъёмности всех роверов
    impossibleDay: 2           // день, в который он гарантированно появится
  };

  // Улучшения роверов (покупка кредитами).
  var UPGRADES = [
    { id: 'battery',  name: 'Усиленная батарея',  desc: '+40 кВт·ч', cost: 80, battery: 40 },
    { id: 'capacity', name: 'Усиленная подвеска', desc: '+20 кг',    cost: 60, capacity: 20 }
  ];

  var INCIDENTS = [
    {
      id: 'storm',   name: 'Пылевая буря', weight: 3, speedFactor: 0.45, durationH: 2,
      text: 'Пылевая буря накрыла маршрут — скорость временно снижена.'
    },
    {
      id: 'rubble',  name: 'Каменный завал', weight: 3, batteryPct: 0.08,
      text: 'Ровер пробирается через каменный завал — лишний расход батареи.'
    },
    {
      id: 'wheel',   name: 'Повреждение колёс', weight: 2, speedFactor: 0.6, batteryPct: 0.04,
      text: 'Повреждены колёса: скорость снижена, расход выше.'
    },
    {
      id: 'cargo',   name: 'Потеря груза', weight: 1, cargoLost: true,
      text: 'Груз сорвало с платформы на стыке рельефа. Доставка провалена.'
    }
  ];

  return {
    MAP: MAP,
    ZONES: ZONES,
    TARGETS: TARGETS,
    ROVER_TEMPLATES: ROVER_TEMPLATES,
    PHYSICS: PHYSICS,
    RATING: RATING,
    CYCLE: CYCLE,
    UPGRADES: UPGRADES,
    INCIDENTS: INCIDENTS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG: CONFIG };
}
