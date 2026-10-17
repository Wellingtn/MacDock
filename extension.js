// MacDock — fork of Dash to Dock (GPL-2.0-or-later)
import {DockManager} from './docking.js';
import {MacDockPanel} from './macdockPanel.js';
import {Extension} from './dependencies/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import {LiquidGlassManager} from './liquidGlass/manager.js';
import {WidgetManager} from './widgetManager.js';
import {MusicWidget} from './musicWidget.js';
import {createSystemWidget} from './systemWidget.js';
import {createCalendarWidget} from './calendarWidget.js';
import {createWeatherWidget} from './weatherWidget.js';

export let dockManager;
export default class MacDockExtension extends Extension.Extension {
    enable() {
        for (const uuid of [
            'macdock@local', 'macdock-liquid-glass-test@local',
            'macdock-weather-revisado@local',
            'dash-to-dock@micxgx.gmail.com', 'ubuntu-dock@ubuntu.com',
        ]) {
            const other = Main.extensionManager.lookup(uuid);
            if (other && other.state === (ExtensionState.ACTIVE ?? ExtensionState.ENABLED))
                throw new Error(`Disable ${uuid} before enabling MacDock. Its installation will be preserved.`);
        }
        try {
            // Keep the instance reachable before any initialization that can fail.
            dockManager = new DockManager(this);
            dockManager.initialize();
            this._panel = new MacDockPanel(this, dockManager);
            this._widgets = new WidgetManager(dockManager, {
                music: context => new MusicWidget(context),
                system: createSystemWidget,
                calendar: createCalendarWidget,
                weather: createWeatherWidget,
            });
            this._liquidGlass = new LiquidGlassManager(dockManager, this.path);
            this._liquidGlass.enable();
            this._shutdownID = global.connect('shutdown', () => this.disable());
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    disable() {
        const cleanup = callback => {
            try {
                callback();
            } catch (error) {
                console.error(`MacDock: cleanup failed: ${error}`);
            }
        };
        if (this._shutdownID) {
            cleanup(() => global.disconnect(this._shutdownID));
            this._shutdownID = null;
        }
        cleanup(() => this._liquidGlass?.disable());
        this._liquidGlass = null;
        cleanup(() => this._widgets?.destroy());
        this._widgets = null;
        cleanup(() => this._panel?.destroy());
        this._panel = null;
        cleanup(() => dockManager?.destroy());
        dockManager = null;
    }
}
