const unique = (values) => [...new Set(values.map(String).filter(Boolean))];
const key = (routeId, ownerId) => JSON.stringify([routeId, ownerId]);
export class InterlockingResources {
    constructor(cantonManager) {
        this.routes = new Map();
        this.claims = new Map();
        this.cantonManager = cantonManager;
    }
    lockSnapshot(ownerId) {
        const rows = new Map();
        if (!this.cantonManager.resourceEventsEnabled?.())
            return rows;
        for (const claim of this.claims.values())
            if (claim.ownerId === ownerId) {
                for (const point of this.routes.get(claim.routeId)?.switches || [])
                    rows.set(point.id, 'switch');
                if (claim.committedEpochMs != null)
                    rows.set(claim.routeId, 'approach');
            }
        return rows;
    }
    lockChanges(ownerId, before, epoch) {
        const after = this.lockSnapshot(ownerId);
        for (const [resourceId, kind] of before)
            if (!after.has(resourceId))
                this.cantonManager.emitResourceEvent?.({ resourceId, kind, serviceId: ownerId, type: 'release', simEpochMs: epoch });
        for (const [resourceId, kind] of after)
            if (!before.has(resourceId))
                this.cantonManager.emitResourceEvent?.({ resourceId, kind, serviceId: ownerId, type: 'acquire', simEpochMs: epoch });
    }
    bindRoute(plan) {
        if (!plan.id || !plan.assignments?.length)
            throw new TypeError('Itinéraire physique canonique requis.');
        const assignments = plan.assignments.map(assignment => ({ cantonId: assignment.cantonId, startKm: assignment.startKm, endKm: assignment.endKm,
            startIndex: assignment.startIndex, endIndex: assignment.endIndex, resourceIds: assignment.resourceIds?.slice() }));
        if (assignments.some(assignment => !assignment.cantonId || !Number.isFinite(assignment.startKm) || !Number.isFinite(assignment.endKm) || assignment.endKm < assignment.startKm))
            throw new TypeError('Empreinte physique d’itinéraire invalide.');
        const endKm = assignments.reduce((maximum, assignment) => Math.max(maximum, assignment.endKm), -Infinity);
        const route = { ...plan, id: String(plan.id), assignments,
            flankCantonIds: unique(plan.flankCantonIds || []), overlapCantonIds: unique(plan.overlapCantonIds || []),
            switches: (plan.switches || []).map(value => ({ ...value, id: String(value.id), position: String(value.position) })),
            releaseAtKm: Math.max(endKm, Number.isFinite(plan.releaseAtKm) ? Number(plan.releaseAtKm) : endKm),
            approachLockSec: Math.max(0, Number(plan.approachLockSec) || 0) };
        if (route.switches.some(value => !value.id || !value.position || value.id === 'undefined' || value.position === 'undefined'))
            throw new TypeError('Position d’aiguille explicite requise.');
        const positions = new Map();
        for (const value of route.switches) {
            if (positions.has(value.id) && positions.get(value.id) !== value.position)
                throw new TypeError('Un itinéraire exige deux positions de la même aiguille.');
            positions.set(value.id, value.position);
        }
        for (const id of this.cantonIds(route))
            if (!this.cantonManager.cantons.has(id))
                throw new TypeError(`Canton canonique absent : ${id}`);
        const existing = this.routes.get(route.id);
        if (existing && [...this.claims.values()].some(claim => claim.routeId === route.id) && JSON.stringify(existing) !== JSON.stringify(route))
            throw new Error('Un itinéraire verrouillé ne peut pas changer son empreinte.');
        this.routes.set(route.id, route);
        return route;
    }
    cantonIds(route) {
        return unique([...route.assignments.map(assignment => assignment.cantonId), ...route.flankCantonIds, ...route.overlapCantonIds]);
    }
    conflict(route, ownerId) {
        for (const required of route.switches)
            for (const claim of this.claims.values()) {
                const other = this.routes.get(claim.routeId)?.switches.find(value => value.id === required.id);
                if (other && other.position !== required.position)
                    return { ok: false, code: 'SWITCH_LOCK', resourceId: `switch:${required.id}`, ownerId: claim.ownerId, reason: `Aiguille ${required.id} verrouillée ${other.position} par ${claim.ownerId}.` };
            }
        for (const id of this.cantonIds(route)) {
            if (!this.cantonManager.cantons.has(id))
                return { ok: false, code: 'MISSING_CANTON', resourceId: id, reason: 'Ressource physique canonique absente.' };
            if (!this.cantonManager.isAvailable(id, ownerId)) {
                const reason = this.cantonManager.describeUnavailable?.(id, ownerId);
                const canton = this.cantonManager.cantons.get(id);
                return { ok: false, code: 'TRACK_LOCK', resourceId: reason?.resourceId || id,
                    ownerId: reason?.ownerId != null ? String(reason.ownerId) : canton.occupiedBy != null ? String(canton.occupiedBy) : canton.reservedBy != null ? String(canton.reservedBy) : undefined, reason: reason?.reason || 'Empreinte réservée ou occupée.' };
            }
        }
        return null;
    }
    reserveRoute(routeId, ownerId, simEpochMs) {
        if (!ownerId || !Number.isFinite(simEpochMs))
            throw new TypeError('Propriétaire canonique et horloge simulée absolue requis.');
        const route = this.routes.get(routeId);
        if (!route)
            return { ok: false, code: 'MISSING_ROUTE', reason: 'Itinéraire physique absent.' };
        if (this.claims.has(key(routeId, ownerId)))
            return { ok: true, code: 'ALREADY_RESERVED' };
        const failure = this.conflict(route, ownerId);
        if (failure)
            return failure;
        const beforeLocks = this.lockSnapshot(ownerId);
        const finish = this.cantonManager.beginResourceTransaction?.();
        const added = [];
        // One synchronous transaction; preserve own pre-existing occupation/reservation.
        try {
            for (const id of this.cantonIds(route)) {
                const canton = this.cantonManager.cantons.get(id);
                if (canton.occupiedBy === ownerId || canton.reservedBy === ownerId)
                    continue;
                if (!this.cantonManager.reserve(id, ownerId)) {
                    for (const previous of added)
                        this.cantonManager.release(previous, ownerId);
                    finish?.(false);
                    return { ok: false, code: 'RESERVATION_FAILED', resourceId: id, reason: 'Réservation complète refusée; réservations nouvelles annulées.' };
                }
                added.push(id);
            }
        }
        catch (error) {
            for (const previous of added)
                this.cantonManager.release(previous, ownerId);
            finish?.(false);
            throw error;
        }
        this.claims.set(key(routeId, ownerId), { routeId, ownerId, reservedEpochMs: simEpochMs, committedEpochMs: null, heldCantonIds: this.cantonIds(route) });
        this.lockChanges(ownerId, beforeLocks, simEpochMs);
        finish?.(true);
        return { ok: true, code: 'RESERVED' };
    }
    canReserveRoute(routeId, ownerId) {
        const route = this.routes.get(routeId);
        return route ? this.conflict(route, ownerId) || { ok: true, code: 'AVAILABLE' } : { ok: false, code: 'MISSING_ROUTE' };
    }
    pruneIdleRoutes(retainIds) {
        const retain = new Set(retainIds);
        for (const claim of this.claims.values())
            retain.add(claim.routeId);
        for (const id of this.routes.keys())
            if (!retain.has(id))
                this.routes.delete(id);
    }
    transferOwner(from, to) {
        if (!from || !to || from === to)
            return;
        const before = this.lockSnapshot(from);
        for (const claim of [...this.claims.values()])
            if (claim.ownerId === from) {
                this.claims.delete(key(claim.routeId, from));
                const existing = this.claims.get(key(claim.routeId, to));
                this.claims.set(key(claim.routeId, to), existing ? { ...existing, heldCantonIds: unique([...existing.heldCantonIds, ...claim.heldCantonIds]),
                    committedEpochMs: existing.committedEpochMs ?? claim.committedEpochMs } : { ...claim, ownerId: to });
            }
        const after = this.lockSnapshot(to);
        for (const [resourceId, kind] of before)
            if (after.has(resourceId))
                this.cantonManager.emitResourceEvent?.({ resourceId, kind, previousServiceId: from, serviceId: to, type: 'transfer', simEpochMs: this.cantonManager.getSimulationEpochMs?.() ?? 0 });
    }
    commitApproach(routeId, ownerId, simEpochMs) {
        if (!Number.isFinite(simEpochMs))
            throw new TypeError('Horloge simulée absolue requise.');
        const claim = this.claims.get(key(routeId, ownerId));
        if (!claim)
            return { ok: false, code: 'NOT_RESERVED' };
        if (claim.committedEpochMs == null) {
            const before = this.lockSnapshot(ownerId);
            claim.committedEpochMs = simEpochMs;
            this.lockChanges(ownerId, before, simEpochMs);
        }
        return { ok: true, code: 'APPROACH_LOCKED' };
    }
    protectedCantonIds(ownerId) {
        return new Set([...this.claims.values()].filter(claim => claim.ownerId === ownerId).flatMap(claim => claim.heldCantonIds));
    }
    dropCanton(id, claim) {
        if (![...this.claims.values()].some(other => other !== claim && other.ownerId === claim.ownerId && other.heldCantonIds.includes(id)))
            this.cantonManager.release(id, claim.ownerId);
        claim.heldCantonIds = claim.heldCantonIds.filter(value => value !== id);
    }
    cancelRoute(routeId, ownerId, simEpochMs) {
        if (!Number.isFinite(simEpochMs))
            throw new TypeError('Horloge simulée absolue requise.');
        const claim = this.claims.get(key(routeId, ownerId));
        if (!claim)
            return { ok: true, code: 'NO_CLAIM' };
        if (claim.committedEpochMs != null)
            return { ok: false, code: 'APPROACH_LOCKED', ownerId, reason: 'Signal engagé : libération après dégagement physique complet.' };
        if (claim.heldCantonIds.some(id => this.cantonManager.cantons.get(id)?.occupiedBy === ownerId))
            return { ok: false, code: 'OCCUPIED', ownerId, reason: 'La formation occupe encore une ressource protégée.' };
        const before = this.lockSnapshot(ownerId);
        for (const id of claim.heldCantonIds.slice())
            this.dropCanton(id, claim);
        this.claims.delete(key(routeId, ownerId));
        this.lockChanges(ownerId, before, simEpochMs);
        return { ok: true, code: 'CANCELLED' };
    }
    releaseCleared(ownerId, progress) {
        if (![progress.frontKm, progress.lengthM, progress.simEpochMs].every(Number.isFinite) || progress.lengthM < 0)
            throw new TypeError('Empreinte avant/queue et horloge simulée absolue requises.');
        const tailKm = progress.frontKm - progress.lengthM / 1000, released = [];
        const before = this.lockSnapshot(ownerId);
        for (const claim of [...this.claims.values()]) {
            if (claim.ownerId !== ownerId || progress.routeId && progress.routeId !== claim.routeId)
                continue;
            const route = this.routes.get(claim.routeId);
            const lockedUntil = claim.committedEpochMs == null ? -Infinity : claim.committedEpochMs + route.approachLockSec * 1000;
            for (const id of claim.heldCantonIds.slice()) {
                const assignment = route.assignments.find(value => value.cantonId === id);
                const protectedRole = route.flankCantonIds.includes(id) || route.overlapCantonIds.includes(id);
                const end = protectedRole ? route.releaseAtKm : assignment?.endKm ?? route.releaseAtKm;
                if (tailKm > end + 1e-6 && progress.frontKm > end + 1e-6 && progress.simEpochMs >= lockedUntil)
                    this.dropCanton(id, claim);
            }
            if (!claim.heldCantonIds.length && tailKm > route.releaseAtKm + 1e-6 && progress.simEpochMs >= lockedUntil) {
                this.claims.delete(key(claim.routeId, ownerId));
                released.push(claim.routeId);
            }
        }
        this.lockChanges(ownerId, before, progress.simEpochMs);
        return released;
    }
    speedLimitKmh(routeId) {
        const values = this.routes.get(routeId)?.switches.map(value => Number(value.speedLimitKmh)).filter(value => Number.isFinite(value) && value > 0) || [];
        return values.length ? Math.min(...values) : Infinity;
    }
    toSave() {
        return { schemaVersion: 1, routes: [...this.routes.values()].map(route => ({ ...route, assignments: route.assignments.map(value => ({ ...value, resourceIds: value.resourceIds?.slice() })),
                switches: route.switches.map(value => ({ ...value })), flankCantonIds: route.flankCantonIds.slice(), overlapCantonIds: route.overlapCantonIds.slice() })).sort((a, b) => a.id.localeCompare(b.id)),
            claims: [...this.claims.values()].map(claim => ({ ...claim, heldCantonIds: claim.heldCantonIds.slice() })).sort((a, b) => key(a.routeId, a.ownerId).localeCompare(key(b.routeId, b.ownerId))) };
    }
    loadFromSave(snapshot, options = {}) {
        if (this.claims.size && !options.mergeExisting)
            throw new Error('Rechargement interdit sur un enclenchement actif.');
        if (!options.mergeExisting)
            this.routes.clear();
        if (snapshot?.schemaVersion !== 1)
            return { ok: true, errors: [] };
        const errors = [];
        for (const route of snapshot.routes || []) {
            try {
                this.bindRoute(route);
            }
            catch (error) {
                errors.push({ ok: false, code: 'INVALID_SAVED_ROUTE', resourceId: route.id, reason: String(error) });
            }
        }
        for (const saved of snapshot.claims || []) {
            const route = this.routes.get(saved.routeId);
            if (!route || !saved.ownerId || !Number.isFinite(saved.reservedEpochMs) || saved.committedEpochMs != null && !Number.isFinite(saved.committedEpochMs)
                || !saved.heldCantonIds?.every(id => this.cantonIds(route).includes(id))) {
                errors.push({ ok: false, code: 'INVALID_SAVED_CLAIM', ownerId: saved.ownerId });
                continue;
            }
            // Restore only still-held sections; progressively released blocks remain free.
            const current = { ...route, assignments: route.assignments.filter(value => saved.heldCantonIds.includes(value.cantonId)),
                flankCantonIds: route.flankCantonIds.filter(id => saved.heldCantonIds.includes(id)), overlapCantonIds: route.overlapCantonIds.filter(id => saved.heldCantonIds.includes(id)) };
            const failure = this.conflict(current, saved.ownerId);
            if (failure) {
                errors.push(failure);
                continue;
            }
            const added = [];
            let failed = null;
            for (const id of unique(saved.heldCantonIds)) {
                const canton = this.cantonManager.cantons.get(id);
                if (canton.occupiedBy === saved.ownerId || canton.reservedBy === saved.ownerId)
                    continue;
                if (!this.cantonManager.reserve(id, saved.ownerId)) {
                    failed = id;
                    break;
                }
                added.push(id);
            }
            if (failed) {
                for (const id of added)
                    this.cantonManager.release(id, saved.ownerId);
                errors.push({ ok: false, code: 'RESTORE_CONFLICT', resourceId: failed });
                continue;
            }
            this.claims.set(key(saved.routeId, saved.ownerId), { ...saved, heldCantonIds: unique(saved.heldCantonIds) });
        }
        return { ok: errors.length === 0, errors };
    }
    capacityIntervals(movements) {
        const intervals = [];
        for (const movement of movements) {
            const route = this.routes.get(movement.routeId);
            if (!route || !movement.id || !Number.isFinite(movement.startEpochMs) || !Number.isFinite(movement.speedKmh) || movement.speedKmh <= 0 || !Number.isFinite(movement.lengthM) || movement.lengthM < 0)
                throw new TypeError('Mouvement prévisionnel et itinéraire canoniques requis.');
            const speedMs = movement.speedKmh / 3.6;
            const clearanceSec = Math.max(0, Number(movement.signalClearanceSec ?? 5));
            const brakeMs2 = Math.max(.05, Number(movement.brakeMs2 ?? .7));
            const headwaySec = movement.lengthM / speedMs + speedMs / (2 * brakeMs2) + clearanceSec;
            const routeEnd = movement.startEpochMs + (route.releaseAtKm * 1000 / speedMs + headwaySec) * 1000;
            const addCanton = (id, start, end) => {
                const resources = [...(this.cantonManager.cantons.get(id)?.resourceIds || [])];
                for (const resource of resources.length ? resources : [id])
                    intervals.push({ movementId: movement.id, resourceId: `track:${resource}`, startEpochMs: start, endEpochMs: end });
            };
            for (const assignment of route.assignments)
                addCanton(assignment.cantonId, movement.startEpochMs + assignment.startKm * 1000 / speedMs * 1000, movement.startEpochMs + (assignment.endKm * 1000 / speedMs + headwaySec) * 1000);
            for (const id of unique([...route.flankCantonIds, ...route.overlapCantonIds]))
                addCanton(id, movement.startEpochMs, routeEnd);
            for (const required of route.switches)
                intervals.push({ movementId: movement.id, resourceId: `switch:${required.id}`, position: required.position, startEpochMs: movement.startEpochMs, endEpochMs: routeEnd });
            const platform = movement.platform;
            if (platform && platform.id && Number.isFinite(platform.startEpochMs) && Number.isFinite(platform.endEpochMs) && platform.endEpochMs > platform.startEpochMs)
                intervals.push({ movementId: movement.id, resourceId: `platform:${platform.id}`, startEpochMs: platform.startEpochMs, endEpochMs: platform.endEpochMs });
        }
        // A flank/overlap can cover a primary segment too: merge that movement's
        // overlapping demand, so one train is not counted twice in saturation.
        const groups = new Map();
        for (const interval of intervals) {
            const id = JSON.stringify([interval.movementId, interval.resourceId, interval.position]);
            const rows = groups.get(id) || [];
            rows.push(interval);
            groups.set(id, rows);
        }
        const merged = [];
        for (const rows of groups.values()) {
            rows.sort((a, b) => a.startEpochMs - b.startEpochMs);
            let previous = null;
            for (const row of rows) {
                if (previous && row.startEpochMs <= previous.endEpochMs)
                    previous.endEpochMs = Math.max(previous.endEpochMs, row.endEpochMs);
                else {
                    previous = { ...row };
                    merged.push(previous);
                }
            }
        }
        return merged;
    }
    capacityConflicts(movements) {
        const byResource = new Map();
        for (const interval of this.capacityIntervals(movements)) {
            const rows = byResource.get(interval.resourceId) || [];
            rows.push(interval);
            byResource.set(interval.resourceId, rows);
        }
        const conflicts = [], seen = new Set();
        for (const [resourceId, rows] of byResource) {
            rows.sort((a, b) => a.startEpochMs - b.startEpochMs || a.movementId.localeCompare(b.movementId));
            let active = [];
            for (const row of rows) {
                active = active.filter(previous => previous.endEpochMs > row.startEpochMs);
                for (const previous of active) {
                    if (previous.movementId === row.movementId || previous.position != null && previous.position === row.position)
                        continue;
                    const pair = [previous.movementId, row.movementId].sort(), uniqueKey = JSON.stringify([resourceId, ...pair]);
                    if (seen.has(uniqueKey))
                        continue;
                    seen.add(uniqueKey);
                    conflicts.push({ a: pair[0], b: pair[1], resourceId, startEpochMs: row.startEpochMs, endEpochMs: Math.min(previous.endEpochMs, row.endEpochMs) });
                }
                active.push(row);
            }
        }
        return conflicts;
    }
    capacityMatrix(movements, window) {
        const binMs = Number(window.binSeconds ?? 300) * 1000;
        if (![window.startEpochMs, window.endEpochMs, binMs].every(Number.isFinite) || binMs < 1000 || window.endEpochMs <= window.startEpochMs || (window.endEpochMs - window.startEpochMs) / binMs > 1000000)
            throw new TypeError('Fenêtre de capacité finie requise.');
        const bins = new Map();
        for (const interval of this.capacityIntervals(movements)) {
            const start = Math.max(window.startEpochMs, interval.startEpochMs), end = Math.min(window.endEpochMs, interval.endEpochMs);
            for (let at = window.startEpochMs + Math.floor((start - window.startEpochMs) / binMs) * binMs; at < end; at += binMs) {
                const id = JSON.stringify([interval.resourceId, at]);
                const entry = bins.get(id) || { row: { resourceId: interval.resourceId, startEpochMs: at, demandSeconds: 0, utilization: 0, movementIds: [] }, owners: new Set() };
                entry.row.demandSeconds += Math.max(0, Math.min(end, at + binMs) - Math.max(start, at)) / 1000;
                entry.owners.add(interval.movementId);
                bins.set(id, entry);
            }
        }
        return [...bins.values()].map(({ row, owners }) => ({ ...row, utilization: row.demandSeconds / (Math.min(binMs, window.endEpochMs - row.startEpochMs) / 1000), movementIds: [...owners].sort() }))
            .sort((a, b) => a.resourceId.localeCompare(b.resourceId) || a.startEpochMs - b.startEpochMs);
    }
}
