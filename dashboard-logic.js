import { getUserTeamsMap } from "./auth-logic.js";

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQTwKJ86LlXzR5Ynx--KzD0ICx79xFXbMkZeMLTgUWJFD9MQ2LAOVZfWyWaZW-hFg3vhxtINAYfZ_Gz/pub?gid=0&single=true&output=csv';
const DETAILED_CSV_URL = 'https://google.com';

let googleData = []; let detailedCallsData = {}; let filteredData = [];
let globalUserTeamsMap = {}; let sortStates = { name: false, ouk: true, sa: true };

export async function startDashboard(userProfile) {
    await loadGoogleData(); await loadDetailedCallsData();
    globalUserTeamsMap = await getUserTeamsMap();
    document.getElementById('loader').style.display = 'none';
    document.getElementById('listContainer').classList.remove('hidden');

    if (userProfile.role === 'leader') {
        document.getElementById('leaderPanel').classList.remove('hidden');
        document.getElementById('statsBar').classList.remove('hidden');
        document.getElementById('controlsBar').classList.remove('hidden');
        const leaderTeam = (userProfile.teamName || '').toLowerCase().trim();
        filteredData = googleData.filter(u => (globalUserTeamsMap[u.name.toLowerCase().trim()] || '').toLowerCase().trim() === leaderTeam);
        sortData('ouk', true); updateStats(filteredData);
    } else {
        document.getElementById('leaderPanel').classList.add('hidden');
        document.getElementById('statsBar').classList.add('hidden');
        document.getElementById('controlsBar').classList.add('hidden');
        filteredData = googleData.filter(u => u.name.toLowerCase() === userProfile.name.toLowerCase());
        renderList(filteredData);
    }
    setupSortListeners();
}

async function loadGoogleData() {
    try {
        const res = await fetch(CSV_URL); const text = await res.text(); const lines = text.split(/\r?\n/);
        googleData = [];
        for (let i = 2; i < lines.length; i++) {
            if (!lines[i].trim()) continue; const row = parseCsvRow(lines[i]); if (row.length < 17) continue;
            const fName = safeTrim(row[0]); const role = safeTrim(row[1]);
            if (!fName || fName.toLowerCase().includes('общая') || fName.startsWith('http')) continue;
            googleData.push({
                name: fName, role: role || 'Не указана',
                oukWeeks: [row[2], row[3], row[4], row[5], row[6]].map(v => parseNum(v)), oukTotal: parseNum(row[15]),
                saWeeks: [row[8], row[9], row[10], row[11], row[12]].map(v => parseNum(v)), saTotal: parseNum(row[16])
            });
        }
    } catch (e) { console.error(e); }
}

async function loadDetailedCallsData() {
    try {
        const res = await fetch(DETAILED_CSV_URL); if(!res.ok) return;
        const text = await res.text(); const lines = text.split(/\r?\n/).map(l => parseCsvRow(l));
        detailedCallsData = {}; let currentEmp = "";
        lines.forEach((row, index) => {
            if (!row || row.length < 2) return; const checkCell = safeTrim(row[0]).toLowerCase();
            if (row[0] && !row[1] && row[0].toString().length > 3) {
                currentEmp = safeTrim(row[0]).toLowerCase();
                detailedCallsData[currentEmp] = { criteria: [], finalOuk: ["-","-","-","-","-"], sa: "-" }; return;
            }
            if (!currentEmp || !detailedCallsData[currentEmp]) return;
            if (row[0] !== undefined && row[0] !== "" && index >= 2 && index <= 12) {
                detailedCallsData[currentEmp].criteria.push({ name: row[0], calls: [row[2], row[3], row[4], row[5], row[6]].map(v => v || "-") });
            }
            if (checkCell.includes("итоговый") || checkCell.includes("результат")) {
                detailedCallsData[currentEmp].finalOuk = [row[2], row[3], row[4], row[5], row[6]].map(v => v || "-");
            }
            if (checkCell.includes("sa") || checkCell.includes("speech")) {
                detailedCallsData[currentEmp].sa = row[2] || "-";
            }
        });
    } catch(e) { console.warn(e); }
}
window.openDetailedWeekModal = function(name, metricType, weekNum, value) {
    const modal = document.getElementById('weekDetailsModal');
    document.getElementById('weekModalTitle').innerText = `${metricType} — Неделя ${weekNum}`;
    document.getElementById('weekModalEmpName').innerText = name;
    const empKey = name.toLowerCase().trim(); const hData = detailedCallsData[empKey];
    const tBody = document.getElementById('weekModalTableRows'); tBody.innerHTML = '';

    if (!hData || !hData.criteria || hData.criteria.length === 0) {
        tBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;">Детальные критерии для ${name} еще не внесены на лист Детализации.</td></tr>`;
        document.getElementById('weekModalSaValue').innerText = fmt(value) + "%";
        document.getElementById('weekModalSaValue').className = metricType === 'ОУК' ? getOukClass(value) : getSaClass(value);
        modal.classList.remove('hidden'); return;
    }
    hData.criteria.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${c.name}</td>${c.calls.map(val => `<td style="text-align:center;">${val}</td>`).join('')}`;
        tBody.appendChild(tr);
    });
    const trOuk = document.createElement('tr');
    trOuk.innerHTML = `<td style="font-weight:700; background:var(--input-bg);">ИТОГОВЫЙ ОУК РАЗГОВОРОВ</td>
        ${hData.finalOuk.map(v => `<td style="text-align:center; font-weight:700;" class="${getOukClass(parseFloat(v))}">${v}${isNaN(parseFloat(v))?'':'%'}</td>`).join('')}`;
    tBody.appendChild(trOuk);
    document.getElementById('weekModalSaValue').innerText = hData.sa + (isNaN(parseFloat(hData.sa)) ? '' : '%');
    document.getElementById('weekModalSaValue').className = getSaClass(parseFloat(hData.sa));
    modal.classList.remove('hidden');
};

function parseCsvRow(t) {
    let r = ['']; let q = false;
    for (let i = 0; i < t.length; i++) {
        if (t[i] === '"') { q = !q; continue; }
        if (t[i] === ',' && !q) { r.push(''); continue; } r[r.length - 1] += t[i];
    }
    return r;
}
function safeTrim(v) { return typeof v === 'string' ? v.trim() : (v ? String(v).trim() : ''); }
// Обновленный парсинг чисел, убирающий знак %
function parseNum(v) { v = safeTrim(v).replace('%',''); if (!v || v === '0' || v.includes('-')) return null; let n = parseFloat(v.replace(',', '.')); return isNaN(n) ? null : n; }
function getOukClass(v) { return v === null ? 'bg-none' : (v >= 90 ? 'bg-good' : (v >= 85 ? 'bg-normal' : 'bg-bad')); }
function getSaClass(v) { return v === null ? 'bg-none' : (v >= 85 ? 'bg-good' : (v >= 70 ? 'bg-normal' : 'bg-bad')); }
function fmt(v) { return v === null ? '-' : v.toFixed(1); }

function sortData(field, forceDirection = null) {
    let isDescending = forceDirection !== null ? forceDirection : sortStates[field];
    if (forceDirection === null) sortStates[field] = !sortStates[field];
    filteredData.sort((a, b) => {
        let valA, valB;
        if (field === 'name') { valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); return isDescending ? valB.localeCompare(valA) : valA.localeCompare(valB); }
        if (field === 'ouk') { valA = a.oukTotal ?? -1; valB = b.oukTotal ?? -1; }
        if (field === 'sa') { valA = a.saTotal ?? -1; valB = b.saTotal ?? -1; }
        return isDescending ? valB - valA : valA - valB;
    });
    renderList(filteredData);
}
function setupSortListeners() {
    const bName = document.getElementById('sortName'); const bOuk = document.getElementById('sortOuk'); const bSa = document.getElementById('sortSa');
    if(bName && !bName.dataset.hooked) { bName.addEventListener('click', () => sortData('name')); bName.dataset.hooked = true; }
    if(bOuk && !bOuk.dataset.hooked) { bOuk.addEventListener('click', () => sortData('ouk')); bOuk.dataset.hooked = true; }
    if(bSa && !bSa.dataset.hooked) { bSa.addEventListener('click', () => sortData('sa')); bSa.dataset.hooked = true; }
}

function renderList(data) {
    const rows = document.getElementById('mainListRows'); if(!rows) return; rows.innerHTML = '';
    if (data.length === 0) { rows.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;">Ничего не найдено</td></tr>'; return; }
    data.forEach(user => {
        const currentTeam = globalUserTeamsMap[user.name.toLowerCase().trim()] || 'Без команды';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div class="emp-profile"><div class="emp-avatar">${user.name.slice(0,2).toUpperCase()}</div><div><div class="emp-name">${user.name}</div><div class="emp-role-tag">${user.role}</div></div></div></td>
            <td><span class="emp-team-badge">${currentTeam}</span></td>
            <td><div class="metric-cell-wrapper"><div class="total-score-badge ${getOukClass(user.oukTotal)}">${fmt(user.oukTotal)}%</div>
                <div class="weeks-mini-row">${user.oukWeeks.map((v, i) => `<div class="week-mini-box ${getOukClass(v)}" style="cursor:pointer;" onclick="window.openDetailedWeekModal('${user.name}', 'ОУК', ${i+1}, ${v})">${fmt(v)}</div>`).join('')}</div></div></td>
            <td><div class="metric-cell-wrapper"><div class="total-score-badge ${getSaClass(user.saTotal)}">${fmt(user.saTotal)}%</div>
                <div class="weeks-mini-row">${user.saWeeks.map((v, i) => `<div class="week-mini-box ${getSaClass(v)}" style="cursor:pointer;" onclick="window.openDetailedWeekModal('${user.name}', 'Speech Analytics', ${i+1}, ${v})">${fmt(v)}</div>`).join('')}</div></div></td>`;
        rows.appendChild(tr);
    });
}
function updateStats(data) {
    document.getElementById('statTotal').innerText = data.length;
    const validOuk = data.map(u => u.oukTotal).filter(v => v !== null && v > 0);
    if(validOuk.length > 0) document.getElementById('statAvg').innerText = (validOuk.reduce((s,v)=>s+v,0)/validOuk.length).toFixed(2)+'%';
    const validSa = data.map(u => u.saTotal).filter(v => v !== null && v > 0);
    if(validSa.length > 0) document.getElementById('statSaAvg').innerText = (validSa.reduce((s,v)=>s+v,0)/validSa.length).toFixed(2)+'%';
}
document.getElementById('searchInput').addEventListener('input', () => {
    const s = document.getElementById('searchInput').value.toLowerCase();
    renderList(googleData.filter(u => u.name.toLowerCase().includes(s)));
});

