import { assertImageSize, compositeFrameLayers, isSafeLiverySource } from './livery-model.js';
/** HOTFIX86 — file:// treats neighbouring files as opaque origins in Chromium.
 * Resolve catalogue sprites through the generated local script pack so anything
 * painted on the editor canvas is an origin-clean data URL before toBlob(). */
export async function originCleanLiverySource(source) {
    if (!isSafeLiverySource(source))
        throw new Error('Format image non autorisé.');
    if (source.startsWith('data:image/'))
        return source;
    const protocol = typeof location !== 'undefined' ? location.protocol : '';
    if (protocol !== 'file:')
        return source;
    const loader = globalThis.__railEmpireLoadLiveryCatalogAsset;
    if (typeof loader !== 'function')
        throw new Error('Pack d’images Livrées indisponible pour le lancement direct. Relancez le build complet Rail Empire.');
    const clean = await loader(source);
    if (!clean || !isSafeLiverySource(clean) || !clean.startsWith('data:image/'))
        throw new Error('Image du catalogue introuvable dans le pack Livrées.');
    return clean;
}
export async function decodeLiveryImage(source) {
    if (!isSafeLiverySource(source))
        throw new Error('Format image non autorisé.');
    return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => { try {
        assertImageSize(image.naturalWidth, image.naturalHeight);
        resolve(image);
    }
    catch (e) {
        reject(e);
    } }; image.onerror = () => reject(new Error('Image illisible ou fichier du catalogue introuvable.')); image.src = source; });
}
export function drawLiveryLayers(canvas, base, cargoLayers) {
    const frame = compositeFrameLayers({ width: base.naturalWidth, height: base.naturalHeight }, cargoLayers.map(layer => ({ image: { width: layer.image.naturalWidth, height: layer.image.naturalHeight }, placement: layer.placement })));
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Canvas 2D indisponible.');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    // Every load layer stays behind the wagon. Later layers are drawn over earlier loads.
    cargoLayers.forEach((layer, index) => { const geo = frame.layers[index]; ctx.drawImage(layer.image, geo.x, geo.y, geo.width, geo.height); });
    ctx.drawImage(base, frame.baseX, frame.baseY);
    return frame;
}
export function drawLivery(canvas, base, cargo, placement) {
    if (base) {
        const layered = drawLiveryLayers(canvas, base, [{ image: cargo, placement }]), first = layered.layers[0];
        return { ...layered, cargoX: first.x, cargoY: first.y, cargoWidth: first.width, cargoHeight: first.height };
    }
    assertImageSize(cargo.naturalWidth, cargo.naturalHeight);
    canvas.width = cargo.naturalWidth;
    canvas.height = cargo.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Canvas 2D indisponible.');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cargo, 0, 0);
    return null;
}
export function canvasPNG(canvas) {
    assertImageSize(canvas.width, canvas.height);
    return new Promise((resolve, reject) => { try {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Échec de l’export PNG : mémoire graphique insuffisante.')), 'image/png');
    }
    catch (e) {
        reject(e);
    } });
}
export function blobDataURL(blob) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Lecture de l’image impossible.')); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image illisible.')); reader.readAsDataURL(blob); });
}
export async function canvasAsset(canvas) { return { src: await blobDataURL(await canvasPNG(canvas)), width: canvas.width, height: canvas.height }; }
export async function importLiveryImage(file) {
    if (file.size > 32 * 1024 * 1024)
        throw new Error('Image trop lourde (maximum 32 Mio par import).');
    if (!/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(file.name) || (file.type && !/^image\/(?:png|jpeg|gif|webp|bmp|x-ms-bmp)$/.test(file.type)))
        throw new Error('Importez une image PNG, JPEG, GIF, WebP ou BMP. Les SVG ne sont pas acceptés.');
    const url = URL.createObjectURL(file);
    try {
        const image = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Ce fichier ne contient pas une image lisible.')); image.src = url; });
        assertImageSize(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        drawLivery(canvas, null, image, { x: 0, y: 0, scale: 1 });
        const asset = await canvasAsset(canvas);
        canvas.width = canvas.height = 1;
        return { asset, image: await decodeLiveryImage(asset.src) };
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
export function downloadLiveryPNG(blob, label) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = (label.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'livree') + '.png';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}
