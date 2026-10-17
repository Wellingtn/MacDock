import {systemIcon} from './widgetIcons.js';
// SPDX-License-Identifier: GPL-2.0-or-later
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

const WIDGETS = [
    ['weather', 'Clima', 'weather-clear-symbolic'],
    ['system', 'Sistema', 'utilities-system-monitor-symbolic'],
    ['calendar', 'Calendário', 'x-office-calendar-symbolic'],
    ['music', 'Música', 'audio-x-generic-symbolic'],
];

export class MacDockPanel {
    constructor(extension, manager) {
        this._settings = extension.getSettings();
        this._signals = [];
        this._indicator = new PanelMenu.Button(0.0, 'Controles do MacDock', false);
        this._indicator.connect('destroy', () => {
            this._indicator = null;
            this.destroy();
        });
        const menu = this._indicator.menu;
        menu.actor.add_style_class_name('macdock-control-popup');
        this._indicator.add_child(new St.Icon({
            icon_name: 'view-app-grid-symbolic', style_class: 'system-status-icon',
        }));
        try {
            this._heading('Seu dock', 'Ajustes rápidos · alterações ao vivo');
            const preview = this._row();
            const dock = new St.BoxLayout({style_class: 'macdock-control-preview', x_expand: true,
                x_align: Clutter.ActorAlign.CENTER});
            preview.add_child(dock);
            const icons = ['system-file-manager-symbolic', 'web-browser-symbolic',
                'utilities-terminal-symbolic', 'view-app-grid-symbolic'].map(name => {
                const icon = new St.Icon({icon_name: name, style_class: 'macdock-control-app'});
                dock.add_child(icon);
                return icon;
            });
            const sizeRow = this._row();
            sizeRow.add_child(new St.Icon({icon_name: 'zoom-out-symbolic', icon_size: 16}));
            const slider = new Slider(0);
            slider.x_expand = true;
            slider.accessible_name = 'Tamanho dos ícones do dock';
            sizeRow.add_child(slider);
            sizeRow.add_child(new St.Icon({icon_name: 'zoom-in-symbolic', icon_size: 20}));
            let syncing = false;
            const syncSize = () => {
                syncing = true;
                const size = this._settings.get_int('dash-max-icon-size');
                slider.value = Math.max(0, Math.min(1, (size - 24) / 72));
                for (const icon of icons)
                    icon.icon_size = Math.round(18 + Math.min(96, size) / 4);
                syncing = false;
            };
            slider.connect('notify::value', () => {
                if (!syncing)
                    this._settings.set_int('dash-max-icon-size', Math.round((24 + slider.value * 72) / 2) * 2);
            });
            this._watch('dash-max-icon-size', syncSize);
            syncSize();
            const positions = this._row();
            for (const [label, value, icon] of [
                ['Esquerda', 3, 'go-previous-symbolic'], ['Embaixo', 2, 'go-down-symbolic'],
                ['Em cima', 0, 'go-up-symbolic'], ['Direita', 1, 'go-next-symbolic'],
            ]) {
                const button = new St.Button({style_class: 'macdock-control-choice', can_focus: true,
                    x_expand: true, accessible_name: `Posicionar dock: ${label}`,
                    child: new St.Icon({icon_name: icon, icon_size: 16})});
                button.connect('clicked', () => this._settings.set_enum('dock-position', value));
                const sync = () => button[this._settings.get_enum('dock-position') === value
                    ? 'add_style_pseudo_class' : 'remove_style_pseudo_class']('checked');
                this._watch('dock-position', sync);
                sync();
                positions.add_child(button);
            }
            this._heading('Widgets', 'Clique para mostrar ou ocultar');
            const tiles = this._row();
            for (const [id, label, icon] of WIDGETS) {
                const content = new St.BoxLayout({vertical: true, style_class: 'macdock-control-tile-content'});
                content.add_child(new St.Icon({...id === 'system' ? {gicon: systemIcon()} : {icon_name: icon}, icon_size: 23}));
                content.add_child(new St.Label({text: label, x_align: Clutter.ActorAlign.CENTER}));
                const button = new St.Button({style_class: 'macdock-control-tile', child: content,
                    can_focus: true, x_expand: true, accessible_name: label});
                const sync = () => {
                    const external = id === 'music' && Main.extensionManager.lookup('dock-music@local')?.state === 1;
                    const active = external || this._settings.get_strv('macdock-widget-enabled').includes(id);
                    button[active ? 'add_style_pseudo_class' : 'remove_style_pseudo_class']('checked');
                    button.reactive = !external;
                    button.accessible_name = `${label}: ${active ? 'ativado' : 'desativado'}${external ? ' (extensão independente)' : ''}`;
                };
                button.connect('clicked', () => {
                    const enabled = this._settings.get_strv('macdock-widget-enabled');
                    this._settings.set_strv('macdock-widget-enabled', enabled.includes(id)
                        ? enabled.filter(name => name !== id) : [...enabled, id]);
                });
                this._watch('macdock-widget-enabled', sync);
                if (id === 'music')
                    this._externalMusicSignal = Main.extensionManager.connect('extension-state-changed', sync);
                sync();
                tiles.add_child(button);
            }
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const hide = this._switch('Ocultar por enquanto', false,
                (_item, value) => manager.setTemporaryHidden(value));
            menu.addMenuItem(hide);
            const fixed = this._switch('Manter sempre visível', this._settings.get_boolean('dock-fixed'),
                (_item, value) => {
                    this._settings.set_boolean('dock-fixed', value);
                    this._settings.set_boolean('manualhide', false);
                    if (!value)
                        this._settings.set_boolean('autohide', true);
                });
            this._watch('dock-fixed', () => fixed.setToggleState(this._settings.get_boolean('dock-fixed')));
            menu.addMenuItem(fixed);
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const prefs = new PopupMenu.PopupMenuItem('Personalizar meu dock…');
            prefs.add_style_class_name('macdock-control-settings');
            prefs.connect('activate', () => extension.openPreferences());
            menu.addMenuItem(prefs);
            Main.panel.addToStatusArea('macdock-control', this._indicator);
            const syncVisibility = () => {
                const visible = this._settings.get_boolean('macdock-show-indicator');
                if (!visible)
                    menu.close();
                this._indicator.visible = visible;
                this._indicator.container.visible = visible;
            };
            this._watch('macdock-show-indicator', syncVisibility);
            syncVisibility();
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    _watch(key, callback) {
        this._signals.push(this._settings.connect(`changed::${key}`, callback));
    }

    _row() {
        const row = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        row.add_style_class_name('macdock-control-row');
        this._indicator.menu.addMenuItem(row);
        return row;
    }

    _heading(title, subtitle) {
        const box = new St.BoxLayout({vertical: true, style_class: 'macdock-control-heading'});
        box.add_child(new St.Label({text: title, style_class: 'macdock-control-title'}));
        box.add_child(new St.Label({text: subtitle, style_class: 'macdock-control-subtitle'}));
        this._row().add_child(box);
    }

    _switch(label, state, callback) {
        const item = new PopupMenu.PopupSwitchMenuItem(label, state);
        item.connect('toggled', callback);
        item.activate = () => { if (item.reactive) item.toggle(); };
        return item;
    }

    destroy() {
        if (this._externalMusicSignal) {
            Main.extensionManager.disconnect(this._externalMusicSignal);
            this._externalMusicSignal = null;
        }
        for (const id of this._signals.splice(0))
            this._settings.disconnect(id);
        const indicator = this._indicator;
        this._indicator = null;
        indicator?.destroy();
        this._settings = null;
    }
}
