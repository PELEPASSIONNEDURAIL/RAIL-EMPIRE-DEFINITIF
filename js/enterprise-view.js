import { layoutExperimentalModule } from './experimental-layout.js';
import { htmlText } from './html-text.js';
import { ENTERPRISE_CONSTRUCTORS } from './enterprise.js';
const PAGE_SIZE = 25;
const state = new WeakMap();
const money = (value) => Math.round(value).toLocaleString('fr-FR') + ' €';
const date = (value) => new Date(value).toLocaleString('fr-FR');
const tabs = [['qg', 'QG · commandes'], ['insurance', 'Assurance'], ['customs', 'Douane'], ['crm', 'Relation clients'], ['property', 'Patrimoine'], ['accounting', 'Comptabilité']];
const button = (action, label, id = '') => `<button type="button" data-enterprise-action="${htmlText(action)}" data-id="${htmlText(id)}">${htmlText(label)}</button>`;
const options = (values, selected) => values.map(v => `<option value="${htmlText(v)}"${v === selected ? ' selected' : ''}>${htmlText(v)}</option>`).join('');
const field = (name, label, value = '', type = 'text') => `<label style="display:grid;gap:4px">${htmlText(label)}<input name="${htmlText(name)}" type="${htmlText(type)}" value="${htmlText(value)}"${type === 'number' ? ' min="0" step="any"' : ''} required></label>`;
const select = (name, label, content, multiple = false) => `<label style="display:grid;gap:4px">${htmlText(label)}<select name="${htmlText(name)}"${multiple ? ' multiple' : ''}>${content}</select></label>`;
const form = (kind, content, label, id = '') => `<form data-enterprise-form="${htmlText(kind)}" data-id="${htmlText(id)}" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin:12px 0">${content}<button type="submit">${htmlText(label)}</button></form>`;
const table = (headers, rows) => `<div style="overflow:auto"><table style="width:100%;text-align:left"><thead><tr>${headers.map(h => `<th>${htmlText(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${headers.length}">Aucun dossier pour le moment.</td></tr>`}</tbody></table></div>`;
const row = (cells) => `<tr>${cells.map(c => `<td style="padding:8px;vertical-align:top">${c}</td>`).join('')}</tr>`;
const panel = (title, content) => `<section style="padding:12px;border:1px solid var(--border-color,#334155);border-radius:8px;margin:12px 0"><h3>${htmlText(title)}</h3>${content}</section>`;
const enterpriseDraftKey = (tab, form) => `${tab}:${form.dataset.enterpriseForm}:${form.dataset.id || ''}`;
function rememberEnterpriseDrafts(host, view) {
    if (!host.ownerDocument || !host.querySelector)
        return;
    const tab = host.dataset.enterpriseRenderedTab;
    if (!tab)
        return;
    view.drafts ?? (view.drafts = new Map());
    view.folds ?? (view.folds = new Map());
    view.scroll ?? (view.scroll = new Map());
    for (const form of host.querySelectorAll('form[data-enterprise-form]')) {
        const key = enterpriseDraftKey(tab, form);
        if (form.dataset.draftReset) {
            view.drafts.delete(key);
            continue;
        }
        view.drafts.set(key, [...form.querySelectorAll('input,select,textarea')].filter(c => c.getAttribute('name') && c.getAttribute('type') !== 'file').map(c => {
            const field = c;
            return { name: field.name, value: field.value, ...(field.type === 'checkbox' ? { checked: field.checked } : {}), ...(c.tagName === 'SELECT' ? { values: [...c.options].filter(o => o.selected).map(o => o.value) } : {}) };
        }));
    }
    for (const details of host.querySelectorAll('details')) {
        const f = details.querySelector('form[data-enterprise-form]');
        view.folds.set(`${tab}:${f ? enterpriseDraftKey(tab, f) : details.querySelector('summary')?.textContent}`, details.open);
    }
    const workspace = host.closest('#experimental-workspace');
    view.scroll.set(tab, (workspace ?? host).scrollTop);
}
function restoreEnterpriseDrafts(host, view) {
    if (!host.ownerDocument || !host.querySelector)
        return;
    host.dataset.enterpriseRenderedTab = view.tab;
    for (const form of host.querySelectorAll('form[data-enterprise-form]'))
        for (const saved of view.drafts?.get(enterpriseDraftKey(view.tab, form)) ?? []) {
            const c = [...form.querySelectorAll('input,select,textarea')].find(c => c.getAttribute('name') === saved.name);
            if (!c)
                continue;
            if (c.tagName === 'SELECT') {
                const select = c, valid = [...select.options].filter(o => (saved.values ?? [saved.value]).includes(o.value));
                if (valid.length || select.multiple)
                    for (const o of select.options)
                        o.selected = valid.includes(o);
            }
            else if (c.type === 'checkbox')
                c.checked = !!saved.checked;
            else
                c.value = saved.value;
        }
    for (const details of host.querySelectorAll('details')) {
        const f = details.querySelector('form[data-enterprise-form]');
        const open = view.folds?.get(`${view.tab}:${f ? enterpriseDraftKey(view.tab, f) : details.querySelector('summary')?.textContent}`);
        if (open !== undefined)
            details.open = open;
    }
    const workspace = host.closest('#experimental-workspace');
    (workspace ?? host).scrollTop = view.scroll?.get(view.tab) ?? 0;
}
export function renderEnterprisePage(host, manager, context) {
    let view = state.get(host);
    if (!view) {
        view = { tab: context.initialTab ?? 'qg', notice: '', offset: 0, route: context.initialTab };
        state.set(host, view);
    }
    if (context.initialTab && context.initialTab !== view.route) {
        view.tab = context.initialTab;
        view.route = context.initialTab;
        view.offset = 0;
        view.notice = '';
    }
    rememberEnterpriseDrafts(host, view);
    const current = view;
    const entityId = context.entityId ?? host.dataset?.entityId ?? host.closest?.('[data-experimental-section-host],.page')?.getAttribute('data-entity-id') ?? '';
    if (entityId !== current.entityId) {
        current.entityId = entityId;
        const index = manager.orders.findIndex(order => order.id === entityId);
        if (index >= 0) {
            current.tab = 'qg';
            current.offset = Math.floor(index / PAGE_SIZE) * PAGE_SIZE;
            current.notice = '';
        }
    }
    const catalog = manager.dependencies.catalog(), depots = context.depots?.() ?? [], now = context.epoch(), simple = context.simple();
    const reportForCount = current.tab === 'accounting' ? manager.report(0, now + 1) : undefined;
    const count = current.tab === 'qg' ? Math.max(manager.quotes.length, manager.orders.length, manager.warrantyClaims.length, manager.replacementLeases.length) : current.tab === 'insurance' ? Math.max(manager.policies.length, manager.claims.length) : current.tab === 'customs' ? manager.customs.length : current.tab === 'crm' ? Math.max(manager.customers.length, manager.complaints.length) : current.tab === 'property' ? Math.max(manager.parcels.length, manager.constructionOffers.length, manager.buildings.length) : Math.max(manager.ledger.length, ['byActivity', 'byLine', 'byContract', 'byDepot', 'byFleet', 'bySupply'].reduce((total, key) => total + Object.keys(reportForCount[key]).length, 0));
    const lastOffset = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1) * PAGE_SIZE;
    current.offset = Math.max(0, Math.min(current.offset, lastOffset));
    const page = (values, _limit = PAGE_SIZE) => values.slice(current.offset, current.offset + PAGE_SIZE);
    let content = '';
    if (current.tab === 'qg') {
        const sources = context.sources?.() ?? [{ kind: 'fleet', id: 'target', label: 'Objectif de parc' }];
        const sourceOptions = sources.map(source => `<option value="${htmlText(source.kind + ':' + source.id)}">${htmlText(source.label)}</option>`).join('');
        const familyOptions = options([...new Set(catalog.map(m => m.family))]);
        content = panel('Exprimer un besoin', form('need', select('source', 'Point de départ', sourceOptions) + select('family', 'Famille', familyOptions) + field('capacity', 'Capacité minimale', 100, 'number') + field('quantity', 'Quantité', 1, 'number') + select('location', 'Point de livraison', depots.map(d => `<option value="${htmlText(d.id)}">${htmlText(d.name)}</option>`).join('') || '<option value="">Aucun lieu de livraison</option>') + (depots.length ? select('depotId', 'Dépôt', depots.map(d => `<option value="${htmlText(d.id)}">${htmlText(d.name)}</option>`).join('')) : '<p>Créez et construisez un dépôt dans Depots/ITE pour recevoir votre matériel.</p><input name="depotId" type="hidden" value="">'), 'Comparer les offres').replace('<button type="submit">', `<button type="submit"${!depots.length || !catalog.length || !sources.length ? ' disabled' : ''}>`));
        if (!catalog.length)
            content += '<p role="status">Catalogue vide : ajoutez un modèle dans Catalogue ou Séries / Import avant de comparer les offres.</p>';
        if (!sources.length)
            content += '<p role="status">Aucune rame ou circulation disponible comme source du besoin.</p>';
        content += panel('Constructeurs · paramètres gameplay', table(['Constructeur', 'Familles', 'Capacité annuelle', 'Délai de base', 'Qualité'], ENTERPRISE_CONSTRUCTORS.map(c => row([htmlText(c.name), htmlText(c.families.join(', ')), String(c.annualCapacity), `${c.leadDays} jours`, `${Math.round(c.quality * 100)} %`]))));
        content += panel('Appels d’offres', table(['Modèle / fournisseur', 'Prix / sortie prévue', 'Configuration compatible'], page(manager.quotes).map(q => {
            const m = catalog.find(model => model.id === q.modelId), maker = ENTERPRISE_CONSTRUCTORS.find(c => c.id === q.constructorId);
            if (!m)
                return row([htmlText(q.modelId), 'Catalogue indisponible', '']);
            const existingOrder = manager.orders.find(o => o.quoteId === q.id);
            if (existingOrder)
                return row([htmlText(m.name), money(existingOrder.price), `Commande ${htmlText(existingOrder.id)} déjà enregistrée · ${htmlText(existingOrder.stage)}.`]);
            const need = manager.needs.find(n => n.id === q.needId), presets = m.configurations?.filter(c => c.capacity >= (need?.capacity ?? 0)) ?? [];
            const chosen = presets.find(c => c.id === current.configurations?.[q.id]) ?? presets.find(c => c.catalogId === m.id) ?? presets[0], allowed = chosen ?? m;
            const configuration = presets.length ? select('configurationId', 'Capacité et équipements catalogue', presets.map(c => `<option value="${htmlText(c.id)}"${c.id === chosen?.id ? ' selected' : ''}>${htmlText(c.label)} · capacité ${c.capacity} · ${htmlText(c.equipment.join(', ') || 'équipements non renseignés')} · ${money(c.price)} / unité</option>`).join('')).replace('name="configurationId"', `name="configurationId" data-enterprise-configuration="${htmlText(q.id)}"`) : '';
            const liveryChoices = chosen?.liveryChoices?.map(l => `<option value="${htmlText(l.id)}">${htmlText(l.label)}</option>`).join('') ?? options(allowed.liveries);
            return row([`${htmlText(m.name)} · ${q.quantity}<br>${htmlText(maker?.name ?? q.constructorId)}`, `${money(chosen ? Math.round(chosen.price * q.quantity * (maker?.priceFactor ?? 1)) : q.price)}<br>${htmlText(date(q.readyAt))}`, form('order', configuration + (chosen ? `<p>Capacité ${chosen.capacity} · équipements inclus : ${htmlText(chosen.equipment.join(', ') || 'non renseignés au catalogue')}.</p>` : '') + select('livery', 'Livrée compatible', liveryChoices) + (allowed.options.length ? select('options', 'Options déclarées compatibles', options(allowed.options), true) : '<p>Aucune option supplémentaire déclarée.</p>') + select('homologations', 'Homologations compatibles', options(allowed.homologations), true), 'Commander', q.id)]);
        })));
        content += panel('Portefeuille commandes', table(['Commande', 'Production / financement', 'Dates / garantie', 'Matériel / actions'], page(manager.orders).map(o => row([
            `${htmlText(o.id)} · ${htmlText(catalog.find(m => m.id === o.modelId)?.name ?? o.modelId)} × ${o.quantity}<br>${htmlText(o.seriesId)} · ${htmlText(o.options.join(', '))}${o.configurationId ? `<br>Capacité ${o.capacity} · ${htmlText(o.equipment?.join(', ') || 'équipements non renseignés')}` : ''}<br>Livrée ${htmlText(o.livery)} · homologations ${htmlText(o.homologations.join(', ') || 'non renseignées')}`,
            `${htmlText({ configuration: 'Configuration et acompte', assembly: 'Assemblage', 'factory-tests': 'Essais usine', ready: 'Prêt pour inspection', accepted: 'Accepté · livraison attendue', delivered: 'Livré · préparation en dépôt', commissioned: 'Disponible en service' }[o.stage] || o.stage)}${o.receiptIssue ? `<br>${htmlText(o.receiptIssue)}` : ''}<br>${o.installments.map(i => `${money(i.amount)} ${i.paid ? 'payé' : 'à échéance'}`).join('<br>')}<br>${o.delayDays ? `Retard : ${o.delayDays} jours` : ''}`,
            `Sortie ${htmlText(date(o.readyAt))}<br>Livraison ${htmlText(date(o.deliveryAt))}<br>Garantie ${htmlText(date(o.warrantyUntil))}`,
            `${htmlText(o.vehicleIds.join(', ') || 'En fabrication')}<br>Remplacement : ${htmlText(o.replacementIds.join(', ') || 'aucun')}<br>${o.stage === 'ready' ? (!o.inspected ? button('inspect', 'Inspecter', o.id) : '<span>Inspection réalisée.</span>') + (o.inspected && o.defect && !o.defectCorrected ? button('correct', 'Corriger le défaut constaté', o.id) : '') + (o.inspected && (!o.defect || o.defectCorrected) ? button('accept', 'Accepter la réception', o.id) : '<small>Inspectez puis corrigez tout défaut avant acceptation.</small>') : ''}${o.stage === 'delivered' ? (!o.trained ? button('train', 'Former un conducteur à la série', o.id) : '<span>Conducteur habilité.</span>') + (o.trained && (simple || now >= o.preparationAt) ? button('commission', 'Mettre en service au dépôt', o.id) : `<small>${o.trained ? 'Fin de préparation : ' + htmlText(date(o.preparationAt)) : 'Un conducteur libre et le budget de formation sont requis dans Personnel.'}</small>`) : ''}${o.delayDays ? button('lease', 'Louer un remplacement', o.id) + button('replan', 'Replanifier service', o.id) + button('substitute', 'Affecter matériel existant', o.id) + button('priority', 'Priorité autre lot', o.id) : ''}${o.vehicleIds.length ? form('campaign', field('reason', 'Motif campagne fournisseur'), 'Transmettre à la fiabilité', o.id) : ''}`
        ]).replace('<tr>', `<tr data-enterprise-entity-id="${htmlText(o.id)}">`))));
        content += panel('Garantie constructeur · dossiers atelier', table(['Dossier / véhicule / commande', 'Pièces / preuve / échéance', 'Statut / prise en charge'], page(manager.warrantyClaims, 25).map(c => row([`${htmlText(c.id)}<br>${htmlText(c.vehicleId)} · ${htmlText(c.factoryOrderId)}<br>Ordre atelier ${htmlText(c.workshopOrderId)}`, `${htmlText(c.partId || 'Pièces atelier')} × ${c.quantity}<br>Coût ${money(c.partsCost)} · garanti jusqu’au ${htmlText(date(c.warrantyUntil))}<br>${htmlText(c.proof.join(' · '))}`, `${htmlText(c.stage)} · ${htmlText(c.reason)}<br>Prise en charge ${money(c.refund)}${c.stage === 'ready' ? button('pay-warranty', 'Verser prise en charge', c.id) : ''}`]))));
        content += panel('Locations temporaires de remplacement', table(['Contrat / véhicule physique', 'Actif jusqu’au', 'Restitution sûre'], page(manager.replacementLeases, 25).map(l => row([`${htmlText(l.orderId)}<br>${htmlText(l.vehicleId)}`, htmlText(date(l.until)), `${htmlText(l.status)}${l.status === 'pending-release' ? '<br>Restitution différée : attendre la fin des engagements physiques. ' + button('release-lease', 'Réessayer restitution', l.id) : ''}`]))));
    }
    else if (current.tab === 'insurance') {
        content = panel('Souscrire une couverture', form('policy', select('kind', 'Couverture', options(['fleet', 'cargo'])) + select('category', 'Catégorie flotte', options([...new Set(catalog.map(m => m.family))])) + field('contractId', 'Contrat fret (facultatif)') + field('lotId', 'Lot fret (facultatif)') + field('annualPremium', 'Prime annuelle gameplay', 1000, 'number') + field('deductible', 'Franchise', 100, 'number') + field('limit', 'Plafond', 100000, 'number'), 'Souscrire').replace(/name="(contractId|lotId)"([^>]+) required/g, 'name="$1"$2'));
        content += `<p>Coefficient de prime : ${manager.premiumFactor(simple).toFixed(2)} · bornes 0,70 à 1,50 en Expert; ${manager.claims.length} sinistres historiques. Les montants sont des paramètres gameplay.</p>`;
        content += panel('Polices actives', table(['Police', 'Couverture', 'Prime / franchise / plafond', 'Prochaine prime'], page(manager.policies).map(p => row([htmlText(p.id), `${htmlText(p.kind)} · ${htmlText(p.category ?? p.contractId ?? p.lotId)}`, `${money(p.annualPremium)} / ${money(p.deductible)} / ${money(p.limit)}`, htmlText(date(p.nextPremiumAt))]))));
        content += panel('Sinistres · preuves du moteur', table(['Dossier / incident', 'Statut / décision', 'Preuves', 'Action'], page(manager.claims).map(c => row([`${htmlText(c.id)}<br>${htmlText(c.incidentId)}`, `${htmlText(c.stage)} · ${money(c.award)}<br>${htmlText(c.reason)}`, htmlText(c.proof.join(', ')), c.stage === 'open' ? button('expertise', 'Expertiser', c.id) : c.stage === 'expertise' ? form('decision', select('decision', 'Décision', options(['accept', 'deny'])) + field('reason', 'Motif', 'Preuves conformes'), 'Décider', c.id) : c.stage === 'decision' ? button('pay-claim', 'Payer indemnité', c.id) : 'Dossier traité']))));
    }
    else if (current.tab === 'customs') {
        const lots = context.lots?.() ?? [];
        content = `<p>Les documents reprennent l’origine, la destination, la marchandise, la valeur et le contrat du lot. Frais gameplay bornés entre 0 % et 25 %; aucune fiscalité réelle annoncée.</p>`;
        content += lots.length ? panel('Lots internationaux', form('customs-lot', select('lotId', 'Lot', lots.map(l => `<option value="${htmlText(l.id)}">${htmlText(l.id)} · ${htmlText(l.origin)} → ${htmlText(l.destination)} · ${htmlText(l.cargo)}</option>`).join('')) + field('rate', 'Taux gameplay', .02, 'number'), 'Préparer les documents')) : '';
        content += panel('Dossiers douaniers', table(['Lot / contrat', 'Documents', 'Statut / ETA', 'Frais / formalités'], page(manager.customs, 90).map(c => row([`${htmlText(c.lotId)}<br>${htmlText(c.contractId)}`, `${htmlText(c.documents.origin)} → ${htmlText(c.documents.destination)}<br>${htmlText(c.documents.cargo)} · ${money(c.documents.value)}`, `${htmlText(c.status)}<br>${htmlText(date(c.eta))}`, `${money(c.fee)} · ${c.broker ? 'courtier mandaté' : 'gestion manuelle'}<br>${button('broker', 'Mandater courtier', c.id)}${button('clear-customs', 'Valider contrôle', c.id)}${c.status === 'held' ? form('reroute', field('destination', 'Destination alternative'), 'Rerouter lot réel', c.id) : ''}`]))));
    }
    else if (current.tab === 'crm') {
        content = panel('Cohortes voyageurs et chargeurs fret', table(['Client / interlocuteur', 'Historique / satisfaction', 'SLA', 'Renégociation'], page(manager.customers).map(c => { const sla = manager.customerSla(c.id); return row([`${htmlText(c.id)} · ${htmlText(c.kind)}<br>${htmlText(c.interlocutor)}`, `${c.serviceIds.length} services · ${c.complaintIds.length} réclamations · ${c.satisfaction} %<br>${c.interactions.slice(-3).map(i => htmlText(i.label)).join('<br>')}`, `Ponctualité ${Math.round(sla.punctuality)} %<br>Intégrité ${Math.round(sla.integrity)} %<br>Livraison ${Math.round(sla.delivery)} %<br>Disponibilité ${Math.round(sla.availability)} %`, c.kind === 'freight' && c.contractIds.length ? form('renegotiate', select('contractId', 'Contrat', options(c.contractIds)) + field('terms', 'Nouvelles conditions'), 'Enregistrer', c.id) : 'Cohorte agrégée']); })));
        content += panel('Réclamations liées aux services réels', table(['Ticket / service', 'Incident / valeur', 'Résolution'], page(manager.complaints).map(c => row([`${htmlText(c.customerId)}<br>${htmlText(c.serviceId)} · ${htmlText(c.id)}`, `${htmlText(c.cause)} · ${money(c.value)}`, c.status === 'open' ? form('complaint', select('resolution', 'Solution', options(['refund', 'credit', 'redelivery', 'refusal', 'gift'])) + field('reason', 'Motif', 'Service constaté'), 'Résoudre', c.id) : `${htmlText(c.resolution)} · ${htmlText(c.reason)}${c.credit ? `<br>Avoir ${money(c.credit)}` : ''}`]))));
    }
    else if (current.tab === 'property') {
        content = panel('Acquérir une parcelle abstraite', form('parcel', field('location', 'Lieu / dépôt') + field('area', 'Surface (m²)', 2000, 'number') + field('cost', 'Coût acquisition', 10000, 'number') + field('rent', 'Loyer mensuel', 0, 'number'), 'Acquérir'));
        content += `<p>Ces projets ajoutent un bâtiment exploitable. L’éditeur d’infrastructure garde ses voies et ses outils.</p>`;
        content += panel('Foncier', table(['Parcelle', 'Lieu / surface', 'Coût / loyer', 'Projet'], page(manager.parcels, 25).map(p => row([htmlText(p.id), `${htmlText(p.location)} · ${p.area} m²`, `${money(p.cost)} · ${money(p.rent)} / mois`, form('build-offers', select('kind', 'Bâtiment', options(['depot', 'terminal', 'workshop', 'hub'])), 'Comparer entreprises', p.id)]))));
        content += panel('Devis entreprises de travaux', table(['Sous-traitant / projet', 'Coût / délai / fiabilité', 'Action'], page(manager.constructionOffers, 25).map(q => row([`${htmlText(q.builderId)} · ${htmlText(q.kind)}`, `${money(q.price)} · ${q.durationDays} jours · ${Math.round(q.reliability * 100)} %`, button('start-building', 'Lancer étude', q.id)]))));
        content += panel('Constructions par phases', table(['Projet', 'Phase', 'Mise en service'], page(manager.buildings, 25).map(b => row([`${htmlText(b.kind)} · ${htmlText(b.location)}`, htmlText(b.stage), htmlText(date(b.completeAt))]))));
    }
    else {
        const report = manager.report(0, now + 1);
        content = `<p>Compte de résultat gameplay : recettes ${money(report.revenue)} · coûts ${money(report.costs)} · résultat ${money(report.result)} · cash-flow ${money(report.cashflow)}. Coûts informatifs de secours : ${money(report.informationalCosts)}.</p>`;
        content += form('close', field('from', 'Début (epoch ms)', Math.floor(now / 86400000) * 86400000, 'number') + field('to', 'Fin exclusive (epoch ms)', now + 1, 'number'), 'Clôturer période');
        const dimensions = [['Activité', report.byActivity], ['Ligne', report.byLine], ['Contrat', report.byContract], ['Dépôt', report.byDepot], ['Parc', report.byFleet], ['Supply chain', report.bySupply]];
        content += panel('Ventilation analytique', table(['Axe', 'Référence', 'Montant'], dimensions.flatMap(([axis, entries]) => Object.entries(entries).map(([key, value]) => row([htmlText(axis), htmlText(key), money(value)]))).slice(current.offset, current.offset + PAGE_SIZE)));
        content += panel('Journal · solde détenu par Economy', table(['Date', 'Activité / pièce', 'Axes', 'Montant'], page(manager.ledger, 40).map(p => row([htmlText(date(p.at)), `${htmlText(p.activity)} · ${htmlText(p.label)}<br>${htmlText(p.id)}`, htmlText([p.lineId, p.contractId, p.depotId, p.fleetId, p.supplyId].filter(Boolean).join(' / ')), `${money(p.amount)}${p.informational ? ' · informatif' : ''}`]))));
    }
    host.innerHTML = `<div class="enterprise-page" data-enterprise-tab="${current.tab}"><h2>Entreprise</h2><nav style="display:flex;gap:8px;flex-wrap:wrap" aria-label="Gestion entreprise">${tabs.map(([id, label]) => `<button type="button" data-enterprise-action="tab" data-id="${id}" aria-pressed="${id === current.tab}">${htmlText(label)}</button>`).join('')}</nav><div style="display:flex;gap:8px;margin:12px 0">${button('delegate', manager.isDelegated(simple) ? 'Reprendre la main' : 'Tout gérer pour moi')}${button('refresh', 'Actualiser')}${button('previous', 'Dossiers précédents').replace('<button ', `<button ${current.offset === 0 ? 'disabled ' : ''}`)}${button('next', 'Dossiers suivants').replace('<button ', `<button ${current.offset >= lastOffset ? 'disabled ' : ''}`)}<span>${count ? `${current.offset + 1}–${Math.min(count, current.offset + PAGE_SIZE)} / ${count}` : 'Aucun dossier'} · ${PAGE_SIZE} lignes maximum par tableau</span></div>${current.notice ? `<p role="${current.error ? 'alert' : 'status'}" data-enterprise-message style="color:${current.error ? '#ff8a8a' : '#8bd8af'}">${htmlText(current.notice)}</p>` : ''}${content}</div>`;
    layoutExperimentalModule(host);
    restoreEnterpriseDrafts(host, current);
    host.querySelectorAll('select[data-enterprise-configuration]').forEach(element => element.addEventListener('change', () => {
        const quoteId = element.dataset.enterpriseConfiguration;
        if (!quoteId)
            return;
        current.configurations ?? (current.configurations = {});
        current.configurations[quoteId] = element.value;
        renderEnterprisePage(host, manager, context);
    }));
    const run = (action, success = 'Action enregistrée.', failure = 'Action indisponible : vérifiez les prérequis indiqués dans le dossier.', submitted) => {
        try {
            manager.advance(context.epoch(), context.simple());
            const result = action();
            current.error = result === false || result === null;
            current.notice = current.error ? failure : success;
            if (submitted && !current.error)
                submitted.dataset.draftReset = 'true';
            context.onChange?.();
        }
        catch (error) {
            current.error = true;
            current.notice = error instanceof Error ? error.message : String(error);
        }
        renderEnterprisePage(host, manager, context);
    };
    host.querySelectorAll('button[data-enterprise-action]').forEach(element => element.addEventListener('click', () => {
        if (element.disabled)
            return;
        const action = element.dataset.enterpriseAction, id = element.dataset.id ?? '';
        if (action === 'tab') {
            if (tabs.some(([key]) => key === id)) {
                current.tab = id;
                current.offset = 0;
                current.notice = '';
                renderEnterprisePage(host, manager, context);
            }
            return;
        }
        if (action === 'next' || action === 'previous') {
            current.offset = Math.max(0, Math.min(lastOffset, current.offset + (action === 'next' ? PAGE_SIZE : -PAGE_SIZE)));
            renderEnterprisePage(host, manager, context);
            return;
        }
        run(() => {
            switch (action) {
                case 'delegate':
                    manager.setDelegated(!manager.isDelegated(simple));
                    manager.advance(context.epoch(), context.simple());
                    return true;
                case 'refresh': return true;
                case 'inspect': return manager.inspectOrder(id);
                case 'correct': return manager.correctFactoryDefect(id);
                case 'accept': return manager.acceptOrder(id, context.simple());
                case 'train': return manager.trainOrder(id, context.simple());
                case 'commission': return manager.commissionOrder(id, context.simple());
                case 'pay-warranty': return manager.payWarrantyClaim(id, context.simple());
                case 'release-lease': return manager.releaseReplacementLease(id);
                case 'lease': return manager.resolveDelay(id, 'lease', context.simple());
                case 'replan': return manager.resolveDelay(id, 'replan', context.simple());
                case 'substitute': return manager.resolveDelay(id, 'substitution', context.simple());
                case 'priority': return manager.resolveDelay(id, 'priority', context.simple());
                case 'expertise': return manager.expertiseClaim(id);
                case 'pay-claim': return manager.payClaim(id, context.simple());
                case 'broker': return manager.assignBroker(id);
                case 'clear-customs': return manager.clearCustoms(id, context.simple());
                case 'start-building': return manager.startConstruction(id, context.simple());
                default: return false;
            }
        }, { inspect: 'Inspection enregistrée : relisez le résultat du contrôle.', correct: 'Défaut corrigé : acceptez maintenant la réception.', accept: 'Réception acceptée. Le matériel sera livré à la date indiquée après règlement du solde.', train: 'Conducteur habilité à la série. Attendez la fin de préparation puis mettez en service.', commission: 'Matériel mis en service et disponible dans Inventaire.', refresh: 'États actualisés à la date de simulation.' }[action || ''] || 'Action enregistrée.', { train: 'Formation refusée : un conducteur libre et le budget d’habilitation sont nécessaires dans Personnel.', commission: 'Mise en service refusée : vérifiez formation, fin de préparation et lieu du matériel.', accept: 'Acceptation refusée : inspectez le lot, corrigez le défaut et vérifiez sa configuration catalogue.' }[action || '']);
    }));
    host.querySelectorAll('form[data-enterprise-form]').forEach(element => element.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(element), text = (name) => String(data.get(name) ?? ''), number = (name) => Number(text(name)), id = element.dataset.id ?? '';
        run(() => {
            switch (element.dataset.enterpriseForm) {
                case 'need': {
                    const source = text('source'), separator = source.indexOf(':'), kind = source.slice(0, separator);
                    if (!['rame', 'service', 'fleet'].includes(kind) || (context.sources && !context.sources().some(s => s.kind === kind && s.id === source.slice(separator + 1))))
                        throw new Error('Choisissez une source réelle disponible pour le besoin.');
                    if (!depots.some(d => d.id === text('depotId')) || !depots.some(d => d.id === text('location')))
                        throw new Error('Choisissez un dépôt de la compagnie pour la livraison et la préparation.');
                    if (!Number.isFinite(number('capacity')) || number('capacity') <= 0)
                        throw new Error('Besoin incomplet : capacité minimale strictement positive requise.');
                    if (!Number.isInteger(number('quantity')) || number('quantity') < 1 || number('quantity') > 1000)
                        throw new Error('Quantité entière requise, de 1 à 1 000 engins.');
                    if (!manager.dependencies.catalog().some(m => m.family === text('family') && m.capacity >= number('capacity') && m.price >= 0 && ENTERPRISE_CONSTRUCTORS.some(c => c.families.includes(m.family))))
                        throw new Error('Aucun modèle et constructeur compatibles avec cette capacité. Réduisez le besoin ou ajoutez un modèle dans le catalogue.');
                    const need = manager.defineNeed({ source: kind, sourceId: source.slice(separator + 1), family: text('family'), capacity: number('capacity'), quantity: number('quantity'), location: text('location'), depotId: text('depotId') });
                    const offers = manager.requestQuotes(need.id);
                    if (!offers.length)
                        throw new Error('Aucun modèle compatible dans le catalogue actuel');
                    current.offset = Math.floor(manager.quotes.findIndex(q => q.id === offers[0].id) / PAGE_SIZE) * PAGE_SIZE;
                    return offers;
                }
                case 'order': return manager.placeOrder(id, { ...(text('configurationId') ? { configurationId: text('configurationId') } : {}), options: data.getAll('options').map(String), livery: text('livery'), homologations: data.getAll('homologations').map(String) }, context.simple());
                case 'campaign': return manager.createWarrantyCampaign(id, text('reason'));
                case 'policy': {
                    const kind = text('kind');
                    if (kind !== 'fleet' && kind !== 'cargo')
                        return false;
                    return manager.insure({ kind, ...(kind === 'fleet' ? { category: text('category') } : { ...(text('contractId') ? { contractId: text('contractId') } : {}), ...(text('lotId') ? { lotId: text('lotId') } : {}) }), annualPremium: number('annualPremium'), deductible: number('deductible'), limit: number('limit') });
                }
                case 'decision': return manager.decideClaim(id, text('decision') === 'accept', text('reason'));
                case 'customs-lot': {
                    const lot = context.lots?.().find(l => l.id === text('lotId'));
                    return lot ? manager.registerCustoms(lot, number('rate')) : false;
                }
                case 'reroute': return manager.rerouteCustoms(id, text('destination'));
                case 'complaint': {
                    const resolution = text('resolution');
                    if (!['refund', 'credit', 'redelivery', 'refusal', 'gift'].includes(resolution))
                        return false;
                    return manager.resolveComplaint(id, resolution, text('reason'), context.simple());
                }
                case 'renegotiate': return manager.renegotiateCustomer(id, text('contractId'), text('terms'));
                case 'parcel': return manager.acquireParcel({ location: text('location'), area: number('area'), cost: number('cost'), rent: number('rent') }, context.simple());
                case 'build-offers': {
                    const kind = text('kind');
                    if (!['depot', 'terminal', 'workshop', 'hub'].includes(kind))
                        return false;
                    return manager.constructionQuotes(id, kind);
                }
                case 'close':
                    if (number('to') <= number('from'))
                        throw new Error('La fin doit suivre le début');
                    return manager.closePeriod(number('from'), number('to'));
                default: return false;
            }
        }, element.dataset.enterpriseForm === 'need' ? 'Besoin enregistré : choisissez une configuration et un constructeur dans les offres ci-dessous.' : element.dataset.enterpriseForm === 'order' ? 'Commande confirmée : acompte réglé et fabrication réservée. Suivez ses dates dans Portefeuille commandes.' : 'Action enregistrée.', element.dataset.enterpriseForm === 'order' ? 'Commande refusée : vérifiez le budget de l’acompte et la configuration compatible.' : undefined, element);
    }));
}
