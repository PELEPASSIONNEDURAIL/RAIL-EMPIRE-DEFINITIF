import { CompositeCouplingAuthority } from './composite-coupling.js';
import { CompositeConvoyRegistry } from './composite-convoy.js';
import { CompositeCommercialLedger, attachCompositeCommercialFollowers, detachCompositeCommercialFollowers } from './composite-commercial.js';
import { cantonManager } from './schedule-creator.js';
import { FormationRole } from './rotation-v2-model.js';
import { materialTrackLocation } from './material-track-location.js';
import { captureCompositeRuntimeCheckpoint, restoreCompositeRuntimeCheckpoint, releaseCompositeRuntimeAfterSplit } from './composite-runtime-persistence.js';
export function supportsCompositeRuntimeTopology(group, isTerminalLocation) {
    if (!group?.events?.length || !group.sharedSections?.length)
        return false;
    const sections = group.sharedSections;
    if (sections.some(s => s.participants.length < 2 ||
        new Set(s.participants.map(p => p.scheduleId)).size !== s.participants.length ||
        s.masterScheduleId && !s.participants.some(p => p.scheduleId === s.masterScheduleId)))
        return false;
    const active = new Map((group.memberScheduleIds?.length ? group.memberScheduleIds :
        [...new Set(sections.flatMap(s => s.participants.map(p => p.scheduleId)))])
        .map(id => [id, id]));
    const matches = (a, b) => a.length === b.length && a.every(id => b.includes(id));
    let initialJoin = false;
    for (const event of group.events) {
        const ids = event.participants.map(p => p.scheduleId);
        if (ids.length < 2 || new Set(ids).size !== ids.length || ids.some(id => !active.has(id)))
            return false;
        const owners = new Set(ids.map(id => active.get(id)));
        if (event.type === 'JOIN') {
            const section = sections.find(s => matches(s.participants.map(p => p.scheduleId), ids) &&
                s.participants.every(p => event.participants.some(member => member.scheduleId === p.scheduleId &&
                    member.locationId === p.fromLocationId)));
            if (owners.size < 2 || [...active].some(([id, owner]) => owners.has(owner) && !ids.includes(id)) ||
                !section)
                return false;
            initialJoin = true;
            for (const id of ids)
                active.set(id, section.participants[0].scheduleId);
        }
        else if (event.type === 'SPLIT') {
            if (!initialJoin || owners.size !== 1 ||
                !sections.some(s => matches(s.participants.map(p => p.scheduleId), ids) && s.participants.every(p => event.participants.some(member => member.scheduleId === p.scheduleId && member.locationId === p.toLocationId))))
                return false;
            const retained = event.retainsLocomotiveScheduleId || ids[0];
            if (!ids.includes(retained))
                return false;
            const saved = event.outputGroups?.length ? event.outputGroups : [];
            const output = saved.length && saved.every(row => row.length === 1 && ids.includes(row[0]))
                ? [...saved, ...ids.filter(id => !saved.some(row => row[0] === id)).map(id => [id])]
                : saved.length ? saved : ids.map(id => [id]);
            if (output.length < 2 || !matches(output.flat(), ids) ||
                new Set(output.flat()).size !== ids.length || output.some(row => !row.length))
                return false;
            for (const row of output) {
                if (row.length > 1 && !sections.some(s => matches(s.participants.map(p => p.scheduleId), row) &&
                    s.participants.every(p => event.participants.some(member => member.scheduleId === p.scheduleId &&
                        member.locationId === p.fromLocationId))))
                    return false;
                for (const id of row)
                    active.set(id, row.includes(retained) ? retained : row[0]);
            }
        }
        else
            return false;
    }
    if (!initialJoin)
        return false;
    return [...active].every(([id, owner]) => id === owner ||
        sections.some(s => s.participants.some(p => p.scheduleId === id && p.toLocationId) &&
            s.participants.some(p => p.scheduleId === owner) &&
            s.participants.every(p => active.get(p.scheduleId) === owner &&
                (!isTerminalLocation || isTerminalLocation(p.scheduleId, p.toLocationId))) &&
            !sections.some(next => next.id !== s.id && next.participants.some(p => p.scheduleId === id && p.fromLocationId === s.participants.find(last => last.scheduleId === id)?.toLocationId))));
}
const activeRole = (role) => [FormationRole.LEAD, FormationRole.ACTIVE_MULTIPLE, FormationRole.PUSHER].includes(role);
const identity = (stop) => stop?.trackIdentity?.kind === 'native'
    ? `voie:${stop.trackIdentity.id}` : stop?.trackIdentity?.kind === 'osm'
    ? `way:${String(stop.trackIdentity.id).replace(/^way[-/]/, '')}|ref:${stop.trackIdentity.trackRef}` : '';
const direction = (route, end = 'destination') => {
    if (!route || route.length < 2)
        return null;
    const a = end === 'origin' ? route[0] : route[route.length - 2];
    const b = end === 'origin' ? route[1] : route[route.length - 1];
    const north = (Number(b.lat) - Number(a.lat)) * 111195;
    const east = (Number(b.lon) - Number(a.lon)) * 111195 * Math.cos(Number(a.lat) * Math.PI / 180);
    const magnitude = Math.hypot(north, east);
    return magnitude > 0 ? { north: north / magnitude, east: east / magnitude } : null;
};
const pairKey = (date, groupId) => `${date}\u0000${groupId}`;
const segmentKm = (route) => {
    let km = 0;
    for (let i = 1; i < (route?.length || 0); i++) {
        const a = route[i - 1], b = route[i];
        const p = Math.PI / 180, dLat = (b.lat - a.lat) * p, dLon = (b.lon - a.lon) * p;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLon / 2) ** 2;
        km += 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    return km;
};
const commercialApproach = (service, joinIndex) => {
    let previous = joinIndex - 1;
    while (previous > 0 && service.stops[previous]?.type !== 'arret')
        previous--;
    const legs = (service.routes || []).slice(previous, joinIndex);
    return { route: legs.flatMap(r => r || []),
        distanceKm: legs.reduce((km, r) => km + segmentKm(r || []), 0) };
};
/** Isolated RC30 prototype. The production runtime never constructs this bridge.
 * It owns the physical handoff; commercial sidecars never enter the movement fleet. */
export class CompositeRuntimeBridge {
    constructor(host) {
        this.host = host;
        this.authority = new CompositeCouplingAuthority();
        this.registry = new CompositeConvoyRegistry();
        this.ledger = new CompositeCommercialLedger();
        this.originalFormations = new Map();
        this.approachFormations = new Map();
        this.approaching = new Map();
        this.splitHolds = new Map();
        this.arrivalBase = new Map();
        this.missed = new Set();
        host.game.compositeCouplingAuthority = this.authority;
    }
    captureJoinDecisions() { return [...this.missed].map(key => { const [serviceDate, eventId] = key.split('\u0000'); return { serviceDate, eventId }; }); }
    stageJoinDecisions(raw) {
        if (raw == null)
            return [];
        if (!Array.isArray(raw) || raw.length > 2048)
            return null;
        const staged = [], seen = new Set();
        for (const row of raw) {
            if (!row || typeof row !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(row.serviceDate) || !Number.isFinite(Date.parse(row.serviceDate)) || typeof row.eventId !== 'string' || !(this.host.game.scheduleV2?.compositeGroups || []).some((g) => g.events.some(e => e.id === row.eventId && e.type === 'JOIN')))
                return null;
            const key = pairKey(row.serviceDate, row.eventId);
            if (seen.has(key))
                return null;
            seen.add(key);
            staged.push({ serviceDate: row.serviceDate, eventId: row.eventId });
        }
        return staged;
    }
    restoreJoinDecisions(staged) { this.missed = new Set(staged.map(row => pairKey(row.serviceDate, row.eventId))); }
    cancelPendingJoin(service, request = {}) {
        const group = this.linkedGroup(String(service?._v2ScheduleId || '')), baseDate = String(service?._v2BaseDate || '');
        if (!group || group.state !== 'VALID' || !baseDate)
            return { ok: false, message: 'Aucune jonction composite validée pour cette circulation.' };
        if (service._physicalCouplingId || this.registry.activeConvoys().some(c => c.groupId === group.id && c.serviceDate === baseDate && c.portions.some(p => p.serviceId === service.id)))
            return { ok: false, message: 'Convoi déjà joint : une coupe physique validée est requise.' };
        const joins = group.events.filter(e => e.type === 'JOIN' && e.participants.some(p => p.scheduleId === service._v2ScheduleId) && (!request.eventId || e.id === request.eventId));
        if (joins.length !== 1)
            return { ok: false, message: 'Précisez la jonction à annuler.' };
        const join = joins[0], section = group.sharedSections.find(s => s.participants.every(p => join.participants.some(ep => ep.scheduleId === p.scheduleId && ep.locationId === p.fromLocationId)));
        if (!section)
            return { ok: false, message: 'Section de jonction introuvable.' };
        const members = section.participants.map(p => (this.host.game.scheduleCreator?.services || []).filter((s) => s._v2ScheduleId === p.scheduleId && s._v2BaseDate === baseDate && !s.completed && !s.cancelled));
        if (members.some(list => list.length !== 1) || members.flat().some((s) => this.registry.ownerFor(s.id) && this.registry.ownerFor(s.id) !== s.id || s._physicalCouplingId || !(s._v2FormationMembers || []).some(m => activeRole(m.role) && Number(this.host.game.rotationV2?.getVehicle?.(m.vehicleId)?.powerW) > 0)))
            return { ok: false, message: 'Chaque portion doit conserver sa propre traction réelle disponible pour partir séparément.' };
        const ids = members.flat().flatMap((s) => (s._v2FormationMembers || []).map(m => m.vehicleId));
        if (new Set(ids).size !== ids.length)
            return { ok: false, message: 'Véhicule partagé par plusieurs portions indépendantes.' };
        const key = pairKey(baseDate, join.id);
        if (this.missed.has(key))
            return { ok: true, message: 'Jonction déjà annulée pour ce jour.' };
        this.missed.add(key);
        const pending = this.approaching.get(pairKey(baseDate, section.id));
        if (pending)
            this.authority.revokeChain(pending.owner.id);
        else
            for (const member of members.flat())
                this.authority.revokeChain(member.id);
        this.approaching.delete(pairKey(baseDate, section.id));
        this.host.game.emitDomainEvent?.({ eventId: `composite-cancel:${baseDate}:${join.id}`, simEpochMs: this.host.game.engine?.getSimulationEpochMs?.() || 0, type: 'compositeJoinCancelled', resourceIds: ids, payload: { groupId: group.id, eventId: join.id, serviceDate: baseDate } });
        return { ok: true, message: 'Jonction annulée pour ce jour ; portions motorisées indépendantes sous signalisation ordinaire.' };
    }
    captureCheckpoint(services) {
        if (!this.registry.activeConvoys().length)
            return null;
        return captureCompositeRuntimeCheckpoint(this.registry, this.ledger, services, [...this.originalFormations].map(([serviceId, members]) => ({ serviceId, members })), [...this.approachFormations].map(([serviceId, members]) => ({ serviceId, members })));
    }
    captureSplitHolds() {
        return [...this.splitHolds.values()].map(hold => ({ ownerId: hold.owner.id,
            followerId: hold.follower.id, stationId: hold.stationId, stockId: String(hold.stockId || '') }));
    }
    validateCheckpointGroups(staged) {
        return staged.registry.joined.every(convoy => {
            const group = this.host.game.scheduleV2?.getCompositeGroup?.(convoy.groupId) ||
                this.host.game.scheduleV2?.compositeGroups?.find((g) => g.id === convoy.groupId);
            const section = group?.sharedSections?.find((s) => s.id === convoy.sectionId);
            const schedules = convoy.portions.map(p => p.scheduleId);
            return group?.state === 'VALID' && section?.participants?.length === schedules.length &&
                section.participants.every((p) => schedules.includes(p.scheduleId)) &&
                (group.events?.some((e) => e.type === 'SPLIT' && schedules.every(scheduleId => e.participants.some(p => p.scheduleId === scheduleId))) ||
                    section.participants.every((p) => {
                        const version = this.host.game.scheduleV2?.getSchedule?.(p.scheduleId)?.currentVersion;
                        return version?.locations?.at(-1)?.id === p.toLocationId;
                    }));
        });
    }
    restoreCheckpoint(staged, services) {
        if (!this.validateCheckpointGroups(staged))
            return false;
        if (!restoreCompositeRuntimeCheckpoint(staged, this.registry, this.ledger, services))
            return false;
        for (const row of staged.formations)
            this.originalFormations.set(row.serviceId, row.members.map(member => ({ ...member })));
        for (const row of staged.approachFormations || [])
            this.approachFormations.set(row.serviceId, row.members.map(member => ({ ...member })));
        for (const convoy of this.registry.activeConvoys()) {
            const owner = services.find(s => s.id === convoy.ownerServiceId);
            const followers = convoy.portions.filter(p => p.serviceId !== owner?.id)
                .map(p => services.find(s => s.id === p.serviceId));
            const group = this.host.game.scheduleV2?.getCompositeGroup?.(convoy.groupId) ||
                this.host.game.scheduleV2?.compositeGroups?.find((g) => g.id === convoy.groupId);
            if (!owner || followers.some(s => !s) || !followers.length || !group ||
                !group.sharedSections?.some((section) => section.id === convoy.sectionId))
                return false;
            this.host._refreshRuntimeFormation(owner);
            for (const follower of followers)
                this.host._refreshRuntimeFormation(follower);
            this.wireJoined(owner, followers, group, convoy.sectionId);
            owner.active = !(this.host.game.scheduleV2Runtime?._pendingCompositeSplitHolds || [])
                .some(row => row.followerId === owner.id);
            for (const follower of followers) {
                follower.active = false;
                follower.position = null;
                follower._v2VehicleIds = [];
            }
        }
        this.host.game.scheduleCreator?._invalidateActiveCache?.();
        return true;
    }
    restoreSplitHolds(rows, services) {
        const staged = new Map();
        for (const row of rows) {
            const owner = services.find(s => s.id === row.ownerId);
            const follower = services.find(s => s.id === row.followerId);
            const stock = this.host.game.rotationV2?.getVehicle?.(row.stockId);
            if (!owner || !follower || owner === follower || staged.has(row.followerId) ||
                follower.active !== false || follower.state !== 'stopped_at_station' ||
                !owner._v2VehicleIds?.length || !follower._v2VehicleIds?.includes(row.stockId) ||
                owner._v2VehicleIds.some((id) => follower._v2VehicleIds?.includes(id)) ||
                !stock || stock.available || !this.host.game.world?.getStationById?.(row.stationId))
                return false;
            staged.set(row.followerId, { owner, follower, stationId: row.stationId, stockId: row.stockId });
        }
        this.splitHolds = staged;
        return true;
    }
    linkedGroup(scheduleId) {
        return (this.host.game.scheduleV2?.listCompositeGroups?.(scheduleId) || []).find((group) => group.sharedSections?.some(section => section.participants.some(part => part.scheduleId === scheduleId))) || null;
    }
    /** Recomputed from the live formation on every tick, including after F5. */
    joinApproachGate(service, stop) {
        if (!service?._v2ScheduleId || !stop?.locationOccurrenceId || !stop.voiePointId)
            return null;
        const group = this.linkedGroup(String(service._v2ScheduleId));
        if (group?.state !== 'VALID')
            return null;
        const join = group.events?.find(event => event.type === 'JOIN' &&
            event.participants.some(part => part.scheduleId === service._v2ScheduleId &&
                part.locationId === stop.locationOccurrenceId));
        if (!join || this.missed.has(pairKey(String(service._v2BaseDate || ''), join.id)))
            return null;
        const section = group.sharedSections?.find(candidate => candidate.participants.every(part => join.participants.some(member => member.scheduleId === part.scheduleId &&
            member.locationId === part.fromLocationId)));
        const index = section?.participants.findIndex(part => part.scheduleId === service._v2ScheduleId);
        if (!(Number(index) > 0) || identity(stop) !== join.trackIdentity ||
            String(stop.stationId) !== String(join.stationId))
            return null;
        const berth = this.host.game.voiePointManager?.getVoiePointById?.(stop.voiePointId);
        if (!berth || String(berth.stationId) !== String(join.stationId) ||
            !(Number(berth.usableLengthM) > 0))
            return null;
        const services = this.host.game.scheduleCreator?.services || [];
        const ahead = [], seen = new Set();
        for (const part of section.participants.slice(0, index)) {
            const member = services.find((s) => s._v2ScheduleId === part.scheduleId &&
                s._v2BaseDate === service._v2BaseDate && !s.completed && !s.cancelled);
            const physicalId = member && (this.registry.ownerFor(member.id) || member.id);
            const physical = services.find((s) => s.id === physicalId);
            const memberStop = member?.stops.find((s) => s.locationOccurrenceId === part.fromLocationId);
            if (!physical || !memberStop || memberStop.voiePointId !== stop.voiePointId ||
                identity(memberStop) !== join.trackIdentity)
                return null;
            if (!seen.has(physical.id)) {
                ahead.push(physical);
                seen.add(physical.id);
            }
        }
        const standOffM = ahead.reduce((sum, train) => sum + Math.max(1, Number(train.rame?.totalLength || 20)) + 12, 0);
        const master = ahead[0];
        if (!master)
            return null;
        const authorized = this.authority.isAuthorized(master.id, service.id);
        return { hold: !authorized, standOffM, stationId: join.stationId, berthPointId: stop.voiePointId };
    }
    onCompiled(service) {
        const group = this.linkedGroup(String(service._v2ScheduleId || ''));
        if (!group)
            return;
        service._v2CompositeDepartureAllowed = (stop, dateStr, timeOfDay) => {
            const join = group.events.find(event => event.type === 'JOIN' &&
                event.participants.some(p => p.scheduleId === service._v2ScheduleId && p.locationId === stop?.locationOccurrenceId));
            if (join) {
                const joinedSection = group.sharedSections.find(section => section.participants.every(p => join.participants.some(member => member.scheduleId === p.scheduleId &&
                    member.locationId === p.fromLocationId)));
                if (joinedSection && this.registry.activeConvoys().some(c => c.serviceDate === service._v2BaseDate &&
                    c.groupId === group.id && c.sectionId === joinedSection.id && c.ownerServiceId === service.id))
                    return true;
                const key = pairKey(String(service._v2BaseDate || ''), join.id);
                const baseDay = Date.parse(`${service._v2BaseDate}T00:00:00Z`);
                const nowDay = Date.parse(`${dateStr}T00:00:00Z`);
                const booked = Number(stop?.departureTime);
                const missedTime = Number.isFinite(baseDay) && Number.isFinite(nowDay) &&
                    Number.isFinite(timeOfDay) && Number.isFinite(booked) &&
                    (nowDay - baseDay) / 86400000 * 1440 + timeOfDay >= booked + 5;
                if (!missedTime && !this.missed.has(key))
                    return false;
                const berth = this.host.game.voiePointManager?.getVoiePointById?.(stop?.voiePointId);
                if (!berth || String(berth.stationId) !== join.stationId ||
                    !Number.isFinite(Number(berth.usableLengthM)) || Number(berth.usableLengthM) <= 0)
                    return false;
                const powered = (service._v2FormationMembers || []).some(member => activeRole(member.role) &&
                    Number(this.host.game.rotationV2?.getVehicle?.(member.vehicleId)?.powerW || 0) > 0);
                if (!powered || String(service.train?.stoppedAt?.id || '') !== join.stationId)
                    return false;
                if (!this.missed.has(key)) {
                    this.missed.add(key);
                    if (joinedSection)
                        this.approaching.delete(pairKey(String(service._v2BaseDate || ''), joinedSection.id));
                    const ownerId = joinedSection?.participants?.[0]?.scheduleId;
                    const owner = (this.host.game.scheduleCreator?.services || []).find((s) => s._v2ScheduleId === ownerId && s._v2BaseDate === service._v2BaseDate);
                    if (owner)
                        this.authority.revokeChain(owner.id);
                    this.host._pushAlert('WARNING', 'COMPOSITE_JOIN_MISSED', 'Jonction manquée : les portions motorisées poursuivent séparément sous signalisation ordinaire.', { groupId: group.id, baseDate: service._v2BaseDate });
                }
                return true;
            }
            const split = group.events.find(event => event.type === 'SPLIT' &&
                event.participants.some(p => p.scheduleId === service._v2ScheduleId && p.locationId === stop?.locationOccurrenceId));
            if (split && this.registry.activeConvoys().some(c => c.serviceDate === service._v2BaseDate &&
                c.groupId === group.id && c.portions.some(p => p.serviceId === service.id) &&
                group.sharedSections.find(s => s.id === c.sectionId)?.participants.some(p => p.scheduleId === service._v2ScheduleId && p.toLocationId === stop?.locationOccurrenceId)))
                return false;
            return !this.splitHolds.has(service.id);
        };
    }
    adapter(service, joinStop, route, end) {
        const heading = direction(route, end);
        if (!heading)
            return null;
        return {
            get id() { return service.id; }, get active() { return service.active; },
            get completed() { return service.completed; }, get cancelled() { return service.cancelled; },
            get state() { return service.state; }, get position() { return service.position; },
            get speed() { return service.speed; }, get lengthM() { return service.rame?.totalLength || 0; },
            get trackIdentity() { return identity(joinStop); },
            get routeWayId() { return String((end === 'origin' ? route[0] : route.at(-1))?.wayId || ''); },
            get direction() { return heading; },
        };
    }
    pair(group, sectionId, date, serviceIndex) {
        const section = group.sharedSections.find(s => s.id === sectionId);
        const join = group.events.find(e => e.type === 'JOIN' && section?.participants.every(p => e.participants.some(member => member.scheduleId === p.scheduleId && member.locationId === p.fromLocationId)));
        if (!section || !join)
            return null;
        if (section.participants.length < 2)
            return null;
        const services = this.host.game.scheduleCreator.services;
        const choices = section.participants.map(p => (serviceIndex?.get(pairKey(date, p.scheduleId)) ||
            services.filter(s => s._v2ScheduleId === p.scheduleId && s._v2BaseDate === date && !s.completed && !s.cancelled)));
        if (choices.some(candidates => candidates.length > 1)) {
            this.host._pushAlert('ERROR', 'COMPOSITE_JOIN_OCCURRENCE_AMBIGUOUS', 'Jonction retenue : plusieurs occurrences du même sillon correspondent à cet événement.', { groupId: group.id, sectionId, baseDate: date });
            return null;
        }
        const found = choices.map(candidates => candidates[0]);
        if (found.some(s => !s))
            return null;
        const physicalIds = [...new Set(found.map(s => this.registry.ownerFor(s.id) || s.id))];
        const physical = physicalIds.map(id => services.find(s => s.id === id));
        if (physical.some(s => !s || !found.includes(s)))
            return null;
        const owner = physical[0], followers = physical.slice(1);
        if (!owner || followers.some(f => !f?.position) || !owner.position || owner.state !== 'stopped_at_station' ||
            String(owner.train?.stoppedAt?.id || owner._platformAssignment?.stationId || '') !== join.stationId)
            return null;
        const joinStop = (service) => service.stops.find(s => s.locationOccurrenceId ===
            section.participants.find(p => p.scheduleId === service._v2ScheduleId)?.fromLocationId);
        const ownerStop = joinStop(owner);
        const followerStops = followers.map(f => joinStop(f));
        if (!ownerStop || identity(ownerStop) !== join.trackIdentity ||
            followerStops.some(stop => !stop || identity(stop) !== join.trackIdentity ||
                stop.voiePointId !== ownerStop.voiePointId))
            return null;
        if (owner.currentStopIndex !== owner.stops.indexOf(ownerStop) + 1 || followers.some((f, index) => f.currentStopIndex !== f.stops.indexOf(followerStops[index])))
            return null;
        const ownerRoute = owner.routes[owner.stops.indexOf(ownerStop)];
        const followerRoutes = followers.map((f, index) => f.routes[f.stops.indexOf(followerStops[index]) - 1]);
        const ownerAdapter = this.adapter(owner, ownerStop, ownerRoute, 'origin');
        const followerAdapters = followers.map((f, index) => this.adapter(f, followerStops[index], followerRoutes[index], 'destination'));
        const station = this.host.game.world?.getStationById?.(join.stationId);
        const berth = this.host.game.voiePointManager?.getVoiePointById?.(ownerStop.voiePointId);
        const usableLengthM = Number(berth?.usableLengthM);
        if (!berth || String(berth.stationId) !== join.stationId ||
            String(berth.voie).trim().toLowerCase() !== String(ownerStop.trackIdentity?.trackRef || '').trim().toLowerCase() ||
            !Number.isFinite(usableLengthM) || usableLengthM <= 0) {
            this.host._pushAlert('ERROR', 'COMPOSITE_JOIN_TRACK_LENGTH_MISSING', 'Jonction retenue : longueur utile de la voie exacte inconnue à la gare de jonction.', { groupId: group.id, stationId: join.stationId });
            return null;
        }
        if (!ownerAdapter || followerAdapters.some(a => !a) || !station || !ownerRoute?.length)
            return null;
        const heading = direction(ownerRoute, 'origin');
        if (!heading)
            return null;
        if (!Number.isFinite(Number(berth.lat)) || !Number.isFinite(Number(berth.lon)))
            return null;
        // Separate incoming OSM ways may converge on one measured station point.
        // This remains tied to each compiled approach and the exact physical berth.
        const approachWayIds = Object.fromEntries(followerAdapters.map(adapter => [adapter.id, adapter.routeWayId]));
        const node = { stationId: join.stationId, trackIdentity: join.trackIdentity,
            lat: Number(berth.lat), lon: Number(berth.lon),
            routeWayId: String(ownerRoute[0].wayId || ''), direction: heading,
            platformLengthM: usableLengthM, trackRef: String(berth.voie),
            berthPointId: String(berth.id), approachWayIds };
        return { owner, follower: followers[0], followers: followers,
            members: found, group, sectionId, node,
            ownerAdapter, followerAdapter: followerAdapters[0], followerAdapters: followerAdapters };
    }
    tick(date) {
        this.releaseSplitHolds();
        this.retryPendingSplits();
        this.retryPendingTerminals();
        const groups = (this.host.game.scheduleV2?.compositeGroups || []);
        if (!groups.length)
            return;
        const nowDay = Date.parse(`${date}T00:00:00Z`);
        if (Number.isFinite(nowDay))
            for (const key of this.missed) {
                const day = Date.parse(`${key.split('\u0000')[0]}T00:00:00Z`);
                if (Number.isFinite(day) && day < nowDay - 2 * 86400000)
                    this.missed.delete(key);
            }
        for (const [key, pending] of this.approaching) {
            if (pending.group.state === 'VALID' && !pending.owner.completed && !pending.owner.cancelled &&
                pending.followers.every(f => !f.completed && !f.cancelled) &&
                this.authority.isAuthorized(pending.owner.id, pending.follower.id))
                continue;
            this.authority.revokeChain(pending.owner.id);
            this.approaching.delete(key);
        }
        const dates = new Set([date]), serviceIndex = new Map();
        for (const service of (this.host.game.scheduleCreator?.services || [])) {
            const baseDate = String(service._v2BaseDate || ''), scheduleId = String(service._v2ScheduleId || '');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || !scheduleId)
                continue;
            dates.add(baseDate);
            if (service.completed || service.cancelled)
                continue;
            const key = pairKey(baseDate, scheduleId);
            const matching = serviceIndex.get(key) || [];
            matching.push(service);
            serviceIndex.set(key, matching);
        }
        for (const baseDate of dates)
            for (const group of groups)
                for (const section of group.sharedSections || []) {
                    const sectionJoin = group.events.find(e => e.type === 'JOIN' && section.participants.every(p => e.participants.some(ep => ep.scheduleId === p.scheduleId && ep.locationId === p.fromLocationId)));
                    if (group.state !== 'VALID' || !sectionJoin || this.missed.has(pairKey(baseDate, sectionJoin.id)) ||
                        this.registry.activeConvoys().some(c => c.groupId === group.id && c.serviceDate === baseDate &&
                            c.sectionId === section.id))
                        continue;
                    const key = pairKey(baseDate, section.id);
                    let pair = this.approaching.get(key) || null;
                    if (!pair) {
                        pair = this.pair(group, section.id, baseDate, serviceIndex);
                        if (!pair || !this.authority.grantChain(pair.ownerAdapter, pair.followerAdapters, pair.node).ok)
                            continue;
                        this.approaching.set(key, pair);
                    }
                    const assembled = pair.followers.every((follower, index) => {
                        const predecessor = index ? pair.followers[index - 1] : pair.owner;
                        if (!predecessor.position || !follower.position)
                            return false;
                        const gapM = ((predecessor.position.lat - follower.position.lat) * 111195 * pair.node.direction.north +
                            (predecessor.position.lon - follower.position.lon) * 111195 *
                                Math.cos(pair.node.lat * Math.PI / 180) * pair.node.direction.east) -
                            Number(predecessor.rame?.totalLength || 0);
                        const metresPerLon = 111195 * Math.cos(pair.node.lat * Math.PI / 180);
                        const nearBerth = (s) => !!s.position && Math.hypot((s.position.lat - pair.node.lat) * 111195, (s.position.lon - pair.node.lon) * metresPerLon) <= 40;
                        return follower.speed <= .01 && (gapM >= -.05 && gapM <= 1 ||
                            follower.state === 'stopped_at_station' && nearBerth(predecessor) && nearBerth(follower));
                    });
                    if (!assembled)
                        continue;
                    this.join(pair, key);
                }
    }
    join(pair, key) {
        const { owner, followers, members, group, sectionId, node } = pair;
        const priorFollowerGroups = followers.map(physical => ({ physical,
            shadows: this.registry.activeConvoys().find(c => c.ownerServiceId === physical.id &&
                c.serviceDate === physical._v2BaseDate && c.groupId === group.id)?.portions
                .filter(p => p.serviceId !== physical.id).map(p => members.find(s => s.id === p.serviceId)) || [] }));
        const formations = followers.map(follower => {
            const all = follower._v2FormationMembers || [];
            const powered = all.filter(m => activeRole(m.role));
            const selfPropelled = !!powered.length && powered.every(m => ['automotrice', 'autorail'].includes(String(this.host.game.rotationV2.getVehicle(m.vehicleId)?.category || '').toLowerCase()));
            return { follower, selfPropelled, wagons: selfPropelled ? all : all.filter(m => !activeRole(m.role)),
                engines: selfPropelled ? [] : powered, approachMassKg: follower._currentMassKg() };
        });
        if (formations.some(f => !f.wagons.length || !f.selfPropelled && !f.engines.length))
            return;
        const section = group.sharedSections.find(s => s.id === sectionId);
        const joinEvent = group.events.find(e => e.type === 'JOIN' && section?.participants.every(p => e.participants.some(member => member.scheduleId === p.scheduleId && member.locationId === p.fromLocationId)));
        if (!joinEvent)
            return;
        const portions = members.map(service => {
            const physicalFollower = formations.find(f => f.follower === service);
            const original = this.originalFormations.get(service.id) || service._v2FormationMembers || [];
            const removed = new Set(physicalFollower?.engines.map(m => m.vehicleId) || []);
            const formation = original.filter(m => !removed.has(m.vehicleId));
            const couponLimits = [...new Set(formation.map(m => m.sourceCouponId).filter(Boolean))]
                .map(id => this.host.game.rotationV2?.getCoupon?.(id)?.allowedLocomotiveSeries || [])
                .filter((series) => series.length);
            const allowedLocomotiveSeries = couponLimits.length
                ? couponLimits[0].filter((name) => couponLimits.every((series) => series.includes(name))) : [];
            return { serviceId: service.id, scheduleId: String(service._v2ScheduleId), name: service.name,
                rameId: String(service.rameId), stationId: node.stationId, trackIdentity: node.trackIdentity,
                driveCapable: formation.some(m => activeRole(m.role)), vehicleIds: formation.map(m => m.vehicleId),
                allowedLocomotiveSeries,
                number: String(service.number || '') };
        });
        const resources = { cantons: this.host.game.cantonManager || cantonManager,
            voiePoints: this.host.game.voiePointManager, platforms: this.host.game.platformManager };
        if (!resources.cantons || !resources.voiePoints || !resources.platforms)
            return;
        const joined = this.registry.join(group, sectionId, String(owner._v2BaseDate), portions, () => this.authority.commitChain(pair.ownerAdapter, pair.followerAdapters, node, resources, onRollback => {
            const all = members;
            const savedServices = all.map(service => ({ service,
                members: (service._v2FormationMembers || []).map(m => ({ ...m })),
                vehicleIds: [...(service._v2VehicleIds || [])], active: service.active,
                position: service.position && { ...service.position }, speed: service.speed, trainSpeed: service.train.speed,
                rameDetails: structuredClone(service.rame?.elementDetails || []), rameElements: [...(service.rame?.elements || [])],
                trainMaxSpeed: service.train.maxSpeed, trainAccel: service.train.accel, trainDecel: service.train.decel,
                brakeService: service._v2BrakeServiceMs2, mileageMembers: service._v2MileageMembers,
                mileage: { ...(service._v2VehicleMileageKm || {}) }, mileageRecorded: service._v2MileageRecorded,
                compositeOwnerId: service._v2CompositeOwnerId, compositeFollowers: service._v2CompositeFollowers,
                departureHold: service._departureResourceHold && { ...service._departureResourceHold },
                carriedHolds: (service._carriedDepartureHolds || []).map(hold => ({ ...hold })),
                troncons: new Set(service._occupiedTronconIds), exits: new Map(service._tronconExitTravelKm),
                reservedTroncon: service._reservedTronconId, lastTroncon: service._lastTronconId }));
            const detachedStock = formations.flatMap(f => f.engines.map(m => this.host.game.rotationV2.getVehicle(m.vehicleId)))
                .filter(Boolean).map((stock) => ({ stock, available: stock.available,
                location: stock.location ? structuredClone(stock.location) : stock.location }));
            const oldOriginal = new Map(this.originalFormations), oldApproach = new Map(this.approachFormations);
            const oldLedger = this.ledger.toSave();
            onRollback(() => {
                for (const row of savedServices) {
                    Object.assign(row.service, { _v2FormationMembers: row.members, _v2VehicleIds: row.vehicleIds,
                        active: row.active, position: row.position, speed: row.speed,
                        _v2CompositeOwnerId: row.compositeOwnerId, _v2CompositeFollowers: row.compositeFollowers,
                        _v2BrakeServiceMs2: row.brakeService, _v2MileageMembers: row.mileageMembers,
                        _v2VehicleMileageKm: row.mileage, _v2MileageRecorded: row.mileageRecorded,
                        _departureResourceHold: row.departureHold, _carriedDepartureHolds: row.carriedHolds,
                        _occupiedTronconIds: row.troncons, _tronconExitTravelKm: row.exits,
                        _reservedTronconId: row.reservedTroncon, _lastTronconId: row.lastTroncon });
                    if (row.service.rame) {
                        row.service.rame.elementDetails = row.rameDetails;
                        row.service.rame.elements = row.rameElements;
                    }
                    Object.assign(row.service.train, { speed: row.trainSpeed, maxSpeed: row.trainMaxSpeed,
                        accel: row.trainAccel, decel: row.trainDecel });
                }
                for (const row of detachedStock) {
                    row.stock.available = row.available;
                    row.stock.location = row.location;
                }
                this.originalFormations.clear();
                this.approachFormations.clear();
                for (const [id, members] of oldOriginal)
                    this.originalFormations.set(id, members);
                for (const [id, members] of oldApproach)
                    this.approachFormations.set(id, members);
                this.ledger.loadFromSave(oldLedger);
            });
            for (const physical of [owner, ...followers])
                detachCompositeCommercialFollowers(physical);
            const shadows = members.filter(service => service !== owner);
            if (!attachCompositeCommercialFollowers(owner, shadows))
                return false;
            if (!this.originalFormations.has(owner.id))
                this.originalFormations.set(owner.id, (owner._v2FormationMembers || []).map(m => ({ ...m })));
            for (const { follower, wagons, engines } of formations) {
                const removed = new Set(engines.map(m => m.vehicleId));
                this.originalFormations.set(follower.id, (this.originalFormations.get(follower.id) || follower._v2FormationMembers || [])
                    .filter(m => !removed.has(m.vehicleId)).map(m => ({ ...m })));
                if (engines.length)
                    this.approachFormations.set(follower.id, [
                        ...(this.approachFormations.get(follower.id) || []), ...engines.map(m => ({ ...m }))
                    ]);
            }
            for (const service of members)
                if (!this.originalFormations.has(service.id))
                    this.originalFormations.set(service.id, (service._v2FormationMembers || []).map(m => ({ ...m })));
            for (const { follower } of formations) {
                const prior = this.registry.activeConvoys().find(c => c.ownerServiceId === follower.id &&
                    c.serviceDate === follower._v2BaseDate && c.groupId === group.id);
                if (!prior)
                    continue;
                const credit = follower._v2VehicleMileageKm || {};
                for (const portion of prior.portions.filter(p => p.serviceId !== follower.id)) {
                    const shadow = members.find(s => s.id === portion.serviceId);
                    if (!shadow)
                        return false;
                    const shadowCredit = { ...(shadow._v2VehicleMileageKm || {}) };
                    for (const id of (this.originalFormations.get(shadow.id) || []).map(m => m.vehicleId)) {
                        if (Number.isFinite(credit[id])) {
                            shadowCredit[id] = Math.max(0, Number(shadowCredit[id] || 0)) + credit[id];
                            delete credit[id];
                        }
                    }
                    shadow._v2VehicleMileageKm = shadowCredit;
                    shadow._v2MileageRecorded = true;
                }
                follower._v2VehicleMileageKm = { ...credit };
                follower._v2MileageMembers = undefined;
            }
            for (const service of all)
                this.ledger.capture(service);
            for (const follower of followers) {
                // The follower's nose may meet the owner's rear while its tail still
                // occupies its previous departure point. Transfer that exact claim to
                // the physical owner and release it only after the rear clears it.
                const extraHolds = (follower._carriedDepartureHolds || []).map(hold => ({ ...hold,
                    releaseAtKm: Number(owner.totalDistance || 0) +
                        Math.max(0, Number(hold.releaseAtKm) - Number(follower.totalDistance || 0)) }));
                const hold = follower._departureResourceHold;
                if (hold) {
                    const travelledM = Math.max(0, (Number(follower.totalDistance || 0) -
                        Number(hold.startTravelKm || 0)) * 1000);
                    const remainingM = Math.max(0, Number(follower.rame?.totalLength || 0) - travelledM);
                    extraHolds.push({ ...hold,
                        releaseAtKm: Number(owner.totalDistance || 0) + remainingM / 1000 });
                }
                owner._carriedDepartureHolds = [...(owner._carriedDepartureHolds || []), ...extraHolds];
                follower._departureResourceHold = null;
                follower._carriedDepartureHolds = [];
                for (const id of follower._occupiedTronconIds) {
                    owner._occupiedTronconIds.add(id);
                    if (id !== owner._lastTronconId)
                        owner._tronconExitTravelKm.set(id, Number(owner.totalDistance || 0));
                }
                follower._occupiedTronconIds.clear();
                follower._tronconExitTravelKm.clear();
                if (follower._reservedTronconId) {
                    resources.voiePoints.releaseTronconReservation(follower._reservedTronconId, owner.id);
                    follower._reservedTronconId = null;
                }
                follower._lastTronconId = null;
            }
            // The approach locomotive has brought the unpowered coupon to Givors;
            // park it there before the shared physical formation is assembled.
            const exactStop = owner.stops.find(s => s.locationOccurrenceId === joinEvent.participants.find(p => p.scheduleId === owner._v2ScheduleId)?.locationId);
            const exactBerth = materialTrackLocation(exactStop);
            for (const { follower, wagons, engines } of formations) {
                for (const member of engines) {
                    const stock = this.host.game.rotationV2.getVehicle(member.vehicleId);
                    if (stock) {
                        stock.available = true;
                        stock.location = {
                            ...exactBerth, kind: 'STATION', id: node.stationId, stationId: node.stationId,
                            lat: node.lat, lon: node.lon,
                        };
                    }
                }
                follower._v2FormationMembers = (this.originalFormations.get(follower.id) || []).map(m => ({ ...m }));
                follower._v2VehicleIds = follower._v2FormationMembers.map(m => m.vehicleId);
                owner._v2FormationMembers = [...(owner._v2FormationMembers || []), ...wagons.map(m => ({ ...m }))];
                this.host._refreshRuntimeFormation(follower);
                follower._v2VehicleIds = []; // commercial shadow cannot claim the owner's stock twice
                follower.active = false;
                follower.position = null;
                follower.speed = follower.train.speed = 0;
            }
            this.host._refreshRuntimeFormation(owner);
            return true;
        }).ok);
        if (!joined.ok) {
            this.authority.revokeChain(owner.id);
            this.approaching.delete(key);
            this.host._pushAlert('ERROR', 'COMPOSITE_JOIN_FAILED', 'Jonction physique refusée à Givors.', { groupId: group.id, reason: joined.reason });
            return;
        }
        // The follower has stopped at the rear, short of the station coordinate.
        // Account for its own independent approach once before advancing its
        // commercial cursor onto the shared Givors–Lyon leg.
        for (const { follower, approachMassKg } of formations) {
            const joinIndex = follower.stops.findIndex(s => s.locationOccurrenceId ===
                group.sharedSections.find(section => section.id === sectionId)?.participants.find(p => p.scheduleId === follower._v2ScheduleId)?.fromLocationId);
            if (joinIndex >= 0 && follower.currentStopIndex === joinIndex) {
                const station = this.host.game.world.getStationById(node.stationId);
                try {
                    const approach = commercialApproach(follower, joinIndex);
                    this.host.game.economy?.processStopRevenue?.(follower, station.name, approach.distanceKm, false, false, node.stationId, approach.route, false, { physicalMassKg: approachMassKg });
                    follower.currentStopIndex = joinIndex + 1;
                    this.ledger.capture(follower);
                }
                catch {
                    this.host._pushAlert('ERROR', 'COMPOSITE_JOIN_COMMERCIAL_HELD', 'Jonction physique effectuée ; état commercial de la portion à vérifier.', { groupId: group.id, serviceId: follower.id });
                }
            }
        }
        for (const { physical, shadows } of priorFollowerGroups)
            for (const shadow of shadows) {
                const joinLocation = group.sharedSections.find(s => s.id === sectionId)?.participants
                    .find(p => p.scheduleId === shadow._v2ScheduleId)?.fromLocationId;
                const index = shadow.stops.findIndex(s => s.locationOccurrenceId === joinLocation);
                if (index < 0 || shadow.currentStopIndex !== index)
                    continue;
                const expectedOwner = shadow._v2CompositeOwnerId;
                const expectedFollowers = physical._v2CompositeFollowers;
                physical._v2CompositeFollowers = [shadow];
                shadow._v2CompositeOwnerId = physical.id;
                try {
                    const approach = commercialApproach(shadow, index);
                    const station = this.host.game.world.getStationById(node.stationId);
                    if (!this.ledger.settleFollowerArrival(physical, shadow, joinLocation, station, this.host.game.economy, approach.distanceKm, approach.route))
                        this.host._pushAlert('ERROR', 'COMPOSITE_JOIN_COMMERCIAL_HELD', 'Convoi reformé ; arrivée commerciale d’une tranche en attente.', { groupId: group.id, serviceId: shadow.id });
                }
                finally {
                    physical._v2CompositeFollowers = expectedFollowers;
                    shadow._v2CompositeOwnerId = expectedOwner;
                }
            }
        this.approaching.delete(key);
        this.wireJoined(owner, members.filter(s => s !== owner), group, sectionId);
    }
    wireJoined(owner, followers, group, sectionId) {
        owner._v2CompositeCompletionAllowed = () => this.registry.ownerFor(owner.id) !== owner.id;
        if (!this.arrivalBase.has(owner.id))
            this.arrivalBase.set(owner.id, owner._v2OnArrive);
        const priorArrival = this.arrivalBase.get(owner.id);
        owner._v2OnCommercialArrive = arrival => {
            const section = group.sharedSections.find(s => s.id === sectionId);
            const mapped = section.participants.find(p => p.scheduleId === owner._v2ScheduleId);
            if (!mapped || mapped.toLocationId !== arrival.stop.locationOccurrenceId)
                return true;
            return followers.every(follower => {
                const counterpart = section.participants.find(p => p.scheduleId === follower._v2ScheduleId);
                return !!counterpart && this.ledger.settleFollowerArrival(owner, follower, counterpart.toLocationId, arrival.station, arrival.economy, arrival.distFromPrev, arrival.legRoute);
            });
        };
        owner._v2OnArrive = (stop, station, timeOfDay) => {
            priorArrival?.(stop, station, timeOfDay);
            const section = group.sharedSections.find(s => s.id === sectionId);
            const split = group.events.find(e => e.type === 'SPLIT' && section?.participants.every(p => e.participants.some(member => member.scheduleId === p.scheduleId && member.locationId === p.toLocationId)) &&
                e.participants.some(p => p.scheduleId === owner._v2ScheduleId && p.locationId === stop.locationOccurrenceId));
            if (split)
                this.split(owner, followers, group, split.id);
            else if (section?.participants.some(p => p.scheduleId === owner._v2ScheduleId &&
                p.toLocationId === stop.locationOccurrenceId)) {
                const next = group.sharedSections.find(candidate => candidate.id !== sectionId &&
                    candidate.participants.length === section.participants.length &&
                    candidate.participants.every(p => section.participants.some(previous => previous.scheduleId === p.scheduleId && previous.toLocationId === p.fromLocationId)));
                if (next && this.registry.advanceSection(String(owner._v2BaseDate), group, owner.id, next.id))
                    this.wireJoined(owner, followers, group, next.id);
                else if (!next && owner.stops.at(-1)?.locationOccurrenceId === stop.locationOccurrenceId &&
                    followers.every(follower => follower.currentStopIndex === follower.stops.length))
                    this.finishTogether(owner, followers, group, sectionId, station);
            }
        };
    }
    finishTogether(owner, followers, group, sectionId, station) {
        const section = group.sharedSections.find(s => s.id === sectionId);
        if (!section || !followers.every(follower => section.participants.some(p => p.scheduleId === follower._v2ScheduleId &&
            follower.stops.at(-1)?.locationOccurrenceId === p.toLocationId)) ||
            owner.roundTrip || followers.some(follower => follower.roundTrip) ||
            [owner, ...followers].some(service => service._terminalOperationPending?.() ||
                service.getCurrentStops().at(-1)?.turnBack))
            return false;
        const finished = this.registry.finishTogether(String(owner._v2BaseDate), group, owner.id, section.participants.map(p => p.toLocationId), () => {
            // Keep the assembled consist under one physical identity at its terminal.
            // Each shadow has already received its commercial last arrival.
            for (const follower of followers) {
                follower._v2CompositeOwnerId = '';
                follower._v2CompositeCompletionAllowed = undefined;
                follower.completeService(this.host.game.economy, station, owner.position?.lat, owner.position?.lon);
                if (!follower.completed)
                    return false;
            }
            owner._v2CompositeFollowers = [];
            owner._v2CompositeCompletionAllowed = undefined;
            return true;
        });
        if (!finished) {
            this.host._pushAlert('WARNING', 'COMPOSITE_TERMINAL_HELD', 'Terminus commun retenu : une tranche ne peut pas encore clôturer son service.', { groupId: group.id, serviceId: owner.id });
            return false;
        }
        for (const service of [owner, ...followers]) {
            this.originalFormations.delete(service.id);
            this.approachFormations.delete(service.id);
            this.ledger.clear(service.id);
            service._v2OnCommercialArrive = undefined;
            service._v2OnArrive = this.arrivalBase.get(service.id);
            this.arrivalBase.delete(service.id);
        }
        return true;
    }
    retryPendingTerminals() {
        for (const convoy of this.registry.activeConvoys()) {
            const services = this.host.game.scheduleCreator.services;
            const owner = services.find(s => s.id === convoy.ownerServiceId);
            const group = this.host.game.scheduleV2?.getCompositeGroup?.(convoy.groupId);
            const section = group?.sharedSections.find(s => s.id === convoy.sectionId);
            if (!owner || !group || !section || owner.completed || owner.currentStopIndex !== owner.stops.length ||
                owner.state !== 'stopped_at_station' || !owner.position ||
                section.participants.some(p => !services.some(s => s._v2ScheduleId === p.scheduleId &&
                    s._v2BaseDate === convoy.serviceDate && s.stops.at(-1)?.locationOccurrenceId === p.toLocationId)) ||
                group.events.some(e => e.type === 'SPLIT' && section.participants.every(p => e.participants.some(ep => ep.scheduleId === p.scheduleId && ep.locationId === p.toLocationId))))
                continue;
            const followers = convoy.portions.filter(p => p.serviceId !== owner.id)
                .map(p => services.find(s => s.id === p.serviceId));
            if (followers.some(s => !s || s.currentStopIndex !== s.stops.length))
                continue;
            const station = this.host.game.world?.getStationById?.(owner.stops.at(-1)?.stationId);
            if (station && this.finishTogether(owner, followers, group, section.id, station))
                owner.completeService(this.host.game.economy, station, owner.position.lat, owner.position.lon);
        }
    }
    split(owner, followers, group, eventId) {
        const event = group.events.find(e => e.id === eventId);
        const beforeSplit = this.captureCheckpoint(this.host.game.scheduleCreator.services);
        if (!beforeSplit) {
            this.host._pushAlert('ERROR', 'COMPOSITE_SPLIT_CHECKPOINT_INVALID', 'Coupe retenue : la formation physique et les kilomètres des portions ne concordent pas.', { groupId: group.id, serviceId: owner.id });
            return;
        }
        const activeSectionId = this.registry.activeConvoys().find(c => c.ownerServiceId === owner.id)?.sectionId;
        const splitParticipant = group.sharedSections.find(s => s.id === activeSectionId)
            ?.participants.find(p => p.scheduleId === owner._v2ScheduleId);
        const retainedScheduleId = event.retainsLocomotiveScheduleId ||
            group.sharedSections.find(s => s.id === activeSectionId)?.participants[0]?.scheduleId;
        const retainedService = [owner, ...followers].find(s => s._v2ScheduleId === retainedScheduleId);
        const transferredHead = retainedService !== owner
            ? this.originalFormations.get(owner.id)?.filter(m => m.role === FormationRole.LEAD) : undefined;
        const head = transferredHead?.length === 1 &&
            (this.originalFormations.get(owner.id)?.length || 0) > 1 &&
            this.originalFormations.get(owner.id)?.filter(m => activeRole(m.role)).length === 1 &&
            !(this.originalFormations.get(retainedService?.id || '') || []).some(m => activeRole(m.role))
            ? transferredHead[0] : null;
        const headStock = head && this.host.game.rotationV2?.getVehicle?.(head.vehicleId);
        const headSeries = String(headStock?.series || headStock?.name || '');
        const retainedLimits = this.registry.activeConvoys().find(c => c.ownerServiceId === owner.id)
            ?.portions.find(p => p.serviceId === retainedService?.id)?.allowedLocomotiveSeries || [];
        const chosenLimits = event.allowedLocomotiveSeriesByScheduleId?.[String(retainedScheduleId)] || [];
        if (!retainedService || retainedService !== owner && (!head || !headStock ||
            retainedLimits.length && !retainedLimits.includes(headSeries) ||
            chosenLimits.length && !chosenLimits.includes(headSeries))) {
            this.host._pushAlert('WARNING', 'COMPOSITE_SPLIT_HELD', 'Coupe retenue : locomotive de tête incompatible avec la tranche réceptrice ou rame tractée indisponible.', { groupId: group.id, serviceId: owner.id });
            return;
        }
        const splitStop = owner.stops.find(s => s.locationOccurrenceId === splitParticipant?.toLocationId);
        const exactTrack = materialTrackLocation(splitStop).trackIdentity;
        const stock = (this.host.game.rotationV2?.vehicles || []).map((v) => {
            const location = v.location || {}, locationTrack = materialTrackLocation(location).trackIdentity;
            const sameTrack = !!exactTrack && !!locationTrack && exactTrack.kind === locationTrack.kind &&
                exactTrack.id === locationTrack.id;
            const samePlace = String(location.id || '') === event.stationId &&
                Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lon)) &&
                Math.hypot((Number(location.lat) - Number(owner.position?.lat)) * 111195, (Number(location.lon) - Number(owner.position?.lon)) * 111195 *
                    Math.cos(Number(owner.position?.lat) * Math.PI / 180)) <= 100;
            return { id: v.id, series: String(v.series || v.name || ''),
                stationId: samePlace && sameTrack ? event.stationId : '',
                available: v.available === true, trackIdentity: sameTrack ? event.trackIdentity : '' };
        });
        const result = this.registry.split(String(owner._v2BaseDate), group, eventId, stock, ({ branches, portions, groups, groupOwners }) => {
            const retainedGroup = groups.findIndex(members => members.some(p => p.serviceId === retainedService.id));
            if (retainedGroup < 0 || groupOwners[retainedGroup] !== retainedService.id)
                return false;
            const physicalBranches = groups.map((members, index) => ({ members, index,
                service: [owner, ...followers].find(s => s.id === groupOwners[index]) }));
            const relief = physicalBranches.filter(row => row.service !== retainedService).map(({ service: follower, members }) => {
                const branch = branches.find(b => b.serviceId === follower.id);
                const loco = branch?.locomotiveId ? this.host.game.rotationV2.getVehicle(branch.locomotiveId) : null;
                return { follower, branch, loco, driveCapable: members.some(p => p.driveCapable) };
            });
            if (relief.some(({ branch, loco, driveCapable }) => !branch || branch.status !== 'READY' ||
                (!driveCapable && (!loco?.available || String(loco.location?.stationId) !== event.stationId))))
                return false;
            if (!this.originalFormations.get(owner.id))
                return false;
            const snapshots = [owner, ...followers].map(service => ({ service,
                members: structuredClone(service._v2FormationMembers || []), ids: [...(service._v2VehicleIds || [])],
                mileage: { ...(service._v2VehicleMileageKm || {}) }, recorded: service._v2MileageRecorded,
                mileageMembers: service._v2MileageMembers, original: service._v2CompositeOriginalFormationMembers,
                compositeOwnerId: service._v2CompositeOwnerId, compositeFollowers: service._v2CompositeFollowers,
                onArrive: service._v2OnArrive, onCommercialArrive: service._v2OnCommercialArrive,
                completionAllowed: service._v2CompositeCompletionAllowed,
                rameDetails: structuredClone(service.rame?.elementDetails || []), rameElements: [...(service.rame?.elements || [])],
                trainMaxSpeed: service.train.maxSpeed, trainAccel: service.train.accel, trainDecel: service.train.decel,
                brakeService: service._v2BrakeServiceMs2, active: service.active, position: service.position && { ...service.position },
                state: service.state, trainState: service.train.state, stoppedAt: service.train.stoppedAt }));
            const stockAvailable = relief.map(({ loco }) => ({ loco, available: loco?.available }));
            const oldHolds = new Map(this.splitHolds), oldLedger = this.ledger.toSave();
            const oldOriginal = new Map(this.originalFormations), oldApproach = new Map(this.approachFormations);
            const oldArrivalBase = new Map(this.arrivalBase);
            try {
                if (!releaseCompositeRuntimeAfterSplit(beforeSplit, this.host.game.scheduleCreator.services, relief.map(({ follower, loco }) => ({ serviceId: follower.id, members: [
                        ...(loco ? [{ vehicleId: loco.id, role: FormationRole.LEAD }] : []),
                        ...(this.originalFormations.get(follower.id) || []).filter(m => m.vehicleId !== head?.vehicleId)
                            .map(m => ({ ...m })),
                    ] })), { sourceOwnerId: owner.id,
                    groups: groups.map((members, index) => ({ ownerServiceId: groupOwners[index], serviceIds: members.map(p => p.serviceId) })),
                    ...(head ? { headTransfer: { vehicleId: head.vehicleId, toServiceId: retainedService.id } } : {}) }))
                    return false;
                if (head) {
                    this.originalFormations.set(owner.id, (this.originalFormations.get(owner.id) || []).filter(m => m.vehicleId !== head.vehicleId));
                    this.originalFormations.set(retainedService.id, [{ ...head }, ...(this.originalFormations.get(retainedService.id) || [])]);
                }
                for (const { follower, loco } of relief)
                    if (loco)
                        this.originalFormations.set(follower.id, [
                            { vehicleId: loco.id, role: FormationRole.LEAD },
                            ...(this.originalFormations.get(follower.id) || []).map(m => ({ ...m }))
                        ]);
                this.host._refreshRuntimeFormation(owner);
                if (head)
                    this.host._refreshRuntimeFormation(retainedService);
                for (const [index, { follower, loco }] of relief.entries()) {
                    this.host._refreshRuntimeFormation(follower);
                    if (loco)
                        loco.available = false;
                    follower.position = owner.position ? { ...owner.position } : null;
                    follower.state = 'stopped_at_station';
                    follower.train.state = 'stopped_at_station';
                    follower.train.stoppedAt = owner.train.stoppedAt;
                    this.splitHolds.set(follower.id, { owner: index ? relief[index - 1].follower : retainedService,
                        follower, stationId: event.stationId, stockId: loco?.id || follower._v2VehicleIds?.find((id) => activeRole(follower._v2FormationMembers?.find((m) => m.vehicleId === id)?.role)) || null });
                    this.ledger.capture(follower);
                }
                for (const { members, service } of physicalBranches)
                    if (members.length > 1) {
                        for (const member of members) {
                            const portionService = [owner, ...followers].find(s => s.id === member.serviceId);
                            if (portionService !== service) {
                                portionService.active = false;
                                portionService.position = null;
                                this.ledger.capture(portionService);
                            }
                        }
                        this.wireJoined(service, members.filter(p => p.serviceId !== service.id)
                            .map(p => [owner, ...followers].find(s => s.id === p.serviceId)), group, group.sharedSections.find(section => section.participants.length === members.length &&
                            section.participants.every(part => members.some(p => p.scheduleId === part.scheduleId) &&
                                event.participants.some(ep => ep.scheduleId === part.scheduleId && ep.locationId === part.fromLocationId)))?.id || '');
                    }
                this.ledger.capture(owner);
                if (head) {
                    retainedService.position = owner.position ? { ...owner.position } : null;
                    retainedService.state = owner.state;
                    retainedService.train.state = owner.train.state;
                    retainedService.train.stoppedAt = owner.train.stoppedAt;
                    retainedService.active = true;
                    owner.active = false;
                    this.ledger.capture(retainedService);
                    if (!this.transferPhysicalOwner(owner, retainedService))
                        throw new Error('physical owner transfer failed');
                }
                return true;
            }
            catch {
                for (const row of snapshots) {
                    Object.assign(row.service, { _v2FormationMembers: row.members, _v2VehicleIds: row.ids,
                        _v2VehicleMileageKm: row.mileage, _v2MileageRecorded: row.recorded,
                        _v2MileageMembers: row.mileageMembers, _v2CompositeOriginalFormationMembers: row.original,
                        _v2CompositeOwnerId: row.compositeOwnerId, _v2CompositeFollowers: row.compositeFollowers,
                        _v2OnArrive: row.onArrive, _v2OnCommercialArrive: row.onCommercialArrive,
                        _v2CompositeCompletionAllowed: row.completionAllowed,
                        _v2BrakeServiceMs2: row.brakeService, active: row.active, position: row.position, state: row.state });
                    if (row.service.rame) {
                        row.service.rame.elementDetails = row.rameDetails;
                        row.service.rame.elements = row.rameElements;
                    }
                    Object.assign(row.service.train, { maxSpeed: row.trainMaxSpeed, accel: row.trainAccel,
                        decel: row.trainDecel, state: row.trainState, stoppedAt: row.stoppedAt });
                }
                for (const { loco, available } of stockAvailable)
                    if (loco)
                        loco.available = available;
                this.splitHolds = oldHolds;
                this.ledger.loadFromSave(oldLedger);
                this.originalFormations.clear();
                this.approachFormations.clear();
                for (const [id, members] of oldOriginal)
                    this.originalFormations.set(id, members);
                for (const [id, members] of oldApproach)
                    this.approachFormations.set(id, members);
                this.arrivalBase = oldArrivalBase;
                return false;
            }
        }, head?.vehicleId);
        if (!result.ok)
            this.host._pushAlert('WARNING', 'COMPOSITE_SPLIT_HELD', 'Coupe retenue : locomotive réelle indisponible.', { groupId: group.id, reason: result.reason });
        else {
            for (const service of [owner, ...followers]) {
                if (!this.registry.ownerFor(service.id)) {
                    this.originalFormations.delete(service.id);
                    this.approachFormations.delete(service.id);
                    service._v2OnCommercialArrive = undefined;
                    service._v2CompositeCompletionAllowed = undefined;
                    service._v2OnArrive = this.arrivalBase.get(service.id);
                    this.arrivalBase.delete(service.id);
                }
            }
        }
    }
    transferPhysicalOwner(from, to) {
        const cantons = this.host.game.cantonManager || cantonManager;
        const points = this.host.game.voiePointManager;
        const platforms = this.host.game.platformManager;
        if (!cantons || !points || !platforms ||
            cantons.getTrackedCantons(to.id).size || points.voiePoints.some((p) => p.occupiedBy === to.id))
            return false;
        const claims = [...platforms.stationPlatforms.values()].flatMap((data) => [...data.occupied].filter((row) => row[1] === from.id)
            .map(([key, id]) => ({ map: data.occupied, key, id })));
        const voies = points.voiePoints.filter((p) => p.occupiedBy === from.id);
        const troncons = points.troncons.filter((t) => t.occupiedBy === from.id || t.reservedBy === from.id)
            .map((track) => ({ track, occupiedBy: track.occupiedBy, reservedBy: track.reservedBy }));
        const tracked = [from, to].map(service => ({ id: service.id, had: cantons.trainCantons.has(service.id),
            ids: cantons.getTrackedCantons(service.id) }));
        const blocks = [...new Set(tracked.flatMap(row => [...row.ids]))].map(id => ({ block: cantons.cantons.get(id),
            occupiedBy: cantons.cantons.get(id)?.occupiedBy, reservedBy: cantons.cantons.get(id)?.reservedBy }));
        const fields = ['_platformAssignment', '_departureResourceHold', '_carriedDepartureHolds', '_carryoverCantonIds',
            '_carryoverStartTravelKm', '_passageTailSpeedHolds', '_occupiedTronconIds', '_tronconExitTravelKm',
            '_lastTronconId', '_reservedTronconId', '_stationaryRoute', '_stationaryRouteIndex'];
        const copy = (value) => value instanceof Set ? new Set(value) : value instanceof Map ? new Map(value)
            : Array.isArray(value) ? structuredClone(value) : value && typeof value === 'object'
                ? { ...value } : value;
        const saved = [from, to].map(service => ({ service, values: fields.map(field => copy(service[field])) }));
        const oldPlatform = from.train.platform, newPlatform = to.train.platform;
        try {
            for (const { map, key } of claims)
                map.set(key, to.id);
            for (const point of voies)
                point.occupiedBy = to.id;
            for (const { track } of troncons) {
                if (track.occupiedBy === from.id)
                    track.occupiedBy = to.id;
                if (track.reservedBy === from.id)
                    track.reservedBy = to.id;
            }
            cantons.transferTrainResources(from.id, to.id);
            for (const field of fields)
                to[field] = copy(from[field]);
            to.train.platform = oldPlatform;
            from._platformAssignment = null;
            from._releaseAllPhysicalResources();
            to._resetState();
            return true;
        }
        catch {
            for (const { map, key, id } of claims)
                map.set(key, id);
            for (const point of voies)
                point.occupiedBy = from.id;
            for (const { track, occupiedBy, reservedBy } of troncons) {
                track.occupiedBy = occupiedBy;
                track.reservedBy = reservedBy;
            }
            for (const { block, occupiedBy, reservedBy } of blocks)
                if (block) {
                    block.occupiedBy = occupiedBy;
                    block.reservedBy = reservedBy;
                }
            for (const row of tracked) {
                if (row.had)
                    cantons.trainCantons.set(row.id, new Set(row.ids));
                else
                    cantons.trainCantons.delete(row.id);
            }
            for (const { service, values } of saved)
                fields.forEach((field, index) => service[field] = values[index]);
            from.train.platform = oldPlatform;
            to.train.platform = newPlatform;
            return false;
        }
    }
    retryPendingSplits() {
        for (const convoy of this.registry.activeConvoys()) {
            const owner = this.host.game.scheduleCreator.services
                .find(s => s.id === convoy.ownerServiceId);
            if (!owner || owner.state !== 'stopped_at_station' || !owner.position)
                continue;
            const group = this.host.game.scheduleV2?.compositeGroups?.find((g) => g.id === convoy.groupId);
            const section = group?.sharedSections?.find((s) => s.id === convoy.sectionId);
            const stop = owner.stops[Math.max(0, owner.currentStopIndex - 1)];
            const split = group?.events?.find((e) => e.type === 'SPLIT' && section.participants.every((p) => e.participants.some(ep => ep.scheduleId === p.scheduleId && ep.locationId === p.toLocationId)) &&
                e.participants.some(p => p.scheduleId === owner._v2ScheduleId && p.locationId === stop?.locationOccurrenceId));
            if (!section || !split)
                continue;
            const followers = convoy.portions.filter(p => p.serviceId !== owner.id)
                .map(p => this.host.game.scheduleCreator.services.find(s => s.id === p.serviceId));
            if (followers.length && followers.every(Boolean))
                this.split(owner, followers, group, split.id);
        }
    }
    releaseSplitHolds() {
        for (const [id, hold] of this.splitHolds) {
            const { owner, follower, stationId } = hold;
            if (!follower.position)
                continue;
            const finishedAndClear = owner.completed && !owner.position &&
                !(this.host.game.cantonManager || cantonManager)?.getTrackedCantons?.(owner.id)?.size;
            if (!finishedAndClear) {
                if (!owner.position || owner.state !== 'moving' &&
                    String(owner.train?.stoppedAt?.id || '') === stationId)
                    continue;
                const metres = Math.hypot((owner.position.lat - follower.position.lat) * 111195, (owner.position.lon - follower.position.lon) * 111195 * Math.cos(owner.position.lat * Math.PI / 180));
                if (metres < Number(owner.rame?.totalLength || 0) + 10)
                    continue;
            }
            const station = this.host.game.world.getStationById(stationId);
            // The rear of the departing physical train has cleared this exact berth.
            // Station point occupation can outlive its own movement cursor; hand the
            // vacated point to the waiting branch without releasing any other track.
            const stop = follower.stops[follower.currentStopIndex - 1];
            const point = stop?.voiePointId && this.host.game.voiePointManager?.getVoiePointById?.(stop.voiePointId);
            if (point?.occupiedBy === owner.id) {
                this.host.game.voiePointManager.releaseVoiePoint(point.id, owner.id);
                if (owner._platformAssignment?.stationId === stationId)
                    owner._platformAssignment = null;
            }
            if (!station || follower._reserveArrivalResources(station, stop) === false)
                continue;
            const protectedAtStop = follower._restoreStationarySafetyFootprint() !== false &&
                (this.host.game.cantonManager || cantonManager)?.getTrackedCantons?.(follower.id)?.size > 0;
            if (!protectedAtStop) {
                follower._releaseAllPhysicalResources();
                continue;
            }
            follower.active = true;
            this.splitHolds.delete(id);
        }
    }
}
