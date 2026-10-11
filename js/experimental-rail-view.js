import { trainStatus } from './operations-view-model.js';
const states = new WeakMap();
const refreshers = new WeakMap();
export function refreshExperimentalRail(host) { const refresh = refreshers.get(host); if (!refresh)
    return false; refresh(); return true; }
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = (v) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const input = (name, label, value = '', type = 'text', min = '') => `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${min ? `min="${min}"` : ''} required></label>`;
const select = (name, label, items, chosen = '') => `<label>${esc(label)}<select name="${name}" required><option value="">Choisir…</option>${items.map(v => `<option value="${esc(v.id)}" ${v.id === chosen ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>`;
const form = (action, title, fields, submit) => `<details class="exp-action"><summary>${esc(title)}</summary><form data-operation="${action}" class="exp-form">${fields}<button type="submit" class="btn-primary">${esc(submit)}</button></form></details>`;
const table = (headers, rows) => `<div class="exp-table-scroll"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
let stationFieldId = 0;
const stationField = (section) => { const listId = `exp-stations-${section}-${++stationFieldId}`; return `<label>Gare<input name="station" type="search" data-exp-station-query list="${listId}" placeholder="Rechercher une gare…" required autocomplete="off"><datalist id="${listId}"></datalist></label>`; };
const pager = () => `<div class="exp-pager"><button type="button" data-exp-page="-1">Précédent</button><span data-exp-count></span><button type="button" data-exp-page="1">Suivant</button></div>`;
const resourceSearch = (query, label) => `<div class="exp-toolbar"><label>${label}<input type="search" data-exp-query value="${esc(query)}" placeholder="Nom ou identifiant…"></label><button type="button" data-exp-live>Mettre à jour la liste</button></div>`;
/** Focused railway views. Actions use the same validated commands as the runtime. */
export function renderExperimentalRail(host, game, section, command) {
    let state = states.get(host);
    if (!state) {
        state = { query: '', offset: 0, message: '', error: false };
        states.set(host, state);
    }
    const view = state;
    const allServices = () => game.scheduleCreator.services;
    const stations = game.world.stations;
    const power = game.operationalExtensions;
    const live = () => allServices().filter(s => s.active !== false && !s.completed && !s.cancelled);
    const services = live().map(s => ({ id: s.id, label: [s.number, s.name].filter(Boolean).join(' · ') || s.id }));
    const chosen = host.closest('[data-experimental-section-host]')?.getAttribute('data-entity-id') || '';
    const serviceField = () => select('service', 'Train', services, chosen);
    const stationLookup = (value) => stations.find(s => s.id === value || `${s.name} · ${s.id}` === value);
    let content = '';
    if (section === 'operations' || section === 'regulation') {
        content = `<div class="exp-metrics" data-exp-metrics></div><div class="exp-toolbar"><label>Rechercher une circulation<input type="search" data-exp-query value="${esc(view.query)}" placeholder="Numéro, nom, cause d’attente…"></label><button type="button" data-exp-live>Mettre à jour la liste</button></div><div data-exp-services></div><div class="exp-pager"><button type="button" data-exp-page="-1">Précédent</button><span data-exp-count></span><button type="button" data-exp-page="1">Suivant</button></div>`;
        const selected = allServices().find(s => s.id === chosen);
        if (selected)
            content = `<article class="exp-selection" data-assistant-service-id="${esc(selected.id)}"><h3>${esc(selected.name || selected.number)}</h3><p>${esc(trainStatus(selected.state, Number(selected.delay), Number(selected.train?.speed)))} · ${esc(selected.delayReason || selected.train?.delayReason || 'Aucune attente signalée.')}</p></article>` + content;
        content += `<section class="exp-command-group"><h3>Décisions de régulation</h3><p>Ces actions ciblent le train choisi. Une retenue reste active jusqu’à son échéance ou sa libération.</p>${form('hold', 'Retenir un train', serviceField() + input('min', 'Durée de retenue (min)', '5', 'number', '1'), 'Retenir')}${form('release', 'Libérer une retenue', serviceField(), 'Libérer')}${form('priority', 'Régler la priorité', serviceField() + input('priority', 'Priorité (plus grand = prioritaire)', '5', 'number', '0'), 'Enregistrer la priorité')}${form('extraStop', 'Ajouter un arrêt exceptionnel', serviceField() + stationField(section) + input('minutes', 'Durée d’arrêt (min)', '5', 'number', '1'), 'Ajouter l’arrêt')}${form('reroute', 'Chercher un réacheminement', serviceField(), 'Chercher un itinéraire ferroviaire')}${form('rescue', 'Organiser un secours', serviceField(), 'Préparer le secours')}</section>`;
    }
    if (section === 'energy') {
        const sections = [...power.powerSections].map(([id]) => ({ id: String(id), label: String(id) }));
        content = `<div class="exp-metrics"><div><span>Sections configurées</span><b>${sections.length}</b></div><div><span>Énergie récupérée</span><b>${number(power.energyRecoveredKwh)} kWh</b></div><div><span>Trains affectés</span><b>${power.serviceSections.size}</b></div></div>`;
        content += resourceSearch(view.query, 'Rechercher une alimentation') + table(['Section', 'Tension', 'Fréquence', 'Capacité', 'Résistance', 'État'], [...power.powerSections].slice(0, 100).map(([id, v]) => `<tr><td>${esc(id)}</td><td>${number(v.nominalVoltage)} V</td><td>${number(v.capacityKw)} kW</td><td>${number(v.resistanceOhm)} Ω</td><td>${v.outage ? 'Hors tension' : 'Disponible'}</td></tr>`).join('') || '<tr><td colspan="5">Aucune alimentation personnalisée. Configurez une section ci-dessous.</td></tr>');
        content += pager();
        content += form('power', 'Configurer une alimentation', input('section', 'Nom de section') + select('voltage', 'Tension nominale', [{ id: '1500', label: '1 500 V continu' }, { id: '3000', label: '3 000 V continu' }, { id: '15000', label: '15 000 V' }, { id: '25000', label: '25 000 V' }]) + select('frequency', 'Fréquence', [{ id: 'auto', label: 'Selon la tension' }, { id: '0', label: 'Courant continu' }, { id: '16.7', label: '16,7 Hz' }, { id: '50', label: '50 Hz' }], 'auto') + input('capacity', 'Puissance disponible (kW)', '10000', 'number', '1') + input('resistance', 'Résistance (Ω)', '0.01', 'number', '0') + select('outage', 'État de l’alimentation', [{ id: 'false', label: 'Sous tension' }, { id: 'true', label: 'Hors tension' }], 'false'), 'Enregistrer la section');
        content += form('assignPower', 'Affecter une alimentation à un train', serviceField() + select('section', 'Section d’alimentation', sections), 'Affecter');
        content += `<p class="exp-note">Les paramètres décrivent une alimentation de jeu. L’électrification du parcours et la compatibilité du matériel restent contrôlées par le moteur.</p>`;
    }
    if (section === 'stations') {
        const configured = [...game.stationResources.stations.values()];
        content = `<div class="exp-metrics"><div><span>Gares du monde</span><b>${number(game.world.stations.length)}</b></div><div><span>Gares équipées</span><b>${configured.length}</b></div><div><span>Opérations</span><b>${game.stationResources.operations.length}</b></div></div>`;
        content += resourceSearch(view.query, 'Rechercher une gare équipée') + table(['Gare', 'Quais', 'Agents', 'Équipements'], configured.slice(0, 100).map(s => `<tr><td>${esc(game.world.getStationById(s.id)?.name || s.id)}</td><td>${s.platforms.length}</td><td>${s.staff}</td><td>${esc(s.equipment.join(', ') || 'Aucun')}</td></tr>`).join('') || '<tr><td colspan="4">Aucune installation personnalisée. Les gares du monde restent disponibles pour les horaires.</td></tr>');
        content += pager() + `<details class="exp-action"><summary>Opérations de service en cours</summary><div data-exp-station-operations></div></details>`;
        content += form('stationPlatform', 'Configurer un quai', stationField(section) + input('platform', 'Nom du quai') + input('track', 'Voie') + input('length', 'Longueur utile (m)', '250', 'number', '1') + input('capacity', 'Capacité voyageurs', '500', 'number', '0') + select('accessible', 'Accessibilité', [{ id: 'true', label: 'Accessible' }, { id: 'false', label: 'Non accessible' }], 'true'), 'Enregistrer le quai');
        content += form('stationResources', 'Configurer les moyens de service', stationField(section) + input('water', 'Eau (L)', '1000', 'number', '0') + input('cleaner', 'Nettoyant (L)', '20', 'number', '0') + input('chemical', 'Produit WC (L)', '20', 'number', '0') + input('catering', 'Restauration (unités)', '100', 'number', '0') + input('staff', 'Agents disponibles', '5', 'number', '0') + input('equipment', 'Équipements (séparés par virgules)', 'water,cleaning,wc,restoration,preparation'), 'Enregistrer les moyens');
        content += form('stationOperation', 'Planifier une opération en gare', serviceField() + stationField(section) + select('kind', 'Opération', [{ id: 'cleaning', label: 'Nettoyage' }, { id: 'water', label: 'Remplissage d’eau' }, { id: 'wc', label: 'Vidange WC' }, { id: 'restoration', label: 'Restauration' }, { id: 'preparation', label: 'Préparation' }]) + input('quantity', 'Quantité requise', '1', 'number', '1'), 'Planifier');
    }
    host.classList.add('exp-content');
    host.innerHTML = `<div class="exp-result" data-exp-result role="status" ${view.message ? '' : 'hidden'}></div><p data-exp-no-services class="exp-note" ${services.length ? 'hidden' : ''}>Aucun train actif à choisir. Créez ou activez un horaire dans Horaires ; il apparaîtra ici automatiquement.</p>${content}`;
    const result = host.querySelector('[data-exp-result]');
    const showResult = (message, error = false) => { view.message = message; view.error = error; result.hidden = false; result.textContent = message; result.classList.toggle('error', error); };
    if (view.message)
        showResult(view.message, view.error);
    const stationLists = () => {
        for (const field of host.querySelectorAll('[data-exp-station-query]')) {
            const query = field.value.toLocaleLowerCase('fr').trim();
            const list = field.list || host.querySelector(`#${field.getAttribute('list')}`);
            if (!list)
                continue;
            const rows = stations.filter(s => query.length >= 2 ? `${s.name} ${s.id}`.toLocaleLowerCase('fr').includes(query) : !s._nativeOSM).slice(0, 40);
            list.innerHTML = rows.map(s => `<option value="${esc(`${s.name} · ${s.id}`)}">${esc(s.name)}</option>`).join('');
        }
    };
    const pageRows = (rows) => {
        const size = 50;
        view.offset = Math.max(0, Math.min(view.offset, Math.max(0, Math.ceil(rows.length / size) - 1) * size));
        const count = host.querySelector('[data-exp-count]');
        if (count)
            count.textContent = `${rows.length ? view.offset + 1 : 0}–${Math.min(rows.length, view.offset + size)} / ${rows.length}`;
        for (const b of host.querySelectorAll('[data-exp-page]'))
            b.disabled = Number(b.dataset.expPage) < 0 ? view.offset === 0 : view.offset + size >= rows.length;
        return rows.slice(view.offset, view.offset + size);
    };
    let serviceSignature = '';
    const syncServices = () => {
        const entries = live().map(s => ({ id: s.id, label: [s.number, s.name].filter(Boolean).join(' · ') || s.id }));
        const signature = JSON.stringify(entries);
        if (signature === serviceSignature)
            return;
        serviceSignature = signature;
        for (const field of host.querySelectorAll('select[name="service"]')) {
            const value = field.value, obsolete = value && !entries.some(s => s.id === value);
            const options = '<option value="">Choisir…</option>' + entries.map(s => `<option value="${esc(s.id)}" ${s.id === value ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
            field.innerHTML = options + (obsolete ? `<option selected disabled value="${esc(value)}">Train terminé ou indisponible — choisir un autre train</option>` : '');
            field.setCustomValidity?.(obsolete ? 'Choisissez un train actif.' : '');
            field.onchange = () => field.setCustomValidity?.(!live().some(s => s.id === field.value) ? 'Choisissez un train actif.' : '');
        }
        const note = host.querySelector('[data-exp-no-services]');
        if (note)
            note.hidden = entries.length > 0;
    };
    const refreshRows = () => {
        const query = view.query.toLocaleLowerCase('fr');
        if (section === 'energy') {
            const all = [...power.powerSections], rows = all.filter(([id]) => String(id).toLocaleLowerCase('fr').includes(query));
            const body = host.querySelector('tbody');
            if (body)
                body.innerHTML = pageRows(rows).map(([id, v]) => `<tr><td>${esc(id)}</td><td>${number(v.nominalVoltage)} V</td><td>${v.frequency ? `${number(v.frequency)} Hz` : 'Continu'}</td><td>${number(v.capacityKw)} kW</td><td>${number(v.resistanceOhm)} Ω</td><td>${v.outage ? 'Hors tension' : 'Disponible'}</td></tr>`).join('') || '<tr><td colspan="6">Aucune alimentation correspondante.</td></tr>';
            const metrics = host.querySelectorAll('.exp-metrics b');
            if (metrics[0])
                metrics[0].textContent = String(all.length);
            if (metrics[1])
                metrics[1].textContent = `${number(power.energyRecoveredKwh)} kWh`;
            if (metrics[2])
                metrics[2].textContent = String(power.serviceSections.size);
            const field = host.querySelector('form[data-operation="assignPower"] select[name="section"]');
            if (field) {
                const value = field.value;
                const signature = JSON.stringify(all.map(([id]) => id));
                const options = '<option value="">Choisir…</option>' + all.map(([id]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(id)}</option>`).join('');
                if (field.dataset.expOptions !== signature) {
                    field.innerHTML = options;
                    field.dataset.expOptions = signature;
                }
            }
            return;
        }
        if (section === 'stations') {
            const all = [...game.stationResources.stations.values()], rows = all.filter(s => `${s.id} ${game.world.getStationById(s.id)?.name || ''}`.toLocaleLowerCase('fr').includes(query));
            const body = host.querySelector('tbody');
            if (body)
                body.innerHTML = pageRows(rows).map(s => `<tr><td>${esc(game.world.getStationById(s.id)?.name || s.id)}</td><td>${s.platforms.length}</td><td>${s.staff - s.staffBusy} libres / ${s.staff}</td><td>${esc(s.equipment.join(', ') || 'Aucun')}</td></tr>`).join('') || '<tr><td colspan="4">Aucune installation correspondante.</td></tr>';
            const metrics = host.querySelectorAll('.exp-metrics b');
            if (metrics[1])
                metrics[1].textContent = String(all.length);
            if (metrics[2])
                metrics[2].textContent = String(game.stationResources.operations.length);
            const operations = host.querySelector('[data-exp-station-operations]');
            if (operations)
                operations.innerHTML = table(['Gare / train', 'Prestation', 'État', 'Progression / action'], game.stationResources.operations.slice(-50).reverse().map(op => `<tr><td>${esc(game.world.getStationById(op.stationId)?.name || op.stationId)} · ${esc(allServices().find(s => s.id === op.serviceId)?.name || op.serviceId)}</td><td>${esc(op.kind)}</td><td>${esc(op.state)} ${esc(op.reason || '')}</td><td>${Math.min(100, Math.round(Number(op.elapsedSec || 0) / Math.max(1, op.durationSec) * 100))} % ${op.state === 'running' ? `<button type="button" data-exp-cancel-operation="${esc(op.id)}">Annuler et libérer les moyens</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4">Aucune prestation planifiée.</td></tr>');
            return;
        }
        const target = host.querySelector('[data-exp-services]');
        if (!target)
            return;
        const all = live();
        const rows = all.filter(s => `${s.name} ${s.number} ${s.delayReason} ${s.train?.delayReason}`.toLocaleLowerCase('fr').includes(query));
        const pageSize = 50;
        view.offset = Math.max(0, Math.min(view.offset, Math.max(0, Math.ceil(rows.length / pageSize) - 1) * pageSize));
        target.innerHTML = table(['Train', 'État', 'Parcours', 'Rame', 'Motif / action'], rows.slice(view.offset, view.offset + pageSize).map(s => {
            const stops = s.getCurrentStops(), first = stops[0], last = stops[stops.length - 1];
            return `<tr data-assistant-service-id="${esc(s.id)}"><td><b>${esc(s.number || s.name || s.id)}</b><small>${esc(s.name)}</small></td><td>${esc(trainStatus(s.state, Number(s.delay), Number(s.train?.speed)))}</td><td>${esc(first?.name || game.world.getStationById(first?.stationId)?.name || 'Départ')} → ${esc(last?.name || game.world.getStationById(last?.stationId)?.name || 'Terminus')}</td><td>${esc(s.rame?.name || 'Affectation directe')}</td><td>${esc(s.delayReason || s.train?.delayReason || 'Aucune attente')} ${s.position ? `<button type="button" data-exp-follow="${esc(s.id)}">Voir sur la carte</button>` : ''}</td></tr>`;
        }).join('') || '<tr><td colspan="5">Aucune circulation correspondante. Créez ou activez un horaire depuis Horaires.</td></tr>');
        const metric = host.querySelector('[data-exp-metrics]');
        if (metric)
            metric.innerHTML = `<div><span>Services actifs</span><b>${all.length}</b></div><div><span>En mouvement</span><b>${all.filter(s => s.state === 'moving').length}</b></div><div><span>Avec retard</span><b>${all.filter(s => Number(s.delay) >= 1).length}</b></div>`;
        const count = host.querySelector('[data-exp-count]');
        if (count)
            count.textContent = `${rows.length ? view.offset + 1 : 0}–${Math.min(rows.length, view.offset + pageSize)} / ${rows.length}`;
        for (const b of host.querySelectorAll('[data-exp-page]'))
            b.disabled = Number(b.dataset.expPage) < 0 ? view.offset === 0 : view.offset + pageSize >= rows.length;
    };
    const execute = (action, values, button) => {
        if (button?.disabled)
            return;
        if (button)
            button.disabled = true;
        void Promise.resolve().then(() => command(action, values)).then(value => { showResult(typeof value === 'string' ? value : JSON.stringify(value ?? 'Action enregistrée.')); game.saveState(); refreshExperimentalRail(host); }).catch(error => showResult(error instanceof Error ? error.message : String(error), true)).finally(() => { if (button)
            button.disabled = false; });
    };
    host.oninput = event => { const field = event.target; if (field.matches('[data-exp-query]')) {
        view.query = field.value;
        view.offset = 0;
        refreshRows();
    } if (field.matches('[data-exp-station-query]'))
        stationLists(); };
    host.onclick = event => { const b = event.target?.closest('button'); if (!b)
        return; if (b.dataset.expCancelOperation) {
        execute('stationCancelOperation', { operation: b.dataset.expCancelOperation }, b);
        return;
    } if (b.dataset.expPage) {
        view.offset += Number(b.dataset.expPage) * 50;
        refreshRows();
    } if (b.hasAttribute('data-exp-live'))
        refreshExperimentalRail(host); if (b.dataset.expFollow) {
        const s = live().find(s => s.id === b.dataset.expFollow);
        if (s) {
            game.ui.switchPage('map');
            game.ui.selectService(s);
        }
    } };
    host.onsubmit = event => {
        const form = event.target;
        if (!form.matches('form[data-operation]'))
            return;
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        if (button?.disabled)
            return;
        const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value)]));
        if (values.station) {
            const station = stationLookup(values.station);
            if (!station) {
                showResult('Sélectionnez une gare dans les propositions.', true);
                return;
            }
            values.station = station.id;
        }
        execute(form.dataset.operation || '', values, button);
    };
    // Numeric fields can contain fractional physical quantities.
    for (const input of host.querySelectorAll('input[type="number"]'))
        input.step = 'any';
    const refresh = () => { syncServices(); refreshRows(); };
    refreshers.set(host, refresh);
    refresh();
    stationLists();
}
