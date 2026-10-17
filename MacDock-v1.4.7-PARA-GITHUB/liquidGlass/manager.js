// Experimental Liquid Glass lifecycle manager for MacDock.
// Not activated automatically.

import GLib from 'gi://GLib';
import {applyPreset} from '../appearance.js';
import {DockGlassIntegration} from './dockIntegration.js';

export class LiquidGlassManager {
    constructor(dockManager, extensionPath) {
        this._dockManager = dockManager;
        this._extensionPath = extensionPath;
        this._integrations = new Map();
        this._readySignalId = 0;
        this._enabled = false;
        this._surfaces = null;
        this._surfacesLoading = false;
        this._scopeSignalId = 0;
        this.surfaceFailure = null;
        this.failures = [];
    }

    enable() {
        if (this._enabled)
            return;

        this._enabled = true;

        this._readySignalId = this._dockManager.connect(
            'docks-ready',
            () => this._syncDocks()
        );

        const settings = this._dockManager.settings;
        // Upgrade the previously independent on/off setting once on startup.
        if (settings.get_boolean('liquid-glass-enabled') && settings.get_string('macdock-theme') !== 'liquid')
            applyPreset(settings, 'liquid');
        this._settingsId = settings.connect('changed', (_settings, key) => {
            if (this._syncingTheme || !['macdock-theme', 'liquid-glass-enabled',
                'macdock-appearance-enabled'].includes(key))
                return;
            this._syncingTheme = true;
            try {
                if (key === 'macdock-theme') {
                    settings.set_boolean('liquid-glass-enabled', settings.get_string(key) === 'liquid');
                } else if (key === 'liquid-glass-enabled') {
                    const enabled = settings.get_boolean(key);
                    if (enabled && settings.get_string('macdock-theme') !== 'liquid')
                        applyPreset(settings, 'liquid');
                    else if (!enabled && settings.get_string('macdock-theme') === 'liquid')
                        applyPreset(settings, 'glass');
                }
            } finally {
                this._syncingTheme = false;
            }
            // One renderer transition for a whole batch of preset settings.
            if (!this._syncIdle) {
                this._syncIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._syncIdle = 0;
                    this._syncDocks();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        // Superfícies além do dock (opt-in; padrão 'dock' não carrega nada).
        this._scopeSignalId = settings.connect('changed::liquid-glass-scope', () => this._syncSurfaces());
        this._syncSurfaces();
        this._syncDocks();
    }

    // Import dinâmico: um erro no módulo de superfícies nunca derruba o dock.
    async _syncSurfaces() {
        if (!this._enabled)
            return;
        const settings = this._dockManager.settings;
        if (settings.get_string('liquid-glass-scope') === 'dock') {
            this._surfaces?.disable();
            this._surfaces = null;
            return;
        }
        if (this._surfaces || this._surfacesLoading)
            return;
        this._surfacesLoading = true;
        try {
            const module = await import('./surfaces.js');
            if (!this._enabled || this._surfaces ||
                settings.get_string('liquid-glass-scope') === 'dock')
                return;
            this._surfaces = new module.SurfaceGlassManager(settings, this._extensionPath);
            this._surfaces.enable();
            this.surfaceFailure = null;
        } catch (error) {
            this.surfaceFailure = String(error);
            console.error(`[MacDock Liquid Glass] superfícies indisponíveis: ${error}`);
            try {
                this._surfaces?.disable();
            } catch (cleanupError) {
                console.error(`[MacDock Liquid Glass] limpeza das superfícies: ${cleanupError}`);
            }
            this._surfaces = null;
        } finally {
            this._surfacesLoading = false;
        }
    }

    _syncDocks() {
        if (!this._enabled)
            return;

        const settings = this._dockManager.settings;
        const docks = settings.get_boolean('liquid-glass-enabled') &&
            settings.get_boolean('macdock-appearance-enabled') && settings.get_string('macdock-theme') === 'liquid'
            ? this._dockManager._allDocks ?? [] : [];
        const current = new Set(docks);

        for (const [dock, integration] of this._integrations) {
            if (!current.has(dock)) {
                this._integrations.delete(dock);
                integration.disable();
            }
        }

        for (const dock of docks) {
            if (this._integrations.has(dock))
                continue;

            let integration = null;

            try {
                integration = new DockGlassIntegration(
                    dock,
                    this._extensionPath,
                    this._dockManager.settings,
                    (removedDock, removedIntegration) => {
                        if (removedIntegration.failure) {
                            this.failures.push(removedIntegration.failure);
                            this.failures = this.failures.slice(-16);
                        }
                        if (this._integrations.get(removedDock) === removedIntegration)
                            this._integrations.delete(removedDock);
                    }
                );

                integration.enable();
                this._integrations.set(dock, integration);
            } catch (error) {
                console.error(
                    `[MacDock Liquid Glass] Initialization failed: ${error}`
                );

                try {
                    integration?.disable();
                } catch (cleanupError) {
                    console.error(
                        `[MacDock Liquid Glass] Cleanup failed: ${cleanupError}`
                    );
                }
            }
        }
    }

    describe() {
        return {
            enabled: this._dockManager.settings.get_boolean('liquid-glass-enabled'),
            failures: [...this.failures],
            surfaceFailure: this.surfaceFailure,
            surfaces: this._surfaces?.describe() ?? null,
            docks: [...this._integrations.values()].map(item => ({
                ready: item._glassReady,
                ...item._glass?.describe(),
            })),
        };
    }

    disable() {
        this._enabled = false;
        if (this._scopeSignalId) {
            this._dockManager.settings.disconnect(this._scopeSignalId);
            this._scopeSignalId = 0;
        }
        try {
            this._surfaces?.disable();
        } catch (error) {
            console.error(`[MacDock Liquid Glass] Surfaces cleanup failed: ${error}`);
        }
        this._surfaces = null;
        if (this._syncIdle) {
            GLib.Source.remove(this._syncIdle);
            this._syncIdle = 0;
        }
        if (this._settingsId) {
            this._dockManager.settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }

        if (this._readySignalId) {
            this._dockManager.disconnect(this._readySignalId);
            this._readySignalId = 0;
        }

        for (const integration of this._integrations.values()) {
            try {
                integration.disable();
            } catch (error) {
                console.error(
                    `[MacDock Liquid Glass] Cleanup failed: ${error}`
                );
            }
        }

        this._integrations.clear();
    }
}
