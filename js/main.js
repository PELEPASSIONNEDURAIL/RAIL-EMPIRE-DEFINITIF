import { LiveryLibrary, applyOwnedLivery, copyLiveryAppearance } from './livery-model.js';
import { UltimateRuntime } from './ultimate-runtime.js';
import { ReplayPump } from './replay-pump.js';
import { civilDateAt } from './civil-game-time.js';
import { prepareAnalyticalCatchup, commitAnalyticalCatchup, analyticalCatchupFallbackReason, AnalyticalCatchupFallbackError } from './analytical-catchup.js';
import { acquireImportUiLock } from './import-ui-lock.js';
import { StateTransaction, validateSaveDocument } from './state-transaction.js';
import { openStoragePanel } from './storage-panel.js';
import { collectFreightRailLegs } from './freight-network.js';
import { bindLaunchActions } from './launch-actions.js';
import { syncMaterialMileage } from './material-mileage.js';
// RE_ASSET_FALLBACK_BATCH186
// Code-only reconstruction: missing legacy composite/Pack RE images are hidden gracefully.
if (typeof document !== 'undefined') {
    document.addEventListener('error', (event) => {
        const el = event.target;
        if (el && el.tagName === 'IMG') {
            const src = el.getAttribute('src') || '';
            if (src.startsWith('img/catalog/') || src.startsWith('img/pack_re/')) {
                // These images own a synchronous bridge fallback. Hiding them here can
                // make the catalog image window detach the replacement before it loads.
                const repair = typeof window === 'undefined' ? undefined :
                    window.__reDefinitif?.repairImage;
                if (el.dataset.reMaterialId && typeof el.onerror === 'function' && typeof repair === 'function')
                    return;
                el.style.display = 'none';
                el.dataset.assetMissing = 'true';
            }
        }
    }, true);
}
import { SimulationEngine } from './engine.js';
import { GameplayClock } from './gameplay-clock.js';
import { normalizeGameplayMode, applyExpertDepartureGate, expertDepartureBlock } from './gameplay-mode.js';
import { OperationalDiagnostics } from './operational-diagnostics.js';
import { OperationalExtensions } from './operational-extensions.js';
import { REALISM_SYSTEMS, normalizeRealismPolicy, resolveRealismPolicy as resolveSystemPolicy, setRealismSystem } from './realism-policy.js';
import { OperationalReplay, auditPhysicalState } from './operational-replay.js';
import { FreightOperations } from './freight-operations.js';
import { StationResources } from './station-resources.js';
import { VehicleBrakeState } from './physics-vehicle-state.js';
import { applyRegulationAction } from './regulation-actions.js';
import { createLiveReplayAdapter } from './live-replay-adapter.js';
import { SeededRng, setGlobalRng } from './rng.js';
import { createDefaultWorld } from './world.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { Economy } from './economy.js';
import { IncidentManager } from './incidents.js';
import { FreightManager } from './freight.js';
import { ScheduleManager } from './schedule.js';
import { GameStorage } from './storage.js';
import { AccountManager } from './account.js';
import { RollingStockManager } from './rolling-stock.js';
import { RameManager } from './rame.js';
import { ScheduleCreator, cantonManager } from './schedule-creator.js';
import { DepotManager } from './depot.js';
import { WorksManager } from './works.js';
import { ORMClient } from './orm.js';
import { WorldRailCache } from './world-rail-cache.js';
import { LineManager, PlatformManager, processDueInfrastructureRequests } from './line.js';
import { SillonManager } from './sillon.js';
import { VoiePointManager } from './voie-points.js';
import { Dashboard } from './dashboard.js';
import { GraphMarche } from './graph-marche.js';
import { StaffManager } from './staff.js';
import { Tutorial } from './tutorial.js';
import { Bank } from './bank.js';
import { Weather } from './weather.js';
import { Unions } from './unions.js';
import { SeasonalSchedule } from './seasonal.js';
import { Connections } from './connections.js';
import { StationUpgrades } from './station-upgrades.js';
import { A12Model } from './a12-model.js';
import { JunctionManager } from './junctions.js';
import { CargoTypeManager } from './cargo-types.js';
import { ITEModules } from './ite-modules.js';
import { IndustrialClients } from './industrial-clients.js';
import { ShuntingManager } from './shunting.js';
import { MarketingManager } from './marketing.js';
import { CATALOG_CARGO_TYPES_BASE } from './catalog-cargo-types-base.js';
import { BATCH186_FREIGHT_CARGO_TYPES, applyBatch186FreightToCatalog, applyBatch186IndustryFreightPatch } from './catalog-freight-batch186.js';
import { BATCH186_FREIGHT_PASS2_CARGO_TYPES, applyBatch186FreightPass2ToCatalog, applyBatch186FreightPass2IndustryPatch } from './catalog-freight-batch186-pass2.js';
import { applyBatch186CategoryOverrides } from './catalog-batch186-category-overrides.js';
import { loadBatch186FullCatalogAdditions, loadCatalogClassicModule } from './catalog-batch186-full-loader.js';
import { applyBalancedPurchasePrices } from './catalog-price-balance.js';
import { CATALOG_NORMALIZATION_EXTRA_CARGO_TYPES, normalizeCatalogCargoKeys } from './catalog-cargo-normalization.js';
import { correctCatalogImagePaths } from './catalog-image-path-corrections.js';
import { adminSync } from './admin-sync.js';
import { protectedCatalogIds, clearExternalCatalogBundle, loadExternalCatalogBundle, parseExternalCatalogFile, saveExternalCatalogBundle } from './catalog-external.js';
import { getCatalogStore, parseCatalogJSON } from './catalog-store.js';
import { migrateCatalogImageLengths } from './catalog-series.js';
import { CATALOG_IMAGE_WIDTHS } from './catalog-image-widths.js';
import { GlobalStationCatalog } from './global-stations.js';
import { RailReferenceSync } from './rail-reference-sync.js';
import { ScheduleV2Manager } from './schedule-v2-model.js';
import { RotationV2Manager } from './rotation-v2-model.js';
import { ScheduleV2Runtime } from './schedule-v2-runtime.js';
import { ScheduleV2Revalidator } from './schedule-v2-revalidation.js';
export class RailEmpire {
    constructor({ initialize = true } = {}) {
        this.liveries = new LiveryLibrary();
        this._liveryWriting = false;
        this._started = false;
        this._launching = false;
        this._importing = false;
        this._analyticalCatchupActive = false;
        this.gameplayClock = new GameplayClock();
        this.diagnostics = new OperationalDiagnostics();
        this.operationalExtensions = new OperationalExtensions();
        this.operationalReplay = new OperationalReplay();
        this.stationResources = new StationResources();
        this.vehicleBrakeState = new VehicleBrakeState();
        this.freightOperations = new FreightOperations().connectRuntime(this);
        this._replayDomainEvents = null;
        this._operationalReplayActive = false;
        this._physicalResourceEventsSuspended = 0;
        this._externalCatalogApplied = false;
        this._externalCatalogLastResult = null;
        this._catalogImporting = false;
        this._legacyWagonCargoRecoveryByRames = new WeakMap();
        this._replayPump = null;
        this._lastReplayStatusPaint = -Infinity;
        this._replayStatusWasCatchingUp = false;
        // DET-01 : PRNG déterministe de partie
        this.rng = new SeededRng(Date.now());
        setGlobalRng(this.rng);
        // DET-05 : curseurs de réalisme (1.0 = normal)
        this.realismSettings = {
            physics: 2.0,
            weather: 2.0,
            breakdown: 2.0,
            delayTolerance: 120,
            // HOTFIX64 — advanced operating layers are opt-in for beginners.
            rotationsRequired: false,
            personnelRequired: false,
            difficulty: 'easy',
            easyCompetitionEnabled: false,
            realismPolicy: normalizeRealismPolicy(),
        };
        this.engine = new SimulationEngine();
        this.world = createDefaultWorld();
        this.economy = new Economy();
        this.incidentManager = new IncidentManager();
        this.freightManager = new FreightManager();
        this.scheduleManager = new ScheduleManager();
        this.storage = new GameStorage();
        this.account = new AccountManager();
        this.rollingStock = new RollingStockManager();
        this.catalogStore = getCatalogStore(this.rollingStock, {
            loadNative: async () => { await this._loadNativeCatalog(); },
            nativeIds: () => {
                const ids = new Set();
                const rows = [...(this._baseCatalogModules?.CATALOG || []), ...(this._baseCatalogModules?.CATALOG_PACK_RE || []), ...(this._batch186FullCatalogAdditions || [])];
                for (const row of rows)
                    if (row && typeof row === 'object' && 'id' in row && typeof row.id === 'string')
                        ids.add(row.id);
                return ids;
            },
            protectedIds: () => this._protectedCatalogMaterialIds(),
            beforeReady: async (manager) => {
                const report = migrateCatalogImageLengths(manager.items, CATALOG_IMAGE_WIDTHS);
                await this.catalogStore.recordMigrationReport(report);
            },
            afterReady: manager => {
                // A saved rame can have stale details even when the catalogue itself already
                // has the intrinsic length. Refresh every owned type after overlay + migration,
                // with READY indices available to livery resolution and physical consumers.
                const ids = new Set(this.catalogStore.lastInvalidation.ids);
                for (const rame of this.rameManager.getAll()) {
                    for (const id of rame.elements)
                        ids.add(id);
                    for (const detail of rame.elementDetails)
                        if (detail.catalogId)
                            ids.add(detail.catalogId);
                }
                const refreshed = this.rameManager.refreshCatalogDetails(manager, ids, this.scheduleCreator.getActiveServices(), (id) => this.rotationV2.getRameVehicles(id).map((vehicle) => vehicle.id));
                this._refreshExternalCatalogRames(refreshed);
            },
        });
        this.rameManager = new RameManager();
        this.scheduleCreator = new ScheduleCreator();
        // v1.1.21 — Schedule/Rotation V2 are deliberately independent from the
        // legacy ActiveService runtime.  Schedules describe WHAT/WHEN; rotations
        // bind real material and are the only source of future V2 circulations.
        this.scheduleV2 = new ScheduleV2Manager();
        this.rotationV2 = new RotationV2Manager(this.scheduleV2);
        this.scheduleV2Runtime = new ScheduleV2Runtime(this);
        this.depotManager = new DepotManager();
        this.worksManager = new WorksManager();
        this.orm = new ORMClient();
        // World OSM railway vectors are acquired online and cached for repeat routes.
        // OpenRailwayMap remains the specialist display/enrichment layer.
        this.worldRailCache = new WorldRailCache({ cellDeg: 0.5, maxMemoryTiles: 32, maxMemoryWays: 16000 });
        this.orm.setWorldRailCache?.(this.worldRailCache);
        this.scheduleV2Revalidator = new ScheduleV2Revalidator(this);
        // v1.1.9 — worldwide railway-station reference layer (OSM/QLever).
        // Stored outside the player world save and cached separately in IndexedDB.
        this.globalStations = new GlobalStationCatalog();
        this.railReferenceSync = new RailReferenceSync();
        this._railReferenceSyncStarted = false;
        this._railReferenceSyncTimer = null;
        this._globalStationsLoading = null;
        this._europeGameplayReady = null; // v1.1.34: complete Europe gameplay baseline for all-zoom visibility
        this._osmNativeStreamPromise = null;
        this._osmNativeViewportKey = '';
        this._osmNativeLastAttempt = 0;
        this.lineManager = new LineManager();
        this.sillonManager = new SillonManager();
        this.platformManager = new PlatformManager();
        this.stationResources.connectRuntime(this.platformManager);
        this.voiePointManager = new VoiePointManager();
        // R-08 : brancher les aiguillages/tronçons utilisateur au graphe de routage ORM
        this.orm.setUserTronconProvider(() => this.voiePointManager.getAllTroncons());
        this.voiePointManager.onChange = () => this.orm.markGraphDirty();
        this.dashboard = new Dashboard();
        this.graphMarche = new GraphMarche();
        this.staffManager = new StaffManager();
        this.depotManager.connectCreationStaffManager(this.staffManager);
        this.tutorial = new Tutorial();
        this.bank = new Bank();
        this.weather = new Weather();
        this.a12Model = new A12Model(this);
        this.scheduleCreator.weather = this.weather;
        this.unions = new Unions();
        this.seasonal = new SeasonalSchedule();
        this.connections = new Connections();
        this.stationUpgrades = new StationUpgrades();
        this.stationUpgrades.connectRuntime(this.world, this.depotManager, this.platformManager);
        this.junctionManager = new JunctionManager();
        this.cargoTypes = new CargoTypeManager();
        this.iteModules = new ITEModules();
        this.industrialClients = new IndustrialClients();
        this.freightManager.industrialClients = this.industrialClients;
        this.marketingManager = new MarketingManager();
        this.industrialClients.freightAccessProvider = (id) => this.stationUpgrades.canHandleFreight(id);
        this.industrialClients.railLegProvider = () => collectFreightRailLegs(this.scheduleV2, this.scheduleCreator.services);
        this.industrialClients.iteProvider = () => this.depotManager.getITEs();
        applyBatch186IndustryFreightPatch(this.industrialClients);
        applyBatch186FreightPass2IndustryPatch(this.industrialClients);
        this.shuntingManager = new ShuntingManager();
        this.cantonManager = cantonManager;
        this._bindPhysicalResourceObserver();
        this.renderer = null;
        this.ui = null;
        this.running = false;
        this.autoSaveInterval = null;
        // v1.1.1: FullCatalog is lazy-loaded after the UI/login listeners are alive.
        // This avoids parsing a 26 MB module before the start buttons can respond.
        this._batch186FullCatalogAdditions = [];
        this._batch186FullCatalogLoaded = false;
        this._batch186FullCatalogLoading = null;
        this._baseCatalogSeeded = false;
        this._catalogCargoTypesSeeded = false;
        this.ultimate = new UltimateRuntime(this);
        if (initialize)
            this.init();
    }
    getGameplayModeState() {
        return normalizeGameplayMode(this.realismSettings);
    }
    resolveRealismPolicy(systemId) {
        return resolveSystemPolicy(this.realismSettings, systemId);
    }
    setRealismSystem(systemId, choice) {
        this.realismSettings.realismPolicy = setRealismSystem(this.realismSettings.realismPolicy, systemId, choice);
        this._applyGameplayModeSettings();
        return this.resolveRealismPolicy(systemId);
    }
    emitDomainEvent(event) {
        const datedEvent = { ...event, payload: event.payload, simEpochMs: event.simEpochMs ?? this.engine.getSimulationEpochMs() };
        this.scheduleV2Runtime?.handleDomainEvent?.({ ...datedEvent, resourceIds: datedEvent.resourceIds ? [...datedEvent.resourceIds] : undefined });
        if (Array.isArray(this._replayDomainEvents))
            this._replayDomainEvents.push(datedEvent);
        return this.operationalReplay?.recordDomainEvent(datedEvent) || false;
    }
    _bindPhysicalResourceObserver() {
        if (this._physicalResourceEventsSuspended > 0)
            return;
        this.cantonManager.resourceEventObserver = (event) => {
            this.operationalExtensions.nodeCapacity?.onResourceEvent(event);
            const types = { acquire: 'PhysicalResourceAcquired', release: 'PhysicalResourceReleased', transfer: 'PhysicalResourceTransferred' };
            // CantonManager assigns a durable ID before invoking its observer.
            this.emitDomainEvent({ ...event, eventId: event.eventId, type: types[event.type], resourceAction: event.type });
        };
    }
    _suspendPhysicalResourceEvents() {
        this._physicalResourceEventsSuspended++;
        this.cantonManager.resourceEventObserver = null;
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            this._physicalResourceEventsSuspended--;
            if (!this._physicalResourceEventsSuspended)
                this._bindPhysicalResourceObserver();
        };
    }
    auditOperations() { return auditPhysicalState(this); }
    applyRegulationAction(action) { return applyRegulationAction(this, action); }
    _advanceParkedVehicleBrakes(simEpochMs, elapsedSeconds) {
        if (!this.resolveRealismPolicy('pneumatic').enforce || !this.vehicleBrakeState.states.size)
            return;
        const moving = new Set();
        for (const service of this.scheduleCreator.getMovingServices())
            for (const id of service._v2VehicleIds || [])
                moving.add(String(id));
        for (const operation of this.depotManager.physicalOperations || [])
            if (operation.state === 'moving')
                for (const id of operation.vehicleIds)
                    moving.add(String(id));
        const parked = this.rotationV2.vehicles.filter((vehicle) => !moving.has(vehicle.id)
            && ['DEPOT', 'STATION'].includes(vehicle.location?.kind)).map((vehicle) => ({ ...vehicle, vehicleId: vehicle.id, emptyMassKg: vehicle.massKg }));
        this.vehicleBrakeState.advanceIdle(parked, Math.max(0, Math.min(86400, elapsedSeconds)), { simEpochMs });
    }
    captureReplaySnapshot() {
        const physicsClock = this.engine.toClockSave?.() || null;
        if (physicsClock)
            physicsClock.targetMs = physicsClock.cursorMs;
        const snapshot = { companyName: this.account.companyName, saveTime: this.engine.getSimulationEpochMs(),
            gameplayClock: this.gameplayClock.toSave(), physicsClock,
            economy: this.economy.toSave(), world: this.world.toSave({ pinNativeStationIds: this._collectPinnedNativeStationIds() }),
            rollingStock: this.rollingStock.toSave(), rames: this.rameManager.toSave(), liveries: this.liveries.toSave(),
            scheduleV2: this.scheduleV2.toSave(), rotationsV2: this.rotationV2.toSave(), v2Runtime: this.scheduleV2Runtime.toSave(),
            ultimate: this.ultimate.toSave(),
            tutorial: this.tutorial.snapshot(),
            operationalExtensions: this.operationalExtensions.toSave(), freightOperations: this.freightOperations.toSave(),
            stationResources: this.stationResources.toSave(), depots: this.depotManager.toSave(),
            vehicleBrakeState: this.vehicleBrakeState.toSave(),
            interlocking: this.cantonManager.toSave(),
            freightContracts: this.freightManager.toSave(), activeIncidents: this.incidentManager.getActiveIncidentsSave(),
            incidentCadence: this.incidentManager.getCadenceSave(), incidentEnabledTypes: this.incidentManager.getEnabledTypes(),
            works: this.worksManager.toSave(), lines: this.lineManager.toSave(), staff: this.staffManager.toSave(),
            bank: this.bank.toSave(), weather: this.weather.toSave(), unions: this.unions.toSave(),
            seasonal: this.seasonal.toSave(), connections: this.connections.toSave(), stationUpgrades: this.stationUpgrades.toSave(),
            junctions: this.junctionManager.toSave(), voiePoints: this.voiePointManager.toSave(), sillons: this.sillonManager.toSave(),
            cargoTypes: this.cargoTypes.toSave(), industrialClients: this.industrialClients.toSave(), iteModules: this.iteModules.toSave(),
            marketing: this.marketingManager?.toSave?.() || null, shunting: this.shuntingManager.toSave(), ormRoutes: this.orm.toSave(),
            definitifFleet: window.__reDefinitif?.toSave?.() || null,
            rngState: this.rng.getState(), realism: { ...this.realismSettings } };
        return snapshot;
    }
    startOperationalRecording() {
        return this.operationalReplay.captureCheckpoint(this.captureReplaySnapshot(), this.engine.getSimulationEpochMs(), this.rng.getState());
    }
    sealOperationalRecording() {
        this.operationalReplay.sealTarget(this.captureReplaySnapshot(), { simEpochMs: this.engine.getSimulationEpochMs(), rngState: this.rng.getState() });
        return this.operationalReplay.toSave();
    }
    async replayOperations() {
        if (this._operationalReplayActive)
            throw new Error('Un replay est déjà en cours.');
        const journal = this.operationalReplay;
        this.sealOperationalRecording();
        const transaction = this._captureImportCheckpoint();
        const fleetTransaction = globalThis.window?.__reDefinitif?.beginImportTransaction?.();
        const wasRunning = this.running, wasPaused = this.engine.paused, wasImporting = this._importing;
        const releaseUi = acquireImportUiLock();
        this._operationalReplayActive = true;
        this._importing = true;
        this.running = false;
        this.engine.paused = true;
        try {
            return await journal.replay(createLiveReplayAdapter(this, journal));
        }
        finally {
            try {
                transaction.rollback();
            }
            finally {
                try {
                    fleetTransaction?.rollback();
                }
                finally {
                    this.operationalReplay = journal;
                    this._replayDomainEvents = null;
                    this._operationalReplayActive = false;
                    this._importing = wasImporting;
                    this.running = wasRunning;
                    this.engine.paused = wasPaused;
                    releaseUi();
                    this.ui?.update?.(this.scheduleCreator.getActiveServices());
                }
            }
        }
    }
    executeOperationsCommand(action, values) {
        if (['record', 'recording', 'audit', 'exportReplay', 'replay'].includes(action))
            return this.ui.performOperationsAction(action, values);
        if (!this.operationalReplay.checkpoint)
            return this.ui.performOperationsAction(action, values);
        const tx = this._captureImportCheckpoint();
        try {
            const result = this.operationalReplay.execute({ kind: 'operations', action, values }, {
                simEpochMs: this.engine.getSimulationEpochMs(), rngBefore: this.rng.getState(),
                apply: command => { const input = command; return this.ui.performOperationsAction(input.action, input.values); },
                snapshot: () => this.captureReplaySnapshot(), rollback: () => tx.rollback()
            });
            tx.release();
            return result;
        }
        catch (error) {
            tx.rollback();
            throw error;
        }
    }
    _applyGameplayModeSettings() {
        const mode = this.getGameplayModeState();
        this.realismSettings.difficulty = mode.difficulty;
        this.realismSettings.easyCompetitionEnabled = mode.easyCompetitionEnabled;
        this.realismSettings.rotationsRequired = mode.rotationsRequired;
        this.realismSettings.realismPolicy = normalizeRealismPolicy(this.realismSettings.realismPolicy);
        this.realismSettings.personnelRequired = mode.personnelRequired && this.resolveRealismPolicy('personnel').enabled;
        this.operationalExtensions.pneumaticBrakesEnabled = this.resolveRealismPolicy('pneumatic').enabled;
        return mode;
    }
    setGameplayDifficulty(difficulty, persist = true) {
        if (difficulty !== 'easy' && difficulty !== 'expert')
            throw new TypeError('Mode de jeu invalide.');
        this.realismSettings.difficulty = difficulty;
        this._applyGameplayModeSettings();
        this.ultimate?.ensureSimpleRameStaff?.();
        if (persist) {
            window.__reDefinitif?.onGameplayModeChange?.();
            this._forceV2RuntimeSyncNow?.();
            this.saveState();
        }
    }
    setEasyCompetitionEnabled(enabled) {
        if (typeof enabled !== 'boolean')
            throw new TypeError('Choix de concurrence invalide.');
        this.realismSettings.easyCompetitionEnabled = enabled;
        this._applyGameplayModeSettings();
        window.__reDefinitif?.onGameplayModeChange?.();
        this.saveState();
    }
    async init() {
        const btnNew = document.getElementById('btn-new-game');
        const btnLoad = document.getElementById('btn-load-game');
        const nameInput = document.getElementById('login-name');
        if (await this.storage.hasSaveAsync()) {
            btnLoad.style.display = 'block';
            const saved = await this.storage.loadGame();
            if (saved && typeof saved === 'object' && 'companyName' in saved && typeof saved.companyName === 'string') {
                nameInput.value = saved.companyName;
            }
        }
        const launch = async (action) => {
            if (this._launching || this._started)
                return;
            this._launching = true;
            btnNew.disabled = true;
            btnLoad.disabled = true;
            try {
                await action();
            }
            catch (error) {
                alert('Chargement refusé : ' + (error instanceof Error ? error.message : String(error)));
            }
            finally {
                this._launching = false;
                btnNew.disabled = false;
                btnLoad.disabled = false;
            }
        };
        btnNew.addEventListener('click', () => void launch(async () => {
            const name = nameInput.value.trim();
            if (!name)
                throw new Error('Entrez un nom de compagnie');
            if (!await this._ensureAllZoomGameplayStations())
                throw new Error('Catalogue européen de gares gameplay absent ou invalide.');
            this.account.companyName = name;
            const selectedMode = document.getElementById('new-game-mode')?.value;
            this.setGameplayDifficulty(selectedMode === 'expert' ? 'expert' : 'easy', false);
            // New Facile games start with the requested 50 million euros. Existing
            // saves keep their recorded balance, and mode changes never reset cash.
            if (this.getGameplayModeState().difficulty === 'easy')
                this.economy.balance = 50000000;
            this.startGame(null);
        }));
        btnLoad.addEventListener('click', () => void launch(async () => {
            const saved = await this.storage.loadGame();
            if (!saved)
                throw new Error('Aucune sauvegarde lisible');
            if (!await this._ensureAllZoomGameplayStations())
                throw new Error('Catalogue européen de gares gameplay absent ou invalide.');
            validateSaveDocument(saved);
            this.loadState(saved);
            this.account.companyName = saved.companyName;
            this.startGame(saved);
        }));
        // Import save file from login screen
        const btnImport = document.getElementById('btn-import-file');
        const importInput = document.getElementById('import-file-input');
        btnImport.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            if (this._launching || this._started)
                return;
            this._launching = true;
            btnNew.disabled = true;
            btnLoad.disabled = true;
            try {
                let text;
                if (file.name.endsWith('.gz')) {
                    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
                    text = await new Response(stream).text();
                }
                else {
                    text = await file.text();
                }
                const saved = JSON.parse(text);
                if (!saved.companyName)
                    throw new Error('Fichier invalide');
                const ready = await this._ensureAllZoomGameplayStations();
                if (!ready)
                    throw new Error('Catalogue européen de gares gameplay absent ou invalide');
                await this.importState(saved);
                nameInput.value = saved.companyName;
                this.startGame(saved);
            }
            catch (err) {
                alert('Erreur: fichier de sauvegarde invalide.\n' + err.message);
            }
            finally {
                this._launching = false;
                btnNew.disabled = false;
                btnLoad.disabled = false;
                importInput.value = '';
            }
        });
        // v1.1.34 — preload during the login screen. New/load/import await this exact
        // same promise, so gameplay cannot open with a partially empty station world.
        this._ensureAllZoomGameplayStations().catch((err) => console.warn('All-zoom station preload failed:', err));
    }
    startGame(savedState) {
        if (this._started)
            return;
        this._started = true;
        // La cible reste l'heure réelle de Paris ; les événements reprennent au curseur sauvegardé.
        // Les anciens décalages gameTime/gameDate restent ignorés.
        this.engine.setGameTime(null, null);
        if (!this.engine.chronologicalClock)
            this.engine.enableChronologicalReplay();
        document.getElementById('screen-login').classList.remove('active');
        document.getElementById('screen-game').classList.add('active');
        document.getElementById('company-name').textContent = this.account.companyName;
        const canvas = document.getElementById('game-canvas');
        this.renderer = new Renderer(canvas);
        this.ui = new UI(this);
        this.ui.setupAll();
        // v1.1.34 — ALL STATIONS / ALL ZOOMS contract. The complete embedded Europe
        // gameplay baseline is already in world.stations BEFORE this method is entered.
        // OSM streaming only enriches the local area; it never gates station visibility.
        this._setWorldStationsStatus(`Gares gameplay : ${Number(this.world._builtInStationCount || this.world.stations.length).toLocaleString('fr-FR')} natives · toutes visibles`, 'done');
        queueMicrotask(() => this._streamNativeOSMViewport(true));
        // Setup station creation button (double-click = multi-creation mode)
        document.getElementById('btn-create-station')?.addEventListener('click', () => {
            this.ui.toggleStationCreation();
        });
        document.getElementById('btn-create-station')?.addEventListener('dblclick', () => {
            this.ui._multiCreateMode = 'station';
            if (!this.ui.stationCreationMode)
                this.ui.toggleStationCreation();
            document.getElementById('btn-create-station')?.classList.add('multi-mode');
        });
        document.getElementById('btn-save-station')?.addEventListener('click', () => {
            this.ui.saveStation();
        });
        // RC13 — quota diagnostics and explicit in-place cache compaction.
        if (!document.getElementById('btn-storage')) {
            const button = document.createElement('button');
            button.id = 'btn-storage';
            button.className = 'btn-header';
            button.type = 'button';
            button.textContent = '🗜';
            button.title = 'Stockage : compression et quota';
            button.setAttribute('aria-label', 'Stockage : compression et quota');
            button.addEventListener('click', () => openStoragePanel(this.storage, {
                save: async () => {
                    if (this._saveWritePromise)
                        await this._saveWritePromise;
                    this.saveState({ force: true, lowMemory: true });
                    return (await this._saveWritePromise) === true;
                },
                export: () => this.exportSaveFile(),
            }));
            document.getElementById('btn-save-file')?.before(button);
        }
        // Save to file button
        document.getElementById('btn-save-file')?.addEventListener('click', () => {
            this.exportSaveFile();
        });
        // Load from file button
        const loadFileInput = document.getElementById('load-file-input');
        document.getElementById('btn-load-file')?.addEventListener('click', () => {
            loadFileInput.click();
        });
        loadFileInput?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            try {
                let text;
                if (file.name.endsWith('.gz')) {
                    // Decompress gzipped file
                    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
                    text = await new Response(stream).text();
                }
                else {
                    text = await file.text();
                }
                const saved = JSON.parse(text);
                if (!saved.companyName)
                    throw new Error('Fichier invalide');
                await this.importState(saved);
                // loadFromSave replaces RollingStockManager.items. Keep only saved/custom
                // stock on the Livemap; built-in catalogue rows are restored lazily on demand.
                this._batch186ExistingIds = null;
                this._baseCatalogSeeded = false;
                this._seedCatalogCargoTypes();
                this.account.companyName = saved.companyName;
                document.getElementById('company-name').textContent = saved.companyName;
                if (this.ui)
                    this.ui.refreshAll();
                alert('Partie chargee avec succes !');
            }
            catch (err) {
                alert('Erreur: fichier de sauvegarde invalide.\n' + err.message);
            }
            e.target.value = '';
        });
        // v1.1.43 — the Livemap needs cargo definitions, not 16k rolling-stock
        // catalogue objects. Seed only the small cargo-type registry here; material
        // catalogue rows are created lazily when a catalogue-dependent page is opened.
        this._seedCatalogCargoTypes();
        // v1.1.43 — the 36k+ Batch186 catalogue is NOT a Livemap dependency. Older
        // builds parsed 63 heavy catalogue chunks a few seconds after every launch,
        // creating sustained main-thread jank even when the player never opened the
        // rolling-stock UI. FullCatalog is now strictly lazy: UI.switchPage() requests
        // it only when the player opens Matériel or Rames.
        // Load admin overrides (async, non-blocking)
        adminSync.loadOverrides().then(() => {
            if (adminSync.loaded) {
                // v1.1.43 — never rebuild the whole catalogue just because a tiny admin
                // JSON finished loading. Apply only actual changed IDs; the bundled file
                // currently contains zero catalogue overrides, so normal Livemap startup
                // does zero catalogue work here.
                this._applyAdminCatalogOverridesIncremental();
                adminSync.startIncidentLoop(() => new Date());
            }
        });
        // Settings modal
        this._setupSettings(savedState);
        // Incident toast notifications
        window.addEventListener('admin-incident', (event) => {
            const inc = event.detail || {};
            const toast = document.getElementById('incident-toast');
            document.getElementById('incident-toast-title').textContent = String(inc.name || 'Incident');
            document.getElementById('incident-toast-desc').textContent = String(inc.description || '');
            document.getElementById('incident-toast-duration').textContent = `Durée : ${String(inc.duration ?? '?')} min`;
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 8000);
        });
        this.engine.paused = false;
        this.running = true;
        this.engine.onTick = (timeOfDay, dateStr, pt) => this.tick(timeOfDay, dateStr, pt);
        this.engine.onSecondTick = (timeOfDay, dateStr, pt) => this.secondTick(timeOfDay, dateStr, pt);
        this.engine.onMoveTick = (dt, timeOfDay) => this.moveTick(dt, timeOfDay);
        this.gameLoop();
        // v1.1.43 PERF — do NOT replay every historical ORM bbox at startup.
        // Stored schedule geometry is already pinned; routing fetches graph tiles on demand.
        // Clear previous autoSave interval to prevent double-save on re-login
        if (this.autoSaveInterval)
            clearInterval(this.autoSaveInterval);
        // Heavy saves are now idle-scheduled; 60 s avoids random UI stalls every 10 s.
        this.autoSaveInterval = setInterval(() => this.saveState(), 60000);
        // HOTFIX83 — requestAnimationFrame is suspended/throttled when the player
        // opens another browser tab. Keep a lightweight simulation heartbeat alive
        // while hidden so trains continue to move instead of freezing behind Google.
        if (this._backgroundSimInterval)
            clearInterval(this._backgroundSimInterval);
        this._backgroundSimInterval = setInterval(() => {
            if (!this.running || this.engine?.paused || typeof document === 'undefined' || !document.hidden)
                return;
            try {
                this.catchUpAnalytically();
                this.engine.update();
            }
            catch (e) {
                this.diagnostics.record('BACKGROUND_TICK', e);
            }
        }, 500);
        this._hiddenSinceWall = 0;
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this._hiddenSinceWall = Date.now();
                this._hiddenPhysicsLossBaseline = this.engine.discardedPhysicsSeconds;
                this.saveState({ force: true });
            }
            else {
                const wasHidden = !!this._hiddenSinceWall;
                this.catchUpAnalytically();
                this.engine.update();
                const gapSec = wasHidden ? Math.max(0, this.engine.discardedPhysicsSeconds - Number(this._hiddenPhysicsLossBaseline || 0)) : 0;
                this._hiddenSinceWall = 0;
                // Only request timetable recovery for time actually discarded by the
                // engine. A healthy hidden heartbeat MUST NOT reconstruct speed/position
                // just because the player spent more than eight seconds in another tab.
                if (gapSec > 8 && !this.engine.chronologicalClock) {
                    try {
                        const pt = this.engine?.getParisTime?.();
                        const nowMin = pt ? pt.hours * 60 + pt.minutes + (Number(pt.seconds || 0) / 60) : Number(this.timeOfDay || 0);
                        const date = this.engine?.getParisDate?.() || this._currentDate;
                        this.scheduleV2Runtime?.catchUpExistingToClock?.(nowMin, date, { gapSec });
                        this.scheduleV2Runtime?.forceSync?.(nowMin, date);
                        this.scheduleCreator?.refreshMovingCache?.();
                    }
                    catch (e) {
                        this.diagnostics.record('BACKGROUND_CATCHUP', e);
                    }
                }
            }
        });
    }
    _setWorldStationsStatus(message, state = 'loading') {
        if (typeof document === 'undefined')
            return;
        const el = document.getElementById('world-stations-status') || document.getElementById('settings-rail-reference-status');
        if (!el)
            return;
        el.textContent = String(message ?? '');
        el.title = String(message ?? '');
        el.dataset.state = state;
        el.style.opacity = state === 'error' ? '0.9' : '1';
        el.style.color = state === 'error' ? '#fca5a5' : (state === 'done' ? '#bbf7d0' : '#bfdbfe');
    }
    async _indexAllZoomGameplayStations(stations, source = '') {
        if (!Array.isArray(stations) || !stations.length)
            return 0;
        this._setWorldStationsStatus('Gares gameplay : création 0 %');
        const count = await this.world.setBuiltInGameplayStationsAsync(stations, ({ indexed, total, count: ready }) => {
            const pct = total ? Math.round(indexed * 100 / total) : 100;
            this._setWorldStationsStatus(`Gares gameplay : création ${pct} % · ${Number(ready || 0).toLocaleString('fr-FR')}`);
        });
        // v1.1.43 PERF — platform occupancy state is lazy. assignPlatform() creates
        // the station entry on first real use; do not allocate 17,817 empty Maps.
        this.renderer?.invalidateStatic?.();
        this._setWorldStationsStatus(`Gares gameplay : ${count.toLocaleString('fr-FR')} natives · visibles à tous les zooms`, 'done');
        return count;
    }
    _ensureAllZoomGameplayStations() {
        if (this._europeGameplayReady)
            return this._europeGameplayReady;
        if (this.world._builtInStationCount >= 17000 && this.globalStations?.loaded) {
            return Promise.resolve(this.world._builtInStationCount);
        }
        this._setWorldStationsStatus('Gares gameplay : lecture du pack local…');
        const onProgress = (info) => {
            if (info?.phase === 'embedded-shard') {
                const pct = info.totalShards ? Math.round((Math.max(0, info.shard - 1) * 100) / info.totalShards) : 0;
                this._setWorldStationsStatus(`Gares gameplay : fichiers ${pct} % · ${info.shard}/${info.totalShards}`);
            }
            else if (info?.phase === 'embedded-ready' || info?.phase === 'ready-local-europe') {
                this._setWorldStationsStatus(`Gares gameplay : ${Number(info.count || 0).toLocaleString('fr-FR')} lues · création…`);
            }
        };
        this._europeGameplayReady = this.globalStations.load(onProgress).then(async (stations) => {
            await this._indexAllZoomGameplayStations(stations, this.globalStations.source);
            // RC29 — base rail reference is entirely shipped with the game. No IndexedDB
            // cache and no network request may be required to expose freight/ITE or the
            // passenger-station supplement. Optional online sync remains a manual update
            // tool only; it is never part of gameplay startup.
            const embedded = globalThis.__RAILNET_EMBEDDED_REFERENCE__;
            if (Array.isArray(embedded?.points) && embedded.points.length) {
                const merged = await this.world.mergeNativeOSMGameplayStationsAsync(embedded.points, null, 600);
                const count = Number(this.world._builtInStationCount || this.world.stations.length || 0);
                this._setWorldStationsStatus(`Référentiel rail embarqué : ${count.toLocaleString('fr-FR')} points natifs · +${Number(merged.added || 0).toLocaleString('fr-FR')} fret/ITE/gares`, 'done');
            }
            // A manually synced country remains available after an offline restart.
            // Its cached points supplement, never replace, the complete embedded base.
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                try {
                    const cached = await this.railReferenceSync.loadCachedIntoWorld(this.world);
                    if (cached.countries)
                        this._setWorldStationsStatus(`Référentiel hors ligne : ${Number(this.world.stations.length).toLocaleString('fr-FR')} points · ${cached.countries} pays en cache`, 'done');
                }
                catch (error) {
                    console.warn('Cached rail-reference restoration failed:', error);
                }
            }
            return Number(this.world._builtInStationCount || this.world.stations.length || 0);
        }).catch((err) => {
            console.warn('Gameplay station baseline unavailable:', err);
            this._setWorldStationsStatus('Gares gameplay : pack local indisponible', 'error');
            return 0;
        });
        this._globalStationsLoading = this._europeGameplayReady;
        return this._europeGameplayReady;
    }
    _startRailReferenceSync() {
        if (this._railReferenceSyncStarted)
            return;
        this._railReferenceSyncStarted = true;
        if (this._railReferenceSyncTimer)
            clearTimeout(this._railReferenceSyncTimer);
        this._railReferenceSyncTimer = setTimeout(() => {
            this._railReferenceSyncTimer = null;
            void this.railReferenceSync.syncAll(this.world, (p) => {
                const stations = Number(p.stations || 0).toLocaleString('fr-FR');
                const freight = Number(p.freightSites || 0).toLocaleString('fr-FR');
                if (p.phase === 'country-start') {
                    this._setWorldStationsStatus(`Référentiel rail ${p.index || 0}/${p.totalCountries || 0} · ${p.iso || ''} · synchronisation…`);
                }
                else if (p.phase === 'country-done' || p.phase === 'country-fresh') {
                    this._setWorldStationsStatus(`Référentiel rail ${p.index || 0}/${p.totalCountries || 0} · ${stations} gares · ${freight} fret/ITE`, p.index === p.totalCountries ? 'done' : 'loading');
                }
                else if (p.phase === 'country-error') {
                    this._setWorldStationsStatus(`Référentiel rail ${p.index || 0}/${p.totalCountries || 0} · ${p.iso || ''} indisponible · cache conservé`, 'loading');
                }
            }).then((r) => {
                this.renderer?.invalidateStatic?.();
                const total = Number(this.world._builtInStationCount || this.world.stations.length || 0);
                this._setWorldStationsStatus(`Référentiel rail : ${total.toLocaleString('fr-FR')} points natifs · ${Number(r.freightSites || 0).toLocaleString('fr-FR')} fret/ITE référencés${r.errors ? ` · ${r.errors} source(s) à retenter` : ''}`, r.errors ? 'loading' : 'done');
            }).catch((err) => {
                console.warn('Rail reference sync failed:', err);
                const total = Number(this.world._builtInStationCount || this.world.stations.length || 0);
                this._setWorldStationsStatus(`Référentiel rail : ${total.toLocaleString('fr-FR')} points locaux · synchronisation reportée`, 'error');
            });
        }, 3500);
    }
    _streamNativeOSMViewport(force = false) {
        // Replaying elapsed simulation must not multiply external viewport requests.
        if (this.engine?.getReplayDebtSeconds?.() > 2)
            return Promise.resolve(this.world?._builtInStationCount || 0);
        const tm = this.renderer?.tileMap;
        if (!tm || !this.world || !this.orm)
            return Promise.resolve(0);
        // Country/continent zooms can cover hundreds of thousands of km². The map tiles
        // still render there, but detailed station/network data starts at a local zoom.
        // This keeps Overpass and the browser responsive on low-end machines.
        const zoom = Number(tm.zoomLevel || 0);
        if (zoom < 10) {
            const count = this.world._builtInStationCount || this.world.stations?.length || 0;
            if (force)
                this._setWorldStationsStatus(`Gares gameplay : ${Number(count).toLocaleString('fr-FR')} visibles · OSM local à zoom 10+`, count ? 'done' : 'loading');
            return Promise.resolve(count);
        }
        const now = Date.now();
        if (!force && now - (this._osmNativeLastAttempt || 0) < 1200) {
            return this._osmNativeStreamPromise || Promise.resolve(this.world._builtInStationCount || 0);
        }
        const w = this.renderer?.logicalWidth || tm.viewportWidth || 1024;
        const h = this.renderer?.logicalHeight || tm.viewportHeight || 768;
        const tl = tm.screenToWorld(0, 0, w, h);
        const br = tm.screenToWorld(w, h, w, h);
        if (!tl || !br)
            return Promise.resolve(this.world._builtInStationCount || 0);
        let south = Math.min(tl.lat, br.lat), north = Math.max(tl.lat, br.lat);
        let west = Math.min(tl.lon, br.lon), east = Math.max(tl.lon, br.lon);
        if (![south, north, west, east].every(Number.isFinite))
            return Promise.resolve(0);
        // Quantised/padded viewport = stable cache keys while panning a few pixels.
        const padLat = Math.max(0.015, (north - south) * 0.12);
        const midLat = (south + north) / 2;
        const padLon = Math.max(0.02, (east - west) * 0.12 / Math.max(0.35, Math.cos(midLat * Math.PI / 180)));
        south = Math.max(-90, south - padLat);
        north = Math.min(90, north + padLat);
        west = Math.max(-180, west - padLon);
        east = Math.min(180, east + padLon);
        const q = (v) => (Math.round(v * 20) / 20).toFixed(2); // 0.05° cells
        const key = `${q(south)},${q(west)},${q(north)},${q(east)}`;
        if (!force && key === this._osmNativeViewportKey) {
            return this._osmNativeStreamPromise || Promise.resolve(this.world._builtInStationCount || 0);
        }
        if (this._osmNativeStreamPromise)
            return this._osmNativeStreamPromise;
        this._osmNativeViewportKey = key;
        this._osmNativeLastAttempt = now;
        const before = this.world._builtInStationCount || 0;
        this._setWorldStationsStatus(`OSM/ORM natif : chargement de la zone… · ${before.toLocaleString('fr-FR')} gares en mémoire`);
        const p = (async () => {
            // The ORM raster already shows the physical railway. We only stream station
            // metadata while panning; OSM rail geometry is fetched lazily when gameplay
            // actually needs routing/snap. This is the key performance rule: everything is
            // available, but unused Europe is never turned into RAM-resident graph data.
            let stations = [];
            try {
                stations = await this.orm.fetchStationsTiled(south, west, north, east, (info) => {
                    if (info?.phase?.startsWith('stations')) {
                        const done = Number(info.done || 0), total = Number(info.total || 0);
                        const pct = total ? Math.round(done * 100 / total) : 0;
                        this._setWorldStationsStatus(`OSM/ORM natif : gares ${pct} % · ${Number(info.stations || 0).toLocaleString('fr-FR')} trouvées`);
                    }
                }, 60);
            }
            catch (err) {
                console.warn('OSM/ORM native station load deferred:', err);
            }
            if (stations.length) {
                await (this.world.mergeNativeOSMGameplayStationsAsync ? this.world.mergeNativeOSMGameplayStationsAsync(stations, null, 600) : this.world.setBuiltInGameplayStationsAsync(stations, null, 600));
            }
            this.renderer?.invalidateStatic?.();
            const count = this.world._builtInStationCount || 0;
            const wayCount = this.orm.getNetworkStats?.().ways || this.orm._ways?.size || 0;
            this._setWorldStationsStatus(`OSM/ORM = JEU · ${count.toLocaleString('fr-FR')} gares natives chargées · ${Number(wayCount).toLocaleString('fr-FR')} ways rail`, 'done');
            return count;
        })().finally(() => {
            this._osmNativeStreamPromise = null;
        });
        this._osmNativeStreamPromise = p;
        return p;
    }
    // Seed the built-in rolling-stock catalog (idempotent: only adds missing entries by id).
    // Also auto-adds any cargo type referenced by the catalog that the game doesn't know yet.
    _seedCatalogCargoTypes() {
        if (this._catalogCargoTypesSeeded)
            return;
        this._catalogCargoTypesSeeded = true;
        if (Array.isArray(CATALOG_CARGO_TYPES_BASE) && this.cargoTypes?.ensureType) {
            for (const ct of CATALOG_CARGO_TYPES_BASE)
                this.cargoTypes.ensureType(ct.category, ct);
        }
        if (Array.isArray(BATCH186_FREIGHT_CARGO_TYPES) && this.cargoTypes?.ensureType) {
            for (const ct of BATCH186_FREIGHT_CARGO_TYPES)
                this.cargoTypes.ensureType(ct.category, ct);
        }
        if (Array.isArray(BATCH186_FREIGHT_PASS2_CARGO_TYPES) && this.cargoTypes?.ensureType) {
            for (const ct of BATCH186_FREIGHT_PASS2_CARGO_TYPES)
                this.cargoTypes.ensureType(ct.category, ct);
        }
        if (Array.isArray(CATALOG_NORMALIZATION_EXTRA_CARGO_TYPES) && this.cargoTypes?.ensureType) {
            for (const ct of CATALOG_NORMALIZATION_EXTRA_CARGO_TYPES)
                this.cargoTypes.ensureType(ct.category, ct);
        }
    }
    async _ensureBaseCatalogModulesLoaded() {
        if (this._baseCatalogModules)
            return this._baseCatalogModules;
        if (this._baseCatalogModulesPromise)
            return this._baseCatalogModulesPromise;
        // v1.1.43 PERF — these modules instantiate ~30k catalogue/identity objects
        // (~52 MB measured heap) and are irrelevant to an idle Livemap. Execute them
        // only when the player opens a material-dependent page.
        this._baseCatalogModulesPromise = (async () => {
            return Promise.all(['catalog-data.js', 'catalog-data-pack-re.js', 'catalog-identity-batch186.js'].map(loadCatalogClassicModule));
        })().then(([data, pack, identity]) => {
            this._baseCatalogModules = {
                CATALOG: data.CATALOG || [],
                CATALOG_PACK_RE: pack.CATALOG_PACK_RE || [],
                CATALOG_IDENTITY_BATCH186: identity.CATALOG_IDENTITY_BATCH186 || {},
            };
            return this._baseCatalogModules;
        }).catch((err) => {
            this._baseCatalogModulesPromise = null;
            throw err;
        });
        return this._baseCatalogModulesPromise;
    }
    async _ensureBaseCatalogSeeded() {
        if (this._baseCatalogSeeded)
            return 0;
        this._seedCatalogCargoTypes();
        await this._ensureBaseCatalogModulesLoaded();
        // A concurrent caller may have completed while this one awaited imports.
        if (this._baseCatalogSeeded)
            return 0;
        const added = this.seedCatalog();
        this._baseCatalogSeeded = true;
        this._refreshExternalCatalogRames(this.rameManager.recoverMissingWagonCargoTypes(this.rollingStock, this.scheduleCreator.getActiveServices(), (id) => this.rotationV2.getRameVehicles(id).map((v) => v.id)));
        return added;
    }
    /** Old saves omitted wagon cargo checkboxes from Rames and pristine catalogue
     * rows from rollingStock. Only those affected saves need a deferred catalogue
     * load when resumed directly on Livemap; normal startup stays catalogue-lazy. */
    _queueLegacyWagonCargoRecovery() {
        const savedRames = this.rameManager.rames;
        const needsCargo = () => savedRames.some((rame) => rame.elementDetails.some((element) => String(element.category).toLowerCase() === 'wagon' && Number(element.freightCapacity) > 0 &&
            (!Array.isArray(element.cargoTypes) || element.cargoTypes.length === 0)));
        if (!needsCargo())
            return null;
        const pending = this._legacyWagonCargoRecoveryByRames.get(savedRames);
        if (pending)
            return pending;
        // Schedule after the save transaction and first UI turn. The base catalogue
        // fixes most old consists; load the larger Batch186 pack only if still needed.
        const recovery = new Promise(resolve => setTimeout(resolve, 0)).then(async () => {
            if (savedRames !== this.rameManager.rames)
                return;
            await this._ensureBaseCatalogSeeded();
            if (savedRames !== this.rameManager.rames || !needsCargo())
                return;
            await this._loadBatch186FullCatalogInBackground();
        }).catch(error => { this.diagnostics.record('FREIGHT_CARGO_CATALOG', error); });
        this._legacyWagonCargoRecoveryByRames.set(savedRames, recovery);
        return recovery;
    }
    seedCatalog() {
        this._seedCatalogCargoTypes();
        const modules = this._baseCatalogModules;
        if (!modules)
            return 0;
        const { CATALOG = [], CATALOG_PACK_RE = [], CATALOG_IDENTITY_BATCH186 = {} } = modules;
        // Seed the rolling-stock entries only when a catalogue-dependent page is opened.
        let allCatalog = [...(Array.isArray(CATALOG) ? CATALOG : [])];
        allCatalog = applyBatch186FreightToCatalog(allCatalog);
        allCatalog = applyBatch186FreightPass2ToCatalog(allCatalog);
        // Batch186 FullCatalog: normalize unambiguous legacy categories, then append every
        // in-scope MLG rolling-stock drawing not already represented by the old catalog.
        allCatalog = applyBatch186CategoryOverrides(allCatalog);
        if (this._batch186FullCatalogLoaded && Array.isArray(this._batch186FullCatalogAdditions) && this._batch186FullCatalogAdditions.length)
            allCatalog = allCatalog.concat(this._batch186FullCatalogAdditions);
        if (Array.isArray(CATALOG_PACK_RE))
            allCatalog = allCatalog.concat(CATALOG_PACK_RE);
        // Normalize legacy Pack RE cargo labels to canonical internal keys.
        allCatalog = normalizeCatalogCargoKeys(allCatalog);
        allCatalog = correctCatalogImagePaths(allCatalog);
        // Attach Pass12/Batch186 identity to legacy catalog entries. FullCatalog additions
        // already carry their own identity metadata; Pack RE entries remain independent.
        allCatalog = allCatalog.map((entry) => {
            const ident = CATALOG_IDENTITY_BATCH186?.[entry.id];
            return ident ? { ...entry, ...ident, mlgSeriesName: entry.seriesName || '' } : entry;
        });
        // Purchase prices are game-balance values. Complete high-speed trainsets are capped
        // at 6 M€, and component pricing keeps typical TGV/ICE formations under that scale.
        allCatalog = applyBalancedPurchasePrices(allCatalog);
        // Admin overrides are last so explicit user/admin edits always win over generated data.
        allCatalog = adminSync.applyCatalogOverrides(allCatalog);
        // v1.1.43 — 63 catalogue chunks used to rebuild a Set of every existing
        // rolling-stock id for every chunk. Reuse one index for the whole background load.
        const existing = this._batch186ExistingIds || (this._batch186ExistingIds = new Set(this.rollingStock.getAll().map((i) => i.id)));
        let added = 0;
        for (const entry of allCatalog) {
            if (existing.has(entry.id))
                continue;
            this.rollingStock.add({ ...entry, _catalog: true });
            existing.add(entry.id);
            added++;
        }
        if (added && this.ui?.activePage === 'rolling-stock')
            this.ui.renderStockList();
        return added;
    }
    _applyAdminCatalogOverridesIncremental() {
        const ov = adminSync.overrides || {};
        const deletions = Array.isArray(ov.deletions) ? ov.deletions : [];
        const modifications = Array.isArray(ov.modifications) ? ov.modifications : [];
        const imports = Array.isArray(ov.imports) ? ov.imports : [];
        if (!deletions.length && !modifications.length && !imports.length)
            return 0;
        let changed = 0;
        const modifiedIds = [];
        if (deletions.length) {
            for (const id of deletions) {
                if (!id || !this.rollingStock.getById(id))
                    continue;
                this.rollingStock.remove(id);
                changed++;
            }
        }
        for (const mod of modifications) {
            if (!mod?.id)
                continue;
            const item = this.rollingStock.getById(mod.id);
            // Preserve a player's edited catalogue copy. Admin changes target pristine
            // catalogue records, not user modifications saved locally.
            if (item && item._catalog && !item._edited) {
                // Route authoritative admin changes through the same model sanitiser as player
                // edits, but do not mark the pristine catalogue row as a local player edit.
                if (this.rollingStock.update(item.id, mod, { markEdited: false })) {
                    changed++;
                    modifiedIds.push(item.id);
                }
            }
        }
        for (const imp of imports) {
            if (!imp?.id || this.rollingStock.getById(imp.id))
                continue;
            this.rollingStock.add({ ...imp, _catalog: true });
            changed++;
        }
        this._batch186ExistingIds = new Set(this.rollingStock.getAll().map((i) => i.id));
        if (modifiedIds.length)
            this._refreshExternalCatalogRames(this.rameManager.refreshCatalogDetails(this.rollingStock, modifiedIds, this.scheduleCreator.getActiveServices(), (id) => this.rotationV2.getRameVehicles(id).map((v) => v.id)));
        if (changed)
            this.catalogChanged([...deletions, ...modifications.map(row => row.id), ...imports.map(row => row.id)].filter((id) => typeof id === 'string'));
        if (changed && this.ui?.activePage === 'rolling-stock')
            this.ui.renderStockList();
        return changed;
    }
    _seedBatch186CatalogChunk(chunk) {
        if (!Array.isArray(chunk) || chunk.length === 0)
            return 0;
        let entries = normalizeCatalogCargoKeys(chunk);
        entries = correctCatalogImagePaths(entries);
        entries = applyBalancedPurchasePrices(entries);
        entries = adminSync.applyCatalogOverrides(entries);
        // Reuse the catalogue-wide id index created by seedCatalog. Rebuilding a Set
        // from ~36k entries for each of the 63 Batch186 chunks was a startup CPU storm.
        const existing = this._batch186ExistingIds || (this._batch186ExistingIds = new Set(this.rollingStock.getAll().map((i) => i.id)));
        let added = 0;
        for (const entry of entries) {
            if (existing.has(entry.id))
                continue;
            this.rollingStock.add({ ...entry, _catalog: true });
            existing.add(entry.id);
            added++;
        }
        // Never rebuild the 36k-card catalogue DOM while the player is on the livemap.
        if (added && this.ui?.activePage === 'rolling-stock') {
            clearTimeout(this._catalogRenderTimer);
            this._catalogRenderTimer = setTimeout(() => this.ui?.renderStockList(), 250);
        }
        return added;
    }
    _setCatalogLoadStatus(message, state = 'loading') {
        if (typeof document === 'undefined')
            return;
        let el = document.getElementById('catalog-load-status');
        if (!el) {
            el = document.createElement('div');
            el.id = 'catalog-load-status';
            el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:10000;padding:8px 14px;border-radius:8px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;box-shadow:0 6px 24px rgba(0,0,0,.35);font:600 12px system-ui,sans-serif;pointer-events:none';
            document.body.appendChild(el);
        }
        el.textContent = String(message ?? '');
        el.style.display = 'block';
        el.style.borderColor = state === 'error' ? '#ef4444' : (state === 'done' ? '#22c55e' : '#3b82f6');
        if (state === 'done')
            setTimeout(() => { if (el)
                el.style.display = 'none'; }, 1800);
    }
    _protectedCatalogMaterialIds() {
        const physicalFleet = typeof window === 'undefined' ? null : window.__reDefinitif?.inventory;
        return protectedCatalogIds(this.rameManager?.getAll() || [], this.rotationV2?.vehicles || [], physicalFleet?.getState?.().vehicles || []);
    }
    async _applyStoredExternalCatalog() {
        await this.catalogStore.ensureLoaded();
        this._externalCatalogApplied = true;
        const modifiedIds = this.catalogStore.lastInvalidation.ids;
        this._refreshExternalCatalogRames(this.rameManager.refreshCatalogDetails(this.rollingStock, modifiedIds, this.scheduleCreator.getActiveServices(), (id) => this.rotationV2.getRameVehicles(id).map((v) => v.id)));
        return this._externalCatalogLastResult;
    }
    _refreshExternalCatalogRames(rameIds) {
        for (const id of rameIds) {
            const rame = this.rameManager.getById(id);
            if (!rame)
                continue;
            for (const detail of rame.elementDetails)
                this._applyOwnedLivery(detail);
            this.rotationV2.refreshCatalogRame(rame);
        }
        if (rameIds.length) {
            this.renderer?._trainImageCache?.clear();
            this.ui?.refreshOpenRameCatalogDetails?.(rameIds);
            if (this.ui?.activePage === 'rames')
                this.ui.renderRamesList();
        }
    }
    catalogChanged(changedIds) {
        if (this.catalogStore?.state === 'READY')
            this.catalogStore.refreshFromManager(changedIds);
        window.__reDefinitif?.onCatalogChanged?.();
    }
    updateStockItem(id, data) {
        const item = this.rollingStock.update(id, data);
        if (!item)
            return null;
        const activeServices = this.scheduleCreator.getActiveServices();
        const refreshedRameIds = this.rameManager.refreshCatalogDetails(this.rollingStock, [item.id], activeServices, (rameId) => this.rotationV2.getRameVehicles(rameId).map((v) => v.id));
        const deferredRameIds = this.rameManager.pendingCatalogRameIds([item.id]);
        this._refreshExternalCatalogRames(refreshedRameIds);
        this.catalogChanged([item.id]);
        return { item, refreshedRameIds, deferredRameIds };
    }
    async commitCatalogStockItem(id, data) {
        await this.catalogStore.ensureLoaded();
        const existing = id == null ? undefined : this.rollingStock.getById(id);
        if (id != null && !existing)
            throw new Error('Fiche catalogue introuvable.');
        let key = existing?.id || (typeof data.id === 'string' ? data.id.trim() : '');
        if (!key) {
            let suffix = 1;
            do {
                key = `player-stock-${this.catalogStore.generation}-${suffix++}`;
            } while (this.rollingStock.getById(key));
        }
        const row = { ...data, id: key, _edited: true, imageData: typeof data.imageData === 'string' ? data.imageData : undefined };
        await this.catalogStore.commit(this.catalogStore.preview({ format: 'rail-empire-catalog', version: 1,
            modifications: existing ? [row] : [], imports: existing ? [] : [row], deletions: [] }));
        const item = this.rollingStock.getById(key);
        if (!item)
            throw new Error('Publication de la fiche catalogue impossible.');
        const activeServices = this.scheduleCreator.getActiveServices();
        const refreshedRameIds = this.rameManager.refreshCatalogDetails(this.rollingStock, [key], activeServices, (rameId) => this.rotationV2.getRameVehicles(rameId).map((vehicle) => vehicle.id));
        const deferredRameIds = this.rameManager.pendingCatalogRameIds([key]);
        this._refreshExternalCatalogRames(refreshedRameIds);
        this.catalogChanged();
        return { item, refreshedRameIds, deferredRameIds };
    }
    async deleteCatalogStockItem(id) {
        await this.catalogStore.ensureLoaded();
        const key = String(id);
        if (this._protectedCatalogMaterialIds().has(key))
            throw new Error('Cette fiche est utilisée par une rame ou un engin possédé. Retirer son affectation avant de la supprimer.');
        await this.catalogStore.commit(this.catalogStore.preview({ format: 'rail-empire-catalog', version: 1, modifications: [], imports: [], deletions: [key] }));
        this.catalogChanged();
    }
    async _checkpointBeforeCatalogReload() {
        while (this._saveWritePromise)
            await this._saveWritePromise;
        this._saveStateNow({ lowMemory: true });
        const saved = this._saveWritePromise;
        if (!saved || await saved !== true)
            throw new Error('Partie non sauvegardée (quota ou stockage indisponible). Ancien catalogue conservé ; rien ne sera rechargé.');
    }
    async importExternalCatalogFile(file) {
        if (!file || typeof file.name !== 'string')
            throw new Error('Fichier catalogue absent.');
        if (this._catalogImporting || this._importing || this._liveryWriting)
            throw new Error('Un import ou enregistrement est déjà en cours.');
        this._catalogImporting = true;
        try {
            const bundle = await parseExternalCatalogFile(file, parseCatalogJSON);
            // The page reloads immediately after success. A deferred saveState()
            // would be cancelled by navigation, losing the latest gameplay state.
            // Commit the game checkpoint while the previous overlay is still active;
            // if quota/storage rejects it, leave that overlay untouched.
            await this._checkpointBeforeCatalogReload();
            if (this.catalogStore.state === 'READY') {
                const result = await this.catalogStore.commit(this.catalogStore.preview(bundle));
                this._externalCatalogLastResult = result;
                this._refreshExternalCatalogRames(this.rameManager.refreshCatalogDetails(this.rollingStock, result.modifiedIds, this.scheduleCreator.getActiveServices(), (id) => this.rotationV2.getRameVehicles(id).map((v) => v.id)));
                this.catalogChanged();
            }
            else {
                // Imports may be installed before the native catalogue is opened. Merge durable overlays
                // so adding a second series never replaces a player's first imported series.
                const previous = await loadExternalCatalogBundle();
                const modifications = new Map((previous?.modifications || []).map(row => [row.id, row]));
                const imports = new Map((previous?.imports || []).map(row => [row.id, row]));
                const deletions = new Set(previous?.deletions || []);
                for (const id of bundle.deletions) {
                    modifications.delete(id);
                    imports.delete(id);
                    deletions.add(id);
                }
                for (const row of bundle.modifications) {
                    deletions.delete(row.id);
                    if (imports.has(row.id))
                        imports.set(row.id, { ...imports.get(row.id), ...row });
                    else
                        modifications.set(row.id, row);
                }
                for (const row of bundle.imports) {
                    deletions.delete(row.id);
                    imports.set(row.id, row);
                }
                await saveExternalCatalogBundle({ ...bundle, modifications: [...modifications.values()], imports: [...imports.values()], deletions: [...deletions] });
            }
            return {
                modifications: bundle.modifications.length,
                deletions: bundle.deletions.length,
                imports: bundle.imports.length,
                createdAt: bundle.createdAt || '',
            };
        }
        finally {
            this._catalogImporting = false;
        }
    }
    async clearExternalCatalog() {
        if (this._catalogImporting || this._importing || this._liveryWriting)
            throw new Error('Un import ou enregistrement est déjà en cours.');
        this._catalogImporting = true;
        try {
            await this._checkpointBeforeCatalogReload();
            await clearExternalCatalogBundle();
        }
        finally {
            this._catalogImporting = false;
        }
    }
    _loadBatch186FullCatalogInBackground() {
        return this.catalogStore.ensureLoaded().then(() => {
            this._setCatalogLoadStatus(this.catalogStore.diagnostic, 'done');
            this.ui?._populateMaterialAdvancedFilters?.('stock', true);
            this.ui?._populateMaterialAdvancedFilters?.('rame', true);
            if (this.ui?.activePage === 'rolling-stock')
                this.ui.renderStockList();
            return this._batch186FullCatalogAdditions;
        }).catch((error) => {
            this._setCatalogLoadStatus(this.catalogStore.diagnostic, 'error');
            this.diagnostics.record('CATALOG_STORE', error);
            return [];
        });
    }
    _loadNativeCatalog() {
        if (this._batch186FullCatalogLoaded)
            return Promise.resolve(this._batch186FullCatalogAdditions);
        if (this._batch186FullCatalogLoading)
            return this._batch186FullCatalogLoading;
        const run = (async () => {
            await this._ensureBaseCatalogSeeded();
            if (this._batch186FullCatalogLoaded)
                return this._batch186FullCatalogAdditions;
            this._setCatalogLoadStatus('Catalogue complet : chargement 0 %');
            this._batch186FullCatalogAdditions = [];
            const additions = await loadBatch186FullCatalogAdditions((done, total, count, chunk) => {
                if (Array.isArray(chunk) && chunk.length) {
                    this._batch186FullCatalogAdditions.push(...chunk);
                    this._seedBatch186CatalogChunk(chunk);
                }
                const pct = Math.round(done * 100 / total);
                this._setCatalogLoadStatus(`Catalogue complet : ${pct} % · ${count.toLocaleString('fr-FR')} fiches ajoutées`);
            });
            // Loader returns the same rows; chunks were already injected progressively.
            if (this._batch186FullCatalogAdditions.length !== (Array.isArray(additions) ? additions.length : 0)) {
                this._batch186FullCatalogAdditions = Array.isArray(additions) ? additions : this._batch186FullCatalogAdditions;
            }
            this._seedBatch186CatalogChunk(additions);
            this._batch186FullCatalogLoaded = true;
            // FullCatalog arrives in chunks. Run one bounded pass after the final
            // chunk so restored wagons can find their models without 63 full scans.
            this._refreshExternalCatalogRames(this.rameManager.recoverMissingWagonCargoTypes(this.rollingStock, this.scheduleCreator.getActiveServices(), (id) => this.rotationV2.getRameVehicles(id).map((v) => v.id)));
            this.refreshLiveryImages(false);
            if (this.ui?.activePage === 'rolling-stock')
                this.ui.renderStockList();
            return this._batch186FullCatalogAdditions;
        })().catch((err) => {
            console.error('Batch186 FullCatalog lazy load failed:', err);
            this._setCatalogLoadStatus('Catalogue complet non chargé — jeu utilisable avec le catalogue de base', 'error');
            throw err;
        }).finally(() => {
            this._batch186FullCatalogLoading = null;
        });
        this._batch186FullCatalogLoading = run;
        return run;
    }
    _setupSettings(savedState = null) {
        const modal = document.getElementById('modal-settings');
        const btnSettings = document.getElementById('btn-settings');
        const nameInput = document.getElementById('settings-company-name');
        const logoInput = document.getElementById('settings-logo-url');
        const colorInput = document.getElementById('settings-company-color');
        const incidentsToggle = document.getElementById('settings-incidents-enabled');
        const physicsInput = document.getElementById('settings-physics');
        const weatherInput = document.getElementById('settings-weather');
        const breakdownInput = document.getElementById('settings-breakdown');
        const delayToleranceInput = document.getElementById('settings-delay-tolerance');
        const physicsVal = document.getElementById('settings-physics-val');
        const weatherVal = document.getElementById('settings-weather-val');
        const breakdownVal = document.getElementById('settings-breakdown-val');
        const delayToleranceVal = document.getElementById('settings-delay-tolerance-val');
        const rotationsRequiredInput = document.getElementById('settings-rotations-required');
        const personnelRequiredInput = document.getElementById('settings-personnel-required');
        const gameplayModeInput = document.getElementById('settings-gameplay-mode');
        const stationsEnabledInput = document.getElementById('settings-stations-enabled');
        const easyCompetitionInput = document.getElementById('settings-easy-competition');
        const easyCompetitionRow = document.getElementById('settings-easy-competition-row')
            || easyCompetitionInput?.closest('label');
        const priceSlowInput = document.getElementById('settings-price-slow');
        const priceRegionalInput = document.getElementById('settings-price-regional');
        const priceIntercityInput = document.getElementById('settings-price-intercity');
        const priceFastInput = document.getElementById('settings-price-fast');
        const priceTgvInput = document.getElementById('settings-price-tgv');
        const priceSlowVal = document.getElementById('settings-price-slow-val');
        const priceRegionalVal = document.getElementById('settings-price-regional-val');
        const priceIntercityVal = document.getElementById('settings-price-intercity-val');
        const priceFastVal = document.getElementById('settings-price-fast-val');
        const priceTgvVal = document.getElementById('settings-price-tgv-val');
        const railReferenceSyncBtn = document.getElementById('settings-sync-rail-reference');
        const saveBtn = document.getElementById('settings-save');
        // Load saved settings
        let settings = {};
        try {
            {
                const parsed = JSON.parse(localStorage.getItem('re_player_settings') || '{}');
                settings = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            }
        }
        catch (e) { }
        if (!savedState && settings.realism) {
            const chosenMode = this.getGameplayModeState();
            this.realismSettings = { ...this.realismSettings, ...settings.realism };
            // A fresh game's login choice has priority over the previous company's
            // preferences, while its other realism sliders may still be reused.
            this.realismSettings.difficulty = chosenMode.difficulty;
            this.realismSettings.easyCompetitionEnabled = chosenMode.easyCompetitionEnabled;
        }
        this._applyGameplayModeSettings();
        const definitiveMode = window.__reDefinitif;
        if (!savedState)
            definitiveMode?.resetForNewGame?.();
        else
            definitiveMode?.onGameplayModeChange?.();
        // RC29: one master setting controls both admin incidents and the local
        // IncidentManager (random + weather). RC28 only wired adminSync.
        this.incidentManager.disabled = settings.incidentsEnabled === false;
        const updateRealismLabels = () => {
            if (physicsVal)
                physicsVal.textContent = Number(physicsInput.value).toFixed(2);
            if (weatherVal)
                weatherVal.textContent = Number(weatherInput.value).toFixed(2);
            if (breakdownVal)
                breakdownVal.textContent = Number(breakdownInput.value).toFixed(2);
            if (delayToleranceVal)
                delayToleranceVal.textContent = delayToleranceInput.value;
        };
        const fmtPrice = (v, unit) => `${Number(v).toFixed(2)} ${unit}`;
        const updatePriceLabels = () => {
            if (priceSlowVal)
                priceSlowVal.textContent = fmtPrice(priceSlowInput.value, '€/pax·km');
            if (priceRegionalVal)
                priceRegionalVal.textContent = fmtPrice(priceRegionalInput.value, '€/pax·km');
            if (priceIntercityVal)
                priceIntercityVal.textContent = fmtPrice(priceIntercityInput.value, '€/pax·km');
            if (priceFastVal)
                priceFastVal.textContent = fmtPrice(priceFastInput.value, '€/pax·km');
            if (priceTgvVal)
                priceTgvVal.textContent = fmtPrice(priceTgvInput.value, '€/pax·km');
        };
        [physicsInput, weatherInput, breakdownInput, delayToleranceInput].forEach((el) => {
            el?.addEventListener('input', updateRealismLabels);
        });
        [priceSlowInput, priceRegionalInput, priceIntercityInput, priceFastInput, priceTgvInput].forEach((el) => {
            el?.addEventListener('input', updatePriceLabels);
        });
        const displayModeOptions = () => {
            const expert = gameplayModeInput?.value === 'expert';
            if (easyCompetitionRow)
                easyCompetitionRow.style.display = expert ? 'none' : 'flex';
            if (easyCompetitionInput)
                easyCompetitionInput.disabled = expert;
            if (rotationsRequiredInput) {
                rotationsRequiredInput.checked = false;
                rotationsRequiredInput.disabled = true;
            }
            if (personnelRequiredInput) {
                personnelRequiredInput.checked = expert;
                personnelRequiredInput.disabled = true;
            }
        };
        gameplayModeInput?.addEventListener('change', displayModeOptions);
        railReferenceSyncBtn?.addEventListener('click', () => {
            if (railReferenceSyncBtn.disabled)
                return;
            railReferenceSyncBtn.disabled = true;
            const oldLabel = railReferenceSyncBtn.textContent || 'Synchroniser gares + fret + ITE';
            railReferenceSyncBtn.textContent = 'Synchronisation en cours…';
            void this.railReferenceSync.syncAll(this.world, (p) => {
                const idx = Number(p.index || 0), totalCountries = Number(p.totalCountries || 0);
                const stations = Number(p.stations || 0).toLocaleString('fr-FR');
                const freight = Number(p.freightSites || 0).toLocaleString('fr-FR');
                this._setWorldStationsStatus(`Référentiel rail ${idx}/${totalCountries} · ${p.iso || ''} · ${stations} gares · ${freight} fret/ITE`);
            }, true).then((r) => {
                this.renderer?.invalidateStatic?.();
                if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                    this._setWorldStationsStatus(`Référentiel hors connexion : pack local actif · ${r.countries} pays en cache · ${Number(this.world.stations.length).toLocaleString('fr-FR')} points`, 'done');
                    return;
                }
                const total = Number(this.world._builtInStationCount || this.world.stations.length || 0);
                this._setWorldStationsStatus(`Référentiel rail : ${total.toLocaleString('fr-FR')} points natifs · ${Number(r.freightSites || 0).toLocaleString('fr-FR')} fret/ITE · ${r.errors ? `${r.errors} pays à retenter` : 'à jour'}`, r.errors ? 'loading' : 'done');
            }).catch((err) => {
                console.warn('Manual rail reference sync failed:', err);
                this._setWorldStationsStatus('Référentiel rail : synchronisation impossible pour le moment · cache local conservé', 'error');
            }).finally(() => {
                railReferenceSyncBtn.disabled = false;
                railReferenceSyncBtn.textContent = oldLabel;
            });
        });
        btnSettings.addEventListener('click', () => {
            const mode = this.getGameplayModeState();
            if (gameplayModeInput)
                gameplayModeInput.value = mode.difficulty;
            if (easyCompetitionInput)
                easyCompetitionInput.checked = mode.easyCompetitionEnabled;
            if (stationsEnabledInput)
                stationsEnabledInput.checked = this.operationalExtensions.stationsEnabled;
            this.ui?.renderRealismSettings?.();
            const policy = normalizeRealismPolicy(this.realismSettings.realismPolicy);
            for (const { id } of REALISM_SYSTEMS) {
                const enabled = document.getElementById(`settings-realism-${id}-enabled`);
                const delegated = document.getElementById(`settings-realism-${id}-delegated`);
                if (enabled)
                    enabled.checked = policy.systems[id].enabled;
                if (delegated)
                    delegated.checked = policy.systems[id].delegated;
            }
            displayModeOptions();
            nameInput.value = this.account.companyName || '';
            logoInput.value = settings.logoUrl || '';
            colorInput.value = settings.companyColor || '#3b82f6';
            incidentsToggle.checked = settings.incidentsEnabled !== false;
            physicsInput.value = this.realismSettings.physics ?? 1;
            weatherInput.value = this.realismSettings.weather ?? 1;
            breakdownInput.value = this.realismSettings.breakdown ?? 1;
            delayToleranceInput.value = this.realismSettings.delayTolerance ?? 30;
            if (rotationsRequiredInput)
                rotationsRequiredInput.checked = this.realismSettings.rotationsRequired === true;
            if (personnelRequiredInput)
                personnelRequiredInput.checked = this.realismSettings.personnelRequired === true;
            const prices = this.economy.passengerPriceByClass || {};
            priceSlowInput.value = String(prices.slow ?? 0.08);
            priceRegionalInput.value = String(prices.regional ?? 0.12);
            priceIntercityInput.value = String(prices.intercity ?? 0.18);
            priceFastInput.value = String(prices.fast ?? 0.30);
            priceTgvInput.value = String(prices.tgv ?? 0.50);
            updateRealismLabels();
            updatePriceLabels();
            modal.classList.remove('hidden');
        });
        modal.querySelector('.modal-close').addEventListener('click', () => modal.classList.add('hidden'));
        saveBtn.addEventListener('click', () => {
            const newName = nameInput.value.trim();
            if (newName) {
                this.account.companyName = newName;
                document.getElementById('company-name').textContent = newName;
            }
            const logoUrl = logoInput.value.trim();
            const color = colorInput.value;
            const incEnabled = incidentsToggle.checked;
            this.realismSettings.physics = parseFloat(physicsInput.value) || 1;
            this.realismSettings.weather = parseFloat(weatherInput.value) || 1;
            this.realismSettings.breakdown = parseFloat(breakdownInput.value) || 1;
            {
                const tol = Number.parseInt(delayToleranceInput.value, 10);
                this.realismSettings.delayTolerance = Number.isFinite(tol) ? Math.max(0, Math.min(120, tol)) : 30;
            }
            // The public mode API owns all derived constraints and the AI preference.
            const selectedMode = gameplayModeInput?.value === 'expert' ? 'expert' : 'easy';
            if (selectedMode !== this.getGameplayModeState().difficulty)
                this.setGameplayDifficulty(selectedMode);
            if (easyCompetitionInput && easyCompetitionInput.checked !== this.getGameplayModeState().easyCompetitionEnabled)
                this.setEasyCompetitionEnabled(easyCompetitionInput.checked);
            this.operationalExtensions.setStationsEnabled(stationsEnabledInput?.checked !== false);
            for (const { id } of REALISM_SYSTEMS) {
                const enabled = document.getElementById(`settings-realism-${id}-enabled`);
                const delegated = document.getElementById(`settings-realism-${id}-delegated`);
                if (enabled || delegated)
                    this.setRealismSystem(id, { enabled: enabled?.checked, delegated: delegated?.checked });
            }
            const infogareNav = document.querySelector('.nav-btn[data-page="infogare"]');
            if (infogareNav)
                infogareNav.hidden = !this.operationalExtensions.stationsEnabled;
            if (!this.operationalExtensions.stationsEnabled && this.ui?.activePage === 'infogare')
                this.ui.switchPage('map');
            this._applyGameplayModeSettings();
            // Section X — tarifs au km modifiables par le joueur, persistés dans la sauvegarde
            this.economy.passengerPriceByClass = {
                slow: parseFloat(priceSlowInput.value) || 0,
                regional: parseFloat(priceRegionalInput.value) || 0,
                intercity: parseFloat(priceIntercityInput.value) || 0,
                fast: parseFloat(priceFastInput.value) || 0,
                tgv: parseFloat(priceTgvInput.value) || 0,
            };
            // Save settings
            const s = { logoUrl, companyColor: color, incidentsEnabled: incEnabled, realism: { ...this.realismSettings } };
            try {
                localStorage.setItem('re_player_settings', JSON.stringify(s));
            }
            catch (e) { }
            // Apply logo
            const logoEl = document.getElementById('company-logo');
            if (logoUrl) {
                logoEl.src = logoUrl;
                logoEl.style.display = 'inline-block';
            }
            else {
                logoEl.style.display = 'none';
            }
            // Apply incidents opt-in to BOTH incident engines.
            adminSync.setOptIn(incEnabled);
            this.incidentManager.disabled = !incEnabled;
            modal.classList.add('hidden');
            this.scheduleV2Runtime?.forceSync?.(this.engine.getParisTime().hours * 60 + this.engine.getParisTime().minutes, this.engine.getParisDate());
            this.saveState();
        });
        // Apply logo on load if saved
        if (settings.logoUrl) {
            const logoEl = document.getElementById('company-logo');
            logoEl.src = settings.logoUrl;
            logoEl.style.display = 'inline-block';
        }
    }
    async exportSaveFile() {
        const btn = document.getElementById('btn-save-file');
        const oldText = btn?.textContent || '';
        try {
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Préparation...';
            }
            // Paint the button state before any serialization work.
            await new Promise((resolve) => requestAnimationFrame(() => resolve()));
            this.gameplayClock.freightGenerationMinute = this.freightManager.lastGenTime;
            const state = {
                gameplayClock: this.gameplayClock.toSave(),
                physicsClock: this.engine.toClockSave?.() || null,
                companyName: this.account.companyName,
                economy: this.economy.toSave(),
                world: this.world.toSave({ pinNativeStationIds: this._collectPinnedNativeStationIds() }),
                rollingStock: this.rollingStock.toSave(),
                rames: this.rameManager.toSave(),
                liveries: this.liveries.toSave(),
                scheduleV2: this.scheduleV2.toSave(),
                rotationsV2: this.rotationV2.toSave(),
                v2Runtime: this.scheduleV2Runtime?.toSave?.() || { schemaVersion: 1, services: [] },
                ultimate: this.ultimate.toSave(),
                tutorial: this.tutorial.snapshot(),
                operationalExtensions: this.operationalExtensions.toSave(),
                operationalReplay: this.operationalReplay.toSave(),
                stationResources: this.stationResources.toSave(),
                vehicleBrakeState: this.vehicleBrakeState.toSave(),
                interlocking: this.cantonManager.toSave(),
                freightOperations: this.freightOperations.toSave(),
                depots: this.depotManager.toSave(),
                activeIncidents: this.incidentManager.getActiveIncidentsSave(),
                incidentCadence: this.incidentManager.getCadenceSave(),
                incidentEnabledTypes: this.incidentManager.getEnabledTypes(),
                incidentTypesVersion: this.incidentManager.incidentTypesVersion || 56,
                works: this.worksManager.toSave(),
                freightContracts: this.freightManager.toSave(),
                ormRoutes: this.orm.toSave(),
                lines: this.lineManager.toSave(),
                sillons: this.sillonManager.toSave(),
                voiePoints: this.voiePointManager.toSave(),
                dashboard: this.dashboard.toSave(),
                graphMarche: this.graphMarche.toSave(),
                staff: this.staffManager.toSave(),
                bank: this.bank.toSave(),
                weather: this.weather.toSave(),
                unions: this.unions.toSave(),
                seasonal: this.seasonal.toSave(),
                connections: this.connections.toSave(),
                stationUpgrades: this.stationUpgrades.toSave(),
                junctions: this.junctionManager.toSave(),
                cargoTypes: this.cargoTypes.toSave(),
                iteModules: this.iteModules.toSave(),
                industrialClients: this.industrialClients.toSave(),
                marketing: this.marketingManager?.toSave?.() || null,
                definitifFleet: window.__reDefinitif?.toSave?.() || null,
                shunting: this.shuntingManager.toSave(),
                rngState: this.rng ? this.rng.getState() : null,
                realism: { ...this.realismSettings },
                exportDate: new Date().toISOString(),
            };
            const filename = `rail-empire-${this.account.companyName.replace(/\s+/g, '_')}-${new Date().toISOString().slice(0, 10)}`;
            // Capture JSON synchronously for a coherent instant. Gzip may run in a worker;
            // a large JSON snapshot can still cause a short main-thread pause.
            if (btn)
                btn.textContent = 'Compression...';
            const packing = this.storage.makeExportBlob(state);
            await new Promise((resolve) => requestAnimationFrame(() => resolve()));
            const packed = await packing;
            const blob = packed.blob, ext = packed.ext;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename + ext;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
        catch (e) {
            console.error('Export save error:', e);
            alert('Erreur lors de la sauvegarde: ' + e.message);
        }
        finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = oldText || 'Enregistrer';
            }
        }
    }
    _collectPinnedNativeStationIds() {
        const ids = new Set();
        const add = (id) => { if (typeof id === 'string' && id)
            ids.add(id); };
        for (const line of this.lineManager?.getAll?.() || [])
            for (const id of line.stops || [])
                add(id);
        for (const svc of this.scheduleCreator?.services || []) {
            for (const st of svc.stops || [])
                add(st?.stationId);
            for (const st of svc._returnStopsData || svc.returnStops || [])
                add(st?.stationId);
        }
        for (const schedule of this.scheduleV2?.schedules || this.scheduleV2?.getAll?.() || []) {
            for (const ver of schedule?.versions || []) {
                for (const loc of ver?.locations || [])
                    add(loc?.stationId);
            }
        }
        for (const d of this.depotManager?.getAll?.() || [])
            add(d?.stationId);
        for (const sl of this.sillonManager?.getAll?.() || []) {
            add(sl?.fromStationId);
            add(sl?.toStationId);
        }
        for (const vp of this.voiePointManager?.getAll?.() || [])
            add(vp?.stationId);
        for (const t of this.world?.tracks || []) {
            add(t?.stationA);
            add(t?.stationB);
        }
        return ids;
    }
    // S3 Alpha17 source-shape QA ordering markers (runtime calls below remain authoritative):
    // if (s.voiePoints || s.ormRoutes) this.orm.markGraphDirty()
    // this.orm.hydrateCursorRouteMemoryFromSchedules?.(this.scheduleV2)
    _captureImportCheckpoint() {
        // Tile geometry is a shared external OSM cache, outside the player save.
        // ORM points at the same cache; snapshotting it would recursively copy
        // every resident way and point during a save import.
        const externalWorldCaches = [this.worldRailCache, this.orm?._worldRailCache]
            .filter((value) => value instanceof WorldRailCache);
        // A visible weather view owns live RAF/timer/listener handles. A rollback
        // cannot recreate a delivered frame by restoring its former numeric ID.
        const externalRuntimeOwners = [...externalWorldCaches];
        if (this.weather?._mapView)
            externalRuntimeOwners.push(this.weather._mapView);
        if (this.weather?._requestOwnership)
            externalRuntimeOwners.push(this.weather._requestOwnership);
        const tx = new StateTransaction(externalRuntimeOwners);
        // Snapshot this object's fields, but never walk renderer/UI/DOM or external services.
        tx.captureRoot(this, false);
        // Tutorial.restore changes scalar fields and the selected steps reference.
        // Keep its overlay and game back-reference outside the undo graph.
        tx.captureRoot(this.tutorial, false);
        const keys = ['operationalExtensions', 'operationalReplay', 'stationResources', 'freightOperations', 'vehicleBrakeState', 'gameplayClock', 'engine', 'economy', 'world', 'rollingStock', 'rameManager', 'liveries', 'scheduleV2', 'rotationV2',
            'depotManager', 'incidentManager', 'worksManager', 'freightManager', 'lineManager', 'sillonManager', 'voiePointManager',
            'dashboard', 'graphMarche', 'staffManager', 'bank', 'weather', 'unions', 'seasonal', 'connections', 'stationUpgrades',
            'cantonManager', 'platformManager', 'junctionManager', 'cargoTypes', 'iteModules', 'industrialClients', 'marketingManager', 'shuntingManager', 'rng', 'scheduleCreator', 'scheduleV2Runtime', 'orm'];
        // Back-references to the game already occur in seen; renderer and UI stay outside the graph.
        for (const key of keys) {
            const value = this[key];
            if (value && typeof value === 'object')
                tx.captureRoot(value);
        }
        return tx;
    }
    _resetLiveryEditorAfterCommittedImport() {
        // The save/sidecar transaction is already committed. A cosmetic editor
        // refresh cannot turn that durable success into a reported import failure.
        try {
            this.ui?.resetLiveryEditor?.();
        }
        catch (error) {
            console.warn('Rafraîchissement de l’éditeur de livrée impossible après import :', error);
        }
    }
    loadState(input) {
        if (this._liveryWriting)
            throw new Error('Enregistrement d’une livrée en cours.');
        validateSaveDocument(input);
        const cadence = this.incidentManager.getCadenceSave();
        const bridgeTx = window.__reDefinitif?.beginImportTransaction?.();
        let tx = null;
        try {
            tx = this._captureImportCheckpoint();
            this._loadStateUnchecked(input);
            bridgeTx?.commit();
            tx.release();
            this._resetLiveryEditorAfterCommittedImport();
            this._queueLegacyWagonCargoRecovery();
        }
        catch (error) {
            try {
                tx?.rollback();
            }
            finally {
                bridgeTx?.rollback();
            }
            if (tx)
                try {
                    this.weather?._recoverRequestOwnershipAfterRollback();
                }
                catch (recoveryError) {
                    console.error('Récupération des requêtes météo après import échoué :', recoveryError);
                }
            this.incidentManager.loadCadenceSave(cadence);
            throw error;
        }
    }
    /** One import at a time. Simulation/autosave stay suspended until the commit
     * has succeeded; a failed write restores the exact previous in-memory graph. */
    async importState(input) {
        if (this._importing || this._liveryWriting)
            throw new Error('Un import ou enregistrement de livrée est déjà en cours.');
        validateSaveDocument(input);
        if (typeof input.companyName !== 'string' || !input.companyName.trim())
            throw new Error('Nom de compagnie manquant.');
        this._importing = true;
        const wasRunning = this.running, wasPaused = this.engine.paused;
        this.running = false;
        this.engine.paused = true;
        let tx = null;
        let bridgeTx = null;
        let releaseUiLock = () => { };
        const cadence = this.incidentManager.getCadenceSave();
        try {
            releaseUiLock = acquireImportUiLock();
            // Previously requested saves must finish BEFORE checkpoint/persistence.
            if (this._saveWritePromise)
                await this._saveWritePromise;
            bridgeTx = window.__reDefinitif?.beginImportTransaction?.() || null;
            tx = this._captureImportCheckpoint();
            this._loadStateUnchecked(input);
            // Restoring the saved clock unpauses the engine: keep import suspension
            // until the pending storage transaction has actually completed.
            this.running = false;
            this.engine.paused = true;
            const written = await this.storage.saveGame(input);
            if (written !== true)
                throw new Error('Import non enregistré : quota ou stockage indisponible. Partie précédente conservée.');
            this.account.companyName = input.companyName;
            bridgeTx?.commit();
            bridgeTx = null;
            tx.release();
            tx = null;
            this._resetLiveryEditorAfterCommittedImport();
            this._queueLegacyWagonCargoRecovery();
        }
        catch (error) {
            try {
                tx?.rollback();
            }
            finally {
                bridgeTx?.rollback();
            }
            if (tx)
                try {
                    this.weather?._recoverRequestOwnershipAfterRollback();
                }
                catch (recoveryError) {
                    console.error('Récupération des requêtes météo après import échoué :', recoveryError);
                }
            this.incidentManager.loadCadenceSave(cadence);
            throw error;
        }
        finally {
            releaseUiLock();
            this.running = wasRunning;
            this.engine.paused = wasPaused;
            this._importing = false;
        }
    }
    _loadStateUnchecked(s) {
        const resumeResourceEvents = this._suspendPhysicalResourceEvents();
        try {
            this.cantonManager.resetForLoad();
            // These claims are reconstructed from the saved physical services.
            this.platformManager.stationPlatforms.clear();
            const platformClaims = this.platformManager;
            platformClaims.physicalAliases.clear();
            platformClaims.displayNames.clear();
            platformClaims.physicallyReferencedKeys.clear();
            this.operationalExtensions = new OperationalExtensions();
            const operations = s.operationalExtensions;
            if (operations && !this.operationalExtensions.loadFromSave(operations))
                throw new Error("Extension exploitation : sauvegarde incompatible.");
            this.stationResources = new StationResources();
            this.stationResources.connectRuntime(this.platformManager);
            this.vehicleBrakeState = new VehicleBrakeState();
            if (s.vehicleBrakeState) {
                if (s.vehicleBrakeState.schemaVersion !== 1)
                    throw new Error('Freins des véhicules : version incompatible.');
                this.vehicleBrakeState.loadFromSave(s.vehicleBrakeState);
            }
            if (s.stationResources && !this.stationResources.loadFromSave(s.stationResources))
                throw new Error('Gares et flux : sauvegarde incompatible.');
            this.freightOperations = new FreightOperations().connectRuntime(this);
            if (s.freightOperations && !this.freightOperations.loadFromSave(s.freightOperations))
                throw new Error('Fret physique : sauvegarde incompatible.');
            this.operationalReplay = new OperationalReplay();
            if (s.operationalReplay && !this.operationalReplay.loadFromSave(s.operationalReplay))
                throw new Error('Journal de replay : sauvegarde incompatible.');
            const infogareNav = document.querySelector('.nav-btn[data-page="infogare"]');
            if (infogareNav)
                infogareNav.hidden = !this.operationalExtensions.stationsEnabled;
            this.gameplayClock = new GameplayClock();
            this.gameplayClock.load(s.gameplayClock, s.saveTime);
            this.freightManager.lastGenTime = this.gameplayClock.freightGenerationMinute;
            // Ne pas restaurer l'ancien décalage libre gameTime/gameDate.
            // Le curseur physique RC16, lui, reprend exactement avant le rattrapage.
            this.engine.setGameTime(null, null);
            // Resume from the state timestamp, then replay towards real Paris time.
            // Old saves have no precise physics cursor: saveTime is the migration bound.
            this.engine.enableChronologicalReplay(s.physicsClock, Number(s.saveTime) || Date.parse(String(s.exportDate || '')) || Date.now());
            // Saves predating the mode field start in Facile, independent of the mode
            // currently selected in another part loaded earlier in this session.
            const savedRealism = s.realism && typeof s.realism === 'object' ? s.realism : {};
            this.realismSettings = { ...this.realismSettings, ...savedRealism,
                difficulty: savedRealism.difficulty === 'expert' ? 'expert' : 'easy',
                easyCompetitionEnabled: savedRealism.easyCompetitionEnabled === true };
            this._applyGameplayModeSettings();
            const loadPt = this.engine.getParisTime();
            const loadTimeMin = loadPt.hours * 60 + loadPt.minutes + loadPt.seconds / 60;
            const loadDateStr = this.engine.getParisDate();
            if (s.economy)
                this.economy.loadFromSave(s.economy);
            if (s.world)
                this.world.loadFromSave(s.world);
            if (s.rollingStock) {
                this.rollingStock.loadFromSave(s.rollingStock);
                // A second save imported into the same tab replaces the catalogue rows.
                // Its former lazy-load flags must not claim those rows are still present.
                this._baseCatalogSeeded = false;
                this._batch186FullCatalogLoaded = false;
                this._batch186ExistingIds = null;
                this._externalCatalogApplied = false;
                this._externalCatalogLastResult = null;
            }
            this.liveries.loadFromSave(s.liveries);
            if (s.rames)
                this.rameManager.loadFromSave(s.rames, this.rollingStock);
            // V2 is an intentional format break: only V2 payloads are restored.
            // Legacy schedules/sillons are not converted into V2 objects.
            if (s.scheduleV2 && !this.scheduleV2.loadFromSave(s.scheduleV2))
                throw new Error('Schedule V2 : schéma incompatible ou sauvegarde invalide.');
            if (s.rotationsV2 && !this.rotationV2.loadFromSave(s.rotationsV2))
                throw new Error('Roulements V2 : schéma incompatible ou sauvegarde invalide.');
            if (this.scheduleV2Runtime?.loadFromSave?.(s.v2Runtime || { schemaVersion: 1, services: [] }) === false)
                throw new Error('Circulations V2 : schéma incompatible ou sauvegarde invalide.');
            // Restore the saved physical train before reconciling edited catalogue rows.
            // ActiveService is derived on load; these pending runtime snapshots protect its
            // old formation physics until that service actually finishes.
            const savedActiveServices = [...(this.scheduleV2Runtime?._pendingSnapshots?.values() || [])].map(snap => {
                const rotation = this.rotationV2.getRotation(String(snap.rotationId || ''));
                const occurrence = rotation?.occurrences?.find((o) => String(o.id) === String(snap.occurrenceId || ''));
                const direct = this.rotationV2.directAssignments.find((a) => `direct:${a.id}` === String(snap.rotationId || ''));
                return { ...snap,
                    rameId: String(direct?.rameId || occurrence?.rameId || rotation?.assignedRameId || ''),
                    _v2VehicleIds: snap.vehicleIds?.length ? snap.vehicleIds : (snap.formationMembers || []).map((member) => member.vehicleId),
                };
            });
            const legacySavedServices = Array.isArray(s.services) ? s.services : [];
            this._refreshExternalCatalogRames(this.rameManager.refreshSavedCatalogDetails(this.rollingStock, [...savedActiveServices, ...legacySavedServices], (id) => this.rotationV2.getRameVehicles(id).map((v) => v.id)));
            this._refreshExternalCatalogRames(this.rameManager.recoverMissingWagonCargoTypes(this.rollingStock, [...savedActiveServices, ...legacySavedServices], (id) => this.rotationV2.getRameVehicles(id).map((v) => v.id)));
            this.refreshLiveryImages(true, false);
            // ActiveService V2 objects are derived from rotations and intentionally not
            // persisted. Always discard any in-memory derived services on load and reset
            // runtime dedupe/alerts so the due occurrence can be compiled cleanly.
            this.scheduleCreator.services = this.scheduleCreator.services.filter((x) => !x._v2OccurrenceId);
            this.scheduleCreator._invalidateActiveCache?.();
            if (this.scheduleV2Runtime) {
                this.scheduleV2Runtime.alerts = [];
                this.scheduleV2Runtime._alertKeys?.clear?.();
                this.scheduleV2Runtime._alertTimes?.clear?.();
                this.scheduleV2Runtime._timedVersionCache?.clear?.();
                this.scheduleV2Runtime._lastSyncKey = '';
            }
            // Legacy Schedule Creator payload intentionally ignored in V2.
            if (s.depots)
                this.depotManager.loadFromSave(s.depots);
            this.rameManager.reconcileReferences?.({ depots: this.depotManager.getAll?.() || [], stations: this.world.stations || [] });
            // Maintenance queue is authoritative after reload. Repair stale legacy flags
            // in both directions so a rame cannot be simultaneously reusable and in-shop,
            // or permanently inMaintenance with no queue entry.
            {
                const queued = new Set([...(this.depotManager.maintenanceQueue || []), ...(this.depotManager.repairQueue || [])].map(m => String(m.rameId ?? '')).filter(Boolean));
                const depotOps = new Map((this.depotManager.depotOperations || []).map((o) => [String(o.rameId ?? ''), o]));
                for (const rame of this.rameManager.getAll?.() || []) {
                    rame.inMaintenance = queued.has(String(rame.id ?? ''));
                    const op = depotOps.get(String(rame.id ?? ''));
                    rame.depotOperationId = op?.id || '';
                    // Track occupancy is authoritative for physical depot presence after reload.
                    const d = (this.depotManager.getDepots?.() || []).find((x) => x.findRameTrack?.(rame.id));
                    if (d)
                        rame.currentLocation = { ...(rame.currentLocation || {}), depotId: d.id, stationId: '', serviceId: '', lat: d.location?.lat ?? rame.currentLocation?.lat ?? null, lon: d.location?.lon ?? rame.currentLocation?.lon ?? null };
                    else if (rame.currentLocation?.depotId)
                        rame.currentLocation = { ...(rame.currentLocation || {}), depotId: '' };
                }
            }
            // Restore the type whitelist before hydrating active incidents. Keep the
            // activeIncidents guard as the integration boundary used by depot/load QA.
            if (s.activeIncidents) {
                if (s.incidentEnabledTypes)
                    this.incidentManager.setEnabledTypes(s.incidentEnabledTypes, s.incidentTypesVersion || 0);
                this.incidentManager.loadFromSave(s.activeIncidents, this.world);
            }
            else if (s.incidentEnabledTypes) {
                this.incidentManager.setEnabledTypes(s.incidentEnabledTypes, s.incidentTypesVersion || 0);
            }
            this.incidentManager.loadCadenceSave(s.incidentCadence);
            if (s.works)
                this.worksManager.loadFromSave(s.works);
            if (s.freightContracts)
                this.freightManager.loadFromSave(s.freightContracts);
            if (s.ormRoutes)
                this.orm.loadFromSave(s.ormRoutes);
            if (s.lines)
                this.lineManager.loadFromSave(s.lines, this.world);
            // Modern auto-sillons from the Lignes page are independent of legacy schedules.
            // They are native current-game data and must survive autosave/export/import.
            if (Array.isArray(s.sillons))
                this.sillonManager.loadFromSave(s.sillons, this.world);
            else
                this.sillonManager.loadFromSave([], this.world);
            if (s.voiePoints)
                this.voiePointManager.loadFromSave(s.voiePoints, this.world);
            // R-08 : les tronçons utilisateur doivent être rebranchés au graphe après chargement.
            // Do this BEFORE hydrating last-known-good Schedule routes: v1.1.74 topology
            // epochs deliberately invalidate route memory when resident topology changes.
            if (s.voiePoints || s.ormRoutes)
                this.orm.markGraphDirty();
            // v1.1.57/v1.1.74 — rebuild zero-network route memory from fresh VALID schedule
            // geometry only after every load-time topology invalidation has completed.
            this.orm.hydrateCursorRouteMemoryFromSchedules?.(this.scheduleV2);
            if (s.interlocking) {
                const restored = this.cantonManager.loadFromSave(s.interlocking, { restoreEventSequence: true });
                if (!restored.ok)
                    throw new Error(`Enclenchements : ${restored.errors.join('; ')}`);
            }
            // v1.1.86 — saved VALID route snapshots are authoritative on load. Never launch
            // background Overpass revalidation while the player is editing; explicit
            // topology edits/revalidation own that network work.
            if (s.dashboard)
                this.dashboard.loadFromSave(s.dashboard);
            if (s.graphMarche)
                this.graphMarche.loadFromSave(s.graphMarche);
            if (s.staff) {
                this.staffManager.loadFromSave(s.staff);
                // HOTFIX54 — one-time compatibility migration for pre-authorization saves.
                // Existing drivers inherit only families already present in the player's fleet;
                // new drivers and newly acquired families still require explicit training.
                this.staffManager.migrateLegacyMaterialAuthorizations?.(this, loadDateStr);
            }
            if (s.bank)
                this.bank.loadFromSave(s.bank);
            if (s.weather)
                this.weather.loadFromSave(s.weather);
            if (s.unions)
                this.unions.loadFromSave(s.unions);
            if (s.seasonal)
                this.seasonal.loadFromSave(s.seasonal);
            if (s.connections)
                this.connections.loadFromSave(s.connections);
            this.stationUpgrades.loadFromSave(s.stationUpgrades, this.world);
            if (s.junctions)
                this.junctionManager.loadFromSave(s.junctions, this.world, this.rameManager);
            if (s.cargoTypes)
                this.cargoTypes.loadFromSave(s.cargoTypes);
            if (s.iteModules)
                this.iteModules.loadFromSave(s.iteModules);
            this.iteModules.pruneInstallations?.(this.depotManager.getITEs().map((d) => d.id));
            if (s.industrialClients)
                this.industrialClients.loadFromSave(s.industrialClients);
            if (s.marketing)
                this.marketingManager?.loadFromSave?.(s.marketing);
            const definitifFleet = s.definitifFleet;
            const definitiveHost = window;
            if (definitifFleet) {
                if (definitiveHost.__reDefinitif?.restore)
                    definitiveHost.__reDefinitif.restore(definitifFleet);
                else
                    definitiveHost.__reDefinitifPendingFleet = definitifFleet;
            }
            else {
                // A legacy save has no DÉFINITIF fleet; never inherit a different
                // company's Inventory, Occasion listings or competition from the sidecar.
                if (definitiveHost.__reDefinitif?.resetForNewGame)
                    definitiveHost.__reDefinitif.resetForNewGame();
                else
                    definitiveHost.__reDefinitifPendingFleet = { schema: 1, reset: true };
            }
            definitiveHost.__reDefinitif?.onGameplayModeChange?.();
            this.industrialClients.pruneClients?.(this.depotManager.getITEs());
            this.freightManager.pruneIndustrialClientContracts?.(this.industrialClients.clients?.map((c) => c.id) || []);
            if (s.shunting)
                this.shuntingManager.loadFromSave(s.shunting);
            this.ultimate = new UltimateRuntime(this);
            if (!this.ultimate.loadFromSave(s.ultimate))
                throw new Error('Systèmes RC44 : sauvegarde incompatible.');
            this.ultimate.ensureSimpleRameStaff();
            this.tutorial.restore(s.tutorial);
            this.freightManager.reconcileReservations(this.scheduleCreator.services, this.scheduleV2Runtime?._pendingSnapshots?.values());
            // Validated V2 snapshots still own their crews before services are rebuilt.
            this.staffManager.reconcileAssignments?.({ services: [...this.scheduleCreator.services, ...Array.from(this.scheduleV2Runtime?._pendingSnapshots?.keys() || [], id => ({ id }))], stations: this.world.stations, depots: this.depotManager.getAll() });
            this.staffManager.reconcileDepotTaskReservations?.(this.depotManager.depotOperations || []);
            if (this.rng && typeof s.rngState === 'number')
                this.rng.setState(s.rngState);
            // Clear voie point occupations on reload (prevent ghost occupations after crash)
            for (const vp of this.voiePointManager.getAll()) {
                vp.occupiedBy = null;
            }
            for (const trc of this.voiePointManager.getAllTroncons()) {
                trc.occupiedBy = null;
                trc.reservedBy = null;
            }
            // Platform occupancy state is created lazily by assignPlatform(); untouched
            // Europe stations do not need per-station Maps in memory.
            // v1.1.43 PERF — validated route snapshots are authoritative on load.
            // Older builds rebuilt every non-draft V2 route through ORM/Overpass at boot,
            // causing network/graph storms while the player was simply opening Livemap.
            // Runtime integrity checks remain fail-closed; explicit editing/revalidation can
            // rebuild a route when it is actually needed.
            queueMicrotask(() => {
                if (this._importing)
                    return;
                const current = this.engine.getParisTime();
                const resumeEvents = this._suspendPhysicalResourceEvents();
                try {
                    this.scheduleV2Runtime?.sync(current.hours * 60 + current.minutes + current.seconds / 60, this.engine.getParisDate());
                    // A snapshot rejected by reconstruction cannot keep an orphan crew.
                    this.staffManager.reconcileAssignments?.({ services: this.scheduleCreator.services, stations: this.world.stations, depots: this.depotManager.getAll() });
                }
                finally {
                    resumeEvents();
                }
            });
        }
        finally {
            resumeResourceEvents();
        }
    }
    /** Collect the editable sprites without traversing geometry, physics or DOM. */
    liveryTargets(includeRuntime = true) {
        const targets = new Set();
        for (const rame of this.rameManager.getAll())
            for (const e of rame.elementDetails)
                targets.add(e);
        for (const v of this.rotationV2.vehicles)
            targets.add(v);
        if (includeRuntime)
            for (const svc of this.scheduleCreator.services)
                for (const e of svc.rame?.elementDetails || [])
                    targets.add(e);
        return [...targets];
    }
    _applyOwnedLivery(target, strict = false) {
        applyOwnedLivery(target, this.liveries, id => this.rollingStock.getById(id), strict, this._batch186FullCatalogLoaded);
    }
    refreshLiveryImages(strict = false, includeRuntime = true) {
        for (const target of this.liveryTargets(false))
            this._applyOwnedLivery(target, strict);
        if (includeRuntime) {
            const physical = new Map();
            for (const v of this.rotationV2.vehicles)
                physical.set(v.id, v);
            for (const svc of this.scheduleCreator.services) {
                const parent = this.rameManager.getById(svc.rame?.id || svc.rameId || '');
                const sourceElements = new Map();
                for (const element of (parent?.elementDetails || []))
                    if (element.elementId)
                        sourceElements.set(element.elementId, element);
                for (const target of (svc.rame?.elementDetails || [])) {
                    const source = target.physicalVehicleId ? physical.get(target.physicalVehicleId) : target.elementId ? sourceElements.get(target.elementId) : undefined;
                    if (source)
                        copyLiveryAppearance(target, source);
                    this._applyOwnedLivery(target, strict);
                }
            }
        }
        this.renderer?._trainImageCache?.clear();
    }
    async commitLiveryChange(change) {
        if (this._liveryWriting || this._importing)
            throw new Error('Un enregistrement ou import est déjà en cours.');
        this._liveryWriting = true;
        const release = acquireImportUiLock();
        let backup = null;
        const saved = [];
        try {
            while (this._saveWritePromise)
                await this._saveWritePromise;
            backup = this.liveries.toSave();
            for (const target of this.liveryTargets()) {
                const fields = {};
                for (const key of ['liveryId', 'imageData', 'originalImageData']) {
                    const descriptor = Object.getOwnPropertyDescriptor(target, key);
                    if (descriptor)
                        fields[key] = descriptor;
                }
                saved.push({ target, fields });
            }
            change();
            this.refreshLiveryImages(true);
            this._saveStateNow();
            const pending = this._saveWritePromise;
            if (!pending || await pending !== true)
                throw new Error('Livrée non enregistrée : quota ou stockage indisponible. La version précédente est conservée.');
        }
        catch (error) {
            if (backup)
                this.liveries.loadFromSave(backup);
            for (const { target, fields } of saved) {
                for (const key of ['liveryId', 'imageData', 'originalImageData'])
                    Reflect.deleteProperty(target, key);
                Object.defineProperties(target, fields);
            }
            this.refreshLiveryImages(false);
            this.renderer?._trainImageCache?.clear();
            throw error;
        }
        finally {
            this._liveryWriting = false;
            release();
        }
    }
    _saveStateNow(options = null) {
        if (this._importing)
            return null;
        // HOTFIX8 OPERA-FRIENDLY — never build/clone a second full game snapshot
        // while the previous IndexedDB/worker save is still in flight. Coalesce all
        // intermediate requests into one follow-up save with the newest live state.
        if (this._saveWritePromise) {
            this._saveAfterWrite = true;
            this._saveAfterWriteLowMemory = !!this._saveAfterWriteLowMemory || options?.lowMemory === true;
            this._saveAfterWriteRoutePointCount = Math.max(Number(this._saveAfterWriteRoutePointCount || 0), Number(options?.routePointCount || 0));
            return this._lastSaveState || null;
        }
        // Save the canonical material state; prepared services can be older than
        // a depot operation. Mirroring their maxima back would undo maintenance.
        this._applyGameplayModeSettings();
        for (const svc of this.scheduleCreator.getActiveServices()) {
            if (svc.rame && svc.train)
                syncMaterialMileage(svc.rame, svc.train);
        }
        this.gameplayClock.freightGenerationMinute = this.freightManager.lastGenTime;
        const state = {
            gameplayClock: this.gameplayClock.toSave(),
            physicsClock: this.engine.toClockSave?.() || null,
            companyName: this.account.companyName,
            saveTime: Date.now(),
            // saveTime dates the storage operation; physicsClock dates the applied simulation.
            // Keeping both is essential when an offline backlog is saved midway.
            economy: this.economy.toSave(),
            world: this.world.toSave({ pinNativeStationIds: this._collectPinnedNativeStationIds() }),
            rollingStock: this.rollingStock.toSave(),
            rames: this.rameManager.toSave(),
            liveries: this.liveries.toSave(),
            scheduleV2: this.scheduleV2.toSave(),
            rotationsV2: this.rotationV2.toSave(),
            v2Runtime: this.scheduleV2Runtime?.toSave?.() || { schemaVersion: 1, services: [] },
            ultimate: this.ultimate.toSave(),
            tutorial: this.tutorial.snapshot(),
            operationalExtensions: this.operationalExtensions.toSave(),
            operationalReplay: this.operationalReplay.toSave(),
            stationResources: this.stationResources.toSave(),
            vehicleBrakeState: this.vehicleBrakeState.toSave(),
            interlocking: this.cantonManager.toSave(),
            freightOperations: this.freightOperations.toSave(),
            depots: this.depotManager.toSave(),
            activeIncidents: this.incidentManager.getActiveIncidentsSave(),
            incidentCadence: this.incidentManager.getCadenceSave(),
            incidentEnabledTypes: this.incidentManager.getEnabledTypes(),
            incidentTypesVersion: this.incidentManager.incidentTypesVersion || 56,
            works: this.worksManager.toSave(),
            freightContracts: this.freightManager.toSave(),
            ormRoutes: this.orm.toSave(),
            lines: this.lineManager.toSave(),
            sillons: this.sillonManager.toSave(),
            voiePoints: this.voiePointManager.toSave(),
            dashboard: this.dashboard.toSave(),
            graphMarche: this.graphMarche.toSave(),
            staff: this.staffManager.toSave(),
            bank: this.bank.toSave(),
            weather: this.weather.toSave(),
            unions: this.unions.toSave(),
            seasonal: this.seasonal.toSave(),
            connections: this.connections.toSave(),
            stationUpgrades: this.stationUpgrades.toSave(),
            junctions: this.junctionManager.toSave(),
            cargoTypes: this.cargoTypes.toSave(),
            iteModules: this.iteModules.toSave(),
            industrialClients: this.industrialClients.toSave(),
            marketing: this.marketingManager?.toSave?.() || null,
            definitifFleet: window.__reDefinitif?.toSave?.() || null,
            shunting: this.shuntingManager.toSave(),
            rngState: this.rng ? this.rng.getState() : null,
            realism: { ...this.realismSettings },
        };
        const lowMemory = options?.lowMemory === true || Number(options?.routePointCount || 0) > 12000;
        const saveMeta = { saveTime: state.saveTime, lowMemory };
        try {
            let writePromise;
            writePromise = Promise.resolve(this.storage.saveGame(state, { lowMemory }))
                .catch((e) => { console.warn('Auto-save failed:', e); return false; })
                .finally(() => {
                if (this._saveWritePromise === writePromise)
                    this._saveWritePromise = null;
                if (this._saveAfterWrite) {
                    const followLow = !!this._saveAfterWriteLowMemory, followPoints = Number(this._saveAfterWriteRoutePointCount || 0);
                    this._saveAfterWrite = false;
                    this._saveAfterWriteLowMemory = false;
                    this._saveAfterWriteRoutePointCount = 0;
                    this.saveState({ lowMemory: followLow, routePointCount: followPoints });
                }
            });
            this._saveWritePromise = writePromise;
        }
        catch (e) {
            console.warn('Auto-save failed:', e);
        }
        // HOTFIX8 — never retain/return the full serialized world. _lastSaveState is
        // now tiny metadata only, so a completed autosave cannot pin a continental
        // Schedule V2 snapshot in the live heap.
        return saveMeta;
    }
    saveState(options = null) {
        if (this._importing)
            return null;
        const force = options === true || (typeof options === 'object' && options?.force === true);
        const opts = typeof options === 'object' && options ? options : {};
        const lowMemory = opts.lowMemory === true;
        const routePointCount = Math.max(0, Number(opts.routePointCount || 0));
        if (force)
            return this._saveStateNow({ lowMemory, routePointCount });
        // Coalesce the many UI-triggered saves into one idle save. A click never waits
        // for full world/schedule serialization anymore. HOTFIX8 also merges the
        // strongest memory hint until the deferred save actually runs.
        this._savePending = true;
        this._saveLowMemoryPending = !!this._saveLowMemoryPending || lowMemory;
        this._saveRoutePointCountPending = Math.max(Number(this._saveRoutePointCountPending || 0), routePointCount);
        if (this._saveIdleHandle)
            return this._lastSaveState || null;
        const run = () => {
            this._saveIdleHandle = null;
            if (!this._savePending)
                return;
            this._savePending = false;
            const opts = { lowMemory: !!this._saveLowMemoryPending, routePointCount: Number(this._saveRoutePointCountPending || 0) };
            this._saveLowMemoryPending = false;
            this._saveRoutePointCountPending = 0;
            try {
                this._lastSaveState = this._saveStateNow(opts);
            }
            catch (e) {
                console.warn('Deferred save failed:', e);
            }
        };
        if (typeof requestIdleCallback === 'function') {
            this._saveIdleHandle = requestIdleCallback(run, { timeout: 1500 });
        }
        else {
            this._saveIdleHandle = setTimeout(run, 80);
        }
        return this._lastSaveState || null;
    }
    moveTick(dt, timeOfDay) {
        // RC4: avoid scanning the entire fleet for every conflicting canton.
        // The scope is synchronous and always released, including the idle return
        // and exceptions. Safety uses live service objects and rechecks array edits.
        const endServiceLookup = this.cantonManager.beginServiceLookupFrame?.(this.scheduleCreator.services);
        const endCompetitionFrame = window.__reDefinitif?.beginCompetitionFrame?.();
        try {
            this._safetyFleetFrame = undefined;
            const activeServices = [...this.scheduleCreator.getActiveServices().filter((s) => !this.depotManager.ownsServiceMovement?.(s.id)), ...(this.depotManager.getPhysicalRescueServices?.() || [])];
            const movingSvcs = this.scheduleCreator.getMovingServices().filter((svc) => !this.depotManager.ownsServiceMovement?.(svc.id));
            const movingCount = movingSvcs.length;
            // LOD constants tuned for 100k+ simultaneous trains on low-end hardware.
            const HIGH_BUDGET = 500; // full physics per tick
            const MEDIUM_INTERVAL = 1; // RC17: physical cadence is independent of the camera
            const LOW_INTERVAL = 1; // same common controller and dt for every visible/distant train
            const MEDIUM_RADIUS_DEG = 0.5; // ~55 km around camera
            if (!this._tickPhase)
                this._tickPhase = 0;
            this._tickPhase++;
            const lowPhase = this._tickPhase % 30;
            const mediumPhase = this._tickPhase % MEDIUM_INTERVAL;
            const tm = this.renderer?.tileMap;
            // v1.1.43 — true idle fast-path. Waiting/pre-departure services are driven by
            // secondTick; with no moving train there is no reason to build viewport
            // projections, spatial grids, route indexes and LOD arrays ten times/second.
            if (movingCount === 0) {
                if (tm && tm.zoomLevel >= 10 && lowPhase === 0)
                    this._streamNativeOSMViewport(false);
                for (let i = 0; i < activeServices.length; i++) {
                    const svc = activeServices[i];
                    if (svc.state === 'stopped_at_station')
                        svc.moveUpdate(dt, timeOfDay, activeServices);
                }
                this.depotManager.updateRescues(dt, Number(timeOfDay), activeServices);
                if (!this._lastCantonCleanup)
                    this._lastCantonCleanup = 0;
                const idleNow = performance.now();
                if (idleNow - this._lastCantonCleanup > 30000) {
                    this._lastCantonCleanup = idleNow;
                    this.cantonManager.cleanup();
                }
                return;
            }
            // Camera / viewport
            const w = this.renderer?.logicalWidth || 1024;
            const h = this.renderer?.logicalHeight || 768;
            const center = tm ? tm.screenToWorld(w / 2, h / 2, w, h) : null;
            const tl = tm ? tm.screenToWorld(0, 0, w, h) : null;
            const br = tm ? tm.screenToWorld(w, h, w, h) : null;
            const hasViewport = center && tl && br;
            const centerLat = center?.lat ?? 0;
            const centerLon = center?.lon ?? 0;
            const vpMinLat = hasViewport ? Math.min(tl.lat, br.lat) : -90;
            const vpMaxLat = hasViewport ? Math.max(tl.lat, br.lat) : 90;
            const vpMinLon = hasViewport ? Math.min(tl.lon, br.lon) : -180;
            const vpMaxLon = hasViewport ? Math.max(tl.lon, br.lon) : 180;
            // Direct native OSM world: stream the current detailed viewport at low cadence.
            if (hasViewport && lowPhase === 0)
                this._streamNativeOSMViewport(false);
            // Safety spatial grid: index every PHYSICALLY PRESENT train, not only moving
            // ones. A stopped_at_station/broken train is precisely the obstacle followers
            // must never lose from leader/IPCS detection.
            const SERVICE_GRID_CELL = 0.02; // ~2.2 km
            const COARSE_SERVICE_GRID_CELL = 0.1; // ~11 km, for wide braking horizons
            const serviceGrid = new Map();
            const coarseServiceGrid = new Map();
            for (const svc of activeServices) {
                // v1.1.73: physical presence is the only criterion for safety indexing.
                // A waiting/preparation train already positioned on a platform/track is
                // still a real obstacle and must be visible to followers/interlocking.
                if (!svc.position || ['completed', 'cancelled'].includes(svc.state))
                    continue;
                const latKey = Math.floor(svc.position.lat / SERVICE_GRID_CELL);
                const lonKey = Math.floor(svc.position.lon / SERVICE_GRID_CELL);
                const key = `${latKey},${lonKey}`;
                if (!serviceGrid.has(key))
                    serviceGrid.set(key, []);
                serviceGrid.get(key).push(svc);
                const coarseLatKey = Math.floor(svc.position.lat / COARSE_SERVICE_GRID_CELL);
                const coarseLonKey = Math.floor(svc.position.lon / COARSE_SERVICE_GRID_CELL);
                const coarseKey = `${coarseLatKey},${coarseLonKey}`;
                if (!coarseServiceGrid.has(coarseKey))
                    coarseServiceGrid.set(coarseKey, []);
                coarseServiceGrid.get(coarseKey).push(svc);
            }
            this._serviceGrid = serviceGrid;
            this._serviceGridCell = SERVICE_GRID_CELL;
            this._safetyFleetFrame = {
                services: activeServices, length: activeServices.length,
                members: new Map(activeServices.map((svc, index) => [svc, index])),
                coarseGrid: coarseServiceGrid, coarseCell: COARSE_SERVICE_GRID_CELL,
            };
            // Clear route-local neighbours even when a train is demoted to macro LOD.
            for (const svc of activeServices)
                svc._nearbyServices = undefined;
            const routeIndex = new Map();
            const highCandidates = [];
            const mediumList = [];
            let lowList = [];
            // HOTFIX81 — camera-independent simulation for ordinary sessions. If all
            // moving trains fit inside the full-physics budget, ALL of them receive full
            // updates regardless of the 2D/GPS field of view. LOD remains only a
            // scalability mechanism above that budget.
            if (movingCount <= HIGH_BUDGET) {
                for (let i = 0; i < movingCount; i++) {
                    const svc = movingSvcs[i];
                    if (!svc.position || !svc._state) {
                        svc._lod = 'low';
                        lowList.push(svc);
                        continue;
                    }
                    const legKey = `${svc.currentStopIndex}-${svc.isReturnLeg ? 1 : 0}`;
                    if (!svc._routeKey || svc._state.legKey !== legKey || !svc._state.cachedRoute) {
                        const route = svc.getCurrentRoute();
                        if (route && route.length >= 2)
                            svc._initializeState(route, legKey);
                    }
                    const route = svc._state.cachedRoute;
                    if (!route || route.length < 2) {
                        svc._lod = 'low';
                        lowList.push(svc);
                        continue;
                    }
                    svc._lod = 'high';
                    svc._lodDist = 0;
                    highCandidates.push(svc);
                    const key = svc._routeKey || '';
                    if (key) {
                        let arr = routeIndex.get(key);
                        if (!arr) {
                            arr = [];
                            routeIndex.set(key, arr);
                        }
                        arr.push(svc);
                    }
                }
                // No visible renderer in a huge session: every train runs as low-LOD macro.
            }
            else if (!hasViewport) {
                for (let i = 0; i < movingCount; i++) {
                    movingSvcs[i]._lod = 'low';
                }
                lowList = movingSvcs;
            }
            else {
                for (let i = 0; i < movingCount; i++) {
                    const svc = movingSvcs[i];
                    if (!svc.position || !svc._state) {
                        svc._lod = 'low';
                        lowList.push(svc);
                        continue;
                    }
                    const legKey = `${svc.currentStopIndex}-${svc.isReturnLeg ? 1 : 0}`;
                    if (!svc._routeKey || svc._state.legKey !== legKey || !svc._state.cachedRoute) {
                        const route = svc.getCurrentRoute();
                        if (route && route.length >= 2)
                            svc._initializeState(route, legKey);
                    }
                    const route = svc._state.cachedRoute;
                    if (!route || route.length < 2) {
                        svc._lod = 'low';
                        lowList.push(svc);
                        continue;
                    }
                    const lat = svc.position.lat;
                    const lon = svc.position.lon;
                    const inViewport = lat >= vpMinLat && lat <= vpMaxLat && lon >= vpMinLon && lon <= vpMaxLon;
                    const dLat = Math.abs(lat - centerLat);
                    const dLon = Math.abs(lon - centerLon);
                    let lod = 'low';
                    if (inViewport) {
                        lod = 'high';
                        svc._lodDist = dLat + dLon;
                        highCandidates.push(svc);
                    }
                    else if (dLat < MEDIUM_RADIUS_DEG && dLon < MEDIUM_RADIUS_DEG) {
                        lod = 'medium';
                        mediumList.push(svc);
                    }
                    else {
                        lowList.push(svc);
                    }
                    svc._lod = lod;
                    if (lod !== 'low') {
                        const key = svc._routeKey || '';
                        if (key) {
                            let arr = routeIndex.get(key);
                            if (!arr) {
                                arr = [];
                                routeIndex.set(key, arr);
                            }
                            arr.push(svc);
                        }
                    }
                }
            }
            // Cap high-priority services and demote overflow to low.
            if (highCandidates.length > HIGH_BUDGET) {
                highCandidates.sort((a, b) => a._lodDist - b._lodDist);
                const keep = highCandidates.slice(0, HIGH_BUDGET);
                const keepSet = new Set(keep);
                for (let i = 0; i < highCandidates.length; i++) {
                    const svc = highCandidates[i];
                    if (!keepSet.has(svc)) {
                        svc._lod = 'low';
                        lowList.push(svc);
                    }
                }
                highCandidates.length = keep.length;
                for (let i = 0; i < keep.length; i++)
                    highCandidates[i] = keep[i];
            }
            // Pass 2: sort route groups that contain a high-priority train and assign neighbours.
            const LOOKAHEAD = 5;
            const LOOKBEHIND = 2;
            const MAX_GROUP_SORT = 5000;
            for (const [key, group] of routeIndex) {
                if (!group.some((s) => s._lod === 'high'))
                    continue;
                let sortGroup = group;
                if (sortGroup.length > MAX_GROUP_SORT) {
                    sortGroup = sortGroup.filter((s) => s._lod === 'high');
                }
                // Route vertices are not equally spaced. Sorting by index+progress can put
                // a train on a dense 5 m segment "ahead" of one physically kilometres
                // further along a sparse segment. Use actual route-km progression.
                sortGroup.sort((a, b) => {
                    const ar = a._state?.cachedRoute;
                    const br = b._state?.cachedRoute;
                    const akm = ar ? a._currentFrontKm?.(ar) : 0;
                    const bkm = br ? b._currentFrontKm?.(br) : 0;
                    return Number(akm || 0) - Number(bkm || 0);
                });
                for (let i = 0; i < sortGroup.length; i++) {
                    const svc = sortGroup[i];
                    if (svc._lod !== 'high')
                        continue;
                    const start = Math.max(0, i - LOOKBEHIND);
                    const end = Math.min(sortGroup.length, i + LOOKAHEAD + 1);
                    const nearby = new Array(end - start - 1);
                    let k = 0;
                    for (let j = start; j < end; j++) {
                        if (j !== i)
                            nearby[k++] = sortGroup[j];
                    }
                    svc._nearbyServices = nearby;
                }
            }
            // Pass 3: update high (full physics), medium/low via strided macro updates.
            for (let i = 0; i < highCandidates.length; i++) {
                const svc = highCandidates[i];
                // Pending distant time belongs to the train, not to a camera bucket.
                // Flush it once when promoted; never replay it upon a later demotion.
                const pending = (svc._macroElapsed?.medium || 0) + (svc._macroElapsed?.low || 0);
                if (svc._macroElapsed) {
                    svc._macroElapsed.medium = 0;
                    svc._macroElapsed.low = 0;
                }
                svc.moveUpdate(dt + pending, timeOfDay, activeServices);
            }
            // v1.1.73 — deterministic per-train macro cadence. The old strided update
            // used each service's ARRAY INDEX as its phase. When sorting/filtering changed
            // that index, a train could receive a 1 s / 3 s macro jump twice too close
            // together (or miss one), producing artificial advance, overlap and brutal
            // braking. Each service now owns its own elapsed-time accumulator.
            const runMacroCadence = (list, intervalTicks, bucket) => {
                const intervalSec = dt * intervalTicks;
                for (let i = 0; i < list.length; i++) {
                    const svc = list[i];
                    if (!svc)
                        continue;
                    if (!svc._macroElapsed)
                        svc._macroElapsed = { medium: 0, low: 0 };
                    const elapsed = svc._macroElapsed.medium + svc._macroElapsed.low + dt;
                    svc._macroElapsed.medium = 0;
                    svc._macroElapsed.low = 0;
                    svc._macroElapsed[bucket] = elapsed;
                    if (elapsed + 1e-9 < intervalSec)
                        continue;
                    svc._macroElapsed[bucket] = 0;
                    svc.moveMacro(elapsed, timeOfDay, this.economy, activeServices);
                }
            };
            runMacroCadence(mediumList, MEDIUM_INTERVAL, 'medium');
            runMacroCadence(lowList, LOW_INTERVAL, 'low');
            // v1.1.73 — incidents are a simulation rule, not a camera/LOD rule. The old
            // high/medium-only scan let distant trains ignore or retain stale incidents.
            if (!this._incidentCheckTick)
                this._incidentCheckTick = 0;
            if (this._incidentCheckTick++ % 6 === 0) {
                this.incidentManager.checkTrainPositions(activeServices, this.depotManager, this.world);
            }
            // Dwell timer for stopped trains.
            for (let i = 0; i < activeServices.length; i++) {
                const svc = activeServices[i];
                if (svc.state === 'stopped_at_station') {
                    svc.moveUpdate(dt, timeOfDay, activeServices);
                }
            }
            // Update rescue locomotives movement
            this.depotManager.updateRescues(dt, Number(timeOfDay), activeServices);
            // Periodic canton cleanup (every ~30s)
            if (!this._lastCantonCleanup)
                this._lastCantonCleanup = 0;
            const now = performance.now();
            if (now - this._lastCantonCleanup > 30000) {
                this._lastCantonCleanup = now;
                this.cantonManager.cleanup();
            }
        }
        finally {
            this._safetyFleetFrame = undefined;
            endCompetitionFrame?.();
            endServiceLookup?.();
        }
    }
    _forceV2RuntimeSyncNow() {
        const pt = this.engine?.getParisTime?.();
        const time = Number.isFinite(Number(this.timeOfDay)) ? Number(this.timeOfDay) : (pt ? pt.hours * 60 + pt.minutes + (pt.seconds || 0) / 60 : 0);
        const date = this._currentDate || this.engine?.getParisDate?.();
        if (!date || !this.scheduleV2Runtime)
            return null;
        const diag = this.scheduleV2Runtime.forceSync?.(time, date) || null;
        this._updateV2RuntimeStatus();
        this.ui?.updateV2RuntimeSidebar?.();
        this.ui?.updateTrainsList?.(this.scheduleCreator.getActiveServices());
        return diag;
    }
    _updateV2RuntimeStatus() {
        if (typeof document === 'undefined')
            return;
        const el = document.getElementById('re-chronological-status');
        if (!el)
            return;
        const debt = this.engine?.getReplayDebtSeconds?.() || 0;
        const fault = this.engine?.chronologicalClock?.failed;
        const paintingNow = performance.now(), catchingUp = debt > 2;
        if (!fault && catchingUp === this._replayStatusWasCatchingUp && paintingNow - this._lastReplayStatusPaint < 200)
            return;
        this._lastReplayStatusPaint = paintingNow;
        this._replayStatusWasCatchingUp = catchingUp;
        if (fault || catchingUp) {
            el.style.display = 'block';
            el.style.color = fault ? '#fecaca' : '#fde68a';
            const clock = this.engine.getParisTime?.();
            const timeLabel = clock ? `${this.engine.getParisDate?.() || ''} ${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}:${String(clock.seconds).padStart(2, '0')} → heure réelle · ` : '';
            el.textContent = fault ? `Simulation suspendue : ${fault}` : `Rattrapage · ${timeLabel}${Math.ceil(debt)} s restantes (temps simulé)`;
            el.title = 'Le temps non simulé reste en attente et est conservé dans la sauvegarde. Aucun repositionnement horaire automatique.';
            return;
        }
        el.style.display = 'none';
        el.textContent = '';
        el.title = '';
    }
    _tickStationaryService(svc, timeOfDay, dateStr) {
        // Legacy daily rearming happens before this call. A terminal physical train
        // cannot depart again, so its retained history needs no departure gates.
        if (svc.completed || svc.cancelled || svc.state === 'completed' || svc.state === 'cancelled')
            return;
        const ultimateBlock = this.ultimate.departureBlock(svc);
        if (ultimateBlock) {
            svc.train.delayReason = ultimateBlock.message;
            svc._movementStop?.(ultimateBlock.code, ultimateBlock.message, 'network');
            this.scheduleCreator.updateServiceIndexes(svc, timeOfDay);
            return;
        }
        const networkBlock = this.operationalExtensions?.networkDepartureBlock?.(this, svc);
        const handling = this.freightOperations?.canDepart?.(svc, this.engine.getSimulationEpochMs());
        if (networkBlock || handling?.ok === false) {
            const reason = networkBlock?.message || handling.reason || handling.message;
            svc.train.delayReason = reason;
            svc._movementStop?.(networkBlock?.code || 'FREIGHT_HANDLING', reason, networkBlock ? 'network' : 'freight');
            this.scheduleCreator.updateServiceIndexes(svc, timeOfDay);
            return;
        }
        if (!applyExpertDepartureGate(this, svc)) {
            const block = expertDepartureBlock(this, svc);
            if (block && svc._v2OccurrenceId)
                this.scheduleV2Runtime?._pushAlert?.('ERROR', block.code, `Train ${svc.number || svc.name || ''} en attente : ${block.message}`, { rotationId: svc._v2RotationId, occurrenceId: svc._v2OccurrenceId, baseDate: svc._v2BaseDate,
                    suggestion: 'Créer un dépôt, affecter la rame ou les véhicules au dépôt, et entretenir la rame si nécessaire.' });
        }
        else {
            svc.scheduleTick(Number(timeOfDay), String(dateStr), this.economy);
        }
        this.scheduleCreator.updateServiceIndexes(svc, timeOfDay);
    }
    secondTick(timeOfDay, dateStr, pt) {
        const tick = pt && typeof pt === 'object' ? pt : null;
        // Minute 00 is already handled by tick(); avoid duplicate heavy legacy work.
        if (!dateStr || Number(tick?.seconds || 0) === 0)
            return;
        this.timeOfDay = timeOfDay;
        this._gameTime = timeOfDay;
        this._currentDate = dateStr;
        const simEpochMs = this.engine.getSimulationEpochMs();
        this.ultimate.advance(simEpochMs);
        this.freightOperations?.advancePending(simEpochMs, this);
        this.stationResources?.advancePending(this, simEpochMs);
        this.shuntingManager.advancePhysicalOperations?.(simEpochMs / 1000, { depotManager: this.depotManager,
            rotationV2: this.rotationV2, staffManager: this.staffManager, game: this, policy: this.resolveRealismPolicy('shunting') });
        this.incidentManager.checkTrainPositions(this.depotManager.getPhysicalRescueServices(), this.depotManager, this.world);
        this.depotManager.advancePhysicalOperations?.(simEpochMs / 1000, { game: this, world: this.world,
            date: String(dateStr), rotationV2: this.rotationV2, rameManager: this.rameManager, services: this.scheduleCreator.services,
            cantonManager: this.cantonManager, staffManager: this.staffManager, policy: this.resolveRealismPolicy('depots') });
        try {
            this.seasonal.checkSeason(dateStr);
        }
        catch (e) {
            this.diagnostics.record('SEASONAL', e);
        }
        this.scheduleV2Runtime?.sync(timeOfDay, dateStr);
        this._updateV2RuntimeStatus();
        const services = this.scheduleCreator.getActiveServices();
        const endCompetitionFrame = window.__reDefinitif?.beginCompetitionFrame?.();
        try {
            for (const svc of services) {
                if (!svc._v2OccurrenceId)
                    continue;
                svc._currentDate = dateStr;
                if (svc.state === 'moving' || svc.state === 'departing')
                    continue;
                this._tickStationaryService(svc, timeOfDay, dateStr);
            }
        }
        finally {
            endCompetitionFrame?.();
        }
        // V2 can transition waiting→moving or moving→stationary on a second boundary.
        // Do not leave the movement cache frozen until the next minute tick.
        this.scheduleCreator.refreshMovingCache();
    }
    applyDepotQueueResults({ repaired, maintainedIds }, dateStr, activeSchedules) {
        const currentDate = dateStr || this._currentDate || this.engine?.getParisDate?.() || '';
        const services = activeSchedules || this.scheduleCreator.getActiveServices();
        for (const { serviceId, repairType, rameId, vehicleIds, targetVehicleId, targetComponent } of repaired) {
            const storedRame = rameId ? this.rameManager.getById(rameId) : null;
            const anotherVehicleDamaged = !!(targetVehicleId && targetComponent && (vehicleIds || []).some((id) => id !== targetVehicleId && Number(this.operationalExtensions?.componentCondition?.(id, targetComponent)) < 100));
            if (storedRame) {
                storedRame.inMaintenance = anotherVehicleDamaged;
                if (!anotherVehicleDamaged)
                    storedRame.pendingDefects = (storedRame.pendingDefects || []).filter((type) => type !== repairType);
            }
            for (const id of vehicleIds || []) {
                const vehicle = this.rotationV2?.getVehicle?.(id);
                if (vehicle && (!anotherVehicleDamaged || id === targetVehicleId))
                    vehicle.available = true;
            }
            const svc = this.scheduleCreator.services.find((s) => s.id === serviceId);
            if (svc && !anotherVehicleDamaged)
                svc.resumeAfterRepair();
            const repairedVehicleIds = targetVehicleId ? [targetVehicleId] : vehicleIds?.length ? vehicleIds :
                (storedRame?.elementDetails || []).map((detail) => detail.physicalVehicleId).filter((id) => typeof id === 'string' && !!id);
            if (repairedVehicleIds.length)
                this.emitDomainEvent({ type: 'maintenanceCompleted',
                    eventId: `maintenance:repair:${serviceId}:${targetVehicleId || rameId}:${this.engine.getSimulationEpochMs()}`,
                    resourceIds: [...new Set(repairedVehicleIds.map(String))], simEpochMs: this.engine.getSimulationEpochMs() });
        }
        for (const rameId of maintainedIds) {
            const rame = this.rameManager.getById(rameId);
            if (rame) {
                rame.kmSinceLastMaint = 0;
                rame.wearLevel = 0;
                rame.inMaintenance = false;
                rame.lastMaintenanceMonth = currentDate ? currentDate.slice(0, 7) : rame.lastMaintenanceMonth;
                rame.recommendedMaintenance = false;
            }
            for (const svc of services) {
                if (svc.rame && svc.rame.id === rameId) {
                    svc.train.wearLevel = 0;
                    svc.train.kmSinceLastMaint = 0;
                    svc.train.inMaintenance = false;
                    svc.resumeAfterRepair();
                }
            }
            const maintainedVehicleIds = [...new Set([
                    ...(rame?.elementDetails || []).map((detail) => detail.physicalVehicleId).filter((id) => typeof id === 'string' && !!id),
                    ...(this.rotationV2?.getRameVehicles?.(rameId) || []).map((vehicle) => vehicle.id)
                ])];
            if (maintainedVehicleIds.length)
                this.emitDomainEvent({ type: 'maintenanceCompleted',
                    eventId: `maintenance:legacy:${rameId}:${this.engine.getSimulationEpochMs()}`,
                    resourceIds: maintainedVehicleIds, simEpochMs: this.engine.getSimulationEpochMs() });
        }
    }
    tick(timeOfDay, dateStr, pt) {
        this.ultimate.advance(this.engine.getSimulationEpochMs());
        const { elapsedMinutes, dailyDates } = this.gameplayClock.advance(dateStr, this.engine?.getSimulationEpochMs?.() ?? Date.now());
        try {
            const market = window.__reDefinitif;
            market?.advanceCompetition?.(this.engine?.getSimulationEpochMs?.() ?? Date.now(), dateStr);
        }
        catch (e) {
            this.diagnostics.record('COMPETITION', e);
        }
        this.timeOfDay = timeOfDay;
        this._gameTime = timeOfDay;
        this._currentDate = dateStr;
        // The network authority decides requests on the simulation clock, even if
        // the player never opens Lignes. The manager serializes concurrent ticks.
        void processDueInfrastructureRequests(this, dateStr)
            .catch((err) => this.diagnostics.record('INFRASTRUCTURE_REQUEST', err));
        // Seasonal grid must be resolved BEFORE V2 compilation/departure decisions.
        // Doing this later at the daily-charge hook allowed an old-season train to
        // compile or depart at 00:00 before the grid switched.
        try {
            this.seasonal.checkSeason(dateStr);
        }
        catch (e) {
            this.diagnostics.record('SEASONAL', e);
        }
        // V2 schedules never instantiate trains directly. Compile only the due
        // RotationOccurrences with their real physical formations.
        this.scheduleV2Runtime?.sync(timeOfDay, dateStr);
        this._updateV2RuntimeStatus();
        const activeSchedules = this.scheduleCreator.getActiveServices();
        const relatedVehicleIds = (id) => this.rotationV2.getRameVehicles(id).map((v) => v.id);
        const catalogRefreshed = this.rameManager.flushPendingCatalogDetails(this.rollingStock, activeSchedules, relatedVehicleIds);
        const cargoRecovered = this.rameManager.flushPendingCargoBackfill(this.rollingStock, activeSchedules, relatedVehicleIds);
        this._refreshExternalCatalogRames([...new Set([...catalogRefreshed, ...cargoRecovered])]);
        // Moving V2 services need the current absolute date too: moveUpdate only
        // receives the clock-of-day, so this keeps J+1/J+N delay maths correct.
        for (const svc of activeSchedules) {
            svc._currentDate = dateStr;
            // Rearm before the existing material-positioning path and priority indexes.
            svc._prepareLegacyOperatingDay?.(timeOfDay, dateStr);
        }
        // CVO-04 : création automatique des services EVO (garage/gare → gare de départ)
        for (let i = 0; i < activeSchedules.length; i++) {
            const svc = activeSchedules[i];
            if (svc.state === 'moving' || svc.state === 'departing')
                continue;
            this.scheduleCreator.ensureEVOForService(svc, this.world, timeOfDay);
        }
        // Build per-minute lookup indexes so isRameInUse and OCC-03 station priority
        // are O(k) instead of O(n²) during this tick.
        this.scheduleCreator.beginTick(timeOfDay);
        // HOTFIX53 — RH global : affectation automatique des postes fixes, équipes 3x8,
        // congés, absences et licenciements programmés sont résolus avant l'exploitation.
        try {
            this.staffManager.tickWorkforce(this, activeSchedules, timeOfDay, dateStr);
        }
        catch (e) {
            this.diagnostics.record('STAFF_WORKFORCE', e);
        }
        // REG-03 : régulation (ordre de passage / garage temporaire) doit être calculée
        // AVANT que scheduleTick ne fasse démarrer les trains, sinon un train retardé
        // et non prioritaire risque de partir avant d'être mis au garage.
        try {
            this.staffManager.tickRegulateurs(this.scheduleCreator.getActiveServices(), timeOfDay, dateStr, this.realismSettings);
        }
        catch (e) {
            this.diagnostics.record('STAFF_REGULATION', e);
        }
        this.operationalExtensions.applyManualHolds(activeSchedules, timeOfDay * 60, dateStr);
        this.operationalExtensions.advanceNetwork(this, dateStr, timeOfDay, elapsedMinutes);
        const simEpochMs = this.engine.getSimulationEpochMs();
        this.stationResources?.advance(this, simEpochMs, elapsedMinutes);
        this._advanceParkedVehicleBrakes(simEpochMs, elapsedMinutes * 60);
        this.freightOperations?.syncServices(this.scheduleCreator.services, simEpochMs, this);
        this.shuntingManager.advancePhysicalOperations?.(simEpochMs / 1000, { depotManager: this.depotManager,
            rotationV2: this.rotationV2, staffManager: this.staffManager, game: this, policy: this.resolveRealismPolicy('shunting') });
        // Project already-active incidents without advancing their cadence or
        // duration before a depot/rescue controller consumes its elapsed minute.
        this.incidentManager.checkTrainPositions(this.depotManager.getPhysicalRescueServices(), this.depotManager, this.world);
        this.depotManager.advancePhysicalOperations?.(simEpochMs / 1000, { game: this, world: this.world,
            date: dateStr, rotationV2: this.rotationV2, rameManager: this.rameManager, services: this.scheduleCreator.services,
            cantonManager: this.cantonManager, staffManager: this.staffManager, policy: this.resolveRealismPolicy('depots') });
        // INC-03 : incidents (gare, voie, train) doivent être appliqués AVANT
        // scheduleTick, sinon un départ prévu à la même minute qu'un incident
        // ne serait pas bloqué en gare.
        const incidentVisualKey = () => (this.incidentManager.activeIncidents || [])
            .filter((inc) => inc?.active !== false && !inc?.serviceId)
            .map(inc => `${inc.id || ''}:${inc.stationA || ''}:${inc.stationB || ''}:${inc.typeId || inc.effect || ''}`)
            .sort().join('|');
        const incidentVisualBefore = incidentVisualKey();
        this.incidentManager.update(timeOfDay, activeSchedules, this.depotManager, this.world, dateStr, this.weather?.season, this.weather, elapsedMinutes);
        const worksVisualChanged = this.worksManager.update(dateStr, timeOfDay, this.world) === true;
        const incidentVisualAfter = incidentVisualKey();
        // Static Livemap invalidation is expensive at continent zoom (17,817 station
        // markers). Do it only when works/incidents actually changed visually.
        if (worksVisualChanged || incidentVisualBefore !== incidentVisualAfter) {
            this.renderer?.invalidateStatic?.();
        }
        // Auto-assign conductors BEFORE scheduleTick so a waiting service can depart immediately
        try {
            this.staffManager.tickConductors(activeSchedules, timeOfDay, dateStr, this);
        }
        catch (e) {
            this.diagnostics.record('STAFF_CONDUCTORS', e);
        }
        // scheduleTick: moving trains already have their state managed by moveUpdate,
        // so only call scheduleTick on non-moving trains (waiting, stopped_at_station, etc.)
        const endCompetitionFrame = window.__reDefinitif?.beginCompetitionFrame?.();
        try {
            for (let i = 0; i < activeSchedules.length; i++) {
                const svc = activeSchedules[i];
                if (svc.state === 'moving' || svc.state === 'departing')
                    continue;
                this._tickStationaryService(svc, timeOfDay, dateStr);
            }
        }
        finally {
            endCompetitionFrame?.();
        }
        this.operationalExtensions.syncEmptyWagons(activeSchedules);
        for (const service of activeSchedules)
            this.operationalExtensions.updateCrossingsForService(service);
        // Update repair & maintenance queues
        const queueResults = this.depotManager.updateRepairs(elapsedMinutes);
        // HOTFIX50 — only operations explicitly launched by the player progress here.
        this.depotManager.updateDepotOperations?.(elapsedMinutes, this.rameManager, this.staffManager);
        this.applyDepotQueueResults(queueResults, dateStr, activeSchedules);
        // Internal generation cadence uses an absolute minute, never HH:00 equality.
        const absoluteMinute = Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 60000) + Math.floor(timeOfDay);
        this.freightManager.reconcileReservations(this.scheduleCreator.services, this.scheduleV2Runtime?._pendingSnapshots?.values());
        this.freightManager.maybeGenerate(this.world.stations, absoluteMinute, this.cargoTypes, this.industrialClients);
        // Periodic canton cleanup every 5 in-game minutes to prevent memory leaks
        if (timeOfDay % 5 === 0) {
            this.cantonManager.cleanup();
        }
        // Contrôleurs: random ticket inspections on passenger trains
        try {
            this.staffManager.tickControleurs(this.economy, activeSchedules, timeOfDay);
        }
        catch (e) {
            this.diagnostics.record('STAFF_INSPECTIONS', e);
        }
        // Revenue collected inside service.completeService -> economy.processServiceRevenue
        for (const settlementDate of dailyDates) {
            try {
                const settle = (key, work) => this.gameplayClock.runDailyTask(key, settlementDate, work);
                settle('operating', () => this.economy.processDailyCharges(activeSchedules, this.depotManager.getAll(), settlementDate));
                settle('payroll', () => { this.staffManager.processDailySalaries(this.economy, settlementDate, { subsidizedIds: this.ultimate.simpleFundedStaffIds }); });
                settle('bank', () => { this.bank.processDailyRepayments(this.economy, settlementDate); });
                settle('unions', () => { this.unions.dailyUpdate(this, undefined, settlementDate); });
                settle('industry', () => { this.industrialClients.generateDailyContracts(this.freightManager, this.world, this.cargoTypes, settlementDate); });
                settle('marketing', () => { this.marketingManager?.dailyUpdate?.(this, settlementDate); });
                settle('ite', () => {
                    const cost = this.iteModules.getTotalDailyMaintenance();
                    if (cost > 0)
                        this.economy.addExpense(cost, 'maintenance', 'Maintenance ITE');
                });
                settle('preventive', () => { this.depotManager.checkPreventiveMaintenance(settlementDate, this.rameManager); });
                this.gameplayClock.markSettled(settlementDate);
            }
            catch (error) {
                this.diagnostics.record('DAILY_SETTLEMENT_RETRY', error);
                break; // Preserve order; retry next tick without charging successful tasks twice.
            }
        }
        // Weather update every minute
        try {
            const mapLat = this.renderer?.tileMap?.centerLat;
            const mapLon = this.renderer?.tileMap?.centerLon;
            this.weather.update(timeOfDay, dateStr, mapLat, mapLon);
        }
        catch (e) {
            this.diagnostics.record('WEATHER', e);
        }
        // Shunting operations update every minute
        try {
            this.shuntingManager.update(elapsedMinutes);
        }
        catch (e) {
            this.diagnostics.record('SHUNTING', e);
        }
        // Update radar + cloud tile URLs from weather data
        try {
            const radarPath = this.weather.getLatestRadarPath();
            if (radarPath && this.renderer?.tileMap) {
                this.renderer.tileMap.setRadarTileUrl(this.weather.getRadarTileUrl(radarPath));
            }
            // XIV — satellite true color mis à jour chaque minute
            if (this.renderer?.tileMap) {
                this.renderer.tileMap.setCloudTileUrl(this.weather.getCloudTileUrl(null));
            }
        }
        catch (e) {
            this.diagnostics.record('WEATHER_TILES', e);
        }
        // Dashboard + Graph hooks (every minute, wrapped in try/catch for safety)
        try {
            this.dashboard.record(this);
        }
        catch (e) {
            this.diagnostics.record('DASHBOARD', e);
        }
        try {
            this.graphMarche.record(this, timeOfDay);
        }
        catch (e) {
            this.diagnostics.record('TIMETABLE_GRAPH', e);
        }
        // Refresh moving services cache after state transitions
        this.scheduleCreator.refreshMovingCache();
    }
    /** Historical timetable reconstruction is distinct from strict audit replay. */
    catchUpAnalytically(targetMs = Date.now()) {
        if (this._importing || this._operationalReplayActive || this.engine.paused || !this.engine.chronologicalClock)
            return null;
        const fromMs = this.engine.getSimulationEpochMs();
        if (targetMs - fromMs <= 5000)
            return null;
        if (analyticalCatchupFallbackReason(this, fromMs, targetMs))
            return null;
        try {
            return commitAnalyticalCatchup(this, prepareAnalyticalCatchup(this, fromMs, targetMs));
        }
        catch (error) {
            if (error instanceof AnalyticalCatchupFallbackError)
                return null;
            throw error;
        }
    }
    captureAnalyticalCheckpoint(planning = false, targetMs = this.engine.getSimulationEpochMs()) {
        // Stored ORM geometry and catalogue assets are immutable during historical
        // timetable execution. Snapshot only the managers whose domain work runs.
        const mutableKeys = planning ? ['scheduleV2', 'rotationV2', 'scheduleV2Runtime', 'rameManager'] :
            ['engine', 'economy', 'scheduleV2', 'rollingStock', 'gameplayClock', 'operationalReplay', 'operationalExtensions', 'stationResources', 'freightOperations', 'vehicleBrakeState',
                'rameManager', 'rotationV2', 'scheduleV2Runtime', 'scheduleCreator', 'ultimate', 'depotManager', 'staffManager', 'bank', 'unions', 'seasonal',
                'freightManager', 'industrialClients', 'marketingManager', 'shuntingManager', 'connections', 'stationUpgrades', 'cantonManager', 'platformManager', 'voiePointManager', 'rng'];
        const mutable = new Set(mutableKeys);
        const excluded = Object.keys(this).filter(key => !mutable.has(key)).map(key => this[key]).filter((value) => !!value && typeof value === 'object');
        // A projection may share the same immutable routes through a service and a
        // schedule. Exclude geometry itself rather than relying on its parent link.
        for (const record of this.scheduleV2.schedules)
            for (const version of record.versions)
                for (const path of [version.outboundPath, version.returnPath].filter(Boolean)) {
                    excluded.push(path.routePoints, path.segments);
                    for (const leg of path.legs || [])
                        excluded.push(leg.routePoints, leg.segments);
                }
        const noStaffWork = !planning && this.getGameplayModeState().difficulty === 'easy' && civilDateAt(targetMs) === civilDateAt(this.engine.getSimulationEpochMs())
            && !this.depotManager.physicalOperations.length && !this.depotManager.depotOperations.length && !this.depotManager.repairQueue.length
            && !this.shuntingManager.physicalOperations.length && !this.ultimate.workshop.reconditionings.some(r => !r.done) && !this.ultimate.workshop.orders.length && !this.ultimate.enterprise.orders.length;
        if (noStaffWork)
            excluded.push(...this.staffManager.staff);
        if (!planning)
            excluded.push(this.ultimate.logistics.references, this.ultimate.logistics.suppliers, this.ultimate.logistics.carriers);
        const tx = new StateTransaction(excluded);
        tx.captureRoot(this, false);
        // Cached timing/plan records are memoized immutable projections. Transactions
        // need their containers and adapter rotation flags, not another copy of every
        // historical cached graph and alert object.
        const runtime = this.scheduleV2Runtime;
        tx.captureRoot(runtime._planCache, false);
        tx.captureRoot(runtime._timedVersionCache, false);
        tx.captureRoot(runtime.alerts, false);
        for (const cached of runtime._directRuntimeAdapters.values()) {
            tx.captureRoot(cached.assignment, false);
            tx.captureRoot(cached.operations, false);
            if (cached.vehicles)
                tx.captureRoot(cached.vehicles, false);
        }
        if (noStaffWork) {
            tx.captureRoot(this.staffManager, false);
            tx.captureRoot(this.staffManager.staff, false);
            for (const value of Object.values(this.staffManager))
                if (value && typeof value === 'object')
                    tx.captureRoot(value);
        }
        for (const key of mutableKeys) {
            const value = this[key];
            if (value && typeof value === 'object')
                tx.captureRoot(value);
        }
        return tx;
    }
    settleAnalyticalDay(settlementDate) {
        const activeSchedules = this.scheduleCreator.getActiveServices();
        const settle = (key, work) => this.gameplayClock.runDailyTask(key, settlementDate, work);
        settle('operating', () => this.economy.processDailyCharges(activeSchedules, this.depotManager.getAll(), settlementDate));
        settle('payroll', () => { this.staffManager.processDailySalaries(this.economy, settlementDate, { subsidizedIds: this.ultimate.simpleFundedStaffIds }); });
        settle('bank', () => { this.bank.processDailyRepayments(this.economy, settlementDate); });
        settle('unions', () => { this.unions.dailyUpdate(this, { random: () => 1 }, settlementDate); });
        settle('industry', () => { this.industrialClients.generateDailyContracts(this.freightManager, this.world, this.cargoTypes, settlementDate); });
        settle('marketing', () => { this.marketingManager?.dailyUpdate?.(this, settlementDate); });
        settle('ite', () => { const cost = this.iteModules.getTotalDailyMaintenance(); if (cost > 0)
            this.economy.addExpense(cost, 'maintenance', 'Maintenance ITE'); });
        settle('preventive', () => { this.depotManager.checkPreventiveMaintenance(settlementDate, this.rameManager); });
        this.gameplayClock.markSettled(settlementDate);
    }
    gameLoop() {
        if (!this.running)
            return;
        try {
            const now = performance.now();
            if (!this._lastFrameTime)
                this._lastFrameTime = 0;
            const frameDelta = now - this._lastFrameTime;
            this.catchUpAnalytically();
            this.engine.update();
            const catchingUp = (this.engine.getReplayDebtSeconds?.() || 0) > 2;
            if (catchingUp && !this._importing && !this.engine.paused && !document.hidden) {
                if (!this._replayPump)
                    this._replayPump = new ReplayPump(() => {
                        if (!this.running || this._importing || this.engine.paused || document.hidden || this.engine.getReplayDebtSeconds() <= 2)
                            return false;
                        this.engine.update();
                        this._updateV2RuntimeStatus();
                        return this.engine.getReplayDebtSeconds() > 2;
                    }, error => this.diagnostics.record('REPLAY_PUMP', error));
                this._replayPump.request();
            }
            else
                this._replayPump?.cancel();
            if (this.engine.chronologicalClock?.failed)
                this._updateV2RuntimeStatus();
            // v1.1.43 — UI and simulation continue normally, but the Livemap is no
            // longer repainted 30 times/s while it is hidden or completely static.
            // During replay, draw fewer intermediate states, not fewer objects or
            // lower-resolution tiles. Full normal cadence returns as soon as caught up.
            if (frameDelta >= (catchingUp ? 200 : 30)) {
                this._lastFrameTime = now;
                const activeServices = this.scheduleCreator.getActiveServices();
                const mapActive = this.ui?.activePage === 'map';
                if (mapActive && this.renderer) {
                    const movingSvcs = this.scheduleCreator.getMovingServices();
                    const rescueServices = this.depotManager.getRescueServices();
                    const followed = this.ui?._followService;
                    // The visual sample is shared by the 2D camera, GPS camera and selected
                    // marker. Physics and block occupancy keep their live service position.
                    if (followed)
                        this.ui?._sampleFollowMotion?.(now);
                    const bounds = this.renderer._visibleGeoBounds?.(0.01);
                    const inView = (s) => !!s?.position && (!bounds || (s.position.lat >= bounds.minLat && s.position.lat <= bounds.maxLat && s.position.lon >= bounds.minLon && s.position.lon <= bounds.maxLon));
                    const hasVisibleMotion = !!followed ||
                        movingSvcs.some(inView) ||
                        rescueServices.some(inView);
                    const idleHeartbeat = !this._lastIdleMapRender || now - this._lastIdleMapRender >= 1000;
                    // HOTFIX24 — GPS 3D uses a large tilted satellite canvas. Repainting
                    // that full surface at the normal ~33 FPS was the main source of lag.
                    // The followed arrow is screen-pinned and CSS heading interpolation is
                    // smooth, so 10 FPS map refresh is visually sufficient while cutting
                    // the expensive raster workload by roughly two thirds.
                    const threeDFollowActive = !!this.ui?._threeDFollowActive;
                    // HOTFIX25 — camera bearing is pure CSS and cheap. Update it at the
                    // normal game-loop cadence even when the raster map itself is throttled.
                    // This keeps curves fluid without forcing satellite/ORM redraws.
                    if (threeDFollowActive && followed)
                        this.ui?.applyCameraFollow?.();
                    // HOTFIX26 — DOM train arrows are cheap. Keep them fresh independently
                    // of the heavyweight raster cadence so labels/nearby trains do not jump
                    // every time the satellite canvas is rebuilt.
                    if (threeDFollowActive && (!this._last3DMarkerSync || now - this._last3DMarkerSync >= 100)) {
                        this._last3DMarkerSync = now;
                        if (document.getElementById('toggle-trains')?.checked !== false)
                            this.renderer.sync3DMarkers?.(activeServices);
                    }
                    const last3DCost = Math.max(0, Number(this.renderer?._last3DRenderCostMs || 0));
                    // HOTFIX26 — the live train motion no longer requires raster repaint.
                    // The plane glides in CSS at game-loop cadence; heavyweight satellite,
                    // ORM and static-world drawing is reserved for tile completion, a rare
                    // anchor recenter, or a slow heartbeat. This removes the PowerPoint
                    // effect caused by 200–650 ms full-canvas paints on every follow step.
                    const threeDInterval = last3DCost > 220 ? 5000 : last3DCost > 130 ? 4000 : last3DCost > 75 ? 3000 : 2200;
                    const threeDElapsed = !this._last3DMapRender ? Infinity : now - this._last3DMapRender;
                    const threeDAnchorDue = !!this.ui?._threeDMapNeedsReanchor;
                    const threeDTileDue = !!this.renderer.needsRender && threeDElapsed >= threeDInterval;
                    const threeDHeartbeatDue = threeDElapsed >= 8000;
                    const threeDFrameDue = !this._last3DMapRender || threeDAnchorDue || threeDTileDue || threeDHeartbeatDue;
                    const shouldRender = threeDFollowActive
                        ? threeDFrameDue
                        : (hasVisibleMotion || this.renderer.needsRender || idleHeartbeat);
                    if (shouldRender) {
                        if (!this._visibleBuf)
                            this._visibleBuf = [];
                        const allVisibleServices = this._visibleBuf;
                        allVisibleServices.length = 0;
                        for (let i = 0; i < movingSvcs.length; i++) {
                            const svc = movingSvcs[i];
                            if (inView(svc))
                                allVisibleServices.push(svc);
                        }
                        if (!this._stoppedWithPosBuf)
                            this._stoppedWithPosBuf = [];
                        const stoppedBuf = this._stoppedWithPosBuf;
                        if (!this._lastStoppedScan || now - this._lastStoppedScan > 500) {
                            this._lastStoppedScan = now;
                            stoppedBuf.length = 0;
                            for (let i = 0; i < activeServices.length; i++) {
                                const svc = activeServices[i];
                                if ((svc.state === 'stopped_at_station' || svc.state === 'blocked_route' || (svc.state === 'waiting' && svc.position)) && svc.position)
                                    stoppedBuf.push(svc);
                            }
                        }
                        for (let i = 0; i < stoppedBuf.length; i++)
                            if (inView(stoppedBuf[i]))
                                allVisibleServices.push(stoppedBuf[i]);
                        for (let i = 0; i < rescueServices.length; i++)
                            if (inView(rescueServices[i]))
                                allVisibleServices.push(rescueServices[i]);
                        // LVM-04/06 — normal 2D follow still updates with each map paint.
                        // In 3D HOTFIX26 already updates the cheap CSS camera + pan above.
                        if (!threeDFollowActive)
                            this.ui?.applyCameraFollow?.();
                        else if (threeDAnchorDue)
                            this.ui?.prepare3DMapAnchorForRender?.();
                        if (!this._lastRadarSync || now - this._lastRadarSync > 2000) {
                            this._lastRadarSync = now;
                            try {
                                const rp = this.weather.getLatestRadarPath();
                                if (rp)
                                    this.renderer.tileMap.setRadarTileUrl(this.weather.getRadarTileUrl(rp));
                                this.renderer.tileMap.setCloudTileUrl(this.weather.getCloudTileUrl(null));
                            }
                            catch (e) {
                                this.diagnostics.record('WEATHER_TILES', e);
                            }
                        }
                        const renderStartedAt = performance.now();
                        this.renderer.render(this.world, allVisibleServices, this.engine, this.depotManager, this.lineManager, this.platformManager, this.voiePointManager);
                        if (threeDFollowActive) {
                            this.renderer._last3DRenderCostMs = Math.max(0, performance.now() - renderStartedAt);
                            // Timestamp completion, not start: an expensive frame now earns a
                            // real cool-down instead of immediately triggering another paint.
                            this._last3DMapRender = performance.now();
                        }
                        if (!hasVisibleMotion)
                            this._lastIdleMapRender = now;
                    }
                }
                if (!this._lastUIUpdate || now - this._lastUIUpdate > 250) {
                    this._lastUIUpdate = now;
                    this.ui?.update(activeServices);
                }
            }
        }
        catch (e) {
            this.diagnostics.record('GAME_LOOP', e);
            if (this.engine.chronologicalClock?.failed)
                this._updateV2RuntimeStatus();
        }
        requestAnimationFrame(() => this.gameLoop());
    }
}
// Global error handler to prevent game crashes
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('error', (e) => {
        console.error('Uncaught error:', e.error);
        e.preventDefault();
    });
    window.addEventListener('unhandledrejection', (e) => {
        console.error('Unhandled rejection:', e.reason);
        e.preventDefault();
    });
    bindLaunchActions(document);
    window.game = new RailEmpire();
}
