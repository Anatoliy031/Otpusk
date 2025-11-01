// VacationPlanner 2026 👾 — Финальная версия (светлая тема + импорт Excel)
// Автор: Code GPT

let employees = [];
let vacationChart = null;
const storageKey = "vacationPlanner2026";

// ===============================
// 1. ИНИЦИАЛИЗАЦИЯ
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    employees = JSON.parse(saved);
  } else {
    employees = getDemoData();
    saveToStorage();
  }

  renderEmployeeTable();
  renderVacationChart();
  renderFullYearCalendar();

  initFileImport();
  initButtons();
});

// ===============================
// 2. ДЕМО-ДАННЫЕ (на случай отсутствия Excel)
// ===============================
function getDemoData() {
  return [
    {
      name: "Иванов Иван Иванович",
      position: "Инженер",
      total_days: 28,
      vacations: [{ start: "2026-06-10", end: "2026-06-30", days: 21 }],
      color: getRandomColor(),
    },
    {
      name: "Петров Петр Петрович",
      position: "Менеджер отдела продаж",
      total_days: 28,
      vacations: [{ start: "2026-07-01", end: "2026-07-14", days: 14 }],
      color: getRandomColor(),
    },
    {
      name: "Сидорова Анна Сергеевна",
      position: "Бухгалтер",
      total_days: 28,
      vacations: [{ start: "2026-08-05", end: "2026-08-25", days: 21 }],
      color: getRandomColor(),
    },
  ];
}

// ===============================
// 3. ХРАНЕНИЕ
// ===============================
function saveToStorage() {
  localStorage.setItem(storageKey, JSON.stringify(employees));
}

function clearStorage() {
  if (confirm("Очистить все данные?")) {
    localStorage.removeItem(storageKey);
    employees = getDemoData();
    saveToStorage();
    renderEmployeeTable();
    renderVacationChart();
    renderFullYearCalendar();
  }
}

// ===============================
// 4. ГЕНЕРАЦИЯ СЛУЧАЙНЫХ ЦВЕТОВ
// ===============================
function getRandomColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 50%)`;
}

// ===============================
// 5. РЕНДЕР ТАБЛИЦЫ СОТРУДНИКОВ
// ===============================
function renderEmployeeTable() {
  const tbody = document.querySelector("#employees-table tbody");
  tbody.innerHTML = "";

  employees.forEach((emp, index) => {
    const usedDays = emp.vacations.reduce((s, v) => s + v.days, 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="color:${emp.color}">${emp.name}</td>
      <td>${emp.position}</td>
      <td>${emp.total_days}</td>
      <td>${usedDays}</td>
    `;
    tbody.appendChild(tr);
  });

  updateCurrentVacationBanner();
}

// ===============================
// 6. БАННЕР ТЕКУЩИХ ОТПУСКОВ
// ===============================
function updateCurrentVacationBanner() {
  const banner = document.getElementById("current-vacation-banner");
  const today = new Date("2026-06-15"); // фикс для теста
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

// ===============================
// 7. Chart.js ДИАГРАММА
// ===============================
function renderVacationChart() {
  const ctx = document.getElementById("vacationChart");
  if (!ctx) return;

  const labels = employees.map((e) => e.name);
  const used = employees.map((e) =>
    e.vacations.reduce((sum, v) => sum + v.days, 0)
  );
  const total = employees.map((e) => e.total_days);

  if (vacationChart) vacationChart.destroy();

  vacationChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Использовано",
          data: used,
          backgroundColor: employees.map((e) => e.color),
        },
        {
          label: "Всего дней",
          data: total,
          backgroundColor: "rgba(180,180,180,0.3)",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top" },
      },
    },
  });
}

// ===============================
// 8. ГОДОВОЙ КАЛЕНДАРЬ 2026
// ===============================
function renderFullYearCalendar() {
  const container = document.getElementById("calendar-container");
  container.innerHTML = "";
  const year = 2026;
  const months = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
  ];

  months.forEach((month, m) => {
    const box = document.createElement("div");
    box.innerHTML = `<h6 class="text-center text-primary">${month}</h6>`;
    const grid = document.createElement("div");
    grid.classList.add("calendar-grid");

    ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].forEach((d) => {
      const head = document.createElement("div");
      head.classList.add("header-cell");
      head.textContent = d;
      grid.appendChild(head);
    });

    const date = new Date(year, m, 1);
    const firstDay = (date.getDay() || 7) - 1;
    const daysInMonth = new Date(year, m + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      grid.appendChild(document.createElement("div"));
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      const dayNum = document.createElement("div");
      dayNum.classList.add("day-number");
      dayNum.textContent = day;
      cell.appendChild(dayNum);

      const dateStr = `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      employees.forEach((emp) => {
        emp.vacations.forEach((v) => {
          if (dateStr >= v.start && dateStr <= v.end) {
            const tag = document.createElement("div");
            tag.classList.add("vacation-item");
            tag.textContent = emp.name.split(" ")[0];
            tag.style.backgroundColor = emp.color;
            cell.appendChild(tag);
          }
        });
      });

      grid.appendChild(cell);
    }

    box.appendChild(grid);
    container.appendChild(box);
  });
}

// ===============================
// 9. ИМПОРТ EXCEL
// ===============================
function initFileImport() {
  const input = document.getElementById("importExcel");
  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    employees = rows
      .filter((r) => r["Фамилия Имя Отчество"] || r["ФИО"])
      .map((r) => ({
        name: r["Фамилия Имя Отчество"] || r["ФИО"],
        position: r["Должность"] || "",
        total_days: r["Дней"] || 28,
        vacations: [
          {
            start: formatDate(r["Дата начала"]),
            end: formatDate(r["Дата окончания"]),
            days: r["Дней"] || 0,
          },
        ],
        color: getRandomColor(),
      }));

    saveToStorage();
    renderEmployeeTable();
    renderVacationChart();
    renderFullYearCalendar();
    alert("Импорт завершён!");
  });
}

function formatDate(d) {
  if (!d) return "";
  if (typeof d === "string") return d.split("T")[0];
  const date = new Date(d);
  return date.toISOString().split("T")[0];
}

// ===============================
// 10. КНОПКИ: ЭКСПОРТ, СБРОС
// ===============================
function initButtons() {
  document.getElementById("export-csv").addEventListener("click", exportCSV);
  document.getElementById("reset-data").addEventListener("click", clearStorage);
}

function exportCSV() {
  let csv = "ФИО;Должность;Всего дней;Использовано\n";
  employees.forEach((emp) => {
    const used = emp.vacations.reduce((s, v) => s + v.days, 0);
    csv += `${emp.name};${emp.position};${emp.total_days};${used}\n`;
  });
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "график_отпусков_2026.csv";
  link.click();
}
