// SPDX-License-Identifier: GPL-2.0-or-later
import St from 'gi://St';

// Resize the layout and font rasterization, never a finished actor texture.
// St handles the monitor's device scale; these are logical pixels only.
const styles = {
    'macdock-widget': 'border-radius: 14px;',
    'macdock-widget-row': 'padding: 0 9px; spacing: 8px;',
    'macdock-widget-icon-tile': 'width: 30px; height: 30px; border-radius: 9px;',
    'macdock-weather-card': 'border-radius: 14px;',
    'macdock-weather-card-row': 'padding: 0 10px; spacing: 8px;',
    'macdock-weather-condition': 'font-size: 11px;',
    'macdock-weather-city': 'font-size: 10px;',
    'macdock-weather-temperature': 'font-size: 24px; min-width: 48px;',
    'macdock-system-rows': 'spacing: 5px;',
    'macdock-metric': 'spacing: 5px;',
    'macdock-metric-name': 'font-size: 9px; min-width: 24px;',
    'macdock-metric-value': 'font-size: 11px; min-width: 30px;',
    'macdock-metric-track': 'width: 64px; height: 5px; border-radius: 3px;',
    'macdock-metric-fill': 'height: 5px; border-radius: 3px;',
    'macdock-date-tile': 'width: 34px; height: 34px; border-radius: 9px;',
    'macdock-date-tile-weekday': 'font-size: 7px; padding-top: 3px;',
    'macdock-date-tile-day': 'font-size: 16px;',
    'macdock-date-main': 'font-size: 12px;',
    'macdock-date-sub': 'font-size: 10px;',
};
const applied = new WeakMap();
const icons = new WeakMap();
export function resizeWidgetContents(actor, scale) {
    const declarations = Object.entries(styles)
        .filter(([name]) => actor.has_style_class_name?.(name))
        .map(([, css]) => css).join(' ');
    if (declarations) {
        const old = applied.get(actor) ?? '';
        let current = actor.get_style() ?? '';
        if (old && current.endsWith(old))
            current = current.slice(0, -old.length);
        const next = ` ${declarations.replace(/([\d.]+)px/g,
            (_match, value) => `${Math.max(1, Math.round(Number(value) * scale))}px`)}`;
        actor.set_style(current + next);
        applied.set(actor, next);
    }
    if (actor instanceof St.Icon) {
        if (!icons.has(actor))
            icons.set(actor, actor.icon_size);
        actor.icon_size = Math.max(1, Math.round(icons.get(actor) * scale));
    }
    for (const child of actor.get_children())
        resizeWidgetContents(child, scale);
}
