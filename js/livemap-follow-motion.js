export class LivemapFollowMotion {
    constructor() {
        this.service = null;
        this.route = null;
        this.previous = null;
        this.current = null;
    }
    reset() {
        this.service = null;
        this.route = null;
        this.previous = null;
        this.current = null;
    }
    sample(service, nowMs) {
        const physical = service?.position;
        if (!physical || !Number.isFinite(physical.lat) || !Number.isFinite(physical.lon)) {
            this.reset();
            return null;
        }
        const st = service?._state;
        const route = st?.cachedRoute;
        const lengths = st?.segDists;
        const remaining = st?.cumDist;
        const idx = Number(st?.index);
        const fraction = Number(st?.progress);
        if (service?.state !== 'moving' || !route || route.length < 2 || !lengths || !remaining ||
            lengths.length !== route.length - 1 || remaining.length !== route.length ||
            !Number.isInteger(idx) || idx < 0 || idx >= route.length || !Number.isFinite(fraction) ||
            !Number.isFinite(remaining[0]) || !Number.isFinite(nowMs)) {
            this.reset();
            return physical;
        }
        const total = remaining[0];
        const distanceKm = idx === route.length - 1 ? total
            : total - remaining[idx] + Math.max(0, Math.min(1, fraction)) * lengths[idx];
        if (!Number.isFinite(distanceKm) || distanceKm < -1e-7 || distanceKm > total + 1e-7) {
            this.reset();
            return physical;
        }
        const observed = Math.max(0, Math.min(total, distanceKm));
        // A leg change, a route replacement or a safety rewind is authoritative.
        // Never interpolate across two different railway geometries or backwards.
        if (service !== this.service || route !== this.route || !this.current ||
            observed < this.current.distanceKm - 1e-7 || nowMs < this.current.atMs) {
            this.service = service;
            this.route = route;
            this.previous = this.current = { distanceKm: observed, atMs: nowMs };
            return physical;
        }
        if (Math.abs(observed - this.current.distanceKm) > 1e-9) {
            this.previous = this.current;
            this.current = { distanceKm: observed, atMs: nowMs };
        }
        else if (nowMs - this.current.atMs >= 100) {
            // A red signal can leave the service in `moving` with no progress for
            // minutes. Once the delayed visual sample has caught up, re-anchor the
            // stationary position so the first step after release spans 100 ms,
            // rather than the entire pause and jumping almost to its new position.
            this.previous = this.current = { distanceKm: observed, atMs: nowMs };
        }
        const from = this.previous;
        const to = this.current;
        // The physics controller moves every 100 ms. Displaying that last observed
        // interval at frame cadence removes the 10 Hz start/stop of both cameras.
        const displayTime = nowMs - 100;
        const t = to.atMs <= from.atMs ? 1
            : Math.max(0, Math.min(1, (displayTime - from.atMs) / (to.atMs - from.atMs)));
        return this.atDistance(route, lengths, remaining, total, from.distanceKm + (to.distanceKm - from.distanceKm) * t);
    }
    atDistance(route, lengths, remaining, total, distanceKm) {
        if (distanceKm >= total)
            return route[route.length - 1];
        let lo = 0, hi = lengths.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (total - remaining[mid + 1] < distanceKm)
                lo = mid + 1;
            else
                hi = mid;
        }
        const a = route[lo], b = route[lo + 1];
        const fraction = lengths[lo] > 0
            ? Math.max(0, Math.min(1, (distanceKm - (total - remaining[lo])) / lengths[lo])) : 0;
        let deltaLon = b.lon - a.lon;
        if (Math.abs(deltaLon) > 180) {
            deltaLon = deltaLon > 180 ? deltaLon - 360 : deltaLon + 360;
            const longitude = a.lon + deltaLon * fraction;
            return { lat: a.lat + (b.lat - a.lat) * fraction, lon: ((longitude + 180) % 360 + 360) % 360 - 180 };
        }
        return { lat: a.lat + (b.lat - a.lat) * fraction,
            lon: a.lon + deltaLon * fraction };
    }
}
