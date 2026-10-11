export function normalizeGameplayMode(input) {
    const difficulty = input?.difficulty === 'expert' ? 'expert' : 'easy';
    const expert = difficulty === 'expert';
    const easyCompetitionEnabled = input?.easyCompetitionEnabled === true;
    return { difficulty, easyCompetitionEnabled, competitionEnabled: expert || easyCompetitionEnabled,
        rotationsRequired: false, personnelRequired: expert, depotsRequired: expert };
}
export function expertDepartureBlock(game, service) {
    if (normalizeGameplayMode(game.realismSettings).difficulty !== 'expert')
        return null;
    if (game.resolveRealismPolicy?.('depots')?.enabled === false)
        return null;
    const depots = (game.depotManager?.getDepots?.() || []).filter(d => d?.type === 'depot' && d.built === true);
    if (!depots.length)
        return { code: 'EXPERT_DEPOT_REQUIRED', message: 'Créez un dépôt opérationnel avant le départ.' };
    const validDepots = new Set(depots.map(d => String(d.id)));
    const sourceId = service._v2DirectRameId || service._v2AssignedRameId || service.rameId || '';
    const source = sourceId ? game.rameManager?.getById?.(sourceId) : null;
    if (source) {
        if (!source.depotId || !validDepots.has(String(source.depotId)))
            return { code: 'EXPERT_RAME_HOME_REQUIRED', message: 'Affectez la rame à un dépôt opérationnel.' };
        if (source.inMaintenance || Number(source.wearLevel || 0) >= 100)
            return { code: 'EXPERT_MAINTENANCE_REQUIRED', message: 'La rame doit être entretenue avant le départ.' };
        return null;
    }
    const vehicleIds = service._v2VehicleIds || [];
    if (!vehicleIds.length || vehicleIds.some(id => !validDepots.has(String(game.rotationV2?.getVehicle?.(id)?.homeDepotId || ''))))
        return { code: 'EXPERT_RAME_HOME_REQUIRED', message: 'Affectez les véhicules du roulement à un dépôt opérationnel.' };
    return null;
}
/** Returns false when the caller must skip this departure's schedule tick. */
export function applyExpertDepartureGate(game, service) {
    if (!['waiting', 'preparation', 'garage', 'stopped_at_station'].includes(String(service.state)) ||
        Number(service.currentStopIndex || 0) !== 0 || !service.train)
        return true;
    const block = expertDepartureBlock(game, service);
    if (block) {
        const reason = `expert : ${block.message}`;
        service.train.delayReason = reason;
        service._movementStop?.(block.code, reason, 'depot');
        return false;
    }
    if (String(service.train.delayReason || '').startsWith('expert : ')) {
        service.train.delayReason = '';
        service._movementGo?.();
    }
    return true;
}
