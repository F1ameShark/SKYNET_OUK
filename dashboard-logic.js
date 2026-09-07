import { getUserTeamsMap } from "./auth-logic.js";

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQTwKJ86LlXzR5Ynx--KzD0ICx79xFXbMkZeMLTgUWJFD9MQ2LAOVZfWyWaZW-hFg3vhxtINAYfZ_Gz/pub?gid=0&single=true&output=csv';

let googleData = [];
let filteredData = [];
let globalUserTeamsMap = {};

// Состояния сортировки (false - по возрастанию, true - по убыванию)
let sortStates = { name: false, ouk: true, sa: true };

export async function startDashboard(userProfile) {
    await loadGoogleData();
    globalUserTeamsMap = await getUserTeamsMap();
    
    document.getElementById('loader').style.display = 'none';
    document.getElementById('listContainer').classList.remove('hidden');

    if (userProfile.role === 'leader') {
        document.getElementById('leaderPanel').classList.remove('hidden');
        document.getElementById('statsBar').classList.remove('hidden');
        document.getElementById('controlsBar').classList.remove('hidden');
        
        const leaderTeam = (userProfile.teamName || '').toLowerCase().trim();
        filteredData = googleData.filter(u => {
            const employeeTeam = (globalUserTeamsMap[u.name.toLowerCase().trim()] || '').toLowerCase().trim();
            return employeeTeam === leaderTeam;
        });
        
        // По умолчанию сортируем ОУК от лучших к отстающим
        sortData('ouk', true);
        updateStats(filteredData);
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
        const res = await fetch(CSV_URL);
        const text = await res.text();
        const lines = text.split(/\r?\n/);
        googleData = [];
        for (let i = 2; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const row = parseCsvRow(lines[i]);
            if (row.length < 17) continue;
            const fName = safeTrim(row[0]); const role = safeTrim(row[1]);
            if (!fName || fName.toLowerCase().includes('общая') || fName.startsWith('http')) continue;
            googleData.push({
                name: fName, role: role || 'Не указана',
                oukWeeks: [row[2], row[3], row[4], row[5], row[6]].map(v => parseNum(v)), 
                oukTotal: parseNum(row[15]), 
                saWeeks: [row[8], row[9], row[10], row[11], row[12]].map(v => parseNum(v)), 
                saTotal: parseNum(row[16])
            });
        }
    } catch (e) { console.error(e); }
}

function parseCsvRow(t) {
    let r = ['']; let q = false;
    for (let i = 0; i < t.length; i++) {
        if (t[i] === '"') { q = !q; continue; }
        if (t[i] === ',' && !q) { r.push(''); continue; } r[r.length - 1] += t[i];
    }
    return r;
}
function safeTrim(v) { return typeof v === 'string' ? v.trim() : (v ? String(v).trim() : ''); }
function parseNum(v) { v = safeTrim(v); if (!v || v === '0' || v.includes('-')) return null; let n = parseFloat(v.replace(',', '.')); return isNaN(n) ? null : n; }
function getOukClass(v) { return v === null ? 'bg-none' : (v >= 90 ? 'bg-good' : (v >= 85 ? 'bg-normal' : 'bg-bad')); }
function getSaClass(v) { return v === null ? 'bg-none' : (v >= 85 ? 'bg-good' : (v >= 70 ? 'bg-normal' : 'bg-bad')); }
function fmt(v) { return v === null ? '-' : v.toFixed(1); }

// ФУНКЦИЯ СОРТИРОВКИ МАССИВА
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
    const btnName = document.getElementById('sortName');
    const btnOuk = document.getElementById('sortOuk');
    const btnSa = document.getElementById('sortSa');
    if(btnName && !btnName.dataset.hooked) { btnName.addEventListener('click', () => sortData('name')); btnName.dataset.hooked = true; }
    if(btnOuk && !btnOuk.dataset.hooked) { btnOuk.addEventListener('click', () => sortData('ouk')); btnOuk.dataset.hooked = true; }
    if(btnSa && !btnSa.dataset.hooked) { btnSa.addEventListener('click', () => sortData('sa')); btnSa.dataset.hooked = true; }
}

function renderList(data) {
    const rowsContainer = document.getElementById('mainListRows');
    if(!rowsContainer) return; rowsContainer.innerHTML = '';
    
    if (data.length === 0) {
        rowsContainer.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-muted);">Ничего не найдено</td></tr>';
        return;
    }

    data.forEach(user => {
        const currentTeam = globalUserTeamsMap[user.name.toLowerCase().trim()] || 'Без команды';
        const tr = document.createElement('tr');
        
        tr.innerHTML = `
            <td>
                <div class="emp-profile">
                    <div class="emp-avatar">${user.name.slice(0,2).toUpperCase()}</div>
                    <div>
                        <div class="emp-name">${user.name}</div>
                        <div class="emp-role-tag">${user.role}</div>
                    </div>
                </div>
            </td>
            <td><span class="emp-team-badge">${currentTeam}</span></td>
            <td>
                <div class="metric-cell-wrapper">
                    <div class="total-score-badge ${getOukClass(user.oukTotal)}">${fmt(user.oukTotal)}%</div>
                    <div class="weeks-mini-row">
                        <div class="week-mini-box ${getOukClass(user.oukWeeks[0])}">${fmt(user.oukWeeks[0])}</div>
                        <div class="week-mini-box ${getOukClass(user.oukWeeks[1])}">${fmt(user.oukWeeks[1])}</div>
                        <div class="week-mini-box ${getOukClass(user.oukWeeks[2])}">${fmt(user.oukWeeks[2])}</div>
                        <div class="week-mini-box ${getOukClass(user.oukWeeks[3])}">${fmt(user.oukWeeks[3])}</div>
                        <div class="week-mini-box ${getOukClass(user.oukWeeks[4])}">${fmt(user.oukWeeks[4])}</div>
                    </div>
                </div>
            </td>
            <td>
                <div class="metric-cell-wrapper">
                    <div class="total-score-badge ${getSaClass(user.saTotal)}">${fmt(user.saTotal)}%</div>
                    <div class="weeks-mini-row">
                        <div class="week-mini-box ${getSaClass(user.saWeeks[0])}">${fmt(user.saWeeks[0])}</div>
                        <div class="week-mini-box ${getSaClass(user.saWeeks[1])}">${fmt(user.saWeeks[1])}</div>
                        <div class="week-mini-box ${getSaClass(user.saWeeks[2])}">${fmt(user.saWeeks[2])}</div>
                        <div class="week-mini-box ${getSaClass(user.saWeeks[3])}">${fmt(user.saWeeks[3])}</div>
                        <div class="week-mini-box ${getSaClass(user.saWeeks[4])}">${fmt(user.saWeeks[4])}</div>
                    </div>
                </div>
            </td>
        `;
        rowsContainer.appendChild(tr);
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
    const leaderTeam = (document.getElementById('userRoleBadge').innerText === 'Руководитель') ? document.getElementById('newTeamName').placeholder : '';
    filteredData = googleData.filter(u => {
        const matchesSearch = u.name.toLowerCase().includes(s);
        if (!leaderTeam) return matchesSearch;
        const employeeTeam = (globalUserTeamsMap[u.name.toLowerCase().trim()] || '').toLowerCase().trim();
        return matchesSearch && employeeTeam === leaderTeam.toLowerCase().trim();
    });
    renderList(filteredData);
});

