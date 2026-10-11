import { readSeriesTar } from './catalog-series.js';
/** Retain rows needed by an owned vehicle, an assembled rame, or a selected
 * alternate catalog sprite. Deleting a variant still in use loses its image. */
export function protectedCatalogIds(rames, vehicles, inventory) {
    const ids = new Set();
    const protectVariant = (raw) => {
        if (typeof raw === 'string' && raw.startsWith('catalog:') && raw.length > 'catalog:'.length)
            ids.add(raw.slice('catalog:'.length));
    };
    for (const rame of rames) {
        for (const id of rame.elements || [])
            if (id)
                ids.add(String(id));
        for (const detail of rame.elementDetails || []) {
            if (detail.catalogId)
                ids.add(String(detail.catalogId));
            protectVariant(detail.liveryId);
        }
    }
    for (const vehicle of vehicles) {
        if (vehicle.catalogId)
            ids.add(String(vehicle.catalogId));
        protectVariant(vehicle.liveryId);
    }
    for (const owned of inventory) {
        if (owned.status === 'sold' || owned.status === 'withdrawn')
            continue;
        if (owned.materialId)
            ids.add(String(owned.materialId));
        protectVariant(owned.liveryId);
    }
    return ids;
}
const DB_NAME = 'rail-empire-external-catalog-v1';
const STORE = 'catalog';
const ACTIVE_KEY = 'active';
const MAX_ROWS = 100000;
const MAX_IMAGE_CHARS = 16 * 1024 * 1024;
// Keep a compressed archive from inflating without bound in 32-bit browsers.
// The companion editor uses the same uncompressed TAR limit.
const MAX_TAR_BYTES = 64 * 1024 * 1024;
const FALLBACK_KEY = DB_NAME + ':fallback';
function openDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible.'));
            return;
        }
        const req = indexedDB.open(DB_NAME, 1);
        let finished = false;
        const timer = setTimeout(() => { finished = true; reject(new Error('Base catalogue externe bloquée (10 secondes).')); }, 10000);
        const fail = (error) => { if (finished)
            return; finished = true; clearTimeout(timer); reject(error); };
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE))
            req.result.createObjectStore(STORE); };
        req.onsuccess = () => { if (finished) {
            req.result.close();
            return;
        } finished = true; clearTimeout(timer); resolve(req.result); };
        req.onerror = () => fail(req.error || new Error('Base catalogue externe indisponible.'));
        req.onblocked = () => fail(new Error('Base catalogue externe bloquée par une autre fenêtre.'));
    });
}
function readFallback() {
    if (typeof localStorage === 'undefined')
        return null;
    const text = localStorage.getItem(FALLBACK_KEY);
    return text === null ? null : validateExternalCatalogBundle(JSON.parse(text));
}
let storageRevision = 0;
function revision(bundle) { const value = Number(bundle?.metadata?.storageRevision); return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
export async function loadExternalCatalogBundle() {
    let fallback = null;
    try {
        fallback = readFallback();
    }
    catch (error) {
        if (typeof indexedDB === 'undefined')
            throw error;
    }
    if (typeof indexedDB === 'undefined') {
        storageRevision = Math.max(storageRevision, revision(fallback));
        return fallback;
    }
    let db;
    try {
        db = await openDB();
    }
    catch (error) {
        if (fallback) {
            storageRevision = Math.max(storageRevision, revision(fallback));
            return fallback;
        }
        throw error;
    }
    try {
        const primary = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(ACTIVE_KEY);
            req.onsuccess = () => { try {
                resolve(req.result == null ? null : validateExternalCatalogBundle(req.result));
            }
            catch (error) {
                reject(error);
            } };
            tx.onerror = () => reject(tx.error || new Error('Lecture du catalogue externe impossible.'));
            tx.onabort = () => reject(tx.error || new Error('Lecture du catalogue externe annulée.'));
        });
        const selected = fallback && (!primary || revision(fallback) > revision(primary)) ? fallback : primary;
        storageRevision = Math.max(storageRevision, revision(selected));
        return selected;
    }
    finally {
        db.close();
    }
}
export async function saveExternalCatalogBundle(bundle) {
    const clean = validateExternalCatalogBundle(bundle);
    const nextRevision = Math.max(Date.now(), storageRevision + 1);
    clean.metadata = { ...clean.metadata, storageRevision: nextRevision };
    try {
        const db = await openDB();
        try {
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(clean, ACTIVE_KEY);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('Écriture du catalogue externe impossible.'));
                tx.onabort = () => reject(tx.error || new Error('Écriture du catalogue externe annulée.'));
            });
        }
        finally {
            db.close();
        }
        storageRevision = nextRevision;
        // Cleanup is optional: revision selection prevents an undeletable old fallback from winning.
        try {
            if (typeof localStorage !== 'undefined')
                localStorage.removeItem(FALLBACK_KEY);
        }
        catch { }
    }
    catch (error) {
        if (typeof localStorage === 'undefined')
            throw new Error(`Catalogue non mémorisé : ${error instanceof Error ? error.message : String(error)}. Stockage persistant indisponible.`, { cause: error });
        try {
            const encoded = JSON.stringify(clean);
            localStorage.setItem(FALLBACK_KEY, encoded);
            if (localStorage.getItem(FALLBACK_KEY) !== encoded)
                throw new Error('Vérification de stockage échouée.');
            storageRevision = nextRevision;
        }
        catch (fallbackError) {
            throw new Error('Catalogue non mémorisé : quota ou stockage persistant indisponible.', { cause: fallbackError });
        }
    }
}
export async function clearExternalCatalogBundle() {
    // Empty overlay is a durable tombstone; deleting a fallback first could revive old imports.
    await saveExternalCatalogBundle({ format: 'rail-empire-catalog', version: 1, modifications: [], imports: [], deletions: [] });
}
function asEntry(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Fiche du catalogue invalide.');
    const raw = value;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || id.length > 180)
        throw new Error('Identifiant de fiche catalogue invalide.');
    for (const key of ['__proto__', 'prototype', 'constructor']) {
        if (Object.prototype.hasOwnProperty.call(raw, key))
            throw new Error(`Champ catalogue interdit : ${key}.`);
    }
    if (raw.name != null && (typeof raw.name !== 'string' || raw.name.length > 1000))
        throw new Error(`Nom de fiche catalogue invalide : ${id}.`);
    if (raw.category != null && (!['locomotive', 'automotrice', 'voiture', 'wagon'].includes(String(raw.category).toLowerCase())))
        throw new Error(`Catégorie catalogue invalide : ${id}.`);
    if (raw.imageData != null && (typeof raw.imageData !== 'string' || raw.imageData.length > MAX_IMAGE_CHARS))
        throw new Error(`Image catalogue invalide ou trop volumineuse : ${id}.`);
    for (const key of ['maxSpeed', 'mass', 'tonnage', 'length', 'power', 'passengerCapacity', 'freightCapacity', 'purchasePrice', 'axleLoad', 'metreLoad', 'brakeServiceMs2']) {
        if (raw[key] == null || raw[key] === '')
            continue;
        if ((typeof raw[key] !== 'number' && typeof raw[key] !== 'string') || !Number.isFinite(Number(raw[key])))
            throw new Error(`Valeur ${key} invalide dans la fiche ${id}.`);
    }
    for (const key of ['cargoTypes', 'technicallyCompatibleCargoTypes']) {
        if (raw[key] == null)
            continue;
        if (!Array.isArray(raw[key]) || raw[key].length > 4096 || !raw[key].every(x => typeof x === 'string' && x.length <= 180))
            throw new Error(`Chargements invalides dans la fiche ${id}.`);
    }
    // Keep the parsed row itself when possible: 36k records must not be cloned
    // several times just to validate an editor JSON on a 32-bit browser.
    return (raw.id === id ? raw : { ...raw, id });
}
export function validateExternalCatalogBundle(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Catalogue externe invalide.');
    const raw = value;
    if (raw.format !== 'rail-empire-catalog' || raw.version !== 1 ||
        !Array.isArray(raw.modifications) || !Array.isArray(raw.imports) || !Array.isArray(raw.deletions))
        throw new Error('Format ou version du catalogue externe invalide.');
    if (raw.modifications.length + raw.imports.length > MAX_ROWS || raw.deletions.length > MAX_ROWS)
        throw new Error('Catalogue externe trop volumineux.');
    const modifications = raw.modifications.map(asEntry);
    const imports = raw.imports.map(asEntry);
    const deletions = raw.deletions.map(x => {
        if (typeof x !== 'string' || !x.trim() || x.trim().length > 180)
            throw new Error('Identifiant de suppression invalide.');
        return x.trim();
    });
    const modifiedIds = new Set();
    for (const row of modifications) {
        if (modifiedIds.has(row.id))
            throw new Error(`Doublon dans les modifications : ${row.id}.`);
        modifiedIds.add(row.id);
    }
    const deletedIds = new Set();
    for (const id of deletions) {
        if (deletedIds.has(id))
            throw new Error(`Doublon dans les suppressions : ${id}.`);
        deletedIds.add(id);
    }
    const importedIds = new Set();
    for (const row of imports) {
        if (modifiedIds.has(row.id) || deletedIds.has(row.id) || importedIds.has(row.id))
            throw new Error(`Conflit d'identifiant catalogue : ${row.id}.`);
        importedIds.add(row.id);
    }
    // A deleted fiche can also be modified when it belongs to a physical fleet.
    // In that case deletion is skipped, while its technical update still applies.
    return {
        format: 'rail-empire-catalog', version: 1,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
        catalogBase: typeof raw.catalogBase === 'string' ? raw.catalogBase : undefined,
        modifications, deletions, imports,
        metadata: raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata : undefined,
    };
}
function parseLegacyArray(value) {
    if (!Array.isArray(value))
        return null;
    if (!value.length || value.length > MAX_ROWS)
        throw new Error('Catalogue historique vide ou trop volumineux.');
    const entries = value.map(asEntry);
    if (new Set(entries.map(x => x.id)).size !== entries.length)
        throw new Error('Doublon dans le catalogue historique.');
    return { format: 'rail-empire-catalog', version: 1, modifications: entries, deletions: [], imports: [] };
}
// RC29 archives used descriptive filenames; the current editor generates
// image-000001.png. Accept both safe flat names, never traversal or subfolders.
const TAR_ASSET = /^assets\/[^/\\\x00-\x1f\x7f]{1,1000}\.(?:png|gif|jpe?g|webp|bmp)$/iu;
const MAX_TAR_IMAGE_BYTES = 5 * 1024 * 1024;
function tarText(bytes, start, length) {
    let out = '';
    for (let i = start; i < start + length && bytes[i]; i++) {
        if (bytes[i] < 32 || bytes[i] > 127)
            throw new Error('En-tête TAR corrompu.');
        out += String.fromCharCode(bytes[i]);
    }
    return out;
}
function tarOctal(bytes, start, length) {
    const digits = tarText(bytes, start, length).trim();
    if (!/^[0-7]+$/.test(digits))
        throw new Error('Taille ou checksum TAR invalide.');
    return parseInt(digits, 8);
}
function parseTar(bytes) {
    const files = readSeriesTar(bytes);
    for (const [name, data] of files) {
        if (name !== 'catalog.json' && !TAR_ASSET.test(name))
            throw new Error(`Chemin TAR non autorisé : ${name}`);
        if (name.startsWith('assets/') && data.byteLength > MAX_TAR_IMAGE_BYTES)
            throw new Error('Image TAR trop volumineuse (5 Mio maximum).');
    }
    return files;
}
async function gunzipFile(file) {
    if (typeof DecompressionStream === 'undefined')
        throw new Error('Ce navigateur ne sait pas ouvrir TAR.GZ. Utilise l’export JSON sur cette machine.');
    if (file.size > MAX_TAR_BYTES)
        throw new Error('Archive TAR.GZ trop volumineuse (64 Mio maximum). Utilise le JSON.');
    const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > MAX_TAR_BYTES) {
                await reader.cancel();
                throw new Error('Archive TAR.GZ décompressée trop volumineuse (64 Mio maximum). Utilise le JSON.');
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const tar = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        tar.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return tar;
}
function mimeFromPath(path) {
    const lower = path.toLowerCase();
    if (lower.endsWith('.png'))
        return 'image/png';
    if (lower.endsWith('.gif'))
        return 'image/gif';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))
        return 'image/jpeg';
    if (lower.endsWith('.webp'))
        return 'image/webp';
    if (lower.endsWith('.bmp'))
        return 'image/bmp';
    return 'application/octet-stream';
}
function bytesToDataUrl(bytes, mime) {
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK)
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + CHUNK)));
    return `data:${mime};base64,${btoa(binary)}`;
}
async function hydrateTarAssets(bundle, files) {
    const hydrated = new Map();
    const hydrate = (entry) => {
        const src = typeof entry.imageData === 'string' ? entry.imageData : '';
        if (src.startsWith('assets/')) {
            if (!TAR_ASSET.test(src))
                throw new Error(`Chemin image TAR non autorisé : ${src}`);
            const asset = files.get(src);
            if (!asset)
                throw new Error(`Image absente de l’archive : ${src}`);
            let dataUrl = hydrated.get(src);
            if (!dataUrl) {
                dataUrl = bytesToDataUrl(asset, mimeFromPath(src));
                hydrated.set(src, dataUrl);
            }
            return { ...entry, imageData: dataUrl };
        }
        return entry;
    };
    const restored = {
        ...bundle,
        modifications: bundle.modifications.map(hydrate),
        imports: bundle.imports.map(hydrate),
    };
    for (const name of files.keys())
        if (name !== 'catalog.json' && !hydrated.has(name))
            throw new Error(`Image TAR non référencée : ${name}`);
    return restored;
}
export async function parseExternalCatalogFile(file, parseJSON = async (text) => JSON.parse(text)) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
        const tar = parseTar(await gunzipFile(file));
        const manifestBytes = tar.get('catalog.json');
        if (!manifestBytes)
            throw new Error('catalog.json absent du TAR.GZ.');
        const parsed = await parseJSON(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
        const bundle = validateExternalCatalogBundle(parsed);
        return hydrateTarAssets(bundle, tar);
    }
    if (file.size > MAX_TAR_BYTES)
        throw new Error('JSON catalogue trop volumineux (64 Mio maximum).');
    const parsed = await parseJSON(await file.text());
    const bundle = Array.isArray(parsed) ? parseLegacyArray(parsed) : validateExternalCatalogBundle(parsed);
    if (!bundle)
        throw new Error('JSON catalogue incompatible.');
    return bundle;
}
export function applyExternalCatalogBundle(manager, bundle, protectedMaterialIds = new Set()) {
    // Validate every row before touching a single native fiche. A damaged stored
    // overlay must never apply a few deletions before a later bad record is found.
    const clean = validateExternalCatalogBundle(bundle);
    for (const imp of clean.imports) {
        if (manager.getById(imp.id))
            throw new Error(`Identifiant importé en conflit avec une fiche existante : ${imp.id}.`);
    }
    const result = { modified: 0, modifiedIds: [], deleted: 0, imported: 0, skipped: 0 };
    // References, not deep clones: the 36k base catalog stays in place. Only
    // modified records need field snapshots; the shallow order snapshot restores
    // their exact identities and placement if a later model operation throws.
    const originalOrder = manager.items.slice();
    const modified = new Map();
    try {
        for (const id of clean.deletions) {
            // An editor may remove a catalogue row, but existing physical vehicles and
            // rames still need their type for rendering, assignment and save restoration.
            if (protectedMaterialIds.has(id)) {
                result.skipped++;
                continue;
            }
            if (manager.getById(id) && manager.remove(id))
                result.deleted++;
            else
                result.skipped++;
        }
        for (const mod of clean.modifications) {
            const item = manager.getById(mod.id);
            if (!item) {
                result.skipped++;
                continue;
            }
            // A player edit made after importing the external catalogue wins over the
            // catalogue overlay, matching the historical admin-catalogue behaviour.
            if (item._catalog && item._edited) {
                result.skipped++;
                continue;
            }
            modified.set(item, { ...item });
            if (manager.update(mod.id, mod, { markEdited: false })) {
                result.modified++;
                result.modifiedIds.push(String(mod.id));
            }
            else
                result.skipped++;
        }
        for (const imp of clean.imports) {
            if (manager.add({ ...imp, _catalog: true, _source: imp._source || 'Catalogue externe' }))
                result.imported++;
            else
                result.skipped++;
        }
        return result;
    }
    catch (error) {
        for (const [item, fields] of modified)
            Object.assign(item, fields);
        manager.items = originalOrder;
        manager._byId = new Map(originalOrder.map(item => [item.id, item]));
        throw error;
    }
}
