/* Планировщик отпусков — интерфейс.
 * Логика правил и операций — в shared.js (общая с Google Apps Script). */
(function () {
  'use strict';

  var CFG = window.OTPUSK_CONFIG || {};
  var K = { state: 'otpusk_state_v2', session: 'otpusk_session_v2', api: 'otpusk_api_url', ui: 'otpusk_ui_v2', theme: 'otpusk_theme' };
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* нет доступа */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* нет доступа */ } }
  };
  var MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  var MONTHS_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MONTHS_S = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var THEME_ICON = {
    auto: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/></svg>',
    light: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M3 13l1.1-1.1M11.9 4.1 13 3"/></g></svg>',
    dark: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor"/></svg>'
  };
  var WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  var state = null;              // данные (без паролей)
  var stateKey = '';             // для сравнения при обновлении
  var cache = {};                // кэш проверок
  var session = LS.get(K.session, null);
  var conn = { mode: 'local', status: 'idle', error: '' };
  var ui = Object.assign({ tab: '', year: +todayISO().slice(0, 4), zoom: 'year', calMode: 'month', calMonth: todayISO().slice(0, 7),
    showInactive: false, f: { emp: '', status: '', year: '' } }, LS.get(K.ui, {}));
  var loginRole = 'employee';

  function saveUi() { LS.set(K.ui, { tab: ui.tab, year: ui.year, zoom: ui.zoom, calMode: ui.calMode, calMonth: ui.calMonth, showInactive: ui.showInactive, f: ui.f }); }
  function apiUrl() { return String(LS.get(K.api, '') || CFG.apiUrl || '').trim(); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isMgr() { return session && session.role === 'manager'; }
  function meId() { return session && session.role === 'employee' ? session.employeeId : ''; }
  function emp(id) { return empById(state, id) || { name: '—', color: '#888' }; }
  function plural(n, a, b, c) { var m = Math.abs(n) % 100, l = m % 10; return m > 10 && m < 20 ? c : l > 1 && l < 5 ? b : l === 1 ? a : c; }
  function dni(n) { return n + ' ' + plural(n, 'день', 'дня', 'дней'); }
  function fmtRange(a, b) { return fmtDate(a) + ' – ' + fmtDate(b); }
  function fmtHuman(iso) { return +iso.slice(8, 10) + ' ' + MONTHS_G[+iso.slice(5, 7) - 1]; }
  function canAddFor(empId) { return isMgr() || empId === meId(); }

  /* ---------- Хранилище: Google Таблица или локально ---------- */

  function setConn(status, err) {
    conn.status = status; conn.error = err || '';
    var el = $('#conn');
    if (el) el.outerHTML = connHtml();
  }
  function connHtml() {
    var cls = conn.status === 'busy' ? 'busy' : conn.status === 'err' ? 'err' : 'ok';
    var txt = conn.mode === 'remote'
      ? (conn.status === 'err' ? 'Нет связи с таблицей' : conn.status === 'busy' ? 'Синхронизация…' : 'Google Таблица')
      : 'Локально';
    var title = conn.mode === 'remote' ? 'Данные хранятся в общей Google Таблице' : 'Данные хранятся только в этом браузере';
    return '<div class="conn ' + cls + '" id="conn" title="' + esc(conn.error || title) + '"><i></i><span>' + txt + '</span></div>';
  }
  function setState(s) {
    state = s;
    state.settings = Object.assign(clone(DEFAULT_SETTINGS), state.settings || {});
    stateKey = JSON.stringify(s);
    cache = {};
  }
  function call(url, body) {
    var opt = body ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) } : { cache: 'no-store' };
    var u = body ? url : url + (url.indexOf('?') >= 0 ? '&' : '?') + 'action=state&t=' + Date.now();
    return fetch(u, opt).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { throw new Error('Нет связи с Google Таблицей (' + e.message + ')'); });
  }
  var Store = {
    load: function () {
      var url = apiUrl();
      if (url) {
        conn.mode = 'remote'; setConn('busy');
        return call(url).then(function (r) {
          if (!r.ok) throw new Error(r.error || 'Ошибка сервера');
          setState(r.state); setConn('ok');
        }).catch(function (e) { setConn('err', e.message); throw e; });
      }
      conn.mode = 'local';
      var full = LS.get(K.state, null);
      if (!full) { full = migrateOld() || clone(window.OTPUSK_SEED || emptyState()); LS.set(K.state, full); }
      setState(publicState(full)); setConn('ok');
      return Promise.resolve();
    },
    refresh: function () {
      if (conn.mode !== 'remote') return Promise.resolve(false);
      return call(apiUrl()).then(function (r) {
        if (!r.ok) throw new Error(r.error);
        setConn('ok');
        if (JSON.stringify(r.state) === stateKey) return false;
        setState(r.state); return true;
      }).catch(function (e) { setConn('err', e.message); return false; });
    },
    op: function (action, payload, auth) {
      auth = auth || session;
      if (conn.mode === 'remote') {
        setConn('busy');
        return call(apiUrl(), { action: action, payload: payload, auth: auth }).then(function (r) {
          setConn('ok');
          if (!r.ok) throw new Error(r.error || 'Ошибка');
          if (r.state) setState(r.state);
          return action === 'login' ? r.actor : r.result;
        }, function (e) { setConn('err', e.message); throw e; });
      }
      try {
        var full = LS.get(K.state, null) || clone(window.OTPUSK_SEED || emptyState());
        var actor = authenticate(full, auth);
        if (action === 'login') return Promise.resolve(actor);
        var res = applyOp(full, action, payload, actor);
        LS.set(K.state, full);
        setState(publicState(full));
        return Promise.resolve(res);
      } catch (e) { return Promise.reject(e); }
    }
  };
  // данные прежней версии программы (localStorage 'vacation_employees_2026')
  function oldData() { return LS.get('vacation_employees_2026', null); }
  function convertOld(old) {
    var st = emptyState();
    old.forEach(function (o, i) {
      var id = 'e' + (i + 1);
      st.employees.push({ id: id, name: o.name, position: o.position || '', tabNo: '', daysPerYear: +o.total_days || 0, deputyId: '', pin: '', color: PALETTE[i % PALETTE.length], order: i + 1 });
      (o.vacations || []).forEach(function (v) {
        if (!isValidISO(v.start) || !isValidISO(v.end)) return;
        st.vacations.push({ id: uid('v'), employeeId: id, start: v.start, end: v.end, days: vacDays(v.start, v.end), status: 'approved',
          year: +v.start.slice(0, 4), comment: '', managerComment: '', createdAt: nowStamp(), updatedAt: nowStamp(), updatedBy: 'Перенос', replacesId: '' });
      });
    });
    return st;
  }
  function migrateOld() {
    var old = oldData();
    if (!Array.isArray(old) || !old.length) return null;
    var st = convertOld(old);
    if (window.OTPUSK_SEED) st.settings = clone(window.OTPUSK_SEED.settings);
    st.log = [{ ts: nowStamp(), who: 'Система', text: 'Данные перенесены из прежней версии программы' }];
    return st;
  }

  /* ---------- Вычисления ---------- */

  function check(v) {
    var key = v.id + '|' + v.start + '|' + v.end;
    if (!cache[key]) cache[key] = checkPeriod(state, { employeeId: v.employeeId, start: v.start, end: v.end, id: v.id, replacesId: v.replacesId });
    return cache[key];
  }
  function conflictsOf(v) { return check(v).issues.filter(function (x) { return x.level === 'conflict'; }); }
  function activeVacs() { return state.vacations.filter(function (v) { return ACTIVE[v.status]; }); }
  function absentOn(d) {
    return activeVacs().filter(function (v) { return v.start <= d && v.end >= d; });
  }
  function yearsList() {
    var ys = {}, cy = +todayISO().slice(0, 4);
    ys[cy] = 1; ys[cy + 1] = 1; ys[+state.settings.planYear || cy] = 1;
    state.vacations.forEach(function (v) { ys[+v.start.slice(0, 4)] = 1; ys[+v.end.slice(0, 4)] = 1; });
    return Object.keys(ys).map(Number).sort();
  }
  function yearSelect() {
    return '<select class="inp" data-act="year" style="width:auto">' + yearsList().map(function (y) {
      return '<option value="' + y + '"' + (y === ui.year ? ' selected' : '') + '>' + y + ' год</option>';
    }).join('') + '</select>';
  }
  function statusBadge(v) {
    var t = STATUS[v.status], today = todayISO();
    if (v.status === 'approved') {
      if (v.end < today) t = 'Использован';
      else if (v.start <= today) t = 'Идёт сейчас';
    }
    return '<span class="badge s-' + v.status + '">' + esc(t) + '</span>';
  }
  function empLabel(e, sub) {
    return '<span class="emp"><span class="dot" style="background:' + esc(e.color) + '"></span><span>' + esc(shortName(e.name)) +
      (sub ? '<div class="muted small">' + esc(sub) + '</div>' : '') + '</span></span>';
  }
  function issuesHtml(issues, okText) {
    if (!issues.length) return okText ? '<ul class="issues"><li class="issue ok"><span class="ic">✓</span><span>' + esc(okText) + '</span></li></ul>' : '';
    var ic = { block: '!', conflict: '!', warn: '!', info: 'i' };
    var order = { block: 0, conflict: 1, warn: 2, info: 3 };
    return '<ul class="issues">' + issues.slice().sort(function (a, b) { return order[a.level] - order[b.level]; }).map(function (x) {
      return '<li class="issue ' + x.level + '"><span class="ic">' + ic[x.level] + '</span><span>' + esc(x.text) + '</span></li>';
    }).join('') + '</ul>';
  }

  /* ---------- Каркас ---------- */

  function tabsFor() {
    var pending = state ? state.vacations.filter(function (v) { return v.status === 'proposed'; }).length : 0;
    if (isMgr()) return [
      ['overview', 'Обзор'], ['gantt', 'График'], ['calendar', 'Календарь'],
      ['requests', 'Заявки' + (pending ? ' <span class="badge count">' + pending + '</span>' : '')],
      ['employees', 'Сотрудники'], ['settings', 'Настройки']];
    return [['mine', 'Мои отпуска'], ['gantt', 'График'], ['calendar', 'Календарь']];
  }
  function currentTab() {
    var t = tabsFor().map(function (x) { return x[0]; });
    if (t.indexOf(ui.tab) < 0) ui.tab = t[0];
    return ui.tab;
  }

  function render() {
    var app = $('#app');
    hideTip();
    if (!state) { app.innerHTML = loadingView(); return; }
    if (session && session.role === 'employee' && !empById(state, session.employeeId)) { session = null; LS.del(K.session); }
    if (!session) { app.innerHTML = loginView(); return; }
    var tab = currentTab();
    var who = isMgr() ? 'Руководитель' : shortName(emp(meId()).name);
    var theme = LS.get(K.theme, 'auto');
    app.innerHTML =
      '<header class="topbar"><div class="topbar-in">' +
      '<div class="brand"><div class="brand-mark">О</div><div>Отпуска<small>' + esc(state.settings.unitName || '') + '</small></div></div>' +
      '<nav class="tabs">' + tabsFor().map(function (t) {
        return '<button class="tab' + (t[0] === tab ? ' active' : '') + '" data-act="tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</nav>' +
      '<div class="top-right">' + connHtml() +
      '<button class="btn ghost icon" data-act="theme" title="Тема: ' + ({ auto: 'как в системе', light: 'светлая', dark: 'тёмная' }[theme]) + ' (нажмите, чтобы сменить)">' + THEME_ICON[theme] + '</button>' +
      '<div class="user-chip"><b>' + esc(who) + '</b><button class="btn ghost sm" data-act="logout" title="Выйти">Выйти</button></div>' +
      '</div></div></header><main id="main"></main>';
    renderMain();
  }
  function renderMain() {
    var m = $('#main');
    if (!m) return render();
    hideTip();
    var tab = currentTab();
    var banner = '';
    if (isMgr() && state.settings.defaultPassword)
      banner = '<div class="banner warn"><span>Пароль руководителя по умолчанию — <b>1234</b>. Смените его в разделе <a href="#" data-act="tab" data-tab="settings">«Настройки»</a>, иначе любой сотрудник сможет войти как руководитель.</span></div>';
    m.innerHTML = banner + VIEWS[tab]();
    if (AFTER[tab]) AFTER[tab](m);
  }

  function loadingView() {
    if (conn.status === 'err') {
      return '<div class="login card"><div class="card-b"><h1>Нет связи с таблицей</h1>' +
        '<p class="muted">' + esc(conn.error) + '</p>' +
        '<p class="small muted">Адрес: ' + esc(apiUrl()) + '</p>' +
        '<div class="row"><button class="btn primary" data-act="retry">Повторить</button>' +
        '<button class="btn" data-act="set-api">Изменить адрес</button></div></div></div>';
    }
    return '<div class="login card"><div class="card-b"><div class="row" style="align-items:center"><span class="spinner"></span> Загрузка данных…</div></div></div>';
  }

  function loginView() {
    var emps = state.employees.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    var remote = conn.mode === 'remote';
    return '<div class="login card"><div class="card-b">' +
      '<div><h1>Планировщик отпусков</h1><div class="muted">' + esc(state.settings.unitName) + '</div></div>' +
      '<div class="seg"><button data-act="login-role" data-role="employee" class="' + (loginRole === 'employee' ? 'on' : '') + '">Я сотрудник</button>' +
      '<button data-act="login-role" data-role="manager" class="' + (loginRole === 'manager' ? 'on' : '') + '">Я руководитель</button></div>' +
      (loginRole === 'employee'
        ? '<label class="field"><span>Сотрудник</span><select class="inp" id="lg-emp" data-act="lg-emp"><option value="">— выберите себя —</option>' +
          emps.map(function (e) { return '<option value="' + e.id + '">' + esc(e.name) + '</option>'; }).join('') + '</select></label>' +
          '<label class="field hidden" id="lg-pin-wrap"><span>PIN-код</span><input class="inp" id="lg-pin" type="password" inputmode="numeric" autocomplete="off"></label>'
        : '<label class="field"><span>Пароль руководителя</span><input class="inp" id="lg-pass" type="password" autocomplete="current-password"></label>' +
          (!remote && state.settings.defaultPassword ? '<div class="small muted">Пароль по умолчанию: 1234</div>' : '')) +
      '<button class="btn primary" data-act="login" style="justify-content:center">Войти</button>' +
      '<div class="small muted" style="border-top:1px solid var(--line);padding-top:12px">' +
      (remote ? 'Данные хранятся в общей Google Таблице. ' : 'Локальный режим: данные хранятся только в этом браузере. ') +
      '<a href="#" data-act="set-api">' + (remote ? 'Изменить подключение' : 'Подключить Google Таблицу') + '</a></div>' +
      '</div></div>';
  }

  /* ---------- Обзор (руководитель) ---------- */

  var VIEWS = {}, AFTER = {};

  VIEWS.overview = function () {
    var y = ui.year, today = todayISO(), S = state.settings;
    var act = activeVacs();
    var nowOff = act.filter(function (v) { return v.status === 'approved' && v.start <= today && v.end >= today; });
    var pending = state.vacations.filter(function (v) { return v.status === 'proposed'; });
    var inYear = act.filter(function (v) { return vacYear(v) === y; });
    var confl = inYear.filter(function (v) { return conflictsOf(v).length; });
    var bals = state.employees.map(function (e) { return { e: e, b: balanceOf(state, e.id, y, today) }; });
    var free = bals.reduce(function (s, x) { return s + Math.max(0, x.b.free); }, 0);
    var horizon = addDays(today, 60);
    var upcoming = act.filter(function (v) { return v.end >= today && v.start <= horizon; }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });

    // внимание
    var att = [];
    confl.forEach(function (v) {
      att.push({ lvl: 'conflict', html: '<b>' + esc(shortName(emp(v.employeeId).name)) + '</b>, ' + fmtRange(v.start, v.end) + ': ' +
        esc(conflictsOf(v).map(function (c) { return c.text; }).join('; ')), id: v.id });
    });
    var nd = +S.notifyDays || 14;
    act.filter(function (v) { return v.status === 'approved' && v.start > today && dn(v.start) - dn(today) <= nd + 7; }).forEach(function (v) {
      var by = addDays(v.start, -nd);
      att.push({ lvl: by < today ? 'conflict' : 'warn', html: 'Уведомить <b>' + esc(shortName(emp(v.employeeId).name)) + '</b> о начале отпуска ' + fmtDate(v.start) +
        ' — не позднее ' + fmtDate(by) + (by < today ? ' (срок прошёл)' : ''), id: v.id });
    });
    bals.forEach(function (x) {
      if (x.b.entitled >= (+S.minPart || 14) && x.b.parts.length && x.b.maxPart < (+S.minPart || 14) && x.b.free < (+S.minPart || 14))
        att.push({ lvl: 'warn', html: '<b>' + esc(shortName(x.e.name)) + '</b>: нет части отпуска ≥ ' + S.minPart + ' дн. за ' + y + ' г. (ст. 125 ТК РФ)' });
      if (x.b.free > 0 && y >= +today.slice(0, 4))
        att.push({ lvl: 'info', html: '<b>' + esc(shortName(x.e.name)) + '</b>: не распланировано ' + dni(x.b.free) + ' за ' + y + ' г.' });
    });

    return '<div class="page-head"><h2>Обзор</h2><div class="tools">' + yearSelect() +
      '<button class="btn" data-act="export-t7">Выгрузить Т-7</button>' +
      '<button class="btn" data-act="export-summary">Сводка в Excel</button>' +
      '<button class="btn primary" data-act="propose">+ Добавить отпуск</button></div></div>' +
      '<div class="grid g-kpi" style="margin-bottom:16px">' +
      kpi('Сейчас в отпуске', nowOff.length, nowOff.map(function (v) { return shortName(emp(v.employeeId).name); }).join(', ') || 'никого') +
      kpi('На согласовании', pending.length, pending.length ? 'открыть заявки →' : 'новых заявок нет', pending.length ? 'warn clickable' : '', 'requests') +
      kpi('Конфликтов в ' + y, confl.length, confl.length ? 'замещение или лимит ' + S.maxAbsent + ' чел.' : 'пересечения в норме', confl.length ? 'bad' : '') +
      kpi('Не распланировано', free, 'дней на ' + state.employees.length + ' чел. за ' + y + ' г.', free ? '' : '') +
      '</div>' +
      '<div class="grid g-2">' +
      '<div class="grid" style="align-content:start">' +
      '<div class="card"><div class="card-h"><h3>Остатки дней за ' + y + ' год</h3><div class="legend">' +
      '<span><i class="sw" style="background:var(--heat-4)"></i>использовано</span><span><i class="sw" style="background:var(--heat-2)"></i>согласовано</span>' +
      '<span><i class="sw" style="background:repeating-linear-gradient(135deg,var(--warn-mark) 0 3px,transparent 3px 6px);border:1px solid var(--warn-mark)"></i>на согласовании</span></div></div>' +
      '<div class="card-b tbl-wrap"><table class="tbl"><thead><tr><th>Сотрудник</th><th class="r">Положено</th><th class="r">Использ.</th><th class="r">Соглас.</th><th class="r">Заявки</th><th class="r">Осталось</th><th style="width:28%"></th></tr></thead><tbody>' +
      bals.map(function (x) {
        var b = x.b, tot = Math.max(b.entitled, b.approved + b.proposed, 1);
        var w = function (n) { return (100 * n / tot).toFixed(2) + '%'; };
        return '<tr class="click" data-act="open-emp-plan" data-id="' + x.e.id + '"><td>' + empLabel(x.e, x.e.position) + '</td>' +
          '<td class="r num">' + b.entitled + (b.carry ? '<div class="muted small">в т.ч. ' + b.carry + ' перенос</div>' : '') + '</td>' +
          '<td class="r num">' + b.used + '</td><td class="r num">' + b.approved + '</td><td class="r num">' + (b.proposed || '') + '</td>' +
          '<td class="r num" style="font-weight:700;color:' + (b.free < 0 ? 'var(--bad)' : 'inherit') + '">' + b.free + '</td>' +
          '<td><div class="bal" data-tip="' + esc('Использовано ' + b.used + ', согласовано всего ' + b.approved + ', на согласовании ' + b.proposed + ', осталось ' + b.free) + '">' +
          '<i class="b-used" style="width:' + w(b.used) + '"></i><i class="b-appr" style="width:' + w(b.approved - b.used) + '"></i><i class="b-prop" style="width:' + w(b.proposed) + '"></i></div></td></tr>';
      }).join('') + '</tbody></table></div></div>' +
      '<div class="card"><div class="card-h"><h3>Дней отпуска по месяцам, ' + y + '</h3><div class="legend"><span><i class="sw" style="background:var(--heat-3)"></i>согласовано</span><span><i class="sw" style="background:var(--warn-mark)"></i>на согласовании</span></div></div>' +
      '<div class="card-b">' + monthChart(y) + '</div></div>' +
      '</div>' +
      '<div class="grid" style="align-content:start">' +
      '<div class="card"><div class="card-h"><h3>Требует внимания</h3><span class="muted small">' + att.length + '</span></div><div class="card-b">' +
      (att.length ? '<ul class="issues">' + att.slice(0, 14).map(function (a) {
        return '<li class="issue ' + a.lvl + '"' + (a.id ? ' data-act="open-vac" data-id="' + a.id + '" style="cursor:pointer"' : '') + '><span class="ic">' + (a.lvl === 'info' ? 'i' : '!') + '</span><span>' + a.html + '</span></li>';
      }).join('') + (att.length > 14 ? '<li class="muted small">и ещё ' + (att.length - 14) + '…</li>' : '') + '</ul>' : '<div class="muted">Всё в порядке</div>') +
      '</div></div>' +
      '<div class="card"><div class="card-h"><h3>Ближайшие 60 дней</h3></div><div class="card-b">' +
      (upcoming.length ? '<table class="tbl"><tbody>' + upcoming.map(function (v) {
        return '<tr class="click" data-act="open-vac" data-id="' + v.id + '"><td>' + empLabel(emp(v.employeeId)) + '</td><td class="nowrap num">' + fmtShort(v.start) + '–' + fmtShort(v.end) + '</td><td class="r num">' + v.days + '</td><td>' + statusBadge(v) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="muted">Отпусков не запланировано</div>') +
      '</div></div></div></div>';
  };
  function kpi(lbl, val, sub, cls, tab) {
    return '<div class="card kpi ' + (cls || '') + '"' + (tab ? ' data-act="tab" data-tab="' + tab + '"' : '') + '><div class="lbl">' + esc(lbl) + '</div><div class="val">' + val + '</div><div class="sub">' + esc(sub) + '</div></div>';
  }
  function monthChart(y) {
    var appr = [], prop = [];
    for (var m = 0; m < 12; m++) { appr.push(0); prop.push(0); }
    activeVacs().forEach(function (v) {
      for (var i = dn(v.start); i <= dn(v.end); i++) {
        var d = isoOf(i);
        if (+d.slice(0, 4) !== y || isHoliday(d)) continue;
        (v.status === 'approved' ? appr : prop)[+d.slice(5, 7) - 1]++;
      }
    });
    var max = Math.max.apply(null, appr.map(function (a, i) { return a + prop[i]; }).concat([10]));
    var step = max > 100 ? 50 : max > 40 ? 20 : 10;
    max = Math.ceil(max / step) * step;
    var W = 600, H = 190, L = 30, B = 22, T = 8, cw = (W - L) / 12, bw = Math.min(30, cw - 10);
    var yv = function (v) { return T + (H - B - T) * (1 - v / max); };
    var s = '<svg class="bars-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Дней отпуска по месяцам">';
    for (var g = 0; g <= max; g += step) {
      s += '<line x1="' + L + '" x2="' + W + '" y1="' + yv(g) + '" y2="' + yv(g) + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (L - 6) + '" y="' + (yv(g) + 4) + '" font-size="10" text-anchor="end" fill="var(--ink-3)">' + g + '</text>';
    }
    for (var k = 0; k < 12; k++) {
      var x = L + k * cw + (cw - bw) / 2, a = appr[k], p = prop[k];
      var tip = esc('<b>' + MONTHS[k] + ' ' + y + '</b><br>Согласовано: ' + a + ' чел.-дн.<br>На согласовании: ' + p + ' чел.-дн.');
      s += '<g data-tip="' + tip + '"><rect x="' + (L + k * cw) + '" y="' + T + '" width="' + cw + '" height="' + (H - B - T) + '" fill="transparent"/>';
      if (a) s += '<rect x="' + x + '" y="' + yv(a) + '" width="' + bw + '" height="' + (yv(0) - yv(a)) + '" rx="3" fill="var(--heat-3)"/>';
      if (p) s += '<rect x="' + x + '" y="' + yv(a + p) + '" width="' + bw + '" height="' + Math.max(0, yv(a) - yv(a + p) - (a ? 2 : 0)) + '" rx="3" fill="var(--warn-mark)"/>';
      s += '<text x="' + (L + k * cw + cw / 2) + '" y="' + (H - 6) + '" font-size="10.5" text-anchor="middle" fill="var(--ink-2)">' + MONTHS_S[k] + '</text></g>';
    }
    return s + '</svg>';
  }

  /* ---------- График (диаграмма Ганта) ---------- */

  VIEWS.gantt = function () {
    return '<div class="page-head"><h2>График отпусков</h2><div class="tools">' + yearSelect() +
      '<div class="seg">' + [['year', 'Год'], ['quarter', 'Квартал'], ['month', 'Месяц']].map(function (z) {
        return '<button data-act="zoom" data-z="' + z[0] + '" class="' + (ui.zoom === z[0] ? 'on' : '') + '">' + z[1] + '</button>';
      }).join('') + '</div>' +
      '<label class="check small"><input type="checkbox" data-act="toggle-inactive"' + (ui.showInactive ? ' checked' : '') + '> отклонённые и отменённые</label>' +
      '<button class="btn primary" data-act="propose">' + (isMgr() ? '+ Добавить отпуск' : '+ Предложить отпуск') + '</button></div></div>' +
      '<div class="card gantt-card"><div class="gantt" id="gantt"></div></div>' +
      '<div class="legend" style="margin-top:10px">' +
      '<span><i class="sw" style="background:var(--heat-3)"></i>согласован</span>' +
      '<span><i class="sw" style="background:repeating-linear-gradient(135deg,var(--heat-2) 0 3px,transparent 3px 6px);outline:1.5px dashed var(--ink-3)"></i>на согласовании</span>' +
      '<span><i class="sw" style="background:var(--bad-mark)"></i>конфликт (замещение / лимит)</span>' +
      '<span><i class="sw" style="background:var(--weekend);border:1px solid var(--line)"></i>выходной</span>' +
      '<span><i class="sw" style="background:var(--holiday)"></i>праздник</span>' +
      '<span><i class="sw" style="background:repeating-linear-gradient(135deg,rgba(208,59,59,.35) 0 3px,transparent 3px 6px)"></i>нежелательный период</span>' +
      '<span class="muted">Строка «Отсутствуют» — сколько человек в отпуске в каждый день; красным — больше лимита (' + state.settings.maxAbsent + ').' +
      (isMgr() ? ' Щёлкните по пустому месту строки, чтобы добавить отпуск.' : ' Щёлкните по своей строке, чтобы предложить даты.') + '</span></div>';
  };
  AFTER.gantt = function () { drawGantt(); };

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function drawGantt() {
    var el = $('#gantt');
    if (!el) return;
    var y = ui.year, d0 = dn(y + '-01-01'), d1 = dn(y + '-12-31'), N = d1 - d0 + 1;
    var nameW = window.innerWidth < 700 ? 140 : 230;
    var avail = el.clientWidth - nameW - 2;
    var W = ui.zoom === 'year' ? Math.max(2.2, avail / N) : ui.zoom === 'quarter' ? Math.max(9, avail / 92) : Math.max(26, avail / 31);
    var TW = N * W, today = todayISO(), tIdx = dn(today) - d0;
    var S = state.settings, maxAbs = +S.maxAbsent || 0;

    // фон: выходные и праздники
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(TW); cv.height = 1;
    var cx = cv.getContext('2d');
    var cOff = cssVar('--weekend'), cHol = cssVar('--holiday'), cLine = cssVar('--line-strong');
    for (var i = 0; i < N; i++) {
      var iso = isoOf(d0 + i), t = dayType(iso);
      if (t !== 'work') { cx.fillStyle = t === 'holiday' ? cHol : cOff; cx.fillRect(Math.floor(i * W), 0, Math.ceil(W), 1); }
      if (iso.slice(8) === '01' && i) { cx.fillStyle = cLine; cx.fillRect(Math.floor(i * W), 0, 1, 1); }
    }
    var bg = 'url(' + cv.toDataURL() + ')';
    var bgStyle = 'width:' + TW + 'px;background-image:' + bg + ';background-size:' + Math.ceil(TW) + 'px 100%;';

    var blackouts = (state.blackouts || []).map(function (b) {
      var a = Math.max(dn(b.start), d0), z = Math.min(dn(b.end), d1);
      return z < a ? '' : '<div class="g-blackout" style="left:' + (a - d0) * W + 'px;width:' + (z - a + 1) * W + 'px"></div>';
    }).join('');
    var todayLine = tIdx >= 0 && tIdx < N ? '<div class="g-today" style="left:' + (tIdx * W + W / 2 - 1) + 'px"></div>' : '';

    // шапка
    var h = '<div class="g-head"><div class="g-row"><div class="g-name" style="width:' + nameW + 'px"><span class="muted small">' + y + ' год</span></div><div class="g-months" style="width:' + TW + 'px">';
    for (var m = 0; m < 12; m++) {
      var ms = dn(y + '-' + pad2(m + 1) + '-01') - d0, me = (m === 11 ? N : dn(y + '-' + pad2(m + 2) + '-01') - d0);
      var wpx = (me - ms) * W;
      h += '<div class="g-month" style="left:' + ms * W + 'px;width:' + wpx + 'px"><span style="position:sticky;left:' + (nameW + 6) + 'px">' + (wpx > 70 ? MONTHS[m] + (ui.zoom === 'year' ? '' : ' ' + y) : MONTHS_S[m]) + '</span></div>';
    }
    h += '</div></div>';
    if (W >= 14) {
      h += '<div class="g-row"><div class="g-name" style="width:' + nameW + 'px"></div><div class="g-days" style="width:' + TW + 'px">';
      for (var j = 0; j < N; j++) {
        var di = isoOf(d0 + j), dt = dayType(di);
        h += '<div class="g-day ' + (dt === 'work' ? '' : dt) + '" style="left:' + j * W + 'px;width:' + W + 'px">' + (+di.slice(8)) + '</div>';
      }
      h += '</div></div>';
    }
    h += '<div class="g-row"><div class="g-name" style="width:' + nameW + 'px"><div class="n">Отсутствуют</div><div class="p">лимит ' + (maxAbs || 'не задан') + ' чел.</div></div>' +
      '<div class="g-cov" id="g-cov" style="' + bgStyle + '"><canvas id="g-cov-cv"></canvas>' + blackouts + todayLine + '</div></div></div>';

    // строки сотрудников
    var me0 = meId();
    var rows = state.employees.map(function (e) {
      var bal = balanceOf(state, e.id, y, today);
      var vs = state.vacations.filter(function (v) {
        return v.employeeId === e.id && (ACTIVE[v.status] || ui.showInactive) && v.start <= y + '-12-31' && v.end >= y + '-01-01';
      }).sort(function (a, b) { return ACTIVE[a.status] - ACTIVE[b.status]; });
      var bars = vs.map(function (v) {
        var a = Math.max(dn(v.start), d0), z = Math.min(dn(v.end), d1);
        var left = (a - d0) * W, width = Math.max(3, (z - a + 1) * W);
        var cf = ACTIVE[v.status] ? conflictsOf(v) : [];
        var cfDays = ACTIVE[v.status] ? Object.keys(check(v).conflictDays) : [];
        var segs = cfDays.map(function (d) {
          var k = dn(d);
          return k < a || k > z ? '' : '<i class="cf" style="left:' + (k - a) * W + 'px;width:' + Math.max(W, 2) + 'px"></i>';
        }).join('');
        var label = width > 110 ? fmtShort(v.start) + '–' + fmtShort(v.end) + ' · ' + v.days + ' дн.' : width > 26 ? String(v.days) : '';
        var tip = '<b>' + esc(e.name) + '</b><br>' + fmtRange(v.start, v.end) + ' · ' + dni(v.days) + '<br>' + esc(STATUS[v.status]) +
          (v.comment ? '<br><i>' + esc(v.comment) + '</i>' : '') +
          (cf.length ? '<br><span style="color:#ff9b9b">⚠ ' + esc(cf.map(function (c) { return c.text; }).join('; ')) + '</span>' : '');
        return '<div class="g-bar ' + v.status + (ACTIVE[v.status] ? '' : ' inactive') + (cf.length ? ' has-conflict' : '') + '" data-act="open-vac" data-id="' + v.id + '" data-tip="' + esc(tip) + '" ' +
          'style="left:' + left + 'px;width:' + width + 'px;background-color:' + esc(e.color) + '">' + label + segs + '</div>';
      }).join('');
      var can = canAddFor(e.id);
      return '<div class="g-row' + (e.id === me0 ? ' me' : '') + '"><div class="g-name" style="width:' + nameW + 'px" data-act="open-emp-plan" data-id="' + e.id + '" title="' + esc(e.name + ' — ' + (e.position || '')) + '">' +
        '<div class="n"><span class="dot" style="background:' + esc(e.color) + '"></span>' + esc(shortName(e.name)) + '</div>' +
        '<div class="p">' + esc(e.position || '') + ' · осталось ' + bal.free + '</div></div>' +
        '<div class="g-track' + (can ? ' can-add' : '') + '" data-emp="' + e.id + '" style="' + bgStyle + '">' + blackouts + todayLine + bars + '</div></div>';
    }).join('');
    el.innerHTML = h + rows;
    $$('.g-name', el).forEach(function (n) { n.style.width = nameW + 'px'; });

    // строка загрузки
    var cov = $('#g-cov-cv'), dpr = window.devicePixelRatio || 1, CH = 34;
    cov.width = Math.ceil(TW * dpr); cov.height = CH * dpr;
    cov.style.width = TW + 'px'; cov.style.height = CH + 'px'; cov.style.display = 'block';
    var c2 = cov.getContext('2d'); c2.scale(dpr, dpr);
    var counts = [], act = activeVacs();
    var maxC = Math.max(maxAbs + 1, 3);
    var cA = cssVar('--heat-3'), cP = cssVar('--warn-mark'), cB = cssVar('--bad-mark');
    for (var q = 0; q < N; q++) {
      var dd = isoOf(d0 + q), ap = {}, pr = {};
      act.forEach(function (v) { if (v.start <= dd && v.end >= dd) (v.status === 'approved' ? ap : pr)[v.employeeId] = 1; });
      Object.keys(ap).forEach(function (k) { delete pr[k]; });
      var na = Object.keys(ap).length, np = Object.keys(pr).length;
      counts.push([na, np]);
      if (!na && !np) continue;
      var over = maxAbs && na + np > maxAbs;
      var x0 = q * W + (W > 4 ? 1 : 0), bw = Math.max(1, W - (W > 4 ? 2 : 0));
      var hA = (CH - 4) * Math.min(na, maxC) / maxC, hP = (CH - 4) * Math.min(np, maxC - Math.min(na, maxC)) / maxC;
      c2.fillStyle = over ? cB : cA; c2.fillRect(x0, CH - hA, bw, hA);
      c2.fillStyle = over ? cB : cP; c2.fillRect(x0, CH - hA - hP, bw, hP);
      if (W >= 14) { c2.fillStyle = cssVar('--ink'); c2.font = '600 10px sans-serif'; c2.textAlign = 'center'; c2.fillText(String(na + np), q * W + W / 2, 10); }
    }
    var covEl = $('#g-cov');
    covEl.onmousemove = function (ev) {
      var r = covEl.getBoundingClientRect(), k = Math.floor((ev.clientX - r.left) / W);
      if (k < 0 || k >= N) return hideTip();
      showTip(dayTip(isoOf(d0 + k)), ev);
    };
    covEl.onmouseleave = hideTip;
    // добавление по щелчку на строке
    $$('.g-track.can-add', el).forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target.closest('.g-bar')) return;
        var r = tr.getBoundingClientRect(), k = Math.floor((ev.clientX - r.left) / W);
        var s = isoOf(d0 + Math.max(0, Math.min(N - 1, k)));
        openEditor({ employeeId: tr.getAttribute('data-emp'), start: s, end: endForDays(s, 14) });
      });
    });
    if (ui.zoom !== 'year' && tIdx >= 0 && tIdx < N && !el._scrolled) { el.scrollLeft = Math.max(0, tIdx * W - 120); }
  }
  function dayTip(d) {
    var t = dayType(d), list = absentOn(d);
    var s = '<b>' + fmtHuman(d) + ' ' + d.slice(0, 4) + '</b>, ' + ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][weekdayOf(d)] +
      (t === 'holiday' ? ' · праздник' : t === 'off' ? ' · выходной' : '');
    if (!list.length) return s + '<br>Все на месте';
    var max = +state.settings.maxAbsent || 0, n = {};
    list.forEach(function (v) { n[v.employeeId] = 1; });
    var cnt = Object.keys(n).length;
    s += '<br>В отпуске: ' + cnt + (max && cnt > max ? ' <span style="color:#ff9b9b">— больше лимита ' + max + '</span>' : '');
    list.forEach(function (v) {
      var e = emp(v.employeeId);
      s += '<div class="t-row"><span class="dot" style="background:' + esc(e.color) + '"></span>' + esc(shortName(e.name)) + (v.status === 'proposed' ? ' <i>(заявка)</i>' : '') + '</div>';
    });
    return s;
  }

  /* ---------- Календарь ---------- */

  VIEWS.calendar = function () {
    var head = '<div class="page-head"><h2>Календарь</h2><div class="tools">' +
      '<div class="seg"><button data-act="cal-mode" data-m="month" class="' + (ui.calMode === 'month' ? 'on' : '') + '">Месяц</button>' +
      '<button data-act="cal-mode" data-m="year" class="' + (ui.calMode === 'year' ? 'on' : '') + '">Год</button></div>';
    if (ui.calMode === 'month') {
      var y = +ui.calMonth.slice(0, 4), m = +ui.calMonth.slice(5, 7);
      head += '<button class="btn icon" data-act="cal-shift" data-k="-1">‹</button><b style="min-width:130px;text-align:center">' + MONTHS[m - 1] + ' ' + y + '</b>' +
        '<button class="btn icon" data-act="cal-shift" data-k="1">›</button><button class="btn sm" data-act="cal-today">Сегодня</button>';
    } else head += yearSelect();
    head += '<button class="btn primary" data-act="propose">' + (isMgr() ? '+ Добавить отпуск' : '+ Предложить отпуск') + '</button></div></div>';
    return head + (ui.calMode === 'month' ? monthCal() : yearCal());
  };
  function monthCal() {
    var y = +ui.calMonth.slice(0, 4), m = +ui.calMonth.slice(5, 7), first = ui.calMonth + '-01';
    var nd = new Date(Date.UTC(y, m, 0)).getUTCDate(), off = (weekdayOf(first) + 6) % 7, today = todayISO();
    var max = +state.settings.maxAbsent || 0;
    var s = '<div class="card"><div class="mcal">' + WD.map(function (w) { return '<div class="hd">' + w + '</div>'; }).join('');
    for (var i = 0; i < off; i++) s += '<div class="c empty"></div>';
    for (var d = 1; d <= nd; d++) {
      var iso = ui.calMonth + '-' + pad2(d), t = dayType(iso), list = absentOn(iso);
      var n = {}; list.forEach(function (v) { n[v.employeeId] = 1; });
      var cnt = Object.keys(n).length;
      var cls = 'c' + (t !== 'work' ? ' ' + t : '') + (max && cnt > max ? ' over' : '') + (iso === today ? ' today' : '');
      s += '<div class="' + cls + '" data-act="cal-day" data-d="' + iso + '" data-tip="' + esc(dayTip(iso)) + '"><span class="d">' + d + '</span>' + (cnt ? '<span class="cnt">' + cnt + '</span>' : '') +
        list.slice(0, 5).map(function (v) {
          var e = emp(v.employeeId);
          return '<div class="chip ' + v.status + '" style="background-color:' + esc(e.color) + '" data-act="open-vac" data-id="' + v.id + '">' + esc(shortName(e.name)) + '</div>';
        }).join('') + (list.length > 5 ? '<div class="small muted">ещё ' + (list.length - 5) + '</div>' : '') + '</div>';
    }
    var tail = (7 - (off + nd) % 7) % 7;
    for (var k = 0; k < tail; k++) s += '<div class="c empty"></div>';
    return s + '</div></div><div class="legend" style="margin-top:10px"><span><i class="sw" style="background:var(--weekend);border:1px solid var(--line)"></i>выходной</span><span><i class="sw" style="background:var(--holiday)"></i>праздник</span><span><i class="sw" style="box-shadow:inset 0 0 0 2px var(--bad-mark)"></i>больше лимита (' + max + ' чел.)</span><span>штриховка — заявка на согласовании</span></div>';
  }
  function yearCal() {
    var y = ui.year, today = todayISO(), max = +state.settings.maxAbsent || 0;
    var s = '<div class="ycal">';
    for (var m = 1; m <= 12; m++) {
      var mm = y + '-' + pad2(m), nd = new Date(Date.UTC(y, m, 0)).getUTCDate(), off = (weekdayOf(mm + '-01') + 6) % 7;
      s += '<div class="card ym"><h4>' + MONTHS[m - 1] + '</h4><div class="g">' + WD.map(function (w) { return '<div class="wd">' + w + '</div>'; }).join('');
      for (var i = 0; i < off; i++) s += '<div></div>';
      for (var d = 1; d <= nd; d++) {
        var iso = mm + '-' + pad2(d), t = dayType(iso), n = {};
        absentOn(iso).forEach(function (v) { n[v.employeeId] = 1; });
        var c = Object.keys(n).length;
        var cls = 'dd' + (t !== 'work' ? ' ' + t : '') + (max && c > max ? ' over' : c >= 3 ? ' h3' : c === 2 ? ' h2' : c === 1 ? ' h1' : '') + (iso === today ? ' today' : '');
        s += '<div class="' + cls + '" data-act="ycal-day" data-d="' + iso + '" data-tip="' + esc(dayTip(iso)) + '">' + d + '</div>';
      }
      s += '</div></div>';
    }
    return s + '</div><div class="legend" style="margin-top:10px"><span>Цвет — сколько человек в отпуске:</span><span><i class="sw" style="background:var(--heat-1)"></i>1</span><span><i class="sw" style="background:var(--heat-2)"></i>2</span><span><i class="sw" style="background:var(--heat-3)"></i>3+</span><span><i class="sw" style="background:var(--bad-mark)"></i>больше лимита</span><span class="muted">Щёлкните день — откроется месяц</span></div>';
  }

  /* ---------- Мои отпуска (сотрудник) ---------- */

  VIEWS.mine = function () { return planView(meId(), true); };
  function planView(empId, own) {
    var e = emp(empId), y = ui.year, today = todayISO(), S = state.settings;
    var b = balanceOf(state, empId, y, today);
    var mine = state.vacations.filter(function (v) { return v.employeeId === empId; }).sort(function (a, c) { return a.start < c.start ? 1 : -1; });
    var dep = e.deputyId ? emp(e.deputyId) : null;
    var subs = state.employees.filter(function (x) { return x.deputyId === empId; });
    var tips = [];
    if (b.free > 0) tips.push({ level: 'info', text: 'Осталось распланировать ' + dni(b.free) + ' за ' + y + ' год.' });
    if (b.maxPart < (+S.minPart || 14) && b.entitled >= (+S.minPart || 14)) tips.push({ level: b.free >= (+S.minPart || 14) ? 'info' : 'warn', text: 'Одна из частей отпуска должна быть не менее ' + S.minPart + ' календарных дней (ст. 125 ТК РФ).' });
    if (dep) tips.push({ level: 'info', text: 'Вас замещает ' + shortName(dep.name) + ' — ваши отпуска не должны пересекаться.' });
    subs.forEach(function (x) { tips.push({ level: 'info', text: 'Вы замещаете ' + shortName(x.name) + ' — ваши отпуска не должны пересекаться.' }); });
    var upcoming = activeVacs().filter(function (v) { return v.employeeId !== empId && v.end >= today && v.start <= addDays(today, 90); })
      .sort(function (a, c) { return a.start < c.start ? -1 : 1; });
    return '<div class="page-head"><h2>' + (own ? 'Мои отпуска' : esc(e.name)) + '</h2><div class="tools">' + yearSelect() +
      '<button class="btn primary" data-act="propose" data-emp="' + empId + '">' + (own ? '+ Предложить даты отпуска' : '+ Добавить отпуск') + '</button></div></div>' +
      '<div class="grid g-2"><div class="grid" style="align-content:start">' +
      '<div class="card"><div class="card-h"><h3>' + esc(e.name) + '</h3><span class="muted small">' + esc(e.position || '') + '</span></div><div class="card-b">' +
      '<div class="sumline"><div><b>' + b.entitled + '</b><span>положено за ' + y + (b.carry ? ' (вкл. ' + b.carry + ' перенос)' : '') + '</span></div>' +
      '<div><b>' + b.approved + '</b><span>согласовано</span></div><div><b>' + b.proposed + '</b><span>на согласовании</span></div>' +
      '<div><b>' + b.used + '</b><span>использовано</span></div><div class="' + (b.free < 0 ? 'neg' : '') + '"><b>' + b.free + '</b><span>осталось распланировать</span></div></div>' +
      issuesHtml(tips) + '</div></div>' +
      '<div class="card"><div class="card-h"><h3>Периоды</h3></div><div class="card-b tbl-wrap">' +
      (mine.length ? '<table class="tbl"><thead><tr><th>Период</th><th class="r">Дней</th><th>Статус</th><th>Комментарий</th><th></th></tr></thead><tbody>' +
        mine.map(function (v) {
          var cf = ACTIVE[v.status] ? conflictsOf(v) : [];
          var acts = '';
          if (own && v.status === 'proposed') acts = '<button class="btn sm" data-act="edit-vac" data-id="' + v.id + '">Изменить</button> <button class="btn sm danger" data-act="withdraw" data-id="' + v.id + '">Отозвать</button>';
          else if (own && v.status === 'approved' && v.start > today) acts = '<button class="btn sm" data-act="move-vac" data-id="' + v.id + '">Перенести</button>';
          return '<tr><td class="nowrap"><a href="#" data-act="open-vac" data-id="' + v.id + '">' + fmtRange(v.start, v.end) + '</a>' + (cf.length ? ' <span class="badge s-rejected" data-tip="' + esc(cf.map(function (c) { return c.text; }).join('<br>')) + '">конфликт</span>' : '') + '</td>' +
            '<td class="r num">' + v.days + '</td><td>' + statusBadge(v) + '</td>' +
            '<td class="small">' + (v.comment ? esc(v.comment) : '') + (v.managerComment ? '<div class="muted">Руководитель: ' + esc(v.managerComment) + '</div>' : '') + '</td>' +
            '<td class="r nowrap">' + acts + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="empty-state">Отпусков пока нет. Нажмите «Предложить даты отпуска» — программа покажет, какие дни уже заняты коллегами.</div>') +
      '</div></div></div>' +
      '<div class="card" style="align-self:start"><div class="card-h"><h3>Коллеги в отпуске, 90 дней</h3></div><div class="card-b">' +
      (upcoming.length ? '<table class="tbl"><tbody>' + upcoming.map(function (v) {
        return '<tr><td>' + empLabel(emp(v.employeeId)) + '</td><td class="nowrap num">' + fmtShort(v.start) + '–' + fmtShort(v.end) + '</td><td>' + statusBadge(v) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="muted">Никто не уходит в отпуск</div>') + '</div></div></div>';
  }

  /* ---------- Заявки (руководитель) ---------- */

  VIEWS.requests = function () {
    var pending = state.vacations.filter(function (v) { return v.status === 'proposed'; }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    var f = ui.f;
    var all = state.vacations.filter(function (v) {
      return (!f.emp || v.employeeId === f.emp) && (!f.status || v.status === f.status) && (!f.year || vacYear(v) === +f.year);
    }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    return '<div class="page-head"><h2>Заявки на отпуск</h2><div class="tools"><button class="btn primary" data-act="propose">+ Добавить отпуск</button></div></div>' +
      '<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>На согласовании</h3><span class="muted small">' + pending.length + '</span></div><div class="card-b">' +
      (pending.length ? pending.map(function (v) {
        var e = emp(v.employeeId), chk = check(v);
        var rep = v.replacesId ? vacById(state, v.replacesId) : null;
        return '<div class="req-card"><div><div class="row" style="align-items:center;gap:12px">' + empLabel(e, e.position) +
          '<b class="num">' + fmtRange(v.start, v.end) + '</b><span class="muted">' + dni(v.days) + '</span>' +
          (rep ? '<span class="badge">перенос с ' + fmtShort(rep.start) + '–' + fmtShort(rep.end) + '</span>' : '') + '</div>' +
          (v.comment ? '<div class="small" style="margin:6px 0">«' + esc(v.comment) + '»</div>' : '') +
          '<div style="margin-top:8px">' + issuesHtml(chk.issues.filter(function (x) { return x.level !== 'info'; }), 'Пересечений нет') + '</div>' +
          '<div class="muted small" style="margin-top:6px">Подана ' + esc(v.createdAt) + '</div></div>' +
          '<div class="acts"><button class="btn good sm" data-act="approve" data-id="' + v.id + '">Согласовать</button>' +
          '<button class="btn danger sm" data-act="reject" data-id="' + v.id + '">Отклонить</button>' +
          '<button class="btn sm" data-act="edit-vac" data-id="' + v.id + '">Изменить даты</button></div></div>';
      }).join('') : '<div class="muted">Новых заявок нет</div>') + '</div></div>' +
      '<div class="card"><div class="card-h"><h3>Все периоды</h3><div class="row">' +
      '<select class="inp" data-act="filter" data-k="emp" style="width:auto"><option value="">Все сотрудники</option>' + state.employees.map(function (e) {
        return '<option value="' + e.id + '"' + (f.emp === e.id ? ' selected' : '') + '>' + esc(shortName(e.name)) + '</option>';
      }).join('') + '</select>' +
      '<select class="inp" data-act="filter" data-k="status" style="width:auto"><option value="">Все статусы</option>' + Object.keys(STATUS).map(function (k) {
        return '<option value="' + k + '"' + (f.status === k ? ' selected' : '') + '>' + STATUS[k] + '</option>';
      }).join('') + '</select>' +
      '<select class="inp" data-act="filter" data-k="year" style="width:auto"><option value="">Все годы</option>' + yearsList().map(function (y) {
        return '<option value="' + y + '"' + (+f.year === y ? ' selected' : '') + '>' + y + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="card-b tbl-wrap"><table class="tbl"><thead><tr><th>Сотрудник</th><th>Период</th><th class="r">Дней</th><th>Год</th><th>Статус</th><th>Комментарии</th><th>Изменено</th></tr></thead><tbody>' +
      all.map(function (v) {
        var cf = ACTIVE[v.status] ? conflictsOf(v) : [];
        return '<tr class="click" data-act="open-vac" data-id="' + v.id + '"><td>' + empLabel(emp(v.employeeId)) + '</td><td class="nowrap num">' + fmtRange(v.start, v.end) +
          (cf.length ? ' <span class="badge s-rejected">конфликт</span>' : '') + '</td><td class="r num">' + v.days + '</td><td class="num">' + vacYear(v) + '</td><td>' + statusBadge(v) + '</td>' +
          '<td class="small">' + esc(v.comment || '') + (v.managerComment ? '<div class="muted">' + esc(v.managerComment) + '</div>' : '') + '</td><td class="small muted nowrap">' + esc(v.updatedAt || '') + '</td></tr>';
      }).join('') + '</tbody></table>' + (all.length ? '' : '<div class="empty-state">Ничего не найдено</div>') + '</div></div>';
  };

  /* ---------- Сотрудники ---------- */

  VIEWS.employees = function () {
    var y = ui.year;
    return '<div class="page-head"><h2>Сотрудники</h2><div class="tools">' + yearSelect() + '<button class="btn primary" data-act="edit-emp">+ Добавить сотрудника</button></div></div>' +
      '<div class="card"><div class="card-b tbl-wrap"><table class="tbl"><thead><tr><th>Ф.И.О.</th><th>Должность</th><th>Таб. №</th><th class="r">Дней в год</th><th class="r">Перенос на ' + y + '</th><th class="r">Осталось ' + y + '</th><th>Замещающий</th><th>PIN</th></tr></thead><tbody>' +
      state.employees.map(function (e) {
        var b = balanceOf(state, e.id, y);
        return '<tr class="click" data-act="edit-emp" data-id="' + e.id + '"><td><span class="emp"><span class="dot" style="background:' + esc(e.color) + '"></span>' + esc(e.name) + '</span></td>' +
          '<td>' + esc(e.position || '') + '</td><td class="num">' + esc(e.tabNo || '') + '</td><td class="r num">' + e.daysPerYear + '</td><td class="r num">' + (b.carry || '') + '</td>' +
          '<td class="r num">' + b.free + '</td><td>' + (e.deputyId ? esc(shortName(emp(e.deputyId).name)) : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (e.hasPin ? '<span class="badge s-approved">задан</span>' : '<span class="muted small">нет</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' +
      '<p class="muted small">Замещающий — сотрудник, чей отпуск не должен пересекаться с отпуском этого сотрудника. PIN-код защищает вход сотрудника: без него любой сможет подать заявку от чужого имени.</p>';
  };

  /* ---------- Настройки ---------- */

  VIEWS.settings = function () {
    var S = state.settings, remote = conn.mode === 'remote';
    var bl = state.blackouts || [];
    return '<div class="page-head"><h2>Настройки</h2></div><div class="grid g-2"><div class="grid" style="align-content:start">' +
      '<div class="card"><div class="card-h"><h3>Правила планирования</h3></div><div class="card-b"><div class="row">' +
      fld('Макс. одновременно в отпуске, чел.', 'maxAbsent', S.maxAbsent, 'number') +
      fld('Мин. длина одной части, дн.', 'minPart', S.minPart, 'number') +
      fld('Уведомлять о начале за, дн.', 'notifyDays', S.notifyDays, 'number') +
      fld('Год планирования', 'planYear', S.planYear, 'number') + '</div>' +
      '<h3 style="margin:18px 0 8px">Нежелательные периоды</h3><p class="muted small" style="margin:0 0 8px">Например, годовая отчётность или пиковая нагрузка. При выборе этих дат сотрудник увидит предупреждение.</p>' +
      '<div id="bl-list">' + bl.map(blRow).join('') + '</div><button class="btn sm" data-act="bl-add">+ Добавить период</button>' +
      '<h3 style="margin:18px 0 8px">Реквизиты для графика Т-7</h3><div class="row">' +
      fld('Организация', 'orgName', S.orgName) + fld('Структурное подразделение', 'unitName', S.unitName) + '</div><div class="row" style="margin-top:10px">' +
      fld('Должность руководителя', 'managerPosition', S.managerPosition) + fld('Руководитель (Ф.И.О.)', 'managerName', S.managerName) +
      fld('Руководитель кадровой службы', 'hrName', S.hrName) + '</div>' +
      '<h3 style="margin:18px 0 8px">Пароль руководителя</h3><div class="row">' + fld('Новый пароль (оставьте пустым, чтобы не менять)', 'password', '', 'password') + '</div>' +
      '<div style="margin-top:16px"><button class="btn primary" data-act="save-settings">Сохранить настройки</button></div></div></div>' +
      '<div class="card"><div class="card-h"><h3>Журнал изменений</h3><span class="muted small">последние 100</span></div><div class="card-b tbl-wrap" style="max-height:420px;overflow:auto"><table class="tbl"><tbody>' +
      (state.log || []).slice(0, 100).map(function (l) { return '<tr><td class="small muted nowrap">' + esc(l.ts) + '</td><td class="small nowrap">' + esc(l.who) + '</td><td class="small">' + esc(l.text) + '</td></tr>'; }).join('') +
      '</tbody></table></div></div></div>' +
      '<div class="grid" style="align-content:start">' +
      '<div class="card"><div class="card-h"><h3>Подключение</h3></div><div class="card-b">' +
      '<p style="margin-top:0">' + (remote ? 'Данные хранятся в <b>Google Таблице</b> — все сотрудники видят одно и то же.' : '<b>Локальный режим</b>: данные хранятся только в этом браузере. Чтобы сотрудники подавали заявки со своих компьютеров, подключите Google Таблицу.') + '</p>' +
      '<label class="field"><span>Адрес веб-приложения Apps Script (…/exec)</span><input class="inp" id="api-url" value="' + esc(apiUrl()) + '" placeholder="https://script.google.com/macros/s/…/exec"></label>' +
      '<div class="row" style="margin-top:10px"><button class="btn" data-act="api-save">Подключить</button>' + (remote ? '<button class="btn ghost" data-act="api-clear">Отключить</button>' : '') + '</div>' +
      (CFG.apiUrl ? '<p class="muted small">Адрес по умолчанию задан в config.js.</p>' : '<p class="muted small">Чтобы не вводить адрес на каждом компьютере, впишите его в файл config.js.</p>') +
      '</div></div>' +
      '<div class="card"><div class="card-h"><h3>Данные</h3></div><div class="card-b"><div class="row">' +
      '<button class="btn" data-act="export-json">Резервная копия (JSON)</button>' +
      '<label class="btn">Загрузить из копии<input type="file" accept=".json,application/json" id="import-file" hidden></label>' +
      (oldData() ? '<button class="btn" data-act="import-old">Перенести данные из прежней версии</button>' : '') +
      (!remote ? '<button class="btn danger" data-act="reset-local">Сбросить к начальным</button>' : '') +
      '</div><p class="muted small">Загрузка из копии заменяет всех сотрудников и отпуска.</p></div></div>' +
      '<div class="card"><div class="card-h"><h3>Производственный календарь</h3></div><div class="card-b small">' +
      '<p style="margin-top:0">Праздничные дни (ст. 112 ТК РФ) не входят в число дней отпуска — программа считает это автоматически и продлевает отпуск при подборе по количеству дней.</p>' +
      '<p class="muted" style="margin-bottom:0">Переносы выходных заложены на 2025, 2026 и 2027 годы. Для других лет действует общее правило переноса праздника с выходного на следующий рабочий день.</p></div></div>' +
      '</div></div>';
  };
  function fld(label, key, val, type) {
    return '<label class="field"><span>' + esc(label) + '</span><input class="inp" data-set="' + key + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (type === 'password' ? ' autocomplete="new-password"' : '') + '></label>';
  }
  function blRow(b) {
    b = b || { start: '', end: '', reason: '' };
    return '<div class="row bl-row" style="margin-bottom:8px"><label class="field" style="flex:0 0 150px"><span>С</span><input type="date" class="inp" data-bl="start" value="' + esc(b.start) + '"></label>' +
      '<label class="field" style="flex:0 0 150px"><span>По</span><input type="date" class="inp" data-bl="end" value="' + esc(b.end) + '"></label>' +
      '<label class="field"><span>Причина</span><input class="inp" data-bl="reason" value="' + esc(b.reason) + '"></label>' +
      '<button class="btn ghost icon" data-act="bl-del" title="Удалить">✕</button></div>';
  }

  /* ---------- Модальные окна ---------- */

  var modals = [];
  function openModal(html, opts) {
    opts = opts || {};
    var bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) closeModal(); });
    document.body.appendChild(bg);
    modals.push(bg);
    var f = bg.querySelector('[autofocus]');
    if (f) setTimeout(function () { f.focus(); }, 30);
    return bg;
  }
  function closeModal() { var m = modals.pop(); if (m) m.remove(); hideTip(); }
  function modalHead(t) { return '<div class="modal-h"><h3>' + t + '</h3><button class="btn ghost icon" data-act="close">✕</button></div>'; }
  function askText(title, label, required) {
    return new Promise(function (resolve) {
      var m = openModal(modalHead(esc(title)) + '<div class="modal-b"><label class="field"><span>' + esc(label) + '</span><textarea class="inp" id="ask-t" autofocus></textarea></label></div>' +
        '<div class="modal-f"><button class="btn" data-act="close">Отмена</button><button class="btn primary" id="ask-ok">OK</button></div>');
      $('#ask-ok', m).onclick = function () {
        var v = $('#ask-t', m).value.trim();
        if (required && !v) { $('#ask-t', m).focus(); return toast('Заполните поле', 'err'); }
        closeModal(); resolve(v);
      };
    });
  }

  /* ---------- Окно выбора дат с подсветкой занятых дней ---------- */

  var ed = null;
  function openEditor(o) {
    o = o || {};
    var v = o.vacId ? vacById(state, o.vacId) : null;
    var mode = o.mode || (v ? 'edit' : 'new');
    var empId = v ? v.employeeId : (o.employeeId || meId() || '');
    if (!isMgr()) empId = meId();
    ed = {
      mode: mode, employeeId: empId,
      id: mode === 'edit' && v ? v.id : '',
      replacesId: mode === 'move' && v ? v.id : '',
      start: mode === 'edit' && v ? v.start : (o.start || ''),
      end: mode === 'edit' && v ? v.end : (o.end || ''),
      comment: mode === 'edit' && v ? (v.comment || '') : '',
      approve: false, stage: 0
    };
    var base = ed.start || (+todayISO().slice(0, 4) < ui.year ? ui.year + '-01-01' : todayISO());
    ed.pickMonth = base.slice(0, 7);
    var title = mode === 'edit' ? 'Изменить даты отпуска' : mode === 'move' ? 'Перенос отпуска ' + fmtRange(v.start, v.end) : (isMgr() ? 'Добавить отпуск' : 'Предложить даты отпуска');
    var emps = state.employees;
    var html = modalHead(esc(title)) + '<div class="modal-b"><div class="pv"><div>' +
      (isMgr() && mode === 'new'
        ? '<label class="field"><span>Сотрудник</span><select class="inp" id="ed-emp"><option value="">— выберите —</option>' + emps.map(function (e) {
          return '<option value="' + e.id + '"' + (e.id === ed.employeeId ? ' selected' : '') + '>' + esc(e.name) + '</option>';
        }).join('') + '</select></label>'
        : '<div class="field"><span>Сотрудник</span><div style="padding:6px 0">' + empLabel(emp(ed.employeeId), emp(ed.employeeId).position) + '</div></div>') +
      '<div class="row" style="margin-top:10px"><label class="field"><span>Начало</span><input type="date" class="inp" id="ed-start" value="' + ed.start + '"></label>' +
      '<label class="field"><span>Окончание</span><input type="date" class="inp" id="ed-end" value="' + ed.end + '"></label>' +
      '<label class="field" style="flex:0 0 90px"><span>Дней</span><input type="number" min="1" max="120" class="inp" id="ed-days"></label></div>' +
      '<div class="muted small" style="margin-top:4px">Можно выбрать даты щелчками по календарю справа: первый щелчок — начало, второй — окончание. Если ввести число дней, окончание посчитается с учётом праздников.</div>' +
      '<div id="ed-result"></div>' +
      '<label class="field" style="margin-top:10px"><span>Комментарий' + (isMgr() ? '' : ' для руководителя') + '</span><textarea class="inp" id="ed-comment" rows="2" placeholder="Например: семейная поездка, можно сдвинуть на неделю">' + esc(ed.comment) + '</textarea></label>' +
      '</div><div>' +
      '<div class="picker-head"><button class="btn icon" data-act="pk-shift" data-k="-1">‹</button><b id="pk-title"></b><button class="btn icon" data-act="pk-shift" data-k="1">›</button></div>' +
      '<div id="ed-picker"></div>' +
      '<div class="legend" style="margin:10px 0 14px"><span><i class="sw" style="background:var(--warn-soft);border:1px solid var(--line)"></i>1 чел. в отпуске</span><span><i class="sw" style="background:#fde2b0"></i>2+</span>' +
      '<span><i class="sw" style="background:var(--bad-soft);border:1px solid var(--bad-mark)"></i>занято: лимит или замещающий</span><span><i class="sw" style="background:var(--accent)"></i>ваш выбор</span><span><i class="sw" style="box-shadow:inset 0 0 0 2px var(--ink-2)"></i>ваш другой отпуск</span></div>' +
      '<div class="card" style="box-shadow:none"><div class="card-b"><div class="row" style="align-items:flex-end"><b style="flex:1 1 100%">Подобрать свободные даты</b>' +
      '<label class="field" style="flex:0 0 90px"><span>Дней</span><input type="number" class="inp" id="w-days" min="1" max="60" value="14"></label>' +
      '<label class="field" style="flex:1 1 140px"><span>Начиная с месяца</span><select class="inp" id="w-month"></select></label>' +
      '<button class="btn" data-act="find-windows">Найти</button></div><div id="ed-windows" class="windows" style="margin-top:10px"></div></div></div>' +
      '</div></div></div>' +
      '<div class="modal-f">' + (isMgr() && mode !== 'edit' ? '<label class="check left"><input type="checkbox" id="ed-approve" checked> Сразу согласовать</label>' : '') +
      '<button class="btn" data-act="close">Отмена</button><button class="btn primary" id="ed-save"></button></div>';
    var m = openModal(html, { wide: true });
    if (isMgr() && mode !== 'edit') ed.approve = true;
    // месяцы для подбора
    var wm = $('#w-month', m), ty = +todayISO().slice(0, 4), cm = todayISO().slice(0, 7), opts = '';
    [ty, ty + 1].forEach(function (yy) {
      for (var k = 1; k <= 12; k++) {
        var val = yy + '-' + pad2(k);
        if (val < cm) continue;
        opts += '<option value="' + val + '"' + (val === ed.pickMonth ? ' selected' : '') + '>' + MONTHS[k - 1] + ' ' + yy + '</option>';
      }
    });
    wm.innerHTML = opts;
    var bal = ed.employeeId ? balanceOf(state, ed.employeeId, ui.year) : null;
    if (bal && bal.free > 0 && bal.free < 14) $('#w-days', m).value = bal.free;

    var sync = function () { $('#ed-start', m).value = ed.start; $('#ed-end', m).value = ed.end; updateEditor(); };
    if ($('#ed-emp', m)) $('#ed-emp', m).onchange = function () { ed.employeeId = this.value; updateEditor(); };
    $('#ed-start', m).onchange = function () {
      ed.start = this.value;
      if (ed.start && (!ed.end || ed.end < ed.start)) { var nd = +$('#ed-days', m).value || 14; ed.end = endForDays(ed.start, nd); }
      if (ed.start) ed.pickMonth = ed.start.slice(0, 7);
      sync();
    };
    $('#ed-end', m).onchange = function () { ed.end = this.value; updateEditor(); };
    $('#ed-days', m).oninput = function () { var n = +this.value; if (ed.start && n > 0 && n <= 120) { ed.end = endForDays(ed.start, n); $('#ed-end', m).value = ed.end; updateEditor(true); } };
    $('#ed-comment', m).oninput = function () { ed.comment = this.value; };
    if ($('#ed-approve', m)) $('#ed-approve', m).onchange = function () { ed.approve = this.checked; updateEditor(); };
    $('#ed-save', m).onclick = saveEditor;
    ed.sync = sync;
    updateEditor();
  }
  function updateEditor(keepDays) {
    var m = modals[modals.length - 1];
    if (!m || !ed) return;
    var res = $('#ed-result', m), chk = null;
    if (ed.employeeId && ed.start && ed.end) {
      chk = checkPeriod(state, { employeeId: ed.employeeId, start: ed.start, end: ed.end, id: ed.id, replacesId: ed.replacesId });
      if (!keepDays) $('#ed-days', m).value = chk.days || '';
      var y = +ed.start.slice(0, 4);
      var hard = chk.issues.filter(function (x) { return x.level === 'conflict'; }).length;
      res.innerHTML = '<div class="sumline"><div><b>' + chk.days + '</b><span>дней отпуска' + (chk.holidays.length ? ', без ' + chk.holidays.length + ' праздн.' : '') + '</span></div>' +
        '<div><b>' + (chk.entitled !== undefined ? chk.entitled : '—') + '</b><span>положено за ' + y + '</span></div>' +
        '<div class="' + (chk.leftAfter < 0 ? 'neg' : '') + '"><b>' + (chk.leftAfter !== undefined ? chk.leftAfter : '—') + '</b><span>останется</span></div>' +
        '<div><b style="color:' + (hard ? 'var(--bad)' : chk.overlaps.length ? 'var(--warn)' : 'var(--good)') + '">' + (hard ? 'Конфликт' : chk.overlaps.length ? 'Пересечение' : 'Свободно') + '</b><span>статус дат</span></div></div>' +
        issuesHtml(chk.issues, 'Даты свободны: никто из коллег в эти дни не в отпуске') +
        (chk.overlaps.length ? '<table class="tbl overl" style="margin-top:10px"><thead><tr><th>Кто ещё в отпуске</th><th>Его период</th><th>Пересечение</th></tr></thead><tbody>' +
          chk.overlaps.map(function (o) {
            var e = emp(o.employeeId);
            return '<tr><td>' + empLabel(e) + (o.rule ? ' <span class="badge s-rejected">' + esc(o.rule.toLowerCase()) + '</span>' : '') + '</td><td class="nowrap num">' + fmtShort(o.vacation.start) + '–' + fmtShort(o.vacation.end) +
              (o.vacation.status === 'proposed' ? ' <span class="badge s-proposed">заявка</span>' : '') + '</td><td class="nowrap num">' + fmtShort(o.from) + '–' + fmtShort(o.to) + ' (' + o.n + ' дн.)</td></tr>';
          }).join('') + '</tbody></table>' : '');
    } else {
      res.innerHTML = '<div class="sumline"><div><span>' + (ed.employeeId ? 'Выберите даты — занятые коллегами дни подсвечены в календаре' : 'Выберите сотрудника') + '</span></div></div>';
    }
    var save = $('#ed-save', m);
    var blocked = !chk || chk.issues.some(function (x) { return x.level === 'block'; });
    save.disabled = blocked;
    save.textContent = ed.mode === 'edit' ? 'Сохранить изменения' : isMgr() ? (ed.approve ? 'Добавить согласованным' : 'Добавить как заявку') : ed.mode === 'move' ? 'Отправить перенос на согласование' : 'Отправить на согласование';
    drawPicker(m, chk);
  }
  function drawPicker(m, chk) {
    var box = $('#ed-picker', m), today = todayISO(), max = +state.settings.maxAbsent || 0;
    var y = +ed.pickMonth.slice(0, 4), mo = +ed.pickMonth.slice(5, 7);
    var e = ed.employeeId ? empById(state, ed.employeeId) : null;
    var linked = {};
    if (e) {
      if (e.deputyId) linked[e.deputyId] = 1;
      state.employees.forEach(function (x) { if (x.deputyId === e.id) linked[x.id] = 1; });
    }
    var act = activeVacs().filter(function (v) { return v.id !== ed.id && v.id !== ed.replacesId; });
    var html = '', titles = [];
    for (var k = 0; k < 3; k++) {
      var yy = y + Math.floor((mo - 1 + k) / 12), mm = (mo - 1 + k) % 12 + 1, pre = yy + '-' + pad2(mm);
      titles.push(MONTHS[mm - 1] + (k === 2 || mm === 12 ? ' ' + yy : ''));
      var nd = new Date(Date.UTC(yy, mm, 0)).getUTCDate(), off = (weekdayOf(pre + '-01') + 6) % 7;
      html += '<div class="pm"><h5>' + MONTHS[mm - 1] + ' ' + yy + '</h5><div class="g">' + WD.map(function (w) { return '<div class="wd">' + w + '</div>'; }).join('');
      for (var i = 0; i < off; i++) html += '<div></div>';
      for (var d = 1; d <= nd; d++) {
        var iso = pre + '-' + pad2(d), t = dayType(iso);
        var here = act.filter(function (v) { return v.start <= iso && v.end >= iso; });
        var others = {}, mine = false, dep = false;
        here.forEach(function (v) {
          if (v.employeeId === ed.employeeId) mine = true;
          else { others[v.employeeId] = v.status; if (linked[v.employeeId]) dep = true; }
        });
        var ids = Object.keys(others), n = ids.length;
        var full = dep || (max && n + 1 > max);
        var cls = 'pd' + (t !== 'work' ? ' ' + t : '') + (full ? ' full' : n >= 2 ? ' busy2' : n === 1 ? ' busy1' : '') + (mine ? ' mine' : '') + (iso < today ? ' past' : '');
        if (ed.start && ed.end && iso >= ed.start && iso <= ed.end) cls += ' sel' + (chk && chk.conflictDays[iso] ? ' conf' : n ? ' warnd' : '');
        else if (ed.start && !ed.end && iso === ed.start) cls += ' sel';
        if ((state.blackouts || []).some(function (b) { return b.start <= iso && b.end >= iso; })) cls += ' blk';
        var tip = '<b>' + fmtHuman(iso) + '</b>' + (t === 'holiday' ? ' · праздник (не входит в отпуск)' : t === 'off' ? ' · выходной' : '');
        if (n) tip += '<br>В отпуске:' + ids.map(function (id) {
          var x = emp(id);
          return '<div class="t-row"><span class="dot" style="background:' + esc(x.color) + '"></span>' + esc(shortName(x.name)) + (others[id] === 'proposed' ? ' <i>(заявка)</i>' : '') + (linked[id] ? ' — <b>замещение</b>' : '') + '</div>';
        }).join('');
        else tip += '<br>Свободно';
        if (full) tip += '<br><span style="color:#ff9b9b">' + (dep ? 'Отпуск пересечётся с замещающим' : 'Будет превышен лимит ' + max + ' чел.') + '</span>';
        html += '<div class="' + cls + '" data-act="pk-day" data-d="' + iso + '" data-tip="' + esc(tip) + '">' + d +
          (n ? '<span class="oc">' + ids.slice(0, 4).map(function (id) { return '<i style="background:' + esc(emp(id).color) + '"></i>'; }).join('') + '</span>' : '') + '</div>';
      }
      html += '</div></div>';
    }
    box.innerHTML = '<div class="picker">' + html + '</div>';
    $('#pk-title', m).textContent = titles[0] + ' — ' + titles[2];
  }
  function pickDay(iso) {
    if (!ed.employeeId) return toast('Сначала выберите сотрудника', 'err');
    if (ed.stage === 0 || !ed.start) { ed.start = iso; ed.end = ''; ed.stage = 1; }
    else if (iso >= ed.start) { ed.end = iso; ed.stage = 0; }
    else { ed.start = iso; ed.end = ''; ed.stage = 1; }
    if (ed.start && !ed.end) {
      $('#ed-start', modals[modals.length - 1]).value = ed.start; $('#ed-end', modals[modals.length - 1]).value = '';
      updateEditor(); return;
    }
    ed.sync();
  }
  function findWin() {
    var m = modals[modals.length - 1];
    if (!ed.employeeId) return toast('Сначала выберите сотрудника', 'err');
    var n = +$('#w-days', m).value || 14, from = $('#w-month', m).value + '-01';
    if (from < todayISO()) from = addDays(todayISO(), 1);
    var to = addDays(from, 365);
    var list = findWindows(state, ed.employeeId, n, from, to, 8, ed.id, ed.replacesId);
    $('#ed-windows', m).innerHTML = list.length ? list.map(function (w) {
      return '<button class="win" data-act="use-window" data-s="' + w.start + '" data-e="' + w.end + '">' + fmtShort(w.start) + '–' + fmtShort(w.end) + '.' + w.end.slice(0, 4) +
        (w.overlaps ? ' <span class="muted">· пересеч. ' + w.overlaps + '</span>' : ' <span style="color:var(--good)">· свободно</span>') + '</button>';
    }).join('') : '<span class="muted small">Свободных окон без конфликтов не найдено</span>';
  }
  function saveEditor() {
    var btn = this;
    var payload = { employeeId: ed.employeeId, start: ed.start, end: ed.end, comment: ed.comment };
    var action = 'propose';
    if (ed.mode === 'edit') { action = 'updateVacation'; payload.id = ed.id; }
    if (ed.mode === 'move') payload.replacesId = ed.replacesId;
    if (isMgr() && ed.mode !== 'edit') payload.approve = ed.approve;
    var chk = checkPeriod(state, { employeeId: ed.employeeId, start: ed.start, end: ed.end, id: ed.id, replacesId: ed.replacesId });
    var hard = chk.issues.filter(function (x) { return x.level === 'conflict'; });
    if (hard.length && !confirm('Есть конфликты:\n• ' + hard.map(function (x) { return x.text; }).join('\n• ') + '\n\nВсё равно ' + (isMgr() ? 'сохранить' : 'отправить') + '?')) return;
    busy(btn, true);
    Store.op(action, payload).then(function () {
      closeModal();
      toast(ed.mode === 'edit' ? 'Изменения сохранены' : isMgr() && ed.approve ? 'Отпуск добавлен' : 'Заявка отправлена руководителю', 'ok');
      renderAll();
    }).catch(function (e) { busy(btn, false); toast(e.message, 'err'); });
  }

  /* ---------- Карточка периода ---------- */

  function openVacation(id) {
    var v = vacById(state, id);
    if (!v) return;
    var e = emp(v.employeeId), today = todayISO();
    var own = v.employeeId === meId();
    var chk = ACTIVE[v.status] ? check(v) : null;
    var rep = v.replacesId ? vacById(state, v.replacesId) : null;
    var acts = [];
    if (isMgr()) {
      if (v.status === 'proposed') {
        acts.push('<button class="btn good" data-act="approve" data-id="' + v.id + '">Согласовать</button>');
        acts.push('<button class="btn danger" data-act="reject" data-id="' + v.id + '">Отклонить</button>');
      }
      if (ACTIVE[v.status]) acts.push('<button class="btn" data-act="edit-vac" data-id="' + v.id + '">Изменить даты</button>');
      if (v.status === 'approved' && v.end >= today) acts.push('<button class="btn" data-act="cancel-vac" data-id="' + v.id + '">Отменить</button>');
    } else if (own) {
      if (v.status === 'proposed') {
        acts.push('<button class="btn" data-act="edit-vac" data-id="' + v.id + '">Изменить даты</button>');
        acts.push('<button class="btn danger" data-act="withdraw" data-id="' + v.id + '">Отозвать заявку</button>');
      }
      if (v.status === 'approved' && v.start > today) acts.push('<button class="btn" data-act="move-vac" data-id="' + v.id + '">Попросить перенос</button>');
    }
    var html = modalHead(esc(e.name)) + '<div class="modal-b">' +
      '<div class="row" style="align-items:center;gap:12px;margin-bottom:10px"><b style="font-size:18px" class="num">' + fmtRange(v.start, v.end) + '</b>' + statusBadge(v) + '</div>' +
      '<div class="sumline"><div><b>' + v.days + '</b><span>дней отпуска</span></div><div><b>' + vacYear(v) + '</b><span>учётный год</span></div>' +
      (v.status === 'approved' && v.start > today ? '<div><b>' + fmtShort(addDays(v.start, -(+state.settings.notifyDays || 14))) + '</b><span>уведомить не позднее</span></div>' : '') + '</div>' +
      (rep ? '<p class="small">Перенос отпуска ' + fmtRange(rep.start, rep.end) + ' (' + esc(STATUS[rep.status]) + ')</p>' : '') +
      (v.comment ? '<p><span class="muted small">Комментарий сотрудника</span><br>' + esc(v.comment) + '</p>' : '') +
      (v.managerComment ? '<p><span class="muted small">Комментарий руководителя</span><br>' + esc(v.managerComment) + '</p>' : '') +
      (chk ? issuesHtml(chk.issues.filter(function (x) { return x.level === 'conflict' || x.level === 'warn' && x.text.indexOf('Пересечение') === 0 || x.text.indexOf('Нежелательный') === 0; }), 'Пересечений нет') : '') +
      '<p class="muted small" style="margin-bottom:0">Создано ' + esc(v.createdAt || '') + ' · изменено ' + esc(v.updatedAt || '') + (v.updatedBy ? ' (' + esc(v.updatedBy) + ')' : '') + '</p></div>' +
      '<div class="modal-f">' + (isMgr() ? '<div class="left"><button class="btn ghost danger" data-act="delete-vac" data-id="' + v.id + '">Удалить</button></div>' : '') +
      acts.join('') + '<button class="btn" data-act="close">Закрыть</button></div>';
    openModal(html);
  }

  /* ---------- Карточка сотрудника ---------- */

  function openEmployee(id) {
    var e = id ? clone(empById(state, id)) : { id: '', name: '', position: '', tabNo: '', daysPerYear: 28, deputyId: '', color: PALETTE[state.employees.length % PALETTE.length] };
    var y = ui.year, carry = id ? carryOf(state, id, y) : 0;
    var html = modalHead(id ? 'Сотрудник' : 'Новый сотрудник') + '<div class="modal-b"><div class="grid" style="gap:12px">' +
      '<label class="field"><span>Ф.И.О.</span><input class="inp" id="em-name" value="' + esc(e.name) + '" autofocus></label>' +
      '<div class="row"><label class="field"><span>Должность</span><input class="inp" id="em-pos" value="' + esc(e.position) + '"></label>' +
      '<label class="field" style="flex:0 0 120px"><span>Табельный №</span><input class="inp" id="em-tab" value="' + esc(e.tabNo) + '"></label></div>' +
      '<div class="row"><label class="field"><span>Дней отпуска в год</span><input type="number" min="0" class="inp" id="em-days" value="' + e.daysPerYear + '"></label>' +
      '<label class="field"><span>Перенос неиспользованных дней на ' + y + ' г.</span><input type="number" class="inp" id="em-carry" value="' + carry + '"></label></div>' +
      '<label class="field"><span>Замещающий (их отпуска не должны пересекаться)</span><select class="inp" id="em-dep"><option value="">— нет —</option>' +
      state.employees.filter(function (x) { return x.id !== e.id; }).map(function (x) { return '<option value="' + x.id + '"' + (x.id === e.deputyId ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></label>' +
      '<div class="row"><label class="field"><span>PIN-код для входа ' + (e.hasPin ? '(задан; введите новый или оставьте пустым)' : '(необязательно)') + '</span><input class="inp" id="em-pin" autocomplete="off" placeholder="' + (e.hasPin ? '••••' : 'например, 4 цифры') + '"></label>' +
      '<label class="field" style="flex:0 0 90px"><span>Цвет</span><input type="color" class="inp" id="em-color" value="' + esc(e.color) + '" style="height:36px;padding:2px"></label></div>' +
      (e.hasPin ? '<label class="check small"><input type="checkbox" id="em-pin-clear"> убрать PIN-код</label>' : '') +
      '</div></div><div class="modal-f">' + (id ? '<div class="left"><button class="btn ghost danger" data-act="delete-emp" data-id="' + id + '">Удалить сотрудника</button></div>' : '') +
      '<button class="btn" data-act="close">Отмена</button><button class="btn primary" id="em-save">Сохранить</button></div>';
    var m = openModal(html);
    $('#em-save', m).onclick = function () {
      var btn = this, pin = $('#em-pin', m).value.trim();
      var clr = $('#em-pin-clear', m) && $('#em-pin-clear', m).checked;
      var p = { id: e.id, name: $('#em-name', m).value, position: $('#em-pos', m).value, tabNo: $('#em-tab', m).value,
        daysPerYear: +$('#em-days', m).value, deputyId: $('#em-dep', m).value, color: $('#em-color', m).value,
        pin: clr ? '' : (pin || '__keep__'), carryYear: y, carry: +$('#em-carry', m).value || 0 };
      busy(btn, true);
      Store.op('saveEmployee', { employee: p }).then(function () { closeModal(); toast('Сохранено', 'ok'); renderAll(); })
        .catch(function (er) { busy(btn, false); toast(er.message, 'err'); });
    };
  }

  /* ---------- Выгрузка в Excel ---------- */

  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'vendor/xlsx.min.js';
      s.onload = function () { res(window.XLSX); };
      s.onerror = function () { rej(new Error('Не удалось загрузить модуль Excel (vendor/xlsx.min.js)')); };
      document.head.appendChild(s);
    });
  }
  var BORDER = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  function cell(v, s) { var c = { v: v == null ? '' : v, t: typeof v === 'number' ? 'n' : 's' }; if (s) c.s = s; return c; }
  function exportT7() {
    var y = ui.year, S = state.settings;
    loadXLSX().then(function (X) {
      var rows = [], merges = [];
      var R = function (arr) { rows.push(arr); return rows.length - 1; };
      var st = { font: { name: 'Arial', sz: 9 } };
      var b = { font: { name: 'Arial', sz: 9, bold: true } };
      var hdr = { font: { name: 'Arial', sz: 8, bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: BORDER, fill: { fgColor: { rgb: 'F2F2F2' } } };
      var td = { font: { name: 'Arial', sz: 9 }, alignment: { vertical: 'center', wrapText: true }, border: BORDER };
      var tdc = { font: { name: 'Arial', sz: 9 }, alignment: { horizontal: 'center', vertical: 'center' }, border: BORDER };
      R([cell('', st), '', '', '', '', '', '', '', cell('Унифицированная форма № Т-7', { font: { name: 'Arial', sz: 8 }, alignment: { horizontal: 'right' } })]); merges.push({ s: { r: 0, c: 8 }, e: { r: 0, c: 9 } });
      R(['', '', '', '', '', '', '', '', cell('Утверждена постановлением Госкомстата России от 05.01.2004 № 1', { font: { name: 'Arial', sz: 7 }, alignment: { horizontal: 'right', wrapText: true } })]); merges.push({ s: { r: 1, c: 8 }, e: { r: 1, c: 9 } });
      var r = R([cell(S.orgName, b)]); merges.push({ s: { r: r, c: 0 }, e: { r: r, c: 7 } });
      r = R([cell('(наименование организации)', { font: { name: 'Arial', sz: 7, italic: true } })]); merges.push({ s: { r: r, c: 0 }, e: { r: r, c: 7 } });
      r = R([cell(S.unitName, st)]); merges.push({ s: { r: r, c: 0 }, e: { r: r, c: 7 } });
      R([]);
      r = R(['', '', '', cell('Номер документа', hdr), cell('Дата составления', hdr), cell('На год', hdr), '', cell('УТВЕРЖДАЮ', b)]);
      R(['', '', '', cell('', tdc), cell(fmtDate(todayISO()), tdc), cell(y, tdc), '', cell(S.managerPosition || 'Руководитель', st)]);
      R(['', '', '', '', '', '', '', cell('______________  ' + (S.managerName || ''), st)]);
      R(['', '', '', '', '', '', '', cell('«____» ______________ ' + (y - 1) + ' г.', st)]);
      r = R([cell('ГРАФИК ОТПУСКОВ', { font: { name: 'Arial', sz: 12, bold: true }, alignment: { horizontal: 'center' } })]); merges.push({ s: { r: r, c: 0 }, e: { r: r, c: 9 } });
      R([]);
      var h1 = R([cell('Структурное подразделение', hdr), cell('Должность (специальность, профессия) по штатному расписанию', hdr), cell('Фамилия, имя, отчество', hdr), cell('Табельный номер', hdr),
        cell('ОТПУСК', hdr), cell('', hdr), cell('', hdr), cell('', hdr), cell('', hdr), cell('Примечание', hdr)]);
      R([cell('', hdr), cell('', hdr), cell('', hdr), cell('', hdr), cell('количество календарных дней', hdr), cell('дата запланированная', hdr), cell('дата фактическая', hdr),
        cell('перенесение отпуска: основание (документ)', hdr), cell('перенесение отпуска: дата предполагаемого отпуска', hdr), cell('', hdr)]);
      [0, 1, 2, 3, 9].forEach(function (c) { merges.push({ s: { r: h1, c: c }, e: { r: h1 + 1, c: c } }); });
      merges.push({ s: { r: h1, c: 4 }, e: { r: h1, c: 8 } });
      R([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return cell(n, tdc); }));
      state.employees.forEach(function (e) {
        var vs = state.vacations.filter(function (v) { return v.employeeId === e.id && vacYear(v) === y && (v.status === 'approved' || v.status === 'moved'); })
          .sort(function (a, c) { return a.start < c.start ? -1 : 1; });
        if (!vs.length) { R([cell(S.unitName, td), cell(e.position, td), cell(e.name, td), cell(e.tabNo, tdc), cell('', tdc), cell('', tdc), cell('', tdc), cell('', td), cell('', tdc), cell('не запланирован', td)]); return; }
        vs.forEach(function (v) {
          var moved = v.status === 'moved' ? state.vacations.filter(function (n) { return n.replacesId === v.id && ACTIVE[n.status]; })[0] : null;
          var fact = v.status === 'approved' && v.start <= todayISO() ? fmtDate(v.start) : '';
          R([cell(S.unitName, td), cell(e.position, td), cell(e.name, td), cell(e.tabNo, tdc), cell(v.days, tdc), cell(fmtDate(v.start), tdc), cell(fact, tdc),
            cell(moved ? 'заявление сотрудника' : '', td), cell(moved ? fmtDate(moved.start) : '', tdc), cell(v.status === 'moved' ? 'перенесён' : (v.comment || ''), td)]);
        });
      });
      R([]);
      R([cell('Руководитель кадровой службы', st), '', cell('______________', st), '', cell('______________', st), '', cell(S.hrName || '______________', st)]);
      R([cell('', st), '', cell('(должность)', { font: { name: 'Arial', sz: 7, italic: true } }), '', cell('(подпись)', { font: { name: 'Arial', sz: 7, italic: true } }), '', cell('(расшифровка подписи)', { font: { name: 'Arial', sz: 7, italic: true } })]);
      var ws = X.utils.aoa_to_sheet(rows);
      ws['!merges'] = merges;
      ws['!cols'] = [26, 28, 30, 10, 11, 13, 13, 18, 16, 20].map(function (w) { return { wch: w }; });
      ws['!rows'] = []; ws['!rows'][h1] = { hpt: 24 }; ws['!rows'][h1 + 1] = { hpt: 48 };
      ws['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1 };
      var wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, 'Т-7 ' + y);
      X.writeFile(wb, 'График отпусков Т-7 ' + y + '.xlsx');
    }).catch(function (e) { toast(e.message, 'err'); });
  }
  function exportSummary() {
    var y = ui.year;
    loadXLSX().then(function (X) {
      var hs = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1C5CAB' } }, alignment: { vertical: 'center', wrapText: true }, border: BORDER };
      var ts = { border: BORDER, alignment: { vertical: 'top', wrapText: true } };
      var head = ['Сотрудник', 'Должность', 'Начало', 'Окончание', 'Дней', 'Статус', 'Учётный год', 'Конфликты', 'Комментарий сотрудника', 'Комментарий руководителя', 'Изменено'];
      var rows = [head.map(function (h) { return cell(h, hs); })];
      state.vacations.filter(function (v) { return vacYear(v) === y; }).sort(function (a, b) { return a.start < b.start ? -1 : 1; }).forEach(function (v) {
        var e = emp(v.employeeId), cf = ACTIVE[v.status] ? conflictsOf(v).map(function (c) { return c.text; }).join('; ') : '';
        rows.push([e.name, e.position, fmtDate(v.start), fmtDate(v.end), v.days, STATUS[v.status], vacYear(v), cf, v.comment, v.managerComment, v.updatedAt].map(function (x) { return cell(x, ts); }));
      });
      var ws1 = X.utils.aoa_to_sheet(rows);
      ws1['!cols'] = [32, 28, 11, 11, 6, 16, 8, 40, 30, 30, 16].map(function (w) { return { wch: w }; });
      ws1['!autofilter'] = { ref: 'A1:K' + rows.length };
      var head2 = ['Сотрудник', 'Должность', 'Дней в год', 'Перенос', 'Положено', 'Использовано', 'Согласовано', 'На согласовании', 'Осталось распланировать'];
      var rows2 = [head2.map(function (h) { return cell(h, hs); })];
      state.employees.forEach(function (e) {
        var b = balanceOf(state, e.id, y);
        rows2.push([e.name, e.position, e.daysPerYear, b.carry, b.entitled, b.used, b.approved, b.proposed, b.free].map(function (x) { return cell(x, ts); }));
      });
      var ws2 = X.utils.aoa_to_sheet(rows2);
      ws2['!cols'] = [32, 28, 10, 9, 10, 12, 12, 14, 14].map(function (w) { return { wch: w }; });
      var wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws1, 'Периоды ' + y);
      X.utils.book_append_sheet(wb, ws2, 'Остатки ' + y);
      X.writeFile(wb, 'Отпуска ' + y + ' — сводка.xlsx');
    }).catch(function (e) { toast(e.message, 'err'); });
  }
  function download(name, text, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------- Уведомления, подсказки ---------- */

  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'err' ? 6000 : 3000);
  }
  function busy(btn, on) {
    if (!btn) return;
    if (on) { btn._txt = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + btn._txt; }
    else { btn.disabled = false; if (btn._txt) btn.innerHTML = btn._txt; }
  }
  var tipEl = null;
  function showTip(html, ev) {
    tipEl = tipEl || $('#tooltip');
    tipEl.innerHTML = html; tipEl.classList.remove('hidden');
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - 14;
    tipEl.style.left = Math.max(4, x) + 'px'; tipEl.style.top = Math.max(4, y) + 'px';
  }
  function hideTip() { var t = tipEl || $('#tooltip'); if (t) t.classList.add('hidden'); }
  document.addEventListener('mousemove', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-tip]');
    if (t) showTip(t.getAttribute('data-tip'), ev);
    else if (!(ev.target.closest && ev.target.closest('#g-cov'))) hideTip();
  });

  /* ---------- Действия ---------- */

  function renderAll() {
    if (modals.length && ed && $('#ed-picker', modals[modals.length - 1])) updateEditor(true);
    var t = $('.tabs');
    if (t) {
      t.innerHTML = tabsFor().map(function (x) { return '<button class="tab' + (x[0] === currentTab() ? ' active' : '') + '" data-act="tab" data-tab="' + x[0] + '">' + x[1] + '</button>'; }).join('');
      renderMain();
    } else render();
  }
  function doOp(action, payload, okMsg, btn) {
    busy(btn, true);
    return Store.op(action, payload).then(function (r) { busy(btn, false); if (okMsg) toast(okMsg, 'ok'); renderAll(); return r; })
      .catch(function (e) { busy(btn, false); toast(e.message, 'err'); throw e; });
  }
  function closeAllModals() { while (modals.length) closeModal(); }

  var ACT = {
    close: function () { closeModal(); },
    tab: function (el) { ui.tab = el.getAttribute('data-tab'); saveUi(); closeAllModals(); render(); },
    year: function (el) { ui.year = +el.value; saveUi(); renderMain(); },
    zoom: function (el) { ui.zoom = el.getAttribute('data-z'); saveUi(); renderMain(); },
    'toggle-inactive': function (el) { ui.showInactive = el.checked; saveUi(); renderMain(); },
    'cal-mode': function (el) { ui.calMode = el.getAttribute('data-m'); saveUi(); renderMain(); },
    'cal-shift': function (el) {
      var k = +el.getAttribute('data-k'), y = +ui.calMonth.slice(0, 4), m = +ui.calMonth.slice(5, 7) - 1 + k;
      y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
      ui.calMonth = y + '-' + pad2(m + 1); saveUi(); renderMain();
    },
    'cal-today': function () { ui.calMonth = todayISO().slice(0, 7); saveUi(); renderMain(); },
    'cal-day': function (el, ev) {
      if (ev.target.closest('.chip')) return;
      var d = el.getAttribute('data-d');
      openEditor({ start: d, end: endForDays(d, 14), employeeId: meId() });
    },
    'ycal-day': function (el) { ui.calMode = 'month'; ui.calMonth = el.getAttribute('data-d').slice(0, 7); saveUi(); renderMain(); },
    theme: function () {
      var t = LS.get(K.theme, 'auto'), n = { auto: 'light', light: 'dark', dark: 'auto' }[t];
      LS.set(K.theme, n); applyTheme(); render();
    },
    logout: function () { session = null; LS.del(K.session); closeAllModals(); render(); },
    retry: function () { boot(); },
    'set-api': function () {
      var u = prompt('Адрес веб-приложения Google Apps Script (оканчивается на /exec).\nОставьте пустым для локального режима.', apiUrl());
      if (u === null) return;
      LS.set(K.api, u.trim()); state = null; render(); boot();
    },
    'login-role': function (el) { loginRole = el.getAttribute('data-role'); render(); },
    'lg-emp': function () {},
    login: function (el) {
      var auth;
      if (loginRole === 'manager') auth = { role: 'manager', secret: $('#lg-pass').value };
      else {
        var id = $('#lg-emp').value;
        if (!id) return toast('Выберите себя в списке', 'err');
        auth = { role: 'employee', employeeId: id, secret: $('#lg-pin') ? $('#lg-pin').value : '' };
      }
      busy(el, true);
      Store.op('login', null, auth).then(function () {
        session = auth; LS.set(K.session, session);
        // сотруднику сразу показываем год планирования
        if (auth.role === 'employee' && +state.settings.planYear >= +todayISO().slice(0, 4)) ui.year = +state.settings.planYear;
        ui.tab = ''; saveUi(); render();
      }).catch(function (e) { busy(el, false); toast(e.message, 'err'); });
    },
    propose: function (el) { openEditor({ employeeId: el.getAttribute('data-emp') || meId() }); },
    'open-vac': function (el, ev) { ev.preventDefault(); ev.stopPropagation(); openVacation(el.getAttribute('data-id')); },
    'open-emp-plan': function (el) {
      var id = el.getAttribute('data-id');
      if (!isMgr()) { if (id === meId()) { ui.tab = 'mine'; render(); } return; }
      var m = openModal(modalHead('План отпусков') + '<div class="modal-b" id="plan-box"></div><div class="modal-f"><button class="btn" data-act="close">Закрыть</button></div>', { wide: true });
      $('#plan-box', m).innerHTML = planView(id, false).replace('<div class="page-head">', '<div class="page-head" style="margin-top:0">');
    },
    'edit-vac': function (el) { var id = el.getAttribute('data-id'); closeAllModals(); openEditor({ vacId: id, mode: 'edit' }); },
    'move-vac': function (el) { var id = el.getAttribute('data-id'); closeAllModals(); openEditor({ vacId: id, mode: 'move' }); },
    approve: function (el) {
      var id = el.getAttribute('data-id'), v = vacById(state, id);
      var cf = v ? conflictsOf(v) : [];
      if (cf.length && !confirm('У заявки есть конфликты:\n• ' + cf.map(function (c) { return c.text; }).join('\n• ') + '\n\nВсё равно согласовать?')) return;
      doOp('approve', { id: id }, 'Отпуск согласован', el).then(closeAllModals, function () {});
    },
    reject: function (el) {
      var id = el.getAttribute('data-id');
      askText('Отклонить заявку', 'Причина (увидит сотрудник)', true).then(function (c) { doOp('reject', { id: id, comment: c }, 'Заявка отклонена').then(closeAllModals, function () {}); });
    },
    withdraw: function (el) {
      if (!confirm('Отозвать заявку?')) return;
      doOp('withdraw', { id: el.getAttribute('data-id') }, 'Заявка отозвана', el).then(closeAllModals, function () {});
    },
    'cancel-vac': function (el) {
      var id = el.getAttribute('data-id');
      askText('Отменить согласованный отпуск', 'Причина', false).then(function (c) { doOp('withdraw', { id: id, comment: c }, 'Отпуск отменён').then(closeAllModals, function () {}); });
    },
    'delete-vac': function (el) {
      if (!confirm('Удалить период безвозвратно? Обычно лучше «Отменить» — тогда останется история.')) return;
      doOp('deleteVacation', { id: el.getAttribute('data-id') }, 'Удалено', el).then(closeAllModals, function () {});
    },
    'edit-emp': function (el) { openEmployee(el.getAttribute('data-id') || ''); },
    'delete-emp': function (el) {
      if (!confirm('Удалить сотрудника вместе со всеми его отпусками?')) return;
      doOp('deleteEmployee', { id: el.getAttribute('data-id') }, 'Сотрудник удалён', el).then(closeAllModals, function () {});
    },
    filter: function (el) { ui.f[el.getAttribute('data-k')] = el.value; saveUi(); renderMain(); },
    'pk-shift': function (el) {
      var k = +el.getAttribute('data-k'), y = +ed.pickMonth.slice(0, 4), m = +ed.pickMonth.slice(5, 7) - 1 + k;
      y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
      ed.pickMonth = y + '-' + pad2(m + 1); updateEditor(true);
    },
    'pk-day': function (el) { pickDay(el.getAttribute('data-d')); },
    'find-windows': function () { findWin(); },
    'use-window': function (el) { ed.start = el.getAttribute('data-s'); ed.end = el.getAttribute('data-e'); ed.stage = 0; ed.pickMonth = ed.start.slice(0, 7); ed.sync(); },
    'export-t7': function () { exportT7(); },
    'export-summary': function () { exportSummary(); },
    'export-json': function () {
      var s = clone(state); delete s.settings.defaultPassword;
      download('otpusk-backup-' + todayISO() + '.json', JSON.stringify(s, null, 1));
    },
    'import-old': function (el) {
      if (!confirm('Заменить текущие данные данными из прежней версии программы (этот браузер)?')) return;
      var st = convertOld(oldData());
      doOp('importState', { state: st }, 'Данные перенесены', el);
    },
    'reset-local': function () {
      if (!confirm('Сбросить все локальные данные к начальным?')) return;
      LS.del(K.state); session = null; LS.del(K.session); boot();
    },
    'bl-add': function () { $('#bl-list').insertAdjacentHTML('beforeend', blRow()); },
    'bl-del': function (el) { el.closest('.bl-row').remove(); },
    'save-settings': function (el) {
      var s = {};
      $$('[data-set]').forEach(function (i) { s[i.getAttribute('data-set')] = i.value; });
      if (!s.password) delete s.password;
      var bl = $$('.bl-row').map(function (r) {
        return { start: $('[data-bl=start]', r).value, end: $('[data-bl=end]', r).value, reason: $('[data-bl=reason]', r).value };
      }).filter(function (b) { return b.start && b.end; });
      doOp('saveSettings', { settings: s, blackouts: bl }, 'Настройки сохранены', el).then(function () {
        if (s.password) { session.secret = s.password; LS.set(K.session, session); }
      }, function () {});
    },
    'api-save': function () {
      var u = $('#api-url').value.trim();
      if (u && !/^https:\/\/script\.google\.com\/.+\/exec$/.test(u) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u) && !confirm('Адрес не похож на адрес веб-приложения Apps Script (…/exec). Продолжить?')) return;
      LS.set(K.api, u); session = null; LS.del(K.session); state = null; render(); boot();
    },
    'api-clear': function () { LS.set(K.api, ''); state = null; session = null; LS.del(K.session); render(); boot(); }
  };
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var a = el.getAttribute('data-act');
    if (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type === 'checkbox')) return;
    if (el.tagName === 'A') ev.preventDefault();
    if (ACT[a]) ACT[a](el, ev);
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.id === 'import-file' && el.files[0]) {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var st = JSON.parse(fr.result);
          if (!confirm('Заменить всех сотрудников и отпуска данными из файла?')) return;
          doOp('importState', { state: st }, 'Данные загружены');
        } catch (e) { toast('Не удалось прочитать файл: ' + e.message, 'err'); }
      };
      fr.readAsText(el.files[0]);
      return;
    }
    if (el.id === 'lg-emp') {
      var e = empById(state, el.value), w = $('#lg-pin-wrap');
      if (w) w.classList.toggle('hidden', !(e && e.hasPin));
      return;
    }
    var a = el.getAttribute('data-act');
    if (a && ACT[a] && (el.tagName === 'SELECT' || el.type === 'checkbox')) ACT[a](el, ev);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && modals.length) closeModal();
    if (ev.key === 'Enter' && !session && (ev.target.id === 'lg-pass' || ev.target.id === 'lg-pin')) ACT.login($('[data-act=login]'));
  });
  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { if (session && state && currentTab() === 'gantt') drawGantt(); }, 150);
  });

  function applyTheme() {
    var t = LS.get(K.theme, 'auto');
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  function boot() {
    render();
    Store.load().then(render, render);
  }
  applyTheme();
  boot();
  // периодическое обновление из таблицы
  setInterval(function () {
    if (conn.mode !== 'remote' || document.hidden || !session || modals.length) return;
    Store.refresh().then(function (changed) { if (changed) renderAll(); });
  }, Math.max(10, +CFG.pollSeconds || 30) * 1000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && conn.mode === 'remote' && session && !modals.length) Store.refresh().then(function (c) { if (c) renderAll(); });
  });

  window.__otpusk = { get state() { return state; }, ui: ui };
})();
