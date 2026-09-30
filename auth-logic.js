import { auth, db, app } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, getAuth } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { startDashboard } from "./dashboard-logic.js";

const ui = {
    authScreen: document.getElementById('authScreen'), mainScreen: document.getElementById('mainScreen'),
    userDisplayName: document.getElementById('userDisplayName'), userRoleBadge: document.getElementById('userRoleBadge'),
    authError: document.getElementById('authError'), modalAdminMessage: document.getElementById('modalAdminMessage'),
    settingsPanel: document.getElementById('settingsPanel'), leaderPanel: document.getElementById('leaderPanel'),
    userManagementRows: document.getElementById('userManagementRows'), usersModal: document.getElementById('usersModal'),
    openUsersModalBtn: document.getElementById('openUsersModalBtn'), closeUsersModalBtn: document.getElementById('closeUsersModalBtn')
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

if (ui.openUsersModalBtn) ui.openUsersModalBtn.addEventListener('click', () => { ui.usersModal.classList.remove('hidden'); loadUserManagementList(); });
if (ui.closeUsersModalBtn) ui.closeUsersModalBtn.addEventListener('click', () => ui.usersModal.classList.add('hidden'));

const loginBtn = document.getElementById('loginBtn');
if (loginBtn) loginBtn.addEventListener('click', async () => {
    try { await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value, document.getElementById('loginPassword').value); } catch(e){ ui.authError.innerText="Неверный логин или пароль."; }
});
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', () => signOut(auth));
const toggleSettingsBtn = document.getElementById('toggleSettingsBtn');
if (toggleSettingsBtn) toggleSettingsBtn.addEventListener('click', () => { ui.settingsPanel.classList.toggle('hidden'); });
const regUserBtn = document.getElementById('registerUserBtn');
if (regUserBtn) regUserBtn.addEventListener('click', async () => {
    const name = document.getElementById('regName').value.trim(); const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const team = document.getElementById('regTeam').value.trim() || "Основная"; if(!name || !email) return;
    const secApp = initializeApp(app.options, "SecondaryContext"); const secAuth = getAuth(secApp);
    try {
        const cred = await createUserWithEmailAndPassword(secAuth, email, "123456");
        await setDoc(doc(db, "users", cred.user.uid), { name: name, email: email, role: "employee", teamName: team, history_weeks:{} });
        ui.modalAdminMessage.style.color = "var(--success)"; ui.modalAdminMessage.innerText = "Сотрудник добавлен!";
        document.getElementById('regName').value=""; document.getElementById('regEmail').value=""; loadUserManagementList(); startDashboard(currentUserProfile);
    } catch(e) { ui.modalAdminMessage.innerText = "Ошибка."; } finally { await deleteApp(secApp); }
});
const syncCsvBtn = document.getElementById('syncMainCsvBtn');
if (syncCsvBtn) syncCsvBtn.addEventListener('click', async () => {
    const fileInput = document.getElementById('mainCsvFileInput'); const files = fileInput ? fileInput.files : null;
    if (!files || files.length === 0) { alert("Выберите скачанный CSV-файл для импорта!"); return; }
    ui.modalAdminMessage.style.color = "var(--primary)"; ui.modalAdminMessage.innerText = "Синхронизация оценок с Firebase Firestore...";
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const text = e.target.result; const lines = text.split(/\r?\n/); const csvDataMap = {};
            for (let i = 2; i < lines.length; i++) {
                if (!lines[i].trim()) continue; const row = parseCsvRow(lines[i]); if (row.length < 17) continue;
                const fName = row[0].trim().toLowerCase().replace(/\s+/g, ' ');
                if (!fName || fName.includes('общая') || fName.startsWith('http')) continue;
                
                // Данные ОУК за месяц берутся из индекса 15 (столбец P), SA — из индекса 16 (столбец Q)
                csvDataMap[fName] = {
                    oukWeeks: [row[2], row[3], row[4], row[5], row[6]].map(v => parseNumLocal(v)), 
                    oukTotal: parseNumLocal(row[15]), // Столбец P
                    saWeeks: [row[8], row[9], row[10], row[11], row[12]].map(v => parseNumLocal(v)), 
                    saTotal: parseNumLocal(row[16]), // Столбец Q
                    role: row[1] ? row[1].trim() : 'Не указана'
                };
            }
            const snap = await getDocs(collection(db, "users")); let successCount = 0;
            for (const d of snap.docs) {
                const uData = d.data(); if (uData.role === 'leader') continue;
                const empKey = uData.name.trim().toLowerCase().replace(/\s+/g, ' '); const csvUser = csvDataMap[empKey];
                const userRef = doc(db, "users", d.id); const updateFields = {};
                if (csvUser) {
                    updateFields['role'] = csvUser.role; updateFields['ouk_total'] = csvUser.oukTotal; updateFields['sa_total'] = csvUser.saTotal;
                    for(let w=1; w<=5; w++) { updateFields[`ouk_w${w}`] = csvUser.oukWeeks[w-1]; updateFields[`sa_w${w}`] = csvUser.saWeeks[w-1]; }
                } else {
                    updateFields['ouk_total'] = null; updateFields['sa_total'] = null;
                    for(let w=1; w<=5; w++) { updateFields[`ouk_w${w}`] = null; updateFields[`sa_w${w}`] = null; }
                }
                await updateDoc(userRef, updateFields); successCount++;
            }
            ui.modalAdminMessage.style.color = "var(--success)"; ui.modalAdminMessage.innerText = `Успешно! Синхронизировано специалистов: ${successCount}`;
            if (fileInput) fileInput.value = ""; 
            startDashboard(currentUserProfile);
        } catch (err) { ui.modalAdminMessage.style.color = "var(--danger)"; ui.modalAdminMessage.innerText = "Ошибка структуры CSV."; console.error(err); }
    };
    reader.readAsText(files[0], "UTF-8");
});

function parseCsvRow(t) {
    let r = ['']; let q = false; for (let i = 0; i < t.length; i++) { if (t[i] === '"') { q = !q; continue; } if (t[i] === ',' && !q) { r.push(''); continue; } r[r.length - 1] += t[i]; } return r;
}

function parseNumLocal(v) { 
    if (v === undefined || v === null) return null; 
    v = v.toString().trim().replace('%', ''); 
    if (!v || v === '-' || v.includes('#ref!')) return null; 
    let n = parseFloat(v.replace(',', '.')); 
    return isNaN(n) ? null : n; 
}

async function loadUserManagementList() {
    if (!ui.userManagementRows) return;
    try {
        const snap = await getDocs(collection(db, "users")); ui.userManagementRows.innerHTML = '';
        snap.forEach((d) => {
            const uData = d.data(); const uId = d.id; if (uData.role === 'leader') return;
            const tr = document.createElement('tr');
            
            tr.innerHTML = `
                <td>${uData.name}</td>
                <td>${uData.teamName || 'Без команды'}</td>
                <td>${uData.email}</td>
                <td style="text-align: right;">
                    <button class="action-btn pass-btn" id="resetPass-${uId}" style="margin-right: 5px; padding: 4px 8px; font-size: 12px; cursor: pointer;">Сбросить пароль</button>
                    <button class="action-btn del-btn" id="deleteUser-${uId}" style="padding: 4px 8px; font-size: 12px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">Удалить</button>
                </td>
            `;
            ui.userManagementRows.appendChild(tr);

            document.getElementById(`resetPass-${uId}`).addEventListener('click', async () => {
                if(!confirm(`Сбросить пароль для ${uData.name} на "123456"?`)) return;
                const secApp = initializeApp(app.options, "ResetContext"); const secAuth = getAuth(secApp);
                try {
                    await signInWithEmailAndPassword(secAuth, uData.email, "123456"); 
                    alert("У пользователя уже установлен стандартный пароль 123456 либо сброс не требуется.");
                } catch(err) {
                    alert("Для смены измененного пароля сотрудника используйте стандартную форму отправки ссылки сброса или пересоздайте учетную запись.");
                } finally { await deleteApp(secApp); }
            });

            document.getElementById(`deleteUser-${uId}`).addEventListener('click', async () => {
                if (!confirm(`Вы уверены, что хотите удалить сотрудника ${uData.name}? Из базы данных удалятся все его оценки.`)) return;
                try {
                    await deleteDoc(doc(db, "users", uId));
                    ui.modalAdminMessage.style.color = "var(--success)";
                    ui.modalAdminMessage.innerText = "Сотрудник успешно удален из базы данных.";
                    loadUserManagementList();
                    startDashboard(currentUserProfile);
                } catch(e) {
                    alert("Ошибка при удалении из БД.");
                }
            });
        });
    } catch(e) { console.error("Ошибка загрузки менеджера пользователей:", e); }
}
