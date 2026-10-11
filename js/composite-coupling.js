const result = (ok, reason = '') => ({ ok, ...(reason ? { reason } : {}) });
const trackRef = (identity) => {
    const match = /^way:[^|]+\|ref:(.+)$/.exec(identity);
    return match ? match[1].trim().toLowerCase() : '';
};
const pairKey = (a, b) => `${a}\u0000${b}`;
/** A shunting approach may share only the parked target's block and exact berth.
 * Grants are live predicates, never a permanent identity alias. */
export class CompositeCouplingAuthority {
    constructor() {
        this.grants = new Map();
        this.chains = new Map();
    }
    geometry(owner, follower, node) {
        const direction = node.direction;
        const length = Math.hypot(direction?.north, direction?.east);
        if (!Number.isFinite(length) || Math.abs(length - 1) > .01 || !owner.position || !follower.position)
            return null;
        const metresPerLon = 111195 * Math.cos(node.lat * Math.PI / 180);
        const ownerEast = (owner.position.lon - node.lon) * metresPerLon;
        const ownerNorth = (owner.position.lat - node.lat) * 111195;
        const followerEast = (follower.position.lon - node.lon) * metresPerLon;
        const followerNorth = (follower.position.lat - node.lat) * 111195;
        return { ownerOffsetM: Math.hypot(ownerEast, ownerNorth),
            longitudinalM: (ownerEast - followerEast) * direction.east + (ownerNorth - followerNorth) * direction.north,
            lateralM: Math.abs((ownerEast - followerEast) * direction.north - (ownerNorth - followerNorth) * direction.east) };
    }
    bothStoppedAtBerth(owner, follower, node) {
        if (follower.state !== 'stopped_at_station' || Math.abs(follower.speed) > .01)
            return false;
        const g = this.geometry(owner, follower, node);
        if (!g || g.ownerOffsetM > 40 || g.lateralM > 12)
            return false;
        const east = (follower.position.lon - node.lon) * 111195 * Math.cos(node.lat * Math.PI / 180);
        const north = (follower.position.lat - node.lat) * 111195;
        return Math.hypot(east, north) <= 40;
    }
    sameApproachWay(follower, node) {
        return follower.routeWayId === node.routeWayId ||
            !!node.berthPointId && !!follower.routeWayId &&
                node.approachWayIds?.[follower.id] === follower.routeWayId;
    }
    valid(owner, follower, node) {
        if (!owner?.id || !follower?.id || owner.id === follower.id || !node?.stationId ||
            !node.direction || !Number.isFinite(node.direction.north) || !Number.isFinite(node.direction.east) ||
            owner.active !== true || follower.active !== true || owner.completed || follower.completed ||
            owner.cancelled || follower.cancelled || owner.state !== 'stopped_at_station' ||
            !['moving', 'departing', 'stopped_at_station'].includes(follower.state) ||
            Math.abs(Number(owner.speed)) > .01 || !Number.isFinite(follower.speed) || follower.speed < 0 || follower.speed > 5 ||
            !Number.isFinite(owner.lengthM) || !Number.isFinite(follower.lengthM) ||
            owner.lengthM <= 0 || follower.lengthM <= 0 ||
            !Number.isFinite(node.platformLengthM) || owner.lengthM + follower.lengthM > node.platformLengthM ||
            owner.trackIdentity !== node.trackIdentity || follower.trackIdentity !== node.trackIdentity ||
            owner.routeWayId !== node.routeWayId || !this.sameApproachWay(follower, node))
            return false;
        for (const train of [owner, follower]) {
            if (!train.direction || !Number.isFinite(train.direction.north) || !Number.isFinite(train.direction.east) ||
                train.direction.north * node.direction.north + train.direction.east * node.direction.east < .98)
                return false;
        }
        const g = this.geometry(owner, follower, node);
        return this.bothStoppedAtBerth(owner, follower, node) || !!g && g.ownerOffsetM <= 3 && g.lateralM <= 3 &&
            g.longitudinalM >= owner.lengthM - .05 &&
            g.longitudinalM <= owner.lengthM + Math.min(2000, Math.max(0, Number(node.maxApproachM ?? 2000)));
    }
    validChain(owner, followers, node) {
        if (!Array.isArray(followers) || !followers.length || !this.valid(owner, followers[0], node) ||
            new Set([owner.id, ...followers.map(f => f?.id)]).size !== followers.length + 1 ||
            followers.some(f => !f?.id))
            return false;
        let totalLengthM = owner.lengthM;
        const maxApproachM = Math.min(2000, Math.max(0, Number(node.maxApproachM ?? 2000)));
        for (let index = 0; index < followers.length; index++) {
            const predecessor = index ? followers[index - 1] : owner;
            const follower = followers[index];
            totalLengthM += follower.lengthM;
            const g = this.geometry(predecessor, follower, node);
            const offset = this.geometry(owner, follower, node);
            if (totalLengthM > node.platformLengthM || follower.active !== true || follower.completed || follower.cancelled ||
                !['moving', 'departing', 'stopped_at_station'].includes(follower.state) ||
                !Number.isFinite(follower.speed) || follower.speed < 0 || follower.speed > 5 ||
                !Number.isFinite(follower.lengthM) || follower.lengthM <= 0 ||
                follower.trackIdentity !== node.trackIdentity || !this.sameApproachWay(follower, node) ||
                !follower.direction || !Number.isFinite(follower.direction.north) ||
                !Number.isFinite(follower.direction.east) ||
                follower.direction.north * node.direction.north + follower.direction.east * node.direction.east < .98 ||
                !g || !offset || !this.bothStoppedAtBerth(predecessor, follower, node) && (g.lateralM > 3 || offset.lateralM > 3 ||
                g.longitudinalM < predecessor.lengthM - .05 ||
                g.longitudinalM > predecessor.lengthM + maxApproachM))
                return false;
        }
        return true;
    }
    chainFollower(id) {
        for (const chain of this.chains.values()) {
            const index = chain.followers.findIndex(f => f.id === id);
            if (index >= 0)
                return { chain, predecessor: index ? chain.followers[index - 1] : chain.owner,
                    follower: chain.followers[index] };
        }
        return null;
    }
    followerGrant(id) {
        return [...this.grants.values()].find(g => g.follower.id === id) || null;
    }
    /** The follower may close the rear gap at shunting speed, never cross it.
     * A stale live grant becomes a stop, rather than an unbounded movement. */
    approachSpeedCap(followerId, decelMs2 = .25) {
        const grant = this.followerGrant(followerId);
        const link = this.chainFollower(followerId);
        if (!grant && !link)
            return null;
        const predecessor = grant?.owner || link.predecessor;
        const follower = grant?.follower || link.follower;
        const node = grant?.node || link.chain.node;
        if (grant ? !this.valid(predecessor, follower, node) : !this.validChain(link.chain.owner, link.chain.followers, node))
            return 0;
        const geometry = this.geometry(predecessor, follower, node);
        const gapM = Math.max(0, geometry.longitudinalM - predecessor.lengthM);
        const brakingM = Math.max(0, gapM - .05);
        return Math.min(5, Math.sqrt(2 * Math.max(.05, Number(decelMs2) || .25) * brakingM) * 3.6);
    }
    clipAdvance(followerId, requestedKm) {
        const grant = this.followerGrant(followerId);
        const link = this.chainFollower(followerId);
        if (!grant && !link)
            return null;
        const predecessor = grant?.owner || link.predecessor;
        const follower = grant?.follower || link.follower;
        const node = grant?.node || link.chain.node;
        if (grant ? !this.valid(predecessor, follower, node) : !this.validChain(link.chain.owner, link.chain.followers, node))
            return 0;
        const geometry = this.geometry(predecessor, follower, node);
        const remainingM = Math.max(0, geometry.longitudinalM - predecessor.lengthM - .05);
        return Math.min(Math.max(0, Number(requestedKm) || 0), remainingM / 1000);
    }
    grant(owner, follower, node) {
        if (!this.valid(owner, follower, node))
            return result(false, 'COUPLING_GEOMETRY_OR_RESOURCE_INVALID');
        const existing = [...this.grants.values()].find(g => [g.owner.id, g.follower.id].some(id => id === owner.id || id === follower.id));
        if (existing || [...this.chains.values()].some(g => [g.owner.id, ...g.followers.map(f => f.id)]
            .some(id => id === owner.id || id === follower.id)))
            return result(false, 'COUPLING_ALREADY_GRANTED');
        this.grants.set(pairKey(owner.id, follower.id), { owner, follower, node: { ...node, direction: { ...node.direction } } });
        return result(true);
    }
    /** Front-to-rear order is explicit. Every member must stay on this berth and
     * each moving portion approaches only the live rear of its predecessor. */
    grantChain(owner, followers, node) {
        if (!this.validChain(owner, followers, node))
            return result(false, 'COUPLING_GEOMETRY_OR_RESOURCE_INVALID');
        const ids = new Set([owner.id, ...followers.map(f => f.id)]);
        if ([...this.grants.values()].some(g => ids.has(g.owner.id) || ids.has(g.follower.id)) ||
            [...this.chains.values()].some(g => [g.owner, ...g.followers].some(t => ids.has(t.id))))
            return result(false, 'COUPLING_ALREADY_GRANTED');
        this.chains.set(owner.id, { owner, followers: [...followers], node: { ...node, direction: { ...node.direction } } });
        return result(true);
    }
    isAuthorized(a, b) {
        if (!this.grants.size && !this.chains.size)
            return false;
        const grant = this.grants.get(pairKey(String(a), String(b))) || this.grants.get(pairKey(String(b), String(a)));
        if (grant)
            return this.valid(grant.owner, grant.follower, grant.node);
        if (a === b)
            return false;
        for (const chain of this.chains.values()) {
            const ids = [chain.owner.id, ...chain.followers.map(f => f.id)];
            if (ids.includes(String(a)) && ids.includes(String(b)) && this.validChain(chain.owner, chain.followers, chain.node))
                return true;
        }
        return false;
    }
    canShareStationTrack(stationId, ref, a, b) {
        const grant = this.grants.get(pairKey(String(a), String(b))) || this.grants.get(pairKey(String(b), String(a)));
        const chain = grant ? null : [...this.chains.values()].find(g => [g.owner.id, ...g.followers.map(f => f.id)].includes(String(a)) &&
            [g.owner.id, ...g.followers.map(f => f.id)].includes(String(b)));
        const node = grant?.node || chain?.node;
        return !!node && node.stationId === stationId &&
            String(node.trackRef || trackRef(node.trackIdentity)).trim().toLowerCase() === String(ref).trim().toLowerCase() &&
            this.isAuthorized(a, b);
    }
    revoke(ownerId, followerId) { this.grants.delete(pairKey(ownerId, followerId)); }
    revokeChain(ownerId) { this.chains.delete(ownerId); }
    /** Resource control passes to the physical owner once, or is restored in full.
     * The callback registers compensation before each formation/registry mutation. */
    commitChain(owner, followers, node, resources, apply) {
        const chain = this.chains.get(owner?.id);
        if (!chain || chain.owner !== owner || !Array.isArray(followers) ||
            chain.followers.length !== followers.length || chain.followers.some((f, i) => f !== followers[i]) ||
            chain.node.stationId !== node?.stationId || chain.node.trackIdentity !== node?.trackIdentity ||
            chain.node.routeWayId !== node?.routeWayId ||
            !this.validChain(owner, followers, chain.node) || !this.validChain(owner, followers, node) ||
            followers.some((f, i) => {
                const predecessor = i ? followers[i - 1] : owner;
                const g = this.geometry(predecessor, f, chain.node);
                return !g || !this.bothStoppedAtBerth(predecessor, f, chain.node) &&
                    (g.longitudinalM - predecessor.lengthM > 1 || g.longitudinalM - predecessor.lengthM < -.05) || Math.abs(f.speed) > .01 ||
                    !['moving', 'stopped_at_station'].includes(f.state);
            }))
            return result(false, 'COUPLING_NOT_AT_REAR');
        const { cantons, voiePoints, platforms } = resources || {};
        if (!cantons || !voiePoints || !platforms || typeof apply !== 'function')
            return result(false, 'COUPLING_RESOURCES_MISSING');
        const ids = new Set(followers.map(f => f.id));
        const platformChanges = [];
        for (const data of platforms.stationPlatforms.values()) {
            const claims = [...data.occupied].filter(([, id]) => ids.has(id) || id === owner.id);
            if (new Set(claims.map(([key]) => key)).size > 1 && claims.some(([, id]) => ids.has(id)))
                return result(false, 'COUPLING_BERTH_CONFLICT');
            for (const [key, id] of claims)
                if (ids.has(id))
                    platformChanges.push({ occupied: data.occupied, key, id });
        }
        const points = voiePoints.voiePoints.filter(p => ids.has(p.occupiedBy))
            .map(point => ({ point, occupiedBy: point.occupiedBy }));
        const sections = voiePoints.troncons.filter(t => ids.has(t.occupiedBy) || ids.has(t.reservedBy))
            .map(section => ({ section, occupiedBy: section.occupiedBy, reservedBy: section.reservedBy }));
        const tracked = [owner, ...followers].map(train => ({ id: train.id,
            hadEntry: cantons.trainCantons.has(train.id), ids: cantons.getTrackedCantons(train.id) }));
        const blockIds = new Set(tracked.flatMap(entry => [...entry.ids]));
        const blocks = [...blockIds].map(id => {
            const block = cantons.cantons.get(id);
            return { block, occupiedBy: block?.occupiedBy, reservedBy: block?.reservedBy };
        });
        const compensations = [];
        try {
            for (const change of platformChanges)
                change.occupied.set(change.key, owner.id);
            for (const { point } of points)
                point.occupiedBy = owner.id;
            for (const { section } of sections) {
                if (ids.has(section.occupiedBy))
                    section.occupiedBy = owner.id;
                if (ids.has(section.reservedBy))
                    section.reservedBy = owner.id;
            }
            for (const follower of followers)
                cantons.transferTrainResources(follower.id, owner.id);
            if (apply(undo => {
                if (typeof undo !== 'function')
                    throw new Error('invalid compensation');
                compensations.push(undo);
            }) !== true)
                throw new Error('attachment refused');
        }
        catch {
            for (const undo of compensations.reverse()) {
                try {
                    undo();
                }
                catch { /* Continue restoring independent rail claims. */ }
            }
            for (const { occupied, key, id } of platformChanges)
                occupied.set(key, id);
            for (const { point, occupiedBy } of points)
                point.occupiedBy = occupiedBy;
            for (const { section, occupiedBy, reservedBy } of sections) {
                section.occupiedBy = occupiedBy;
                section.reservedBy = reservedBy;
            }
            for (const { block, occupiedBy, reservedBy } of blocks)
                if (block) {
                    block.occupiedBy = occupiedBy ?? null;
                    block.reservedBy = reservedBy ?? null;
                }
            for (const entry of tracked) {
                if (entry.hadEntry)
                    cantons.trainCantons.set(entry.id, new Set(entry.ids));
                else
                    cantons.trainCantons.delete(entry.id);
            }
            this.revokeChain(owner.id);
            return result(false, 'COUPLING_ATTACHMENT_FAILED');
        }
        this.revokeChain(owner.id);
        return result(true);
    }
    commit(owner, follower, node, resources, apply) {
        const grant = this.grants.get(pairKey(owner.id, follower.id));
        const g = this.geometry(owner, follower, node);
        if (!grant || grant.owner !== owner || grant.follower !== follower || !this.valid(owner, follower, grant.node) ||
            !g || !this.bothStoppedAtBerth(owner, follower, node) &&
            (g.longitudinalM - owner.lengthM > 1 || g.longitudinalM - owner.lengthM < -.05) ||
            Math.abs(follower.speed) > .01 ||
            !['moving', 'stopped_at_station'].includes(follower.state))
            return result(false, 'COUPLING_NOT_AT_REAR');
        const { cantons, voiePoints, platforms } = resources;
        if (!cantons || !voiePoints || !platforms || typeof apply !== 'function')
            return result(false, 'COUPLING_RESOURCES_MISSING');
        const platformChanges = [];
        for (const data of platforms.stationPlatforms.values()) {
            for (const [key, id] of data.occupied)
                if (id === follower.id) {
                    if ([...data.occupied].some(([otherKey, otherId]) => otherKey !== key && otherId === owner.id))
                        return result(false, 'COUPLING_BERTH_CONFLICT');
                    platformChanges.push({ occupied: data.occupied, key });
                }
        }
        const points = voiePoints.voiePoints.filter(p => p.occupiedBy === follower.id);
        const sections = voiePoints.troncons.filter(t => t.occupiedBy === follower.id || t.reservedBy === follower.id)
            .map(t => ({ section: t, occupiedBy: t.occupiedBy, reservedBy: t.reservedBy }));
        const fromBlocks = cantons.getTrackedCantons(follower.id);
        const toBlocks = cantons.getTrackedCantons(owner.id);
        const blocks = [...new Set([...fromBlocks, ...toBlocks])].map(id => {
            const block = cantons.cantons.get(id);
            return { block, occupiedBy: block?.occupiedBy, reservedBy: block?.reservedBy };
        });
        try {
            for (const change of platformChanges)
                change.occupied.set(change.key, owner.id);
            for (const point of points)
                point.occupiedBy = owner.id;
            for (const { section } of sections) {
                if (section.occupiedBy === follower.id)
                    section.occupiedBy = owner.id;
                if (section.reservedBy === follower.id)
                    section.reservedBy = owner.id;
            }
            cantons.transferTrainResources(follower.id, owner.id);
            if (apply() !== true)
                throw new Error('attachment refused');
        }
        catch {
            for (const change of platformChanges)
                change.occupied.set(change.key, follower.id);
            for (const point of points)
                point.occupiedBy = follower.id;
            for (const { section, occupiedBy, reservedBy } of sections) {
                section.occupiedBy = occupiedBy;
                section.reservedBy = reservedBy;
            }
            for (const { block, occupiedBy, reservedBy } of blocks)
                if (block) {
                    block.occupiedBy = occupiedBy ?? null;
                    block.reservedBy = reservedBy ?? null;
                }
            cantons.trainCantons.set(follower.id, fromBlocks);
            if (toBlocks.size)
                cantons.trainCantons.set(owner.id, toBlocks);
            else
                cantons.trainCantons.delete(owner.id);
            this.revoke(owner.id, follower.id);
            return result(false, 'COUPLING_ATTACHMENT_FAILED');
        }
        this.revoke(owner.id, follower.id);
        return result(true);
    }
}
