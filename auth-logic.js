import { auth, db, app } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
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
    openUsersModalBtn: document.getElementById('openUsersModalBtn'), closeUsersModalBtn: document.getElementById('closeUsersModalBtn')
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
