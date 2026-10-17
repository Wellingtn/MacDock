// SPDX-License-Identifier: GPL-2.0-or-later
export function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
export function validateNotes(data) {
    if (!data || data.version !== 1 || !data.notes ||
        typeof data.notes !== 'object' || Array.isArray(data.notes))
        throw new Error('Formato de notas inválido (esperado version: 1 e notes)');
    const entries = Object.entries(data.notes);
    if (entries.length > 10000)
        throw new Error('Limite de 10000 datas excedido');
    const notes = {};
    for (const [date, text] of entries) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dateKey(new Date(`${date}T12:00:00`)) !== date ||
            typeof text !== 'string' || text.length > 10000)
            throw new Error(`Nota inválida: ${date}`);
        notes[date] = text;
    }
    const result = {version: 1, notes};
    if (new TextEncoder().encode(JSON.stringify(result)).length > 800000)
        throw new Error('Limite total de notas excedido (800 kB)');
    return result;
}
