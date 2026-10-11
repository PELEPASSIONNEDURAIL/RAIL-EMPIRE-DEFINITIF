import { RollingStockItem } from './rolling-stock.js';
export const SERIES_LENGTH_FORMULA = 'longueur_m = naturalWidth_px × 0,10';
const MAX_BYTES = 64 * 1024 * 1024;
const IMMUTABLE = new Set(['id', 'name', 'seriesName', 'length', 'imageData', 'imageNaturalWidth', 'imageFileName', 'imageHash', 'lengthSource', 'lengthFormula', 'lengthMigrationVersion', '__proto__', 'constructor', 'prototype']);
export function imageStem(filename) { const base = filename.replace(/\\/g, '/').split('/').pop() || ''; const dot = base.lastIndexOf('.'); return dot > 0 ? base.slice(0, dot) : base; }
export function naturalFileCompare(a, b) {
    const aa = a.match(/\d+|\D+/g) || [], bb = b.match(/\d+|\D+/g) || [];
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
        const x = aa[i], y = bb[i];
        let diff = 0;
        if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
            const xx = x.replace(/^0+/, '') || '0', yy = y.replace(/^0+/, '') || '0';
            diff = xx.length - yy.length || (xx < yy ? -1 : xx > yy ? 1 : 0);
        }
        else {
            const xx = x.toLocaleLowerCase('fr'), yy = y.toLocaleLowerCase('fr');
            diff = xx < yy ? -1 : xx > yy ? 1 : 0;
        }
        if (diff)
            return diff;
    }
    return aa.length - bb.length || (a < b ? -1 : a > b ? 1 : 0);
}
export function imageLength(width) { if (!Number.isSafeInteger(width) || width <= 0)
    throw Error('Largeur intrinsèque image invalide.'); return width / 10; }
/** Portable SHA-256: file:// and old browsers do not necessarily expose WebCrypto. */
export function sha256Bytes(bytes) {
    const constants = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const size = Math.ceil((bytes.length + 9) / 64) * 64, padded = new Uint8Array(size);
    padded.set(bytes);
    padded[bytes.length] = 128;
    const view = new DataView(padded.buffer);
    view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(size - 4, (bytes.length * 8) >>> 0);
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Uint32Array(64);
    const rotr = (v, n) => (v >>> n) | (v << (32 - n));
    for (let off = 0; off < size; off += 64) {
        for (let i = 0; i < 16; i++)
            w[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15], y = w[i - 2];
            w[i] = w[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10));
        }
        let [a, b, c, d, e, f, g, k] = h;
        for (let i = 0; i < 64; i++) {
            const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + w[i]) >>> 0, t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            k = g;
            g = f;
            f = e;
            e = (d + t1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) >>> 0;
        }
        const state = [a, b, c, d, e, f, g, k];
        for (let i = 0; i < 8; i++)
            h[i] = (h[i] + state[i]) >>> 0;
    }
    return h.map(x => x.toString(16).padStart(8, '0')).join('');
}
function stableId(series, name) { return 'series-' + sha256Bytes(new TextEncoder().encode(series + '\0' + name)).slice(0, 40); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function bundle() { return { format: 'rail-empire-catalog', version: 1, imports: [], modifications: [], deletions: [], metadata: { lengthFormula: SERIES_LENGTH_FORMULA } }; }
function canonicalEntry(entry) { const item = new RollingStockItem(entry); return { ...entry, ...item, imageData: typeof item.imageData === 'string' ? item.imageData : undefined, _source: typeof item._source === 'string' ? item._source : undefined }; }
function imageEntry(image) { return { imageData: image.imageData, imageNaturalWidth: image.naturalWidth, imageFileName: image.name.replace(/\\/g, '/').split('/').pop(), imageHash: image.hash, length: imageLength(image.naturalWidth), lengthSource: 'image-width', lengthFormula: SERIES_LENGTH_FORMULA, lengthMigrationVersion: 1 }; }
function safePatch(patch) { for (const key of Object.keys(patch))
    if (IMMUTABLE.has(key))
        throw Error(`${key} est défini par l'image et ne peut pas être saisi.`); }
export class CatalogSeriesManager {
    constructor(port) {
        this.port = port;
        this.rows = [];
        this.common = {};
        this.series = '';
        this.source = 'Sélection d’images';
        this.sequence = 0;
        this.busy = false;
        this.journal = [];
    }
    recoverJournal() {
        if (this.busy)
            return;
        const raw = this.port.readJournal?.();
        if (raw == null)
            return;
        if (!Array.isArray(raw) || raw.length > 100000)
            throw Error('Journal catalogue persistant invalide.');
        let sequence = this.sequence;
        const ids = new Set();
        for (const value of raw) {
            if (!value || typeof value !== 'object' || Array.isArray(value))
                throw Error('Transaction persistante invalide.');
            const tx = value;
            const match = typeof tx.id === 'string' ? /^series-tx-(\d+)$/.exec(tx.id) : null;
            if (!match || ids.has(String(tx.id)) || !Array.isArray(tx.entries) || !tx.inverse || !['committed', 'rolled-back'].includes(String(tx.status)))
                throw Error('Transaction persistante invalide.');
            const n = Number(match[1]);
            if (!Number.isSafeInteger(n) || n <= 0)
                throw Error('Identifiant transaction persistant invalide.');
            ids.add(String(tx.id));
            sequence = Math.max(sequence, n);
        }
        this.journal = clone(raw);
        this.sequence = sequence;
    }
    getPreview() { return this.rows; }
    getDraftModel() { return { series: this.series, source: this.source, common: clone(this.common) }; }
    previewWindow(offset = 0, limit = 60, invalidOnly = false) { const all = invalidOnly ? this.rows.filter(x => x.errors.length) : this.rows; return all.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(100, Math.max(0, limit))); }
    preview(series, images, common, source = 'Sélection d’images') {
        this.recoverJournal();
        if (this.busy)
            throw Error('Une transaction est en cours.');
        if (!series.trim())
            throw Error('La série doit avoir un nom.');
        if (images.length > 100000)
            throw Error('100 000 images maximum.');
        safePatch(common);
        this.series = series;
        this.source = source;
        this.common = clone(common);
        this.rows = [...images].sort((a, b) => naturalFileCompare(a.name, b.name)).map(image => ({ entry: { ...clone(common), ...imageEntry(image), id: stableId(series, imageStem(image.name)), name: imageStem(image.name), seriesName: series, _source: 'Import série RC44' }, selected: true, overrides: {}, errors: [], warnings: [] }));
        this.validate();
        return this.rows;
    }
    async ingest(series, files, common, decode, onProgress, signal, source = 'Sélection d’images') {
        const images = [];
        let totalChars = 0;
        for (const file of [...files].sort((a, b) => naturalFileCompare(a.name, b.name))) {
            if (signal?.aborted)
                throw Error('Import annulé avant écriture.');
            let image;
            try {
                image = await decode(file);
                totalChars += image.imageData.length;
                if (totalChars > MAX_BYTES)
                    throw Error('Images trop volumineuses pour le budget mémoire; fractionnez la série.');
                images.push({ name: image.name, naturalWidth: image.naturalWidth, imageData: image.imageData, hash: image.hash });
            }
            finally {
                image?.release?.();
            }
            onProgress?.(images.length, files.length);
            if (images.length % 16 === 0)
                await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (signal?.aborted)
            throw Error('Import annulé avant écriture.');
        this.preview(series, images, common, source);
    }
    validate() {
        const existing = new Map(this.port.entries().map(x => [x.id, x]));
        const names = new Map(), ids = new Map(), hashes = new Map();
        for (const row of this.rows) {
            row.errors = [];
            row.warnings = [];
            const name = String(row.entry.name ?? '');
            const group = names.get(name) || [];
            group.push(row);
            names.set(name, group);
            const idGroup = ids.get(row.entry.id) || [];
            idGroup.push(row);
            ids.set(row.entry.id, idGroup);
            if (!name)
                row.errors.push('Nom de fichier vide.');
            if (!row.entry.id || row.entry.id.length > 180 || row.entry.id !== row.entry.id.trim())
                row.errors.push('Identifiant invalide (1–180 caractères).');
            if (existing.has(row.entry.id) && row.mergeId !== row.entry.id)
                row.errors.push('Collision ID existant : fusionner explicitement ou choisir un ID libre.');
            if (row.mergeId && !existing.has(row.mergeId))
                row.errors.push('Fiche de fusion introuvable.');
            const hash = String(row.entry.imageHash || '');
            if (hash && hashes.has(hash))
                row.warnings.push(`Image strictement identique à ${hashes.get(hash)} (SHA-256).`);
            else if (hash)
                hashes.set(hash, name);
            if (!Number.isSafeInteger(row.entry.imageNaturalWidth) || Number(row.entry.imageNaturalWidth) <= 0)
                row.errors.push('Largeur intrinsèque image invalide.');
            if (row.entry.category && !['locomotive', 'automotrice', 'voiture', 'wagon'].includes(String(row.entry.category)))
                row.errors.push('Catégorie invalide.');
            for (const field of ['maxSpeed', 'mass', 'power', 'passengerCapacity', 'freightCapacity', 'purchasePrice'])
                if (row.entry[field] !== undefined && (!Number.isFinite(row.entry[field]) || Number(row.entry[field]) < 0))
                    row.errors.push(`${field} doit être un nombre positif ou nul.`);
        }
        for (const group of names.values())
            if (group.filter(x => x.selected).length > 1)
                for (const row of group)
                    if (row.selected && !row.duplicateNameConfirmed)
                        row.errors.push('Nom en doublon dans la série : confirmation explicite requise.');
        for (const group of ids.values())
            if (group.filter(x => x.selected).length > 1)
                for (const row of group)
                    if (row.selected)
                        row.errors.push('Collision ID entre images : résolution explicite requise.');
    }
    assertIdle() { if (this.busy)
        throw Error('Une transaction est en cours.'); }
    row(index) { this.assertIdle(); const row = this.rows[index]; if (!row)
        throw Error('Ligne introuvable.'); return row; }
    setSelected(index, selected) { this.row(index).selected = selected; }
    selectAll(selected) { this.assertIdle(); for (const row of this.rows)
        row.selected = selected; }
    setOverride(index, field, value) { safePatch({ [field]: value }); const row = this.row(index); row.overrides[field] = clone(value); row.entry[field] = clone(value); this.validate(); }
    applyCommon(patch) { this.assertIdle(); safePatch(patch); Object.assign(this.common, clone(patch)); for (const row of this.rows)
        for (const [key, value] of Object.entries(patch))
            if (!Object.prototype.hasOwnProperty.call(row.overrides, key))
                row.entry[key] = clone(value); this.validate(); }
    editSelected(field, value) { this.assertIdle(); safePatch({ [field]: value }); for (const row of this.rows)
        if (row.selected) {
            row.overrides[field] = clone(value);
            row.entry[field] = clone(value);
        } this.validate(); }
    resolveCollision(index, id) { const row = this.row(index); row.entry.id = id; row.explicitId = true; delete row.mergeId; this.validate(); }
    confirmDuplicateName(index) { this.row(index).duplicateNameConfirmed = true; this.validate(); }
    mergeWith(index, id) { const row = this.row(index); row.entry.id = id; row.mergeId = id; this.validate(); }
    previewReplacement(id, image) {
        this.assertIdle();
        const old = this.port.entries().find(x => x.id === id);
        if (!old)
            throw Error('Fiche à remplacer introuvable.');
        this.series = old.seriesName || 'Sans série';
        this.source = `Remplacement image ${id}`;
        this.common = {};
        this.rows = [{ entry: { ...clone(old), ...imageEntry(image) }, selected: true, overrides: {}, errors: [], warnings: [], mergeId: id }];
        this.validate();
        return { before: Number(old.length || 0), after: imageLength(image.naturalWidth), message: 'Vérifier les longueurs de rames, quais, voies et gabarits avant application.' };
    }
    previewFamily(series, patch) {
        this.assertIdle();
        safePatch(patch);
        this.series = series;
        this.source = `Propagation explicite à la famille ${series}`;
        this.common = {};
        this.rows = this.port.entries().filter(x => x.seriesName === series).map(entry => ({ entry: { ...clone(entry), ...clone(patch) }, selected: true, overrides: clone(patch), errors: [], warnings: [], mergeId: entry.id }));
        this.validate();
        return this.rows;
    }
    buildBundle() {
        this.validate();
        const selected = this.rows.filter(x => x.selected);
        if (!selected.length)
            throw Error('Aucune fiche sélectionnée.');
        if (selected.some(x => x.errors.length))
            throw Error('Prévisualisation invalide : résoudre les erreurs avant écriture.');
        const result = bundle();
        for (const row of selected)
            (row.mergeId ? result.modifications : result.imports).push(clone(canonicalEntry(row.entry)));
        result.createdAt = new Date().toISOString();
        result.metadata = { ...result.metadata, series: this.series, source: this.source };
        return result;
    }
    async commit() {
        this.recoverJournal();
        if (this.busy)
            throw Error('Une transaction est en cours.');
        const forward = this.buildBundle(), existing = new Map(this.port.entries().map(x => [x.id, x]));
        const inverse = bundle();
        inverse.deletions = forward.imports.map(x => x.id);
        inverse.modifications = forward.modifications.map(x => clone(existing.get(x.id)));
        const entry = { id: `series-tx-${this.sequence + 1}`, at: new Date().toISOString(), source: this.source, count: forward.imports.length + forward.modifications.length, warnings: this.rows.filter(x => x.selected).flatMap(x => x.warnings), collisions: this.rows.filter(x => x.selected && (x.explicitId || x.mergeId || x.duplicateNameConfirmed)).map(x => `${x.entry.name} → ${x.entry.id}`), formula: SERIES_LENGTH_FORMULA, status: 'committed', inverse, entries: [...forward.imports, ...forward.modifications] };
        forward.metadata = { ...forward.metadata, seriesJournal: clone([...this.journal, entry]) };
        this.busy = true;
        try {
            await this.port.applyBundle(forward);
            this.sequence++;
            this.journal.push(entry);
            this.rows = [];
            return clone(entry);
        }
        finally {
            this.busy = false;
        }
    }
    async rollback(id) {
        this.recoverJournal();
        if (this.busy)
            throw Error('Une transaction est en cours.');
        const tx = this.journal.find(x => x.id === id);
        if (!tx)
            throw Error('Transaction introuvable.');
        if (tx.status === 'rolled-back')
            throw Error('Cette transaction est déjà annulée.');
        const current = new Map(this.port.entries().map(x => [x.id, x]));
        for (const entry of tx.entries) {
            const now = current.get(entry.id);
            if (!now || Object.entries(entry).some(([key, value]) => !key.startsWith('_') && JSON.stringify(now[key]) !== JSON.stringify(value)))
                throw Error('Fiche modifiée depuis cet import : annuler d’abord les transactions plus récentes.');
        }
        const inverse = clone(tx.inverse);
        inverse.metadata = { ...inverse.metadata, seriesJournal: clone(this.journal.map(item => item.id === id ? { ...item, status: 'rolled-back' } : item)) };
        this.port.validateRollback?.(inverse);
        this.busy = true;
        try {
            await this.port.applyBundle(inverse);
            tx.status = 'rolled-back';
        }
        finally {
            this.busy = false;
        }
    }
    exportJSON() {
        this.recoverJournal();
        const result = bundle(), records = new Map(), createdIds = new Set(this.journal.flatMap(tx => tx.inverse.deletions));
        for (const tx of this.journal)
            if (tx.status === 'committed')
                for (const row of tx.entries)
                    records.set(row.id, row);
        for (const row of records.values())
            (createdIds.has(row.id) ? result.imports : result.modifications).push(clone(row));
        result.createdAt = new Date().toISOString();
        return result;
    }
    toSave() { return clone({ version: 1, sequence: this.sequence, series: this.series, source: this.source, common: this.common, rows: this.rows, journal: this.journal }); }
    loadFromSave(value) {
        this.assertIdle();
        if (value == null) {
            this.rows = [];
            this.common = {};
            this.series = '';
            this.source = 'Sélection d’images';
            this.sequence = 0;
            this.journal = [];
            return;
        }
        if (typeof value !== 'object' || Array.isArray(value))
            throw Error('Sauvegarde séries invalide.');
        const raw = value;
        if (raw.version !== 1 || !Array.isArray(raw.journal) || !Array.isArray(raw.rows) || raw.rows.length > 100000 || !Number.isSafeInteger(raw.sequence) || Number(raw.sequence) < 0)
            throw Error('Sauvegarde séries incompatible.');
        const journals = raw.journal;
        for (const item of journals) {
            if (!item || typeof item !== 'object')
                throw Error('Journal séries invalide.');
            const tx = item;
            if (typeof tx.id !== 'string' || !Array.isArray(tx.entries) || !tx.inverse || !['committed', 'rolled-back'].includes(String(tx.status)))
                throw Error('Transaction sauvegardée invalide.');
        }
        this.sequence = Number(raw.sequence);
        this.series = String(raw.series || '');
        this.source = String(raw.source || '');
        this.common = raw.common && typeof raw.common === 'object' ? clone(raw.common) : {};
        this.rows = clone(raw.rows);
        this.journal = clone(journals);
        this.validate();
    }
}
/** Read intrinsic container metadata for old imported images without retaining decoded bitmaps. */
export function inlineImageNaturalWidth(source) {
    try {
        const bytes = dataURLBytes(source), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
            return view.getUint32(16);
        if (bytes.length >= 10 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70)
            return view.getUint16(6, true);
        if (bytes.length >= 26 && bytes[0] === 66 && bytes[1] === 77) {
            const header = view.getUint32(14, true);
            return header === 12 ? view.getUint16(18, true) : Math.abs(view.getInt32(18, true));
        }
        if (bytes.length >= 30 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) {
            const type = String.fromCharCode(...bytes.subarray(12, 16));
            if (type === 'VP8X')
                return 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
            if (type === 'VP8L' && bytes[20] === 47)
                return 1 + ((bytes[21] | (bytes[22] << 8)) & 16383);
            if (type === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42)
                return view.getUint16(26, true) & 16383;
        }
        if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
            let offset = 2;
            while (offset + 4 <= bytes.length) {
                while (bytes[offset] === 255)
                    offset++;
                const marker = bytes[offset++];
                if (marker === 217 || marker === 218)
                    break;
                if (marker === 0 || marker === 1 || marker >= 208 && marker <= 215)
                    continue;
                const size = view.getUint16(offset);
                if (size < 2 || offset + size > bytes.length)
                    return null;
                if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker))
                    return size >= 7 ? view.getUint16(offset + 5) : null;
                offset += size;
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
export function migrateCatalogImageLengths(entries, widths, threshold = 0.2) {
    const report = { formula: SERIES_LENGTH_FORMULA, total: entries.length, changed: [], anomalies: [], missing: [] };
    for (const entry of entries) {
        const src = typeof entry.imageData === 'string' ? entry.imageData : '';
        const indexed = widths[src];
        const width = src.startsWith('data:') ? Number(inlineImageNaturalWidth(src) ?? entry.imageNaturalWidth) : Number(indexed ?? entry.imageNaturalWidth);
        if (!src || !Number.isSafeInteger(width) || width <= 0) {
            entry.lengthSource = src ? 'missing-image-metadata' : 'not-calculable';
            report.missing.push({ id: entry.id, reason: src ? 'Métadonnée image absente : décoder le fichier avant migration.' : 'Sans image : longueur non calculable.' });
            continue;
        }
        const before = Number.isFinite(entry.length) ? Number(entry.length) : null, after = imageLength(width);
        entry.imageNaturalWidth = width;
        entry.lengthSource = 'image-width';
        entry.lengthFormula = SERIES_LENGTH_FORMULA;
        entry.lengthMigrationVersion = 1;
        if (!entry.imageFileName)
            entry.imageFileName = src.startsWith('data:') ? `${entry.name || entry.id}.png` : src.split('/').pop();
        if (before !== after) {
            report.changed.push({ id: entry.id, before, after });
            const ratio = before && before > 0 ? Math.abs(after - before) / before : Infinity;
            if (ratio > threshold)
                report.anomalies.push({ id: entry.id, before, after, ratio });
            entry.length = after;
        }
    }
    return report;
}
export function bytesToDataURL(bytes, mime) { let binary = ''; for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return `data:${mime};base64,${btoa(binary)}`; }
function dataURLBytes(value) { const match = /^data:([^;,]+);base64,(.*)$/s.exec(value); if (!match)
    throw Error('Image exportable inline manquante.'); const binary = atob(match[2]); return Uint8Array.from(binary, x => x.charCodeAt(0)); }
export async function decodeSeriesFile(file) {
    if (file.size > 5 * 1024 * 1024)
        throw Error(`Image trop volumineuse : ${file.name} (5 Mio maximum).`);
    const bytes = new Uint8Array(await file.arrayBuffer()), url = URL.createObjectURL(file), img = new Image();
    try {
        await new Promise((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(Error(`Image illisible : ${file.name}`)); img.src = url; });
        const width = img.naturalWidth;
        imageLength(width);
        return { name: file.name, naturalWidth: width, imageData: bytesToDataURL(bytes, file.type || mimeForFilename(file.name)), hash: sha256Bytes(bytes) };
    }
    finally {
        img.src = '';
        URL.revokeObjectURL(url);
    }
}
export function mimeForFilename(name) { const ext = name.toLowerCase().split('.').pop(); return { png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp' }[ext || ''] || 'application/octet-stream'; }
/** USTAR + PAX paths preserve exact filenames, including spaces, Unicode and long names. */
function safeTarPath(name) { if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(x => x === '..' || x === '.') || /[\x00-\x1f\x7f]/.test(name))
    throw Error(`Chemin archive interdit : ${name}`); }
function tarHeader(path, size, type = '0') {
    const header = new Uint8Array(512), encoder = new TextEncoder();
    const put = (at, value) => header.set(encoder.encode(value), at);
    put(0, path);
    put(100, '0000644\0');
    put(108, '0000000\0');
    put(116, '0000000\0');
    put(124, size.toString(8).padStart(11, '0') + '\0');
    put(136, '00000000000\0');
    put(148, '        ');
    put(156, type);
    put(257, 'ustar\0');
    put(263, '00');
    let sum = 0;
    for (const x of header)
        sum += x;
    put(148, sum.toString(8).padStart(6, '0') + '\0 ');
    return header;
}
function paxPath(path) { const enc = new TextEncoder(); let length = enc.encode(' path=' + path + '\n').length + 1; while (true) {
    const next = enc.encode(`${length} path=${path}\n`).length;
    if (next === length)
        return enc.encode(`${length} path=${path}\n`);
    length = next;
} }
export function createSeriesTar(input) {
    const manifest = clone(input), files = new Map();
    for (const row of [...manifest.imports, ...manifest.modifications]) {
        if (typeof row.imageData !== 'string' || !row.imageData.startsWith('data:'))
            throw Error(`Image inline requise pour export : ${row.id}`);
        const filename = typeof row.imageFileName === 'string' ? row.imageFileName : `${row.name || row.id}.png`;
        if (filename.includes('/') || filename.includes('\\'))
            throw Error('Le nom original doit être un basename.');
        const path = 'assets/' + filename;
        safeTarPath(path);
        const bytes = dataURLBytes(row.imageData), previous = files.get(path);
        if (previous && sha256Bytes(previous) !== sha256Bytes(bytes))
            throw Error(`Collision de noms dans l'archive : ${filename}. Exporter les séries séparément.`);
        files.set(path, bytes);
        row.imageData = path;
    }
    files.set('catalog.json', new TextEncoder().encode(JSON.stringify(manifest)));
    const parts = [];
    let total = 1024;
    const add = (path, bytes, type = '0') => { parts.push(tarHeader(path, bytes.length, type), bytes, new Uint8Array((512 - bytes.length % 512) % 512)); total += 512 + Math.ceil(bytes.length / 512) * 512; };
    for (const [path, bytes] of files) {
        const pathBytes = new TextEncoder().encode(path);
        if (pathBytes.length > 99 || /[^\x20-\x7e]/.test(path)) {
            add('PaxHeaders/path', paxPath(path), 'x');
            add('PaxEntry', bytes);
        }
        else
            add(path, bytes);
    }
    if (total > MAX_BYTES)
        throw Error('Archive trop volumineuse : fractionnez la série.');
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}
export function readSeriesTar(bytes) {
    if (bytes.length > MAX_BYTES)
        throw Error('Archive décompressée trop volumineuse.');
    const files = new Map(), decoder = new TextDecoder('utf-8', { fatal: true });
    let pendingPath = '';
    let ended = false;
    for (let offset = 0; offset + 512 <= bytes.length;) {
        const header = bytes.subarray(offset, offset + 512);
        if (header.every(x => x === 0)) {
            if (offset + 1024 > bytes.length || !bytes.subarray(offset).every(x => x === 0))
                throw Error('Terminaison TAR corrompue.');
            ended = true;
            break;
        }
        const field = (start, length) => decoder.decode(header.subarray(start, start + length)).split('\0')[0];
        const sizeText = field(124, 12).trim(), sumText = field(148, 8).trim();
        if (!/^[0-7]+$/.test(sizeText) || !/^[0-7]+$/.test(sumText))
            throw Error('Taille TAR invalide.');
        const size = parseInt(sizeText, 8), recorded = parseInt(sumText, 8);
        let sum = 0;
        for (let i = 0; i < 512; i++)
            sum += i >= 148 && i < 156 ? 32 : header[i];
        if (sum !== recorded)
            throw Error('Checksum TAR invalide.');
        if (field(257, 5) !== 'ustar')
            throw Error('Format TAR non compatible.');
        const start = offset + 512, end = start + size, next = start + Math.ceil(size / 512) * 512;
        if (!Number.isSafeInteger(size) || next > bytes.length)
            throw Error('Archive TAR tronquée.');
        if (!bytes.subarray(end, next).every(x => x === 0))
            throw Error('Remplissage TAR corrompu.');
        const data = bytes.subarray(start, end), type = field(156, 1);
        if (type === 'x') {
            let pos = 0;
            pendingPath = '';
            while (pos < data.length) {
                let space = pos;
                while (space < data.length && data[space] !== 32)
                    space++;
                const len = Number(decoder.decode(data.subarray(pos, space)));
                if (!Number.isSafeInteger(len) || len <= space - pos + 2 || pos + len > data.length)
                    throw Error('En-tête PAX corrompu.');
                const record = decoder.decode(data.subarray(space + 1, pos + len - 1));
                if (record.startsWith('path='))
                    pendingPath = record.slice(5);
                pos += len;
            }
            if (!pendingPath)
                throw Error('Chemin PAX manquant.');
        }
        else if (type === 'L') {
            const nul = data.indexOf(0);
            if (nul < 1 || !data.subarray(nul).every(x => x === 0))
                throw Error('Chemin GNU TAR corrompu.');
            pendingPath = decoder.decode(data.subarray(0, nul));
        }
        else if (type === '0' || type === '' || type === '5') {
            const prefix = field(345, 155);
            const path = (pendingPath || (prefix ? prefix + '/' : '') + field(0, 100)).replace(/^(?:\.\/)+/, '');
            pendingPath = '';
            if (type === '5') {
                if (size !== 0)
                    throw Error('Dossier TAR avec contenu interdit.');
                if (path)
                    safeTarPath(path);
            }
            else {
                safeTarPath(path);
                if (files.has(path))
                    throw Error(`Fichier archive en doublon : ${path}`);
                files.set(path, data);
            }
        }
        else
            throw Error('Type TAR interdit (liens).');
        offset = next;
    }
    if (!ended || pendingPath)
        throw Error('Archive TAR tronquée.');
    return files;
}
export async function gzipSeriesTar(bytes) { if (typeof CompressionStream === 'undefined')
    throw Error('TAR.GZ indisponible dans ce navigateur : utiliser JSON.'); return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).blob(); }
export async function archiveSeriesImages(file) {
    if (file.size > MAX_BYTES)
        throw Error('Archive trop volumineuse.');
    let bytes;
    if (/\.(tgz|tar\.gz)$/i.test(file.name)) {
        if (typeof DecompressionStream === 'undefined')
            throw Error('TAR.GZ indisponible : sélectionner directement les images.');
        const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
        const chunks = [];
        let total = 0;
        try {
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                total += part.value.byteLength;
                if (total > MAX_BYTES) {
                    await reader.cancel();
                    throw Error('Archive décompressée trop volumineuse.');
                }
                chunks.push(part.value);
            }
        }
        finally {
            reader.releaseLock();
        }
        bytes = new Uint8Array(total);
        let off = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, off);
            off += chunk.length;
        }
    }
    else
        bytes = new Uint8Array(await file.arrayBuffer());
    const images = [];
    for (const [path, data] of readSeriesTar(bytes))
        if (/\.(png|gif|jpe?g|webp|bmp)$/i.test(path)) {
            const name = path.split('/').pop();
            images.push(new File([data], name, { type: mimeForFilename(name) }));
        }
    if (!images.length)
        throw Error('Aucune image dans cette archive.');
    return images;
}
