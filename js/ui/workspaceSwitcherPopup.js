// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta  = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const Main = imports.ui.main;
const Tweener = imports.ui.tweener;

var ANIMATION_TIME = 0.1;
var DISPLAY_TIMEOUT = 600;

var WorkspaceSwitcherPopupList = new Lang.Class({
    Name: 'WorkspaceSwitcherPopupList',
    Extends: St.Widget,

    _init() {
        this.parent({ style_class: 'workspace-switcher' });

        this._itemSpacing = 0;
        this._childHeight = 0;
        this._childWidth = 0;

        this.connect('style-changed', () => {
           this._itemSpacing = this.get_theme_node().get_length('spacing');
        });
    },

    vfunc_get_preferred_height(forWidth) {
        let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        let themeNode = this.get_theme_node();

        let availHeight = workArea.height;
        availHeight -= themeNode.get_vertical_padding();

        let height = 0;
        for (let child of this.get_children()) {
            let [childMinHeight, childNaturalHeight] = child.get_preferred_height(-1);
            let [childMinWidth, childNaturalWidth] = child.get_preferred_width(childNaturalHeight);
            height += childNaturalHeight * workArea.width / workArea.height;
        }

        let workspaceManager = global.workspace_manager;
        let spacing = this._itemSpacing * (workspaceManager.n_workspaces - 1);
        height += spacing;
        height = Math.min(height, availHeight);

        this._childHeight = (height - spacing) / workspaceManager.n_workspaces;

        return themeNode.adjust_preferred_height(height, height);
    },

    vfunc_get_preferred_width(forHeight) {
        let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        this._childWidth = Math.round(this._childHeight * workArea.width / workArea.height);

        return [this._childWidth, this._childWidth];
    },

    vfunc_allocate(box, flags) {
        this.set_allocation(box, flags);

        let themeNode = this.get_theme_node();
        box = themeNode.get_content_box(box);

        let childBox = new Clutter.ActorBox();

        let y = box.y1;
        let prevChildBoxY2 = box.y1 - this._itemSpacing;
        for (let child of this.get_children()) {
            childBox.x1 = box.x1;
            childBox.x2 = box.x1 + this._childWidth;
            childBox.y1 = prevChildBoxY2 + this._itemSpacing;
            childBox.y2 = Math.round(y + this._childHeight);
            y += this._childHeight + this._itemSpacing;
            prevChildBoxY2 = childBox.y2;
            child.allocate(childBox, flags);
        }
    },
});

var WorkspaceSwitcherPopup = new Lang.Class({
    Name: 'WorkspaceSwitcherPopup',
    Extends: St.Widget,

    _init() {
        this.parent({ x: 0,
                      y: 0,
                      width: global.screen_width,
                      height: global.screen_height,
                      style_class: 'workspace-switcher-group' });

        this.actor = this;

        Main.uiGroup.add_actor(this);

        this._timeoutId = 0;

        this._container = new St.BoxLayout({ style_class: 'workspace-switcher-container' });
        this.add_child(this._container);

        this._list = new WorkspaceSwitcherPopupList();
        this._container.add_child(this._list);

        this._redisplay();

        this.hide();

        let workspaceManager = global.workspace_manager;
        this._workspaceManagerSignals = [];
        this._workspaceManagerSignals.push(workspaceManager.connect('workspace-added',
                                                                    this._redisplay.bind(this)));
        this._workspaceManagerSignals.push(workspaceManager.connect('workspace-removed',
                                                                    this._redisplay.bind(this)));

        this.connect('destroy', this._onDestroy.bind(this));
    },

    _redisplay() {
        let workspaceManager = global.workspace_manager;

        this._list.destroy_all_children();

        for (let i = 0; i < workspaceManager.n_workspaces; i++) {
            let indicator = null;

           if (i == this._activeWorkspaceIndex && this._direction == Meta.MotionDirection.UP)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-up' });
           else if(i == this._activeWorkspaceIndex && this._direction == Meta.MotionDirection.DOWN)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-down' });
           else
               indicator = new St.Bin({ style_class: 'ws-switcher-box' });

           this._list.add_actor(indicator);

        }

        let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        let [containerMinHeight, containerNatHeight] = this._container.get_preferred_height(global.screen_width);
        let [containerMinWidth, containerNatWidth] = this._container.get_preferred_width(containerNatHeight);
        this._container.x = workArea.x + Math.floor((workArea.width - containerNatWidth) / 2);
        this._container.y = workArea.y + Math.floor((workArea.height - containerNatHeight) / 2);
    },

    _show() {
        Tweener.addTween(this._container, { opacity: 255,
                                            time: ANIMATION_TIME,
                                            transition: 'easeOutQuad'
                                           });
        this.actor.show();
    },

    display(direction, activeWorkspaceIndex) {
        this._direction = direction;
        this._activeWorkspaceIndex = activeWorkspaceIndex;

        this._redisplay();
        if (this._timeoutId != 0)
            Mainloop.source_remove(this._timeoutId);
        this._timeoutId = Mainloop.timeout_add(DISPLAY_TIMEOUT, this._onTimeout.bind(this));
        GLib.Source.set_name_by_id(this._timeoutId, '[gnome-shell] this._onTimeout');
        this._show();
    },

    _onTimeout() {
        Mainloop.source_remove(this._timeoutId);
        this._timeoutId = 0;
        Tweener.addTween(this._container, { opacity: 0.0,
                                            time: ANIMATION_TIME,
                                            transition: 'easeOutQuad',
                                            onComplete() { this.destroy(); },
                                            onCompleteScope: this
                                           });
        return GLib.SOURCE_REMOVE;
    },

    _onDestroy() {
        if (this._timeoutId)
            Mainloop.source_remove(this._timeoutId);
        this._timeoutId = 0;

        let workspaceManager = global.workspace_manager;
        for (let i = 0; i < this._workspaceManagerSignals.length; i++)
            workspaceManager.disconnect(this._workspaceManagerSignals[i]);

        this._workspaceManagerSignals = [];
    }
});
