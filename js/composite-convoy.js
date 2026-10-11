const key = (date, groupId, ownerId) => `${date}\u0000${groupId}\u0000${ownerId}`;
const statusKey = (date, groupId, scheduleId) => `${date}\u0000${groupId}\u0000${scheduleId}`;
const copyPortion = (p) => ({ ...p, vehicleIds: [...(p.vehicleIds || [])],
    allowedLocomotiveSeries: [...(p.allowedLocomotiveSeries || [])] });
const distinct = (values) => values.length === new Set(values).size;
/** Commercial portions share one physical owner between a validated JOIN and SPLIT.
 * The handoff callbacks must commit physical resources atomically; the registry
 * only changes its own state after those callbacks report success. */
export class CompositeConvoyRegistry {
    constructor() {
        this.joined = new Map();
        this.owners = new Map();
        this.statuses = new Map();
    }
    join(group, sectionId, serviceDate, candidates, handoff) {
        const section = group?.sharedSections?.find(s => s.id === sectionId);
        const joinEvent = group?.events?.find(e => e.type === 'JOIN' && section?.participants.every(p => e.participants.some(x => x.scheduleId === p.scheduleId && x.locationId === p.fromLocationId)));
        const fail = (reason) => ({ ok: false, reason });
        if (!group?.id || group.state !== 'VALID' || !section || !joinEvent || !serviceDate)
            return fail('GROUP_OR_SECTION_INVALID');
        const expected = section.participants.map(p => p.scheduleId);
        if (expected.length < 2 || !distinct(expected) || candidates.length !== expected.length ||
            !distinct(candidates.map(p => p.scheduleId)) || !distinct(candidates.map(p => p.serviceId)) ||
            candidates.some(p => !p.serviceId || !p.rameId || !expected.includes(p.scheduleId) ||
                p.stationId !== joinEvent.stationId || p.trackIdentity !== joinEvent.trackIdentity))
            return fail('PARTICIPANTS_NOT_AT_JOIN');
        const previous = [...this.joined.entries()].filter(([, convoy]) => convoy.serviceDate === serviceDate &&
            convoy.groupId === group.id && convoy.portions.some(p => candidates.some(c => c.serviceId === p.serviceId)));
        if (previous.some(([, convoy]) => convoy.portions.some(p => !candidates.some(c => c.serviceId === p.serviceId))) ||
            candidates.some(p => this.owners.has(p.serviceId) && !previous.some(([, convoy]) => convoy.portions.some(part => part.serviceId === p.serviceId))))
            return fail('PARTICIPANTS_NOT_AT_JOIN');
        const physicalOwners = new Set(previous.map(([, convoy]) => convoy.ownerServiceId));
        if (candidates.some(p => this.joined.has(key(serviceDate, group.id, p.serviceId)) && !physicalOwners.has(p.serviceId)))
            return fail('ALREADY_JOINED');
        const allVehicles = candidates.flatMap(p => p.vehicleIds || []);
        if (!distinct(allVehicles))
            return fail('VEHICLE_DOUBLE_BOOKED');
        const ordered = expected.map(id => copyPortion(candidates.find(p => p.scheduleId === id)));
        const plan = { owner: ordered[0], followers: ordered.slice(1), portions: ordered };
        try {
            if (handoff(plan) !== true)
                return fail('PHYSICAL_HANDOFF_FAILED');
        }
        catch {
            return fail('PHYSICAL_HANDOFF_FAILED');
        }
        const record = { serviceDate, groupId: group.id, sectionId, ownerServiceId: plan.owner.serviceId,
            portions: ordered, lastMovement: null };
        for (const [oldKey] of previous)
            this.joined.delete(oldKey);
        this.joined.set(key(serviceDate, group.id, record.ownerServiceId), record);
        for (const p of ordered)
            this.owners.set(p.serviceId, record.ownerServiceId);
        return { ok: true, ownerServiceId: record.ownerServiceId, followers: plan.followers };
    }
    split(serviceDate, group, eventId, locomotives, handoff, headVehicleId) {
        const fail = (reason) => ({ ok: false, reason });
        const event = group?.events?.find(e => e.id === eventId && e.type === 'SPLIT');
        const joined = [...this.joined.values()].find(c => c.serviceDate === serviceDate && c.groupId === group?.id &&
            event?.participants.length === c.portions.length && c.portions.every(p => event.participants.some(ep => ep.scheduleId === p.scheduleId)));
        const section = group?.sharedSections?.find(s => s.id === joined?.sectionId);
        if (!joined || !event || !section || !section.participants.every(p => event.participants.some(x => x.scheduleId === p.scheduleId && x.locationId === p.toLocationId)))
            return fail('SPLIT_EVENT_INVALID');
        const retained = event.retainsLocomotiveScheduleId || joined.portions[0].scheduleId;
        if (!joined.portions.some(p => p.scheduleId === retained))
            return fail('RETAINED_PORTION_INVALID');
        const savedGroups = event.outputGroups?.length ? event.outputGroups : [];
        // Older schedules synthesized singleton branches before another portion was
        // added. Preserve their old meaning when that is the only missing member.
        const outputIds = savedGroups.length && savedGroups.every(g => g.length === 1) &&
            savedGroups.every(g => joined.portions.some(p => p.scheduleId === g[0]))
            ? [...savedGroups, ...joined.portions.filter(p => !savedGroups.some(g => g[0] === p.scheduleId))
                    .map(p => [p.scheduleId])]
            : savedGroups.length ? savedGroups : joined.portions.map(p => [p.scheduleId]);
        const flat = outputIds.flat();
        if (outputIds.length < 2 || flat.length !== joined.portions.length || !distinct(flat) ||
            joined.portions.some(p => !flat.includes(p.scheduleId)))
            return fail('SPLIT_PARTITION_INVALID');
        const portions = joined.portions.map(copyPortion);
        const retainedPortion = portions.find(p => p.scheduleId === retained);
        const sourcePortion = portions.find(p => p.serviceId === joined.ownerServiceId);
        const transferHead = sourcePortion.serviceId !== retainedPortion.serviceId;
        if (transferHead) {
            if (!headVehicleId || !sourcePortion.vehicleIds?.includes(headVehicleId) ||
                retainedPortion.vehicleIds?.includes(headVehicleId))
                return fail('HEAD_TRANSFER_INVALID');
            sourcePortion.vehicleIds = sourcePortion.vehicleIds.filter(id => id !== headVehicleId);
            retainedPortion.vehicleIds = [headVehicleId, ...(retainedPortion.vehicleIds || [])];
            sourcePortion.driveCapable = false;
            retainedPortion.driveCapable = true;
        }
        const groups = outputIds.map(ids => ids.map(id => portions.find(p => p.scheduleId === id)));
        const groupOwners = groups.map(members => members.some(p => p.scheduleId === retained)
            ? members.find(p => p.scheduleId === retained).serviceId : members[0].serviceId);
        const nextSections = groups.map(members => members.length < 2 ? null : group.sharedSections.find(s => s.id !== joined.sectionId && s.participants.length === members.length &&
            s.participants.every(p => members.some(member => member.scheduleId === p.scheduleId) &&
                event.participants.some(ep => ep.scheduleId === p.scheduleId && ep.locationId === p.fromLocationId))));
        if (groups.some((members, i) => members.length > 1 && !nextSections[i]))
            return fail('NEXT_SECTION_MISSING');
        const used = new Set();
        const occupied = new Set(joined.portions.flatMap(p => p.vehicleIds || []));
        const branches = portions.map(p => {
            const branchIndex = groups.findIndex(members => members.some(member => member.serviceId === p.serviceId));
            const branchOwnerId = groupOwners[branchIndex];
            const series = String(event.locomotiveSeriesByScheduleId?.[p.scheduleId] || '');
            const allowed = event.allowedLocomotiveSeriesByScheduleId?.[p.scheduleId]?.length
                ? event.allowedLocomotiveSeriesByScheduleId[p.scheduleId] : series ? [series] : [];
            const couponLimits = groups[branchIndex].map(member => member.allowedLocomotiveSeries || [])
                .filter(limit => limit.length);
            const eligible = allowed.length ? allowed.filter(name => couponLimits.every(limit => limit.includes(name)))
                : couponLimits.length ? couponLimits[0].filter(name => couponLimits.every(limit => limit.includes(name))) : [];
            let locomotiveId = null;
            let status = 'READY';
            if (p.serviceId === branchOwnerId && !groups[branchIndex].some(member => member.scheduleId === retained) &&
                !groups[branchIndex].some(member => member.driveCapable)) {
                const candidate = locomotives.find(l => l.available && eligible.includes(l.series) &&
                    l.stationId === event.stationId && (!l.trackIdentity || l.trackIdentity === event.trackIdentity) &&
                    !occupied.has(l.id) && !used.has(l.id));
                if (candidate) {
                    locomotiveId = candidate.id;
                    used.add(candidate.id);
                }
                else
                    status = 'HELD_NO_LOCOMOTIVE';
            }
            return { serviceId: p.serviceId, scheduleId: p.scheduleId, status, locomotiveId };
        });
        const plan = { ownerServiceId: joined.ownerServiceId, portions: portions.map(copyPortion), branches,
            groups: groups.map(members => members.map(copyPortion)), groupOwners };
        try {
            if (handoff(plan) !== true)
                return fail('PHYSICAL_HANDOFF_FAILED');
        }
        catch {
            return fail('PHYSICAL_HANDOFF_FAILED');
        }
        this.joined.delete(key(serviceDate, group.id, joined.ownerServiceId));
        for (const p of joined.portions)
            this.owners.delete(p.serviceId);
        for (let i = 0; i < groups.length; i++)
            if (groups[i].length > 1) {
                const ids = groups[i].map(p => p.scheduleId);
                const next = nextSections[i];
                if (next) {
                    const record = { serviceDate, groupId: group.id, sectionId: next.id,
                        ownerServiceId: groupOwners[i], portions: groups[i].map(p => ({ ...copyPortion(p), vehicleIds: [
                                ...(p.vehicleIds || []), ...(p.serviceId === groupOwners[i]
                                    ? branches.filter(b => b.serviceId === p.serviceId && b.locomotiveId).map(b => b.locomotiveId) : [])
                            ] })),
                        lastMovement: null };
                    this.joined.set(key(serviceDate, group.id, record.ownerServiceId), record);
                    for (const p of record.portions)
                        this.owners.set(p.serviceId, record.ownerServiceId);
                }
            }
        for (const branch of branches)
            this.statuses.set(statusKey(serviceDate, group.id, branch.scheduleId), branch.status);
        return { ok: true, branches };
    }
    missedJoin(portion) {
        return { status: portion.driveCapable ? 'CONTINUE_ALONE' : 'HELD_NO_LOCOMOTIVE' };
    }
    advanceSection(serviceDate, group, ownerServiceId, nextSectionId) {
        const current = this.joined.get(key(serviceDate, group?.id, ownerServiceId));
        const previous = group?.sharedSections?.find(s => s.id === current?.sectionId);
        const next = group?.sharedSections?.find(s => s.id === nextSectionId);
        if (!current || !previous || !next || previous.id === next.id ||
            next.participants.length !== current.portions.length ||
            !next.participants.every(p => current.portions.some(part => part.scheduleId === p.scheduleId) &&
                previous.participants.some(from => from.scheduleId === p.scheduleId && from.toLocationId === p.fromLocationId)))
            return false;
        current.sectionId = nextSectionId;
        return true;
    }
    finishTogether(serviceDate, group, ownerServiceId, terminalLocationIds, handoff) {
        const record = this.joined.get(key(serviceDate, group?.id, ownerServiceId));
        const section = group?.sharedSections?.find(s => s.id === record?.sectionId);
        if (!record || !section || !distinct(terminalLocationIds) ||
            terminalLocationIds.length !== record.portions.length ||
            !section.participants.every(p => terminalLocationIds.includes(p.toLocationId)))
            return false;
        try {
            if (handoff(record.portions.map(copyPortion)) !== true)
                return false;
        }
        catch {
            return false;
        }
        this.joined.delete(key(serviceDate, group.id, ownerServiceId));
        for (const portion of record.portions)
            this.owners.delete(portion.serviceId);
        return true;
    }
    ownerFor(serviceId) { return this.owners.get(serviceId) || null; }
    branchStatus(serviceDate, groupId, scheduleId) {
        return this.statuses.get(statusKey(serviceDate, groupId, scheduleId)) || null;
    }
    activeConvoys() {
        return [...this.joined.values()].map(c => ({ serviceDate: c.serviceDate, groupId: c.groupId,
            sectionId: c.sectionId, ownerServiceId: c.ownerServiceId, portions: c.portions.map(copyPortion) }));
    }
    projectMovement(serviceDate, groupId, movement, ownerServiceId) {
        const joined = [...this.joined.values()].find(c => c.serviceDate === serviceDate && c.groupId === groupId &&
            (!ownerServiceId || c.ownerServiceId === ownerServiceId));
        if (!joined || !Number.isFinite(movement?.lat) || !Number.isFinite(movement?.lon) || !Number.isFinite(movement?.atMs))
            return null;
        if (!joined.lastMovement || movement.atMs >= joined.lastMovement.atMs)
            joined.lastMovement = { ...movement };
        const current = joined.lastMovement;
        const position = { lat: current.lat, lon: current.lon, speedKmh: current.speedKmh, stationId: current.stationId || '', atMs: current.atMs };
        return { physicalMarkers: [{ serviceId: joined.ownerServiceId, ...position }],
            commercialServices: joined.portions.map(p => ({ ...copyPortion(p), physicalOwnerId: joined.ownerServiceId, ...position })) };
    }
    toSave() {
        return { schemaVersion: 1, joined: [...this.joined.values()].map(c => ({ ...c,
                portions: c.portions.map(copyPortion), lastMovement: c.lastMovement ? { ...c.lastMovement } : null })),
            branchStatuses: [...this.statuses].map(([k, status]) => {
                const [serviceDate, groupId, scheduleId] = k.split('\u0000');
                return { serviceDate, groupId, scheduleId, status };
            }) };
    }
    loadFromSave(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return false;
        const save = value;
        if (save.schemaVersion !== 1 || !Array.isArray(save.joined) || !Array.isArray(save.branchStatuses))
            return false;
        const next = new Map(), owners = new Map(), statuses = new Map();
        for (const c of save.joined) {
            if (!c || !c.serviceDate || !c.groupId || !c.sectionId || !c.ownerServiceId || !Array.isArray(c.portions) ||
                c.portions.length < 2 || next.has(key(c.serviceDate, c.groupId, c.ownerServiceId)) || !c.portions.some(p => p.serviceId === c.ownerServiceId) ||
                !distinct(c.portions.map(p => p.serviceId)) || !distinct(c.portions.map(p => p.scheduleId)) ||
                c.portions.some(p => !p.serviceId || !p.scheduleId || owners.has(p.serviceId)))
                return false;
            const record = { ...c, portions: c.portions.map(copyPortion), lastMovement: c.lastMovement ? { ...c.lastMovement } : null };
            next.set(key(c.serviceDate, c.groupId, c.ownerServiceId), record);
            for (const p of c.portions)
                owners.set(p.serviceId, c.ownerServiceId);
        }
        for (const row of save.branchStatuses) {
            if (!row?.serviceDate || !row.groupId || !row.scheduleId || !['READY', 'HELD_NO_LOCOMOTIVE'].includes(row.status) ||
                statuses.has(statusKey(row.serviceDate, row.groupId, row.scheduleId)))
                return false;
            statuses.set(statusKey(row.serviceDate, row.groupId, row.scheduleId), row.status);
        }
        this.joined = next;
        this.owners = owners;
        this.statuses = statuses;
        return true;
    }
}
