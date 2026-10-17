// SPDX-License-Identifier: GPL-2.0-or-later
// Compact scenic weather card + forecast overlay for GNOME Shell 46.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {readText, requestBytes, writeJSON} from './dataIO.js';

export function weatherCondition(code, day) {
    if ((code >= 71 && code <= 77) || code === 85 || code === 86)
        return {text: 'Neve', scene: 'snow', icon: 'weather-snow-symbolic'};
    if (code >= 95)
        return {text: 'Tempestade', scene: 'rain', icon: 'weather-storm-symbolic'};
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
        return {text: 'Chuva', scene: 'rain', icon: 'weather-showers-symbolic'};
    if (code >= 45 && code <= 48)
        return {text: 'Neblina', scene: 'cloud', icon: 'weather-fog-symbolic'};
    if (code >= 1 && code <= 3)
        return {text: code === 3 ? 'Nublado' : 'Parcialmente nublado', scene: 'cloud',
            icon: day ? 'weather-few-clouds-symbolic' : 'weather-few-clouds-night-symbolic'};
    if (!day)
        return {text: 'Noite limpa', scene: 'night', icon: 'weather-clear-night-symbolic'};
    return {text: 'Ensolarado', scene: 'sun', icon: 'weather-clear-symbolic'};
}

function text(value, styleClass, options = {}) {
    return new St.Label({text: String(value), style_class: styleClass, ...options});
}

function forecastTile(heading, temperature, code, day = true, low = null) {
    // x_expand: as linhas horária (5) e diária (7) ocupam a mesma largura do popup.
    const tile = new St.BoxLayout({vertical: true, style_class: 'macdock-forecast-tile',
        x_expand: true, x_align: Clutter.ActorAlign.FILL});
    tile.add_child(text(heading, 'macdock-forecast-time', {x_align: Clutter.ActorAlign.CENTER}));
    const condition = weatherCondition(code ?? 0, day);
    tile.add_child(new St.Icon({icon_name: condition.icon, icon_size: 27,
        style_class: 'macdock-forecast-icon', x_align: Clutter.ActorAlign.CENTER}));
    tile.add_child(text(`${Math.round(temperature ?? 0)}°`, 'macdock-forecast-high',
        {x_align: Clutter.ActorAlign.CENTER}));
    if (low !== null)
        tile.add_child(text(`${Math.round(low)}°`, 'macdock-forecast-low',
            {x_align: Clutter.ActorAlign.CENTER}));
    return tile;
}

export function createWeatherWidget({scope, settings, extension}) {
    const place = settings.get_string('macdock-weather-place').trim() || 'Clima';
    // Tamanho final definido pelo WidgetManager (base 208x48, escalado ao ícone do dock).
    const button = scope.actor(new St.Button({style_class: 'macdock-weather-card',
        can_focus: true, reactive: true, track_hover: true,
        accessible_name: 'Clima: abrir previsão'}));
    // Content is a direct child. The photo is painted by the button itself,
    // so it cannot be inset by a second Bin, padding or actor allocation.
    const row = new St.BoxLayout({style_class: 'macdock-weather-card-row',
        x_expand: true, y_expand: true,
        x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.FILL});
    const descriptionBox = new St.BoxLayout({vertical: true, x_expand: true,
        y_align: Clutter.ActorAlign.CENTER, style_class: 'macdock-weather-description'});
    const conditionLabel = text('Clima', 'macdock-weather-condition');
    const cityLabel = text(place, 'macdock-weather-city');
    descriptionBox.add_child(conditionLabel);
    descriptionBox.add_child(cityLabel);
    const temperatureLabel = text('--°', 'macdock-weather-temperature',
        {y_align: Clutter.ActorAlign.CENTER});
    row.add_child(descriptionBox);
    row.add_child(temperatureLabel);
    button.set_child(row);

    // Single GNOME-native popup: translucent dark glass, structured sections.
    const menu = new PopupMenu.PopupMenu(button, 0.5, scope.menuSide ?? St.Side.TOP);
    Main.uiGroup.add_child(menu.actor);
    menu.actor.hide();
    menu.actor.add_style_class_name('macdock-weather-popup');
    const menuManager = new PopupMenu.PopupMenuManager(button);
    menuManager.addMenu(menu);
    scope.connect(button, 'clicked', () => menu.toggle());
    scope.connect(menu, 'open-state-changed', (_menu, opened) => scope.menuState?.(opened));
    scope.own(() => {
        // Flush an open popup's pending allocation before disposal. GNOME 46
        // may otherwise revisit its queued BoxPointer during the next layout.
        if (menu.isOpen)
            menu.actor.get_allocation_box();
        // Release the modal grab while the menu and source are still alive.
        menu.close(0);
        menu.actor.remove_all_transitions();
        menu.actor.hide();
        menuManager.removeMenu(menu);
        menu.destroy();
    });
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    item.add_style_class_name('macdock-weather-popup-item');
    menu.addMenuItem(item);
    const layout = new St.BoxLayout({vertical: true, style_class: 'macdock-weather-popup-layout'});
    item.add_child(layout);
    const top = new St.BoxLayout({style_class: 'macdock-weather-popup-top'});
    const location = new St.BoxLayout({vertical: true, x_expand: true});
    const placeName = text(place, 'macdock-weather-popup-location');
    const conditionName = text('Carregando previsão…', 'macdock-weather-popup-subtitle');
    location.add_child(placeName);
    location.add_child(conditionName);
    top.add_child(location);
    const temperatureBig = text('--°C', 'macdock-weather-popup-temp');
    top.add_child(temperatureBig);
    layout.add_child(top);
    const hourlyTitle = text('PREVISÃO HORÁRIA', 'macdock-weather-section-title');
    layout.add_child(hourlyTitle);
    const hourlyRow = new St.BoxLayout({style_class: 'macdock-weather-forecast-row'});
    layout.add_child(hourlyRow);
    const dailyTitle = text('PRÓXIMOS 7 DIAS', 'macdock-weather-section-title');
    layout.add_child(dailyTitle);
    const dailyRow = new St.BoxLayout({style_class: 'macdock-weather-forecast-row'});
    layout.add_child(dailyRow);
    const stats = text('Umidade — · Vento — · Chuva —', 'macdock-weather-stats');
    layout.add_child(stats);
    const updated = text('Dados: Open-Meteo · CC BY 4.0', 'macdock-weather-credit');
    layout.add_child(updated);

    const latitude = settings.get_double('macdock-weather-latitude');
    const longitude = settings.get_double('macdock-weather-longitude');
    const unit = settings.get_string('macdock-weather-unit');
    const unitLabel = unit === 'fahrenheit' ? '°F' : '°C';
    const session = new Soup.Session({timeout: 15, user_agent: 'MacDock-Weather-Prototype'});
    scope.own(() => session.abort());
    const directory = GLib.build_filenamev([GLib.get_user_cache_dir(), 'macdock-weather-prototype']);
    GLib.mkdir_with_parents(directory, 0o700);
    const cache = Gio.File.new_for_path(`${directory}/weather-${latitude}-${longitude}-${unit}.json`);
    let latest = null;
    // Background comes from one of five CSS classes (background-size: cover).
    // Avoid dynamic CSS pixel calculations: St handles the actor size, widget
    // scaling and monitor HiDPI directly.  This prevents image insets and
    // avoids overwriting inline font/radius scaling from widgetSizing.js.
    let sceneKey = null;
    let busy = false;
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    function repaint() {
        if (!scope.alive || !latest?.data?.current)
            return;
        const {current, hourly, daily} = latest.data;
        const info = weatherCondition(current.weather_code, current.is_day);
        const temp = Math.round(current.temperature_2m);
        conditionLabel.text = info.text;
        temperatureLabel.text = `${temp}°`;
        temperatureBig.text = `${temp}${unitLabel}`;
        conditionName.text = info.text;
        // Change the scenery without recreating the card or resetting its layout.
        if (sceneKey !== info.scene) {
            if (sceneKey)
                button.remove_style_class_name(`macdock-weather-scene-${sceneKey}`);
            sceneKey = info.scene;
            button.add_style_class_name(`macdock-weather-scene-${sceneKey}`);
        }
        // CSS overlay only for rain/snow; no CPU-expensive continuous repaint.
        button.remove_style_class_name('macdock-weather-rain');
        button.remove_style_class_name('macdock-weather-snow');
        if (info.scene === 'rain')
            button.add_style_class_name('macdock-weather-rain');
        if (info.scene === 'snow')
            button.add_style_class_name('macdock-weather-snow');
        hourlyRow.destroy_all_children();
        if (Array.isArray(hourly?.time)) {
            for (let i = 0; i < Math.min(5, hourly.time.length); i++) {
                const time = hourly.time[i];
                hourlyRow.add_child(forecastTile(time.slice(11, 16),
                    hourly.temperature_2m?.[i], hourly.weather_code?.[i], hourly.is_day?.[i] ?? 1));
            }
        }
        dailyRow.destroy_all_children();
        if (Array.isArray(daily?.time)) {
            for (let i = 0; i < Math.min(7, daily.time.length); i++) {
                const date = new Date(`${daily.time[i]}T12:00:00`);
                dailyRow.add_child(forecastTile(dayNames[date.getDay()],
                    daily.temperature_2m_max?.[i], daily.weather_code?.[i], 1,
                    daily.temperature_2m_min?.[i]));
            }
        }
        const humidity = current.relative_humidity_2m;
        const wind = current.wind_speed_10m;
        const chance = daily?.precipitation_probability_max?.[0];
        stats.text = `Umidade ${Number.isFinite(humidity) ? `${Math.round(humidity)}%` : '—'}   ·   ` +
            `Vento ${Number.isFinite(wind) ? `${Math.round(wind)} km/h` : '—'}   ·   ` +
            `Chuva ${Number.isFinite(chance) ? `${Math.round(chance)}%` : '—'}`;
        updated.text = `Open-Meteo · CC BY 4.0   ·   Atualizado ${new Date(latest.saved).toLocaleTimeString()}`;
    }
    async function refresh() {
        if (busy || !scope.alive)
            return;
        if (!settings.get_boolean('macdock-weather-configured')) {
            conditionLabel.text = 'Configure o clima';
            conditionName.text = 'Defina a localização nas preferências';
            return;
        }
        busy = true;
        try {
            const query = [
                `latitude=${encodeURIComponent(latitude)}`,
                `longitude=${encodeURIComponent(longitude)}`,
                'current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day',
                'hourly=temperature_2m,weather_code,is_day',
                'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
                'forecast_days=7', 'forecast_hours=5',
                `temperature_unit=${encodeURIComponent(unit)}`, 'timezone=auto',
            ].join('&');
            const url = `https://api.open-meteo.com/v1/forecast?${query}`;
            const bytes = await requestBytes(session, Soup.Message.new('GET', url),
                scope.cancellable, 262144);
            const data = JSON.parse(new TextDecoder().decode(bytes));
            if (!Number.isFinite(data.current?.temperature_2m) ||
                !Array.isArray(data.hourly?.time) || !Array.isArray(data.daily?.time))
                throw new Error('Resposta meteorológica incompleta');
            if (!scope.alive)
                return;
            latest = {saved: Date.now(), data};
            repaint();
            await writeJSON(cache, latest, scope.cancellable);
        } catch (error) {
            if (scope.alive) {
                repaint();
                updated.text = `Sem atualização: ${error.message}`;
                if (!latest)
                    conditionName.text = 'Previsão indisponível';
            }
        } finally {
            busy = false;
        }
    }
    async function start() {
        try {
            const saved = JSON.parse(await readText(cache.get_path(), scope.cancellable));
            if (Number.isFinite(saved.saved) && Number.isFinite(saved.data?.current?.temperature_2m)) {
                latest = saved;
                repaint();
            }
        } catch {
            // Offline start and absent cache must be harmless.
        }
        if (scope.alive && (!latest || Date.now() - latest.saved > 15 * 60 * 1000))
            refresh();
    }
    scope.every(900, refresh);
    start();
    return {actor: button, size: {width: 208, height: 48}};
}
