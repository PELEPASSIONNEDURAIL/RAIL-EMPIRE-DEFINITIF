/** RC44 enterprise chains. Economy and physical assets remain owned by the game. */
const DAY = 86400000;
const YEAR = 365 * DAY;
/** Procurement presets reference existing technical rows: no second technical catalogue,
 * arbitrary capacity multipliers, inferred country approvals or invented equipment. */
export function enterpriseModelsFromCatalog(items, liveries = []) {
    const text = (v) => typeof v === 'string' ? v.trim() : '';
    const list = (v) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && !!x.trim()).map(x => x.trim()))] : [];
    const number = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
    const family = (item) => item.category === 'automotrice' ? (/diesel|therm/i.test(text(item.traction)) ? 'DMU' : 'EMU') : item.category === 'voiture' ? 'passenger' : text(item.category);
    const series = (item) => text(item.seriesName) || text(item.realIdentitySeries);
    const valid = items.filter(item => text(item.id) && text(item.name) && text(item.category) && Number.isFinite(item.purchasePrice) && Number(item.purchasePrice) >= 0);
    const byId = new Map(valid.map(item => [text(item.id), item]));
    const groups = new Map(), liveriesByCatalog = new Map(), presetsByCatalog = new Map();
    const groupKey = (item) => JSON.stringify([series(item), item.category, text(item.traction)]);
    for (const item of valid)
        if (series(item)) {
            const key = groupKey(item), rows = groups.get(key) ?? [];
            rows.push(item);
            groups.set(key, rows);
        }
    for (const livery of liveries) {
        const rows = liveriesByCatalog.get(livery.catalogId) ?? [];
        rows.push(livery);
        liveriesByCatalog.set(livery.catalogId, rows);
    }
    const preset = (item) => {
        const id = text(item.id), existing = presetsByCatalog.get(id);
        if (existing)
            return existing;
        const compatibility = item.compatibility && typeof item.compatibility === 'object' ? item.compatibility : {};
        const equipment = [...list(item.equipment), ...(item.hvacEquipped === true ? ['HVAC'] : []), ...list(item.safetySystems ?? compatibility.safetySystems), ...(Number.isSafeInteger(item.pantographCount) && Number(item.pantographCount) > 0 ? [`${item.pantographCount} pantographes`] : [])];
        const custom = liveriesByCatalog.get(id) ?? [], image = typeof item.imageData === 'string' ? item.imageData : undefined;
        const countries = list(item.authorizedCountries ?? item.homologations), country = text(item.country ?? item.identityCountry);
        if (!countries.length && /^[A-Z]{2}$/.test(country))
            countries.push(country);
        const result = { id: 'catalog:' + id, label: text(item.name), catalogId: id, capacity: number(item.passengerCapacity) || number(item.freightCapacity) || 1, equipment: [...new Set(equipment)], options: list(item.procurementOptions ?? item.options), liveries: [id, ...custom.map(l => l.id)], homologations: countries, price: number(item.purchasePrice), ...(image ? { image } : {}), liveryChoices: [{ id, label: text(item.name), ...(image ? { image } : {}) }, ...custom.map(l => ({ id: l.id, label: l.label, image: l.image.src }))] };
        presetsByCatalog.set(id, result);
        return result;
    };
    return valid.map(item => {
        const id = text(item.id), declared = Array.isArray(item.procurementConfigurations) ? item.procurementConfigurations : [], group = series(item);
        const explicit = declared.map(raw => typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? text(raw.catalogId) : '').map(key => byId.get(key)).filter((row) => !!row && row.category === item.category && family(row) === family(item));
        const siblings = group ? groups.get(groupKey(item)) ?? [] : [];
        const sources = [...new Map([item, ...explicit, ...siblings].map(row => [text(row.id), row])).values()], configurations = sources.map(preset), base = configurations[0];
        return { id, name: text(item.name), family: family(item), seriesId: group || text(item.name), capacity: configurations.reduce((max, c) => Math.max(max, c.capacity), -Infinity), price: base.price, options: [...new Set(configurations.flatMap(c => c.options))], liveries: [...new Set(configurations.flatMap(c => c.liveries))], homologations: [...new Set(configurations.flatMap(c => c.homologations))], ...(base.image ? { image: base.image } : {}), configurations };
    });
}
export const ENTERPRISE_CONSTRUCTORS = [
    { id: 'regional-works', name: 'Ateliers régionaux', families: ['passenger', 'freight', 'locomotive', 'wagon', 'EMU', 'DMU', 'electric', 'diesel'], annualCapacity: 120, leadDays: 15, quality: .96, priceFactor: 1 },
    { id: 'continental-works', name: 'Industries ferroviaires', families: ['passenger', 'freight', 'locomotive', 'wagon', 'EMU', 'DMU', 'electric', 'diesel'], annualCapacity: 240, leadDays: 25, quality: .99, priceFactor: 1.08 },
    { id: 'rapid-works', name: 'Construction express', families: ['passenger', 'freight', 'locomotive', 'wagon', 'EMU', 'DMU', 'electric', 'diesel'], annualCapacity: 60, leadDays: 8, quality: .88, priceFactor: 1.2 }
];
export const ENTERPRISE_BUILDERS = [
    { id: 'local-build', name: 'Bâtiment ferroviaire local', costFactor: 1, days: 12, reliability: .92 },
    { id: 'industrial-build', name: 'Travaux industriels', costFactor: 1.2, days: 7, reliability: .98 }
];
function bounded(value, min, max) { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)); }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function record(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function strings(value) { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
export class EnterpriseManager {
    isDelegated(simple) { return this.delegated || simple && this.simpleDelegated; }
    constructor(dependencies = { catalog: () => [] }) {
        this.needs = [];
        this.quotes = [];
        this.orders = [];
        this.customs = [];
        this.policies = [];
        this.claims = [];
        this.customers = [];
        this.complaints = [];
        this.parcels = [];
        this.constructionOffers = [];
        this.buildings = [];
        this.campaigns = [];
        this.warrantyClaims = [];
        this.replacementLeases = [];
        this.ledger = [];
        this.closures = [];
        this.serviceHistory = [];
        this.delegated = false;
        this.epoch = 0;
        this.rng = 0x44e17;
        this.seq = 1;
        this.events = [];
        this.simpleDelegated = true;
        this.seenServices = new Set();
        this.seenIncidents = new Set();
        this.dependencies = dependencies;
    }
    id(prefix) { return `${prefix}-${this.seq++}`; }
    random() { this.rng ^= this.rng << 13; this.rng ^= this.rng >>> 17; this.rng ^= this.rng << 5; this.rng >>>= 0; return this.rng / 4294967296; }
    event(kind, entityId, message, data) { this.events.push({ id: this.id('enterprise-event'), at: this.epoch, kind, entityId, message, ...(data ? { data } : {}) }); }
    setDelegated(value) { this.delegated = value; this.simpleDelegated = value; this.event('delegation', 'enterprise', value ? 'Gestion automatique activée' : 'Gestion manuelle reprise'); }
    drainEvents() { return this.events.splice(0); }
    recordPosting(posting, simple = false, alreadySettled = false) {
        if (!posting.id || !Number.isFinite(posting.amount) || !Number.isFinite(posting.at))
            return false;
        if (this.ledger.some(row => row.id === posting.id))
            return true;
        const paid = alreadySettled || this.dependencies.settle?.(copy(posting)) === true;
        if (!paid && !simple)
            return false;
        this.ledger.push({ ...posting, informational: posting.informational === true || !paid });
        if (!paid)
            this.event('assistance', posting.id, 'Financement de secours : coût informatif, opération maintenue', { amount: posting.amount });
        return true;
    }
    defineNeed(input) {
        if (!input.sourceId || !input.location || !input.depotId || !Number.isFinite(input.capacity) || input.capacity <= 0)
            throw new Error('Besoin incomplet');
        const need = { ...input, id: this.id('need'), quantity: Math.round(bounded(input.quantity, 1, 1000)) };
        this.needs.push(need);
        return need;
    }
    requestQuotes(needId) {
        const need = this.needs.find(row => row.id === needId);
        if (!need)
            return [];
        const existing = this.quotes.filter(row => row.needId === needId);
        if (existing.length)
            return existing;
        const offers = [];
        for (const model of this.dependencies.catalog().filter(row => row.family === need.family && row.capacity >= need.capacity && row.price >= 0)) {
            for (const constructor of ENTERPRISE_CONSTRUCTORS.filter(row => row.families.includes(model.family))) {
                const active = this.orders.filter(row => row.constructorId === constructor.id && row.stage !== 'commissioned');
                const queue = active.reduce((sum, row) => sum + row.quantity, 0);
                const productionDays = Math.ceil((queue + need.quantity) / constructor.annualCapacity * 365);
                offers.push({ id: this.id('quote'), needId, constructorId: constructor.id, modelId: model.id, seriesId: model.seriesId, quantity: need.quantity, price: Math.round(model.price * need.quantity * constructor.priceFactor), readyAt: this.epoch + (constructor.leadDays + productionDays) * DAY, quality: constructor.quality, ...(model.image ? { image: model.image } : {}) });
            }
        }
        for (const offer of offers)
            this.quotes.push(offer);
        return offers;
    }
    placeOrder(quoteId, config, simple) {
        const quote = this.quotes.find(row => row.id === quoteId), need = quote && this.needs.find(row => row.id === quote.needId);
        const model = quote && this.dependencies.catalog().find(row => row.id === quote.modelId);
        if (!quote || !need || !model)
            return null;
        const preset = model.configurations?.find(row => config.configurationId ? row.id === config.configurationId : row.catalogId === model.id) ?? (!config.configurationId ? model.configurations?.find(row => row.capacity >= need.capacity) : undefined);
        if (config.configurationId && !preset)
            throw new Error('Configuration catalogue absente ou incompatible');
        if (preset && preset.capacity < need.capacity)
            throw new Error('Capacité de configuration insuffisante pour le besoin');
        const allowed = preset ?? model;
        if (config.options.some(value => !allowed.options.includes(value) && !(value === 'Configuration catalogue' && !config.configurationId)) || !allowed.liveries.includes(config.livery) || config.homologations.some(value => !allowed.homologations.includes(value)))
            throw new Error('Options, livrée ou homologations incompatibles');
        const technical = preset ? this.dependencies.catalog().find(row => row.id === preset.catalogId) : model;
        if (!technical || technical.family !== need.family)
            throw new Error('Configuration technique catalogue indisponible');
        const configurationImage = preset?.liveryChoices?.find(row => row.id === config.livery)?.image ?? preset?.image ?? model.image;
        if (this.orders.some(row => row.quoteId === quoteId))
            return this.orders.find(row => row.quoteId === quoteId) ?? null;
        const maker = ENTERPRISE_CONSTRUCTORS.find(row => row.id === quote.constructorId);
        const queued = this.orders.filter(row => row.constructorId === maker.id && row.stage !== 'commissioned').reduce((sum, row) => sum + row.quantity, 0);
        const readyAt = Math.max(quote.readyAt, this.epoch + (maker.leadDays + Math.ceil((queued + quote.quantity) / maker.annualCapacity * 365)) * DAY);
        const price = preset ? Math.round(preset.price * quote.quantity * maker.priceFactor) : quote.price;
        const configured = { ...copy(config), ...(preset ? { configurationId: preset.id, capacity: preset.capacity, equipment: [...preset.equipment] } : {}) };
        const id = this.id('order'), assemblyAt = this.epoch + (readyAt - this.epoch) * .3;
        const order = { ...configured, id, quoteId, needId: need.id, constructorId: quote.constructorId, modelId: technical.id, seriesId: technical.seriesId, quantity: quote.quantity, price, location: need.location, depotId: need.depotId, createdAt: this.epoch, readyAt, deliveryAt: readyAt + DAY, stage: 'configuration', installments: [{ id: `${id}-deposit`, at: this.epoch, amount: Math.round(price * .2), paid: false }, { id: `${id}-assembly`, at: assemblyAt, amount: Math.round(price * .4), paid: false }, { id: `${id}-delivery`, at: readyAt + DAY, amount: price - Math.round(price * .2) - Math.round(price * .4), paid: false }], inspected: false, defect: false, defectCorrected: false, vehicleIds: [], trained: false, warrantyUntil: readyAt + DAY + 2 * YEAR, delayDays: 0, replacementIds: [], preparationAt: readyAt + DAY + 3600000, ...(configurationImage ? { image: configurationImage } : {}) };
        if (!this.payInstallment(order, 0, simple))
            return null;
        order.defect = this.random() > quote.quality;
        this.orders.push(order);
        this.event('order', id, 'Commande confirmée, slot réservé', { readyAt, price });
        if (this.random() > quote.quality) {
            this.delayOrder(id, (1 + Math.floor(this.random() * 5)) * DAY);
            if (simple)
                this.resolveDelay(id, 'lease', true);
        }
        return order;
    }
    payInstallment(order, index, simple) {
        const installment = order.installments[index];
        if (!installment)
            return false;
        if (installment.paid)
            return true;
        installment.paid = this.recordPosting({ id: installment.id, at: installment.at, activity: 'fleet-purchase', amount: -installment.amount, label: `Commande ${order.id} — échéance ${index + 1}`, depotId: order.depotId, fleetId: order.id }, simple);
        return installment.paid;
    }
    delayOrder(orderId, durationMs) {
        const order = this.orders.find(row => row.id === orderId);
        if (!order || ['accepted', 'delivered', 'commissioned'].includes(order.stage))
            return false;
        const duration = bounded(durationMs, 3600000, 90 * DAY);
        order.readyAt += duration;
        order.deliveryAt += duration;
        order.preparationAt += duration;
        order.warrantyUntil += duration;
        order.delayDays += duration / DAY;
        order.installments[2].at = order.deliveryAt;
        this.event('industrial-delay', orderId, 'Retard industriel : location, replanification ou priorité sur un autre lot', { deliveryAt: order.deliveryAt });
        return true;
    }
    resolveDelay(orderId, choice, simple) {
        const order = this.orders.find(row => row.id === orderId);
        if (!order || order.delayDays <= 0)
            return false;
        if (choice === 'lease') {
            if (order.replacementIds.length)
                return true;
            if (!this.dependencies.leaseVehicle)
                return false;
            const attempt = order.leaseAttempt ?? 0, leaseId = `${order.id}-lease${attempt ? '-' + attempt : ''}`;
            const cost = Math.round(order.price * .005), postingId = `${order.id}-lease-cost-${attempt}`;
            if (!this.recordPosting({ id: postingId, at: this.epoch, activity: 'lease', amount: -cost, label: 'Location de remplacement', fleetId: order.id, depotId: order.depotId }, simple))
                return false;
            const vehicle = this.dependencies.leaseVehicle({ id: leaseId, orderId, modelId: order.modelId, location: order.depotId, until: order.deliveryAt });
            if (!vehicle) {
                this.recordPosting({ id: `${postingId}-refund`, at: this.epoch, activity: 'lease', amount: cost, label: 'Location indisponible : annulation', fleetId: order.id, depotId: order.depotId }, simple);
                order.leaseAttempt = (order.leaseAttempt ?? 0) + 1;
                return false;
            }
            order.replacementIds.push(vehicle);
            this.replacementLeases.push({ id: leaseId, orderId, modelId: order.modelId, location: order.depotId, until: order.deliveryAt, vehicleId: vehicle, startedAt: this.epoch, status: 'active' });
            order.leaseAttempt = attempt + 1;
        }
        else if (choice === 'priority') {
            const donor = this.orders.find(row => row.id !== orderId && row.modelId === order.modelId && row.quantity >= order.quantity && row.readyAt < order.readyAt && ['configuration', 'assembly', 'factory-tests', 'ready'].includes(row.stage));
            if (!donor)
                return false;
            const ready = order.readyAt, delivery = order.deliveryAt;
            order.readyAt = donor.readyAt;
            order.deliveryAt = donor.deliveryAt;
            donor.readyAt = ready;
            donor.deliveryAt = delivery;
            order.preparationAt = order.deliveryAt + 3600000;
            donor.preparationAt = donor.deliveryAt + 3600000;
            order.installments[2].at = order.deliveryAt;
            donor.installments[2].at = donor.deliveryAt;
            this.event('priority', orderId, 'Priorité accordée sur un lot compatible', { donorOrderId: donor.id });
        }
        else {
            const need = this.needs.find(row => row.id === order.needId);
            if (!need)
                return false;
            if (choice === 'substitution') {
                const vehicle = (this.dependencies.vehicles?.() ?? []).find(row => row.modelId === order.modelId && !order.vehicleIds.includes(row.id) && !this.orders.some(other => other.replacementIds.includes(row.id)));
                if (!vehicle || this.dependencies.substituteVehicle?.({ orderId, vehicleId: vehicle.id, source: need.source, sourceId: need.sourceId, until: order.deliveryAt }) !== true)
                    return false;
                order.replacementIds.push(vehicle.id);
            }
            else if (this.dependencies.replanDelivery?.({ orderId, source: need.source, sourceId: need.sourceId, readyAt: order.readyAt, deliveryAt: order.deliveryAt }) !== true)
                return false;
            this.event('replan', orderId, choice === 'substitution' ? 'Matériel existant affecté temporairement au service' : 'Planning du service réellement recalé sur la date industrielle', { deliveryAt: order.deliveryAt });
        }
        this.event('delay-resolution', orderId, `Solution appliquée : ${choice}`);
        return true;
    }
    inspectOrder(orderId) {
        const order = this.orders.find(row => row.id === orderId);
        if (!order || order.stage !== 'ready')
            return false;
        order.inspected = true;
        this.event('inspection', orderId, order.defect && !order.defectCorrected ? 'Défaut mineur identifié, correction fournisseur requise' : 'Inspection conforme');
        return true;
    }
    correctFactoryDefect(orderId) {
        const order = this.orders.find(row => row.id === orderId);
        if (!order || !order.inspected)
            return false;
        order.defectCorrected = true;
        this.event('factory-correction', orderId, 'Correction et nouvel essai fournisseur conformes');
        return true;
    }
    acceptOrder(orderId, simple) {
        const order = this.orders.find(row => row.id === orderId);
        if (!order)
            return false;
        if (['accepted', 'delivered', 'commissioned'].includes(order.stage))
            return true;
        if (order.stage !== 'ready')
            return false;
        const model = this.dependencies.catalog().find(row => row.id === order.modelId);
        const preset = model?.configurations?.find(row => row.id === order.configurationId), allowed = preset ?? model;
        if (!model || !allowed || order.configurationId && !preset || model.seriesId !== order.seriesId || order.options.some(v => !allowed.options.includes(v) && !(v === 'Configuration catalogue' && !order.configurationId)) || !allowed.liveries.includes(order.livery) || order.homologations.some(v => !allowed.homologations.includes(v)) || preset && (preset.catalogId !== order.modelId || preset.capacity !== order.capacity || JSON.stringify(preset.equipment) !== JSON.stringify(order.equipment)))
            return false;
        if (simple) {
            order.inspected = true;
            order.defectCorrected = true;
        }
        if (!order.inspected || (order.defect && !order.defectCorrected))
            return false;
        order.stage = 'accepted';
        this.event('acceptance', orderId, 'Réception contractuelle conforme : quantité, série, options, catalogue et garantie', { quantity: order.quantity, seriesId: order.seriesId, warrantyUntil: order.warrantyUntil });
        return true;
    }
    verifyReceipt(order) {
        if (!this.dependencies.vehicles)
            return true;
        const fleet = this.dependencies.vehicles();
        let issue = '';
        for (const id of order.vehicleIds) {
            const vehicle = fleet.find(row => row.id === id);
            if (!vehicle || vehicle.modelId !== order.modelId) {
                issue = 'Réception : modèle physique livré non conforme';
                break;
            }
            if (order.configurationId && vehicle.capacity !== undefined && vehicle.capacity !== order.capacity) {
                issue = 'Réception : capacité physique livrée non conforme à la configuration';
                break;
            }
            if ((vehicle.seriesId && vehicle.seriesId !== order.seriesId) || (vehicle.livery && vehicle.livery !== order.livery) || (vehicle.options && order.options.some(v => !vehicle.options.includes(v))) || (vehicle.homologations && order.homologations.some(v => !vehicle.homologations.includes(v)))) {
                issue = 'Réception : série, livrée ou options physiques non conformes';
                break;
            }
        }
        if (issue) {
            if (order.receiptIssue !== issue)
                this.event('receipt-mismatch', order.id, issue);
            order.receiptIssue = issue;
            return false;
        }
        delete order.receiptIssue;
        return true;
    }
    trainOrder(orderId, simple) {
        const order = this.orders.find(row => row.id === orderId);
        if (!order || !order.vehicleIds.length)
            return false;
        if (order.trained)
            return true;
        order.trained = this.dependencies.trainSeries?.(order.seriesId, [...order.vehicleIds], simple) === true;
        if (order.trained)
            this.event('training', orderId, 'Formation initiale validée pour la série');
        return order.trained;
    }
    commissionOrder(orderId, simple) {
        const order = this.orders.find(row => row.id === orderId);
        if (!order)
            return false;
        if (order.stage === 'commissioned')
            return true;
        if (order.stage !== 'delivered' || order.vehicleIds.length !== order.quantity)
            return false;
        if (!order.trained && !this.trainOrder(orderId, simple))
            return false;
        if (!simple && this.epoch < order.preparationAt)
            return false;
        for (const id of order.vehicleIds) {
            if (this.dependencies.moveVehicle?.(id, order.depotId) !== true || this.dependencies.commissionVehicle?.(id) !== true)
                return false;
        }
        order.stage = 'commissioned';
        if (!order.campaignChecked) {
            order.campaignChecked = true;
            if (this.random() > .98)
                this.createWarrantyCampaign(order.id, 'Contrôle de jeunesse du lot — scénario gameplay');
        }
        this.event('commission', orderId, 'Enregistrement, contrôle, données et essais achevés; matériel disponible au dépôt', { vehicleIds: [...order.vehicleIds] });
        return true;
    }
    /** The workshop submits the same source ID at diagnosis and after physical consumption/quality. */
    reportWorkshopWarranty(request) {
        const existing = this.warrantyClaims.find(row => row.sourceId === request.id), previousStage = existing?.stage;
        if (existing?.stage === 'paid' || existing?.stage === 'denied')
            return existing;
        const vehicle = (this.dependencies.vehicles?.() ?? []).find(row => row.id === request.vehicleId);
        const factoryId = vehicle?.factoryOrderId ?? request.factoryOrderId ?? '';
        const order = this.orders.find(row => row.id === factoryId && row.vehicleIds.includes(request.vehicleId));
        const physicalUntil = vehicle?.warrantyUntil ?? request.warrantyUntil ?? 0;
        const until = Math.min(order?.warrantyUntil ?? 0, physicalUntil);
        const at = existing?.reportedAt ?? request.at;
        const proof = [...(request.proof ?? [])];
        const parts = Object.entries(request.parts ?? {}).filter(([, quantity]) => Number.isFinite(quantity) && quantity > 0);
        const consumed = parts.length ? parts.every(([part]) => proof.some(line => line.startsWith(`consumed:${part}:`))) : !!request.partId && proof.some(line => line.startsWith(`consumed:${request.partId}:`));
        const verified = request.status === 'verified' && typeof request.completedAt === 'number' && Number.isFinite(request.completedAt) && consumed && proof.some(line => line.startsWith('quality:'));
        const cost = typeof request.partsCost === 'number' && Number.isFinite(request.partsCost) ? Math.max(0, request.partsCost) : 0;
        const refund = verified && typeof request.eligibleRefund === 'number' && Number.isFinite(request.eligibleRefund) ? Math.max(0, Math.min(cost, request.eligibleRefund)) : 0;
        const eligible = !!vehicle && !!order && Number.isFinite(at) && at < until;
        const stage = !eligible ? 'denied' : verified && refund > 0 ? 'ready' : 'requested';
        const reason = !vehicle || !order ? 'Véhicule physique sans commande constructeur correspondante.' : at >= until ? 'Garantie physique expirée à la date du signalement.' : !verified ? 'Attente de consommation physique et de contrôles qualité atelier.' : refund <= 0 ? 'Aucun coût de pièce remboursable vérifié.' : 'Pièces consommées et essais qualité attestés : prise en charge constructeur disponible.';
        const claim = existing ?? { id: `manufacturer-${request.id}`, sourceId: request.id, workshopOrderId: request.orderId, factoryOrderId: factoryId, vehicleId: request.vehicleId, partId: request.partId, reportedAt: at, warrantyUntil: until, partsCost: cost, refund, quantity: Math.max(0, request.quantity ?? 1), proof, stage, reason };
        Object.assign(claim, { proof, partsCost: cost, refund, quantity: Math.max(0, request.quantity ?? 1), stage, reason, ...(verified ? { verifiedAt: request.completedAt } : {}) });
        if (!existing)
            this.warrantyClaims.push(claim);
        if (!existing || previousStage !== stage)
            this.event('manufacturer-warranty', claim.id, reason, { vehicleId: claim.vehicleId, factoryOrderId: claim.factoryOrderId, refund });
        return claim;
    }
    payWarrantyClaim(id, _simple = false) {
        const claim = this.warrantyClaims.find(row => row.id === id);
        if (!claim)
            return false;
        if (claim.stage === 'paid')
            return true;
        if (claim.stage !== 'ready' || claim.refund <= 0)
            return false;
        // A credit must reach Economy; Simple assistance cannot manufacture an informational reimbursement.
        if (!this.recordPosting({ id: `${claim.id}-refund`, at: this.epoch, activity: 'warranty-refund', amount: claim.refund, label: `Garantie constructeur : ${claim.partId || 'pièces'} / ${claim.workshopOrderId}`, fleetId: claim.vehicleId, supplyId: claim.factoryOrderId }, false))
            return false;
        claim.stage = 'paid';
        claim.paidAt = this.epoch;
        claim.reason = 'Prise en charge constructeur versée au solde.';
        this.event('manufacturer-warranty-paid', claim.id, claim.reason, { amount: claim.refund, vehicleId: claim.vehicleId });
        return true;
    }
    releaseReplacementLease(id) {
        const lease = this.replacementLeases.find(row => row.id === id);
        if (!lease)
            return false;
        if (lease.status === 'released')
            return true;
        if (this.epoch < lease.until)
            return false;
        lease.status = 'pending-release';
        if (this.dependencies.releaseLease?.(copy(lease)) !== true)
            return false;
        lease.status = 'released';
        lease.releasedAt = this.epoch;
        const order = this.orders.find(row => row.id === lease.orderId);
        if (order)
            order.replacementIds = order.replacementIds.filter(vehicle => vehicle !== lease.vehicleId);
        this.event('lease-release', lease.id, 'Location terminée : véhicule physique libéré en sécurité.', { vehicleId: lease.vehicleId });
        return true;
    }
    createWarrantyCampaign(orderId, reason) {
        const order = this.orders.find(row => row.id === orderId);
        if (!order || !order.vehicleIds.length || !reason.trim())
            throw new Error('Lot livré et motif requis');
        const existing = this.campaigns.find(row => row.orderId === orderId && row.reason === reason);
        if (existing)
            return existing;
        const campaign = { id: this.id('campaign'), orderId, at: this.epoch, reason, vehicleIds: [...order.vehicleIds], warrantyUntil: order.warrantyUntil, applied: false };
        campaign.applied = this.dependencies.warrantyCampaign?.(copy(campaign)) === true;
        this.campaigns.push(campaign);
        this.event('warranty-campaign', campaign.id, 'Campagne fournisseur transmise à la fiabilité', { vehicleIds: campaign.vehicleIds });
        return campaign;
    }
    registerCustoms(lot, feeRate = .02) {
        const existing = this.customs.find(row => row.lotId === lot.id);
        if (existing)
            return existing;
        if (!lot.id || !lot.origin || !lot.destination || !lot.cargo)
            throw new Error('Lot douanier incomplet');
        const customs = { id: this.id('customs'), lotId: lot.id, contractId: lot.contractId, documents: { origin: lot.origin, destination: lot.destination, cargo: lot.cargo, value: bounded(lot.value, 0, 1e12), contractId: lot.contractId }, status: 'documented', eta: Math.max(this.epoch, lot.eta), holdUntil: 0, fee: Math.round(bounded(lot.value, 0, 1e12) * bounded(feeRate, 0, .25)), broker: false, settled: false };
        this.customs.push(customs);
        if (lot.origin !== lot.destination && this.random() > .9)
            this.holdCustoms(customs.id, (1 + Math.floor(this.random() * 3)) * DAY);
        return customs;
    }
    holdCustoms(id, durationMs) {
        const c = this.customs.find(row => row.id === id);
        if (!c || c.status === 'cleared')
            return false;
        const duration = bounded(durationMs, 3600000, 7 * DAY);
        c.status = 'held';
        c.holdUntil = this.epoch + duration;
        c.eta += duration;
        this.event('customs-hold', id, 'Contrôle douanier, ETA actualisée', { eta: c.eta });
        return true;
    }
    assignBroker(id) {
        const c = this.customs.find(row => row.id === id);
        if (!c)
            return false;
        c.broker = true;
        this.event('customs-broker', id, 'Formalités confiées au courtier');
        return true;
    }
    rerouteCustoms(id, destination) {
        const c = this.customs.find(row => row.id === id);
        if (!c || !destination || this.dependencies.rerouteLot?.(c.lotId, destination) !== true)
            return false;
        c.documents.destination = destination;
        c.status = 'documented';
        c.holdUntil = 0;
        c.eta = Math.max(this.epoch, c.eta - DAY);
        this.event('customs-reroute', id, 'Lot réellement rerouté', { destination });
        return true;
    }
    clearCustoms(id, simple) {
        const c = this.customs.find(row => row.id === id);
        if (!c)
            return false;
        if (c.status === 'cleared')
            return true;
        if (c.status === 'held' && this.epoch < c.holdUntil && !simple)
            return false;
        if (!c.settled)
            c.settled = this.recordPosting({ id: `${id}-fee`, at: this.epoch, activity: 'customs', amount: -c.fee, label: 'Frais douaniers gameplay', contractId: c.contractId, supplyId: c.lotId }, simple);
        if (!c.settled)
            return false;
        c.status = 'cleared';
        c.holdUntil = 0;
        this.event('customs-clear', id, 'Documents et contrôle validés');
        return true;
    }
    insure(input) {
        if (input.kind === 'fleet' && !input.category)
            throw new Error('Catégorie de flotte requise');
        if (input.kind === 'cargo' && !input.contractId && !input.lotId)
            throw new Error('Lot ou contrat fret requis');
        const policy = { ...input, id: this.id('policy'), annualPremium: bounded(input.annualPremium, 0, 1e9), deductible: bounded(input.deductible, 0, 1e10), limit: bounded(input.limit, 0, 1e12), createdAt: this.epoch, nextPremiumAt: this.epoch, active: true };
        this.policies.push(policy);
        return policy;
    }
    premiumFactor(simple) {
        if (simple)
            return 1;
        const decided = this.claims.filter(row => ['paid', 'denied', 'decision'].includes(row.stage)), paid = decided.reduce((sum, row) => sum + row.award, 0), premiums = this.ledger.filter(row => row.activity === 'insurance-premium').reduce((sum, row) => sum + Math.abs(row.amount), 0);
        return bounded(.8 + paid / Math.max(1, premiums) * .15, .7, 1.5);
    }
    openClaim(incident) {
        const existing = this.claims.find(row => row.incidentId === incident.id);
        if (existing)
            return existing;
        if (!incident.proof.length || !Number.isFinite(incident.loss) || incident.loss <= 0)
            return null;
        const policies = this.policies.filter(row => row.active && incident.at >= row.createdAt && ((row.kind === 'fleet' && !!incident.vehicleId && (row.category === incident.category || row.category === incident.vehicleCategory)) || (row.kind === 'cargo' && !!incident.lotId && ((row.lotId && row.lotId === incident.lotId) || (row.contractId && row.contractId === incident.contractId) || (row.contractId && this.customs.some(c => c.lotId === incident.lotId && c.contractId === row.contractId))))));
        const policy = policies.sort((a, b) => (b.limit - b.deductible) - (a.limit - a.deductible))[0];
        if (!policy)
            return null;
        const claim = { id: this.id('claim'), policyId: policy.id, incidentId: incident.id, at: incident.at, stage: 'open', proof: [...incident.proof], loss: incident.loss, award: 0, reason: '', ...(incident.vehicleId ? { vehicleId: incident.vehicleId } : {}), ...(incident.lotId ? { lotId: incident.lotId } : {}) };
        this.claims.push(claim);
        this.event('claim-open', claim.id, 'Déclaration liée aux preuves du moteur');
        return claim;
    }
    expertiseClaim(id) {
        const claim = this.claims.find(row => row.id === id);
        if (!claim || claim.stage !== 'open')
            return false;
        claim.stage = 'expertise';
        claim.reason = `${claim.proof.length} preuve(s) moteur analysée(s)`;
        this.event('claim-expertise', id, claim.reason);
        return true;
    }
    decideClaim(id, accepted, reason = 'Preuves et couverture conformes') {
        const claim = this.claims.find(row => row.id === id), policy = claim && this.policies.find(row => row.id === claim.policyId);
        if (!claim || !policy || claim.stage !== 'expertise')
            return false;
        claim.award = accepted ? Math.min(policy.limit, Math.max(0, claim.loss - policy.deductible)) : 0;
        claim.reason = reason;
        claim.stage = accepted ? 'decision' : 'denied';
        this.event('claim-decision', id, reason, { award: claim.award });
        return true;
    }
    payClaim(id, simple = false) {
        const claim = this.claims.find(row => row.id === id);
        if (!claim)
            return false;
        if (claim.stage === 'paid')
            return true;
        if (claim.stage !== 'decision')
            return false;
        if (!this.recordPosting({ id: `${id}-payment`, at: this.epoch, activity: 'insurance-award', amount: claim.award, label: `Indemnité ${claim.incidentId}`, ...(claim.vehicleId ? { fleetId: claim.vehicleId } : {}), ...(claim.lotId ? { supplyId: claim.lotId } : {}) }, simple))
            return false;
        claim.stage = 'paid';
        this.event('claim-payment', id, 'Indemnisation payée', { amount: claim.award });
        return true;
    }
    ingestServices(simple) {
        for (const service of this.dependencies.services?.(this.seenServices) ?? []) {
            if (this.seenServices.has(service.id) || service.at > this.epoch)
                continue;
            this.seenServices.add(service.id);
            this.serviceHistory.push(copy(service));
            this.redeemCustomerCredit(service.customerId, service.id, service.value, simple);
            let customer = this.customers.find(row => row.id === service.customerId);
            if (!customer) {
                customer = { id: service.customerId, kind: service.kind, interlocutor: service.kind === 'freight' ? 'Responsable logistique' : 'Cohorte voyageurs', serviceIds: [], complaintIds: [], interactions: [], satisfaction: 100, contractIds: [] };
                this.customers.push(customer);
            }
            customer.serviceIds.push(service.id);
            if (service.contractId && !customer.contractIds.includes(service.contractId))
                customer.contractIds.push(service.contractId);
            customer.interactions.push({ at: service.at, label: `Service ${service.id} : retard ${service.delayMinutes} min, intégrité ${service.damaged ? 'dégradée' : 'respectée'}` });
            const cause = service.damaged ? 'damage' : !service.delivered ? 'delivery' : service.delayMinutes > 15 ? 'delay' : null;
            if (cause) {
                const complaint = { id: this.id('complaint'), customerId: customer.id, serviceId: service.id, at: service.at, cause, value: Math.max(0, service.value), status: 'open', reason: '', credit: 0, ...(service.lineId ? { lineId: service.lineId } : {}), ...(service.contractId ? { contractId: service.contractId } : {}) };
                this.complaints.push(complaint);
                customer.complaintIds.push(complaint.id);
                customer.satisfaction = bounded(customer.satisfaction - 15, 0, 100);
                this.event('complaint', complaint.id, `Réclamation ${cause} liée au service ${service.id}`);
            }
        }
    }
    customerSla(customerId) {
        const rows = this.serviceHistory.filter(row => row.customerId === customerId);
        const n = rows.length;
        const ratio = (predicate) => n ? rows.filter(predicate).length / n * 100 : 100;
        return { services: n, punctuality: ratio(row => row.delayMinutes <= 15), integrity: ratio(row => !row.damaged), delivery: ratio(row => row.delivered), availability: ratio(row => row.available) };
    }
    resolveComplaint(id, resolution, reason, simple = false) {
        const ticket = this.complaints.find(row => row.id === id);
        if (!ticket || ticket.status === 'resolved')
            return false;
        if (resolution === 'refusal' && !reason.trim())
            return false;
        const compensation = resolution === 'refund' ? ticket.value : resolution === 'gift' ? Math.round(ticket.value * .1) : 0;
        if (resolution === 'redelivery' && this.dependencies.redeliver?.(ticket.serviceId) !== true)
            return false;
        if (compensation > 0 && !this.recordPosting({ id: `${id}-compensation`, at: this.epoch, activity: 'crm-compensation', amount: -compensation, label: resolution, lineId: ticket.lineId, contractId: ticket.contractId }, simple))
            return false;
        ticket.credit = resolution === 'credit' ? ticket.value : 0;
        ticket.resolution = resolution;
        ticket.reason = reason;
        ticket.status = 'resolved';
        const customer = this.customers.find(row => row.id === ticket.customerId);
        if (customer) {
            customer.interactions.push({ at: this.epoch, label: `${resolution} : ${reason}` });
            customer.satisfaction = bounded(customer.satisfaction + (resolution === 'refusal' ? -5 : 10), 0, 100);
        }
        this.event('complaint-resolved', id, `Litige résolu : ${resolution}`, { credit: ticket.credit });
        return true;
    }
    redeemCustomerCredit(customerId, serviceId, requestedAmount, simple) {
        const postingId = `crm-credit-${customerId}-${serviceId}`;
        if (!serviceId || this.ledger.some(row => row.id === postingId))
            return 0;
        const tickets = this.complaints.filter(row => row.customerId === customerId && row.status === 'resolved' && row.resolution === 'credit' && row.credit > 0);
        const amount = Math.min(bounded(requestedAmount, 0, 1e9), tickets.reduce((sum, row) => sum + row.credit, 0));
        if (amount <= 0)
            return 0;
        if (!this.recordPosting({ id: postingId, at: this.epoch, activity: 'crm-credit', amount: -amount, label: `Avoir utilisé sur le service ${serviceId}`, contractId: tickets[0]?.contractId, lineId: tickets[0]?.lineId }, simple))
            return 0;
        let remaining = amount;
        for (const ticket of tickets) {
            const consumed = Math.min(remaining, ticket.credit);
            ticket.credit -= consumed;
            remaining -= consumed;
            if (!remaining)
                break;
        }
        this.event('crm-credit-used', customerId, 'Avoir déduit du nouveau service', { serviceId, amount });
        return amount;
    }
    renegotiateCustomer(customerId, contractId, terms) {
        const customer = this.customers.find(row => row.id === customerId);
        if (!customer || !customer.contractIds.includes(contractId) || !terms.trim())
            return false;
        customer.interactions.push({ at: this.epoch, label: `Renégociation ${contractId} : ${terms}` });
        this.event('crm-renegotiation', customerId, terms, { contractId });
        return true;
    }
    acquireParcel(input, simple) {
        if (!input.location || input.area <= 0)
            return null;
        const parcel = { ...input, id: this.id('parcel'), cost: bounded(input.cost, 0, 1e12), rent: bounded(input.rent, 0, 1e9), nextRentAt: this.epoch + 30 * DAY };
        if (!this.recordPosting({ id: `${parcel.id}-acquire`, at: this.epoch, activity: 'property', amount: -parcel.cost, label: 'Acquisition de parcelle', depotId: parcel.location }, simple))
            return null;
        this.parcels.push(parcel);
        return parcel;
    }
    constructionQuotes(parcelId, kind) {
        const parcel = this.parcels.find(row => row.id === parcelId);
        if (!parcel)
            return [];
        const base = parcel.area * (kind === 'terminal' ? 200 : kind === 'depot' ? 150 : 100);
        const offers = ENTERPRISE_BUILDERS.map(builder => ({ id: this.id('build-quote'), parcelId, kind, builderId: builder.id, price: Math.round(base * builder.costFactor), durationDays: builder.days, reliability: builder.reliability }));
        this.constructionOffers.push(...offers);
        return offers;
    }
    startConstruction(quoteId, simple) {
        const quote = this.constructionOffers.find(row => row.id === quoteId), parcel = quote && this.parcels.find(row => row.id === quote.parcelId);
        if (!quote || !parcel || this.buildings.some(row => row.parcelId === parcel.id))
            return null;
        const id = this.id('building');
        if (!this.recordPosting({ id: `${id}-build`, at: this.epoch, activity: 'construction', amount: -quote.price, label: `Construction ${quote.kind}`, depotId: parcel.location }, simple))
            return null;
        const delay = this.random() > quote.reliability ? 2 * DAY : 0;
        const building = { id, quoteId, parcelId: parcel.id, kind: quote.kind, location: parcel.location, price: quote.price, startAt: this.epoch, completeAt: this.epoch + quote.durationDays * DAY + delay, stage: 'study', commissioned: false };
        this.buildings.push(building);
        if (delay)
            this.event('construction-delay', id, 'Aléa du sous-traitant : deux jours de travaux supplémentaires');
        return building;
    }
    report(from, to) {
        const report = { from, to, revenue: 0, costs: 0, result: 0, cashflow: 0, informationalCosts: 0, byActivity: {}, byLine: {}, byContract: {}, byDepot: {}, byFleet: {}, bySupply: {} };
        const add = (map, key, amount) => {
            if (key)
                map[key] = (map[key] ?? 0) + amount;
        };
        for (const row of this.ledger.filter(entry => entry.at >= from && entry.at < to)) {
            if (row.amount >= 0)
                report.revenue += row.amount;
            else
                report.costs -= row.amount;
            if (row.informational)
                report.informationalCosts += Math.max(0, -row.amount);
            else
                report.cashflow += row.amount;
            add(report.byActivity, row.activity, row.amount);
            add(report.byLine, row.lineId, row.amount);
            add(report.byContract, row.contractId, row.amount);
            add(report.byDepot, row.depotId, row.amount);
            add(report.byFleet, row.fleetId, row.amount);
            add(report.bySupply, row.supplyId, row.amount);
        }
        report.result = report.revenue - report.costs;
        return report;
    }
    closePeriod(from, to) {
        const existing = this.closures.find(row => row.from === from && row.to === to);
        if (existing)
            return existing;
        const report = this.report(from, to);
        this.closures.push(report);
        this.event('accounting-close', 'enterprise', 'Clôture gameplay produite', { from, to, result: report.result, cashflow: report.cashflow });
        return report;
    }
    advance(epoch, simple) {
        if (!Number.isFinite(epoch) || epoch < this.epoch)
            return;
        const previous = this.epoch;
        this.epoch = epoch;
        const automatic = this.isDelegated(simple);
        for (const order of this.orders) {
            if (['configuration', 'assembly', 'factory-tests'].includes(order.stage)) {
                const elapsed = (epoch - order.createdAt) / Math.max(1, order.readyAt - order.createdAt);
                for (const [threshold, stage] of [[.3, 'assembly'], [.8, 'factory-tests'], [1, 'ready']]) {
                    if (elapsed >= threshold && (['configuration', 'assembly', 'factory-tests', 'ready'].indexOf(order.stage) < ['configuration', 'assembly', 'factory-tests', 'ready'].indexOf(stage))) {
                        if (stage === 'assembly' && !this.payInstallment(order, 1, simple))
                            break;
                        order.stage = stage;
                        this.event('production', order.id, `Fabrication : ${stage}`);
                    }
                }
            }
            if (automatic && order.stage === 'ready')
                this.acceptOrder(order.id, true);
            if (order.stage === 'accepted' && epoch >= order.deliveryAt && this.payInstallment(order, 2, simple)) {
                for (let index = order.vehicleIds.length; index < order.quantity; index++) {
                    const id = this.dependencies.deliverVehicle?.({ id: `${order.id}-vehicle-${index}`, orderId: order.id, modelId: order.modelId, seriesId: order.seriesId, location: order.location, options: [...order.options], livery: order.livery, homologations: [...order.homologations], warrantyUntil: order.warrantyUntil, ...(order.image ? { image: order.image } : {}) });
                    if (!id)
                        break;
                    order.vehicleIds.push(id);
                }
                if (order.vehicleIds.length === order.quantity && this.verifyReceipt(order)) {
                    order.stage = 'delivered';
                    this.event('vehicle-delivery', order.id, 'Matériel présent au point de livraison', { vehicleIds: [...order.vehicleIds], location: order.location });
                }
            }
            if (automatic && order.stage === 'delivered')
                this.commissionOrder(order.id, simple);
        }
        for (const lease of this.replacementLeases)
            if (lease.status !== 'released' && epoch >= lease.until)
                this.releaseReplacementLease(lease.id);
        if (automatic)
            for (const claim of this.warrantyClaims)
                if (claim.stage === 'ready')
                    this.payWarrantyClaim(claim.id, simple);
        for (const customs of this.customs) {
            if (automatic) {
                customs.broker = true;
                this.clearCustoms(customs.id, simple);
            }
            else if (customs.broker && epoch >= customs.holdUntil)
                this.clearCustoms(customs.id, false);
        }
        for (const policy of this.policies) {
            if (!policy.active)
                continue;
            let steps = 0;
            while (epoch >= policy.nextPremiumAt && steps++ < 100) {
                const due = policy.nextPremiumAt;
                if (!this.recordPosting({ id: `${policy.id}-premium-${due}`, at: due, activity: 'insurance-premium', amount: -Math.round(policy.annualPremium * this.premiumFactor(simple)), label: `Prime annuelle, coefficient ${this.premiumFactor(simple).toFixed(2)} (${this.claims.length} sinistres historiques)`, contractId: policy.contractId, supplyId: policy.lotId }, simple))
                    break;
                policy.nextPremiumAt += YEAR;
            }
        }
        for (const incident of this.dependencies.incidents?.() ?? []) {
            if (incident.at > epoch || this.seenIncidents.has(incident.id))
                continue;
            const claim = this.openClaim(incident);
            if (claim)
                this.seenIncidents.add(incident.id);
        }
        if (automatic) {
            for (const claim of this.claims) {
                if (claim.stage === 'open')
                    this.expertiseClaim(claim.id);
                if (claim.stage === 'expertise')
                    this.decideClaim(claim.id, true);
                if (claim.stage === 'decision')
                    this.payClaim(claim.id, simple);
            }
        }
        this.ingestServices(simple);
        if (automatic)
            for (const complaint of this.complaints.filter(row => row.status === 'open'))
                this.resolveComplaint(complaint.id, complaint.cause === 'delivery' ? 'redelivery' : 'refund', 'Assistance : compensation du service constaté', simple);
        for (const parcel of this.parcels) {
            let steps = 0;
            while (parcel.rent > 0 && epoch >= parcel.nextRentAt && steps++ < 1200) {
                const due = parcel.nextRentAt;
                if (!this.recordPosting({ id: `${parcel.id}-rent-${due}`, at: due, activity: 'property-rent', amount: -parcel.rent, label: 'Loyer parcelle', depotId: parcel.location }, simple))
                    break;
                parcel.nextRentAt += 30 * DAY;
            }
        }
        for (const building of this.buildings) {
            if (building.commissioned)
                continue;
            const progress = (epoch - building.startAt) / Math.max(1, building.completeAt - building.startAt);
            if (progress >= .2 && building.stage === 'study') {
                building.stage = 'works';
                this.event('construction', building.id, 'Travaux commencés');
            }
            if (progress >= .8 && building.stage === 'works') {
                building.stage = 'equipment';
                this.event('construction', building.id, 'Équipement installé');
            }
            if (progress >= 1 && this.dependencies.commissionBuilding?.(copy(building)) === true) {
                building.stage = 'commissioned';
                building.commissioned = true;
                this.event('building-commission', building.id, 'Bâtiment mis en service dans le patrimoine');
            }
        }
        for (const campaign of this.campaigns.filter(row => !row.applied))
            campaign.applied = this.dependencies.warrantyCampaign?.(copy(campaign)) === true;
        const currentDay = Math.floor(epoch / DAY), oldDay = Math.floor(previous / DAY);
        if (currentDay > oldDay)
            this.closePeriod((currentDay - 1) * DAY, currentDay * DAY);
    }
    toSave() { return copy({ version: 44, simpleDelegated: this.simpleDelegated, rng: this.rng, seq: this.seq, epoch: this.epoch, delegated: this.delegated, needs: this.needs, quotes: this.quotes, orders: this.orders, customs: this.customs, policies: this.policies, claims: this.claims, customers: this.customers, complaints: this.complaints, parcels: this.parcels, constructionOffers: this.constructionOffers, buildings: this.buildings, campaigns: this.campaigns, warrantyClaims: this.warrantyClaims, replacementLeases: this.replacementLeases, ledger: this.ledger, events: this.events, seenServices: [...this.seenServices], seenIncidents: [...this.seenIncidents], closures: this.closures, serviceHistory: this.serviceHistory }); }
    loadFromSave(value) {
        if (!record(value) || value.version !== 44)
            return;
        const data = copy(value);
        const rows = (key, check) => { const input = data[key]; return Array.isArray(input) ? input.filter((row) => record(row) && typeof row.id === 'string' && check(row)) : []; };
        const finite = (row, ...keys) => keys.every(key => typeof row[key] === 'number' && Number.isFinite(row[key]));
        const text = (row, ...keys) => keys.every(key => typeof row[key] === 'string');
        this.needs = rows('needs', r => text(r, 'sourceId', 'family', 'location', 'depotId') && finite(r, 'capacity', 'quantity') && ['rame', 'service', 'fleet'].includes(String(r.source)));
        this.quotes = rows('quotes', r => text(r, 'needId', 'constructorId', 'modelId', 'seriesId') && finite(r, 'quantity', 'price', 'readyAt', 'quality'));
        this.orders = rows('orders', r => (r.configurationId === undefined || typeof r.configurationId === 'string' && typeof r.capacity === 'number' && Number.isFinite(r.capacity) && r.capacity > 0 && strings(r.equipment)) && text(r, 'quoteId', 'needId', 'constructorId', 'modelId', 'seriesId', 'location', 'depotId', 'livery') && finite(r, 'quantity', 'price', 'createdAt', 'readyAt', 'deliveryAt', 'warrantyUntil', 'delayDays', 'preparationAt') && ['configuration', 'assembly', 'factory-tests', 'ready', 'accepted', 'delivered', 'commissioned'].includes(String(r.stage)) && ['inspected', 'defect', 'defectCorrected', 'trained'].every(k => typeof r[k] === 'boolean') && strings(r.options) && strings(r.homologations) && strings(r.vehicleIds) && strings(r.replacementIds) && Array.isArray(r.installments) && r.installments.length === 3 && r.installments.every((v) => record(v) && text(v, 'id') && finite(v, 'at', 'amount') && typeof v.paid === 'boolean'));
        this.customs = rows('customs', r => text(r, 'lotId', 'contractId') && finite(r, 'eta', 'holdUntil', 'fee') && record(r.documents) && text(r.documents, 'origin', 'destination', 'cargo', 'contractId') && finite(r.documents, 'value') && ['documented', 'held', 'cleared'].includes(String(r.status)) && typeof r.broker === 'boolean' && typeof r.settled === 'boolean');
        this.policies = rows('policies', r => ['fleet', 'cargo'].includes(String(r.kind)) && finite(r, 'annualPremium', 'deductible', 'limit', 'createdAt', 'nextPremiumAt') && typeof r.active === 'boolean');
        this.claims = rows('claims', r => text(r, 'policyId', 'incidentId', 'reason') && finite(r, 'at', 'loss', 'award') && strings(r.proof) && ['open', 'expertise', 'decision', 'paid', 'denied'].includes(String(r.stage)));
        this.customers = rows('customers', r => ['passenger', 'freight'].includes(String(r.kind)) && text(r, 'interlocutor') && finite(r, 'satisfaction') && strings(r.serviceIds) && strings(r.complaintIds) && strings(r.contractIds) && Array.isArray(r.interactions) && r.interactions.every((v) => record(v) && finite(v, 'at') && text(v, 'label')));
        this.complaints = rows('complaints', r => text(r, 'customerId', 'serviceId', 'reason') && finite(r, 'at', 'value', 'credit') && ['delay', 'damage', 'delivery'].includes(String(r.cause)) && ['open', 'resolved'].includes(String(r.status)));
        this.parcels = rows('parcels', r => text(r, 'location') && finite(r, 'area', 'cost', 'rent', 'nextRentAt'));
        this.constructionOffers = rows('constructionOffers', r => text(r, 'parcelId', 'builderId') && ['depot', 'terminal', 'workshop', 'hub'].includes(String(r.kind)) && finite(r, 'price', 'durationDays', 'reliability'));
        this.buildings = rows('buildings', r => text(r, 'quoteId', 'parcelId', 'kind', 'location') && finite(r, 'price', 'startAt', 'completeAt') && ['study', 'works', 'equipment', 'commissioned'].includes(String(r.stage)) && typeof r.commissioned === 'boolean');
        this.campaigns = rows('campaigns', r => text(r, 'orderId', 'reason') && strings(r.vehicleIds) && finite(r, 'at', 'warrantyUntil') && typeof r.applied === 'boolean');
        this.warrantyClaims = rows('warrantyClaims', r => text(r, 'sourceId', 'workshopOrderId', 'factoryOrderId', 'vehicleId', 'partId', 'reason') && finite(r, 'reportedAt', 'warrantyUntil', 'partsCost', 'refund', 'quantity') && strings(r.proof) && ['requested', 'ready', 'paid', 'denied'].includes(String(r.stage)));
        this.replacementLeases = rows('replacementLeases', r => text(r, 'orderId', 'modelId', 'location', 'vehicleId') && finite(r, 'until', 'startedAt') && ['active', 'pending-release', 'released'].includes(String(r.status)));
        this.ledger = rows('ledger', r => text(r, 'activity', 'label') && finite(r, 'at', 'amount'));
        this.events = rows('events', r => text(r, 'kind', 'entityId', 'message') && finite(r, 'at'));
        const reports = data.closures;
        this.closures = Array.isArray(reports) ? reports.filter((r) => record(r) && finite(r, 'from', 'to', 'revenue', 'costs', 'result', 'cashflow', 'informationalCosts') && ['byActivity', 'byLine', 'byContract', 'byDepot', 'byFleet', 'bySupply'].every(k => record(r[k]) && Object.values(r[k]).every(v => typeof v === 'number' && Number.isFinite(v)))) : [];
        this.serviceHistory = rows('serviceHistory', r => text(r, 'customerId') && finite(r, 'at', 'delayMinutes', 'value') && ['passenger', 'freight'].includes(String(r.kind)) && ['damaged', 'delivered', 'available'].every(k => typeof r[k] === 'boolean'));
        this.rng = typeof data.rng === 'number' && Number.isFinite(data.rng) ? data.rng >>> 0 : 0x44e17;
        this.seq = typeof data.seq === 'number' && Number.isFinite(data.seq) ? Math.max(1, Math.floor(data.seq)) : 1;
        this.epoch = typeof data.epoch === 'number' && Number.isFinite(data.epoch) ? data.epoch : 0;
        this.delegated = data.delegated === true;
        this.simpleDelegated = data.simpleDelegated !== false;
        this.seenServices = new Set(strings(data.seenServices) ? data.seenServices : []);
        this.seenIncidents = new Set(strings(data.seenIncidents) ? data.seenIncidents : []);
    }
}
