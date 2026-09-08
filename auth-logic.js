import { auth, db, app } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { startDashboard } from "./dashboard-logic.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const ui = {
    authScreen: document.getElementById('authScreen'), mainScreen: document.getElementById('mainScreen'),
    userDisplayName: document.getElementById('userDisplayName'), userRoleBadge: document.getElementById('userRoleBadge'),
    authError: document.getElementById('authError'), modalAdminMessage: document.getElementById('modalAdminMessage'),
    settingsPanel: document.getElementById('settingsPanel'), leaderPanel: document.getElementById('leaderPanel'),
    userManagementRows: document.getElementById('userManagementRows'), usersModal: document.getElementById('usersModal'),
    openUsersModalBtn: document.getElementById('openUsersModalBtn'), closeUsersModalBtn: document.getElementById('closeUsersModalBtn'),
    excelFileInput: document.getElementById('excelFileInput')
};
export let currentUserProfile = null;

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
    const filesList = ui.excelFileInput ? ui.excelFileInput.files : null;
    if (!filesList || filesList.length === 0) { alert("Выберите файл Excel (.xlsx)!"); return; }

    ui.modalAdminMessage.style.color = "var(--primary)";
    ui.modalAdminMessage.innerText = `Обработка файла Excel за ${targetWeek} неделю...`;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const currentXLSX = window.XLSX;
            if (!currentXLSX) { alert("Ошибка инициализации XLSX в браузере."); return; }

            const dataBytes = new Uint8Array(e.target.result);
            const workbook = currentXLSX.read(dataBytes, { type: 'array' });
            const sheetName = workbook.SheetNames[0]; // Берем самый первый плоский лист
            const worksheet = workbook.Sheets[sheetName];
            const lines = currentXLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

            const snap = await getDocs(collection(db, "users"));
            const employees = [];
            snap.forEach(d => { if(d.data().role === 'employee') employees.push({ id: d.id, name: d.data().name }); });

            let successCount = 0;

            // Сканируем плоский лист построчно
            for (let i = 0; i < lines.length; i++) {
                const row = lines[i];
                if (!row || row.length === 0) continue;
                
                const rowText = row.join(' ').toLowerCase();

                // Находим маркер начала блока сотрудника
                if (rowText.includes('skyservice') && rowText.includes('ос по разговорам')) {
                    // ФИО всегда в строке прямо над маркером SkyService
                    const metaRow = lines[i - 1];
                    const metaText = metaRow ? metaRow.join(' ').toLowerCase() : '';

                    const matchedEmp = employees.find(emp => metaText.includes(emp.name.toLowerCase().trim()));
                    if (!matchedEmp) continue;

                    let weekOukVal = null; let weekSaVal = null;
                    let finalOukRows = ['-', '-', '-', '-', '-']; const criteriaRows = [];

                    // Собираем данные блока вниз от текущей строки i
                    for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
                        const subRow = lines[j];
                        if (!subRow || subRow.length === 0) continue;

                        const firstCell = subRow[0] ? subRow[0].toString().toLowerCase().trim() : '';

                        // Забираем критерии качества звонков (строки 3-13 относительно блока)
                        if (j >= i + 2 && j <= i + 12) {
                            const calls = [];
                            for (let col = 2; col <= 6; col++) {
                                calls.push(subRow[col] !== undefined && subRow[col] !== '' ? subRow[col].toString().trim() : '-');
                            }
                            criteriaRows.push({ name: subRow[0] || 'Критерий', calls: calls });
                        }

                        // Забираем строку итогового ОУК (строка 16 относительно блока)
                        if (j === i + 13 || firstCell.includes('итоговый оук') || firstCellText.includes('результат')) {
                            const oukCalls = [];
                            for (let col = 2; col <= 6; col++) {
                                oukCalls.push(subRow[col] !== undefined && subRow[col] !== '' ? subRow[col].toString().trim() : '-');
                            }
                            finalOukRows = oukCalls;
                        }

                        // Вытаскиваем итоговые недельные проценты
                        if (firstCell === 'оценка оук') weekOukVal = parseNumLocal(subRow[1]);
                        if (firstCell === 'оценка sa') weekSaVal = parseNumLocal(subRow[1]);
                        
                        // Если уперлись в следующий блок SkyService — прерываем этот внутренний цикл
                        if (j > i + 5 && subRow.join(' ').toLowerCase().includes('skyservice')) break;
                    }

                    // Отправляем пакет в Firestore
                    const weekPackage = { oukValue: weekOukVal, saValue: weekSaVal, criteria: criteriaRows, finalOukRows: finalOukRows };
                    await updateDoc(doc(db, "users", matchedEmp.id), {
                        [`ouk_w${targetWeek}`]: weekOukVal,
                        [`sa_w${targetWeek}`]: weekSaVal,
                        [`history_weeks.w${targetWeek}`]: weekPackage
                    });
                    successCount++;
                }
            }

            ui.modalAdminMessage.style.color = "var(--success)";
            ui.modalAdminMessage.innerText = `Успешно! Обновлены данные для ${successCount} специалистов.`;
            startDashboard(currentUserProfile);
        } catch (err) {
            ui.modalAdminMessage.style.color = "var(--danger)"; ui.modalAdminMessage.innerText = "Ошибка парсинга файла."; console.error(err);
        }
    };
    reader.readAsArrayBuffer(filesList.item(0));
});

document.getElementById('clearScoresBtn').addEventListener('click', async () => {
    if(!confirm("Стереть все оценки текущего месяца?")) return;
    try {
        const snap = await getDocs(collection(db, "users")); const batch = writeBatch(db);
        snap.forEach(d => { if(d.data().role === 'employee') batch.update(doc(db, "users", d.id), { ouk_w1:null, ouk_w2:null, ouk_w3:null, ouk_w4:null, ouk_w5:null, sa_w1:null, sa_w2:null, sa_w3:null, sa_w4:null, sa_w5:null, history_weeks:{} }); });
        await batch.commit(); ui.modalAdminMessage.innerText = "Архив очищен."; startDashboard(currentUserProfile);
    } catch(e){}
});

function parseNumLocal(v) { if(v === undefined || v === null || v === '') return null; let s = v.toString().trim().replace('%','').replace(',','.'); let n = parseFloat(s); return isNaN(n) ? null : n; }

document.getElementById('registerUserBtn').addEventListener('click', async () => {
    const name = document.getElementById('regName').value.trim(); const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const team = document.getElementById('regTeam').value.trim() || "Основная";
    if(!name || !email) return;
    const secApp = initializeApp(app.options, "SecondaryContext"); const secAuth = getAuth(secApp);
    try {
        const cred = await createUserWithEmailAndPassword(secAuth, email, "123456");
        await setDoc(doc(db, "users", cred.user.uid), { name: name, email: email, role: "employee", teamName: team, history_weeks:{} });
        ui.modalAdminMessage.style.color = "var(--success)"; ui.modalAdminMessage.innerText = "Добавлен!";
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
