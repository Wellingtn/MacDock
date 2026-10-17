// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ORIGINAL = 'org.gnome.shell.extensions.dash-to-dock';
const ORIGINAL_UUID = 'dash-to-dock@micxgx.gmail.com';
const MARKER = 'macdock-import-complete';

export function findOriginalSchema(roots = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()]) {
    const parent = Gio.SettingsSchemaSource.get_default();
    // Prefer the local installation, matching GNOME's extension search order.
    for (const root of roots) {
        const directory = GLib.build_filenamev([root, 'gnome-shell', 'extensions', ORIGINAL_UUID, 'schemas']);
        if (!GLib.file_test(`${directory}/gschemas.compiled`, GLib.FileTest.IS_REGULAR))
            continue;
        try {
            const source = Gio.SettingsSchemaSource.new_from_directory(directory, parent, false);
            const schema = source.lookup(ORIGINAL, false);
            if (schema)
                return schema;
        } catch (error) {
            console.warn(`MacDock: cannot read original schema: ${error}`);
        }
    }
    return parent?.lookup(ORIGINAL, true) ?? null;
}

// The source is read-only by contract. This function also runs in isolated GJS tests.
export function migrateSettings(original, target) {
    if (target.get_boolean(MARKER))
        return {status: 'already-complete', copied: 0};
    if (!original)
        return {status: 'source-unavailable', copied: 0};

    let copied = 0;
    let failed = false;
    for (const key of original.settings_schema.list_keys()) {
        if (key.startsWith('macdock-') || !target.settings_schema.has_key(key) || target.get_user_value(key))
            continue;
        const value = original.get_user_value(key);
        if (!value)
            continue;
        const targetKey = target.settings_schema.get_key(key);
        if (!value.is_of_type(targetKey.get_value_type()) || !targetKey.range_check(value))
            continue;
        try {
            if (target.set_value(key, value))
                copied++;
            else
                failed = true;
        } catch (error) {
            failed = true;
            console.warn(`MacDock: could not migrate ${key}: ${error}`);
        }
    }
    if (!failed && !target.set_boolean(MARKER, true))
        failed = true;
    return {status: failed ? 'incomplete' : 'complete', copied};
}

export function importOriginalSettings(extension) {
    const target = extension.getSettings('org.gnome.shell.extensions.macdock-weather-prototype');
    if (target.get_boolean(MARKER))
        return;
    const schema = findOriginalSchema();
    migrateSettings(schema ? new Gio.Settings({settings_schema: schema}) : null, target);
}
