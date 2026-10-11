import { planClosedServiceFleet, fleetDateDay, fleetDayDate, certifiedScheduleSignature, certifiedMaterialSignature } from './schedule-fleet-plan.js';
import { civilDateAt } from './civil-game-time.js';
import { materialTrackMismatch, materialTrackLocation } from './material-track-location.js';
import { cloneEditableGraph, LabelAllocator } from './duplicate-tools.js';
import { ActiveFormationSpec, FormationMember } from './rotation-v2-model.js';
const ELEMENT_PROFILE_FIELDS = ['name', 'seriesName', 'category', 'traction', 'maxSpeed', 'mass', 'tonnage', 'power', 'length', 'passengerCapacity', 'freightCapacity',
    'wagonSubCategory', 'cargoTypes', 'technicallyCompatibleCargoTypes', 'electricSystems', 'gauges', 'gauge', 'loadingGauge', 'axleLoad', 'metreLoad', 'brakeServiceMs2',
    'isDrivingTrailer', 'compatibility', 'tractionCurve', 'dynamicBrakeCurve', 'regenerativePowerW', 'emptyMassKg', 'payloadMassKg', 'tractionActive', 'brakeForceN',
    'brakeRegime', 'brakeLoadCompensated', 'brakeEstablishSec', 'brakeReleaseSec', 'brakePropagationMps', 'brakePropagationMs', 'brakeHeatCapacityJK', 'brakeCoolingWK',
    'brakeFadeStartC', 'brakeFadeEndC', 'imageData', 'originalImageData'];
function fleetBridge() {
    const fleet = globalThis.window?.__reDefinitif;
    if (!fleet?.inventory?.prepareNewOrder || !fleet.catalog || !fleet.vehicleElement)
        throw new Error('Achat du matériel indisponible. Rechargez le jeu.');
    return fleet;
}
function sourceMaterial(game, id) {
    const manager = game.rotationV2, rec = game.scheduleV2.getSchedule(id);
    if (!rec)
        throw new Error('Horaire introuvable.');
    if (!manager)
        return null;
    const direct = manager.getDirectAssignment(id, rec.currentVersion.id);
    const occurrences = manager.rotations.filter(r => r.enabled).flatMap(r => r.occurrences.filter(o => o.scheduleId === id && o.formation.members.length).map(o => ({ formation: o.formation, rameId: o.rameId || r.assignedRameId })));
    for (const owner of manager.rotations.filter(r => r.enabled && r.certifiedFleetPlan)) {
        const duty = owner.certifiedFleetPlan.duties.find(d => d.outboundScheduleId === id || d.returnScheduleId === id), unit = duty && owner.certifiedFleetPlan.units.find(u => u.home === duty.home);
        if (unit)
            occurrences.push({ formation: new ActiveFormationSpec({ members: unit.formationMembers }), rameId: unit.rameId });
    }
    const assigned = occurrences.length ? occurrences : direct?.enabled !== false && direct ? [{ formation: direct.formation, rameId: direct.rameId }] : [];
    const signatures = new Set(assigned.map(a => a.formation.members.map(m => m.vehicleId).sort().join('|')));
    if (signatures.size > 1)
        throw new Error('Plusieurs compositions sont affectées à cet horaire. Choisissez une composition unique avant de le dupliquer.');
    const assignment = assigned[0];
    if (!assignment?.formation.members.length)
        return null;
    const members = [...assignment.formation.members].sort((a, b) => a.order - b.order);
    const details = members.map(member => {
        const vehicle = manager.getVehicle(member.vehicleId);
        if (!vehicle)
            throw new Error('Un élément du matériel affecté est introuvable.');
        const source = game.rameManager.getById(vehicle.sourceRameId || assignment.rameId);
        if (vehicle.sourceRameId && !source)
            throw new Error('Rame source introuvable pour un élément du matériel affecté.');
        const detail = vehicle.sourceRameElementId ? source?.elementDetails.find(d => d.elementId === vehicle.sourceRameElementId) :
            Number.isInteger(vehicle.sourceRameElementIndex) ? source?.elementDetails[Number(vehicle.sourceRameElementIndex)] : undefined;
        if (vehicle.sourceRameId && !detail)
            throw new Error('Élément de rame source introuvable dans la composition affectée.');
        const stock = game.rollingStock.getById(vehicle.catalogId);
        if (!stock)
            throw new Error(`Type catalogue introuvable : ${vehicle.catalogId}.`);
        const physicalProfile = { ...vehicle.toJSON(), mass: vehicle.massKg / 1000, tonnage: vehicle.massKg / 1000, power: vehicle.powerW / 1000, length: vehicle.lengthM };
        return cloneEditableGraph({ ...stock, ...(detail || physicalProfile), catalogId: vehicle.catalogId, flipped: vehicle.flipped, liveryId: vehicle.liveryId || detail?.liveryId || '' });
    });
    const source = game.rameManager.getById(assignment.rameId || manager.getVehicle(members[0].vehicleId)?.sourceRameId || '');
    const stationId = rec.currentVersion.locations[0]?.stationId || '';
    const station = game.world.getStationById(stationId);
    if (!station || station.closed || !Number.isFinite(station.lat) || !Number.isFinite(station.lon))
        throw new Error('Gare de livraison du matériel indisponible au départ de cet horaire.');
    return { ownerKey: id, key: [...members.map(m => m.vehicleId)].sort().join('|'), details, vehicleIds: members.map(m => m.vehicleId), roles: members.map(m => m.role), name: source?.name || rec.name || rec.number, home: source?.depotId || '', randomize: source?.randomizeOnDeparture || false, randomMax: source?.randomMaxVehicles || null, stationId, departureSec: rec.currentVersion.firstDepartureSec };
}
function frequencyCount(base, options, composite = false) {
    const interval = Math.max(60, Math.round(Number(options.intervalSec || 0))), max = Math.max(1, Math.min(500, Math.floor(Number(options.maxCopies || 500))));
    if (!Number.isFinite(interval))
        throw new Error('Fréquence invalide.');
    let count;
    if (options.firstDepartureSec != null && options.untilDepartureSec != null) {
        const first = Number(options.firstDepartureSec), last = Number(options.untilDepartureSec);
        if (!Number.isFinite(first) || !Number.isFinite(last) || last < first || last - first > 86400 || (composite && first < base))
            throw new Error('Plage de fréquence invalide (24 h maximum).');
        count = Math.floor((last - first) / interval) + 1;
        if (base >= first && base <= last && (base - first) % interval === 0)
            count--;
    }
    else if (options.untilDepartureSec != null) {
        const last = Number(options.untilDepartureSec);
        if (!Number.isFinite(last) || last <= base || last - base > 86400)
            throw new Error('Heure de fin invalide.');
        count = Math.min(max, Math.floor((last - base) / interval));
    }
    else {
        count = Math.max(1, Math.floor(Number(options.totalCount || 2))) - (options.includeOriginal === false ? 0 : 1);
        if (count * interval > 86400)
            throw new Error('La génération par fréquence est limitée à 24 h.');
    }
    if (!Number.isFinite(count) || count < 0 || count > max)
        throw new Error(`Nombre de duplicatas invalide. Maximum : ${max}.`);
    return count;
}
function batchPlan(game, request) {
    const manager = game.scheduleV2;
    let sourceIds, copies;
    if (request.kind === 'bulk') {
        sourceIds = request.options?.preserveRoundTrips ? manager.expandScheduleEntryIds(request.ids) : [...new Set(request.ids)];
        copies = 1;
    }
    else if (request.kind === 'roundtrip') {
        const group = manager.roundTrips.find(g => g.id === request.id);
        if (!group)
            throw new Error('Aller-retour introuvable.');
        sourceIds = [group.outboundScheduleId, group.returnScheduleId];
        const base = manager.getSchedule(sourceIds[0])?.currentVersion.firstDepartureSec || 0, options = request.options;
        const interval = Math.max(1, Number(options.intervalSec || 0)), horizon = Math.min(86400, Math.max(0, Number(options.horizonSec ?? 86400)));
        let first = options.nextDepartureSec != null ? Number(options.nextDepartureSec) - base : Number(options.firstShiftSec || 0);
        if (first <= 0)
            first = interval;
        if (!Number.isFinite(interval) || !Number.isFinite(first) || !Number.isFinite(horizon))
            throw new Error('Fréquence invalide.');
        copies = Math.max(0, Math.min(Math.max(1, Math.min(500, Math.floor(Number(options.maxPairs || 500)))), Math.floor((horizon - first) / interval) + 1));
    }
    else if (request.kind === 'composite') {
        const group = manager.getCompositeGroup(request.id);
        if (!group)
            throw new Error('Groupe lié introuvable.');
        sourceIds = [...group.memberScheduleIds];
        copies = frequencyCount(manager.getSchedule(sourceIds[0])?.currentVersion.firstDepartureSec || 0, request.options, true);
    }
    else {
        sourceIds = [request.id];
        copies = frequencyCount(manager.getSchedule(request.id)?.currentVersion.firstDepartureSec || 0, request.options);
    }
    const templates = new Map(sourceIds.map(id => [id, sourceMaterial(game, id)]));
    if (request.kind === 'bulk' && request.options?.preserveRoundTrips) {
        for (const { record, returnRecord } of manager.getScheduleEntries())
            if (returnRecord) {
                const back = templates.get(returnRecord.id);
                if (back)
                    back.ownerKey = record.id;
            }
    }
    else if (request.kind === 'roundtrip' || request.kind === 'composite')
        for (const template of templates.values())
            if (template)
                template.ownerKey = '';
    return { sourceIds, copies, templates };
}
function materialUnits(game, plan, request) {
    const templates = [...plan.templates.values()].filter((t) => !!t);
    if (request.kind !== 'roundtrip' && request.kind !== 'composite' && !(request.kind === 'bulk' && request.options?.preserveRoundTrips))
        return templates;
    // A linked copy purchases each original physical vehicle once, including
    // vehicles shared by several portions after coupling or splitting.
    const firstUses = new Map();
    for (const template of templates)
        for (const id of template.vehicleIds) {
            const key = `${template.ownerKey}|${id}`, old = firstUses.get(key);
            if (!old || template.departureSec < old.departureSec)
                firstUses.set(key, template);
        }
    const groups = new Map();
    for (const template of templates)
        for (let i = 0; i < template.vehicleIds.length; i++) {
            const id = template.vehicleIds[i], source = game.rotationV2?.getVehicle(id), firstUse = firstUses.get(`${template.ownerKey}|${id}`), key = `${template.ownerKey}|${source?.sourceRameId || template.key}|${firstUse.stationId}`;
            let group = groups.get(key);
            if (!group) {
                const sourceRame = source?.sourceRameId ? game.rameManager.getById(source.sourceRameId) : null;
                group = { ...firstUse, key, name: sourceRame?.name || firstUse.name, home: sourceRame?.depotId || firstUse.home,
                    randomize: sourceRame?.randomizeOnDeparture || false, randomMax: sourceRame?.randomMaxVehicles || null, details: [], vehicleIds: [], roles: [] };
                groups.set(key, group);
            }
            if (!group.vehicleIds.includes(id)) {
                group.vehicleIds.push(id);
                group.details.push(template.details[i]);
                group.roles.push(template.roles[i]);
            }
        }
    return [...groups.values()];
}
function quotePlan(game, request, plan) {
    const units = materialUnits(game, plan, request), rameCount = units.length * plan.copies;
    let newCents = 0, chargedCents = 0;
    const fleet = rameCount ? fleetBridge() : null;
    for (const unit of units)
        for (const detail of unit.details) {
            const id = String(detail.catalogId), live = game.rollingStock.getById(id), catalog = fleet?.catalog.byId(id), price = Number(live?.purchasePrice);
            if (!catalog || !Number.isFinite(price) || price <= 0 || Number(catalog.purchasePrice) !== price)
                throw new Error(`Prix neuf du catalogue indisponible pour ${String(live?.name || id)}.`);
            if (detail.liveryId && !fleet?.catalog.liveryById?.(id, String(detail.liveryId)))
                throw new Error(`Livrée indisponible pour ${String(live?.name || id)}.`);
            const cents = Math.round(price * 100);
            newCents += cents * plan.copies;
            chargedCents += Math.round(cents / 10) * plan.copies;
        }
    if (!Number.isSafeInteger(newCents) || !Number.isSafeInteger(chargedCents))
        throw new Error('Montant du matériel trop élevé.');
    const totalPrice = chargedCents / 100, totalNewPrice = newCents / 100, money = (amount) => amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
    const unitPrice = units.length === 1 ? ` · ${money(totalPrice / plan.copies)} par rame` : '';
    return { copies: plan.copies, rameCount, totalPrice, totalNewPrice, description: rameCount ? `${rameCount} rame(s) neuve(s) indépendante(s) · 10 % du prix neuf (${money(totalNewPrice)})${unitPrice} · Total : ${money(totalPrice)}` : 'Aucun matériel affecté : seuls les horaires sont dupliqués, sans frais de rame.' };
}
export function quoteScheduleMaterialDuplication(game, request) { return request.kind === 'joint-frequency' ? jointMaterialPlan(game, request).quote : quotePlan(game, request, batchPlan(game, request)); }
/** Purchase and schedule creation form one transaction, preserving source runtime object identities. */
export function duplicateScheduleMaterial(game, request, reviewedTotalPrice) {
    if (request.kind === 'joint-frequency')
        return duplicateJointMaterial(game, request, reviewedTotalPrice);
    const reviewedAmount = typeof reviewedTotalPrice === 'number' ? reviewedTotalPrice : reviewedTotalPrice?.totalPrice;
    if (request.kind === 'bulk')
        request = { ...request, ids: [...request.ids] };
    const plan = batchPlan(game, request), quote = quotePlan(game, request, plan), manager = game.scheduleV2, rotation = game.rotationV2;
    if (reviewedAmount != null && quote.totalPrice !== reviewedAmount)
        throw new Error('Le prix neuf a changé : vérifiez le nouveau devis avant de confirmer.');
    if (quote.rameCount && (!Number.isFinite(game.economy.balance) || game.economy.balance < quote.totalPrice))
        throw new Error(`Trésorerie insuffisante : ${quote.totalPrice.toLocaleString('fr-FR')} € nécessaires pour le matériel dupliqué.`);
    const fleet = quote.rameCount ? fleetBridge() : null, units = materialUnits(game, plan, request), inventoryBefore = fleet?.inventory.getState();
    const orders = new Map();
    for (const unit of units)
        for (const detail of unit.details) {
            const id = String(detail.catalogId), old = orders.get(id);
            if (old)
                old.quantity += plan.copies;
            else
                orders.set(id, { quantity: plan.copies, firstFleetNumber: inventoryBefore?.serialCursors?.some(c => c.materialId === id) ? null : `SC${inventoryBefore?.vehicles.length || 0}001` });
        }
    const discountedCatalog = { byId(id) { const stock = fleet?.catalog.byId(id); return stock ? { ...stock, purchasePrice: Math.round(Number(stock.purchasePrice) * 10) / 100 } : null; } };
    const reserved = new Set(rotation?.vehicles.map(v => Number(v.id)).filter(n => Number.isSafeInteger(n) && n > 0));
    const purchase = fleet?.inventory.prepareNewOrder([...orders].map(([materialId, row]) => ({ materialId, ...row })), discountedCatalog, Math.max(0, Math.floor(game.engine?.getSimulationEpochMs?.() || 0)), reserved);
    if (purchase && purchase.receipt.totalPriceCents !== Math.round(quote.totalPrice * 100))
        throw new Error('Le devis du matériel a changé.');
    const destination = request.kind === 'roundtrip' ? String(request.options.rotationId || '') : '';
    const before = { entryCounter: manager.nextEntryNumber, schedules: manager.schedules.length, groups: manager.roundTrips.length, composites: manager.compositeGroups.length, rames: game.rameManager.rames.length,
        vehicles: rotation?.vehicles.slice(), vehicleStates: rotation?.vehicles.map(v => ({ target: v, state: cloneEditableGraph(v) })), coupons: rotation?.coupons.slice(), direct: rotation?.directAssignments.slice(), rotations: rotation?.rotations.filter(r => r.id === destination).map(r => ({ reference: r, state: cloneEditableGraph(r), occurrences: r.occurrences.map(o => ({ reference: o, state: cloneEditableGraph(o) })) })), economy: quote.rameCount ? cloneEditableGraph(game.economy.toSave()) : null, staff: game.staffManager?.toSave(), ultimate: game.ultimate?.toSave?.(), rameReferences: game.rameManager.rames.slice() };
    try {
        if (purchase) {
            if (!purchase.canCommit())
                throw new Error('Inventaire modifié : actualisez le devis.');
            purchase.commit();
        }
        let pairs = [], groups = [], copies = [];
        if (request.kind === 'bulk')
            copies = manager.duplicateSchedules(plan.sourceIds, request.options);
        else if (request.kind === 'frequency')
            copies = manager.duplicateScheduleFrequency(request.id, request.options).filter((r) => !!r);
        else if (request.kind === 'roundtrip') {
            pairs = manager.duplicateRoundTrip(request.id, { ...request.options, rotationId: '' }, null);
            copies = pairs.flatMap(p => [p.outbound, p.return]);
        }
        else {
            groups = manager.duplicateCompositeGroupFrequency(request.id, request.options);
            copies = groups.flatMap(g => g.memberScheduleIds.map(id => manager.getSchedule(id)));
        }
        const expected = request.kind === 'bulk' ? plan.sourceIds.length : plan.copies * plan.sourceIds.length;
        if (copies.length !== expected)
            throw new Error('Le nombre de copies a changé : actualisez la duplication.');
        const pools = new Map();
        for (const owned of purchase?.receipt.vehicles || []) {
            const rows = pools.get(owned.materialId) || [];
            rows.push(owned);
            pools.set(owned.materialId, rows);
        }
        const names = new LabelAllocator(game.rameManager.getAll().map(r => r.name), true);
        for (let batch = 0; batch < (request.kind === 'bulk' ? 1 : plan.copies); batch++) {
            const shared = request.kind === 'roundtrip' || request.kind === 'composite' || (request.kind === 'bulk' && !!request.options?.preserveRoundTrips);
            const mapped = new Map();
            const buy = (template) => {
                if (!fleet || !rotation)
                    throw new Error('Affectation du matériel indisponible.');
                const details = template.details.map(detail => {
                    const materialId = String(detail.catalogId), owned = pools.get(materialId)?.shift();
                    if (!owned)
                        throw new Error('Commande du matériel incomplète.');
                    if (detail.liveryId)
                        fleet.inventory.setVehicleLivery(owned.vehicleId, String(detail.liveryId), fleet.catalog);
                    const fresh = fleet.vehicleElement(owned.vehicleId, !!detail.flipped);
                    const profile = cloneEditableGraph(fresh);
                    for (const field of ELEMENT_PROFILE_FIELDS)
                        if (detail[field] !== undefined)
                            profile[field] = cloneEditableGraph(detail[field]);
                    return { ...profile, purchasePrice: Number(game.rollingStock.getById(materialId)?.purchasePrice), homeDepotId: String(detail.homeDepotId || template.home), flipped: !!detail.flipped };
                });
                const station = game.world.getStationById(template.stationId);
                const rame = game.rameManager.add({ name: names.next(template.name), depotId: template.home, randomizeOnDeparture: template.randomize, randomMaxVehicles: template.randomMax,
                    elements: details.map(d => String(d.catalogId)), elementDetails: details, currentLocation: { stationId: String(station.id), lat: station.lat, lon: station.lon, depotId: '', serviceId: '' } });
                fleet.inventory.assignRame(fleet.inventoryRameId(rame.id), rame.elements, rame.elementDetails.map(d => Number(d.physicalVehicleId)));
                const compatible = { ...rame, elementDetails: rame.elementDetails.map(e => ({ ...e, instanceNumber: e.instanceNumber || undefined })) };
                for (let j = 0; j < rame.elementDetails.length; j++) {
                    const vehicle = rotation.materializeRameElement(compatible, j, null);
                    mapped.set(`${template.ownerKey}|${template.vehicleIds[j]}`, { vehicleId: vehicle.id, rame });
                }
            };
            if (shared)
                for (const unit of units)
                    buy(unit);
            for (let i = 0; i < plan.sourceIds.length; i++) {
                const template = plan.templates.get(plan.sourceIds[i]), record = copies[batch * plan.sourceIds.length + i];
                if (!template || !rotation) {
                    if (destination && rotation)
                        rotation.addOccurrence(destination, { scheduleId: record.id, versionId: record.currentVersion.id });
                    continue;
                }
                if (!shared) {
                    mapped.clear();
                    buy(template);
                }
                const rame = mapped.get(`${template.ownerKey}|${template.vehicleIds[0]}`).rame;
                const formation = new ActiveFormationSpec({ members: template.vehicleIds.map((id, j) => new FormationMember({ vehicleId: mapped.get(`${template.ownerKey}|${id}`).vehicleId, role: template.roles[j], order: j, sourceCouponId: '' })), temporary: false });
                // Bind performance references to the newly acquired rame while keeping
                // the copied numerical profile and historical validation states intact.
                for (const version of record.versions)
                    if (version.performanceProfile.referenceRameId)
                        version.performanceProfile.referenceRameId = rame.id;
                if (destination) {
                    const occurrence = rotation.addOccurrence(destination, { scheduleId: record.id, versionId: record.currentVersion.id, usesAssignedFormation: false, rameId: rame.id });
                    occurrence.formation = formation;
                }
                else
                    rotation.setDirectAssignment(record.id, record.currentVersion.id, formation, { rameId: rame.id });
            }
        }
        if (destination)
            rotation.recalculateRotation(destination);
        if (quote.rameCount && game.economy.addExpense(quote.totalPrice, 'achat', `Duplication d’horaires · ${quote.rameCount} rame(s) · 10 % du neuf`) !== true)
            throw new Error('Paiement du matériel refusé.');
        game.ultimate?.ensureSimpleRameStaff();
        return { copies, pairs, groups, quote };
    }
    catch (error) {
        manager.nextEntryNumber = before.entryCounter;
        manager.schedules.splice(before.schedules);
        manager.roundTrips.splice(before.groups);
        manager.compositeGroups.splice(before.composites);
        game.rameManager.rames.splice(before.rames);
        if (rotation) {
            for (const { target, state } of before.vehicleStates || [])
                Object.assign(target, state);
            rotation.vehicles = before.vehicles;
            rotation.coupons = before.coupons;
            rotation.directAssignments = before.direct;
            for (const { reference, state, occurrences } of before.rotations) {
                Object.assign(reference, state, { occurrences: occurrences.map(o => o.reference) });
                for (const occurrence of occurrences)
                    Object.assign(occurrence.reference, occurrence.state);
            }
        }
        if (fleet && inventoryBefore && purchase)
            fleet.inventory.restore(inventoryBefore);
        if (before.economy)
            game.economy.loadFromSave(before.economy);
        game.rameManager.rames = before.rameReferences;
        if (before.staff)
            game.staffManager?.loadFromSave(before.staff);
        if (before.ultimate)
            game.ultimate?.loadFromSave?.(before.ultimate);
        throw error;
    }
}
const PROFILE_FIELDS = ['catalogId', 'category', 'traction', 'maxSpeed', 'mass', 'tonnage', 'power', 'length', 'passengerCapacity', 'freightCapacity', 'electricSystems', 'gauges', 'gauge', 'loadingGauge', 'axleLoad', 'metreLoad', 'brakeServiceMs2', 'isDrivingTrailer', 'compatibility', 'tractionCurve', 'flipped', 'brakeRegime', 'tractionActive'];
function compositionSignature(details) { return JSON.stringify(details.map(d => Object.fromEntries(PROFILE_FIELDS.map(field => [field, d[field] ?? null])))); }
function homeKey(location) { const physical = materialTrackLocation(location); return String(location.stationId || location.technicalLocationId || '') + (physical.trackIdentity ? `|${JSON.stringify(physical.trackIdentity)}` : ''); }
function fullFingerprint(game, request, sourceIds, activationDate) {
    const input = { ids: [...new Set(request.ids)], options: request.options, activationDate, sources: sourceIds.map(id => game.scheduleV2.getSchedule(id)?.toJSON()), numbers: game.scheduleV2.schedules.map(r => [r.id, r.number, r.entryNumber]), calendars: game.scheduleV2.calendars.map(c => c.toJSON()), roundTrips: game.scheduleV2.roundTrips.map(g => g.toJSON()), rotations: game.rotationV2?.toSave(), physical: game.rotationV2?.vehicles.map(v => [v.id, v.available, v._v2BusyUntilEpoch, v._v2OperationOwnerServiceId, v.location]), rames: game.rameManager.toSave(), prices: sourceIds.flatMap(id => { const t = sourceMaterial(game, id); return t?.details.map(d => [d.catalogId, game.rollingStock.getById(String(d.catalogId))?.purchasePrice]) || []; }) };
    const data = JSON.stringify(input);
    let a = 2166136261, b = 2246822519;
    for (let i = 0; i < data.length; i++) {
        const n = data.charCodeAt(i);
        a = Math.imul(a ^ n, 16777619);
        b = Math.imul(b ^ n, 3266489917);
    }
    return `rc58:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}:${data.length}`;
}
function jointMaterialPlan(game, request) {
    request = { ...request, ids: [...request.ids] };
    const manager = game.scheduleV2, { groupIds, shifts } = manager.roundTripSelectionShifts(request.ids, request.options), sourceIds = groupIds.flatMap(id => { const g = manager.roundTrips.find(g => g.id === id); return [g.outboundScheduleId, g.returnScheduleId]; });
    const activationDate = fleetDayDate(fleetDateDay(civilDateAt(game.engine?.getSimulationEpochMs?.() || Date.now())) + 1), templates = sourceIds.map(id => sourceMaterial(game, id)).filter((t) => !!t), template = templates[0] || null, duties = [];
    for (const t of templates) {
        const sourceRames = [...new Set(t.vehicleIds.map(id => game.rotationV2?.getVehicle(id)?.sourceRameId).filter(Boolean))];
        if (sourceRames.length > 1 || sourceRames.some(id => game.rameManager.getById(id)?.elementDetails.length !== t.details.length) || t.randomize)
            throw new Error('Minimum non prouvé : formation partielle, partagée ou variable.');
    }
    if (template && templates.some(t => compositionSignature(t.details) !== compositionSignature(template.details)))
        throw new Error('Minimum non prouvé : les compositions affectées sont hétérogènes. Utilisez la duplication indépendante ou une composition intacte équivalente.');
    for (const id of groupIds) {
        const group = manager.roundTrips.find(g => g.id === id), out = manager.getSchedule(group.outboundScheduleId), back = manager.getSchedule(group.returnScheduleId), ov = out.currentVersion, rv = back.currentVersion;
        if (ov.state !== 'VALID' || rv.state !== 'VALID')
            throw new Error('Validez les deux sens avant la fréquence.');
        if (template) {
            if (game.rotationV2?.rotations.some(r => r.enabled && r.actions.some(a => r.occurrences.some(o => o.id === a.occurrenceId && (o.scheduleId === out.id || o.scheduleId === back.id)))))
                throw new Error('Minimum non prouvé pour des opérations de roulement avancées.');
            if (game.scheduleV2.compositeGroups.some(g => g.memberScheduleIds.some(member => member === out.id || member === back.id)) || [ov, rv].some(v => v.locations.some(l => l.tractionChange)))
                throw new Error('Minimum non prouvé pour une formation partagée, coupe ou relève de traction.');
            const outCalendars = [...ov.calendarIds].sort(), returnCalendars = [...rv.calendarIds].sort();
            if (JSON.stringify(outCalendars) !== JSON.stringify(returnCalendars))
                throw new Error('Minimum non prouvé : les deux sens doivent circuler les mêmes jours.');
            const first = ov.locations[0], terminal = ov.locations.at(-1), retFirst = rv.locations[0], last = rv.locations.at(-1);
            if (first.stationId !== last.stationId || terminal.stationId !== retFirst.stationId || materialTrackMismatch(last, first, first.stationId) || materialTrackMismatch(first, last, first.stationId) || materialTrackMismatch(terminal, retFirst, terminal.stationId) || materialTrackMismatch(retFirst, terminal, terminal.stationId))
                throw new Error('Minimum non prouvé : la composition doit retrouver sa voie physique à chaque terminus.');
            if (rv.firstDepartureSec < ov.lastArrivalSec + group.terminalLayoverSec)
                throw new Error('Attente au terminus insuffisante.');
            const calendars = ov.calendarIds.map(calendarId => { const cal = manager.calendars.find(c => c.id === calendarId); if (!cal)
                throw new Error('Calendrier introuvable.'); return cal.toJSON(); });
            const prep = Number(first.brakePreparation?.durationSec || 0);
            for (const shift of [0, ...shifts])
                duties.push({ key: `${id}|${shift}`, groupId: id, outboundScheduleId: out.id, returnScheduleId: back.id, home: homeKey(first), startSec: ov.firstDepartureSec + shift - prep, endSec: Math.max(rv.lastArrivalSec, Number(last.departureSec ?? rv.lastArrivalSec), rv.lastArrivalSec + Number(last.brakePreparation?.durationSec || 0)) + shift + group.terminalLayoverSec, outboundStartSec: ov.firstDepartureSec + shift, outboundEndSec: ov.lastArrivalSec + shift, returnStartSec: rv.firstDepartureSec + shift, returnEndSec: rv.lastArrivalSec + shift, calendars });
        }
    }
    const selectedIds = new Set(Array.isArray(request.options.selectedRameIds) ? request.options.selectedRameIds.map(String) : templates.flatMap(t => t.vehicleIds.map(id => game.rotationV2?.getVehicle(id)?.sourceRameId || '')).filter(Boolean)), selected = [], stock = [], seenPhysical = new Set();
    for (const rame of game.rameManager.getAll()) {
        let reason = '', home = '', eligible = !!template;
        const details = rame.elementDetails.map(d => ({ ...d, catalogId: d.catalogId || rame.elements[rame.elementDetails.indexOf(d)] }));
        if (template && compositionSignature(details) !== compositionSignature(template.details))
            reason = 'Composition ou profil technique différent';
        else if (rame.randomizeOnDeparture)
            reason = 'Composition variable au départ';
        else if (rame.inMaintenance || rame.depotOperationId || rame.currentLocation?.depotId)
            reason = 'Maintenance ou opération dépôt';
        else if (rame.currentLocation?.serviceId)
            reason = 'Service en cours';
        const physical = (game.rotationV2?.getRameVehicles(rame.id) || []).filter(v => !v.id.startsWith('rame-proxy:'));
        if (!reason && physical.some(v => !v.available || v._v2OperationOwnerServiceId))
            reason = 'Matériel actuellement engagé';
        const outsideDirect = game.rotationV2?.directAssignments.some(a => a.enabled && !sourceIds.includes(a.scheduleId) && (a.rameId === rame.id || a.formation.members.some(m => physical.some(v => v.id === m.vehicleId))));
        const outsideRotation = game.rotationV2?.rotations.some(r => r.enabled && r.occurrences.some(o => !sourceIds.includes(o.scheduleId)) && (r.poolRameIds.includes(rame.id) || r.assignedRameId === rame.id || r.occurrences.some(o => !sourceIds.includes(o.scheduleId) && (o.rameId === rame.id || o.formation.members.some(m => physical.some(v => v.id === m.vehicleId))))));
        if (!reason && (outsideDirect || outsideRotation))
            reason = 'Réservée sur un autre service';
        if (!reason) {
            const matching = duties.find(d => d.home.split('|')[0] === rame.currentLocation?.stationId && !materialTrackMismatch(rame.currentLocation, manager.getSchedule(d.outboundScheduleId).currentVersion.locations[0], String(rame.currentLocation.stationId)));
            if (matching)
                home = matching.home;
            else
                reason = 'Position incompatible avec les terminus';
        }
        if (!reason && selectedIds.has(rame.id)) {
            const ids = details.map(d => String(d.physicalVehicleId || d.elementId || '')).filter(Boolean);
            if (ids.some(id => seenPhysical.has(id)))
                reason = 'Éléments physiques déjà sélectionnés dans une autre rame';
            else {
                ids.forEach(id => seenPhysical.add(id));
                selected.push({ rame, home });
            }
        }
        eligible = eligible && !reason;
        const first = details.find(d => d.imageData) || details[0];
        stock.push({ rameId: rame.id, name: rame.name, serialNumber: rame.serialNumber, series: [...new Set(details.map(d => String(d.seriesName || d.name || d.catalogId)))].join(' · '), composition: details.map(d => String(d.name || d.catalogId)).join(' + '), locationName: String(game.world.getStationById(String(rame.currentLocation?.stationId || ''))?.name || rame.currentLocation?.stationId || 'Position inconnue'), image: String(first?.imageData || game.rollingStock.getById(String(first?.catalogId || ''))?.imageData || ''), eligible, reason, home, selected: selectedIds.has(rame.id) });
    }
    const certificate = planClosedServiceFleet(duties, activationDate), missing = [], usedRameIds = [], reserveRameIds = [];
    for (const need of certificate.needs) {
        const available = selected.filter(s => s.home === need.home);
        usedRameIds.push(...available.slice(0, need.count).map(s => s.rame.id));
        reserveRameIds.push(...available.slice(need.count).map(s => s.rame.id));
        for (let i = available.length; i < need.count; i++)
            missing.push({ home: need.home, stationId: need.home.split('|')[0], template: template });
    }
    let totalPrice = 0, totalNewPrice = 0, chargedCents = 0, newCents = 0;
    if (missing.length) {
        const fleet = fleetBridge();
        for (const unit of missing)
            for (const detail of unit.template.details) {
                const price = Number(game.rollingStock.getById(String(detail.catalogId))?.purchasePrice), catalog = fleet.catalog.byId(String(detail.catalogId));
                if (!catalog || !Number.isFinite(price) || price <= 0 || Number(catalog.purchasePrice) !== price)
                    throw new Error('Prix neuf du catalogue indisponible.');
                if (detail.liveryId && !fleet.catalog.liveryById?.(String(detail.catalogId), String(detail.liveryId)))
                    throw new Error('Livrée indisponible.');
                const cents = Math.round(price * 100);
                newCents += cents;
                chargedCents += Math.round(cents / 10);
            }
    }
    totalPrice = chargedCents / 100;
    totalNewPrice = newCents / 100;
    if (!Number.isSafeInteger(Math.round(totalPrice * 100)) || !Number.isSafeInteger(Math.round(totalNewPrice * 100)))
        throw new Error('Montant du matériel trop élevé.');
    const money = (n) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }), fingerprint = fullFingerprint(game, request, sourceIds, activationDate);
    const quote = { copies: shifts.length * groupIds.length, rameCount: missing.length, totalPrice, totalNewPrice, requiredRameCount: certificate.required, proven: !!template, fingerprint, stock, usedRameIds, reserveRameIds, activationDate, description: template ? `Besoin total prouvé : ${certificate.required} rame(s) · ${usedRameIds.length} du stock utilisées · ${reserveRameIds.length} en réserve · ${missing.length} neuve(s) à 10 % du catalogue (${money(totalNewPrice)}) · Total : ${money(totalPrice)}. Même composition sur les deux sens ; service à compter du ${activationDate}.` : 'Aucun matériel défini : seuls les horaires sont créés, sans achat ni minimum de parc inventé.' };
    return { quote, template, duties, groupIds, shifts, selected, missing };
}
function duplicateJointMaterial(game, request, reviewed) {
    request = { ...request, ids: [...request.ids] };
    const plan = jointMaterialPlan(game, request), quote = plan.quote, manager = game.scheduleV2, rotation = game.rotationV2;
    if (typeof reviewed === 'number')
        throw new Error('Vérifiez le devis complet du service et du stock avant de confirmer.');
    if (reviewed != null && (reviewed.totalPrice !== quote.totalPrice || reviewed.fingerprint !== quote.fingerprint))
        throw new Error('Le service, le stock ou le prix a changé : vérifiez le nouveau devis.');
    if (quote.rameCount && game.economy.balance < quote.totalPrice)
        throw new Error('Trésorerie insuffisante pour le complément de matériel.');
    const fleet = quote.rameCount ? fleetBridge() : null, inventory = fleet?.inventory.getState(), orders = new Map();
    for (const unit of plan.missing)
        for (const detail of unit.template.details)
            orders.set(String(detail.catalogId), (orders.get(String(detail.catalogId)) || 0) + 1);
    const catalog = { byId(id) { const row = fleet?.catalog.byId(id); return row ? { ...row, purchasePrice: Math.round(Number(row.purchasePrice) * 10) / 100 } : null; } };
    const purchase = fleet?.inventory.prepareNewOrder([...orders].map(([materialId, quantity]) => ({ materialId, quantity, firstFleetNumber: inventory?.serialCursors?.some(c => c.materialId === materialId) ? null : `SC${inventory?.vehicles.length || 0}001` })), catalog, game.engine?.getSimulationEpochMs?.() || 0, new Set(rotation?.vehicles.map(v => Number(v.id)).filter(Number.isSafeInteger)));
    if (purchase?.receipt.totalPriceCents !== undefined && purchase.receipt.totalPriceCents !== Math.round(quote.totalPrice * 100))
        throw new Error('Le devis de la commande a changé.');
    const before = { schedules: manager.schedules.length, groups: manager.roundTrips.length, calendars: manager.calendars.length, counter: manager.nextEntryNumber, rames: game.rameManager.rames.length, vehicles: rotation?.vehicles.slice(), vehicleStates: rotation?.vehicles.map(v => ({ target: v, state: cloneEditableGraph(v) })), coupons: rotation?.coupons.slice(), direct: rotation?.directAssignments.slice(), rotations: rotation?.rotations.slice(), occurrenceCutoffs: rotation?.rotations.flatMap(r => r.occurrences.map(o => ({ target: o, activeUntilDate: o.activeUntilDate }))), rameReferences: game.rameManager.rames.slice(), economy: cloneEditableGraph(game.economy.toSave()), staff: game.staffManager?.toSave(), ultimate: game.ultimate?.toSave?.() };
    try {
        if (purchase) {
            if (!purchase.canCommit())
                throw new Error('Inventaire modifié : actualisez le devis.');
            purchase.commit();
        }
        const pairs = manager.duplicateRoundTripSelection(plan.groupIds, request.options), copies = pairs.flatMap(p => [p.outbound, p.return]);
        const units = [...plan.selected], pools = new Map();
        for (const owned of purchase?.receipt.vehicles || []) {
            const list = pools.get(owned.materialId) || [];
            list.push(owned);
            pools.set(owned.materialId, list);
        }
        const labels = new LabelAllocator(game.rameManager.getAll().map(r => r.name), true);
        for (const missing of plan.missing) {
            if (!fleet || !rotation)
                throw new Error('Affectation du matériel indisponible.');
            const template = missing.template;
            const details = template.details.map(detail => { const owned = pools.get(String(detail.catalogId))?.shift(); if (!owned)
                throw new Error('Commande de matériel incomplète.'); if (detail.liveryId)
                fleet.inventory.setVehicleLivery(owned.vehicleId, String(detail.liveryId), fleet.catalog); const fresh = fleet.vehicleElement(owned.vehicleId, !!detail.flipped); for (const field of ELEMENT_PROFILE_FIELDS)
                if (detail[field] !== undefined)
                    fresh[field] = cloneEditableGraph(detail[field]); return { ...fresh, purchasePrice: Number(game.rollingStock.getById(String(detail.catalogId))?.purchasePrice), homeDepotId: template.home, flipped: !!detail.flipped }; });
            const station = game.world.getStationById(missing.stationId);
            if (!station || station.closed)
                throw new Error('Gare de livraison indisponible.');
            const duty = plan.duties.find(d => d.home === missing.home), track = materialTrackLocation(manager.getSchedule(duty.outboundScheduleId).currentVersion.locations[0]);
            const rame = game.rameManager.add({ name: labels.next(template.name), depotId: template.home, elements: details.map(d => String(d.catalogId)), elementDetails: details, currentLocation: { stationId: station.id, lat: station.lat, lon: station.lon, ...track } });
            fleet.inventory.assignRame(fleet.inventoryRameId(rame.id), rame.elements, rame.elementDetails.map(d => Number(d.physicalVehicleId)));
            for (let i = 0; i < rame.elementDetails.length; i++)
                rotation.materializeRameElement({ ...rame, elementDetails: rame.elementDetails.map(e => ({ ...e, instanceNumber: e.instanceNumber || undefined })) }, i, null);
            units.push({ rame, home: missing.home });
        }
        let generatedRotation;
        if (plan.template) {
            if (!rotation)
                throw new Error('Gestionnaire de matériel indisponible.');
            const duties = plan.duties.map(d => { if (d.key.endsWith('|0'))
                return { ...d }; const source = plan.groupIds.find(id => d.key.startsWith(`${id}|`)), shift = Number(d.key.slice(source.length + 1)), pair = pairs.find(p => p.sourceGroupId === source && p.shiftSec === shift); return { ...d, groupId: pair.group.id, outboundScheduleId: pair.outbound.id, returnScheduleId: pair.return.id }; });
            const certificate = planClosedServiceFleet(duties, quote.activationDate), savedUnits = units.map(({ rame, home }) => { for (let i = 0; i < rame.elementDetails.length; i++)
                rotation.materializeRameElement({ ...rame, elementDetails: rame.elementDetails.map(e => ({ ...e, instanceNumber: e.instanceNumber || undefined })) }, i, null); const formation = rotation.formationForRame({ ...rame, elementDetails: rame.elementDetails.map(e => ({ ...e, instanceNumber: e.instanceNumber || undefined })) }); return { rameId: rame.id, home, materialSignature: certifiedMaterialSignature(rame), vehicleIds: formation.members.map(m => m.vehicleId), formationMembers: formation.members.map(m => ({ vehicleId: m.vehicleId, role: m.role, order: m.order, sourceCouponId: m.sourceCouponId })) }; });
            const selectedSchedules = new Set(plan.groupIds.flatMap(id => { const group = manager.roundTrips.find(g => g.id === id); return [group.outboundScheduleId, group.returnScheduleId]; }));
            for (const owner of rotation.rotations)
                for (const occ of owner.occurrences)
                    if (selectedSchedules.has(occ.scheduleId))
                        occ.activeUntilDate = fleetDayDate(fleetDateDay(quote.activationDate) - 1);
            const calendar = manager.addCalendar({ name: 'Fréquence RC58 · affectation future', startDate: quote.activationDate, endDate: '2999-12-31' });
            generatedRotation = rotation.addRotation({ name: 'Fréquence liée · parc certifié', calendarId: calendar.id, assignmentMode: 'POOL', poolRameIds: units.map(u => u.rame.id) });
            const scheduleIds = [...new Set(duties.flatMap(d => [d.outboundScheduleId, d.returnScheduleId]))];
            for (const id of scheduleIds) {
                const record = manager.getSchedule(id);
                rotation.addOccurrence(generatedRotation.id, { scheduleId: id, versionId: record.currentVersion.id, usesAssignedFormation: false });
            }
            generatedRotation.certifiedFleetPlan = { schemaVersion: 1, activationDate: quote.activationDate, duties, units: savedUnits, certificate, fingerprint: quote.fingerprint, scheduleSignatures: Object.fromEntries(scheduleIds.map(id => [id, certifiedScheduleSignature(manager.getSchedule(id).currentVersion)])), calendarSignatures: Object.fromEntries([...new Set(duties.flatMap(d => manager.getSchedule(d.outboundScheduleId).currentVersion.calendarIds))].map(id => [id, JSON.stringify(manager.calendars.find(c => c.id === id).toJSON())])) };
        }
        if (quote.rameCount && game.economy.addExpense(quote.totalPrice, 'achat', `Fréquence liée · ${quote.rameCount} rame(s) complémentaires · 10 % du neuf`) !== true)
            throw new Error('Paiement du matériel refusé.');
        game.ultimate?.ensureSimpleRameStaff();
        return { copies, pairs, groups: [], quote, rotation: generatedRotation };
    }
    catch (error) {
        manager.schedules.splice(before.schedules);
        manager.roundTrips.splice(before.groups);
        manager.calendars.splice(before.calendars);
        manager.nextEntryNumber = before.counter;
        game.rameManager.rames.splice(before.rames);
        if (rotation) {
            for (const { target, state } of before.vehicleStates || [])
                Object.assign(target, state);
            for (const { target, activeUntilDate } of before.occurrenceCutoffs || []) {
                if (activeUntilDate === undefined)
                    delete target.activeUntilDate;
                else
                    target.activeUntilDate = activeUntilDate;
            }
            rotation.vehicles = before.vehicles;
            rotation.coupons = before.coupons;
            rotation.directAssignments = before.direct;
            rotation.rotations = before.rotations;
        }
        game.rameManager.rames = before.rameReferences;
        if (fleet && inventory)
            fleet.inventory.restore(inventory);
        game.economy.loadFromSave(before.economy);
        if (before.staff)
            game.staffManager?.loadFromSave(before.staff);
        if (before.ultimate)
            game.ultimate?.loadFromSave?.(before.ultimate);
        throw error;
    }
}
