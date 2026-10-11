const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const pos = (v) => Math.max(0, num(v));
const str = (v) => String(v ?? '').trim();
const bound = (v, lo, hi) => Math.min(hi, Math.max(lo, num(v, lo)));
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(str).filter(Boolean))];
const copy = (v) => JSON.parse(JSON.stringify(v));
const alive = (s) => s.active !== false && !s.cancelled && !s.completed && !['completed', 'cancelled', 'arrived'].includes(s.state || '');
const absolute = (date, minutes) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) + num(minutes) * 60;
const distanceM = (a, b) => {
    const r = Math.PI / 180, dlat = (num(b.lat) - num(a.lat)) * r, dlon = (num(b.lon) - num(a.lon)) * r;
    return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dlat / 2) ** 2 + Math.cos(num(a.lat) * r) * Math.cos(num(b.lat) * r) * Math.sin(dlon / 2) ** 2)));
};
export function networkPolicy(game, system) {
    if (game?.resolveRealismPolicy)
        return game.resolveRealismPolicy(system);
    const expert = game?.realismSettings?.difficulty === 'expert', ultra = ['pneumatic', 'noise', 'crossings'].includes(system);
    const enabled = ultra ? game?.realismSettings?.[system] === true : game?.realismSettings?.[system] !== false;
    return { enabled, enforce: expert && enabled, delegated: !expert };
}
export class NetworkOperations {
    constructor(host) {
        this.host = host;
        this.substations = new Map();
        this.feeders = new Map();
        this.assets = new Map();
        this.maintenance = new Map();
        this.borders = new Map();
        this.environment = new Map();
        this.crossings = new Map();
        this.connections = new Map();
        this.priorities = new Map();
        this.causes = new Map();
        this.progress = new Map();
        this.borderVisits = new Map();
        this.environmentEvents = new Set();
        this.totals = { consumedKwh: 0, recoveredKwh: 0, dissipatedKwh: 0, cost: 0, dieselCo2Kg: 0, electricCo2Kg: 0, noiseComplaints: 0, ecoDrivingKm: 0, ecoBonus: 0 };
        this.cursorSec = null;
        this.energy = [];
        this.conflicts = [];
        this.borderRows = [];
        this.connectionRows = [];
        this.effects = new Map();
        this.indexDirty = true;
        this.railIndex = new Map();
        this.sectionIndex = new Map();
        this.componentCache = new Map();
    }
    required(data) { const id = str(data.id); if (!id)
        throw new TypeError('Identité réseau requise.'); return id; }
    configureSubstation(data) {
        const id = this.required(data), sectionId = str(data.sectionId), voltage = pos(data.nominalVoltage), capacity = pos(data.capacityKw);
        if (!sectionId || !voltage || !capacity)
            throw new TypeError('Section, tension et capacité de sous-station requises.');
        this.indexDirty = true;
        this.substations.set(id, { id, sectionId, nominalVoltage: voltage, capacityKw: capacity, maxCurrentA: pos(data.maxCurrentA) || capacity * 1000 / voltage,
            resistanceOhm: bound(data.resistanceOhm ?? .01, 0, 10), outage: data.outage === true });
    }
    configureFeeder(data) {
        const id = this.required(data), from = str(data.from), to = str(data.to);
        if (!from || !to || from === to)
            throw new TypeError('Deux sections distinctes requises.');
        const a = this.host.powerSections.get(from), b = this.host.powerSections.get(to);
        if (a && b && (Math.abs(a.nominalVoltage - b.nominalVoltage) > Math.max(50, a.nominalVoltage * .03) || Math.abs(num(a.frequency) - num(b.frequency)) > 1))
            throw new TypeError('Systèmes électriques incompatibles : feeder refusé.');
        this.indexDirty = true;
        this.feeders.set(id, { id, from, to, closed: data.closed !== false, resistanceOhm: bound(data.resistanceOhm ?? .01, 0, 10) });
    }
    configureAsset(data) {
        const id = this.required(data), wayIds = ids(data.wayIds);
        if (!wayIds.length)
            throw new TypeError('Identité ferroviaire de l’infrastructure requise.');
        this.indexDirty = true;
        this.assets.set(id, { id, kind: str(data.kind) || 'track', wayIds, condition: bound(data.condition ?? 100, 0, 100),
            wearPerMillionTonneKm: bound(data.wearPerMillionTonneKm ?? .1, 0, 100000), slowBelow: bound(data.slowBelow ?? 35, 0, 100),
            closeBelow: bound(data.closeBelow ?? 10, 0, 100), ltvKmh: bound(data.ltvKmh ?? 40, 1, 400), ageDays: pos(data.ageDays),
            initialQuality: bound(data.initialQuality ?? 100, 1, 100), tonneKm: pos(data.tonneKm), possessionBy: str(data.possessionBy), inspectionDue: data.inspectionDue === true });
    }
    configureBorder(data) {
        const id = this.required(data);
        this.indexDirty = true;
        this.borders.set(id, { id, wayIds: ids(data.wayIds), country: str(data.country).toUpperCase(),
            voltage: pos(data.voltage), frequency: pos(data.frequency), signaling: str(data.signaling).toUpperCase(), dwellSec: pos(data.dwellSec), forbiddenCargoTypes: ids(data.forbiddenCargoTypes), forbiddenHazardClasses: ids(data.forbiddenHazardClasses) });
    }
    configureEnvironment(data) {
        const id = this.required(data);
        this.indexDirty = true;
        this.environment.set(id, { id, wayIds: ids(data.wayIds),
            nightSpeedKmh: pos(data.nightSpeedKmh), daySpeedKmh: pos(data.daySpeedKmh), dieselKgCo2PerLitre: pos(data.dieselKgCo2PerLitre) || 2.68,
            electricKgCo2PerKwh: pos(data.electricKgCo2PerKwh), noiseDbAt80Kmh: pos(data.noiseDbAt80Kmh), noiseLimitDb: pos(data.noiseLimitDb) || 70, ecoBonusPerKm: pos(data.ecoBonusPerKm), maxObservedDb: pos(data.maxObservedDb), complaints: pos(data.complaints) });
    }
    configureCrossing(data) {
        const id = this.required(data), old = this.crossings.get(id);
        this.indexDirty = true;
        this.crossings.set(id, { id, wayIds: ids(data.wayIds), kmFromWayStart: pos(data.kmFromWayStart),
            approachM: bound(data.approachM ?? 100, 0, 5000), roadVehiclesPerMinute: pos(data.roadVehiclesPerMinute), maxClosedSec: pos(data.maxClosedSec) || 300,
            failed: data.failed === true, failedSpeedKmh: bound(data.failedSpeedKmh ?? 10, 0, 160), roadBlocked: typeof data.roadBlocked === 'boolean' ? data.roadBlocked : old?.roadBlocked === true, incidentReason: str(data.incidentReason ?? old?.incidentReason), closed: old?.closed || data.closed === true,
            closedSec: pos(data.closedSec ?? old?.closedSec), roadQueue: pos(data.roadQueue ?? old?.roadQueue), owners: ids(data.owners ?? old?.owners), excessive: data.excessive === true });
    }
    configureConnection(data) {
        const id = this.required(data), fromServiceId = str(data.fromServiceId), toServiceId = str(data.toServiceId);
        if (!fromServiceId || !toServiceId || fromServiceId === toServiceId)
            throw new TypeError('Deux services réels distincts requis.');
        this.connections.set(id, { id, fromServiceId, toServiceId, stationId: str(data.stationId), minTransferSec: pos(data.minTransferSec), holdMaxSec: pos(data.holdMaxSec) });
    }
    route(s, context = {}) { return context.route || s.getCurrentRoute?.() || s._state?.cachedRoute || []; }
    way(s, context = {}) {
        const route = this.route(s, context), i = Math.max(0, Math.min(route.length - 1, Math.floor(num(context.segmentIndex ?? s._state?.index))));
        return str(route[i]?.wayId || route[Math.min(route.length - 1, i + 1)]?.wayId);
    }
    onZone(s, ways, context = {}) { const way = this.way(s, context); return !!way && ways.includes(way); }
    invalidateIndex() { this.indexDirty = true; }
    ensureIndex() {
        if (!this.indexDirty)
            return;
        this.indexDirty = false;
        this.railIndex.clear();
        this.sectionIndex.clear();
        this.componentCache.clear();
        for (const kind of ['assets', 'borders', 'environment', 'crossings'])
            for (const zone of this[kind].values())
                for (const way of zone.wayIds) {
                    let row = this.railIndex.get(way);
                    if (!row) {
                        row = { assets: [], borders: [], environment: [], crossings: [] };
                        this.railIndex.set(way, row);
                    }
                    row[kind].push(zone);
                }
        for (const [id, section] of this.host.powerSections)
            for (const way of section.wayIds || [])
                if (!this.sectionIndex.has(way))
                    this.sectionIndex.set(way, id);
    }
    zones(s, context = {}) {
        this.ensureIndex();
        return this.railIndex.get(this.way(s, context)) || { assets: [], borders: [], environment: [], crossings: [] };
    }
    section(s) {
        this.ensureIndex();
        const match = this.sectionIndex.get(this.way(s));
        if (match)
            return match;
        return this.host.serviceSections.get(str(s.id)) || '';
    }
    componentSections(sectionId) {
        const cached = this.componentCache.get(sectionId);
        if (cached)
            return cached;
        if (this.host.powerSections.get(sectionId)?.outage) {
            const isolated = { sections: new Set([sectionId]), resistance: 0 };
            this.componentCache.set(sectionId, isolated);
            return isolated;
        }
        const sections = new Set([sectionId]), queue = [sectionId];
        let resistance = 0;
        for (let i = 0; i < queue.length; i++)
            for (const f of this.feeders.values())
                if (f.closed && (f.from === queue[i] || f.to === queue[i])) {
                    const next = f.from === queue[i] ? f.to : f.from, a = this.host.powerSections.get(queue[i] || ''), b = this.host.powerSections.get(next);
                    const compatible = !(a && b) || Math.abs(a.nominalVoltage - b.nominalVoltage) <= Math.max(50, a.nominalVoltage * .03) && Math.abs(num(a.frequency) - num(b.frequency)) <= 1;
                    if (compatible && !sections.has(next) && !b?.outage) {
                        sections.add(next);
                        queue.push(next);
                        resistance += f.resistanceOhm;
                    }
                }
        const result = { sections, resistance };
        for (const id of sections)
            this.componentCache.set(id, result);
        return result;
    }
    electricPower(s) {
        const rame = s.rame;
        if (!rame)
            return pos(s.train?.powerKw);
        if (rame.electricPowerKw != null)
            return pos(rame.electricPowerKw);
        const traction = str(rame.traction).toLowerCase();
        if (/diesel|vapeur|steam|battery|batterie/.test(traction) && !/bimode|electric|électrique|kv/.test(traction))
            return 0;
        return pos(rame.totalPower || s.train?.powerKw);
    }
    powers(s) {
        const installed = this.electricPower(s), moving = s.state === 'moving', v = pos(s.speed ?? s.train?.speed) / 3.6;
        const brake = moving ? bound(s._brakeEffort, 0, 1) : 0, command = moving ? bound(s._tractiveEffort ?? 1, 0, 1) : 0;
        const auxiliary = pos(s.rame?.auxiliaryPowerKw);
        const tractionKw = auxiliary + (moving && brake <= .01 ? installed * command : 0);
        const massKg = pos(s.rame?.getTotalMassWithPayload?.() ?? s.rame?.totalMass) * 1000;
        const capacity = pos(s.rame?.regenerativeBrakeKw);
        const kineticKw = massKg * .7 * v * brake / 1000;
        return { tractionKw, regenKw: Math.min(capacity, kineticKw) * bound(s.rame?.regenEfficiency ?? .8, 0, 1) };
    }
    /** Read-only brake query. Substations here do not export to a utility grid:
     * only actual connected consumers can absorb generated braking power. */
    regenerationAcceptanceForService(service, requestedPowerW, game = this.game) {
        if (!networkPolicy(game, 'energy').enforce || !alive(service) || service.state !== 'moving' || pos(service.speed ?? service.train?.speed) <= 0 || this.electricPower(service) <= 0)
            return 0;
        const sectionId = this.section(service), section = this.host.powerSections.get(sectionId);
        if (!section || section.outage)
            return 0;
        const component = this.componentSections(sectionId), sections = [...component.sections];
        if (sections.some(id => !this.host.powerSections.get(id) || this.host.powerSections.get(id)?.receptive === false))
            return 0;
        const explicit = [...this.substations.values()].filter(s => component.sections.has(s.sectionId));
        const supplied = explicit.length ? explicit.some(s => !s.outage && !this.host.powerSections.get(s.sectionId)?.outage && s.capacityKw > 0 && s.maxCurrentA > 0) : sections.some(id => { const s = this.host.powerSections.get(id); return !s.explicitSupply && !s.outage && s.capacityKw > 0; });
        if (!supplied)
            return 0;
        const targetKw = requestedPowerW == null ? this.powers(service).regenKw : pos(requestedPowerW) / 1000;
        if (targetKw <= 0)
            return 0;
        let demand = pos(service.rame?.auxiliaryPowerKw), generated = targetKw;
        for (const other of game?.scheduleCreator?.services || []) {
            if (str(other.id) === str(service.id) || !alive(other) || !component.sections.has(this.section(other)))
                continue;
            const power = this.powers(other);
            demand += power.tractionKw;
            generated += power.regenKw;
        }
        return bound(demand / Math.max(targetKw, generated), 0, 1);
    }
    advanceEnergy(services, minutes) {
        const groups = new Map();
        for (const service of services) {
            service._gridPowerFactor = 1;
            service._measuredTractionEnergyActive = false;
            const sectionId = this.section(service);
            if (!sectionId)
                continue;
            service._measuredTractionEnergyActive = networkPolicy(this.game, 'energy').enabled;
            this.effects.set(str(service.id), { sectionId, border: null });
            const component = this.componentSections(sectionId);
            const key = [...component.sections].sort().join('|');
            let group = groups.get(key);
            if (!group) {
                group = { ...component, entries: [] };
                groups.set(key, group);
            }
            group.entries.push({ service, sectionId, ...this.powers(service) });
        }
        this.energy = [];
        const policy = networkPolicy(this.game, 'energy');
        for (const group of groups.values()) {
            const sectionIds = [...group.sections], first = this.host.powerSections.get(sectionIds[0] || '');
            if (!first)
                continue;
            const explicit = [...this.substations.values()].filter(ss => group.sections.has(ss.sectionId));
            const supplies = explicit.filter(ss => !ss.outage && !this.host.powerSections.get(ss.sectionId)?.outage);
            if (!explicit.length)
                for (const key of sectionIds) {
                    const s = this.host.powerSections.get(key);
                    if (s && !s.explicitSupply && !s.outage)
                        supplies.push({ id: key, sectionId: key, nominalVoltage: s.nominalVoltage, capacityKw: s.capacityKw, maxCurrentA: s.maxCurrentA || s.capacityKw * 1000 / s.nominalVoltage, resistanceOhm: s.resistanceOhm, outage: false });
                }
            const voltageNominal = supplies[0]?.nominalVoltage || first.nominalVoltage;
            const capacity = supplies.reduce((sum, ss) => sum + Math.min(ss.capacityKw, ss.maxCurrentA * ss.nominalVoltage / 1000), 0);
            const demand = group.entries.reduce((sum, x) => sum + x.tractionKw, 0), regen = group.entries.reduce((sum, x) => sum + x.regenKw, 0);
            const receptive = capacity > 0 && sectionIds.every(key => this.host.powerSections.get(key)?.receptive !== false);
            const used = receptive ? Math.min(demand, regen) : 0, net = Math.max(0, demand - used);
            const r = group.resistance + (supplies.length ? supplies.reduce((sum, ss) => sum + ss.resistanceOhm, 0) / supplies.length : first.resistanceOhm);
            let factor = capacity > 0 ? Math.min(1, net > 0 ? capacity / net : 1) : 0;
            for (let i = 0; i < 16 && capacity > 0; i++) {
                const candidate = bound(Math.min((voltageNominal - net * factor * 1000 / Math.max(1, voltageNominal) * r) / Math.max(1, voltageNominal), net > 0 ? capacity / net : 1), 0, 1);
                factor = (factor + candidate) / 2;
            }
            const current = voltageNominal > 0 ? net * factor * 1000 / voltageNominal : 0, voltage = capacity > 0 ? Math.max(0, voltageNominal - current * r) : 0;
            const consumed = net * (policy.enforce ? factor : 1) * minutes / 60, recovered = used * minutes / 60, dissipated = Math.max(0, regen - used) * minutes / 60;
            const price = sectionIds.reduce((sum, key) => sum + pos(this.host.powerSections.get(key)?.pricePerKwh), 0) / sectionIds.length, cost = consumed * price;
            const status = capacity <= 0 ? 'outage' : net > capacity ? 'overload' : voltage < voltageNominal * .9 ? 'low-voltage' : 'normal';
            for (const id of sectionIds)
                this.energy.push({ sectionId: id, voltage, currentA: current, tractionFactor: factor, demandKw: net,
                    recoveredKwh: recovered, consumedKwh: consumed, dissipatedKwh: dissipated, cost, status, supplies: supplies.map(ss => ss.id) });
            for (const entry of group.entries)
                entry.service._gridPowerFactor = policy.enforce ? factor : 1;
            if (policy.enabled && networkPolicy(this.game, 'noise').enabled)
                for (const entry of group.entries) {
                    const share = net > 0 ? Math.max(0, entry.tractionKw - used * (entry.tractionKw / Math.max(1, demand))) / net : 0;
                    const emission = this.zones(entry.service).environment.reduce((sum, z) => sum + z.electricKgCo2PerKwh, 0);
                    this.totals.electricCo2Kg += consumed * share * emission;
                }
            if (policy.enabled) {
                this.totals.consumedKwh += consumed;
                this.totals.recoveredKwh += recovered;
                this.totals.dissipatedKwh += dissipated;
                this.host.energyRecoveredKwh += recovered;
                if (policy.enforce && cost > 0) {
                    this.game?.economy?.addExpense(cost, 'energie', `Énergie traction ${sectionIds.join(', ')} (${consumed.toFixed(3)} kWh)`);
                    this.totals.cost += cost;
                }
            }
            if (minutes > 0)
                this.emit(`network-energy:${sectionIds.join('|')}:${this.cursorSec}`, 'energy-settlement', sectionIds, { consumedKwh: consumed, recoveredKwh: recovered, dissipatedKwh: dissipated, cost: policy.enforce ? cost : 0 });
        }
    }
    cause(from, to, kind, resourceId, delaySeconds, date) {
        const key = `${date}|${from}|${to}|${kind}|${resourceId}`;
        this.causes.set(key, { id: key, from, to, kind, resourceId, delaySeconds: pos(delaySeconds), date });
        while (this.causes.size > 1000)
            this.causes.delete(this.causes.keys().next().value);
    }
    advanceRegulation(services, date, time) {
        const byId = new Map(services.map(s => [str(s.id), s])), owners = new Map();
        this.conflicts = [];
        this.connectionRows = [];
        const resources = (s) => {
            const out = [], platform = s._platformAssignment;
            if (this.host.stationsEnabled && platform?.stationId && platform.platform)
                out.push({ key: `platform:${platform.stationId}:${platform.platform}`, kind: 'platform' });
            for (const id of s._v2VehicleIds || [])
                out.push({ key: `vehicle:${id}`, kind: 'vehicle' });
            if (!s._v2VehicleIds?.length && s.rameId)
                out.push({ key: `rame:${s.rameId}`, kind: 'vehicle' });
            const driver = s.train?.driverId || this.game?.staffManager?.staff?.find(d => d.role === 'conducteur' && str(d.assignedTo) === str(s.id))?.id;
            if (driver)
                out.push({ key: `driver:${driver}`, kind: 'driver' });
            return out;
        };
        for (const s of services)
            if (['moving', 'stopped_at_station', 'preparation'].includes(s.state || ''))
                for (const r of resources(s))
                    if (!owners.has(r.key))
                        owners.set(r.key, s);
        for (const s of services)
            if (['waiting', 'garage', 'stopped_at_station'].includes(s.state || ''))
                for (const r of resources(s)) {
                    const owner = owners.get(r.key);
                    if (owner && owner !== s) {
                        const id = str(s.id), ownerId = str(owner.id), reason = `${r.kind} ${r.key} utilisé par ${ownerId}`;
                        this.conflicts.push({ kind: r.kind, resourceId: r.key, serviceId: id, causingServiceId: ownerId, reason, proposals: r.kind === 'platform' ? ['attendre libération', 'changer de quai'] : r.kind === 'vehicle' ? ['attendre matériel', 'affecter autre rame'] : ['attendre conducteur', 'relève conducteur'] });
                        this.cause(ownerId, id, r.kind, r.key, Math.max(0, num(owner.train?.delay)) * 60, date);
                    }
                }
        for (const [id, canton] of this.game?.cantonManager?.cantons || []) {
            const owner = str(canton.occupiedBy), entrant = str(canton.reservedBy);
            if (owner && entrant && owner !== entrant && byId.has(owner) && byId.has(entrant))
                this.conflicts.push({ kind: 'track', resourceId: id, serviceId: entrant, causingServiceId: owner, reason: `Canton ${id} occupé par ${owner}`, proposals: ['attendre libération', 'réacheminer'] });
        }
        if (networkPolicy(this.game, 'regulation').enforce) {
            for (const d of this.host.propagateMaterialDelays(services, date))
                this.cause(d.from, d.to, 'material', `rame:${byId.get(d.from)?.rameId || ''}`, d.delaySeconds, date);
        }
        for (const c of this.connections.values()) {
            if (!this.host.stationsEnabled)
                continue;
            const from = byId.get(c.fromServiceId), to = byId.get(c.toServiceId);
            if (!from || !to)
                continue;
            const arrival = (from.getCurrentStops?.() || from.stops || []).find(stop => str(stop.stationId) === c.stationId);
            const departure = (to.getCurrentStops?.() || to.stops || []).find(stop => str(stop.stationId) === c.stationId);
            if (!arrival || !departure)
                continue;
            const ready = num(arrival.arrivalTime) + pos(from.train?.delay) + c.minTransferSec / 60, dep = num(departure.departureTime), late = (ready - dep) * 60;
            const status = late <= 0 ? 'protected' : late <= c.holdMaxSec ? 'waiting' : 'missed';
            this.connectionRows.push({ id: c.id, status, fromServiceId: c.fromServiceId, toServiceId: c.toServiceId, lateSeconds: pos(late) });
            if (late > 0) {
                this.cause(c.fromServiceId, c.toServiceId, 'connection', c.id, late, date);
                if (status === 'waiting' && to.state === 'waiting' && networkPolicy(this.game, 'regulation').enforce) {
                    this.host.hold(str(to.id), ready * 60, `correspondance ${c.fromServiceId}`, date);
                }
            }
        }
        this.host.applyManualHolds(services, time * 60, date);
    }
    borderCheck(s, context = {}) {
        const zone = this.zones(s, context).borders[0];
        if (!zone)
            return null;
        const reasons = [], permit = this.host.borderPermits.get(str(s.id));
        const vehicles = ids(permit?.vehicleCountries?.length ? permit.vehicleCountries : s.rame?.elementDetails?.flatMap(e => (e.countries || e.country) ? [...(e.countries || []), e.country || ''] : []));
        const driver = this.game?.staffManager?.staff?.find(d => s.train?.driverId ? str(d.id) === str(s.train.driverId) : d.role === 'conducteur' && str(d.assignedTo) === str(s.id));
        const driverCountries = driver?.operatingQualifications?.countries || driver?.countryQualifications;
        const drivers = ids(driverCountries?.length ? driverCountries : permit?.driverCountries), country = zone.country;
        if (country && vehicles.length && !vehicles.map(c => c.toUpperCase()).includes(country))
            reasons.push(`matériel non homologué ${country}`);
        if (country && drivers.length && !drivers.map(c => c.toUpperCase()).includes(country))
            reasons.push(`conducteur non habilité ${country}`);
        const systems = s.rame?.electricSystems || [];
        if (this.electricPower(s) > 0 && systems.length && zone.voltage && !systems.some(sys => Math.abs(num(sys.voltage) - zone.voltage) <= Math.max(50, zone.voltage * .03) && (!zone.frequency || !sys.frequency || Math.abs(sys.frequency - zone.frequency) <= 1)))
            reasons.push(`traction incompatible ${zone.voltage} V ${zone.frequency} Hz`);
        const signals = ids(driver?.operatingQualifications?.signalingSystems || driver?.signalingQualifications);
        if (zone.signaling && signals.length && !signals.map(x => x.toUpperCase()).includes(zone.signaling))
            reasons.push(`conducteur non habilité ${zone.signaling}`);
        if (pos(s._onboardFreight) + pos(s._contractFreight) > 0) {
            const contract = this.game?.freightManager?.contracts.find(row => row.id === s._contractCargoId);
            const cargo = ids([...(s._genericManifest || []).filter(row => row.tonnes > 0).map(row => row.type), s._genericCargoType, contract?.cargoType]);
            for (const type of cargo) {
                if (zone.forbiddenCargoTypes.includes(type))
                    reasons.push(`fret ${type} interdit à cette frontière`);
                const hazard = this.game?.cargoTypes?.getHazardProfile?.(type)?.hazardClass;
                if (hazard && zone.forbiddenHazardClasses.includes(hazard))
                    reasons.push(`classe dangereuse ${hazard} interdite`);
            }
        }
        const known = country && vehicles.length && drivers.length, status = reasons.length ? 'incompatible' : known ? 'ok' : 'unknown';
        this.borderRows.push({ serviceId: str(s.id), zoneId: zone.id, country, status, reasons });
        if (reasons.length)
            return { code: 'BORDER_INCOMPATIBLE', message: `Frontière ${zone.id} : ${reasons.join(', ')}`, resourceId: zone.id };
        if (zone.dwellSec > 0 && networkPolicy(this.game, 'borders').enforce) {
            const now = Number.isFinite(this.game?.engine?.getSimulationEpochMs?.()) ? num(this.game?.engine?.getSimulationEpochMs?.()) / 1000 : this.cursorSec;
            if (now == null)
                return null;
            const baseDate = str(s._v2BaseDate || s._legacyOperatingDay || s._currentDate) || new Date(now * 1000).toISOString().slice(0, 10);
            const visitId = `${baseDate}|${str(s.id)}|${zone.id}|${num(s._tripCount)}|${s.isReturnLeg ? 1 : 0}|${num(s.currentStopIndex)}`;
            let visit = this.borderVisits.get(visitId);
            if (!visit) {
                visit = { id: visitId, serviceId: str(s.id), zoneId: zone.id, untilSec: null, state: 'waiting' };
                this.borderVisits.set(visitId, visit);
            }
            if (visit.state === 'cleared')
                return null;
            const stopped = pos(s.speed ?? s.train?.speed) <= .1;
            if (visit.state === 'waiting' && stopped) {
                visit.untilSec = now + zone.dwellSec;
                visit.state = 'timing';
                this.emit(`border-start:${visitId}`, 'border-technical-stop', [str(s.id), zone.id], { untilSec: visit.untilSec });
            }
            if (visit.state === 'timing' && visit.untilSec != null && now >= visit.untilSec) {
                visit.state = 'cleared';
                this.emit(`border-clear:${visitId}`, 'border-technical-release', [str(s.id), zone.id], {});
                return null;
            }
            const remaining = visit.untilSec == null ? zone.dwellSec : Math.max(0, visit.untilSec - now);
            return { code: 'BORDER_FORMALITIES', message: `Frontière ${zone.id} : arrêt technique ${Math.ceil(remaining)} s`, resourceId: zone.id };
        }
        return null;
    }
    advanceEnvironment(services, date) {
        if (!networkPolicy(this.game, 'noise').enabled)
            return;
        for (const service of services) {
            const speed = pos(service.speed ?? service.train?.speed);
            if (speed < 1)
                continue;
            for (const zone of this.zones(service).environment) {
                const reference = pos(service.rame?.noiseDbAt80Kmh) || zone.noiseDbAt80Kmh;
                if (!reference)
                    continue;
                const db = Math.max(0, reference + 20 * Math.log10(Math.max(1, speed) / 80) + (pos(service._tractiveEffort) > .8 ? 2 : 0));
                zone.maxObservedDb = Math.max(zone.maxObservedDb, db);
                const eventId = `noise:${date}:${str(service.id)}:${zone.id}`;
                if (db > zone.noiseLimitDb && !this.environmentEvents.has(eventId)) {
                    this.environmentEvents.add(eventId);
                    zone.complaints++;
                    this.totals.noiseComplaints++;
                    this.emit(eventId, 'resident-noise-complaint', [zone.id, str(service.id)], { db, limitDb: zone.noiseLimitDb });
                }
            }
        }
        const oldest = Date.parse(`${date}T00:00:00Z`) - 86400000;
        for (const id of this.environmentEvents) {
            const day = Date.parse(id.slice(6, 16) + 'T00:00:00Z');
            if (Number.isFinite(day) && day < oldest)
                this.environmentEvents.delete(id);
        }
    }
    advanceAssets(services, minutes) {
        const infrastructureEnabled = networkPolicy(this.game, 'infrastructure').enabled;
        for (const service of services) {
            const id = str(service.id), distance = pos(service.totalDistance), previous = this.progress.get(id);
            this.progress.set(id, distance);
            const delta = previous == null ? 0 : Math.max(0, distance - previous);
            if (!delta)
                continue;
            const mass = pos(service.rame?.getTotalMassWithPayload?.() ?? service.rame?.totalMass), speed = pos(service.speed ?? service.train?.speed);
            const axle = pos(service.rame?.axleLoad) || mass / Math.max(4, pos(service.rame?.axleCount) || Math.ceil(pos(service.rame?.totalLength) / 6));
            if (infrastructureEnabled)
                for (const asset of this.zones(service).assets) {
                    const load = mass * delta;
                    asset.tonneKm += load;
                    const observed = service.position ? this.game?.weather?.getAt?.(service.position.lat, service.position.lon) : null;
                    const weather = observed?.type === 'snow' ? 1.3 : pos(observed?.precipitation) > 4 ? 1.2 : 1;
                    const climate = observed?.temperature != null && (observed.temperature > 35 || observed.temperature < -10) ? 1.1 : 1;
                    const severity = Math.max(.25, axle / 20) ** 2 * Math.max(.5, speed / 100) * (100 / asset.initialQuality) * weather * climate * (1 + Math.min(1, asset.ageDays / 36500));
                    asset.condition = bound(asset.condition - load / 1e6 * asset.wearPerMillionTonneKm * severity, 0, 100);
                    asset.inspectionDue = asset.condition <= asset.slowBelow;
                }
            if (networkPolicy(this.game, 'noise').enabled)
                for (const zone of this.zones(service).environment) {
                    const diesel = /diesel|bimode/i.test(str(service.rame?.traction));
                    if (diesel)
                        this.totals.dieselCo2Kg += delta * pos(service.rame?.dieselLitresPerKm) * zone.dieselKgCo2PerLitre;
                    if (speed > 1 && pos(service._tractiveEffort) <= .5 && pos(service._brakeEffort) <= .1) {
                        this.totals.ecoDrivingKm += delta;
                        const bonus = delta * zone.ecoBonusPerKm;
                        if (bonus > 0 && networkPolicy(this.game, 'noise').enforce && this.game?.economy?.addRevenue?.(bonus, 'environnement', `Éco-conduite ${zone.id}`))
                            this.totals.ecoBonus += bonus;
                    }
                }
        }
        if (infrastructureEnabled)
            for (const op of this.maintenance.values())
                if (op.state === 'running') {
                    const service = services.find(s => str(s.id) === op.serviceId), asset = this.assets.get(op.assetId);
                    if (!service || !asset || !this.onZone(service, asset.wayIds) || pos(service.speed ?? service.train?.speed) > 1) {
                        op.state = 'suspended';
                        continue;
                    }
                    op.remainingMinutes = Math.max(0, op.remainingMinutes - minutes);
                    if (op.remainingMinutes <= 0) {
                        asset.condition = 100;
                        asset.inspectionDue = false;
                        asset.possessionBy = '';
                        op.state = 'completed';
                        if (op.workId)
                            this.game?.worksManager?.remove(op.workId);
                        this.emit(`network-maintenance-complete:${op.id}`, 'infrastructure-release', [asset.id, op.serviceId], { condition: 100 });
                    }
                }
    }
    crossingProgress(s, ways) {
        const route = this.route(s), i = Math.max(0, Math.min(route.length - 1, Math.floor(num(s._state?.index))));
        let end = i;
        while (end >= 0 && !ways.includes(str(route[end]?.wayId)))
            end--;
        if (end < 0)
            return null;
        let start = end;
        while (start > 0 && ways.includes(str(route[start - 1]?.wayId)))
            start--;
        let distance = 0;
        for (let n = start + 1; n <= i; n++)
            distance += distanceM(route[n - 1], route[n]);
        const p = s.position;
        if (p && route[i])
            distance += distanceM(route[i], p);
        return distance;
    }
    advanceCrossings(services, minutes) {
        if (!networkPolicy(this.game, 'crossings').enabled)
            return;
        for (const c of this.crossings.values()) {
            const owners = [];
            for (const s of services) {
                const head = this.crossingProgress(s, c.wayIds);
                if (head == null)
                    continue;
                const point = c.kmFromWayStart * 1000, length = Math.max(1, pos(s.rame?.totalLength || s.train?.length));
                if (head >= point - c.approachM && head - length <= point)
                    owners.push(str(s.id));
            }
            c.owners = owners;
            c.closed = c.failed || c.roadBlocked || owners.length > 0;
            c.closedSec = c.closed ? c.closedSec + minutes * 60 : 0;
            c.roadQueue = c.closed ? c.roadQueue + c.roadVehiclesPerMinute * minutes : Math.max(0, c.roadQueue - c.roadVehiclesPerMinute * minutes * 2);
            c.excessive = c.closedSec > c.maxClosedSec;
        }
    }
    advance(game, date, time, elapsedMinutes = 1) {
        this.game = game;
        this.indexDirty = true;
        const now = Number.isFinite(game.engine?.getSimulationEpochMs?.()) ? num(game.engine?.getSimulationEpochMs?.()) / 1000 : absolute(date, time);
        if (!Number.isFinite(now))
            throw new TypeError('Date réseau invalide.');
        const elapsed = bound(elapsedMinutes, 0, 1440) * 60, minutes = this.cursorSec == null ? elapsed / 60 : Math.max(0, Math.min(elapsed, now - this.cursorSec)) / 60;
        this.cursorSec = this.cursorSec == null ? now : Math.max(this.cursorSec, now);
        const all = game.scheduleCreator?.services || [], services = all.filter(alive);
        this.effects.clear();
        this.borderRows = [];
        this.advanceEnergy(services, minutes);
        this.advanceRegulation(all, date, time);
        this.advanceAssets(services, minutes);
        this.advanceCrossings(services, minutes);
        this.advanceEnvironment(services, date);
        for (const s of services) {
            const state = this.effects.get(str(s.id)) || { sectionId: '', border: null };
            state.border = this.borderCheck(s);
            this.effects.set(str(s.id), state);
            s._noiseCapKmh = this.speedLimit(s, { game, hour: Math.floor(time / 60) });
        }
        const liveIds = new Set(services.map(s => str(s.id)));
        for (const id of this.progress.keys())
            if (!liveIds.has(id))
                this.progress.delete(id);
    }
    departureBlock(game, s, context = {}) {
        if (networkPolicy(game, 'crossings').enforce)
            for (const crossing of this.zones(s, context).crossings)
                if (this.crossingRoadBlocked(s, crossing))
                    return { code: 'CROSSING_ROAD_OBSTRUCTION', message: `PN ${crossing.id} : ${crossing.incidentReason || 'obstacle routier sur la voie'}`, resourceId: crossing.id };
        if (networkPolicy(game, 'infrastructure').enforce)
            for (const asset of this.zones(s, context).assets) {
                if (asset.possessionBy && asset.possessionBy !== str(s.id))
                    return { code: 'INFRA_POSSESSION', message: `Possession ${asset.id} par ${asset.possessionBy}`, resourceId: asset.id, causingServiceId: asset.possessionBy };
                if (asset.condition <= asset.closeBelow && !s.isWorkTrain)
                    return { code: 'INFRA_CLOSED', message: `Infrastructure ${asset.id} fermée (état ${asset.condition.toFixed(1)} %)`, resourceId: asset.id };
            }
        if (networkPolicy(game, 'energy').enforce) {
            const sectionId = this.section(s), row = this.energy.find(x => x.sectionId === sectionId);
            if (row?.status === 'outage' && this.electricPower(s) > 0)
                return { code: 'GRID_OUTAGE', message: `Section électrique ${sectionId} hors tension`, resourceId: sectionId };
        }
        if (networkPolicy(game, 'borders').enforce) {
            this.game = game;
            this.borderRows = this.borderRows.filter(row => row.serviceId !== str(s.id));
            const block = this.borderCheck(s, context);
            if (block)
                return block;
        }
        return null;
    }
    speedLimit(s, context = {}) {
        const game = context.game || this.game, caps = [];
        if (networkPolicy(game, 'infrastructure').enforce)
            for (const asset of this.zones(s, context).assets)
                if (asset.condition <= asset.slowBelow && !s.isWorkTrain)
                    caps.push(asset.condition <= asset.closeBelow ? 0 : asset.ltvKmh);
        if (networkPolicy(game, 'noise').enforce) {
            const hour = num(context.hour, context.timeOfDay == null ? 12 : Math.floor(context.timeOfDay / 60)), night = hour >= 22 || hour < 6, manual = this.host.noiseLimitFor(str(s.id), hour);
            if (manual != null)
                caps.push(manual);
            for (const z of this.zones(s, context).environment) {
                const cap = night ? z.nightSpeedKmh : z.daySpeedKmh;
                if (cap > 0)
                    caps.push(cap);
            }
        }
        if (networkPolicy(game, 'crossings').enforce)
            for (const c of this.zones(s, context).crossings) {
                if (this.crossingRoadBlocked(s, c))
                    caps.push(0);
                else if (c.failed)
                    caps.push(c.failedSpeedKmh);
            }
        return caps.length ? Math.min(...caps) : null;
    }
    pneumaticEnabled(game) { return this.host.pneumaticBrakesEnabled && networkPolicy(game, 'pneumatic').enforce; }
    crossingRoadBlocked(service, crossing) {
        if (!crossing.roadBlocked)
            return false;
        const head = this.crossingProgress(service, crossing.wayIds);
        if (head == null)
            return false;
        const point = crossing.kmFromWayStart * 1000, length = Math.max(1, pos(service.rame?.totalLength || service.train?.length));
        return head >= point - crossing.approachM && head - length <= point;
    }
    startMaintenance(game, data) {
        const asset = this.assets.get(str(data.assetId)), service = (game.scheduleCreator?.services || []).find(s => str(s.id) === str(data.serviceId) && alive(s));
        if (!asset || !service || (!service.isTTX && !service.isWorkTrain))
            throw new Error('Infrastructure et train de travaux réel requis.');
        if (!this.onZone(service, asset.wayIds) || pos(service.speed ?? service.train?.speed) > 1)
            throw new Error('Train de travaux absent ou encore en mouvement.');
        const base = str(data.id) || `maintenance:${asset.id}:${str(service.id)}:${num(game.engine?.getSimulationEpochMs?.(), (this.cursorSec || 0) * 1000)}`;
        let id = base;
        if (!str(data.id)) {
            let suffix = 1;
            while (this.maintenance.has(id))
                id = `${base}:${suffix++}`;
        }
        if (asset.possessionBy || [...this.maintenance.values()].some(op => op.id === id && op.state !== 'completed'))
            throw new Error('Possession déjà attribuée.');
        const duration = pos(data.durationMinutes);
        if (!duration)
            throw new Error('Durée de travail requise.');
        const route = this.route(service).filter(p => asset.wayIds.includes(str(p.wayId)));
        const date = str(data.dateStr) || game.engine?.getParisDate?.() || (this.cursorSec != null ? new Date(this.cursorSec * 1000).toISOString().slice(0, 10) : '');
        if (!date)
            throw new Error('Date simulée requise pour les travaux.');
        let workId = '';
        if (game.worksManager && networkPolicy(game, 'infrastructure').enforce) {
            workId = game.worksManager.add({ name: `Maintenance ${asset.id}`, route, impact: 'stop', recurrence: 'daily', startDate: date, startTime: '00:00', endTime: '23:59', affectsTraffic: true }).id;
        }
        const op = { id, assetId: asset.id, serviceId: str(service.id), remainingMinutes: duration, workId, state: 'running' };
        asset.possessionBy = op.serviceId;
        this.maintenance.set(id, op);
        this.emit(`network-maintenance:${id}`, 'infrastructure-possession', [asset.id, op.serviceId], { ...op });
        return copy(op);
    }
    action(game, data) {
        this.game = game;
        const id = str(data.serviceId), service = (game.scheduleCreator?.services || []).find(s => str(s.id) === id), kind = str(data.kind);
        if (!service && ['hold', 'release', 'priority', 'cancel', 'reroute', 'rescue'].includes(kind))
            throw new Error('Service réel introuvable.');
        const date = str(data.dateStr), time = num(data.timeOfDay);
        switch (kind) {
            case 'hold':
                this.host.hold(id, time * 60 + Math.max(1, pos(data.durationMinutes)) * 60, str(data.reason) || 'ordre du régulateur', date);
                this.host.applyManualHolds([service], time * 60, date);
                break;
            case 'release':
                this.host.releaseHold(id);
                this.host.applyManualHolds([service], time * 60, date);
                break;
            case 'priority':
                this.priorities.set(id, num(data.priority));
                break;
            case 'cancel':
                if (!service?._cancelBlockedService?.())
                    throw new Error('Annulation physique indisponible.');
                break;
            case 'reroute':
                if (!service?._startAlternateRouteSearch)
                    throw new Error('Réacheminement indisponible.');
                service._startAlternateRouteSearch(time, date);
                break;
            case 'rescue':
                if (!service || !game.depotManager?.dispatchRescue?.(game.world, service))
                    throw new Error('Aucun secours réel disponible.');
                break;
            case 'maintenance':
                this.startMaintenance(game, data);
                break;
            case 'platform':
            case 'skipStop':
            case 'extraStop':
            case 'partialTerminus':
            case 'swapRames':
            case 'shortenMission':
            case 'connection':
            case 'changeLoco':
            case 'cancelComposite': {
                if (!game.applyRegulationAction)
                    throw new Error('Cette opération physique nécessite le contrôleur de services.');
                const result = game.applyRegulationAction(data);
                if (!result.ok)
                    throw new Error(result.message || 'Opération physique refusée.');
                break;
            }
            default: throw new Error('Commande réseau inconnue.');
        }
        this.emit(`network-action:${kind}:${id}:${this.eventEpochMs()}:${str(data.requestId)}`, 'regulation-action', [id].filter(Boolean), { kind, serviceId: id });
        return { ok: true, message: `${kind} enregistré sur ${id || str(data.assetId)}` };
    }
    emit(eventId, type, resourceIds, payload) {
        this.game?.emitDomainEvent?.({ eventId, simEpochMs: this.eventEpochMs(), type, resourceIds, payload });
    }
    eventEpochMs() { const actual = this.game?.engine?.getSimulationEpochMs?.(); return Number.isFinite(actual) ? num(actual) : this.cursorSec == null ? 0 : this.cursorSec * 1000; }
    diagnostics() {
        return copy({ energy: this.energy.slice(0, 200), totals: this.totals, conflicts: this.conflicts.slice(0, 200), causes: [...this.causes.values()].slice(-200),
            infrastructure: [...this.assets.values()].slice(0, 200), maintenance: [...this.maintenance.values()].slice(0, 200), borders: this.borderRows.slice(0, 200), connections: this.connectionRows.slice(0, 200), environment: [...this.environment.values()].slice(0, 200), crossings: [...this.crossings.values()].slice(0, 200) });
    }
    toSave() {
        return copy({ schemaVersion: 1, cursorSec: this.cursorSec, totals: this.totals, substations: [...this.substations.values()], feeders: [...this.feeders.values()],
            assets: [...this.assets.values()], maintenance: [...this.maintenance.values()], borders: [...this.borders.values()], environment: [...this.environment.values()], crossings: [...this.crossings.values()], connections: [...this.connections.values()],
            causes: [...this.causes.values()], energy: this.energy, conflicts: this.conflicts, borderRows: this.borderRows, connectionRows: this.connectionRows, progress: [...this.progress], priorities: [...this.priorities], borderVisits: [...this.borderVisits.values()].slice(-2000), environmentEvents: [...this.environmentEvents] });
    }
    loadFromSave(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return false;
        const s = value;
        if (s.schemaVersion !== 1)
            return false;
        const fields = ['substations', 'feeders', 'assets', 'maintenance', 'borders', 'environment', 'crossings', 'connections', 'causes', 'energy', 'conflicts', 'borderRows', 'connectionRows', 'progress', 'priorities'];
        if (fields.some(field => !Array.isArray(s[field]) || s[field].length > 100000) || s.cursorSec !== null && !Number.isFinite(s.cursorSec))
            return false;
        if (s.borderVisits != null && (!Array.isArray(s.borderVisits) || s.borderVisits.length > 2000))
            return false;
        if (s.environmentEvents != null && (!Array.isArray(s.environmentEvents) || s.environmentEvents.length > 100000 || s.environmentEvents.some(id => !str(id))))
            return false;
        const serialized = JSON.stringify(s);
        if (serialized.length > 16000000)
            return false;
        if (fields.slice(0, 9).some(field => {
            const rows = s[field], keys = rows.map(row => str(row?.id));
            return keys.some(key => !key) || new Set(keys).size !== keys.length;
        }))
            return false;
        if (!s.totals || Object.values(s.totals).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0))
            return false;
        if (s.energy.some(row => ['voltage', 'currentA', 'tractionFactor', 'demandKw', 'recoveredKwh', 'consumedKwh', 'dissipatedKwh', 'cost'].some(key => !Number.isFinite(row[key]))))
            return false;
        const candidate = new NetworkOperations(this.host);
        try {
            for (const row of s.substations)
                candidate.configureSubstation(row);
            for (const row of s.feeders)
                candidate.configureFeeder(row);
            for (const row of s.assets)
                candidate.configureAsset(row);
            for (const row of s.borders)
                candidate.configureBorder(row);
            for (const row of s.environment)
                candidate.configureEnvironment(row);
            for (const row of s.crossings)
                candidate.configureCrossing(row);
            for (const row of s.connections)
                candidate.configureConnection(row);
            const possessions = new Set();
            for (const row of s.maintenance) {
                if (!str(row.id) || !candidate.assets.has(row.assetId) || !str(row.serviceId) || !Number.isFinite(row.remainingMinutes) || row.remainingMinutes < 0 || !['running', 'suspended', 'completed'].includes(row.state))
                    throw new Error('Maintenance réseau invalide.');
                if (row.state !== 'completed') {
                    if (possessions.has(row.assetId) || candidate.assets.get(row.assetId)?.possessionBy !== row.serviceId)
                        throw new Error('Deux propriétaires de possession.');
                    possessions.add(row.assetId);
                }
                candidate.maintenance.set(row.id, copy(row));
            }
            for (const asset of candidate.assets.values())
                if (asset.possessionBy && !possessions.has(asset.id))
                    throw new Error('Possession sans mission physique.');
            for (const row of s.causes.slice(-1000))
                if (str(row.id) && Number.isFinite(row.delaySeconds))
                    candidate.causes.set(row.id, copy(row));
            for (const row of s.progress)
                if (Array.isArray(row) && str(row[0]) && Number.isFinite(row[1]) && row[1] >= 0)
                    candidate.progress.set(row[0], row[1]);
            for (const row of s.priorities)
                if (Array.isArray(row) && str(row[0]) && Number.isFinite(row[1]))
                    candidate.priorities.set(row[0], row[1]);
            for (const row of s.borderVisits || []) {
                if (!row || !str(row.id) || candidate.borderVisits.has(row.id) || !str(row.serviceId) || !candidate.borders.has(row.zoneId) || !['waiting', 'timing', 'cleared'].includes(row.state) || row.untilSec !== null && !Number.isFinite(row.untilSec) || row.state === 'timing' && row.untilSec === null)
                    throw new Error('Visite frontière invalide.');
                candidate.borderVisits.set(row.id, copy(row));
            }
            for (const key of Object.keys(candidate.totals))
                candidate.totals[key] = pos(s.totals?.[key]);
            for (const id of s.environmentEvents || [])
                candidate.environmentEvents.add(id);
            candidate.cursorSec = s.cursorSec;
            candidate.energy = copy(s.energy);
            candidate.conflicts = copy(s.conflicts);
            candidate.borderRows = copy(s.borderRows);
            candidate.connectionRows = copy(s.connectionRows);
        }
        catch {
            return false;
        }
        for (const name of ['substations', 'feeders', 'assets', 'maintenance', 'borders', 'environment', 'crossings', 'connections', 'causes', 'progress', 'priorities', 'borderVisits']) {
            this[name].clear();
            for (const [key, row] of candidate[name])
                this[name].set(key, row);
        }
        this.environmentEvents.clear();
        for (const id of candidate.environmentEvents)
            this.environmentEvents.add(id);
        this.indexDirty = true;
        this.totals = candidate.totals;
        this.cursorSec = candidate.cursorSec;
        this.energy = candidate.energy;
        this.conflicts = candidate.conflicts;
        this.borderRows = candidate.borderRows;
        this.connectionRows = candidate.connectionRows;
        return true;
    }
}
