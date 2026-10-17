// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export async function loadFile(file, cancellable, limit = 1024 * 1024) {
    const info = await new Promise((resolve, reject) => file.query_info_async(
        'standard::size', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT,
        cancellable, (source, result) => {
            try {
                resolve(source.query_info_finish(result));
            } catch (error) {
                reject(error);
            }
        }));
    if (info.get_size() > limit)
        throw new Error('Arquivo excede o limite de tamanho');
    return new Promise((resolve, reject) => file.load_contents_async(cancellable, (source, result) => {
        try {
            const [ok, bytes] = source.load_contents_finish(result);
            if (!ok || bytes.length > limit)
                throw new Error('Arquivo inválido ou grande demais');
            resolve(bytes);
        } catch (error) {
            reject(error);
        }
    }));
}

export function readText(path, cancellable) {
    return loadFile(Gio.File.new_for_path(path), cancellable).then(bytes => new TextDecoder().decode(bytes));
}

export function writeJSON(file, data, cancellable = null) {
    const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
    return new Promise((resolve, reject) => file.replace_contents_async(bytes, null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION,
        cancellable, (source, result) => {
            try {
                source.replace_contents_finish(result);
                resolve();
            } catch (error) {
                reject(error);
            }
        }));
}

export async function requestBytes(session, message, cancellable, limit) {
    const stream = await new Promise((resolve, reject) => session.send_async(message,
        GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
            try {
                resolve(source.send_finish(result));
            } catch (error) {
                reject(error);
            }
        }));
    try {
        if (message.status_code < 200 || message.status_code >= 300)
            throw new Error(`HTTP ${message.status_code}`);
        const chunks = [];
        let size = 0;
        while (true) {
            // Sequential reads preserve stream ordering.
            // eslint-disable-next-line no-await-in-loop
            const bytes = await new Promise((resolve, reject) => stream.read_bytes_async(32768,
                GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
                    try {
                        resolve(source.read_bytes_finish(result).get_data());
                    } catch (error) {
                        reject(error);
                    }
                }));
            if (!bytes.length)
                break;
            size += bytes.length;
            if (size > limit)
                throw new Error('Resposta excede o limite de tamanho');
            chunks.push(bytes);
        }
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    } finally {
        await new Promise(resolve => stream.close_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
            try {
                source.close_finish(result);
            } catch {
                // Nothing else owns this stream, even if the transport disappeared.
            }
            resolve();
        }));
    }
}
