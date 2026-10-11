class LogisticsFundingError extends Error {
}
const HOUR = 3600000, DAY = 24 * HOUR;
const clone = (value) => JSON.parse(JSON.stringify(value));
const frozenPrimitiveKeys = new WeakMap();
const locationArrayMethods = { iterator: Array.prototype[Symbol.iterator], slice: Array.prototype.slice, map: Array.prototype.map, every: Array.prototype.every };
function ordinaryLocationArray(rows) { return Object.getPrototypeOf(rows) === Array.prototype && rows[Symbol.iterator] === locationArrayMethods.iterator && rows.slice === locationArrayMethods.slice && rows.map === locationArrayMethods.map && rows.every === locationArrayMethods.every; }
/** Runtime station projections contain primitive JSON fields. Skip their
 * unchanged copies, reading both live records on every call. Nested or unusual
 * values retain the original JSON clone and its ownership/normalization. */
function unchangedPrimitiveLocation(old, next) {
    const current = old, incoming = next;
    if (typeof incoming.toJSON === 'function')
        return false;
    let keys = frozenPrimitiveKeys.get(incoming);
    if (keys !== undefined || Object.isFrozen(incoming) && Object.getPrototypeOf(incoming) === Object.prototype) {
        if (keys === undefined) {
            keys = [];
            const jsonDescriptor = Object.getOwnPropertyDescriptor(incoming, 'toJSON');
            if (jsonDescriptor && !('value' in jsonDescriptor))
                keys = null;
            for (const key of Object.keys(incoming)) {
                if (keys === null)
                    break;
                const descriptor = Object.getOwnPropertyDescriptor(incoming, key);
                const value = descriptor.value;
                if (!('value' in descriptor) || value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) {
                    keys = null;
                    break;
                }
                if (value !== undefined)
                    keys.push(key);
            }
            frozenPrimitiveKeys.set(incoming, keys);
        }
        if (keys) {
            for (let i = 0; i < keys.length; i++)
                if (current[keys[i]] !== incoming[keys[i]])
                    return false;
            return true;
        }
    }
    for (const key in incoming) {
        if (!Object.prototype.hasOwnProperty.call(incoming, key))
            continue;
        const value = incoming[key];
        if (value === undefined)
            continue; // JSON omits it; Object.assign kept the old field.
        if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value)))
            return false;
        if (current[key] !== value)
            return false;
    }
    return true;
}
const finite = (v, f = 0) => typeof v === 'number' && Number.isFinite(v) ? v : f;
const positive = (v, name) => { if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${name}: quantité positive requise`); return v; };
const rec = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const str = (v, d = '') => typeof v === 'string' ? v : d;
const bool = (v, d = false) => typeof v === 'boolean' ? v : d;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function savedArray(v, valid) { return Array.isArray(v) ? v.filter(x => valid(rec(x))).map(x => clone(x)) : []; }
const hasId = (x) => typeof x.id === 'string' && x.id.length > 0;
const DEFAULT_REFERENCES = [
    { id: 'reusable_packaging', name: 'Emballages réutilisables', family: 'packaging', unit: 'emballage', unitPrice: 0, unitKg: 15, unitM3: .15, moq: 1, packSize: 1, packaging: 'batch', compatibleIds: [] },
    { id: 'brake_pad', name: 'Garnitures de frein', family: 'parts', unit: 'pièce', unitPrice: 80, unitKg: 5, unitM3: .01, moq: 10, packSize: 10, packaging: 'crate', compatibleIds: ['brake_pad_eco'], reusableDeposit: 12 },
    { id: 'brake_pad_eco', name: 'Garnitures compatibles', family: 'parts', unit: 'pièce', unitPrice: 68, unitKg: 5, unitM3: .01, moq: 10, packSize: 10, packaging: 'crate', compatibleIds: ['brake_pad'], reusableDeposit: 12 },
    { id: 'diesel_l', name: 'Gazole', family: 'fuel', unit: 'L', unitPrice: 1.45, unitKg: .84, unitM3: .001, moq: 100, packSize: 100, packaging: 'drum', compatibleIds: [] },
    { id: 'detergent_l', name: 'Détergent', family: 'cleaning', unit: 'L', unitPrice: 2.8, unitKg: 1, unitM3: .001, moq: 20, packSize: 20, packaging: 'drum', compatibleIds: [], shelfLifeMs: 180 * DAY },
    { id: 'meal', name: 'Repas restauration', family: 'catering', unit: 'portion', unitPrice: 4, unitKg: .4, unitM3: .002, moq: 10, packSize: 10, packaging: 'crate', compatibleIds: [], shelfLifeMs: 3 * DAY, reusableDeposit: 4 },
    { id: 'ballast_t', name: 'Ballast', family: 'construction', unit: 't', unitPrice: 24, unitKg: 1000, unitM3: .6, moq: 1, packSize: 1, packaging: 'batch', compatibleIds: [] },
    { id: 'rails_m', name: 'Rail infrastructure', family: 'construction', unit: 'm', unitPrice: 120, unitKg: 60, unitM3: .03, moq: 12, packSize: 12, packaging: 'batch', compatibleIds: [] },
    { id: 'vehicle', name: 'Automobile finie', family: 'automobile', unit: 'véhicule', unitPrice: 15000, unitKg: 1500, unitM3: 12, moq: 1, packSize: 1, packaging: 'batch', compatibleIds: [] },
    { id: 'recycling_t', name: 'Déchets à traiter', family: 'waste', unit: 't', unitPrice: 25, unitKg: 1000, unitM3: 2, moq: 1, packSize: 1, packaging: 'batch', compatibleIds: [], reusableDeposit: 80 },
];
const DEFAULT_SUPPLIERS = [
    { id: 'standard', name: 'Approvisionnement régional', country: 'FR', referenceIds: ['*'], priceFactor: 1, reliability: .98, capacityPerDay: 10000, prepareMs: 2 * HOUR, weekdays: [1, 2, 3, 4, 5], openHour: 8, closeHour: 18, available: true },
    { id: 'economy', name: 'Distribution européenne', country: 'DE', referenceIds: ['*'], priceFactor: .87, reliability: .92, capacityPerDay: 50000, prepareMs: 6 * HOUR, weekdays: [1, 2, 3, 4, 5], openHour: 7, closeHour: 19, available: true },
    { id: 'priority', name: 'Pièces et services express', country: 'FR', referenceIds: ['*'], priceFactor: 1.25, reliability: .995, capacityPerDay: 5000, prepareMs: HOUR, weekdays: [0, 1, 2, 3, 4, 5, 6], openHour: 0, closeHour: 24, available: true },
];
const DEFAULT_CARRIERS = [
    ['regional', 'Transport régional', 'regional', 'rigid', 8000, 35, 100, 55, 1.2, .97], ['general', 'Route généraliste', 'general', 'semi', 26000, 85, 100, 65, 1.55, .96], ['express', 'Messagerie express', 'express', 'van', 1200, 12, 100, 75, 1.8, .99], ['cold', 'Chaîne frigorifique', 'cold', 'reefer', 22000, 80, 100, 60, 1.9, .98], ['tank', 'Transport citerne', 'tank', 'tank', 26000, 30, 100, 60, 1.7, .98], ['parcel', 'Messagerie consolidée', 'parcel', 'rigid', 8000, 40, 100, 60, 1.1, .96], ['heavy', 'Convoi lourd', 'heavy', 'special', 80000, 150, 30, 45, 3, .96], ['international', 'Intermodal international', 'international', 'container', 28000, 70, 100, 60, 1.6, .97],
].map(x => ({ id: x[0], name: x[1], profile: x[2], vehicleClass: x[3], capacityKg: x[4], capacityM3: x[5], fleetCapacity: x[6], speedKmh: x[7], tariffKm: x[8], reliability: x[9], countries: ['*'], families: ['*'], available: true }));
export class LogisticsManager {
    get delegatedSupply() { return this.supplyChoice ?? this.simpleMode; }
    set delegatedSupply(value) { this.supplyChoice = value; }
    get delegatedRoad() { return this.roadChoice ?? this.simpleMode; }
    set delegatedRoad(value) { this.roadChoice = value; }
    resetDelegation() { this.supplyChoice = null; this.roadChoice = null; }
    reservedRailWeight(serviceId) { return this.flows.filter(f => f.railReservation?.serviceId === serviceId && f.railReservation.status !== 'released').reduce((sum, f) => sum + (f.railReservation?.weightKg ?? 0), 0); }
    loadedRailWeight(serviceId) { return this.flows.filter(f => f.railReservation?.serviceId === serviceId && f.railReservation.status === 'loaded').reduce((sum, f) => sum + (f.railReservation?.weightKg ?? 0), 0); }
    constructor(seed = 44) {
        this.references = clone(DEFAULT_REFERENCES);
        this.suppliers = clone(DEFAULT_SUPPLIERS);
        this.carriers = clone(DEFAULT_CARRIERS);
        this.locations = [];
        this.demands = [];
        this.contracts = [];
        this.orders = [];
        this.shipments = [];
        this.consolidationGroups = [];
        this.lots = [];
        this.reservations = [];
        this.stockPolicies = [];
        this.rescueResources = [];
        this.packaging = [];
        this.flows = [];
        this.inventoryControls = [];
        this.simpleMode = false;
        this.supplyChoice = null;
        this.roadChoice = null;
        this.epochMs = 0;
        this.sequence = 0;
        this.host = null;
        this.runtimeLocationIndex = null;
        this.runtimeFrozenBatch = null;
        this.events = [];
        this.deliveries = [];
        this.exclusions = [];
        this.costs = [];
        this.paymentHolds = new Set();
        this.paymentHoldsDirty = false;
        this.consumptions = [];
        this.lastInventoryDay = -1;
        this.importedStockKeys = [];
        this.externalUseKeys = [];
        this.mileageSamples = [];
        this.mileageDays = [];
        this.rngState = (seed >>> 0) || 44;
    }
    observeVehicleMileage(vehicleId, locationId, totalKm, at) { if (!Number.isFinite(at) || !Number.isFinite(totalKm) || totalKm < 0 || !this.locations.some(location => location.id === locationId))
        return; const old = this.mileageSamples.find(sample => sample.id === vehicleId); if (!old) {
        this.mileageSamples.push({ id: vehicleId, locationId, km: totalKm, at });
        return;
    } if (at <= old.at)
        return; const delta = Math.max(0, totalKm - old.km), day = Math.floor(at / DAY), key = `${locationId}:${day}`; if (delta > 0) {
        let bin = this.mileageDays.find(row => row.id === key);
        if (!bin) {
            bin = { id: key, locationId, day, km: 0, fromAt: old.at };
            this.mileageDays.push(bin);
        }
        bin.km += delta;
        bin.fromAt = Math.min(bin.fromAt, old.at);
    } old.km = totalKm; old.at = at; old.locationId = locationId; this.mileageDays = this.mileageDays.filter(row => row.day >= day - 14); }
    observedMileage(locationId, now, days = 14) { const window = Math.max(1, Math.min(14, days)), rows = this.mileageDays.filter(row => row.locationId === locationId && row.day >= Math.floor((now - window * DAY) / DAY) && row.day <= Math.floor(now / DAY)); const km = rows.reduce((sum, row) => sum + row.km, 0), span = rows.length ? Math.max(1, Math.min(window, (now - rows.reduce((earliest, row) => Math.min(earliest, row.fromAt), Infinity)) / DAY)) : 1; return { km, kmPerDay: km / span, days: span }; }
    declareCompatibility(referenceId, alternativeId, notice) { const source = this.reference(referenceId), target = this.reference(alternativeId); if (source.unit !== target.unit)
        throw new Error('Compatibilité: unités différentes, conversion interdite'); if (source.family !== target.family)
        throw new Error('Compatibilité: usages différents'); if (!notice.trim())
        throw new Error('Une règle du jeu approuvée doit être renseignée'); if (!source.compatibleIds.includes(target.id))
        source.compatibleIds.push(target.id); source.compatibilityNotice = notice; this.event('compatibility-declared', source.id, notice, { alternativeId, unit: source.unit }); }
    stockReference(order) { return this.demands.find(demand => demand.id === order.demandId)?.requestedReferenceId ?? order.referenceId; }
    get now() { return this.epochMs; }
    id(prefix) { return `${prefix}-${++this.sequence}`; }
    random() { let x = this.rngState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rngState = x >>> 0; return this.rngState / 4294967296; }
    event(kind, entityId, message, data, at = this.epochMs) { this.events.push({ id: this.id('logevt'), at, kind, entityId, message, ...(data ? { data } : {}) }); if (this.events.length > 2000)
        this.events.splice(0, this.events.length - 2000); }
    drainEvents() { const out = this.events; this.events = []; return out; }
    connectRuntime(host) { this.host = host; this.recheckSavedCosts(); this.registerRuntimeLocations(host.listLocations?.() ?? []); this.flushEffects(); }
    registerLocation(location) { if (!location.id.trim())
        throw new Error('Identifiant du lieu requis'); const old = this.locations.find(x => x.id === location.id); if (old) {
        if (!unchangedPrimitiveLocation(old, location))
            Object.assign(old, clone(location));
    }
    else
        this.locations.push(clone(location)); }
    registerRuntimeLocations(locations) {
        if (!locations.length)
            return;
        if (!ordinaryLocationArray(this.locations) || !ordinaryLocationArray(locations)) {
            this.runtimeLocationIndex = null;
            this.runtimeFrozenBatch = null;
            const byId = new Map();
            for (const location of this.locations)
                if (!byId.has(location.id))
                    byId.set(location.id, location);
            for (const location of locations) {
                if (!location.id.trim())
                    throw new Error('Identifiant du lieu requis');
                const old = byId.get(location.id);
                if (old) {
                    if (!unchangedPrimitiveLocation(old, location))
                        Object.assign(old, clone(location));
                }
                else {
                    const copy = clone(location);
                    this.locations.push(copy);
                    byId.set(copy.id, copy);
                }
            }
            return;
        }
        // Validate every member and ID, including same-length imports/reorders and
        // duplicates introduced through the public array. Field updates remain live.
        let index = this.runtimeLocationIndex;
        let valid = !!index && index.members.length === this.locations.length;
        if (valid)
            for (let i = 0; i < this.locations.length; i++)
                if (this.locations[i] !== index.members[i] || this.locations[i].id !== index.ids[i]) {
                    valid = false;
                    break;
                }
        if (!valid) {
            const members = this.locations.slice(), ids = members.map(location => location.id), byId = new Map();
            for (const location of members)
                if (!byId.has(location.id))
                    byId.set(location.id, location);
            this.runtimeLocationIndex = index = { members, ids, byId };
        }
        const byId = index.byId;
        const batch = this.runtimeFrozenBatch;
        const inheritedJSON = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
        if (batch?.rows === locations && batch.index === index && (!inheritedJSON || 'value' in inheritedJSON && typeof inheritedJSON.value !== 'function')) {
            if (batch.stationRows) {
                for (let i = 0; i < locations.length; i++) {
                    const old = batch.targets[i], next = locations[i];
                    if (old.id !== next.id || old.name !== next.name || old.kind !== next.kind || old.latitude !== next.latitude || old.longitude !== next.longitude)
                        Object.assign(old, clone(next));
                }
                return;
            }
            for (let i = 0; i < locations.length; i++)
                if (!unchangedPrimitiveLocation(batch.targets[i], locations[i]))
                    Object.assign(batch.targets[i], clone(locations[i]));
            return;
        }
        for (const location of locations) {
            if (!location.id.trim())
                throw new Error('Identifiant du lieu requis');
            const old = byId.get(location.id);
            if (old) {
                if (!unchangedPrimitiveLocation(old, location))
                    Object.assign(old, clone(location));
            }
            else {
                const copy = clone(location);
                this.locations.push(copy);
                byId.set(copy.id, copy);
                index.members.push(copy);
                index.ids.push(copy.id);
            }
        }
        if (Object.isFrozen(locations) && locations.every(location => !!frozenPrimitiveKeys.get(location))) {
            const stationRows = locations.every(location => { const keys = frozenPrimitiveKeys.get(location); return keys.length === 5 && keys[0] === 'id' && keys[1] === 'name' && keys[2] === 'kind' && keys[3] === 'latitude' && keys[4] === 'longitude'; });
            this.runtimeFrozenBatch = { rows: locations, index: index, targets: locations.map(location => byId.get(location.id)), stationRows };
        }
        else
            this.runtimeFrozenBatch = null;
    }
    createHub(name, kind = 'hub') { const hub = { id: this.id('hub'), name: name.trim() || 'Entrepôt central', kind, dockCount: 2, dockCapacity: 25000, unloadMs: HOUR / 2, waveHours: [6, 12, 18, 22] }; this.registerLocation(hub); this.event('hub-created', hub.id, hub.name); return this.locations[this.locations.length - 1]; }
    addReference(reference) { positive(reference.packSize, 'Conditionnement'); positive(reference.moq, 'MOQ'); const old = this.references.find(x => x.id === reference.id); if (old)
        Object.assign(old, clone(reference));
    else
        this.references.push(clone(reference)); }
    addSupplier(supplier) { positive(supplier.capacityPerDay, 'Capacité fournisseur'); const old = this.suppliers.find(x => x.id === supplier.id); if (old)
        Object.assign(old, clone(supplier));
    else
        this.suppliers.push(clone(supplier)); }
    addCarrier(carrier) { positive(carrier.capacityKg, 'Charge'); positive(carrier.capacityM3, 'Volume'); const old = this.carriers.find(x => x.id === carrier.id); if (old)
        Object.assign(old, clone(carrier));
    else
        this.carriers.push(clone(carrier)); }
    setSupplierAvailable(id, available) { this.supplier(id).available = available; this.event('supplier-availability', id, available ? 'Fournisseur ouvert' : 'Fournisseur indisponible'); }
    setCarrierCapacity(id, capacity) { this.carrier(id).fleetCapacity = Math.max(0, finite(capacity)); }
    reference(id) { const ref = this.references.find(x => x.id === id); if (!ref)
        throw new Error(`Référence inconnue: ${id}`); return ref; }
    supplier(id) { const s = this.suppliers.find(x => x.id === id); if (!s)
        throw new Error(`Fournisseur inconnu: ${id}`); return s; }
    carrier(id) { const c = this.carriers.find(x => x.id === id); if (!c)
        throw new Error(`Transporteur inconnu: ${id}`); return c; }
    location(id) { const l = this.locations.find(x => x.id === id); if (!l)
        throw new Error(`Lieu inconnu: ${id}`); return l; }
    order(id) { const o = this.orders.find(x => x.id === id); if (!o)
        throw new Error(`Commande inconnue: ${id}`); return o; }
    shipment(id) { const s = this.shipments.find(x => x.id === id); if (!s)
        throw new Error(`Expédition inconnue: ${id}`); return s; }
    requestPurchase(input) {
        this.location(input.locationId);
        this.reference(input.referenceId);
        positive(input.quantity, 'Demande');
        if (input.sourceId) {
            const existing = this.demands.find(x => x.sourceId === input.sourceId);
            if (existing)
                return existing;
        }
        const d = { id: this.id('demand'), locationId: input.locationId, referenceId: input.referenceId, quantity: input.quantity, needAt: finite(input.needAt, this.epochMs + DAY), urgency: clamp(input.urgency, 0, 10), source: input.source, sourceId: input.sourceId ?? '', criticalTrain: input.criticalTrain ?? false, customerContract: input.customerContract ?? false, status: 'requested', orderIds: [] };
        this.demands.push(d);
        this.event('purchase-requested', d.id, `${d.quantity} ${d.referenceId} pour ${d.locationId}`, { source: d.source, sourceId: d.sourceId });
        return d;
    }
    signContract(input) { this.supplier(input.supplierId); this.reference(input.referenceId); const c = { ...clone(input), id: this.id('contract'), discountPct: clamp(input.discountPct, 0, 35), minimumVolume: Math.max(0, input.minimumVolume), slaMs: Math.max(HOUR, input.slaMs), priority: clamp(input.priority, 0, 10), purchased: 0 }; this.contracts.push(c); this.event('framework-signed', c.id, 'Contrat cadre signé', { minimumVolume: c.minimumVolume, slaMs: c.slaMs }); return c; }
    calendarReady(s, at, simple) {
        if (simple)
            return at;
        let t = at;
        for (let i = 0; i < 370; i++) {
            const date = new Date(t), hour = date.getUTCHours() + date.getUTCMinutes() / 60;
            if (s.weekdays.includes(date.getUTCDay()) && hour >= s.openHour && hour < s.closeHour)
                return t;
            const day = Math.floor(t / DAY) * DAY;
            if (s.weekdays.includes(date.getUTCDay()) && hour < s.openHour)
                return day + s.openHour * HOUR;
            t = day + DAY + s.openHour * HOUR;
        }
        return at + 370 * DAY;
    }
    compareOffers(demandId, simple = false) {
        const d = this.demands.find(x => x.id === demandId);
        if (!d)
            throw new Error('Demande inconnue');
        const r = this.reference(d.referenceId);
        return this.suppliers.filter(s => s.referenceIds.includes('*') || s.referenceIds.includes(r.id)).map(s => {
            const c = this.contracts.find(x => x.supplierId === s.id && x.referenceId === r.id);
            const quantity = Math.ceil(Math.max(r.moq, d.quantity) / r.packSize) * r.packSize;
            const pending = this.orders.filter(o => o.supplierId === s.id && ['preparing', 'backorder'].includes(o.status)).reduce((sum, o) => sum + o.quantity, 0);
            const capacityDelayMs = Math.max(0, (pending + quantity - s.capacityPerDay) / s.capacityPerDay * DAY) / (1 + (c?.priority ?? 0) * .1);
            const urgent = d.urgency >= 3;
            const prepare = s.prepareMs * (urgent ? .5 : 1);
            const raw = this.epochMs + prepare + capacityDelayMs;
            const readyAt = this.calendarReady(s, raw, simple);
            const volumeDiscount = Math.min(.12, quantity / 100000);
            const dynamic = clamp(1 + (urgent ? .2 : 0) + Math.min(.15, pending / s.capacityPerDay * .05) - volumeDiscount, .8, 1.35);
            const unitPrice = r.unitPrice * s.priceFactor * dynamic * (1 - (c?.discountPct ?? 0) / 100);
            return { supplierId: s.id, supplierName: s.name, referenceId: r.id, quantity, unitPrice, total: quantity * unitPrice, readyAt, reliability: s.reliability, available: s.available, capacityDelayMs, calendarDelayMs: readyAt - raw, slaAtRisk: Boolean(c && readyAt > this.epochMs + c.slaMs), contractRemaining: c ? Math.max(0, c.minimumVolume - c.purchased) : 0, ...(c ? { contractId: c.id } : {}) };
        }).sort((a, b) => ((a.available ? 0 : 1) - (b.available ? 0 : 1)) || (a.total - b.total) || a.supplierId.localeCompare(b.supplierId));
    }
    compatibleSubstitutions(demandId) { const d = this.demands.find(x => x.id === demandId); if (!d)
        return []; const r = this.reference(d.referenceId); return r.compatibleIds.map(id => this.references.find(x => x.id === id)).filter((x) => Boolean(x) && x.unit === r.unit && x.family === r.family).map(x => ({ referenceId: x.id, name: x.name, priceDifference: x.unitPrice - r.unitPrice, performance: r.compatibilityNotice ?? 'Compatibilité déclarée au catalogue; même unité et mêmes usages, vérifier le coût unitaire.' })); }
    substituteDemand(demandId, referenceId) { const d = this.demands.find(x => x.id === demandId); if (!d || d.orderIds.length)
        throw new Error('Demande déjà attribuée'); const source = this.reference(d.referenceId), target = this.reference(referenceId); if (!source.compatibleIds.includes(referenceId) || source.unit !== target.unit || source.family !== target.family)
        throw new Error('Substitution incompatible: unité ou usage'); d.requestedReferenceId ?? (d.requestedReferenceId = d.referenceId); d.referenceId = referenceId; this.event('substitution', d.id, `Référence remplacée par ${referenceId}`); }
    placeOrder(demandId, supplierId, simple = false) {
        const d = this.demands.find(x => x.id === demandId);
        if (!d)
            throw new Error('Demande inconnue');
        const existing = this.orders.find(x => x.demandId === d.id && x.supplierId === supplierId && x.status !== 'returned');
        if (existing) {
            this.requireFinancedSource(existing.id, simple);
            return existing;
        }
        const offer = this.compareOffers(demandId, simple).find(x => x.supplierId === supplierId);
        if (!offer)
            throw new Error('Fournisseur incompatible');
        const available = offer.available || simple, id = this.id('order'), c = this.contracts.find(x => x.id === offer.contractId);
        this.requireCommandCost(id, offer.total, `Achat ${d.referenceId}`, false, simple, { depotId: this.locations.find(l => l.id === d.locationId)?.kind === 'depot' ? d.locationId : undefined, contractId: c?.id, supplyId: id });
        const o = { id, demandId: d.id, locationId: d.locationId, referenceId: d.referenceId, supplierId, quantity: offer.quantity, requestedQuantity: d.quantity, deliveredQuantity: 0, total: offer.total, unitPrice: offer.unitPrice, readyAt: offer.readyAt, eta: offer.readyAt + HOUR, status: available ? 'preparing' : 'backorder', urgent: d.urgency >= 3, qualityRoll: this.random(), batchId: this.id('batch'), history: [{ at: this.epochMs, status: available ? 'preparing' : 'backorder', message: available ? 'Préparation fournisseur' : 'Fournisseur indisponible; reliquat conservé' }] };
        this.orders.push(o);
        d.orderIds.push(o.id);
        d.status = available ? 'ordered' : 'backorder';
        if (!offer.available && simple)
            this.rescue('supplier', o.id, o.quantity, o.total * .15, 'Fournisseur de secours');
        if (c)
            c.purchased += o.quantity;
        this.event('order-created', o.id, `${o.quantity} ${o.referenceId}; ETA préparation ${new Date(o.readyAt).toISOString()}`);
        return o;
    }
    multiSource(demandId, splits, simple = false) { const d = this.demands.find(x => x.id === demandId); if (!d || d.orderIds.length)
        throw new Error('Demande inconnue ou déjà attribuée'); if (Math.abs(splits.reduce((s, x) => s + x.quantity, 0) - d.quantity) > 1e-6)
        throw new Error('Répartition différente de la demande'); return splits.map((x, index) => { const sub = this.requestPurchase({ ...d, quantity: positive(x.quantity, 'Répartition'), sourceId: `${d.id}:split:${index}` }); const o = this.placeOrder(sub.id, x.supplierId, simple); d.orderIds.push(o.id); d.status = 'ordered'; return o; }); }
    carrierBusyAt(carrierId, at, ignoreFlowId = '') { const carrier = this.carrier(carrierId); return this.shipments.filter(s => s.carrierId === carrierId && !['delivered', 'returned'].includes(s.status) && s.pickupAt <= at && s.unloadAt > at).reduce((sum, s) => sum + s.vehicleCount, 0) + this.flows.filter(f => f.id !== ignoreFlowId && f.carrierId === carrierId && f.status !== 'delivered' && f.createdAt <= at && f.stages[f.stages.length - 1].at > at).reduce((sum, f) => { const r = this.reference(f.referenceId); return sum + Math.max(1, Math.ceil(Math.max(f.quantity * r.unitKg / carrier.capacityKg, f.quantity * r.unitM3 / carrier.capacityM3))); }, 0); }
    compareCarriers(referenceId, quantity, distanceKm, country = 'FR', ignoreFlowId = '') { const r = this.reference(referenceId); return this.carriers.filter(c => (c.families.includes('*') || c.families.includes(r.family)) && (c.countries.includes('*') || c.countries.includes(country))).map(c => { const vehicleCount = Math.max(1, Math.ceil(Math.max(quantity * r.unitKg / c.capacityKg, quantity * r.unitM3 / c.capacityM3))); const travelMs = (distanceKm / c.speedKmh + Math.floor(distanceKm / c.speedKmh / 4.5) * .75 + .25) * HOUR; return { carrierId: c.id, name: c.name, cost: Math.max(25, distanceKm * c.tariffKm * vehicleCount), travelMs, reliability: c.reliability, vehicleCount, available: c.available && c.fleetCapacity - this.carrierBusyAt(c.id, this.epochMs, ignoreFlowId) >= vehicleCount }; }).sort((a, b) => (Number(b.available) - Number(a.available)) || a.cost - b.cost); }
    planPickup(orderId, input, simple = false) {
        const o = this.order(orderId);
        this.requireFinancedSource(o.id, simple);
        if (o.status !== 'ready')
            throw new Error('Marchandise pas encore préparée');
        const existing = this.shipments.find(x => x.orderId === o.id && !['delivered', 'returned'].includes(x.status));
        if (existing)
            return existing;
        const pickupAt = Math.max(this.epochMs, o.readyAt, input.pickupAt);
        if (input.windowEnd !== undefined && pickupAt > input.windowEnd && !simple)
            throw new Error('Fenêtre de pickup manquée');
        const s = this.makeShipment({ from: `supplier:${o.supplierId}`, to: o.locationId, referenceId: o.referenceId, quantity: o.quantity - o.deliveredQuantity, supplierId: o.supplierId, batchId: o.batchId, orderId: o.id, carrierId: input.carrierId, distanceKm: input.distanceKm, pickupAt, terminalCutoff: input.terminalCutoff, railDeparture: input.railDeparture, railArrival: input.railArrival, trafficFactor: input.trafficFactor, weatherFactor: input.weatherFactor, crossDockTo: input.crossDockTo }, simple);
        o.status = 'transit';
        o.eta = s.eta;
        o.history.push({ at: this.epochMs, status: 'transit', message: `Pickup réservé ${s.carrierId}` });
        return s;
    }
    makeShipment(input, simple) {
        this.location(input.to);
        const ref = this.reference(input.referenceId);
        const c = this.carrier(input.carrierId);
        const weightKg = input.quantity * ref.unitKg, volumeM3 = input.quantity * ref.unitM3;
        const vehicleCount = Math.max(1, Math.ceil(Math.max(weightKg / c.capacityKg, volumeM3 / c.capacityM3)));
        const busy = this.carrierBusyAt(c.id, input.pickupAt);
        const id = this.id('shipment');
        if ((!c.available || vehicleCount + busy > c.fleetCapacity) && !simple)
            throw new Error('Capacité transporteur insuffisante');
        const distanceKm = Math.max(0, input.distanceKm), cost = Math.max(25, distanceKm * c.tariffKm * vehicleCount);
        this.requireCommandCost(id, cost, 'Transport routier', false, simple, { supplyId: input.orderId ?? id });
        const delayRoll = this.random();
        const reliabilityDelay = delayRoll > c.reliability ? (delayRoll - c.reliability) * 20 * HOUR : 0;
        const drive = distanceKm / c.speedKmh;
        const travelMs = (drive * clamp(input.trafficFactor ?? 1, .5, 3) * clamp(input.weatherFactor ?? 1, .7, 3) + Math.floor(drive / 4.5) * .75 + .25) * HOUR + reliabilityDelay;
        const eta = input.pickupAt + travelMs;
        const missedCutoff = input.terminalCutoff !== undefined && eta > input.terminalCutoff;
        const alternatives = missedCutoff ? [{ kind: 'wait', eta: eta + DAY, cost: 0, label: 'Attendre au terminal' }, { kind: 'next-train', eta: (input.railDeparture ?? eta) + DAY, cost: 15, label: 'Train suivant (+24 h)' }, { kind: 'rescue-road', eta: eta + HOUR, cost: cost * .5 + 100, label: 'Acheminement routier de secours' }] : [];
        const s = { id, groupId: id, ...input, vehicleClass: c.vehicleClass, vehicleCount, weightKg, volumeM3, distanceKm, cost, pickupAt: input.pickupAt, eta, unloadAt: eta, carrierId: c.id, status: 'planned', missedCutoff, alternatives, quantityMissing: 0, damagedQuantity: 0, wrongReference: false, scans: [{ at: this.epochMs, status: 'pickup-reserved' }] };
        this.shipments.push(s);
        if (!c.available || vehicleCount + busy > c.fleetCapacity)
            this.rescue('truck', id, vehicleCount, cost * .2 + 50, 'Capacité routière additionnelle');
        if (missedCutoff) {
            this.event('cutoff-missed', id, 'Correspondance terminale manquée; trois alternatives disponibles', { eta, cutoff: input.terminalCutoff });
            if (simple)
                this.chooseAlternative(id, 'rescue-road', true);
        }
        this.scheduleDock(s, simple);
        this.event('pickup-reserved', id, `${vehicleCount} ${c.vehicleClass}, ${weightKg} kg`, { from: s.from, to: s.to, distanceKm: s.distanceKm });
        return s;
    }
    scheduleDock(s, simple) {
        const l = this.location(s.to), slots = Math.max(1, Math.floor(l.dockCount ?? 1)), capacity = Math.max(1, l.dockCapacity ?? 25000);
        const duration = (shipment) => (l.unloadMs ?? HOUR / 4) * Math.max(1, Math.ceil(shipment.weightKg / capacity)), unload = duration(s);
        let start = Math.max(this.epochMs, s.eta, s.railArrival ?? 0);
        if (l.closed) {
            if (simple)
                this.rescue('dock', s.id, s.quantity, 50, 'Quai de secours pour terminal fermé');
            else
                start += DAY;
        }
        // Reserve aggregate time intervals: a future pickup does not occupy a dock now.
        const changes = new Map();
        for (const other of this.shipments) {
            if (other.id === s.id || other.to !== s.to || ['delivered', 'returned'].includes(other.status) || other.unloadAt <= start)
                continue;
            const began = other.unloadStartAt ?? other.unloadAt - duration(other);
            changes.set(began, (changes.get(began) ?? 0) + 1);
            changes.set(other.unloadAt, (changes.get(other.unloadAt) ?? 0) - 1);
        }
        const times = [...changes.keys()].sort((a, b) => a - b);
        let occupied = 0;
        for (let i = 0; i < times.length - 1; i++) {
            const at = times[i];
            occupied += changes.get(at) ?? 0;
            const end = times[i + 1];
            if (occupied < slots || end <= start)
                continue;
            if (start + unload <= at)
                break;
            start = Math.max(start, end);
        }
        s.unloadStartAt = start;
        s.unloadAt = start + unload;
    }
    chooseAlternative(shipmentId, kind, simple = false) { const s = this.shipment(shipmentId), a = s.alternatives.find(x => x.kind === kind); if (!a)
        throw new Error('Alternative inconnue'); if (s.selectedAlternative === kind)
        return; if (kind === 'rescue-road')
        this.requireCommandCost(this.id('alternative'), a.cost, 'Secours routier', simple, simple, { supplyId: s.orderId ?? s.id }); s.selectedAlternative = kind; if (kind === 'next-train') {
        s.railDeparture = (s.railDeparture ?? s.eta) + DAY;
        s.railArrival = (s.railArrival ?? s.railDeparture) + DAY;
    }
    else if (kind === 'wait') {
        s.railDeparture = a.eta;
        s.railArrival = a.eta + HOUR;
    }
    else {
        s.railDeparture = undefined;
        s.railArrival = undefined;
        if (simple)
            this.rescue('road', s.id, s.quantity, a.cost, 'Correspondance manquée, secours automatique');
    } this.scheduleDock(s, simple); this.event('alternative-selected', s.id, a.label, { kind, cost: a.cost }); }
    consolidate(shipmentIds) {
        const distinct = [...new Set(shipmentIds)];
        if (distinct.length !== shipmentIds.length || distinct.length < 2)
            throw new Error('Consolidation: au moins deux expéditions distinctes, aucun ID dupliqué');
        const list = distinct.map(id => this.shipment(id));
        if (list.some(shipment => shipment.groupId !== shipment.id || this.consolidationGroups.some(group => group.shipmentIds.includes(shipment.id))))
            throw new Error('Expéditions déjà consolidées; économie déjà comptabilisée');
        if (list.some(shipment => shipment.status !== 'planned' || shipment.to !== list[0].to || shipment.carrierId !== list[0].carrierId))
            throw new Error('Consolidation: destination, transporteur et pickups doivent correspondre');
        for (const shipment of list)
            this.requireFinancedSource(shipment.orderId ?? shipment.id, this.simpleMode);
        const groupId = this.id('consolidation'), costBefore = list.reduce((sum, shipment) => sum + shipment.cost, 0), saving = costBefore * .12;
        const group = { id: groupId, shipmentIds: distinct.slice().sort(), at: this.epochMs, carrierId: list[0].carrierId, destinationId: list[0].to, weightKg: list.reduce((sum, shipment) => sum + shipment.weightKg, 0), volumeM3: list.reduce((sum, shipment) => sum + shipment.volumeM3, 0), costBefore, saving };
        this.consolidationGroups.push(group);
        for (const shipment of list) {
            shipment.groupId = groupId;
            shipment.cost *= .88;
        }
        this.cost(`saving:${groupId}`, -saving, 'Économie consolidation', false, { supplyId: groupId, depotId: new Set(list.map(s => s.to)).size === 1 ? list[0].to : undefined });
        this.event('consolidated', groupId, `${list.length} lots consolidés`, { saving, shipmentIds: group.shipmentIds });
        return groupId;
    }
    receiveShipment(shipmentId, inspection, simple = false) {
        const s = this.shipment(shipmentId);
        this.requireFinancedSource(s.orderId ?? s.id, simple);
        if (s.status === 'delivered')
            return this.lots.find(l => l.orderId === (s.orderId ?? s.id) && l.batchId === s.batchId) ?? null;
        if (s.status !== 'quality')
            throw new Error('Déchargement non terminé');
        if (s.missedCutoff && !s.selectedAlternative && !simple)
            throw new Error('Choisir une alternative après cut-off manqué');
        const o = s.orderId ? this.order(s.orderId) : null;
        const risk = o ? o.qualityRoll : 1;
        const reliability = o ? this.supplier(o.supplierId).reliability : 1;
        const missing = clamp(inspection.missing ?? (risk > reliability ? Math.ceil(s.quantity * .05) : 0), 0, s.quantity);
        const damaged = clamp(inspection.damaged ?? 0, 0, s.quantity - missing);
        const wrong = inspection.wrongReference ?? false;
        const lost = wrong ? s.quantity : missing + damaged, accepted = simple ? s.quantity : s.quantity - lost, ref = this.reference(s.referenceId);
        let packagingId;
        if (accepted > 0 && ref.reusableDeposit && s.from.startsWith('supplier:')) {
            packagingId = this.id('packaging');
            this.requireCommandCost(packagingId, Math.ceil(accepted / ref.packSize) * ref.reusableDeposit, 'Consigne emballages', false, simple, { supplyId: s.orderId ?? s.id });
        }
        s.quantityMissing = missing;
        s.damagedQuantity = damaged;
        s.wrongReference = wrong;
        if (lost > 0) {
            this.event('reception-dispute', s.id, 'Écart de réception', { missing, damaged, wrongReference: wrong });
            if (simple)
                this.rescue('replacement', s.id, lost, lost * this.reference(s.referenceId).unitPrice, 'Écart réception compensé sans blocage');
        }
        let lot = null;
        if (accepted > 0) {
            lot = { id: this.id('lot'), batchId: s.batchId, referenceId: o ? this.stockReference(o) : s.referenceId, ...(o && this.stockReference(o) !== s.referenceId ? { receivedReferenceId: s.referenceId } : {}), locationId: s.to, supplierId: s.supplierId, orderId: o?.id ?? s.id, quantity: accepted, receivedAt: this.epochMs, expiresAt: ref.shelfLifeMs ? this.epochMs + ref.shelfLifeMs : null, quality: s.returnKind === 'defective' || s.returnKind === 'warranty' ? 'quarantine' : 'good', usedBy: [] };
            this.lots.push(lot);
            for (const p of s.packagingMovement ?? [])
                this.packaging.push({ id: this.id('packaging'), locationId: s.to, kind: p.kind, quantity: p.quantity, deposit: p.deposit, status: 'available', supplierId: p.supplierId });
            const packages = Math.ceil(accepted / ref.packSize);
            if (packagingId && ref.reusableDeposit)
                this.packaging.push({ id: packagingId, locationId: s.to, kind: ref.packaging, quantity: packages, deposit: ref.reusableDeposit, status: 'available', supplierId: s.supplierId });
            if (!s.crossDockTo && lot.quality === 'good') {
                const source = o ? this.demands.find(d => d.id === o.demandId)?.source ?? 'player' : 'return';
                this.deliveries.push({ delivery: { eventId: `delivery:${s.id}`, locationId: s.to, referenceId: lot.referenceId, quantity: accepted, lotId: lot.id, source, at: this.epochMs }, sent: false });
            }
        }
        s.status = 'delivered';
        s.proof = { at: this.epochMs, quantity: accepted, difference: lost };
        s.scans.push({ at: this.epochMs, status: 'delivered' });
        if (o) {
            o.deliveredQuantity += accepted;
            o.status = o.deliveredQuantity >= o.quantity ? 'delivered' : 'backorder';
            o.history.push({ at: this.epochMs, status: o.status, message: `Réception ${accepted}; reliquat ${o.quantity - o.deliveredQuantity}` });
            const d = this.demands.find(x => x.id === o.demandId);
            if (d)
                d.status = o.status === 'delivered' ? 'fulfilled' : 'backorder';
        }
        for (const parent of this.demands)
            if (parent.orderIds.includes(o?.id ?? '') && parent.orderIds.length && parent.orderIds.every(id => this.orders.find(x => x.id === id)?.status === 'delivered'))
                parent.status = 'fulfilled';
        this.event('delivery-proof', s.id, `Livraison ${accepted} ${s.referenceId}`, { at: this.epochMs, quantity: accepted, difference: lost });
        if (s.crossDockTo && lot) {
            this.location(s.crossDockTo);
            const onward = this.transferStock(s.to, s.crossDockTo, lot.referenceId, accepted, simple, true);
            this.event('cross-docked', s.id, `Transfert direct vers ${s.crossDockTo}`, { shipmentId: onward.id });
        }
        this.allocateReservations();
        this.flushEffects();
        return lot;
    }
    importStock(locationId, referenceId, quantity, sourceId) { const key = `${locationId}:${referenceId}:${sourceId}`; if (this.importedStockKeys.includes(key))
        return; this.location(locationId); this.reference(referenceId); this.importedStockKeys.push(key); if (quantity <= 0)
        return; this.lots.push({ id: this.id('lot'), batchId: this.id('legacy-batch'), referenceId, locationId, supplierId: 'legacy-stock', orderId: '', quantity, receivedAt: this.epochMs, expiresAt: null, quality: 'good', usedBy: [] }); this.allocateReservations(); }
    totalStock(locationId, referenceId) { return this.lots.filter(l => l.locationId === locationId && l.referenceId === referenceId && l.quality === 'good').reduce((sum, l) => sum + l.quantity, 0); }
    /** Finance holds exclude usable stock without removing the physical assets. */
    unfundedStock(locationId, referenceId) { return this.simpleMode ? 0 : this.lots.filter(l => l.locationId === locationId && l.referenceId === referenceId && l.quality === 'good' && this.paymentHolds.has(l.orderId)).reduce((sum, l) => sum + l.quantity, 0); }
    availableStock(locationId, referenceId) { return Math.max(0, this.lots.filter(l => l.locationId === locationId && l.referenceId === referenceId && l.quality === 'good' && this.stockFinanced(l)).reduce((sum, l) => sum + l.quantity, 0) - this.reservations.filter(r => r.locationId === locationId && r.referenceId === referenceId && (r.status === 'reserved' || r.status === 'pending')).reduce((sum, r) => sum + r.allocated, 0)); }
    transitQuantity(locationId, referenceId) { return this.orders.filter(o => o.locationId === locationId && !['delivered', 'returned'].includes(o.status) && this.stockReference(o) === referenceId).reduce((sum, o) => sum + Math.max(0, o.quantity - o.deliveredQuantity), 0) + this.shipments.filter(s => !s.orderId && s.to === locationId && s.referenceId === referenceId && !['delivered', 'returned'].includes(s.status)).reduce((sum, s) => sum + s.quantity, 0); }
    earliestArrival(locationId, referenceId) { const times = this.orders.filter(o => o.locationId === locationId && !['delivered', 'returned', 'backorder'].includes(o.status) && this.stockReference(o) === referenceId).map(o => o.eta); for (const s of this.shipments)
        if (!s.orderId && s.to === locationId && s.referenceId === referenceId && !['delivered', 'returned'].includes(s.status))
            times.push(s.unloadAt); return times.length ? times.reduce((earliest, at) => Math.min(earliest, at), Infinity) : null; }
    reserveStock(input) { const existing = this.reservations.find(r => r.operationId === input.operationId && r.referenceId === input.referenceId && r.status !== 'cancelled'); if (existing)
        return existing; this.location(input.locationId); this.reference(input.referenceId); const r = { id: this.id('reservation'), operationId: input.operationId, locationId: input.locationId, referenceId: input.referenceId, quantity: positive(input.quantity, 'Réservation'), allocated: 0, priority: input.priority + (input.criticalTrain ? 10 : 0) + (input.customerContract ? 5 : 0), status: 'pending', lots: [] }; this.reservations.push(r); this.allocateReservations(); return r; }
    allocateReservations() {
        const active = this.reservations.filter(r => r.status === 'pending' || r.status === 'reserved').sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
        const used = new Map();
        for (const r of active) {
            r.allocated = 0;
            r.lots = [];
            for (const l of this.lots.filter(l => l.locationId === r.locationId && l.referenceId === r.referenceId && l.quality === 'good' && this.stockFinanced(l)).sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || a.receivedAt - b.receivedAt)) {
                const free = Math.max(0, l.quantity - (used.get(l.id) ?? 0));
                const qty = Math.min(free, r.quantity - r.allocated);
                if (qty > 0) {
                    r.lots.push({ lotId: l.id, quantity: qty });
                    used.set(l.id, (used.get(l.id) ?? 0) + qty);
                    r.allocated += qty;
                }
                if (r.allocated >= r.quantity)
                    break;
            }
            r.status = r.allocated >= r.quantity ? 'reserved' : 'pending';
        }
    }
    consumeReservation(operationId) { const list = this.reservations.filter(r => r.operationId === operationId && r.status === 'reserved'); let consumed = 0; for (const r of list) {
        for (const a of r.lots) {
            const l = this.lots.find(x => x.id === a.lotId);
            if (l) {
                l.quantity -= a.quantity;
                l.usedBy.push({ operationId, quantity: a.quantity, at: this.epochMs });
            }
        }
        r.status = 'consumed';
        consumed += r.allocated;
        this.consumptions.push({ eventId: `consume:${r.id}`, locationId: r.locationId, referenceId: r.referenceId, quantity: r.allocated, operationId, at: this.epochMs, sent: false });
        this.event('stock-consumed', r.id, `${r.allocated} ${r.referenceId} consommés pour ${operationId}`);
    } this.allocateReservations(); this.flushEffects(); return consumed; }
    recordExternalUse(operationId, locationId, referenceId, quantity) {
        const key = `${operationId}:${locationId}:${referenceId}`;
        if (this.externalUseKeys.includes(key))
            return 0;
        positive(quantity, 'Consommation physique externe');
        this.location(locationId);
        this.reference(referenceId);
        let remaining = quantity;
        for (const lot of this.lots.filter(l => l.locationId === locationId && l.referenceId === referenceId && l.quality === 'good').sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || a.receivedAt - b.receivedAt)) {
            const used = Math.min(remaining, lot.quantity);
            if (used > 0) {
                lot.quantity -= used;
                lot.usedBy.push({ operationId, quantity: used, at: this.epochMs });
                remaining -= used;
            }
            if (remaining === 0)
                break;
        }
        this.externalUseKeys.push(key);
        this.allocateReservations();
        this.event('external-stock-used', operationId, `Consommation physique déjà réalisée: ${quantity - remaining} ${referenceId}`, { locationId, referenceId, quantity: quantity - remaining, untracedQuantity: remaining });
        return quantity - remaining;
    }
    cancelReservation(operationId) { for (const r of this.reservations)
        if (r.operationId === operationId && r.status !== 'consumed')
            r.status = 'cancelled'; this.allocateReservations(); }
    transferProposals(locationId, referenceId, quantity) { return this.locations.filter(l => l.id !== locationId && l.kind === 'depot' || l.id !== locationId && l.kind === 'hub').map(l => ({ from: l.id, available: this.availableStock(l.id, referenceId), quantity: Math.min(quantity, this.availableStock(l.id, referenceId)), eta: this.epochMs + 2 * HOUR })).filter(x => x.quantity > 0); }
    transferStock(from, to, referenceId, quantity, simple = false, crossDock = false, allowQuarantine = false) { positive(quantity, 'Transfert'); this.location(from); this.location(to); const quarantined = allowQuarantine ? this.lots.filter(l => l.locationId === from && l.referenceId === referenceId && (l.quality === 'recalled' || l.quality === 'quarantine')).reduce((sum, l) => sum + l.quantity, 0) : 0; if (this.availableStock(from, referenceId) + quarantined < quantity)
        throw new Error('Stock disponible insuffisant pour le transfert'); const lots = this.lots.filter(l => l.locationId === from && l.referenceId === referenceId && this.stockFinanced(l) && (l.quality === 'good' || allowQuarantine && (l.quality === 'recalled' || l.quality === 'quarantine'))).sort((a, b) => Number(a.quality === 'good') - Number(b.quality === 'good')); const batchId = lots.find(l => l.quantity > 0)?.batchId ?? this.id('batch'); const carrier = this.compareCarriers(referenceId, quantity, 50).find(c => c.available)?.carrierId ?? 'regional'; const s = this.makeShipment({ from, to, referenceId, quantity, supplierId: lots[0]?.supplierId ?? 'internal', batchId, carrierId: carrier, distanceKm: 50, pickupAt: this.epochMs }, simple); const ref = this.reference(referenceId); if (ref.reusableDeposit) {
        let required = Math.ceil(quantity / ref.packSize);
        s.packagingMovement = [];
        for (const p of this.packaging.filter(p => p.locationId === from && p.kind === ref.packaging && p.status === 'available')) {
            const take = Math.min(required, p.quantity);
            if (take > 0) {
                p.quantity -= take;
                required -= take;
                s.packagingMovement.push({ kind: p.kind, quantity: take, deposit: p.deposit, supplierId: p.supplierId });
            }
            if (required === 0)
                break;
        }
    } let remaining = quantity, goodMoved = 0; for (const l of lots) {
        const reserved = this.reservations.filter(r => r.status === 'reserved' || r.status === 'pending').flatMap(r => r.lots).filter(a => a.lotId === l.id).reduce((sum, a) => sum + a.quantity, 0);
        const take = Math.min(remaining, Math.max(0, l.quantity - reserved));
        l.quantity -= take;
        remaining -= take;
        if (l.quality === 'good')
            goodMoved += take;
        if (!remaining)
            break;
    } this.consumptions.push({ eventId: `transfer:${s.id}`, locationId: from, referenceId, quantity: goodMoved, operationId: s.id, at: this.epochMs, sent: crossDock || goodMoved === 0 }); this.event('stock-transfer', s.id, `${quantity} ${referenceId}: ${from} → ${to}`); this.flushEffects(); return s; }
    deconsolidate(shipmentId, destinations, simple = false) { const s = this.shipment(shipmentId); const total = destinations.reduce((sum, d) => sum + positive(d.quantity, 'Déconsolidation'), 0); if (s.status !== 'delivered' || total > s.quantity || total > this.availableStock(s.to, s.referenceId))
        throw new Error('Déconsolidation: réception, stock ou quantités invalides'); for (const d of destinations)
        this.location(d.locationId); return destinations.map(d => this.transferStock(s.to, d.locationId, s.referenceId, d.quantity, simple)); }
    returnStock(locationId, referenceId, quantity, to, kind, simple = false) { const s = this.transferStock(locationId, to, referenceId, quantity, simple, false, kind === 'defective' || kind === 'warranty'); s.returnKind = kind; this.event('reverse-logistics', s.id, `Retour ${kind}`, { quantity }); return s; }
    returnPackaging(packagingId, to, simple = false) { const p = this.packaging.find(x => x.id === packagingId); if (!p || p.status !== 'available')
        throw new Error('Emballages indisponibles'); const f = this.createFlow({ kind: 'ecommerce-return', referenceId: 'reusable_packaging', quantity: p.quantity, from: p.locationId, to, deadline: this.epochMs + 2 * DAY, distanceKm: 50, documents: [`Consigne ${p.id}`, `Valeur ${p.quantity * p.deposit}`], campaignId: `packaging:${p.id}` }, simple); p.status = 'returning'; return f; }
    recallLot(batchId, reason) { const affected = this.lots.filter(l => l.batchId === batchId); if (!affected.length)
        throw new Error('Lot inconnu'); for (const l of affected) {
        if (l.quality === 'good' && l.quantity > 0)
            this.excludeLot(l, 'recall');
        l.quality = 'recalled';
    } const recall = { lotId: batchId, referenceId: affected[0].referenceId, locationIds: [...new Set(affected.map(l => l.locationId))], operationIds: [...new Set(affected.flatMap(l => l.usedBy.map(u => u.operationId)))] }; this.allocateReservations(); this.flushEffects(); this.host?.onRecall?.(recall); this.event('supplier-recall', batchId, reason, { ...recall }); return recall; }
    setStockPolicy(policy) { this.location(policy.locationId); this.reference(policy.referenceId); const value = { ...clone(policy), autoGenerated: policy.autoGenerated === true, minimum: Math.max(0, policy.minimum), coverDays: Math.max(0, policy.coverDays), dailyUse: Math.max(0, policy.dailyUse) }; const old = this.stockPolicies.find(p => p.locationId === policy.locationId && p.referenceId === policy.referenceId); if (old)
        Object.assign(old, value);
    else
        this.stockPolicies.push(value); }
    forecast(policy) { const runtime = policy.runtimeForecast, daily = policy.dailyUse + (policy.mileageUse ?? 0) + (policy.historyUse ?? 0) + (runtime?.historyPerDay ?? 0) + (runtime?.mileagePerDay ?? 0); return Math.max(0, daily * (policy.seasonFactor ?? 1) * (runtime?.seasonFactor ?? 1) * policy.coverDays + (policy.plannedUse ?? 0) + (policy.futureServicesUse ?? 0) + (runtime?.plannedUse ?? 0) + (runtime?.futureServicesUse ?? 0)); }
    inventory(locationId, referenceId, counted, simple = false) { const expected = this.totalStock(locationId, referenceId); const value = simple ? expected : Math.max(0, counted ?? expected); const c = { id: this.id('inventory'), locationId, referenceId, at: this.epochMs, expected, counted: value, difference: value - expected, automatic: simple }; this.inventoryControls.push(c); if (c.difference !== 0) {
        if (c.difference > 0)
            this.importStock(locationId, referenceId, c.difference, c.id);
        else {
            let loss = -c.difference;
            for (const l of this.lots.filter(l => l.locationId === locationId && l.referenceId === referenceId && l.quality === 'good')) {
                const q = Math.min(loss, l.quantity);
                l.quantity -= q;
                loss -= q;
                if (!loss)
                    break;
            }
            this.allocateReservations();
        }
    } this.event('inventory', c.id, `Inventaire: écart ${c.difference}`, { expected, counted: value }); return c; }
    supply(simple) {
        for (const x of this.host?.requestSources?.() ?? [])
            if (x.quantity > 0 && this.locations.some(l => l.id === x.locationId) && this.references.some(r => r.id === x.referenceId))
                this.requestPurchase({ ...x, sourceId: x.id });
        if (this.delegatedSupply) {
            {
                const stock = new Map(), reserved = new Map(), orderTransit = new Map(), shipmentTransit = new Map(), requested = new Map();
                const get = (index, locationId, referenceId) => index.get(locationId)?.get(referenceId) ?? 0;
                const add = (index, locationId, referenceId, quantity) => { let row = index.get(locationId); if (!row) {
                    row = new Map();
                    index.set(locationId, row);
                } row.set(referenceId, (row.get(referenceId) ?? 0) + quantity); };
                const demandById = new Map(), knownDemands = new Set(this.demands);
                for (const demand of this.demands) {
                    if (!demandById.has(demand.id))
                        demandById.set(demand.id, demand);
                    if (demand.status === 'requested')
                        add(requested, demand.locationId, demand.requestedReferenceId ?? demand.referenceId, demand.quantity);
                }
                for (const lot of this.lots)
                    if (lot.quality === 'good' && this.stockFinanced(lot))
                        add(stock, lot.locationId, lot.referenceId, lot.quantity);
                for (const reservation of this.reservations)
                    if (reservation.status === 'reserved' || reservation.status === 'pending')
                        add(reserved, reservation.locationId, reservation.referenceId, reservation.allocated);
                for (const order of this.orders)
                    if (!['delivered', 'returned'].includes(order.status))
                        add(orderTransit, order.locationId, demandById.get(order.demandId)?.requestedReferenceId ?? order.referenceId, Math.max(0, order.quantity - order.deliveredQuantity));
                for (const shipment of this.shipments)
                    if (!shipment.orderId && !['delivered', 'returned'].includes(shipment.status))
                        add(shipmentTransit, shipment.to, shipment.referenceId, shipment.quantity);
                for (const p of this.stockPolicies.filter(p => p.delegated !== false)) {
                    const available = Math.max(0, get(stock, p.locationId, p.referenceId) - get(reserved, p.locationId, p.referenceId)) + (get(orderTransit, p.locationId, p.referenceId) + get(shipmentTransit, p.locationId, p.referenceId)) + get(requested, p.locationId, p.referenceId), target = Math.max(p.minimum, this.forecast(p));
                    if (target > available) {
                        const demand = this.requestPurchase({ locationId: p.locationId, referenceId: p.referenceId, quantity: target - available, needAt: this.epochMs + Math.max(HOUR, p.coverDays * DAY), urgency: available <= 0 ? 3 : 1, source: 'forecast', sourceId: `forecast:${p.locationId}:${p.referenceId}:${Math.floor(this.epochMs / HOUR)}` });
                        // Duplicate policies see a new pending demand exactly as the former rescan did.
                        // Idempotent sourceId lookup may return an existing/ordered demand: never add it twice.
                        if (!knownDemands.has(demand)) {
                            knownDemands.add(demand);
                            if (demand.status === 'requested')
                                add(requested, demand.locationId, demand.requestedReferenceId ?? demand.referenceId, demand.quantity);
                        }
                    }
                }
            }
            for (const d of this.demands.filter(d => d.status === 'requested').sort((a, b) => (b.urgency + Number(b.criticalTrain) * 10 + Number(b.customerContract) * 5) - (a.urgency + Number(a.criticalTrain) * 10 + Number(a.customerContract) * 5) || a.needAt - b.needAt)) {
                const offer = this.compareOffers(d.id, simple).filter(o => o.available || simple).sort((a, b) => { const score = (x) => x.total + (x.readyAt > d.needAt ? this.reference(d.referenceId).unitPrice * d.quantity : 0) + (1 - x.reliability) * x.total; return score(a) - score(b); })[0];
                if (offer)
                    try {
                        this.placeOrder(d.id, offer.supplierId, simple);
                    }
                    catch (error) {
                        if (!(error instanceof LogisticsFundingError))
                            throw error;
                    }
            }
        }
    }
    rescue(type, entityId, quantity, cost, reason) { const r = { id: this.id('rescue-resource'), at: this.epochMs, entityId, type, quantity, cost: Math.max(1, cost), reason, informational: true }; this.rescueResources.push(r); this.cost(r.id, r.cost, reason, true, { supplyId: entityId }); this.event('simple-rescue', r.id, reason, { type, quantity, cost: r.cost, informational: true }); }
    cost(id, amount, label, informational, dimensions) { if (this.costs.some(c => c.id === `logistics:${id}`))
        return; this.costs.push({ id: `logistics:${id}`, amount, label, informational, dimensions: dimensions ? { ...dimensions } : undefined, sent: false }); this.paymentHoldsDirty = true; this.flushEffects(); }
    /** Command costs are accepted before creating physical commitments. Legacy void hosts remain supported. */
    requireCommandCost(id, amount, label, informational, simple, dimensions) {
        const effect = { id: `logistics:${id}`, amount, label, informational, dimensions: dimensions ? { ...dimensions } : undefined, sent: false };
        if (this.host?.recordCost) {
            const accepted = this.host.recordCost(effect.id, amount, label, informational, effect.dimensions);
            if (accepted === false && !simple)
                throw new LogisticsFundingError('Trésorerie insuffisante : paiement refusé, aucune commande ni réservation créée.');
            effect.sent = accepted !== false;
        }
        this.costs.push(effect);
        if (!effect.sent)
            this.paymentHoldsDirty = true;
    }
    requireFinancedSource(sourceId, simple) { if (!simple) {
        this.flushEffects();
        if (this.paymentHolds.has(sourceId))
            throw new LogisticsFundingError('Paiement logistique en attente : rétablissez la trésorerie avant de réserver ou libérer ce lot.');
    } }
    stockFinanced(lot) { return this.simpleMode || !this.paymentHolds.has(lot.orderId); }
    recheckSavedCosts() {
        const checked = this.host?.isCostRecorded;
        if (checked)
            for (const cost of this.costs)
                if (cost.sent && !cost.informational && !checked(cost.id))
                    cost.sent = false;
        this.paymentHoldsDirty = true;
    }
    refreshPaymentHolds() {
        if (!this.paymentHoldsDirty)
            return;
        this.paymentHoldsDirty = false;
        this.paymentHolds.clear();
        if (!this.host?.recordCost)
            return;
        const sources = new Map();
        for (const order of this.orders)
            sources.set(`logistics:${order.id}`, order.id);
        for (const shipment of this.shipments)
            sources.set(`logistics:${shipment.id}`, shipment.orderId ?? shipment.id);
        for (const flow of this.flows)
            sources.set(`logistics:${flow.id}`, flow.id);
        for (const cost of this.costs)
            if (!cost.sent && !cost.informational) {
                const source = sources.get(cost.id) ?? cost.dimensions?.supplyId;
                if (source)
                    this.paymentHolds.add(source);
            }
        this.allocateReservations();
    }
    excludeLot(lot, reason) { const eventId = `exclude:${reason}:${lot.id}`; if (this.exclusions.some(e => e.exclusion.eventId === eventId))
        return; this.exclusions.push({ exclusion: { eventId, locationId: lot.locationId, referenceId: lot.referenceId, quantity: lot.quantity, reason, lotId: lot.id, at: this.epochMs }, sent: false }); }
    flushEffects() {
        const host = this.host;
        if (!host)
            return;
        // Economic acceptance precedes stock delivery, including recovery of RC48 sent-but-unpaid effects.
        for (const e of this.costs)
            if (!e.sent && host.recordCost) {
                try {
                    if (host.recordCost(e.id, e.amount, e.label, e.informational, e.dimensions) !== false) {
                        e.sent = true;
                        this.paymentHoldsDirty = true;
                    }
                }
                catch {
                    break;
                }
            }
        this.refreshPaymentHolds();
        const actions = [];
        for (const e of this.deliveries)
            if (!e.sent) {
                const lot = this.lots.find(l => l.id === e.delivery.lotId);
                if (lot && !this.stockFinanced(lot))
                    continue;
                actions.push({ at: e.delivery.at, priority: 0, run: () => { host.deliverStock(clone(e.delivery)); e.sent = true; } });
            }
        for (const e of this.consumptions)
            if (!e.sent && host.consumeStock)
                actions.push({ at: e.at, priority: 1, run: () => { const { sent, ...use } = e; host.consumeStock?.(use); e.sent = true; } });
        for (const e of this.exclusions)
            if (!e.sent && host.excludeStock)
                actions.push({ at: e.exclusion.at, priority: 2, run: () => { host.excludeStock?.(clone(e.exclusion)); e.sent = true; } });
        actions.sort((a, b) => a.at - b.at || a.priority - b.priority);
        for (const a of actions) {
            try {
                a.run();
            }
            catch {
                break;
            }
        }
    }
    /** Reflect physical consumption already performed by another domain; never emits a delivery. */
    syncStock(locationId, referenceId, physicalQuantity) { const total = this.totalStock(locationId, referenceId), shadow = this.exclusions.filter(e => !e.sent && e.exclusion.locationId === locationId && e.exclusion.referenceId === referenceId).reduce((sum, e) => sum + e.exclusion.quantity, 0) + this.consumptions.filter(e => !e.sent && e.locationId === locationId && e.referenceId === referenceId).reduce((sum, e) => sum + e.quantity, 0), pending = this.deliveries.filter(e => !e.sent && e.delivery.locationId === locationId && e.delivery.referenceId === referenceId).reduce((sum, e) => sum + e.delivery.quantity, 0), quantity = Math.max(0, finite(physicalQuantity) + pending - shadow); if (Math.abs(quantity - total) < 1e-6)
        return; const difference = quantity - total; if (difference > 0)
        this.importStock(locationId, referenceId, difference, this.id('external-stock'));
    else {
        let loss = -difference;
        for (const l of this.lots.filter(x => x.locationId === locationId && x.referenceId === referenceId && x.quality === 'good').sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity))) {
            const take = Math.min(loss, l.quantity);
            l.quantity -= take;
            if (take)
                l.usedBy.push({ operationId: 'external-consumption', quantity: take, at: this.epochMs });
            loss -= take;
            if (loss <= 0)
                break;
        }
        this.allocateReservations();
    } }
    createFlow(input, simple = false) {
        this.location(input.from);
        this.location(input.to);
        if (input.hubId)
            this.location(input.hubId);
        const r = this.reference(input.referenceId);
        positive(input.quantity, 'Cohorte');
        const bound = Boolean(input.rail && this.host?.getRailService);
        let railInvalid = '';
        if (input.rail) {
            const offered = input.rail, actual = this.host?.getRailService?.(offered.serviceId);
            if (bound) {
                if (!actual || actual.serviceId !== offered.serviceId)
                    railInvalid = 'Service ferroviaire réel absent';
                else {
                    const origin = [actual.originId, ...(actual.originLocationIds ?? [])].filter((v) => Boolean(v)), destination = [actual.destinationId, ...(actual.destinationLocationIds ?? [])].filter((v) => Boolean(v));
                    if (origin.length && !origin.includes(input.from) && !origin.includes(input.hubId ?? input.from))
                        railInvalid = 'Origine de correspondance incompatible';
                    else if (destination.length && !destination.includes(input.to))
                        railInvalid = 'Destination de correspondance incompatible';
                    else if (input.kind === 'waste' && !(actual.cargoTypes ?? []).includes(input.referenceId) && !(actual.compatibleKinds ?? []).includes('waste'))
                        railInvalid = 'Déchets: train réel sans wagon/conteneur déclaré compatible';
                    else if (actual.status !== 'scheduled')
                        railInvalid = 'Départ ferroviaire réel déjà passé';
                    else if (!actual.eligible || !Number.isFinite(actual.capacityKg) || actual.capacityKg <= 0)
                        railInvalid = 'Offre ferroviaire réelle inéligible';
                    input = { ...input, rail: { serviceId: actual.serviceId, eligible: actual.eligible, capacityKg: actual.capacityKg, departure: actual.departure, arrival: actual.arrival } };
                }
            }
            const selected = input.rail ?? offered;
            if (!railInvalid && selected.capacityKg - this.reservedRailWeight(selected.serviceId) < r.unitKg * input.quantity)
                railInvalid = 'Capacité ferroviaire déjà réservée insuffisante';
            if (railInvalid && !simple)
                throw new Error(railInvalid);
            if (railInvalid)
                input = { ...input, rail: { ...selected, eligible: false } };
        }
        const service = input.service ?? 'standard';
        const preferred = input.carrierId ?? (input.cold ? 'cold' : service === 'express' ? 'express' : input.kind === 'waste' ? 'heavy' : 'regional');
        const carrier = this.carrier(preferred);
        const choice = this.compareCarriers(input.referenceId, input.quantity, input.distanceKm).find(x => x.carrierId === preferred);
        if (!choice)
            throw new Error('Transporteur hors couverture');
        const id = this.id('flow');
        const capacityNeeded = Math.ceil(Math.max(input.quantity * r.unitKg / carrier.capacityKg, input.quantity * r.unitM3 / carrier.capacityM3));
        if (!choice.available && !simple)
            throw new Error('Capacité transporteur insuffisante pour cohorte');
        if (!choice.available && simple)
            this.rescue('truck', id, capacityNeeded, choice.cost * .2, 'Transport cohortes: moyens supplémentaires');
        const hub = input.hubId ?? input.from;
        const stages = [];
        const stage = (status, at, locationId) => { stages.push({ status, at, locationId }); };
        let t = this.epochMs + HOUR / 4;
        if (input.kind === 'automobile')
            stage('factory-compound', t, input.from);
        if (input.kind === 'ship' || input.kind === 'air') {
            t = Math.max(t, input.externalArrival ?? this.epochMs + 6 * HOUR);
            stage(input.kind === 'ship' ? 'ship-wave' : 'air-flight', t, input.from);
        }
        stage('collected', t, input.from);
        t += Math.max(HOUR / 4, choice.travelMs * .4);
        stage('arrived-hub', t, hub);
        const hubLocation = this.location(hub);
        let sorted = this.nextWave(t, hubLocation.waveHours ?? [6, 10, 14, 18, 22]);
        const cutoffMissed = Boolean(input.rail && sorted > input.rail.departure - HOUR / 4);
        if (hubLocation.closed) {
            if (simple)
                this.rescue('dock', id, input.quantity, choice.cost * .1 + 50, 'Hub fermé: tri partenaire');
            else
                sorted += DAY;
        }
        stage('sorted', sorted, hub);
        t = sorted;
        let railKm = 0, reprotection;
        if (input.rail) {
            const rail = input.rail;
            const realMissed = bound && rail.departure < t + HOUR / 4;
            const permitted = rail.eligible && rail.capacityKg - this.reservedRailWeight(rail.serviceId) >= r.unitKg * input.quantity && !realMissed;
            if (!permitted) {
                if (!simple)
                    throw new Error(realMissed ? 'Correspondance ferroviaire réelle manquée' : 'Offre/matériel ferroviaire inéligible ou capacité insuffisante');
                reprotection = realMissed ? 'Routage routier de secours: départ réel manqué' : railInvalid || 'Routage routier de secours: rail inéligible';
                this.rescue('road', id, input.quantity, choice.cost * .5 + 100, reprotection);
            }
            else {
                let departure = rail.departure, arrival = rail.arrival;
                if (departure < t + HOUR / 4) {
                    departure += DAY * Math.ceil((t + HOUR / 4 - departure) / DAY);
                    arrival += departure - rail.departure;
                    reprotection = 'Reprotection sur vague ferroviaire suivante';
                    if (simple && arrival > input.deadline) {
                        reprotection = 'Route express pour garantir le service';
                        this.rescue('road', id, input.quantity, choice.cost * .5 + 100, reprotection);
                        departure = t + HOUR / 4;
                        arrival = departure + choice.travelMs * .5;
                    }
                }
                stage('loaded-train', departure, hub);
                stage('arrived-terminal', Math.max(departure, arrival), input.to);
                t = Math.max(departure, arrival);
                railKm = input.distanceKm * .8;
            }
        }
        if (!stages.some(x => x.status === 'arrived-terminal')) {
            t += Math.max(HOUR / 4, choice.travelMs * .4);
            stage('arrived-terminal', t, input.to);
        }
        if (input.kind === 'automobile')
            stage('destination-park', t + HOUR / 4, input.to);
        if (input.kind === 'waste') {
            stage('treatment', t + HOUR, input.to);
            t += HOUR;
        }
        if (input.kind === 'ecommerce-return') {
            stage('return-inspected', t + HOUR / 2, input.to);
            t += HOUR / 2;
        }
        if (input.kind === 'construction') {
            t = Math.max(t, input.needAt ?? t);
            stage('worksite-unload', t + HOUR / 2, input.to);
            t += HOUR / 2;
        }
        stage('out-for-delivery', t + HOUR / 4, input.to);
        stage('delivered', t + Math.max(HOUR / 2, choice.travelMs * .2), input.to);
        stages.sort((a, b) => a.at - b.at);
        const documents = [...(input.documents ?? [])];
        if (input.kind === 'waste')
            documents.push(`Bordereau traitement ${id}`, `Conteneur adapté ${carrier.vehicleClass}`, `Site destination ${input.to}`);
        if (input.kind === 'automobile')
            documents.push(`Contrôle dommage compound ${id}`);
        if (input.kind === 'construction')
            documents.push(`Campagne ${input.campaignId ?? id}, besoin ${new Date(input.needAt ?? input.deadline).toISOString()}`);
        this.requireCommandCost(id, choice.cost, `Flux ${input.kind}`, false, simple, { supplyId: id });
        const f = { ...clone(input), id, carrierId: preferred, service, status: 'active', stages, stageIndex: 0, scans: [{ status: 'scheduled', at: this.epochMs, locationId: input.from }], createdAt: this.epochMs, temperature: input.cold ? (input.cold.min + input.cold.max) / 2 : 20, outsideColdMs: 0, lastTemperatureAt: this.epochMs, quality: 'good', cost: choice.cost, railKm, missedCutoff: cutoffMissed, ...(reprotection ? { reprotection } : {}), quantityDelivered: 0, damageQuantity: input.kind === 'automobile' && this.random() > .98 ? Math.ceil(input.quantity * .01) : 0, documents, packagingCount: Math.ceil(input.quantity / r.packSize), performanceBonus: 0 };
        if (input.rail && stages.some(stage => stage.status === 'loaded-train')) {
            f.railBound = bound;
            f.railReservation = { id: `rail:${id}`, serviceId: input.rail.serviceId, weightKg: r.unitKg * input.quantity, status: 'reserved' };
        }
        this.flows.push(f);
        this.event('flow-created', id, `${input.quantity} ${input.referenceId}: ${input.kind}`, { stages: stages.length, service });
        return f;
    }
    rerouteFlow(flowId, destinationId, distanceKm = 50, simple = false) {
        const f = this.flows.find(x => x.id === flowId);
        if (!f || f.status === 'delivered')
            throw new Error('Cohorte absente ou déjà livrée');
        this.location(destinationId);
        if (!Number.isFinite(distanceKm) || distanceKm < 0)
            throw new Error('Distance invalide');
        const c = this.compareCarriers(f.referenceId, f.quantity, distanceKm, 'FR', f.id).find(x => x.carrierId === f.carrierId) ?? this.compareCarriers(f.referenceId, f.quantity, distanceKm, 'FR', f.id)[0];
        if (!c || !c.available && !simple)
            throw new Error('Pas de capacité pour la déviation');
        this.requireFinancedSource(f.id, simple);
        this.requireCommandCost(this.id('reroute'), c.cost, 'Déviation de cohorte', false, simple, { supplyId: f.id });
        const railActual = f.railReservation ? this.host?.getRailService?.(f.railReservation.serviceId) : null;
        const railDeparted = f.railReservation?.departedAt !== undefined || railActual?.status === 'departed' || railActual?.status === 'arrived';
        const physicalRailArrival = f.railReservation?.status === 'loaded' && (!f.railBound || railDeparted) ? f.stages.slice(f.stageIndex).find(x => x.status === 'arrived-terminal') : undefined;
        const pendingRail = physicalRailArrival?.at ?? (f.scans.some(x => x.status === 'loaded-train') && !f.scans.some(x => x.status === 'arrived-terminal') ? f.stages.find(x => x.status === 'arrived-terminal')?.at ?? this.epochMs : this.epochMs);
        if (f.railReservation && (f.railReservation.status === 'reserved' || f.railReservation.status === 'loaded' && f.railBound && !railDeparted)) {
            f.railReservation.status = 'released';
            f.railReservation.releasedAt = this.epochMs;
            f.railKm = 0;
        }
        delete f.railWaiting;
        const start = Math.max(this.epochMs, pendingRail), eta = start + c.travelMs;
        f.stages.splice(f.stageIndex);
        if (physicalRailArrival)
            f.stages.push(clone(physicalRailArrival));
        f.stages.push({ status: 'arrived-terminal', at: eta, locationId: destinationId }, { status: 'out-for-delivery', at: eta + HOUR / 4, locationId: destinationId }, { status: 'delivered', at: eta + HOUR / 2, locationId: destinationId });
        f.to = destinationId;
        f.status = 'active';
        f.reprotection = `Déviation via ${destinationId}`;
        f.distanceKm += distanceKm;
        f.cost += c.cost;
        if (!c.available && simple)
            this.rescue('road', f.id, f.quantity, c.cost * .2 + 50, 'Déviation: moyen routier de secours');
        this.event('flow-rerouted', f.id, f.reprotection, { destinationId, distanceKm, eta, quantity: f.quantity });
        return f;
    }
    nextWave(at, hours) { const waves = hours.filter(h => h >= 0 && h < 24).sort((a, b) => a - b); if (!waves.length)
        return at; const day = Math.floor(at / DAY) * DAY; for (const h of waves)
        if (day + h * HOUR >= at)
            return day + h * HOUR; return day + DAY + waves[0] * HOUR; }
    setFlowTemperature(flowId, temperature) { const f = this.flows.find(x => x.id === flowId); if (!f || !Number.isFinite(temperature))
        throw new Error('Cohorte ou température invalide'); this.updateCold(f, this.epochMs, false); f.temperature = temperature; this.event('temperature-change', f.id, `${temperature} °C`); }
    updateCold(f, at, simple) { if (!f.cold || f.status === 'delivered') {
        f.lastTemperatureAt = at;
        return;
    } const delta = Math.max(0, at - f.lastTemperatureAt); if (f.temperature < f.cold.min || f.temperature > f.cold.max)
        f.outsideColdMs += delta; f.lastTemperatureAt = at; if (f.outsideColdMs > f.cold.maxOutsideMs && f.quality === 'good') {
        f.quality = simple ? 'replaced' : 'spoiled';
        this.event('cold-break', f.id, `Rupture froid: ${Math.round(f.outsideColdMs / 60000)} min hors ${f.cold.min}–${f.cold.max} °C`, { temperature: f.temperature, outsideMs: f.outsideColdMs });
        if (simple) {
            this.rescue('replacement', f.id, f.quantity, f.quantity * this.reference(f.referenceId).unitPrice, 'Cohorte froide remplacée');
            f.temperature = (f.cold.min + f.cold.max) / 2;
        }
    } }
    replaceFlow(flowId, simple = false) { const f = this.flows.find(x => x.id === flowId); if (!f || f.quality !== 'spoiled')
        throw new Error('Aucune cohorte dégradée à remplacer'); const cost = f.quantity * this.reference(f.referenceId).unitPrice; this.cost(this.id('replacement'), cost, 'Remplacement cohorte froide', simple, { supplyId: f.id }); if (simple)
        this.rescue('replacement', f.id, f.quantity, cost, 'Remplacement froid'); f.quality = 'replaced'; if (f.cold)
        f.temperature = (f.cold.min + f.cold.max) / 2; f.status = 'active'; this.event('cold-replaced', f.id, 'Lot conforme substitué'); }
    /** Preserve one physical cohort during a customs hold; postpone only its unperformed legs. */
    setFlowHold(flowId, until, reason = '') { const f = this.flows.find(x => x.id === flowId); if (!f || f.status === 'delivered')
        return false; const held = Boolean(f.holdUntil); if (until > 0) {
        f.holdUntil = until;
        f.holdReason = reason;
        const next = f.stages[f.stageIndex];
        if (next && next.at < until) {
            const shift = until - next.at;
            for (let i = f.stageIndex; i < f.stages.length; i++)
                f.stages[i].at += shift;
        }
        f.status = 'held';
        if (!held)
            this.event('flow-hold', f.id, reason || 'Cohorte retenue');
    }
    else if (held) {
        const next = f.stages[f.stageIndex];
        if (next && next.at < this.epochMs) {
            const shift = this.epochMs - next.at;
            for (let i = f.stageIndex; i < f.stages.length; i++)
                f.stages[i].at += shift;
        }
        delete f.holdUntil;
        delete f.holdReason;
        f.status = 'active';
        this.event('flow-release', f.id, 'Cohorte libérée; acheminement repris sans nouvelle quantité');
    } return true; }
    shiftFlowStages(f, at) { const stage = f.stages[f.stageIndex]; if (stage && at > stage.at) {
        const delay = at - stage.at;
        for (let i = f.stageIndex; i < f.stages.length; i++)
            f.stages[i].at += delay;
    } }
    railStageReady(f, stage) {
        if (!f.railReservation || !f.railBound || f.railReservation.status === 'released')
            return true;
        if (stage.status !== 'loaded-train' && stage.status !== 'arrived-terminal')
            return true;
        const actual = this.host?.getRailService?.(f.railReservation.serviceId);
        if (!actual || !actual.eligible || actual.status === 'cancelled') {
            f.railWaiting = true;
            return false;
        }
        const departure = stage.status === 'loaded-train';
        if (departure) {
            if (f.railWaiting)
                this.shiftFlowStages(f, this.epochMs);
            if (actual.capacityKg + 1e-6 < this.reservedRailWeight(actual.serviceId)) {
                f.railWaiting = true;
                return false;
            }
            const sorted = f.scans.find(s => s.status === 'sorted')?.at ?? Infinity;
            if (Number.isFinite(actual.actualDepartureAt) && actual.actualDepartureAt < Math.max(sorted + HOUR / 4, stage.at)) {
                f.railWaiting = true;
                return false;
            }
        }
        else if (actual.status !== 'arrived') {
            f.railWaiting = true;
            return false;
        }
        const destination = [actual.destinationId, ...(actual.destinationLocationIds ?? [])].filter((v) => Boolean(v));
        if (!departure && destination.length && !destination.includes(stage.locationId)) {
            f.railWaiting = true;
            return false;
        }
        const physicalAt = departure ? stage.at : actual.actualArrivalAt;
        const at = Number.isFinite(physicalAt) ? physicalAt : this.epochMs;
        this.shiftFlowStages(f, Math.max(stage.at, at));
        if (stage.at > this.epochMs) {
            delete f.railWaiting;
            return false;
        }
        delete f.railWaiting;
        return true;
    }
    recoverBlockedRail(f, simple) { if (!simple || !this.delegatedRoad || !f.railBound || !f.railReservation || f.railReservation.status === 'released')
        return; const actual = this.host?.getRailService?.(f.railReservation.serviceId); const departed = f.railReservation.departedAt !== undefined || actual?.status === 'departed' || actual?.status === 'arrived'; if (departed)
        return; if (actual && actual.status !== 'cancelled' && actual.eligible && actual.capacityKg >= this.reservedRailWeight(actual.serviceId))
        return; this.rerouteFlow(f.id, f.to, Math.max(10, f.distanceKm), true); this.rescue('road', f.id, f.quantity, Math.max(100, f.cost * .2), 'Train réel indisponible: cohorte routière de secours'); }
    observeRailDeparture(f) { const reservation = f.railReservation; if (!f.railBound || reservation?.status !== 'loaded' || reservation.departedAt !== undefined)
        return; const actual = this.host?.getRailService?.(reservation.serviceId); if (!actual || actual.status === 'scheduled' || actual.status === 'cancelled')
        return; const at = Number.isFinite(actual.actualDepartureAt) ? actual.actualDepartureAt : this.epochMs; if (at > this.epochMs)
        return; reservation.departedAt = Math.max(reservation.loadedAt ?? at, at); const scan = { status: 'rail-departed', at: reservation.departedAt, locationId: f.hubId ?? f.from }; f.scans.push(scan); this.event('flow-scan', f.id, `rail-departed — ${scan.locationId}`, { serviceId: reservation.serviceId, quantity: f.quantity, at: scan.at }, scan.at); }
    processFlow(f, simple) {
        if (!simple && this.paymentHolds.has(f.id))
            return;
        this.observeRailDeparture(f);
        this.updateCold(f, this.epochMs, simple);
        if (f.holdUntil && !simple)
            return;
        if (simple && f.holdUntil)
            this.setFlowHold(f.id, 0);
        if (simple && f.quality === 'spoiled')
            this.replaceFlow(f.id, true);
        while (f.stageIndex < f.stages.length && f.stages[f.stageIndex].at <= this.epochMs) {
            const stage = f.stages[f.stageIndex];
            if (!this.railStageReady(f, stage)) {
                this.recoverBlockedRail(f, simple);
                break;
            }
            if (f.railReservation && stage.status === 'loaded-train') {
                f.railReservation.status = 'loaded';
                f.railReservation.loadedAt = stage.at;
                this.observeRailDeparture(f);
            }
            if (f.railReservation && stage.status === 'arrived-terminal' && f.railReservation.status === 'loaded') {
                f.railReservation.status = 'released';
                f.railReservation.releasedAt = stage.at;
            }
            if (stage.status === 'delivered' && f.quality === 'spoiled') {
                f.status = 'held';
                break;
            }
            f.scans.push(clone(stage));
            f.stageIndex++;
            this.event('flow-scan', f.id, `${stage.status} — ${stage.locationId}`, { quantity: f.quantity, at: stage.at }, stage.at);
            if (stage.status === 'delivered') {
                f.status = 'delivered';
                f.quantityDelivered = simple ? f.quantity : f.quantity - f.damageQuantity;
                f.performanceBonus = (f.service === 'J+1' || f.service === 'express') && stage.at <= f.deadline ? f.cost * .1 : 0;
                if (f.performanceBonus)
                    this.cost(this.id('service-bonus'), -f.performanceBonus, 'Prime ponctualité express', simple, { supplyId: f.id });
                if (simple && f.damageQuantity)
                    this.rescue('replacement', f.id, f.damageQuantity, f.damageQuantity * this.reference(f.referenceId).unitPrice, 'Dommage automobile compensé');
                const ref = this.reference(f.referenceId);
                const lot = { id: this.id('lot'), batchId: this.id('flow-batch'), referenceId: f.referenceId, locationId: f.to, supplierId: f.carrierId ?? 'flow', orderId: f.id, quantity: f.quantityDelivered, receivedAt: stage.at, expiresAt: ref.shelfLifeMs ? stage.at + ref.shelfLifeMs : null, quality: 'good', usedBy: [] };
                this.lots.push(lot);
                if (!f.campaignId?.startsWith('packaging:'))
                    this.deliveries.push({ delivery: { eventId: `delivery:${f.id}`, locationId: f.to, referenceId: f.referenceId, quantity: f.quantityDelivered, lotId: lot.id, source: f.kind === 'construction' ? 'works' : f.kind === 'ecommerce-return' ? 'return' : 'industrial', at: stage.at }, sent: false });
                else {
                    lot.quantity = 0;
                    const p = this.packaging.find(x => `packaging:${x.id}` === f.campaignId);
                    if (p) {
                        p.status = 'returned';
                        this.cost(this.id('deposit-return'), -p.quantity * p.deposit, 'Retour consigne emballages', false, { supplyId: f.id });
                    }
                }
                this.event('flow-delivered', f.id, `${f.quantityDelivered} livrés`, { at: stage.at, quantity: f.quantityDelivered, difference: f.quantity - f.quantityDelivered, bonus: f.performanceBonus }, stage.at);
                this.allocateReservations();
            }
        }
    }
    dispatchReady(simple) {
        if (this.delegatedRoad)
            for (const o of this.orders)
                if (o.status === 'ready') {
                    const choices = this.compareCarriers(o.referenceId, o.quantity - o.deliveredQuantity, 50);
                    let carrier = choices.find(c => c.available)?.carrierId;
                    if (simple)
                        carrier = this.reference(o.referenceId).family === 'catering' ? 'cold' : this.reference(o.referenceId).family === 'fuel' ? 'tank' : 'regional';
                    if (carrier)
                        try {
                            this.planPickup(o.id, { carrierId: carrier, distanceKm: 50, pickupAt: o.readyAt }, simple);
                        }
                        catch (error) {
                            if (!(error instanceof LogisticsFundingError))
                                throw error;
                        }
                }
    }
    /** Idempotent monotonic epoch advancement, including off-page and save/reload catch-up. */
    advance(epochMs, simple) {
        if (!Number.isFinite(epochMs) || epochMs < 0)
            return;
        this.simpleMode = simple;
        if (epochMs <= this.epochMs)
            return;
        this.flushEffects();
        if (!this.epochMs) {
            this.epochMs = epochMs;
            return;
        }
        const end = epochMs;
        for (const flow of this.flows) {
            if (flow.railWaiting && flow.stages[flow.stageIndex]?.status === 'loaded-train')
                this.shiftFlowStages(flow, this.epochMs);
            delete flow.railWaiting;
        }
        this.registerRuntimeLocations(this.host?.listLocations?.() ?? []);
        this.supply(simple);
        for (const o of this.orders)
            if (o.status === 'backorder' && (this.supplier(o.supplierId).available || simple)) {
                if (o.deliveredQuantity > 0 && this.shipments.some(s => s.orderId === o.id && s.quantityMissing === 0 && s.damagedQuantity === 0 && !s.wrongReference))
                    continue;
                const r = this.reference(o.referenceId), s = this.supplier(o.supplierId);
                o.readyAt = this.calendarReady(s, this.epochMs + s.prepareMs, simple);
                o.status = 'preparing';
                o.qualityRoll = this.random();
                o.history.push({ at: this.epochMs, status: 'preparing', message: `Reliquat ${o.quantity - o.deliveredQuantity} remis en préparation` });
                if (!s.available && simple)
                    this.rescue('supplier', o.id, o.quantity - o.deliveredQuantity, r.unitPrice * (o.quantity - o.deliveredQuantity) * .15, 'Reliquat fournisseur de secours');
            }
        this.dispatchReady(simple);
        for (let count = 0; count < 100000; count++) {
            // Reduce in the same order instead of spreading a growing event array onto
            // the call stack. Every event still participates in the exact same minimum.
            let next = Infinity;
            for (const o of this.orders)
                if (o.status === 'preparing')
                    next = Math.min(next, Math.max(this.epochMs, o.readyAt));
            for (const s of this.shipments) {
                if (s.status === 'planned')
                    next = Math.min(next, Math.max(this.epochMs, s.pickupAt));
                else if (s.status === 'collected')
                    next = Math.min(next, Math.max(this.epochMs, s.eta));
                else if (s.status === 'reception')
                    next = Math.min(next, Math.max(this.epochMs, s.unloadAt));
                else if (s.status === 'quality' && simple)
                    next = Math.min(next, this.epochMs);
            }
            for (const f of this.flows)
                if (f.status === 'active' && !f.railWaiting && (simple || !this.paymentHolds.has(f.id)) && f.stageIndex < f.stages.length)
                    next = Math.min(next, Math.max(this.epochMs, f.stages[f.stageIndex].at));
            for (const l of this.lots)
                if (l.quality === 'good' && l.quantity > 0 && l.expiresAt !== null)
                    next = Math.min(next, Math.max(this.epochMs, l.expiresAt));
            if (next > end)
                break;
            this.epochMs = next;
            for (const o of this.orders)
                if (o.status === 'preparing' && o.readyAt <= next) {
                    o.status = 'ready';
                    o.history.push({ at: next, status: 'ready', message: 'Commande préparée, pickup possible' });
                    this.event('supplier-ready', o.id, 'Marchandise prête');
                }
            this.dispatchReady(simple);
            for (const s of this.shipments) {
                const o = s.orderId ? this.orders.find(o => o.id === s.orderId) : undefined;
                if (s.status === 'planned' && s.pickupAt <= next) {
                    s.status = 'collected';
                    s.scans.push({ at: s.pickupAt, status: 'collected' });
                    this.event('truck-collected', s.id, 'Lot collecté');
                }
                if (s.status === 'collected' && s.eta <= next) {
                    s.status = 'reception';
                    if (o)
                        o.status = 'reception';
                    s.scans.push({ at: s.eta, status: 'arrived-terminal' });
                    this.event('terminal-arrived', s.id, 'Lot arrivé, en file de quai');
                }
                if (s.status === 'reception' && s.unloadAt <= next) {
                    s.status = 'quality';
                    if (o)
                        o.status = 'quality';
                    s.scans.push({ at: s.unloadAt, status: 'unloaded' });
                    this.event('reception-unloaded', s.id, 'Déchargement terminé: contrôle réception');
                }
                if (s.status === 'quality' && simple)
                    this.receiveShipment(s.id, {}, true);
            }
            for (const f of this.flows)
                if (f.status !== 'delivered')
                    this.processFlow(f, simple);
            for (const l of this.lots)
                if (l.quality === 'good' && l.quantity > 0 && l.expiresAt !== null && l.expiresAt <= next) {
                    this.excludeLot(l, 'expired');
                    l.quality = 'expired';
                    this.event('stock-expired', l.id, 'Lot périmé retiré du disponible', { quantity: l.quantity });
                    if (simple)
                        this.requestPurchase({ locationId: l.locationId, referenceId: l.referenceId, quantity: l.quantity, needAt: next + HOUR, urgency: 4, source: 'forecast', sourceId: `expiry:${l.id}` });
                }
            this.allocateReservations();
        }
        this.epochMs = end;
        for (const f of this.flows)
            if (f.status !== 'delivered')
                this.processFlow(f, simple);
        const day = Math.floor(end / DAY);
        if (day > this.lastInventoryDay) {
            this.lastInventoryDay = day;
            for (const p of this.stockPolicies)
                this.inventory(p.locationId, p.referenceId, undefined, simple);
        }
        this.supply(simple);
        this.flushEffects();
    }
    supplierScore(supplierId) { const list = this.orders.filter(o => o.supplierId === supplierId && o.deliveredQuantity > 0), deliveries = this.shipments.filter(s => s.supplierId === supplierId && s.proof); const onTime = list.filter(o => (o.history.find(h => h.status === 'delivered')?.at ?? Infinity) <= (this.demands.find(d => d.id === o.demandId)?.needAt ?? 0)).length; const disputes = deliveries.filter(s => s.proof.difference > 0).length; return { supplierId, onTime: list.length ? onTime / list.length : 1, quality: deliveries.length ? 1 - deliveries.reduce((sum, s) => sum + s.proof.difference, 0) / Math.max(1, deliveries.reduce((sum, s) => sum + s.quantity, 0)) : 1, disputeRate: deliveries.length ? disputes / deliveries.length : 0, averageUnitPrice: list.length ? list.reduce((sum, o) => sum + o.unitPrice, 0) / list.length : 0, flexibility: list.length ? list.filter(o => o.urgent).length / list.length : 0, sample: list.length }; }
    getRisks() { const out = []; for (const p of this.stockPolicies) {
        const available = this.availableStock(p.locationId, p.referenceId);
        if (available < p.minimum)
            out.push({ kind: 'stock', locationId: p.locationId, referenceId: p.referenceId, message: `Stock ${available} sous minimum ${p.minimum}`, severity: available === 0 ? 3 : 2 });
        const suppliers = this.suppliers.filter(s => s.available && (s.referenceIds.includes('*') || s.referenceIds.includes(p.referenceId)));
        if (suppliers.length < 2)
            out.push({ kind: 'dependency', locationId: p.locationId, referenceId: p.referenceId, message: 'Dépendance fournisseur unique', severity: 2 });
    } for (const c of this.contracts)
        if (c.purchased < c.minimumVolume)
            out.push({ kind: 'contract-minimum', locationId: '', referenceId: c.referenceId, message: `Contrat ${c.id}: volume engagé restant ${c.minimumVolume - c.purchased}`, severity: 1 }); for (const o of this.orders) {
        if (o.status === 'backorder')
            out.push({ kind: 'backorder', locationId: o.locationId, referenceId: o.referenceId, message: `Reliquat ${o.quantity - o.deliveredQuantity}; pas de livraison disponible`, severity: 3 });
        if (['delivered', 'returned'].includes(o.status) || o.deliveredQuantity >= o.quantity)
            continue;
        const demand = this.demands.find(d => d.id === o.demandId), backup = demand && this.compareOffers(demand.id, false).some(offer => offer.supplierId !== o.supplierId && offer.available && offer.readyAt <= demand.needAt);
        if (!backup)
            out.push({ kind: 'no-backup', locationId: o.locationId, referenceId: this.stockReference(o), message: `Commande ${o.id}: aucun fournisseur de secours compatible disponible avant le besoin`, severity: 3 });
    } for (const s of this.shipments)
        if (s.missedCutoff && !s.selectedAlternative)
            out.push({ kind: 'cutoff', locationId: s.to, referenceId: s.referenceId, message: 'Cut-off manqué sans alternative sélectionnée', severity: 3 }); return out; }
    whatIf(input) { const list = this.orders.filter(o => !['delivered', 'returned'].includes(o.status) && (!input.supplierId || o.supplierId === input.supplierId)); return { affectedOrders: list.map(o => o.id), extraCost: list.reduce((sum, o) => sum + o.total * clamp(input.priceIncreasePct ?? 0, -50, 200) / 100, 0), delayedQuantity: input.supplierDown ? list.reduce((sum, o) => sum + o.quantity - o.deliveredQuantity, 0) : this.shipments.filter(s => s.to === input.closedHubId && !['delivered', 'returned'].includes(s.status)).reduce((sum, s) => sum + s.quantity, 0), risks: [...(input.supplierDown ? ['Fournisseur indisponible: comparer un second sourcing ou un transfert inter-dépôts.'] : []), ...(input.closedHubId ? [`Hub ${input.closedHubId} fermé: rediriger les pickups ou activer quai de secours.`] : [])] }; }
    getKpis() { const delivered = this.orders.filter(o => o.status === 'delivered'); const otif = delivered.filter(o => { const demand = this.demands.find(d => d.id === o.demandId); return o.deliveredQuantity >= o.quantity && (o.history.find(h => h.status === 'delivered')?.at ?? Infinity) <= (demand?.needAt ?? Infinity); }).length; const road = this.shipments.reduce((sum, s) => sum + s.distanceKm, 0) + this.flows.reduce((sum, f) => sum + Math.max(0, f.distanceKm - f.railKm), 0); const rail = this.flows.reduce((sum, f) => sum + f.railKm, 0); const tonnes = (this.shipments.reduce((sum, s) => sum + s.weightKg, 0) + this.flows.reduce((sum, f) => sum + f.quantity * this.reference(f.referenceId).unitKg, 0)) / 1000; const transportCost = this.shipments.reduce((sum, s) => sum + s.cost, 0) + this.flows.reduce((sum, f) => sum + f.cost, 0); const shipments = this.shipments.filter(s => s.status === 'delivered'); const doneFlows = this.flows.filter(f => f.status === 'delivered'); return { otif: delivered.length ? otif / delivered.length : 1, stockDays: this.stockPolicies.length ? this.stockPolicies.reduce((sum, p) => sum + this.availableStock(p.locationId, p.referenceId) / Math.max(1, p.dailyUse), 0) / this.stockPolicies.length : 0, transportCost, stockoutRate: this.stockPolicies.length ? this.stockPolicies.filter(p => this.availableStock(p.locationId, p.referenceId) === 0).length / this.stockPolicies.length : 0, urgentOrders: this.orders.filter(o => o.urgent).length, immobilizations: this.reservations.filter(r => r.status === 'pending').length, missedCutoffRate: this.shipments.length ? this.shipments.filter(s => s.missedCutoff).length / this.shipments.length : 0, roadCostPerTonne: tonnes ? transportCost / tonnes : 0, terminalPunctuality: shipments.length ? shipments.filter(s => !s.missedCutoff).length / shipments.length : 1, railShare: road + rail ? rail / (road + rail) : 0, deliveredOrders: delivered.length, flowOnTime: doneFlows.length ? doneFlows.filter(f => (f.scans.find(s => s.status === 'delivered')?.at ?? Infinity) <= f.deadline).length / doneFlows.length : 1 }; }
    mapFlows() { return [...this.shipments.filter(s => !['delivered', 'returned'].includes(s.status)).map(s => ({ id: s.id, from: s.from, to: s.to, status: s.status, quantity: s.quantity, eta: s.eta })), ...this.flows.filter(f => f.status !== 'delivered').map(f => ({ id: f.id, from: f.from, to: f.to, status: f.status, quantity: f.quantity, eta: f.stages[f.stages.length - 1].at }))].slice(0, 100).map(f => { const from = this.locations.find(l => l.id === f.from), to = this.locations.find(l => l.id === f.to); return { ...f, fromLat: from?.latitude, fromLon: from?.longitude, toLat: to?.latitude, toLon: to?.longitude }; }); }
    toSave() { return clone({ schemaVersion: 1, epochMs: this.epochMs, sequence: this.sequence, rngState: this.rngState, delegatedSupply: this.delegatedSupply, delegatedRoad: this.delegatedRoad, supplyChoice: this.supplyChoice, roadChoice: this.roadChoice, simpleMode: this.simpleMode, references: this.references, suppliers: this.suppliers, carriers: this.carriers, locations: this.locations, demands: this.demands, contracts: this.contracts, orders: this.orders, shipments: this.shipments, consolidationGroups: this.consolidationGroups, lots: this.lots, reservations: this.reservations, stockPolicies: this.stockPolicies, rescueResources: this.rescueResources, packaging: this.packaging, flows: this.flows, inventoryControls: this.inventoryControls, events: this.events, exclusions: this.exclusions, deliveries: this.deliveries, costs: this.costs, consumptions: this.consumptions, lastInventoryDay: this.lastInventoryDay, importedStockKeys: this.importedStockKeys, externalUseKeys: this.externalUseKeys, mileageSamples: this.mileageSamples, mileageDays: this.mileageDays }); }
    loadFromSave(value) {
        const d = rec(value);
        if (d.schemaVersion !== 1) {
            return;
        }
        this.epochMs = Math.max(0, finite(d.epochMs));
        this.sequence = Math.max(0, Math.floor(finite(d.sequence)));
        this.rngState = (finite(d.rngState, 44) >>> 0) || 44;
        this.simpleMode = bool(d.simpleMode);
        this.supplyChoice = Object.hasOwn(d, 'supplyChoice') ? (typeof d.supplyChoice === 'boolean' ? d.supplyChoice : null) : (typeof d.delegatedSupply === 'boolean' ? d.delegatedSupply : null);
        this.roadChoice = Object.hasOwn(d, 'roadChoice') ? (typeof d.roadChoice === 'boolean' ? d.roadChoice : null) : (typeof d.delegatedRoad === 'boolean' ? d.delegatedRoad : null);
        const replace = (target, list) => { target.splice(0, target.length); for (const item of list)
            target.push(item); };
        const arrayStrings = (v) => Array.isArray(v) && v.every(x => typeof x === 'string');
        const quantity = (x) => hasId(x) && typeof x.quantity === 'number' && Number.isFinite(x.quantity) && x.quantity >= 0;
        const refs = savedArray(d.references, x => hasId(x) && typeof x.unitPrice === 'number' && finite(x.unitKg, -1) >= 0 && finite(x.unitM3, -1) >= 0 && finite(x.moq) > 0 && finite(x.packSize) > 0 && arrayStrings(x.compatibleIds));
        if (refs.length)
            replace(this.references, refs);
        const suppliers = savedArray(d.suppliers, x => hasId(x) && arrayStrings(x.referenceIds) && Array.isArray(x.weekdays) && finite(x.capacityPerDay) > 0 && finite(x.prepareMs, -1) >= 0);
        if (suppliers.length)
            replace(this.suppliers, suppliers);
        const carriers = savedArray(d.carriers, x => hasId(x) && arrayStrings(x.families) && arrayStrings(x.countries) && finite(x.capacityKg) > 0 && finite(x.capacityM3) > 0 && finite(x.speedKmh) > 0);
        if (carriers.length)
            replace(this.carriers, carriers);
        const referenceIds = new Set(this.references.map(r => r.id)), supplierIds = new Set(this.suppliers.map(s => s.id)), carrierIds = new Set(this.carriers.map(c => c.id));
        replace(this.locations, savedArray(d.locations, x => hasId(x) && typeof x.name === 'string' && ['depot', 'hub', 'terminal', 'factory', 'client', 'port', 'airport', 'treatment', 'worksite'].includes(str(x.kind))));
        const locationIds = new Set(this.locations.map(l => l.id));
        const refLocation = (x) => referenceIds.has(str(x.referenceId)) && locationIds.has(str(x.locationId));
        replace(this.demands, savedArray(d.demands, x => quantity(x) && refLocation(x) && Array.isArray(x.orderIds) && typeof x.needAt === 'number'));
        replace(this.contracts, savedArray(d.contracts, x => hasId(x) && referenceIds.has(str(x.referenceId)) && supplierIds.has(str(x.supplierId))));
        replace(this.orders, savedArray(d.orders, x => quantity(x) && refLocation(x) && supplierIds.has(str(x.supplierId)) && Array.isArray(x.history) && typeof x.readyAt === 'number' && typeof x.deliveredQuantity === 'number'));
        replace(this.shipments, savedArray(d.shipments, x => quantity(x) && referenceIds.has(str(x.referenceId)) && locationIds.has(str(x.to)) && carrierIds.has(str(x.carrierId)) && Array.isArray(x.scans) && Array.isArray(x.alternatives) && typeof x.eta === 'number' && typeof x.unloadAt === 'number'));
        const shipmentIds = new Set(this.shipments.map(shipment => shipment.id));
        replace(this.consolidationGroups, savedArray(d.consolidationGroups, group => hasId(group) && Array.isArray(group.shipmentIds) && group.shipmentIds.length >= 2 && new Set(group.shipmentIds).size === group.shipmentIds.length && group.shipmentIds.every(id => typeof id === 'string' && shipmentIds.has(id)) && carrierIds.has(str(group.carrierId)) && locationIds.has(str(group.destinationId)) && finite(group.saving, -1) >= 0));
        replace(this.lots, savedArray(d.lots, x => quantity(x) && refLocation(x) && Array.isArray(x.usedBy) && typeof x.receivedAt === 'number' && ['good', 'expired', 'recalled', 'quarantine'].includes(str(x.quality))));
        replace(this.reservations, savedArray(d.reservations, x => quantity(x) && refLocation(x) && Array.isArray(x.lots) && typeof x.allocated === 'number'));
        replace(this.stockPolicies, savedArray(d.stockPolicies, x => refLocation(x) && typeof x.minimum === 'number' && typeof x.dailyUse === 'number' && typeof x.coverDays === 'number'));
        replace(this.rescueResources, savedArray(d.rescueResources, x => quantity(x) && typeof x.cost === 'number' && x.informational === true));
        replace(this.packaging, savedArray(d.packaging, x => quantity(x) && locationIds.has(str(x.locationId)) && typeof x.deposit === 'number'));
        replace(this.flows, savedArray(d.flows, x => quantity(x) && referenceIds.has(str(x.referenceId)) && locationIds.has(str(x.from)) && locationIds.has(str(x.to)) && Array.isArray(x.stages) && Array.isArray(x.scans) && Array.isArray(x.documents) && typeof x.stageIndex === 'number' && typeof x.lastTemperatureAt === 'number'));
        for (const flow of this.flows)
            if (flow.railReservation) {
                const reservation = flow.railReservation;
                reservation.weightKg = flow.quantity * this.reference(flow.referenceId).unitKg;
                if (flow.status === 'delivered')
                    reservation.status = 'released';
                if (!['reserved', 'loaded', 'released'].includes(reservation.status))
                    reservation.status = flow.scans.some(scan => scan.status === 'loaded-train') ? 'loaded' : 'reserved';
            }
        replace(this.inventoryControls, savedArray(d.inventoryControls, x => hasId(x) && refLocation(x) && typeof x.counted === 'number'));
        this.events = savedArray(d.events, x => hasId(x) && typeof x.at === 'number' && typeof x.message === 'string');
        this.deliveries = savedArray(d.deliveries, x => { const v = rec(x.delivery); return typeof x.sent === 'boolean' && typeof v.eventId === 'string' && typeof v.quantity === 'number' && referenceIds.has(str(v.referenceId)) && locationIds.has(str(v.locationId)); });
        this.exclusions = savedArray(d.exclusions, x => { const v = rec(x.exclusion); return typeof x.sent === 'boolean' && typeof v.eventId === 'string' && typeof v.quantity === 'number' && ['recall', 'expired'].includes(str(v.reason)) && referenceIds.has(str(v.referenceId)) && locationIds.has(str(v.locationId)); });
        this.costs = savedArray(d.costs, x => hasId(x) && typeof x.amount === 'number' && typeof x.sent === 'boolean');
        this.consumptions = savedArray(d.consumptions, x => typeof x.eventId === 'string' && refLocation(x) && typeof x.quantity === 'number' && typeof x.sent === 'boolean');
        this.lastInventoryDay = finite(d.lastInventoryDay, -1);
        this.importedStockKeys = Array.isArray(d.importedStockKeys) ? d.importedStockKeys.filter((x) => typeof x === 'string') : [];
        this.externalUseKeys = Array.isArray(d.externalUseKeys) ? d.externalUseKeys.filter((x) => typeof x === 'string') : [];
        this.mileageSamples = savedArray(d.mileageSamples, sample => hasId(sample) && locationIds.has(str(sample.locationId)) && finite(sample.km, -1) >= 0 && finite(sample.at, -1) >= 0);
        this.mileageDays = savedArray(d.mileageDays, row => hasId(row) && locationIds.has(str(row.locationId)) && finite(row.km, -1) >= 0 && finite(row.day, -1) >= 0 && finite(row.fromAt, -1) >= 0);
        this.recheckSavedCosts();
        this.allocateReservations();
        this.flushEffects();
    }
}
