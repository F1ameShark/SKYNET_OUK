import { auth, db, app } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { startDashboard } from "./dashboard-logic.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

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
        if (!d.exists()) { alert("Ваш профиль отсутствует в базе данных."); await signOut(auth); return; }
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
    try { await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value, document.getElementById('loginPassword').value); } catch(e){ ui.authError.innerText="Неверный логин или пароль."; }
});
document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));
document.getElementById('toggleSettingsBtn').addEventListener('click', () => { ui.settingsPanel.classList.toggle('hidden'); });
import { deleteApp } from "https://gstatic.com";

document.getElementById('registerUserBtn').addEventListener('click', async () => {
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

document.getElementById('syncMainCsvBtn').addEventListener('click', async () => {
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
                csvDataMap[fName] = {
                    oukWeeks: [row[2], row[3], row[4], row[5], row[6]].map(v => parseNumLocal(v)), oukTotal: parseNumLocal(row[15]),
                    saWeeks: [row[8], row[9], row[10], row[11], row[12]].map(v => parseNumLocal(v)), saTotal: parseNumLocal(row[16]),
                    role: row[1] ? row[1].trim() : 'Не указана'
                };
            }
            const snap = await getDocs(collection(db, "users")); let successCount = 0;
            for (const d of snap.docs) {
                const uData = d.data(); if (uData.role !== 'employee') continue;
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
            startDashboard(currentUserProfile);
        } catch (err) { ui.modalAdminMessage.style.color = "var(--danger)"; ui.modalAdminMessage.innerText = "Ошибка структуры CSV."; console.error(err); }
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
