// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export class ResourceScope {
    constructor() {
        this.alive = true;
        this.cancellable = new Gio.Cancellable();
        this._cleanup = [];
    }

    own(cleanup) {
        this._cleanup.push(cleanup);
    }

    actor(actor) {
        let live = true;
        actor.connect('destroy', () => (live = false));
        this.own(() => {
            if (live)
                actor.destroy();
        });
        return actor;
    }

    connect(object, signal, callback) {
        let live = true;
        const actor = object instanceof Clutter.Actor;
        const id = object.connect(signal, (...args) => {
            if (signal === 'destroy')
                live = false;
            if (this.alive)
                callback(...args);
        });
        const destroyId = actor && signal !== 'destroy'
            ? object.connect('destroy', () => {
                live = false;
            }) : 0;
        this.own(() => {
            if (!live)
                return;
            object.disconnect(id);
            if (destroyId)
                object.disconnect(destroyId);
        });
        return id;
    }

    every(seconds, callback) {
        let removed = false;
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            if (!this.alive) {
                removed = true;
                return GLib.SOURCE_REMOVE;
            }
            try {
                callback();
            } catch (error) {
                console.warn(`MacDock widget update: ${error.message}`);
            }
            return GLib.SOURCE_CONTINUE;
        });
        this.own(() => {
            if (!removed)
                GLib.source_remove(id);
        });
    }

    destroy() {
        if (!this.alive)
            return;
        this.alive = false;
        this.cancellable.cancel();
        for (const cleanup of this._cleanup.reverse()) {
            try {
                cleanup();
            } catch (error) {
                console.warn(`MacDock widget cleanup: ${error.message}`);
            }
        }
        this._cleanup = [];
    }
}

export function makeCard(scope, name, icon) {
    const actor = scope.actor(new St.Button({
        style_class: 'macdock-widget', can_focus: true, reactive: true,
        accessible_name: name, width: 240, height: 60,
    }));
    const row = new St.BoxLayout({style_class: 'macdock-widget-row'});
    const symbol = new St.Icon({icon_name: icon, icon_size: 30, y_align: Clutter.ActorAlign.CENTER});
    row.add_child(symbol);
    const text = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER, x_expand: true});
    const title = new St.Label({text: name, style_class: 'macdock-widget-title'});
    const detail = new St.Label({text: '…', style_class: 'macdock-widget-detail'});
    text.add_child(title);
    text.add_child(detail);
    row.add_child(text);
    actor.set_child(row);
    return {actor, title, detail, symbol};
}

export function makeMenu(scope, button) {
    const menu = new PopupMenu.PopupMenu(button, 0.5, scope.menuSide ?? St.Side.TOP);
    Main.uiGroup.add_child(menu.actor);
    menu.actor.hide();
    const manager = new PopupMenu.PopupMenuManager(button);
    manager.addMenu(menu);
    scope.connect(button, 'clicked', () => menu.toggle());
    scope.connect(menu, 'open-state-changed', (_menu, opened) => scope.menuState?.(opened));
    scope.own(() => {
        // Flush an open popup's pending allocation before disposal. GNOME 46
        // may otherwise revisit its queued BoxPointer during the next layout.
        if (menu.isOpen)
            menu.actor.get_allocation_box();
        // Release the modal grab while the menu and source are still alive.
        menu.close(0);
        menu.actor.remove_all_transitions();
        menu.actor.hide();
        manager.removeMenu(menu);
        menu.destroy();
    });
    return menu;
}

export function menuLabel(menu, text) {
    const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
    menu.addMenuItem(item);
    return item.label;
}

