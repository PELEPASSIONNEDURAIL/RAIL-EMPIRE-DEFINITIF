import { normalizeFreightManifest } from './freight.js';
import { normalizeFreightLoadManifest } from './freight-load.js';
const finiteNonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const arrivalKey = (serviceId, locationId) => `${serviceId}\u0000${locationId}`;
export function captureCompositeCommercialState(service) {
    const contractFreight = Math.max(0, Number(service._contractFreight || 0));
    const onboardFreight = Math.max(0, Number(service._onboardFreight || 0));
    return {
        serviceId: String(service.id), scheduleId: String(service._v2ScheduleId || ''),
        currentStopIndex: Math.max(0, Number(service.currentStopIndex || 0)),
        onboardPax: Math.max(0, Number(service._onboardPax || 0)),
        onboardPassengerKm: Math.max(0, Number(service._onboardPassengerKm || 0)),
        onboardFreight, contractFreight,
        contractCargoId: String(service._contractCargoId || ''),
        contractDelivered: Math.max(0, Number(service._contractDelivered || 0)),
        contractManifest: normalizeFreightManifest(service._contractManifest, contractFreight),
        genericCargoType: String(service._genericCargoType || ''),
        genericManifest: normalizeFreightLoadManifest(service._genericManifest, onboardFreight),
        revenueCollected: service.revenueCollected === true,
    };
}
export function restoreCompositeCommercialState(service, state) {
    if (!state || String(service.id) !== state.serviceId ||
        (service._v2ScheduleId && service._v2ScheduleId !== state.scheduleId) ||
        !Number.isSafeInteger(state.currentStopIndex) || state.currentStopIndex < 0 ||
        state.currentStopIndex > service.stops.length ||
        ![state.onboardPax, state.onboardPassengerKm, state.onboardFreight,
            state.contractFreight, state.contractDelivered].every(finiteNonNegative))
        return false;
    service.currentStopIndex = state.currentStopIndex;
    service._onboardPax = state.onboardPax;
    service._onboardPassengerKm = state.onboardPassengerKm;
    service._onboardFreight = state.onboardFreight;
    service._contractFreight = state.contractFreight;
    service._contractCargoId = state.contractCargoId;
    service._contractDelivered = state.contractDelivered;
    service._contractManifest = normalizeFreightManifest(state.contractManifest, state.contractFreight);
    service._genericCargoType = state.genericCargoType;
    service._genericManifest = normalizeFreightLoadManifest(state.genericManifest, state.onboardFreight);
    service.revenueCollected = state.revenueCollected;
    return true;
}
export function attachCompositeCommercialFollowers(owner, followers) {
    if (!owner?.id || !Array.isArray(followers) || !followers.length ||
        new Set([owner.id, ...followers.map(s => s?.id)]).size !== followers.length + 1 ||
        followers.some(s => !s?._v2OccurrenceId || s._v2CompositeOwnerId && s._v2CompositeOwnerId !== owner.id))
        return false;
    owner._v2CompositeFollowers = [...followers];
    for (const follower of followers)
        follower._v2CompositeOwnerId = owner.id;
    return true;
}
export function detachCompositeCommercialFollowers(owner) {
    const followers = owner._v2CompositeFollowers || [];
    for (const follower of followers)
        if (follower._v2CompositeOwnerId === owner.id)
            follower._v2CompositeOwnerId = '';
    owner._v2CompositeFollowers = [];
    return followers;
}
/** The ledger persists the portion payload and makes a shared arrival idempotent.
 * Physical movement, vehicle ownership and station reservations remain external. */
export class CompositeCommercialLedger {
    constructor() {
        this.portions = new Map();
        this.processedArrivals = new Set();
    }
    capture(service) {
        const state = captureCompositeCommercialState(service);
        this.portions.set(state.serviceId, state);
        return state;
    }
    restore(service) {
        const state = this.portions.get(String(service.id));
        return !!state && restoreCompositeCommercialState(service, state);
    }
    get(serviceId) {
        const state = this.portions.get(serviceId);
        return state ? structuredClone(state) : null;
    }
    clear(serviceId) {
        this.portions.delete(serviceId);
        for (const key of this.processedArrivals)
            if (key.startsWith(`${serviceId}\u0000`))
                this.processedArrivals.delete(key);
    }
    settleFollowerArrival(owner, follower, followerLocationId, station, economy, distanceKm, legRoute) {
        const stops = follower.getCurrentStops?.() || follower.stops || [];
        const index = stops.findIndex((stop) => stop.locationOccurrenceId === followerLocationId);
        const stop = stops[index];
        if (!owner?._v2CompositeFollowers?.includes(follower) || follower._v2CompositeOwnerId !== owner.id ||
            !followerLocationId || index < 0 ||
            String(stop?.stationId || '') !== String(station?.id || '') ||
            !Number.isFinite(distanceKm) || distanceKm < 0)
            return false;
        const key = arrivalKey(follower.id, followerLocationId);
        if (this.processedArrivals.has(key))
            return true;
        if (index !== follower.currentStopIndex)
            return false;
        // Mark before calling the economy: an optional accounting callback can throw
        // after posting a transaction, and replay must never post it a second time.
        this.processedArrivals.add(key);
        follower.delay = owner.delay;
        follower.train.delay = owner.train.delay;
        follower._currentDate = owner._currentDate;
        try {
            // Mark distance in the same idempotent window as the revenue callback.
            follower.totalDistance += distanceKm;
            follower.train.totalKm = follower.totalDistance;
            if (stop.type === 'arret')
                economy.processStopRevenue(follower, station.name, distanceKm, index === 0, index === stops.length - 1, station.id, legRoute, false, { chargePhysicalExpense: false });
            follower.currentStopIndex = index + 1;
            this.capture(follower);
            return true;
        }
        catch {
            this.capture(follower);
            return false;
        }
    }
    toSave() {
        return { schemaVersion: 1, portions: [...this.portions.values()].map(s => structuredClone(s)),
            processedArrivals: [...this.processedArrivals] };
    }
    loadFromSave(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return false;
        const save = value;
        if (save.schemaVersion !== 1 || !Array.isArray(save.portions) || !Array.isArray(save.processedArrivals))
            return false;
        const portions = new Map();
        for (const raw of save.portions) {
            if (!raw || typeof raw.serviceId !== 'string' || !raw.serviceId ||
                typeof raw.scheduleId !== 'string' || portions.has(raw.serviceId) ||
                !Number.isSafeInteger(raw.currentStopIndex) || raw.currentStopIndex < 0 ||
                ![raw.onboardPax, raw.onboardPassengerKm, raw.onboardFreight,
                    raw.contractFreight, raw.contractDelivered].every(finiteNonNegative) ||
                typeof raw.contractCargoId !== 'string' || typeof raw.genericCargoType !== 'string' ||
                typeof raw.revenueCollected !== 'boolean' ||
                (raw.contractManifest != null && !normalizeFreightManifest(raw.contractManifest, raw.contractFreight)) ||
                (raw.genericManifest != null && !normalizeFreightLoadManifest(raw.genericManifest, raw.onboardFreight)))
                return false;
            portions.set(raw.serviceId, structuredClone(raw));
        }
        const processedArrivals = new Set();
        for (const key of save.processedArrivals) {
            const id = typeof key === 'string' ? key.split('\u0000')[0] : '';
            if (!id || !portions.has(id) || processedArrivals.has(key))
                return false;
            processedArrivals.add(key);
        }
        this.portions = portions;
        this.processedArrivals = processedArrivals;
        return true;
    }
}
