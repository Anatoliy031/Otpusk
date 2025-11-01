let employees=[],vacationChart=null;
const storageKey="vacationPlanner2026";

document.addEventListener("DOMContentLoaded",()=>{
  const saved=localStorage.getItem(storageKey);
  employees=saved?JSON.parse(saved):getDemoData();
  saveToStorage();renderEmployeeTable();renderVacationChart();renderFullYearCalendar();
  initFileImport();initButtons();
});

function getDemoData(){
  return[
    {name:"Иванов Иван Иванович",position:"Инженер",total_days:28,vacations:[{start:"2026-06-10",end:"2026-06-30",days:21}],color:getColor()},
    {name:"Петров Петр Петрович",position:"Менеджер",total_days:28,vacations:[{start:"2026-07-01",end:"2026-07-14",days:14}],color:getColor()},
    {name:"Сидорова Анна Сергеевна",position:"Бухгалтер",total_days:28,vacations:[{start:"2026-08-05",end:"2026-08-25",days:21}],color:getColor()}
  ];
}
function saveToStorage(){localStorage.setItem(storageKey,JSON.stringify(employees));}
function clearStorage(){if(confirm("Очистить все данные?")){localStorage.removeItem(storageKey);employees=getDemoData();saveToStorage();renderAll();}}
function getColor(){return`hsl(${Math.floor(Math.random()*360)},70%,50%)`;}
function renderAll(){renderEmployeeTable();renderVacationChart();renderFullYearCalendar();}
function renderEmployeeTable(){
  const tbody=document.querySelector("#employees-table tbody");tbody.innerHTML="";
  employees.forEach(e=>{
    const used=e.vacations.reduce((s,v)=>s+v.days,0);
    tbody.innerHTML+=`<tr><td style="color:${e.color}">${e.name}</td><td>${e.position}</td><td>${e.total_days}</td><td>${used}</td></tr>`;
  });
  updateBanner();
}
function updateBanner(){
  const b=document.getElementById("current-vacation-banner"),today=new Date();
  const onVacation=employees.filter(e=>e.vacations.some(v=>new Date(v.start)<=today&&today<=new Date(v.end)));
  b.innerHTML=onVacation.length?`<b>Сейчас в отпуске:</b> ${onVacation.map(e=>`<span style="color:${e.color}">${e.name}</span>`).join(", ")}`:"Сегодня никто не в отпуске.";
}
function renderVacationChart(){
  const ctx=document.getElementById("vacationChart");if(vacationChart)vacationChart.destroy();
  vacationChart=new Chart(ctx,{type:"bar",data:{labels:employees.map(e=>e.name),datasets:[
    {label:"Использовано",data:employees.map(e=>e.vacations.reduce((s,v)=>s+v.days,0)),backgroundColor:employees.map(e=>e.color)},
    {label:"Всего дней",data:employees.map(e=>e.total_days),backgroundColor:"rgba(180,180,180,0.3)"}]},
    options:{responsive:true,plugins:{legend:{position:"top"}}}});
}
function renderFullYearCalendar(){
  const c=document.getElementById("calendar-container");c.innerHTML="";
  const months=["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  months.forEach((m,i)=>{
    const box=document.createElement("div");box.innerHTML=`<h6 class="text-center text-primary">${m}</h6>`;
    const grid=document.createElement("div");grid.className="calendar-grid";
    ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].forEach(d=>{const h=document.createElement("div");h.className="header-cell";h.textContent=d;grid.appendChild(h);});
    const first=new Date(2026,i,1).getDay()||7,days=new Date(2026,i+1,0).getDate();
    for(let j=1;j<first;j++)grid.appendChild(document.createElement("div"));
    for(let d=1;d<=days;d++){const cell=document.createElement("div");cell.className="cell";
      const num=document.createElement("div");num.className="day-number";num.textContent=d;cell.appendChild(num);
      const date=`2026-${String(i+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      employees.forEach(e=>e.vacations.forEach(v=>{if(date>=v.start&&date<=v.end){const tag=document.createElement("div");tag.className="vacation-item";tag.textContent=e.name.split(" ")[0];tag.style.background=e.color;cell.appendChild(tag);}}));
      grid.appendChild(cell);}
    box.appendChild(grid);c.appendChild(box);
  });
}
function initFileImport(){
  document.getElementById("importExcel").addEventListener("change",async e=>{
    const f=e.target.files[0];if(!f)return;
    const data=await f.arrayBuffer(),wb=XLSX.read(data,{type:"array"}),sheet=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet);
    employees=rows.filter(r=>r["ФИО"]||r["Фамилия Имя Отчество"]).map(r=>({
      name:r["ФИО"]||r["Фамилия Имя Отчество"],position:r["Должность"]||"",total_days:r["Дней"]||28,
      vacations:[{start:fmt(r["Дата начала"]||r["Начало"]),end:fmt(r["Дата окончания"]||r["Конец"]),days:r["Дней"]||0}],
      color:getColor()
    }));
    saveToStorage();renderAll();alert("✅ Импорт завершён!");
  });
}
function fmt(d){if(!d)return"";if(typeof d==="string")return d.split("T")[0];return new Date(d).toISOString().split("T")[0];}
function initButtons(){
  document.getElementById("export-csv").addEventListener("click",()=>{
    let csv="ФИО;Должность;Всего дней;Использовано\n";
    employees.forEach(e=>{const used=e.vacations.reduce((s,v)=>s+v.days,0);csv+=`${e.name};${e.position};${e.total_days};${used}\n`;});
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"}),a=document.createElement("a");
    a.href=URL.createObjectURL(blob);a.download="график_отпусков_2026.csv";a.click();
  });
  document.getElementById("reset-data").addEventListener("click",clearStorage);
}
