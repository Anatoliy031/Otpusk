// Client-side script for employee vacation tracking

// Global array of employee objects loaded from JSON
let employees = [];

// Keep track of the currently edited employee index
let currentEmployeeIndex = null;

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
  const today = new Date();
  employees.forEach((emp, index) => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => showEmployeeDetail(index));
    const usedDays = emp.vacations.reduce((sum, v) => {
      return sum + (v.days || 0);
    }, 0);
    // Highlight employee if currently on vacation
    const onVacation = emp.vacations.some((v) => {
      if (!v.start || !v.end) return false;
      const start = new Date(v.start);
      const end = new Date(v.end);
      return today >= start && today <= end;
    });
    if (onVacation) {
      tr.classList.add('table-primary');
    }
    tr.innerHTML = `
      <td>${emp.name}</td>
      <td>${emp.position || ''}</td>
      <td>${emp.total_days ?? ''}</td>
      <td>${usedDays}</td>
    `;
    tbody.appendChild(tr);
  });
  // Update banner showing who is currently on vacation
  updateCurrentVacationBanner();
}

// Show employee detail modal
function showEmployeeDetail(index) {
  // Open detail modal in edit mode
  currentEmployeeIndex = index;
  const emp = employees[index];
  // Populate basic fields
  document.getElementById('edit-name').value = emp.name;
  document.getElementById('edit-position').value = emp.position || '';
  document.getElementById('edit-total-days').value = emp.total_days ?? '';
  // Compute used days and display
  const usedDays = emp.vacations.reduce((sum, v) => sum + (v.days || 0), 0);
  document.getElementById('edit-used-days').textContent = usedDays;
  // Populate vacation rows
  const vacTbody = document.querySelector('#vacations-table tbody');
  vacTbody.innerHTML = '';
  if (emp.vacations && emp.vacations.length > 0) {
    emp.vacations.forEach((v) => {
      addVacationRow(v.start, v.end, v.days);
    });
  }
  // Show modal
  const modalEl = document.getElementById('employeeDetailModal');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
}

// Create a new vacation row in the edit table
function addVacationRow(start = '', end = '', days = 0) {
  const tbody = document.querySelector('#vacations-table tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="date" class="form-control form-control-sm start-date" value="${start}"></td>
    <td><input type="date" class="form-control form-control-sm end-date" value="${end}"></td>
    <td class="vac-days">${days || 0}</td>
    <td><button type="button" class="btn btn-sm btn-danger delete-vac">✕</button></td>
  `;
  // Update days when dates change
  const startInput = tr.querySelector('.start-date');
  const endInput = tr.querySelector('.end-date');
  const updateFn = () => {
    updateRowDays(tr);
    recalculateUsedDays();
  };
  startInput.addEventListener('change', updateFn);
  endInput.addEventListener('change', updateFn);
  // Delete row
  tr.querySelector('.delete-vac').addEventListener('click', () => {
    tr.remove();
    recalculateUsedDays();
  });
  tbody.appendChild(tr);
  // Initial calculation
  updateRowDays(tr);
  recalculateUsedDays();
}

// Compute days for a given row (inclusive of start and end)
function updateRowDays(tr) {
  const startVal = tr.querySelector('.start-date').value;
  const endVal = tr.querySelector('.end-date').value;
  const cell = tr.querySelector('.vac-days');
  if (startVal && endVal) {
    const s = new Date(startVal);
    const e = new Date(endVal);
    if (!isNaN(s) && !isNaN(e) && e >= s) {
      const diff = e.getTime() - s.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
      cell.textContent = days;
      return;
    }
  }
  cell.textContent = 0;
}

// Recalculate and update used vacation days display
function recalculateUsedDays() {
  const rows = document.querySelectorAll('#vacations-table tbody tr');
  let total = 0;
  rows.forEach((row) => {
    const days = parseInt(row.querySelector('.vac-days').textContent, 10);
    total += isNaN(days) ? 0 : days;
  });
  document.getElementById('edit-used-days').textContent = total;
}

// Update the banner showing employees currently on vacation
function updateCurrentVacationBanner() {
  const banner = document.getElementById('current-vacation-banner');
  if (!banner) return;
  const today = new Date();
  const onVacation = employees
    .filter((emp) =>
      emp.vacations.some((v) => {
        if (!v.start || !v.end) return false;
        const s = new Date(v.start);
        const e = new Date(v.end);
        return today >= s && today <= e;
      })
    )
    .map((emp) => emp.name);
  if (onVacation.length > 0) {
    banner.innerHTML = `<div class="alert alert-info">Сегодня в отпуске: ${onVacation.join(', ')}</div>`;
  } else {
    banner.innerHTML = '';
  }
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

// Set up event listeners for editing employee modal
function setupEditEmployeeModal() {
  // Add new vacation row when clicking the button
  const addVacBtn = document.getElementById('add-vacation-row');
  if (addVacBtn) {
    addVacBtn.addEventListener('click', () => {
      addVacationRow();
    });
  }
  // Save employee changes
  const saveBtn = document.getElementById('save-employee');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (currentEmployeeIndex === null || currentEmployeeIndex === undefined) return;
      const emp = employees[currentEmployeeIndex];
      // Save basic fields
      emp.name = document.getElementById('edit-name').value.trim();
      emp.position = document.getElementById('edit-position').value.trim();
      const totalVal = document.getElementById('edit-total-days').value;
      emp.total_days = totalVal ? parseInt(totalVal, 10) : 0;
      // Save vacations
      const rows = document.querySelectorAll('#vacations-table tbody tr');
      const newVacations = [];
      rows.forEach((row) => {
        const start = row.querySelector('.start-date').value;
        const end = row.querySelector('.end-date').value;
        const days = parseInt(row.querySelector('.vac-days').textContent, 10) || 0;
        if (start && end) {
          newVacations.push({ start, end, days });
        }
      });
      emp.vacations = newVacations;
      // Re-render
      renderEmployees();
      renderCalendar();
      // Hide modal
      const modalEl = document.getElementById('employeeDetailModal');
      const modalInstance = bootstrap.Modal.getInstance(modalEl);
      if (modalInstance) modalInstance.hide();
    });
  }
  // Delete employee
  const delBtn = document.getElementById('delete-employee');
  if (delBtn) {
    delBtn.addEventListener('click', () => {
      if (currentEmployeeIndex === null || currentEmployeeIndex === undefined) return;
      const confirmDelete = confirm('Вы уверены, что хотите удалить сотрудника?');
      if (!confirmDelete) return;
      employees.splice(currentEmployeeIndex, 1);
      currentEmployeeIndex = null;
      renderEmployees();
      renderCalendar();
      // Hide modal
      const modalEl = document.getElementById('employeeDetailModal');
      const modalInstance = bootstrap.Modal.getInstance(modalEl);
      if (modalInstance) modalInstance.hide();
    });
  }
}

// Initialize everything after DOM loaded
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupAddEmployeeForm();
  setupEditEmployeeModal();
  loadData();
});