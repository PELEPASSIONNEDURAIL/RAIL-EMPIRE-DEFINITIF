import { civilDateAt, simulationEpochSec } from './civil-game-time.js';
import { expertDepartureBlock } from './gameplay-mode.js';
function fingerprint(game) {
    return JSON.stringify([game.engine.getSimulationEpochMs(), game.economy.balance, game.rng.getState(),
        game.scheduleV2.schedules.map((s) => [s.id, s.currentVersion?.id, s.currentVersion?.state, s.currentVersion?.calendarIds, s.currentVersion?.locations, s.currentVersion?.outboundPath?.legs, s.currentVersion?.performanceProfile]),
        game.rotationV2.directAssignments.map((a) => a.toJSON()), game.rotationV2.rotations.map((r) => r.toJSON()), game.scheduleV2.calendars, game.gameplayClock.toSave(),
        game.scheduleCreator.services.map((s) => [s.id, s.state, s.completed, s.cancelled, s.totalDistance, s.currentStopIndex, s.delay, s.train?.blockedBy, s.train?.breakdown]),
        game.rameManager.getAll().map((r) => [r.id, r.totalKmRun, r.currentLocation])]);
}
function shiftDate(date, days) { return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10); }
function serviceId(plan) { return `v2:${plan.rotation.id}:${plan.occ.id}:${plan.baseDate}`; }
function checkpoint(game, planning = false, targetMs = game.engine.getSimulationEpochMs()) { return game.captureAnalyticalCheckpoint(planning, targetMs); }
/** Complex shared formations and unversioned commands retain physical replay.
 * Bound preparation memory before materializing any history; no ledger debt is
 * discarded when the ordinary chronological path handles these cases. */
export class AnalyticalCatchupFallbackError extends Error {
}
export function analyticalCatchupFallbackReason(game, fromMs, toMs) {
    const liveServices = game.scheduleCreator.services.filter((svc) => !svc.completed && !svc.cancelled);
    const rotations = game.rotationV2.rotations.filter((rotation) => rotation.enabled !== false);
    const assignments = game.rotationV2.directAssignments.filter((assignment) => assignment.enabled !== false);
    // Only commands belonging to enabled assignments can run historically.
    // An unrelated draft, disabled duty or retained completed trace must not
    // force every ordinary train through millions of physical replay steps.
    // Resolve the assigned version, which may precede a newer editor draft.
    const assignedVersions = [
        ...rotations.flatMap((rotation) => rotation.occurrences.filter((occ) => !occ.cancelled)
            .map((occ) => game.scheduleV2.getVersion(occ.scheduleId, occ.versionId))),
        ...assignments.map((assignment) => game.scheduleV2.getVersion(assignment.scheduleId, assignment.versionId))
    ].filter((version) => !!version && version.state === 'VALID');
    if ((game.scheduleV2.compositeGroups || []).some((group) => group.sharedSections?.length))
        return 'reprise physique : horaire composite';
    if (game.scheduleCreator.services.some((svc) => !svc._v2OccurrenceId && !svc.completed && !svc.cancelled))
        return 'reprise physique : service ancien';
    if (game.depotManager?.repairQueue.length || game.depotManager?.maintenanceQueue.length || game.depotManager?.depotOperations.length || game.depotManager?.physicalOperations.length || game.depotManager?.activeRescues.length || game.shuntingManager?.physicalOperations.length || game.ultimate?.workshop.orders.some(order => !['complete', 'cancelled'].includes(order.state)))
        return 'reprise physique : réparation ou opération matérielle persistée';
    const handling = game.freightOperations?.handling;
    if ([...(handling?.values() || [])].some(row => row.status !== 'completed') || game.stationResources?.operations.some(op => op.state === 'running' && op.enforced))
        return 'reprise physique : chargement ou prestation temporisée';
    const pending = [...game.scheduleV2Runtime._pendingSnapshots.values()].filter(snap => !snap.completed && !snap.cancelled);
    if (liveServices.some((svc) => ['portes', 'climatisation'].includes(String(svc.train?.breakdown?.type))) || pending.some(snap => ['portes', 'climatisation'].includes(String(snap.train?.breakdown?.type))))
        return 'reprise physique : panne bénigne avec réparation à l’arrêt';
    const operationLocations = (locations) => locations?.some(loc => loc.brakePreparation || loc.tractionChange || loc.turnBack);
    if (rotations.some((rotation) => rotation.actions.length) || assignedVersions.some(version => operationLocations(version.locations)) ||
        liveServices.some((svc) => svc._v2OperationState || svc.stops.some(stop => Number(stop.v2OperationSec) > 0 || stop.turnBack)) ||
        pending.some(snap => snap.operationState || snap.commands?.rotation?.actions?.length || operationLocations(snap.commands?.version?.locations)))
        return 'reprise physique : opérations de composition, frein ou retournement';
    const days = Math.ceil((toMs - fromMs) / 86400000) + 2;
    const ledgerDate = game.gameplayClock?.dailyDate, ledgerDays = ledgerDate ? Math.max(0, (Date.parse(civilDateAt(toMs) + 'T00:00:00Z') - Date.parse(ledgerDate + 'T00:00:00Z')) / 86400000) : 0;
    if (ledgerDays > 366)
        return 'reprise physique : arriéré journalier supérieur à un an';
    if (days > 368)
        return 'reprise physique : horizon supérieur à un an';
    const perDay = game.rotationV2.rotations.reduce((sum, r) => sum + r.occurrences.reduce((n, o) => n + 2 * (game.scheduleV2.getVersion(o.scheduleId, o.versionId)?.locations.length || 2) + 2, 0), 0) +
        game.rotationV2.directAssignments.reduce((sum, a) => sum + 2 * (game.scheduleV2.getVersion(a.scheduleId, a.versionId)?.locations.length || 2) + 2, 0);
    const pinned = game.scheduleCreator.services.reduce((sum, svc) => sum + 2 * (svc.stops?.length || 0) + 2, 0) + pending.reduce((sum, snap) => sum + 2 * (snap.commands?.version?.locations?.length || 0) + 2, 0);
    if (days * perDay + pinned + ledgerDays > 100000)
        return 'reprise physique : plus de 100 000 événements potentiels';
    const known = new Set([...game.rotationV2.rotations.map((r) => r.id), ...game.rotationV2.directAssignments.map((a) => 'direct:' + a.id)]);
    for (const snap of pending)
        if (!snap.commands && !known.has(String(snap.rotationId)))
            return 'reprise physique : anciennes commandes absentes';
    return '';
}
/** Prepare timetable events in isolation. Accounting is published by the one atomic
 * commit, so external freight/fleet adapters are never invoked speculatively. */
export function prepareAnalyticalCatchup(game, fromMs, toMs) {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs || fromMs !== game.engine.getSimulationEpochMs())
        throw Error('Intervalle de rattrapage invalide.');
    const fallback = analyticalCatchupFallbackReason(game, fromMs, toMs);
    if (fallback)
        throw new AnalyticalCatchupFallbackError(fallback);
    const initial = fingerprint(game), events = [], plans = [];
    if (toMs === fromMs)
        return { game, fromMs, toMs, events, plans, fingerprint: initial };
    const pushEvent = (event) => { if (events.length >= 100000)
        throw new AnalyticalCatchupFallbackError('reprise physique : plus de 100 000 événements'); events.push(event); };
    const tx = checkpoint(game, true);
    try {
        const runtime = game.scheduleV2Runtime, rotations = runtime._runtimeRotations();
        const fromDate = civilDateAt(fromMs), lastDate = civilDateAt(toMs);
        const represented = new Set();
        const addPlan = (plan, existing) => {
            const id = serviceId(plan);
            if (represented.has(id) || existing?.completed || existing?.cancelled)
                return;
            const pending = runtime._pendingSnapshots.get(id);
            if (pending?.completed || pending?.cancelled)
                return;
            const delay = Math.max(0, Number(existing?.delay ?? pending?.delay ?? 0)) * 60;
            const at = (sec) => simulationEpochSec(plan.baseDate, sec + delay) * 1000;
            const start = at(plan.startSec), end = at(plan.endSec);
            if (start > toMs + 300000 || end < fromMs && !existing && !pending || start < fromMs && !existing && !pending)
                return;
            if (plans.length >= 100000)
                throw new AnalyticalCatchupFallbackError('reprise physique : plus de 100 000 circulations');
            represented.add(id);
            plans.push(plan);
            const push = (kind, ms, priority, stop) => { if (ms >= fromMs && ms <= toMs)
                pushEvent({ kind, ms, priority, plan, stop }); };
            push('compile', Math.max(fromMs, at(Math.min(plan.startSec - 300, plan.prepStartSec))), 2);
            for (let i = 0; i < plan.locations.length; i++) {
                const loc = plan.locations[i];
                if (i > 0)
                    push('arrive', at(Number(loc.arrivalSec ?? loc.departureSec)), 3, i);
                if (i < plan.locations.length - 1)
                    push('depart', at(Number(loc.departureSec ?? loc.arrivalSec)), 4, i);
            }
            push('finish', at(plan.endSec), 5);
        };
        for (const svc of game.scheduleCreator.services) {
            if (!svc._v2OccurrenceId || !svc._v2BaseDate || svc.completed || svc.cancelled)
                continue;
            const stops = svc.stops || [];
            if (stops.length < 2)
                continue;
            const ver = game.scheduleV2.getSchedule(svc._v2ScheduleId)?.currentVersion;
            const plan = { rotation: { id: svc._v2RotationId }, occ: { id: svc._v2OccurrenceId, scheduleId: svc._v2ScheduleId }, ver: ver || {}, sourceVersion: ver || {}, baseDate: svc._v2BaseDate,
                startSec: Number(stops[0].departureTime) * 60, prepStartSec: Number(stops[0].departureTime) * 60,
                endSec: Math.max(Number(stops.at(-1)?.arrivalTime || 0), Number(stops.at(-1)?.departureTime || 0)) * 60,
                locations: stops.map(stop => ({ location: { id: stop.locationOccurrenceId, stationId: stop.stationId }, arrivalSec: Number(stop.arrivalTime) * 60, departureSec: Number(stop.departureTime) * 60 })),
                preDepartureOperationSec: 0, terminalOperationSec: 0, shiftSec: 0 };
            addPlan(plan, svc);
        }
        for (const pending of runtime._pendingSnapshots.values()) {
            const pinned = runtime._planFromSavedCommands(pending);
            if (pinned)
                addPlan(pinned);
        }
        // Daily arrears belong to the ledger, not to the physics cursor. Apply
        // them at the cursor in date order before later daily tasks can advance.
        const settled = game.gameplayClock.dailyDate || fromDate;
        for (let date = shiftDate(settled, 1); date <= lastDate; date = shiftDate(date, 1))
            pushEvent({ kind: 'daily', date, ms: Math.max(fromMs, simulationEpochSec(date, 0) * 1000), priority: 0 });
        // Offset departures can originate on an earlier calendar date. Ordinary
        // same-day starts need no negative-day planning/diagnostic work.
        const carry = Math.max(0, ...rotations.flatMap(r => r.occurrences.map((o) => Math.floor(Math.max(0, Number(game.scheduleV2.getVersion(o.scheduleId, o.versionId)?.firstDepartureSec || 0) + Number(o.offsetSec || 0)) / 86400))));
        for (let date = shiftDate(fromDate, -carry); date <= lastDate; date = shiftDate(date, 1))
            for (const rotation of rotations) {
                if (!rotation.enabled || !runtime._rotationRuns(rotation, date))
                    continue;
                for (const p of runtime._plansForRotationDate(rotation, date))
                    if (p.ver && !p.error)
                        addPlan(p);
            }
        events.sort((a, b) => a.ms - b.ms || a.priority - b.priority);
    }
    finally {
        tx.rollback();
    }
    return { game, fromMs, toMs, events, plans, fingerprint: initial };
}
function relativeAtPlan(plan, ms, delaySec = 0) {
    const at = (sec) => simulationEpochSec(plan.baseDate, sec + delaySec) * 1000;
    for (let i = 0; i < plan.locations.length; i++) {
        const loc = plan.locations[i], arr = Number(loc.arrivalSec ?? loc.departureSec), dep = Number(loc.departureSec ?? loc.arrivalSec);
        if (dep > arr && ms >= at(arr) && ms < at(dep))
            return arr + (dep - arr) * (ms - at(arr)) / Math.max(1, at(dep) - at(arr));
        if (i + 1 < plan.locations.length) {
            const next = Number(plan.locations[i + 1].arrivalSec ?? plan.locations[i + 1].departureSec);
            if (ms >= at(dep) && ms < at(next))
                return dep + (next - dep) * (ms - at(dep)) / Math.max(1, at(next) - at(dep));
        }
    }
    return ms < at(plan.startSec) ? plan.startSec - 1 : plan.endSec + 1;
}
function setClock(game, ms) {
    game.engine.publishAnalyticalTime(ms);
    const pt = game.engine.getParisTime();
    game.timeOfDay = pt.hours * 60 + pt.minutes + pt.seconds / 60;
    game._gameTime = game.timeOfDay;
    game._currentDate = game.engine.getParisDate();
}
function blocked(svc) {
    const type = String(svc.serviceType || '').toLowerCase(), emptyFreight = ['fret', 'freight'].includes(type) && Number(svc._onboardFreight || 0) + Number(svc._contractFreight || 0) <= 0 && ['moving', 'departing'].includes(svc.state);
    return !!(emptyFreight || svc.cancelled || svc.completed || svc.train?.breakdown || svc.train?.inMaintenance || svc.rame?.inMaintenance || svc.train?.blockedBy || svc.train?.movementAuthority?.status === 'STOP' || svc.train?.incident?.effect === 'stop' || svc._iteHardBlock || svc.state === 'blocked_route' || svc.state === 'broken_down');
}
function find(game, plan) { return game.scheduleCreator.services.find((s) => s.id === serviceId(plan)); }
function location(game, svc, index) {
    const stop = svc.stops[index];
    if (!stop)
        return;
    const station = game.world.getStationById(stop.stationId) || { id: stop.stationId, name: stop.locationName || stop.stationId, lat: stop.lat, lon: stop.lon, platforms: 2 };
    svc.position = { lat: Number(stop.lat), lon: Number(stop.lon) };
    svc.train.stoppedAt = station;
    svc.train.platform = stop.platform || '';
    svc.speed = 0;
    svc.train.speed = 0;
    svc.state = 'stopped_at_station';
    svc.train.state = svc.state;
}
function advanceDistance(game, svc, km, elapsedSec, report) {
    const delta = Math.max(0, km - Number(svc.totalDistance || 0));
    if (delta > 0) {
        svc._trackWear(delta, Number(game.timeOfDay || 0), elapsedSec);
        report.distanceKm += delta;
    }
    svc.totalDistance = Math.max(Number(svc.totalDistance || 0), km);
}
function prefix(game, svc, index) { return (svc.routes || []).slice(0, index).reduce((sum, r) => sum + game.scheduleV2Runtime._routeLengthKm(r), 0); }
function commercial(game, svc, index) {
    const stops = svc.getCurrentStops(), stop = stops[index];
    if (!stop || stop.type !== 'arret' || stop.technicalLocationId || svc._v2OptionalStopDecisions?.[String(stop.locationOccurrenceId)])
        return;
    const station = game.world.getStationById(stop.stationId);
    if (!station)
        return;
    let previous = index - 1;
    while (previous > 0 && stops[previous].type !== 'arret')
        previous--;
    const distance = index === 0 ? 0 : prefix(game, svc, index) - prefix(game, svc, Math.max(0, previous));
    svc.currentStopIndex = index;
    game.economy.processStopRevenue(svc, station.name, distance, index === 0, index === stops.length - 1, String(station.id), index === 0 ? [] : svc.routes.slice(Math.max(0, previous), index).flat());
    if (game.freightOperations.pendingForService(svc) || game.stationResources.operations.some(op => op.serviceId === svc.id && op.state === 'running' && op.enforced))
        throw new AnalyticalCatchupFallbackError('reprise physique : chargement ou prestation temporisée');
}
function progressOperations(game, ms, elapsedMinutes) {
    game.ultimate.advanceExistingOperations(ms);
    game.freightOperations?.advancePending(ms, game);
    game.stationResources?.advancePending(game, ms);
    game.shuntingManager.advancePhysicalOperations?.(ms / 1000, { depotManager: game.depotManager, rotationV2: game.rotationV2, staffManager: game.staffManager, game, policy: game.resolveRealismPolicy('shunting') });
    game.depotManager.advancePhysicalOperations?.(ms / 1000, { game, world: game.world, date: String(game._currentDate), rotationV2: game.rotationV2, rameManager: game.rameManager, services: game.scheduleCreator.services, cantonManager: game.cantonManager, staffManager: game.staffManager, policy: game.resolveRealismPolicy('depots') });
    if (elapsedMinutes > 0) {
        game.applyDepotQueueResults(game.depotManager.updateRepairs(elapsedMinutes), String(game._currentDate));
        game.depotManager.updateDepotOperations?.(elapsedMinutes, game.rameManager, game.staffManager);
        game.shuntingManager.update(elapsedMinutes);
    }
}
/** Commit domain events with the physical cursor in one undo-protected operation. */
export function commitAnalyticalCatchup(game, plan) {
    if (plan.game !== game)
        throw Error('Plan de rattrapage étranger.');
    if (plan.report)
        return plan.report;
    if (fingerprint(game) !== plan.fingerprint)
        throw Error('Plan de rattrapage périmé.');
    const report = { fromMs: plan.fromMs, toMs: plan.toMs, events: plan.events.length, occurrences: plan.plans.length, completedServices: 0, distanceKm: 0, dailySettlements: 0, blockedServices: 0 };
    if (plan.toMs === plan.fromMs) {
        plan.report = report;
        return report;
    }
    const tx = checkpoint(game, false, plan.toMs), resume = game._suspendPhysicalResourceEvents();
    let external;
    const preserved = new Set();
    for (const svc of game.scheduleCreator.services)
        if (blocked(svc) || game.depotManager.ownsServiceMovement?.(svc.id))
            preserved.add(svc.id);
    let lastMs = plan.fromMs, lastOperationMs = plan.fromMs;
    const lastTravelMs = new Map();
    game._analyticalCatchupActive = true;
    try {
        external = globalThis.window?.__reDefinitif?.beginImportTransaction?.();
        for (const event of plan.events) {
            setClock(game, event.ms);
            if (event.ms > lastOperationMs) {
                progressOperations(game, event.ms, (event.ms - lastOperationMs) / 60000);
                lastOperationMs = event.ms;
            }
            lastMs = event.ms;
            if (event.kind === 'daily') {
                game.settleAnalyticalDay(event.date);
                report.dailySettlements++;
                continue;
            }
            const p = event.plan, id = serviceId(p);
            if (preserved.has(id))
                continue;
            let svc = find(game, p);
            if (event.kind === 'compile') {
                if (!svc) {
                    game.seasonal.checkSeason(String(game._currentDate));
                    game.scheduleV2Runtime._compile({ ...p, _relNow: game.scheduleV2Runtime._pendingSnapshots.has(id) ? relativeAtPlan(p, event.ms, Math.max(0, Number(game.scheduleV2Runtime._pendingSnapshots.get(id)?.delay || 0)) * 60) : Math.min(p.startSec - 300, p.prepStartSec) });
                    svc = find(game, p);
                }
                if (svc) {
                    if ((blocked(svc) || game.depotManager.ownsServiceMovement?.(svc.id)) && event.ms === plan.fromMs) {
                        preserved.add(id);
                        continue;
                    }
                    svc._releaseAllPhysicalResources?.();
                }
                continue;
            }
            if (!svc || svc.completed || svc.cancelled)
                continue;
            svc._currentDate = String(game._currentDate);
            svc._currentTimeOfDay = Number(game.timeOfDay || 0);
            const stopIndex = Number(event.stop || 0), loc = p.locations[stopIndex];
            if (event.kind === 'depart') {
                svc._v2OnOperationTick?.(String(game._currentDate), Number(game.timeOfDay || 0));
                if (stopIndex === 0 && svc.currentStopIndex === 0) {
                    if (game.realismSettings.difficulty === 'expert')
                        game.staffManager.tickConductors(game.scheduleCreator.getActiveServices(), Number(game.timeOfDay), String(game._currentDate), game);
                    const gate = game.ultimate.departureBlock(svc) || game.operationalExtensions.networkDepartureBlock(game, svc) || expertDepartureBlock(game, svc);
                    if (gate) {
                        svc.train.delayReason = gate.message;
                        preserved.add(id);
                        continue;
                    }
                    if (game.realismSettings.personnelRequired === true) {
                        const driver = game.staffManager.getAssignedTo(svc.id).find((member) => member.role === 'conducteur');
                        const availability = driver ? game.staffManager.getDriverAvailability(driver.id, { game, dateStr: String(game._currentDate), timeOfDay: Number(game.timeOfDay), service: svc, ownerId: svc.id, locationId: String(svc.train.stoppedAt?.id || '') }) : null;
                        if (!game.staffManager.hasAssignedConductor(svc.id, true) || availability?.ok === false || game.unions.isServiceBlocked(svc.id)) {
                            svc.train.delayReason = availability?.reason || game.staffManager.getMissingConductorReason(svc, String(game._currentDate), game) || 'personnel : conducteur indisponible';
                            preserved.add(id);
                            continue;
                        }
                    }
                    commercial(game, svc, 0);
                    svc.currentStopIndex = 1;
                }
                if (['fret', 'freight'].includes(String(svc.serviceType).toLowerCase()) && Number(svc._onboardFreight || 0) + Number(svc._contractFreight || 0) <= 0) {
                    svc.train.delayReason = 'chargement fret : aucune marchandise embarquée';
                    preserved.add(id);
                    continue;
                }
                const cargo = game.freightOperations.canDepart(svc, event.ms);
                if (cargo?.ok === false) {
                    svc.train.delayReason = cargo.reason || cargo.message;
                    preserved.add(id);
                    continue;
                }
                svc.state = 'moving';
                svc.train.state = 'moving';
                svc.train.stoppedAt = null;
                svc._releaseAllPhysicalResources?.();
                lastTravelMs.set(id, event.ms);
            }
            else if (event.kind === 'arrive') {
                // Exact restores already exchanged the stop. Imported snapshots
                // retain their next target index, so only unconsumed arrivals run.
                if (svc.currentStopIndex > stopIndex)
                    continue;
                location(game, svc, stopIndex);
                const prior = Number(p.locations[Math.max(0, stopIndex - 1)].departureSec || p.startSec);
                advanceDistance(game, svc, prefix(game, svc, stopIndex), Math.max(0, Math.min((simulationEpochSec(p.baseDate, Number(loc.arrivalSec ?? loc.departureSec)) - simulationEpochSec(p.baseDate, prior)), (event.ms - (lastTravelMs.get(id) ?? plan.fromMs)) / 1000)), report);
                lastTravelMs.set(id, event.ms);
                commercial(game, svc, stopIndex);
                svc.currentStopIndex = stopIndex + 1;
                svc._v2OnArrive?.(svc.stops[stopIndex], svc.train.stoppedAt, Number(game.timeOfDay || 0));
                svc._v2OnOperationTick?.(String(game._currentDate), Number(game.timeOfDay || 0));
            }
            else if (event.kind === 'finish') {
                svc._v2OnOperationTick?.(String(game._currentDate), Number(game.timeOfDay || 0));
                const terminal = svc.stops.length - 1;
                location(game, svc, terminal);
                svc.currentStopIndex = svc.stops.length;
                svc.completeService(game.economy, svc.train.stoppedAt, svc.position?.lat, svc.position?.lon);
                if (svc.completed) {
                    report.completedServices++;
                    game.scheduleV2Runtime._finalizeServices(String(game._currentDate), Number(game.timeOfDay));
                }
            }
        }
        setClock(game, plan.toMs);
        if (plan.toMs > lastOperationMs)
            progressOperations(game, plan.toMs, (plan.toMs - lastOperationMs) / 60000);
        for (const p of plan.plans) {
            const svc = find(game, p);
            if (!svc || svc.completed || svc.cancelled || preserved.has(svc.id))
                continue;
            const delay = Number(svc.delay || 0), now = relativeAtPlan(p, plan.toMs, Math.max(0, delay) * 60);
            if (now < p.startSec) {
                svc._reserveOriginSafetyFootprint?.();
                continue;
            }
            const before = Number(svc.totalDistance || 0);
            const result = game.scheduleV2Runtime._catchUpFreshCompile(svc, p, now, { totalDistance: before, onboardPax: svc._onboardPax, onboardFreight: svc._onboardFreight, commercialAccountingComplete: true });
            if (result && result.mode !== 'blocked') {
                const final = Number(svc.totalDistance || 0);
                svc.totalDistance = before;
                const lastDeparture = p.locations[Math.max(0, result.stopIndex)].departureSec ?? p.startSec;
                const elapsed = Math.max(0, Math.min(plan.toMs - (lastTravelMs.get(svc.id) ?? plan.fromMs), (now - Number(lastDeparture)) * 1000)) / 1000;
                advanceDistance(game, svc, final, elapsed, report);
                svc.delay = delay;
                svc.train.delay = delay;
            }
        }
        report.blockedServices = preserved.size;
        game.gameplayClock.advance(String(game._currentDate), plan.toMs);
        game.freightManager.reconcileReservations(game.scheduleCreator.services, game.scheduleV2Runtime._pendingSnapshots.values());
        game.scheduleCreator._invalidateActiveCache();
        game.scheduleCreator.refreshMovingCache();
        game.scheduleCreator.beginTick(Number(game.timeOfDay));
        game._analyticalCatchupActive = false;
        if (game.operationalReplay.checkpoint)
            game.startOperationalRecording();
        external?.commit();
        tx.release();
        plan.report = report;
        return report;
    }
    catch (error) {
        tx.rollback();
        external?.rollback();
        throw error;
    }
    finally {
        resume();
        game._analyticalCatchupActive = false;
    }
}
