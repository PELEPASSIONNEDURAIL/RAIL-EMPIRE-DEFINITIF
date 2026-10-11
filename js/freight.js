import { getGlobalRng } from './rng.js';
export function normalizeFreightManifest(raw, loaded) {
    if (!Array.isArray(raw))
        return null;
    const ceiling = Number(loaded);
    if (!Number.isFinite(ceiling) || ceiling <= 0)
        return null;
    const result = [];
    let room = ceiling;
    for (const line of raw.slice(0, 256)) {
        if (!isRecord(line) || typeof line.type !== 'string' || !line.type.trim() || line.type.length > 100)
            continue;
        const tonnes = Number(line.tonnes);
        if (!Number.isFinite(tonnes) || tonnes <= 0)
            continue;
        const accepted = Math.min(room, tonnes);
        if (accepted <= 0)
            break;
        result.push({ type: line.type.trim(), tonnes: accepted });
        room -= accepted;
    }
    return result.length ? result : null;
}
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
let nextContractId = 1;
export class FreightContract {
    constructor(data) {
        this.removeWhenSettled = data.removeWhenSettled === true;
        const terms = isRecord(data.qualityTerms) ? data.qualityTerms : {};
        const rate = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
        this.qualityTerms = { deadlineMs: terms.deadlineMs != null && Number.isFinite(Number(terms.deadlineMs)) ? Math.max(0, Number(terms.deadlineMs)) : null,
            latePenaltyRate: rate(terms.latePenaltyRate, .25), minimumCondition: rate(terms.minimumCondition, 0), damagePenaltyRate: rate(terms.damagePenaltyRate, .25) };
        this.loadedByService = Object.create(null);
        if (isRecord(data.loadedByService)) {
            for (const [key, qty] of Object.entries(data.loadedByService)) {
                if (Number.isFinite(Number(qty)) && Number(qty) > 0)
                    this.loadedByService[key] = Number(qty);
            }
        }
        const rawId = data?.id == null ? '' : String(data.id).trim();
        this.id = rawId || `fret-${nextContractId++}`;
        this.cargoType = typeof data?.cargoType === 'string' && data.cargoType.trim() ? data.cargoType.trim() : '';
        // FRT-01 : MLMC (diffus) = plusieurs types de wagons acceptés
        this.diffuse = data.diffuse === true;
        this.cargoTypes = [...new Set((Array.isArray(data.cargoTypes) ? data.cargoTypes : (data.cargoType ? [data.cargoType] : [])).filter((x) => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()))];
        if (!this.cargoTypes.length)
            this.cargoTypes = [this.cargoType];
        this.cargoName = typeof data.cargoName === 'string' && data.cargoName.trim() ? data.cargoName.trim() : (this.cargoType || 'Fret');
        const qty = Number(data.quantity);
        this.quantity = Number.isFinite(qty) && qty >= 0 ? qty : 0;
        const initQty = Number(data.initialQuantity);
        this.initialQuantity = Number.isFinite(initQty) && initQty > 0 ? Math.max(initQty, this.quantity) : Math.max(this.quantity, 1);
        this.unit = typeof data.unit === 'string' && data.unit.trim() ? data.unit.trim() : 't';
        this.from = data.from == null ? '' : String(data.from);
        this.fromId = data.fromId == null ? '' : String(data.fromId);
        this.to = data.to == null ? '' : String(data.to);
        this.toId = data.toId == null ? '' : String(data.toId);
        const payment = Number(data.payment);
        this.payment = Number.isFinite(payment) && payment >= 0 ? payment : 0;
        const unitPrice = Number(data.unitPrice);
        this.unitPrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : (this.initialQuantity > 0 ? this.payment / this.initialQuantity : 0);
        this.tariffSource = data.tariffSource === 'cargo-types' ? 'cargo-types' : 'quote';
        this.active = data.active !== false && this.quantity > 0;
        // Old saves may contain distance-based or "half loaded" progress.
        // Quantities, not that obsolete display value, are authoritative.
        this.industrialClientId = data.industrialClientId == null || data.industrialClientId === '' ? null : String(data.industrialClientId);
        this.industrialReceiverId = data.industrialReceiverId == null || data.industrialReceiverId === '' ? null : String(data.industrialReceiverId);
        const reserved = Number(data.industrialReservedQuantity);
        this.industrialReservedQuantity = this.industrialReceiverId && Number.isFinite(reserved)
            ? Math.max(0, Math.min(this.quantity, reserved)) : 0;
    }
    get deliveredQuantity() {
        return Math.max(0, this.initialQuantity - Math.max(0, this.quantity));
    }
    get inTransitQuantity() {
        return Math.min(Math.max(0, this.quantity), Object.values(this.loadedByService)
            .reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0));
    }
    get progress() {
        return this.initialQuantity > 0 ? Math.max(0, Math.min(1, this.deliveredQuantity / this.initialQuantity)) : 0;
    }
}
export class FreightManager {
    constructor() {
        this.contracts = [];
        this.lastGenTime = 0;
        this.freightAccessProvider = null;
        this.industrialClients = null;
    }
    _canHandleFreight(stationId) {
        const supplied = this.freightAccessProvider?.(stationId);
        const access = supplied ?? globalThis.window?.game?.stationUpgrades?.canHandleFreight?.(stationId);
        return access !== false;
    }
    /** Marchandises determines the live €/t for every known type, including
     * contracts imported from old saves. Only missing types keep their quote. */
    getContractTariffPerTonne(contract, cargoTypes = null, cargoType = contract.cargoType) {
        const info = cargoTypes?.getTypeInfo?.(cargoType);
        if (info) {
            const tariff = cargoTypes?.getTransportTariffPerTonne
                ? cargoTypes.getTransportTariffPerTonne(cargoType) : Number(info.pricePerUnit);
            return Number.isFinite(tariff) ? Math.max(0, tariff) : 0;
        }
        return Math.max(0, Number(contract.unitPrice) || 0);
    }
    _resolveManifestCargoType(contract, wagonTypes, cargoTypes) {
        const allowed = contract.cargoTypes.filter(type => typeof type === 'string' && type.trim());
        if (contract.cargoType && !allowed.includes(contract.cargoType))
            allowed.unshift(contract.cargoType);
        const choices = (Array.isArray(wagonTypes) ? wagonTypes : [])
            .filter((type) => typeof type === 'string' && !!type.trim()).map(type => type.trim());
        if (choices.includes(contract.cargoType) && allowed.includes(contract.cargoType))
            return contract.cargoType;
        const exact = choices.find(type => allowed.includes(type));
        if (exact)
            return exact;
        // Historical wagon catalogues sometimes use a more specific alias.
        // Resolve it to a *known contract good*, never bill the unknown alias.
        for (const type of choices) {
            const prefix = type.split('-')[0];
            const match = allowed.find(good => good.split('-')[0] === prefix && cargoTypes?.getTypeInfo?.(good));
            if (match)
                return match;
        }
        return null;
    }
    /** Remaining pre-penalty estimate shown in the freight list and SC picker. */
    estimateContractPayment(contract, cargoTypes = null, services = null) {
        let remaining = Math.max(0, Number(contract.quantity) || 0);
        let estimate = 0;
        if (contract.diffuse && services)
            for (const service of services) {
                if (!service || service.completed || service.cancelled || String(service.state || '') === 'completed')
                    continue;
                const carriedId = String(service._contractCargoId || service.contractCargoId || service.assignedContractId || '');
                if (carriedId !== contract.id)
                    continue;
                const loaded = Number(service._contractFreight ?? service.contractFreight);
                const manifest = normalizeFreightManifest(service._contractManifest ?? service.contractManifest, loaded);
                if (!manifest)
                    continue; // old save: remaining tonnage stays at the nominal estimate
                for (const line of manifest) {
                    const type = this._resolveManifestCargoType(contract, [line.type], cargoTypes);
                    if (!type || remaining <= 0)
                        continue;
                    const tonnes = Math.min(remaining, line.tonnes);
                    estimate += Math.round(tonnes * this.getContractTariffPerTonne(contract, cargoTypes, type));
                    remaining -= tonnes;
                }
            }
        return estimate + Math.round(remaining * this.getContractTariffPerTonne(contract, cargoTypes));
    }
    maybeGenerate(stations, absTime, cargoTypes, industrialClients) {
        absTime = Number(absTime);
        if (!Number.isFinite(absTime) || absTime < 0)
            return;
        if (absTime < this.lastGenTime)
            this.lastGenTime = 0;
        if (absTime - this.lastGenTime < 120)
            return;
        this.lastGenTime = absTime;
        const usableStations = (Array.isArray(stations) ? stations : []).filter((st) => st && st.id && st.closed !== true && Number.isFinite(Number(st.lat)) && Number.isFinite(Number(st.lon)) && this._canHandleFreight(String(st.id)));
        if (usableStations.length < 2)
            return;
        if (this.contracts.filter((c) => c.active && !c.industrialClientId).length >= 12)
            return;
        const rng = getGlobalRng();
        if (rng.random() > 0.3)
            return;
        // Use CargoTypeManager if available, otherwise fallback
        const allTypes = cargoTypes?.getAllTypes?.() || [];
        if (allTypes.length === 0)
            return;
        const cargo = allTypes[Math.floor(rng.random() * allTypes.length)];
        const quantity = 20 + Math.floor(rng.random() * 500);
        const from = usableStations[Math.floor(rng.random() * usableStations.length)];
        const others = usableStations.filter((s) => s.id !== from.id);
        if (others.length === 0)
            return;
        const to = others[Math.floor(rng.random() * others.length)];
        const payment = quantity * (cargoTypes?.getTransportTariffPerTonne?.(cargo.type) ?? cargo.pricePerUnit);
        // FRT-01 : 20 % des contrats générés sont diffus (MLMC) — plusieurs types de wagons
        const isDiffuse = rng.random() < 0.2;
        this.contracts.push(new FreightContract({
            cargoType: cargo.type,
            cargoName: isDiffuse ? `${cargo.name} (MLMC)` : cargo.name,
            diffuse: isDiffuse,
            cargoTypes: isDiffuse ? allTypes.filter((ct) => ct.category === cargo.category).map((ct) => ct.type) : [cargo.type],
            quantity,
            unit: 't',
            from: from.name,
            fromId: from.id,
            to: to.name,
            toId: to.id,
            payment,
            tariffSource: 'cargo-types',
        }));
        // Generic offers do not belong to the Industriels statistics. Industry
        // counters are updated only by contracts actually generated for a client.
    }
    /** A contract is an ordered commercial journey, not only a compatible wagon.
     * Intermediate loading is allowed, but passing/technical points do not count.
     * Routing itself remains the Schedule Creator's responsibility.
     */
    validateAssignment(contract, service) {
        const result = { ok: false, code: '', message: '', originIndex: -1, destinationIndex: -1, capacity: 0 };
        const fail = (code, message) => ({ ...result, code, message });
        if (!contract || !contract.active || !(contract.quantity > 0))
            return fail('CONTRACT_INACTIVE', 'Ce contrat n’est plus actif.');
        if (service?.isWorkTrain || ['w', 'hlp', 'tm', 'evo', 'work'].includes(String(service?.serviceType || '').toLowerCase()))
            return fail('NON_COMMERCIAL_SERVICE', 'Ce type de service ne peut pas transporter un contrat commercial.');
        // A station without a dedicated freight terminal can still handle a
        // compatible consist. The terminal remains relevant to offer generation.
        const originStation = globalThis.window?.game?.world?.getStationById?.(contract.fromId);
        if (originStation?.closed)
            return fail('ORIGIN_CLOSED', `L’origine ${contract.from || contract.fromId} est fermée.`);
        // The destination can acquire its terminal while the train is en route.
        // Actual unloading still requires freight access at arrival.
        result.capacity = this.getRameCargoCapacity(service?.rame, contract);
        if (!(result.capacity > 0))
            return fail('CARGO_INCOMPATIBLE', 'Aucun wagon de la rame ne peut charger cette marchandise.');
        const stops = service?.getCurrentStops?.() || service?.stops || [];
        const commercial = (stop) => !!stop && !stop.technicalLocationId && (!stop.type || stop.type === 'arret');
        result.originIndex = stops.findIndex(stop => commercial(stop) && String(stop.stationId ?? '') === contract.fromId);
        if (!contract.fromId || result.originIndex < 0)
            return fail('ORIGIN_NOT_SERVED', `Le service doit s’arrêter à l’origine du contrat : ${contract.from || contract.fromId}.`);
        result.destinationIndex = stops.findIndex((stop, i) => i > result.originIndex && commercial(stop) && String(stop.stationId ?? '') === contract.toId);
        if (!contract.toId || result.destinationIndex < 0)
            return fail('DESTINATION_NOT_SERVED_AFTER_ORIGIN', `Le service doit s’arrêter à ${contract.to || contract.toId} après le chargement à ${contract.from || contract.fromId}.`);
        return { ...result, ok: true, code: 'OK', message: '' };
    }
    reserveForService(contract, service, capacity) {
        const id = service.id == null ? '' : String(service.id);
        if (!id || !contract?.active || !Number.isFinite(capacity) || capacity <= 0)
            return 0;
        // Legacy generic freight carries no per-wagon occupancy manifest. A
        // diffuse contract needs exact wagon attribution; the single-cargo
        // contract can still share the existing aggregate free capacity.
        if (contract.diffuse && Number(service._onboardFreight) > 0)
            return 0;
        const carried = this.carriedContract(service);
        if (Number(service._contractFreight) > 0 && carried?.id !== contract.id)
            return 0;
        const existing = Math.max(0, Number(contract.loadedByService[id]) || 0);
        const reserved = Object.values(contract.loadedByService).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0);
        const pending = globalThis.window?.game?.freightOperations?.pendingQuantity?.(contract.id, id) || 0;
        let amount = Math.min(capacity, Math.max(0, contract.quantity - reserved - pending + existing));
        if (contract.diffuse && amount > 0) {
            // The manifest is decided at loading, not inferred from the train
            // later: wagon compatibility can contain several possible goods.
            const manifest = [];
            let unassigned = amount;
            for (const wagon of service.rame?.elementDetails || []) {
                if (String(wagon?.category || '').toLowerCase() !== 'wagon')
                    continue;
                const cap = Number(wagon.freightCapacity);
                if (!Number.isFinite(cap) || cap <= 0)
                    continue;
                const type = this._resolveManifestCargoType(contract, wagon.cargoTypes, globalThis.window?.game?.cargoTypes || null);
                if (!type)
                    continue;
                const tonnes = Math.min(cap, unassigned);
                if (tonnes > 0)
                    manifest.push({ type, tonnes });
                unassigned -= tonnes;
                if (unassigned <= 0)
                    break;
            }
            amount -= unassigned;
            if (amount > 0)
                service._contractManifest = manifest;
        }
        const physicalFreight = globalThis.window?.game?.freightOperations;
        if (amount > 0 && physicalFreight) {
            amount = physicalFreight.loadContract(service, contract, amount, service._contractManifest || null);
            if (!(amount > 0))
                service._contractManifest = null;
        }
        if (amount > 0) {
            contract.loadedByService[id] = amount;
            service._contractCargoId = contract.id;
        }
        return amount;
    }
    releaseForService(serviceId, physicalReturn = null) {
        const id = String(serviceId ?? '');
        for (const contract of this.contracts) {
            if (!physicalReturn?.deferred && !contract.active && contract.industrialReceiverId)
                this._returnIndustrialReservation(contract, contract.loadedByService[id]);
            delete contract.loadedByService[id];
        }
        this._pruneSettledRemovals();
    }
    /** The cargo's owner is independent of a newly edited service assignment. */
    carriedContract(service) {
        const explicit = String(service._contractCargoId || service.contractCargoId || '');
        if (explicit)
            return this.contracts.find(c => c.id === explicit) || null;
        const id = String(service.id ?? '');
        const held = this.contracts.filter(c => Number(c.loadedByService[id]) > 0);
        const assigned = String(service.assignedContractId || '');
        const contract = held.find(c => c.id === assigned) || (held.length === 1 ? held[0] : null)
            || this.contracts.find(c => c.id === assigned) || null;
        if (contract && Number(service._contractFreight ?? service.contractFreight) > 0) {
            if ('_contractFreight' in service)
                service._contractCargoId = contract.id;
            else
                service.contractCargoId = contract.id;
        }
        return contract;
    }
    /** Return/unload an unfulfilled consignment. This is NOT a delivery: no
     * quantity/progress, revenue, industrial satisfaction or generic cargo change.
     * Used at the next usable commercial stop of an interrupted contract, or
     * when its service is removed/finally completed. Idempotent after reload.
     */
    finishServiceCargo(service) {
        const physicalReturn = globalThis.window?.game?.freightOperations?.returnServiceCargo?.(service);
        const value = Number(service._contractFreight ?? service.contractFreight);
        const quantity = Number.isFinite(value) ? Math.max(0, value) : 0;
        if ('contractFreight' in service)
            service.contractFreight = 0;
        if ('contractCargoId' in service)
            service.contractCargoId = '';
        service._contractFreight = 0;
        service._contractCargoId = '';
        service._contractManifest = null;
        if ('contractManifest' in service)
            service.contractManifest = null;
        this.releaseForService(service.id, physicalReturn);
        return quantity;
    }
    _pruneSettledRemovals() {
        this.contracts = this.contracts.filter(c => !c.removeWhenSettled || c.inTransitQuantity > 0 || c.industrialReservedQuantity > 0);
    }
    _industrialStockManager() {
        return this.industrialClients || globalThis.window?.game?.industrialClients || null;
    }
    _returnIndustrialReservation(contract, quantity) {
        const amount = Math.min(contract.industrialReservedQuantity, Math.max(0, Number(quantity) || 0));
        if (!(amount > 0) || !this._industrialStockManager()?.returnReservedStock?.(contract.industrialClientId, contract.cargoType, amount))
            return 0;
        contract.industrialReservedQuantity = Math.max(0, contract.industrialReservedQuantity - amount);
        return amount;
    }
    _cancelIndustrialReservation(contract) {
        if (!contract.industrialReceiverId)
            return;
        this._returnIndustrialReservation(contract, Math.max(0, contract.industrialReservedQuantity - contract.inTransitQuantity));
    }
    /** Reconcile saved/live reservations only once all carrier snapshots exist.
     * Pending V2 snapshots count as carriers before compilation. Live instances
     * take precedence. This prevents both orphan stock and early release on F5.
     */
    reconcileReservations(services, pending = []) {
        const carriers = new Map();
        for (const source of [pending, services])
            for (const carrier of source) {
                const id = String(carrier?.id ?? '');
                if (id)
                    carriers.set(id, carrier);
            }
        const desired = new Map();
        for (const [id, carrier] of carriers) {
            if (carrier.completed || carrier.cancelled || ['completed', 'cancelled'].includes(String(carrier.state))) {
                this.finishServiceCargo(carrier);
                continue;
            }
            const quantity = Number(carrier._contractFreight ?? carrier.contractFreight);
            if (!Number.isFinite(quantity) || quantity <= 0)
                continue;
            const contract = this.carriedContract(carrier);
            if (!contract)
                continue; // An old orphan is returned at its next stop.
            let entries = desired.get(contract.id);
            if (!entries) {
                entries = new Map();
                desired.set(contract.id, entries);
            }
            entries.set(id, quantity);
        }
        for (const c of this.contracts) {
            const oldLedger = c.loadedByService;
            const ledger = Object.create(null);
            let available = Math.max(0, c.quantity);
            for (const [id, quantity] of desired.get(c.id) || []) {
                const held = Math.min(available, quantity);
                if (held > 0)
                    ledger[id] = held;
                available -= held;
            }
            c.loadedByService = ledger;
            if (!c.active && c.industrialReceiverId) {
                for (const [id, amount] of Object.entries(oldLedger))
                    this._returnIndustrialReservation(c, Math.max(0, amount - (ledger[id] || 0)));
                this._cancelIndustrialReservation(c);
            }
        }
        this._pruneSettledRemovals();
    }
    toSave() {
        return this.contracts.map((c) => ({
            id: c.id,
            qualityTerms: { ...c.qualityTerms },
            cargoType: c.cargoType,
            diffuse: c.diffuse || false,
            cargoTypes: c.cargoTypes || (c.cargoType ? [c.cargoType] : []),
            cargoName: c.cargoName,
            quantity: c.quantity,
            initialQuantity: c.initialQuantity,
            unit: c.unit,
            from: c.from,
            fromId: c.fromId,
            to: c.to,
            toId: c.toId,
            payment: c.payment,
            unitPrice: c.unitPrice,
            tariffSource: c.tariffSource,
            active: c.active,
            progress: c.progress,
            industrialClientId: c.industrialClientId || null,
            industrialReceiverId: c.industrialReceiverId || null,
            industrialReservedQuantity: c.industrialReservedQuantity,
            loadedByService: { ...c.loadedByService },
            removeWhenSettled: c.removeWhenSettled,
        }));
    }
    _contractMatchesCargo(contract, type) {
        if (!contract || !type)
            return false;
        if (contract.diffuse && Array.isArray(contract.cargoTypes)) {
            return contract.cargoTypes.includes(type) || contract.cargoTypes.some((ct) => type?.startsWith(String(ct || '').split('-')[0]));
        }
        return contract.cargoType === type || contract.cargoType?.startsWith(String(type).split('-')[0]);
    }
    getRameCargoTypes(rame) {
        const out = new Set();
        for (const e of rame?.elementDetails || []) {
            if (String(e?.category || '').toLowerCase() !== 'wagon')
                continue;
            if (!(Number(e?.freightCapacity) > 0))
                continue;
            for (const t of Array.isArray(e?.cargoTypes) ? e.cargoTypes : [])
                if (t)
                    out.add(t);
        }
        return [...out];
    }
    // Payload usable for ONE cargo/contract, not the total capacity of unrelated wagons.
    // This prevents e.g. one coal hopper + twenty tank wagons from advertising the
    // capacity of all 21 wagons for a coal contract.
    getRameCargoCapacity(rame, cargoOrContract) {
        const contract = cargoOrContract && typeof cargoOrContract === 'object' ? cargoOrContract : null;
        const type = contract ? null : String(cargoOrContract || '');
        let total = 0;
        for (const e of rame?.elementDetails || []) {
            if (String(e?.category || '').toLowerCase() !== 'wagon')
                continue;
            const cap = Number(e?.freightCapacity);
            if (!(Number.isFinite(cap) && cap > 0))
                continue;
            const types = Array.isArray(e?.cargoTypes) ? e.cargoTypes.filter(Boolean) : [];
            if (!types.length)
                continue;
            const compatible = contract
                ? types.some((t) => this._contractMatchesCargo(contract, String(t)))
                : types.some((t) => t === type || t.startsWith(String(type).split('-')[0]) || String(type || '').startsWith(t.split('-')[0]));
            if (compatible)
                total += cap;
        }
        return total;
    }
    isContractCompatibleWithRame(contract, rame) {
        return this.getRameCargoCapacity(rame, contract) > 0;
    }
    cancelContractsForIndustrialClient(clientId) {
        clientId = String(clientId ?? '');
        let n = 0;
        for (const c of this.contracts)
            if ((c?.industrialClientId === clientId || c?.industrialReceiverId === clientId) && c.active) {
                c.active = false;
                this._cancelIndustrialReservation(c);
                n++;
            }
        return n;
    }
    pruneIndustrialClientContracts(validClientIds = []) {
        const valid = new Set(Array.isArray(validClientIds) ? validClientIds.filter((x) => x != null && x !== '').map(String) : []);
        let n = 0;
        for (const c of this.contracts) {
            if (c?.active && ((c.industrialClientId && !valid.has(c.industrialClientId))
                || (c.industrialReceiverId && !valid.has(c.industrialReceiverId)))) {
                c.active = false;
                this._cancelIndustrialReservation(c);
                n++;
            }
        }
        return n;
    }
    // Section X — résolution des contrats fret lors d'un arrêt en gare ITE/destination
    // Renvoie { fulfilled: [...], remainingTonnes }
    fulfillAtStation(service, stationId, freightUnload, isDelayed = false, isEarly = false) {
        const g = typeof window !== 'undefined' ? window.game : null;
        stationId = stationId == null ? '' : String(stationId);
        const unload = Number(freightUnload);
        if (!g || !service?.rame || !stationId || !Number.isFinite(unload) || unload <= 0)
            return { fulfilled: [], remainingTonnes: Number.isFinite(unload) && unload > 0 ? unload : 0 };
        // Only a wagon can establish that this train is carrying freight.
        const rameCargoType = service.rame.elementDetails?.filter((e) => String(e.category || '').toLowerCase() === 'wagon' && Number(e.freightCapacity) > 0)
            .flatMap(e => Array.isArray(e.cargoTypes) ? e.cargoTypes : [])
            .find((type) => typeof type === 'string' && !!type.trim());
        // Never invent a cargo type for an empty/unknown consist. The historical
        // containers-20 fallback allowed an empty freight train to satisfy contracts.
        if (!rameCargoType)
            return { fulfilled: [], remainingTonnes: freightUnload };
        let remaining = unload;
        const fulfilled = [];
        const tryFulfill = (c, matchType = String(rameCargoType)) => {
            if (!c || !c.active || c.toId !== stationId)
                return false;
            if (!this._contractMatchesCargo(c, matchType))
                return false;
            if (remaining <= 0)
                return false;
            const serviceId = String(service.id ?? '');
            const own = Math.max(0, Number(c.loadedByService[serviceId]) || 0);
            // Ingredient orders require the exact stock that was reserved and loaded.
            if (c.industrialReceiverId && (!(own > 0) || !(c.industrialReservedQuantity > 0)))
                return false;
            const reserved = Object.values(c.loadedByService).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0);
            let qty = c.industrialReceiverId
                ? Math.min(remaining, own, c.industrialReservedQuantity, c.quantity)
                : Math.min(remaining, Math.max(0, c.quantity - reserved + own));
            if (qty <= 0)
                return false;
            const physicalFreight = g?.freightOperations;
            if (physicalFreight) {
                const accepted = physicalFreight.unloadContract(service, c, stationId, qty);
                if (!(accepted > 0))
                    return false;
                qty = Math.min(qty, accepted);
            }
            if (own > 0) {
                const left = Math.max(0, own - qty);
                if (left > 0)
                    c.loadedByService[serviceId] = left;
                else
                    delete c.loadedByService[serviceId];
            }
            c.quantity -= qty;
            if (c.industrialReceiverId)
                c.industrialReservedQuantity = Math.max(0, c.industrialReservedQuantity - qty);
            remaining -= qty;
            if (c.quantity <= 0) {
                c.active = false;
            }
            else {
                const initial = Math.max(Number(c.initialQuantity) || (c.quantity + qty), c.quantity + qty, 1);
                c.initialQuantity = initial;
            }
            const loaded = Number(service._contractFreight ?? service.contractFreight);
            const manifest = c.diffuse && Number.isFinite(loaded)
                ? normalizeFreightManifest(service._contractManifest ?? service.contractManifest, loaded) : null;
            const parts = [];
            let uncovered = qty;
            const rest = [];
            let estimatedCargo = false;
            if (manifest)
                for (const line of manifest) {
                    const type = this._resolveManifestCargoType(c, [line.type], g.cargoTypes);
                    const used = type ? Math.min(uncovered, line.tonnes) : 0;
                    if (used > 0 && type)
                        parts.push({ type, tonnes: used,
                            base: Math.round(used * this.getContractTariffPerTonne(c, g.cargoTypes, type)) });
                    if (type && type !== line.type)
                        estimatedCargo = true;
                    if (type && line.tonnes > used)
                        rest.push({ type, tonnes: line.tonnes - used });
                    uncovered -= used;
                }
            // Old saves know the carried tonnage but have no goods breakdown.
            // The contract's nominal cargo is the explicit historical estimate.
            estimatedCargo = c.diffuse && (estimatedCargo || uncovered > 0);
            if (uncovered > 0) {
                const type = c.cargoType || matchType;
                parts.push({ type, tonnes: uncovered,
                    base: Math.round(uncovered * this.getContractTariffPerTonne(c, g.cargoTypes, type)) });
            }
            if (manifest) {
                service._contractManifest = rest.length ? rest : null;
                if ('contractManifest' in service)
                    service.contractManifest = service._contractManifest;
            }
            const base = parts.reduce((sum, part) => sum + part.base, 0);
            // Apply the freight offer before distributing receipts to cargo and
            // industrial-client ledgers, so both match the company's revenue.
            const rawFare = Number(g.marketingManager?.getFreightFareMultiplier?.(service));
            const freightFare = Number.isFinite(rawFare) && rawFare > 0 ? Math.max(0.5, Math.min(2, rawFare)) : 1;
            const effectiveBase = Math.round(base * freightFare);
            const observedDelivery = service._lastDeliveredFreightQuality;
            const delivery = observedDelivery?.contractId === c.id ? observedDelivery : { cargoCondition: 1, deliveredAtMs: g.engine?.getSimulationEpochMs?.() || 0 };
            const terms = c.qualityTerms;
            const late = terms.deadlineMs == null ? isDelayed : delivery.deliveredAtMs > terms.deadlineMs;
            const damaged = delivery.cargoCondition < terms.minimumCondition;
            const enforce = g.realismSettings?.difficulty === 'expert';
            const paymentFactor = enforce ? Math.max(0, 1 - (late ? terms.latePenaltyRate : 0) - (damaged ? terms.damagePenaltyRate : 0)) : 1;
            const payment = Math.round(effectiveBase * paymentFactor);
            fulfilled.push({ id: c.id, quantity: qty, payment, estimatedCargo, late, damaged, ...delivery });
            let allocatedPayment = 0;
            let accumulatedBase = 0;
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                accumulatedBase += part.base;
                const partBase = Math.round(accumulatedBase * freightFare);
                const partPayment = Math.round(partBase * paymentFactor) - allocatedPayment;
                allocatedPayment += partPayment;
                try {
                    g.cargoTypes?.recordContract?.(part.type, part.tonnes, partPayment, c.quantity <= 0 && i === parts.length - 1);
                }
                catch (e) { /* stats must never break an arrival */ }
                const recipientId = c.industrialReceiverId || c.industrialClientId;
                if (recipientId && typeof g.industrialClients?.recordDeliveredCargo === 'function') {
                    try {
                        g.industrialClients.recordDeliveredCargo(recipientId, part.type, part.tonnes, partPayment, !!c.industrialReceiverId || g.industrialClients.stockMode !== 'finite');
                    }
                    catch (e) { /* a withdrawn client must not interrupt physical delivery */ }
                }
            }
            // Compatibility for older host integrations without the new
            // per-good ledger; the RC30 manager already records above.
            if ((c.industrialReceiverId || c.industrialClientId) && typeof g.industrialClients?.recordDeliveredCargo !== 'function') {
                const client = g.industrialClients?.clients?.find((cl) => cl.id === (c.industrialReceiverId || c.industrialClientId));
                if (client) {
                    client.totalTonnage = Math.max(0, Number(client.totalTonnage) || 0) + qty;
                    client.totalRevenue = Math.max(0, Number(client.totalRevenue) || 0) + payment;
                    if (g.industrialClients?.stats) {
                        g.industrialClients.stats.totalTonnage = Math.max(0, Number(g.industrialClients.stats.totalTonnage) || 0) + qty;
                        g.industrialClients.stats.totalRevenue = Math.max(0, Number(g.industrialClients.stats.totalRevenue) || 0) + payment;
                    }
                }
            }
            if (c.quantity <= 0 && c.industrialClientId) {
                const client = g.industrialClients?.clients?.find((cl) => cl.id === c.industrialClientId);
                if (client) {
                    const delta = enforce && (late || damaged) ? -5 : (isEarly ? +8 : +5);
                    const currentSat = Number.isFinite(Number(client.satisfaction)) ? Number(client.satisfaction) : 80;
                    client.satisfaction = Math.min(100, Math.max(0, currentSat + delta));
                    // FRT-02 : qualité de service influe sur la part de marché
                    const shareDelta = enforce && (late || damaged) ? -1 : (isEarly ? +1.5 : +0.5);
                    const currentShare = Number.isFinite(Number(client.marketShare)) ? Number(client.marketShare) : 5;
                    client.marketShare = Math.min(100, Math.max(0, currentShare + shareDelta));
                }
            }
            return true;
        };
        // Priorité au contrat explicitement assigné à ce service
        const cargoId = String(service._contractCargoId || service.assignedContractId || '');
        if (cargoId) {
            const assignedId = cargoId;
            const assigned = this.contracts.find((c) => c.id === assignedId);
            if (assigned) {
                if (assigned.diffuse) {
                    const compatible = service.rame.elementDetails?.some(e => String(e?.category || '').toLowerCase() === 'wagon' && Number(e?.freightCapacity) > 0 &&
                        this._resolveManifestCargoType(assigned, e.cargoTypes, g.cargoTypes) !== null);
                    if (compatible)
                        tryFulfill(assigned, assigned.cargoType || String(rameCargoType));
                }
                else {
                    if (this.isContractCompatibleWithRame(assigned, service.rame))
                        tryFulfill(assigned, assigned.cargoType);
                }
            }
            // Assigned/carried freight cannot silently fulfil another customer,
            // even if the original contract was removed or no longer accepts it.
            return { fulfilled, remainingTonnes: remaining };
        }
        // Puis écoulement automatique sur les autres contrats compatibles
        for (const c of this.contracts) {
            if (remaining <= 0)
                break;
            if (service.assignedContractId != null && c.id === String(service.assignedContractId))
                continue;
            if (c.diffuse) {
                for (const e of service.rame.elementDetails || []) {
                    if (remaining <= 0)
                        break;
                    const wagonCargo = Array.isArray(e.cargoTypes) && e.cargoTypes.length > 0 ? e.cargoTypes[0] : rameCargoType;
                    tryFulfill(c, wagonCargo);
                }
            }
            else {
                tryFulfill(c);
            }
        }
        return { fulfilled, remainingTonnes: remaining };
    }
    getAllActive() {
        return this.contracts.filter((c) => c.active);
    }
    addContract(data) {
        if (!isRecord(data))
            return null;
        const hasCargo = typeof data.cargoType === 'string' && data.cargoType.trim();
        const hasDiffuse = data.diffuse === true && Array.isArray(data.cargoTypes) && data.cargoTypes.some((x) => typeof x === 'string' && x.trim());
        if (!hasCargo && !hasDiffuse)
            return null;
        const c = new FreightContract(data);
        if (this.contracts.some((x) => x.id === c.id))
            return null;
        if (c.industrialReceiverId) {
            if (!c.industrialClientId || c.diffuse || !c.cargoType || !(c.quantity > 0)
                || !this._industrialStockManager()?.reserveStockForProcurement?.(c.industrialClientId, c.industrialReceiverId, c.cargoType, c.quantity, c.fromId, c.toId))
                return null;
            c.industrialReservedQuantity = c.quantity;
        }
        this.contracts.push(c);
        return c;
    }
    removeContract(id) {
        id = String(id ?? '');
        const contract = this.contracts.find(c => c.id === id);
        if (!contract)
            return;
        contract.active = false;
        contract.removeWhenSettled = true;
        this._cancelIndustrialReservation(contract);
        // Keep a tombstone while its cargo is physically on a service.
        this._pruneSettledRemovals();
    }
    loadFromSave(arr) {
        const seen = new Set();
        this.contracts = [];
        for (const raw of Array.isArray(arr) ? arr : []) {
            if (!isRecord(raw))
                continue;
            const d = raw;
            if (d.cargoType != null && typeof d.cargoType !== 'string')
                continue;
            const hasCargo = typeof d.cargoType === 'string' && d.cargoType.trim();
            const hasDiffuse = d.diffuse === true && Array.isArray(d.cargoTypes) && d.cargoTypes.some((x) => typeof x === 'string' && x.trim());
            if (!hasCargo && !hasDiffuse)
                continue;
            const normalized = { ...d, id: d.id == null ? '' : String(d.id), fromId: d.fromId == null ? '' : String(d.fromId), toId: d.toId == null ? '' : String(d.toId), industrialClientId: d.industrialClientId == null ? null : String(d.industrialClientId) };
            const c = new FreightContract(normalized);
            if (!c.id || typeof c.id !== 'string' || seen.has(c.id))
                continue;
            seen.add(c.id);
            const num = parseInt(String(c.id).replace('fret-ind-', '').replace('fret-', ''), 10);
            if (Number.isFinite(num) && num >= nextContractId)
                nextContractId = num + 1;
            this.contracts.push(c);
        }
    }
}
