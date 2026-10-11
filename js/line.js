import { canonicalTrackRef, normalizeStationTrackIdentity, stationTrackResourceKey } from './station-track-identity.js';
import { compositeStationTrackShare } from './physical-service-identity.js';
export const INFRASTRUCTURE_OWNER = 'GESTIONNAIRE_RESEAU';
const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
let nextLineId = 1;
let nextInfrastructureRequestId = 1;
const isoDay = (value) => {
    const day = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T12:00:00Z')))
        throw new Error('Date de simulation invalide pour la demande au gestionnaire.');
    return day;
};
const dayPlus = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
export class Line {
    constructor(input = {}) {
        const data = isRecord(input) ? input : {};
        const rawId = data.id == null ? '' : String(data.id);
        this.id = rawId || `line-${nextLineId++}`;
        this.name = String(data.name || 'Ligne').slice(0, 160);
        this.color = /^#[0-9a-f]{6}$/i.test(String(data.color || '')) ? String(data.color) : '#3b82f6';
        this.code = String(data.code || '').slice(0, 40);
        this.stops = Array.isArray(data.stops) ? data.stops.map((id) => String(id ?? '')).filter(Boolean) : []; // ordered station IDs
        this.trackIds = Array.isArray(data.trackIds) ? data.trackIds.map((id) => String(id ?? '')).filter(Boolean) : []; // track IDs between consecutive stops
        this.infrastructureOwner = INFRASTRUCTURE_OWNER; // Service rights never transfer ownership of the network.
        this.infrastructureRequestId = String(data.infrastructureRequestId || '');
        this.requestedMaxSpeed = Math.max(0, Number(data.requestedMaxSpeed) || 0);
        this.requestedElectrified = data.requestedElectrified === true;
    }
    getStationIds() {
        return [...this.stops];
    }
    hasStation(stationId) {
        return this.stops.includes(stationId);
    }
    hasTrack(trackId) {
        return this.trackIds.includes(trackId);
    }
    toSave() {
        return {
            id: this.id,
            name: this.name,
            color: this.color,
            code: this.code,
            stops: [...this.stops],
            trackIds: [...this.trackIds],
            infrastructureOwner: this.infrastructureOwner,
            infrastructureRequestId: this.infrastructureRequestId,
            requestedMaxSpeed: this.requestedMaxSpeed,
            requestedElectrified: this.requestedElectrified,
        };
    }
}
export class LineManager {
    constructor() {
        this._trackLineMap = null;
        this.lines = [];
        this.infrastructureRequests = [];
        this._pendingInfrastructureSubmissions = new Set();
        this._processingInfrastructureRequests = false;
    }
    addLine(data) {
        const line = new Line(data || {});
        if (this.lines.some((l) => l.id === line.id))
            line.id = `line-${nextLineId++}`;
        this.lines.push(line);
        this.invalidateTrackLineMap();
        return line;
    }
    removeLine(id) {
        id = String(id ?? '');
        this.lines = this.lines.filter((l) => l.id !== id);
        this.invalidateTrackLineMap();
    }
    getLine(id) {
        id = String(id ?? '');
        return this.lines.find((l) => l.id === id);
    }
    getAll() {
        return this.lines;
    }
    getLinesForStation(stationId) {
        return this.lines.filter((l) => l.hasStation(stationId));
    }
    getLinesForTrack(trackId) {
        // Use cached track→line map for O(1) lookup
        if (!this._trackLineMap)
            this._rebuildTrackLineMap();
        return this._trackLineMap.get(trackId) || [];
    }
    _rebuildTrackLineMap() {
        this._trackLineMap = new Map();
        for (const l of this.lines) {
            for (const tid of l.trackIds) {
                let arr = this._trackLineMap.get(tid);
                if (!arr) {
                    arr = [];
                    this._trackLineMap.set(tid, arr);
                }
                arr.push(l);
            }
        }
    }
    invalidateTrackLineMap() { this._trackLineMap = null; }
    /**
     * Build a line from ordered station IDs.
     * Reuses existing tracks (troncons communs) if they exist between station pairs.
     * Creates new tracks via ORM if they don't exist.
     */
    async buildLine(input, world, orm, createdTrackIds = []) {
        if (!isRecord(input))
            return null;
        const lineData = input;
        const stops = Array.isArray(lineData.stops) ? lineData.stops.filter((id) => typeof id === 'string' && id) : [];
        if (stops.length < 2 || new Set(stops).size < 2)
            return null;
        const trackIds = [];
        const manualRoutes = Array.isArray(lineData.manualRoutes) ? lineData.manualRoutes : [];
        const abortBuild = () => {
            for (const id of createdTrackIds)
                world.removeTrack(id);
            return null;
        };
        for (let i = 0; i < stops.length - 1; i++) {
            const stA = world.getStationById(stops[i]);
            const stB = world.getStationById(stops[i + 1]);
            if (!stA || !stB) {
                console.warn('Création de ligne refusée : gare introuvable', stops[i], stops[i + 1]);
                return abortBuild();
            }
            // Manual trace is an explicit player override and therefore takes
            // precedence over a previously cached station-to-station track. Otherwise
            // the "tracé manuel" button can appear to save successfully while the
            // line silently keeps the old automatic ORM path.
            const manualRoute = manualRoutes[i];
            if (Array.isArray(manualRoute) && manualRoute.length >= 2) {
                const routeOk = manualRoute.every((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)) && !p.fallback && !p.synthetic);
                const distance = routeOk ? Number(orm.getRouteDistance(manualRoute)) : NaN;
                if (!routeOk || !Number.isFinite(distance) || distance <= 0) {
                    console.warn(`Tracé manuel invalide pour ${stA.name} -> ${stB.name}`);
                    return abortBuild();
                }
                const speeds = manualRoute.map((r) => Number(r.maxSpeed)).filter((v) => Number.isFinite(v) && v > 0);
                const avgSpeed = speeds.length > 0 ? Math.round(speeds.reduce((sum, value) => sum + value, 0) / speeds.length) : 160;
                const electrified = manualRoute.some((r) => r.electrified === false) ? false : true;
                const routeLabel = manualRoute.find((p) => p.trackRef || p.ref || p.name);
                const trackName = routeLabel ? (routeLabel.trackRef || routeLabel.ref || routeLabel.name) : `${stA.name} - ${stB.name}`;
                const track = world.addTrack({
                    stationA: stA.id, stationB: stB.id,
                    distance: Math.round(distance * 1000) / 1000, maxSpeed: avgSpeed,
                    electrified, name: trackName, route: manualRoute,
                });
                trackIds.push(track.id);
                createdTrackIds.push(track.id);
                continue;
            }
            // Check if a track already exists between these two stations (troncon commun)
            let existing = world.getTrackBetween(stA.id, stB.id);
            if (existing) {
                trackIds.push(existing.id);
                continue;
            }
            // No existing track: the OSM/ORM graph is authoritative. A line leg only
            // exists when a real railway route can be resolved; Rail Empire never invents
            // a straight connection between two railway stations.
            try {
                const route = await orm.findRoute(stA.lat, stA.lon, stB.lat, stB.lon);
                if (!Array.isArray(route) || route.length < 2) {
                    console.warn(`No OSM/ORM railway route for ${stA.name} -> ${stB.name}`);
                    return abortBuild();
                }
                const routeOk = route.every((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)) && !p.fallback && !p.synthetic);
                const distance = routeOk ? Number(orm.getRouteDistance(route)) : NaN;
                if (!routeOk || !Number.isFinite(distance) || distance <= 0) {
                    console.warn(`Route OSM/ORM invalide pour ${stA.name} -> ${stB.name}`);
                    return abortBuild();
                }
                const speeds = route.map((r) => Number(r.maxSpeed)).filter((v) => Number.isFinite(v) && v > 0);
                const avgSpeed = speeds.length > 0 ? Math.round(speeds.reduce((s, v) => s + v, 0) / speeds.length) : 160;
                const routeLabel = route.find((p) => p.trackRef || p.ref || p.name);
                const trackName = routeLabel ? (routeLabel.trackRef || routeLabel.ref || routeLabel.name) : `${stA.name} - ${stB.name}`;
                const electrified = route.some((r) => r.electrified === false) ? false : true;
                const track = world.addTrack({
                    stationA: stA.id,
                    stationB: stB.id,
                    distance: Math.round(distance * 1000) / 1000,
                    maxSpeed: avgSpeed,
                    electrified,
                    name: trackName,
                    route,
                });
                trackIds.push(track.id);
                createdTrackIds.push(track.id);
            }
            catch (e) {
                console.warn(`ORM route failed for ${stA.name} -> ${stB.name}:`, e);
                return abortBuild();
            }
        }
        lineData.trackIds = trackIds;
        return this.addLine(lineData);
    }
    /**
     * Ask the network authority for service rights and infrastructure work.
     * The route is checked and quoted now, but neither the network nor the
     * operator's account changes until the simulated decision date.
     */
    async submitInfrastructureRequest(input, world, orm, simulationDate) {
        if (!isRecord(input))
            throw new Error('Demande de ligne invalide.');
        const name = String(input.name || '').trim().slice(0, 160);
        const stops = Array.isArray(input.stops) ? input.stops.map(String) : [];
        if (!name || stops.length < 2 || stops.some((id, i) => !id || (i > 0 && id === stops[i - 1])))
            throw new Error('Indiquez un nom et au moins deux gares distinctes dans l’ordre.');
        const lineId = String(input.lineId || '');
        if (lineId && !this.getLine(lineId))
            throw new Error('Ligne à modifier introuvable.');
        if (!lineId && this.lines.some((l) => l.name.toLowerCase() === name.toLowerCase() && l.stops.join('|') === stops.join('|')))
            throw new Error('Cette ligne est déjà en exploitation ; utilisez Modifier si ses caractéristiques doivent changer.');
        const duplicateKey = lineId ? `edit:${lineId}` : `new:${name.toLowerCase()}:${stops.join('|')}`;
        if (this._pendingInfrastructureSubmissions.has(duplicateKey)
            || this.infrastructureRequests.some((r) => ['PENDING', 'AWAITING_FUNDS'].includes(r.status)
                && (lineId ? r.lineId === lineId : !r.lineId && r.name.toLowerCase() === name.toLowerCase() && r.stops.join('|') === stops.join('|'))))
            throw new Error('Une demande identique attend déjà la décision du gestionnaire.');
        this._pendingInfrastructureSubmissions.add(duplicateKey);
        try {
            const requestedSpeed = Number(input.maxSpeed || 0);
            if (requestedSpeed && (!Number.isInteger(requestedSpeed) || requestedSpeed < 40 || requestedSpeed > 320))
                throw new Error('Vitesse demandée hors de la plage 40–320 km/h.');
            const maxSpeed = requestedSpeed || 0, electrify = input.electrify === true;
            const manualRoutes = Array.isArray(input.manualRoutes) ? input.manualRoutes : [];
            const routePlans = [];
            let quotedCost = 18000, distance = 0;
            for (let i = 0; i < stops.length - 1; i++) {
                const a = world.getStationById(stops[i]), b = world.getStationById(stops[i + 1]);
                if (!a || !b)
                    throw new Error('Gare introuvable sur le réseau du gestionnaire.');
                const manual = Array.isArray(manualRoutes[i]) && manualRoutes[i].length >= 2 ? manualRoutes[i] : null;
                const pairTrack = world.getTrackBetween(a.id, b.id);
                const existing = manual ? null : pairTrack;
                if (existing) {
                    const km = Number(existing.distance);
                    if (!Number.isFinite(km) || km <= 0)
                        throw new Error('Distance de voie existante invalide.');
                    distance += km;
                    if (maxSpeed > Number(existing.maxSpeed || 160))
                        quotedCost += Math.round((maxSpeed - Number(existing.maxSpeed || 160)) * 6500 * km);
                    else if (maxSpeed > 0 && maxSpeed < Number(existing.maxSpeed || 160))
                        quotedCost += Math.round(500 * km); // safety signage for a reduced network limit
                    if (electrify && !existing.electrified)
                        quotedCost += Math.round(300000 * km);
                    routePlans.push({ existingTrackId: existing.id, route: null, distanceKm: km,
                        quotedMaxSpeed: Number(existing.maxSpeed || 160), quotedElectrified: !!existing.electrified });
                    continue;
                }
                const raw = manual || await orm.findRoute(a.lat, a.lon, b.lat, b.lon);
                const route = Array.isArray(raw) ? raw : [];
                if (route.length < 2 || orm.isFallbackRoute?.(route) || route.some((p) => !p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon)) || p.fallback || p.synthetic))
                    throw new Error(`Aucun itinéraire ferroviaire ORM réel entre ${a.name} et ${b.name}.`);
                const km = Number(orm.getRouteDistance(route));
                if (!Number.isFinite(km) || km <= 0)
                    throw new Error('Distance ferroviaire ORM invalide.');
                distance += km;
                quotedCost += Math.round(km * (1200000 + (electrify ? 300000 : 0)));
                routePlans.push({ existingTrackId: '', route: route.map((p) => ({ ...p })), distanceKm: km,
                    quotedParallelTrackId: manual ? pairTrack?.id || '' : '' });
            }
            quotedCost += Math.round(distance * 250);
            const quotedClosedStationIds = [...new Set(stops.filter((id) => world.getStationById(id)?.closed))];
            quotedCost += quotedClosedStationIds.length * 75000;
            const submittedOn = isoDay(simulationDate);
            const req = {
                id: `infra-request-${nextInfrastructureRequestId++}`, lineId, name, code: String(input.code || '').slice(0, 40),
                color: /^#[0-9a-f]{6}$/i.test(String(input.color || '')) ? String(input.color) : '#3b82f6',
                stops, maxSpeed, electrify, routePlans, quotedClosedStationIds, quotedCost, submittedOn, decisionOn: dayPlus(submittedOn, 2),
                decidedOn: '', status: 'PENDING', networkOwner: INFRASTRUCTURE_OWNER, reason: '',
            };
            this.infrastructureRequests.push(req);
            return req;
        }
        finally {
            this._pendingInfrastructureSubmissions.delete(duplicateKey);
        }
    }
    async processInfrastructureRequests(simulationDate, world, orm, economy) {
        if (this._processingInfrastructureRequests)
            return 0;
        this._processingInfrastructureRequests = true;
        try {
            const day = isoDay(simulationDate);
            let changed = 0;
            for (const req of this.infrastructureRequests) {
                if (!['PENDING', 'AWAITING_FUNDS'].includes(req.status) || day < req.decisionOn)
                    continue;
                if (req.lineId && !this.getLine(req.lineId)) {
                    req.status = 'REJECTED';
                    req.reason = 'La ligne à modifier n’existe plus.';
                    req.decidedOn = day;
                    changed++;
                    continue;
                }
                const quoteChanged = (newTracks = null) => req.routePlans.some((p, i) => {
                    const current = world.getTrackBetween(req.stops[i], req.stops[i + 1]);
                    return p.existingTrackId
                        ? !current || current.id !== p.existingTrackId || Number(current.distance) !== p.distanceKm
                            || (p.quotedMaxSpeed !== undefined && Number(current.maxSpeed || 160) !== p.quotedMaxSpeed)
                            || (p.quotedElectrified !== undefined && !!current.electrified !== p.quotedElectrified)
                        : p.quotedParallelTrackId
                            ? !current || current.id !== p.quotedParallelTrackId
                            : !!current && !newTracks?.has(current.id);
                }) || !!(req.quotedClosedStationIds && req.stops.some((id) => !!world.getStationById(id)?.closed !== req.quotedClosedStationIds.includes(id)));
                if (quoteChanged()) {
                    req.status = 'REJECTED';
                    req.reason = 'La configuration des voies a changé depuis la demande.';
                    req.decidedOn = day;
                    changed++;
                    continue;
                }
                if (!Number.isFinite(Number(economy.balance)) || economy.balance < req.quotedCost) {
                    if (req.status !== 'AWAITING_FUNDS') {
                        req.status = 'AWAITING_FUNDS';
                        req.reason = 'Provision insuffisante ; le projet reste approuvé mais suspendu.';
                        req.decidedOn = day;
                        changed++;
                    }
                    continue;
                }
                const createdTrackIds = [];
                let staged = null;
                let fundsExhaustedDuringBuild = false;
                let restoreChanges = () => { };
                try {
                    staged = await this.buildLine({ name: req.name, code: req.code, color: req.color, stops: [...req.stops],
                        manualRoutes: req.routePlans.map((p) => p.route) }, world, orm, createdTrackIds);
                    if (!staged)
                        throw new Error('Le tracé ferroviaire ne peut plus être construit.');
                    const tracks = staged.trackIds.map((id) => world.tracks.find((t) => t.id === id));
                    if (tracks.some((t) => !t))
                        throw new Error('Voie construite introuvable.');
                    if (quoteChanged(new Set(createdTrackIds)))
                        throw new Error('La configuration des voies a changé depuis la demande.');
                    if (req.lineId && !this.getLine(req.lineId))
                        throw new Error('La ligne à modifier n’existe plus.');
                    // buildLine yields; other gameplay operations may spend the cash
                    // between the first balance check and this debit.
                    if (!Number.isFinite(Number(economy.balance)) || economy.balance < req.quotedCost) {
                        fundsExhaustedDuringBuild = true;
                        throw new Error('Provision insuffisante ; le projet reste approuvé mais suspendu.');
                    }
                    // A line is an operator's service right; physical tracks and stations
                    // remain entirely under the network authority.
                    const line = req.lineId ? this.getLine(req.lineId) : staged;
                    const oldStops = req.lineId ? [...line.stops] : [];
                    const lineBefore = req.lineId ? line.toSave() : null;
                    const stationStates = new Map();
                    for (const id of new Set([...oldStops, ...req.stops])) {
                        const station = world.getStationById(id);
                        if (!station)
                            throw new Error('Gare introuvable avant la décision du gestionnaire.');
                        stationStates.set(id, { station, closed: station.closed, lineIds: station.lineIds,
                            values: Array.isArray(station.lineIds) ? [...station.lineIds] : null });
                    }
                    const trackStates = tracks.map((track) => ({ track: track, maxSpeed: track.maxSpeed, electrified: track.electrified }));
                    restoreChanges = () => {
                        if (lineBefore)
                            Object.assign(line, lineBefore);
                        for (const { station, closed, lineIds, values } of stationStates.values()) {
                            station.closed = closed;
                            if (Array.isArray(lineIds) && values && !Object.isFrozen(lineIds)) {
                                lineIds.length = 0;
                                lineIds.push(...values);
                            }
                            station.lineIds = lineIds;
                        }
                        for (const { track, maxSpeed, electrified } of trackStates) {
                            if (track.maxSpeed !== maxSpeed)
                                track.maxSpeed = maxSpeed;
                            if (track.electrified !== electrified)
                                track.electrified = electrified;
                        }
                        this.invalidateTrackLineMap();
                    };
                    if (req.lineId) {
                        this.removeLine(staged.id);
                        line.name = req.name;
                        line.code = req.code;
                        line.color = req.color;
                        line.stops = [...req.stops];
                        line.trackIds = [...staged.trackIds];
                    }
                    line.infrastructureOwner = INFRASTRUCTURE_OWNER;
                    line.infrastructureRequestId = req.id;
                    line.requestedMaxSpeed = req.maxSpeed;
                    line.requestedElectrified = req.electrify;
                    for (const id of oldStops) {
                        const st = stationStates.get(id)?.station;
                        if (st)
                            st.lineIds = (Array.isArray(st.lineIds) ? st.lineIds : []).filter((lineId) => lineId !== line.id);
                    }
                    for (const id of req.stops) {
                        const st = stationStates.get(id)?.station;
                        if (st) {
                            st.closed = false;
                            if (!Array.isArray(st.lineIds))
                                st.lineIds = [];
                            if (!st.lineIds.includes(line.id))
                                st.lineIds.push(line.id);
                        }
                    }
                    for (const track of tracks) {
                        if (!track)
                            continue;
                        if (req.maxSpeed > 0)
                            track.maxSpeed = req.maxSpeed;
                        if (req.electrify)
                            track.electrified = true;
                    }
                    this.invalidateTrackLineMap();
                    // All potentially failing infrastructure edits are complete before
                    // the debit. A payment refusal restores their previous values.
                    if (!economy.addExpense(req.quotedCost, 'infrastructure', `Gestionnaire du réseau — ${req.name} (${req.id})`))
                        throw new Error('Paiement de la redevance refusé.');
                    req.status = 'APPROVED';
                    req.reason = 'Droits d’exploitation accordés ; infrastructure conservée par le gestionnaire.';
                    req.decidedOn = day;
                    changed++;
                }
                catch (err) {
                    try {
                        restoreChanges();
                    }
                    catch (rollbackError) {
                        console.warn('Restauration de la demande d’infrastructure incomplète :', rollbackError);
                    }
                    if (staged)
                        this.removeLine(staged.id);
                    for (const id of createdTrackIds)
                        world.removeTrack(id);
                    req.status = fundsExhaustedDuringBuild ? 'AWAITING_FUNDS' : 'REJECTED';
                    req.reason = err?.message || 'Projet refusé par le gestionnaire.';
                    req.decidedOn = day;
                    changed++;
                }
            }
            return changed;
        }
        finally {
            this._processingInfrastructureRequests = false;
        }
    }
    toSave() {
        const lines = this.lines.map((l) => l.toSave());
        // The existing save field is a lines array. A tagged record keeps all
        // previous saves compatible while persisting requests not yet approved.
        if (this.infrastructureRequests.length)
            lines.push({ id: '__infrastructure_requests_v1__', schemaVersion: 1, requests: this.infrastructureRequests.map((r) => structuredClone(r)) });
        return lines;
    }
    loadFromSave(data, world = null) {
        if (!Array.isArray(data)) {
            this.lines = [];
            this.infrastructureRequests = [];
            this.invalidateTrackLineMap();
            return;
        }
        const seen = new Set();
        const seenRequestIds = new Set();
        this.lines = [];
        this.infrastructureRequests = [];
        for (const raw of data) {
            if (!raw || typeof raw !== 'object')
                continue;
            if (raw.id === '__infrastructure_requests_v1__' && raw.schemaVersion === 1 && Array.isArray(raw.requests)) {
                for (const r of raw.requests) {
                    if (this.infrastructureRequests.length >= 500)
                        break;
                    if (!isRecord(r) || typeof r.id !== 'string' || !r.id || seenRequestIds.has(r.id)
                        || !Array.isArray(r.stops) || !Array.isArray(r.routePlans)
                        || !['PENDING', 'AWAITING_FUNDS', 'APPROVED', 'REJECTED'].includes(String(r.status)))
                        continue;
                    seenRequestIds.add(r.id);
                    this.infrastructureRequests.push(structuredClone(r));
                }
                continue;
            }
            const line = new Line(raw);
            if (!line.id || seen.has(line.id) || line.stops.length < 2)
                continue;
            if (line.stops.some((id, i) => i > 0 && id === line.stops[i - 1]))
                continue;
            if (world) {
                if (line.stops.some((id) => !world.getStationById?.(id)))
                    continue;
                const rebuilt = [];
                let ok = true;
                for (let i = 0; i < line.stops.length - 1; i++) {
                    const a = line.stops[i], b = line.stops[i + 1];
                    const savedId = line.trackIds[i];
                    const savedTrack = savedId ? (world.tracks || []).find((t) => t?.id === savedId) : null;
                    const connects = savedTrack && ((savedTrack.stationA === a && savedTrack.stationB === b) || (savedTrack.stationA === b && savedTrack.stationB === a));
                    const track = connects ? savedTrack : world.getTrackBetween?.(a, b);
                    if (!track) {
                        ok = false;
                        break;
                    }
                    rebuilt.push(track.id);
                }
                if (!ok)
                    continue;
                line.trackIds = rebuilt;
            }
            seen.add(line.id);
            this.lines.push(line);
        }
        this.invalidateTrackLineMap();
        nextLineId = this.lines.reduce((max, l) => {
            const num = parseInt(String(l.id || '').replace('line-', ''));
            return isNaN(num) ? max : Math.max(max, num + 1);
        }, nextLineId);
        nextInfrastructureRequestId = this.infrastructureRequests.reduce((max, r) => {
            const n = Number(String(r.id || '').replace('infra-request-', ''));
            return Number.isInteger(n) ? Math.max(max, n + 1) : max;
        }, nextInfrastructureRequestId);
    }
}
/** Called by the minute tick and on an opened Lines page after a save reload. */
export async function processDueInfrastructureRequests(game, simulationDate) {
    const day = isoDay(simulationDate);
    const due = game.lineManager.infrastructureRequests.some((r) => (r.status === 'PENDING' || (r.status === 'AWAITING_FUNDS' && Number(game.economy.balance) >= r.quotedCost))
        && r.decisionOn <= day);
    if (!due)
        return 0;
    const changed = await game.lineManager.processInfrastructureRequests(day, game.world, game.orm, game.economy);
    if (changed) {
        game.saveState();
        game.renderer?.invalidateStatic?.();
        if (game.ui?.activePage === 'lines')
            game.ui.renderLinesList?.();
    }
    return changed;
}
/**
 * PlatformManager - tracks platform allocation at stations.
 * Each station has N platforms. A train occupies one platform while stopped.
 */
export class PlatformManager {
    effectiveCapacity(stationId, value) {
        const parsed = Math.floor(Number(value));
        const base = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
        const result = Math.floor(Number(this.capacityProvider?.(stationId, base) ?? base));
        return Number.isFinite(result) && result >= base ? result : base;
    }
    constructor() {
        this.capacityProvider = null;
        this.physicalAliases = new Map();
        this.displayNames = new Map();
        this.physicallyReferencedKeys = new Map();
        // stationId -> { total: N, occupied: Map<platformIndex, trainId> }
        this.stationPlatforms = new Map();
    }
    initStation(stationId, numPlatforms) {
        const total = this.effectiveCapacity(stationId, numPlatforms);
        if (!this.stationPlatforms.has(stationId)) {
            this.stationPlatforms.set(stationId, {
                total,
                occupied: new Map(),
            });
        }
        else {
            // Update total if changed
            this.stationPlatforms.get(stationId).total = total;
        }
    }
    /**
     * Try to assign a platform to a train at a station.
     * Returns the platform name/number or null if all platforms are occupied.
     * @param {string} preferred - preferred platform name from schedule (optional)
     */
    assignPlatform(stationId, trainId, numPlatforms, preferred, options = null) {
        const parsedTotal = Math.floor(Number(numPlatforms));
        const baseTotal = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : 2;
        const requestedTotal = this.effectiveCapacity(stationId, baseTotal);
        if (!this.stationPlatforms.has(stationId)) {
            this.initStation(stationId, baseTotal);
        }
        else {
            // A station may first be touched through a fallback `2 platforms` path and
            // only later reveal its real OSM/gameplay capacity. Grow lazily when better
            // information arrives; never shrink merely because a later fallback says 2.
            const data0 = this.stationPlatforms.get(stationId);
            if (requestedTotal > Number(data0.total || 0))
                data0.total = requestedTotal;
        }
        const data = this.stationPlatforms.get(stationId);
        const exactPreferred = options === true || (typeof options === 'object' && options?.exactPreferred === true);
        const identity = typeof options === 'object' ? normalizeStationTrackIdentity(options?.trackIdentity) : null;
        if (identity)
            return this._assignPhysicalTrack(stationId, trainId, data, identity, typeof options === 'object' ? options?.displayName || '' : '');
        // Unbound legacy requests cannot enter an occupied physical track merely
        // because that train's display name differs from the stored ORM key.
        if (preferred != null && String(preferred).trim()) {
            const wantedLabel = canonicalTrackRef(preferred);
            for (const [key, label] of this.displayNames.get(stationId) || []) {
                const owner = data.occupied.get(key);
                if (!this.physicallyReferencedKeys.get(stationId)?.has(key) && canonicalTrackRef(label) === wantedLabel && owner != null && owner !== trainId)
                    return null;
            }
        }
        // A real ref may have been renamed or split across OSM ways. Legacy
        // requests must consult those same aliases, in either occupation order.
        const refAlias = preferred == null ? undefined : this.physicalAliases.get(stationId)?.get(`ref:${canonicalTrackRef(preferred)}`);
        if (refAlias != null) {
            const owner = data.occupied.get(refAlias);
            if (owner != null && owner !== trainId)
                return null;
            for (const [key, existingOwner] of data.occupied) {
                if (existingOwner === trainId && key !== refAlias)
                    return null;
            }
            data.occupied.set(refAlias, trainId);
            this.displayNames.get(stationId)?.delete(refAlias);
            return refAlias;
        }
        // Check if train already has a platform
        for (const [plat, tid] of data.occupied) {
            if (tid === trainId) {
                // The owner of track 1 is not automatically the owner of track 2.
                if (exactPreferred && preferred != null && String(preferred).trim()
                    && canonicalTrackRef(plat) !== canonicalTrackRef(preferred))
                    return null;
                return plat;
            }
        }
        // If a preferred platform/track was specified and it's free, use it.
        // V2 Schedule Creator bindings are exact physical track labels (e.g. Paris-Est
        // "20"), NOT ordinal platform numbers constrained by world.station.platforms.
        // When no native VoiePoint exists, exactPreferred preserves that track identity
        // as a station resource instead of falsely declaring "voie occupée" because
        // a generic station model happens to advertise only 2 platforms.
        if (preferred != null && String(preferred).trim() !== '') {
            const rawPreferred = String(preferred).trim();
            let preferredKey = null;
            const numericLabel = rawPreferred.match(/^(?:voie|track|gleis|v)?\s*(\d+)$/i);
            if (numericLabel) {
                const n = Number(numericLabel[1]);
                if (!Number.isSafeInteger(n))
                    preferredKey = exactPreferred ? canonicalTrackRef(rawPreferred) : null;
                else if (Number.isInteger(n) && n >= 1 && data.occupied.has(String(n)))
                    preferredKey = String(n); // Existing exact key survives newly discovered capacity.
                else if (Number.isInteger(n) && n >= 1 && n <= data.total)
                    preferredKey = n;
                else if (exactPreferred)
                    preferredKey = String(n);
            }
            else if (exactPreferred) {
                // A, 1 bis and V1M are real track labels, not requests for any track.
                preferredKey = rawPreferred;
            }
            if (preferredKey != null) {
                const owner = data.occupied.get(preferredKey);
                if (owner == null || owner === trainId) {
                    data.occupied.set(preferredKey, trainId);
                    return preferredKey;
                }
                // Exact requested track exists logically but is genuinely owned by another
                // train: never spill onto a different free platform.
                if (exactPreferred)
                    return null;
            }
        }
        // Find first free platform
        for (let i = 1; i <= data.total; i++) {
            const physicalKey = this.physicalAliases.get(stationId)?.get(`ref:${i}`) ?? i;
            if (!data.occupied.has(i) && !data.occupied.has(String(i)) && !data.occupied.has(physicalKey)) {
                data.occupied.set(physicalKey, trainId);
                this.displayNames.get(stationId)?.delete(physicalKey);
                return physicalKey;
            }
        }
        return null; // All platforms occupied
    }
    /** ORM aliases connect validated way IDs and real track refs, never display names. */
    _assignPhysicalTrack(stationId, trainId, data, identity, displayName) {
        const aliases = this.physicalAliases.get(stationId) || new Map();
        const resource = stationTrackResourceKey(identity);
        const ref = canonicalTrackRef(identity.trackRef);
        const aliasNames = ref ? [resource, `ref:${ref}`] : [resource];
        const candidates = new Set();
        for (const name of aliasNames) {
            const mapped = aliases.get(name);
            if (mapped != null)
                candidates.add(mapped);
        }
        // A legacy service using the real platform number must conflict with the
        // same ORM track. Both numeric representations occur in old/custom worlds.
        let refKey = null;
        if (ref) {
            const n = /^\d+$/.test(ref) ? Number(ref) : NaN;
            refKey = Number.isSafeInteger(n) && n >= 1 && n <= data.total ? n : ref;
            candidates.add(refKey);
            for (const key of data.occupied.keys()) {
                if (canonicalTrackRef(key) === ref)
                    candidates.add(key);
            }
        }
        // With no real track ref, an already occupied legacy label is ambiguous:
        // hold, do not invent proof that it is a different physical track. This is
        // only an occupancy guard, never an alias between two bound ORM tracks.
        if (!ref && displayName) {
            const legacyLabel = canonicalTrackRef(displayName);
            for (const [key, owner] of data.occupied) {
                if (!String(key).startsWith('@') && canonicalTrackRef(key) === legacyLabel && owner !== trainId)
                    return null;
            }
        }
        const key = aliases.get(resource) ?? (ref ? aliases.get(`ref:${ref}`) : undefined) ?? refKey ?? resource;
        candidates.add(key);
        // No reservation/alias is changed on refusal. Inconsistent imports with two
        // different owners stay blocked rather than losing one owner's protection.
        let sharedOwner = null;
        for (const candidate of candidates) {
            const owner = data.occupied.get(candidate);
            if (owner != null && owner !== trainId) {
                if (!ref || !compositeStationTrackShare(stationId, ref, owner, trainId) || (sharedOwner && sharedOwner !== owner))
                    return null;
                sharedOwner = owner;
            }
        }
        for (const [owned, owner] of data.occupied) {
            if (owner === trainId && !candidates.has(owned))
                return null;
        }
        // The controlling train retains the one physical platform claim during
        // the low-speed coupling approach. The follower never steals its owner.
        if (sharedOwner)
            return key;
        for (const candidate of candidates) {
            if (candidate !== key && data.occupied.get(candidate) === trainId)
                data.occupied.delete(candidate);
        }
        for (const [name, oldKey] of aliases) {
            if (candidates.has(oldKey))
                aliases.set(name, key);
        }
        for (const name of aliasNames)
            aliases.set(name, key);
        this.physicalAliases.set(stationId, aliases);
        const realRefs = this.physicallyReferencedKeys.get(stationId) || new Set();
        if (ref || [...candidates].some(candidate => realRefs.has(candidate)))
            realRefs.add(key);
        this.physicallyReferencedKeys.set(stationId, realRefs);
        data.occupied.set(key, trainId);
        const labels = this.displayNames.get(stationId) || new Map();
        labels.set(key, displayName || identity.trackRef || resource);
        this.displayNames.set(stationId, labels);
        return key;
    }
    /** Identify a unique blocking owner without mutating aliases/reservations. */
    getPhysicalTrackOwner(stationId, input, displayName = '') {
        const identity = normalizeStationTrackIdentity(input);
        const data = this.stationPlatforms.get(stationId);
        if (!identity || !data)
            return null;
        const aliases = this.physicalAliases.get(stationId);
        const ref = canonicalTrackRef(identity.trackRef);
        const keys = new Set([stationTrackResourceKey(identity)]);
        for (const name of [stationTrackResourceKey(identity), ...(ref ? [`ref:${ref}`] : [])]) {
            const key = aliases?.get(name);
            if (key != null)
                keys.add(key);
        }
        if (ref) {
            for (const key of data.occupied.keys())
                if (canonicalTrackRef(key) === ref)
                    keys.add(key);
        }
        else if (displayName) {
            for (const key of data.occupied.keys()) {
                if (!String(key).startsWith('@') && canonicalTrackRef(key) === canonicalTrackRef(displayName))
                    keys.add(key);
            }
        }
        const owners = new Set();
        for (const key of keys) {
            const owner = data.occupied.get(key);
            if (owner != null)
                owners.add(owner);
        }
        return owners.size === 1 ? owners.values().next().value : null;
    }
    /**
     * Release a platform when a train departs.
     */
    releasePlatform(stationId, trainId) {
        const data = this.stationPlatforms.get(stationId);
        if (!data)
            return;
        for (const [plat, tid] of data.occupied) {
            if (tid === trainId) {
                data.occupied.delete(plat);
                this.displayNames.get(stationId)?.delete(plat);
                return;
            }
        }
    }
    /**
     * Get the platform a train is on, or null.
     */
    getPlatformForTrain(stationId, trainId) {
        const data = this.stationPlatforms.get(stationId);
        if (!data)
            return null;
        for (const [plat, tid] of data.occupied) {
            if (tid === trainId)
                return plat;
        }
        return null;
    }
    /**
     * Check how many free platforms are available.
     */
    getFreePlatforms(stationId) {
        const data = this.stationPlatforms.get(stationId);
        if (!data)
            return 0;
        return Math.max(0, Number(data.total || 0) - data.occupied.size);
    }
    /**
     * Get platform status for display.
     */
    getStatus(stationId) {
        const data = this.stationPlatforms.get(stationId);
        if (!data)
            return { total: 0, used: 0, free: 0, assignments: [] };
        const assignments = [];
        for (const [plat, tid] of data.occupied) {
            assignments.push({ platform: this.displayNames.get(stationId)?.get(plat) || plat, resourceId: plat, trainId: tid });
        }
        return {
            total: data.total,
            used: data.occupied.size,
            free: Math.max(0, Number(data.total || 0) - data.occupied.size),
            assignments,
        };
    }
}
