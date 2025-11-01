// script.js — улучшенная версия Code GPT 👾
// Система учета отпусков с сохранением и анимацией UI

// ==========================
// 1. ИНИЦИАЛИЗАЦИЯ ДАННЫХ
// ==========================

let employees = [];
const storageKey = "vacation_employees";

document.addEventListener("DOMContentLoaded", () => {
  const savedData = localStorage.getItem(storageKey);
  if (savedData) {
    employees = JSON.parse(savedData);
  } else {
    const jsonData = document.getElementById("employee-data").textContent;
    employees = JSON.parse(jsonData);
    saveToStorage();
  }

  initAnimatedNavigation();
  renderEmployeeTable();
  populateMonthSelector();
  setupEventListeners();
});

// Сохранение данных
function saveToStorage() {
  localStorage.setItem(storageKey, JSON.stringify(employees));
}

// ==========================
// 2. ТАБЛИЦА СОТРУДНИКОВ
// ==========================

function renderEmployeeTable() {
  const tbody = document.querySelector("#employees-table tbody");
  tbody.innerHTML = "";

  employees.forEach((emp, index) => {
    const usedDays = emp.vacations.reduce((sum, v) => sum + v.days, 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><a href="#" class="employee-link" data-index="${index}">${emp.name}</a></td>
      <td>${emp.position}</td>
      <td>${emp.total_days}</td>
      <td>${usedDays}</td>
    `;
    tbody.appendChild(tr);
  });

  updateCurrentVacationBanner();
}

function updateCurrentVacationBanner() {
  const banner = document.getElementById("current-vacation-banner");
  const today = new Date();
  const onVacation = employees.filter((emp) =>
    emp.vacations.some(
      (v) => new Date(v.start) <= today && today <= new Date(v.end)
    )
  );

  if (onVacation.length === 0) {
    banner.textContent = "Сегодня никто не в отпуске.";
  } else {
    banner.innerHTML = `<strong>Сейчас в отпуске:</strong> ${onVacation
      .map((e) => e.name)
      .join(", ")}`;
  }
}

// ==========================
// 3. МОДАЛЬНОЕ ОКНО СОТРУДНИКА
// ==========================

function openEmployeeDetail(index) {
  const emp = employees[index];
  document.getElementById("edit-name").value = emp.name;
  document.getElementById("edit-position").value = emp.position;
  document.getElementById("edit-total-days").value = emp.total_days;
  document.getElementById("edit-used-days").textContent = emp.vacations.reduce(
    (sum, v) => sum + v.days,
    0
  );

  renderVacationRows(emp.vacations);

  document.getElementById("save-employee").dataset.index = index;
  document.getElementById("delete-employee").dataset.index = index;

  const modal = new bootstrap.Modal(document.getElementById("employeeDetailModal"));
  modal.show();
}

function renderVacationRows(vacations) {
  const tbody = document.querySelector("#vacations-table tbody");
  tbody.innerHTML = "";
  vacations.forEach((v, i) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="date" class="form-control start" value="${v.start}" /></td>
      <td><input type="date" class="form-control end" value="${v.end}" /></td>
      <td><input type="number" class="form-control days" value="${v.days}" min="1" /></td>
      <td><button class="btn btn-danger btn-sm delete-vacation" data-index="${i}">✕</button></td>
    `;
    tbody.appendChild(row);
  });
}

// ==========================
// 4. ДОБАВЛЕНИЕ СОТРУДНИКА
// ==========================

document.getElementById("add-employee-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("input-name").value.trim();
  const position = document.getElementById("input-position").value.trim();
  const total_days = parseInt(document.getElementById("input-total-days").value, 10);

  if (!name || !position || isNaN(total_days)) return alert("Заполните все поля!");

  employees.push({ name, position, total_days, vacations: [] });
  saveToStorage();
  renderEmployeeTable();
  e.target.reset();
  bootstrap.Modal.getInstance(document.getElementById("addEmployeeModal")).hide();
});

// ==========================
// 5. УПРАВЛЕНИЕ ОТПУСКАМИ
// ==========================

document.getElementById("add-vacation-row").addEventListener("click", () => {
  const tbody = document.querySelector("#vacations-table tbody");
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="date" class="form-control start" /></td>
    <td><input type="date" class="form-control end" /></td>
    <td><input type="number" class="form-control days" min="1" /></td>
    <td><button class="btn btn-danger btn-sm delete-vacation">✕</button></td>
  `;
  tbody.appendChild(row);
});

document
  .getElementById("vacations-table")
  .addEventListener("click", (e) => {
    if (e.target.classList.contains("delete-vacation")) {
      e.target.closest("tr").remove();
    }
  });

// Сохранение сотрудника
document.getElementById("save-employee").addEventListener("click", (e) => {
  const index = parseInt(e.target.dataset.index, 10);
  const emp = employees[index];

  emp.name = document.getElementById("edit-name").value.trim();
  emp.position = document.getElementById("edit-position").value.trim();
  emp.total_days = parseInt(document.getElementById("edit-total-days").value, 10);

  const rows = document.querySelectorAll("#vacations-table tbody tr");
  emp.vacations = Array.from(rows)
    .map((r) => ({
      start: r.querySelector(".start").value,
      end: r.querySelector(".end").value,
      days: parseInt(r.querySelector(".days").value, 10),
    }))
    .filter((v) => v.start && v.end && !isNaN(v.days));

  saveToStorage();
  renderEmployeeTable();
  bootstrap.Modal.getInstance(document.getElementById("employeeDetailModal")).hide();
});

// Удаление сотрудника
document.getElementById("delete-employee").addEventListener("click", (e) => {
  const index = parseInt(e.target.dataset.index, 10);
  if (confirm("Удалить этого сотрудника?")) {
    employees.splice(index, 1);
    saveToStorage();
    renderEmployeeTable();
    bootstrap.Modal.getInstance(document.getElementById("employeeDetailModal")).hide();
  }
});

// ==========================
// 6. КАЛЕНДАРЬ
// ==========================

function populateMonthSelector() {
  const select = document.getElementById("month-select");
  const months = [
    "Январь","Февраль","Март","Апрель","Май","Июнь",
    "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"
  ];
  months.forEach((m, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = m;
    select.appendChild(opt);
  });

  select.value = new Date().getMonth();
  renderCalendar(new Date().getMonth());
}

function renderCalendar(monthIndex) {
  const year = new Date().getFullYear();
  const container = document.getElementById("calendar-container");
  const monthYear = document.getElementById("calendar-month-year");
  container.innerHTML = "";
  const date = new Date(year, monthIndex, 1);
  const firstDay = date.getDay() || 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  monthYear.textContent = `${date.toLocaleString("ru", { month: "long" })} ${year}`;
  container.innerHTML = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"]
    .map(d => `<div class='header-cell'>${d}</div>`).join("");

  for (let i = 1; i < firstDay; i++) {
    container.appendChild(document.createElement("div"));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement("div");
    cell.classList.add("cell");
    const dateStr = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayElem = document.createElement("div");
    dayElem.className = "day-number";
    dayElem.textContent = day;
    cell.appendChild(dayElem);

    employees.forEach((emp) => {
      emp.vacations.forEach((v) => {
        if (dateStr >= v.start && dateStr <= v.end) {
          const div = document.createElement("div");
          div.className = "vacation-item";
          div.textContent = emp.name;
          cell.appendChild(div);
        }
      });
    });

    container.appendChild(cell);
  }
}

document.getElementById("month-select").addEventListener("change", (e) => {
  renderCalendar(parseInt(e.target.value, 10));
});

// ==========================
// 7. ЭКСПОРТ В EXCEL
// ==========================

document.getElementById("export-excel").addEventListener("click", () => {
  let csv = "ФИО;Должность;Всего дней;Использовано\n";

  employees.forEach((emp) => {
    const used = emp.vacations.reduce((s, v) => s + v.days, 0);
    csv += `${emp.name};${emp.position};${emp.total_days};${used}\n`;
  });

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "график_отпусков.csv";
  link.click();
});

// ==========================
// 8. ПЛАВНАЯ НАВИГАЦИЯ И АНИМАЦИЯ
// ==========================

const style = document.createElement("style");
style.textContent = `
  .fade-section {
    opacity: 0;
    transition: opacity 0.5s ease-in-out;
  }
  .fade-section.active {
    opacity: 1;
  }
  .nav-link.active-glow {
    box-shadow: 0 0 10px #2d9cdb;
    border-radius: 8px;
  }
`;
document.head.appendChild(style);

function fadeSwitch(showSection, hideSection) {
  hideSection.classList.remove("active");
  hideSection.classList.add("fade-section");
  setTimeout(() => {
    hideSection.style.display = "none";
    showSection.style.display = "block";
    requestAnimationFrame(() => showSection.classList.add("active"));
  }, 300);
}

function initAnimatedNavigation() {
  const empSection = document.getElementById("employees-section");
  const calSection = document.getElementById("calendar-section");
  empSection.classList.add("fade-section", "active");
  calSection.classList.add("fade-section");

  const navEmp = document.getElementById("nav-employees");
  const navCal = document.getElementById("nav-calendar");

  navEmp.addEventListener("click", () => {
    fadeSwitch(empSection, calSection);
    navEmp.classList.add("active-glow");
    navCal.classList.remove("active-glow");
  });

  navCal.addEventListener("click", () => {
    fadeSwitch(calSection, empSection);
    navCal.classList.add("active-glow");
    navEmp.classList.remove("active-glow");
  });

  // Плавные эффекты модалок
  const modals = document.querySelectorAll(".modal");
  modals.forEach((m) => {
    m.addEventListener("show.bs.modal", () => {
      m.style.opacity = 0;
      setTimeout(() => (m.style.opacity = 1), 50);
    });
    m.addEventListener("hidden.bs.modal", () => {
      m.style.opacity = 0;
    });
  });

  // Ссылки на сотрудников
  document.querySelector("#employees-table").addEventListener("click", (e) => {
    if (e.target.classList.contains("employee-link")) {
      const index = e.target.dataset.index;
      openEmployeeDetail(index);
    }
  });
}
