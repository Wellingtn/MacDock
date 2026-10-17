// SPDX-License-Identifier: GPL-2.0-or-later
// Catálogo das superfícies do Liquid Glass. Sem imports: é usado tanto pelo
// Shell quanto pelo processo de preferências (GTK), que não enxerga ui/*.js.

export const SURFACE_SCOPES = Object.freeze(['dock', 'custom', 'full']);

export const SURFACES = Object.freeze([
    {
        id: 'panel', available: true,
        title: 'Barra superior',
        subtitle: 'Vidro sob a barra do GNOME; o fundo original é restaurado ao desativar.',
    },
    {
        id: 'popups', available: true,
        title: 'Menus suspensos e pop-ups',
        subtitle: 'Menus dos indicadores, menus de ícones do dock e pop-ups dos widgets.',
    },
    {
        id: 'quick-settings', available: true,
        title: 'Menu de configurações rápidas',
        subtitle: 'Wi-Fi, volume, brilho, energia.',
    },
    {
        id: 'calendar', available: true,
        title: 'Calendário e menu de data/hora',
        subtitle: 'Menu aberto pelo relógio da barra superior.',
    },
    {
        id: 'notifications', available: true,
        title: 'Notificações (banners)',
        subtitle: 'Banner que aparece no topo da tela.',
    },
    {
        id: 'overview', available: false,
        title: 'Visão geral de atividades',
        reason: 'o fundo da visão geral é desenhado pelo Shell com estados e animações próprios; não implementado.',
    },
    {
        id: 'app-grid', available: false,
        title: 'Seletor e grade de aplicativos',
        reason: 'depende da visão geral (mesma limitação); não implementado.',
    },
    {
        id: 'file-manager', available: false,
        title: 'Janelas do gerenciador de arquivos',
        reason: 'janelas GTK4 pertencem ao aplicativo e são opacas; uma extensão do Shell não consegue ' +
            'torná-las translúcidas. Exige integração separada (ver docs/LIQUID-GLASS-APPS.md).',
    },
    {
        id: 'app-windows', available: false,
        title: 'Janelas e diálogos de aplicativos',
        reason: 'mesma limitação das janelas GTK4: o conteúdo é do aplicativo. Ver docs/LIQUID-GLASS-APPS.md.',
    },
]);

export const AVAILABLE_SURFACE_IDS = Object.freeze(
    SURFACES.filter(surface => surface.available).map(surface => surface.id));

// Conjunto efetivo de superfícies (além do dock) para um modo e uma seleção.
export function effectiveSurfaces(scope, selected = []) {
    if (scope === 'full')
        return new Set(AVAILABLE_SURFACE_IDS);
    if (scope === 'custom')
        return new Set(selected.filter(id => AVAILABLE_SURFACE_IDS.includes(id)));
    return new Set();
}
