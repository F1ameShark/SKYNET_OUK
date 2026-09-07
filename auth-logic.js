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
    const team = document.getElementById('regTeam').value.trim() || "Основная"; const defaultPassword = "123456";
    if(!name || !email) return;
    ui.modalAdminMessage.style.color = "var(--primary)"; ui.modalAdminMessage.innerText = "Регистрация...";
    const secApp = initializeApp(app.options, "SecondaryContext"); const secAuth = getAuth(secApp);
    try {
        const cred = await createUserWithEmailAndPassword(secAuth, email, defaultPassword);
        await setDoc(doc(db, "users", cred.user.uid), { name: name, email: email, role: "employee", teamName: team });
        ui.modalAdminMessage.style.color = "var(--success)"; ui.modalAdminMessage.innerText = `Успешно! Пароль: ${defaultPassword}`;
        document.getElementById('regName').value = ""; document.getElementById('regEmail').value = ""; document.getElementById('regTeam').value = "";
        loadUserManagementList(); startDashboard(currentUserProfile);
    } catch(e) { 
        ui.modalAdminMessage.style.color = "var(--danger)";
        ui.modalAdminMessage.innerText = e.code === 'auth/email-already-in-use' ? "Email уже занят." : "Ошибка регистрации.";
    } finally { await secApp.delete(); }
});

async function loadUserManagementList() {
    if (!ui.userManagementRows) return; ui.userManagementRows.innerHTML = '<tr><td colspan="5" style="text-align:center;">Загрузка...</td></tr>';
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
    } catch (e) { console.error(e); }
}

window.updateUserTeam = async function(userId) {
    const tInput = document.getElementById(`team-${userId}`); if (!tInput) return;
    try { await updateDoc(doc(db, "users", userId), { teamName: tInput.value.trim() }); alert("Сохранено!"); startDashboard(currentUserProfile); } 
    catch (e) { alert("Ошибка."); }
};
window.updateUserPasswordAdmin = async function(userId) {
    const pInput = document.getElementById(`pass-${userId}`); if (!pInput || pInput.value.length < 6) { alert("Минимум 6 знаков."); return; }
    try { await updateDoc(doc(db, "users", userId), { forceNewPassword: pInput.value }); alert("Подготовлено!"); pInput.value = ""; } 
    catch (e) { alert("Ошибка."); }
};
window.deleteUserAdmin = async function(userId) {
    if (!confirm("Удалить пользователя?")) return;
    try { await deleteDoc(doc(db, "users", userId)); alert("Удален!"); loadUserManagementList(); startDashboard(currentUserProfile); } 
    catch (e) { alert("Ошибка."); }
};
