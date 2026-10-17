import {systemIcon} from './widgetIcons.js';
// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {makeMenu, menuLabel} from './widgetSupport.js';
import {readText} from './dataIO.js';
import {cpuCounters, cpuUsage, memoryUsage, networkCounters} from './systemMetrics.js';

const TRACK_WIDTH = 64;

// Faixa de métrica: nome · barra fina · valor. Cor por limiar (verde/amarelo/vermelho).
function makeMetric(scope, name) {
    const row = new St.BoxLayout({style_class: 'macdock-metric', y_align: Clutter.ActorAlign.CENTER});
    row.add_child(new St.Label({text: name, style_class: 'macdock-metric-name',
        y_align: Clutter.ActorAlign.CENTER}));
    const track = new St.Widget({style_class: 'macdock-metric-track', width: TRACK_WIDTH, height: 4,
        layout_manager: new Clutter.FixedLayout(), y_align: Clutter.ActorAlign.CENTER});
    const fill = new St.Widget({style_class: 'macdock-metric-fill', x: 0, y: 0, width: 0, height: 4});
    track.add_child(fill);
    row.add_child(track);
    const value = new St.Label({text: '—', style_class: 'macdock-metric-value',
        x_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
    row.add_child(value);
    let fraction = 0;
    const redraw = () => {
        fill.width = Math.round(track.width * fraction);
        fill.height = track.height;
    };
    scope.connect(track, 'notify::width', redraw);
    scope.connect(track, 'notify::height', redraw);
    return {
        row,
        set(percent) {
            if (percent === null || !Number.isFinite(percent)) {
                value.text = '—';
                fraction = 0;
                redraw();
                return;
            }
            const clamped = Math.max(0, Math.min(100, percent));
            value.text = `${clamped.toFixed(0)}%`;
            fraction = clamped / 100;
            redraw();
            if (clamped >= 85) {
                fill.remove_style_class_name('warn');
                fill.add_style_class_name('crit');
            } else if (clamped >= 60) {
                fill.remove_style_class_name('crit');
                fill.add_style_class_name('warn');
            } else {
                fill.remove_style_class_name('warn');
                fill.remove_style_class_name('crit');
            }
        },
    };
}

function makeSystemCard(scope) {
    const actor = scope.actor(new St.Button({
        style_class: 'macdock-widget macdock-system-card', can_focus: true, reactive: true, track_hover: true,
        accessible_name: 'Sistema: aguardando amostra',
    }));
    const row = new St.BoxLayout({style_class: 'macdock-widget-row', x_expand: true, y_expand: true});
    const tile = new St.Bin({style_class: 'macdock-widget-icon-tile', y_align: Clutter.ActorAlign.CENTER,
        child: new St.Icon({gicon: systemIcon(), icon_size: 19,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER})});
    row.add_child(tile);
    const rows = new St.BoxLayout({vertical: true, style_class: 'macdock-system-rows',
        x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    const cpu = makeMetric(scope, 'CPU');
    const ram = makeMetric(scope, 'RAM');
    rows.add_child(cpu.row);
    rows.add_child(ram.row);
    row.add_child(rows);
    actor.set_child(row);
    return {actor, cpu, ram, size: {width: 200, height: 48}};
}

export function createSystemWidget({scope}) {
    const card = makeSystemCard(scope);
    const menu = makeMenu(scope, card.actor);
    menu.actor.add_style_class_name('macdock-system-popup');
    menuLabel(menu, 'Atividade do sistema').add_style_class_name('macdock-system-heading');
    const status = menuLabel(menu, 'Preparando a primeira leitura…');
    status.add_style_class_name('macdock-system-status');
    const history = [];
    const graphRow = new PopupMenu.PopupBaseMenuItem({reactive: false});
    const graph = new St.DrawingArea({style_class: 'macdock-system-graph', x_expand: true});
    scope.connect(graph, 'repaint', () => {
        const cr = graph.get_context();
        const [width, height] = graph.get_surface_size();
        cr.setLineWidth(1);
        cr.setSourceRGBA(0.65, 0.75, 0.9, 0.15);
        for (const level of [0.25, 0.5, 0.75]) {
            cr.moveTo(0, height * level);
            cr.lineTo(width, height * level);
        }
        cr.stroke();
        if (history.length > 1) {
            for (const [key, color] of [['cpu', [0.4, 0.78, 1]], ['ram', [0.67, 0.57, 1]]]) {
                cr.setSourceRGBA(...color, 1);
                cr.setLineWidth(2);
                history.forEach((sample, index) => {
                    const x = width * index / 59;
                    const y = 3 + (height - 6) * (1 - sample[key] / 100);
                    if (index === 0) cr.moveTo(x, y);
                    else cr.lineTo(x, y);
                });
                cr.stroke();
            }
        }
        cr.$dispose();
    });
    graphRow.add_child(graph);
    menu.addMenuItem(graphRow);
    menuLabel(menu, 'CPU · azul    RAM · violeta    Últimas 60 amostras · intervalo de 2 s')
        .add_style_class_name('macdock-system-legend');
    const cpuLabel = menuLabel(menu, 'CPU: aguardando amostra');
    const memoryLabel = menuLabel(menu, 'RAM: aguardando amostra');
    const diskLabel = menuLabel(menu, 'Armazenamento: indisponível');
    const netLabel = menuLabel(menu, 'Rede: aguardando amostra');
    const tempLabel = menuLabel(menu, 'Temperatura: não disponível');
    let previous = null;
    let previousNet = null;
    let previousTime = 0;
    let busy = false;
    let lastSlowUpdate = -Infinity;
    const gib = value => `${(value / 1024 ** 3).toFixed(1)} GiB`;
    const update = async () => {
        if (!scope.alive || busy)
            return;
        busy = true;
        try {
            const [cpuText, memText, netText] = await Promise.all([
                readText('/proc/stat', scope.cancellable),
                readText('/proc/meminfo', scope.cancellable),
                readText('/proc/net/dev', scope.cancellable),
            ]);
            if (!scope.alive)
                return;
            const now = GLib.get_monotonic_time() / 1000000;
            const current = cpuCounters(cpuText);
            const cpu = cpuUsage(previous, current);
            const ram = memoryUsage(memText);
            const net = networkCounters(netText);
            if (cpu !== null) {
                history.push({cpu, ram: ram.percent});
                if (history.length > 60) history.shift();
                graph.queue_repaint();
            }
            status.text = cpu === null ? 'Coletando a primeira amostra…' :
                cpu >= 85 ? 'CPU com uso elevado' : ram.percent >= 85 ? 'Memória com uso elevado' : 'Sistema em atividade';
            card.cpu.set(cpu);
            card.ram.set(ram.percent);
            card.actor.accessible_name = `Sistema: CPU ${cpu === null ? 'aguardando amostra' : `${cpu.toFixed(0)}%`}, ` +
                `RAM ${ram.percent.toFixed(0)}%`;
            cpuLabel.text = `CPU: ${cpu === null ? 'aguardando amostra' : `${cpu.toFixed(1)}%`}`;
            memoryLabel.text = `RAM: ${gib(ram.used)} / ${gib(ram.total)}`;
            if (previousNet && now > previousTime) {
                const seconds = now - previousTime;
                const rx = Math.max(0, net.received - previousNet.received) / seconds / 1024;
                const tx = Math.max(0, net.sent - previousNet.sent) / seconds / 1024;
                netLabel.text = `Rede: ↓ ${rx.toFixed(1)} KiB/s · ↑ ${tx.toFixed(1)} KiB/s`;
            }
            previous = current;
            previousNet = net;
            previousTime = now;
            if (now - lastSlowUpdate < 15)
                return;
            lastSlowUpdate = now;
            Gio.File.new_for_path('/').query_filesystem_info_async('filesystem::size,filesystem::free',
                GLib.PRIORITY_LOW, scope.cancellable, (file, result) => {
                    try {
                        const info = file.query_filesystem_info_finish(result);
                        if (scope.alive)
                            diskLabel.text = `Disco /: ${gib(info.get_attribute_uint64('filesystem::free'))} livres de ${gib(info.get_attribute_uint64('filesystem::size'))}`;
                    } catch {
                        // Missing filesystem metrics do not prevent CPU/RAM updates.
                    }
                });
            const temperatures = [];
            for (let zone = 0; zone < 16; zone++) {
                try {
                    const path = `/sys/class/thermal/thermal_zone${zone}/temp`;
                    // Sequential sensor reads bound the I/O workload.
                    // eslint-disable-next-line no-await-in-loop
                    const value = Number(await readText(path, scope.cancellable));
                    if (Number.isFinite(value) && value > -50000 && value < 200000)
                        temperatures.push(value / 1000);
                } catch {
                    // Thermal zones are optional; no GPU/sensor availability is assumed.
                }
                if (!scope.alive)
                    return;
            }
            tempLabel.text = temperatures.length
                ? `Zonas térmicas: ${temperatures.map(t => `${t.toFixed(0)} °C`).join(' · ')}`
                : 'Temperatura: não disponível';
        } catch (error) {
            if (scope.alive) {
                card.cpu.set(null);
                card.ram.set(null);
                card.actor.accessible_name = 'Sistema: métricas indisponíveis';
                console.warn(`MacDock System: ${error.message}`);
            }
        } finally {
            busy = false;
        }
    };
    scope.every(2, () => {
        if (card.actor.mapped || menu.isOpen)
            update();
    });
    update();
    return card;
}
