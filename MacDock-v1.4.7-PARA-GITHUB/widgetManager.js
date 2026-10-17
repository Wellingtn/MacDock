// SPDX-License-Identifier: GPL-2.0-or-later
// Native-resolution widget layouts aligned with application icons.
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ResourceScope} from './widgetSupport.js';
import {resizeWidgetContents} from './widgetSizing.js';

const ICON_BASE = 48;           // tamanho de ícone para o qual os cartões foram desenhados
const FALLBACK_PAD_TOP = 10;    // folga do botão de app (stylesheet.css: padding-top)
const FALLBACK_PAD_BOTTOM = 14; // idem padding-bottom
const MUSIC_UUID = 'dock-music@local';

// Folga superior/inferior REAL do botão de app, para alinhar o cartão ao ícone.
function appButtonPadding(dash) {
    try {
        for (const container of dash._box.get_children()) {
            const button = container.child;
            if (!button?.get_stage?.() || !button.mapped)
                continue;
            const node = button.get_theme_node();
            const top = node.get_padding(St.Side.TOP);
            const bottom = node.get_padding(St.Side.BOTTOM);
            if (Number.isFinite(top) && Number.isFinite(bottom) && top + bottom > 0)
                return {top, bottom};
        }
    } catch {
        // Tema ainda não resolvido: usa o padrão do stylesheet.
    }
    return {top: FALLBACK_PAD_TOP, bottom: FALLBACK_PAD_BOTTOM};
}

export class WidgetManager {
    constructor(manager, factories) {
        this.manager = manager;
        this.factories = factories;
        this.scope = new ResourceScope();
        this.instances = new Map(); // `${dockIndex}:${id}` -> {scope, id}
        this._rebuildIdle = 0;
        this.scope.connect(manager, 'docks-ready', () => this._queueRebuild());
        // Só o Dock Music independente interessa; antes, QUALQUER extensão
        // mudando de estado destruía e recriava todos os widgets.
        this.scope.connect(Main.extensionManager, 'extension-state-changed', (_manager, extension) => {
            if (extension?.uuid === MUSIC_UUID)
                this._queueRebuild();
        });
        this.scope.connect(manager.settings, 'changed', (_settings, key) => {
            if (key === 'macdock-widget-enabled' || key === 'macdock-widget-order' ||
                key === 'macdock-widget-position')
                this._queueRebuild();
            else if (key.startsWith('macdock-weather-'))
                this._rebuildOnly('weather');
        });
        this.scope.own(() => {
            if (this._rebuildIdle)
                GLib.Source.remove(this._rebuildIdle);
            this._rebuildIdle = 0;
        });
        this.rebuild();
    }

    // Junta rajadas de eventos em uma única reconstrução.
    _queueRebuild() {
        if (this._rebuildIdle || !this.scope.alive)
            return;
        this._rebuildIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildIdle = 0;
            this.rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuildOnly(id) {
        if (!this.scope.alive)
            return;
        for (const [key, instance] of [...this.instances]) {
            if (instance.id !== id)
                continue;
            instance.scope.destroy();
            this.instances.delete(key);
        }
        this._build(id);
    }

    rebuild() {
        if (!this.scope.alive)
            return;
        for (const instance of this.instances.values())
            instance.scope.destroy();
        this.instances.clear();
        const {settings} = this.manager;
        const enabled = settings.get_strv('macdock-widget-enabled');
        const ordered = [...new Set([...settings.get_strv('macdock-widget-order'), ...enabled])];
        for (const id of ordered)
            this._build(id);
    }

    _build(onlyId) {
        const {settings} = this.manager;
        const enabled = settings.get_strv('macdock-widget-enabled');
        if (!enabled.includes(onlyId) || !this.factories[onlyId])
            return;
        // O Dock Music independente tem prioridade: nunca dois players no mesmo dock.
        if (onlyId === 'music' && Main.extensionManager.lookup(MUSIC_UUID)?.state === 1)
            return;
        const docks = [...this.manager.constructor.allDocks];
        docks.forEach((dock, dockIndex) => {
            const scope = new ResourceScope();
            try {
                this._mount(scope, dock, onlyId);
                this.instances.set(`${dockIndex}:${onlyId}`, {scope, id: onlyId});
            } catch (error) {
                scope.destroy();
                console.warn(`MacDock widget ${onlyId}: ${error.stack ?? error}`);
            }
        });
    }

    _mount(scope, dock, id) {
        const {settings} = this.manager;
        scope.menuSide = [St.Side.BOTTOM, St.Side.LEFT, St.Side.TOP, St.Side.RIGHT][settings.get_enum('dock-position')];
        let dockAlive = true;
        let menuOpen = false;
        scope.connect(dock, 'destroy', () => {
            dockAlive = false;
            scope.destroy();
        });
        scope.menuState = opened => {
            if (!dockAlive || menuOpen === opened)
                return;
            menuOpen = opened;
            dock.dash.emit(opened ? 'menu-opened' : 'menu-closed');
        };
        scope.own(() => {
            if (dockAlive && menuOpen)
                dock.dash.emit('menu-closed');
        });

        // Slot: tamanho explícito e NUNCA esticado pelo BoxLayout do dash.
        const slot = scope.actor(new St.Widget({
            layout_manager: new Clutter.FixedLayout(), clip_to_allocation: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
            width: 0, height: 0, visible: false,
        }));
        let visible = true;
        let widget = null;
        let geometry = null;

        // Calcula (sem ler alocação) o tamanho do slot e a posição do cartão.
        const measure = () => {
            const logicalSize = Math.max(16, dock.dash.iconSize || ICON_BASE);
            const deviceScale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const iconSize = logicalSize * deviceScale;
            const base = widget.size ?? {width: 216, height: ICON_BASE};
            const scale = logicalSize / ICON_BASE;
            const width = Math.round(base.width * scale * deviceScale);
            const height = Math.round(base.height * scale * deviceScale);
            const gap = Math.round(8 * (iconSize / ICON_BASE));
            const pad = appButtonPadding(dock.dash);
            // Altura do slot == altura do botão de app, para o dock não crescer.
            const rowHeight = iconSize + pad.top + pad.bottom;
            const cardY = Math.round(pad.top);
            return {scale, base, width, height, gap, rowHeight, cardY};
        };

        const place = (slotWidth = null) => {
            if (!scope.alive || !widget || !geometry)
                return;
            const g = geometry;
            const innerWidth = slotWidth ?? (g.width + (dock.isHorizontal ? g.gap : 0));
            widget.actor.set_pivot_point(0, 0);
            widget.actor.set_scale(1, 1);
            widget.actor.set_size(g.width, g.height);
            widget.actor.set_position(
                Math.round((innerWidth - g.width) / 2),
                dock.isHorizontal ? g.cardY : 0);
        };

        const resize = (animate = false) => {
            if (!scope.alive || !widget)
                return;
            geometry = measure();
            const g = geometry;
            resizeWidgetContents(widget.actor, g.scale);
            widget.resize?.(g.width, g.height);
            slot.remove_all_transitions();
            if (visible)
                slot.show();
            const targetWidth = visible || !dock.isHorizontal
                ? g.width + (dock.isHorizontal ? g.gap : 0) : 0;
            const targetHeight = visible || dock.isHorizontal
                ? (dock.isHorizontal ? g.rowHeight : g.height + g.gap) : 0;
            const duration = animate && St.Settings.get().enable_animations ? 600 : 0;
            place(visible ? targetWidth : null);
            slot.ease({
                width: targetWidth, height: targetHeight,
                opacity: visible ? 255 : 0,
                duration, mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
                onComplete: () => {
                    if (!scope.alive)
                        return;
                    if (!visible)
                        slot.hide();
                    place(visible ? targetWidth : null);
                },
            });
        };
        const setVisible = value => {
            if (visible === value)
                return;
            visible = value;
            resize(true);
        };

        widget = this.factories[id]({scope, settings, extension: this.manager.extension, setVisible});
        scope.own(() => widget.destroy?.());
        slot.add_child(widget.actor);

        // Durante a animação de revelação, acompanha a largura animada do slot.
        scope.connect(slot, 'notify::width', () => {
            if (geometry && dock.isHorizontal && slot.get_transition('width'))
                place(slot.width);
        });
        let relayoutIdle = 0;
        const requery = () => {
            if (relayoutIdle || !scope.alive)
                return;
            relayoutIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                relayoutIdle = 0;
                resize(false);
                return GLib.SOURCE_REMOVE;
            });
        };
        scope.own(() => {
            if (relayoutIdle)
                GLib.Source.remove(relayoutIdle);
            relayoutIdle = 0;
        });
        scope.connect(dock.dash, 'icon-size-changed', requery);
        scope.connect(slot, 'notify::mapped', requery);
        // Tema/fonte/escala mudaram: refaz as medidas.
        scope.connect(St.ThemeContext.get_for_stage(global.stage), 'changed', requery);

        const box = dock.dash._boxContainer;
        slot._macdockWidgetId = id;
        const order = [...new Set([...settings.get_strv('macdock-widget-order'),
            ...settings.get_strv('macdock-widget-enabled')])];
        const next = box.get_children().find(child => child._macdockWidgetId &&
            order.indexOf(child._macdockWidgetId) > order.indexOf(id));
        if (next)
            box.insert_child_below(slot, next);
        else if (settings.get_string('macdock-widget-position') === 'before')
            box.insert_child_below(slot, dock.dash._box);
        else
            box.add_child(slot);
        resize(true);
        // O tema do botão de app só existe depois do 1º mapeamento: reconfere.
        requery();
    }

    destroy() {
        this.scope.destroy();
        for (const instance of this.instances.values())
            instance.scope.destroy();
        this.instances.clear();
    }
}
