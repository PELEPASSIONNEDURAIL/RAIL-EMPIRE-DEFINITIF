export const EXPERIMENTAL_SECTIONS = [
    { id: 'operations', label: 'Circulations', group: 'Trafic', description: 'Les trains de votre compagnie, leur progression et leurs causes d’attente.' },
    { id: 'regulation', label: 'Régulation', group: 'Trafic', description: 'Choisissez une circulation avant de décider d’une retenue ou d’une priorité.' },
    { id: 'signaling', label: 'Signalisation', group: 'Trafic', description: 'Occupation, réservations et autorités de mouvement des trains réels.' },
    { id: 'energy', label: 'Énergie', group: 'Réseau', description: 'Alimentation électrique et affectation des trains aux sections configurées.' },
    { id: 'stations', label: 'Gares', group: 'Réseau', description: 'Quais, équipes et ressources de service dans les gares.' },
    { id: 'reliability', label: 'Fiabilité', group: 'Matériel', description: 'État des engins, défauts et conséquences sur leur disponibilité.' },
    { id: 'workshop', label: 'Atelier', group: 'Matériel', description: 'Diagnostic, pièces, personnel, réparation et retour en service.' },
    { id: 'catalog-series', label: 'Séries / Import', group: 'Matériel', description: 'Préparez une série d’images, vérifiez les fiches et importez votre matériel.' },
    { id: 'logistics', label: 'Logistique', group: 'Compagnie', description: 'Achats, stocks, transport et réception des approvisionnements.' },
    { id: 'enterprise', label: 'Entreprise', group: 'Compagnie', description: 'Commandes constructeur, clients, patrimoine et comptabilité.' },
    { id: 'security', label: 'Sûreté / Radio', group: 'Compagnie', description: 'Signalements, équipes d’intervention et communication radio.' },
];
export function isExperimentalSection(value) { return EXPERIMENTAL_SECTIONS.some(s => s.id === value); }
export function experimentalMenu() {
    let group = '';
    return EXPERIMENTAL_SECTIONS.map(s => {
        const heading = group === s.group ? '' : `<h3>${s.group}</h3>`;
        group = s.group;
        return `${heading}<button type="button" data-experimental-section="${s.id}" aria-pressed="false">${s.label}</button>`;
    }).join('');
}
