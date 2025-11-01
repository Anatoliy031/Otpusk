// Client-side script for employee vacation tracking

// Global array of employee objects loaded from JSON
let employees = [];

// Fetch employee data from JSON on load
async function loadData() {
  try {
    // First attempt to load embedded data from the HTML document. This works
    // when the site is opened via file:// protocol where fetching local JSON
    // files can be blocked. The <script id="employee-data"> tag contains
    // JSON text that we parse into the employees array.
    const embedded = document.getElementById('employee-data');
    if (embedded) {
      employees = JSON.parse(embedded.textContent.trim());
    } else {
      // Fallback: fetch JSON from server (useful when served via HTTP)
      const response = await fetch('../employee_vacations.json');
      if (!response.ok) {
        throw new Error('Не удалось загрузить данные');
      }
      employees = await response.json();
    }
    renderEmployees();
    populateMonthSelect();
    // Render calendar for current month by default
    const today = new Date();
    document.getElementById('month-select').value = `${today.getFullYear()}-${
      (today.getMonth() + 1)
        .toString()
        .padStart(2, '0')
    }`;
    renderCalendar();
  } catch (err) {
    console.error(err);
  }
}

// Render employees table
function renderEmployees() {
  const tbody = document.querySelector('#employees-table tbody');
  tbody.innerHTML = '';
  employees.forEach((emp, index) => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => showEmployeeDetail(index));
    const usedDays = emp.vacations.reduce((sum, v) => {
      return sum + (v.days || 0);
    }, 0);
    tr.innerHTML = `
      <td>${emp.name}</td>
      <td>${emp.position || ''}</td>
      <td>${emp.total_days ?? ''}</td>
      <td>${usedDays}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Show employee detail modal
function showEmployeeDetail(index) {
  const emp = employees[index];
  document.getElementById('detail-name').textContent = emp.name;
  document.getElementById('detail-position').textContent = emp.position || '';
  document.getElementById('detail-total').textContent = emp.total_days ?? '';
  const list = document.getElementById('detail-vacations');
  list.innerHTML = '';
  if (emp.vacations && emp.vacations.length > 0) {
    emp.vacations.forEach((v) => {
      const li = document.createElement('li');
      li.className = 'list-group-item bg-dark text-light';
      li.textContent = `${formatDate(v.start)} — ${formatDate(v.end)} (${v.days || 0} дн.)`;
      list.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.className = 'list-group-item bg-dark text-light';
    li.textContent = 'Нет запланированных отпусков';
    list.appendChild(li);
  }
  const modal = new bootstrap.Modal(document.getElementById('employeeDetailModal'));
  modal.show();
}

// Format date from ISO string to DD.MM.YYYY
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${day}.${month}.${d.getFullYear()}`;
}

// Populate month select options (2025 year from sample plus current year)
function populateMonthSelect() {
  const select = document.getElementById('month-select');
  select.innerHTML = '';
  // We'll provide months for the current year and next year
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];
  years.forEach((year) => {
    for (let m = 0; m < 12; m++) {
      const value = `${year}-${(m + 1).toString().padStart(2, '0')}`;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${monthNames[m]} ${year}`;
      select.appendChild(option);
    }
  });
  select.addEventListener('change', renderCalendar);
}

// Month names in Russian
const monthNames = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

// Render calendar for selected month
function renderCalendar() {
  const container = document.getElementById('calendar-container');
  container.innerHTML = '';
  const selectValue = document.getElementById('month-select').value;
  const [yearStr, monthStr] = selectValue.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const firstDay = new Date(year, month, 1);
  const startDayOfWeek = firstDay.getDay() || 7; // Monday as first? Actually Sunday=0; but we want Monday as first? We'll start Monday
  // Determine days in month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Weekday headers
  const weekdayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  weekdayNames.forEach((name) => {
    const header = document.createElement('div');
    header.className = 'header-cell';
    header.textContent = name;
    container.appendChild(header);
  });
  // Fill in blank cells before first day
  const blankBefore = ((startDayOfWeek + 6) % 7); // convert Sunday index to Monday-based
  for (let i = 0; i < blankBefore; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    container.appendChild(cell);
  }
  // Fill in days
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = day;
    cell.appendChild(dayNumber);
    // Determine date string
    const currentDate = new Date(year, month, day);
    const isoDate = currentDate.toISOString().split('T')[0];
    // Add vacation items that include this day
    employees.forEach((emp) => {
      emp.vacations.forEach((v) => {
        if (!v.start || !v.end) return;
        const start = new Date(v.start);
        const end = new Date(v.end);
        // inclusive
        if (currentDate >= start && currentDate <= end) {
          const span = document.createElement('span');
          span.className = 'vacation-item vacation-label';
          // Use initials for better fit
          const initials = emp.name
            .split(' ')
            .map((part) => part[0])
            .join('');
          span.textContent = initials;
          span.title = emp.name;
          cell.appendChild(span);
        }
      });
    });
    container.appendChild(cell);
  }
  // Fill remaining cells to complete grid (if needed)
  const totalCells = weekdayNames.length + blankBefore + daysInMonth;
  const remainder = totalCells % 7;
  if (remainder !== 0) {
    const cellsToAdd = 7 - remainder;
    for (let i = 0; i < cellsToAdd; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      container.appendChild(cell);
    }
  }
}

// Navigation: switch between sections
function setupNavigation() {
  const navEmployees = document.getElementById('nav-employees');
  const navCalendar = document.getElementById('nav-calendar');
  navEmployees.addEventListener('click', (e) => {
    e.preventDefault();
    showSection('employees');
  });
  navCalendar.addEventListener('click', (e) => {
    e.preventDefault();
    showSection('calendar');
  });
}

// Show either employees or calendar section
function showSection(section) {
  const empSec = document.getElementById('employees-section');
  const calSec = document.getElementById('calendar-section');
  if (section === 'employees') {
    empSec.style.display = '';
    calSec.style.display = 'none';
    document.getElementById('nav-employees').classList.add('active');
    document.getElementById('nav-calendar').classList.remove('active');
  } else {
    empSec.style.display = 'none';
    calSec.style.display = '';
    document.getElementById('nav-employees').classList.remove('active');
    document.getElementById('nav-calendar').classList.add('active');
    // Re-render calendar in case new vacations were added
    renderCalendar();
  }
}

// Add new employee via modal form
function setupAddEmployeeForm() {
  const form = document.getElementById('add-employee-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('input-name').value.trim();
    const position = document.getElementById('input-position').value.trim();
    const total = parseInt(document.getElementById('input-total-days').value, 10);
    employees.push({
      name,
      position,
      total_days: total,
      vacations: [],
    });
    renderEmployees();
    // Reset form
    form.reset();
    // Hide modal
    const modalEl = document.getElementById('addEmployeeModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
  });
}

// Initialize everything after DOM loaded
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupAddEmployeeForm();
  loadData();
});