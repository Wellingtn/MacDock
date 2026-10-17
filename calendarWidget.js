// SPDX-License-Identifier: GPL-2.0-or-later
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {makeMenu, menuLabel} from './widgetSupport.js';
import {dateKey} from './notesModel.js';
import {getNotesStore} from './notesStore.js';

const capitalize = text => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);

// Cartão 240x60: bloco de data (dia da semana + número) e data/hora por extenso.
function makeCalendarCard(scope) {
    const actor = scope.actor(new St.Button({
        style_class: 'macdock-widget macdock-calendar-card', can_focus: true, reactive: true, track_hover: true,
        accessible_name: 'Calendário',
    }));
    const row = new St.BoxLayout({style_class: 'macdock-widget-row', x_expand: true, y_expand: true});
    const tile = new St.BoxLayout({vertical: true, style_class: 'macdock-date-tile',
        y_align: Clutter.ActorAlign.CENTER});
    const weekday = new St.Label({text: '', style_class: 'macdock-date-tile-weekday',
        x_align: Clutter.ActorAlign.FILL});
    const day = new St.Label({text: '', style_class: 'macdock-date-tile-day',
        x_align: Clutter.ActorAlign.FILL});
    tile.add_child(weekday);
    tile.add_child(day);
    row.add_child(tile);
    const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    const main = new St.Label({text: '', style_class: 'macdock-date-main'});
    const sub = new St.Label({text: '', style_class: 'macdock-date-sub'});
    text.add_child(main);
    text.add_child(sub);
    row.add_child(text);
    actor.set_child(row);
    return {actor, weekday, day, main, sub, size: {width: 176, height: 48}};
}

export function createCalendarWidget({scope}) {
    const card = makeCalendarCard(scope);
    const menu = makeMenu(scope, card.actor);
    menu.actor.add_style_class_name('macdock-calendar-popup');
    const header = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const headerRow = new St.BoxLayout({style_class: 'macdock-calendar-header', x_expand: true});
    const monthLabel = new St.Label({text: 'Calendário', style_class: 'macdock-calendar-month',
        x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    headerRow.add_child(monthLabel);
    header.add_child(headerRow);
    menu.addMenuItem(header);
    const gridItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
    const grid = new St.BoxLayout({vertical: true, style_class: 'macdock-calendar-grid'});
    gridItem.add_child(grid);
    menu.addMenuItem(gridItem);
    const noteDate = menuLabel(menu, '');
    noteDate.add_style_class_name('macdock-calendar-date-label');
    const editorRow = new PopupMenu.PopupBaseMenuItem({reactive: false});
    const entry = new St.Entry({
        hint_text: 'Anotação da data selecionada', can_focus: true,
        style_class: 'macdock-calendar-note', x_expand: true,
    });
    editorRow.add_child(entry);
    menu.addMenuItem(editorRow);
    const feedback = menuLabel(menu, 'Notas salvas somente neste computador');
    feedback.add_style_class_name('macdock-calendar-feedback');
    const store = getNotesStore();
    let selected = dateKey(new Date());
    let month = new Date();
    month.setDate(1);
    let ready = false;
    function select(date) {
        selected = date;
        noteDate.text = date;
        entry.set_text(store.data.notes[date] ?? '');
    }
    function draw() {
        if (!scope.alive)
            return;
        grid.destroy_all_children();
        monthLabel.text = capitalize(month.toLocaleDateString('pt-BR', {month: 'long', year: 'numeric'}));
        const todayKey = dateKey(new Date());
        const weekdays = new St.BoxLayout({style_class: 'macdock-calendar-week'});
        for (const name of ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'])
            weekdays.add_child(new St.Label({text: name, style_class: 'macdock-calendar-weekday',
                x_expand: true}));
        grid.add_child(weekdays);
        const first = month.getDay();
        const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
        let row;
        for (let cell = 0; cell < Math.ceil((first + last) / 7) * 7; cell++) {
            if (cell % 7 === 0) {
                row = new St.BoxLayout({style_class: 'macdock-calendar-week'});
                grid.add_child(row);
            }
            const day = cell - first + 1;
            const valid = day > 0 && day <= last;
            const key = dateKey(new Date(month.getFullYear(), month.getMonth(), day));
            const button = new St.Button({
                reactive: valid, can_focus: valid, x_expand: true,
                style_class: valid ? 'macdock-calendar-day' : 'macdock-calendar-day outside',
            });
            const content = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER});
            content.add_child(new St.Label({text: valid ? String(day) : ' ',
                x_align: Clutter.ActorAlign.CENTER}));
            // Marcador de nota separado do número: a largura da célula não varia.
            const dot = new St.Widget({style_class: 'macdock-calendar-note-dot',
                x_align: Clutter.ActorAlign.CENTER, opacity: valid && store.data.notes[key] ? 255 : 0});
            content.add_child(dot);
            button.set_child(content);
            if (valid && key === todayKey)
                button.add_style_class_name('today');
            if (key === selected && valid) {
                button.add_style_class_name('selected');
                dot.add_style_class_name('selected');
            }
            button.connect('clicked', () => {
                select(key);
                draw();
            });
            row.add_child(button);
        }
    }
    function moveMonth(delta) {
        if (delta) {
            month.setMonth(month.getMonth() + delta);
        } else {
            month = new Date();
            month.setDate(1);
            select(dateKey(new Date()));
        }
        draw();
    }
    for (const [label, delta, name] of [['‹', -1, 'Mês anterior'], ['Hoje', 0, 'Ir para hoje'],
        ['›', 1, 'Próximo mês']]) {
        const button = new St.Button({label, can_focus: true, accessible_name: name,
            style_class: 'macdock-calendar-nav'});
        button.connect('clicked', () => moveMonth(delta));
        headerRow.add_child(button);
    }
    const save = menu.addAction('Salvar anotação', async () => {
        if (!ready)
            return;
        const date = selected;
        try {
            await store.save(date, entry.get_text());
            if (scope.alive)
                feedback.text = `Salvo: ${date}`;
        } catch (error) {
            if (scope.alive)
                feedback.text = error.message;
        }
    });
    const remove = menu.addAction('Excluir anotação', async () => {
        if (!ready)
            return;
        const date = selected;
        try {
            await store.save(date, '');
            if (scope.alive && selected === date)
                entry.set_text('');
        } catch (error) {
            if (scope.alive)
                feedback.text = error.message;
        }
    });
    save.setSensitive(false);
    remove.setSensitive(false);
    const monitor = store.file.monitor_file(Gio.FileMonitorFlags.NONE, scope.cancellable);
    scope.own(() => monitor.cancel());
    scope.connect(monitor, 'changed', () => {
        store.reload().catch(error => {
            if (scope.alive)
                feedback.text = error.message;
        });
    });
    store.reload().then(() => {
        if (!scope.alive)
            return;
        ready = true;
        save.setSensitive(true);
        remove.setSensitive(true);
        select(selected);
        draw();
    }).catch(error => {
        if (scope.alive)
            feedback.text = error.message;
    });
    store.listeners.add(draw);
    scope.own(() => store.listeners.delete(draw));
    let shownDay = dateKey(new Date());
    const tick = () => {
        const now = new Date();
        card.weekday.text = now.toLocaleDateString('pt-BR', {weekday: 'short'})
            .replace('.', '').toLocaleUpperCase('pt-BR');
        card.day.text = String(now.getDate());
        card.main.text = capitalize(now.toLocaleDateString('pt-BR', {day: 'numeric', month: 'long'}));
        card.sub.text = now.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
        card.actor.accessible_name = `Calendário: ${now.toLocaleDateString('pt-BR',
            {weekday: 'long', day: 'numeric', month: 'long'})}, ${card.sub.text}`;
        // Virada de data: destaca o novo "hoje" na grade sem esperar interação.
        const key = dateKey(now);
        if (key !== shownDay) {
            shownDay = key;
            draw();
        }
    };
    scope.every(15, tick);
    tick();
    draw();
    return card;
}
