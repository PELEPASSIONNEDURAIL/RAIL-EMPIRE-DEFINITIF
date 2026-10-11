import { layoutExperimentalModule } from './experimental-layout.js';
import { htmlText } from './html-text.js';
const states = new WeakMap();
const esc = (v) => htmlText(String(v ?? ''));
const num = (v) => v.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const money = (v) => `${num(v)} €`;
const date = (v) => v === undefined || v === null ? '—' : new Date(v).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
const options = (list, blank = false) => `${blank ? '<option value="">Aucun</option>' : ''}${list.slice(0, 100).map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}`;
const field = (name, label, control) => `<label style="display:inline-flex;flex-direction:column;gap:4px;margin:5px">${esc(label)}${control.replace('NAME', esc(name))}</label>`;
const input = (name, label, value, min = 0) => field(name, label, `<input name="NAME" type="${typeof value === 'number' ? 'number' : 'text'}" value="${esc(value)}" min="${min}" step="any" required>`);
const select = (name, label, content) => field(name, label, `<select name="NAME">${content}</select>`);
const check = (name, label, value = false) => `<label style="margin:5px"><input name="${esc(name)}" type="checkbox" ${value ? 'checked' : ''}> ${esc(label)}</label>`;
const btn = (action, id, label) => `<button type="button" data-log-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
const form = (action, title, fields, submit) => `<details class="card" open style="padding:12px;margin:10px 0"><summary><strong>${esc(title)}</strong></summary><form data-log-form="${action}" style="margin-top:8px">${fields}<button type="submit">${esc(submit)}</button></form></details>`;
const table = (heads, rows, empty = 'Aucune entrée') => `<div style="overflow:auto;max-height:480px"><table style="width:100%;text-align:left"><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${heads.length}">${esc(empty)}</td></tr>`}</tbody></table></div>`;
const row = (...cells) => `<tr>${cells.map(c => `<td style="padding:6px">${c}</td>`).join('')}</tr>`;
const draftKey = (tab, form) => `${tab}:${form.dataset.logForm}:${form.dataset.id || ''}`;
function rememberLogisticsDrafts(host, view) {
    if (!host.ownerDocument || !host.querySelector)
        return;
    const tab = host.dataset.logRenderedTab;
    if (!tab)
        return;
    view.drafts ?? (view.drafts = new Map());
    view.folds ?? (view.folds = new Map());
    view.scroll ?? (view.scroll = new Map());
    for (const form of host.querySelectorAll('form[data-log-form]')) {
        const key = draftKey(tab, form);
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
        const f = details.querySelector('form[data-log-form]');
        view.folds.set(`${tab}:${f ? draftKey(tab, f) : details.querySelector('summary')?.textContent}`, details.open);
    }
    const workspace = host.closest('#experimental-workspace');
    view.scroll.set(tab, (workspace ?? host).scrollTop);
}
function restoreLogisticsDrafts(host, view) {
    if (!host.ownerDocument || !host.querySelector)
        return;
    host.dataset.logRenderedTab = view.tab;
    for (const form of host.querySelectorAll('form[data-log-form]'))
        for (const saved of view.drafts?.get(draftKey(view.tab, form)) ?? []) {
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
        const f = details.querySelector('form[data-log-form]');
        const open = view.folds?.get(`${view.tab}:${f ? draftKey(view.tab, f) : details.querySelector('summary')?.textContent}`);
        if (open !== undefined)
            details.open = open;
    }
    const workspace = host.closest('#experimental-workspace');
    (workspace ?? host).scrollTop = view.scroll?.get(view.tab) ?? 0;
}
const hour = 3600000;
export function renderLogisticsPage(host, manager, context) {
    for (const l of context.locations ?? [])
        manager.registerLocation(l);
    let state = states.get(host);
    if (!state) {
        state = { referenceQuery: '', tab: 'purchases', offset: 0, message: '', error: false };
        states.set(host, state);
    }
    rememberLogisticsDrafts(host, state);
    const view = state, entityId = host.closest?.('[id^="page-"]')?.dataset.entityId || '';
    const enteringEntity = entityId !== view.entityId;
    if (enteringEntity) {
        if (entityId && !view.entityId)
            view.beforeEntity = { tab: view.tab, offset: view.offset };
        if (!entityId && view.beforeEntity) {
            view.tab = view.beforeEntity.tab;
            view.offset = view.beforeEntity.offset;
            view.beforeEntity = undefined;
        }
        view.entityId = entityId;
        const reference = manager.references.find(r => r.id === entityId);
        if (reference) {
            view.referenceQuery = reference.id;
            view.tab = 'purchases';
            view.offset = 0;
        }
    }
    const order = manager.orders.find(o => o.id === entityId);
    const demand = manager.demands.find(d => d.id === entityId || d.sourceId === entityId || d.id === order?.demandId);
    const lot = manager.lots.find(l => l.id === entityId || l.batchId === entityId);
    let selected;
    const locate = (tab, list, id) => { const index = list.findIndex(r => r.id === id); if (index >= 0)
        selected = { tab, id, index }; };
    if (entityId) {
        if (demand)
            locate('purchases', manager.demands.slice().reverse(), demand.id);
        else if (manager.shipments.some(s => s.id === entityId))
            locate('road', manager.shipments.slice().reverse(), entityId);
        else if (manager.flows.some(f => f.id === entityId))
            locate('flows', manager.flows.slice().reverse(), entityId);
        else if (lot)
            locate('stock', manager.lots.slice().reverse(), lot.id);
        else if (manager.suppliers.some(s => s.id === entityId))
            locate('suppliers', manager.suppliers, entityId);
        else if (manager.rescueResources.some(r => r.id === entityId))
            locate('trace', manager.rescueResources.slice().reverse(), entityId);
    }
    if (selected) {
        view.tab = selected.tab;
        view.offset = Math.floor(selected.index / 100) * 100;
    }
    const selectedReference = manager.references.find(r => r.id === entityId);
    const selectionMessage = selectedReference ? `Approvisionnement : ${selectedReference.name}. Choisissez le dépôt et la quantité à commander.` : entityId && !selected ? `Élément ${entityId} introuvable. Consultez les listes ou recherchez son identifiant dans KPI & traçabilité.` : '';
    const entityRow = (id, ...cells) => row(...cells).replace('<tr>', `<tr data-log-entity-id="${esc(selected?.id === id ? entityId : id)}">`);
    const locations = options(manager.locations), references = options(manager.references.filter(r => `${r.id} ${r.name}`.toLocaleLowerCase('fr').includes(view.referenceQuery.toLocaleLowerCase('fr')))), suppliers = options(manager.suppliers), carriers = options(manager.carriers);
    const tabs = [{ id: 'purchases', label: 'Achats & réceptions' }, { id: 'stock', label: 'Stocks & lots' }, { id: 'road', label: 'Transport & hubs' }, { id: 'flows', label: 'Colis & filières' }, { id: 'suppliers', label: 'Fournisseurs & contrats' }, { id: 'trace', label: 'KPI & traçabilité' }];
    let content = '';
    const count = { purchases: manager.demands.length, stock: manager.lots.length, road: manager.shipments.length, flows: manager.flows.length, suppliers: manager.suppliers.length, trace: manager.rescueResources.length }[view.tab];
    view.offset = Math.max(0, Math.min(view.offset, Math.max(0, Math.ceil(count / 100) - 1) * 100));
    const page = (list) => list.slice(view.offset, view.offset + 100);
    const help = (text) => `<details><summary>Comprendre ce tableau</summary><p>${esc(text)}</p></details>`;
    const refLocation = select('locationId', 'Lieu', locations) + select('referenceId', 'Référence', references);
    if (view.tab === 'purchases') {
        content = form('purchase', 'Demande d’achat', refLocation + input('quantity', 'Quantité', 20, 1) + input('needHours', 'Besoin dans (h)', 24) + select('urgency', 'Priorité', '<option value="0">Normale</option><option value="3">Urgente / express</option><option value="7">Train critique</option>') + select('source', 'Usage', options([{ id: 'player', name: 'Achat joueur' }, { id: 'depot', name: 'Atelier dépôt' }, { id: 'catering', name: 'Restauration' }, { id: 'works', name: 'Travaux' }, { id: 'industrial', name: 'Pré/post industriel' }])), 'Comparer les offres');
        content += '<div data-log-offers></div>';
        content += form('receipt', 'Contrôle et réception', select('shipmentId', 'Expédition déchargée', options(manager.shipments.filter(s => s.status === 'quality').map(s => ({ id: s.id, name: `${s.id} · ${s.quantity} ${s.referenceId} → ${s.to}` })))) + input('missing', 'Quantité manquante', 0) + input('damaged', 'Quantité endommagée', 0) + check('wrongReference', 'Mauvaise référence'), 'Réceptionner et libérer le stock');
        content += help('Une commande passe par préparation, pickup, transport, file de quai, déchargement puis contrôle. Expert attend votre réception; Simple accepte et remplace les écarts. Les cut-offs manqués demandent une alternative.');
        const rows = page(manager.demands.slice().reverse()).map(d => { const orders = d.orderIds.map(id => manager.orders.find(o => o.id === id)).filter(o => o !== undefined); return entityRow(d.id, esc(d.id), `${esc(d.quantity)} ${esc(d.referenceId)}<br>${esc(d.locationId)}`, `${esc(d.source)}<br>${esc(d.sourceId)}`, `${esc(d.status)}<br>${date(d.needAt)}`, orders.map(o => `${esc(o.id)} · ${esc(o.status)} · ${money(o.total)}<br>Prêt ${date(o.readyAt)} / ETA ${date(o.eta)}`).join('') || '—', d.status === 'requested' ? btn('offers', d.id, 'Offres / attribution') : btn('trace-demand', d.id, 'Historique') + (orders.some(o => o.status === 'ready') ? btn('transport', orders.find(o => o.status === 'ready').id, 'Réserver le transport') : orders.some(o => o.status === 'preparing') ? `<small>Préparation fournisseur : attendre la date indiquée puis actualiser.</small>` : '')); });
        content += table(['Demande', 'Quantité / lieu', 'Source', 'État / besoin', 'Commandes', 'Actions'], rows, 'Aucune demande. Créez un achat ou configurez un seuil de stock.');
    }
    if (view.tab === 'stock') {
        content = form('policy', 'Seuils et prévision de consommation', refLocation + input('minimum', 'Stock minimum', 10) + input('coverDays', 'Couverture (jours)', 3) + input('dailyUse', 'Usage quotidien', 3) + input('plannedUse', 'Maintenance planifiée', 0) + input('mileageUse', 'Usage kilométrique / jour', 0) + input('seasonFactor', 'Facteur saison', 1, .1) + input('futureServicesUse', 'Services à venir', 0) + input('historyUse', 'Usage historique / jour', 0) + check('delegated', 'Réapprovisionnement délégué', true), 'Enregistrer la politique');
        content += `<details open><summary>Prévisions et sources réelles (${manager.stockPolicies.length})</summary>${table(['Lieu / référence', 'Seuil / prévision', 'Historique / kilométrage', 'Besoins planifiés / preuves'], manager.stockPolicies.slice(0, 100).map(p => { const d = p.runtimeForecast; return row(`${esc(p.locationId)} · ${esc(p.referenceId)}`, `Minimum ${num(p.minimum)} · cible ${num(Math.max(p.minimum, manager.forecast(p)))}<br>${num(p.coverDays)} jours · ${p.delegated ? 'Délégué' : 'Manuel'}`, d ? `${num(d.historyPerDay)} / jour · ${num(d.observedKm)} km observés<br>${num(d.scheduledKm)} km planifiés · ${num(d.mileagePerDay)} / jour additionnel<br>Saison jeu ×${num(d.seasonFactor)}` : 'Pas de mesure enregistrée', d ? `Atelier / chantier ${num(d.plannedUse)} · services ${num(d.futureServicesUse)}<br>${d.evidence.slice(0, 12).map(esc).join('<br>')}<br>Calcul ${date(d.at)}` : 'Paramètres saisis par le joueur'); }))}</details>`;
        content += form('transfer', 'Transfert inter-dépôts / hub', select('from', 'Origine', locations) + select('to', 'Destination', locations) + select('referenceId', 'Référence', references) + input('quantity', 'Quantité', 5, 1), 'Réserver le transfert');
        content += form('reservation', 'Réserver des pièces', refLocation + input('operationId', 'Opération planifiée', 'operation-atelier') + input('quantity', 'Quantité', 5, 1) + input('priority', 'Priorité', 5) + check('criticalTrain', 'Train critique') + check('customerContract', 'Contrat client'), 'Réserver / allouer');
        content += form('inventory', 'Inventaire tournant', refLocation + input('counted', 'Quantité comptée', 0), 'Valider l’inventaire');
        content += help('Le disponible exclut les réservations, lots périmés et rappels. FEFO: les lots qui expirent d’abord sont consommés d’abord. Prévision = usages quotidiens × saison × couverture + maintenance + services.');
        const rows = page(manager.lots.slice().reverse()).map(l => entityRow(l.id, `${esc(l.id)}<br>${esc(l.batchId)}`, `${esc(l.locationId)} · ${esc(l.referenceId)}`, `${num(l.quantity)} / ${esc(l.quality)}<br>Disponible référence ${num(manager.availableStock(l.locationId, l.referenceId))}`, `${date(l.receivedAt)}<br>Expiration ${date(l.expiresAt)}`, `${esc(l.supplierId)}<br>${esc(l.usedBy.map(u => `${u.operationId}:${u.quantity}`).join(', '))}`, btn('recall', l.batchId, 'Rappeler le lot')));
        content += table(['Lot / campagne', 'Lieu / référence', 'Stock', 'Dates', 'Origine / usages', 'Rappel'], rows);
        content += `<details><summary>Réservations (${manager.reservations.length})</summary>${table(['Opération', 'Référence', 'Allocation', 'Actions'], manager.reservations.slice(-100).map(r => row(esc(r.operationId), esc(r.referenceId), `${num(r.allocated)}/${num(r.quantity)} · ${esc(r.status)}`, btn('consume', r.operationId, 'Consommer') + btn('cancel-reservation', r.operationId, 'Libérer'))))}</details>`;
    }
    if (view.tab === 'road') {
        content = form('pickup', 'Réserver un pickup / correspondance ferroviaire', select('orderId', 'Commande préparée', options(manager.orders.filter(o => o.status === 'ready').map(o => ({ id: o.id, name: `${o.id} · ${o.quantity} ${o.referenceId}` })))) + select('carrierId', 'Transporteur', carriers) + input('distanceKm', 'Distance routière (km)', 50) + input('pickupHours', 'Pickup dans (h)', 0) + input('windowHours', 'Fin fenêtre (h)', 4) + input('cutoffHours', 'Cut-off dans (h), 0 = aucun', 0) + input('railHours', 'Départ train dans (h), 0 = aucun', 0) + input('railArrivalHours', 'Arrivée train dans (h)', 8) + input('trafficFactor', 'Facteur trafic', 1, .5) + input('weatherFactor', 'Facteur météo', 1, .7) + select('crossDockTo', 'Cross-docking destination', options(manager.locations, true)), 'Réserver le transport');
        content += form('hub', 'Créer un entrepôt / terminal', input('name', 'Nom', 'Entrepôt central') + select('kind', 'Type', options([{ id: 'hub', name: 'Hub / entrepôt' }, { id: 'terminal', name: 'Terminal rail' }, { id: 'port', name: 'Terminal maritime' }, { id: 'airport', name: 'Hub aéroportuaire' }, { id: 'treatment', name: 'Site de traitement' }, { id: 'worksite', name: 'Chantier' }, { id: 'factory', name: 'Usine / compound' }, { id: 'client', name: 'Client' }])) + input('dockCount', 'Nombre de quais', 2, 1) + input('dockCapacity', 'Capacité quai (kg)', 25000, 1) + input('unloadMinutes', 'Durée de déchargement (min)', 30, 1) + input('waves', 'Vagues de tri (heures UTC)', '6,12,18,22'), 'Créer le site');
        content += form('consolidate', 'Consolider des pickups', input('shipmentIds', 'IDs expéditions séparés par virgules', ''), 'Consolider même destination / transporteur');
        content += form('deconsolidate', 'Déconsolider depuis un hub reçu', select('shipmentId', 'Expédition livrée', options(manager.shipments.filter(s => s.status === 'delivered').map(s => ({ id: s.id, name: `${s.id} · ${s.to}` })))) + select('to', 'Dépôt destination', locations) + input('quantity', 'Quantité à transférer', 5, 1), 'Transférer le lot reçu');
        content += help('Les camions sont des classes agrégées avec capacité poids et volume. ETA utilise distance, trafic, météo, pause et fiabilité. Les quais sont des files événementielles.');
        content += table(['Lot / groupe', 'Trajet / camion', 'Planning', 'État / preuve', 'Cut-off / alternatives'], page(manager.shipments.slice().reverse()).map(s => entityRow(s.id, `${esc(s.id)}<br>${esc(s.groupId)}`, `${esc(s.from)} → ${esc(s.to)}<br>${s.vehicleCount} ${esc(s.vehicleClass)} · ${num(s.weightKg)} kg · ${money(s.cost)}`, `Pickup ${date(s.pickupAt)}<br>ETA ${date(s.eta)}<br>Déchargé ${date(s.unloadAt)}`, `${esc(s.status)}${s.proof ? `<br>${num(s.proof.quantity)} livrés / écart ${num(s.proof.difference)} à ${date(s.proof.at)}` : ''}`, s.missedCutoff ? s.alternatives.map(a => btn(`alternative:${a.kind}`, s.id, `${a.label} · ${money(a.cost)}`)).join('') + `<br>Choix ${esc(s.selectedAlternative ?? 'requis')}` : 'À l’heure')));
    }
    if (view.tab === 'flows') {
        const kinds = [{ id: 'express', name: 'Colis / messagerie express' }, { id: 'road-freight', name: 'Pré / post acheminement fret' }, { id: 'automobile', name: 'Automobile compound → parc' }, { id: 'waste', name: 'Déchets / traitement' }, { id: 'construction', name: 'Campagne chantier' }, { id: 'ecommerce-return', name: 'Retour e-commerce' }, { id: 'ship', name: 'Vague maritime / ship ETA' }, { id: 'air', name: 'Cargo aérien / vol ETA' }];
        content = form('flow', 'Créer une cohorte / filière', select('kind', 'Filière', options(kinds)) + select('referenceId', 'Marchandise', references) + input('quantity', 'Quantité agrégée', 100, 1) + select('from', 'Origine', locations) + select('to', 'Destination', locations) + select('hubId', 'Hub de tri', options(manager.locations.filter(l => l.kind === 'hub' || l.kind === 'terminal'), true)) + select('service', 'Service', options([{ id: 'standard', name: 'Standard' }, { id: 'J+1', name: 'J+1' }, { id: 'express', name: 'Express' }])) + select('carrierId', 'Transporteur', carriers) + input('distanceKm', 'Distance chaîne (km)', 100) + input('deadlineHours', 'Livraison avant (h)', 24) + input('externalHours', 'ETA navire / vol (h)', 6) + input('campaignId', 'Campagne / référence client', 'campagne') + select('railId', 'Train / fourgon offert', options(context.railServices ?? [], true)) + check('cold', 'Chaîne du froid') + input('coldMin', 'Température min (°C)', 0, -100) + input('coldMax', 'Température max (°C)', 5, -100) + input('coldMinutes', 'Temps toléré hors froid (min)', 30, 1), 'Créer la chaîne');
        content += form('temperature', 'Relever la température d’une cohorte', select('flowId', 'Cohorte active', options(manager.flows.filter(f => f.status !== 'delivered').map(f => ({ id: f.id, name: `${f.id} · ${f.referenceId}` })))) + input('temperature', 'Température (°C)', 20, -100), 'Enregistrer la température');
        content += form('return', 'Retour garantie / matériel / e-commerce', select('from', 'Origine', locations) + select('to', 'Hub / fournisseur / atelier', locations) + select('referenceId', 'Référence', references) + input('quantity', 'Quantité', 5, 1) + select('kind', 'Motif', options([{ id: 'warranty', name: 'Garantie' }, { id: 'defective', name: 'Défectueux' }, { id: 'ecommerce', name: 'Retour client' }])), 'Créer le retour');
        content += form('packaging', 'Repositionnement emballages / consigne', select('packagingId', 'Lot emballages', options(manager.packaging.filter(p => p.status === 'available').map(p => ({ id: p.id, name: `${p.id} · ${p.quantity} ${p.kind} · ${p.locationId}` })))) + select('to', 'Lieu de retour', locations), 'Retourner les emballages');
        content += help('Une ligne suit une cohorte entière, même pour 100 000 colis. Scans collecte, hub, tri, rail éventuel, terminal et livraison. Le froid cumule le temps hors plage; un lot dégradé attend remplacement en Expert.');
        content += form('reroute-flow', 'Alternative routière / déviation d’une cohorte', select('flowId', 'Cohorte en cours', options(manager.flows.filter(f => f.status !== 'delivered').map(f => ({ id: f.id, name: `${f.id} · ${f.referenceId}` })))) + select('to', 'Destination', locations) + input('distanceKm', 'Distance routière (km)', 50), 'Dévier la cohorte');
        content += table(['Cohorte / filière', 'Service / chaîne', 'Scans / ETA', 'Froid / qualité', 'Livraison / documents'], page(manager.flows.slice().reverse()).map(f => entityRow(f.id, `${esc(f.id)}<br>${esc(f.kind)} · ${num(f.quantity)} ${esc(f.referenceId)}`, `${esc(f.service)}<br>${esc(f.from)} → ${esc(f.hubId ?? 'direct')} → ${esc(f.to)}<br>${esc(f.reprotection ?? '')}${f.railReservation ? `<br>Train ${esc(f.railReservation.serviceId)} · ${esc(f.railReservation.status)} · ${num(f.railReservation.weightKg)} kg${f.railWaiting ? ' · arrivée / capacité réelle attendue' : ''}` : ''}`, `${esc(f.scans[f.scans.length - 1]?.status)}<br>${date(f.stages[f.stages.length - 1]?.at)}<br>${esc(f.status)}`, `${esc(f.quality)} · ${num(f.temperature)} °C<br>Hors froid ${num(f.outsideColdMs / 60000)} min${f.quality === 'spoiled' ? btn('replace-flow', f.id, 'Remplacer le lot') : ''}`, `${num(f.quantityDelivered)} livrés<br>Prime ${money(f.performanceBonus)}<br>${esc(f.documents.join(' · '))}`)));
    }
    if (view.tab === 'suppliers') {
        content = form('compatibility', 'Déclarer une substitution approuvée', select('referenceId', 'Référence demandée', references) + select('alternativeId', 'Référence alternative', references) + input('notice', 'Règle de jeu et validation', 'Équivalence de jeu : 1 unité pour 1 unité') + check('approved', 'J’approuve cette équivalence de jeu, avec même unité et même usage'), 'Approuver la substitution');
        content += `<p>Cette déclaration est une règle du jeu. Aucune conformité technique réelle n’est déduite du nom de la pièce. Les unités ou usages différents sont refusés.</p>`;
        content += form('contract', 'Signer un contrat cadre', select('supplierId', 'Fournisseur', suppliers) + select('referenceId', 'Référence', references) + input('discountPct', 'Remise (%)', 8) + input('minimumVolume', 'Volume minimum', 100) + input('slaHours', 'SLA préparation (h)', 8, 1) + input('priority', 'Priorité capacité', 3), 'Signer le contrat');
        content += form('supplier', 'Ajouter un fournisseur nommé', input('name', 'Nom', 'Fournisseur personnalisé') + input('country', 'Pays ISO', 'FR') + input('priceFactor', 'Facteur de prix', 1, .1) + input('prepareHours', 'Préparation (h)', 4, 1) + input('capacity', 'Capacité / jour', 10000, 1) + input('reliability', 'Fiabilité (0–1)', .98, 0), 'Ajouter le fournisseur');
        content += form('carrier', 'Ajouter un transporteur nommé', input('name', 'Nom', 'Transporteur personnalisé') + select('profile', 'Profil', options(manager.carriers.map(c => ({ id: c.id, name: `${c.profile} · ${c.vehicleClass}` })))), 'Créer le profil transporteur');
        content += form('multi-source', 'Répartir une demande non attribuée', select('demandId', 'Demande', options(manager.demands.filter(d => d.status === 'requested').map(d => ({ id: d.id, name: `${d.id} · ${d.quantity} ${d.referenceId}` })))) + select('supplierA', 'Premier fournisseur', suppliers) + input('quantityA', 'Quantité premier fournisseur', 10, 1) + select('supplierB', 'Second fournisseur', suppliers), 'Attribuer en multi-sourcing');
        content += help('Les offres montrent prix, délai, MOQ, saturation et calendrier. Les scores utilisent seulement les réceptions de la partie; un score sans échantillon n’est pas une garantie. Le minimum contractuel et le SLA restent inspectables.');
        content += table(['Fournisseur', 'Pays / capacité', 'Préparation / fiabilité', 'Score réel', 'Contrats / actions'], page(manager.suppliers).map(s => { const score = manager.supplierScore(s.id); const contracts = manager.contracts.filter(c => c.supplierId === s.id); return entityRow(s.id, esc(s.name), `${esc(s.country)} · ${num(s.capacityPerDay)}/j`, `${num(s.prepareMs / hour)} h · ${num(s.reliability * 100)} %<br>${s.available ? 'Disponible' : 'Fermé'}`, `n=${score.sample} · OTIF ${num(score.onTime * 100)} %<br>Qualité ${num(score.quality * 100)} % · litiges ${num(score.disputeRate * 100)} %`, contracts.map(c => `${esc(c.referenceId)} · ${c.discountPct}% · ${c.purchased}/${c.minimumVolume} · SLA ${num(c.slaMs / hour)}h`).join('<br>') + '<br>' + btn('toggle-supplier', s.id, s.available ? 'Fermer' : 'Rouvrir')); }));
    }
    if (view.tab === 'trace') {
        const k = manager.getKpis();
        content = `<div class="card" style="padding:12px;display:flex;flex-wrap:wrap;gap:18px">${[['OTIF', `${num(k.otif * 100)} %`], ['Jours stock', num(k.stockDays)], ['Transport', money(k.transportCost)], ['Ruptures', `${num(k.stockoutRate * 100)} %`], ['Commandes urgentes', String(k.urgentOrders)], ['Immobilisations', String(k.immobilizations)], ['Cut-offs manqués', `${num(k.missedCutoffRate * 100)} %`], ['Route / tonne', money(k.roadCostPerTonne)], ['Ponctualité terminale', `${num(k.terminalPunctuality * 100)} %`], ['Part rail', `${num(k.railShare * 100)} %`], ['Express à l’heure', `${num(k.flowOnTime * 100)} %`]].map(([label, value]) => `<div><small>${esc(label)}</small><br><strong>${esc(value)}</strong></div>`).join('')}</div>`;
        content += form('what-if', 'Scénario what-if sans appliquer', select('supplierId', 'Fournisseur', suppliers) + input('priceIncreasePct', 'Hausse prix (%)', 25, -50) + check('supplierDown', 'Panne fournisseur') + select('closedHubId', 'Site fermé', options(manager.locations, true)), 'Calculer sans modifier');
        content += '<div data-log-analysis></div>';
        const risks = manager.getRisks();
        content += `<details open><summary>Risques (${risks.length})</summary><ul>${risks.slice(0, 100).map(r => `<li>${esc(r.locationId)} · ${esc(r.referenceId)}: ${esc(r.message)}</li>`).join('') || '<li>Aucun risque calculé pour les seuils configurés.</li>'}</ul></details>`;
        content += form('trace', 'Rechercher la chaîne causale', input('entityId', 'ID demande, commande, expédition, cohorte ou lot', ''), 'Afficher le détail');
        content += '<div data-log-trace></div>';
        content += table(['Ressource de secours', 'Entité', 'Quantité / coût', 'Motif'], page(manager.rescueResources.slice().reverse()).map(r => entityRow(r.id, `${esc(r.type)}<br>${date(r.at)}`, esc(r.entityId), `${num(r.quantity)} · ${money(r.cost)}<br>Informatif en Simple`, esc(r.reason))));
        const flows = manager.mapFlows().filter(f => f.fromLat !== undefined && f.fromLon !== undefined && f.toLat !== undefined && f.toLon !== undefined);
        if (flows.length) {
            const lon = (x) => (x + 180) / 360 * 600, lat = (y) => (90 - y) / 180 * 300;
            content += `<figure><svg viewBox="0 0 600 300" style="max-width:600px;background:#122138" role="img" aria-label="Flux routiers simplifiés">${flows.map(f => `<g><title>${esc(f.id)} ${esc(f.from)} → ${esc(f.to)}</title><line x1="${lon(f.fromLon)}" y1="${lat(f.fromLat)}" x2="${lon(f.toLon)}" y2="${lat(f.toLat)}" stroke="#69c9f7" stroke-width="2"/><circle cx="${lon(f.toLon)}" cy="${lat(f.toLat)}" r="3" fill="#7ce7b3"/></g>`).join('')}</svg><figcaption>Flux agrégés des lieux géoréférencés; position des camions abstraite.</figcaption></figure>`;
        }
    }
    if (context.supply && view.tab === 'stock') {
        const works = context.supply.workProjects();
        content += form('work-resources', 'Matériaux et préparation d’un chantier réel', select('workId', 'Projet', options(works.map(w => ({ id: w.workId, name: `${w.workId} · ${w.phase}` })))) + select('referenceId', 'Ressource catalogue', references) + input('quantity', 'Besoin de cette ressource', 1), 'Enregistrer le besoin du projet');
        content += table(['Projet / occurrence', 'Phase réelle', 'Matériaux disponibles / requis', 'Fenêtre / retard'], works.slice(0, 100).map(w => row(esc(`${w.workId} · ${w.occurrenceDate}`), esc(w.phase), Object.entries(w.needed).map(([ref, q]) => `${esc(ref)}: ${num(w.stock[ref] ?? 0)} / ${num(q)} (consommé ${num(w.consumed[ref] ?? 0)})`).join('<br>') || esc(w.provenance), `Prévu ${date(w.plannedStartAt)} → ${date(w.plannedEndAt)}<br>Réel ${date(w.actualStartAt)} → ${date(w.actualEndAt)}<br>Retard ${num(w.delayMs / hour)} h`)));
    }
    if (context.supply && view.tab === 'road') {
        const clients = context.supply.industrialSources();
        content += form('industrial-leg', 'Pré/post routier du stock industriel réel', select('clientId', 'Client raccordé à un ITE construit', options(clients)) + select('referenceId', 'Marchandise catalogue', references) + select('direction', 'Sens', options([{ id: 'pre', name: 'Usine → ITE' }, { id: 'post', name: 'ITE → usine' }])) + input('quantity', 'Tonnes à transférer', 1, .001) + field('contractId', 'Contrat ferroviaire associé (facultatif)', '<input name="NAME" value="">'), 'Planifier la jambe routière');
        content += table(['Client / ITE', 'Marchandise', 'Stock usine disponible', 'Stock tampon ITE'], clients.flatMap(client => client.cargo.map(c => row(`${esc(client.name)} / ${esc(client.iteId)}`, esc(c.name), num(c.available), num(c.terminal)))).slice(0, 100));
        content += table(['Jambe / contrat', 'Sens / quantité', 'Expédition', 'État'], context.supply.industrialLegs().slice(-100).reverse().map(l => entityRow(l.id, `${esc(l.id)} / ${esc(l.contractId)}`, `${esc(l.direction)} · ${num(l.quantity)} ${esc(l.cargoType)}`, esc(l.shipmentId), esc(l.status))));
    }
    host.innerHTML = `<section data-rc44-logistics><h2>Logistique</h2>${selectionMessage ? `<p role="status">${esc(selectionMessage)}</p>` : ''}<p>${context.simple ? 'Simple: achats, moyens de secours et réceptions automatiques. Les coûts de secours sont informatifs.' : 'Expert: capacités, calendrier, file de réception et contrôles appliqués.'}</p><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" data-log-action="refresh">Actualiser les états</button>${tabs.map(t => `<button type="button" data-log-tab="${t.id}" aria-pressed="${view.tab === t.id}">${t.label}</button>`).join('')}</div><div style="margin:10px 0">${check('delegatedSupply', 'Déléguer les achats', manager.delegatedSupply)}${check('delegatedRoad', 'Déléguer les transporteurs', manager.delegatedRoad)}</div><p data-log-message role="status" style="color:${view.error ? '#ff8a8a' : '#8bd8af'}">${esc(view.message)}</p>${form('reference-search', 'Rechercher une référence du catalogue', field('referenceQuery', 'Nom ou identifiant', `<input name="NAME" value="${esc(view.referenceQuery)}" placeholder="ballast, repas, pièce…">`), 'Filtrer les références')}${manager.locations.length ? content : '<p>Créez un dépôt ou un lieu logistique pour commander.</p>' + form('hub', 'Créer un lieu', input('name', 'Nom', 'Entrepôt central') + select('kind', 'Type', options([{ id: 'hub', name: 'Hub' }])) + input('dockCount', 'Quais', 1, 1) + input('dockCapacity', 'Capacité (kg)', 25000, 1) + input('unloadMinutes', 'Déchargement (min)', 30, 1) + input('waves', 'Vagues', '6,12,18,22'), 'Créer')}<div style="display:flex;gap:12px;margin:12px"><button data-log-action="previous" ${view.offset === 0 ? 'disabled' : ''}>Précédent</button><span>${count ? `${Math.min(count, view.offset + 1)}–${Math.min(count, view.offset + 100)} / ${count}` : '0 entrée'} · 100 lignes maximum par tableau</span><button data-log-action="next" ${view.offset + 100 >= count ? 'disabled' : ''}>Suivant</button></div></section>`;
    layoutExperimentalModule(host);
    restoreLogisticsDrafts(host, view);
    const refresh = (message = 'Action enregistrée') => { view.message = message; view.error = false; context.refresh?.(); renderLogisticsPage(host, manager, context); };
    const fail = (error) => { view.message = error instanceof Error ? error.message : String(error); view.error = true; const status = host.querySelector('[data-log-message]'); if (status) {
        status.textContent = view.message;
        status.style.color = '#ff8a8a';
    } };
    const offers = (demandId) => { view.offerDemandId = demandId; const target = host.querySelector('[data-log-offers]'); if (!target)
        return; const offers = manager.compareOffers(demandId, context.simple); target.innerHTML = `<h3>Offres de la demande ${esc(demandId)}</h3>` + (offers.length ? '' : '<p>Aucun fournisseur compatible. Ajoutez un fournisseur dans Fournisseurs & contrats.</p>') + table(['Fournisseur', 'Prix / MOQ', 'Préparation / fiabilité', 'Attribution'], offers.slice(0, 100).map(o => row(esc(o.supplierName), `${money(o.total)} · ${num(o.quantity)} unités`, `${date(o.readyAt)} · ${num(o.reliability * 100)} %<br>Saturation ${num(o.capacityDelayMs / hour)} h / calendrier ${num(o.calendarDelayMs / hour)} h${o.slaAtRisk ? ' · SLA à risque' : ''}${o.contractRemaining ? ` · volume engagé restant ${num(o.contractRemaining)}` : ''}`, btn('award', `${demandId}|${o.supplierId}`, o.available ? 'Attribuer' : context.simple ? 'Fournisseur de secours' : 'Commander en reliquat')))); const substitutes = manager.compatibleSubstitutions(demandId); target.innerHTML += substitutes.map(s => `<p>${btn('substitute', `${demandId}|${s.referenceId}`, `Substituer: ${s.name}`)} · écart ${money(s.priceDifference)} · ${esc(s.performance)}</p>`).join(''); const d = manager.demands.find(d => d.id === demandId); if (d)
        target.innerHTML += manager.transferProposals(d.locationId, d.referenceId, d.quantity).map(p => `<p>Alternative transfert: ${esc(p.from)} · disponible ${num(p.available)} · ETA ${date(p.eta)}</p>`).join(''); };
    const trace = (id) => { const target = host.querySelector('[data-log-trace]'); if (!target)
        return; const demand = manager.demands.find(d => d.id === id), order = manager.orders.find(o => o.id === id), shipment = manager.shipments.find(s => s.id === id), flow = manager.flows.find(f => f.id === id), lot = manager.lots.find(l => l.id === id || l.batchId === id); const records = []; const append = (list) => { for (const record of list)
        records.push(record); }; if (demand) {
        records.push(demand);
        append(manager.orders.filter(o => demand.orderIds.includes(o.id)));
        append(manager.shipments.filter(s => s.orderId && demand.orderIds.includes(s.orderId)));
    }
    else if (order) {
        records.push(order);
        append(manager.shipments.filter(s => s.orderId === id));
        append(manager.lots.filter(l => l.orderId === id));
    }
    else if (shipment) {
        records.push(shipment);
        append(manager.lots.filter(l => l.batchId === shipment.batchId));
    }
    else if (flow)
        records.push(flow);
    else if (lot)
        append(manager.lots.filter(l => l.batchId === lot.batchId)); target.innerHTML = `<pre style="max-height:420px;overflow:auto;white-space:pre-wrap">${esc(records.length ? JSON.stringify(records.slice(0, 100), null, 2) : 'ID introuvable')}</pre>`; };
    const leaveSelection = () => { const page = host.closest?.('[id^="page-"]'); if (page)
        delete page.dataset.entityId; view.entityId = ''; view.beforeEntity = undefined; };
    host.onclick = (event) => {
        const target = event.target instanceof Element ? event.target.closest('button') : null;
        if (!target)
            return;
        const tab = target.dataset.logTab;
        if (tab) {
            leaveSelection();
            view.tab = tab;
            view.offset = 0;
            refresh('');
            return;
        }
        const action = target.dataset.logAction, id = target.dataset.id ?? '';
        if (action === 'previous' || action === 'next' || action === 'trace-demand')
            leaveSelection();
        try {
            if (action === 'refresh') {
                refresh('États actualisés à la date de simulation.');
            }
            else if (action === 'transport') {
                leaveSelection();
                view.tab = 'road';
                view.offset = 0;
                refresh('Commande préparée : choisissez le transporteur puis réservez le pickup.');
                const field = host.querySelector('[data-log-form="pickup"] [name="orderId"]');
                if (field)
                    field.value = id;
            }
            else if (action === 'previous') {
                view.offset = Math.max(0, view.offset - 100);
                refresh('');
            }
            else if (action === 'next') {
                view.offset = Math.min(Math.max(0, Math.ceil(count / 100) - 1) * 100, view.offset + 100);
                refresh('');
            }
            else if (action === 'offers')
                offers(id);
            else if (action === 'award') {
                const [demandId, supplierId] = id.split('|');
                const order = manager.placeOrder(demandId, supplierId, context.simple);
                view.offerDemandId = undefined;
                refresh(`Commande ${order.id} créée : ${order.quantity} ${order.referenceId}. Préparation prévue ${date(order.readyAt)} ; réservez ensuite le transport dans Transport & hubs.`);
            }
            else if (action === 'substitute') {
                const [demandId, referenceId] = id.split('|');
                manager.substituteDemand(demandId, referenceId);
                context.refresh?.();
                offers(demandId);
            }
            else if (action === 'toggle-supplier') {
                const supplier = manager.suppliers.find(s => s.id === id);
                if (supplier)
                    manager.setSupplierAvailable(id, !supplier.available);
                refresh();
            }
            else if (action?.startsWith('alternative:')) {
                manager.chooseAlternative(id, action.slice(12), context.simple);
                refresh('Alternative sélectionnée');
            }
            else if (action === 'consume') {
                const quantity = manager.consumeReservation(id);
                refresh(`${quantity} unités consommées`);
            }
            else if (action === 'cancel-reservation') {
                manager.cancelReservation(id);
                refresh('Réservation libérée');
            }
            else if (action === 'recall') {
                manager.recallLot(id, 'Campagne de rappel déclarée par le joueur');
                refresh('Lot isolé et usages identifiés');
            }
            else if (action === 'replace-flow') {
                manager.replaceFlow(id, context.simple);
                refresh('Cohorte de remplacement activée');
            }
            else if (action === 'trace-demand') {
                view.tab = 'trace';
                view.offset = 0;
                renderLogisticsPage(host, manager, context);
                trace(id);
            }
        }
        catch (error) {
            fail(error);
        }
    };
    host.onchange = (event) => { const target = event.target; if (!(target instanceof HTMLInputElement))
        return; if (target.name === 'delegatedSupply') {
        manager.delegatedSupply = target.checked;
        refresh();
    }
    else if (target.name === 'delegatedRoad') {
        manager.delegatedRoad = target.checked;
        refresh();
    } };
    host.onsubmit = (event) => {
        const target = event.target;
        if (!(target instanceof HTMLFormElement))
            return;
        event.preventDefault();
        const data = new FormData(target), s = (key) => String(data.get(key) ?? ''), n = (key) => { const value = Number(s(key)); if (!Number.isFinite(value))
            throw new Error(`Valeur invalide: ${key}`); return value; }, b = (key) => data.has(key), action = target.dataset.logForm;
        const now = manager.now || context.now;
        try {
            if (action === 'reference-search') {
                view.referenceQuery = s('referenceQuery').trim();
                refresh('Catalogue filtré');
                return;
            }
            if (action === 'purchase') {
                const d = manager.requestPurchase({ locationId: s('locationId'), referenceId: s('referenceId'), quantity: n('quantity'), needAt: now + n('needHours') * hour, urgency: n('urgency'), source: s('source') });
                view.offerDemandId = d.id;
                target.dataset.draftReset = 'true';
                view.offset = 0;
                refresh(`Demande ${d.id} créée : ${d.quantity} ${d.referenceId}. Choisissez une offre ci-dessous.`);
                return;
            }
            if (action === 'receipt') {
                const lot = manager.receiveShipment(s('shipmentId'), { missing: n('missing'), damaged: n('damaged'), wrongReference: b('wrongReference') }, context.simple);
                target.dataset.draftReset = 'true';
                refresh(lot ? `Réception ${lot.quantity} ${lot.referenceId} au ${lot.locationId} : stock ${lot.quality === 'good' ? 'disponible' : 'en quarantaine'}. Consultez Stocks & lots.` : 'Réception terminée sans stock accepté : consultez le reliquat et la preuve de livraison.');
                return;
            }
            else if (action === 'work-resources') {
                if (!context.supply)
                    throw new Error('Raccordement chantier indisponible');
                const state = context.supply.workStatus(s('workId'));
                context.supply.planWorkResources(s('workId'), { ...(state?.needed ?? {}), [s('referenceId')]: n('quantity') });
            }
            else if (action === 'industrial-leg') {
                if (!context.supply)
                    throw new Error('Raccordement industriel indisponible');
                context.supply.planIndustrialRoadLeg(s('clientId'), s('referenceId'), n('quantity'), s('direction'), s('contractId'), context.simple);
            }
            else if (action === 'policy')
                manager.setStockPolicy({ locationId: s('locationId'), referenceId: s('referenceId'), minimum: n('minimum'), coverDays: n('coverDays'), dailyUse: n('dailyUse'), plannedUse: n('plannedUse'), mileageUse: n('mileageUse'), seasonFactor: n('seasonFactor'), futureServicesUse: n('futureServicesUse'), historyUse: n('historyUse'), delegated: b('delegated') });
            else if (action === 'transfer')
                manager.transferStock(s('from'), s('to'), s('referenceId'), n('quantity'), context.simple);
            else if (action === 'reservation')
                manager.reserveStock({ operationId: s('operationId'), locationId: s('locationId'), referenceId: s('referenceId'), quantity: n('quantity'), priority: n('priority'), criticalTrain: b('criticalTrain'), customerContract: b('customerContract') });
            else if (action === 'inventory')
                manager.inventory(s('locationId'), s('referenceId'), n('counted'), context.simple);
            else if (action === 'pickup')
                manager.planPickup(s('orderId'), { carrierId: s('carrierId'), distanceKm: n('distanceKm'), pickupAt: now + n('pickupHours') * hour, windowEnd: now + n('windowHours') * hour, ...(n('cutoffHours') ? { terminalCutoff: now + n('cutoffHours') * hour } : {}), ...(n('railHours') ? { railDeparture: now + n('railHours') * hour, railArrival: now + n('railArrivalHours') * hour } : {}), trafficFactor: n('trafficFactor'), weatherFactor: n('weatherFactor'), ...(s('crossDockTo') ? { crossDockTo: s('crossDockTo') } : {}) }, context.simple);
            else if (action === 'hub') {
                const hub = manager.createHub(s('name'), s('kind'));
                manager.registerLocation({ ...hub, dockCount: n('dockCount'), dockCapacity: n('dockCapacity'), unloadMs: n('unloadMinutes') * 60000, waveHours: s('waves').split(',').map(Number).filter(h => Number.isFinite(h) && h >= 0 && h < 24) });
            }
            else if (action === 'consolidate')
                manager.consolidate(s('shipmentIds').split(',').map(x => x.trim()).filter(Boolean));
            else if (action === 'deconsolidate')
                manager.deconsolidate(s('shipmentId'), [{ locationId: s('to'), quantity: n('quantity') }], context.simple);
            else if (action === 'flow') {
                const rail = (context.railServices ?? []).find(r => r.id === s('railId'));
                manager.createFlow({ kind: s('kind'), referenceId: s('referenceId'), quantity: n('quantity'), from: s('from'), to: s('to'), ...(s('hubId') ? { hubId: s('hubId') } : {}), service: s('service'), carrierId: s('carrierId'), distanceKm: n('distanceKm'), deadline: now + n('deadlineHours') * hour, externalArrival: now + n('externalHours') * hour, campaignId: s('campaignId'), ...(rail ? { rail: { serviceId: rail.id, departure: rail.departure, arrival: rail.arrival, capacityKg: rail.capacityKg, eligible: rail.eligible } } : {}), ...(b('cold') ? { cold: { min: n('coldMin'), max: n('coldMax'), maxOutsideMs: n('coldMinutes') * 60000 } } : {}) }, context.simple);
            }
            else if (action === 'reroute-flow')
                manager.rerouteFlow(s('flowId'), s('to'), n('distanceKm'), context.simple);
            else if (action === 'temperature')
                manager.setFlowTemperature(s('flowId'), n('temperature'));
            else if (action === 'return')
                manager.returnStock(s('from'), s('referenceId'), n('quantity'), s('to'), s('kind'), context.simple);
            else if (action === 'packaging')
                manager.returnPackaging(s('packagingId'), s('to'), context.simple);
            else if (action === 'compatibility') {
                if (!b('approved'))
                    throw new Error('L’approbation explicite de cette équivalence est requise');
                manager.declareCompatibility(s('referenceId'), s('alternativeId'), s('notice'));
            }
            else if (action === 'contract')
                manager.signContract({ supplierId: s('supplierId'), referenceId: s('referenceId'), discountPct: n('discountPct'), minimumVolume: n('minimumVolume'), slaMs: n('slaHours') * hour, priority: n('priority') });
            else if (action === 'supplier')
                manager.addSupplier({ id: `custom-supplier-${manager.suppliers.length}`, name: s('name'), country: s('country'), referenceIds: ['*'], priceFactor: n('priceFactor'), prepareMs: n('prepareHours') * hour, capacityPerDay: n('capacity'), reliability: Math.max(0, Math.min(1, n('reliability'))), weekdays: [1, 2, 3, 4, 5], openHour: 8, closeHour: 18, available: true });
            else if (action === 'carrier') {
                const base = manager.carriers.find(c => c.id === s('profile'));
                if (!base)
                    throw new Error('Profil inconnu');
                const carrier = { ...base, id: `custom-carrier-${manager.carriers.length}`, name: s('name') };
                manager.addCarrier(carrier);
            }
            else if (action === 'multi-source') {
                const d = manager.demands.find(d => d.id === s('demandId'));
                if (!d)
                    throw new Error('Demande inconnue');
                manager.multiSource(d.id, [{ supplierId: s('supplierA'), quantity: n('quantityA') }, { supplierId: s('supplierB'), quantity: d.quantity - n('quantityA') }], context.simple);
            }
            else if (action === 'what-if') {
                const analysis = manager.whatIf({ supplierId: s('supplierId'), priceIncreasePct: n('priceIncreasePct'), supplierDown: b('supplierDown'), closedHubId: s('closedHubId') || undefined });
                const output = host.querySelector('[data-log-analysis]');
                if (output)
                    output.innerHTML = `<p>${analysis.affectedOrders.length} commandes impactées · surcoût ${money(analysis.extraCost)} · ${num(analysis.delayedQuantity)} unités retardées</p><p>${esc(analysis.risks.join(' '))}</p>`;
                return;
            }
            else if (action === 'trace') {
                trace(s('entityId'));
                return;
            }
            target.dataset.draftReset = 'true';
            refresh(action === 'pickup' ? 'Transport réservé. Suivez l’ETA et la fin de déchargement ci-dessus, puis contrôlez la réception dans Achats & réceptions.' : 'Action enregistrée');
        }
        catch (error) {
            fail(error);
        }
    };
    if (selectedReference && enteringEntity) {
        const referenceField = host.querySelector('form[data-log-form="purchase"] select[name="referenceId"]');
        if (referenceField && [...referenceField.options].some(o => o.value === selectedReference.id))
            referenceField.value = selectedReference.id;
    }
    if (view.tab === 'purchases' && view.offerDemandId) {
        const d = manager.demands.find(d => d.id === view.offerDemandId);
        if (d?.status === 'requested')
            try {
                offers(d.id);
            }
            catch (error) {
                fail(error);
            }
    }
}
