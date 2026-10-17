// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {applyPreset, resetAppearance} from './appearance.js';
import {SURFACES, SURFACE_SCOPES, effectiveSurfaces} from './liquidGlass/surfaceCatalog.js';

export function addMacDockPreferences(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Visual', icon_name: 'preferences-desktop-appearance-symbolic',
    });
    page.add_css_class('macdock-appearance-page');
    let group = new Adw.PreferencesGroup({
        title: 'Visual do MacDock',
        description: 'Ajustes visuais do dock e do acabamento Liquid Glass.',
    });
    page.add(group);
    const bind = (key, widget, property) =>
        settings.bind(key, widget, property, Gio.SettingsBindFlags.DEFAULT);
    function toggle(title, key, subtitle = '') {
        const row = new Adw.ActionRow({title, subtitle});
        const control = new Gtk.Switch({valign: Gtk.Align.CENTER});
        row.add_suffix(control);
        row.activatable_widget = control;
        bind(key, control, 'active');
        group.add(row);
    }
    function number(title, key, lower, upper, step) {
        const row = new Adw.ActionRow({title});
        const control = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
            digits: step < 1 ? 2 : 0,
            valign: Gtk.Align.CENTER,
        });
        row.add_suffix(control);
        bind(key, control, 'value');
        group.add(row);
    }
    function colorEntry(title, key) {
        const row = new Adw.EntryRow({title});
        row.text = settings.get_string(key);
        row.connect('changed', () => {
            if (/^#[0-9a-f]{6}$/i.test(row.text)) {
                row.remove_css_class('error');
                if (settings.get_string(key) !== row.text)
                    settings.set_string(key, row.text);
            } else {
                row.add_css_class('error');
            }
        });
        const id = settings.connect(`changed::${key}`, () => {
            const value = settings.get_string(key);
            if (row.text !== value)
                row.text = value;
        });
        window.connect('close-request', () => settings.disconnect(id));
        group.add(row);
    }
    toggle('Ativar aparência MacDock', 'macdock-appearance-enabled');
    const names = ['liquid', 'glass', 'classic', 'minimal', 'custom'];
    const preset = new Adw.ComboRow({
        title: 'Tema',
        model: Gtk.StringList.new([
            'Liquid Glass', 'Glass (translúcido)', 'Classic (sólido)', 'Minimal', 'Custom',
        ]),
    });
    preset.selected = Math.max(0, names.indexOf(settings.get_string('macdock-theme')));
    let syncing = false;
    preset.connect('notify::selected', () => {
        if (!syncing)
            applyPreset(settings, names[preset.selected]);
    });
    const id = settings.connect('changed::macdock-theme', () => {
        syncing = true;
        preset.selected = Math.max(0, names.indexOf(settings.get_string('macdock-theme')));
        syncing = false;
    });
    window.connect('close-request', () => settings.disconnect(id));
    group.add(preset);
    // Keep the selected renderer stable while editing or receiving another
    // process's preset updates. Custom explicitly preserves the current colors.
    colorEntry('Cor do fundo (#RRGGBB)', 'macdock-background');
    number('Opacidade — 1 é sólido', 'macdock-opacity', 0, 1, 0.05);
    number('Raio dos cantos', 'macdock-radius', 0, 64, 1);
    number('Espessura da borda', 'macdock-border-width', 0, 8, 0.5);
    colorEntry('Cor da borda (#RRGGBB)', 'macdock-border-color');
    toggle('Sombra', 'macdock-shadow');
    toggle('Gradiente vertical', 'macdock-gradient');
    colorEntry('Cor final do gradiente (#RRGGBB)', 'macdock-gradient-end');
    toggle('Blur experimental', 'macdock-blur',
        'Usa o compositor quando disponível. Pode aumentar o consumo de GPU; valide os cantos no seu tema.');
    number('Raio do blur', 'macdock-blur-radius', 0, 60, 1);
    const reset = new Gtk.Button({
        label: 'Restaurar aparência padrão', margin_top: 12, halign: Gtk.Align.START,
    });
    reset.connect('clicked', () => resetAppearance(settings));
    group.add(reset);
    group = new Adw.PreferencesGroup({
        title: 'Liquid Glass — experimental',
        description: 'Captura o fundo real do compositor. Em caso de falha, o tema Glass permanece visível.',
    });
    page.add(group);
    toggle('Ativar Liquid Glass', 'liquid-glass-enabled');
    number('Desfoque do fundo', 'liquid-glass-blur', 0, 40, 1);
    number('Refração nas bordas', 'glass-displacement-scale', 0, 24, 0.5);
    number('Opacidade do vidro', 'liquid-glass-opacity', 0, 1, 0.05);
    colorEntry('Tonalidade do vidro (#RRGGBB)', 'liquid-glass-tint');
    number('Intensidade da tonalidade', 'liquid-glass-tint-strength', 0, 1, 0.02);
    number('Intensidade da borda', 'glass-rim-intensity', 0, 1, 0.05);
    number('Intensidade dos reflexos', 'glass-specular-intensity', 0, 1, 0.05);
    toggle('Economia de GPU', 'liquid-glass-economy',
        'Usa blur em resolução reduzida e menos amostras nas bordas.');
    toggle('Diagnóstico de renderização', 'glass-debug-diagnostics',
        'Registra a primeira composição e mantém contadores de captura e pintura.');

    // ---- Abrangência: onde mais o Liquid Glass é aplicado (além do dock) ----
    group = new Adw.PreferencesGroup({
        title: 'Abrangência do Liquid Glass',
        description: 'Cada superfície extra usa seu próprio vidro e consome GPU. ' +
            'Itens marcados como indisponíveis não são aplicados por esta versão. ' +
            'Superfícies extras são experimentais e ainda dependem de validação em sessão real.',
    });
    page.add(group);
    const scopeRow = new Adw.ComboRow({
        title: 'Abrangência',
        subtitle: 'Somente dock mantém o comportamento atual.',
        model: Gtk.StringList.new(['Somente dock', 'Personalizado', 'GNOME completo']),
    });
    group.add(scopeRow);
    const surfaceRows = [];
    let syncingScope = false;
    function syncSurfaceRows() {
        syncingScope = true;
        try {
            const scope = settings.get_string('liquid-glass-scope');
            scopeRow.selected = Math.max(0, SURFACE_SCOPES.indexOf(scope));
            const selected = settings.get_strv('liquid-glass-surfaces');
            const active = effectiveSurfaces(scope, selected);
            for (const {surface, control, row} of surfaceRows) {
                control.active = surface.available && active.has(surface.id);
                row.sensitive = surface.available && scope === 'custom';
            }
        } finally {
            syncingScope = false;
        }
    }
    scopeRow.connect('notify::selected', () => {
        if (syncingScope)
            return;
        const scope = SURFACE_SCOPES[scopeRow.selected] ?? 'dock';
        if (settings.get_string('liquid-glass-scope') !== scope)
            settings.set_string('liquid-glass-scope', scope);
    });
    for (const surface of SURFACES) {
        const row = new Adw.ActionRow({
            title: surface.title,
            subtitle: surface.available ? surface.subtitle : `Indisponível — ${surface.reason}`,
        });
        const control = new Gtk.Switch({valign: Gtk.Align.CENTER});
        row.add_suffix(control);
        row.activatable_widget = control;
        control.connect('notify::active', () => {
            if (syncingScope || !surface.available)
                return;
            const current = settings.get_strv('liquid-glass-surfaces');
            if (current.includes(surface.id) === control.active)
                return;
            settings.set_strv('liquid-glass-surfaces', control.active
                ? [...current, surface.id] : current.filter(id => id !== surface.id));
        });
        group.add(row);
        surfaceRows.push({surface, control, row});
    }
    const scopeIds = ['liquid-glass-scope', 'liquid-glass-surfaces'].map(key =>
        settings.connect(`changed::${key}`, syncSurfaceRows));
    window.connect('close-request', () => scopeIds.forEach(id => settings.disconnect(id)));
    syncSurfaceRows();
    window.add(page);
}
