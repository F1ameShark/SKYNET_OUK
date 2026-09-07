import { getUserTeamsMap } from "./auth-logic.js";

let googleData = [];
let filteredData = [];
let globalUserTeamsMap = {};
let sortStates = { name: false, ouk: true, sa: true };

export async function startDashboard(userProfile) {
    await fetchEmployeesFromFirestore();
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

async function fetchEmployeesFromFirestore() {
    try {
        const snap = await google.firestore().collection("users").get();
        googleData = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.role === 'employee') {
                const oukWeeks = [data.ouk_w1, data.ouk_w2, data.ouk_w3, data.ouk_w4, data.ouk_w5].map(v => v ?? null);
                const saWeeks = [data.sa_w1, data.sa_w2, data.sa_w3, data.sa_w4, data.sa_w5].map(v => v ?? null);
                const validOuk = oukWeeks.filter(v => v !== null);
                const oukTotal = validOuk.length ? validOuk.reduce((s,v)=>s+v,0)/validOuk.length : null;
                const validSa = saWeeks.filter(v => v !== null);
                const saTotal = validSa.length ? validSa.reduce((s,v)=>s+v,0)/validSa.length : null;

                googleData.push({
                    id: d.id, name: data.name, role: data.role || 'Не указана',
                    oukWeeks, oukTotal, saWeeks, saTotal, rawData: data.history_weeks || {}
                });
            }
        });
    } catch(e) { console.error(e); }
}

window.openDetailedWeekModal = function(user, weekNum) {
    const modal = document.getElementById('weekDetailsModal');
    document.getElementById('weekModalTitle').innerText = `Детализация Чек-листа за ${weekNum} неделю`;
    document.getElementById('weekModalEmpName').innerText = user.name;

    const hData = user.rawData && user.rawData[`w${weekNum}`] ? user.rawData[`w${weekNum}`] : null;
    const tBody = document.getElementById('weekModalTableRows');
    tBody.innerHTML = '';

    if (!hData || !hData.criteria) {
        tBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">Разговоры за эту неделю ещё не импортировались руководителем.</td></tr>';
        document.getElementById('weekModalSaValue').innerText = '-';
        document.getElementById('weekModalSaValue').className = 'bg-none';
        modal.classList.remove('hidden');
        return;
    }

    hData.criteria.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="font-weight:600;">${c.name}</td>${c.calls.map(val => `<td style="text-align:center;">${val}</td>`).join('')}`;
        tBody.appendChild(tr);
    });

    const finalOuk = hData.finalOukRows || ['-', '-', '-', '-', '-'];
    const trOuk = document.createElement('tr');
    trOuk.innerHTML = `<td style="font-weight:700; background:var(--input-bg);">ИТОГОВЫЙ ОУК РАЗГОВОРОВ</td>
        ${finalOuk.map(v => `<td style="text-align:center; font-weight:700;" class="${getOukClass(parseFloat(v))}">${v}${isNaN(parseFloat(v)) ? '' : '%'}</td>`).join('')}`;
    tBody.appendChild(trOuk);

    const saVal = hData.saValue !== null ? parseFloat(hData.saValue) : null;
    document.getElementById('weekModalSaValue').innerText = saVal !== null ? `${saVal.toFixed(1)}%` : '-';
    document.getElementById('weekModalSaValue').className = getSaClass(saVal);

    modal.classList.remove('hidden');
};

function safeTrim(v) { return typeof v === 'string' ? v.trim() : (v ? String(v).trim() : ''); }
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
                <div class="weeks-mini-row">${user.oukWeeks.map((v, i) => `<div class="week-mini-box ${getOukClass(v)}" style="cursor:pointer;" id="oukClick-${user.id}-${i+1}">${fmt(v)}</div>`).join('')}</div></div></td>
            <td><div class="metric-cell-wrapper"><div class="total-score-badge ${getSaClass(user.saTotal)}">${fmt(user.saTotal)}%</div>
                <div class="weeks-mini-row">${user.saWeeks.map((v, i) => `<div class="week-mini-box ${getSaClass(v)}" style="cursor:pointer;" id="saClick-${user.id}-${i+1}">${fmt(v)}</div>`).join('')}</div></div></td>`;
        rows.appendChild(tr);

        for(let w = 1; w <= 5; w++) {
            document.getElementById(`oukClick-${user.id}-${w}`).addEventListener('click', () => window.openDetailedWeekModal(user, w));
            document.getElementById(`saClick-${user.id}-${w}`).addEventListener('click', () => window.openDetailedWeekModal(user, w));
        }
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
