// script.js — Code GPT 👾 Финальная версия с цветами сотрудников
// Полный годовой календарь + цвета сотрудников + Chart.js + localStorage

let employees = [];
const storageKey = "vacation_employees";
let vacationChart = null;

// ==========================
// 1. ИНИЦИАЛИЗАЦИЯ
// ==========================
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
  renderFullYearCalendar();
});

// ==========================
// 2. ХРАНЕНИЕ
// ==========================
function saveToStorage() {
  localStorage.setItem(storageKey, JSON.stringify(employees));
}

function resetStorage() {
  if (confirm("Очистить все данные?")) {
    localStorage.removeItem(storageKey);
    employees = [];
    renderEmployeeTable();
    renderFullYearCalendar();
    renderVacationChart();
  }
}

document.getElementById("reset-data").addEventListener("click", resetStorage);

// ==========================
// 3. СЛУЧАЙНЫЙ ЦВЕТ ДЛЯ СОТРУДНИКА
// ==========================
function randomColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 80%, 50%)`;
}

// ==========================
// 4. ТАБЛИЦА СОТРУДНИКОВ
// ==========================
function renderEmployeeTable() {
  const tbody = document.querySelector("#employees-table tbody");
  tbody.innerHTML = "";

  employees.forEach((emp, index) => {
    const usedDays = emp.vacations.reduce((sum, v) => sum + v.days, 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><a href="#" class="employee-link" data-index="${index}" style="color:${emp.color || '#2d9cdb'}">${emp.name}</a></td>
      <td>${emp.position}</td>
      <td>${emp.total_days}</td>
      <td>${usedDays}</td>
    `;
    tbody.appendChild(tr);
  });

  updateCurrentVacationBanner();
  renderVacationChart();
}

function updateCurrentVacationBanner() {
  const banner = document.getElementById("current-vacation-banner");
  const today = new Date();
  const onVacation = employees.filter((emp) =>
    emp.vacations.some(
      (v) => new Date(v.start) <= today && today <= new Date(v.end)
    )
  );

  banner.innerHTML =
    onVacation.length === 0
      ? "Сегодня никто не в отпуске."
      : `<strong>Сейчас в отпуске:</strong> ${onVacation
          .map((e) => `<span style="color:${e.color}">${e.name}</span>`)
          .join(", ")}`;
}

// ==========================
// 5. ГРАФИК (Chart.js)
// ==========================
function renderVacationChart() {
  const ctx = document.getElementById("vacationChart");
  if (!ctx) return;

  const names = employees.map((e) => e.name);
  const used = employees.map((e) =>
    e.vacations.reduce((sum, v) => sum + v.days, 0)
  );
  const total = employees.map((e) => e.total_days);

  if (vacationChart) vacationChart.destroy();

  vacationChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: names,
      datasets: [
        {
          label: "Использовано",
          data: used,
          backgroundColor: employees.map((e) => e.color || "#2d9cdb"),
        },
        {
          label: "Всего дней",
          data: total,
          backgroundColor: "rgba(255,255,255,0.3)",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top", labels: { color: "#fff" } },
      },
      scales: {
        x: { ticks: { color: "#fff" } },
        y: { ticks: { color: "#fff" } },
      },
    },
  });
}

// ==========================
// 6. ДОБАВЛЕНИЕ СОТРУДНИКА
// ==========================
document.getElementById("add-employee-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("input-name").value.trim();
  const position = document.getElementById("input-position").value.trim();
  const total_days = parseInt(document.getElementById("input-total-days").value, 10);

  if (!name || !position || isNaN(total_days)) return alert("Заполните все поля!");

  employees.push({ name, position, total_days, vacations: [], color: randomColor() });
  saveToStorage();
  renderEmployeeTable();
  renderFullYearCalendar();
  e.target.reset();
  bootstrap.Modal.getInstance(document.getElementById("addEmployeeModal")).hide();
});

// ==========================
// 7. РЕДАКТИРОВАНИЕ СОТРУДНИКА
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
  new bootstrap.Modal(document.getElementById("employeeDetailModal")).show();
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
  renderFullYearCalendar();
  bootstrap.Modal.getInstance(document.getElementById("employeeDetailModal")).hide();
});

document.getElementById("delete-employee").addEventListener("click", (e) => {
  const index = parseInt(e.target.dataset.index, 10);
  if (confirm("Удалить этого сотрудника?")) {
    employees.splice(index, 1);
    saveToStorage();
    renderEmployeeTable();
    renderFullYearCalendar();
    bootstrap.Modal.getInstance(document.getElementById("employeeDetailModal")).hide();
  }
});

// ==========================
// 8. ГОДОВОЙ КАЛЕНДАРЬ С ЦВЕТАМИ
// ==========================
function renderFullYearCalendar() {
  const container = document.getElementById("calendar-container");
  const year = new Date().getFullYear();
  container.innerHTML = "";

  const months = [
    "Январь","Февраль","Март","Апрель","Май","Июнь",
    "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"
  ];

  months.forEach((monthName, monthIndex) => {
    const monthBox = document.createElement("div");
    monthBox.classList.add("mb-5");

    const monthTitle = document.createElement("h5");
    monthTitle.classList.add("text-center", "text-info", "mb-2");
    monthTitle.textContent = `${monthName} ${year}`;
    monthBox.appendChild(monthTitle);

    const grid = document.createElement("div");
    grid.classList.add("calendar-grid");

    ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].forEach((d) => {
      const h = document.createElement("div");
      h.classList.add("header-cell");
      h.textContent = d;
      grid.appendChild(h);
    });

    const date = new Date(year, monthIndex, 1);
    const firstDay = date.getDay() || 7;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

    for (let i = 1; i < firstDay; i++) {
      const empty = document.createElement("div");
      empty.classList.add("cell");
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      const dateStr = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      const dayNum = document.createElement("div");
      dayNum.classList.add("day-number");
      dayNum.textContent = day;
      cell.appendChild(dayNum);

      employees.forEach((emp) => {
        emp.vacations.forEach((v) => {
          if (dateStr >= v.start && dateStr <= v.end) {
            const tag = document.createElement("div");
            tag.classList.add("vacation-item");
            tag.textContent = emp.name;
            tag.style.backgroundColor = emp.color || "#2d9cdb";
            cell.appendChild(tag);
          }
        });
      });

      grid.appendChild(cell);
    }

    monthBox.appendChild(grid);
    container.appendChild(monthBox);
  });
}

// ==========================
// 9. ЭКСПОРТ В CSV
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
// 10. НАВИГАЦИЯ И АНИМАЦИЯ
// ==========================
const style = document.createElement("style");
style.textContent = `
  .fade-section { opacity: 0; transition: opacity 0.5s ease-in-out; }
  .fade-section.active { opacity: 1; }
  .nav-link.active-glow {
    box-shadow: 0 0 10px #2d9cdb;
    border-radius: 8px;
  }
`;
document.head.appendChild(style);

function fadeSwitch(showSection, hideSection) {
  hideSection.classList.remove("active");
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

  document.querySelector("#employees-table").addEventListener("click", (e) => {
    if (e.target.classList.contains("employee-link")) openEmployeeDetail(e.target.dataset.index);
  });
}
