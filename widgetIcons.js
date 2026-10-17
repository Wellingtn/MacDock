// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
export function systemIcon() {
    return new Gio.FileIcon({file: Gio.File.new_for_uri(import.meta.url)
        .get_parent().get_child('media/macdock-system-symbolic.svg')});
}
