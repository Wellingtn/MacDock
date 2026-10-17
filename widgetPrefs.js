// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {loadFile, readText, writeJSON} from './dataIO.js';
import {validateNotes} from './notesModel.js';

export function addWidgetPreferences(window, settings) {
    const page = new Adw.PreferencesPage({title: 'Widgets', icon_name: 'view-grid-symbolic'});
    page.add_css_class('macdock-widgets-page');
    const group = new Adw.PreferencesGroup({
        title: 'Organize seu dock',
        description: 'Ative, desative e reordene os widgets que aparecem no dock.',
    });
    page.add(group);
    const ids = ['music', 'weather', 'system', 'calendar'];
    const labels = ['Música', 'Clima', 'Sistema', 'Calendário'];
    const connections = [];
    ids.forEach((id, index) => {
        const row = new Adw.ActionRow({title: labels[index]});
        if (id === 'music')
            row.subtitle = 'Não duplica o Dock Music v16 quando ele estiver ativo.';
        const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
        toggle.active = settings.get_strv('macdock-widget-enabled').includes(id);
        toggle.connect('notify::active', () => {
            const enabled = settings.get_strv('macdock-widget-enabled');
            if (enabled.includes(id) === toggle.active)
                return;
            settings.set_strv('macdock-widget-enabled', toggle.active
                ? [...enabled, id] : enabled.filter(name => name !== id));
        });
        connections.push(settings.connect('changed::macdock-widget-enabled', () => {
            toggle.active = settings.get_strv('macdock-widget-enabled').includes(id);
        }));
        row.add_suffix(toggle);
        row.activatable_widget = toggle;
        for (const direction of [-1, 1]) {
        const up = new Gtk.Button({
            icon_name: direction === -1 ? 'go-up-symbolic' : 'go-down-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: direction === -1 ? 'Mover para antes' : 'Mover para depois',
        });
        up.connect('clicked', () => {
            const order = [...new Set([...settings.get_strv('macdock-widget-order'), ...ids])];
            const position = order.indexOf(id);
            const target = position + direction;
            if (target >= 0 && target < order.length) {
                [order[target], order[position]] = [order[position], order[target]];
                settings.set_strv('macdock-widget-order', order);
            }
        });
        row.add_suffix(up);
        const syncMove = () => {
            const order = [...new Set([...settings.get_strv('macdock-widget-order'), ...ids])];
            const target = order.indexOf(id) + direction;
            up.sensitive = target >= 0 && target < order.length;
        };
        connections.push(settings.connect('changed::macdock-widget-order', syncMove));
        syncMove();
        }
        group.add(row);
    });
    const order = new Adw.ActionRow({title: 'Ordem atual'});
    const syncOrder = () => {
        order.subtitle = settings.get_strv('macdock-widget-order').map(id => labels[ids.indexOf(id)] ?? id).join(' → ');
    };
    syncOrder();
    connections.push(settings.connect('changed::macdock-widget-order', syncOrder));
    group.add(order);
    const position = new Adw.ComboRow({
        title: 'Posição', model: Gtk.StringList.new(['Antes dos apps', 'Após os apps']),
    });
    position.selected = settings.get_string('macdock-widget-position') === 'before' ? 0 : 1;
    position.connect('notify::selected', () => settings.set_string('macdock-widget-position',
        position.selected === 0 ? 'before' : 'after'));
    connections.push(settings.connect('changed::macdock-widget-position', () => {
        position.selected = settings.get_string('macdock-widget-position') === 'before' ? 0 : 1;
    }));
    group.add(position);
    const weather = new Adw.PreferencesGroup({
        title: 'Localização do clima',
        description: 'Configure a localização exibida no widget de clima.',
    });
    page.add(weather);
    for (const [key, title, lower, upper] of [
        ['latitude', 'Latitude', -90, 90], ['longitude', 'Longitude', -180, 180],
    ]) {
        const row = new Adw.ActionRow({title});
        const control = new Gtk.SpinButton({
            digits: 4, valign: Gtk.Align.CENTER,
            adjustment: new Gtk.Adjustment({lower, upper, step_increment: 0.01}),
        });
        settings.bind(`macdock-weather-${key}`, control, 'value', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(control);
        weather.add(row);
    }
    const placeRow = new Adw.EntryRow({title: 'Nome do local exibido'});
    settings.bind('macdock-weather-place', placeRow, 'text', Gio.SettingsBindFlags.DEFAULT);
    weather.add(placeRow);
    const configured = new Adw.ActionRow({title: 'Usar esta localização'});
    const enable = new Gtk.Switch({valign: Gtk.Align.CENTER});
    settings.bind('macdock-weather-configured', enable, 'active', Gio.SettingsBindFlags.DEFAULT);
    configured.add_suffix(enable);
    configured.activatable_widget = enable;
    weather.add(configured);
    const units = new Adw.ComboRow({
        title: 'Temperatura', model: Gtk.StringList.new(['Celsius', 'Fahrenheit']),
    });
    units.selected = settings.get_string('macdock-weather-unit') === 'fahrenheit' ? 1 : 0;
    units.connect('notify::selected', () => settings.set_string('macdock-weather-unit',
        units.selected === 1 ? 'fahrenheit' : 'celsius'));
    weather.add(units);
    const notes = new Adw.PreferencesGroup({
        title: 'Anotações do calendário',
        description: 'JSON versionado. Importar combina os dados e preserva notas ' +
            'existentes em datas repetidas.',
    });
    const status = new Adw.ActionRow({
        title: 'Notas locais', subtitle: 'Importação/exportação não usa a internet.',
    });
    notes.add(status);
    page.add(notes);
    const directory = GLib.build_filenamev([GLib.get_user_data_dir(), 'macdock-glass-test']);
    GLib.mkdir_with_parents(directory, 0o700);
    const file = Gio.File.new_for_path(`${directory}/calendar-notes.json`);
    const cancellable = new Gio.Cancellable();
    const dialogs = new Set();
    let closed = false;
    const currentNotes = async () => {
        try {
            return validateNotes(JSON.parse(await readText(file.get_path(), cancellable)));
        } catch (error) {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return {version: 1, notes: {}};
            throw error;
        }
    };
    const addNotesButton = exporting => {
        const button = new Gtk.Button({
            label: exporting ? 'Exportar notas…' : 'Importar notas…', margin_top: 8,
        });
        button.connect('clicked', () => {
            const chooser = new Gtk.FileChooserNative({
                title: button.label, transient_for: window,
                action: exporting ? Gtk.FileChooserAction.SAVE : Gtk.FileChooserAction.OPEN,
                accept_label: exporting ? 'Exportar' : 'Importar', cancel_label: 'Cancelar',
            });
            dialogs.add(chooser);
            if (exporting)
                chooser.set_current_name('macdock-notes.json');
            chooser.connect('response', async (_dialog, response) => {
                const chosen = chooser.get_file();
                chooser.destroy();
                dialogs.delete(chooser);
                if (response !== Gtk.ResponseType.ACCEPT || !chosen || closed)
                    return;
                try {
                    const current = await currentNotes();
                    if (exporting) {
                        await writeJSON(chosen, current, cancellable);
                    } else {
                        const bytes = await loadFile(chosen, cancellable);
                        const imported = validateNotes(JSON.parse(new TextDecoder().decode(bytes)));
                        const merged = validateNotes({
                            version: 1, notes: {...imported.notes, ...current.notes},
                        });
                        await writeJSON(file, merged, cancellable);
                    }
                    if (!closed)
                        status.subtitle = exporting ? 'Exportação concluída.' : 'Importação concluída.';
                } catch (error) {
                    if (!closed)
                        status.subtitle = error.message;
                }
            });
            chooser.show();
        });
        notes.add(button);
    };
    for (const exporting of [true, false])
        addNotesButton(exporting);
    window.connect('close-request', () => {
        closed = true;
        cancellable.cancel();
        for (const dialog of dialogs)
            dialog.destroy();
        dialogs.clear();
        for (const id of connections)
            settings.disconnect(id);
        connections.length = 0;
    });
    window.add(page);
}
