function jsonCopy(value) { return JSON.parse(JSON.stringify(value)); }
function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError('Snapshot de partie JSON requis.');
    return value;
}
function epoch(value) {
    if (!Number.isFinite(value) || value <= 0)
        throw new TypeError('Horloge absolue positive requise.');
    return value;
}
/** Only wall-clock replay debt is normalized; all durable game data stays visible. */
export function captureLiveReplaySnapshot(gameValue) {
    const game = gameValue;
    const state = record(jsonCopy(game.captureReplaySnapshot()));
    const clock = state.physicsClock;
    if (clock && typeof clock === 'object' && !Array.isArray(clock) && typeof clock.cursorMs === 'number')
        clock.targetMs = clock.cursorMs;
    return state;
}
/** Replay through the same production minute/second/100 ms callbacks, without paints. */
export function createLiveReplayAdapter(gameValue, replay) {
    const game = gameValue;
    const adapter = {
        async restore(snapshot, simEpochMs, rngState) {
            const state = record(jsonCopy(snapshot)), engine = game.engine;
            const savedEpoch = epoch(simEpochMs), wasImporting = game._importing;
            const originalEnable = engine.enableChronologicalReplay;
            const rawClock = state.physicsClock;
            const clock = rawClock && typeof rawClock === 'object' && !Array.isArray(rawClock) ? { ...rawClock, targetMs: savedEpoch } : { version: 1, cursorMs: savedEpoch, targetMs: savedEpoch };
            if (clock.cursorMs !== undefined && clock.cursorMs !== savedEpoch)
                throw new Error('Curseur du snapshot différent du point de reprise.');
            // The normal importer supplies wall time; a recorded playback supplies its saved cursor.
            engine.enableChronologicalReplay = raw => originalEnable.call(engine, raw, savedEpoch, savedEpoch);
            game._importing = true;
            const resumeResourceEvents = game._suspendPhysicalResourceEvents?.();
            try {
                game._loadStateUnchecked({ ...state, saveTime: savedEpoch, physicsClock: clock });
                game.operationalReplay = replay;
                originalEnable.call(engine, clock, savedEpoch, savedEpoch);
                const pt = engine.getParisTime(), date = engine.getParisDate(), time = pt.hours * 60 + pt.minutes + pt.seconds / 60;
                game.timeOfDay = time;
                game._gameTime = time;
                game._currentDate = date;
                const rng = game.rng.getState();
                game.scheduleV2Runtime.forceSync(time, date);
                game.scheduleCreator.refreshMovingCache();
                if (game.rng.getState() !== rng)
                    throw new Error('La reconstruction V2 a consommé le RNG sans avancer le temps.');
                if (typeof rngState !== 'number' || game.rng.getState() !== rngState)
                    throw new Error('RNG restauré différent du checkpoint.');
                if (engine.getSimulationEpochMs() !== savedEpoch)
                    throw new Error('La reconstruction a avancé le temps simulé.');
                // Drain the importer's deferred sync while its explicit import guard is still set.
                await Promise.resolve();
            }
            finally {
                resumeResourceEvents?.();
                engine.enableChronologicalReplay = originalEnable;
                game.operationalReplay = replay;
                game._importing = wasImporting;
            }
        },
        restoreRngState(rngState) {
            if (typeof rngState !== 'number' || game.rng.getState() !== rngState)
                throw new Error('RNG du chargement non conservé.');
            // Restore already used the real loader; never hide a random draw during compilation.
        },
        async advanceTo(simEpochMs) {
            const target = epoch(simEpochMs), engine = game.engine, clock = engine.chronologicalClock;
            if (!clock)
                throw new Error('Moteur chronologique non initialisé.');
            if (target < clock.cursorMs)
                throw new Error('Cible de replay antérieure au curseur physique.');
            if (clock.failed)
                throw new Error(clock.failed);
            const renderer = game.renderer, ui = game.ui, status = game._updateV2RuntimeStatus, historical = game.weather._historicalReplay;
            game.renderer = null;
            game.ui = null;
            game._updateV2RuntimeStatus = () => { };
            // External observations were saved with the checkpoint; playback never fetches today's data.
            game.weather._historicalReplay = () => true;
            const at = (ms) => {
                const pt = engine._timeAtEpoch(ms);
                return { pt, date: engine._formatDateISO(pt.date), time: pt.hours * 60 + pt.minutes + (pt.seconds + (ms % 1000) / 1000) / 60 };
            };
            const handlers = {
                minute(ms) { const p = at(ms); engine.lastMinute = p.pt.hours * 60 + p.pt.minutes; engine.currentDate = p.date; game.tick(p.time, p.date, p.pt); },
                second(ms) { const p = at(ms); engine.lastSecondKey = String(Math.floor(ms / 1000)); engine.currentDate = p.date; game.secondTick(p.time, p.date, p.pt); },
                move(dt, ms) { game.moveTick(dt, at(ms).time); },
            };
            try {
                // Discard wall-clock debt only. Target, event order and dt still use the real clock.
                clock.targetMs = target;
                do {
                    const before = clock.cursorMs;
                    clock.advance(target, handlers, 2000, 8);
                    if (clock.failed)
                        throw new Error(clock.failed);
                    if (clock.cursorMs >= target)
                        break;
                    if (clock.cursorMs === before)
                        throw new Error('Cible incompatible avec le pas physique de 100 ms.');
                    await new Promise(resolve => setTimeout(resolve, 0));
                } while (clock.cursorMs < target);
                if (clock.cursorMs !== target)
                    throw new Error('Le moteur ne rejoint pas exactement la cible enregistrée.');
                // Permit queued production tasks to settle before the next command/hash.
                await Promise.resolve();
            }
            finally {
                game.renderer = renderer;
                game.ui = ui;
                game._updateV2RuntimeStatus = status;
                game.weather._historicalReplay = historical;
            }
        },
        apply(command) {
            const input = record(command);
            if (input.kind !== 'operations' || typeof input.action !== 'string')
                throw new Error('Commande enregistrée non reconnue.');
            if (!game.ui || typeof game.ui.performOperationsAction !== 'function')
                throw new Error('Façade des commandes réelles absente.');
            return game.ui.performOperationsAction(input.action, record(input.values));
        },
        snapshot: () => captureLiveReplaySnapshot(game),
        getRngState: () => game.rng.getState(),
        beginDomainEvents: () => { game._replayDomainEvents = []; },
        getDomainEvents: () => game._replayDomainEvents || [],
    };
    return adapter;
}
