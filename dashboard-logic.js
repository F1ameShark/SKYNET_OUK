import { db } from "./firebase-config.js";
import { collection, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getUserTeamsMap } from "./auth-logic.js";

let allEmployees = []; 
let filteredData = [];
let currentMode = "my_team";
let sortStates = { name: false, team: false, ouk: true, sa: true };
let currentLeaderProfile = null;

export async function startDashboard(userProfile) {
    currentLeaderProfile = userProfile;
    await fetchEmployeesFromFirestore();
    globalUserTeamsMap = await getUserTeamsMap();
    
    document.getElementById('loader').style.display = 'none';
    document.getElementById('listContainer').classList.remove('hidden');

    const btnMyTeam = document.getElementById('viewMyTeamBtn');
    const btnAllStaff = document.getElementById('viewAllStaffBtn');
    const leaderPanel = document.getElementById('leaderPanel');
    const statsBar = document.getElementById('statsBar');
    const controlsBar = document.getElementById('controlsBar');

    if (userProfile.role === 'leader') {
        if(btnMyTeam) { btnMyTeam.style.display = 'inline-block'; btnMyTeam.classList.add('tab-active'); }
        if(btnAllStaff) btnAllStaff.style.display = 'inline-block';
        if(leaderPanel) leaderPanel.classList.remove('hidden');
        if(statsBar) statsBar.classList.remove('hidden');
        if(controlsBar) controlsBar.classList.remove('hidden');
        
        const teamInput = document.getElementById('newTeamName');
        if (teamInput) teamInput.placeholder = userProfile.teamName || "Укажите вашу команду";
        
        setupTabListeners();
        applyActiveFilter();
    } else {
        if(btnMyTeam) btnMyTeam.style.display = 'none';
        if(btnAllStaff) btnAllStaff.style.display = 'none';
        if(leaderPanel) leaderPanel.classList.add('hidden');
        if(statsBar) statsBar.classList.add('hidden');
        if(controlsBar) controlsBar.classList.add('hidden');
        
        filteredData = allEmployees.filter(u => u.name.toLowerCase() === userProfile.name.toLowerCase());
        renderList(filteredData);
    }
    setupSortListeners();
    setupTeamSaveListener();
}

async function fetchEmployeesFromFirestore() {
    try {
        const snap = await getDocs(collection(db, "users"));
        allEmployees = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.role === 'employee') {
                const oukWeeks = [data.ouk_w1, data.ouk_w2, data.ouk_w3, data.ouk_w4, data.ouk_w5].map(v => v ?? null);
                const saWeeks = [data.sa_w1, data.sa_w2, data.sa_w3, data.sa_w4, data.sa_w5].map(v => v ?? null);
                allEmployees.push({
                    id: d.id, name: data.name, role: data.role || 'Не указана',
                    teamName: data.teamName || data.team || 'Без команды',
                    oukWeeks, oukTotal: data.ouk_total ?? null,
                    saWeeks, saTotal: data.sa_total ?? null,
                    rawData: data.history_weeks || {}
                });
            }
        });
    } catch(e) { console.error(e); }
}

function setupTabListeners() {
    const btnMyTeam = document.getElementById('viewMyTeamBtn');
    const btnAllStaff = document.getElementById('viewAllStaffBtn');
    if(!btnMyTeam || !btnAllStaff || btnMyTeam.dataset.hooked) return;

    btnMyTeam.addEventListener('click', () => {
        currentMode = "my_team";
        btnMyTeam.classList.add('tab-active');
        btnAllStaff.classList.remove('tab-active');
        applyActiveFilter();
    });

    btnAllStaff.addEventListener('click', () => {
        currentMode = "all_staff";
        btnAllStaff.classList.add('tab-active');
        btnMyTeam.classList.remove('tab-active');
        applyActiveFilter();
    });
    btnMyTeam.dataset.hooked = true;
}

function applyActiveFilter() {
    const leaderTeam = (currentLeaderProfile.teamName || '').toLowerCase().trim();
    if (currentMode === "my_team") {
        filteredData = allEmployees.filter(u => (u.teamName || '').toLowerCase().trim() === leaderTeam);
        updateStats(filteredData);
        sortData('ouk', true);
    } else {
        filteredData = [...allEmployees];
        updateStats(allEmployees);
        sortData('team', false);
    }
}
window.openDetailedWeekModal = function(user, weekNum) {
    const modal = document.getElementById('weekDetailsModal');
    document.getElementById('weekModalTitle').innerText = "Детализация за " + weekNum + " неделю";
    document.getElementById('weekModalEmpName').innerText = user.name;

    let hData = user.rawData && user.rawData["w" + weekNum] ? user.rawData["w" + weekNum] : null;
    if (typeof hData === 'string') { try { hData = JSON.parse(hData); } catch(e) { hData = null; } }
    const tBody = document.getElementById('weekModalTableRows'); tBody.innerHTML = '';

    if (!hData || !hData.criteria) {
        const fbOuk = user.oukWeeks[weekNum - 1]; const fbSa = user.saWeeks[weekNum - 1];
        tBody.innerHTML = "<tr><td colspan='6' style='text-align:center;padding:20px;color:var(--text-muted);'>Детализация звонков отсутствует. Оценка недели: ОУК " + fmt(fbOuk) + "% / SA " + fmt(fbSa) + "%</td></tr>";
        document.getElementById('weekModalSaValue').innerText = fmt(fbOuk) + "%";
        document.getElementById('weekModalSaValue').className = getOukClass(fbOuk);
        modal.classList.remove('hidden'); return;
    }

    hData.criteria.forEach(c => {
        const tr = document.createElement('tr'); let cells = "";
        c.calls.forEach(v => { cells += "<td style='text-align:center;'>" + v + "</td>"; });
        tr.innerHTML = "<td style='font-weight:600;'>" + c.name + "</td>" + cells; tBody.appendChild(tr);
    });

    const finalOuk = hData.finalOukRows || ['-', '-', '-', '-', '-'];
    const trOuk = document.createElement('tr'); let oukCells = "";
    finalOuk.forEach(v => { oukCells += "<td style='text-align:center; font-weight:700;' class='" + getOukClass(parseFloat(v)) + "'>" + v + (isNaN(parseFloat(v)) ? "" : "%") + "</td>"; });
    trOuk.innerHTML = "<td style='font-weight:700; background:var(--input-bg);'>ИТОГОВЫЙ ОУК РАЗГОВОРОВ</td>" + oukCells; tBody.appendChild(trOuk);

    const saVal = hData.saValue !== null ? parseFloat(hData.saValue) : null;
    document.getElementById('weekModalSaValue').innerText = saVal !== null ? saVal.toFixed(1) + "%" : '-';
    document.getElementById('weekModalSaValue').className = getSaClass(saVal);
    modal.classList.remove('hidden');
};

let globalUserTeamsMap = {};
function getOukClass(v) { return v === null ? 'bg-none' : (v >= 90 ? 'bg-good' : (v >= 85 ? 'bg-normal' : 'bg-bad')); }
function getSaClass(v) { return (v === null || isNaN(v)) ? 'bg-none' : (v >= 85 ? 'bg-good' : (v >= 70 ? 'bg-normal' : 'bg-bad')); }
function fmt(v) { return (v === null || isNaN(v)) ? '-' : v.toFixed(1); }

function sortData(field, forceDirection = null) {
    let isDescending = forceDirection !== null ? forceDirection : sortStates[field];
    if (forceDirection === null) sortStates[field] = !sortStates[field];
    filteredData.sort((a, b) => {
        let valA, valB;
        if (field === 'name') { valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); return isDescending ? valB.localeCompare(valA) : valA.localeCompare(valB); }
        if (field === 'team') { valA = a.teamName.toLowerCase(); valB = b.teamName.toLowerCase(); return isDescending ? valB.localeCompare(valA) : valA.localeCompare(valB); }
        if (field === 'ouk') { valA = a.oukTotal ?? -1; valB = b.oukTotal ?? -1; }
        if (field === 'sa') { valA = a.saTotal ?? -1; valB = b.saTotal ?? -1; }
        return isDescending ? valB - valA : valA - valB;
    });
    renderList(filteredData);
}

function setupSortListeners() {
    const bName = document.getElementById('sortName'); const bTeam = document.getElementById('sortTeam');
    const bOuk = document.getElementById('sortOuk'); const bSa = document.getElementById('sortSa');
    if(bName && !bName.dataset.hooked) { bName.addEventListener('click', () => sortData('name')); bName.dataset.hooked = true; }
    if(bTeam && !bTeam.dataset.hooked) { bTeam.addEventListener('click', () => sortData('team')); bTeam.dataset.hooked = true; }
    if(bOuk && !bOuk.dataset.hooked) { bOuk.addEventListener('click', () => sortData('ouk')); bOuk.dataset.hooked = true; }
    if(bSa && !bSa.dataset.hooked) { bSa.addEventListener('click', () => sortData('sa')); bSa.dataset.hooked = true; }
}

function renderList(data) {
    const rows = document.getElementById('mainListRows'); if(!rows) return; rows.innerHTML = '';
    if (data.length === 0) { rows.innerHTML = "<tr><td colspan='4' style='text-align:center;padding:30px;'>Ничего не найдено</td></tr>"; return; }
    
    data.forEach(user => {
        const currentTeam = user.teamName || 'Без команды';
        const tr = document.createElement('tr');
        let oukBoxes = ""; let saBoxes = "";
        user.oukWeeks.forEach((v, i) => { oukBoxes += "<div class='week-mini-box " + getOukClass(v) + "' style='cursor:pointer;' id='oukClick-" + user.id + "-" + (i+1) + "'>" + fmt(v) + "</div>"; });
        user.saWeeks.forEach((v, i) => { saBoxes += "<div class='week-mini-box " + getSaClass(v) + "' style='cursor:pointer;' id='saClick-" + user.id + "-" + (i+1) + "'>" + fmt(v) + "</div>"; });

        tr.innerHTML = "<td><div class='emp-profile'><div class='emp-avatar'>" + user.name.slice(0,2).toUpperCase() + "</div><div><div class='emp-name'>" + user.name + "</div><div class='emp-role-tag'>" + user.role + "</div></div></div></td>" +
            "<td><span class='emp-team-badge'>" + currentTeam + "</span></td>" +
            "<td><div class='metric-cell-wrapper'><div class='total-score-badge " + getOukClass(user.oukTotal) + "'>" + fmt(user.oukTotal) + "%</div><div class='weeks-mini-row'>" + oukBoxes + "</div></div></td>" +
            "<td><div class='metric-cell-wrapper'><div class='total-score-badge " + getSaClass(user.saTotal) + "'>" + fmt(user.saTotal) + "%</div><div class='weeks-mini-row'>" + saBoxes + "</div></div></td>";
        rows.appendChild(tr);
        
        for(let w = 1; w <= 5; w++) {
            const oukEl = document.getElementById("oukClick-" + user.id + "-" + w);
            const saEl = document.getElementById("saClick-" + user.id + "-" + w);
            if(oukEl) oukEl.addEventListener('click', () => window.openDetailedWeekModal(user, w));
            if(saEl) saEl.addEventListener('click', () => window.openDetailedWeekModal(user, w));
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

function setupTeamSaveListener() {
    const btn = document.getElementById('saveTeamNameBtn'); if(!btn || btn.dataset.hooked) return;
    btn.addEventListener('click', async () => {
        const val = document.getElementById('newTeamName').value.trim(); if(!val) return;
        try {
            await updateDoc(doc(db, "users", currentLeaderProfile.uid), { teamName: val });
            currentLeaderProfile.teamName = val; alert("Ваша команда обновлена!");
            startDashboard(currentLeaderProfile);
        } catch(e) { alert("Ошибка."); }
    });
    btn.dataset.hooked = true;
}

document.getElementById('searchInput').addEventListener('input', () => {
    const s = document.getElementById('searchInput').value.toLowerCase();
    renderList(filteredData.filter(u => u.name.toLowerCase().includes(s)));
});
