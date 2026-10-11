import { passengerCleanlinessPenalty, passengerSatisfactionScore } from './consumable-effects.js';
import { getGlobalRng } from './rng.js';
import { normalizeServiceMission, serviceMissionOwner } from './service-mission.js';
import { allocateFreightLoad, normalizeFreightLoadManifest, normalizeFreightLoadPlan } from './freight-load.js';
let browserDemography = null;
let browserDemographyRequested = false;
function requestBrowserDemography() {
    if (browserDemographyRequested || typeof window === 'undefined')
        return;
    const loader = window.RE2?.PassengerDemand?.loadBrowserDemographyCatalog;
    if (typeof loader !== 'function')
        return;
    browserDemographyRequested = true;
    void loader().then(catalog => { if (catalog && typeof catalog.byStationKey === 'function')
        browserDemography = catalog; }).catch(() => {
        // The optional pack can be absent in an offline RC30 build. The
        // economy exposes its fallback status instead of inventing population.
    });
}
// The competition model accepts numeric ITE IDs, while RC30 station IDs are
// strings. Hash the stable saved ID; never depend on station array order.
function competitionStationId(id) {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
        hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
    }
    return (hash >>> 0) % 2147483647 + 1;
}
export class Economy {
    attachPassengerDemography(catalog) { this.passengerDemography = catalog; }
    _demographicBoardingDemand(game, service, stationId, stops) {
        const catalog = this.passengerDemography || browserDemography;
        if (!catalog) {
            requestBrowserDemography();
            this.passengerDemandSource = 'fallback:pack-unavailable';
            return null;
        }
        const current = Math.max(0, Number(service.currentStopIndex) || 0);
        const next = stops.slice(current + 1).find(stop => stop?.stationId && stop.type !== 'passage');
        if (!next) {
            this.passengerDemandSource = 'fallback:route-unknown';
            return null;
        }
        const keys = (id) => {
            const station = game?.world?.getStationById?.(id);
            return [id, station?.referenceSourceId, station?.osmNativeId, station?.uicRef].filter(Boolean).map(String);
        };
        const find = (id) => {
            for (const key of keys(id)) {
                const row = catalog.byStationKey(key);
                if (row)
                    return row;
            }
            return null;
        };
        const origin = find(stationId), destination = find(next.stationId);
        if (!origin || !destination) {
            this.passengerDemandSource = 'fallback:station-unmatched';
            return null;
        }
        const population = (row) => Number(row.catchmentPopulation);
        const valid = (n) => Number.isSafeInteger(n) && n > 0 && n <= 100000000;
        const originPop = population(origin), destinationPop = population(destination);
        const employment = (row) => Number(row.employmentIndexPermille ?? 1000);
        const visitors = (row) => Number(row.visitorIndexPermille ?? 1000);
        const oe = employment(origin), de = employment(destination), dv = visitors(destination);
        if (!valid(originPop) || !valid(destinationPop) || ![oe, de, dv].every(n => Number.isFinite(n) && n >= 100 && n <= 5000)) {
            this.passengerDemandSource = 'fallback:invalid-data';
            return null;
        }
        const distanceKm = Number(service.totalDistance);
        if (!(distanceKm > 0) || !Number.isFinite(distanceKm)) {
            this.passengerDemandSource = 'fallback:route-unknown';
            return null;
        }
        const departure = Number(stops[current]?.departureTime);
        const hour = Number.isFinite(departure) ? Math.floor(((departure % 1440) + 1440) % 1440 / 60)
            : Number(game?.engine?.getParisTime?.().hours ?? 12);
        const timeFactor = hour < 5 ? 0.28 : hour < 7 ? 0.72 : hour < 10 ? 1.35 : hour < 16 ? 0.96 : hour < 19 ? 1.32 : hour < 23 ? 0.82 : 0.42;
        const distanceFactor = Math.max(0.18, Math.min(0.98, 1 / (1 + distanceKm / 900)));
        const attraction = Math.max(0.45, Math.min(2.2, Math.sqrt(Math.sqrt(de * dv) / 1000 * Math.sqrt(oe / 1000))));
        // RC30 uses the core DÉFINITIF gravity scale and the single-service
        // frequency factor. Marketing and competition are applied once below.
        const demand = Math.round(Math.sqrt(originPop * destinationPop) / 300 * distanceFactor * attraction * 0.84 * timeFactor);
        this.passengerDemandSource = 'demography';
        return Number.isSafeInteger(demand) ? Math.max(0, demand) : null;
    }
    _transactionTime() {
        const ms = typeof window !== 'undefined' ? window.game?.engine?.getSimulationEpochMs?.() : null;
        return typeof ms === 'number' && Number.isFinite(ms) ? ms : Date.now();
    }
    get passengerSatisfaction() {
        return this.passengerSatisfactionSamples > 0 ? this.passengerSatisfactionPoints / this.passengerSatisfactionSamples : null;
    }
    constructor() {
        this._companyLogo = null;
        this._lastBulletinDate = null;
        // RC19: cumulative counters are not a substitute for a complete journal.
        // Legacy versions already discarded entries; never claim to reconstruct them.
        this.historyInheritedTruncation = false;
        this.transportHistoryStartMs = 0;
        this.passengerDemandSource = 'uninitialized';
        this.passengerDemography = null;
        this.passengerSatisfactionSamples = 0;
        this.passengerSatisfactionPoints = 0;
        this.balance = 50000000000;
        this.revenue = 0;
        this.expenses = 0;
        this.penalties = 0;
        this.history = [];
        this.ticketPricePerKm = 0.12; // legacy base, kept for backward compat
        this.freightPricePerTKm = 0.08;
        // Section X — prix au km différencié par classification (vitesse max)
        this.passengerPriceByClass = {
            slow: 0.08, // ≤ 120 km/h
            regional: 0.12, // 120–160 km/h
            intercity: 0.18, // 160–200 km/h
            fast: 0.30, // 200–250 km/h
            tgv: 0.50, // > 250 km/h
        };
        this.dailyProcessed = {};
        this.settledEventIds = new Set();
        this.networkContracts = [];
        this.totalPassengers = 0;
        this.totalFreightTonnes = 0;
        // Per-category revenue/expense tracking
        this.revenueByCategory = {}; // { voyageurs: X, fret: Y, amendes: Z }
        this.expenseByCategory = {}; // { exploitation: X, personnel: Y, maintenance: Z, achat: W }
        // Per-line profitability
        this.lineRevenue = {}; // { lineId: totalRevenue }
        this.lineExpense = {};
        // Daily snapshots retained for the complete financial recap
        this.dailySnapshots = []; // [{ date, revenue, expenses, balance, byCategory: { ... } }]
        this._currentDayKey = null;
        this._currentDayRevenue = 0;
        this._currentDayExpenses = 0;
        this._currentDayByCategory = {};
        // Ticket stats
        this.totalTicketsSold = 0;
        this.totalTicketRevenue = 0;
        this.totalFraudFines = 0;
        this.fraudRate = 0.05; // 5% base fraud rate
    }
    settleEvent(eventId, event) {
        const id = String(eventId || '').trim();
        if (!id || this.settledEventIds.has(id))
            return false;
        const amount = Number(event.amount);
        if (!Number.isFinite(amount) || amount < 0)
            return false;
        const accepted = amount === 0 || (event.kind === 'revenue' ? this.addRevenue(amount, event.category, event.description) : this.addExpense(amount, event.category, event.description));
        if (!accepted)
            return false;
        this.settledEventIds.add(id);
        if (amount > 0)
            this.history[this.history.length - 1].eventId = id;
        return true;
    }
    configureNetworkContract(spec) {
        const id = String(spec.id || '').trim();
        if (!id)
            throw new Error('Identité du contrat réseau requise.');
        const n = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
        const row = { id, kind: ['access', 'concession', 'public-service', 'subsidy'].includes(spec.kind) ? spec.kind : 'access',
            country: String(spec.country || ''), sectionIds: (spec.sectionIds || []).map(String), serviceIds: (spec.serviceIds || []).map(String),
            dailyFee: n(spec.dailyFee), dailySubsidy: n(spec.dailySubsidy), tollPerKm: spec.tollPerKm == null ? null : n(spec.tollPerKm),
            expiresAtMs: spec.expiresAtMs == null ? null : n(spec.expiresAtMs), active: spec.active !== false };
        const index = this.networkContracts.findIndex(value => value.id === id);
        if (index >= 0)
            this.networkContracts[index] = row;
        else
            this.networkContracts.push(row);
        return row;
    }
    canAccessNetwork(service, nowMs) {
        const game = globalThis.window?.game;
        const places = [...(service.route || []), ...(service.stops || []).map((stop) => ({ ...stop, ...game?.world?.getStationById?.(stop.stationId) }))];
        const expired = this.networkContracts.find(contract => contract.active && ['access', 'concession'].includes(contract.kind)
            && contract.expiresAtMs != null && nowMs > contract.expiresAtMs
            && places.some((place) => contract.country && place.country === contract.country || contract.sectionIds.includes(String(place.sectionId || ''))));
        if (expired) {
            const reason = `Droit d’accès ${expired.id} expiré.`;
            return { ok: false, code: 'NETWORK_ACCESS_EXPIRED', reason, message: reason };
        }
        return { ok: true, code: 'OK', reason: '', message: '' };
    }
    processCommercialContracts(date, services) {
        for (const contract of this.networkContracts) {
            if (!contract.active)
                continue;
            if (contract.dailyFee > 0)
                this.settleEvent(`network:${contract.id}:${date}:fee`, { kind: 'expense', amount: contract.dailyFee, category: 'acces_reseau', description: `Droit ${contract.id} ${date}` });
            if (contract.dailySubsidy > 0 && (contract.kind !== 'public-service' || contract.serviceIds.every((id) => services.some(service => String(service.id) === id && service.state === 'completed' && (!(service.completedDate || service._v2BaseDate || service._currentDate) || (service.completedDate || service._v2BaseDate || service._currentDate) === date)))))
                this.settleEvent(`network:${contract.id}:${date}:subsidy`, { kind: 'revenue', amount: contract.dailySubsidy, category: 'subvention', description: `Service public ${contract.id} ${date}` });
        }
    }
    serviceDimensions(service) { const row = this.history.at(-1); if (!row)
        return; const rame = service.rame; Object.assign(row, { serviceId: service.id, ...(service.lineId ? { lineId: service.lineId } : {}), ...(service.assignedContractId ? { contractId: service.assignedContractId } : {}), ...(rame?.id ? { fleetId: rame.id } : {}), ...(rame?.depotId ? { depotId: rame.depotId } : {}) }); }
    addRevenue(amount, category, description) {
        amount = Number(amount);
        if (!Number.isFinite(amount) || amount <= 0)
            return false;
        this.balance += amount;
        this.revenue += amount;
        this.revenueByCategory[category] = (this.revenueByCategory[category] || 0) + amount;
        this._currentDayRevenue += amount;
        const key = `rev_${category}`;
        this._currentDayByCategory[key] = (this._currentDayByCategory[key] || 0) + amount;
        this.history.push({ type: 'revenue', amount, category, description, time: this._transactionTime() });
        return true;
    }
    addExpense(amount, category, description) {
        amount = Number(amount);
        if (!Number.isFinite(amount) || amount <= 0)
            return false;
        this.balance -= amount;
        this.expenses += amount;
        this.expenseByCategory[category] = (this.expenseByCategory[category] || 0) + amount;
        this._currentDayExpenses += amount;
        const key = `exp_${category}`;
        this._currentDayByCategory[key] = (this._currentDayByCategory[key] || 0) + amount;
        this.history.push({ type: 'expense', amount, category, description, time: this._transactionTime() });
        return true;
    }
    addPenalty(amount, description) {
        amount = Number(amount);
        if (!Number.isFinite(amount) || amount <= 0)
            return false;
        this.balance -= amount;
        this.penalties += amount;
        this.expenses += amount;
        this.expenseByCategory['penalty'] = (this.expenseByCategory['penalty'] || 0) + amount;
        this._currentDayExpenses += amount;
        this._currentDayByCategory['exp_penalty'] = (this._currentDayByCategory['exp_penalty'] || 0) + amount;
        this.history.push({ type: 'expense', amount, category: 'penalty', description, time: this._transactionTime() });
        return true;
    }
    /** Attach delivered quantities to their transaction, including zero-fare trips. */
    _recordDeliveredTransport(field, quantity, description, hasRevenue, observation = null) {
        if (!(quantity > 0) || !Number.isFinite(quantity))
            return;
        const latest = hasRevenue ? this.history[this.history.length - 1] : null;
        if (latest?.type === 'revenue') {
            latest[field] = quantity;
            if (observation)
                Object.assign(latest, observation);
        }
        else
            this.history.push({ type: 'transport', amount: 0, category: field === 'passengers' ? 'voyageurs' : 'fret', description, time: this._transactionTime(), [field]: quantity, ...(observation || {}) });
    }
    // Section X — prix au km différencié selon la classification (vitesse max)
    recordPassengerCancellation(service, passengers, reason, eventId) {
        const count = Math.max(0, Number(passengers) || 0), id = String(eventId || '');
        if (!count || !id || this.settledEventIds.has(id))
            return false;
        this.settledEventIds.add(id);
        this.passengerSatisfactionSamples += count;
        this.passengerSatisfactionPoints += 10 * count;
        this.history.push({ type: 'transport', amount: 0, category: 'voyageurs', time: this._transactionTime(), eventId: id,
            passengers: count, cancelled: true, delayMinutes: 0, satisfaction: 10, reason: String(reason || 'Train supprimé'),
            serviceId: String(service.id), serviceName: String(service.name || 'Service voyageurs'), description: String(reason || 'Train supprimé') });
        return true;
    }
    getPassengerPricePerKm(maxSpeed = 100) {
        const tiers = this.passengerPriceByClass || {};
        if (maxSpeed <= 120)
            return tiers.slow ?? 0.08;
        if (maxSpeed <= 160)
            return tiers.regional ?? 0.12;
        if (maxSpeed <= 200)
            return tiers.intercity ?? 0.18;
        if (maxSpeed <= 250)
            return tiers.fast ?? 0.30;
        return tiers.tgv ?? 0.50;
    }
    // Legacy — kept for backward compat but now empty (revenue is per-stop)
    processServiceRevenue(service) { }
    /**
     * Péage infrastructure (redevance d'utilisation des voies).
     * Dépend de la distance, du pays, de la vitesse max de la ligne, du nombre
     * de voies, de l'électrification, et de la masse du convoi.
     */
    _calcInfrastructureToll(distanceKm, route, rame, country = 'FR') {
        const now = globalThis.window?.game?.engine?.getSimulationEpochMs?.() || 0;
        const agreement = [...this.networkContracts].reverse().find(contract => contract.active
            && ['access', 'concession'].includes(contract.kind) && contract.tollPerKm != null
            && (contract.expiresAtMs == null || now <= contract.expiresAtMs)
            && (!contract.country && !contract.sectionIds.length || contract.country === country
                || (route || []).some(point => contract.sectionIds.includes(String(point.sectionId || '')))));
        if (agreement)
            return Math.round(distanceKm * agreement.tollPerKm);
        if (!route || route.length < 2)
            return Math.round(distanceKm * 2.0);
        // One allocation-free pass. Math.max(...speeds) crashed on long SC
        // geometries and prevented the entire stop's economy from executing.
        let speedSum = 0, speedCount = 0, maxLineSpeed = 0, trackSum = 0, trackCount = 0, electrifiedCount = 0, mainUsage = false;
        for (const p of route) {
            if (!p)
                continue;
            const speed = Number(p.maxSpeed), tracks = Number(p.tracks);
            if (Number.isFinite(speed) && speed > 0) {
                speedSum += speed;
                speedCount++;
                maxLineSpeed = Math.max(maxLineSpeed, speed);
            }
            if (Number.isFinite(tracks) && tracks > 0) {
                trackSum += tracks;
                trackCount++;
            }
            if (p.electrified)
                electrifiedCount++;
            if (p.usage === 'main')
                mainUsage = true;
        }
        if (!speedCount)
            maxLineSpeed = rame.maxSpeed || 160;
        const avgLineSpeed = speedCount ? Math.round(speedSum / speedCount) : maxLineSpeed;
        const avgTracks = trackCount ? trackSum / trackCount : 1;
        const electrified = electrifiedCount / route.length;
        const isHighSpeed = maxLineSpeed >= 250;
        const isLgv = maxLineSpeed >= 200;
        // Country base rate (EUR / train-km)
        const countryRates = {
            FR: 3.0, DE: 2.6, IT: 2.4, ES: 2.2, BE: 2.5, NL: 2.5, CH: 3.2, AT: 2.3,
            GB: 2.8, PL: 1.6, CZ: 1.5, HU: 1.4, RO: 1.2, SE: 2.0, NO: 2.1, DK: 2.4,
            PT: 1.9, FI: 1.8, IE: 2.0, LU: 2.3, SI: 1.7, SK: 1.5, HR: 1.6, GR: 1.4,
            BG: 1.2, LT: 1.3, LV: 1.3, EE: 1.3, RS: 1.4, BA: 1.3, MK: 1.2, AL: 1.1,
        };
        const baseRate = countryRates[country] || 2.0;
        // Multipliers
        const speedMult = isHighSpeed ? 2.5 : (isLgv ? 1.8 : (avgLineSpeed >= 160 ? 1.3 : (avgLineSpeed >= 120 ? 1.0 : 0.8)));
        const trackMult = avgTracks >= 3 ? 1.2 : (avgTracks >= 2 ? 1.0 : 0.85);
        const electrifiedMult = electrified > 0.5 ? 1.15 : 1.0;
        const usageMult = mainUsage ? 1.0 : 0.85;
        // Weight factor (heavier trains cause more wear)
        const tonnage = rame.totalTonnage || 100;
        const weightFactor = 0.9 + tonnage / 2000;
        const toll = distanceKm * baseRate * speedMult * trackMult * electrifiedMult * usageMult * weightFactor;
        return Math.round(toll);
    }
    /**
     * Process revenue at each station stop.
     * - Passengers: some descend (revenue for their trip), new ones board
     * - Freight: some unloaded (revenue), new freight loaded
     */
    processStopRevenue(service, stationName, distFromPrev, isFirst, isTerminus, stationId, legRoute, retryLoading = false, options = {}) {
        if (!service || !service.rame)
            return;
        if (!Number.isFinite(distFromPrev) || distFromPrev < 0)
            return;
        // The checked service type, not the capacities or the display category
        // inferred from a mixed rame, determines what may be on board.
        const serviceClass = String(service.serviceType || service.category || service.train?.category || '').trim().toLowerCase();
        const carriesPassengers = ['passager', 'passenger', 'voyageur', 'voyageurs'].includes(serviceClass);
        const commercialFreight = serviceClass === 'fret' || serviceClass === 'freight';
        const carriesFreight = commercialFreight || serviceClass === 'ttx' || serviceClass === 'infra';
        const mission = normalizeServiceMission(serviceClass, service.mission);
        const playerOperated = serviceMissionOwner(serviceClass, service.mission) === 'PLAYER';
        const missionOrigin = mission?.fromId || service.stops?.[0]?.stationId;
        const missionDestination = mission?.toId || service.stops?.[service.stops.length - 1]?.stationId;
        const boundedMission = Boolean(mission?.tonnes && missionOrigin && missionDestination && missionOrigin !== missionDestination);
        const isEmptyMovement = !carriesPassengers && !carriesFreight;
        const g = typeof window !== 'undefined' ? window.game : null;
        const operationVisitKey = `${service._v2BaseDate || service._currentDate || g?.engine?.getParisDate?.() || ''}:${service._tripCount || 0}:${service.isReturnLeg ? 'R' : 'A'}:${service.currentStopIndex}:${stationId}`;
        if (service._onboardPax == null)
            service._onboardPax = 0;
        if (service._onboardFreight == null)
            service._onboardFreight = 0;
        if (service._contractFreight == null)
            service._contractFreight = 0;
        // Old saves and category edits can retain an incompatible payload. Clear it
        // before charging the segment, so it cannot inflate mass or earn revenue.
        if (!carriesPassengers) {
            service._onboardPax = 0;
            service._onboardPassengerKm = 0;
        }
        if (!commercialFreight) {
            g?.freightManager?.finishServiceCargo?.(service);
            service._contractFreight = 0;
            service._contractCargoId = '';
        }
        if (!carriesFreight) {
            service._onboardFreight = 0;
            service._genericCargoType = '';
        }
        // Per-segment operating cost: péage réaliste + distance + vitesse max + usure
        if (options.chargePhysicalExpense !== false && !isFirst && distFromPrev > 0) {
            const carriedFreight = Math.max(0, Number(service._onboardFreight) || 0) + Math.max(0, Number(service._contractFreight) || 0);
            const physicalMassKg = Number(options.physicalMassKg);
            const tonnage = Number.isFinite(physicalMassKg) && physicalMassKg > 0
                ? Math.max(1, physicalMassKg / 1000)
                : Math.max(1, (Number(service.rame.totalMass) || Number(service.rame.totalTonnage) || 100) + carriedFreight);
            const maxSpeed = service.rame.maxSpeed || 100;
            // base énergie/usure (€/t·km)
            const energyCost = service._measuredTractionEnergyActive === true ? 0 : Math.round(distFromPrev * tonnage * 0.5);
            // péage infrastructure (track access charge)
            const station = typeof window !== 'undefined' && window.game?.world?.getStationById ? window.game.world.getStationById(stationId) : null;
            const country = station?.country || 'FR';
            const tollCost = this._calcInfrastructureToll(distFromPrev, legRoute || [], service.rame, country);
            const speedCost = Math.round(distFromPrev * Math.max(0, maxSpeed - 100) / 50);
            const opCost = energyCost + tollCost + speedCost;
            if (opCost > 0 && playerOperated) {
                const charged = this.settleEvent(`segment:${service.id}:${operationVisitKey}`, { kind: 'expense', amount: opCost, category: 'exploitation', description: `Trajet ${Math.round(distFromPrev)} km — ${service.name} (${maxSpeed} km/h) — péage ${tollCost.toLocaleString()} EUR` });
                if (charged)
                    this.serviceDimensions(service);
                if (charged && service.lineId)
                    this.addLineExpense(service.lineId, opCost);
            }
        }
        const maxPax = carriesPassengers ? (service.rame.totalCapacity || 0) : 0;
        const revenueStops = service.getCurrentStops?.() || service.stops || [];
        const revenueStop = revenueStops[retryLoading ? Math.max(0, service.currentStopIndex - 1) : isFirst ? 0 : service.currentStopIndex];
        const cohortModel = carriesPassengers && g?.operationalExtensions?.featureEnabled('detailedPassengerFlows')
            && g.operationalExtensions.hasBoundCohorts(service.id) ? g.operationalExtensions : null;
        const cohortVisitKey = `${service._v2BaseDate || service._currentDate || g?.engine?.getParisDate?.() || ''}:${service._tripCount || 0}:${service.isReturnLeg ? 'R' : 'A'}:${service.currentStopIndex}:${stationId}`;
        if (isEmptyMovement || revenueStop?.technicalLocationId || ['passage', 'waypoint'].includes(revenueStop?.type)) {
            g?.operationalExtensions?.clearAutomaticStationDwell?.(service.id, stationId);
            // Preserve distance already travelled by through passengers across technical stops.
            if (carriesPassengers && !isFirst && distFromPrev > 0) {
                const bound = cohortModel?.onboardForService(service.id) || 0;
                cohortModel?.advanceBoundCohorts(service.id, '', distFromPrev, cohortVisitKey);
                g?.stationResources?.advanceTechnicalStop?.(service.id, distFromPrev, cohortVisitKey);
                service._onboardPassengerKm = Math.max(0, Number(service._onboardPassengerKm) || 0) + Math.max(0, service._onboardPax - bound) * distFromPrev;
            }
            return;
        }
        const stationExchange = carriesPassengers && (isFirst || distFromPrev > 0 || retryLoading)
            ? g?.stationResources?.exchangeAtStop?.(g, service, stationId, {
                visitId: cohortVisitKey, simEpochMs: g?.engine?.getSimulationEpochMs?.() || 0,
                distKm: distFromPrev, isFirst, isLast: isTerminus, retryLoading
            }) : null;
        const managedPassengers = stationExchange?.handled === true;
        const cohortOnboardBefore = managedPassengers ? service._onboardPax : cohortModel?.onboardForService(service.id) || 0;
        const cohortArrival = managedPassengers ? { alighted: Math.max(0, Number(stationExchange.alighting) || 0),
            billedPassengerKm: Math.max(0, Number(stationExchange.billedPassengerKm) || 0) } : cohortModel && !isFirst
            ? cohortModel.advanceBoundCohorts(service.id, stationId, distFromPrev, cohortVisitKey)
            : { alighted: 0, billedPassengerKm: 0 };
        g?.freightOperations?.rememberExchange?.(service, stationId, { visitId: cohortVisitKey,
            stationName, distKm: distFromPrev, isFirst, isLast: isTerminus });
        const delayTolerance = (typeof window !== 'undefined' ? (window.game?.realismSettings?.delayTolerance ?? 30) : 30);
        // A commercial station can exchange payload even when it has no freight
        // upgrade. Upgrades still control dedicated freight offers and terminal
        // equipment, not whether a compatible train departs completely empty.
        const freightAccess = !g?.world?.getStationById?.(stationId)?.closed;
        let carriedContract = commercialFreight ? (g?.freightManager?.carriedContract(service) || null) : null;
        if (service._contractFreight > 0 && (!carriedContract?.active || !(carriedContract.quantity > 0)) && !service._iteCargoMismatch && freightAccess) {
            const returned = g?.freightManager?.finishServiceCargo(service) || 0;
            if (returned > 0) {
                this.history.push({ type: 'cargo_return', amount: 0, category: 'fret', description: `${stationName}: ${returned} t restituées, contrat interrompu — ${service.name}`, time: this._transactionTime() });
            }
            carriedContract = null;
        }
        // A held freight service may retry loading at the same physical stop.
        // The zero-distance retry must skip unloading and operating revenue.
        if (distFromPrev === 0 && !isFirst && !retryLoading)
            return;
        const assignedContract = commercialFreight && service.assignedContractId && g?.freightManager?.contracts
            ? g.freightManager.contracts.find((c) => c.id === service.assignedContractId && c.active)
            : null;
        const reservedTonnes = assignedContract
            ? Object.values(assignedContract.loadedByService || {}).reduce((total, qty) => total + Math.max(0, Number(qty) || 0), 0) : 0;
        const ownReservation = Math.max(0, Number(assignedContract?.loadedByService?.[String(service.id)]) || 0);
        const contractStockAvailable = !!assignedContract
            && Math.max(0, Number(assignedContract.quantity) || 0) - reservedTonnes + ownReservation > 0
            && g?.freightManager?.validateAssignment?.(assignedContract, service).ok === true;
        // A selected multi-goods plan owns this service's generic payload.
        // Existing assigned contracts retain their dedicated reservation path.
        const manualFreightPlan = commercialFreight && !service.assignedContractId
            && Array.isArray(service.freightLoadPlan) && service.freightLoadPlan.length > 0;
        const requestedCargo = manualFreightPlan ? normalizeFreightLoadPlan(service.freightLoadPlan) : [];
        const allocatedCargo = manualFreightPlan ? allocateFreightLoad(service.rame, requestedCargo) : [];
        const requestedTonnes = requestedCargo.reduce((total, line) => total + line.tonnes, 0);
        const allocatedTonnes = allocatedCargo.reduce((total, line) => total + line.tonnes, 0);
        // A changed consist must not depart with only the compatible portion
        // of the order while claiming to serve every chosen cargo/client.
        const plannedCargo = requestedCargo.length === service.freightLoadPlan?.length
            && requestedTonnes > 0 && allocatedTonnes + 1e-6 >= requestedTonnes ? allocatedCargo : [];
        // HOTFIX57 — capacity is cargo-specific. Unrelated wagons do not contribute.
        if (!service._genericCargoType) {
            service._genericCargoType = g?.freightManager?.getRameCargoTypes?.(service.rame)?.[0] || '';
        }
        const capacityContract = carriedContract || assignedContract;
        let maxFreight = carriesFreight && capacityContract
            ? (g?.freightManager?.getRameCargoCapacity?.(service.rame, capacityContract) || 0) : 0;
        let genericCapacity = manualFreightPlan
            ? plannedCargo.reduce((total, line) => total + line.tonnes, 0)
            : carriesFreight ? (g?.freightManager?.getRameCargoCapacity?.(service.rame, service._genericCargoType) || 0) : 0;
        // Section VI — ITE non compatible avec le fret du train : pas de chargement/déchargement
        if (service._iteCargoMismatch || !freightAccess) {
            maxFreight = 0;
            genericCapacity = 0;
        }
        // --- DESCENTE / DÉCHARGEMENT (revenue from those who rode this segment) ---
        const rng = getGlobalRng();
        let alightedAtStop = 0;
        if (!isFirst && distFromPrev > 0) {
            const allStops = service.stops || service.getCurrentStops?.() || [];
            const stopRatio = allStops.length > 1 ? service.currentStopIndex / (allStops.length - 1) : 1;
            // Randomized descent rates: base rate from stop position ± random variance
            const rndPax = 0.8 + rng.random() * 0.4; // 0.8 – 1.2 multiplier
            const rndFrt = 0.7 + rng.random() * 0.6; // 0.7 – 1.3 multiplier
            const paxDescendRate = isTerminus ? 1.0 : Math.min(0.85, (0.15 + stopRatio * 0.45) * rndPax);
            const freightUnloadRate = isTerminus ? 1.0 : Math.min(0.65, (0.10 + stopRatio * 0.35) * rndFrt);
            const randomOnboard = Math.max(0, service._onboardPax - cohortOnboardBefore);
            const randomDescend = Math.round(randomOnboard * paxDescendRate);
            const paxDescend = randomDescend + cohortArrival.alighted;
            alightedAtStop = paxDescend;
            // Contrat assigné : déchargement à la gare destination
            let contractUnload = 0;
            let contractRevenue = 0;
            let estimatedContractCargo = false;
            if (carriedContract?.active && stationId === carriedContract.toId && service._contractFreight > 0 && !service._iteCargoMismatch && freightAccess) {
                contractUnload = service._contractFreight;
                let acceptedUnload = 0;
                if (g?.freightManager?.fulfillAtStation) {
                    const delay = service.train?.delay ?? 0;
                    const isDelayed = g?.realismSettings?.difficulty === 'expert' && delay >= delayTolerance;
                    const isEarly = delay <= -10;
                    const res = g.freightManager.fulfillAtStation(service, stationId, contractUnload, isDelayed, isEarly);
                    acceptedUnload = Math.max(0, contractUnload - Math.max(0, Number(res.remainingTonnes) || 0));
                    contractRevenue = (res.fulfilled || []).reduce((sum, f) => sum + (Number(f.payment) || 0), 0);
                    estimatedContractCargo = (res.fulfilled || []).some((f) => f.estimatedCargo === true);
                }
                // Never delete cargo merely because we reached the destination. Only the
                // amount that a compatible contract actually accepted leaves the train.
                service._contractFreight = Math.max(0, contractUnload - acceptedUnload);
                if (service._contractFreight === 0)
                    service._contractCargoId = '';
                service._contractDelivered = (service._contractDelivered || 0) + acceptedUnload;
                if (playerOperated)
                    this.totalFreightTonnes += acceptedUnload;
                if (contractRevenue > 0) {
                    this.addRevenue(contractRevenue, 'fret', `${stationName}: contrat ${carriedContract.cargoName} ${acceptedUnload}${carriedContract.unit}${estimatedContractCargo ? ' (répartition estimée selon la marchandise nominale)' : ''} — ${service.name}`);
                    this.serviceDimensions(service);
                    if (service.lineId)
                        this.addLineRevenue(service.lineId, contractRevenue);
                }
                this._recordDeliveredTransport('freightTonnes', acceptedUnload, `${stationName}: contrat ${acceptedUnload} t livrées — ${service.name}`, contractRevenue > 0, service._lastDeliveredFreightQuality || null);
            }
            let freightUnload = service._iteCargoMismatch || !freightAccess ? 0 : manualFreightPlan
                ? isTerminus ? service._onboardFreight : 0
                : boundedMission
                    ? stationId === missionDestination ? service._onboardFreight : 0
                    : commercialFreight && contractStockAvailable && stationId === assignedContract.fromId
                        ? service._onboardFreight // commercial transfer before loading a typed MLMC manifest
                        : Math.round(service._onboardFreight * freightUnloadRate);
            if (freightUnload > 0 && g?.freightOperations)
                freightUnload = g.freightOperations.unloadGeneric(service, stationId, freightUnload);
            // Revenue = descended passengers * distance they traveled * ticket price
            // Section X — prix au km différencié selon la classification (vitesse max)
            const maxSpeed = service.rame.maxSpeed || 100;
            const basePricePerKm = this.getPassengerPricePerKm(maxSpeed);
            // RC27 marketing: the commercial policy is intentionally a modest global
            // multiplier. Individual offer targeting is abstracted because passengers
            // are not individually segmented in the simulation.
            const marketingFareMultiplier = Number(g?.marketingManager?.getPassengerFareMultiplier?.(service)) || 1;
            const pricePerKm = basePricePerKm * Math.max(0.5, Math.min(2, marketingFareMultiplier));
            const passengerKm = Math.max(0, Number(service._onboardPassengerKm) || 0) + randomOnboard * distFromPrev;
            const billedRandomKm = randomOnboard > 0 ? passengerKm * randomDescend / randomOnboard : 0;
            const billedPassengerKm = billedRandomKm + cohortArrival.billedPassengerKm;
            service._onboardPassengerKm = Math.max(0, passengerKm - billedRandomKm);
            const paxRevenue = Math.round(billedPassengerKm * pricePerKm);
            // Pay compensation only for passengers who actually alight late in Expert.
            // A balanced policy keeps the historical 25% of the gross ticket fare.
            if (!retryLoading && paxDescend > 0 && g?.realismSettings?.difficulty === 'expert'
                && service.train?.delay >= delayTolerance) {
                const policyRate = Number(g?.marketingManager?.getPassengerCompensationRate?.());
                const rate = Number.isFinite(policyRate) ? Math.max(0, Math.min(1, policyRate)) : .25;
                const compensation = Math.round(paxRevenue * rate);
                if (compensation > 0)
                    this.addPenalty(compensation, `Compensation voyageurs : retard ≥${delayTolerance}min ${service.name} @ ${stationName}`);
            }
            if (paxDescend > 0) {
                const missedConnections = Math.max(0, Number(stationExchange?.missedConnections) || 0);
                const comfortFactor = (g?.operationalExtensions?.comfortFactorForService?.(service) ?? 1) * (g?.ultimate?.effectsForService?.(service)?.comfortFactor ?? 1);
                const occupancy = Math.max(Number(stationExchange?.occupancy) || 0, maxPax > 0 ? service._onboardPax / maxPax : 0);
                const restaurantFactor = Math.max(0, Math.min(1, Number(stationExchange?.restaurantFactor ?? 1) || 0));
                const fareRatio = basePricePerKm > 0 ? pricePerKm / basePricePerKm : 1;
                const experiencePenalty = Math.min(20, missedConnections / Math.max(1, paxDescend) * 20)
                    + (stationExchange?.informationAvailable === false ? 5 : 0)
                    + (stationExchange?.accessible === false ? 5 : 0)
                    + Math.max(0, occupancy - .85) * 20 + (1 - restaurantFactor) * 5 + Math.max(0, fareRatio - 1) * 8;
                const satisfaction = Math.max(0, passengerSatisfactionScore(service.rame, service.train?.delay, g?.stationUpgrades?.getSatisfactionBonus?.(stationId))
                    * comfortFactor - experiencePenalty);
                this.passengerSatisfactionSamples += paxDescend;
                this.passengerSatisfactionPoints += satisfaction * paxDescend;
                this.totalPassengers += paxDescend;
                this.totalTicketsSold += paxDescend;
                this.totalTicketRevenue += paxRevenue;
                if (paxRevenue > 0) {
                    this.addRevenue(paxRevenue, 'voyageurs', `${stationName}: ${paxDescend} desc. (${Math.round(distFromPrev)} km) — ${service.name}`);
                    this.serviceDimensions(service);
                    if (service.lineId)
                        this.addLineRevenue(service.lineId, paxRevenue);
                }
                const measuredDelay = service.train?.delay;
                const observation = typeof measuredDelay === 'number' && Number.isFinite(measuredDelay)
                    ? { delayMinutes: measuredDelay, serviceName: String(service.name || 'Service voyageurs'), stationName: String(stationName),
                        serviceId: String(service.id || ''), visitId: cohortVisitKey, satisfaction,
                        missedConnections, deniedBoarding: Math.max(0, Number(stationExchange?.deniedBoarding) || 0),
                        occupancy, comfortFactor, fareRatio,
                        informationAvailable: stationExchange?.informationAvailable !== false,
                        restaurantFactor: Math.max(0, Number(stationExchange?.restaurantFactor ?? 1) || 0),
                        pricePerKm, cleanliness: Number(service.rame.cleanliness?.interior ?? 100) }
                    : null;
                this._recordDeliveredTransport('passengers', paxDescend, `${stationName}: ${paxDescend} voyageurs descendus — ${service.name}`, paxRevenue > 0, observation);
            }
            if (freightUnload > 0) {
                if (playerOperated)
                    this.totalFreightTonnes += freightUnload;
                if (boundedMission)
                    service._missionDelivered = (service._missionDelivered || 0) + freightUnload;
                const freightFare = Math.max(0.5, Math.min(2, Number(g?.marketingManager?.getFreightFareMultiplier?.(service)) || 1));
                const isDelayed = g?.realismSettings?.difficulty === 'expert'
                    && (service.train?.delay ?? 0) >= delayTolerance;
                const manifest = manualFreightPlan
                    ? normalizeFreightLoadManifest(service._genericManifest, freightUnload) : null;
                const cType = service._genericCargoType || this._rameCargoType(service.rame);
                const cargoTariff = Number(g?.cargoTypes?.getTransportTariffPerTonne?.(cType));
                let genericRevenue = 0;
                if (manifest) {
                    const parts = manifest.map(line => {
                        const tariff = Number(g?.cargoTypes?.getTransportTariffPerTonne?.(line.type));
                        return { ...line, base: Math.round(line.tonnes * (Number.isFinite(tariff) ? Math.max(0, tariff) : 0)) };
                    });
                    const base = parts.reduce((sum, part) => sum + part.base, 0);
                    genericRevenue = Math.round(base * freightFare);
                    if (isDelayed)
                        genericRevenue = Math.round(genericRevenue * 0.75);
                    let allocatedRevenue = 0, accumulatedBase = 0;
                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i];
                        accumulatedBase += part.base;
                        const fare = Math.round(accumulatedBase * freightFare);
                        const partRevenue = (isDelayed ? Math.round(fare * 0.75) : fare) - allocatedRevenue;
                        allocatedRevenue += partRevenue;
                        try {
                            g?.cargoTypes?.recordContract?.(part.type, part.tonnes, partRevenue, isTerminus && i === parts.length - 1);
                        }
                        catch (e) { /* statistics must never hold a physical train */ }
                        if (part.industrialClientId) {
                            try {
                                g?.industrialClients?.recordDeliveredCargo?.(part.industrialClientId, part.type, part.tonnes, partRevenue);
                            }
                            catch (e) { /* stale company must not undo the delivery */ }
                        }
                    }
                    service._genericManifest = null;
                }
                else {
                    // Historical saves without a typed manifest retain their
                    // nominal cargo; they never acquire an invented company.
                    genericRevenue = commercialFreight ? Math.round(freightUnload * (Number.isFinite(cargoTariff) ? Math.max(0, cargoTariff) : 0) * freightFare) : 0;
                    if (isDelayed && genericRevenue > 0)
                        genericRevenue = Math.round(genericRevenue * 0.75);
                }
                if (genericRevenue > 0) {
                    if (manifest) {
                        const description = manifest.map(line => `${line.type} ${line.tonnes} t`).join(' + ');
                        this.addRevenue(genericRevenue, 'fret', `${stationName}: fret ${description} — ${service.name}`);
                        this.serviceDimensions(service);
                    }
                    else {
                        this.addRevenue(genericRevenue, 'fret', `${stationName}: fret ${cType || 'non typé'} ${freightUnload}t · tarif ${cargoTariff || 0} €/t — ${service.name}`);
                        this.serviceDimensions(service);
                    }
                    if (service.lineId)
                        this.addLineRevenue(service.lineId, genericRevenue);
                }
                if (playerOperated)
                    this._recordDeliveredTransport('freightTonnes', freightUnload, `${stationName}: fret ${freightUnload} t déchargées — ${service.name}`, genericRevenue > 0);
                // Fret hors contrat : statistiques Marchandises uniquement.
                try {
                    if (!manifest && commercialFreight && g?.cargoTypes?.recordContract) {
                        g.cargoTypes.recordContract(cType, freightUnload, genericRevenue, isTerminus);
                        // Generic freight belongs to cargo statistics, not industrial clients.
                    }
                }
                catch (e) { /* graceful */ }
            }
            service._onboardPax -= paxDescend;
            service._onboardFreight -= freightUnload;
        }
        if (commercialFreight && contractStockAvailable
            && stationId === assignedContract.fromId && distFromPrev === 0
            && freightAccess && !service._iteCargoMismatch && service._onboardFreight > 0) {
            // A malformed/legacy first-stop snapshot can retain generic cargo
            // without a journey to bill. Return it explicitly before MLMC loads.
            const returned = service._onboardFreight;
            service._onboardFreight = 0;
            this.history.push({ type: 'cargo_return', amount: 0, category: 'fret',
                description: `${stationName}: ${returned} t génériques restituées avant chargement du contrat — ${service.name}`,
                time: this._transactionTime() });
        }
        // --- MONTÉE / CHARGEMENT (new passengers/freight board) ---
        const paxBeforeBoarding = service._onboardPax;
        if (!isTerminus) {
            // Validate the whole ordered journey again for imported/edited services.
            // An origin can be an intermediate commercial stop, not just stop zero.
            if (freightAccess && assignedContract && stationId === assignedContract.fromId && service._contractFreight === 0 &&
                g?.freightManager?.validateAssignment?.(assignedContract, service).ok) {
                const available = Math.max(0, maxFreight - service._onboardFreight);
                const contractLoad = Number(g.freightManager.reserveForService(assignedContract, service, available)) || 0;
                if (contractLoad > 0) {
                    service._contractFreight = contractLoad;
                }
            }
            const availPaxSlots = maxPax - service._onboardPax;
            const availFreightSlots = Math.max(0, genericCapacity - service._onboardFreight - service._contractFreight);
            // Randomized boarding: 30-80% of available slots
            const paxBoardRate = 0.30 + rng.random() * 0.50;
            const frtBoardRate = 0.20 + rng.random() * 0.80;
            const upgradeBonus = Math.max(0, Number(g?.stationUpgrades?.getFrequentationBonus?.(stationId)) || 0);
            const marketingDemandMultiplier = Math.max(0.5, Math.min(2, Number(g?.marketingManager?.getPassengerDemandMultiplier?.(service)) || 1));
            const demographicDemand = carriesPassengers ? this._demographicBoardingDemand(g, service, stationId, revenueStops) : null;
            const competition = typeof window !== 'undefined'
                ? window.__reDefinitif?.competition : null;
            const sharePermille = Number(competition?.playerPassengerSharePermille?.(service.id));
            const playerShare = competition?.isEnabled?.() === true && Number.isFinite(sharePermille)
                ? Math.max(0, Math.min(1, sharePermille / 1000)) : 1;
            const remainingStops = revenueStops.slice(service.currentStopIndex).map(stop => stop.stationId);
            const cohortBoard = managedPassengers ? Math.max(0, Number(stationExchange.boarding) || 0) : cohortModel ? cohortModel.boardBoundCohorts(service.id, stationId, availPaxSlots, remainingStops) : 0;
            const randomCapacity = Math.max(0, availPaxSlots - cohortBoard);
            const paxBoard = carriesPassengers && !managedPassengers ? Math.max(0, Math.min(randomCapacity, Math.round((demographicDemand ?? randomCapacity * paxBoardRate) * (1 + upgradeBonus) * (1 - passengerCleanlinessPenalty(service.rame) / 100) * marketingDemandMultiplier * playerShare))) : 0;
            // Contract tonnes are reserved separately. If stock runs out, carry
            // real generic freight in a compatible wagon and bill only that cargo
            // on unloading; it must never masquerade as a contract delivery.
            const freightDemandMultiplier = commercialFreight
                ? Math.max(0.5, Math.min(2, Number(g?.marketingManager?.getFreightDemandMultiplier?.(service)) || 1)) : 1;
            let freightShare = 1;
            if (commercialFreight && !service.assignedContractId && competition?.isEnabled?.() === true) {
                const destinationId = String(revenueStops[revenueStops.length - 1]?.stationId || '');
                const sourceId = String(stationId || '');
                if (sourceId && destinationId && sourceId !== destinationId) {
                    const sourceKey = competitionStationId(sourceId);
                    let destinationKey = competitionStationId(destinationId);
                    if (destinationKey === sourceKey)
                        destinationKey = destinationKey % 2147483647 + 1;
                    const cargo = String(service._genericCargoType || this._rameCargoType(service.rame) || 'general').trim().toLowerCase();
                    const freightPermille = Number(competition.playerFreightSharePermille?.(sourceKey, destinationKey, cargo));
                    if (Number.isFinite(freightPermille))
                        freightShare = Math.max(0, Math.min(1, freightPermille / 1000));
                }
            }
            const pendingHandling = g?.freightOperations?.pendingForService?.(service, stationId);
            const waitingForHandling = !!pendingHandling && !(pendingHandling.generic && pendingHandling.status === 'ready' && pendingHandling.direction === 'load');
            let freightLoad = waitingForHandling ? 0 : manualFreightPlan
                ? (freightAccess && !service._iteCargoMismatch && (isFirst || retryLoading)
                    && plannedCargo.length > 0 && service._onboardFreight <= 0 && service._contractFreight <= 0
                    ? (() => {
                        service._genericManifest = plannedCargo.map(line => ({ ...line }));
                        service._genericCargoType = plannedCargo[0]?.type || '';
                        return plannedCargo.reduce((sum, line) => sum + line.tonnes, 0);
                    })() : 0)
                : carriesFreight && !(commercialFreight && service._contractFreight > 0)
                    ? boundedMission
                        ? stationId === missionOrigin && service._onboardFreight === 0
                            ? Math.min(availFreightSlots, mission.tonnes) : Math.min(availFreightSlots, Math.max(1, Math.round(availFreightSlots * frtBoardRate * freightDemandMultiplier * freightShare)))
                        : Math.min(availFreightSlots, Math.max(1, Math.round(availFreightSlots * frtBoardRate * freightDemandMultiplier * freightShare)))
                    : 0;
            if (freightLoad > 0 && g?.freightOperations) {
                const manifest = manualFreightPlan ? plannedCargo : [{ type: service._genericCargoType, tonnes: freightLoad }];
                freightLoad = g.freightOperations.loadGeneric(service, stationId, manifest);
            }
            service._onboardPax += cohortBoard + (carriesPassengers && !managedPassengers && randomCapacity > 0 ? Math.max(1, paxBoard) : paxBoard);
            service._onboardFreight += freightLoad;
        }
        g?.operationalExtensions?.recordActualStationFlow?.(service, stationId, { boarding: Math.max(0, service._onboardPax - paxBeforeBoarding), alighting: alightedAtStop }, retryLoading);
    }
    // Type de chargement représentatif d'une rame (1er cargo des wagons fret).
    // Sert à attribuer les stats du fret hors contrat à une catégorie de
    // marchandise. Repli sur conteneurs si aucun wagon ne précise son chargement.
    _rameCargoType(rame) {
        const els = rame?.elementDetails || [];
        for (const e of els) {
            if (Array.isArray(e.cargoTypes) && e.cargoTypes.length > 0)
                return e.cargoTypes[0];
        }
        return null;
    }
    processDailyCharges(services, depots, dateKey) {
        if (this.dailyProcessed[dateKey])
            return;
        this.dailyProcessed[dateKey] = true;
        // Save previous day snapshot before processing new day
        if (this._currentDayKey && this._currentDayKey !== dateKey) {
            this.dailySnapshots.push({
                date: this._currentDayKey,
                revenue: this._currentDayRevenue,
                expenses: this._currentDayExpenses,
                balance: this.balance,
                profit: this._currentDayRevenue - this._currentDayExpenses,
                byCategory: { ...this._currentDayByCategory },
            });
            this._currentDayRevenue = 0;
            this._currentDayExpenses = 0;
            this._currentDayByCategory = {};
        }
        this._currentDayKey = dateKey;
        this.processCommercialContracts(dateKey, services);
        globalThis.window?.game?.freightOperations?.lifecycle?.dailyUpdate?.(dateKey);
        for (const svc of services) {
            if (serviceMissionOwner(svc.serviceType || svc.category, svc.mission) !== 'PLAYER')
                continue;
            const cost = 500 + (svc.rame ? svc.rame.totalTonnage * 0.5 : 0);
            if (this.addExpense(Math.round(cost), 'exploitation', `Exploitation ${svc.name}`))
                this.serviceDimensions(svc);
        }
        if (depots) {
            for (const d of depots) {
                const cost = d.getMaintenanceCost ? d.getMaintenanceCost() : d.tracks * 200;
                if (this.addExpense(cost, 'maintenance', `Maintenance ${d.name}`)) {
                    const row = this.history.at(-1);
                    if (row)
                        row.depotId = d.id;
                }
            }
        }
        const keys = Object.keys(this.dailyProcessed);
        while (keys.length > 7) {
            const k = keys.shift();
            if (k !== undefined)
                delete this.dailyProcessed[k];
        }
    }
    // Get effective fraud rate (reduced by contrôleur presence)
    getEffectiveFraudRate(hasControleur) {
        return hasControleur ? this.fraudRate * 0.3 : this.fraudRate; // 70% reduction with contrôleur
    }
    // Revenue breakdown for dashboard
    getRevenueBreakdown() {
        return { ...this.revenueByCategory };
    }
    getExpenseBreakdown() {
        return { ...this.expenseByCategory };
    }
    // Per-line revenue tracking
    addLineRevenue(lineId, amount) {
        if (!lineId || amount <= 0)
            return;
        this.lineRevenue[lineId] = (this.lineRevenue[lineId] || 0) + amount;
    }
    addLineExpense(lineId, amount) {
        if (!lineId || amount <= 0)
            return;
        this.lineExpense[lineId] = (this.lineExpense[lineId] || 0) + amount;
    }
    getLineProfitability(lineId) {
        const rev = this.lineRevenue[lineId] || 0;
        const exp = this.lineExpense[lineId] || 0;
        return { revenue: rev, expense: exp, profit: rev - exp, margin: rev > 0 ? Math.round(((rev - exp) / rev) * 100) : 0 };
    }
    formatAmount(n) {
        return Math.round(n).toLocaleString('fr-FR') + ' €';
    }
    toSave() {
        return {
            balance: this.balance,
            revenue: this.revenue,
            expenses: this.expenses,
            penalties: this.penalties,
            ticketPricePerKm: this.ticketPricePerKm,
            freightPricePerTKm: this.freightPricePerTKm,
            passengerPriceByClass: { ...this.passengerPriceByClass },
            history: this.history.map(entry => ({ ...entry })),
            historyVersion: 1,
            historyInheritedTruncation: this.historyInheritedTruncation,
            transportHistoryVersion: 1,
            transportHistoryStartMs: this.transportHistoryStartMs,
            dailyProcessed: this.dailyProcessed,
            settledEventIds: [...this.settledEventIds], networkContracts: this.networkContracts.map(row => ({ ...row })),
            totalPassengers: this.totalPassengers,
            passengerSatisfactionSamples: this.passengerSatisfactionSamples,
            passengerSatisfactionPoints: this.passengerSatisfactionPoints,
            totalFreightTonnes: this.totalFreightTonnes,
            _companyLogo: this._companyLogo || null,
            _lastBulletinDate: this._lastBulletinDate || null,
            revenueByCategory: this.revenueByCategory,
            expenseByCategory: this.expenseByCategory,
            lineRevenue: this.lineRevenue,
            lineExpense: this.lineExpense,
            dailySnapshots: this.dailySnapshots.map(day => ({ ...day })),
            totalTicketsSold: this.totalTicketsSold,
            totalTicketRevenue: this.totalTicketRevenue,
            totalFraudFines: this.totalFraudFines,
            fraudRate: this.fraudRate,
            _currentDayKey: this._currentDayKey,
            _currentDayRevenue: this._currentDayRevenue,
            _currentDayExpenses: this._currentDayExpenses,
            _currentDayByCategory: this._currentDayByCategory,
        };
    }
    loadFromSave(s) {
        if (!s || typeof s !== 'object')
            return;
        const data = s;
        const num = (v, fallback = 0, min = -Infinity, max = Infinity) => {
            const n = Number(v);
            return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
        };
        this.settledEventIds = new Set((Array.isArray(data.settledEventIds) ? data.settledEventIds : []).filter((value) => typeof value === 'string'));
        this.networkContracts = [];
        for (const spec of Array.isArray(data.networkContracts) ? data.networkContracts : [])
            if (spec && typeof spec === 'object')
                this.configureNetworkContract(spec);
        this.balance = num(data.balance, 50000000000);
        this.revenue = num(data.revenue, 0, 0);
        this.expenses = num(data.expenses, 0, 0);
        this.penalties = num(data.penalties, 0, 0);
        this.ticketPricePerKm = num(data.ticketPricePerKm, 0.12, 0);
        this.freightPricePerTKm = num(data.freightPricePerTKm, 0.08, 0);
        // Backward compat : si passengerPriceByClass n'existe pas, on dérive de l'ancien ticketPricePerKm
        if (data.passengerPriceByClass && typeof data.passengerPriceByClass === 'object' && !Array.isArray(data.passengerPriceByClass)) {
            const savedPrices = data.passengerPriceByClass;
            for (const key of ['slow', 'regional', 'intercity', 'fast', 'tgv']) {
                if (Object.prototype.hasOwnProperty.call(savedPrices, key))
                    this.passengerPriceByClass[key] = num(savedPrices[key], this.passengerPriceByClass[key], 0);
            }
        }
        else if (Object.prototype.hasOwnProperty.call(s, 'ticketPricePerKm')) {
            const base = num(data.ticketPricePerKm, 0.12, 0);
            this.passengerPriceByClass = {
                slow: base * 0.8,
                regional: base * 1.0,
                intercity: base * 1.3,
                fast: base * 1.8,
                tgv: base * 2.5,
            };
        }
        this.history = (Array.isArray(data.history) ? data.history : []).filter((h) => !!h && typeof h === 'object' && !Array.isArray(h) && Number.isFinite(Number(h.amount))).map((h) => ({ ...h, amount: Number(h.amount) }));
        this.historyInheritedTruncation = data.historyVersion !== 1 || data.historyInheritedTruncation === true;
        // Older saves contain financial entries but no delivered quantities.
        // Mark the beginning of reliable transport history rather than claiming
        // that those missing deliveries were zero.
        this.transportHistoryStartMs = data.transportHistoryVersion === 1
            ? num(data.transportHistoryStartMs, 0, 0)
            : this.history.reduce((latest, row) => Math.max(latest, num(row.time, 0, 0)), 0);
        this.dailyProcessed = (data.dailyProcessed && typeof data.dailyProcessed === 'object' && !Array.isArray(data.dailyProcessed)) ? { ...data.dailyProcessed } : {};
        this.totalPassengers = num(data.totalPassengers, 0, 0);
        this.passengerSatisfactionSamples = num(data.passengerSatisfactionSamples, 0, 0, Number.MAX_SAFE_INTEGER / 100);
        this.passengerSatisfactionPoints = num(data.passengerSatisfactionPoints, 0, 0, this.passengerSatisfactionSamples * 100);
        this.totalFreightTonnes = num(data.totalFreightTonnes, 0, 0);
        // RC30 previously counted generic unloading but omitted delivered
        // contracts from this aggregate. A complete transport journal can
        // recover that historical amount without double-counting newer saves.
        if (data.historyVersion === 1 && data.transportHistoryVersion === 1
            && !this.historyInheritedTruncation && this.transportHistoryStartMs === 0) {
            const journalTonnes = this.history.reduce((sum, row) => sum + num(row.freightTonnes, 0, 0), 0);
            this.totalFreightTonnes = Math.max(this.totalFreightTonnes, journalTonnes);
        }
        this._companyLogo = typeof data._companyLogo === 'string' ? data._companyLogo : null;
        this._lastBulletinDate = typeof data._lastBulletinDate === 'string' ? data._lastBulletinDate : null;
        const numMap = (raw) => Object.fromEntries(Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}).map(([k, v]) => [k, num(v, 0)]));
        this.revenueByCategory = numMap(data.revenueByCategory);
        this.expenseByCategory = numMap(data.expenseByCategory);
        this.lineRevenue = numMap(data.lineRevenue);
        this.lineExpense = numMap(data.lineExpense);
        this.dailySnapshots = (Array.isArray(data.dailySnapshots) ? data.dailySnapshots : []).filter((x) => !!x && typeof x === 'object' && !Array.isArray(x)).map((x) => ({
            ...x,
            date: typeof x.date === 'string' ? x.date : '',
            revenue: num(x.revenue, 0), expenses: num(x.expenses, 0), balance: num(x.balance, 0), profit: num(x.profit, 0),
            byCategory: numMap(x.byCategory),
        }));
        this.totalTicketsSold = num(data.totalTicketsSold, 0, 0);
        this.totalTicketRevenue = num(data.totalTicketRevenue, 0, 0);
        this.totalFraudFines = num(data.totalFraudFines, 0, 0);
        this.fraudRate = num(data.fraudRate, 0.05, 0, 1);
        this._currentDayKey = typeof data._currentDayKey === 'string' ? data._currentDayKey : null;
        this._currentDayRevenue = num(data._currentDayRevenue, 0);
        this._currentDayExpenses = num(data._currentDayExpenses, 0);
        this._currentDayByCategory = numMap(data._currentDayByCategory);
    }
}
