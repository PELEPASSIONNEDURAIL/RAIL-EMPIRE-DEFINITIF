/** A shared form layout; never replaces fields or their listeners. */
export function layoutExperimentalModule(host) {
    if (!host.classList || typeof host.closest !== 'function' || !host.closest('#page-experimental'))
        return;
    host.classList.add('exp-content');
    const captions = { need: 'Exprimer un besoin', order: 'Commander le matériel', campaign: 'Organiser une campagne', policy: 'Souscrire une assurance', decision: 'Traiter un sinistre', 'customs-lot': 'Déclarer un lot international', reroute: 'Réacheminer un lot', complaint: 'Enregistrer une réclamation', renegotiate: 'Renégocier le contrat', parcel: 'Enregistrer une parcelle', 'build-offers': 'Construire une installation', close: 'Clôturer la période', hub: 'Créer un lieu logistique', demand: 'Créer une demande d’achat', supplier: 'Configurer un fournisseur', reference: 'Ajouter une référence', pickup: 'Organiser un ramassage', receipt: 'Réceptionner une livraison', transfer: 'Transférer du stock', reserve: 'Réserver des pièces', 'work-resources': 'Approvisionner un chantier', 'industrial-leg': 'Acheminer le fret industriel', 'reference-search': 'Rechercher une référence', trace: 'Retrouver un dossier' };
    for (const table of host.querySelectorAll('table')) {
        if (table.parentElement?.classList.contains('exp-table-scroll'))
            continue;
        const wrap = host.ownerDocument.createElement('div');
        wrap.className = 'exp-table-scroll';
        table.before(wrap);
        wrap.append(table);
    }
    for (const form of host.querySelectorAll('form')) {
        form.classList.add('exp-form');
        if (form.closest('details') || form.dataset.expLayout === 'done')
            continue;
        form.dataset.expLayout = 'done';
        const kind = form.dataset.enterpriseForm || form.dataset.logForm || '';
        if (kind === 'reference-search' || kind === 'trace')
            continue;
        const heading = form.querySelector('h3,h4,strong,legend');
        const title = heading?.textContent?.trim() || captions[kind] || form.querySelector('button')?.textContent?.trim() || 'Configurer';
        const details = host.ownerDocument.createElement('details');
        details.className = 'exp-action';
        const summary = host.ownerDocument.createElement('summary');
        summary.textContent = title;
        form.before(details);
        details.append(summary, form);
        if (heading)
            heading.remove();
    }
    for (const fieldset of host.querySelectorAll('fieldset'))
        fieldset.classList.add('exp-fieldset');
    for (const tabs of host.querySelectorAll('[data-log-tab],[data-enterprise-tab], [data-security-tab]'))
        tabs.classList.add('exp-tab');
    for (const button of host.querySelectorAll('button'))
        if (!button.getAttribute('type') && button.closest('form') === null)
            button.type = 'button';
}
