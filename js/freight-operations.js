const key = value => String(value ?? '').trim();
const positive = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const intermodal = type => /^(containers(?:-|$)|swap-bodies|semi-trailers)/.test(key(type));
const clone = value => JSON.parse(JSON.stringify(value));
export class FreightOperations {
    constructor() {
        this.game = null;
        this.wagons = new Map();
        this.containers = new Map();
        this.terminals = new Map();
        this.handling = new Map();
        this.storedCargo = new Map();
        this.seededContracts = new Set();
        this.nextHandlingId = 1;
        this.exchangeContexts = new Map();
        this.serviceById = new Map();
        this.conditionEvents = new Set();
        this.lifecycle = new AssetLifecycle();
    }
    connectRuntime(game) { this.game = game; this.lifecycle.connectRuntime(game); return this; }
    nowMs() { return positive(this.game?.engine?.getSimulationEpochMs?.()); }
    rememberExchange(service, stationId, context) {
        this.serviceById.set(key(service.id), service);
        this.exchangeContexts.set(`${service.id}:${stationId}`, { ...context, stationId: key(stationId), stopIndex: service.currentStopIndex });
    }
    pendingQuantity(contractId, excludeServiceId = '') {
        return [...this.storedCargo.values()].filter(row => row.contractId === key(contractId)).reduce((sum, row) => sum + row.tonnes, 0)
            + [...this.handling.values()].filter(row => row.contractId === key(contractId) && (row.direction === 'return'
                || row.direction === 'load' && row.serviceId !== key(excludeServiceId)) && row.status !== 'completed').reduce((sum, row) => sum + row.tonnes, 0);
    }
    pendingForService(service, stationId = '') {
        return [...this.handling.values()].find(row => (row.serviceId === key(service.id) || row.otherServiceId === key(service.id)) && row.status !== 'completed'
            && (!stationId || row.stationId === key(stationId))) || null;
    }
    expert(systemId = null) {
        return systemId
            ? this.game?.resolveRealismPolicy?.(systemId)?.enforce ?? this.game?.realismSettings?.difficulty === 'expert'
            : this.game?.realismSettings?.difficulty === 'expert';
    }
    configureTerminal(stationId, config = {}) {
        const id = key(stationId);
        if (!id)
            throw new Error('Gare du terminal requise.');
        const previous = this.terminals.get(id);
        this.terminals.set(id, { stationId: id, open: config.open !== false,
            capacityTonnes: positive(config.capacityTonnes ?? previous?.capacityTonnes ?? 1000000),
            capacityContainers: Math.floor(positive(config.capacityContainers ?? previous?.capacityContainers ?? 1000000)),
            loadingTonnesPerMinute: positive(config.loadingTonnesPerMinute ?? previous?.loadingTonnesPerMinute ?? 20),
            unloadingTonnesPerMinute: positive(config.unloadingTonnesPerMinute ?? previous?.unloadingTonnesPerMinute ?? 20),
            cranes: Math.floor(positive(config.cranes ?? previous?.cranes ?? 0)),
            forbiddenHazardClasses: [...new Set((config.forbiddenHazardClasses ?? previous?.forbiddenHazardClasses ?? []).map(key).filter(Boolean))] });
        return this.terminals.get(id);
    }
    terminal(stationId) {
        const id = key(stationId), explicit = this.terminals.get(id);
        if (explicit)
            return explicit;
        const ite = this.game?.depotManager?.getITEs?.().find(row => row.built && key(row.stationId) === id);
        const modules = this.game?.iteModules;
        const cranes = ite ? positive(modules?.getCraneCount?.(ite.id)) : 0;
        const rate = ite ? 20 / Math.max(.05, positive(modules?.getLoadingSpeedMultiplier?.(ite.id)) || 1) : 20;
        return { stationId: id, open: this.game?.world?.getStationById?.(id)?.closed !== true,
            capacityTonnes: ite ? positive(modules?.getStorageCapacity?.(ite.id)) || 1000000 : 1000000,
            loadingTonnesPerMinute: rate, unloadingTonnesPerMinute: rate,
            cranes, capacityContainers: 1000000, forbiddenHazardClasses: [] };
    }
    wagonMembers(service) {
        const details = service?.rame?.elementDetails || [];
        const formation = service?._v2FormationMembers || [];
        return details.map((detail, index) => {
            const member = formation[index];
            const vehicle = member?.vehicleId ? this.game?.rotationV2?.getVehicle?.(member.vehicleId) : null;
            const sourceRame = vehicle?.sourceRameId ? this.game?.rameManager?.getById?.(vehicle.sourceRameId) : null;
            const source = sourceRame?.elementDetails?.[vehicle?.sourceRameElementIndex];
            const physical = key(detail.physicalVehicleId || source?.physicalVehicleId);
            const id = physical ? `owned:${physical}` : key(member?.vehicleId)
                || `rame:${key(service?.rame?.id || service?.id)}:${key(detail.elementId) || index}`;
            return { id, detail, index, capacity: positive(detail.freightCapacity), length: positive(detail.length) || 15 };
        }).filter(row => key(row.detail.category).toLowerCase() === 'wagon' && row.capacity > 0);
    }
    location(service, fallback = '') {
        const stopped = service?.train?.stoppedAt;
        const live = key(stopped?.id || (typeof stopped === 'string' ? stopped : ''));
        if (live)
            return live;
        if (['moving', 'departing'].includes(service?.state))
            return '';
        return key(service?.rame?.currentLocation?.stationId || service?._lastFreightStationId || fallback);
    }
    registerService(service, stationId = '') {
        if (service?.id)
            this.serviceById.set(key(service.id), service);
        const station = this.location(service, stationId);
        for (const member of this.wagonMembers(service)) {
            if (!this.wagons.has(member.id))
                this.wagons.set(member.id, {
                    id: member.id, stationId: station, lastStationId: station, serviceId: '',
                    capacity: member.capacity, cargoType: '', tonnes: 0, contractId: '', containerIds: []
                });
            const row = this.wagons.get(member.id);
            // Legacy saves can register a wagon before a station is known. An
            // actual stationary service supplies its first observed location.
            // Never overwrite a known location or another physical owner.
            const observed = key(service?.train?.stoppedAt?.id || service?.rame?.currentLocation?.stationId);
            if (station && observed === station && !['moving', 'departing'].includes(service?.state)
                && !row.stationId && !row.lastStationId && !row.serviceId && !row.tonnes && !row.reservedTonnes)
                Object.assign(row, { stationId: station, lastStationId: station });
            Object.assign(row, { capacity: member.capacity, cargoTypes: [...(member.detail.cargoTypes || [])] });
        }
        return this.wagonMembers(service);
    }
    registerWagon(vehicleId, stationId) {
        const id = key(vehicleId), station = key(stationId);
        const inventory = globalThis.window?.__reDefinitif?.inventory || this.game?.inventory;
        const ownedId = id.replace(/^owned:/, '');
        const owned = inventory?.read?.(Number(ownedId));
        const vehicle = this.game?.rotationV2?.getVehicle?.(id);
        const services = this.game?.scheduleCreator?.services || [];
        const member = services.flatMap(service => this.wagonMembers(service)).find(row => row.id === id || row.id === `owned:${ownedId}`);
        if (!station || !member && !vehicle || inventory && id.startsWith('owned:') && (!owned || ['sold', 'withdrawn'].includes(owned.status)))
            throw new Error('Wagon physique possédé introuvable.');
        const physicalId = member?.id || id;
        if (this.wagons.has(physicalId)) {
            const row = this.wagons.get(physicalId);
            if (row.serviceId || row.tonnes > 0 || row.stationId && row.stationId !== station)
                throw new Error('Wagon occupé ou situé ailleurs : repositionnement physique requis.');
            return row;
        }
        const row = { id: physicalId, stationId: station, lastStationId: station, serviceId: '',
            capacity: member?.capacity || positive(vehicle?.freightCapacity), cargoTypes: [...(member?.detail.cargoTypes || vehicle?.cargoTypes || [])],
            cargoType: '', tonnes: 0, contractId: '', containerIds: [] };
        this.wagons.set(physicalId, row);
        return row;
    }
    cargoCompatible(member, type) {
        return (member.detail.cargoTypes || []).some(cargo => key(cargo) === type
            || key(cargo).split('-')[0] === type.split('-')[0]);
    }
    availableCapacity(service, contract, stationId = contract?.fromId) {
        let capacity = 0;
        for (const member of this.registerService(service, stationId)) {
            const row = this.wagons.get(member.id);
            const types = contract?.diffuse ? contract.cargoTypes : [contract?.cargoType || contract];
            if (!types.some(type => this.cargoCompatible(member, key(type))))
                continue;
            if (row.stationId !== key(stationId) || row.serviceId && row.serviceId !== key(service.id))
                continue;
            if (row.tonnes > 0 && row.contractId !== key(contract?.id))
                continue;
            capacity += Math.max(0, member.capacity - row.tonnes);
        }
        return capacity;
    }
    hazardProfile(type) {
        return this.game?.cargoTypes?.getHazardProfile?.(type) || null;
    }
    diagnose(service, prospective = []) {
        if (this.game?.resolveRealismPolicy?.('hazardous')?.enabled === false)
            return [];
        const members = this.wagonMembers(service);
        const cargos = members.flatMap(member => {
            const row = this.wagons.get(member.id);
            return row?.tonnes > 0 ? [{ ...member, cargoType: row.cargoType, tonnes: row.tonnes }] : [];
        });
        for (const row of prospective)
            if (!cargos.some(cargo => cargo.id === row.id))
                cargos.push(row);
        const dangerous = cargos.map(row => ({ ...row, profile: this.hazardProfile(row.cargoType) })).filter(row => row.profile?.class);
        const issues = [];
        const places = [...(service?.route || service?._route || []), ...(service?.getCurrentStops?.() || service?.stops || []).map(stop => ({ ...stop, ...this.game?.world?.getStationById?.(stop.stationId) }))];
        const hazardousTonnes = dangerous.reduce((sum, row) => sum + positive(row.tonnes), 0);
        const limited = places.find(place => Number.isFinite(Number(place?.maxHazardTonnes)) && place.maxHazardTonnes != null && hazardousTonnes > positive(place.maxHazardTonnes));
        if (limited)
            issues.push({ code: 'HAZARD_QUANTITY', message: `Limite ${limited.maxHazardTonnes} t de marchandises dangereuses sur le trajet (${hazardousTonnes} t).` });
        for (let i = 0; i < dangerous.length; i++) {
            const a = dangerous[i];
            for (let j = i + 1; j < dangerous.length; j++) {
                const b = dangerous[j];
                if ((a.profile.incompatibleClasses || []).includes(b.profile.class)
                    || (b.profile.incompatibleClasses || []).includes(a.profile.class))
                    issues.push({ code: 'HAZARD_INCOMPATIBLE', message: `Classes ${a.profile.class} et ${b.profile.class} incompatibles dans la composition.` });
                const separation = members.filter(member => member.index > Math.min(a.index, b.index) && member.index < Math.max(a.index, b.index))
                    .reduce((sum, member) => sum + member.length, 0);
                const minimum = Math.max(positive(a.profile.safetyDistanceMeters), positive(b.profile.safetyDistanceMeters));
                if (a.profile.class !== b.profile.class && minimum > separation)
                    issues.push({ code: 'HAZARD_DISTANCE', message: `Distance de sécurité ${minimum} m requise entre ${a.id} et ${b.id} (${separation} m).` });
            }
            if (places.some(place => place?.hazardProhibited === true || (place?.forbiddenHazardClasses || []).map(key).includes(a.profile.class)))
                issues.push({ code: 'HAZARD_ROUTE', message: `Trafic classe ${a.profile.class} interdit sur une gare ou une section du trajet.` });
        }
        return issues;
    }
    checkTerminal(service, stationId, cargoType) {
        const terminal = this.terminal(stationId), profile = this.hazardProfile(cargoType);
        const issues = [];
        if (!terminal.open)
            issues.push({ code: 'TERMINAL_CLOSED', message: `Terminal ${stationId} fermé.` });
        if (this.expert('intermodal') && intermodal(cargoType) && terminal.cranes < 1)
            issues.push({ code: 'NO_CRANE', message: `Terminal ${stationId} : portique ou grue requis pour ${cargoType}.` });
        if (this.expert('hazardous') && profile?.class && terminal.forbiddenHazardClasses.includes(profile.class))
            issues.push({ code: 'HAZARD_TERMINAL', message: `Terminal ${stationId} interdit à la classe ${profile.class}.` });
        service._freightDiagnostic = issues[0]?.message || '';
        return { ok: !this.expert() || !issues.length, issues, terminal };
    }
    containerStockRoom(contract) {
        const boxes = [...this.containers.values()].filter(box => box.contractId === key(contract?.id) && box.loaded);
        const packaged = boxes.reduce((sum, box) => sum + box.tonnes, 0);
        const physicallyCarried = boxes.filter(box => box.wagonId).reduce((sum, box) => sum + box.tonnes, 0);
        const historicalTransit = Math.max(0, positive(contract?.inTransitQuantity) - physicallyCarried);
        return Math.max(0, positive(contract?.quantity) - packaged - historicalTransit);
    }
    registerContainer(input) {
        const id = key(input?.id), stationId = key(input?.stationId);
        if (!id || !stationId || this.containers.has(id))
            throw new Error('Identité de conteneur unique et terminal requis.');
        const tonnes = positive(input.tonnes);
        if (tonnes > 0) {
            const contract = this.game?.freightManager?.contracts?.find(row => row.id === key(input.contractId) && row.active);
            if (!contract || contract.fromId !== stationId || contract.cargoType !== key(input.cargoType)
                || tonnes > this.containerStockRoom(contract) + 1e-9)
                throw new Error('Marchandise réelle du contrat indisponible au terminal.');
        }
        const row = { id, cargoType: key(input.cargoType) || 'containers-20', tonnes,
            loaded: input.loaded !== false && tonnes > 0, stationId, wagonId: '', contractId: key(input.contractId),
            kind: input.kind === 'swap-body' ? 'swap-body' : 'container' };
        this.containers.set(id, row);
        return row;
    }
    transferContainer(containerId, target) {
        const box = this.containers.get(key(containerId));
        if (!box || box.reservedServiceId || box.transferJobId)
            throw new Error('Conteneur indisponible ou déjà réservé.');
        const sourceRow = box.wagonId ? this.wagons.get(box.wagonId) : null;
        const services = this.game?.scheduleCreator?.services || [];
        const sourceService = sourceRow ? services.find(service => key(service.id) === sourceRow.serviceId) : null;
        const sourceStation = sourceRow ? this.location(sourceService) : box.stationId;
        if (!sourceStation)
            throw new Error('Conteneur en mouvement : attendre son arrivée réelle.');
        const targetService = target.serviceId ? services.find(service => key(service.id) === key(target.serviceId)) : null;
        const stationId = targetService ? this.location(targetService) : key(target.stationId);
        if (!stationId || target.serviceId && !targetService)
            throw new Error('Destination du transfert introuvable.');
        const roadTransfer = stationId !== sourceStation;
        if (roadTransfer && (sourceRow || targetService || !(positive(target.durationMs) > 0)))
            throw new Error('Transport routier entre terminaux : durée réelle et conteneur au sol requis.');
        let wagonId = '';
        if (targetService) {
            const member = this.registerService(targetService, stationId).find(row => row.id === key(target.wagonId));
            if (!member || !this.cargoCompatible(member, box.cargoType))
                throw new Error('Wagon physique compatible absent du train destinataire.');
            const row = this.wagons.get(member.id);
            if (row.serviceId && row.serviceId !== key(targetService.id) || row.reservedTonnes > 0 || row.tonnes + box.tonnes > row.capacity
                || row.contractId && box.contractId && row.contractId !== box.contractId)
                throw new Error('Wagon destinataire occupé.');
            const issues = this.diagnose(targetService, [{ ...member, cargoType: box.cargoType }]);
            if (this.expert() && issues.length)
                throw new Error(issues[0].message);
            wagonId = member.id;
        }
        const terminal = this.terminal(sourceStation);
        if (this.expert() && !terminal.open || this.expert('intermodal') && terminal.cranes < 1)
            throw new Error('Terminal fermé ou grue indisponible.');
        const now = this.nowMs(), service = targetService || sourceService || { id: `road:${containerId}` };
        const eventKey = `container-transfer:${containerId}:${now}:${stationId}:${wagonId}`;
        const job = this.startHandling(service, sourceStation, 'transfer', Math.max(1, box.tonnes), box.cargoType, eventKey);
        Object.assign(job, { transfer: { containerId: box.id, sourceWagonId: box.wagonId, sourceServiceId: key(sourceService?.id),
                targetWagonId: wagonId, targetServiceId: key(targetService?.id), stationId },
            otherServiceId: key(sourceService?.id), cost: positive(target.cost) });
        if (roadTransfer)
            job.dueMs = now + positive(target.durationMs);
        box.transferJobId = job.id;
        if (wagonId)
            Object.assign(this.wagons.get(wagonId), { reservedTonnes: box.tonnes, serviceId: key(targetService.id), transferJobId: job.id });
        if (!this.expert()) {
            job.dueMs = now;
            this.completeContainerTransfer(job);
        }
        return job;
    }
    completeContainerTransfer(job) {
        const transfer = job.transfer, box = this.containers.get(transfer.containerId);
        if (!box || box.transferJobId !== job.id)
            return;
        const services = this.game?.scheduleCreator?.services || [];
        const source = services.find(service => key(service.id) === transfer.sourceServiceId);
        const destination = services.find(service => key(service.id) === transfer.targetServiceId);
        if (source && this.location(source) !== job.stationId || destination && this.location(destination) !== transfer.stationId)
            return;
        const terminal = this.terminal(transfer.stationId);
        const occupants = [...this.containers.values()].filter(other => other.stationId === transfer.stationId && !other.wagonId && other.id !== box.id).length;
        if (this.expert() && !transfer.targetWagonId && (!terminal.open || occupants >= terminal.capacityContainers))
            return;
        const contract = this.game?.freightManager?.contracts?.find(row => row.id === box.contractId);
        if (job.cost > 0)
            this.game.economy.settleEvent(job.eventKey + ':cost', { kind: 'expense', amount: job.cost, category: 'intermodal', description: `Transfert conteneur ${box.id}` });
        const sourceRow = this.wagons.get(transfer.sourceWagonId), destinationRow = this.wagons.get(transfer.targetWagonId);
        if (transfer.targetWagonId && (!destinationRow || destinationRow.transferJobId !== job.id
            || destinationRow.tonnes + box.tonnes > destinationRow.capacity))
            return;
        if (sourceRow) {
            sourceRow.containerIds = sourceRow.containerIds.filter(id => id !== box.id);
            sourceRow.tonnes = Math.max(0, sourceRow.tonnes - box.tonnes);
            if (source && box.loaded)
                source._contractFreight = Math.max(0, positive(source._contractFreight) - box.tonnes);
            if (contract && source)
                contract.loadedByService[source.id] = Math.max(0, positive(contract.loadedByService[source.id]) - box.tonnes);
            if (!sourceRow.tonnes) {
                sourceRow.contractId = '';
                sourceRow.cargoType = '';
            }
        }
        if (destinationRow) {
            destinationRow.reservedTonnes = 0;
            destinationRow.transferJobId = '';
            destinationRow.containerIds.push(box.id);
            destinationRow.tonnes += box.tonnes;
            destinationRow.serviceId = key(destination.id);
            destinationRow.contractId = box.contractId;
            destinationRow.cargoType = box.loaded ? box.cargoType : '';
            if (box.loaded) {
                destination._contractFreight = positive(destination._contractFreight) + box.tonnes;
                destination._contractCargoId = box.contractId;
                if (contract)
                    contract.loadedByService[destination.id] = positive(contract.loadedByService[destination.id]) + box.tonnes;
            }
        }
        box.wagonId = transfer.targetWagonId;
        box.stationId = transfer.targetWagonId ? '' : transfer.stationId;
        box.transferJobId = '';
        job.status = 'completed';
        this.game?.emitDomainEvent?.({ eventId: job.eventKey, simEpochMs: this.nowMs(), type: 'container-transferred', resourceIds: [box.id], payload: clone(transfer) });
    }
    purchaseContainer(input, cost = 3000) {
        if (!key(input?.id) || !key(input?.stationId) || this.containers.has(key(input.id)))
            throw new Error('Identité de conteneur unique et terminal requis.');
        const price = positive(cost);
        if (!(price > 0))
            throw new Error('Prix de conteneur requis.');
        if (this.expert() && positive(this.game?.economy?.balance) < price)
            throw new Error('Solde insuffisant.');
        const contract = this.game?.freightManager?.contracts?.find(row => row.id === key(input.contractId) && row.active);
        if (positive(input.tonnes) > 0) {
            if (!contract || contract.fromId !== key(input.stationId) || contract.cargoType !== key(input.cargoType)
                || positive(input.tonnes) > this.containerStockRoom(contract) + 1e-9)
                throw new Error('Marchandise réelle du contrat indisponible au terminal.');
        }
        if (!this.game?.economy?.addExpense?.(price, 'container', `Achat conteneur ${input.id}`))
            throw new Error('Paiement du conteneur refusé.');
        return this.registerContainer(input);
    }
    startHandling(service, stationId, direction, tonnes, cargoType, eventKey) {
        if (!(tonnes > 0))
            return null;
        const duplicate = [...this.handling.values()].find(row => row.eventKey === eventKey);
        if (duplicate)
            return duplicate;
        const terminal = this.terminal(stationId), now = this.nowMs();
        let serialEnd = now;
        for (const pending of this.handling.values())
            if (pending.stationId === key(stationId) && pending.status !== 'completed')
                serialEnd = Math.max(serialEnd, pending.dueMs);
        const rate = direction === 'load' ? terminal.loadingTonnesPerMinute : terminal.unloadingTonnesPerMinute;
        const effectiveRate = Math.max(.01, rate) * (intermodal(cargoType) ? Math.max(1, terminal.cranes) : 1);
        const row = { id: `handling-${this.nextHandlingId++}`, serviceId: key(service.id), stationId: key(stationId),
            direction, tonnes, cargoType, eventKey, startedMs: serialEnd, status: this.expert() ? 'pending' : 'ready',
            context: clone(this.exchangeContexts.get(`${service.id}:${stationId}`) || null),
            dueMs: serialEnd + Math.ceil(tonnes / effectiveRate * 60000) };
        this.handling.set(row.id, row);
        return row;
    }
    genericContract(service, stationId, manifest, loading) {
        const existing = [...this.handling.values()].find(job => job.generic && job.serviceId === key(service.id)
            && job.direction === (loading ? 'load' : 'unload') && job.status !== 'completed');
        if (existing)
            return existing.generic;
        const carried = this.wagonMembers(service).map(member => this.wagons.get(member.id)).find(row => row?.tonnes > 0 && row.contractId?.startsWith('generic:'));
        const context = this.exchangeContexts.get(`${service.id}:${stationId}`);
        const types = [...new Set(manifest.map(line => key(line.type)))];
        return { id: carried?.contractId || `generic:${service.id}:${context?.visitId || this.nowMs()}`,
            fromId: key(stationId), cargoType: types[0] || key(service._genericCargoType), cargoTypes: types, diffuse: types.length > 1, deliveredQuantity: 0 };
    }
    loadGeneric(service, stationId, manifest) {
        const contract = this.genericContract(service, stationId, manifest, true);
        const amount = this.loadContract(service, contract, manifest.reduce((sum, line) => sum + positive(line.tonnes), 0), manifest);
        const job = [...this.handling.values()].find(row => row.contractId === contract.id && row.serviceId === key(service.id) && row.direction === 'load');
        if (job)
            job.generic = contract;
        return amount;
    }
    unloadGeneric(service, stationId, wanted) {
        const manifest = service._genericManifest || [{ type: service._genericCargoType, tonnes: wanted }];
        const contract = this.genericContract(service, stationId, manifest, false);
        const amount = this.unloadContract(service, contract, stationId, wanted);
        const job = [...this.handling.values()].find(row => row.contractId === contract.id && row.serviceId === key(service.id) && row.direction === 'unload');
        if (job)
            job.generic = contract;
        return amount;
    }
    reportCargoCondition(contractId, condition, eventId) {
        const value = Number(condition), id = key(eventId);
        if (!id || this.conditionEvents.has(id) || !Number.isFinite(value) || value < 0 || value > 1)
            return false;
        const rows = [...this.wagons.values()].filter(row => row.contractId === key(contractId) && row.tonnes > 0);
        if (!rows.length)
            return false;
        for (const row of rows)
            row.cargoCondition = Math.min(row.cargoCondition ?? 1, value);
        this.conditionEvents.add(id);
        this.game?.emitDomainEvent?.({ eventId: id, simEpochMs: this.nowMs(), type: 'cargo-condition-observed', resourceIds: rows.map(row => row.id), payload: { contractId: key(contractId), condition: value } });
        return true;
    }
    loadContract(service, contract, wanted, manifest = null) {
        if (!(wanted > 0))
            return 0;
        const origin = key(contract.fromId), check = this.checkTerminal(service, origin, contract.cargoType);
        if (!check.ok)
            return 0;
        const pending = [...this.handling.values()].find(row => row.serviceId === key(service.id) && row.contractId === key(contract.id)
            && row.direction === 'load' && row.status !== 'completed');
        if (pending) {
            if (pending.status !== 'ready')
                return 0;
            let loaded = 0;
            for (const item of pending.plan || []) {
                const row = this.wagons.get(item.id);
                if (!row || row.pendingContractId !== key(contract.id) || row.serviceId !== key(service.id) || row.stationId !== origin)
                    return 0;
                for (const id of item.containerIds)
                    if (this.containers.get(id)?.reservedServiceId !== key(service.id))
                        return 0;
            }
            for (const item of pending.plan || []) {
                const row = this.wagons.get(item.id);
                Object.assign(row, { cargoType: item.cargoType, tonnes: item.tonnes, contractId: key(contract.id), cargoCondition: 1,
                    reservedTonnes: 0, pendingContractId: '', containerIds: [...item.containerIds] });
                for (const id of item.containerIds) {
                    const box = this.containers.get(id);
                    box.wagonId = row.id;
                    box.stationId = '';
                    box.reservedServiceId = '';
                }
                loaded += item.tonnes;
            }
            pending.status = 'completed';
            this.game?.emitDomainEvent?.({ eventId: pending.eventKey, simEpochMs: this.nowMs(), type: 'freight-loaded',
                resourceIds: pending.plan.map(item => item.id), payload: { contractId: contract.id, tonnes: loaded } });
            return loaded;
        }
        const members = this.registerService(service, origin), plan = [], quantities = manifest || [{ type: contract.cargoType, tonnes: wanted }];
        let remaining = wanted;
        for (const line of quantities) {
            let lineLeft = Math.min(remaining, positive(line.tonnes));
            for (const member of members) {
                const row = this.wagons.get(member.id);
                if (!this.cargoCompatible(member, key(line.type)) || plan.some(item => item.id === member.id))
                    continue;
                if (row.stationId !== origin || row.serviceId && row.serviceId !== key(service.id) || row.tonnes > 0 || row.reservedTonnes > 0)
                    continue;
                const tonnes = Math.min(lineLeft, member.capacity);
                if (tonnes > 0)
                    plan.push({ ...member, cargoType: key(line.type), tonnes });
                lineLeft -= tonnes;
                remaining -= tonnes;
                if (!(lineLeft > 0))
                    break;
            }
        }
        const issues = this.diagnose(service, plan);
        if (issues.length)
            service._freightDiagnostic = issues[0].message;
        if (this.expert() && issues.length)
            return 0;
        let loaded = 0;
        const allocation = [];
        for (const item of plan) {
            const row = this.wagons.get(item.id), boxes = [];
            let tonnes = item.tonnes;
            if (intermodal(item.cargoType)) {
                tonnes = 0;
                for (const container of this.containers.values()) {
                    if (container.contractId !== key(contract.id) || container.stationId !== origin || !container.loaded || container.wagonId || container.reservedServiceId)
                        continue;
                    if (container.tonnes > item.tonnes - tonnes + 1e-9)
                        continue;
                    boxes.push(container);
                    tonnes += container.tonnes;
                }
                if (!this.expert('intermodal') && tonnes === 0)
                    tonnes = item.tonnes;
            }
            if (!(tonnes > 0))
                continue;
            Object.assign(row, { stationId: origin, lastStationId: origin, serviceId: key(service.id), reservedTonnes: tonnes, pendingContractId: key(contract.id) });
            for (const box of boxes)
                box.reservedServiceId = key(service.id);
            allocation.push({ id: item.id, cargoType: item.cargoType, tonnes, containerIds: boxes.map(box => box.id) });
            loaded += tonnes;
        }
        if (loaded > 0) {
            service._lastFreightStationId = origin;
            const context = this.exchangeContexts.get(`${service.id}:${origin}`);
            const job = this.startHandling(service, origin, 'load', loaded, contract.cargoType, `load:${contract.id}:${service.id}:${context?.visitId || this.nowMs()}:${positive(contract.deliveredQuantity)}`);
            job.plan = allocation;
            job.contractId = key(contract.id);
            if (!this.expert())
                return this.loadContract(service, contract, wanted, manifest);
        }
        if (!(loaded > 0))
            service._freightDiagnostic = intermodal(contract.cargoType)
                ? 'Conteneur chargé réel indisponible au terminal d’origine.' : 'Wagon physique indisponible à l’origine : repositionnement requis.';
        return 0;
    }
    unloadContract(service, contract, stationId, wanted) {
        const check = this.checkTerminal(service, stationId, contract.cargoType);
        if (!check.ok)
            return 0;
        const rows = this.wagonMembers(service).map(member => this.wagons.get(member.id))
            .filter(row => row?.contractId === key(contract.id) && row.serviceId === key(service.id));
        // Historical payloads without a physical ledger migrate on their first
        // actual arrival; no fabricated wagon is added to the formation.
        if (!rows.length)
            return wanted;
        let pending = [...this.handling.values()].find(job => job.direction === 'unload' && job.serviceId === key(service.id)
            && job.contractId === key(contract.id) && job.stationId === key(stationId) && job.status !== 'completed');
        if (!pending) {
            const context = this.exchangeContexts.get(`${service.id}:${stationId}`);
            pending = this.startHandling(service, stationId, 'unload', Math.min(wanted, rows.reduce((sum, row) => sum + row.tonnes, 0)), contract.cargoType, `unload:${contract.id}:${service.id}:${context?.visitId || this.nowMs()}:${positive(contract.deliveredQuantity)}`);
            pending.contractId = key(contract.id);
        }
        if (pending.status !== 'ready')
            return 0;
        const storedContainers = [...this.containers.values()].filter(box => box.stationId === key(stationId) && !box.wagonId).length;
        let containerSlots = Math.max(0, (check.terminal.capacityContainers ?? 1000000) - storedContainers);
        if (this.expert() && intermodal(contract.cargoType) && !containerSlots) {
            service._freightDiagnostic = `Terminal ${stationId} plein.`;
            return 0;
        }
        let remaining = wanted;
        const stored = [...this.containers.values()].filter(box => box.stationId === key(stationId) && box.loaded).reduce((sum, box) => sum + box.tonnes, 0);
        if (this.expert() && intermodal(contract.cargoType))
            remaining = Math.min(remaining, Math.max(0, check.terminal.capacityTonnes - stored));
        let unloaded = 0;
        let conditionPoints = 0;
        for (const row of rows) {
            let tonnes = Math.min(remaining, row.tonnes);
            if (row.containerIds.length) {
                tonnes = 0;
                const keep = [];
                for (const id of row.containerIds) {
                    const box = this.containers.get(id);
                    if (box && box.tonnes <= remaining - tonnes + 1e-9 && (!this.expert() || containerSlots > 0)) {
                        tonnes += box.tonnes;
                        box.stationId = key(stationId);
                        box.wagonId = '';
                        box.loaded = false;
                        box.tonnes = 0;
                        containerSlots--;
                    }
                    else
                        keep.push(id);
                }
                row.containerIds = keep;
            }
            row.tonnes = Math.max(0, row.tonnes - tonnes);
            row.stationId = key(stationId);
            row.lastStationId = key(stationId);
            if (!row.tonnes) {
                row.cargoType = '';
                row.contractId = '';
            }
            unloaded += tonnes;
            remaining -= tonnes;
            conditionPoints += tonnes * (row.cargoCondition ?? 1);
            if (!(remaining > 0))
                break;
        }
        if (unloaded > 0) {
            service._lastDeliveredFreightQuality = { cargoCondition: conditionPoints / unloaded, deliveredAtMs: this.nowMs(), contractId: key(contract.id) };
            service._lastFreightStationId = key(stationId);
            pending.status = 'completed';
            this.game?.emitDomainEvent?.({ eventId: pending.eventKey, simEpochMs: this.nowMs(), type: 'freight-unloaded',
                resourceIds: rows.map(row => row.id), payload: { contractId: contract.id, tonnes: unloaded, stationId } });
        }
        return unloaded;
    }
    returnServiceCargo(service) {
        const station = this.location(service);
        if (!station)
            return { deferred: true };
        for (const [id, job] of this.handling)
            if (job.serviceId === key(service.id) || job.otherServiceId === key(service.id)) {
                for (const item of job.plan || []) {
                    const row = this.wagons.get(item.id);
                    if (row) {
                        row.reservedTonnes = 0;
                        row.pendingContractId = '';
                        row.serviceId = '';
                    }
                    for (const boxId of item.containerIds || []) {
                        const box = this.containers.get(boxId);
                        if (box)
                            box.reservedServiceId = '';
                    }
                }
                if (job.transfer) {
                    const box = this.containers.get(job.transfer.containerId);
                    if (box)
                        box.transferJobId = '';
                    const target = this.wagons.get(job.transfer.targetWagonId);
                    if (target?.transferJobId === job.id) {
                        target.transferJobId = '';
                        target.reservedTonnes = 0;
                        if (!target.tonnes)
                            target.serviceId = '';
                    }
                }
                this.handling.delete(id);
            }
        const rows = this.wagonMembers(service).map(member => this.wagons.get(member.id)).filter(row => row?.serviceId === key(service.id) && row.tonnes > 0);
        for (const row of rows) {
            row.stationId = station;
            row.lastStationId = station;
        }
        for (const contractId of new Set(rows.map(row => row.contractId))) {
            const group = rows.filter(row => row.contractId === contractId), quantity = group.reduce((sum, row) => sum + row.tonnes, 0);
            const job = this.startHandling(service, station, 'return', quantity, group[0].cargoType, `cargo-return:${contractId}:${service.id}:${this.nowMs()}`);
            job.contractId = contractId;
            job.returnPlan = group.map(row => ({ id: row.id, tonnes: row.tonnes, cargoType: row.cargoType, cargoCondition: row.cargoCondition ?? 1, containerIds: [...row.containerIds] }));
            if (!this.expert()) {
                job.status = 'ready';
                this.completeCargoReturn(job);
            }
        }
        return { deferred: rows.length > 0 };
    }
    completeCargoReturn(job) {
        const contract = this.game?.freightManager?.contracts?.find(row => row.id === job.contractId);
        const terminal = this.terminal(job.stationId);
        if (this.expert() && (!terminal.open || intermodal(job.cargoType) && this.expert('intermodal') && terminal.cranes < 1))
            return;
        const atOrigin = contract?.fromId === job.stationId;
        for (const item of job.returnPlan || []) {
            const row = this.wagons.get(item.id);
            if (!row || row.tonnes < item.tonnes || row.stationId && row.stationId !== job.stationId)
                return;
        }
        for (const item of job.returnPlan || []) {
            const row = this.wagons.get(item.id);
            for (const id of item.containerIds) {
                const box = this.containers.get(id);
                if (box) {
                    box.stationId = job.stationId;
                    box.wagonId = '';
                    if (atOrigin && !contract?.active) {
                        box.tonnes = 0;
                        box.loaded = false;
                    }
                }
            }
            if (!atOrigin && !item.containerIds.length)
                this.storedCargo.set(`${job.id}:${item.id}`, { ...item, stationId: job.stationId, contractId: job.contractId });
            Object.assign(row, { stationId: job.stationId, lastStationId: job.stationId, tonnes: 0, cargoType: '', contractId: '', containerIds: [], serviceId: '' });
        }
        if (atOrigin && contract && !contract.active)
            this.game.freightManager._returnIndustrialReservation?.(contract, job.tonnes);
        job.status = 'completed';
        this.game?.freightManager?._pruneSettledRemovals?.();
        this.game?.emitDomainEvent?.({ eventId: job.eventKey, simEpochMs: this.nowMs(), type: 'cargo-returned-at-terminal', resourceIds: (job.returnPlan || []).map(item => item.id), payload: { stationId: job.stationId, contractId: job.contractId, tonnes: job.tonnes, atOrigin } });
    }
    syncServices(services, nowMs = this.nowMs(), game = null) {
        if (game)
            this.connectRuntime(game);
        this.lifecycle.advance(nowMs);
        const byId = new Map((services || []).map(service => [key(service.id), service]));
        for (const service of services || []) {
            const members = this.registerService(service);
            if (['moving', 'departing'].includes(service.state))
                for (const member of members) {
                    const row = this.wagons.get(member.id);
                    const origin = key(service._lastFreightStationId || service.rame?.currentLocation?.stationId
                        || (service.getCurrentStops?.() || service.stops || [])[Math.max(0, (service.currentStopIndex || 0) - 1)]?.stationId);
                    if (!row.serviceId && (!row.stationId || row.stationId === origin))
                        row.serviceId = key(service.id);
                }
        }
        for (const row of this.wagons.values()) {
            const service = byId.get(row.serviceId);
            if (!service)
                continue;
            const carries = this.wagonMembers(service).some(member => member.id === row.id);
            const station = this.location(service);
            if (carries) {
                if (['moving', 'departing'].includes(service.state))
                    row.stationId = '';
                else if (station) {
                    row.stationId = station;
                    row.lastStationId = station;
                }
            }
            if ((!carries || ['completed', 'cancelled'].includes(service.state)) && station)
                row.serviceId = '';
        }
        this.advancePending(nowMs);
    }
    advancePending(nowMs = this.nowMs(), game = null) {
        if (game)
            this.connectRuntime(game);
        this.lifecycle.advance(nowMs);
        if (!this.handling.size)
            return;
        const byId = this.serviceById;
        for (const job of this.handling.values()) {
            if (job.status === 'completed' || job.dueMs > nowMs)
                continue;
            job.status = 'ready';
            if (job.returnPlan) {
                this.completeCargoReturn(job);
                continue;
            }
            if (job.transfer) {
                this.completeContainerTransfer(job);
                continue;
            }
            const service = byId.get(job.serviceId), contract = job.generic || this.game?.freightManager?.contracts?.find(row => row.id === job.contractId);
            if (!service)
                continue; // Runtime references are rebuilt after an import before committing a due job.
            if (!job.generic && !contract?.active) {
                if (job.direction === 'load') {
                    for (const row of this.wagons.values())
                        if (row.pendingContractId === job.contractId && row.serviceId === job.serviceId) {
                            row.reservedTonnes = 0;
                            row.pendingContractId = '';
                            row.serviceId = '';
                        }
                    for (const box of this.containers.values())
                        if (box.reservedServiceId === job.serviceId)
                            box.reservedServiceId = '';
                    job.status = 'completed';
                }
                continue;
            }
            const at = this.location(service);
            if (at !== job.stationId || ['moving', 'departing'].includes(service.state))
                continue;
            if (job.context) {
                const context = job.context, currentIndex = service.currentStopIndex;
                try {
                    service.currentStopIndex = context.stopIndex;
                    this.game.economy.processStopRevenue(service, context.stationName, context.distKm, context.isFirst, context.isLast, job.stationId, [], job.direction === 'load' && !context.isFirst, { chargePhysicalExpense: false });
                }
                finally {
                    service.currentStopIndex = currentIndex;
                }
            }
            else if (job.direction === 'load') {
                const amount = this.game.freightManager.reserveForService(contract, service, job.tonnes);
                if (amount > 0)
                    service._contractFreight = amount;
            }
        }
        for (const [id, job] of this.handling)
            if (job.status === 'completed')
                this.handling.delete(id);
    }
    canDepart(service, nowMs = this.nowMs()) {
        const location = this.location(service);
        for (const member of this.registerService(service)) {
            const row = this.wagons.get(member.id);
            if (this.expert() && (row.serviceId && row.serviceId !== key(service.id) || row.stationId && location && row.stationId !== location)) {
                const reason = `Wagon ${member.id} ${row.serviceId ? `utilisé par ${row.serviceId}` : `situé à ${row.stationId}`} : acheminement physique requis.`;
                return { ok: false, code: 'WAGON_UNAVAILABLE', reason, message: reason, remainingSeconds: 0 };
            }
        }
        const assetCheck = this.lifecycle.canDepart(service, nowMs);
        const networkCheck = this.game?.economy?.canAccessNetwork?.(service, nowMs);
        if (this.expert('depots') && !assetCheck.ok)
            return assetCheck;
        if (this.expert('infrastructure') && networkCheck && !networkCheck.ok)
            return networkCheck;
        const issues = this.diagnose(service);
        const row = [...this.handling.values()].filter(job => (job.serviceId === key(service.id) || job.otherServiceId === key(service.id)) && job.status !== 'completed').sort((a, b) => b.dueMs - a.dueMs)[0];
        if (!this.expert())
            return { ok: true, code: 'OK', reason: '', message: '', diagnostics: issues, remainingSeconds: 0 };
        if (issues.length)
            return { ok: false, ...issues[0], reason: issues[0].message, diagnostics: issues, remainingSeconds: 0 };
        if (service.assignedContractId && !(service._contractFreight > 0) && service._freightDiagnostic
            && this.game?.freightManager?.contracts?.some(contract => contract.id === service.assignedContractId && contract.active))
            return { ok: false, code: 'FREIGHT_UNAVAILABLE', reason: service._freightDiagnostic, message: service._freightDiagnostic, remainingSeconds: 0 };
        if (row) {
            const reason = `${row.direction === 'load' ? 'Chargement' : 'Déchargement'} au terminal ${row.stationId}`;
            return { ok: false, code: 'FREIGHT_HANDLING', reason, message: reason, remainingSeconds: Math.max(0, Math.ceil((row.dueMs - nowMs) / 1000)) };
        }
        return { ok: true, code: 'OK', reason: '', message: '', remainingSeconds: 0 };
    }
    availableWagons(stationId, cargoType) {
        return [...this.wagons.values()].filter(row => row.stationId === key(stationId) && !row.serviceId && !row.tonnes
            && (!cargoType || row.cargoTypes?.includes(cargoType))).map(row => row.id);
    }
    toSave() {
        return { schemaVersion: 1, wagons: clone([...this.wagons]), containers: clone([...this.containers]),
            terminals: clone([...this.terminals]), storedCargo: clone([...this.storedCargo]), handling: clone([...this.handling]), conditionEvents: [...this.conditionEvents], seededContracts: [...this.seededContracts], nextHandlingId: this.nextHandlingId, lifecycle: this.lifecycle.toSave() };
    }
    loadFromSave(saved) {
        if (!saved || saved.schemaVersion !== 1)
            return false;
        this.wagons.clear();
        this.containers.clear();
        this.terminals.clear();
        this.handling.clear();
        this.storedCargo.clear();
        this.serviceById.clear();
        this.exchangeContexts.clear();
        this.conditionEvents = new Set((Array.isArray(saved?.conditionEvents) ? saved.conditionEvents : []).map(key));
        for (const name of ['wagons', 'containers', 'terminals', 'handling', 'storedCargo']) {
            for (const pair of Array.isArray(saved?.[name]) ? saved[name] : []) {
                if (!Array.isArray(pair) || pair.length !== 2 || !key(pair[0]) || !pair[1] || typeof pair[1] !== 'object')
                    continue;
                const row = clone(pair[1]);
                if (['wagons', 'containers'].includes(name) && (!Number.isFinite(Number(row.tonnes)) || row.tonnes < 0))
                    continue;
                if (name === 'handling' && (!Number.isFinite(Number(row.dueMs)) || row.dueMs < 0))
                    continue;
                if (name === 'wagons') {
                    row.tonnes = Math.min(positive(row.capacity), positive(row.tonnes));
                    row.containerIds = Array.isArray(row.containerIds) ? row.containerIds.map(key) : [];
                }
                this[name].set(key(pair[0]), row);
            }
        }
        this.seededContracts = new Set((Array.isArray(saved?.seededContracts) ? saved.seededContracts : []).map(key));
        this.nextHandlingId = Math.max(1, Math.floor(positive(saved?.nextHandlingId)));
        this.lifecycle.loadFromSave(saved?.lifecycle);
        return true;
    }
}
export class AssetLifecycle {
    constructor() { this.game = null; this.assets = new Map(); this.finance = new Map(); this.renovations = new Map(); }
    connectRuntime(game) { this.game = game; return this; }
    inventory() { return this.game?.inventory || globalThis.window?.__reDefinitif?.inventory; }
    requireOwned(vehicleId) {
        const vehicle = this.inventory()?.read?.(Number(vehicleId));
        if (!vehicle || ['sold', 'withdrawn'].includes(vehicle.status))
            throw new Error('Engin physique possédé indisponible.');
        return vehicle;
    }
    metadata(vehicleId) {
        this.requireOwned(vehicleId);
        const id = key(vehicleId);
        if (!this.assets.has(id))
            this.assets.set(id, { vehicleId: id, equipment: {}, approvedCountries: [], warranty: null });
        return this.assets.get(id);
    }
    openFinance(vehicleId, spec) {
        const vehicle = this.requireOwned(vehicleId), id = key(vehicleId);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key(spec.startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(key(spec.endDate)) || spec.endDate <= spec.startDate)
            throw new Error('Dates de location invalides.');
        if (this.finance.get(id)?.active)
            throw new Error('Engin déjà financé.');
        const row = { id: `finance:${id}:${spec.startDate}`, vehicleId: id, kind: spec.kind === 'rental' ? 'rental' : 'lease',
            dailyFee: positive(spec.dailyFee), startDate: spec.startDate, endDate: spec.endDate,
            buyout: positive(spec.buyout), active: true, bookPriceCents: vehicle.purchasePriceCents, awaitingReturn: false };
        this.finance.set(id, row);
        return row;
    }
    setWarranty(vehicleId, spec) {
        const row = this.metadata(vehicleId);
        row.warranty = { untilMs: positive(spec.untilMs), coveredComponents: [...new Set((spec.coveredComponents || []).map(key))] };
        return row.warranty;
    }
    quoteMaintenanceCost(vehicleId, component, cost, atMs = this.game?.engine?.getSimulationEpochMs?.() || 0) {
        const row = this.assets.get(key(vehicleId)), warranty = row?.warranty;
        return warranty && atMs <= warranty.untilMs && warranty.coveredComponents.includes(key(component)) ? 0 : positive(cost);
    }
    startRenovation(vehicleId, spec) {
        const inventory = this.inventory(), vehicle = this.requireOwned(vehicleId), id = key(vehicleId);
        if (vehicle.status !== 'available' || inventory.assignmentForVehicle(Number(vehicleId)) !== null)
            throw new Error('Engin affecté ou indisponible : libérer son affectation avant rénovation.');
        if (!key(spec.depotId) || !(positive(spec.durationMs) > 0))
            throw new Error('Atelier et durée de rénovation requis.');
        const depots = [...(inventory.getState?.().depots || []), ...(this.game?.depotManager?.getDepots?.() || []).filter(depot => depot.built !== false)];
        const depot = depots.find(row => key(row.depotId || row.id) === key(spec.depotId));
        if (!depot)
            throw new Error('Atelier physique introuvable : construire ou sélectionner un dépôt réel.');
        const location = key(vehicle.stationId || vehicle.locationKey), depotLocation = key(depot.stationId || depot.locationKey);
        if (location && depotLocation && location !== depotLocation)
            throw new Error('Engin situé ailleurs : acheminement réel vers l’atelier requis.');
        const now = positive(this.game?.engine?.getSimulationEpochMs?.()), cost = this.quoteMaintenanceCost(vehicleId, spec.component, spec.cost, now);
        const job = { id: `renovation:${id}:${now}`, vehicleId: id, depotId: key(spec.depotId), startedMs: now,
            dueMs: now + positive(spec.durationMs), equipment: clone(spec.equipment || {}), approvedCountries: [...new Set((spec.approvedCountries || []).map(key))], status: 'pending' };
        if (cost > 0 && this.game?.realismSettings?.difficulty === 'expert' && positive(this.game?.economy?.balance) < cost)
            throw new Error('Solde insuffisant.');
        inventory.replace(vehicle, { ...vehicle, status: 'maintenance' });
        if (cost > 0 && !this.game?.economy?.settleEvent?.(job.id, { kind: 'expense', amount: cost, category: 'renovation', description: `Rénovation ${vehicle.fleetNumber}` })) {
            inventory.replace(inventory.read(Number(vehicleId)), vehicle);
            throw new Error('Paiement de rénovation refusé.');
        }
        this.renovations.set(job.id, job);
        this.metadata(vehicleId);
        return job;
    }
    applyEquipment(vehicleId, meta) {
        for (const rame of this.game?.rameManager?.getAll?.() || [])
            for (const detail of rame.elementDetails || []) {
                if (key(detail.physicalVehicleId) === key(vehicleId)) {
                    detail.equipment = { ...(detail.equipment || {}), ...meta.equipment };
                    if (meta.approvedCountries.length)
                        detail.approvedCountries = [...meta.approvedCountries];
                }
            }
    }
    advance(nowMs) {
        const inventory = this.inventory();
        if (!inventory)
            return;
        for (const job of this.renovations.values()) {
            if (job.status !== 'pending' || job.dueMs > nowMs)
                continue;
            const vehicle = inventory.read(Number(job.vehicleId));
            if (!vehicle || vehicle.status !== 'maintenance')
                continue;
            inventory.replace(vehicle, { ...vehicle, wearPpm: Math.floor(vehicle.wearPpm * .4), status: 'available' });
            const meta = this.metadata(job.vehicleId);
            meta.equipment = { ...meta.equipment, ...job.equipment };
            meta.approvedCountries = [...job.approvedCountries];
            this.applyEquipment(job.vehicleId, meta);
            job.status = 'completed';
            this.game?.emitDomainEvent?.({ eventId: job.id, simEpochMs: nowMs, type: 'asset-renovated', resourceIds: [job.vehicleId], payload: { depotId: job.depotId } });
        }
        for (const [id, meta] of this.assets)
            this.applyEquipment(id, meta);
    }
    dailyUpdate(date) {
        const inventory = this.inventory();
        if (!inventory)
            return;
        for (const row of this.finance.values()) {
            if (!row.active || date < row.startDate)
                continue;
            if (date >= row.endDate) {
                if (row.kind === 'rental') {
                    if (inventory.assignmentForVehicle(Number(row.vehicleId)) !== null) {
                        row.awaitingReturn = true;
                        continue;
                    }
                    const vehicle = inventory.read(Number(row.vehicleId));
                    if (vehicle && !['sold', 'withdrawn'].includes(vehicle.status))
                        inventory.prepareDisposeVehicle(Number(row.vehicleId), 'withdrawn').commit();
                }
                else if (row.buyout > 0)
                    this.game.economy.settleEvent(`${row.id}:buyout`, { kind: 'expense', amount: row.buyout, category: 'leasing', description: `Levée d’option ${row.vehicleId}` });
                row.active = false;
                row.awaitingReturn = false;
                continue;
            }
            if (row.dailyFee > 0)
                this.game.economy.settleEvent(`${row.id}:${date}`, { kind: 'expense', amount: row.dailyFee,
                    category: row.kind === 'rental' ? 'location' : 'leasing', description: `${row.kind === 'rental' ? 'Location' : 'Leasing'} engin ${row.vehicleId} ${date}` });
        }
    }
    bookValue(vehicleId, atMs = this.game?.engine?.getSimulationEpochMs?.() || 0) {
        const vehicle = this.requireOwned(vehicleId), years = Math.max(0, atMs - vehicle.acquiredAtMs) / (365.25 * 86400000);
        return Math.round(vehicle.purchasePriceCents * Math.max(.05, 1 - years * .04 - vehicle.wearPpm / 1000000 * .5));
    }
    canDepart(service, nowMs) {
        for (const detail of service?.rame?.elementDetails || []) {
            const id = key(detail.physicalVehicleId);
            if (!id)
                continue;
            const finance = this.finance.get(id);
            const job = [...this.renovations.values()].find(row => row.vehicleId === id && row.status === 'pending');
            if (finance?.awaitingReturn || job) {
                const reason = job ? `Engin ${id} en rénovation.` : `Location de l’engin ${id} terminée : restitution requise.`;
                return { ok: false, code: job ? 'ASSET_RENOVATION' : 'RENTAL_RETURN', reason, message: reason, remainingSeconds: job ? Math.max(0, Math.ceil((job.dueMs - nowMs) / 1000)) : 0 };
            }
            const countries = this.assets.get(id)?.approvedCountries || [];
            const routeCountries = (service.stops || []).map(stop => stop.country || this.game?.world?.getStationById?.(stop.stationId)?.country).filter(Boolean);
            if (countries.length && routeCountries.some(country => !countries.includes(country))) {
                const reason = `Homologation de l’engin ${id} insuffisante pour le pays du trajet.`;
                return { ok: false, code: 'ASSET_HOMOLOGATION', reason, message: reason, remainingSeconds: 0 };
            }
        }
        return { ok: true, code: 'OK', reason: '', message: '', remainingSeconds: 0 };
    }
    toSave() { return { schemaVersion: 1, assets: clone([...this.assets]), finance: clone([...this.finance]), renovations: clone([...this.renovations]) }; }
    loadFromSave(saved) { for (const name of ['assets', 'finance', 'renovations'])
        this[name] = new Map((Array.isArray(saved?.[name]) ? saved[name] : []).filter(pair => Array.isArray(pair) && pair.length === 2 && key(pair[0]) && pair[1] && typeof pair[1] === 'object').map(pair => [key(pair[0]), clone(pair[1])])); }
}
