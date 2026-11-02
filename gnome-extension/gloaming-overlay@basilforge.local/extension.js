import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const APP_ID = 'dev.basilforge.GloamingReplay';
const BUS = 'dev.basilforge.GloamingOverlay';
const XML = `<node><interface name="${BUS}"><method name="Version"><arg type="i" direction="out"/></method><method name="Status"><arg type="s" direction="out"/></method></interface></node>`;

export default class GloamingOverlay extends Extension {
    enable() {
        this._tracked = new Map();
        this._created = global.display.connect('window-created', (_d, win) => this._track(win));
        this._mapped = global.window_manager.connect('map', (_wm, actor) => {
            this._track(actor.meta_window);
            this._queue(actor.meta_window, true);
            if (this._tracked.get(actor.meta_window)?.active) this._place(actor.meta_window);
        });
        this._monitors = Main.layoutManager.connect('monitors-changed', () => {
            for (const win of this._tracked.keys()) this._queue(win);
        });
        this._dbus = Gio.DBusExportedObject.wrapJSObject(XML, {Version: () => 1, Status: () => JSON.stringify(
            [...this._tracked.entries()].filter(([, state]) => state.active).map(([win]) => ({
                above: win.is_above(), clientType: win.get_client_type(),
                frame: (() => {const r=win.get_frame_rect();return {x:r.x,y:r.y,width:r.width,height:r.height};})(), monitor: win.get_monitor(), fullscreen: win.is_fullscreen(),
            }))) });
        this._dbus.export(Gio.DBus.session, '/dev/basilforge/GloamingOverlay');
        this._owner = Gio.bus_own_name(Gio.BusType.SESSION, BUS, Gio.BusNameOwnerFlags.NONE, null, null, null);
        for (const actor of global.get_window_actors()) this._track(actor.meta_window);
    }

    _track(win) {
        if (!win || this._tracked.has(win)) return;
        const state = {signals: [], pending: 0, active: false, above: false, sticky: false, fullscreen: false};
        this._tracked.set(win, state);
        state.signals.push(win.connect('notify::title', () => this._queue(win)));
        state.signals.push(win.connect('size-changed', () => this._queue(win)));
        state.signals.push(win.connect('notify::fullscreen', () => this._queue(win)));
        state.signals.push(win.connect('position-changed', () => this._queue(win)));
        state.signals.push(win.connect('unmanaged', () => this._forget(win)));
        this._queue(win);
    }

    _queue(win, activate = false) {
        const state = this._tracked?.get(win);
        if (!state || win.get_gtk_application_id() !== APP_ID) return;
        if (!/^Gloaming Replay(?: \[[\w-]+\])?$/.test(win.get_title() ?? '')) return;
        if (!state.active) {
            state.active = true;
            state.fullscreen = win.is_fullscreen();
            state.above = win.is_above();
            state.sticky = win.is_on_all_workspaces();
            win.make_above();
            win.stick();
            activate = true;
        }
        state.activate = state.activate || activate;
        if (state.pending) return;
        state.pending = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            state.pending = 0;
            if (!this._tracked?.has(win) || !win.get_compositor_private()) return GLib.SOURCE_REMOVE;
            this._place(win);
            if (state.activate) {
                state.activate = false;
                Main.activateWindow(win);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // Centered on the chosen monitor at any resolution. Also called synchronously
    // when the window maps, so it never flashes at the compositor's default spot.
    _place(win) {
        const connector = /\[([\w-]+)\]/.exec(win.get_title() ?? '')?.[1];
        let index = connector ? global.backend.get_monitor_manager().get_monitor_for_connector(connector) : win.get_monitor();
        if (index < 0 || index >= Main.layoutManager.monitors.length) index = Main.layoutManager.primaryIndex;
        const monitor = Main.layoutManager.monitors[index];
        if (monitor && !win.is_fullscreen()) {
            if (win.get_monitor() !== index) win.move_to_monitor(index);
            // Float transparently during normal replay. WebKit owns explicit
            // video fullscreen requests; do not undo them on size-changed.
            // On fullscreen exit, restore the centered floating bounds.
            const width = Math.min(1000, monitor.width - 48);
            const height = Math.min(960, monitor.height - 80);
            const x = monitor.x + Math.round((monitor.width - width) / 2);
            const y = monitor.y + Math.round((monitor.height - height) / 2);
            const rect = win.get_frame_rect();
            if (rect.x !== x || rect.y !== y || rect.width !== width || rect.height !== height)
                win.move_resize_frame(false, x, y, width, height);
        }
    }

    _forget(win, restore = false) {
        const state = this._tracked?.get(win);
        if (!state) return;
        if (state.pending) GLib.source_remove(state.pending);
        for (const id of state.signals) win.disconnect(id);
        if (restore && state.active) {
            if (!state.fullscreen) win.unmake_fullscreen();
            if (!state.above) win.unmake_above();
            if (!state.sticky) win.unstick();
        }
        this._tracked.delete(win);
    }

    disable() {
        global.display.disconnect(this._created);
        global.window_manager.disconnect(this._mapped);
        Main.layoutManager.disconnect(this._monitors);
        for (const win of this._tracked.keys()) this._forget(win, true);
        this._tracked = null;
        this._dbus.unexport();
        Gio.bus_unown_name(this._owner);
    }
}
