import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';

// Helper actors layered around real shell UI. They are hidden from picking so
// that pointer events and Looking Glass's picker reach the real actors
// instead.
// A plain Clutter.Actor rather than an St.Widget, so no theme padding gets in
// the way of pixel-exact layout.
export const UnpickableActor = GObject.registerClass({GTypeName: 'MacDockGlassTestUnpickableActor'}, class UnpickableActor extends Clutter.Actor {
    _init(params = {}) {
        super._init(params);
        Shell.util_set_hidden_from_pick(this, true);
    }

    vfunc_pick(_pickContext) {
    }
});
