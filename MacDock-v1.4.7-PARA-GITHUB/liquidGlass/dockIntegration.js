// Experimental Liquid Glass integration for MacDock.
// This module is not activated automatically.

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BackdropGlass} from './rendering/backdropGlass.js';
import {setClipIfChanged, setSizeIfChanged, setPositionIfChanged} from './actors/writes.js';

const PADDING = 24;

export class DockGlassIntegration {
    constructor(dock, extensionPath, settings, onDisabled = null) {
        this._dock = dock;
        this._onDisabled = onDisabled;
        this._extensionPath = extensionPath;
        this._glass = null;
        this._signals = [];
        this._frameSignalId = 0;
        this._background = dock.dash._background;
        this._originalOpacity = this._background.opacity;
        this._settings = settings;
    }

    enable() {
        if (this._glass)
            return;

        const glass = new BackdropGlass({
            extensionPath: this._extensionPath,
            settings: this._settings,
            owner: 'macdock',
            logger: {error: message => console.error(message), warn: message => console.warn(message),
                log: message => { if (this._settings.get_boolean('glass-debug-diagnostics')) console.log(message); }},
        });

        this._glass = glass;
        glass.connect('destroy', () => {
            if (this._glass !== glass)
                return;
            glass.cleanup();
            this._glass = null;
            this.disable();
        });
        glass.setIsDock(true);
        glass.setPadding(0);
        glass.setShadowMaxRadius(PADDING);
        glass.setBlurRadius(this._settings.get_double('liquid-glass-blur'));
        glass.setCornerRadius(this._settings.get_double('macdock-radius'));
        this._applySettings();
        glass.setBrightness(1);
        glass.setContrast(1);
        glass.setSaturation(1);

        this._syncStacking();

        // Geometry changes only before-update, never during paint/allocation.
        // Preserve the original background until shaders are ready.
        this._glassReady = false;
        this._connect(this._background, 'destroy', () => {
            this._background = null;
            this.disable();
        });
        this._connect(this._dock, 'destroy', () => this.disable());
        this._connect(this._dock, 'notify::mapped', () => {
            if (!this._glass)
                return;

            // Also cancel the startup watchdog when the parent becomes unmapped.
            this._syncGeometry();
        });

        this._frameSignalId = global.stage.connect(
            'before-update',
            () => {
                if (!this._glass)
                    return;

                if (this._glass._renderFailed) {
                    console.warn('[MacDock] Liquid Glass renderer failed; restoring original background');
                    this.failure = 'renderer-failed';
                    this.disable();
                    return;
                }

                // Keep geometry and backdrop relays synchronized while
                // waiting for the first successful composite.
                if (this._dock.mapped)
                    this._syncGeometry();

                if (!this._glassReady) {
                    if (this._glass._compositePaints > 0) {
                        this._glassReady = true;
                        if (this._shaderTimeoutId) {
                            GLib.Source.remove(this._shaderTimeoutId);
                            this._shaderTimeoutId = 0;
                        }
                        this._background.opacity = 0;
                        if (this._settings.get_boolean('glass-debug-diagnostics'))
                            console.log('[MacDock Glass] first composite: ' + JSON.stringify(this._glass.describe()));
                    } else {
                        return;
                    }
                }

            }
        );

        this._connect(this._settings, 'changed', (_settings, key) => {
            if (key.startsWith('liquid-glass-') || key === 'macdock-radius')
                this._applySettings();
        });
        this._syncGeometry();
    }

    _syncStacking() {
        const glass = this._glass;
        const group = Main.uiGroup;
        let root = this._dock;
        while (root.get_parent() && root.get_parent() !== group)
            root = root.get_parent();
        if (root.get_parent() !== group) {
            glass.hide();
            return false;
        }
        if (!glass.get_parent())
            group.insert_child_below(glass, root);
        // Chrome can be reinserted or reordered after startup (fullscreen,
        // struts, overview, other extensions). Never sample our own icons.
        if (glass.get_next_sibling() !== root) {
            group.set_child_below_sibling(glass, root);
            glass._copier.clear();
            glass._relays.redrawArea();
        }
        return true;
    }

    _stopWatchdog() {
        if (this._shaderTimeoutId) {
            GLib.Source.remove(this._shaderTimeoutId);
            this._shaderTimeoutId = 0;
        }
    }

    _startWatchdog() {
        this._shaderTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, 5000, () => {
                this._shaderTimeoutId = 0;
                if (this._glass && !this._glassReady) {
                    console.error('[MacDock] Liquid Glass shader timeout; diagnostics=' +
                        JSON.stringify({
                            stats: this._glass.stats,
                            shadersLoaded: this._glass._shadersLoaded,
                            firstComposite: this._glass._firstCompositeQueued,
                            renderFailed: this._glass._renderFailed,
                            visible: this._glass.visible,
                            mapped: this._glass.mapped,
                            opacity: this._glass.opacity,
                            dockMapped: this._dock.mapped,
                            dockVisible: this._dock.visible,
                            glassSize: this._glass.get_size(),
                            sampleArea: this._glass._relays?.areaRect(),
                        }));
                    this.failure = 'first-composition-timeout';
                    this.disable();
                }
                return GLib.SOURCE_REMOVE;
            });

    }

    _applySettings() {
        const glass = this._glass;
        if (!glass)
            return;
        const settings = this._settings;
        const hex = settings.get_string('liquid-glass-tint');
        const tint = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#c4d6ef';
        glass.setTintColor(...[1, 3, 5].map(i => parseInt(tint.slice(i, i + 2), 16) / 255));
        glass.setTintStrength(settings.get_double('liquid-glass-tint-strength'));
        glass.setBlurRadius(settings.get_double('liquid-glass-blur'));
        glass.setCornerRadius(settings.get_double('macdock-radius'));
        glass._renderer.blur.setDownscale(settings.get_boolean('liquid-glass-economy')
            ? 4 : settings.get_int('glass-blur-downscale'));
        glass.setEdgeTapsEnabled(!settings.get_boolean('liquid-glass-economy'));
        glass.queue_redraw();
    }

    _connect(actor, signal, callback) {
        const record = [actor, 0];
        record[1] = actor.connect(signal, (...args) => {
            if (signal === 'destroy')
                record[0] = null;
            callback(...args);
        });
        this._signals.push(record);
    }

    _syncGeometry(syncSources = true) {
        const glass = this._glass;
        const bg = this._background;

        if (!glass || !bg)
            return;
        if (!this._syncStacking())
            return;

        if (!this._dock.mapped || !this._dock.visible) {
            glass.hide();
            this._stopWatchdog();
            return;
        }

        // Do not render glass when the auto-hide animation is fully closed.
        const slider = this._dock._slider;
        if (slider && slider.slideX <= 0.001) {
            glass.hide();
            this._stopWatchdog();
            return;
        }

        const monitor = Main.layoutManager.monitors[this._dock.monitorIndex];
        if (!monitor)
            return;

        const [x, y] = bg.get_transformed_position();
        const [w, h] = bg.get_transformed_size();

        if (![x, y, w, h].every(Number.isFinite) || w <= 1 || h <= 1) {
            glass.hide();
            this._stopWatchdog();
            return;
        }

        const localX = x - monitor.x;
        const localY = y - monitor.y;

        setPositionIfChanged(glass, monitor.x, monitor.y);
        setSizeIfChanged(glass, monitor.width, monitor.height);
        glass.setResolution(monitor.width, monitor.height);

        glass.setGlassGeometry(localX, localY, w, h);

        const clipX = Math.max(0, Math.floor(localX - PADDING));
        const clipY = Math.max(0, Math.floor(localY - PADDING));
        const clipRight = Math.min(
            monitor.width,
            Math.ceil(localX + w + PADDING)
        );
        const clipBottom = Math.min(
            monitor.height,
            Math.ceil(localY + h + PADDING)
        );

        let visibleLeft = clipX;
        let visibleTop = clipY;
        let visibleRight = clipRight;
        let visibleBottom = clipBottom;

        // The slider clips the Dock during auto-hide animations.
        // Reproduce its visible rectangle for the separate glass actor.
        if (slider) {
            const [sx, sy] = slider.get_transformed_position();
            const [sw, sh] = slider.get_transformed_size();

            if (![sx, sy, sw, sh].every(Number.isFinite) ||
                sw <= 0 || sh <= 0) {
                glass.hide();
            this._stopWatchdog();
                return;
            }

            visibleLeft = Math.max(
                visibleLeft, Math.floor(sx - monitor.x)
            );
            visibleTop = Math.max(
                visibleTop, Math.floor(sy - monitor.y)
            );
            visibleRight = Math.min(
                visibleRight, Math.ceil(sx + sw - monitor.x)
            );
            visibleBottom = Math.min(
                visibleBottom, Math.ceil(sy + sh - monitor.y)
            );
        }

        if (visibleRight <= visibleLeft ||
            visibleBottom <= visibleTop) {
            glass.hide();
            this._stopWatchdog();
            return;
        }

        setClipIfChanged(
            glass,
            visibleLeft,
            visibleTop,
            visibleRight - visibleLeft,
            visibleBottom - visibleTop
        );

        glass.opacity = Math.round(this._dock.get_paint_opacity() *
            this._settings.get_double('liquid-glass-opacity'));
        glass.show();
        if (!this._glassReady && !this._shaderTimeoutId)
            this._startWatchdog();
        if (syncSources)
            glass.syncSources();
    }

    disable() {
        const onDisabled = this._onDisabled;
        this._onDisabled = null;

        const safely = (label, action) => {
            try {
                action();
            } catch (error) {
                console.error(`[MacDock Liquid Glass] ${label}: ${error}`);
            }
        };

        if (this._shaderTimeoutId) {
            const id = this._shaderTimeoutId;
            this._shaderTimeoutId = 0;
            safely('Remove shader timeout', () => GLib.Source.remove(id));
        }

        if (this._frameSignalId) {
            const id = this._frameSignalId;
            this._frameSignalId = 0;
            safely('Disconnect frame signal', () => global.stage.disconnect(id));
        }

        for (const [actor, id] of this._signals) {
            if (actor)
                safely('Disconnect Dock signal', () => actor.disconnect(id));
        }

        this._signals = [];

        if (this._background)
            safely('Restore Dock background', () => {
                this._background.opacity = this._originalOpacity;
            });

        const glass = this._glass;
        this._glass = null;
        this._glassReady = false;

        if (glass) {
            safely('Remove geometry hook', () => glass.setLiveGeometryHook(null));
            safely('Cleanup renderer', () => glass.cleanup());
            safely('Destroy glass actor', () => glass.destroy());
        }

        if (onDisabled)
            safely('Notify manager', () => onDisabled(this._dock, this));
    }
}
