const nonNegative = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
};
const pct = (v) => Math.min(100, v == null ? 100 : nonNegative(v, 100));
const wet = (weather) => ['light_rain', 'rain', 'heavy_rain', 'storm', 'snow'].includes(weather);
const thermal = (traction) => /diesel|therm|gazole|bimode|hybrid/i.test(traction);
const electric = (traction) => /electric|électri|electri|kv|rail|bimode|hybrid/i.test(traction);
const ownLevels = (detail) => detail?.consumables && typeof detail.consumables === 'object' && !Array.isArray(detail.consumables) ? detail.consumables : null;
const poweredDetail = (detail) => ['locomotive', 'automotrice'].includes(String(detail.category)) && nonNegative(detail.power) > 0;
const capacityKeys = (c) => Object.keys(c || {}).filter(k => /Capacity(?:L|Kg|Units)$/.test(k));
function depleted(c, capacity, quantity) {
    const cap = nonNegative(c[capacity]);
    return cap > 0 && c[quantity] != null && nonNegative(c[quantity], cap) <= 0;
}
function compatible(section, detail) {
    if (section.electrified === false)
        return false;
    const systems = Array.isArray(detail.electricSystems) ? detail.electricSystems : [];
    const volts = (section.voltage ?? []).map(Number).filter(v => Number.isFinite(v) && v > 0);
    if (!volts.length || !systems.length)
        return true; // unknown is not an invented incompatibility
    // Missing frequency is unknown, not an invented 0 Hz (DC) restriction.
    const frequencies = (section.frequency ?? []).filter(f => f != null && f !== '').map(Number).filter(Number.isFinite);
    return systems.some((raw) => {
        if (!raw || typeof raw !== 'object')
            return false;
        const s = raw;
        return volts.some(v => Math.abs(v - Number(s.voltage)) <= Math.max(100, v * 0.1)) &&
            (!frequencies.length || frequencies.some(f => Math.abs(f - Number(s.frequency ?? 0)) <= 1));
    });
}
/** Pure and live: refuelling or a consist edit takes effect on the next tick. */
export function materialResourceEffects(rame, section = {}, weather = 'clear', policy) {
    const individual = rame?.elementDetails?.filter(poweredDetail) || [];
    if (individual.some(ownLevels)) {
        const effects = individual.map(detail => materialResourceEffects({ traction: String(detail.traction || ''), totalPower: nonNegative(detail.power), elementDetails: [{ ...detail, consumables: undefined }], consumables: ownLevels(detail) || rame?.consumables }, section, weather, policy));
        const powerW = effects.reduce((sum, e) => sum + e.powerW, 0);
        return { powerW, fuelUnits: effects.reduce((sum, e) => sum + e.fuelUnits, 0), poweredUnits: effects.reduce((sum, e) => sum + e.poweredUnits, 0), tractionFactor: Math.min(...effects.map(e => e.tractionFactor)), speedCap: Math.min(...effects.map(e => e.speedCap)), stopReason: powerW > 0 ? '' : effects.find(e => e.stopReason)?.stopReason || '', warnings: effects.flatMap((e, i) => e.warnings.map(w => `${individual[i].physicalVehicleId || 'Engin'} : ${w}`)) };
    }
    const physical = policy == null || (policy.enabled !== false && policy.enforce !== false);
    const c = physical ? rame?.consumables ?? {} : {}, warnings = [];
    const dryFuel = depleted(c, 'fuelCapacityL', 'fuelL');
    const dryOil = depleted(c, 'oilCapacityL', 'oilL');
    const dryCoolant = depleted(c, 'coolantCapacityL', 'coolantL');
    const dryTransmission = depleted(c, 'gearboxOilCapacityL', 'gearboxOilL');
    const dryHydraulics = depleted(c, 'hydraulicOilCapacityL', 'hydraulicOilL');
    const dryAdblue = depleted(c, 'adblueCapacityL', 'adblueL');
    const drySand = depleted(c, 'sandCapacityKg', 'sandKg');
    const dryWasher = depleted(c, 'washerCapacityL', 'washerL');
    const dieselBlock = dryFuel ? 'Gazole épuisé — avitaillement requis' : dryOil ? 'Huile moteur épuisée — entretien requis' :
        dryCoolant ? 'Liquide de refroidissement épuisé — entretien requis' : '';
    const commonBlock = dryTransmission ? 'Huile de transmission épuisée — entretien requis' :
        dryHydraulics ? 'Fluide hydraulique épuisé — entretien requis' : '';
    let powerW = 0, fuelUnits = 0, poweredUnits = 0, resourceBlockedPower = false;
    const details = rame?.elementDetails ?? [];
    const powered = details.filter(d => ['locomotive', 'automotrice'].includes(String(d.category)) && nonNegative(d.power) > 0);
    const units = powered.length ? powered : [{ traction: rame?.traction ?? 'none', power: rame?.totalPower ?? 0 }];
    for (const d of units) {
        const installed = nonNegative(d.power) * 1000;
        if (!installed)
            continue;
        poweredUnits++;
        const traction = String(d.traction ?? rame?.traction ?? ''), diesel = thermal(traction), isElectric = electric(traction) && (!diesel || /bimode|hybrid/i.test(traction));
        const onWire = isElectric && compatible(section, d);
        let available = 0;
        if (commonBlock)
            resourceBlockedPower = true;
        else if (onWire)
            available = installed;
        else if (diesel) {
            if (dieselBlock)
                resourceBlockedPower = true;
            else {
                available = installed * (dryAdblue ? 0.5 : 1);
                fuelUnits++;
            }
        }
        else if (!isElectric)
            available = installed; // steam / unknown legacy traction, no fictitious diesel tank
        powerW += available;
    }
    if (dieselBlock)
        warnings.push(dieselBlock);
    if (commonBlock)
        warnings.push(commonBlock);
    if (dryAdblue)
        warnings.push('AdBlue épuisé : puissance thermique réduite à 50 % (règle de jeu)');
    if (drySand)
        warnings.push('Sable épuisé : traction réduite sur rail humide');
    if (dryWasher)
        warnings.push('Lave-glace épuisé : vitesse limitée à 80 km/h par précipitations');
    return { powerW, fuelUnits, poweredUnits,
        tractionFactor: drySand && wet(weather) ? 0.7 : 1,
        speedCap: dryWasher && wet(weather) ? 80 : Infinity,
        stopReason: powerW <= 0 && resourceBlockedPower ? (commonBlock || dieselBlock) : '', warnings };
}
/** Consumption follows actual distance and the active traction mode only. */
export function consumeMaterialResources(rame, distKm, section = {}, policy) {
    if (!rame || !Number.isFinite(distKm) || distKm < 0 || (distKm === 0 && !section.resourceUsage))
        return;
    // Cleaning is a depot task, independent of optional fuel/fluid simulation.
    // Distance is credited once by the physical movement caller; waiting does
    // not accumulate dirt. Preserve the established dry/full-load rates.
    if (rame.cleanliness && distKm > 0 && section.cleanlinessUsage?.enabled !== false) {
        const exteriorFactor = wet(section.cleanlinessUsage?.weather || 'clear') ? 1.5 : 1;
        rame.cleanliness.exterior = Math.max(0, pct(rame.cleanliness.exterior) - distKm * 0.004 * exteriorFactor);
        if (nonNegative(rame.totalCapacity) > 0) {
            const loadFactor = Math.min(1, nonNegative(section.cleanlinessUsage?.passengerLoadFactor, 1));
            rame.cleanliness.interior = Math.max(0, pct(rame.cleanliness.interior) - distKm * 0.006 * loadFactor);
        }
    }
    if (policy?.enabled === false)
        return;
    if (policy?.enforce === false) {
        for (const c of [rame.consumables, ...(rame.elementDetails || []).map(ownLevels)].filter((c) => !!c))
            for (const key of capacityKeys(c))
                c[key.replace('Capacity', '')] = nonNegative(c[key]);
        return;
    }
    const effects = materialResourceEffects(rame, section, 'clear', policy), c = rame.consumables;
    const details = rame.elementDetails || [], usage = section.resourceUsage || {};
    if (details.some(ownLevels)) {
        const passengerCapacity = details.reduce((sum, d) => sum + nonNegative(d.capacity), 0);
        for (const detail of details) {
            const levels = ownLevels(detail);
            if (!levels)
                continue;
            const share = passengerCapacity > 0 ? nonNegative(detail.capacity) / passengerCapacity : 0;
            const knownDoors = nonNegative(detail.doorCount ?? detail.doors) > 0;
            const unitUsage = { ...usage, doorCycles: knownDoors ? nonNegative(usage.doorCycles) : 0, sanitaryUsers: nonNegative(usage.sanitaryUsers) * share, cateringMeals: nonNegative(usage.cateringMeals) * share };
            const unit = { traction: String(detail.traction || ''), totalPower: nonNegative(detail.power), totalCapacity: nonNegative(detail.capacity), elementDetails: [{ ...detail, consumables: undefined }], consumables: levels, consumableRates: detail.consumableRates };
            unitUsage.engineHours = materialResourceEffects(unit, section, 'clear', policy).fuelUnits > 0 ? nonNegative(usage.engineHours) : 0;
            consumeMaterialResources(unit, distKm, { ...section, resourceUsage: unitUsage }, policy);
            if (detail.physicalVehicleId) {
                const saved = (detail.materialUsage || {});
                detail.materialUsage = { km: nonNegative(saved.km) + distKm, operatingHours: nonNegative(saved.operatingHours) + nonNegative(usage.operatingHours), engineHours: nonNegative(saved.engineHours) + nonNegative(unitUsage.engineHours), doorCycles: nonNegative(saved.doorCycles) + nonNegative(unitUsage.doorCycles) };
            }
        }
        const legacy = details.filter(d => !ownLevels(d));
        if (legacy.length && c)
            consumeMaterialResources({ ...rame, cleanliness: undefined, elementDetails: legacy }, distKm, section, policy);
        return;
    }
    if (!c)
        return;
    const use = (capacity, quantity, perKm, perEvent = 0, event = '') => {
        const cap = nonNegative(c[capacity]);
        const configured = rame.consumableRates?.[quantity], thermalFluid = ['fuelL', 'oilL', 'coolantL', 'adblueL'].includes(quantity), hours = thermalFluid ? (effects.fuelUnits > 0 ? nonNegative(usage.engineHours) : 0) : nonNegative(usage.operatingHours ?? usage.engineHours);
        const amount = distKm * nonNegative(configured?.perKm, perKm) + hours * nonNegative(configured?.perHour) + nonNegative(usage[configured?.event || event]) * nonNegative(configured?.perEvent, perEvent);
        if (cap > 0 && amount > 0)
            c[quantity] = Math.max(0, Math.min(cap, c[quantity] == null ? cap : nonNegative(c[quantity], cap)) - amount);
    };
    use('fuelCapacityL', 'fuelL', 1.8 * effects.fuelUnits);
    use('oilCapacityL', 'oilL', 0.0012 * effects.fuelUnits);
    use('coolantCapacityL', 'coolantL', 0.0008 * effects.fuelUnits);
    use('adblueCapacityL', 'adblueL', 0.08 * effects.fuelUnits);
    use('gearboxOilCapacityL', 'gearboxOilL', 0.0005 * effects.poweredUnits);
    use('hydraulicOilCapacityL', 'hydraulicOilL', 0.00025 * effects.poweredUnits);
    use('sandCapacityKg', 'sandKg', 0.018 * effects.poweredUnits);
    use('washerCapacityL', 'washerL', 0.0008);
    use('waterCapacityL', 'waterL', 0, 0, 'sanitaryUsers');
    use('cateringCapacityUnits', 'cateringUnits', 0, 0, 'cateringMeals');
}
export function passengerCleanlinessPenalty(rame) {
    return ((100 - pct(rame?.cleanliness?.interior)) * 0.9 + (100 - pct(rame?.cleanliness?.exterior)) * 0.1) * 0.3;
}
export function passengerSatisfactionScore(rame, delayMinutes, stationBonus) {
    return Math.max(0, Math.min(100, 85 - passengerCleanlinessPenalty(rame) - Math.min(30, nonNegative(delayMinutes) * 0.5) + nonNegative(stationBonus) * 100));
}
