/** Game timetables are civil Europe/Paris clocks. Epochs remain absolute UTC. */
const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const departureEpochs = new Map();
const civilDates = new Map();
function parts(epochMs) { return Object.fromEntries(formatter.formatToParts(new Date(epochMs)).filter(p => p.type !== 'literal').map(p => [p.type, p.value])); }
function civilMs(epochMs) { const p = parts(epochMs); return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)); }
export function civilDateAt(epochMs) {
    // Before Paris adopted minute-aligned GMT offsets, its local midnight could
    // fall inside a UTC minute. Keep exact historical behavior for those dates.
    if (epochMs < Date.UTC(1911, 2, 11)) {
        const p = parts(epochMs);
        return `${p.year}-${p.month}-${p.day}`;
    }
    const minute = Math.floor(epochMs / 60000), cached = civilDates.get(minute);
    if (cached !== undefined)
        return cached;
    const p = parts(epochMs), value = `${p.year}-${p.month}-${p.day}`;
    civilDates.set(minute, value);
    if (civilDates.size > 8)
        civilDates.delete(civilDates.keys().next().value);
    return value;
}
/** Read a live instant in timetable coordinates without treating UTC as Paris. */
export function civilRelativeSec(baseDate, epochMs) {
    const base = Date.parse(`${baseDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || !Number.isFinite(base) || !Number.isFinite(epochMs))
        throw new Error('Date ou heure de simulation invalide');
    return (civilMs(epochMs) - base + ((epochMs % 1000) + 1000) % 1000) / 1000;
}
/** Offset is in civil seconds from midnight and can cross a civil day boundary.
 * Autumn ambiguous hours use the first occurrence; nonexistent spring hours
 * roll forward by the DST gap, rather than scheduling an impossible instant. */
export function simulationEpochSec(baseDate, relativeSec = 0) {
    const base = Date.parse(`${baseDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || !Number.isFinite(base) || !Number.isFinite(relativeSec))
        throw new Error('Date ou heure de simulation invalide');
    const key = `${baseDate}|${relativeSec}`, cached = departureEpochs.get(key);
    if (cached !== undefined)
        return cached;
    const target = base + relativeSec * 1000;
    const offsets = new Set([-86400000, 0, 86400000].map(delta => civilMs(target + delta) - (target + delta)));
    const candidates = [...offsets].map(offset => target - offset).sort((a, b) => a - b);
    const exact = candidates.filter(epoch => Math.abs(civilMs(epoch) - target) < 1000);
    const value = (exact.length ? exact[0] : Math.max(...candidates)) / 1000;
    departureEpochs.set(key, value);
    if (departureEpochs.size > 4096)
        departureEpochs.delete(departureEpochs.keys().next().value);
    return value;
}
