/* Планировщик отпусков — серверный скрипт для Google Таблицы.
 * Вставьте целиком в Расширения → Apps Script и опубликуйте как веб-приложение. */

/* =====================================================================
 * Общая логика планировщика отпусков.
 * Этот файл подключается в браузере (app/shared.js) и вставляется
 * в начало серверного скрипта Google Apps Script (gas/Code.gs).
 * Даты везде хранятся строками 'ГГГГ-ММ-ДД'.
 * ===================================================================== */

/* ---------- Производственный календарь ---------- */

// Нерабочие праздничные дни по ст. 112 ТК РФ. По ст. 120 ТК РФ
// они в число календарных дней отпуска не включаются.
var HOLIDAYS_MD = ['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08',
  '02-23', '03-08', '05-01', '05-09', '06-12', '11-04'];

// Переносы выходных по постановлениям Правительства РФ:
// off — дополнительные нерабочие дни, work — рабочие субботы/воскресенья.
// 2025 — пост. № 1335 от 04.10.2024; 2026 — пост. № 1466 от 24.09.2025;
// 2027 — пост. № 1187 от 17.09.2026.
var PROD_CAL = {
  2025: { off: ['2025-05-02', '2025-05-08', '2025-06-13', '2025-11-03', '2025-12-31'], work: ['2025-11-01'] },
  2026: { off: ['2026-01-09', '2026-03-09', '2026-05-11', '2026-12-31'], work: [] },
  2027: { off: ['2027-02-22', '2027-05-03', '2027-05-10', '2027-06-14', '2027-11-05', '2027-12-31'], work: ['2027-02-20'] }
};

var DAY_MS = 86400000;

function dn(iso) { // ISO -> номер дня (UTC)
  var p = String(iso).split('-');
  return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY_MS);
}
function isoOf(n) {
  var d = new Date(n * DAY_MS);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
function pad2(x) { return (x < 10 ? '0' : '') + x; }
function isValidISO(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  return isoOf(dn(s)) === s;
}
function addDays(iso, k) { return isoOf(dn(iso) + k); }
function weekdayOf(iso) { return new Date(dn(iso) * DAY_MS).getUTCDay(); } // 0 = вс
function fmtDate(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : ''; }
function fmtShort(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : ''; }

function isHoliday(iso) { return HOLIDAYS_MD.indexOf(String(iso).slice(5)) >= 0; }

var _offCache = {};
function offDaysOfYear(year) {
  if (_offCache[year]) return _offCache[year];
  var res = { off: {}, work: {} };
  var cal = PROD_CAL[year];
  if (cal) {
    cal.off.forEach(function (d) { res.off[d] = true; });
    cal.work.forEach(function (d) { res.work[d] = true; });
  } else {
    // Год без утверждённого календаря: праздник, выпавший на выходной
    // (кроме 1–8 января), переносится на следующий рабочий день.
    HOLIDAYS_MD.forEach(function (md) {
      if (md.slice(0, 2) === '01' && +md.slice(3) <= 8) return;
      var iso = year + '-' + md, wd = weekdayOf(iso);
      if (wd === 0 || wd === 6) {
        var n = dn(iso) + 1;
        while (true) {
          var c = isoOf(n), w = weekdayOf(c);
          if (w !== 0 && w !== 6 && !isHoliday(c) && !res.off[c]) { res.off[c] = true; break; }
          n++;
        }
      }
    });
  }
  _offCache[year] = res;
  return res;
}
// 'holiday' — праздник (ст.112), 'off' — выходной/перенесённый, 'work' — рабочий
function dayType(iso) {
  if (isHoliday(iso)) return 'holiday';
  var y = +iso.slice(0, 4), cal = offDaysOfYear(y);
  if (cal.work[iso]) return 'work';
  if (cal.off[iso]) return 'off';
  var wd = weekdayOf(iso);
  return (wd === 0 || wd === 6) ? 'off' : 'work';
}

// Количество календарных дней отпуска (без праздничных дней)
function vacDays(start, end) {
  if (!isValidISO(start) || !isValidISO(end) || end < start) return 0;
  var n = 0;
  for (var i = dn(start); i <= dn(end); i++) if (!isHoliday(isoOf(i))) n++;
  return n;
}
function holidaysIn(start, end) {
  var r = [];
  if (!isValidISO(start) || !isValidISO(end) || end < start) return r;
  for (var i = dn(start); i <= dn(end); i++) { var s = isoOf(i); if (isHoliday(s)) r.push(s); }
  return r;
}
// Дата окончания для отпуска из N дней (праздники продлевают отпуск)
function endForDays(start, n) {
  if (!isValidISO(start) || !(n > 0)) return '';
  var i = dn(start), c = 0;
  while (true) {
    if (!isHoliday(isoOf(i))) c++;
    if (c >= n) return isoOf(i);
    i++;
  }
}

/* ---------- Справочники ---------- */

var STATUS = {
  proposed: 'На согласовании',
  approved: 'Согласован',
  rejected: 'Отклонён',
  cancelled: 'Отменён',
  moved: 'Перенесён'
};
var ACTIVE = { proposed: true, approved: true };

// Цвета сотрудников (без красного — он зарезервирован для конфликтов)
var PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6',
  '#0e7490', '#8a5a2b', '#64748b', '#b5179e', '#3f6212', '#1c5cab', '#c2410c', '#0f766e', '#7e22ce'];

var DEFAULT_SETTINGS = {
  orgName: 'ПАО «Россети Юг» — филиал «Кубаньэнерго»',
  unitName: 'Департамент развития нетарифных услуг',
  managerName: '',
  managerPosition: 'Начальник департамента',
  hrName: '',
  maxAbsent: 2,
  minPart: 14,
  notifyDays: 14,
  planYear: 2027,
  password: '1234'
};

function emptyState() {
  return { employees: [], vacations: [], balances: [], blackouts: [], settings: clone(DEFAULT_SETTINGS), log: [] };
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function uid(prefix) {
  return (prefix || 'x') + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}
function nowStamp() {
  var d = new Date(Date.now() + 3 * 3600000); // МСК
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
function todayISO() {
  var d = new Date(Date.now() + 3 * 3600000);
  return d.toISOString().slice(0, 10);
}
function empById(state, id) {
  for (var i = 0; i < state.employees.length; i++) if (state.employees[i].id === id) return state.employees[i];
  return null;
}
function vacById(state, id) {
  for (var i = 0; i < state.vacations.length; i++) if (state.vacations[i].id === id) return state.vacations[i];
  return null;
}
function shortName(name) {
  var p = String(name || '').trim().split(/\s+/);
  if (p.length < 2) return p[0] || '';
  return p[0] + ' ' + p.slice(1).map(function (x) { return x[0] + '.'; }).join('');
}
function initials(name) {
  return String(name || '').trim().split(/\s+/).map(function (x) { return x[0] || ''; }).join('').slice(0, 3);
}
function vacYear(v) { return v.year || +String(v.start).slice(0, 4); }

/* ---------- Остатки дней ---------- */

function carryOf(state, empId, year) {
  for (var i = 0; i < state.balances.length; i++) {
    var b = state.balances[i];
    if (b.employeeId === empId && +b.year === +year) return +b.carry || 0;
  }
  return 0;
}
// Баланс сотрудника за учётный год
function balanceOf(state, empId, year, today) {
  today = today || todayISO();
  var e = empById(state, empId) || {};
  var r = { entitled: (+e.daysPerYear || 0) + carryOf(state, empId, year), carry: carryOf(state, empId, year),
    approved: 0, proposed: 0, used: 0, parts: [] };
  state.vacations.forEach(function (v) {
    if (v.employeeId !== empId || vacYear(v) !== +year || !ACTIVE[v.status]) return;
    var d = +v.days || vacDays(v.start, v.end);
    if (v.status === 'approved') r.approved += d; else r.proposed += d;
    r.parts.push(d);
  });
  // использовано — только уже прошедшие дни согласованных отпусков
  state.vacations.forEach(function (v) {
    if (v.employeeId !== empId || vacYear(v) !== +year || v.status !== 'approved') return;
    if (v.start >= today) return;
    var last = v.end < today ? v.end : addDays(today, -1);
    r.used += vacDays(v.start, last);
  });
  r.free = r.entitled - r.approved - r.proposed;
  r.maxPart = r.parts.length ? Math.max.apply(null, r.parts) : 0;
  return r;
}

/* ---------- Проверка периода ---------- */
// level: block — нельзя подать; conflict — красный; warn — жёлтый; info — справка
function checkPeriod(state, q, today) {
  today = today || todayISO();
  var res = { days: 0, holidays: [], issues: [], overlaps: [], perDay: {}, conflictDays: {} };
  var push = function (level, text, days) { res.issues.push({ level: level, text: text, days: days || [] }); };
  var emp = empById(state, q.employeeId);
  if (!emp) { push('block', 'Не выбран сотрудник'); return res; }
  if (!isValidISO(q.start) || !isValidISO(q.end)) { push('block', 'Укажите даты начала и окончания'); return res; }
  if (q.end < q.start) { push('block', 'Дата окончания раньше даты начала'); return res; }
  if (dn(q.end) - dn(q.start) > 120) { push('block', 'Слишком длинный период (больше 120 дней)'); return res; }
  var S = state.settings || DEFAULT_SETTINGS;
  var maxAbsent = +S.maxAbsent || 0, minPart = +S.minPart || 0, notifyDays = +S.notifyDays || 0;
  res.days = vacDays(q.start, q.end);
  res.holidays = holidaysIn(q.start, q.end);
  if (res.days === 0) { push('block', 'В периоде нет дней отпуска (только праздники)'); return res; }

  var others = state.vacations.filter(function (v) {
    return ACTIVE[v.status] && v.id !== q.id && v.id !== q.replacesId && v.start <= q.end && v.end >= q.start;
  });
  // пересечение с собственными периодами
  var own = others.filter(function (v) { return v.employeeId === q.employeeId; });
  own.forEach(function (v) {
    push('block', 'Пересекается с вашим периодом ' + fmtShort(v.start) + '–' + fmtShort(v.end) + ' (' + STATUS[v.status].toLowerCase() + ')');
  });
  others = others.filter(function (v) { return v.employeeId !== q.employeeId; });

  // по дням
  for (var i = dn(q.start); i <= dn(q.end); i++) {
    var d = isoOf(i);
    res.perDay[d] = others.filter(function (v) { return v.start <= d && v.end >= d; })
      .map(function (v) { return { employeeId: v.employeeId, status: v.status, vacationId: v.id }; });
  }
  // пересечения с коллегами
  var byEmp = {};
  others.forEach(function (v) {
    var from = v.start > q.start ? v.start : q.start, to = v.end < q.end ? v.end : q.end;
    var o = { employeeId: v.employeeId, vacation: v, from: from, to: to, n: dn(to) - dn(from) + 1, rule: '' };
    res.overlaps.push(o);
    byEmp[v.employeeId] = true;
  });
  // правило замещения
  var deputyId = emp.deputyId;
  res.overlaps.forEach(function (o) {
    var other = empById(state, o.employeeId) || {};
    if (deputyId && o.employeeId === deputyId) o.rule = 'Замещающий';
    else if (other.deputyId === q.employeeId) o.rule = 'Вы замещаете';
    if (o.rule) {
      var days = [];
      for (var k = dn(o.from); k <= dn(o.to); k++) { days.push(isoOf(k)); res.conflictDays[isoOf(k)] = true; }
      push('conflict', (o.rule === 'Замещающий'
        ? 'Замещающий сотрудник ' + shortName(other.name) + ' в отпуске '
        : 'Вы замещаете ' + shortName(other.name) + ', а он(а) в отпуске ') +
        fmtShort(o.from) + '–' + fmtShort(o.to) + (o.vacation.status === 'proposed' ? ' (заявка)' : ''), days);
    }
  });
  // лимит одновременного отсутствия
  if (maxAbsent > 0) {
    var over = [];
    Object.keys(res.perDay).forEach(function (d) {
      var cnt = {};
      res.perDay[d].forEach(function (x) { cnt[x.employeeId] = 1; });
      if (Object.keys(cnt).length + 1 > maxAbsent) { over.push(d); res.conflictDays[d] = true; }
    });
    if (over.length) push('conflict', 'Превышен лимит: одновременно в отпуске больше ' + maxAbsent + ' чел. — ' +
      rangesText(over) + ' (' + over.length + ' дн.)', over);
  }
  // просто пересечения
  if (res.overlaps.length) {
    var names = {};
    res.overlaps.forEach(function (o) { if (!o.rule) names[o.employeeId] = 1; });
    var list = Object.keys(names).map(function (id) { return shortName((empById(state, id) || {}).name); });
    if (list.length) push('warn', 'Пересечение с отпуском: ' + list.join(', '));
  }
  // запретные периоды
  (state.blackouts || []).forEach(function (b) {
    if (b.start <= q.end && b.end >= q.start) {
      push('warn', 'Нежелательный период ' + fmtShort(b.start) + '–' + fmtShort(b.end) + (b.reason ? ': ' + b.reason : ''));
    }
  });
  // остаток дней
  var year = +q.start.slice(0, 4);
  var bal = balanceOf(state, q.employeeId, year, today);
  var mine = state.vacations.filter(function (v) {
    return v.employeeId === q.employeeId && ACTIVE[v.status] && vacYear(v) === year && v.id !== q.id && v.id !== q.replacesId;
  });
  var planned = mine.reduce(function (s, v) { return s + (+v.days || 0); }, 0);
  var left = bal.entitled - planned - res.days;
  res.leftAfter = left;
  res.entitled = bal.entitled;
  if (left < 0) push('warn', 'Превышение положенных дней на ' + (-left) + ' дн. (положено ' + bal.entitled + ' за ' + year + ' г.)');
  // часть не менее 14 дней (ст. 125 ТК РФ)
  if (minPart > 0 && res.days < minPart) {
    var hasBig = mine.some(function (v) { return (+v.days || 0) >= minPart; });
    if (!hasBig) {
      if (left < minPart) push('warn', 'Ни одна часть отпуска за ' + year + ' г. не будет ≥ ' + minPart + ' дн. (ст. 125 ТК РФ)');
      else push('info', 'Помните: одна из частей отпуска должна быть не менее ' + minPart + ' дн.');
    }
  }
  if (q.start < today) push('warn', 'Дата начала уже прошла');
  else if (notifyDays > 0 && dn(q.start) - dn(today) < notifyDays)
    push('warn', 'До начала меньше ' + notifyDays + ' дней — уведомление по ст. 123 ТК РФ не успеет');
  return res;
}

function rangesText(days) {
  if (!days.length) return '';
  days = days.slice().sort();
  var out = [], a = days[0], b = days[0];
  for (var i = 1; i <= days.length; i++) {
    var d = days[i];
    if (d && dn(d) === dn(b) + 1) { b = d; continue; }
    out.push(a === b ? fmtShort(a) : fmtShort(a) + '–' + fmtShort(b));
    a = b = d;
  }
  return out.join(', ');
}

// Подбор свободных окон: n дней, начиная с from, без конфликтов
function findWindows(state, empId, n, from, to, limit, excludeId, excludeId2) {
  var res = [], d = dn(from), end = dn(to);
  while (d <= end && res.length < (limit || 5)) {
    var s = isoOf(d);
    // начинаем с первого рабочего дня после выходных/праздников
    if (dayType(s) === 'work' && dayType(addDays(s, -1)) !== 'work') {
      var e = endForDays(s, n);
      var chk = checkPeriod(state, { employeeId: empId, start: s, end: e, id: excludeId, replacesId: excludeId2 });
      var bad = chk.issues.some(function (x) { return x.level === 'block' || x.level === 'conflict'; });
      var overl = chk.overlaps.length;
      if (!bad) { res.push({ start: s, end: e, overlaps: overl }); d += 7; continue; }
    }
    d++;
  }
  return res;
}

/* ---------- Операции (единые для браузера и сервера) ---------- */

function applyOp(state, action, p, actor) {
  p = p || {};
  var isMgr = actor && actor.role === 'manager';
  var who = isMgr ? 'Руководитель' : ((empById(state, actor && actor.employeeId) || {}).name || '?');
  var need = function (cond, msg) { if (!cond) throw new Error(msg); };
  var mgrOnly = function () { need(isMgr, 'Действие доступно только руководителю'); };
  var log = function (text) {
    state.log = state.log || [];
    state.log.unshift({ ts: nowStamp(), who: who, text: text });
    if (state.log.length > 1000) state.log.length = 1000;
  };
  var describe = function (v) {
    return shortName((empById(state, v.employeeId) || {}).name) + ' ' + fmtDate(v.start) + '–' + fmtDate(v.end) + ' (' + v.days + ' дн.)';
  };
  var validateDates = function (v) {
    var chk = checkPeriod(state, v);
    var block = chk.issues.filter(function (x) { return x.level === 'block'; });
    need(!block.length, block.length ? block[0].text : '');
    return chk;
  };

  switch (action) {
    case 'propose': {
      var empId = isMgr ? p.employeeId : actor.employeeId;
      need(empById(state, empId), 'Сотрудник не найден');
      var v = {
        id: uid('v'), employeeId: empId, start: p.start, end: p.end, days: 0,
        status: isMgr && p.approve ? 'approved' : 'proposed', year: +p.year || +String(p.start).slice(0, 4),
        comment: String(p.comment || '').slice(0, 500), managerComment: '',
        createdAt: nowStamp(), updatedAt: nowStamp(), updatedBy: who, replacesId: p.replacesId || ''
      };
      if (v.replacesId) {
        var old = vacById(state, v.replacesId);
        need(old && old.employeeId === empId && old.status === 'approved', 'Переносить можно только согласованный отпуск');
      }
      validateDates(v);
      v.days = vacDays(v.start, v.end);
      if (v.status === 'approved' && v.replacesId) { vacById(state, v.replacesId).status = 'moved'; }
      state.vacations.push(v);
      log((v.replacesId ? 'Перенос: ' : (v.status === 'approved' ? 'Добавлен отпуск: ' : 'Заявка: ')) + describe(v));
      return v.id;
    }
    case 'updateVacation': {
      var u = vacById(state, p.id);
      need(u, 'Период не найден');
      need(isMgr || (u.employeeId === actor.employeeId && u.status === 'proposed'),
        'Изменять можно только свои заявки на согласовании');
      var nv = clone(u);
      nv.start = p.start; nv.end = p.end;
      if (p.comment !== undefined) nv.comment = String(p.comment).slice(0, 500);
      if (isMgr && p.year) nv.year = +p.year;
      else if (nv.start.slice(0, 4) !== u.start.slice(0, 4)) nv.year = +nv.start.slice(0, 4);
      validateDates(nv);
      nv.days = vacDays(nv.start, nv.end);
      nv.updatedAt = nowStamp(); nv.updatedBy = who;
      state.vacations[state.vacations.indexOf(u)] = nv;
      log('Изменён период: ' + describe(nv));
      return nv.id;
    }
    case 'withdraw': {
      var w = vacById(state, p.id);
      need(w, 'Период не найден');
      need(isMgr || (w.employeeId === actor.employeeId && w.status === 'proposed'), 'Отозвать можно только свою заявку на согласовании');
      need(ACTIVE[w.status], 'Период уже не активен');
      w.status = 'cancelled'; w.updatedAt = nowStamp(); w.updatedBy = who;
      if (p.comment) w.managerComment = String(p.comment).slice(0, 500);
      log('Отменён: ' + describe(w));
      return w.id;
    }
    case 'approve': {
      mgrOnly();
      var a = vacById(state, p.id);
      need(a && a.status === 'proposed', 'Заявка не найдена или уже рассмотрена');
      validateDates(a);
      a.status = 'approved'; a.managerComment = String(p.comment || '').slice(0, 500);
      a.updatedAt = nowStamp(); a.updatedBy = who;
      if (a.replacesId) { var r0 = vacById(state, a.replacesId); if (r0 && r0.status === 'approved') r0.status = 'moved'; }
      log('Согласовано: ' + describe(a));
      return a.id;
    }
    case 'reject': {
      mgrOnly();
      var rj = vacById(state, p.id);
      need(rj && rj.status === 'proposed', 'Заявка не найдена или уже рассмотрена');
      rj.status = 'rejected'; rj.managerComment = String(p.comment || '').slice(0, 500);
      rj.updatedAt = nowStamp(); rj.updatedBy = who;
      log('Отклонено: ' + describe(rj) + (rj.managerComment ? ' — ' + rj.managerComment : ''));
      return rj.id;
    }
    case 'deleteVacation': {
      mgrOnly();
      var dv = vacById(state, p.id);
      need(dv, 'Период не найден');
      state.vacations.splice(state.vacations.indexOf(dv), 1);
      log('Удалён период: ' + describe(dv));
      return p.id;
    }
    case 'saveEmployee': {
      mgrOnly();
      var e = p.employee || {};
      need(String(e.name || '').trim(), 'Укажите Ф.И.О.');
      var ex = e.id ? empById(state, e.id) : null;
      var rec = ex || { id: uid('e'), color: PALETTE[state.employees.length % PALETTE.length], order: state.employees.length + 1, pin: '' };
      rec.name = String(e.name).trim();
      rec.position = String(e.position || '').trim();
      rec.tabNo = String(e.tabNo || '').trim();
      rec.daysPerYear = Math.max(0, +e.daysPerYear || 0);
      rec.deputyId = e.deputyId && e.deputyId !== rec.id ? e.deputyId : '';
      if (e.color) rec.color = e.color;
      if (e.pin !== undefined && e.pin !== null && e.pin !== '__keep__') rec.pin = String(e.pin).trim();
      if (!ex) state.employees.push(rec);
      if (e.carryYear) {
        var found = false;
        state.balances.forEach(function (b) { if (b.employeeId === rec.id && +b.year === +e.carryYear) { b.carry = +e.carry || 0; found = true; } });
        if (!found && +e.carry) state.balances.push({ employeeId: rec.id, year: +e.carryYear, carry: +e.carry });
      }
      log((ex ? 'Изменён сотрудник: ' : 'Добавлен сотрудник: ') + rec.name);
      return rec.id;
    }
    case 'deleteEmployee': {
      mgrOnly();
      var de = empById(state, p.id);
      need(de, 'Сотрудник не найден');
      state.employees.splice(state.employees.indexOf(de), 1);
      state.vacations = state.vacations.filter(function (v) { return v.employeeId !== p.id; });
      state.balances = state.balances.filter(function (b) { return b.employeeId !== p.id; });
      state.employees.forEach(function (x) { if (x.deputyId === p.id) x.deputyId = ''; });
      log('Удалён сотрудник: ' + de.name);
      return p.id;
    }
    case 'saveSettings': {
      mgrOnly();
      var s = p.settings || {};
      var cur = state.settings;
      ['orgName', 'unitName', 'managerName', 'managerPosition', 'hrName'].forEach(function (k) {
        if (s[k] !== undefined) cur[k] = String(s[k]);
      });
      ['maxAbsent', 'minPart', 'notifyDays', 'planYear'].forEach(function (k) {
        if (s[k] !== undefined && s[k] !== '') cur[k] = +s[k] || 0;
      });
      if (s.password) { need(String(s.password).length >= 4, 'Пароль — не короче 4 символов'); cur.password = String(s.password); }
      if (Array.isArray(p.blackouts)) {
        state.blackouts = p.blackouts.filter(function (b) { return isValidISO(b.start) && isValidISO(b.end) && b.end >= b.start; })
          .map(function (b) { return { start: b.start, end: b.end, reason: String(b.reason || '').slice(0, 200) }; });
      }
      log('Изменены настройки');
      return true;
    }
    case 'importState': {
      mgrOnly();
      var st = p.state;
      need(st && Array.isArray(st.employees) && Array.isArray(st.vacations), 'Неверный формат файла');
      var keepPwd = state.settings.password;
      state.employees = st.employees; state.vacations = st.vacations;
      state.balances = st.balances || []; state.blackouts = st.blackouts || [];
      state.settings = Object.assign(clone(DEFAULT_SETTINGS), st.settings || {});
      state.settings.password = keepPwd;
      log('Загружены данные из файла');
      return true;
    }
    default:
      throw new Error('Неизвестное действие: ' + action);
  }
}

// Данные, которые видны всем (без паролей и PIN-кодов)
function publicState(state) {
  var s = clone(state);
  s.settings.password = '';
  s.settings.defaultPassword = state.settings.password === DEFAULT_SETTINGS.password;
  s.employees.forEach(function (e) { e.hasPin = !!e.pin; e.pin = ''; });
  return s;
}
// Проверка входа: возвращает actor или бросает ошибку
function authenticate(state, auth) {
  auth = auth || {};
  if (auth.role === 'manager') {
    if (String(auth.secret || '') !== String(state.settings.password || '')) throw new Error('Неверный пароль руководителя');
    return { role: 'manager' };
  }
  if (auth.role === 'employee') {
    var e = empById(state, auth.employeeId);
    if (!e) throw new Error('Сотрудник не найден');
    if (e.pin && String(auth.secret || '') !== String(e.pin)) throw new Error('Неверный PIN-код');
    return { role: 'employee', employeeId: e.id };
  }
  throw new Error('Требуется вход');
}


/* =====================================================================
 * Серверная часть (Google Apps Script): хранение в Google Таблице
 * и веб-API для программы «Планировщик отпусков».
 * ===================================================================== */

// ID таблицы. Нужен, только если скрипт создан отдельно от таблицы.
// Если скрипт открыт из самой таблицы (Расширения → Apps Script) — можно не менять.
var SPREADSHEET_ID = '1r8786SayXTaBXsucbuxSKM6YwgCC6J9MuBdrkm8izCM';

var SHEETS = {
  employees: { name: 'Сотрудники', cols: [
    ['id', 'ID'], ['name', 'Ф.И.О.'], ['position', 'Должность'], ['tabNo', 'Табельный №'],
    ['daysPerYear', 'Дней в год'], ['deputyId', 'Замещающий (ID)'], ['_deputyName', 'Замещающий'],
    ['pin', 'PIN'], ['color', 'Цвет'], ['order', 'Порядок']] },
  vacations: { name: 'Отпуска', cols: [
    ['id', 'ID'], ['employeeId', 'Сотрудник (ID)'], ['_name', 'Ф.И.О.'], ['start', 'Начало'], ['end', 'Окончание'],
    ['days', 'Дней'], ['status', 'Статус'], ['year', 'Учётный год'], ['comment', 'Комментарий сотрудника'],
    ['managerComment', 'Комментарий руководителя'], ['createdAt', 'Создано'], ['updatedAt', 'Изменено'],
    ['updatedBy', 'Кем изменено'], ['replacesId', 'Переносит (ID)']] },
  balances: { name: 'Остатки', cols: [
    ['employeeId', 'Сотрудник (ID)'], ['_name', 'Ф.И.О.'], ['year', 'Год'], ['carry', 'Остаток на начало года']] },
  blackouts: { name: 'Ограничения', cols: [['start', 'Начало'], ['end', 'Окончание'], ['reason', 'Причина']] },
  settings: { name: 'Настройки', cols: [['key', 'Ключ'], ['label', 'Параметр'], ['value', 'Значение']] },
  log: { name: 'Журнал', cols: [['ts', 'Время'], ['who', 'Кто'], ['text', 'Событие']] }
};
var TEXT_KEYS = { id: 1, employeeId: 1, start: 1, end: 1, pin: 1, tabNo: 1, deputyId: 1, replacesId: 1, ts: 1,
  createdAt: 1, updatedAt: 1, key: 1, value: 1, color: 1 };
var NUM_KEYS = { daysPerYear: 1, days: 1, year: 1, carry: 1, order: 1 };
var SETTING_LABELS = {
  orgName: 'Организация', unitName: 'Структурное подразделение', managerName: 'Руководитель (Ф.И.О.)',
  managerPosition: 'Должность руководителя', hrName: 'Руководитель кадровой службы (Ф.И.О.)',
  maxAbsent: 'Макс. одновременно в отпуске, чел.', minPart: 'Мин. длина одной части отпуска, дн.',
  notifyDays: 'Уведомлять за, дн.', planYear: 'Год планирования', password: 'Пароль руководителя'
};
var STATUS_BY_LABEL = {};
Object.keys(STATUS).forEach(function (k) { STATUS_BY_LABEL[STATUS[k]] = k; });

function getSS_() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss;
}

function cellToString_(v, tz) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v).trim();
}
// "02.03.2026" -> "2026-03-02"
function normDate_(s) {
  s = String(s || '').trim();
  var m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return m[3] + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
  return s;
}

function readSheet_(ss, def, tz) {
  var sh = ss.getSheetByName(def.name);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  def.cols.forEach(function (c) { idx[c[0]] = head.indexOf(c[1]); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r], o = {}, empty = true;
    def.cols.forEach(function (c) {
      var k = c[0];
      if (k.charAt(0) === '_' || idx[k] < 0) return;
      var v = row[idx[k]];
      if (NUM_KEYS[k]) v = (v === '' || v === null) ? 0 : +v || 0;
      else v = cellToString_(v, tz);
      if (v !== '' && v !== 0) empty = false;
      o[k] = v;
    });
    if (!empty) out.push(o);
  }
  return out;
}

function writeSheet_(ss, def, rows) {
  var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
  var ncol = def.cols.length;
  var head = def.cols.map(function (c) { return c[1]; });
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, Math.max(ncol, sh.getLastColumn())).clearContent();
  sh.getRange(1, 1, 1, ncol).setValues([head]).setFontWeight('bold');
  if (!rows.length) return;
  var data = rows.map(function (o) {
    return def.cols.map(function (c) { var v = o[c[0]]; return v === undefined || v === null ? '' : v; });
  });
  // текстовый формат для дат и кодов, чтобы таблица не превращала их в числа
  def.cols.forEach(function (c, i) {
    if (TEXT_KEYS[c[0]]) sh.getRange(2, i + 1, data.length, 1).setNumberFormat('@');
  });
  sh.getRange(2, 1, data.length, ncol).setValues(data);
}

function loadState_() {
  var ss = getSS_(), tz = ss.getSpreadsheetTimeZone();
  var st = emptyState();
  st.employees = readSheet_(ss, SHEETS.employees, tz);
  st.employees.sort(function (a, b) { return (a.order || 999) - (b.order || 999); });
  st.vacations = readSheet_(ss, SHEETS.vacations, tz).map(function (v) {
    v.start = normDate_(v.start); v.end = normDate_(v.end);
    v.status = STATUS_BY_LABEL[v.status] || (STATUS[v.status] ? v.status : 'proposed');
    if (!v.days) v.days = vacDays(v.start, v.end);
    if (!v.year) v.year = +String(v.start).slice(0, 4);
    if (!v.id) v.id = uid('v');
    return v;
  });
  st.balances = readSheet_(ss, SHEETS.balances, tz);
  st.blackouts = readSheet_(ss, SHEETS.blackouts, tz).map(function (b) {
    b.start = normDate_(b.start); b.end = normDate_(b.end); return b;
  });
  readSheet_(ss, SHEETS.settings, tz).forEach(function (r) {
    if (!r.key) return;
    var dv = DEFAULT_SETTINGS[r.key];
    st.settings[r.key] = typeof dv === 'number' ? (+r.value || 0) : r.value;
  });
  st.log = readSheet_(ss, SHEETS.log, tz);
  return st;
}

function saveState_(st) {
  var ss = getSS_();
  var nameOf = function (id) { var e = empById(st, id); return e ? e.name : ''; };
  writeSheet_(ss, SHEETS.employees, st.employees.map(function (e, i) {
    var o = clone(e); o._deputyName = nameOf(e.deputyId); o.order = i + 1; return o;
  }));
  writeSheet_(ss, SHEETS.vacations, st.vacations.map(function (v) {
    var o = clone(v); o._name = nameOf(v.employeeId); o.status = STATUS[v.status] || v.status; return o;
  }));
  writeSheet_(ss, SHEETS.balances, st.balances.map(function (b) {
    var o = clone(b); o._name = nameOf(b.employeeId); return o;
  }));
  writeSheet_(ss, SHEETS.blackouts, st.blackouts);
  writeSheet_(ss, SHEETS.settings, Object.keys(DEFAULT_SETTINGS).map(function (k) {
    return { key: k, label: SETTING_LABELS[k] || k, value: String(st.settings[k] === undefined ? '' : st.settings[k]) };
  }));
  writeSheet_(ss, SHEETS.log, st.log || []);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'state';
  try {
    if (action === 'ping') return json_({ ok: true, app: 'otpusk', version: 2 });
    return json_({ ok: true, state: publicState(loadState_()) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    lock.waitLock(20000);
    var st = loadState_();
    var actor = authenticate(st, body.auth);
    if (body.action === 'login') return json_({ ok: true, actor: actor, state: publicState(st) });
    var result = applyOp(st, body.action, body.payload, actor);
    saveState_(st);
    return json_({ ok: true, result: result, state: publicState(st) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
}

/* ---------- Меню в таблице ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Отпуска')
    .addItem('Пересчитать дни и упорядочить листы', 'normalizeSheets')
    .addItem('Проверить подключение', 'selfTest')
    .addToUi();
}
// Пересчитывает «Дней» по производственному календарю и переписывает листы в едином формате
function normalizeSheets() {
  var st = loadState_();
  st.vacations.forEach(function (v) { v.days = vacDays(v.start, v.end); });
  saveState_(st);
  SpreadsheetApp.getActive().toast('Готово: листы пересчитаны', 'Отпуска');
}
function selfTest() {
  var st = loadState_();
  var msg = 'Сотрудников: ' + st.employees.length + ', периодов: ' + st.vacations.length;
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}
