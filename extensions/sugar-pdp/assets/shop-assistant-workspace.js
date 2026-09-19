(function (g) {
  "use strict";

  var ns = (g.SugarSa = g.SugarSa || {});
  var panes = {};

  // Reserved pane ids for later register() — do not implement UI here:
  //   image   — image generation
  //   view3d  — 3D view
  var host = {
    root: null,
    shell: null,
    aside: null,
    titleEl: null,
    body: null,
    activeId: null,
    mountedId: null,
  };

  function paneById(id) {
    return panes[String(id || "")] || null;
  }

  function setOpen(open) {
    if (host.aside) host.aside.hidden = !open;
    if (host.shell) {
      host.shell.classList.toggle("sugar-sa-shell--workspace-open", !!open);
    }
  }

  function unmountActive() {
    if (!host.mountedId || !host.body) {
      host.activeId = null;
      host.mountedId = null;
      return;
    }
    var pane = paneById(host.mountedId);
    if (pane && typeof pane.unmount === "function") {
      pane.unmount(host.body);
    }
    host.body.innerHTML = "";
    host.activeId = null;
    host.mountedId = null;
  }

  function applyTitle(pane, ctx) {
    if (!host.titleEl) return;
    var key = pane && pane.titleKey;
    host.titleEl.textContent =
      ctx && typeof ctx.t === "function" && key ? ctx.t(key) : key || "";
  }

  ns.workspace = {
    bind: function (root) {
      host.root = root;
      host.shell = root.querySelector("[data-sugar-sa-shell]");
      host.aside = root.querySelector("[data-sugar-sa-workspace]");
      host.titleEl = root.querySelector("[data-sugar-sa-workspace-title]");
      host.body = root.querySelector("[data-sugar-sa-workspace-body]");
      var closeBtn = root.querySelector("[data-sugar-sa-workspace-close]");
      if (closeBtn && !closeBtn.__sugarSaBound) {
        closeBtn.__sugarSaBound = true;
        closeBtn.addEventListener("click", function () {
          ns.workspace.close();
        });
      }
      if (root && !root.__sugarSaWsEsc) {
        root.__sugarSaWsEsc = true;
        root.addEventListener("keydown", function (event) {
          if (event.key !== "Escape" || !host.activeId) return;
          event.preventDefault();
          event.stopPropagation();
          ns.workspace.close();
        });
      }
    },

    register: function (pane) {
      if (!pane || !pane.id) return;
      panes[String(pane.id)] = pane;
    },

    open: function (id, ctx) {
      var pane = paneById(id);
      if (!pane || !host.aside || !host.body) return;
      ctx = ctx || {};
      if (host.mountedId && host.mountedId !== pane.id) {
        unmountActive();
      }
      host.activeId = pane.id;
      applyTitle(pane, ctx);
      setOpen(true);
      if (host.mountedId !== pane.id) {
        if (typeof pane.mount === "function") pane.mount(host.body, ctx);
        host.mountedId = pane.id;
      } else if (typeof pane.update === "function") {
        pane.update(host.body, ctx);
      }
    },

    update: function (id, ctx) {
      var pane = paneById(id);
      if (!pane) return;
      if (host.activeId !== pane.id) {
        ns.workspace.open(id, ctx);
        return;
      }
      applyTitle(pane, ctx);
      if (typeof pane.update === "function") pane.update(host.body, ctx || {});
    },

    close: function () {
      unmountActive();
      setOpen(false);
    },

    closePane: function (id) {
      if (host.activeId && host.activeId === String(id || "")) {
        ns.workspace.close();
      }
    },

    isOpen: function (id) {
      if (id) return host.activeId === String(id);
      return !!host.activeId;
    },
  };
})(typeof window !== "undefined" ? window : this);
