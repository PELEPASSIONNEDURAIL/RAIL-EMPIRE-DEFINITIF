export const LIVERY_MAX_SIDE = 8192;
export const LIVERY_MAX_PIXELS = 16777216;
export function assertImageSize(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > LIVERY_MAX_SIDE || height > LIVERY_MAX_SIDE || width * height > LIVERY_MAX_PIXELS)
        throw new Error('Image trop grande ou invalide : maximum 8192 px par côté et 16 mégapixels. Réduisez la taille ou le placement.');
}
export function isSafeLiverySource(src) {
    if (/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src))
        return true;
    try {
        const path = decodeURIComponent(src);
        return path.startsWith('img/') && !path.split('/').some(p => p === '..' || p === '.') && !/[\\?#%\x00-\x1f]/.test(path) && /\.(?:png|jpe?g|gif|webp)$/i.test(path);
    }
    catch {
        return false;
    }
}
function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Livrée : objet attendu.');
    return value;
}
function finite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`Livrée : ${label} invalide.`);
    return value;
}
function checkedImage(value) {
    const v = object(value);
    const width = finite(v.width, 'largeur'), height = finite(v.height, 'hauteur');
    assertImageSize(width, height);
    if (typeof v.src !== 'string' || !isSafeLiverySource(v.src))
        throw new Error('Livrée : source image non autorisée (images locales ou raster importé uniquement).');
    return { src: v.src, width, height };
}
function checkedPlacement(value) {
    const p = object(value), placement = { x: finite(p.x, 'X'), y: finite(p.y, 'Y'), scale: finite(p.scale, 'échelle') };
    if (placement.scale <= 0)
        throw new Error('Échelle invalide.');
    return placement;
}
function checkedLayer(value) {
    const v = object(value);
    return { image: checkedImage(v.image), placement: checkedPlacement(v.placement) };
}
export function compositeFrameLayers(base, cargoLayers) {
    assertImageSize(base.width, base.height);
    if (!cargoLayers.length)
        throw new Error('Ajoutez au moins une image de chargement.');
    let left = 0, top = 0, right = base.width, bottom = base.height;
    const scaled = cargoLayers.map((layer, index) => {
        assertImageSize(layer.image.width, layer.image.height);
        const x = finite(layer.placement.x, `X ${index + 1}`), y = finite(layer.placement.y, `Y ${index + 1}`), scale = finite(layer.placement.scale, `échelle ${index + 1}`);
        if (scale <= 0)
            throw new Error('L’échelle du chargement doit être positive.');
        const width = layer.image.width * scale, height = layer.image.height * scale;
        left = Math.min(left, x);
        top = Math.min(top, -height, y);
        right = Math.max(right, x + width);
        bottom = Math.max(bottom, y + height);
        return { x, y, width, height };
    });
    left = Math.floor(left);
    top = Math.floor(top);
    right = Math.ceil(right);
    bottom = Math.ceil(bottom);
    const width = right - left, height = bottom - top;
    assertImageSize(width, height);
    return { width, height, left, top, baseX: left === 0 ? 0 : -left, baseY: top === 0 ? 0 : -top, layers: scaled.map(layer => ({ x: layer.x - left, y: layer.y - top, width: layer.width, height: layer.height })) };
}
export function compositeFrame(base, cargo, placement) {
    const frame = compositeFrameLayers(base, [{ image: cargo, placement }]), first = frame.layers[0];
    return { ...frame, cargoX: first.x, cargoY: first.y, cargoWidth: first.width, cargoHeight: first.height };
}
export function defaultLiveryPlacement(base, cargo) {
    return { x: (base.width - cargo.width) / 2, y: -cargo.height, scale: 1 };
}
function checkDefinition(value) {
    const v = object(value);
    for (const key of ['id', 'catalogId', 'label', 'createdAt'])
        if (typeof v[key] !== 'string' || !String(v[key]).trim())
            throw new Error(`Livrée : ${key} manquant.`);
    if (v.kind !== 'wagon' && v.kind !== 'replacement')
        throw new Error('Type de livrée invalide.');
    const placement = checkedPlacement(v.placement);
    const base = v.base == null ? null : checkedImage(v.base), cargo = v.cargo == null ? null : checkedImage(v.cargo), image = checkedImage(v.image);
    const layers = Array.isArray(v.cargoLayers) && v.cargoLayers.length ? v.cargoLayers.map(checkedLayer) : (cargo ? [{ image: cargo, placement: { ...placement } }] : []);
    const canonicalCargo = layers[0]?.image || cargo || null, canonicalPlacement = layers[0]?.placement || placement;
    const anchorX = finite(v.anchorX, 'ancre X'), anchorY = finite(v.anchorY, 'ancre Y');
    if (v.kind === 'wagon') {
        if (!base || !layers.length)
            throw new Error('Le wagon et au moins un chargement sont requis.');
        const frame = compositeFrameLayers(base, layers);
        if (frame.width !== image.width || frame.height !== image.height || frame.baseX !== anchorX || frame.baseY !== anchorY)
            throw new Error('Les dimensions exportées ne correspondent pas à la composition.');
    }
    return { id: String(v.id), catalogId: String(v.catalogId), label: String(v.label).trim(), kind: v.kind, base, cargo: canonicalCargo, cargoLayers: layers, image, placement: { ...canonicalPlacement }, anchorX, anchorY, createdAt: String(v.createdAt) };
}
export class LiveryLibrary {
    constructor() {
        this.records = new Map();
        this.sequence = 0;
        this.byCatalog = new Map();
    }
    get size() { return this.records.size; }
    get(id) { return this.records.get(id); }
    all() { return Array.from(this.records.values()); }
    compatible(catalogId) { return this.byCatalog.get(String(catalogId)) || []; }
    reindex() { this.byCatalog.clear(); for (const r of this.records.values()) {
        const a = this.byCatalog.get(r.catalogId) || [];
        a.push(r);
        this.byCatalog.set(r.catalogId, a);
    } }
    newId() { let id; do {
        id = `livery-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    } while (this.records.has(id)); return id; }
    put(value) {
        const record = checkDefinition(value), old = this.records.get(record.id);
        if (old && old.catalogId !== record.catalogId)
            throw new Error('Une livrée existante ne peut pas changer de matériel de base.');
        this.records.set(record.id, record);
        this.reindex();
        return record;
    }
    remove(id) { this.records.delete(id); this.reindex(); }
    apply(target, original, strict = false) {
        const record = target.liveryId ? this.get(target.liveryId) : undefined;
        const catalogId = String(target.catalogId || target.stockId || '');
        if (target.liveryId && (!record || record.catalogId !== catalogId)) {
            if (strict)
                throw new Error(`Livrée absente ou incompatible : ${target.liveryId}`);
            target.liveryId = '';
        }
        if (record && record.catalogId === catalogId) {
            if (target.originalImageData === undefined)
                target.originalImageData = original ?? target.imageData ?? '';
            target.imageData = record.image.src;
        }
        else if (target.originalImageData !== undefined) {
            target.imageData = target.originalImageData;
        }
    }
    select(target, id, original) {
        const record = id ? this.get(id) : null;
        if (id && (!record || record.catalogId !== String(target.catalogId || target.stockId || '')))
            throw new Error('Cette livrée ne correspond pas à ce matériel.');
        if (target.originalImageData === undefined)
            target.originalImageData = original ?? target.imageData ?? '';
        target.liveryId = id;
        this.apply(target, original, true);
    }
    /** Asset strings are stored once in the library; vehicles only store liveryId.
     * No arbitrary cap on liveries, and no eviction/truncation of user creations. */
    toSave() {
        const assets = [], index = new Map();
        const ref = (image) => { if (!image)
            return null; const key = `${image.width}:${image.height}:${image.src}`; let i = index.get(key); if (i === undefined) {
            i = assets.length;
            assets.push({ ...image });
            index.set(key, i);
        } return i; };
        const liveries = this.all().map(r => ({ ...r, placement: { ...r.placement }, base: ref(r.base), cargo: ref(r.cargo), cargoLayers: r.cargoLayers.map(layer => ({ image: ref(layer.image), placement: { ...layer.placement } })), image: ref(r.image) }));
        return { schemaVersion: 1, assets, liveries };
    }
    loadFromSave(value) {
        if (value == null) {
            this.records.clear();
            this.byCatalog.clear();
            return;
        }
        const v = object(value);
        if (v.schemaVersion !== 1 || !Array.isArray(v.assets) || !Array.isArray(v.liveries))
            throw new Error('Livrées : format de sauvegarde incompatible.');
        const assets = v.assets.map(checkedImage), next = new Map();
        const resolve = (ref, optional = false) => { if (ref === null && optional)
            return null; if (typeof ref !== 'number' || !Number.isInteger(ref) || !assets[ref])
            throw new Error('Livrée : référence image invalide.'); return assets[ref]; };
        for (const raw of v.liveries) {
            const r = object(raw);
            const cargoLayers = Array.isArray(r.cargoLayers) ? r.cargoLayers.map(rawLayer => { const layer = object(rawLayer); const image = resolve(layer.image); if (!image)
                throw new Error('Livrée : couche de chargement invalide.'); return { image, placement: layer.placement }; }) : undefined;
            const record = checkDefinition({ ...r, base: resolve(r.base, true), cargo: resolve(r.cargo, true), cargoLayers, image: resolve(r.image) });
            if (next.has(record.id))
                throw new Error('Identifiant de livrée dupliqué.');
            next.set(record.id, record);
        }
        this.records = next;
        this.reindex();
    }
}
/** Catalog variants are alternate sprites for one real identity. They are not
 * records in the player's livery library. FullCatalog is loaded after saves,
 * so a temporarily unresolved variant keeps its saved image during hydration. */
export function applyOwnedLivery(target, library, lookup, strict = false, catalogReady = false) {
    const liveryId = String(target.liveryId || '');
    if (!liveryId.startsWith('catalog:')) {
        library.apply(target, undefined, strict);
        return;
    }
    const baseId = String(target.catalogId || target.stockId || '');
    const alternativeId = liveryId.slice('catalog:'.length);
    const base = baseId ? lookup(baseId) : null;
    const alternative = alternativeId ? lookup(alternativeId) : null;
    if (base && alternative) {
        const identity = String(base.realIdentityId || '').trim();
        if (baseId !== alternativeId && identity && identity === String(alternative.realIdentityId || '').trim()) {
            const image = typeof base.imageData === 'string' ? base.imageData : '';
            target.originalImageData = image;
            target.imageData = typeof alternative.imageData === 'string' && alternative.imageData ? alternative.imageData : image;
            return;
        }
    }
    else if (baseId && alternativeId && !catalogReady) {
        return;
    }
    if (strict)
        throw new Error(`Livrée absente ou incompatible : ${liveryId}`);
    target.liveryId = '';
    if (base && typeof base.imageData === 'string')
        target.originalImageData = base.imageData;
    if (target.originalImageData !== undefined)
        target.imageData = target.originalImageData;
}
export function saveLiveryTarget(element) {
    // Keep the original sprite as the explicit fallback. Custom raster belongs
    // to the library and must not be copied into every wagon in the save.
    return element.liveryId && !element.liveryId.startsWith('catalog:')
        ? { ...element, imageData: element.originalImageData || '' } : element;
}
/** Copy appearance only, never physical properties or catalogue identity. */
export function copyLiveryAppearance(target, source) {
    if (String(target.catalogId || target.stockId || '') !== String(source.catalogId || source.stockId || ''))
        return;
    for (const key of ['liveryId', 'imageData', 'originalImageData']) {
        if (source[key] === undefined)
            delete target[key];
        else
            target[key] = source[key];
    }
}
