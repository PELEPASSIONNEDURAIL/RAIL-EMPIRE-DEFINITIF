import { layoutExperimentalModule } from './experimental-layout.js';
import { SERIES_LENGTH_FORMULA, decodeSeriesFile, archiveSeriesImages, createSeriesTar, gzipSeriesTar } from './catalog-series.js';
const refreshers = new WeakMap();
export function refreshCatalogSeriesPage(host) { const refresh = refreshers.get(host); if (!refresh)
    return false; refresh(); return true; }
function node(tag, text) { const out = document.createElement(tag); if (text !== undefined)
    out.textContent = text; return out; }
function button(label, action) { const out = node('button', label); out.type = 'button'; out.addEventListener('click', () => { void action(); }); return out; }
function field(parent, label, type = 'text', value = '') { const wrap = node('label', label + ' '), input = node('input'); input.type = type; input.value = value; wrap.append(input); parent.append(wrap); return input; }
function download(blob, filename) { const url = URL.createObjectURL(blob), a = node('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
/** Bounded preview: at most 60 image elements, discarded when the window changes. */
export function renderCatalogSeriesPage(host, manager, context = {}) {
    manager.recoverJournal();
    host.replaceChildren();
    const shell = node('section');
    shell.className = 'rc44-catalog-series';
    shell.dataset.rc44 = 'catalog-series';
    shell.style.cssText = 'display:grid;gap:12px;padding:16px';
    host.append(shell);
    shell.append(node('h2', 'Catalogue — séries et longueurs par image'), node('p', `Une image = un engin. Nom = fichier sans extension, sans modification. ${SERIES_LENGTH_FORMULA}. Les longueurs sont en lecture seule.`));
    const status = node('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    shell.append(status);
    let files = [], importSource = 'Sélection multiple', offset = 0, journalOffset = 0, invalidOnly = false, active = null, disposed = false;
    const show = (message) => { if (!disposed)
        status.textContent = message; };
    const reportError = (error) => show(error instanceof Error ? error.message : String(error));
    const run = async (action) => { try {
        await action();
    }
    catch (error) {
        reportError(error);
    } };
    const draft = manager.getDraftModel();
    const commonBox = node('fieldset');
    commonBox.append(node('legend', '1. Modèle commun de la série'));
    commonBox.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px';
    shell.append(commonBox);
    const series = field(commonBox, 'Série', 'text', draft.series || 'BB');
    const category = node('select');
    category.setAttribute('aria-label', 'Catégorie');
    for (const name of ['locomotive', 'automotrice', 'voiture', 'wagon']) {
        const option = node('option', name);
        option.value = name;
        category.append(option);
    }
    category.value = String(draft.common.category || 'locomotive');
    commonBox.append(category);
    const textFields = new Map();
    for (const [key, label, value] of [['manufacturer', 'Constructeur', ''], ['country', 'Pays', ''], ['traction', 'Traction', 'electrique'], ['coupling', 'Attelage', ''], ['loadingGauge', 'Gabarit', '']])
        textFields.set(key, field(commonBox, label, 'text', String(draft.common[key] ?? value)));
    const numberFields = new Map();
    for (const [key, label, value] of [['maxSpeed', 'Vitesse km/h', '160'], ['mass', 'Masse t', '80'], ['power', 'Puissance kW', '4000'], ['passengerCapacity', 'Voyageurs', '0'], ['freightCapacity', 'Fret t', '0'], ['purchasePrice', 'Prix', '4000000'], ['voltage', 'Tension V', '25000'], ['frequency', 'Fréquence Hz', '50']]) {
        const electric = Array.isArray(draft.common.electricSystems) ? draft.common.electricSystems[0] : undefined;
        const saved = key === 'voltage' || key === 'frequency' ? electric?.[key] : draft.common[key];
        const input = field(commonBox, label, 'number', String(saved ?? value));
        input.min = '0';
        input.step = 'any';
        numberFields.set(key, input);
    }
    const additional = field(commonBox, 'Autres champs JSON', 'text', '{}');
    additional.style.minWidth = '250px';
    const common = () => { const parsed = JSON.parse(additional.value || '{}'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw Error('Les autres champs doivent être un objet JSON.'); const values = { ...parsed, category: category.value }; for (const [key, input] of textFields)
        values[key] = input.value; for (const [key, input] of numberFields) {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < 0)
            throw Error(`${key} invalide.`);
        if (key !== 'voltage' && key !== 'frequency')
            values[key] = value;
    } values.electricSystems = [{ voltage: Number(numberFields.get('voltage').value), frequency: Number(numberFields.get('frequency').value) }]; return values; };
    const source = node('fieldset');
    source.append(node('legend', '2. Images, dossier ou archive TAR/TAR.GZ'));
    shell.append(source);
    const multi = field(source, 'Images multiples', 'file');
    multi.multiple = true;
    multi.accept = 'image/png,image/gif,image/jpeg,image/webp,image/bmp';
    multi.dataset.action = 'series-images';
    const folder = field(source, 'Dossier', 'file');
    folder.multiple = true;
    folder.setAttribute('webkitdirectory', '');
    folder.setAttribute('directory', '');
    const archive = field(source, 'Archive', 'file');
    archive.accept = '.tar,.tar.gz,.tgz';
    const selected = (list, source = 'Sélection multiple') => { importSource = source; files = Array.from(list || []).filter(x => /\.(png|gif|jpe?g|webp|bmp)$/i.test(x.name)); show(`${files.length} images sélectionnées. Cliquez Prévisualiser.`); };
    multi.addEventListener('change', () => selected(multi.files));
    folder.addEventListener('change', () => selected(folder.files, `Dossier ${folder.files?.[0]?.webkitRelativePath.split('/')[0] || ''}`));
    archive.addEventListener('change', () => { void run(async () => { const file = archive.files?.[0]; if (!file)
        return; files = await archiveSeriesImages(file); importSource = file.name; show(`${files.length} images extraites sans renommage.`); }); });
    const previewButton = button('Prévisualiser les images', () => run(async () => { if (!files.length)
        throw Error('Sélectionnez des images ou une archive.'); if (active)
        throw Error('Un traitement est déjà en cours.'); active = new AbortController(); previewButton.disabled = true; try {
        await manager.ingest(series.value, files, common(), decodeSeriesFile, (done, total) => show(`Lecture incrémentale ${done}/${total} ; une seule image décodée à la fois.`), active.signal, importSource);
        offset = 0;
        renderGrid();
        context.onChange?.();
        show(`${manager.getPreview().length} fiches prévisualisées, aucune écriture avant Appliquer.`);
    }
    finally {
        active = null;
        previewButton.disabled = false;
    } }));
    previewButton.dataset.action = 'series-preview';
    source.append(previewButton, button('Arrêter la lecture', () => { active?.abort(); }));
    const tools = node('fieldset');
    tools.append(node('legend', '3. Exceptions, masse et propagation'));
    shell.append(tools);
    const editField = node('select');
    editField.setAttribute('aria-label', 'Champ à modifier');
    for (const name of ['maxSpeed', 'mass', 'power', 'passengerCapacity', 'freightCapacity', 'purchasePrice', 'manufacturer', 'country', 'coupling', 'loadingGauge']) {
        const option = node('option', name);
        option.value = name;
        editField.append(option);
    }
    tools.append(editField);
    const editValue = field(tools, 'Valeur', 'text', '');
    const readValue = () => ['maxSpeed', 'mass', 'power', 'passengerCapacity', 'freightCapacity', 'purchasePrice'].includes(editField.value) ? Number(editValue.value) : editValue.value;
    tools.append(button('Modifier les fiches sélectionnées', () => run(() => { manager.editSelected(editField.value, readValue()); renderGrid(); context.onChange?.(); })), button('Mettre à jour le modèle commun (préserver exceptions)', () => run(() => { manager.applyCommon(common()); renderGrid(); context.onChange?.(); })), button('Aperçu : modifier toute cette famille', () => run(() => { manager.previewFamily(series.value, { [editField.value]: readValue() }); offset = 0; renderGrid(); show('Propagation prévisualisée. Désélectionnez les exceptions puis Appliquer.'); })));
    const replaceBox = node('fieldset');
    replaceBox.append(node('legend', 'Remplacer une image existante'));
    shell.append(replaceBox);
    const replaceId = field(replaceBox, 'ID fiche', 'text'), replaceFile = field(replaceBox, 'Nouvelle image', 'file');
    replaceFile.accept = 'image/*';
    replaceBox.append(button('Aperçu du remplacement', () => run(async () => { const file = replaceFile.files?.[0]; if (!file)
        throw Error('Choisissez une image.'); const image = await decodeSeriesFile(file), impact = manager.previewReplacement(replaceId.value, image); offset = 0; renderGrid(); const extra = context.describeImpacts?.(replaceId.value, impact.before, impact.after) || []; show(`${impact.before.toFixed(1)} → ${impact.after.toFixed(1)} m. ${impact.message} ${extra.join(' ')}`); context.onChange?.(); })));
    const filters = node('div');
    shell.append(filters);
    const invalid = field(filters, 'Seulement les erreurs', 'checkbox');
    invalid.addEventListener('change', () => { invalidOnly = invalid.checked; offset = 0; renderGrid(); });
    filters.append(button('Tout sélectionner', () => { manager.selectAll(true); renderGrid(); }), button('Tout désélectionner', () => { manager.selectAll(false); renderGrid(); }));
    const paging = node('div'), grid = node('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px';
    grid.dataset.action = 'series-grid';
    shell.append(paging, grid);
    const releaseImages = () => { for (const img of grid.querySelectorAll('img'))
        img.removeAttribute('src'); };
    function renderGrid() {
        if (disposed)
            return;
        releaseImages();
        grid.replaceChildren();
        const all = manager.getPreview();
        const total = invalidOnly ? all.filter(x => x.errors.length).length : all.length;
        if (offset >= total)
            offset = Math.max(0, Math.floor((total - 1) / 60) * 60);
        const windowRows = manager.previewWindow(offset, 60, invalidOnly);
        paging.replaceChildren(node('span', `${total} fiches ; ${total ? offset + 1 : 0}–${Math.min(offset + 60, total)}. `), button('Précédent', () => { offset = Math.max(0, offset - 60); renderGrid(); }), button('Suivant', () => { if (offset + 60 < total)
            offset += 60; renderGrid(); }));
        for (const row of windowRows) {
            const index = all.indexOf(row), card = node('article');
            card.style.cssText = 'border:1px solid #64748b;border-radius:8px;padding:10px;display:grid;gap:6px';
            const selected = field(card, 'Sélection', 'checkbox');
            selected.checked = row.selected;
            selected.addEventListener('change', () => manager.setSelected(index, selected.checked));
            const img = node('img');
            img.loading = 'lazy';
            img.alt = String(row.entry.name || '');
            img.style.cssText = 'max-width:100%;height:60px;object-fit:contain;image-rendering:pixelated';
            if (typeof row.entry.imageData === 'string')
                img.src = row.entry.imageData;
            card.append(img);
            const name = field(card, 'Nom exact', 'text', String(row.entry.name || ''));
            name.readOnly = true;
            const length = field(card, 'Longueur m', 'text', Number(row.entry.length).toFixed(1));
            length.readOnly = true;
            length.title = `${row.entry.imageNaturalWidth} px × 0,10`;
            const id = field(card, 'ID', 'text', row.entry.id);
            id.addEventListener('change', () => { void run(() => { manager.resolveCollision(index, id.value); renderGrid(); }); });
            const merge = field(card, 'Fusionner avec ID existant', 'text', row.mergeId || '');
            card.append(button('Confirmer fusion', () => run(() => { manager.mergeWith(index, merge.value); renderGrid(); })), button('Confirmer nom en doublon', () => run(() => { manager.confirmDuplicateName(index); renderGrid(); })), button('Exception : appliquer champ/valeur ci-dessus', () => run(() => { manager.setOverride(index, editField.value, readValue()); renderGrid(); })));
            for (const error of row.errors)
                card.append(node('p', 'Erreur : ' + error));
            for (const warning of row.warnings)
                card.append(node('p', 'Attention : ' + warning));
            card.append(node('small', 'Exceptions : ' + Object.keys(row.overrides).join(', ')));
            grid.append(card);
        }
    }
    const actions = node('div');
    shell.append(actions);
    const apply = button('Appliquer les fiches sélectionnées', () => run(async () => { apply.disabled = true; try {
        const tx = await manager.commit();
        context.onChange?.();
        renderGrid();
        renderJournal();
        show(`${tx.count} fiches appliquées atomiquement. Transaction ${tx.id}, annulable depuis le journal.`);
    }
    finally {
        apply.disabled = false;
    } }));
    apply.dataset.action = 'series-commit';
    actions.append(apply, button('Exporter JSON avec images originales', () => run(() => { const blob = new Blob([JSON.stringify(manager.exportJSON(), null, 2)], { type: 'application/json' }); if (blob.size > 64 * 1024 * 1024)
        throw Error('Export JSON trop volumineux (64 Mio) : fractionnez les séries.'); download(blob, 'catalogue-series.json'); })), button('Exporter TAR.GZ (noms originaux)', () => run(async () => { const tar = createSeriesTar(manager.exportJSON()); download(await gzipSeriesTar(tar), 'catalogue-series.tar.gz'); })));
    const migration = node('details');
    migration.append(node('summary', 'Rapport de migration des longueurs'));
    shell.append(migration);
    const report = context.getMigrationReport?.();
    if (report) {
        migration.append(node('p', `${report.total} fiches analysées ; ${report.changed.length} longueurs changées ; ${report.anomalies.length} écarts >20 % ; ${report.missing.length} non calculables.`));
        for (const item of report.anomalies.slice(0, 50))
            migration.append(node('p', `${item.id} : ${item.before ?? '?'} → ${item.after} m`));
        migration.append(button('Exporter le rapport complet', () => download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), 'migration-longueurs.json')));
    }
    else
        migration.append(node('p', 'Les fiches sans image ont une longueur non calculable. Une image locale sans métadonnée doit être remplacée ou décodée avant migration.'));
    const journal = node('div');
    shell.append(journal);
    function renderJournal() {
        const transactions = [...manager.journal].reverse(), size = 20, lastOffset = Math.max(0, Math.ceil(transactions.length / size) - 1) * size;
        journalOffset = Math.min(journalOffset, lastOffset);
        journal.replaceChildren(node('h3', 'Journal — imports annulables après sauvegarde'));
        const navigation = node('nav');
        navigation.setAttribute('aria-label', 'Pages du journal des imports');
        const recent = button('Imports plus récents', () => { journalOffset = Math.max(0, journalOffset - size); renderJournal(); }), older = button('Imports plus anciens', () => { journalOffset = Math.min(lastOffset, journalOffset + size); renderJournal(); });
        recent.disabled = journalOffset === 0;
        older.disabled = journalOffset >= lastOffset;
        navigation.append(recent, node('span', transactions.length ? `${journalOffset + 1}–${Math.min(transactions.length, journalOffset + size)} / ${transactions.length} imports` : 'Aucun import'), older);
        journal.append(navigation);
        for (const tx of transactions.slice(journalOffset, journalOffset + size)) {
            const line = node('p', `${tx.id} · ${tx.at} · ${tx.source} · ${tx.count} fiches · ${tx.status} · ${tx.formula}`);
            if (tx.status === 'committed')
                line.append(button('Annuler ' + tx.id, () => run(async () => { await manager.rollback(tx.id); context.onChange?.(); renderJournal(); show('Import annulé : fiches originales restaurées, éléments physiques préservés.'); })));
            journal.append(line);
        }
    }
    renderGrid();
    renderJournal();
    layoutExperimentalModule(host);
    refreshers.set(host, () => { if (!disposed) {
        renderGrid();
        renderJournal();
    } });
    return () => { refreshers.delete(host); disposed = true; active?.abort(); releaseImages(); shell.remove(); };
}
