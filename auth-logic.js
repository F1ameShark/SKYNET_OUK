import { auth, db, app } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { startDashboard } from "./dashboard-logic.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

export let currentUserProfile = null;
const ui = {
    authScreen: document.getElementById('authScreen'), mainScreen: document.getElementById('mainScreen'),
    userDisplayName: document.getElementById('userDisplayName'), userRoleBadge: document.getElementById('userRoleBadge'),
    authError: document.getElementById('authError'), modalAdminMessage: document.getElementById('modalAdminMessage'),
    settingsPanel: document.getElementById('settingsPanel'), leaderPanel: document.getElementById('leaderPanel'),
    userManagementRows: document.getElementById('userManagementRows'), usersModal: document.getElementById('usersModal'),
    openUsersModalBtn: document.getElementById('openUsersModalBtn'), closeUsersModalBtn: document.getElementById('closeUsersModalBtn'),
    spreadsheetUrlInput: document.getElementById('spreadsheetUrlInput')
};

export async function getUserTeamsMap() {
    const m = {}; try { const s = await getDocs(collection(db, "users")); s.forEach(d => { if(d.data().name) m[d.data().name.toLowerCase().trim()] = d.data().teamName; }); } catch(e){} return m;
}

onAuthStateChanged(auth, async (u) => {
    if (u) {
        let d = await getDoc(doc(db, "users", u.uid));
        if (!d.exists()) { alert("Ваш профиль отсутствует в базе данных."); await signOut(auth); return; }
        currentUserProfile = d.data(); currentUserProfile.uid = u.uid;
        ui.userDisplayName.innerText = currentUserProfile.name; ui.userRoleBadge.innerText = currentUserProfile.role === 'leader' ? 'Руководитель' : 'Сотрудник';
        ui.authScreen.classList.add('hidden'); ui.mainScreen.classList.remove('hidden');
        
        const cfgDoc = await getDoc(doc(db, "system", "config"));
        if (cfgDoc.exists() && ui.spreadsheetUrlInput) ui.spreadsheetUrlInput.value = cfgDoc.data().currentCsvUrl || "";

        startDashboard(currentUserProfile);
        if (currentUserProfile.role === 'leader') { ui.openUsersModalBtn.classList.remove('hidden'); loadUserManagementList(); }
    } else { ui.mainScreen.classList.add('hidden'); ui.authScreen.classList.remove('hidden'); ui.openUsersModalBtn.classList.add('hidden'); }
});

ui.openUsersModalBtn.addEventListener('click', () => { ui.usersModal.classList.remove('hidden'); loadUserManagementList(); });
ui.closeUsersModalBtn.addEventListener('click', () => ui.usersModal.classList.add('hidden'));

document.getElementById('loginBtn').addEventListener('click', async () => {
    try { await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value, document.getElementById('loginPassword').value); } catch(e){ ui.authError.innerText="Ошибка авторизации."; }
});
document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));
document.getElementById('toggleSettingsBtn').addEventListener('click', () => { ui.settingsPanel.classList.toggle('hidden'); });
document.getElementById('syncTableBtn').addEventListener('click', async () => {
    const targetWeek = document.getElementById('syncWeekSelect').value;
    const rawUrl = ui.spreadsheetUrlInput.value.trim();
    if (!rawUrl) { alert("Вставьте ссылку на главную таблицу ОУК!"); return; }

    const mainMatches = rawUrl.match(/\/d\/([a-zA-DR0-9-_]+)/);
    if (!mainMatches) { alert("Неверный формат ссылки!"); return; }
    
    const baseProxy = "https://google.com";
    const mainCsvUrl = `${baseProxy}${mainMatches[1]}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent('Общее')}`;

    ui.modalAdminMessage.style.color = "var(--primary)";
    ui.modalAdminMessage.innerText = `Подключение к листу "Общее" и извлечение карты ссылок...`;

    try {
        await setDoc(doc(db, "system", "config"), { currentCsvUrl: rawUrl }, { merge: true });

        // 1. Считываем служебный JSON листа "Общее" для обхода CORS
        const mainRes = await fetch(mainCsvUrl);
        let mainText = await mainRes.text();
        mainText = mainText.replace(/^[^{]*{/, '{').replace(/}[^}]*$/, '}');
        const mainJson = JSON.parse(mainText);
        
        const personalLinksMap = {};

        // Сканируем строки по структуре ОУК ботов (колонки АО, ТехПо, Чатеры)
        mainJson.table.rows.forEach(row => {
            if (!row || !row.c) return;
            row.c.forEach((cell, idx) => {
                if (cell && cell.v && cell.v.toString().includes('http')) {
                    // Имя сотрудника всегда находится на две колонки левее ссылки
                    const nameCell = row.c[idx - 2];
                    if (nameCell && nameCell.v) {
                        personalLinksMap[nameCell.v.toString().toLowerCase().trim()] = cell.v.toString().trim();
                    }
                }
            });
        });

        // 2. Получаем специалистов из Firebase
        const snap = await getDocs(collection(db, "users"));
        const employees = [];
        snap.forEach(d => { if(d.data().role === 'employee') employees.push({ id: d.id, name: d.data().name }); });

        let successCount = 0;

        // 3. Сканируем личные вкладки сотрудников по логике твоего Node.js скрипта
        for (const emp of employees) {
            try {
                const empUrl = personalLinksMap[emp.name.toLowerCase().trim()];
                if (!empUrl) continue;

                const empMatches = empUrl.match(/\/d\/([a-zA-DR0-9-_]+)/);
                if (!empMatches) continue;

                // Запрашиваем JSON-поток конкретного листа сотрудника
                const empCsvUrl = `${baseProxy}${empMatches[1]}/gviz/tq?tqx=out:json`;
                const response = await fetch(empCsvUrl);
                if (!response.ok) continue;

                let empText = await response.text();
                empText = empText.replace(/^[^{]*{/, '{').replace(/}[^}]*$/, '}');
                const empJson = JSON.parse(empText);

                const lines = empJson.table.rows.map(r => r.c ? r.c.map(c => c ? (c.f || c.v || '') : '') : []);

                let weekOukVal = null; let weekSaVal = null;
                let finalOukRows = ['-', '-', '-', '-', '-']; const criteriaRows = [];

                lines.forEach((rowCells, index) => {
                    if (!rowCells || rowCells.length === 0) return;
                    const firstCellText = rowCells[0] ? rowCells[0].toString().toLowerCase().trim() : '';

                    // Парсим строки 3-13 (индексы 2-12) — критерии качества из твоего бота
                    if (index >= 2 && index <= 12) {
                        const callValues = [];
                        for (let col = 2; col <= 6; col++) {
                            callValues.push(rowCells[col] !== undefined && rowCells[col] !== '' ? rowCells[col].toString().trim() : '-');
                        }
                        criteriaRows.push({ name: rowCells[0] || `Критерий`, calls: callValues });
                    }
                    // Результат ОУК звонков оператора (строка 16 -> индекс 15)
                    if (index === 15 || firstCellText.includes('итоговый оук') || firstCellText.includes('результат')) {
                        const oukCalls = [];
                        for (let col = 2; col <= 6; col++) { oukCalls.push(rowCells[col] !== undefined && rowCells[col] !== '' ? rowCells[col].toString().trim() : '-'); }
                        finalOukRows = oukCalls;
                        weekOukVal = parseNumLocal(rowCells[7]); // Общий итог из колонки H
                    }
                    // Оценка SA (строка 28 -> индекс 27)
                    if (index === 27 || firstCellText.includes('sa') || firstCellText.includes('оценка sa')) {
                        weekSaVal = parseNumLocal(rowCells[2]); // Ячейка C28
                    }
                });

                const weekPackage = { oukValue: weekOukVal, saValue: weekSaVal, criteria: criteriaRows, finalOukRows: finalOukRows };

                const userRef = doc(db, "users", emp.id);
                const updateFields = {};
                updateFields[`ouk_w${targetWeek}`] = weekOukVal;
                updateFields[`sa_w${targetWeek}`] = weekSaVal;
                updateFields[`history_weeks.w${targetWeek}`] = weekPackage;

                await updateDoc(userRef, updateFields);
                successCount++;
            } catch (err) { console.warn(`Ошибка парсинга листа для ${emp.name}:`, err); }
        }

        ui.modalAdminMessage.style.color = "var(--success)";
        ui.modalAdminMessage.innerText = `Успешно! Синхронизировано персональных таблиц для ${successCount} специалистов.`;
        startDashboard(currentUserProfile);
    } catch (e) { ui.modalAdminMessage.style.color = "var(--danger)"; ui.modalAdminMessage.innerText = "Ошибка разбора структуры Google Docs."; console.error(e); }
});

document.getElementById('clearScoresBtn').addEventListener('click', async () => {
    if(!confirm("Стереть все оценки текущего месяца?")) return;
    try {
        const snap = await getDocs(collection(db, "users")); const batch = writeBatch(db);
        snap.forEach(d => { if(d.data().role === 'employee') batch.update(doc(db, "users", d.id), { ouk_w1:null, ouk_w2:null, ouk_w3:null, ouk_w4:null, ouk_w5:null, sa_w1:null, sa_w2:null, sa_w3:null, sa_w4:null, sa_w5:null, history_weeks:{} }); });
        await batch.commit(); ui.modalAdminMessage.innerText = "Архив очищен."; startDashboard(currentUserProfile);
    } catch(e){}
});

function parseNumLocal(v) { if(!v) return null; v=v.toString().trim().replace('%','').replace(',','.'); let n=parseFloat(v); return isNaN(n)?null:n; }

document.getElementById('registerUserBtn').addEventListener('click', async () => {
    const name = document.getElementById('regName').value.trim(); const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const team = document.getElementById('regTeam').value.trim() || "Основная";
    if(!name || !email) return;
    const secApp = initializeApp(app.options, "SecondaryContext"); const secAuth = getAuth(secApp);
    try {
        const cred = await createUserWithEmailAndPassword(secAuth, email, "123456");
        await setDoc(doc(db, "users", cred.user.uid), { name: name, email: email, role: "employee", teamName: team, history_weeks:{} });
        ui.modalAdminMessage.style.color = "var(--success)"; ui.modalAdminMessage.innerText = "Сотрудник добавлен!";
        document.getElementById('regName').value=""; document.getElementById('regEmail').value=""; loadUserManagementList(); startDashboard(currentUserProfile);
    } catch(e) { ui.modalAdminMessage.innerText = "Ошибка."; } finally { await secApp.delete(); }
});

async function loadUserManagementList() {
    if (!ui.userManagementRows) return;
    try {
        const snap = await getDocs(collection(db, "users")); ui.userManagementRows.innerHTML = '';
        snap.forEach((d) => {
            const uData = d.data(); const uId = d.id; if (uData.role === 'leader') return;
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><strong>${uData.name}</strong></td><td>${uData.email||'-'}</td>
                <td><input type="text" class="sm-input" id="team-${uId}" value="${uData.teamName||'Без команды'}"><button class="btn btn-sm" style="background:#4a5568;color:white;margin-left:4px;" onclick="window.updateUserTeam('${uId}')">💾</button></td>
                <td><input type="password" class="sm-input" id="pass-${uId}" placeholder="Ввести новый"></td>
                <td><button class="btn btn-sm" style="background:#2f855a;color:white;" onclick="window.updateUserPasswordAdmin('${uId}')">Сменить</button>
                <button class="btn btn-sm btn-danger" onclick="window.deleteUserAdmin('${uId}')">Удалить</button></td>`;
            ui.userManagementRows.appendChild(tr);
        });
    } catch (e) {}
}

window.updateUserTeam = async function(id) { try { await updateDoc(doc(db, "users", id), { teamName: document.getElementById(`team-${id}`).value.trim() }); startDashboard(currentUserProfile); } catch (e) {} };
window.updateUserPasswordAdmin = async function(id) { const p = document.getElementById(`pass-${id}`); if (!p || p.value.length < 6) return; try { await updateDoc(doc(db, "users", id), { forceNewPassword: p.value }); alert("Успешно"); p.value = ""; } catch (e) {} };
window.deleteUserAdmin = async function(id) { if (!confirm("Удалить?")) return; try { await deleteDoc(doc(db, "users", id)); loadUserManagementList(); startDashboard(currentUserProfile); } catch (e) {} };

