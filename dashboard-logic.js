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
