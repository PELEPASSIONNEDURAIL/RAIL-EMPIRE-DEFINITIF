import { canonicalTrackRef, stationTrackIdentityFromBinding, stationTrackResourceKey } from './station-track-identity.js';
import { segmentsFromRoute, simulateProfile } from './train-physics.js';
import { RailRouteMeasure } from './route-linear-reference.js';
import { cantonManager as sharedCantons } from './schedule-creator.js';
import { civilDateAt, simulationEpochSec } from './civil-game-time.js';
const text = (v) => String(v ?? '').trim();
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const numeric = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const copy = (v) => JSON.parse(JSON.stringify(v));
const kinds = ['canton', 'track', 'platform', 'approach', 'flank', 'overlap', 'switch', 'crossing', 'loop'];
const intervalKey = (resource, service) => JSON.stringify([resource, service]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function epoch(game) { const ms = game.engine?.getSimulationEpochMs?.(); return finite(ms) ? ms : null; }
function haversine(aLat, aLon, bLat, bLon) { const r = Math.PI / 180, x = Math.sin((bLat - aLat) * r / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin((bLon - aLon) * r / 2) ** 2; return 12742 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x))); }
/** The observer never owns a railway resource. Forecasts use canonical canton IDs,
 * actual validated schedule dates and the same physical profile as the timetable. */
export class NodeCapacity {
    constructor() {
        this.resources = new Map();
        this.active = new Map();
        this.history = [];
        this.eventIds = new Set();
        this.cursorEpochMs = null;
        this.physicsCache = new Map();
    }
    configureResource(data) {
        if (!text(data.id) || !kinds.includes(data.kind))
            throw new TypeError('Ressource physique et catégorie requises.');
        const resource = { id: text(data.id), kind: data.kind, nodeId: text(data.nodeId), capacity: Math.max(1, Math.floor(numeric(data.capacity, 1))),
            lengthM: data.lengthM == null ? null : Math.max(0, numeric(data.lengthM)), headwaySec: Math.max(0, numeric(data.headwaySec)), turnaroundSec: Math.max(0, numeric(data.turnaroundSec)), wayIds: [...new Set((data.wayIds || []).map(String))] };
        this.resources.set(resource.id, resource);
        return copy(resource);
    }
    resource(id, kind) { return this.resources.get(id) || { id, kind, nodeId: '', capacity: 1, lengthM: null, headwaySec: 0, turnaroundSec: 0, wayIds: [] }; }
    onResourceEvent(event) {
        if (!event || !text(event.resourceId) || !text(event.serviceId) || !kinds.includes(event.kind) || !finite(event.simEpochMs) || !['acquire', 'release', 'transfer'].includes(event.type))
            return false;
        const eventId = text(event.eventId) || `${event.type}:${event.resourceId}:${event.serviceId}:${event.simEpochMs}:${text(event.previousServiceId)}`;
        if (this.eventIds.has(eventId))
            return true;
        if (this.cursorEpochMs != null && event.simEpochMs < this.cursorEpochMs)
            return false;
        this.cursorEpochMs = event.simEpochMs;
        this.eventIds.add(eventId);
        while (this.eventIds.size > 2000)
            this.eventIds.delete(this.eventIds.values().next().value);
        if (!this.resources.has(event.resourceId))
            this.configureResource({ id: event.resourceId, kind: event.kind });
        const end = (owner) => { const key = intervalKey(event.resourceId, owner), open = this.active.get(key); if (!open)
            return; open.endEpochMs = event.simEpochMs; this.active.delete(key); this.history.push(copy(open)); while (this.history.length > 2000)
            this.history.shift(); };
        if (event.type === 'release') {
            end(event.serviceId);
            return true;
        }
        if (event.type === 'transfer' && event.previousServiceId)
            end(event.previousServiceId);
        const key = intervalKey(event.resourceId, event.serviceId);
        if (this.active.has(key))
            return true;
        this.active.set(key, { id: `${key}:${event.simEpochMs}`, resourceId: event.resourceId, kind: event.kind, serviceId: event.serviceId, startEpochMs: event.simEpochMs, endEpochMs: null,
            source: 'observed', lengthM: finite(event.lengthM) ? event.lengthM : null, speedKmh: finite(event.speedKmh) ? event.speedKmh : null, position: text(event.position), confidence: 'known' });
        return true;
    }
    observeGame(game) {
        const now = epoch(game);
        if (now == null)
            return;
        const owners = new Map(), services = new Map((game.scheduleCreator?.services || []).map(s => [text(s.id), s]));
        for (const [station, data] of game.platformManager?.stationPlatforms || [])
            for (const [track, owner] of data.occupied)
                owners.set(`platform:${station}:${String(track).startsWith('@') ? track : canonicalTrackRef(track)}`, text(owner));
        for (const row of [...this.active.values()])
            if (row.kind === 'platform' && owners.get(row.resourceId) !== row.serviceId)
                this.onResourceEvent({ resourceId: row.resourceId, kind: 'platform', serviceId: row.serviceId, type: 'release', simEpochMs: now });
        for (const [id, owner] of owners) {
            const service = services.get(owner);
            this.onResourceEvent({ resourceId: id, kind: 'platform', serviceId: owner, type: 'acquire', simEpochMs: now,
                lengthM: service?.rame?.totalLength, speedKmh: service?.speed ?? service?.train?.speed });
        }
    }
    window(input) {
        if (!finite(input.startEpochMs) || !finite(input.endEpochMs) || input.endEpochMs <= input.startEpochMs || input.endEpochMs - input.startEpochMs > 8 * 86400000)
            throw new TypeError('Fenêtre de capacité simulée finie, jusqu’à huit jours requise.');
        return { startEpochMs: input.startEpochMs, endEpochMs: input.endEpochMs, binMs: Math.max(1000, Math.min(3600000, numeric(input.binSec, 300) * 1000)) };
    }
    analyze(input, planned = [], missing = []) {
        const { startEpochMs, endEpochMs, binMs } = this.window(input), all = [...this.history, ...this.active.values(), ...planned].filter(row => row.startEpochMs < endEpochMs && (row.endEpochMs ?? endEpochMs) > startEpochMs);
        const byResource = new Map(), resources = new Map(this.resources);
        for (const row of all) {
            if (!resources.has(row.resourceId))
                resources.set(row.resourceId, this.resource(row.resourceId, row.kind));
            const rows = byResource.get(row.resourceId) || [];
            rows.push(row);
            byResource.set(row.resourceId, rows);
        }
        const conflicts = [], heatmap = [];
        for (const [id, rows] of byResource) {
            const resource = resources.get(id);
            rows.sort((a, b) => a.startEpochMs - b.startEpochMs);
            const active = [];
            for (const row of rows) {
                const end = row.endEpochMs ?? endEpochMs;
                if (resource.lengthM != null && row.lengthM != null && row.lengthM > resource.lengthM)
                    conflicts.push({ code: 'USEFUL_LENGTH', resourceId: id, serviceId: row.serviceId, startEpochMs: row.startEpochMs, endEpochMs: end, severity: 'ERROR', message: `Formation ${row.lengthM} m supérieure à la longueur utile ${resource.lengthM} m.` });
                for (let i = active.length - 1; i >= 0; i--)
                    if ((active[i].endEpochMs ?? endEpochMs) + resource.headwaySec * 1000 <= row.startEpochMs)
                        active.splice(i, 1);
                const owners = new Set(active.filter(prior => prior.serviceId !== row.serviceId && (resource.kind !== 'switch' || !prior.position || !row.position || prior.position !== row.position)).map(prior => prior.serviceId));
                if (owners.size >= resource.capacity) {
                    const prior = active.find(p => owners.has(p.serviceId));
                    const overlap = (prior.endEpochMs ?? endEpochMs) > row.startEpochMs;
                    conflicts.push({ code: overlap ? 'RESOURCE_CONFLICT' : 'HEADWAY_CONFLICT', resourceId: id, serviceId: row.serviceId, causingServiceId: prior.serviceId, startEpochMs: row.startEpochMs, endEpochMs: Math.min(end, (prior.endEpochMs ?? endEpochMs) + resource.headwaySec * 1000),
                        severity: row.confidence === 'known' && prior.confidence === 'known' ? 'ERROR' : 'WARNING', message: overlap ? `Ressource partagée avec ${prior.serviceId}.` : `Intervalle inférieur au headway ${resource.headwaySec} s après ${prior.serviceId}.` });
                }
                active.push(row);
            }
            for (let begin = startEpochMs; begin < endEpochMs && heatmap.length < 10000; begin += binMs) {
                const end = Math.min(endEpochMs, begin + binMs), edges = [];
                for (const row of rows) {
                    const a = Math.max(begin, row.startEpochMs), b = Math.min(end, row.endEpochMs ?? endEpochMs);
                    if (b > a) {
                        edges.push({ time: a, owner: row.serviceId, delta: 1 }, { time: b, owner: row.serviceId, delta: -1 });
                    }
                }
                if (!edges.length)
                    continue;
                edges.sort((a, b) => a.time - b.time || a.delta - b.delta);
                let last = begin, used = 0, max = 0;
                const owners = new Map();
                for (const edge of edges) {
                    used += (edge.time - last) * owners.size / 1000;
                    last = edge.time;
                    const count = (owners.get(edge.owner) || 0) + edge.delta;
                    if (count <= 0)
                        owners.delete(edge.owner);
                    else
                        owners.set(edge.owner, count);
                    max = Math.max(max, owners.size);
                }
                heatmap.push({ resourceId: id, kind: resource.kind, nodeId: resource.nodeId, startEpochMs: begin, endEpochMs: end, occupiedSeconds: used, utilization: used / ((end - begin) / 1000 * resource.capacity), maxOwners: max, capacity: resource.capacity,
                    conflicts: conflicts.filter(c => c.resourceId === id && c.startEpochMs < end && c.endEpochMs > begin).length });
            }
        }
        return copy({ startEpochMs, endEpochMs, intervals: all.slice(0, 20000), resources: [...resources.values()].slice(0, 2000), conflicts: conflicts.slice(0, 2000), missing: missing.slice(0, 2000), heatmap, truncated: all.length > 20000 || conflicts.length > 2000 || heatmap.length >= 10000 });
    }
    applicable(game, version, date) { return version.state === 'VALID' && (!(version.calendarIds?.length) || version.calendarIds.some(id => game.scheduleV2?.calendars.find(c => c.id === id)?.matchesDate(date))); }
    future(game, date, horizonEnd) {
        const intervals = [], missing = [], sm = game.scheduleV2, rm = game.rotationV2, cm = game.cantonManager || sharedCantons;
        if (!sm)
            return { intervals, missing };
        const atEpoch = (relativeSec) => simulationEpochSec(date, relativeSec) * 1000;
        atEpoch(0); // Validate the civil operating date before forecasting any movement.
        const items = [], covered = new Set();
        for (const rotation of rm?.rotations || []) {
            if (rotation.calendarId && !sm.calendars.find(c => c.id === rotation.calendarId)?.matchesDate(date))
                continue;
            for (const occ of rotation.occurrences) {
                if (occ.cancelled)
                    continue;
                items.push({ occ, rotation, owner: `v2:${rotation.id}:${occ.id}:${date}`, formation: occ.formation?.members.length ? occ.formation : rotation.assignedFormation });
                covered.add(occ.scheduleId);
            }
        }
        for (const occ of rm?.directAssignments || []) {
            if (occ.enabled === false || rm?.directAssignmentSuppressed?.(occ, date))
                continue;
            items.push({ occ, owner: `v2:direct:${occ.id}:${occ.id}:${date}`, formation: occ.formation });
            covered.add(occ.scheduleId);
        }
        for (const rec of sm.schedules)
            if (!covered.has(rec.id)) {
                const version = sm.resolveVersion(rec.id, date);
                if (version)
                    items.push({ occ: { id: rec.id, scheduleId: rec.id, versionId: version.id }, owner: `schedule:${rec.id}:${date}` });
            }
        for (const item of items) {
            const occ = item.occ, version = sm.getVersion(occ.scheduleId, occ.versionId);
            if (!version || !this.applicable(game, version, date))
                continue;
            const issue = (code, message, resourceId) => { missing.push({ code, serviceId: item.owner, message, ...resourceId ? { resourceId } : {} }); };
            let profile = { ...version.performanceProfile }, formation = item.formation;
            if (item.rotation?.assignmentMode === 'POOL') {
                const assigned = game.scheduleV2Runtime?.getDailyRotationPlan?.(item.rotation.id, date)?.assignments.find(a => a.occurrenceId === occ.id);
                if (!assigned) {
                    issue('MISSING_POOL_FORMATION', 'Aucun tirage daté sauvegardé; le diagnostic ne tire pas de nouveau matériel.');
                    continue;
                }
                formation = { members: assigned.formationMembers };
            }
            if (formation?.members.length && rm) {
                const calculated = formation.calculate?.(rm);
                if (calculated)
                    profile = { ...profile, ...calculated };
                else {
                    const vehicles = formation.members.map(m => rm.getVehicle(m.vehicleId));
                    if (vehicles.some(v => !v)) {
                        issue('MISSING_FORMATION', 'Véhicule de la formation prévu absent.');
                        continue;
                    }
                    profile.lengthM = vehicles.reduce((sum, v) => sum + numeric(v?.lengthM), 0);
                }
            }
            else if (occ.rameId) {
                const rame = game.rameManager?.getById(occ.rameId);
                if (rame)
                    profile = { ...profile, lengthM: rame.totalLength, massKg: numeric(rame.totalMass) * 1000, powerW: numeric(rame.totalPower) * 1000, maxSpeed: rame.maxSpeed };
            }
            if (!numeric(profile.lengthM)) {
                issue('MISSING_LENGTH', 'Longueur physique de formation non connue.');
            }
            const length = numeric(profile.lengthM), offset = numeric(occ.offsetSec) + numeric(occ.dateOffsetDays) * 86400;
            const firstDeparture = version.locations[0]?.departureSec ?? version.locations[0]?.computedDepartureSec;
            const shift = offset + (finite(occ.resolvedStartSec) && finite(firstDeparture) ? occ.resolvedStartSec - firstDeparture : 0);
            const clocks = version.locations.map(loc => ({ loc, arrival: loc.arrivalSec ?? loc.computedArrivalSec, departure: loc.departureSec ?? loc.computedDepartureSec }));
            const sections = [], sectionsByOrigin = new Map();
            let globalDistance = 0;
            for (let i = 0; i < clocks.length - 1; i++) {
                const origin = clocks[i], destination = clocks[i + 1], leg = version.outboundPath.legs.find(l => l.fromLocationId === origin.loc.id && l.toLocationId === destination.loc.id);
                if (!leg?.routePoints?.length || leg.routePoints.length < 2) {
                    issue('MISSING_PATH', `Liaison ferroviaire inconnue ${origin.loc.id} → ${destination.loc.id}.`);
                    continue;
                }
                if (!finite(origin.departure) || !finite(destination.arrival) || destination.arrival <= origin.departure) {
                    issue('MISSING_TIME', `Heures de liaison invalides ${origin.loc.id} → ${destination.loc.id}.`);
                    continue;
                }
                const start = atEpoch(origin.departure + shift), end = atEpoch(destination.arrival + shift), available = (end - start) / 1000;
                if (available <= 0) {
                    issue('MISSING_TIME', `Durée physique de liaison invalide ${origin.loc.id} → ${destination.loc.id}.`);
                    continue;
                }
                const route = leg.routePoints, key = JSON.stringify([route, profile]);
                let physical = this.physicsCache.get(key);
                if (!physical) {
                    const measure = new RailRouteMeasure(route), distances = Array.from(measure.cumulativeKm, d => d * 1000), segments = segmentsFromRoute(route, numeric(profile.maxSpeed, 160), haversine);
                    const params = { ...version.performanceProfile.toPhysicsParams?.(), ...profile, massKg: numeric(profile.massKg, 500000), powerW: numeric(profile.powerW, 5000000), lengthM: length, startMs: 0, endMs: 0, collectSegmentTimes: true, dsStep: Math.max(20, Math.ceil((distances.at(-1) || 0) / 45000)) };
                    physical = { distances, sim: simulateProfile(segments, params) };
                    this.physicsCache.set(key, physical);
                    while (this.physicsCache.size > 128)
                        this.physicsCache.delete(this.physicsCache.keys().next().value);
                }
                const { sim } = physical;
                if (!finite(sim.timeSec) || sim.segmentTimeSec.length !== route.length - 1) {
                    issue('MISSING_PHYSICAL_TIME', `Profil physique non calculable ${origin.loc.id} → ${destination.loc.id}.`);
                    continue;
                }
                const scale = available / sim.timeSec, times = [0];
                for (const sec of sim.segmentTimeSec)
                    times.push(times.at(-1) + sec * scale);
                const distances = physical.distances;
                if (available + 1 < sim.timeSec)
                    issue('PHYSICAL_TIMING', `Temps prévu ${available.toFixed(0)} s inférieur au parcours physique ${sim.timeSec.toFixed(0)} s.`);
                const preview = cm.previewRouteCantons(route), section = { originIndex: i, route, assignments: preview.assignments, plans: new Map(preview.routes.map((plan) => [plan.id, plan])), distances, times, start, end, offsetM: globalDistance };
                sections.push(section);
                sectionsByOrigin.set(i, section);
                globalDistance += distances.at(-1) || 0;
            }
            const at = (distance, origin) => {
                // Preserve the existing shared-boundary interpolation for consecutive legs.
                // A train tail may continue into the next known leg, but never across an
                // omitted path/time/profile: its release then remains conservative.
                let expected = origin.originIndex - (distance === origin.offsetM && sectionsByOrigin.has(origin.originIndex - 1) ? 1 : 0);
                for (const section of sections) {
                    if (section.originIndex < expected)
                        continue;
                    if (section.originIndex !== expected)
                        return { ms: horizonEnd, known: false };
                    expected++;
                    const local = distance - section.offsetM, last = section.distances.at(-1) || 0;
                    if (local < 0)
                        continue;
                    if (local <= last) {
                        let j = 0;
                        while (j < section.distances.length - 2 && section.distances[j + 1] < local)
                            j++;
                        const fraction = (local - section.distances[j]) / Math.max(.00001, section.distances[j + 1] - section.distances[j]);
                        return { ms: section.start + (section.times[j] + (section.times[j + 1] - section.times[j]) * clamp(fraction, 0, 1)) * 1000, known: true };
                    }
                }
                return { ms: horizonEnd, known: false };
            };
            const add = (resourceId, kind, start, end, position = '') => {
                if (!resourceId || end.ms <= start)
                    return;
                intervals.push({ id: `${item.owner}:${resourceId}:${start}`, resourceId, kind, serviceId: item.owner, startEpochMs: start, endEpochMs: end.ms, source: 'planned', lengthM: length || null, speedKmh: null, position, confidence: end.known ? 'known' : 'conservative' });
            };
            // Explicit way bindings also represent shared junction throats, crossing
            // routes and single-track sections. Project train head entry and tail exit.
            for (const resource of this.resources.values())
                if (resource.wayIds.length) {
                    for (const section of sections) {
                        let begin = -1;
                        for (let i = 0; i < section.route.length; i++) {
                            const matches = resource.wayIds.includes(text(section.route[i]?.wayId));
                            if (matches && begin < 0)
                                begin = i;
                            if (begin >= 0 && (!matches || i === section.route.length - 1)) {
                                const end = matches ? i : Math.max(begin, i - 1);
                                const head = at(section.offsetM + section.distances[begin], section);
                                const tail = at(section.offsetM + section.distances[end] + length, section);
                                add(resource.id, resource.kind, head.ms, tail);
                                begin = -1;
                            }
                        }
                    }
                }
            for (const section of sections)
                for (const assignment of section.assignments) {
                    const head = at(section.offsetM + assignment.startKm * 1000, section), tail = at(section.offsetM + assignment.endKm * 1000 + length, section);
                    add(assignment.cantonId, 'canton', head.ms, tail);
                    for (const id of assignment.resourceIds || [])
                        add(id, 'track', head.ms, tail);
                    const route = assignment.interlockingRouteId ? section.plans.get(assignment.interlockingRouteId) : null;
                    if (route) {
                        const release = at(section.offsetM + route.releaseAtKm * 1000 + length, section), approach = head.ms - route.approachLockSec * 1000;
                        for (const id of route.flankCantonIds)
                            add(id, 'flank', approach, release);
                        for (const id of route.overlapCantonIds)
                            add(id, 'overlap', approach, release);
                        add(route.id, 'approach', approach, release);
                        for (const sw of route.switches)
                            add(sw.id, 'switch', approach, release, sw.position);
                    }
                }
            for (let i = 0; i < clocks.length; i++) {
                const { loc, arrival, departure } = clocks[i], station = text(loc.stationId || loc.technicalLocationId);
                if (!station || !loc.track)
                    continue;
                const identity = stationTrackIdentityFromBinding(loc.track), label = identity ? stationTrackResourceKey(identity) : canonicalTrackRef(loc.track.trackRef || loc.track.displayName);
                if (!label) {
                    issue('MISSING_PLATFORM', `Voie prévue absente au point ${loc.id}.`);
                    continue;
                }
                const id = `platform:${station}:${label}`, begin = finite(arrival) ? atEpoch(arrival + shift) : finite(departure) ? atEpoch(departure + shift) : NaN;
                if (!finite(begin)) {
                    issue('MISSING_TIME', `Heure de quai inconnue ${loc.id}.`, id);
                    continue;
                }
                const outgoing = sectionsByOrigin.get(i);
                let end;
                if (outgoing && finite(departure))
                    end = at(outgoing.offsetM + length, outgoing);
                else {
                    end = { ms: horizonEnd, known: false };
                    issue('MISSING_TERMINAL_CLEARANCE', `Libération terminale physique inconnue ${loc.id}; occupation conservatrice.`, id);
                }
                const resource = this.resource(id, 'platform');
                if (loc.turnBack && finite(departure))
                    end = { ms: Math.max(end.ms, atEpoch(departure + shift) + resource.turnaroundSec * 1000), known: end.known };
                add(id, 'platform', begin, end);
            }
        }
        return { intervals, missing };
    }
    analyzeGame(game, input) { const window = this.window(input), date = text(input.dateStr) || civilDateAt(window.startEpochMs); const future = this.future(game, date, window.endEpochMs); return this.analyze(input, future.intervals, future.missing); }
    validateGamePlan(game, input) { const result = this.analyzeGame(game, input), enforce = game.resolveRealismPolicy?.('signaling').enforce ?? game.realismSettings?.difficulty === 'expert'; return { ok: !enforce || !result.conflicts.some(c => c.severity === 'ERROR'), conflicts: result.conflicts, missing: result.missing }; }
    toSave() { return copy({ schemaVersion: 1, cursorEpochMs: this.cursorEpochMs, resources: [...this.resources.values()], history: this.history.slice(-2000), active: [...this.active.values()], eventIds: [...this.eventIds] }); }
    loadFromSave(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return false;
        const save = value;
        if (save.schemaVersion !== 1 || save.cursorEpochMs !== null && !finite(save.cursorEpochMs) || !Array.isArray(save.resources) || save.resources.length > 100000 || !Array.isArray(save.history) || save.history.length > 2000 || !Array.isArray(save.active) || save.active.length > 100000 || !Array.isArray(save.eventIds) || save.eventIds.length > 2000)
            return false;
        const candidate = new NodeCapacity();
        try {
            for (const row of save.resources) {
                if (candidate.resources.has(row.id) || !finite(row.capacity) || row.capacity < 1 || row.lengthM !== null && !finite(row.lengthM) || !finite(row.headwaySec) || !finite(row.turnaroundSec))
                    return false;
                candidate.configureResource(row);
            }
            for (const row of [...save.history, ...save.active]) {
                if (!row || !text(row.id) || !text(row.serviceId) || !text(row.resourceId) || !kinds.includes(row.kind) || !finite(row.startEpochMs) || row.endEpochMs !== null && (!finite(row.endEpochMs) || row.endEpochMs < row.startEpochMs) || row.lengthM !== null && !finite(row.lengthM) || !['known', 'conservative'].includes(row.confidence) || row.source !== 'observed')
                    return false;
                const key = intervalKey(row.resourceId, row.serviceId);
                if (row.endEpochMs === null) {
                    if (candidate.active.has(key))
                        return false;
                    candidate.active.set(key, copy(row));
                }
                else
                    candidate.history.push(copy(row));
            }
            for (const id of save.eventIds) {
                if (!text(id))
                    return false;
                candidate.eventIds.add(id);
            }
            candidate.cursorEpochMs = save.cursorEpochMs;
        }
        catch {
            return false;
        }
        this.resources.clear();
        for (const [id, row] of candidate.resources)
            this.resources.set(id, row);
        this.active.clear();
        for (const [id, row] of candidate.active)
            this.active.set(id, row);
        this.history.splice(0, this.history.length, ...candidate.history);
        this.eventIds.clear();
        for (const id of candidate.eventIds)
            this.eventIds.add(id);
        this.cursorEpochMs = candidate.cursorEpochMs;
        return true;
    }
}
