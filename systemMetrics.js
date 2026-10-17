// SPDX-License-Identifier: GPL-2.0-or-later
export function cpuCounters(text) {
    const row = text.split('\n').find(line => line.startsWith('cpu '));
    if (!row)
        throw new Error('Contadores de CPU indisponíveis');
    const values = row.trim().split(/\s+/).slice(1, 9).map(Number);
    if (values.length < 4 || values.some(v => !Number.isFinite(v)))
        throw new Error('Contadores de CPU inválidos');
    return {total: values.reduce((a, b) => a + b, 0), idle: values[3] + (values[4] ?? 0)};
}
export function cpuUsage(previous, current) {
    if (!previous || current.total <= previous.total)
        return null;
    return Math.max(0, Math.min(100, 100 * (1 -
        (current.idle - previous.idle) / (current.total - previous.total))));
}
export function memoryUsage(text) {
    const entries = Object.fromEntries(
        [...text.matchAll(/^(\w+):\s+(\d+)/gm)].map(m => [m[1], Number(m[2])]));
    const total = entries.MemTotal;
    const available = entries.MemAvailable ?? (entries.MemFree + entries.Buffers + entries.Cached);
    if (!(total > 0) || !Number.isFinite(available))
        throw new Error('Memória indisponível');
    return {
        total: total * 1024, used: Math.max(0, total - available) * 1024,
        percent: Math.max(0, Math.min(100, 100 * (total - available) / total)),
    };
}
export function networkCounters(text) {
    let received = 0;
    let sent = 0;
    for (const line of text.split('\n')) {
        const [name, counters] = line.split(':');
        if (!counters || name.trim() === 'lo')
            continue;
        const values = counters.trim().split(/\s+/).map(Number);
        if (Number.isFinite(values[0]) && Number.isFinite(values[8])) {
            received += values[0];
            sent += values[8];
        }
    }
    return {received, sent};
}
