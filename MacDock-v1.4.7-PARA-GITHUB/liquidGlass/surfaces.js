// SPDX-License-Identifier: GPL-2.0-or-later
// Liquid Glass para superfícies do GNOME Shell além do dock.
//
// OPT-IN: este módulo só é carregado (import dinâmico em manager.js) quando
// `liquid-glass-scope` é 'custom' ou 'full'. No modo padrão 'dock' ele nem é
// importado, então um erro aqui nunca afeta o dock.
//
// Estratégia: um BackdropGlass (o mesmo renderizador do dock) por superfície,
// inserido em Main.uiGroup logo abaixo da raiz da superfície. Menus usam UMA
// instância compartilhada que acompanha o menu aberto no momento (só há um
// menu com grab por vez), em vez de uma instância por menu.
//
// Cada superfície só esconde o fundo original DEPOIS da primeira composição
// bem-sucedida, restaura-o ao perder o alvo/desativar e, em caso de falha do
// renderizador, desliga apenas a si mesma.

import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {BoxPointer} from 'resource:///org/gnome/shell/ui/boxpointer.js';

import {BackdropGlass} from './rendering/backdropGlass.js';
import {setClipIfChanged, setSizeIfChanged, setPositionIfChanged} from './actors/writes.js';
import {effectiveSurfaces} from './surfaceCatalog.js';

const PADDING = 24;
const READY_TIMEOUT_US = 5 * 1000 * 1000;
const MENU_KINDS = ['popups', 'quick-settings', 'calendar'];

function monitorAt(x, y) {
    const {monitors, primaryMonitor} = Main.layoutManager;
    return monitors.find(m => x >= m.x && x < m.x + m.width &&
        y >= m.y && y < m.y + m.height) ?? primaryMonitor ?? null;
}

// Raio do contorno do BoxPointer (CSS -arrow-border-radius).
function arrowRadius(pointer, fallback = 16) {
    try {
        const [found, value] = pointer.get_theme_node().lookup_length('-arrow-border-radius', false);
        return found && value > 0 ? value : fallback;
    } catch {
        return fallback;
    }
}

function borderRadius(actor, fallback = 24) {
    try {
        return actor.get_theme_node().get_border_radius(St.Corner.TOPLEFT) || fallback;
    } catch {
        return fallback;
    }
}

class SurfaceGlass {
    constructor({id, settings, extensionPath, resolve, hideOriginal}) {
        this.id = id;
        this.failure = null;
        this._settings = settings;
        this._extensionPath = extensionPath;
        this._resolve = resolve;
        this._hideOriginal = hideOriginal;
        this._glass = null;
        this._target = null;
        this._targetAlive = false;
        this._targetDestroyId = 0;
        this._restore = null;
        this._ready = false;
        this._waitingSince = 0;
        this._radius = -1;
    }

    // Chamado uma vez por quadro (stage::before-update), nunca durante pintura.
    sync() {
        if (this.failure)
            return;
        let resolved = null;
        try {
            resolved = this._resolve();
        } catch (error) {
            this._fail(`resolve: ${error}`);
            return;
        }
        if (!resolved) {
            this._detach();
            return;
        }
        try {
            this._place(resolved);
        } catch (error) {
            this._fail(`place: ${error}`);
        }
    }

    describe() {
        return {id: this.id, failure: this.failure, ready: this._ready, hasTarget: !!this._target};
    }

    applySettings() {
        const glass = this._glass;
        if (!glass)
            return;
        const s = this._settings;
        const hex = s.get_string('liquid-glass-tint');
        const tint = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#c4d6ef';
        glass.setTintColor(...[1, 3, 5].map(i => parseInt(tint.slice(i, i + 2), 16) / 255));
        glass.setTintStrength(s.get_double('liquid-glass-tint-strength'));
        glass.setBlurRadius(s.get_double('liquid-glass-blur'));
        const economy = s.get_boolean('liquid-glass-economy');
        glass._renderer.blur.setDownscale(economy ? 4 : s.get_int('glass-blur-downscale'));
        glass.setEdgeTapsEnabled(!economy);
        glass.queue_redraw();
    }

    disable() {
        this._detach();
        const glass = this._glass;
        this._glass = null;
        if (!glass)
            return;
        const safely = (label, action) => {
            try {
                action();
            } catch (error) {
                console.error(`[MacDock Liquid Glass] ${this.id} ${label}: ${error}`);
            }
        };
        safely('geometry hook', () => glass.setLiveGeometryHook(null));
        safely('cleanup', () => glass.cleanup());
        safely('destroy', () => glass.destroy());
    }

    _fail(reason) {
        if (this.failure)
            return;
        this.failure = reason;
        console.error(`[MacDock Liquid Glass] superfície '${this.id}' desativada: ${reason}`);
        this.disable();
    }

    _ensureGlass() {
        if (this._glass)
            return this._glass;
        const settings = this._settings;
        const glass = new BackdropGlass({
            extensionPath: this._extensionPath,
            settings,
            owner: `macdock-${this.id}`,
            logger: {
                error: message => console.error(message),
                warn: message => console.warn(message),
                log: message => {
                    if (settings.get_boolean('glass-debug-diagnostics'))
                        console.log(message);
                },
            },
        });
        this._glass = glass;
        glass.connect('destroy', () => {
            if (this._glass !== glass)
                return;
            this._glass = null;
            this._fail('glass-destroyed');
        });
        glass.setIsDock(false);
        glass.setPadding(0);
        glass.setShadowMaxRadius(PADDING);
        glass.setBrightness(1);
        glass.setContrast(1);
        glass.setSaturation(1);
        this._radius = -1;
        this.applySettings();
        return glass;
    }

    _stack(glass, actor) {
        const group = Main.uiGroup;
        let root = actor;
        while (root.get_parent() && root.get_parent() !== group)
            root = root.get_parent();
        if (root.get_parent() !== group) {
            glass.hide();
            return false;
        }
        if (!glass.get_parent())
            group.insert_child_below(glass, root);
        // Superfícies podem ser reinseridas/reordenadas: nunca amostrar a si mesma.
        if (glass.get_next_sibling() !== root) {
            group.set_child_below_sibling(glass, root);
            glass._copier.clear();
            glass._relays.redrawArea();
        }
        return true;
    }

    _place(resolved) {
        const {actor, radius = 0} = resolved;
        if (actor !== this._target) {
            this._detach();
            this._target = actor;
            this._targetAlive = true;
            this._targetDestroyId = actor.connect('destroy', () => {
                this._targetAlive = false;
                this._targetDestroyId = 0;
            });
            this._ready = false;
            this._waitingSince = GLib.get_monotonic_time();
        }
        const glass = this._ensureGlass();
        if (glass._renderFailed) {
            this._fail('renderer-failed');
            return;
        }
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        if (![x, y, w, h].every(Number.isFinite) || w <= 1 || h <= 1) {
            glass.hide();
            return;
        }
        const monitor = monitorAt(x + w / 2, y + h / 2);
        if (!monitor || !this._stack(glass, actor))
            return;

        const localX = x - monitor.x;
        const localY = y - monitor.y;
        const clipX = Math.max(0, Math.floor(localX - PADDING));
        const clipY = Math.max(0, Math.floor(localY - PADDING));
        const clipRight = Math.min(monitor.width, Math.ceil(localX + w + PADDING));
        const clipBottom = Math.min(monitor.height, Math.ceil(localY + h + PADDING));
        if (clipRight <= clipX || clipBottom <= clipY) {
            glass.hide();
            return;
        }

        setPositionIfChanged(glass, monitor.x, monitor.y);
        setSizeIfChanged(glass, monitor.width, monitor.height);
        glass.setResolution(monitor.width, monitor.height);
        // Raio mínimo 1: evita o caso degenerado de raio 0 no shader.
        const cornerRadius = Math.max(1, radius);
        if (cornerRadius !== this._radius) {
            this._radius = cornerRadius;
            glass.setCornerRadius(cornerRadius);
        }
        glass.setGlassGeometry(localX, localY, w, h);
        setClipIfChanged(glass, clipX, clipY, clipRight - clipX, clipBottom - clipY);
        glass.opacity = Math.round(actor.get_paint_opacity() *
            this._settings.get_double('liquid-glass-opacity'));
        glass.show();

        if (!this._ready) {
            if (glass._compositePaints > 0) {
                // Primeira composição concluída: só agora o fundo original sai.
                const restore = this._hideOriginal(resolved);
                if (!restore) {
                    this._fail('original-background-unavailable');
                    return;
                }
                this._restore = restore;
                this._ready = true;
            } else if (GLib.get_monotonic_time() - this._waitingSince > READY_TIMEOUT_US) {
                this._fail('first-composition-timeout');
                return;
            }
        }
        glass.syncSources();
    }

    // Restaura o fundo original e esconde o vidro; mantém a instância viva.
    _detach() {
        const restore = this._restore;
        this._restore = null;
        if (restore && this._targetAlive) {
            try {
                restore();
            } catch (error) {
                console.error(`[MacDock Liquid Glass] ${this.id} restore: ${error}`);
            }
        }
        if (this._target && this._targetAlive && this._targetDestroyId) {
            try {
                this._target.disconnect(this._targetDestroyId);
            } catch {
                // O alvo pode estar em descarte; nada a desconectar.
            }
        }
        this._target = null;
        this._targetAlive = false;
        this._targetDestroyId = 0;
        this._ready = false;
        this._glass?.hide();
    }
}

export class SurfaceGlassManager {
    constructor(settings, extensionPath) {
        this._settings = settings;
        this._extensionPath = extensionPath;
        this._enabled = false;
        this._surfaces = new Map();
        this._pointers = new Map();
        this._mapped = [];
        this._wantedMenus = new Set();
        this._settingsId = 0;
        this._frameId = 0;
        this._childAddedId = 0;
    }

    enable() {
        if (this._enabled)
            return;
        this._enabled = true;
        this._settingsId = this._settings.connect('changed', (_settings, key) => {
            if (key === 'liquid-glass-scope' || key === 'liquid-glass-surfaces') {
                this._rebuild();
            } else if (key.startsWith('liquid-glass-')) {
                for (const surface of this._surfaces.values())
                    surface.applySettings();
            }
        });
        this._rebuild();
    }

    describe() {
        return {
            scope: this._settings.get_string('liquid-glass-scope'),
            surfaces: [...this._surfaces.values()].map(surface => surface.describe()),
        };
    }

    disable() {
        this._enabled = false;
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        this._stopFrameHook();
        this._stopPointerTracking();
        for (const surface of this._surfaces.values())
            surface.disable();
        this._surfaces.clear();
        this._wantedMenus = new Set();
    }

    _rebuild() {
        if (!this._enabled)
            return;
        const wanted = effectiveSurfaces(this._settings.get_string('liquid-glass-scope'),
            this._settings.get_strv('liquid-glass-surfaces'));
        this._wantedMenus = new Set(MENU_KINDS.filter(id => wanted.has(id)));
        const required = {
            panel: wanted.has('panel'),
            menus: this._wantedMenus.size > 0,
            notifications: wanted.has('notifications'),
        };
        for (const [key, needed] of Object.entries(required)) {
            const existing = this._surfaces.get(key);
            if (needed && (!existing || existing.failure)) {
                existing?.disable();
                this._surfaces.set(key, this._create(key));
            } else if (!needed && existing) {
                existing.disable();
                this._surfaces.delete(key);
            }
        }
        if (this._surfaces.size > 0)
            this._startFrameHook();
        else
            this._stopFrameHook();
        if (this._surfaces.has('menus'))
            this._startPointerTracking();
        else
            this._stopPointerTracking();
    }

    _create(key) {
        const common = {id: key, settings: this._settings, extensionPath: this._extensionPath};
        if (key === 'panel') {
            return new SurfaceGlass({
                ...common,
                resolve: () => this._resolvePanel(),
                hideOriginal: ({owner}) => {
                    owner.add_style_class_name('macdock-glass-panel');
                    return () => owner.remove_style_class_name('macdock-glass-panel');
                },
            });
        }
        if (key === 'menus') {
            return new SurfaceGlass({
                ...common,
                resolve: () => this._resolveMenus(),
                hideOriginal: ({owner}) => {
                    // O fundo do menu é desenhado pelo _border do BoxPointer.
                    const border = owner._border;
                    if (!border)
                        return null;
                    const previous = border.opacity;
                    border.opacity = 0;
                    return () => {
                        border.opacity = previous;
                    };
                },
            });
        }
        return new SurfaceGlass({
            ...common,
            resolve: () => this._resolveBanner(),
            hideOriginal: ({owner}) => {
                owner.add_style_class_name('macdock-glass-surface');
                return () => owner.remove_style_class_name('macdock-glass-surface');
            },
        });
    }

    _resolvePanel() {
        const {sessionMode} = Main;
        if (sessionMode.isLocked || sessionMode.isGreeter)
            return null;
        const panel = Main.panel;
        if (!panel || !panel.mapped)
            return null;
        return {actor: panel, owner: panel, radius: 1};
    }

    _resolveMenus() {
        for (let i = this._mapped.length - 1; i >= 0; i--) {
            const pointer = this._mapped[i];
            if (!pointer.bin || !this._wantedMenus.has(this._kindOf(pointer)))
                continue;
            return {actor: pointer.bin, owner: pointer, radius: arrowRadius(pointer)};
        }
        return null;
    }

    _resolveBanner() {
        const banner = Main.messageTray?._banner;
        if (!banner || !banner.mapped)
            return null;
        return {actor: banner, owner: banner, radius: borderRadius(banner)};
    }

    _kindOf(pointer) {
        const area = Main.panel?.statusArea;
        if (pointer === area?.quickSettings?.menu?.actor)
            return 'quick-settings';
        if (pointer === area?.dateMenu?.menu?.actor)
            return 'calendar';
        return 'popups';
    }

    _startFrameHook() {
        if (this._frameId)
            return;
        this._frameId = global.stage.connect('before-update', () => {
            for (const surface of this._surfaces.values())
                surface.sync();
        });
    }

    _stopFrameHook() {
        if (!this._frameId)
            return;
        global.stage.disconnect(this._frameId);
        this._frameId = 0;
    }

    _startPointerTracking() {
        if (this._childAddedId)
            return;
        this._childAddedId = Main.uiGroup.connect('child-added', (_group, child) =>
            this._trackPointer(child));
        for (const child of Main.uiGroup.get_children())
            this._trackPointer(child);
    }

    _stopPointerTracking() {
        if (this._childAddedId) {
            Main.uiGroup.disconnect(this._childAddedId);
            this._childAddedId = 0;
        }
        for (const pointer of [...this._pointers.keys()])
            this._untrackPointer(pointer, false);
        this._mapped = [];
    }

    _trackPointer(actor) {
        if (!(actor instanceof BoxPointer) || this._pointers.has(actor))
            return;
        const ids = [
            actor.connect('notify::mapped', () => this._pointerMapped(actor)),
            actor.connect('destroy', () => this._untrackPointer(actor, true)),
        ];
        this._pointers.set(actor, ids);
        this._pointerMapped(actor);
    }

    _pointerMapped(actor) {
        this._mapped = this._mapped.filter(pointer => pointer !== actor);
        if (actor.mapped)
            this._mapped.push(actor);
    }

    _untrackPointer(actor, destroyed) {
        const ids = this._pointers.get(actor);
        if (!ids)
            return;
        this._pointers.delete(actor);
        this._mapped = this._mapped.filter(pointer => pointer !== actor);
        if (destroyed)
            return;
        for (const id of ids) {
            try {
                actor.disconnect(id);
            } catch {
                // Ator já em descarte.
            }
        }
    }
}
