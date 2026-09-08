import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getUserTeamsMap } from "./auth-logic.js";

// Оригинальная проверенная ссылка на публикацию сводного листа
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2wtg1vy8FT8cgMFFGNecvvhk0GGeUYg_VibkA6g75Nbju7u96webWM5vtkhsygvuhwsOil7FRwVyg/pub?output=csv';

let googleData = [];
let filteredData = [];
let globalUserTeamsMap = {};
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
window.openDetailedWeekModal = async function(name, metricType, weekNum, value) {
    const modal = document.getElementById('weekDetailsModal');
    document.getElementById('weekModalTitle').innerText = `${metricType} — Неделя ${weekNum}`;
    document.getElementById('weekModalEmpName').innerText = name;
    
    const tBody = document.getElementById('weekModalTableRows');
    tBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:15px;">Поиск детального чек-листа в базе данных...</td></tr>';
    document.getElementById('weekModalSaValue').innerText = '-';
    modal.classList.remove('hidden');

    try {
        // Ищем специалиста в Firebase по его ФИО, чтобы вытащить UID документа
        const snap = await google.firestore().collection("users").where("name", "==", name).get();
        let hData = null;
        
        if (!snap.empty) {
            const userDocData = snap.docs[0].data();
            hData = userDocData.history_weeks ? userDocData.history_weeks[`w${weekNum}`] : null;
        }

        // Если данные сохранены твоим бэкендом в виде JSON-строки, распаковываем её
        if (typeof hData === 'string') {
            try { hData = JSON.parse(hData); } catch(e) { hData = null; }
        }

        tBody.innerHTML = '';

        // Если детальный чек-лист отсутствует в Firestore, просто выводим общую оценку за неделю из CSV
        if (!hData || !hData.criteria) {
            tBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">Развернутый чек-лист разговоров отсутствует в базе данных. Выводится общая оценка недели: ${fmt(value)}%</td></tr>`;
            document.getElementById('weekModalSaValue').innerText = fmt(value) + "%";
            document.getElementById('weekModalSaValue').className = metricType === 'ОУК' ? getOukClass(value) : getSaClass(value);
            return;
        }

        // Если чек-лист найден, строим красивую детальную интерактивную таблицу звонков
        hData.criteria.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td style="font-weight:600;">${c.name}</td>${c.calls.map(val => `<td style="text-align:center;">${val}</td>`).join('')}`;
            tBody.appendChild(tr);
        });

        const finalOuk = hData.finalOukRows || ['-', '-', '-', '-', '-'];
        const trOuk = document.createElement('tr');
        trOuk.innerHTML = `<td style="font-weight:700; background:var(--input-bg);">ИТОГОВЫЙ ОУК РАЗГОВОРОВ</td>
            ${finalOuk.map(v => `<td style="text-align:center; font-weight:700;" class="${getOukClass(parseFloat(v))}">${v}${isNaN(parseFloat(v))?'':'%'}</td>`).join('')}`;
        tBody.appendChild(trOuk);

        const saVal = hData.saValue !== null ? parseFloat(hData.saValue) : null;
        document.getElementById('weekModalSaValue').innerText = saVal !== null ? `${saVal.toFixed(1)}%` : '-';
        document.getElementById('weekModalSaValue').className = getSaClass(saVal);

    } catch (err) {
        tBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:15px;color:var(--danger);">Ошибка подключения к Firebase.</td></tr>';
    }
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
function parseNum(v) { v = safeTrim(v); if (!v || v === '0' || v.includes('-')) return null; let n = parseFloat(v.replace(',', '.')); return isNaN(n) ? null : n; }
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
    const btnName = document.getElementById('sortName'); const btnOuk = document.getElementById('sortOuk'); const btnSa = document.getElementById('sortSa');
    if(btnName && !btnName.dataset.hooked) { btnName.addEventListener('click', () => sortData('name')); btnName.dataset.hooked = true; }
    if(btnOuk && !btnOuk.dataset.hooked) { btnOuk.addEventListener('click', () => sortData('ouk')); btnOuk.dataset.hooked = true; }
    if(btnSa && !btnSa.dataset.hooked) { btnSa.addEventListener('click', () => sortData('sa')); btnSa.dataset.hooked = true; }
}

function renderList(data) {
    const rowsContainer = document.getElementById('mainListRows'); if(!rowsContainer) return; rowsContainer.innerHTML = '';
    if (data.length === 0) { rowsContainer.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-muted);">Ничего не найдено</td></tr>'; return; }

    data.forEach(user => {
        const currentTeam = globalUserTeamsMap[user.name.toLowerCase().trim()] || 'Без команды';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div class="emp-profile"><div class="emp-avatar">${user.name.slice(0,2).toUpperCase()}</div><div><div class="emp-name">${user.name}</div><div class="emp-role-tag">${user.role}</div></div></div></td>
            <td><span class="emp-team-badge">${currentTeam}</span></td>
            <td><div class="metric-cell-wrapper"><div class="total-score-badge ${getOukClass(user.oukTotal)}">${fmt(user.oukTotal)}%</div>
                <div class="weeks-mini-row">
                    ${user.oukWeeks.map((v, i) => `<div class="week-mini-box ${getOukClass(v)}" style="cursor:pointer;" onclick="window.openDetailedWeekModal('${user.name}', 'ОУК', ${i+1}, ${v})">${fmt(v)}</div>`).join('')}
                </div></div></td>
            <td><div class="metric-cell-wrapper"><div class="total-score-badge ${getSaClass(user.saTotal)}">${fmt(user.saTotal)}%</div>
                <div class="weeks-mini-row">
                    ${user.saWeeks.map((v, i) => `<div class="week-mini-box ${getSaClass(v)}" style="cursor:pointer;" onclick="window.openDetailedWeekModal('${user.name}', 'Speech Analytics', ${i+1}, ${v})">${fmt(v)}</div>`).join('')}
                </div></div></td>`;
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
    renderList(googleData.filter(u => u.name.toLowerCase().includes(s)));
});
