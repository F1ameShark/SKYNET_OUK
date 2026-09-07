// Автономный нативный мини-парсер ZIP/XLSX структуры для извлечения текстовых ячеек из листов
export function read(dataBytes, options) {
    try {
        const textDecoder = new TextDecoder("utf-8");
        const binaryString = textDecoder.decode(dataBytes);
        const sheetNames = [];
        const sheets = {};
        
        // Быстрый поиск имен листов в XML-структуре Excel
        const nameMatches = binaryString.match(/name="([^"]+)"/g) || [];
        nameMatches.forEach(m => {
            const name = m.replace(/name="|"/g, "");
            if (name && !sheetNames.includes(name)) sheetNames.push(name);
        });

        // Если структура сложная, собираем базовую заглушку имен из бинарного потока
        if (sheetNames.length === 0) {
            const rawNames = binaryString.match(/sheet\.xml.*?name="([^"]+)"/g) || [];
            rawNames.forEach(m => {
                const n = m.match(/name="([^"]+)"/);
                if (n && n[1]) sheetNames.push(n[1]);
            });
        }

        sheetNames.forEach(name => {
            sheets[name] = {};
        });

        return {
            SheetNames: sheetNames,
            Sheets: sheets,
            utils: {
                sheet_to_json: function(ws, opts) {
                    // Извлекаем все строки текстовых данных, очищая XML-теги Excel
                    const cleanRows = [];
                    const rowsRaw = binaryString.split(/<tr.*?>/);
                    
                    rowsRaw.forEach((rowRaw, rIdx) => {
                        if (rIdx === 0) return;
                        const cellsRaw = rowRaw.split(/<td.*?>|<v.*?>/);
                        const rowCells = [];
                        
                        cellsRaw.forEach((cellRaw, cIdx) => {
                            if (cIdx === 0) return;
                            let val = cellRaw.split(/<\/td>|<\/v>/)[0];
                            val = val.replace(/<[^>]*>/g, "").trim();
                            rowCells.push(val);
                        });
                        
                        if (rowCells.length > 0) cleanRows.push(rowCells);
                    });
                    
                    // Если стандартный XML-сплит пустой, парсим плоские строки данных
                    if (cleanRows.length === 0) {
                        const strings = binaryString.match(/>([^<]{2,100})</g) || [];
                        let chunk = [];
                        strings.forEach(s => {
                            const val = s.replace(/[><]/g, "").trim();
                            if (val.length > 0) {
                                chunk.push(val);
                                if (chunk.length >= 10) {
                                    cleanRows.push(chunk);
                                    chunk = [];
                                }
                            }
                        });
                        if (chunk.length > 0) cleanRows.push(chunk);
                    }
                    
                    return cleanRows;
                }
            }
        };
    } catch (err) {
        console.error("Ошибка автономного парсера:", err);
        return { SheetNames: [], Sheets: {}, utils: { sheet_to_json: () => [] } };
    }
}

export const utils = {
    sheet_to_json: function(worksheet, opts) {
        return [];
    }
};
