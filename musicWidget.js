import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup?version=3.0';
import {loadFile, requestBytes} from './dataIO.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const PROPS = 'org.freedesktop.DBus.Properties';
const PLAYER_WIDTH = 216;
const PLAYER_HEIGHT = 48;


// Adapted from the user's original Dock Music v16, preserved under references/.
// Redistribution provenance is tracked in docs/DOCK-MUSIC-V16.md.
export class MusicWidget {
    constructor(context) {
        this.context = context;
        context.scope.own(() => this.disable());
        this.enable();
        this.actor = this._widget;
        this.size = {width: PLAYER_WIDTH, height: PLAYER_HEIGHT};
    }

    enable() {
        this._enabled = true;
        this._player = null;
        this._busy = false;
        this._coverUrl = null;
        this._coverRequest = 0;
        this._session = new Soup.Session({timeout: 15, user_agent: 'MacDock-development'});
        this._dash = null;
        this._widget = null;
        this._hasMedia = false;
        this._buildWidget();
        this._buildRevealSlot();
        this._refresh();
        this.context.scope.every(30, () => this._refresh());
        const bus = Gio.DBus.session;
        const properties = bus.signal_subscribe(null, PROPS, 'PropertiesChanged', PATH, PLAYER,
            Gio.DBusSignalFlags.NONE, () => this._refresh());
        const owners = bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_bus, _sender, _path, _interface, _signal, parameters) => {
                if (parameters.deepUnpack()[0].startsWith(PREFIX))
                    this._refresh();
            });
        this.context.scope.own(() => bus.signal_unsubscribe(properties));
        this.context.scope.own(() => bus.signal_unsubscribe(owners));
    }

    _buildWidget() {
        // Layout fixo: cada camada tem dimensões e posição explícitas.
        // Evita o redimensionamento de St.Icon e do Clutter.BinLayout.
        this._widget = new St.Widget({
            style_class: 'dock-music-root',
            reactive: true,
            track_hover: true,
            width: PLAYER_WIDTH,
            height: PLAYER_HEIGHT,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.FixedLayout(),
            clip_to_allocation: true,
        });

        this.context.scope.actor(this._widget);
        this._backgroundActor = null;
        this._thumbnailActor = null;

        this._tint = new St.Widget({
            style_class: 'dock-music-tint',
            x: 0, y: 0, width: PLAYER_WIDTH, height: PLAYER_HEIGHT,
            reactive: false,
        });
        this._widget.add_child(this._tint);

        this._title = new St.Label({
            text: 'Nenhuma música',
            style_class: 'dock-music-title',
            x: 61, y: 4, width: 175, height: 17,
        });
        this._artist = new St.Label({
            text: '',
            style_class: 'dock-music-artist',
            x: 61, y: 20, width: 175, height: 14,
        });
        for (const label of [this._title, this._artist]) {
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            label.clutter_text.set_single_line_mode(true);
            label.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            this._widget.add_child(label);
        }

        const controls = this._controls = new St.BoxLayout({
            style_class: 'dock-music-controls',
            x: 88, y: 33, width: 122, height: 25,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const button = (icon, method, primary = false) => {
            const b = new St.Button({
                style_class: primary ? 'dock-music-control dock-music-play' : 'dock-music-control',
                can_focus: true,
                child: new St.Icon({icon_name: icon, icon_size: primary ? 17 : 16}),
            });
            b.connect('clicked', () => this._command(method));
            controls.add_child(b);
            return b;
        };
        this._previous = button('media-skip-backward-symbolic', 'Previous');
        this._previous.accessible_name = 'Anterior';
        this._play = button('media-playback-start-symbolic', 'PlayPause', true);
        this._play.accessible_name = 'Reproduzir ou pausar';
        this._playIcon = this._play.child;
        this._next = button('media-skip-forward-symbolic', 'Next');
        this._next.accessible_name = 'Próximo';
        this._widget.add_child(controls);
        this.resize(PLAYER_WIDTH, PLAYER_HEIGHT);
        this._showEmpty();
    }

    resize(width, height) {
        const scale = height / PLAYER_HEIGHT;
        this._renderWidth = width;
        this._renderHeight = height;
        const px = value => Math.max(1, Math.round(value * scale));
        const deviceScale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const css = value => Math.max(1, Math.round(value * scale / deviceScale));
        this._tint.set_size(width, height);
        this._widget.set_style(`border-radius: ${css(14)}px;`);
        this._tint.set_style(`border-radius: ${css(14)}px;`);
        this._title.set_position(px(50), px(2));
        this._title.set_size(width - px(56), px(15));
        this._title.set_style(`font-size: ${css(11)}px; font-weight: bold;`);
        this._artist.set_position(px(50), px(17));
        this._artist.set_size(width - px(56), px(12));
        this._artist.set_style(`font-size: ${css(9)}px;`);
        this._controls.set_position(px(79), px(29));
        this._controls.set_size(px(108), px(18));
        this._controls.set_style(`spacing: ${css(10)}px;`);
        for (const button of [this._previous, this._play, this._next]) {
            button.set_size(px(26), px(18));
            button.child.icon_size = css(13);
        }
        this._renderCover();
    }

    _buildRevealSlot() {
        // The shared WidgetManager owns clipping, scale, reveal and host placement.
    }

    _syncVisibility() {
        if (this._enabled)
            this.context.setVisible(this._hasMedia);
    }

    _call(destination, iface, method, parameters, signature, callback) {
        Gio.DBus.session.call(
            destination, iface === 'org.freedesktop.DBus' ? '/org/freedesktop/DBus' : PATH,
            iface, method, parameters,
            signature ? new GLib.VariantType(signature) : null,
            Gio.DBusCallFlags.NONE, 3000, this.context.scope.cancellable,
            (connection, result) => {
                let response = null;
                try {
                    response = connection.call_finish(result);
                } catch (error) {
                    console.debug(`Dock Music: ${error.message}`);
                }
                if (this._enabled)
                    callback(response);
            }
        );
    }

    _refresh() {
        if (!this._enabled)
            return;
        if (this._busy) {
            this._pendingRefresh = true;
            return;
        }
        this._busy = true;
        this._call('org.freedesktop.DBus', 'org.freedesktop.DBus', 'ListNames',
            null, '(as)', result => {
                if (!result) {
                    this._finishRefresh();
                    return;
                }
                const names = result.deepUnpack()[0].filter(n =>
                    n.startsWith(PREFIX) && n !== `${PREFIX}playerctld`);
                if (!names.length) {
                    this._player = null;
                    this._showEmpty();
                    this._finishRefresh();
                    return;
                }
                const ordered = this._player && names.includes(this._player)
                    ? [this._player, ...names.filter(n => n !== this._player)]
                    : names;
                this._inspect(ordered, 0, null);
            });
    }

    _finishRefresh() {
        this._busy = false;
        if (this._pendingRefresh) {
            this._pendingRefresh = false;
            this._refresh();
        }
    }

    _inspect(names, index, fallback) {
        if (index >= names.length) {
            if (fallback) {
                this._player = fallback.name;
                this._render(fallback.props);
            } else {
                this._player = null;
                this._showEmpty();
            }
            this._finishRefresh();
            return;
        }
        const name = names[index];
        this._call(name, PROPS, 'GetAll', new GLib.Variant('(s)', [PLAYER]),
            '(a{sv})', result => {
                if (!result) {
                    this._inspect(names, index + 1, fallback);
                    return;
                }
                const [props] = result.deepUnpack();
                const metadata = props.Metadata?.deepUnpack() ?? {};
                const hasMedia = Boolean(metadata['xesam:title'] || metadata['mpris:artUrl'] ||
                    metadata['xesam:url']);
                const candidate = hasMedia ? {name, props} : null;
                if (hasMedia && props.PlaybackStatus?.deepUnpack() === 'Playing') {
                    this._player = name;
                    this._render(props);
                    this._finishRefresh();
                } else {
                    this._inspect(names, index + 1, fallback ?? candidate);
                }
            });
    }

    _render(props) {
        const metadata = props.Metadata?.deepUnpack() ?? {};
        const value = key => metadata[key]?.deepUnpack();
        this._title.text = value('xesam:title') || 'Mídia sem título';
        const artists = value('xesam:artist');
        this._artist.text = Array.isArray(artists) && artists.length
            ? artists.join(', ') : 'Artista não informado';
        this._playIcon.icon_name = props.PlaybackStatus?.deepUnpack() === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._play.reactive = props.CanControl?.deepUnpack() !== false;
        this._previous.reactive = props.CanGoPrevious?.deepUnpack() === true;
        this._next.reactive = props.CanGoNext?.deepUnpack() === true;
        for (const b of [this._play, this._previous, this._next])
            b.opacity = b.reactive ? 255 : 95;
        this._hasMedia = true;
        this._syncVisibility();
        this._loadCover(value('mpris:artUrl'));
    }

    _showEmpty() {
        this._hasMedia = false;
        this._title.text = 'Nenhuma música';
        this._artist.text = '';
        this._playIcon.icon_name = 'media-playback-start-symbolic';
        for (const b of [this._play, this._previous, this._next]) {
            b.reactive = false;
            b.opacity = 95;
        }
        this._coverUrl = null;
        ++this._coverRequest;
        this._applyCover(null);
        this._syncVisibility();
    }

    // Retorna um ator com textura RGBA no tamanho exato solicitado.
    // Não usa St.Icon: St.Icon pode preservar a proporção da capa e criar faixas.
    _artworkActor(file, width, height, radius, blurred, x, y) {
        const logicalWidth = width;
        const logicalHeight = height;
        // Foreground album art gets enough texels for HiDPI output.
        const deviceScale = 1; // width/height already include the stage device scale.
        width = Math.round(width * deviceScale);
        height = Math.round(height * deviceScale);
        radius *= deviceScale;
        const source = file;
        const scale = Math.max(width / source.width, height / source.height);
        const sw = Math.max(width, Math.ceil(source.width * scale));
        const sh = Math.max(height, Math.ceil(source.height * scale));
        const scaled = source.scale_simple(sw, sh, GdkPixbuf.InterpType.HYPER);
        const crop = scaled.new_subpixbuf(
            Math.floor((sw - width) / 2), Math.floor((sh - height) / 2), width, height);
        const pixels = crop.get_pixels();
        const stride = crop.get_rowstride();
        const channels = crop.get_n_channels();
        let rgba = new Uint8Array(width * height * 4);
        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                const si = py * stride + px * channels;
                const di = (py * width + px) * 4;
                rgba[di] = pixels[si];
                rgba[di + 1] = pixels[si + 1];
                rgba[di + 2] = pixels[si + 2];
                rgba[di + 3] = channels === 4 ? pixels[si + 3] : 255;
            }
        }

        if (blurred) {
            // Duas passagens de box blur separável, próximas de um blur gaussiano.
            // Executadas apenas quando a capa muda.
            const r = 10;
            for (let pass = 0; pass < 2; pass++) {
                const horizontal = new Uint8Array(rgba.length);
                for (let py = 0; py < height; py++) {
                    for (let px = 0; px < width; px++) {
                        let n = 0, red = 0, green = 0, blue = 0;
                        for (let dx = -r; dx <= r; dx++) {
                            const sx = Math.max(0, Math.min(width - 1, px + dx));
                            const si = (py * width + sx) * 4;
                            red += rgba[si];
                            green += rgba[si + 1];
                            blue += rgba[si + 2];
                            n++;
                        }
                        const di = (py * width + px) * 4;
                        horizontal[di] = red / n;
                        horizontal[di + 1] = green / n;
                        horizontal[di + 2] = blue / n;
                        horizontal[di + 3] = 255;
                    }
                }
                const vertical = new Uint8Array(rgba.length);
                for (let py = 0; py < height; py++) {
                    for (let px = 0; px < width; px++) {
                        let n = 0, red = 0, green = 0, blue = 0;
                        for (let dy = -r; dy <= r; dy++) {
                            const sy = Math.max(0, Math.min(height - 1, py + dy));
                            const si = (sy * width + px) * 4;
                            red += horizontal[si];
                            green += horizontal[si + 1];
                            blue += horizontal[si + 2];
                            n++;
                        }
                        const di = (py * width + px) * 4;
                        vertical[di] = red / n;
                        vertical[di + 1] = green / n;
                        vertical[di + 2] = blue / n;
                        vertical[di + 3] = 255;
                    }
                }
                rgba = vertical;
            }
        }

        // Máscara alfa antialias para cantos realmente arredondados.
        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                let cx = 0;
                let cy = 0;
                if (px < radius)
                    cx = radius - px - 0.5;
                else if (px >= width - radius)
                    cx = px - (width - radius) + 0.5;
                if (py < radius)
                    cy = radius - py - 0.5;
                else if (py >= height - radius)
                    cy = py - (height - radius) + 0.5;
                if (cx > 0 && cy > 0) {
                    const alpha = Math.max(0, Math.min(1,
                        radius + 0.5 - Math.sqrt(cx * cx + cy * cy)));
                    const ai = (py * width + px) * 4 + 3;
                    rgba[ai] = Math.round(rgba[ai] * alpha);
                }
            }
        }
        const image = new Clutter.Image();
        image.set_data(rgba, Cogl.PixelFormat.RGBA_8888, width, height, width * 4);
        return new Clutter.Actor({
            content: image, x, y, width: logicalWidth, height: logicalHeight,
            reactive: false,
        });
    }

    _applyCover(bytes) {
        if (!this._enabled || !this._widget)
            return;
        this._backgroundActor?.destroy();
        this._thumbnailActor?.destroy();
        this._backgroundActor = null;
        this._thumbnailActor = null;
        this._coverPixbuf = null;
        if (!bytes)
            return;
        try {
            const loader = new GdkPixbuf.PixbufLoader();
            loader.connect('size-prepared', (_loader, width, height) => {
                const scale = Math.min(1, 512 / Math.max(width, height));
                loader.set_size(Math.max(1, Math.round(width * scale)), Math.max(1,
                    Math.round(height * scale)));
            });
            loader.write(bytes);
            loader.close();
            const file = loader.get_pixbuf();
            if (!file)
                throw new Error('Capa inválida');
            this._coverPixbuf = file;
            this._renderCover();
        } catch (error) {
            console.warn(`Dock Music: falha ao renderizar capa: ${error.message}`);
            this._backgroundActor?.destroy();
            this._thumbnailActor?.destroy();
            this._backgroundActor = null;
            this._thumbnailActor = null;
        }
    }

    _renderCover() {
        this._backgroundActor?.destroy();
        this._thumbnailActor?.destroy();
        this._backgroundActor = null;
        this._thumbnailActor = null;
        if (!this._coverPixbuf || !this._widget)
            return;
        const width = this._renderWidth ?? PLAYER_WIDTH;
        const height = this._renderHeight ?? PLAYER_HEIGHT;
        const scale = height / PLAYER_HEIGHT;
        const inset = Math.max(1, Math.round(4 * scale));
        this._backgroundActor = this._artworkActor(this._coverPixbuf,
            width, height, 14 * scale, true, 0, 0);
        this._widget.insert_child_below(this._backgroundActor, this._tint);
        this._thumbnailActor = this._artworkActor(this._coverPixbuf,
            height - inset * 2, height - inset * 2, 9 * scale, false, inset, inset);
        this._widget.insert_child_above(this._thumbnailActor, this._tint);
    }

    async _loadCover(url) {
        if (url === this._coverUrl)
            return;
        this._coverUrl = url;
        const request = ++this._coverRequest;
        this._coverCancellable?.cancel();
        this._coverCancellable = new Gio.Cancellable();
        this._applyCover(null);
        try {
            let bytes;
            if (typeof url !== 'string')
                return;
            if (url.startsWith('file://')) {
                bytes = await loadFile(Gio.File.new_for_uri(url), this._coverCancellable, 8 * 1024 * 1024);
            } else if (/^https?:\/\//i.test(url)) {
                bytes = await requestBytes(this._session, Soup.Message.new('GET', url),
                    this._coverCancellable, 8 * 1024 * 1024);
            } else {
                return;
            }
            if (this._enabled && request === this._coverRequest)
                this._applyCover(bytes);
        } catch (error) {
            if (this._enabled && request === this._coverRequest)
                console.debug(`MacDock Music capa: ${error.message}`);
        }
    }

    _command(method) {
        if (!this._player)
            return;
        this._call(this._player, PLAYER, method, null, null, () => this._refresh());
    }

    disable() {
        this._enabled = false;
        this._coverCancellable?.cancel();
        ++this._coverRequest;
        if (this._timer) {
            GLib.Source.remove(this._timer);
            this._timer = null;
        }
        this._session?.abort();
        this._session = null;
        this._slot?.remove_all_transitions();
        this._slot?.destroy();
        this._slot = null;
        this._widget = null;
        this._dash = null;
        this._player = null;
    }
}
