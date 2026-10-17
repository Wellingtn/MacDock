// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {readText, writeJSON} from './dataIO.js';
import {validateNotes} from './notesModel.js';

let shared = null;
export function getNotesStore() {
    shared ??= new NotesStore();
    return shared;
}
export class NotesStore {
    constructor() {
        const directory = GLib.build_filenamev([GLib.get_user_data_dir(), 'macdock-glass-test']);
        GLib.mkdir_with_parents(directory, 0o700);
        this.file = Gio.File.new_for_path(`${directory}/calendar-notes.json`);
        this.data = {version: 1, notes: {}};
        this.listeners = new Set();
        this._queue = Promise.resolve();
        this.ready = this._load();
    }

    async _load() {
        try {
            this.data = validateNotes(JSON.parse(await readText(this.file.get_path(), null)));
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                throw new Error(`Não foi possível ler notas; arquivo preservado: ${error.message}`);
        }
        return this.data;
    }

    reload() {
        this.ready = this._queue.catch(() => {}).then(() => this._load()).then(() => {
            for (const callback of this.listeners)
                callback();
            return this.data;
        });
        return this.ready;
    }

    async save(date, text) {
        await this.ready;
        const operation = this._queue.catch(() => {}).then(async () => {
            const notes = {...this.data.notes};
            if (text.trim())
                notes[date] = text;
            else
                delete notes[date];
            const next = validateNotes({version: 1, notes});
            await writeJSON(this.file, next);
            this.data = next;
            for (const callback of this.listeners)
                callback();
        });
        this._queue = operation;
        return operation;
    }
}
