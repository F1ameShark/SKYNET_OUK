import { auth, db, app } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { startDashboard } from "./dashboard-logic.js";

// Дополнительный импорт ядра Firebase для создания изолированного фонового соединения
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

export let currentUserProfile = null;
const ui = {
    authScreen: document.getElementById('authScreen'), mainScreen: document.getElementById('mainScreen'),
    userDisplayName: document.getElementById('userDisplayName'), userRoleBadge: document.getElementById('userRoleBadge'),
    authError: document.getElementById('authError'), adminMessage: document.getElementById('adminMessage'),
    modalAdminMessage: document.getElementById('modalAdminMessage'), settingsMessage: document.getElementById('settingsMessage'),
    settingsPanel: document.getElementById('settingsPanel'), leaderPanel: document.getElementById('leaderPanel'),
    userManagementRows: document.getElementById('userManagementRows'), usersModal: document.getElementById('usersModal'),
    openUsersModalBtn: document.getElementById('openUsersModalBtn'), closeUsersModalBtn: document.getElementById('closeUsersModalBtn')
};

export async function getUserTeamsMap() {
    const teamsMap = {};
    try {
        const snap = await getDocs(collection(db, "users"));
        snap.forEach(d => { const data = d.data(); if (data.name && data.teamName) teamsMap[data.name.toLowerCase().trim()] = data.teamName; });
    } catch (e) { console.error(e); }
    return teamsMap;
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        let userDoc = await getDoc(doc(db, "users", user.uid));
        
        // ЕСЛИ ПОЛЬЗОВАТЕЛЯ НЕТ В БАЗЕ FIRESTORE — НЕ ДАЕМ ДОСТУП И ВЫВОДИМ ОШИБКУ
        if (!userDoc.exists()) {
            alert("Ваш аккаунт зарегистрирован, но профиль сотрудника отсутствует в базе данных. Обратитесь к руководителю.");
            await signOut(auth);
            return;
        }

        currentUserProfile = userDoc.data(); 
        currentUserProfile.uid = user.uid;
        ui.userDisplayName.innerText = currentUserProfile.name;
        ui.userRoleBadge.innerText = currentUserProfile.role === 'leader' ? 'Руководитель' : 'Сотрудник';
        ui.authScreen.classList.add('hidden'); 
        ui.mainScreen.classList.remove('hidden');
        startDashboard(currentUserProfile);
        
        if (currentUserProfile.role === 'leader') { 
            ui.openUsersModalBtn.classList.remove('hidden'); 
            loadUserManagementList(); 
        }
    } else {
        ui.mainScreen.classList.add('hidden'); 
        ui.authScreen.classList.remove('hidden'); 
        ui.openUsersModalBtn.classList.add('hidden');
    }
});

ui.openUsersModalBtn.addEventListener('click', () => { ui.usersModal.classList.remove('hidden'); loadUserManagementList(); });
ui.closeUsersModalBtn.addEventListener('click', () => ui.usersModal.classList.add('hidden'));
ui.usersModal.addEventListener('click', (e) => { if (e.target === ui.usersModal) ui.usersModal.classList.add('hidden'); });

document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value; const pass = document.getElementById('loginPassword').value;
    ui.authError.innerText = "";
    try { await signInWithEmailAndPassword(auth, email, pass); } catch (e) { ui.authError.innerText = "Неверный логин или пароль."; }
});
document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));
document.getElementById('toggleSettingsBtn').addEventListener('click', () => ui.settingsPanel.classList.remove('hidden'));

document.getElementById('changePasswordBtn').addEventListener('click', async () => {
    const nPass = document.getElementById('newPassword').value;
    if(nPass.length < 6) { ui.settingsMessage.style.color = "var(--danger)"; ui.settingsMessage.innerText = "Минимум 6 символов."; return; }
    try { await updatePassword(auth.currentUser, nPass); ui.settingsMessage.style.color = "var(--success)"; ui.settingsMessage.innerText = "Пароль изменен!"; document.getElementById('newPassword').value = ""; } 
    catch (e) { ui.settingsMessage.style.color = "var(--danger)"; ui.settingsMessage.innerText = "Ошибка. Перезайдите."; }
});

document.getElementById('saveTeamNameBtn').addEventListener('click', async () => {
    const team = document.getElementById('newTeamName').value.trim(); if (!team) return;
    await updateDoc(doc(db, "users", currentUserProfile.uid), { teamName: team });
    currentUserProfile.teamName = team; document.getElementById('adminMessage').style.color = "var(--success)";
    document.getElementById('adminMessage').innerText = "Команда сохранена!"; startDashboard(currentUserProfile);
});

document.getElementById('registerUserBtn').addEventListener('click', async () => {
    const name = document.getElementById('regName').value.trim(); const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const team = document.getElementById('regTeam').value.trim() || "Основная"; if(!name || !email) return;
    const secApp = initializeApp(app.options, "SecondaryContext"); const secAuth = getAuth(secApp);
    try {
        const cred = await createUserWithEmailAndPassword(secAuth, email, "123456");
        await setDoc(doc(db, "users", cred.user.uid), { name: name, email: email, role: "employee", teamName: team, history_weeks:{} });
        ui.modalAdminMessage.style.color = "var(--success)"; ui.modalAdminMessage.innerText = "Сотрудник добавлен!";
        document.getElementById('regName').value=""; document.getElementById('regEmail').value=""; loadUserManagementList(); startDashboard(currentUserProfile);
    } catch(e) { ui.modalAdminMessage.innerText = "Ошибка."; } finally { await secApp.delete(); }
});

// ПАРСЕР СВОДНОГО CSV-ОТЧЕТА РУКОВОДИТЕЛЕМ С АВТО-ОЧИСТКОЙ ИЗМЕНИВШИХСЯ И ПУСТЫХ ПОЛЕЙ
document.getElementById('syncMainCsvBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('mainCsvFileInput');
    const files = fileInput ? fileInput.files : null;
    if (!files || files.length === 0) { alert("Выберите скачанный CSV-файл для импорта!"); return; }

    ui.modalAdminMessage.style.color = "var(--primary)";
    ui.modalAdminMessage.innerText = "Считывание и синхронизация оценок с базой данных Firestore...";

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const text = e.target.result;
            const lines = text.split(/\r?\n/);
            const csvDataMap = {};

            // Парсим строки CSV-файла (пропуская шапку)
            for (let i = 2; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                const row = parseCsvRow(lines[i]);
                if (row.length < 17) continue;

                const fName = row[0].trim().toLowerCase().replace(/\s+/g, ' ');
                if (!fName || fName.includes('общая') || fName.startsWith('http')) continue;

                csvDataMap[fName] = {
                    oukWeeks: [row[2], row[3], row[4], row[5], row[6]].map(v => parseNumLocal(v)),
                    oukTotal: parseNumLocal(row[15]),
                    saWeeks: [row[8], row[9], row[10], row[11], row[12]].map(v => parseNumLocal(v)),
                    saTotal: parseNumLocal(row[16]),
                    role: row[1] ? row[1].trim() : 'Не указана'
                };
            }

            const snap = await getDocs(collection(db, "users"));
            let successCount = 0;

            for (const d of snap.docs) {
                const uData = d.data();
                if (uData.role !== 'employee') continue;

                const empKey = uData.name.trim().toLowerCase().replace(/\s+/g, ' ');
                const csvUser = csvDataMap[empKey];

                const userRef = doc(db, "users", d.id);
                const updateFields = {};

                if (csvUser) {
                    // Если сотрудник есть в CSV, обновляем поля. Если ячейка пустая/дефис — запишется null
                    updateFields['role'] = csvUser.role;
                    updateFields['ouk_w1'] = csvUser.oukWeeks[0];
                    updateFields['ouk_w2'] = csvUser.oukWeeks[1];
                    updateFields['ouk_w3'] = csvUser.oukWeeks[2];
                    updateFields['ouk_w4'] = csvUser.oukWeeks[3];
                    updateFields['ouk_w5'] = csvUser.oukWeeks[4];
                    updateFields['ouk_total'] = csvUser.oukTotal;
                    updateFields['sa_w1'] = csvUser.saWeeks[0];
                    updateFields['sa_w2'] = csvUser.saWeeks[1];
                    updateFields['sa_w3'] = csvUser.saWeeks[2];
                    updateFields['sa_w4'] = csvUser.saWeeks[3];
                    updateFields['sa_w5'] = csvUser.saWeeks[4];
                    updateFields['sa_total'] = csvUser.saTotal;
                } else {
                    // Если сотрудника вообще нет в новом CSV-файле, полностью зачищаем его оценки на сайте
                    updateFields['ouk_w1'] = null; updateFields['ouk_w2'] = null; updateFields['ouk_w3'] = null; updateFields['ouk_w4'] = null; updateFields['ouk_w5'] = null; updateFields['ouk_total'] = null;
                    updateFields['sa_w1'] = null; updateFields['sa_w2'] = null; updateFields['sa_w3'] = null; updateFields['sa_w4'] = null; updateFields['sa_w5'] = null; updateFields['sa_total'] = null;
                }

                await updateDoc(userRef, updateFields);
                successCount++;
            }

            ui.modalAdminMessage.style.color = "var(--success)";
            ui.modalAdminMessage.innerText = `Успешно синхронизировано! Обновлены/очищены профили для ${successCount} специалистов.`;
            startDashboard(currentUserProfile);
        } catch (err) {
            ui.modalAdminMessage.style.color = "var(--danger)"; ui.modalAdminMessage.innerText = "Ошибка структуры CSV-файла."; console.error(err);
        }
    };
    reader.readAsText(files[0], "UTF-8");
});

function parseCsvRow(t) {
    let r = ['']; let q = false; for (let i = 0; i < t.length; i++) { if (t[i] === '"') { q = !q; continue; } if (t[i] === ',' && !q) { r.push(''); continue; } r[r.length - 1] += t[i]; } return r;
}
function parseNumLocal(v) { if (!v) return null; v = v.toString().trim().replace('%', ''); if (!v || v === '0' || v.includes('-') || v.includes('#ref!')) return null; let n = parseFloat(v.replace(',', '.')); return isNaN(n) ? null : n; }

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
