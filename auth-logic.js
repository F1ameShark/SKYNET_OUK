import { db } from "./firebase-config.js";
import { collection, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { startDashboard } from "./dashboard-logic.js";

// Глобальные элементы UI для работы модуля авторизации и админки
const ui = {
    modalAdminMessage: document.getElementById('modalAdminMessage'),
    csvInput: document.getElementById('csvFileInput') // Подставьте ваш реальный ID инпута для файлов, если он другой
};

let currentUserProfile = null;

/**
 * Вспомогательная функция для корректного разбиения строки CSV.
 * Игнорирует разделительные запятые, находящиеся внутри кавычек (например: "99,33").
 */
function parseCsvLineCorrectly(textLine) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < textLine.length; i++) {
        const char = textLine[i];
        if (char === '"') {
            inQuotes = !inQuotes; // Переключаем режим нахождения внутри кавычек
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

/**
 * Преобразует строковое значение из CSV (например, "99,33") в число (99.33) для базы данных.
 * Если ячейка пустая, возвращает null, чтобы затереть старые данные в БД при обновлении.
 */
function cleanNumericValue(val) {
    if (!val) return null;
    const cleaned = val.replace(/"/g, '').replace(',', '.').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
}

/**
 * Возвращает карту соответствия Пользователь -> Команда
 */
export async function getUserTeamsMap() {
    const teamsMap = {};
    try {
        const snap = await getDocs(collection(db, "users"));
        snap.forEach(d => {
            const data = d.data();
            if (data.name) {
                teamsMap[data.name.trim().toLowerCase()] = data.teamName || 'Без команды';
            }
        });
    } catch (e) {
        console.error("Ошибка при получении карты команд:", e);
    }
    return teamsMap;
}

/**
 * Функция инициализации логики импорта CSV файла.
 * Навешивает обработчик на вашу кнопку импорта и принудительно перезаписывает изменения в Firestore.
 */
export function initCsvSync(userProfile) {
    currentUserProfile = userProfile;
    const syncCsvBtn = document.getElementById('syncMainCsvBtn');

    if (syncCsvBtn && !syncCsvBtn.dataset.hooked) {
        syncCsvBtn.addEventListener('click', async () => {
            if (!ui.csvInput || !ui.csvInput.files || ui.csvInput.files.length === 0) {
                if (ui.modalAdminMessage) {
                    ui.modalAdminMessage.style.color = "var(--danger)";
                    ui.modalAdminMessage.innerText = "Выберите CSV файл для загрузки!";
                }
                return;
            }

            if (ui.modalAdminMessage) {
                ui.modalAdminMessage.style.color = "var(--primary)";
                ui.modalAdminMessage.innerText = "Чтение файла и обновление базы данных...";
            }

            const file = ui.csvInput.files[0];
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const text = e.target.result;
                    const lines = text.split(/\r?\n/);
                    const csvDataMap = {};

                    // Парсинг строк таблицы (начиная с 3-й строки — индекс 2, пропускаем заголовки)
                    for (let i = 2; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;

                        const row = parseCsvLineCorrectly(line);
                        if (row.length < 14) continue; // Пропуск слишком коротких или дефектных строк

                        const employeeName = row[0]; // Столбец "Специалист"
                        if (!employeeName || employeeName.includes('Крутышкины') || employeeName.startsWith('http')) continue;

                        const empKey = employeeName.trim().toLowerCase().replace(/\s+/g, ' ');

                        csvDataMap[empKey] = {
                            role: row[1] ? row[1].trim() : 'Не указана',
                            // ОУК: 1-5 недели (индексы колонок 2, 3, 4, 5, 6)
                            oukWeeks: [row[2], row[3], row[4], row[5], row[6]].map(v => cleanNumericValue(v)),
                            // Общий ОУК за месяц (индекс колонки 7)
                            oukTotal: cleanNumericValue(row[7]),
                            // SA: 1-5 недели (индексы колонок 8, 9, 10, 11, 12)
                            saWeeks: [row[8], row[9], row[10], row[11], row[12]].map(v => cleanNumericValue(v)),
                            // Общий SA за месяц (индекс колонки 13)
                            saTotal: cleanNumericValue(row[13])
                        };
                    }

                    // Получаем текущих пользователей из Firestore для сопоставления и обновления
                    const snap = await getDocs(collection(db, "users"));
                    let successCount = 0;

                    for (const d of snap.docs) {
                        const uData = d.data();
                        if (uData.role === 'leader') continue; // Не затираем руководителей

                        const dbUserKey = uData.name.trim().toLowerCase().replace(/\s+/g, ' ');
                        const csvUser = csvDataMap[dbUserKey];
                        const userRef = doc(db, "users", d.id);
                        const updateFields = {};

                        if (csvUser) {
                            // Если пользователь найден в CSV, перезаписываем все поля новыми значениями/числами
                            updateFields['role'] = csvUser.role;
                            updateFields['ouk_total'] = csvUser.oukTotal;
                            updateFields['sa_total'] = csvUser.saTotal;
                            
                            // Циклом явно обновляем каждую неделю
                            for (let w = 1; w <= 5; w++) {
                                updateFields[`ouk_w${w}`] = csvUser.oukWeeks[w - 1];
                                updateFields[`sa_w${w}`] = csvUser.saWeeks[w - 1];
                            }
                        } else {
                            // Если сотрудника нет в новом файле, принудительно обнуляем показатели в БД через null
                            updateFields['ouk_total'] = null;
                            updateFields['sa_total'] = null;
                            for (let w = 1; w <= 5; w++) {
                                updateFields[`ouk_w${w}`] = null;
                                updateFields[`sa_w${w}`] = null;
                            }
                        }

                        // updateDoc теперь гарантированно заменяет старые значения на новые актуальные данные
                        await updateDoc(userRef, updateFields);
                        successCount++;
                    }

                    if (ui.modalAdminMessage) {
                        ui.modalAdminMessage.style.color = "var(--success)";
                        ui.modalAdminMessage.innerText = `Успешно обновлено сотрудников: ${successCount}`;
                    }

                    // Сбрасываем значение инпута, чтобы браузер не кэшировал файл и позволял загружать его повторно после изменений
                    ui.csvInput.value = "";

                    // Перезапускаем дашборд для отображения обновленных данных на клиенте
                    if (typeof startDashboard === "function") {
                        startDashboard(currentUserProfile);
                    }

                } catch (err) {
                    if (ui.modalAdminMessage) {
                        ui.modalAdminMessage.style.color = "var(--danger)";
                        ui.modalAdminMessage.innerText = "Ошибка парсинга структуры CSV. Проверьте консоль.";
                    }
                    console.error("Критическая ошибка импорта:", err);
                }
            };

            reader.readAsText(file, "UTF-8");
        });

        syncCsvBtn.dataset.hooked = true;
    }
}

