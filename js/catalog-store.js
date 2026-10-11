import { RollingStockItem } from './rolling-stock.js';
import { loadExternalCatalogBundle, saveExternalCatalogBundle, validateExternalCatalogBundle } from './catalog-external.js';
const EMPTY = { format: 'rail-empire-catalog', version: 1, modifications: [], imports: [], deletions: [] };
const DIMENSIONS = ['family', 'category', 'country', 'series', 'freight', 'compatibility'];
function values(item, dim) {
    switch (dim) {
        case 'family': return [String(item.realIdentitySeries || item.seriesName || item.mlgSeriesName || item.category)];
        case 'category': return [item.category];
        case 'country': return [String(item.country || item.identityCountry || '')];
        case 'series': return [item.seriesName || item.mlgSeriesName];
        case 'freight': return item.cargoTypes;
        case 'compatibility': return item.technicallyCompatibleCargoTypes;
    }
}
export function catalogSearchText(item) {
    return [item.name, item.seriesName, item.realIdentitySeries, item.realIdentityId, item.notes, item.category, item.traction, item.wagonSubCategory, item.identityCountry, item.identityOperator, item.country, item.mlgId, item.mlgSeriesName, item.mlgArchivePath, item.mlgCategory, item.mlgPathCategory, item.componentRole].join(' ').toLowerCase();
}
function normalizedItem(row, existing) {
    const merged = { ...existing, ...row, _catalog: true };
    const item = new RollingStockItem(merged);
    // Extensions (series/image provenance) survive without bypassing model invariants.
    for (const key of Object.keys(merged))
        if (!(key in item))
            item[key] = merged[key];
    return item;
}
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function copyCatalogValue(value, ancestors = new Set()) {
    if (value === null || typeof value !== 'object')
        return value;
    if (ancestors.has(value))
        throw new Error('Référence circulaire dans le catalogue.');
    ancestors.add(value);
    if (Array.isArray(value)) {
        const copy = value.map(item => copyCatalogValue(item, ancestors));
        ancestors.delete(value);
        return copy;
    }
    const copy = Object.create(null);
    for (const [key, item] of Object.entries(value))
        copy[key] = copyCatalogValue(item, ancestors);
    ancestors.delete(value);
    return copy;
}
function freezeCatalogValue(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value))
        return;
    for (const item of Object.values(value))
        freezeCatalogValue(item);
    Object.freeze(value);
}
// Strings (including multi-megabyte inline images) are immutable and are shared; cloning a
// cumulative overlay must not stringify/reparse all retained images on every small edit.
function cloneBundle(bundle) { return validateExternalCatalogBundle(copyCatalogValue(bundle)); }
/** One shared service per session/manager. Native metadata is never cloned for navigation. */
export class CatalogStore {
    constructor(manager, options) {
        this.state = 'UNLOADED';
        this.diagnostic = 'Catalogue non chargé.';
        this.generation = 0;
        this.lastInvalidation = { ids: [], families: [], indices: [] };
        this.loading = null;
        this.overlay = EMPTY;
        this.nativeIds = new Set();
        this.indices = new Map();
        this.search = new Map();
        this.images = new Map();
        this.imagePending = new Map();
        this.imageWindow = new Set();
        this.plans = new WeakMap();
        this.writing = false;
        this.indexedItems = null;
        this.memorySnapshot = null;
        this.migrationPersistenceDiagnostic = '';
        this.counters = { nativeLoads: 0, overlayApplications: 0, indexBuilds: 0 };
        this.manager = manager;
        this.options = options;
    }
    ensureLoaded() {
        if (this.loading && this.state === 'READY' && this.indexedItems !== this.manager.items) {
            this.state = 'LOADING';
            this.loading = this.reconcileSavedManager();
        }
        if (this.loading)
            return this.loading;
        this.state = 'LOADING';
        this.diagnostic = 'Chargement du catalogue partagé…';
        this.loading = (async () => {
            try {
                this.counters.nativeLoads++;
                await this.options.loadNative();
                this.nativeIds = new Set(this.options.nativeIds?.() || this.manager.items.map(row => row.id));
                const overlay = await (this.options.loadOverlay || loadExternalCatalogBundle)();
                if (overlay) {
                    for (const row of overlay.imports)
                        this.nativeIds.delete(row.id);
                    await this.commit(this.preview(overlay), { persist: false });
                    this.overlay = cloneBundle(overlay);
                    const savedGeneration = Number(overlay.metadata?.catalogGeneration);
                    if (Number.isSafeInteger(savedGeneration) && savedGeneration >= 0)
                        this.generation = savedGeneration;
                    this.counters.overlayApplications++;
                }
                await this.options.beforeReady?.(this.manager);
                this.buildIndices();
                this.state = 'READY';
                this.diagnostic = `${this.manager.items.length.toLocaleString('fr-FR')} fiches disponibles.${this.migrationPersistenceDiagnostic}`;
                await this.options.afterReady?.(this.manager);
                return this.manager;
            }
            catch (error) {
                this.state = 'FAILED';
                this.loading = null;
                this.diagnostic = error instanceof Error ? error.message : String(error);
                throw error;
            }
        })();
        return this.loading;
    }
    async reconcileSavedManager() {
        try {
            // The classic registry and Batch186 Promise already contain the parsed base. Reseed ids,
            // never reparse it, when a player loads another game into the same HTML session.
            await this.options.loadNative();
            await this.commit(this.preview(this.overlay), { persist: false });
            await this.options.beforeReady?.(this.manager);
            this.buildIndices();
            this.state = 'READY';
            this.diagnostic = `${this.manager.items.length} fiches disponibles après restauration.${this.migrationPersistenceDiagnostic}`;
            await this.options.afterReady?.(this.manager);
            return this.manager;
        }
        catch (error) {
            this.state = 'FAILED';
            this.loading = null;
            this.diagnostic = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }
    index(item, add, dimensions = DIMENSIONS, searchChanged = true) {
        if (add && searchChanged)
            this.search.set(item.id, catalogSearchText(item));
        else if (searchChanged)
            this.search.delete(item.id);
        for (const dim of dimensions) {
            let index = this.indices.get(dim);
            if (!index) {
                index = new Map();
                this.indices.set(dim, index);
            }
            for (const value of values(item, dim)) {
                if (!value)
                    continue;
                if (add) {
                    let ids = index.get(value);
                    if (!ids) {
                        ids = new Set();
                        index.set(value, ids);
                    }
                    ids.add(item.id);
                }
                else {
                    const ids = index.get(value);
                    ids?.delete(item.id);
                    if (ids?.size === 0)
                        index.delete(value);
                }
            }
        }
    }
    buildIndices() { this.indices.clear(); this.search.clear(); for (const row of this.manager.items)
        this.index(row, true); this.counters.indexBuilds++; this.indexedItems = this.manager.items; }
    query(query = {}) {
        const limit = Math.max(1, Math.min(100, Math.floor(query.limit || 100)));
        const offset = Math.max(0, Math.floor(query.offset || 0));
        const filters = [];
        for (const dim of DIMENSIONS) {
            const value = query[dim];
            if (value)
                filters.push(this.indices.get(dim)?.get(value) || new Set());
        }
        if (query.ids)
            filters.push(new Set(query.ids));
        filters.sort((a, b) => a.size - b.size);
        const candidates = filters[0] || this.manager._byId.keys();
        const terms = (query.text || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        const items = [];
        let total = 0;
        for (const id of candidates) {
            if (!filters.every(set => set.has(id)))
                continue;
            const item = this.manager.getById(id);
            if (!item || (!terms.every(term => (this.search.get(id) || '').includes(term)) && !query.textMatch?.(item, query.text || '')) || query.predicate && !query.predicate(item))
                continue;
            if (total >= offset && items.length < limit)
                items.push(item);
            total++;
        }
        return { items, total, generation: this.generation, offset, limit };
    }
    facets(dimension) { return [...(this.indices.get(dimension)?.keys() || [])].sort(); }
    preview(input) {
        const clean = cloneBundle(input);
        freezeCatalogValue(clean);
        const rows = new Map();
        const deleted = new Set();
        let skipped = 0;
        const protectedIds = this.options.protectedIds?.() || new Set();
        for (const id of clean.deletions) {
            if (protectedIds.has(id)) {
                skipped++;
                continue;
            }
            if (this.manager.getById(id))
                deleted.add(id);
            else
                skipped++;
        }
        for (const row of clean.modifications) {
            const existing = this.manager.getById(row.id);
            if (!existing) {
                skipped++;
                continue;
            }
            if (deleted.has(row.id))
                continue;
            const candidate = normalizedItem(row, existing);
            if (!equal(existing, candidate))
                rows.set(row.id, candidate);
        }
        for (const row of clean.imports) {
            const existing = this.manager.getById(row.id);
            if (existing && this.nativeIds.has(row.id))
                throw new Error(`Identifiant importé en conflit : ${row.id}.`);
            const candidate = normalizedItem(row, existing);
            if (!existing || !equal(existing, candidate))
                rows.set(row.id, candidate);
        }
        const merged = cloneBundle(this.overlay);
        const mods = new Map(merged.modifications.map(row => [row.id, row]));
        const imports = new Map(merged.imports.map(row => [row.id, row]));
        const tombstones = new Set(merged.deletions);
        for (const id of deleted) {
            mods.delete(id);
            imports.delete(id);
            tombstones.add(id);
        }
        for (const [id, row] of rows) {
            tombstones.delete(id);
            if (this.nativeIds.has(id))
                mods.set(id, { ...row, imageData: typeof row.imageData === 'string' ? row.imageData : undefined, _source: typeof row._source === 'string' ? row._source : undefined });
            else
                imports.set(id, { ...row, imageData: typeof row.imageData === 'string' ? row.imageData : undefined, _source: typeof row._source === 'string' ? row._source : undefined });
        }
        const overlay = { ...merged, metadata: { ...merged.metadata, ...clean.metadata, catalogGeneration: this.generation + (rows.size || deleted.size ? 1 : 0) }, modifications: [...mods.values()], imports: [...imports.values()], deletions: [...tombstones] };
        const plan = Object.freeze({ generation: this.generation, bundle: clean, changedIds: Object.freeze([...rows.keys()]), deletedIds: Object.freeze([...deleted]), skipped });
        this.plans.set(plan, { rows, deleted, overlay });
        return plan;
    }
    async commit(plan, { persist = true } = {}) {
        const staged = this.plans.get(plan);
        if (!staged || plan.generation !== this.generation)
            throw new Error('Prévisualisation catalogue obsolète.');
        if (this.writing)
            throw new Error('Une transaction catalogue est déjà en cours.');
        if (!staged.rows.size && !staged.deleted.size) {
            if (persist && JSON.stringify(staged.overlay.metadata) !== JSON.stringify(this.overlay.metadata)) {
                this.writing = true;
                try {
                    await (this.options.saveOverlay || saveExternalCatalogBundle)(staged.overlay);
                }
                finally {
                    this.writing = false;
                }
            }
            this.overlay = staged.overlay;
            return { modifiedIds: [], deleted: 0, imported: 0, modified: 0, skipped: plan.skipped, generation: this.generation };
        }
        this.writing = true;
        try {
            // Build the publication array before persistence: no partial mutation is visible during I/O.
            const next = this.manager.items.filter(row => !staged.deleted.has(row.id));
            let imported = 0;
            for (const [id, row] of staged.rows)
                if (!this.manager.getById(id)) {
                    next.push(row);
                    imported++;
                }
            const nextIndex = new Map(next.map(row => [row.id, row]));
            if (persist)
                await (this.options.saveOverlay || saveExternalCatalogBundle)(staged.overlay);
            const families = new Set();
            const touched = new Set();
            const touchedIndices = new Set();
            for (const id of [...staged.rows.keys(), ...staged.deleted]) {
                const old = this.manager.getById(id), row = staged.rows.get(id);
                const changedDimensions = DIMENSIONS.filter(dim => JSON.stringify(old ? values(old, dim) : []) !== JSON.stringify(row ? values(row, dim) : []));
                for (const dim of changedDimensions)
                    touchedIndices.add(dim);
                const searchChanged = !old || !row || catalogSearchText(old) !== catalogSearchText(row);
                if (searchChanged)
                    touchedIndices.add('search');
                const imageChanged = !old || !row || old.imageData !== row.imageData;
                if (old) {
                    values(old, 'family').forEach(value => families.add(value));
                    this.index(old, false, changedDimensions, searchChanged);
                }
                if (row) {
                    values(row, 'family').forEach(value => families.add(value));
                    if (old)
                        Object.assign(old, row);
                    this.index(old || row, true, changedDimensions, searchChanged);
                }
                touched.add(id);
                if (imageChanged)
                    this.dropImage(id);
            }
            this.manager.items = next;
            this.manager._byId = nextIndex;
            this.indexedItems = next;
            this.overlay = staged.overlay;
            this.generation++;
            this.lastInvalidation = { ids: [...touched], families: [...families], indices: [...touchedIndices] };
            return { modifiedIds: [...staged.rows.keys()], deleted: staged.deleted.size, imported, modified: staged.rows.size - imported, skipped: plan.skipped, generation: this.generation };
        }
        finally {
            this.writing = false;
        }
    }
    /** Only call for a real external/save migration; page navigation must never call this. */
    refreshFromManager(changedIds) {
        if (!changedIds) {
            if (this.indexedItems === this.manager.items && this.search.size === this.manager.items.length && this.manager.items.every(row => this.search.has(row.id)))
                return;
            this.buildIndices();
            return;
        }
        // Remove old postings by id because external callers may have mutated row references in place.
        for (const id of changedIds) {
            for (const index of this.indices.values())
                for (const [value, ids] of index) {
                    ids.delete(id);
                    if (!ids.size)
                        index.delete(value);
                }
            this.search.delete(id);
            const item = this.manager.getById(id);
            if (item)
                this.index(item, true);
            this.dropImage(id);
        }
        if (changedIds.length) {
            this.generation++;
            this.lastInvalidation = { ids: [...changedIds], families: [], indices: ['search', ...DIMENSIONS] };
        }
    }
    markStale(reason) { this.state = 'STALE'; this.diagnostic = reason; }
    dropImage(id) { this.images.get(id)?.close?.(); this.images.delete(id); this.imagePending.delete(id); }
    purgeVisualCaches() { this.imageWindow.clear(); for (const id of this.images.keys())
        this.dropImage(id); this.imagePending.clear(); }
    async visibleImages(ids) {
        this.imageWindow = new Set(ids.slice(0, 100));
        for (const id of this.images.keys())
            if (!this.imageWindow.has(id))
                this.dropImage(id);
        await Promise.all([...this.imageWindow].map(async (id) => {
            if (this.images.has(id))
                return;
            const item = this.manager.getById(id);
            if (!item)
                return;
            let pending = this.imagePending.get(id);
            if (!pending) {
                const decode = (this.options.decodeImage || decodeCatalogImage)(item);
                const publication = decode.then(decoded => {
                    // A purge or image edit invalidates even an unfinished decode. A shared
                    // Promise owns publication/release once, regardless of concurrent views.
                    if (this.imagePending.get(id) === publication && this.imageWindow.has(id))
                        this.images.set(id, decoded);
                    else
                        decoded.close?.();
                    return decoded;
                }).finally(() => { if (this.imagePending.get(id) === publication)
                    this.imagePending.delete(id); });
                pending = publication;
                this.imagePending.set(id, pending);
            }
            await pending;
        }));
    }
    diagnostics() {
        const key = `${this.generation}:${this.counters.indexBuilds}:${this.manager.items.length}`;
        if (!this.memorySnapshot || this.memorySnapshot.key !== key) {
            let metadataBytes = 0;
            for (const row of this.manager.items)
                for (const [key, value] of Object.entries(row)) {
                    metadataBytes += key.length * 2 + 16;
                    if (typeof value === 'string')
                        metadataBytes += value.length * 2;
                    else if (Array.isArray(value))
                        metadataBytes += value.length * 16;
                }
            let indexBytes = 0;
            for (const index of this.indices.values())
                for (const [value, ids] of index)
                    indexBytes += value.length * 2 + ids.size * 24;
            for (const value of this.search.values())
                indexBytes += value.length * 2 + 24;
            this.memorySnapshot = { key, metadataBytes, indexBytes, overlayBytes: JSON.stringify(this.overlay).length * 2 };
        }
        const { metadataBytes, indexBytes, overlayBytes } = this.memorySnapshot;
        let imageBytes = 0;
        for (const image of this.images.values())
            imageBytes += image.width * image.height * 4;
        const legacyBudgetBytes = 500 * 1024 * 1024;
        return { state: this.state, diagnostic: this.diagnostic, generation: this.generation, rows: this.manager.items.length, ...this.counters, decodedImages: this.images.size, metadataBytes, imageBytes, indexBytes, overlayBytes, legacyBudgetBytes, withinBudget: metadataBytes + indexBytes + imageBytes + overlayBytes < legacyBudgetBytes };
    }
    getOverlayMetadata() { return copyCatalogValue(this.overlay.metadata || {}); }
    getMigrationReport() {
        const value = this.overlay.metadata?.lengthMigrationReport;
        if (!value || typeof value !== 'object')
            return null;
        const report = value;
        const record = (row) => !!row && typeof row === 'object';
        const change = (row) => record(row) && typeof row.id === 'string' && (row.before === null || typeof row.before === 'number' && Number.isFinite(row.before)) && typeof row.after === 'number' && Number.isFinite(row.after);
        if (typeof report.formula !== 'string' || !Number.isSafeInteger(report.total) || Number(report.total) < 0 || !Array.isArray(report.changed) || !report.changed.every(change) || !Array.isArray(report.anomalies) || !report.anomalies.every(row => change(row) && record(row) && (row.ratio === null || typeof row.ratio === 'number')) || !Array.isArray(report.missing) || !report.missing.every(row => record(row) && typeof row.id === 'string' && typeof row.reason === 'string'))
            return null;
        const copy = copyCatalogValue(report);
        // JSON encodes an unbounded variation (no previous length) as null.
        for (const row of copy.anomalies)
            if (row.ratio === null)
                row.ratio = Infinity;
        return copy;
    }
    async recordMigrationReport(current) {
        const previous = this.getMigrationReport();
        const changed = new Map((previous?.changed || []).map(row => [row.id, row]));
        for (const row of current.changed) {
            const prior = changed.get(row.id);
            changed.set(row.id, { ...row, before: prior ? prior.before : row.before });
        }
        const anomalies = new Map((previous?.anomalies || []).map(row => [row.id, row]));
        for (const row of current.anomalies) {
            const prior = anomalies.get(row.id), before = prior ? prior.before : row.before;
            anomalies.set(row.id, { ...row, before, ratio: before && before > 0 ? Math.abs(row.after - before) / before : Infinity });
        }
        const report = { ...current, changed: [...changed.values()], anomalies: [...anomalies.values()] };
        let dirty = JSON.stringify(report) !== JSON.stringify(previous);
        const next = cloneBundle(this.overlay);
        next.metadata = { ...next.metadata, lengthMigrationReport: copyCatalogValue(report) };
        // Existing player overlay rows must retain their migrated image provenance too.
        // Otherwise an old saved overlay restores obsolete lengths on every HTML opening.
        for (const row of [...next.modifications, ...next.imports]) {
            const item = this.manager.getById(row.id);
            if (!item)
                continue;
            const fields = row;
            for (const key of ['length', 'imageNaturalWidth', 'lengthSource', 'lengthFormula', 'lengthMigrationVersion', 'imageFileName'])
                if (item[key] !== undefined && fields[key] !== item[key]) {
                    fields[key] = item[key];
                    dirty = true;
                }
        }
        if (!dirty && !this.migrationPersistenceDiagnostic)
            return;
        try {
            await (this.options.saveOverlay || saveExternalCatalogBundle)(next);
            this.migrationPersistenceDiagnostic = '';
        }
        catch (error) {
            // Native migration remains usable without persistent storage. Imports still use
            // commit(), whose write failure rejects before any catalogue publication.
            this.migrationPersistenceDiagnostic = ` Rapport de migration non mémorisé : ${error instanceof Error ? error.message : String(error)}`;
        }
        this.overlay = next;
        this.memorySnapshot = null;
    }
    isNative(id) { return this.nativeIds.has(id); }
    exportOverlay() { return cloneBundle(this.overlay); }
}
const STORES = new WeakMap();
export function getCatalogStore(manager, options) { let store = STORES.get(manager); if (!store) {
    store = new CatalogStore(manager, options);
    STORES.set(manager, store);
} return store; }
async function decodeCatalogImage(item) {
    if (typeof item.imageData !== 'string' || !item.imageData)
        return { width: 0, height: 0 };
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Image catalogue indisponible : ' + item.id)); image.src = String(item.imageData); });
    if (typeof image.decode === 'function')
        await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight, close: () => { image.src = ''; } };
}
/** JSON work is isolated when permitted; identical JSON.parse semantics on legacy Opera. */
export async function parseCatalogJSON(text, { worker = true } = {}) {
    if (!worker || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function')
        return JSON.parse(text);
    let url;
    let instance;
    try {
        url = URL.createObjectURL(new Blob(['onmessage=function(e){try{postMessage({ok:true,value:JSON.parse(e.data)})}catch(error){postMessage({ok:false,error:String(error)})}}'], { type: 'text/javascript' }));
        instance = new Worker(url);
        const current = instance;
        return await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Worker catalogue indisponible.')), 15000); current.onmessage = (event) => { clearTimeout(timer); const data = event.data; if (data.ok)
            resolve(data.value);
        else
            reject(new Error(data.error)); }; current.onerror = () => { clearTimeout(timer); reject(new Error('Worker catalogue indisponible.')); }; current.postMessage(text); });
    }
    catch {
        return JSON.parse(text);
    }
    finally {
        instance?.terminate();
        if (url)
            URL.revokeObjectURL(url);
    }
}
/** Technical view, text-only diagnostics and an actual cache purge action. */
export function renderCatalogDiagnostics(host, store) {
    host.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = 'Catalogue partagé — diagnostic mémoire';
    const summary = document.createElement('pre');
    const refresh = () => { const data = store.diagnostics(); const mib = (bytes) => (bytes / 1048576).toFixed(1) + ' Mio'; summary.textContent = [`${data.state} · génération ${data.generation} · ${data.rows} fiches`, `${data.nativeLoads} chargement natif · ${data.overlayApplications} overlay · ${data.indexBuilds} construction des index`, `Métadonnées estimées : ${mib(data.metadataBytes)} · index estimés : ${mib(data.indexBytes)}`, `Images décodées : ${data.decodedImages} (${mib(data.imageBytes)}, cache du service) · overlay : ${mib(data.overlayBytes)}`, `Budget de référence : ${mib(data.legacyBudgetBytes)} · estimation ${data.withinBudget ? 'dans le budget' : 'au-delà du budget'}`, `Estimation structurelle, hors moteur navigateur et reste du jeu.`, data.diagnostic].join('\n'); };
    const purge = document.createElement('button');
    purge.type = 'button';
    purge.textContent = 'Purger les caches visuels';
    purge.addEventListener('click', () => { store.purgeVisualCaches(); refresh(); });
    if (host.tagName === 'DETAILS') {
        const label = document.createElement('summary');
        label.textContent = 'Diagnostic technique du catalogue';
        host.append(label);
    }
    host.append(heading, summary, purge);
    refresh();
}
const IMAGE_WINDOWS = new Map();
/** Keep decoded DOM images when only a card's mileage/status/text changed. */
export function setCatalogImageHTML(host, html) {
    const key = (node) => JSON.stringify([node.dataset.catalogId, node.dataset.catalogRequest || node.dataset.catalogSrc || node.getAttribute('src') || '', node.className, node.getAttribute('style') || '', node.dataset.reMaterialId || '', node.dataset.reLiveryId || '']);
    const previous = new Map();
    for (const node of host.querySelectorAll('img[data-catalog-id]')) {
        const k = key(node);
        const list = previous.get(k) || [];
        list.push(node);
        previous.set(k, list);
    }
    host.innerHTML = html;
    for (const next of host.querySelectorAll('img[data-catalog-id]')) {
        const old = previous.get(key(next))?.shift();
        if (!old)
            continue;
        for (const attr of Array.from(next.attributes))
            if (!['src', 'data-catalog-src', 'data-re-fallback-index'].includes(attr.name))
                old.setAttribute(attr.name, attr.value);
        next.replaceWith(old);
    }
}
/** Disconnect observers and detach decoded DOM resources before hiding or replacing a view. */
export function releaseCatalogImageWindows(host, store) {
    for (const [root, window] of IMAGE_WINDOWS)
        if (root === host || host.contains(root)) {
            window.dispose(true);
            IMAGE_WINDOWS.delete(root);
        }
    for (const node of host.querySelectorAll('img[data-catalog-id]'))
        node.removeAttribute('src');
    store.purgeVisualCaches();
}
/** View window owns decoded images; the legacy fallback decodes only the current bounded page. */
export function bindCatalogImageWindow(host, store) {
    var _a;
    const nodes = Array.from(host.querySelectorAll('img[data-catalog-id]'));
    const page = host.closest?.('.page');
    const previous = IMAGE_WINDOWS.get(host);
    if (page && !page.classList.contains('active')) {
        previous?.dispose(true);
        IMAGE_WINDOWS.delete(host);
        for (const node of nodes)
            node.removeAttribute('src');
        return;
    }
    if (previous && previous.nodes.length === nodes.length && nodes.every((node, index) => node === previous.nodes[index]))
        return;
    previous?.dispose(false);
    IMAGE_WINDOWS.delete(host);
    const visible = new Set();
    let disposed = false;
    let observer;
    const sync = () => { if (!disposed)
        void store.visibleImages([...new Set([...visible].map(node => node.dataset.catalogId || ''))]).catch(() => { }); };
    IMAGE_WINDOWS.set(host, { nodes, dispose: (detach) => { disposed = true; observer?.disconnect(); visible.clear(); for (const node of nodes)
            if (detach || !host.contains(node))
                node.removeAttribute('src'); } });
    for (const node of nodes) {
        node.decoding = 'async';
        node.loading = 'lazy';
        if (!node.dataset.catalogSrc)
            node.dataset.catalogSrc = node.getAttribute('src') || '';
        (_a = node.dataset).catalogRequest || (_a.catalogRequest = node.dataset.catalogSrc);
    }
    const attach = (node) => { const src = node.dataset.catalogSrc || ''; if (src && node.getAttribute('src') !== src)
        node.src = src; };
    // A card refresh moves a retained image between DOM parents synchronously.
    // An already queued "outside" observation can describe that transient detach,
    // so confirm its current geometry before releasing a still-visible image.
    const currentlyVisible = (node) => {
        if (!node.isConnected || typeof node.getBoundingClientRect !== 'function')
            return false;
        const rect = node.getBoundingClientRect(), viewport = node.ownerDocument.documentElement;
        if (!(rect.width > 0 && rect.height > 0))
            return false;
        let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(viewport.clientWidth, rect.right), bottom = Math.min(viewport.clientHeight, rect.bottom);
        const view = node.ownerDocument.defaultView;
        if (typeof view?.getComputedStyle === 'function')
            for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                const style = view.getComputedStyle(parent);
                // Unusual clipping/rotation keeps the observer authoritative.
                if (style.clipPath && style.clipPath !== 'none' || style.transform && style.transform !== 'none')
                    return false;
                const clipX = style.overflowX && style.overflowX !== 'visible', clipY = style.overflowY && style.overflowY !== 'visible';
                if (clipX || clipY) {
                    const box = parent.getBoundingClientRect(), x = box.left + parent.clientLeft, y = box.top + parent.clientTop;
                    if (clipX) {
                        left = Math.max(left, x);
                        right = Math.min(right, x + parent.clientWidth);
                    }
                    if (clipY) {
                        top = Math.max(top, y);
                        bottom = Math.min(bottom, y + parent.clientHeight);
                    }
                }
            }
        return right > left && bottom > top;
    };
    if (typeof IntersectionObserver === 'undefined') {
        for (const node of nodes) {
            visible.add(node);
            attach(node);
        }
        sync();
        return;
    }
    observer = new IntersectionObserver(entries => {
        if (disposed)
            return;
        for (const entry of entries) {
            const node = entry.target;
            if (entry.isIntersecting || currentlyVisible(node)) {
                visible.add(node);
                attach(node);
            }
            else {
                visible.delete(node);
                if (node.naturalWidth > 0 && node.naturalHeight > 0) {
                    if (!node.hasAttribute('width'))
                        node.setAttribute('width', String(node.naturalWidth));
                    if (!node.hasAttribute('height'))
                        node.setAttribute('height', String(node.naturalHeight));
                }
                node.removeAttribute('src');
            }
        }
        sync();
    }, { rootMargin: '0px' });
    for (const node of nodes)
        observer.observe(node);
    sync();
}
