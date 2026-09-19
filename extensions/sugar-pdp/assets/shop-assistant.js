(function (g) {
  "use strict";

  var ns = g.SugarSa || {};
  var util = ns.util || {};
  var el = ns.el || {};

  function SugarShopAssistant(root) {
    this.root = root;
    this.config = (util.parseConfig && util.parseConfig(root)) || {};
    this.i18n = (g.SugarSaI18n && g.SugarSaI18n.resolve(this.config.locale)) || {};
    this.dialog = root.querySelector("[data-sugar-sa-dialog]");
    this.thread = root.querySelector("[data-sugar-sa-thread]");
    this.form = root.querySelector("[data-sugar-sa-form]");
    this.input = root.querySelector("[data-sugar-sa-input]");
    this.sendBtn = root.querySelector("[data-sugar-sa-send]");
    this.composerResize = root.querySelector("[data-sugar-sa-composer-resize]");
    this.chat = root.querySelector(".sugar-sa-chat");
    this.workspace = ns.workspace;
    this.streamToken = "";
    this.chatUrl = "";
    this.busy = false;
    this.lastCart = null;
    this.picked = {};
    this.selectedCart = {};
    this.recommended = {};
    this.listingFresh = true;
    this.bind();
  }

  SugarShopAssistant.prototype.t = function (key, fallback) {
    return this.i18n[key] || fallback || key;
  };

  SugarShopAssistant.prototype.bind = function () {
    var self = this;
    this.root.querySelectorAll("[data-sugar-sa-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.open();
      });
    });
    this.root.querySelectorAll("[data-sugar-sa-close]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.close();
      });
    });
    var reset = this.root.querySelector("[data-sugar-sa-reset]");
    if (reset) {
      reset.addEventListener("click", function () {
        self.resetSession();
      });
    }
    if (this.form) {
      this.form.addEventListener("submit", function (event) {
        event.preventDefault();
        self.sendMessage();
      });
    }
    if (this.input) {
      this.input.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;
        if (event.isComposing || event.keyCode === 229) return;
        if (event.shiftKey) return;
        event.preventDefault();
        self.sendMessage();
      });
    }
    this.bindComposerResize();
    if (this.workspace && typeof this.workspace.bind === "function") {
      this.workspace.bind(this.root);
    }
    var wsClose = this.root.querySelector("[data-sugar-sa-workspace-close]");
    if (wsClose) wsClose.setAttribute("aria-label", this.t("workspaceClose"));
    if (this.composerResize) {
      this.composerResize.setAttribute("aria-label", this.t("composerResize"));
      this.composerResize.setAttribute("title", this.t("composerResize"));
    }
    if (this.dialog) {
      this.dialog.addEventListener("click", function (event) {
        if (event.target === self.dialog) self.close();
      });
      this.dialog.addEventListener(
        "keydown",
        function (event) {
          if (event.key !== "Escape") return;
          if (!self.workspace || !self.workspace.isOpen()) return;
          event.preventDefault();
          event.stopPropagation();
          self.workspace.close();
        },
        true,
      );
    }
    if (this.config.displayMode === "embedded") {
      this.hydrate();
    }
  };

  SugarShopAssistant.prototype.open = function () {
    if (this.dialog) {
      if (typeof this.dialog.showModal === "function") this.dialog.showModal();
      else this.dialog.setAttribute("open", "");
    }
    if (!this.streamToken) this.hydrate();
    if (this.input) this.input.focus();
  };

  SugarShopAssistant.prototype.close = function () {
    if (this.config.displayMode === "embedded" || !this.dialog) return;
    if (typeof this.dialog.close === "function") this.dialog.close();
    else this.dialog.removeAttribute("open");
  };

  SugarShopAssistant.prototype.setBusy = function (busy) {
    this.busy = busy;
    if (this.sendBtn) this.sendBtn.disabled = busy;
    if (this.input) this.input.disabled = busy;
  };

  SugarShopAssistant.prototype.hydrate = function (reset) {
    var self = this;
    if (!this.config.enabled) {
      this.thread.innerHTML = "";
      this.appendEvent({ type: "error", message: this.t("errorDisabled") });
      return Promise.resolve();
    }
    var headers = { Accept: "application/json" };
    var init = { method: reset ? "POST" : "GET", headers: headers };
    if (reset) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify({ reset: true });
    }
    return fetch(this.config.sessionUrl || "/apps/sugar/shop/session", init)
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || self.t("errorSession"));
          return data;
        });
      })
      .then(function (data) {
        if (data.enabled === false) {
          self.appendEvent({ type: "error", message: self.t("errorDisabled") });
          return;
        }
        self.streamToken = data.streamToken || "";
        self.chatUrl = data.chatUrl || "";
        self.thread.innerHTML = "";
        self.lastCart = null;
        self.picked = {};
        self.selectedCart = {};
        self.recommended = {};
        self.listingFresh = true;
        if (self.workspace && self.workspace.close) self.workspace.close();
        var events = Array.isArray(data.events) ? data.events : [];
        if (!events.length) {
          self.renderEmpty();
        } else {
          events.forEach(function (event) {
            self.appendEvent(event);
          });
        }
      })
      .catch(function (err) {
        self.appendEvent({
          type: "error",
          message: err instanceof Error ? err.message : self.t("errorSession"),
        });
      });
  };

  SugarShopAssistant.prototype.resetSession = function () {
    this.hydrate(true);
  };

  SugarShopAssistant.prototype.renderEmpty = function () {
    if (!this.thread || !el.empty) return;
    this.thread.innerHTML = "";
    this.thread.appendChild(el.empty(this.t("empty")));
  };

  SugarShopAssistant.prototype.appendEvent = function (event) {
    var self = this;
    if (!event || !this.thread) return;
    if (event.type === "thinking") {
      if (el.ensureThinking) el.ensureThinking(this.thread, this.t("thinking"));
      this.thread.scrollTop = this.thread.scrollHeight;
      return;
    }
    if (el.removeThinking) el.removeThinking(this.thread);
    if (event.type === "done") return;

    if (el.clearEmpty) el.clearEmpty(this.thread);
    if (event.type === "text" && event.role === "user") {
      this.listingFresh = true;
    }
    if (event.type === "text" && event.role !== "user") {
      if (el.appendAssistantText) el.appendAssistantText(this.thread, event.text || "");
    } else if (event.type === "text" || event.type === "error") {
      this.thread.appendChild(
        el.message(event.text || event.message || "", event.role),
      );
    } else if (event.type === "products" && el.products) {
      var incoming = event.items || [];
      var existing = this.thread.querySelector(".sugar-sa-products");
      var next = incoming;
      if (!this.listingFresh && existing && existing.getItems && el.mergeProductItems) {
        next = el.mergeProductItems(existing.getItems(), incoming);
      }
      this.listingFresh = false;
      if (existing && existing.setItems) {
        existing.setItems(next);
        if (existing.setRecommended) existing.setRecommended(this.recommended, { keepPage: true });
        this.thread.appendChild(existing);
      } else {
        this.thread.appendChild(
          el.products(
            next,
            this.i18n,
            this.selectedCart,
            function (item, on) {
              self.togglePickedProduct(item, on);
            },
            this.recommended,
          ),
        );
      }
    } else if (event.type === "choice" && el.ask) {
      this.thread.appendChild(
        el.ask(
          event,
          this.i18n,
          function (payload) {
            if (self.busy) return;
            self.postInput(payload);
          },
          function () {
            self.sendMessage();
          },
        ),
      );
    } else if (event.type === "cart") {
      this.markRecommendedInListing(event);
    }
    this.thread.scrollTop = this.thread.scrollHeight;
  };

  SugarShopAssistant.prototype.productToLine = function (item) {
    return {
      variantId: String((item && item.variantId) || ""),
      productId: String((item && item.productId) || ""),
      title: (item && item.title) || "",
      handle: (item && item.handle) || "",
      quantity: Number(item && item.quantity) > 0 ? Number(item.quantity) : 1,
      priceCents: Number(item && item.priceCents) || 0,
      currency: (item && item.currency) || this.config.currency || "TRY",
      imageUrl: (item && item.imageUrl) || "",
    };
  };

  SugarShopAssistant.prototype.cartFromPicked = function (hint) {
    var items = [];
    var currency =
      (hint && hint.currency) ||
      (this.lastCart && this.lastCart.currency) ||
      this.config.currency ||
      "TRY";
    Object.keys(this.picked).forEach(function (id) {
      var line = this.picked[id];
      if (line) items.push(line);
      if (line && line.currency) currency = line.currency;
    }, this);
    return {
      type: "cart",
      items: items,
      total: 0,
      remaining: 0,
      dropped: (hint && hint.dropped) || (this.lastCart && this.lastCart.dropped) || [],
      currency: currency,
      budget: (hint && hint.budget) || (this.lastCart && this.lastCart.budget) || 0,
    };
  };

  SugarShopAssistant.prototype.cartWorkspaceCtx = function () {
    var self = this;
    return {
      t: function (key) {
        return self.t(key);
      },
      i18n: this.i18n,
      event: this.lastCart,
      selected: this.selectedCart,
      addCartLabel: this.config.addCartLabel || this.t("cartHeading"),
      onToggle: function (id, checked) {
        self.selectedCart[id] = !!checked;
        if (!checked) {
          delete self.selectedCart[id];
          delete self.picked[id];
        } else if (self.lastCart && self.lastCart.items) {
          self.lastCart.items.forEach(function (line) {
            if (String(line.variantId) === id) self.picked[id] = line;
          });
        }
        self.lastCart = self.cartFromPicked();
        self.syncWorkspaceCart();
        if (el.syncProductSelection) {
          el.syncProductSelection(self.thread, self.selectedCart, self.i18n, self.recommended);
        }
      },
      onAddCart: function () {
        self.addProposedCart();
      },
    };
  };

  SugarShopAssistant.prototype.syncWorkspaceCart = function () {
    if (!this.workspace) return;
    var empty = !this.lastCart || !this.lastCart.items || !this.lastCart.items.length;
    if (empty) {
      this.workspace.closePane("cart");
      return;
    }
    var ctx = this.cartWorkspaceCtx();
    if (this.workspace.isOpen("cart")) this.workspace.update("cart", ctx);
    else this.workspace.open("cart", ctx);
  };

  SugarShopAssistant.prototype.togglePickedProduct = function (item, on) {
    var line = this.productToLine(item);
    var id = line.variantId;
    if (!id) return;
    this.selectedCart[id] = !!on;
    if (on) this.picked[id] = line;
    else {
      delete this.selectedCart[id];
      delete this.picked[id];
    }
    this.lastCart = this.cartFromPicked();
    this.syncWorkspaceCart();
    if (el.syncProductSelection) {
      el.syncProductSelection(this.thread, this.selectedCart, this.i18n, this.recommended);
    }
  };

  SugarShopAssistant.prototype.lineToProduct = function (line) {
    return {
      productId: String((line && line.productId) || ""),
      variantId: String((line && line.variantId) || ""),
      title: (line && line.title) || "",
      handle: (line && line.handle) || "",
      imageUrl: (line && line.imageUrl) || "",
      price: "",
      priceCents: Number(line && line.priceCents) || 0,
      currency: (line && line.currency) || this.config.currency || "TRY",
      available: true,
    };
  };

  SugarShopAssistant.prototype.markRecommendedInListing = function (event) {
    var self = this;
    var incoming = [];
    (event && event.items ? event.items : []).forEach(function (line) {
      var id = String(line.variantId || "");
      if (!id) return;
      self.recommended[id] = true;
      incoming.push(self.lineToProduct(line));
    });
    if (this.lastCart) {
      this.lastCart.budget = (event && event.budget) || this.lastCart.budget;
      this.lastCart.dropped = (event && event.dropped) || this.lastCart.dropped;
    }
    if (!incoming.length || !el.products) {
      if (el.syncProductSelection) {
        el.syncProductSelection(this.thread, this.selectedCart, this.i18n, this.recommended);
      }
      return;
    }
    var existing = this.thread.querySelector(".sugar-sa-products");
    var next = incoming;
    if (existing && existing.getItems && el.mergeProductItems) {
      next = el.mergeProductItems(incoming, existing.getItems());
    }
    if (existing && existing.setItems) {
      existing.setItems(next);
      if (existing.setRecommended) existing.setRecommended(this.recommended);
      this.thread.appendChild(existing);
      return;
    }
    this.thread.appendChild(
      el.products(
        next,
        this.i18n,
        this.selectedCart,
        function (item, on) {
          self.togglePickedProduct(item, on);
        },
        this.recommended,
      ),
    );
  };

  SugarShopAssistant.prototype.composerHeightBounds = function () {
    var chatH = this.chat ? this.chat.clientHeight : 0;
    var max = 280;
    if (chatH > 0) max = Math.min(280, Math.max(72, Math.floor(chatH * 0.42)));
    return { min: 72, max: max };
  };

  SugarShopAssistant.prototype.applyComposerHeight = function (height) {
    if (!this.form) return 72;
    var bounds = this.composerHeightBounds();
    var next = Math.max(bounds.min, Math.min(bounds.max, Math.round(height)));
    this.form.style.setProperty("--sugar-sa-composer-h", next + "px");
    if (this.composerResize) {
      this.composerResize.setAttribute("aria-valuemin", String(bounds.min));
      this.composerResize.setAttribute("aria-valuemax", String(bounds.max));
      this.composerResize.setAttribute("aria-valuenow", String(next));
    }
    try {
      sessionStorage.setItem("sugar-sa-composer-h", String(next));
    } catch (err) {}
    return next;
  };

  SugarShopAssistant.prototype.readComposerHeight = function () {
    try {
      var stored = Number(sessionStorage.getItem("sugar-sa-composer-h"));
      if (Number.isFinite(stored) && stored > 0) return stored;
    } catch (err) {}
    return 72;
  };

  SugarShopAssistant.prototype.bindComposerResize = function () {
    var self = this;
    if (!this.form || !this.composerResize) return;
    this.applyComposerHeight(this.readComposerHeight());

    function onPointerMove(event) {
      if (self.composerDragStart == null) return;
      self.applyComposerHeight(self.composerDragStart - event.clientY);
    }

    function onPointerUp() {
      self.composerDragStart = null;
      self.composerResize.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    this.composerResize.addEventListener("pointerdown", function (event) {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      var current = self.form.offsetHeight
        ? parseFloat(getComputedStyle(self.form).getPropertyValue("--sugar-sa-composer-h")) ||
          self.readComposerHeight()
        : self.readComposerHeight();
      self.composerDragStart = event.clientY + current;
      self.composerResize.classList.add("is-dragging");
      if (self.composerResize.setPointerCapture) {
        try {
          self.composerResize.setPointerCapture(event.pointerId);
        } catch (err) {}
      }
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });

    this.composerResize.addEventListener("keydown", function (event) {
      var bounds = self.composerHeightBounds();
      var current =
        parseFloat(getComputedStyle(self.form).getPropertyValue("--sugar-sa-composer-h")) ||
        self.readComposerHeight();
      if (event.key === "ArrowUp") {
        event.preventDefault();
        self.applyComposerHeight(current + 16);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        self.applyComposerHeight(current - 16);
      } else if (event.key === "Home") {
        event.preventDefault();
        self.applyComposerHeight(bounds.min);
      } else if (event.key === "End") {
        event.preventDefault();
        self.applyComposerHeight(bounds.max);
      }
    });
  };

  SugarShopAssistant.prototype.sendMessage = function () {
    if (this.busy) return;
    var otherText = el.askOtherText ? el.askOtherText(this.thread) : "";
    if (otherText) {
      if (el.lockAsk) el.lockAsk(el.activeAsk(this.thread));
      if (this.input) this.input.value = "";
      this.appendEvent({ type: "text", text: otherText, role: "user" });
      this.postInput({ type: "choice", selected: "other", label: otherText });
      return;
    }
    var text = this.input && this.input.value ? this.input.value.trim() : "";
    if (!text) return;
    this.input.value = "";
    this.appendEvent({ type: "text", text: text, role: "user" });
    this.postInput({ type: "message", text: text });
  };

  SugarShopAssistant.prototype.postInput = function (payload) {
    var self = this;
    if (payload && (payload.type === "message" || payload.type === "choice")) {
      this.listingFresh = true;
    }
    if (!this.streamToken || !this.chatUrl) {
      this.appendEvent({ type: "error", message: this.t("errorSession") });
      return;
    }
    this.setBusy(true);
    this.appendEvent({ type: "thinking" });
    fetch(this.chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: "Bearer " + this.streamToken,
      },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (!res.ok || !res.body) {
          return res.text().then(function () {
            throw new Error(self.t("errorGeneric"));
          });
        }
        return self.readSse(res);
      })
      .catch(function (err) {
        self.appendEvent({
          type: "error",
          message: err instanceof Error ? err.message : self.t("errorGeneric"),
        });
      })
      .finally(function () {
        self.setBusy(false);
      });
  };

  SugarShopAssistant.prototype.readSse = function (response) {
    var self = this;
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    function consume(block) {
      var event = "message";
      var data = "";
      block.split(/\r?\n/).forEach(function (line) {
        if (line.indexOf("event:") === 0) event = line.slice(6).trim();
        if (line.indexOf("data:") === 0) data += line.slice(5).trim();
      });
      if (!data) return;
      try {
        var parsed = JSON.parse(data);
        if (parsed && !parsed.type) parsed.type = event;
        self.appendEvent(parsed);
      } catch (err) {
        self.appendEvent({ type: "text", text: data });
      }
    }
    function pump() {
      return reader.read().then(function (result) {
        if (result.done) {
          if (buffer.trim()) consume(buffer);
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        var parts = buffer.split(/\n\n/);
        buffer = parts.pop() || "";
        parts.forEach(consume);
        return pump();
      });
    }
    return pump();
  };

  SugarShopAssistant.prototype.collectCartSectionIds = function () {
    var ids = [];
    var seen = {};
    document.querySelectorAll("[id^='shopify-section-']").forEach(function (node) {
      var id = String(node.id || "").replace(/^shopify-section-/, "");
      if (!id || seen[id]) return;
      var hay = (id + " " + (node.className || "")).toLowerCase();
      if (!/cart|header|navbar|nav-bar|announcement/.test(hay)) return;
      seen[id] = true;
      ids.push(id);
    });
    return ids;
  };

  SugarShopAssistant.prototype.applyCartSections = function (sections) {
    if (!sections || typeof sections !== "object") return;
    Object.keys(sections).forEach(function (id) {
      var html = sections[id];
      if (!html) return;
      var current = document.getElementById("shopify-section-" + id);
      if (!current) return;
      var tmp = document.createElement("div");
      tmp.innerHTML = String(html).trim();
      var incoming =
        tmp.querySelector("#shopify-section-" + id) || tmp.firstElementChild;
      if (incoming && incoming.id === current.id) current.replaceWith(incoming);
      else if (incoming) current.innerHTML = incoming.innerHTML;
      else current.innerHTML = html;
    });
  };

  SugarShopAssistant.prototype.notifyThemeCartUpdated = function (addResponse) {
    var self = this;
    if (addResponse && addResponse.sections) this.applyCartSections(addResponse.sections);
    fetch("/cart.js")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (cart) {
        if (!cart) return;
        ["cart:updated", "cart:refresh", "shopify-cart:updated"].forEach(function (name) {
          document.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: { cart: cart } }));
        });
        var sectionIds = self.collectCartSectionIds();
        if (!sectionIds.length) return null;
        var root =
          (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
        return fetch(root + "?sections=" + encodeURIComponent(sectionIds.join(",")), {
          headers: { Accept: "application/json" },
        }).then(function (res) {
          return res.ok ? res.json() : null;
        });
      })
      .then(function (sections) {
        if (sections) self.applyCartSections(sections);
      })
      .catch(function () {});
  };

  SugarShopAssistant.prototype.addProposedCart = function () {
    var self = this;
    if (!this.lastCart || !this.lastCart.items || !this.lastCart.items.length) return;
    var chosen = el.selectedCartItems
      ? el.selectedCartItems(this.lastCart.items, this.selectedCart)
      : this.lastCart.items;
    var items = chosen
      .map(function (line) {
        return { id: Number(line.variantId), quantity: line.quantity || 1 };
      })
      .filter(function (line) {
        return Number.isFinite(line.id) && line.id > 0;
      });
    if (!items.length) return;
    var addBtn = this.root.querySelector(".sugar-sa-workspace .sugar-sa-primary");
    if (addBtn) addBtn.disabled = true;
    var sectionIds = this.collectCartSectionIds();
    var payload = { items: items };
    if (sectionIds.length) {
      payload.sections = sectionIds.join(",");
      payload.sections_url = window.location.pathname || "/";
    }
    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.description || data.message || self.t("errorCart"));
          return data;
        });
      })
      .then(function (data) {
        if (addBtn) addBtn.disabled = false;
        self.appendEvent({ type: "text", text: self.t("cartSuccess") });
        self.notifyThemeCartUpdated(data);
        self.postInput({ type: "add_cart_result", ok: true });
      })
      .catch(function (err) {
        if (addBtn) addBtn.disabled = false;
        var message = err instanceof Error ? err.message : self.t("errorCart");
        self.appendEvent({ type: "error", message: message });
        self.postInput({ type: "add_cart_result", ok: false, error: message });
      });
  };

  function boot() {
    document.querySelectorAll("[data-sugar-sa-root]").forEach(function (root) {
      if (root.__sugarSa) return;
      root.__sugarSa = new SugarShopAssistant(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : this);
