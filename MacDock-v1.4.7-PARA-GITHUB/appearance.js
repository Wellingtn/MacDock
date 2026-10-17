// SPDX-License-Identifier: GPL-2.0-or-later
// Shared by the Shell and preferences; no imports from either UI process.
export const APPEARANCE_DEFAULTS = Object.freeze({
    'macdock-appearance-enabled': false,
    'liquid-glass-enabled': false,
    'macdock-theme': 'custom',
    'macdock-background': '#242831',
    'macdock-opacity': 0.78,
    'macdock-radius': 18,
    'macdock-border-width': 1,
    'macdock-border-color': '#a0a6b5',
    'macdock-shadow': true,
    'macdock-gradient': false,
    'macdock-gradient-end': '#12151c',
    'macdock-blur': false,
    'macdock-blur-radius': 20,
});
export const PRESETS = Object.freeze({
    glass: {
        background: '#303746', opacity: 0.76, radius: 20, borderWidth: 1,
        borderColor: '#c0cadb', shadow: true, gradient: true,
        gradientEnd: '#171c27',
    },
    classic: {
        background: '#323640', opacity: 1, radius: 12, borderWidth: 1,
        borderColor: '#666c78', shadow: true, gradient: false,
    },
    minimal: {
        background: '#16191f', opacity: 0.9, radius: 10, borderWidth: 0,
        borderColor: '#16191f', shadow: false, gradient: false,
    },
});
export function applyPreset(settings, name) {
    if (!['custom', 'liquid'].includes(name) && !PRESETS[name])
        throw new Error(`Unknown appearance preset: ${name}`);
    const preset = PRESETS[name === 'liquid' ? 'glass' : name];
    if (preset) {
        for (const [key, value] of Object.entries(preset)) {
            const setting = `macdock-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
            if (typeof value === 'boolean')
                settings.set_boolean(setting, value);
            else if (typeof value === 'number')
                settings.set_double(setting, value);
            else
                settings.set_string(setting, value);
        }
        settings.set_boolean('macdock-blur', false);
    }
    settings.set_string('macdock-theme', name);
    settings.set_boolean('liquid-glass-enabled', name === 'liquid');
    settings.set_boolean('macdock-appearance-enabled', true);
}
export function resetAppearance(settings) {
    settings.set_boolean('liquid-glass-enabled', false);
    for (const key of Object.keys(APPEARANCE_DEFAULTS))
        settings.reset(key);
}
export function color(value, opacity = 1) {
    if (!/^#[0-9a-f]{6}$/i.test(value))
        value = '#242831';
    const rgb = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
    return `rgba(${rgb.join(',')},${Math.max(0, Math.min(1, opacity))})`;
}
export function appearanceStyle(settings) {
    const opacity = settings.get_double('macdock-opacity');
    const background = color(settings.get_string('macdock-background'), opacity);
    const style = [
        `background-color: ${background}`,
        `border-radius: ${settings.get_double('macdock-radius')}px`,
        `border: ${settings.get_double('macdock-border-width')}px solid ${color(settings.get_string('macdock-border-color'), 0.65)}`,
        settings.get_boolean('macdock-shadow')
            ? 'box-shadow: 0 4px 16px rgba(0,0,0,0.32)' : 'box-shadow: none',
    ];
    if (settings.get_boolean('macdock-gradient')) {
        style.push('background-gradient-direction: vertical',
            `background-gradient-start: ${background}`,
            `background-gradient-end: ${color(settings.get_string('macdock-gradient-end'), opacity)}`);
    }
    return `${style.join('; ')};`;
}

export function conventionalGlassStyle() {
    return 'background-color: rgba(48,55,70,0.76); border-radius: 20px; ' +
        'border: 1px solid rgba(192,202,219,0.65); box-shadow: 0 4px 16px rgba(0,0,0,0.32); ' +
        'background-gradient-direction: vertical; background-gradient-start: rgba(48,55,70,0.76); ' +
        'background-gradient-end: rgba(23,28,39,0.76);';
}
