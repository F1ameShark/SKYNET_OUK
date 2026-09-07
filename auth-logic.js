import { auth, db, app } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { startDashboard } from "./dashboard-logic.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

// Прямой локальный импорт движка Excel без CORS блокировок
import * as XLSX from "./xlsx.full.mjs";

export let currentUserProfile = null;
const ui = {
    authScreen: document.getElementById('authScreen'), mainScreen: document.getElementById('mainScreen'),
    userDisplayName: document.getElementById('userDisplayName'), userRoleBadge: document.getElementById('userRoleBadge'),
    authError: document.getElementById('authError'), modalAdminMessage: document.getElementById('modalAdminMessage'),
    settingsPanel: document.getElementById('settingsPanel'), leaderPanel: document.getElementById('leaderPanel'),
    userManagementRows: document.getElementById('userManagementRows'), usersModal: document.getElementById('usersModal'),
    openUsersModalBtn: document.getElementById('openUsersModalBtn'), closeUsersModalBtn: document.getElementById('closeUsersModalBtn'),
    excelFileInput: document.getElementById('excelFileInput')
};

export async function getUserTeamsMap() {
    const m = {}; try { const s = await getDocs(collection(db, "users")); s.forEach(d => { if(d.data().name) m[d.data().name.toLowerCase().trim()] = d.data().teamName; }); } catch(e){} return m;
}

onAuthStateChanged(auth, async (u) => {
    if (u) {
        let d = await getDoc(doc(db, "users", u.uid));
        if (!d.exists()) { alert("Профиль отсутствует."); await signOut(auth); return; }
        currentUserProfile = d.data(); currentUserProfile.uid = u.uid;
        ui.userDisplayName.innerText = currentUserProfile.name; ui.userRoleBadge.innerText = currentUserProfile.role === 'leader' ? 'Руководитель' : 'Сотрудник';
        ui.authScreen.classList.add('hidden'); ui.mainScreen.classList.remove('hidden');
        startDashboard(currentUserProfile);
        if (currentUserProfile.role === 'leader') { ui.openUsersModalBtn.classList.remove('hidden'); loadUserManagementList(); }
    } else { ui.mainScreen.classList.add('hidden'); ui.authScreen.classList.remove('hidden'); ui.openUsersModalBtn.classList.add('hidden'); }
});

ui.openUsersModalBtn.addEventListener('click', () => { ui.usersModal.classList.remove('hidden'); loadUserManagementList(); });
ui.closeUsersModalBtn.addEventListener('click', () => ui.usersModal.classList.add('hidden'));

document.getElementById('loginBtn').addEventListener('click', async () => {
    try { await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value, document.getElementById('loginPassword').value); } catch(e){ ui.authError.innerText="Ошибка."; }
});
document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));
document.getElementById('toggleSettingsBtn').addEventListener('click', () => { ui.settingsPanel.classList.toggle('hidden'); });
document.getElementById('syncTableBtn').addEventListener('click', async () => {
    const targetWeek = document.getElementById('syncWeekSelect').value;
    const fileFile = document.getElementById('excelFileInput')?.files[0];
    if (!fileFile) { alert("Выберите скачанный файл Excel (.xlsx)!"); return; }

    ui.modalAdminMessage.style.color = "var(--primary)";
    ui.modalAdminMessage.innerText = `Парсинг вкладок Excel по логике Телеграм-Бота за ${targetWeek} неделю...`;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const dataBytes = new Uint8Array(e.target.result);
            const workbook = XLSX.read(dataBytes, { type: 'array' });
            
            const snap = await getDocs(collection(db, "users"));
            const employees = [];
            snap.forEach(d => { if(d.data().role === 'employee') employees.push({ id: d.id, name: d.data().name }); });

            let successCount = 0;

            for (const emp of employees) {
                // Ищем лист сотрудника (Имя вкладки в Excel == ФИО сотрудника) как в твоем боте
                const sheetName = workbook.SheetNames.find(s => s.trim().toLowerCase() === emp.name.toLowerCase().trim());
                if (!sheetName) continue;

                const worksheet = workbook.Sheets[sheetName];
                const lines = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
                
                let weekOukVal = null; let weekSaVal = null;
                let finalOukRows = ['-', '-', '-', '-', '-']; const criteriaRows = [];

                lines.forEach((rowCells, index) => {
                    if (!rowCells || rowCells.length === 0) return;
                    const firstCellText = rowCells[0] ? rowCells[0].toString().toLowerCase().trim() : '';

                    // Логика твоего бота: строки 3-13 (индексы 2-12) — критерии качества
                    if (index >= 2 && index <= 12) {
                        const callValues = [];
                        for (let col = 2; col <= 6; col++) {
                            callValues.push(rowCells[col] !== undefined && rowCells[col] !== '' ? rowCells[col].toString().trim() : '-');
                        }
                        criteriaRows.push({ name: rowCells[0] || `Критерий качества`, calls: callValues });
                    }

                    // Логика твоего бота: строка 16 (индекс 15) — итоговый ОУК звонков оператора
                    if (index === 15 || firstCellText.includes('итоговый оук') || firstCellText.includes('результат')) {
                        const oukCalls = [];
                        for (let col = 2; col <= 6; col++) {
                            oukCalls.push(rowCells[col] !== undefined && rowCells[col] !== '' ? rowCells[col].toString().trim() : '-');
                        }
                        finalOukRows = oukCalls;
                        weekOukVal = parseNumLocal(rowCells[7]); // Общий итог недели из колонки H (индекс 7)
                    }

                    // Логика твоего бота: ячейка C28 (строка 28 -> индекс 27, колонка C -> индекс 2) — Оценка SA
                    if (index === 27 || firstCellText.includes('оценка sa') || firstCellText.includes('sa')) {
                        weekSaVal = parseNumLocal(rowCells[2]); 
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
            }

            ui.modalAdminMessage.style.color = "var(--success)";
            ui.modalAdminMessage.innerText = `Готово! Из файла Excel импортированы детальные чек-листы для ${successCount} специалистов.`;
            startDashboard(currentUserProfile);
        } catch (err) {
            ui.modalAdminMessage.style.color = "var(--danger)"; ui.modalAdminMessage.innerText = "Ошибка чтения структуры Excel."; console.error(err);
        }
    };
    reader.readAsArrayBuffer(fileFile);
});

document.getElementById('clearScoresBtn').addEventListener('click', async () => {
    if(!confirm("Стереть все оценки текущего месяца?")) return;
    try {
        const snap = await getDocs(collection(db, "users")); const batch = writeBatch(db);
        snap.forEach(d => { if(d.data().role === 'employee') batch.update(doc(db, "users", d.id), { ouk_w1:null, ouk_w2:null, ouk_w3:null, ouk_w4:null, ouk_w5:null, sa_w1:null, sa_w2:null, sa_w3:null, sa_w4:null, sa_w5:null, history_weeks:{} }); });
        await batch.commit(); ui.modalAdminMessage.innerText = "Архив очищен."; startDashboard(currentUserProfile);
    } catch(e){}
});

function parseNumLocal(v) { if(v === undefined || v === null || v === '') return null; v=v.toString().trim().replace('%','').replace(',','.'); let n=parseFloat(v); return isNaN(n)?null:n; }

document.getElementById('registerUserBtn').addEventListener('click', async () => {
    const name = document.getElementById('regName').value.trim(); const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const team = document.getElementById('regTeam').value.trim() || "Основная";
    if(!name || !email) return;
    const secApp = initializeApp(app.options, "SecondaryContext"); const secAuth = getAuth(secApp);
    try {
        const cred = await createUserWithEmailAndPassword(secAuth, email, "123456");
        await setDoc(doc(db, "users", cred.user.uid), { name: name, email: email, role: "employee", teamName: team, history_weeks:{} });
        ui.modalAdminMessage.style.color = "var(--success)"; ui.modalAdminMessage.innerText = "Создан!";
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
