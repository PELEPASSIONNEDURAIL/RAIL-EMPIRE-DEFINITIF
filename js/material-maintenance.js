const n = (value, fallback = 0) => {
    const result = Number(value);
    return Number.isFinite(result) ? Math.max(0, result) : fallback;
};
const number = (value) => Math.round(value).toLocaleString('fr-FR');
export function preventiveMaintenanceReasons(material, dateStr = '') {
    if (material.inMaintenance)
        return [];
    const km = n(material.kmSinceLastMaint), wear = n(material.wearLevel), reasons = [];
    if (wear >= 20)
        reasons.push(`usure ${number(wear)} % (entretien dès 20 %)`);
    if (km >= 5000)
        reasons.push(`${number(km)} km depuis le dernier entretien (échéance 5 000 km)`);
    const lastMonth = String(material.lastMaintenanceMonth || ''), month = dateStr.slice(0, 7);
    const used = km > 2000 || wear > 20;
    if (used && !lastMonth && km < 5000 && wear < 20)
        reasons.push(`${number(km)} km parcourus sans entretien enregistré (contrôle après 2 000 km)`);
    else if (used && /^\d{4}-\d{2}$/.test(lastMonth) && /^\d{4}-\d{2}$/.test(month) && lastMonth < month)
        reasons.push(`contrôle mensuel : dernier entretien ${lastMonth}, ${number(km)} km depuis`);
    return reasons;
}
export function materialDepotReasons(material, dateStr = '', includeConsumables = true) {
    const reasons = preventiveMaintenanceReasons(material, dateStr);
    const defects = { moteur: 'réparation du moteur', moteur_traction: 'réparation des moteurs de traction',
        traction: 'réparation des moteurs de traction', freins: 'révision des freins', climatisation: 'réparation de la climatisation',
        portes: 'réparation des portes', fanaux: 'contrôle des fanaux', pantographe: 'réparation du pantographe',
        compresseur: 'réparation du compresseur', batterie: 'contrôle de la batterie' };
    for (const defect of new Set(material.pendingDefects || []))
        reasons.push(defects[defect] || `diagnostic du défaut ${defect}`);
    if (includeConsumables) {
        const individual = (material.elementDetails || []).map(d => d.consumables).filter((c) => !!c && typeof c === 'object' && !Array.isArray(c));
        const levels = individual.length ? individual : [material.consumables || {}];
        const resources = [
            ['fuelCapacityL', 'fuelL', 'Gazole', 0.3], ['sandCapacityKg', 'sandKg', 'Sable', 0.4],
            ['oilCapacityL', 'oilL', 'Huile moteur', 0.6], ['coolantCapacityL', 'coolantL', 'Refroidissement', 0.6],
            ['gearboxOilCapacityL', 'gearboxOilL', 'Huile de transmission', 0.6], ['hydraulicOilCapacityL', 'hydraulicOilL', 'Fluide hydraulique', 0.6],
            ['adblueCapacityL', 'adblueL', 'AdBlue', 0.3], ['washerCapacityL', 'washerL', 'Lave-glace', 0.35],
        ];
        for (const [capacity, quantity, label, threshold] of resources) {
            const ratios = levels.filter(c => n(c[capacity]) > 0 && c[quantity] != null).map(c => n(c[quantity]) / n(c[capacity]));
            const ratio = ratios.length ? Math.min(...ratios) : 1;
            if (ratio < threshold)
                reasons.push(`${label} à ${number(ratio * 100)} % : avitaillement conseillé`);
        }
    }
    if (n(material.cleanliness?.exterior, 100) < 70)
        reasons.push(`lavage extérieur : propreté ${number(n(material.cleanliness?.exterior))} %`);
    if (n(material.cleanliness?.interior, 100) < 70)
        reasons.push(`nettoyage intérieur : propreté ${number(n(material.cleanliness?.interior))} %`);
    return reasons;
}
