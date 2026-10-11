// Batch186 FullCatalog lazy loader — HOTFIX41 catalogue throughput
const CHUNKS = ["catalog-batch186-001.js", "catalog-batch186-002.js", "catalog-batch186-003.js", "catalog-batch186-004.js", "catalog-batch186-005.js", "catalog-batch186-006.js", "catalog-batch186-007.js", "catalog-batch186-008.js", "catalog-batch186-009.js", "catalog-batch186-010.js", "catalog-batch186-011.js", "catalog-batch186-012.js", "catalog-batch186-013.js", "catalog-batch186-014.js", "catalog-batch186-015.js", "catalog-batch186-016.js", "catalog-batch186-017.js", "catalog-batch186-018.js", "catalog-batch186-019.js", "catalog-batch186-020.js", "catalog-batch186-021.js", "catalog-batch186-022.js", "catalog-batch186-023.js", "catalog-batch186-024.js", "catalog-batch186-025.js", "catalog-batch186-026.js", "catalog-batch186-027.js", "catalog-batch186-028.js", "catalog-batch186-029.js", "catalog-batch186-030.js", "catalog-batch186-031.js", "catalog-batch186-032.js", "catalog-batch186-033.js", "catalog-batch186-034.js", "catalog-batch186-035.js", "catalog-batch186-036.js", "catalog-batch186-037.js", "catalog-batch186-038.js", "catalog-batch186-039.js", "catalog-batch186-040.js", "catalog-batch186-041.js", "catalog-batch186-042.js", "catalog-batch186-043.js", "catalog-batch186-044.js", "catalog-batch186-045.js", "catalog-batch186-046.js", "catalog-batch186-047.js", "catalog-batch186-048.js", "catalog-batch186-049.js", "catalog-batch186-050.js", "catalog-batch186-051.js", "catalog-batch186-052.js", "catalog-batch186-053.js", "catalog-batch186-054.js", "catalog-batch186-055.js", "catalog-batch186-056.js", "catalog-batch186-057.js", "catalog-batch186-058.js", "catalog-batch186-059.js", "catalog-batch186-060.js", "catalog-batch186-061.js", "catalog-batch186-062.js", "catalog-batch186-063.js"];
const BATCH_SIZE = 4;
function yieldToBrowser() {
    return new Promise(resolve => {
        if (typeof globalThis.requestIdleCallback === 'function')
            globalThis.requestIdleCallback(() => resolve(), { timeout: 50 });
        else
            setTimeout(resolve, 12);
    });
}
function bundleRuntime() {
    return globalThis.__RAIL_EMPIRE_FILE_BUNDLE__;
}
/** Resolve through the same classic-script registry as gameplay: no native module fetch on file://. */
export async function loadCatalogClassicModule(name) {
    const ensure = globalThis.__railEmpireEnsureCatalogBundle;
    if (ensure)
        await ensure();
    const runtime = bundleRuntime();
    if (!runtime)
        throw new Error('Chargeur classique catalogue absent. Ouvrir le build joueur index.html.');
    const value = runtime.require('js/' + name, 'js/main.js');
    if (!value || typeof value !== 'object')
        throw new Error('Module catalogue invalide : ' + name);
    return value;
}
let sharedLoad = null;
export function loadBatch186FullCatalogAdditions(onProgress) {
    if (sharedLoad)
        return sharedLoad;
    sharedLoad = (async () => {
        const all = [];
        for (let base = 0; base < CHUNKS.length; base += BATCH_SIZE) {
            const names = CHUNKS.slice(base, base + BATCH_SIZE);
            const modules = await Promise.all(names.map(name => loadCatalogClassicModule('catalog-batch186-chunks/' + name)));
            for (let j = 0; j < modules.length; j++) {
                const value = modules[j].default;
                if (!Array.isArray(value))
                    throw new Error('Fragment catalogue invalide : ' + names[j]);
                for (const item of value)
                    all.push(item);
                onProgress?.(base + j + 1, CHUNKS.length, all.length, value);
            }
            if (base + BATCH_SIZE < CHUNKS.length)
                await yieldToBrowser();
        }
        return all;
    })();
    return sharedLoad;
}
