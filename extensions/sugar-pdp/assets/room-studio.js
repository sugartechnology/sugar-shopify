(function () {
  "use strict";

  var STEPS = ["studio", "upload", "loading", "result"];
  var ATTEMPT_STORAGE_KEY = "sugar_rs_design_attempts";

  function parseJson(raw, fallback) {
    try {
      return JSON.parse(raw || "");
    } catch {
      return fallback;
    }
  }

  function normalizePriceToCents(raw) {
    if (raw === null || raw === undefined || raw === "") return 0;
    var str = String(raw).trim();
    if (str.includes(".")) {
      var major = parseFloat(str);
      return Number.isFinite(major) ? Math.round(major * 100) : 0;
    }
    var n = Number(str);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }

  function formatMoney(rawAmount, currency, locale) {
    var cents = normalizePriceToCents(rawAmount);
    var amount = cents / 100;
    try {
      return new Intl.NumberFormat(locale || undefined, {
        style: "currency",
        currency: currency || "TRY",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return amount + " " + (currency || "TRY");
    }
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || "").split(",")[1] || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function isRemoteImageUrl(imageUrl) {
    return /^https?:\/\//i.test(String(imageUrl || ""));
  }

  function getCartSafeDesignImageUrl(imageUrl) {
    var url = String(imageUrl || "");
    if (!isRemoteImageUrl(url)) return "";
    if (url.length > 2048) return "";
    return url;
  }

  function readAttemptStore() {
    try {
      var raw = localStorage.getItem(ATTEMPT_STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeAttemptStore(store) {
    try {
      localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* ignore */
    }
  }

  function getAttemptCount(shopKey) {
    var store = readAttemptStore();
    var n = Number(store[String(shopKey)] || 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function recordAttempt(shopKey) {
    var store = readAttemptStore();
    var key = String(shopKey);
    var next = getAttemptCount(key) + 1;
    store[key] = next;
    writeAttemptStore(store);
    return next;
  }

  function isShopifyAdminPreview() {
    try {
      return !!(window.Shopify && window.Shopify.designMode);
    } catch {
      return false;
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function SugarRoomStudio(root) {
    this.root = root;
    this.config = parseJson(root.dataset.sugarRsConfig, {});
    this.i18n = this.config.i18n || {};
    this.locale = this.config.locale || undefined;
    this.displayMode = this.config.displayMode === "embedded" ? "embedded" : "modal";
    this.catalog = this.normalizeCatalog(parseJson(root.dataset.sugarRsCatalog, {}));
    this.maxProducts = Math.max(1, Math.min(5, Number(this.config.maxProducts || 5)));
    this.maxDesignAttempts = Math.max(1, Number(this.config.maxDesignAttempts || 3));
    this.unlimitedAttempts = isShopifyAdminPreview();
    this.attemptCount = 0;
    this.step = "studio";
    this.activeCategoryId = "all";
    this.categoryQuery = "";
    this.productQuery = "";
    this.selectedIds = [];
    this.roomFile = null;
    this.roomPreviewUrl = "";
    this.designResult = null;
    this.resultSelections = {};
    this.loadingTimer = null;
    this.toastTimer = null;

    this.init();
  }

  SugarRoomStudio.prototype.t = function (key, fallback) {
    var val = this.i18n[key];
    return val != null && val !== "" ? val : fallback || key;
  };

  SugarRoomStudio.prototype.tReplace = function (key, fallback, vars) {
    var text = this.t(key, fallback);
    Object.keys(vars || {}).forEach(function (k) {
      text = text.replace(new RegExp("\\{\\{" + k + "\\}\\}", "g"), String(vars[k]));
    });
    return text;
  };

  SugarRoomStudio.prototype.normalizeCatalog = function (raw) {
    var products = Array.isArray(raw.products) ? raw.products : [];
    var categories = Array.isArray(raw.categories) ? raw.categories : [];
    var byId = {};
    products.forEach(function (p) {
      if (!p || !p.productId) return;
      byId[String(p.productId)] = {
        productId: String(p.productId),
        variantId: String(p.variantId || ""),
        title: p.title || "",
        handle: p.handle || "",
        price: p.price,
        currency: p.currency || "TRY",
        imageUrl: p.imageUrl || "",
        images: Array.isArray(p.images) ? p.images : [],
        categoryIds: Array.isArray(p.categoryIds)
          ? p.categoryIds.map(String)
          : [],
      };
    });

    var productList = Object.keys(byId).map(function (id) {
      return byId[id];
    });

    // Rebuild category membership from category productIds (source of truth for filtering).
    productList.forEach(function (p) {
      p.categoryIds = [];
    });

    var cats = categories
      .filter(function (c) {
        return c && c.id;
      })
      .map(function (c) {
        var ids = Array.isArray(c.productIds)
          ? c.productIds.map(String).filter(function (id) {
              return !!byId[id];
            })
          : [];
        if (String(c.id) === "all") {
          ids = productList.map(function (p) {
            return p.productId;
          });
        } else {
          ids.forEach(function (id) {
            if (byId[id].categoryIds.indexOf(String(c.id)) === -1) {
              byId[id].categoryIds.push(String(c.id));
            }
          });
        }
        return {
          id: String(c.id),
          title: c.title || String(c.id),
          productIds: ids,
          count: ids.length,
        };
      });

    if (!cats.some(function (c) {
      return c.id === "all";
    })) {
      cats.unshift({
        id: "all",
        title: "All Products",
        productIds: productList.map(function (p) {
          return p.productId;
        }),
        count: productList.length,
      });
    } else {
      cats = cats.map(function (c) {
        if (c.id !== "all") return c;
        var ids = productList.map(function (p) {
          return p.productId;
        });
        return { id: "all", title: c.title || "All Products", productIds: ids, count: ids.length };
      });
    }

    return { products: productList, categories: cats, byId: byId };
  };

  SugarRoomStudio.prototype.init = function () {
    this.cacheDom();
    this.bindEvents();
    this.syncAttemptCount();
    this.renderCategories();
    this.renderGrid();
    this.renderSlots();
    this.renderSelectedCount();
    this.updateGenerateState();
    if (this.config.customCss) {
      var style = document.createElement("style");
      style.textContent = this.config.customCss;
      this.root.appendChild(style);
    }
    if (this.displayMode === "modal") {
      this.portalDialog();
    }
    this.hydrateCatalog();
  };

  SugarRoomStudio.prototype.mapAjaxProduct = function (raw) {
    if (!raw || !raw.id) return null;
    var variant = (raw.variants && raw.variants[0]) || {};
    var images = Array.isArray(raw.images)
      ? raw.images
          .map(function (img) {
            return img && (img.src || img);
          })
          .filter(Boolean)
          .slice(0, 3)
      : [];
    var imageUrl =
      raw.featured_image ||
      (typeof raw.image === "string" ? raw.image : raw.image && raw.image.src) ||
      images[0] ||
      "";
    return {
      productId: String(raw.id),
      variantId: String(variant.id || ""),
      title: raw.title || "",
      handle: raw.handle || "",
      price: variant.price != null ? variant.price : "0",
      currency: this.config.currency || "TRY",
      imageUrl: imageUrl,
      images: images,
      categoryIds: [],
    };
  };

  SugarRoomStudio.prototype.fetchCollectionPage = async function (handle, page) {
    var url =
      "/collections/" +
      encodeURIComponent(handle) +
      "/products.json?limit=250&page=" +
      page;
    var res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return [];
    var data = await res.json();
    return Array.isArray(data.products) ? data.products : [];
  };

  SugarRoomStudio.prototype.fetchAllCollectionProducts = async function (handle) {
    var all = [];
    var page = 1;
    while (page <= 40) {
      var batch = await this.fetchCollectionPage(handle, page);
      if (!batch.length) break;
      all = all.concat(batch);
      if (batch.length < 250) break;
      page += 1;
    }
    return all;
  };

  SugarRoomStudio.prototype.mergeProductsIntoCatalog = function (products, categoryId) {
    var self = this;
    var byId = Object.assign({}, this.catalog.byId);
    var categories = this.catalog.categories.slice();

    products.forEach(function (p) {
      if (!p || !p.productId) return;
      var existing = byId[p.productId];
      if (existing) {
        if (categoryId && categoryId !== "all") {
          if (existing.categoryIds.indexOf(categoryId) === -1) {
            existing.categoryIds.push(categoryId);
          }
        }
        return;
      }
      byId[p.productId] = p;
      if (categoryId && categoryId !== "all") {
        p.categoryIds = [categoryId];
      }
    });

    var productList = Object.keys(byId).map(function (id) {
      return byId[id];
    });

    categories = categories.map(function (c) {
      if (c.id === "all") {
        return {
          id: "all",
          title: c.title,
          productIds: productList.map(function (p) {
            return p.productId;
          }),
          count: productList.length,
        };
      }
      if (categoryId && c.id === categoryId) {
        var ids = productList
          .filter(function (p) {
            return p.categoryIds.indexOf(categoryId) !== -1;
          })
          .map(function (p) {
            return p.productId;
          });
        // Prefer ids from fetched products for this handle
        var fromFetch = products.map(function (p) {
          return p.productId;
        });
        var merged = {};
        ids.concat(fromFetch).forEach(function (id) {
          if (byId[id]) merged[id] = true;
        });
        var finalIds = Object.keys(merged);
        return {
          id: c.id,
          title: c.title,
          productIds: finalIds,
          count: finalIds.length,
        };
      }
      return c;
    });

    this.catalog = {
      products: productList,
      categories: categories,
      byId: byId,
    };
  };

  SugarRoomStudio.prototype.hydrateCatalog = async function () {
    var handles = Array.isArray(this.config.catalogHandles)
      ? this.config.catalogHandles.filter(Boolean)
      : [];
    // Always page beyond Liquid's ~50 product cap when handles are configured
    if (!handles.length) return;

    var self = this;
    if (this.grid) {
      this.grid.setAttribute("aria-busy", "true");
    }

    try {
      for (var i = 0; i < handles.length; i++) {
        var handle = String(handles[i]);
        var rawProducts = await this.fetchAllCollectionProducts(handle);
        var mapped = rawProducts
          .map(function (raw) {
            return self.mapAjaxProduct(raw);
          })
          .filter(Boolean);
        self.mergeProductsIntoCatalog(mapped, handle === "all" ? "all" : handle);
      }
      self.catalog = self.normalizeCatalog({
        products: self.catalog.products,
        categories: self.catalog.categories,
      });
      self.renderCategories();
      self.renderGrid();
      self.renderSlots();
      self.renderSelectedCount();
    } catch (err) {
      console.warn("[Sugar Curator] catalog hydrate failed", err);
    } finally {
      if (this.grid) this.grid.removeAttribute("aria-busy");
    }
  };

  SugarRoomStudio.prototype.cacheDom = function () {
    this.dialog = this.root.querySelector("[data-sugar-rs-dialog]");
    this.shell = this.root.querySelector("[data-sugar-rs-shell]") || this.dialog;
    this.openBtn = this.root.querySelector("[data-sugar-rs-open]");
    this.closeBtn = this.root.querySelector("[data-sugar-rs-close]");
    this.toastEl = this.root.querySelector("[data-sugar-rs-toast]");
    this.catList = this.root.querySelector("[data-sugar-rs-cat-list]");
    this.catSearch = this.root.querySelector("[data-sugar-rs-cat-search]");
    this.productSearch = this.root.querySelector("[data-sugar-rs-product-search]");
    this.grid = this.root.querySelector("[data-sugar-rs-grid]");
    this.emptyEl = this.root.querySelector("[data-sugar-rs-empty]");
    this.browseTitle = this.root.querySelector("[data-sugar-rs-browse-title]");
    this.selectedCountEl = this.root.querySelector("[data-sugar-rs-selected-count]");
    this.slotsEl = this.root.querySelector("[data-sugar-rs-slots]");
    this.slotsTitle = this.root.querySelector("[data-sugar-rs-slots-title]");
    this.slotsHint = this.root.querySelector("[data-sugar-rs-slots-hint]");
    this.roomImg = this.root.querySelector("[data-sugar-rs-room-img]");
    this.roomUploadBtn = this.root.querySelector("[data-sugar-rs-room-upload-btn]");
    this.roomFileInput = this.root.querySelector("[data-sugar-rs-room-file]");
    this.roomActions = this.root.querySelector("[data-sugar-rs-room-actions]");
    this.changeRoomBtn = this.root.querySelector("[data-sugar-rs-change-room]");
    this.removeRoomBtn = this.root.querySelector("[data-sugar-rs-remove-room]");
    this.clearBtn = this.root.querySelector("[data-sugar-rs-clear]");
    this.generateBtn = this.root.querySelector("[data-sugar-rs-generate]");
    this.uploadFocusBtn = this.root.querySelector("[data-sugar-rs-upload-focus-btn]");
    this.backStudioBtn = this.root.querySelector("[data-sugar-rs-back-studio]");
    this.backStudioResultBtn = this.root.querySelector("[data-sugar-rs-back-studio-result]");
    this.redesignBtn = this.root.querySelector("[data-sugar-rs-redesign]");
    this.addCartBtn = this.root.querySelector("[data-sugar-rs-add-cart]");
    this.loadingBar = this.root.querySelector("[data-sugar-rs-loading-bar]");
    this.loadingPct = this.root.querySelector("[data-sugar-rs-loading-pct]");
    this.compareEl = this.root.querySelector("[data-sugar-rs-compare]");
    this.compareOrigin = this.root.querySelector("[data-sugar-rs-compare-origin]");
    this.compareDesign = this.root.querySelector("[data-sugar-rs-compare-design]");
    this.compareRange = this.root.querySelector("[data-sugar-rs-compare-range]");
    this.resultList = this.root.querySelector("[data-sugar-rs-result-list]");
    this.stepEls = {};
    this.stepIndicators = {};
    var self = this;
    STEPS.forEach(function (step) {
      self.stepEls[step] = self.root.querySelector('[data-sugar-rs-step="' + step + '"]');
    });
    ["studio", "upload", "result"].forEach(function (step) {
      self.stepIndicators[step] = self.root.querySelector(
        '[data-sugar-rs-step-indicator="' + step + '"]',
      );
    });
  };

  SugarRoomStudio.prototype.portalDialog = function () {
    if (!this.dialog || this.dialog.parentElement === document.body) return;
    // Copy theme CSS vars onto the dialog — it leaves .sugar-rs-root when moved to body
    var rootStyle = this.root.getAttribute("style") || "";
    if (rootStyle) {
      var existing = this.dialog.getAttribute("style") || "";
      this.dialog.setAttribute("style", (existing + ";" + rootStyle).replace(/^;+/, ""));
    }
    document.body.appendChild(this.dialog);
  };

  SugarRoomStudio.prototype.bindEvents = function () {
    var self = this;

    if (this.openBtn) {
      this.openBtn.addEventListener("click", function () {
        self.open();
      });
    }
    if (this.closeBtn) {
      this.closeBtn.addEventListener("click", function () {
        self.close();
      });
    }
    if (this.dialog) {
      this.dialog.addEventListener("cancel", function (e) {
        e.preventDefault();
        self.close();
      });
      this.dialog.addEventListener("click", function (e) {
        if (e.target === self.dialog) self.close();
      });
    }

    if (this.catSearch) {
      this.catSearch.addEventListener("input", function () {
        self.categoryQuery = String(self.catSearch.value || "").trim().toLowerCase();
        self.renderCategories();
      });
    }
    if (this.productSearch) {
      this.productSearch.addEventListener("input", function () {
        self.productQuery = String(self.productSearch.value || "").trim().toLowerCase();
        self.renderGrid();
      });
    }

    if (this.roomUploadBtn) {
      this.roomUploadBtn.addEventListener("click", function () {
        if (self.roomFileInput) self.roomFileInput.click();
      });
    }
    if (this.changeRoomBtn) {
      this.changeRoomBtn.addEventListener("click", function () {
        if (self.roomFileInput) self.roomFileInput.click();
      });
    }
    if (this.removeRoomBtn) {
      this.removeRoomBtn.addEventListener("click", function () {
        self.clearRoom();
      });
    }
    if (this.roomFileInput) {
      this.roomFileInput.addEventListener("change", function () {
        var file = self.roomFileInput.files && self.roomFileInput.files[0];
        if (file) self.handleRoomFile(file);
        self.roomFileInput.value = "";
      });
    }

    if (this.clearBtn) {
      this.clearBtn.addEventListener("click", function () {
        self.clearSelection();
      });
    }
    if (this.generateBtn) {
      this.generateBtn.addEventListener("click", function () {
        self.onGenerateClick();
      });
    }
    if (this.uploadFocusBtn) {
      this.uploadFocusBtn.addEventListener("click", function () {
        if (self.roomFileInput) self.roomFileInput.click();
      });
    }
    if (this.backStudioBtn) {
      this.backStudioBtn.addEventListener("click", function () {
        self.setStep("studio");
      });
    }
    if (this.backStudioResultBtn) {
      this.backStudioResultBtn.addEventListener("click", function () {
        self.setStep("studio");
      });
    }
    if (this.redesignBtn) {
      this.redesignBtn.addEventListener("click", function () {
        self.runDesign({ isRedesign: true });
      });
    }
    if (this.addCartBtn) {
      this.addCartBtn.addEventListener("click", function () {
        self.addDesignToCart();
      });
    }
    if (this.compareRange && this.compareEl) {
      this.compareRange.addEventListener("input", function () {
        self.compareEl.style.setProperty(
          "--sugar-rs-compare",
          String(self.compareRange.value) + "%",
        );
      });
    }
  };

  SugarRoomStudio.prototype.open = function () {
    if (this.displayMode !== "modal" || !this.dialog) return;
    if (typeof this.dialog.showModal === "function") {
      this.dialog.showModal();
    } else {
      this.dialog.setAttribute("open", "");
    }
    this.setStep("studio");
  };

  SugarRoomStudio.prototype.close = function () {
    if (this.displayMode !== "modal" || !this.dialog) return;
    if (typeof this.dialog.close === "function") {
      this.dialog.close();
    } else {
      this.dialog.removeAttribute("open");
    }
  };

  SugarRoomStudio.prototype.setStep = function (step) {
    if (STEPS.indexOf(step) === -1) return;
    if (step !== "loading") this.stopLoadingProgress();
    this.step = step;
    var self = this;
    STEPS.forEach(function (s) {
      if (self.stepEls[s]) {
        self.stepEls[s].classList.toggle("is-active", s === step);
      }
    });

    var indicatorStep = step === "loading" ? "result" : step;
    ["studio", "upload", "result"].forEach(function (s) {
      var el = self.stepIndicators[s];
      if (!el) return;
      var active = s === indicatorStep;
      var done =
        (s === "studio" && (indicatorStep === "upload" || indicatorStep === "result")) ||
        (s === "upload" && indicatorStep === "result");
      el.classList.toggle("is-active", active);
      el.classList.toggle("is-done", done && !active);
    });
  };

  SugarRoomStudio.prototype.getShopAttemptKey = function () {
    return String(this.config.shopDomain || "shop") + ":curator";
  };

  SugarRoomStudio.prototype.syncAttemptCount = function () {
    this.attemptCount = this.unlimitedAttempts
      ? 0
      : getAttemptCount(this.getShopAttemptKey());
  };

  SugarRoomStudio.prototype.canGenerate = function () {
    if (this.unlimitedAttempts) return true;
    return this.attemptCount < this.maxDesignAttempts;
  };

  SugarRoomStudio.prototype.getActiveCategory = function () {
    var self = this;
    return (
      this.catalog.categories.find(function (c) {
        return c.id === self.activeCategoryId;
      }) || this.catalog.categories[0]
    );
  };

  SugarRoomStudio.prototype.renderCategories = function () {
    if (!this.catList) return;
    var self = this;
    var q = this.categoryQuery;
    var html = "";
    this.catalog.categories.forEach(function (cat) {
      if (q && String(cat.title || "").toLowerCase().indexOf(q) === -1) return;
      var active = cat.id === self.activeCategoryId ? " is-active" : "";
      html +=
        '<li><button type="button" class="sugar-rs-cat-item' +
        active +
        '" data-cat-id="' +
        escapeHtml(cat.id) +
        '" role="option" aria-selected="' +
        (cat.id === self.activeCategoryId ? "true" : "false") +
        '">' +
        '<span class="sugar-rs-cat-item__icon" aria-hidden="true">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M4 7h16M4 12h16M4 17h10"/></svg>' +
        "</span>" +
        '<span class="sugar-rs-cat-item__label">' +
        escapeHtml(cat.title) +
        "</span>" +
        '<span class="sugar-rs-cat-item__count">' +
        escapeHtml(String(cat.count)) +
        "</span>" +
        "</button></li>";
    });
    this.catList.innerHTML = html;
    this.catList.querySelectorAll("[data-cat-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.activeCategoryId = btn.getAttribute("data-cat-id") || "all";
        self.renderCategories();
        self.renderGrid();
      });
    });
  };

  SugarRoomStudio.prototype.getVisibleProducts = function () {
    var cat = this.getActiveCategory();
    var ids = cat ? cat.productIds : [];
    var self = this;
    var q = this.productQuery;
    return ids
      .map(function (id) {
        return self.catalog.byId[id];
      })
      .filter(function (p) {
        if (!p) return false;
        if (!q) return true;
        return String(p.title || "")
          .toLowerCase()
          .indexOf(q) !== -1;
      });
  };

  SugarRoomStudio.prototype.renderGrid = function () {
    if (!this.grid) return;
    var products = this.getVisibleProducts();
    var cat = this.getActiveCategory();
    if (this.browseTitle && cat) this.browseTitle.textContent = cat.title;
    if (this.emptyEl) this.emptyEl.hidden = products.length > 0;

    if (this.catalog.products.length === 0) {
      this.grid.innerHTML = "";
      if (this.emptyEl) {
        this.emptyEl.hidden = false;
        this.emptyEl.textContent = this.t(
          "errorNoCatalog",
          "No products configured. Select collections in the theme editor.",
        );
      }
      return;
    }

    var self = this;
    var atLimit = this.selectedIds.length >= this.maxProducts;
    var html = "";
    products.forEach(function (p) {
      var selected = self.selectedIds.indexOf(p.productId) !== -1;
      var disabled = !selected && atLimit;
      var price = formatMoney(p.price, p.currency, self.locale);
      html +=
        '<article class="sugar-rs-card' +
        (selected ? " is-selected" : "") +
        '" data-product-id="' +
        escapeHtml(p.productId) +
        '">' +
        '<div class="sugar-rs-card__media">' +
        (p.imageUrl
          ? '<img src="' + escapeHtml(p.imageUrl) + '" alt="" loading="lazy">'
          : "") +
        "</div>" +
        '<button type="button" class="sugar-rs-card__add" data-toggle-product="' +
        escapeHtml(p.productId) +
        '" aria-label="' +
        escapeHtml(
          selected
            ? self.t("removeProduct", "Remove")
            : self.t("addProduct", "Add"),
        ) +
        '"' +
        (disabled ? " disabled" : "") +
        ">" +
        (selected ? "✓" : "+") +
        "</button>" +
        '<div class="sugar-rs-card__meta">' +
        '<p class="sugar-rs-card__title">' +
        escapeHtml(p.title) +
        "</p>" +
        '<p class="sugar-rs-card__price">' +
        escapeHtml(price) +
        "</p>" +
        "</div></article>";
    });
    this.grid.innerHTML = html;
    this.grid.querySelectorAll("[data-toggle-product]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.toggleProduct(btn.getAttribute("data-toggle-product"));
      });
    });
  };

  SugarRoomStudio.prototype.toggleProduct = function (productId) {
    var id = String(productId || "");
    if (!id || !this.catalog.byId[id]) return;
    var idx = this.selectedIds.indexOf(id);
    if (idx !== -1) {
      this.selectedIds.splice(idx, 1);
    } else {
      if (this.selectedIds.length >= this.maxProducts) {
        this.showError(
          this.tReplace("errorMaxProducts", "You can select up to {{max}} products.", {
            max: this.maxProducts,
          }),
        );
        return;
      }
      this.selectedIds.push(id);
    }
    this.renderGrid();
    this.renderSlots();
    this.renderSelectedCount();
    this.updateGenerateState();
  };

  SugarRoomStudio.prototype.clearSelection = function () {
    this.selectedIds = [];
    this.renderGrid();
    this.renderSlots();
    this.renderSelectedCount();
    this.updateGenerateState();
  };

  SugarRoomStudio.prototype.renderSelectedCount = function () {
    var count = this.selectedIds.length;
    var max = this.maxProducts;
    if (this.selectedCountEl) {
      this.selectedCountEl.textContent = this.tReplace(
        "selectedCount",
        "Selected {{count}} / {{max}}",
        { count: count, max: max },
      );
    }
    if (this.slotsTitle) {
      this.slotsTitle.textContent = this.tReplace(
        "selectedProducts",
        "Selected products ({{count}}/{{max}})",
        { count: count, max: max },
      );
    }
    if (this.slotsHint) {
      this.slotsHint.textContent = this.tReplace(
        "selectedHint",
        "Add up to {{max}} products to see them in your space.",
        { max: max },
      );
    }
  };

  SugarRoomStudio.prototype.renderSlots = function () {
    if (!this.slotsEl) return;
    var self = this;
    var html = "";
    for (var i = 0; i < this.maxProducts; i++) {
      var id = this.selectedIds[i];
      var product = id ? this.catalog.byId[id] : null;
      if (product) {
        html +=
          '<div class="sugar-rs-slot is-filled" data-slot-id="' +
          escapeHtml(product.productId) +
          '">' +
          (product.imageUrl
            ? '<img src="' + escapeHtml(product.imageUrl) + '" alt="">'
            : "") +
          '<button type="button" class="sugar-rs-slot__remove" data-remove-slot="' +
          escapeHtml(product.productId) +
          '" aria-label="' +
          escapeHtml(this.t("removeProduct", "Remove")) +
          '">×</button>' +
          "</div>";
      } else {
        html += '<div class="sugar-rs-slot"></div>';
      }
    }
    this.slotsEl.innerHTML = html;
    this.slotsEl.querySelectorAll("[data-remove-slot]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.toggleProduct(btn.getAttribute("data-remove-slot"));
      });
    });
  };

  SugarRoomStudio.prototype.handleRoomFile = function (file) {
    if (!file || !String(file.type || "").startsWith("image/")) {
      this.showError(this.t("errorUpload", "Please upload a valid image."));
      return;
    }
    var maxMb = Number(this.config.maxUploadSizeMb || 10);
    if (file.size > maxMb * 1024 * 1024) {
      this.showError(this.t("errorSize", "File is too large."));
      return;
    }
    if (this.roomPreviewUrl) URL.revokeObjectURL(this.roomPreviewUrl);
    this.roomFile = file;
    this.roomPreviewUrl = URL.createObjectURL(file);
    if (this.roomImg) {
      this.roomImg.src = this.roomPreviewUrl;
      this.roomImg.hidden = false;
    }
    if (this.roomUploadBtn) this.roomUploadBtn.hidden = true;
    if (this.roomActions) this.roomActions.hidden = false;
    this.hideMessage();
    this.updateGenerateState();
    if (this.step === "upload") this.setStep("studio");
  };

  SugarRoomStudio.prototype.clearRoom = function () {
    if (this.roomPreviewUrl) URL.revokeObjectURL(this.roomPreviewUrl);
    this.roomFile = null;
    this.roomPreviewUrl = "";
    if (this.roomImg) {
      this.roomImg.removeAttribute("src");
      this.roomImg.hidden = true;
    }
    if (this.roomUploadBtn) this.roomUploadBtn.hidden = false;
    if (this.roomActions) this.roomActions.hidden = true;
    this.updateGenerateState();
  };

  SugarRoomStudio.prototype.updateGenerateState = function () {
    if (!this.generateBtn) return;
    var ready = this.selectedIds.length > 0 && !!this.roomFile && this.canGenerate();
    this.generateBtn.disabled = !ready;
  };

  SugarRoomStudio.prototype.onGenerateClick = function () {
    if (this.selectedIds.length === 0) {
      this.showError(this.t("errorSelectProduct", "Select at least one product."));
      return;
    }
    if (!this.roomFile) {
      this.setStep("upload");
      this.showError(this.t("errorRoomRequired", "A room photo is required."));
      return;
    }
    this.runDesign();
  };

  SugarRoomStudio.prototype.getProductDetailMetafieldRefs = function () {
    return parseJson(this.config.productDetailMetafieldsJson, []);
  };

  SugarRoomStudio.prototype.buildSelections = function () {
    var self = this;
    return this.selectedIds
      .map(function (id, index) {
        var p = self.catalog.byId[id];
        if (!p || !p.variantId) return null;
        return {
          productId: p.productId,
          variantId: p.variantId,
          isPrimary: index === 0,
          quantity: 1,
          position: null,
        };
      })
      .filter(Boolean);
  };

  SugarRoomStudio.prototype.parseGenerateResponse = async function (response) {
    var contentType = String(response.headers.get("content-type") || "").toLowerCase();
    var bodyText = await response.text();
    if (contentType.indexOf("application/json") !== -1 || bodyText.trim().charAt(0) === "{") {
      try {
        return JSON.parse(bodyText);
      } catch {
        throw new Error(
          this.t("errorGenerateProxy", "Design service returned an invalid response."),
        );
      }
    }
    if (response.redirected && /password|challenge|login/i.test(response.url || "")) {
      throw new Error(
        this.t(
          "errorGenerateStorePassword",
          "Storefront password is required before generating a design.",
        ),
      );
    }
    throw new Error(
      this.t(
        "errorGenerateProxy",
        "Design service is unavailable. Start app dev or check the app proxy connection.",
      ),
    );
  };

  SugarRoomStudio.prototype.startLoadingProgress = function () {
    var self = this;
    var started = Date.now();
    var duration = 28000;
    this.stopLoadingProgress();
    this.loadingTimer = setInterval(function () {
      var pct = Math.min(92, Math.floor(((Date.now() - started) / duration) * 100));
      if (self.loadingBar) self.loadingBar.style.width = pct + "%";
      if (self.loadingPct) {
        self.loadingPct.textContent = self.tReplace(
          "loadingProgress",
          "{{percent}}% complete",
          { percent: pct },
        );
      }
    }, 200);
  };

  SugarRoomStudio.prototype.stopLoadingProgress = function () {
    if (this.loadingTimer) {
      clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
  };

  SugarRoomStudio.prototype.completeLoadingProgress = function () {
    this.stopLoadingProgress();
    if (this.loadingBar) this.loadingBar.style.width = "100%";
    if (this.loadingPct) {
      this.loadingPct.textContent = this.tReplace(
        "loadingProgress",
        "{{percent}}% complete",
        { percent: 100 },
      );
    }
  };

  SugarRoomStudio.prototype.runDesign = async function (options) {
    options = options || {};
    if (!this.roomFile) {
      this.showError(this.t("errorRoomRequired", "A room photo is required."));
      this.setStep("upload");
      return;
    }
    var selections = this.buildSelections();
    if (selections.length === 0) {
      this.showError(this.t("errorSelectProduct", "Select at least one product."));
      this.setStep("studio");
      return;
    }
    this.syncAttemptCount();
    if (!this.canGenerate()) {
      this.showError(this.t("errorGenerate", "Could not create design."));
      return;
    }

    this.hideMessage();
    this.setStep("loading");
    this.startLoadingProgress();

    try {
      var base64 = await fileToBase64(this.roomFile);
      var formData = new FormData();
      formData.append("selections", JSON.stringify(selections));
      formData.append("roomImageBase64", base64);
      formData.append("roomImageName", this.roomFile.name || "room.jpg");
      formData.append(
        "productDetailMetafields",
        JSON.stringify(this.getProductDetailMetafieldRefs()),
      );
      formData.append(
        "productDetailMetafieldNamespace",
        this.config.productDetailMetafieldNamespace || "custom",
      );

      var response = await fetch(this.config.proxyUrl || "/apps/sugar/generate", {
        method: "POST",
        body: formData,
      });
      var data = await this.parseGenerateResponse(response);
      if (!response.ok || data.status === "failed") {
        throw new Error(data.message || this.t("errorGenerate", "Could not create design."));
      }

      this.designResult = data;
      this.resultSelections = {};
      selections.forEach(function (s) {
        this.resultSelections[String(s.variantId)] = true;
      }, this);

      if (this.compareOrigin) this.compareOrigin.src = this.roomPreviewUrl || "";
      if (this.compareDesign) this.compareDesign.src = data.imageUrl || "";
      if (this.compareEl) this.compareEl.style.setProperty("--sugar-rs-compare", "50%");
      if (this.compareRange) this.compareRange.value = "50";

      this.renderResultList();
      if (!this.unlimitedAttempts) {
        this.attemptCount = recordAttempt(this.getShopAttemptKey());
      }
      this.completeLoadingProgress();
      if (this.dialog && this.displayMode === "modal" && !this.dialog.open) {
        this.dialog.showModal();
      }
      this.setStep("result");
      this.updateGenerateState();
    } catch (err) {
      this.stopLoadingProgress();
      this.showError(
        err instanceof Error ? err.message : this.t("errorGeneric", "Something went wrong"),
      );
      this.setStep(options.isRedesign ? "result" : "studio");
    }
  };

  SugarRoomStudio.prototype.renderResultList = function () {
    if (!this.resultList) return;
    var self = this;
    var html = "";
    this.selectedIds.forEach(function (id) {
      var p = self.catalog.byId[id];
      if (!p) return;
      html +=
        "<li>" +
        (p.imageUrl ? '<img src="' + escapeHtml(p.imageUrl) + '" alt="">' : "") +
        "<span>" +
        escapeHtml(p.title) +
        "</span></li>";
    });
    this.resultList.innerHTML = html;
  };

  SugarRoomStudio.prototype.notifyThemeCartUpdated = function () {
    fetch("/cart.js")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (cart) {
        if (!cart) return;
        document.dispatchEvent(
          new CustomEvent("cart:updated", { detail: { cart: cart } }),
        );
      })
      .catch(function () {});
  };

  SugarRoomStudio.prototype.addDesignToCart = function () {
    if (!this.designResult || !this.addCartBtn) return;
    var self = this;
    var imageKey = this.config.imagePropertyKey || "_sugar_design_image";
    var genKey = this.config.generationIdPropertyKey || "_sugar_generation_id";
    var cartImageUrl = getCartSafeDesignImageUrl(this.designResult.imageUrl || "");
    var generationId = String(this.designResult.generationId || "");
    var items = [];
    var imageAttached = false;

    this.selectedIds.forEach(function (id) {
      var p = self.catalog.byId[id];
      if (!p || !p.variantId) return;
      if (!self.resultSelections[String(p.variantId)]) return;
      var props = {};
      if (generationId) props[genKey] = generationId;
      if (cartImageUrl && !imageAttached) {
        props[imageKey] = cartImageUrl;
        imageAttached = true;
      }
      items.push({ id: Number(p.variantId), quantity: 1, properties: props });
    });

    if (items.length === 0) {
      this.showError(this.t("errorSelectProduct", "Select at least one product."));
      return;
    }

    this.hideMessage();
    this.addCartBtn.disabled = true;
    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: items }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            throw new Error(
              data.description || data.message || self.t("errorCart", "Could not add to cart"),
            );
          }
          return data;
        });
      })
      .then(function () {
        self.addCartBtn.disabled = false;
        var detail = self.tReplace(
          "cartSuccessDetail",
          "{{count}} item(s) added to your cart.",
          { count: items.length },
        );
        self.showSuccess(self.t("cartSuccess", "Added to cart!") + " " + detail);
        self.notifyThemeCartUpdated();
      })
      .catch(function (err) {
        self.addCartBtn.disabled = false;
        self.showError(
          err instanceof Error
            ? err.message
            : self.t("errorCartRetry", "Could not add to cart. Please try again."),
        );
      });
  };

  SugarRoomStudio.prototype.showError = function (message) {
    this.showToast(message, "error");
  };

  SugarRoomStudio.prototype.showSuccess = function (message) {
    this.showToast(message, "success");
  };

  SugarRoomStudio.prototype.hideMessage = function () {
    if (!this.toastEl) return;
    this.toastEl.hidden = true;
    this.toastEl.textContent = "";
    this.toastEl.classList.remove("is-error", "is-success");
  };

  SugarRoomStudio.prototype.showToast = function (message, type) {
    if (!this.toastEl) return;
    var self = this;
    this.toastEl.hidden = false;
    this.toastEl.textContent = message;
    this.toastEl.classList.toggle("is-error", type === "error");
    this.toastEl.classList.toggle("is-success", type === "success");
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(function () {
      self.hideMessage();
    }, 4000);
  };

  function boot() {
    document.querySelectorAll("[data-sugar-rs-root]").forEach(function (root) {
      if (root.__sugarRsBooted) return;
      root.__sugarRsBooted = true;
      new SugarRoomStudio(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  document.addEventListener("shopify:section:load", boot);
})();
