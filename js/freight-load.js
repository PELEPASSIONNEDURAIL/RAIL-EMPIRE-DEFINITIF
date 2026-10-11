export function normalizeFreightLoadPlan(raw) {
    if (!Array.isArray(raw))
        return [];
    const result = [];
    for (const row of raw.slice(0, 128)) {
        if (!row || typeof row !== 'object' || Array.isArray(row))
            continue;
        const item = row;
        const type = typeof item.type === 'string' ? item.type.trim() : '';
        const tonnes = Number(item.tonnes);
        if (!type || type.length > 100 || !Number.isFinite(tonnes) || tonnes <= 0 || tonnes > 1e9)
            continue;
        const client = typeof item.industrialClientId === 'string' ? item.industrialClientId.trim() : '';
        result.push(client && client.length <= 100 ? { type, tonnes, industrialClientId: client } : { type, tonnes });
    }
    return result;
}
/** A save cannot claim more detailed cargo than the aggregate already on board. */
export function normalizeFreightLoadManifest(raw, onboard) {
    const ceiling = Number(onboard);
    if (!Number.isFinite(ceiling) || ceiling <= 0)
        return null;
    const result = [];
    let room = ceiling;
    for (const line of normalizeFreightLoadPlan(raw)) {
        if (room <= 1e-9)
            break;
        const tonnes = Math.min(room, line.tonnes);
        result.push(line.industrialClientId
            ? { type: line.type, tonnes, industrialClientId: line.industrialClientId }
            : { type: line.type, tonnes });
        room -= tonnes;
    }
    // A partial detail must never price only a fraction of the aggregate load.
    // Treat it as an older untyped snapshot and use its nominal cargo fallback.
    return result.length && room <= 1e-6 ? result : null;
}
/** Exact max flow between requested lots and physical wagons. A wagon may
 * carry two compatible goods, but the sum never exceeds its own capacity.
 * Returned lines are partial if the requested quantity cannot all fit. */
export function allocateFreightLoad(rame, requested) {
    const plan = normalizeFreightLoadPlan(requested);
    if (!plan.length)
        return [];
    const wagons = (Array.isArray(rame?.elementDetails) ? rame.elementDetails : [])
        .filter(w => String(w?.category || '').toLowerCase() === 'wagon')
        .map(w => ({ capacity: Number(w.freightCapacity), types: Array.isArray(w.cargoTypes)
            ? new Set(w.cargoTypes.filter((t) => typeof t === 'string' && !!t.trim()).map(t => t.trim()))
            : new Set() }))
        .filter(w => Number.isFinite(w.capacity) && w.capacity > 0 && w.types.size > 0);
    if (!wagons.length)
        return [];
    const source = 0, firstLot = 1, firstWagon = firstLot + plan.length, sink = firstWagon + wagons.length;
    const graph = Array.from({ length: sink + 1 }, () => []);
    const add = (from, to, capacity) => {
        const edge = { to, reverse: graph[to].length, capacity, original: capacity };
        const reverse = { to: from, reverse: graph[from].length, capacity: 0, original: 0 };
        graph[from].push(edge);
        graph[to].push(reverse);
        return edge;
    };
    const sourceEdges = plan.map((line, i) => add(source, firstLot + i, line.tonnes));
    for (let i = 0; i < plan.length; i++) {
        for (let j = 0; j < wagons.length; j++) {
            if (wagons[j].types.has(plan[i].type))
                add(firstLot + i, firstWagon + j, Math.min(plan[i].tonnes, wagons[j].capacity));
        }
    }
    for (let j = 0; j < wagons.length; j++)
        add(firstWagon + j, sink, wagons[j].capacity);
    const eps = 1e-9;
    while (true) {
        const levels = new Int32Array(sink + 1).fill(-1);
        levels[source] = 0;
        const queue = [source];
        for (let index = 0; index < queue.length; index++) {
            for (const e of graph[queue[index]])
                if (e.capacity > eps && levels[e.to] < 0) {
                    levels[e.to] = levels[queue[index]] + 1;
                    queue.push(e.to);
                }
        }
        if (levels[sink] < 0)
            break;
        const next = new Int32Array(sink + 1);
        const send = (node, allowed) => {
            if (node === sink)
                return allowed;
            for (; next[node] < graph[node].length; next[node]++) {
                const e = graph[node][next[node]];
                if (e.capacity <= eps || levels[e.to] !== levels[node] + 1)
                    continue;
                const pushed = send(e.to, Math.min(allowed, e.capacity));
                if (pushed > eps) {
                    e.capacity -= pushed;
                    graph[e.to][e.reverse].capacity += pushed;
                    return pushed;
                }
            }
            return 0;
        };
        while (send(source, Number.MAX_SAFE_INTEGER) > eps) { /* find remaining augmenting flow */ }
    }
    return plan.flatMap((line, i) => {
        const tonnes = Math.max(0, sourceEdges[i].original - sourceEdges[i].capacity);
        if (tonnes <= eps)
            return [];
        return [line.industrialClientId
                ? { type: line.type, tonnes, industrialClientId: line.industrialClientId }
                : { type: line.type, tonnes }];
    });
}
