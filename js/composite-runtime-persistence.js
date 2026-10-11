import { CompositeConvoyRegistry } from './composite-convoy.js';
import { CompositeCommercialLedger } from './composite-commercial.js';
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const unique = (xs) => new Set(xs).size === xs.length;
const clone = (v) => structuredClone(v);
const freezeDeep = (value, seen = new WeakSet()) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value) && !seen.has(value)) {
        seen.add(value);
        for (const child of Object.values(value))
            freezeDeep(child, seen);
        Object.freeze(value);
    }
    return value;
};
const memberIds = (members) => members.map(m => m.vehicleId);
const sameIds = (a, b) => a.length === b.length && a.every(id => b.includes(id));
const activeRole = (role) => role === 'LEAD' || role === 'ACTIVE_MULTIPLE' || role === 'PUSHER';
// Only a deeply frozen, validated object can enter restoration or split.
// Callers cannot mutate it after snapshot corroboration or pass raw save JSON.
const stagedCheckpoints = new WeakMap();
const checked = (value) => value ? stagedCheckpoints.get(value) || null : null;
/** Capture after JOIN has committed. The original formations are an explicit
 * input because the physical owner now carries the union of both portions. */
export function captureCompositeRuntimeCheckpoint(registry, ledger, services, originalFormations, approachFormations = []) {
    if (!registry || !ledger || !Array.isArray(services) || !Array.isArray(originalFormations) ||
        !Array.isArray(approachFormations))
        return null;
    const serviceById = new Map(services.map(s => [s?.id, s]));
    const originals = new Map(originalFormations.map(f => [f?.serviceId, f]));
    const convoys = registry.activeConvoys();
    const ids = convoys.flatMap(c => c.portions.map(p => p.serviceId));
    if (!unique(ids) || ids.some(id => !serviceById.has(id) || !originals.has(id)))
        return null;
    for (const convoy of convoys) {
        const owner = serviceById.get(convoy.ownerServiceId);
        const all = convoy.portions.flatMap(p => memberIds(originals.get(p.serviceId).members));
        if (!owner || !sameIds(owner._v2VehicleIds || [], all))
            return null;
    }
    // Refresh the live commercial payload before taking the save. A shadow is a
    // freight carrier even though only its owner has a physical movement footprint.
    for (const id of ids)
        ledger.capture(serviceById.get(id));
    const checkpoint = { schemaVersion: 1, registry: registry.toSave(), ledger: ledger.toSave(),
        formations: ids.map(id => clone(originals.get(id))),
        approachFormations: clone(approachFormations),
        mileage: ids.map(id => {
            const service = serviceById.get(id);
            return { serviceId: id, byVehicle: { ...(service._v2VehicleMileageKm || {}) },
                recorded: service._v2MileageRecorded === true };
        }) };
    const snapshots = ids.map(id => ({ id,
        formationMembers: clone(serviceById.get(id)._v2FormationMembers || []),
        vehicleMileageKm: { ...(serviceById.get(id)._v2VehicleMileageKm || {}) } }));
    return stageCompositeRuntimeCheckpoint(checkpoint, snapshots);
}
/** Validate all registry, commercial, formation and mileage references before
 * the caller changes its existing runtime. The returned copy is independent of
 * an import buffer that may later be edited. */
export function stageCompositeRuntimeCheckpoint(raw, serviceSnapshots) {
    if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(serviceSnapshots) ||
        !Array.isArray(raw.formations) || !Array.isArray(raw.mileage) ||
        (raw.approachFormations != null && !Array.isArray(raw.approachFormations)))
        return null;
    const registry = new CompositeConvoyRegistry(), ledger = new CompositeCommercialLedger();
    if (!registry.loadFromSave(raw.registry) || !ledger.loadFromSave(raw.ledger))
        return null;
    const convoys = registry.activeConvoys();
    const portions = convoys.flatMap(c => c.portions);
    const ids = portions.map(p => p.serviceId);
    if (!unique(ids) || raw.formations.length !== ids.length || raw.mileage.length !== ids.length)
        return null;
    const snapshots = new Map();
    for (const snapshot of serviceSnapshots) {
        if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id || snapshots.has(snapshot.id))
            return null;
        snapshots.set(snapshot.id, snapshot);
    }
    const formations = new Map();
    const allVehicles = [];
    for (const row of raw.formations) {
        if (!isRecord(row) || typeof row.serviceId !== 'string' || !ids.includes(row.serviceId) ||
            formations.has(row.serviceId) || !Array.isArray(row.members) || !row.members.length)
            return null;
        const members = [];
        for (const member of row.members) {
            if (!isRecord(member) || typeof member.vehicleId !== 'string' || !member.vehicleId ||
                typeof member.role !== 'string' || !member.role ||
                (member.order != null && (typeof member.order !== 'number' || !Number.isSafeInteger(member.order) || member.order < 0)) ||
                (member.sourceCouponId != null && typeof member.sourceCouponId !== 'string'))
                return null;
            members.push(member);
        }
        const portion = portions.find(p => p.serviceId === row.serviceId);
        if (!snapshots.has(row.serviceId) || !sameIds(memberIds(members), portion.vehicleIds || []))
            return null;
        allVehicles.push(...memberIds(members));
        formations.set(row.serviceId, { serviceId: row.serviceId, members });
    }
    if (!unique(allVehicles))
        return null;
    const approach = new Map();
    const approachIds = [];
    for (const row of (raw.approachFormations || [])) {
        if (!isRecord(row) || typeof row.serviceId !== 'string' || approach.has(row.serviceId) ||
            !ids.includes(row.serviceId) ||
            !Array.isArray(row.members) || !row.members.length)
            return null;
        const members = [];
        for (const member of row.members) {
            if (!isRecord(member) || typeof member.vehicleId !== 'string' || !member.vehicleId ||
                typeof member.role !== 'string' || !activeRole(member.role) ||
                (member.order != null && (typeof member.order !== 'number' || !Number.isSafeInteger(member.order) || member.order < 0)) ||
                (member.sourceCouponId != null && typeof member.sourceCouponId !== 'string'))
                return null;
            members.push(member);
        }
        approachIds.push(...memberIds(members));
        approach.set(row.serviceId, members);
    }
    if (!unique([...allVehicles, ...approachIds]))
        return null;
    const mileage = new Map();
    for (const row of raw.mileage) {
        if (!isRecord(row) || typeof row.serviceId !== 'string' || !ids.includes(row.serviceId) ||
            mileage.has(row.serviceId) || !isRecord(row.byVehicle) || typeof row.recorded !== 'boolean')
            return null;
        const isOwner = convoys.some(c => c.ownerServiceId === row.serviceId);
        const permitted = isOwner ? new Set([...allVehicles, ...memberIds(approach.get(row.serviceId) || [])])
            : new Set([...memberIds(formations.get(row.serviceId).members), ...memberIds(approach.get(row.serviceId) || [])]);
        for (const [vehicleId, km] of Object.entries(row.byVehicle))
            if (!permitted.has(vehicleId) || typeof km !== 'number' || !Number.isFinite(km) || km < 0)
                return null;
        // The independent V2 snapshot must corroborate historical approach credit;
        // a forged checkpoint cannot invent detached locomotives or kilometres.
        for (const vehicleId of memberIds(approach.get(row.serviceId) || [])) {
            const snapKm = snapshots.get(row.serviceId)?.vehicleMileageKm;
            if (!snapKm || !Object.hasOwn(row.byVehicle, vehicleId) ||
                snapKm[vehicleId] !== row.byVehicle[vehicleId])
                return null;
        }
        mileage.set(row.serviceId, row);
    }
    for (const convoy of convoys) {
        const scheduleIds = convoy.portions.map(p => p.scheduleId);
        if (!unique(scheduleIds) || !convoy.portions.every(p => {
            const commercial = ledger.get(p.serviceId);
            return commercial?.scheduleId === p.scheduleId;
        }))
            return null;
        // A saved owner's physical formation must cover every portion exactly once.
        // The follower retains only its original commercial formation as a shadow.
        const union = convoy.portions.flatMap(p => memberIds(formations.get(p.serviceId).members));
        for (const p of convoy.portions) {
            const saved = snapshots.get(p.serviceId)?.formationMembers;
            if (saved != null && (!Array.isArray(saved) ||
                !sameIds(memberIds(saved), p.serviceId === convoy.ownerServiceId
                    ? union : memberIds(formations.get(p.serviceId).members))))
                return null;
        }
    }
    try {
        const staged = freezeDeep(clone(raw));
        stagedCheckpoints.set(staged, staged);
        return staged;
    }
    catch {
        return null;
    }
}
const backup = (service) => ({ service,
    formation: service._v2FormationMembers ? clone(service._v2FormationMembers) : undefined,
    ids: service._v2VehicleIds ? [...service._v2VehicleIds] : undefined,
    original: service._v2CompositeOriginalFormationMembers ? clone(service._v2CompositeOriginalFormationMembers) : undefined,
    owner: service._v2CompositeOwnerId, followers: service._v2CompositeFollowers,
    mileage: service._v2VehicleMileageKm ? { ...service._v2VehicleMileageKm } : undefined,
    recorded: service._v2MileageRecorded, cache: service._v2MileageMembers });
const rollback = (rows) => {
    for (const b of rows) {
        b.service._v2FormationMembers = b.formation;
        b.service._v2VehicleIds = b.ids;
        b.service._v2CompositeOriginalFormationMembers = b.original;
        b.service._v2CompositeOwnerId = b.owner;
        b.service._v2CompositeFollowers = b.followers;
        b.service._v2VehicleMileageKm = b.mileage;
        b.service._v2MileageRecorded = b.recorded;
        b.service._v2MileageMembers = b.cache;
    }
};
/** Run after the V2 services have been compiled from saved snapshots and before
 * rebuilding reservations: only the owner may claim the joined vehicles/footprint. */
export function restoreCompositeRuntimeCheckpoint(staged, registry, ledger, services) {
    if (!staged || !registry || !ledger || !Array.isArray(services))
        return false;
    const all = new Map();
    for (const s of services) {
        if (!s?.id || all.has(s.id))
            return false;
        all.set(s.id, s);
    }
    const valid = checked(staged);
    if (!valid)
        return false;
    const convoys = registrySnapshot(valid);
    const members = new Set(convoys.flatMap(c => c.portions.flatMap(p => p.vehicleIds || [])));
    const memberServiceIds = new Set(convoys.flatMap(c => c.portions.map(p => p.serviceId)));
    if ([...memberServiceIds].some(id => !all.has(id)) || services.some(s => !memberServiceIds.has(s.id) && (s._v2VehicleIds || []).some(id => members.has(id))))
        return false;
    const tempLedger = new CompositeCommercialLedger();
    if (!tempLedger.loadFromSave(valid.ledger))
        return false;
    for (const id of memberServiceIds) {
        const service = all.get(id), commercial = tempLedger.get(id);
        if (!commercial || commercial.currentStopIndex > (service.stops || []).length ||
            (service._v2ScheduleId && service._v2ScheduleId !== commercial.scheduleId))
            return false;
    }
    const oldRegistry = registry.toSave(), oldLedger = ledger.toSave();
    const before = [...memberServiceIds].map(id => backup(all.get(id)));
    try {
        if (!registry.loadFromSave(valid.registry) || !ledger.loadFromSave(valid.ledger))
            throw Error('checkpoint rejected');
        for (const convoy of convoys) {
            const owner = all.get(convoy.ownerServiceId);
            const followers = convoy.portions.filter(p => p.serviceId !== owner.id).map(p => all.get(p.serviceId));
            const union = convoy.portions.flatMap(p => valid.formations.find(f => f.serviceId === p.serviceId).members);
            owner._v2FormationMembers = clone(union);
            owner._v2VehicleIds = memberIds(union);
            owner._v2CompositeOwnerId = '';
            owner._v2CompositeFollowers = followers;
            for (const follower of followers) {
                follower._v2FormationMembers = clone(valid.formations.find(f => f.serviceId === follower.id).members);
                follower._v2VehicleIds = []; // shadow: never a second physical material claim
                follower._v2CompositeOwnerId = owner.id;
                follower._v2CompositeFollowers = [];
            }
            for (const p of convoy.portions) {
                const service = all.get(p.serviceId);
                service._v2CompositeOriginalFormationMembers = clone(valid.formations.find(f => f.serviceId === p.serviceId).members);
                const km = valid.mileage.find(m => m.serviceId === p.serviceId);
                service._v2VehicleMileageKm = { ...km.byVehicle };
                service._v2MileageRecorded = km.recorded;
                service._v2MileageMembers = undefined;
                if (!ledger.restore(service))
                    throw Error('commercial state rejected');
            }
        }
        return true;
    }
    catch {
        rollback(before);
        registry.loadFromSave(oldRegistry);
        ledger.loadFromSave(oldLedger);
        return false;
    }
}
function registrySnapshot(checkpoint) {
    const registry = new CompositeConvoyRegistry();
    registry.loadFromSave(checkpoint.registry);
    return registry.activeConvoys();
}
/** Call in the successful SPLIT handoff, after a real replacement locomotive
 * has been chosen. Pass its exact branch formation, including the new LEAD.
 * Odometers were already advanced by the physical owner's wear hook: moving
 * credits between service ledgers must never increment them again. */
export function releaseCompositeRuntimeAfterSplit(staged, services, branchFormations = [], partition) {
    const valid = checked(staged);
    if (!valid || !Array.isArray(services))
        return false;
    const convoys = registrySnapshot(valid).filter(c => !partition || c.ownerServiceId === partition.sourceOwnerId);
    if (partition && (convoys.length !== 1 || !unique(partition.groups.flatMap(g => g.serviceIds)) ||
        !sameIds(partition.groups.flatMap(g => g.serviceIds), convoys[0].portions.map(p => p.serviceId)) ||
        partition.groups.some(g => !g.serviceIds.includes(g.ownerServiceId))))
        return false;
    const all = new Map(services.map(s => [s?.id, s]));
    const replacement = new Map(branchFormations.map(f => [f.serviceId, f.members]));
    if (!unique(services.map(s => s?.id)) || !unique(branchFormations.map(f => f.serviceId)))
        return false;
    const before = [];
    const updates = [];
    for (const convoy of convoys) {
        const owner = all.get(convoy.ownerServiceId), portions = convoy.portions;
        if (!owner || !owner._v2CompositeFollowers || owner._v2CompositeFollowers.length !== portions.length - 1 ||
            portions.some(p => !all.has(p.serviceId) || (p.serviceId !== owner.id && all.get(p.serviceId)?._v2CompositeOwnerId !== owner.id)))
            return false;
        const transfer = partition?.headTransfer;
        const head = transfer && valid.formations.find(f => f.serviceId === owner.id)?.members.find(m => m.vehicleId === transfer.vehicleId && m.role === 'LEAD');
        if (transfer && (!head || transfer.toServiceId === owner.id ||
            !portions.some(p => p.serviceId === transfer.toServiceId)))
            return false;
        const target = portions.map(p => {
            const original = replacement.get(p.serviceId) || valid.formations.find(f => f.serviceId === p.serviceId).members;
            return { service: all.get(p.serviceId), members: transfer && p.serviceId === owner.id
                    ? original.filter(m => m.vehicleId !== transfer.vehicleId)
                    : transfer && p.serviceId === transfer.toServiceId ? [head, ...original] : original };
        });
        const ids = target.flatMap(t => memberIds(t.members));
        const joinedIds = owner._v2VehicleIds || [];
        const newIds = ids.filter(id => !joinedIds.includes(id));
        if (!unique(ids) || !unique(joinedIds) || !joinedIds.every(id => ids.includes(id)) ||
            newIds.length > portions.length - 1)
            return false;
        const portionIds = new Set(portions.map(p => p.serviceId));
        if (services.some(s => !portionIds.has(s.id) && (s._v2VehicleIds || []).some(id => newIds.includes(id))))
            return false;
        for (const { service, members } of target) {
            const original = valid.formations.find(f => f.serviceId === service.id).members;
            if (!original.every(m => m.vehicleId === (service === owner ? transfer?.vehicleId : '') ||
                memberIds(members).includes(m.vehicleId)))
                return false;
            const added = members.filter(m => !joinedIds.includes(m.vehicleId));
            if (service === owner && (added.length > (transfer ? 1 : 0) || added.some(m => m.role !== 'LEAD')) || service !== owner &&
                (added.length > 1 || added.some(m => m.role !== 'LEAD')))
                return false;
            if (added.some(m => (valid.approachFormations || []).some(f => f.serviceId !== service.id &&
                f.members.some(approach => approach.vehicleId === m.vehicleId))))
                return false;
        }
        const ownerMileage = owner._v2VehicleMileageKm || {};
        for (const { service, members } of target) {
            const mileage = service === owner ? {} : { ...(service._v2VehicleMileageKm || {}) };
            for (const id of memberIds(members)) {
                if (service === owner) {
                    if (Number.isFinite(ownerMileage[id]))
                        mileage[id] = ownerMileage[id];
                }
                else if (Number.isFinite(ownerMileage[id])) {
                    mileage[id] = Math.max(0, Number(mileage[id] || 0)) + ownerMileage[id];
                }
                else if (!Object.hasOwn(mileage, id))
                    mileage[id] = 0;
            }
            // Earlier approach engines remain a historical follower credit only.
            const historic = memberIds((valid.approachFormations || []).find(f => f.serviceId === service.id)?.members || []);
            if (Object.keys(mileage).some(id => !memberIds(members).includes(id) && !historic.includes(id)))
                return false;
            updates.push({ service, members, mileage, recorded: service._v2MileageRecorded === true ||
                    Object.values(mileage).some(km => km > 0) });
            before.push(backup(service));
        }
    }
    if (partition)
        for (const group of partition.groups) {
            const rows = group.serviceIds.map(id => updates.find(row => row.service.id === id));
            const owner = rows.find(row => row.service.id === group.ownerServiceId);
            if (rows.length <= 1)
                continue;
            const formation = rows.flatMap(row => row.members);
            const mileage = { ...owner.mileage };
            for (const row of rows)
                for (const member of row.members)
                    mileage[member.vehicleId] = row.mileage[member.vehicleId] ?? 0;
            owner.members = formation;
            owner.mileage = mileage;
            owner.recorded = rows.some(row => row.recorded);
        }
    try {
        for (const { service, members, mileage, recorded } of updates) {
            service._v2FormationMembers = clone(members);
            service._v2VehicleIds = memberIds(members);
            service._v2VehicleMileageKm = mileage;
            service._v2MileageRecorded = recorded;
            service._v2MileageMembers = undefined;
            service._v2CompositeOwnerId = '';
            service._v2CompositeFollowers = [];
            service._v2CompositeOriginalFormationMembers = undefined;
        }
        if (partition)
            for (const group of partition.groups)
                if (group.serviceIds.length > 1) {
                    const owner = all.get(group.ownerServiceId);
                    const followers = group.serviceIds.filter(id => id !== owner.id).map(id => all.get(id));
                    owner._v2CompositeFollowers = followers;
                    for (const follower of followers) {
                        follower._v2VehicleIds = [];
                        follower._v2CompositeOwnerId = owner.id;
                    }
                }
        return true;
    }
    catch {
        rollback(before);
        return false;
    }
}
