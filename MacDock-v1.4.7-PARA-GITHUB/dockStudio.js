import {systemIcon} from './widgetIcons.js';
// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';

export function addDockStudio(window, settings) {
    const page = new Adw.PreferencesPage({title: 'Início', icon_name: 'view-home-symbolic'});
    page.add_css_class('macdock-surface-page');
    const signals = [];
    const watch = (key, callback) => signals.push(settings.connect(`changed::${key}`, callback));
    const css = new Gtk.CssProvider();
    css.load_from_data(`
        .dock-studio-screen { background: linear-gradient(135deg, #152132, #2f425f); border-radius: 22px; }
        .dock-studio-preview { background: alpha(white,.13); border: 1px solid alpha(white,.24); border-radius: 16px; padding: 10px; }
        .dock-studio-app { color: #e4eeff; background: alpha(white,.10); border-radius: 10px; padding: 5px; }
        .dock-studio-position { color: #edf4ff; background: alpha(white,.08); border-radius: 20px; padding: 5px 12px; border: 1px solid transparent; }
        .dock-studio-position:checked { background: alpha(#4d8fff,.30); color: white; border-color: alpha(white,.18); }
        .dock-studio-position:hover { background: alpha(white,.18); }
        .dock-studio-preview.compact { padding: 6px; }
        .dock-studio-preview.compact .dock-studio-app { padding: 3px; }
        .dock-studio-widget { padding: 14px; border-radius: 14px; }
        .dock-studio-widget:checked { background: alpha(@accent_bg_color,.18); color: @accent_color; }
        .dock-studio-caption { color: #d8e5ff; font-size: 12px; }
    `, -1);    const display = Gdk.Display.get_default();
    Gtk.StyleContext.add_provider_for_display(display, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    window.connect('close-request', () => {
        for (const id of signals.splice(0))
            settings.disconnect(id);
        Gtk.StyleContext.remove_provider_for_display(display, css);
    });    const overview = new Adw.PreferencesGroup();
    page.add(overview);
    const card = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 16, css_classes: ['macdock-overview-card']});
    const logoWrap = new Gtk.Box({valign: Gtk.Align.START, css_classes: ['macdock-overview-accent']});
    const logo = Gtk.Picture.new_for_filename(`${window._macdockExtensionPath}/media/macdock-brand.svg`);
    logo.content_fit = Gtk.ContentFit.CONTAIN;
    logo.width_request = 52;
    logo.height_request = 52;
    logoWrap.append(logo);
    card.append(logoWrap);
    const textArea = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, hexpand: true});
    textArea.append(new Gtk.Label({label: 'MacDock', xalign: 0, css_classes: ['macdock-overview-title']}));
    textArea.append(new Gtk.Label({label: 'Um dock para GNOME com widgets integrados, visual refinado e fluxo simples de configuração.', xalign: 0, wrap: true, css_classes: ['macdock-overview-subtitle']}));
    const chips = new Gtk.Box({spacing: 8});
    for (const label of ['GNOME 46', 'Widgets nativos', 'Liquid Glass'])
        chips.append(new Gtk.Label({label, css_classes: ['macdock-chip']}));
    textArea.append(chips);
    textArea.append(new Gtk.Label({label: 'Ajuste rápido de posição, tamanho e widgets sem alterar a lógica do dock.', xalign: 0, wrap: true, css_classes: ['macdock-overview-caption']}));
    card.append(textArea);
    overview.add(card);

    const intro = new Adw.PreferencesGroup({title: 'Layout rápido',
        description: 'Escolha a posição do dock e ajuste o tamanho com uma prévia simples e imediata.'});
    page.add(intro);
    const screen = new Gtk.Overlay({height_request: 260, css_classes: ['dock-studio-screen']});
    const center = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8,
        valign: Gtk.Align.CENTER, halign: Gtk.Align.CENTER});
    center.append(new Gtk.Label({label: 'Seu espaço de trabalho', css_classes: ['dock-studio-caption']}));
    screen.set_child(center);
    const preview = new Gtk.Box({spacing: 6, css_classes: ['dock-studio-preview'],
        margin_top: 42, margin_bottom: 42, margin_start: 76, margin_end: 76});
    screen.add_overlay(preview);
    const positions = [];
    for (const [label, value, horizontal, vertical] of [
        ['Em cima', 0, Gtk.Align.CENTER, Gtk.Align.START],
        ['Direita', 1, Gtk.Align.END, Gtk.Align.CENTER],
        ['Embaixo', 2, Gtk.Align.CENTER, Gtk.Align.END],
        ['Esquerda', 3, Gtk.Align.START, Gtk.Align.CENTER],
    ]) {
        const button = new Gtk.ToggleButton({label, halign: horizontal, valign: vertical,
            margin_top: 8, margin_bottom: 8, margin_start: 8, margin_end: 8,
            css_classes: ['dock-studio-position'], tooltip_text: `Mover dock: ${label.toLowerCase()}`});
        button.connect('clicked', () => settings.set_enum('dock-position', value));
        screen.add_overlay(button);
        positions.push([button, value]);
    }
    intro.add(screen);
    const widgets = [
        ['weather', 'Clima', 'weather-clear-symbolic', 'Previsão e temperatura'],
        ['system', 'Sistema', 'utilities-system-monitor-symbolic', 'CPU, memória e rede'],
        ['calendar', 'Calendário', 'x-office-calendar-symbolic', 'Datas e suas anotações'],
        ['music', 'Música', 'audio-x-generic-symbolic', 'Aparece ao reproduzir mídia'],
    ];
    const refresh = () => {
        let child;
        while ((child = preview.get_first_child()))
            preview.remove(child);
        const position = settings.get_enum('dock-position');
        const vertical = position === 1 || position === 3;
        screen.height_request = vertical ? 320 : 260;
        preview[vertical ? 'add_css_class' : 'remove_css_class']('compact');
        preview.spacing = vertical ? 4 : 6;
        preview.orientation = vertical ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
        preview.halign = position === 1 ? Gtk.Align.END : position === 3 ? Gtk.Align.START : Gtk.Align.CENTER;
        preview.valign = position === 0 ? Gtk.Align.START : position === 2 ? Gtk.Align.END : Gtk.Align.CENTER;
        for (const [button, value] of positions)
            button.active = value === position;
        const size = Math.round((vertical ? 10 : 16) + Math.min(96, settings.get_int('dash-max-icon-size')) / (vertical ? 16 : 5));
        const add = (icon, tooltip) => preview.append(new Gtk.Image({...icon === 'utilities-system-monitor-symbolic' ? {gicon: systemIcon()} : {icon_name: icon}, pixel_size: size,
            tooltip_text: tooltip, css_classes: ['dock-studio-app']}));
        const enabled = settings.get_strv('macdock-widget-enabled');
        const order = [...new Set([...settings.get_strv('macdock-widget-order'), ...enabled])];
        const addWidgets = () => {
            for (const id of order) {
                const widget = widgets.find(entry => entry[0] === id);
                if (enabled.includes(id) && widget)
                    add(widget[2], widget[1]);
            }
        };
        if (settings.get_string('macdock-widget-position') === 'before')
            addWidgets();
        add('system-file-manager-symbolic', 'Arquivos');
        add('web-browser-symbolic', 'Navegador');
        add('view-app-grid-symbolic', 'Aplicativos');
        if (settings.get_string('macdock-widget-position') !== 'before')
            addWidgets();
    };
    for (const key of ['dock-position', 'dash-max-icon-size', 'macdock-widget-enabled',
        'macdock-widget-position', 'macdock-widget-order'])
        watch(key, refresh);
    refresh();
    const scaleRow = new Gtk.Box({spacing: 12, margin_top: 14, margin_bottom: 6});
    scaleRow.append(new Gtk.Label({label: 'Discreto'}));
    const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 24, 96, 2);
    scale.hexpand = true;
    scale.draw_value = false;
    scale.set_value(settings.get_int('dash-max-icon-size'));
    scale.set_tooltip_text('Arraste para ajustar o tamanho; a prévia acompanha sua escolha');
    for (const value of [32, 48, 64, 96])
        scale.add_mark(value, Gtk.PositionType.BOTTOM, null);
    let syncing = false;
    scale.connect('value-changed', () => {
        if (!syncing)
            settings.set_int('dash-max-icon-size', Math.round(scale.get_value()));
    });
    watch('dash-max-icon-size', () => {
        syncing = true;
        scale.set_value(settings.get_int('dash-max-icon-size'));
        syncing = false;
    });
    scaleRow.append(scale);
    scaleRow.append(new Gtk.Label({label: 'Destacado'}));
    intro.add(scaleRow);
    intro.add(new Gtk.Label({label: 'Prévia ilustrativa. O tamanho final se adapta ao espaço disponível.',
        wrap: true, css_classes: ['dim-label', 'caption'], margin_bottom: 6}));

    const behavior = new Adw.PreferencesGroup({title: 'Quando o dock aparece'});
    page.add(behavior);
    const mode = new Adw.ComboRow({title: 'Visibilidade',
        model: Gtk.StringList.new(['Sempre visível', 'Ocultar automaticamente', 'Desviar das janelas'])});
    let syncingMode = false;
    const syncMode = () => {
        syncingMode = true;
        mode.selected = settings.get_boolean('dock-fixed') ? 0 : settings.get_boolean('intellihide') ? 2 : 1;
        mode.subtitle = settings.get_boolean('manualhide') ? 'Ocultação manual ativa; escolha um modo para reexibir.' :
            ['Disponível o tempo todo.', 'Leve o ponteiro à borda para revelar.', 'Recolhe quando uma janela ocupa o espaço.'][mode.selected];
        syncingMode = false;
    };
    mode.connect('notify::selected', () => {
        if (syncingMode)
            return;
        const selected = mode.selected;
        // Keep listeners from observing an intermediate mode as a user edit.
        syncingMode = true;
        settings.set_boolean('manualhide', false);
        settings.set_boolean('dock-fixed', selected === 0);
        settings.set_boolean('intellihide', selected === 2);
        settings.set_boolean('autohide', selected !== 0);
        syncingMode = false;
        syncMode();
    });
    for (const key of ['dock-fixed', 'intellihide', 'manualhide'])
        watch(key, () => { if (!syncingMode) syncMode(); });
    syncMode();
    behavior.add(mode);
    for (const [title, subtitle, key] of [
        ['Favoritos', 'Seus aplicativos fixados sempre à mão', 'show-favorites'],
        ['Aplicativos abertos', 'Acompanhe o que está em execução', 'show-running'],
        ['Atalho na barra superior', 'Abra os ajustes rápidos sem sair da sua tarefa', 'macdock-show-indicator'],
    ]) {
        const row = new Adw.ActionRow({title, subtitle});
        const control = new Gtk.Switch({valign: Gtk.Align.CENTER});
        settings.bind(key, control, 'active', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(control);
        row.activatable_widget = control;
        behavior.add(row);
    }
    const group = new Adw.PreferencesGroup({title: 'O que você quer acompanhar?',
        description: 'Clique nos cartões para ativar ou desativar. Na aba Widgets, ajuste ordem e conteúdo.'});
    page.add(group);
    const grid = new Gtk.Grid({column_spacing: 10, row_spacing: 10, column_homogeneous: true});
    widgets.forEach(([id, title, icon, detail], index) => {
        const content = new Gtk.Box({spacing: 12});
        content.append(new Gtk.Image({...id === 'system' ? {gicon: systemIcon()} : {icon_name: icon}, pixel_size: 28}));
        const text = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 3, hexpand: true});
        text.append(new Gtk.Label({label: title, xalign: 0, css_classes: ['heading']}));
        text.append(new Gtk.Label({label: detail, xalign: 0, wrap: true, css_classes: ['caption']}));
        content.append(text);
        const button = new Gtk.ToggleButton({child: content, css_classes: ['dock-studio-widget']});
        const sync = () => { button.active = settings.get_strv('macdock-widget-enabled').includes(id); };
        sync();
        button.connect('clicked', () => {
            const enabled = settings.get_strv('macdock-widget-enabled');
            settings.set_strv('macdock-widget-enabled', button.active
                ? [...new Set([...enabled, id])] : enabled.filter(name => name !== id));
        });
        watch('macdock-widget-enabled', sync);
        grid.attach(button, index % 2, Math.floor(index / 2), 1, 1);
    });
    group.add(grid);
    window.add(page);
    return page;
}
