// Client-side script for employee vacation tracking

// Global array of employee objects loaded from JSON
let employees = [];

// Predefined color palette for employees. Distinct colors help differentiate
// employees on the calendar and chart. These colors were chosen for good
// contrast on a dark background.
const colorPalette = [
  '#2d9cdb', // blue
  '#f3722c', // orange
  '#90be6d', // green
  '#f9c74f', // yellow
  '#f9844a', // coral
  '#577590', // blue-grey
  '#43aa8b', // teal
  '#9a031e', // red
  '#4d908e', // sea green
];

// List of official holidays and transferred non‑working days for 2026. These
// dates are taken from the утверждённый производственный календарь for 2026,
// which defines нерабочие праздничные дни: 1–6 и 8 января, 7 января (Рождество),
// 23 февраля, 8 марта, 1 мая, 9 мая, 12 июня, 4 ноября и 31 декабря. Кроме того,
// дополнительные выходные дни образуют длинные уикенды: 8 марта переносится на
// понедельник 9 марта, 9 мая – на понедельник 11 мая, а также 1–3 мая и 9–11
// мая образуют шестидневные выходные【691886759438472†L145-L169】. Мы
// включаем даты 9 марта, 10 мая и 11 мая как нерабочие, чтобы отразить
// производственный календарь.
const holidayDates2026 = [
  '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06',
  '2026-01-07', '2026-01-08',
  '2026-02-23',
  '2026-03-08', '2026-03-09',
  '2026-05-01', '2026-05-09', '2026-05-10', '2026-05-11',
  '2026-06-12',
  '2026-11-04',
  '2026-12-31'
];
const holidaySet2026 = new Set(holidayDates2026);

// Check if a date (YYYY-MM-DD) is an official holiday. Only covers 2026 for
// production calendar purposes. For other years the set can be extended.
function isHoliday(dateStr) {
  return holidaySet2026.has(dateStr);
}

// Keep track of the currently edited employee index
let currentEmployeeIndex = null;

// Fetch employee data from JSON on load
async function loadData() {
  try {
    // Try to load data from localStorage first for persistence
    // Use a unique storage key for the 2026 schedule so that different years
    // don't conflict. If users open multiple versions of the site in different
    // folders, their data will remain separate.
    const stored = localStorage.getItem('vacation_employees_2026');
    if (stored) {
      employees = JSON.parse(stored);
    } else {
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

    // Assign a unique color to each employee for consistent display. We use
    // the predefined color palette and loop around if there are more employees
    // than available colors.
    employees.forEach((emp, idx) => {
      emp.color = colorPalette[idx % colorPalette.length];
    });
    }
    renderEmployees();
    populateMonthSelect();
    // Select the current month if it exists in the dropdown; otherwise select the first available month.
    const today = new Date();
    const todayVal = `${today.getFullYear()}-${(today.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;
    const monthSelect = document.getElementById('month-select');
    let found = false;
    Array.from(monthSelect.options).forEach((opt, idx) => {
      if (opt.value === todayVal) {
        monthSelect.selectedIndex = idx;
        found = true;
      }
    });
    if (!found && monthSelect.options.length > 0) {
      monthSelect.selectedIndex = 0;
    }
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

// Persist employees array to localStorage
function saveData() {
  try {
    // Persist using the 2026-specific key so data for different years doesn't collide
    localStorage.setItem('vacation_employees_2026', JSON.stringify(employees));
  } catch (e) {
    console.error('Ошибка сохранения в localStorage', e);
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
  // Determine the range of years based on the vacations data. If no vacations
  // exist, fall back to the current year and next year.
  let minYear = Number.POSITIVE_INFINITY;
  let maxYear = Number.NEGATIVE_INFINITY;
  employees.forEach((emp) => {
    if (Array.isArray(emp.vacations)) {
      emp.vacations.forEach((v) => {
        if (v.start) {
          const y = new Date(v.start).getFullYear();
          if (y < minYear) minYear = y;
          if (y > maxYear) maxYear = y;
        }
        if (v.end) {
          const y2 = new Date(v.end).getFullYear();
          if (y2 < minYear) minYear = y2;
          if (y2 > maxYear) maxYear = y2;
        }
      });
    }
  });
  // If we didn't find any years, use current year and next year as default
  const currentYear = new Date().getFullYear();
  if (!isFinite(minYear) || !isFinite(maxYear)) {
    minYear = currentYear;
    maxYear = currentYear + 1;
  }
  // Ensure minYear <= maxYear
  if (minYear > maxYear) {
    const tmp = minYear;
    minYear = maxYear;
    maxYear = tmp;
  }
  // Build options for every month between minYear and maxYear inclusive
  for (let year = minYear; year <= maxYear; year++) {
    for (let m = 0; m < 12; m++) {
      const value = `${year}-${(m + 1).toString().padStart(2, '0')}`;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${monthNames[m]} ${year}`;
      select.appendChild(option);
    }
  }
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

// Compute day of year for a date (1-based)
function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// Build data structures for the vacation chart. Returns {datasets, minX, maxX, labels}
// Draw a timeline chart on the given canvas context representing all vacations.
// The chart shows each employee on a separate row and bars representing vacation periods.
function drawTimelineChart(canvas) {
  const ctx = canvas.getContext('2d');
  // Determine the date range across all vacations
  let minDate = null;
  let maxDate = null;
  employees.forEach((emp) => {
    emp.vacations.forEach((vac) => {
      if (!vac.start || !vac.end) return;
      const s = new Date(vac.start);
      const e = new Date(vac.end);
      if (!minDate || s < minDate) minDate = s;
      if (!maxDate || e > maxDate) maxDate = e;
    });
  });
  // Default range: current month if no vacations
  if (!minDate || !maxDate) {
    minDate = new Date();
    maxDate = new Date(minDate);
  }
  const totalDuration = maxDate.getTime() - minDate.getTime() || 1;
  // Layout parameters
  const rowHeight = 25;
  const leftMargin = 200;
  const rightMargin = 50;
  const topMargin = 20;
  const bottomMargin = 50;
  const chartWidth = canvas.width - leftMargin - rightMargin;
  const chartHeight = employees.length * rowHeight;
  // Resize canvas to fit
  canvas.height = chartHeight + topMargin + bottomMargin;
  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Draw background rows and employee names
  employees.forEach((emp, idx) => {
    const y = topMargin + idx * rowHeight;
    // Alternating row color
    ctx.fillStyle = idx % 2 === 0 ? '#2f3e4e' : '#253447';
    ctx.fillRect(0, y, canvas.width, rowHeight);
    // Employee name
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(emp.name, 10, y + rowHeight / 2);
  });
  // Draw vacation bars
  employees.forEach((emp, idx) => {
    const y = topMargin + idx * rowHeight + rowHeight * 0.2;
    const height = rowHeight * 0.6;
    emp.vacations.forEach((vac) => {
      if (!vac.start || !vac.end) return;
      const start = new Date(vac.start);
      const end = new Date(vac.end);
      const xStart = leftMargin + ((start.getTime() - minDate.getTime()) / totalDuration) * chartWidth;
      const xEnd = leftMargin + ((end.getTime() - minDate.getTime()) / totalDuration) * chartWidth;
      // Use the employee's color if available, otherwise fall back to palette
      const color = emp.color || colorPalette[idx % colorPalette.length] || '#2d9cdb';
      ctx.fillStyle = color;
      ctx.fillRect(xStart, y, xEnd - xStart, height);
    });
  });
  // Draw x-axis ticks and labels
  const tickCount = 6;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i <= tickCount; i++) {
    const tTime = minDate.getTime() + (totalDuration * i) / tickCount;
    const x = leftMargin + (chartWidth * i) / tickCount;
    const tickDate = new Date(tTime);
    const day = tickDate.getDate().toString().padStart(2, '0');
    const month = (tickDate.getMonth() + 1).toString().padStart(2, '0');
    const year = tickDate.getFullYear();
    const label = `${day}.${month}.${year}`;
    // Tick line
    ctx.beginPath();
    ctx.moveTo(x, topMargin + chartHeight);
    ctx.lineTo(x, topMargin + chartHeight + 5);
    ctx.stroke();
    // Label
    ctx.fillText(label, x, topMargin + chartHeight + 20);
  }
}

// Draw a yearly timeline chart for all vacations. This version spans from the
// beginning of the first vacation year to the end of the last vacation year.
function drawYearTimelineChart(canvas) {
  const ctx = canvas.getContext('2d');
  // Determine the range of years across all vacations
  let minYear = Infinity;
  let maxYear = -Infinity;
  employees.forEach((emp) => {
    emp.vacations.forEach((vac) => {
      if (vac.start) {
        const y1 = new Date(vac.start).getFullYear();
        if (y1 < minYear) minYear = y1;
        if (y1 > maxYear) maxYear = y1;
      }
      if (vac.end) {
        const y2 = new Date(vac.end).getFullYear();
        if (y2 < minYear) minYear = y2;
        if (y2 > maxYear) maxYear = y2;
      }
    });
  });
  if (!isFinite(minYear) || !isFinite(maxYear)) {
    const currentYear = new Date().getFullYear();
    minYear = currentYear;
    maxYear = currentYear;
  }
  // Set minDate to Jan 1 of minYear and maxDate to Dec 31 of maxYear
  const minDate = new Date(minYear, 0, 1);
  const maxDate = new Date(maxYear, 11, 31);
  const totalDuration = maxDate.getTime() - minDate.getTime() || 1;
  // Layout parameters similar to drawTimelineChart
  const rowHeight = 25;
  const leftMargin = 200;
  const rightMargin = 50;
  const topMargin = 20;
  const bottomMargin = 50;
  const chartWidth = canvas.width - leftMargin - rightMargin;
  const chartHeight = employees.length * rowHeight;
  canvas.height = chartHeight + topMargin + bottomMargin;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Draw alternating row backgrounds and employee names
  employees.forEach((emp, idx) => {
    const y = topMargin + idx * rowHeight;
    ctx.fillStyle = idx % 2 === 0 ? '#2f3e4e' : '#253447';
    ctx.fillRect(0, y, canvas.width, rowHeight);
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(emp.name, 10, y + rowHeight / 2);
  });
  // Draw vacation bars using employee-specific colors
  employees.forEach((emp, idx) => {
    const y = topMargin + idx * rowHeight + rowHeight * 0.2;
    const height = rowHeight * 0.6;
    emp.vacations.forEach((vac) => {
      if (!vac.start || !vac.end) return;
      const start = new Date(vac.start);
      const end = new Date(vac.end);
      const xStart = leftMargin + ((start.getTime() - minDate.getTime()) / totalDuration) * chartWidth;
      const xEnd = leftMargin + ((end.getTime() - minDate.getTime()) / totalDuration) * chartWidth;
      const color = emp.color || colorPalette[idx % colorPalette.length] || '#2d9cdb';
      ctx.fillStyle = color;
      ctx.fillRect(xStart, y, xEnd - xStart, height);
    });
  });
  // Draw ticks and labels for each month across the range
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  // compute number of months across range
  const totalMonths = (maxYear - minYear + 1) * 12;
  for (let i = 0; i <= totalMonths; i++) {
    const date = new Date(minYear, 0, 1);
    date.setMonth(date.getMonth() + i);
    const x = leftMargin + ((date.getTime() - minDate.getTime()) / totalDuration) * chartWidth;
    // Tick line at each month's start
    ctx.beginPath();
    ctx.moveTo(x, topMargin + chartHeight);
    ctx.lineTo(x, topMargin + chartHeight + 4);
    ctx.stroke();
    // Only draw month label at quarter intervals or at Jan 1
    if (i % 3 === 0 || i === 0 || i === totalMonths) {
      const label = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
      ctx.fillText(label, x + ((3 * chartWidth) / totalMonths) / 2, topMargin + chartHeight + 20);
    }
  }
}

// Render the yearly view. Should be called whenever the year section is shown.
function renderYearView() {
  // Render the interactive year grid. This function will also build a legend.
  renderYearGrid();
  renderYearLegend();
  // Draw timeline chart on hidden canvas for export. Keep the original
  // horizontal timeline (hidden) to reuse in Excel export if desired.
  const canvas = document.getElementById('year-chart');
  if (canvas) {
    drawYearTimelineChart(canvas);
  }
}

// Build a legend showing employee colors and explanations for weekends and holidays
function renderYearLegend() {
  const legendContainer = document.getElementById('year-legend');
  if (!legendContainer) return;
  legendContainer.innerHTML = '';
  // Employee color legend
  employees.forEach((emp) => {
    const item = document.createElement('span');
    item.style.display = 'inline-flex';
    item.style.alignItems = 'center';
    item.style.marginRight = '10px';
    // color swatch
    const swatch = document.createElement('span');
    swatch.style.display = 'inline-block';
    swatch.style.width = '12px';
    swatch.style.height = '12px';
    swatch.style.backgroundColor = emp.color || '#2d9cdb';
    swatch.style.marginRight = '4px';
    swatch.style.borderRadius = '2px';
    item.appendChild(swatch);
    // name
    const text = document.createElement('span');
    text.textContent = emp.name;
    item.appendChild(text);
    legendContainer.appendChild(item);
  });
  // Separator
  const separator = document.createElement('div');
  separator.style.marginTop = '8px';
  legendContainer.appendChild(separator);
  // Legend for day types: holiday and weekend
  const legendItems = [
    { label: 'Праздник', className: 'day-holiday' },
    { label: 'Выходной', className: 'day-weekend' }
  ];
  legendItems.forEach((item) => {
    const wrapper = document.createElement('span');
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.marginRight = '10px';
    const box = document.createElement('span');
    box.style.display = 'inline-block';
    box.style.width = '12px';
    box.style.height = '12px';
    box.style.marginRight = '4px';
    // Create a dummy div to get computed background-color from CSS class
    const dummy = document.createElement('div');
    dummy.className = item.className + ' day-cell';
    // Append to wrapper temporarily to compute style
    document.body.appendChild(dummy);
    // Set background color on the box
    const style = window.getComputedStyle(dummy);
    box.style.backgroundColor = style.backgroundColor;
    dummy.remove();
    wrapper.appendChild(box);
    const label = document.createElement('span');
    label.textContent = item.label;
    wrapper.appendChild(label);
    legendContainer.appendChild(wrapper);
  });
}

// Render the year grid for the production calendar view. Only months for the
// year of the majority of vacations (typically 2026) are shown. Each day cell
// marks weekends and official holidays and displays coloured dots for each
// employee who is on vacation on that day.
function renderYearGrid() {
  const gridContainer = document.getElementById('year-calendar-grid');
  if (!gridContainer) return;
  gridContainer.innerHTML = '';
  // Determine which year to render. Use the year with the most vacation days.
  const yearCounts = {};
  employees.forEach((emp) => {
    emp.vacations.forEach((vac) => {
      if (vac.start) {
        const year = new Date(vac.start).getFullYear();
        yearCounts[year] = (yearCounts[year] || 0) + 1;
      }
      if (vac.end) {
        const year = new Date(vac.end).getFullYear();
        yearCounts[year] = (yearCounts[year] || 0) + 1;
      }
    });
  });
  // Choose the year with the maximum count; default to current year
  let renderYear = new Date().getFullYear();
  let maxCount = -1;
  Object.keys(yearCounts).forEach((y) => {
    if (yearCounts[y] > maxCount) {
      maxCount = yearCounts[y];
      renderYear = parseInt(y, 10);
    }
  });
  // Build the grid: 12 months
  for (let month = 0; month < 12; month++) {
    const monthDiv = document.createElement('div');
    monthDiv.className = 'year-month';
    // Month header
    const header = document.createElement('div');
    header.className = 'month-header';
    header.textContent = `${monthNames[month]} ${renderYear}`;
    monthDiv.appendChild(header);
    // Month grid
    const monthGrid = document.createElement('div');
    monthGrid.className = 'month-grid';
    // Weekday names row
    const weekdayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekdayNames.forEach((wd) => {
      const wdCell = document.createElement('div');
      wdCell.className = 'day-cell';
      wdCell.style.backgroundColor = '#253447';
      wdCell.textContent = wd;
      wdCell.style.fontWeight = 'bold';
      wdCell.style.textAlign = 'center';
      wdCell.style.minHeight = '20px';
      monthGrid.appendChild(wdCell);
    });
    // Determine first day of month and days in month
    const firstDay = new Date(renderYear, month, 1);
    // Day of week (Monday=1, Sunday=7)
    let dayOfWeek = firstDay.getDay();
    if (dayOfWeek === 0) dayOfWeek = 7;
    // Fill blanks before the first day
    const blanks = dayOfWeek - 1;
    for (let i = 0; i < blanks; i++) {
      const blankCell = document.createElement('div');
      blankCell.className = 'day-cell';
      monthGrid.appendChild(blankCell);
    }
    // Fill in each day
    const daysInMonth = new Date(renderYear, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(renderYear, month, day);
      const isoDate = date.toISOString().split('T')[0];
      const dayCell = document.createElement('div');
      dayCell.className = 'day-cell';
      // Determine weekend and holiday
      const jsDay = date.getDay(); // 0 Sunday, 6 Saturday
      const isWeekend = jsDay === 0 || jsDay === 6;
      if (isHoliday(isoDate)) {
        dayCell.classList.add('day-holiday');
      } else if (isWeekend) {
        dayCell.classList.add('day-weekend');
      }
      // Day number
      const num = document.createElement('div');
      num.className = 'day-number';
      num.textContent = day;
      dayCell.appendChild(num);
      // Vacation dots container
      const dotsContainer = document.createElement('div');
      dotsContainer.className = 'vacation-dots';
      // Determine which employees are on vacation this day
      employees.forEach((emp) => {
        emp.vacations.forEach((vac) => {
          if (!vac.start || !vac.end) return;
          const s = new Date(vac.start);
          const e = new Date(vac.end);
          if (date >= s && date <= e) {
            const dot = document.createElement('span');
            dot.className = 'vacation-dot';
            dot.style.backgroundColor = emp.color || '#2d9cdb';
            dot.title = emp.name;
            dotsContainer.appendChild(dot);
          }
        });
      });
      dayCell.appendChild(dotsContainer);
      monthGrid.appendChild(dayCell);
    }
    // Append blank cells to complete the grid to 7 columns per week
    const totalCells = weekdayNames.length + blanks + daysInMonth;
    const rows = Math.ceil(totalCells / 7);
    const expectedCells = rows * 7;
    const extra = expectedCells - totalCells;
    for (let i = 0; i < extra; i++) {
      const blankCell = document.createElement('div');
      blankCell.className = 'day-cell';
      monthGrid.appendChild(blankCell);
    }
    monthDiv.appendChild(monthGrid);
    gridContainer.appendChild(monthDiv);
  }
}

// Export employees and vacations to an Excel file with a chart image
async function exportToExcel() {
  try {
    // Draw timeline chart on the hidden canvas
    const canvas = document.getElementById('export-chart');
    drawTimelineChart(canvas);
    // Convert canvas to Base64 image
    const imageData = canvas.toDataURL('image/png');
    // Build HTML string for Excel export. Excel can open HTML files with a .xls extension.
    let html = '<html><head><meta charset="UTF-8"></head><body>';
    html += '<h3>График отпусков</h3>';
    // Build table of vacations
    html += '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">';
    html += '<tr><th>Ф.И.О.</th><th>Должность</th><th>Начало</th><th>Конец</th><th>Дней</th></tr>';
    employees.forEach((emp) => {
      const pos = emp.position || '';
      if (emp.vacations && emp.vacations.length > 0) {
        emp.vacations.forEach((vac) => {
          const start = vac.start || '';
          const end = vac.end || '';
          const days = vac.days || '';
          html += `<tr><td>${emp.name}</td><td>${pos}</td><td>${start}</td><td>${end}</td><td>${days}</td></tr>`;
        });
      } else {
        html += `<tr><td>${emp.name}</td><td>${pos}</td><td></td><td></td><td></td></tr>`;
      }
    });
    html += '</table>';
    // Add chart image
    html += '<br/><img src="' + imageData + '" alt="График"/>';
    html += '</body></html>';
    // Create a Blob as an Excel file
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'график_отпусков.xls';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Ошибка при экспорте в Excel:', err);
    alert('Произошла ошибка при экспорте. Пожалуйста, попробуйте снова.');
  }
}

// Render calendar for selected month
function renderCalendar() {
  const container = document.getElementById('calendar-container');
  container.innerHTML = '';
  const selectValue = document.getElementById('month-select').value;
  const [yearStr, monthStr] = selectValue.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;

  // Update month-year heading if present
  const monthHeading = document.getElementById('calendar-month-year');
  if (monthHeading) {
    monthHeading.textContent = `${monthNames[month]} ${year}`;
  }
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
          // Apply the employee-specific color to the label
          if (emp.color) {
            span.style.backgroundColor = emp.color;
          }
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
  const navYear = document.getElementById('nav-year');
  navEmployees.addEventListener('click', (e) => {
    e.preventDefault();
    showSection('employees');
  });
  navCalendar.addEventListener('click', (e) => {
    e.preventDefault();
    showSection('calendar');
  });
  if (navYear) {
    navYear.addEventListener('click', (e) => {
      e.preventDefault();
      showSection('year');
    });
  }
}

// Show either employees or calendar section
function showSection(section) {
  const empSec = document.getElementById('employees-section');
  const calSec = document.getElementById('calendar-section');
  const yearSec = document.getElementById('year-section');
  // Remove active class from all nav items
  document.getElementById('nav-employees').classList.remove('active');
  document.getElementById('nav-calendar').classList.remove('active');
  if (document.getElementById('nav-year')) {
    document.getElementById('nav-year').classList.remove('active');
  }
  if (section === 'employees') {
    empSec.style.display = '';
    calSec.style.display = 'none';
    if (yearSec) yearSec.style.display = 'none';
    document.getElementById('nav-employees').classList.add('active');
  } else if (section === 'calendar') {
    empSec.style.display = 'none';
    calSec.style.display = '';
    if (yearSec) yearSec.style.display = 'none';
    document.getElementById('nav-calendar').classList.add('active');
    // Re-render calendar in case new vacations were added
    renderCalendar();
  } else if (section === 'year') {
    empSec.style.display = 'none';
    calSec.style.display = 'none';
    if (yearSec) yearSec.style.display = '';
    if (document.getElementById('nav-year')) {
      document.getElementById('nav-year').classList.add('active');
    }
    // Render yearly view when switching to year section
    renderYearView();
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
    // Determine color for the new employee based on current count
    const color = colorPalette[employees.length % colorPalette.length];
    employees.push({
      name,
      position,
      total_days: total,
      vacations: [],
      color,
    });
    renderEmployees();
    saveData();
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
      // Re-render and persist
      renderEmployees();
      renderCalendar();
      saveData();
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
      saveData();
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
  // Set up Excel export button
  const exportBtn = document.getElementById('export-excel');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportToExcel);
  }
});