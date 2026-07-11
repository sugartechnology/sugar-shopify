(function () {
  "use strict";

  var Kit = window.SugarPdpKit;
  var core = Kit.core;
  var STEPS = ["upload", "pick-source", "camera", "products", "loading", "result"];

  function SugarPdp(root) {
    this.root = root;
    this.config = core.parseJson(root.dataset.sugarConfig, {});
    this.i18n = core.getI18n(this.config);
    this.locale = this.config.locale || undefined;
    this.primaryProduct = core.parseJson(root.dataset.sugarProduct, {});
    this.catalog = core.parseJson(root.dataset.sugarCatalog, []);
    this.variants = core.parseJson(root.dataset.sugarVariants, []);
    this.step = "upload";
    this.resultPlacements = [];
    this.designResult = null;
    this.resultSelections = {};
    this.resultQuantities = {};
    this.productQuantities = {};
    this.cameraStream = null;
    this.toastTimer = null;
    this.designAttemptCount = 0;
    this.unlimitedDesignAttempts = core.isShopifyAdminPreview();
    this.maxDesignAttempts = this.unlimitedDesignAttempts
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, Number(this.config.maxDesignAttempts || 3));
    this.enabledProductIds = new Set([
      String(this.primaryProduct.productId || ""),
    ]);

    this.uploadHero = new Kit.UploadHero(root, this.config);
    this.mockup = new Kit.MockupEditor(this);
    this.compare = new Kit.CompareSlider(root, this.t.bind(this));
    this.savedDesigns = new Kit.SavedDesigns(this);

    this.init();
  }

  SugarPdp.prototype.init = function () {
    this.cacheDom();
    this.initPrimarySelection();
    this.renderUploadInstruction();
    this.renderProductStrip();
    this.bindEvents();
    this.mockup.bind();
    this.compare.bind();
    this.bindVariantSync();
    this.mountEmbedTrigger();
    this.savedDesigns.renderPage();
    this.uploadHero.init();
    this.syncDesignAttemptCount();
    this.resetProductQuantities();
    this.applyBrandingAssets();
    if (this.config.customCss) {
      var style = document.createElement("style");
      style.textContent = this.config.customCss;
      this.root.appendChild(style);
    }
    this.portalDialog();
  };

  SugarPdp.prototype.queryModal = function (selector) {
    if (this.dialog) {
      var match = this.dialog.querySelector(selector);
      if (match) return match;
    }
    return this.root.querySelector(selector);
  };

  SugarPdp.prototype.queryModalAll = function (selector) {
    if (this.dialog) {
      var matches = this.dialog.querySelectorAll(selector);
      if (matches.length) return matches;
    }
    return this.root.querySelectorAll(selector);
  };

  SugarPdp.prototype.cacheDom = function () {
    this.dialog = this.root.querySelector("[data-sugar-dialog]");
    this.modalEl = this.dialog ? this.dialog.querySelector(".sugar-modal") : null;
    this.steps = {};
    var self = this;
    STEPS.forEach(function (step) {
      self.steps[step] = self.root.querySelector('[data-sugar-step="' + step + '"]');
    });
    this.toastEl = this.root.querySelector("[data-sugar-toast]");
    this.productStrip = this.root.querySelector("[data-sugar-product-strip]");
    this.checklist = this.root.querySelector("[data-sugar-checklist]");
    this.demoBadge = this.root.querySelector("[data-sugar-demo-badge]");
    this.addDesignBtn = this.root.querySelector("[data-sugar-add-design]");
    this.fileGallery = this.root.querySelector("[data-sugar-file-gallery]");
    this.uploadInstruction = this.root.querySelector("[data-sugar-upload-instruction]");
    this.reviewInstruction = this.root.querySelector("[data-sugar-review-instruction]");
    this.productsSection = this.root.querySelector("[data-sugar-products-section]");
    this.cameraVideo = this.root.querySelector("[data-sugar-camera-video]");
    this.cameraCanvas = this.root.querySelector("[data-sugar-camera-canvas]");
    this.cameraWrap = this.root.querySelector("[data-sugar-camera-wrap]");
    this.headerIcon = this.root.querySelector("[data-sugar-header-icon]");
    this.redesignWrap = this.root.querySelector("[data-sugar-redesign-wrap]");
    this.redesignBtn = this.root.querySelector("[data-sugar-redesign]");
    this.redesignCountEl = this.root.querySelector("[data-sugar-redesign-count]");
    this.designBtn = this.root.querySelector("[data-sugar-design]");
    this.designBtnLabel = this.root.querySelector("[data-sugar-design-label]");
    this.productTipEl = this.queryModal("[data-sugar-product-tip]");
    this.designActions = this.root.querySelector("[data-sugar-design-actions]");
    this.designDownloadBtn = this.root.querySelector("[data-sugar-design-download]");
    this.loadingBar = this.root.querySelector("[data-sugar-loading-bar]");
    this.loadingProgressEl = this.root.querySelector("[data-sugar-loading-progress]");
    this.loadingProgressLabel = this.root.querySelector(
      "[data-sugar-loading-progress-label]",
    );
    this.loadingProgressTimer = null;
  };

  SugarPdp.prototype.animateModalHeight = function (startHeight) {
    var modal = this.modalEl || this.queryModal(".sugar-modal");
    if (!modal || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    var endHeight = modal.scrollHeight;
    if (Math.abs(endHeight - startHeight) < 2) {
      modal.style.height = "";
      modal.classList.remove("sugar-modal--animating");
      return;
    }
    modal.style.height = startHeight + "px";
    modal.classList.add("sugar-modal--animating");
    requestAnimationFrame(function () {
      modal.style.height = endHeight + "px";
    });
    var onEnd = function (e) {
      if (e.propertyName !== "height") return;
      modal.classList.remove("sugar-modal--animating");
      modal.style.height = "";
      modal.removeEventListener("transitionend", onEnd);
    };
    modal.addEventListener("transitionend", onEnd);
  };

  SugarPdp.prototype.applyBrandingAssets = function () {
    if (this.config.headerIconUrl && this.headerIcon) {
      var hasImg = this.headerIcon.querySelector("img");
      if (!hasImg || this.config.headerIconUrl !== hasImg.getAttribute("src")) {
        this.headerIcon.innerHTML =
          '<img src="' + this.config.headerIconUrl + '" alt="" width="20" height="20">';
      }
    }
  };

  SugarPdp.prototype.mountEmbedTrigger = function () {
    if (this.root.dataset.sugarEmbed !== "true") return;
    var trigger = this.root.querySelector(".sugar-trigger-wrap");
    if (!trigger) return;
    var selectors = [
      ".product-form__buttons",
      "form[action*='/cart/add'][data-type='add-to-cart-form']",
      "form.product-form",
      "form[action*='/cart/add']",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var target = document.querySelector(selectors[i]);
      if (target) {
        target.insertBefore(trigger, target.firstChild);
        return;
      }
    }
  };

  SugarPdp.prototype.getSelectedVariantId = function () {
    var input = document.querySelector(
      'form[action*="/cart/add"] input[name="id"], form.product-form input[name="id"], form[data-type="add-to-cart-form"] input[name="id"]',
    );
    if (input && input.value) return String(input.value);
    return String(this.primaryProduct.variantId || "");
  };

  SugarPdp.prototype.applyVariant = function (variantId) {
    if (!variantId || !this.variants.length) return;
    var variant = this.variants.find(function (v) {
      return String(v.variantId) === String(variantId);
    });
    if (!variant) return;
    this.primaryProduct.variantId = String(variant.variantId);
    this.primaryProduct.price = String(variant.price);
    if (variant.imageUrl) this.primaryProduct.imageUrl = variant.imageUrl;
    this.mockup.syncPrimaryVariant(variant.variantId, variant.imageUrl);
    this.renderProductStrip();
    this.renderUploadInstruction();
  };

  SugarPdp.prototype.syncPrimaryToSelectedVariant = function () {
    var variantId = this.getSelectedVariantId();
    if (variantId) this.applyVariant(variantId);
  };

  SugarPdp.prototype.initPrimarySelection = function () {
    this.syncPrimaryToSelectedVariant();
  };

  SugarPdp.prototype.allProducts = function () {
    var list = [this.primaryProduct];
    var primaryId = String(this.primaryProduct.productId || "");
    this.catalog.forEach(function (p) {
      if (String(p.productId) !== primaryId) list.push(p);
    });
    return list;
  };

  SugarPdp.prototype.t = function (key, fallback) {
    return this.i18n[key] || fallback || "";
  };

  SugarPdp.prototype.renderUploadInstruction = function () {
    if (!this.uploadInstruction) return;
    var template = this.config.modalDescription || this.t("modalDescription", "");
    this.uploadInstruction.innerHTML = template.replace(
      /\{productTitle\}/g,
      "<strong>" + (this.primaryProduct.title || "") + "</strong>",
    );
  };

  SugarPdp.prototype.isProductEnabled = function (productId) {
    return this.enabledProductIds.has(String(productId));
  };

  SugarPdp.prototype.enableProduct = function (productId) {
    this.enabledProductIds.add(String(productId));
    var product = this.allProducts().find(function (p) {
      return String(p.productId) === String(productId);
    });
    if (product && this.getProductQuantity(product) < 1) {
      this.productQuantities[String(product.variantId)] = 1;
    }
    this.renderProductStrip();
  };

  SugarPdp.prototype.resetProductQuantities = function () {
    this.productQuantities = {};
    if (this.primaryProduct && this.primaryProduct.variantId) {
      this.productQuantities[String(this.primaryProduct.variantId)] = 1;
    }
  };

  SugarPdp.prototype.getProductQuantity = function (product) {
    var vid = String(product.variantId);
    if (this.productQuantities[vid] !== undefined) {
      return this.productQuantities[vid];
    }
    return product.isPrimary ? 1 : 0;
  };

  SugarPdp.prototype.buildProductQtyStepper = function (product, isEnabled) {
    var vid = String(product.variantId);
    var qty = this.getProductQuantity(product);
    var minQty = product.isPrimary ? 1 : 0;
    var stepper = document.createElement("div");
    stepper.className = "sugar-qty-stepper sugar-product-qty";
    stepper.dataset.variantId = vid;
    if (!isEnabled) stepper.classList.add("is-disabled");

    var downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "sugar-qty-stepper__btn";
    downBtn.dataset.sugarProductQtyDown = "";
    downBtn.setAttribute("aria-label", this.t("qtyDecrease", "Decrease quantity"));
    downBtn.textContent = "−";
    downBtn.disabled = !isEnabled || qty <= minQty;

    var valueEl = document.createElement("span");
    valueEl.className = "sugar-qty-stepper__value";
    valueEl.textContent = String(qty);

    var upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "sugar-qty-stepper__btn";
    upBtn.dataset.sugarProductQtyUp = "";
    upBtn.setAttribute("aria-label", this.t("qtyIncrease", "Increase quantity"));
    upBtn.textContent = "+";
    upBtn.disabled = !isEnabled || qty >= 99;

    stepper.appendChild(downBtn);
    stepper.appendChild(valueEl);
    stepper.appendChild(upBtn);
    return stepper;
  };

  SugarPdp.prototype.adjustProductQuantity = function (variantId, delta) {
    var product = this.allProducts().find(function (p) {
      return String(p.variantId) === String(variantId);
    });
    if (!product) return;
    if (!product.isPrimary && !this.isProductEnabled(product.productId)) return;

    var minQty = product.isPrimary ? 1 : 0;
    var vid = String(variantId);
    var current = this.getProductQuantity(product);
    var next = Math.min(99, Math.max(minQty, current + delta));
    this.productQuantities[vid] = next;
    this.renderProductStrip();
    this.refreshProductPlacementTip();
  };

  SugarPdp.prototype.refreshProductPlacementTip = function () {
    if (this.productTipDismissed || this.mockup.placements.length > 0) return;
    this.productTipEl = this.queryModal("[data-sugar-product-tip]");
    if (this.productTipEl && this.productTipTimer) {
      this.productTipEl.classList.add("is-visible");
    }
  };

  SugarPdp.prototype.resetEnabledProducts = function () {
    this.enabledProductIds = new Set([
      String(this.primaryProduct.productId || ""),
    ]);
  };

  SugarPdp.prototype.renderProductStrip = function () {
    if (!this.productStrip) return;
    this.productStrip.innerHTML = "";
    var maxExtra = Number(this.config.maxAdditionalProducts || 4);
    var extraShown = 0;
    var self = this;

    this.allProducts().forEach(function (product) {
      if (!product.isPrimary) {
        if (extraShown >= maxExtra) return;
        extraShown++;
      }
      var id = String(product.productId);
      var isPrimary = !!product.isPrimary;
      var isEnabled = self.isProductEnabled(id);
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "sugar-product-chip";
      if (isPrimary) {
        chip.classList.add("is-enabled");
      } else if (isEnabled) {
        chip.classList.add("is-enabled");
      } else {
        chip.classList.add("is-disabled");
      }
      if (self.mockup.isProductPlaced(id)) chip.classList.add("is-placed");
      chip.dataset.productId = id;
      if (isPrimary) chip.dataset.primary = "true";
      var stateLabel = isPrimary
        ? self.t("productClickTip", "Click and place product")
        : isEnabled
          ? self.t("productClickTip", "Click and place product")
          : self.t("productEnableTip", "Tap to enable");
      chip.setAttribute("aria-label", (product.title || "") + " — " + stateLabel);
      chip.innerHTML =
        '<img class="sugar-product-chip__img" src="' +
        (product.imageUrl || "") +
        '" alt=""><span class="sugar-product-chip__title">' +
        (product.title || "") +
        "</span>";

      var wrap = document.createElement("div");
      wrap.className = "sugar-product-chip-wrap";
      wrap.appendChild(chip);
      wrap.appendChild(self.buildProductQtyStepper(product, isEnabled));

      if (isPrimary) {
        var group = document.createElement("div");
        group.className = "sugar-product-chip-group";
        var tip = document.createElement("p");
        tip.className = "sugar-product-tip";
        tip.setAttribute("data-sugar-product-tip", "");
        tip.setAttribute("role", "status");
        tip.textContent = self.t("productClickTip", "Click and place product");
        if (self.productTipDismissed) tip.classList.add("is-dismissed");
        group.appendChild(tip);
        group.appendChild(wrap);
        self.productStrip.appendChild(group);
      } else {
        self.productStrip.appendChild(wrap);
      }
    });
    this.updateDesignButtonLabel();
  };

  SugarPdp.prototype.updateDesignButtonLabel = function () {
    if (!this.designBtnLabel) return;
    var hasPlacement = this.mockup.placements.length > 0;
    this.designBtnLabel.textContent = hasPlacement
      ? this.t("designButton", "Design ✦")
      : this.t("autoDesignButton", "Auto Design ✦");
  };

  SugarPdp.prototype.clearProductTipTimer = function () {
    if (!this.productTipTimer) return;
    window.clearTimeout(this.productTipTimer);
    this.productTipTimer = null;
  };

  SugarPdp.prototype.hideProductPlacementTip = function () {
    this.clearProductTipTimer();
    this.productTipEl = this.queryModal("[data-sugar-product-tip]");
    if (this.productTipEl) this.productTipEl.classList.remove("is-visible");
  };

  SugarPdp.prototype.showProductPlacementTip = function () {
    if (this.productTipDismissed || this.mockup.placements.length > 0) return;
    this.productTipEl = this.queryModal("[data-sugar-product-tip]");
    if (!this.productTipEl) return;
    this.productTipEl.classList.add("is-visible");
    var self = this;
    this.clearProductTipTimer();
    this.productTipTimer = window.setTimeout(function () {
      self.hideProductPlacementTip();
      if (self.productTipEl) self.productTipEl.classList.add("is-dismissed");
      self.productTipDismissed = true;
    }, 5000);
  };

  SugarPdp.prototype.dismissProductPlacementTip = function () {
    this.productTipDismissed = true;
    this.hideProductPlacementTip();
    this.productTipEl = this.queryModal("[data-sugar-product-tip]");
    if (this.productTipEl) this.productTipEl.classList.add("is-dismissed");
  };

  SugarPdp.prototype.resetProductPlacementTip = function () {
    this.productTipDismissed = false;
    this.hideProductPlacementTip();
    this.productTipEl = this.queryModal("[data-sugar-product-tip]");
    if (this.productTipEl) this.productTipEl.classList.remove("is-dismissed");
  };

  SugarPdp.prototype.resolveResultProduct = function (placement) {
    var apiProduct = (this.designResult.products || []).find(function (p) {
      return String(p.variantId) === String(placement.variantId);
    });
    var catalogProduct = this.mockup.findCatalogProduct(placement.productId);
    var priceSource =
      apiProduct ||
      (placement.isPrimary ? this.primaryProduct : null) ||
      catalogProduct;
    return {
      placementId: placement.id,
      productId: String(placement.productId),
      variantId: String(placement.variantId),
      title:
        (apiProduct && apiProduct.title) ||
        placement.title ||
        (catalogProduct && catalogProduct.title) ||
        "",
      price: String((priceSource && priceSource.price) || "0"),
      currency:
        (apiProduct && apiProduct.currency) ||
        (catalogProduct && catalogProduct.currency) ||
        this.primaryProduct.currency ||
        "TRY",
      imageUrl:
        (apiProduct && apiProduct.imageUrl) ||
        placement.imageUrl ||
        (catalogProduct && catalogProduct.imageUrl) ||
        "",
    };
  };

  SugarPdp.prototype.getResultCartProducts = function () {
    var self = this;
    return (this.resultPlacements || []).map(function (placement) {
      return self.resolveResultProduct(placement);
    });
  };

  SugarPdp.prototype.getGroupedResultProducts = function () {
    var lines = this.getResultCartProducts();
    var grouped = new Map();

    lines.forEach(function (line) {
      var vid = String(line.variantId);
      if (!grouped.has(vid)) {
        grouped.set(vid, {
          variantId: vid,
          productId: line.productId,
          title: line.title,
          price: line.price,
          currency: line.currency,
          imageUrl: line.imageUrl,
          placedCount: 0,
        });
      }
      grouped.get(vid).placedCount += 1;
    });

    if (grouped.size === 0 && this.designResult && this.designResult.products) {
      this.designResult.products.forEach(function (p) {
        var vid = String(p.variantId);
        if (!grouped.has(vid)) {
          grouped.set(vid, {
            variantId: vid,
            productId: String(p.productId),
            title: p.title || "",
            price: String(p.price || "0"),
            currency: p.currency || "TRY",
            imageUrl: p.imageUrl || "",
            placedCount: 1,
          });
        } else {
          grouped.get(vid).placedCount += 1;
        }
      });
    }

    return Array.from(grouped.values());
  };

  SugarPdp.prototype.renderResultChecklist = function () {
    if (!this.checklist || !this.designResult) return;
    this.checklist.innerHTML = "";
    var self = this;
    var grouped = this.getGroupedResultProducts();

    var productsSection = document.createElement("p");
    productsSection.className = "sugar-checklist__section-title";
    productsSection.textContent = this.t("checklistProducts", "PRODUCTS");
    this.checklist.appendChild(productsSection);

    grouped.forEach(function (g) {
      var vid = String(g.variantId);
      if (self.resultQuantities[vid] === undefined) {
        self.resultQuantities[vid] =
          self.productQuantities[vid] !== undefined
            ? self.productQuantities[vid]
            : g.placedCount || 1;
      }
      if (self.resultSelections[vid] === undefined) {
        self.resultSelections[vid] = true;
      }

      var qty = self.resultQuantities[vid] || 0;
      var lineTotal = core.formatMoney(
        core.normalizePriceToCents(g.price) * qty,
        g.currency,
        self.locale,
      );

      var row = document.createElement("label");
      row.className = "sugar-check-item";
      row.dataset.variantId = vid;
      row.innerHTML =
        '<input type="checkbox" data-sugar-product-check data-variant-id="' +
        vid +
        '"' +
        (self.resultSelections[vid] && qty > 0 ? " checked" : "") +
        '><img class="sugar-check-item__img" src="' +
        (g.imageUrl || "") +
        '" alt=""><span class="sugar-check-item__body"><span class="sugar-check-item__title">' +
        (g.title || "") +
        '</span></span><span class="sugar-check-item__qty sugar-qty-stepper"><button type="button" class="sugar-qty-stepper__btn" data-sugar-qty-down aria-label="-">−</button><span class="sugar-qty-stepper__value">' +
        qty +
        '</span><button type="button" class="sugar-qty-stepper__btn" data-sugar-qty-up aria-label="+">+</button></span><span class="sugar-check-item__price">' +
        lineTotal +
        "</span>";
      self.checklist.appendChild(row);
    });

    this.updateAddButtonState();
  };

  SugarPdp.prototype.bindVariantSync = function () {
    var self = this;
    if (!this.variants.length) return;
    var productForm = document.querySelector(
      'form[action*="/cart/add"], form.product-form, form[data-type="add-to-cart-form"]',
    );
    if (productForm) {
      productForm.addEventListener("change", function (e) {
        if (e.target && e.target.name === "id") self.applyVariant(e.target.value);
      });
    }
    document.addEventListener("variant:change", function (e) {
      var variant = e.detail && e.detail.variant;
      if (variant && variant.id) self.applyVariant(variant.id);
    });
  };

  SugarPdp.prototype.setStep = function (step) {
    if (step !== "camera") this.stopCameraStream();
    if (step !== "loading") this.stopLoadingProgress();
    var modal = this.modalEl || this.queryModal(".sugar-modal");
    var canAnimate = !!(modal && this.dialog && this.dialog.open);
    var startHeight = canAnimate ? modal.getBoundingClientRect().height : 0;
    this.step = step;
    var self = this;
    STEPS.forEach(function (s) {
      if (self.steps[s]) self.steps[s].classList.toggle("is-active", s === step);
    });
    if (step === "products") this.updateReviewStep();
    if (step === "result") this.syncDesignActions();
    if (step === "result" || step === "products") this.syncDesignLimitUi();
    if (canAnimate) this.animateModalHeight(startHeight);
  };

  SugarPdp.prototype.getProductKey = function () {
    return this.savedDesigns.getProductKey();
  };

  SugarPdp.prototype.getProductDetailMetafieldRefs = function () {
    var raw = this.config.productDetailMetafieldsJson;
    if (Array.isArray(this.config.productDetailMetafields)) {
      return this.config.productDetailMetafields.filter(function (ref) {
        return ref && ref.namespace && ref.key;
      });
    }
    var parsed = core.parseJson(raw, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(function (ref) {
      return ref && ref.namespace && ref.key;
    });
  };

  SugarPdp.prototype.getProductDetailMetafieldNamespace = function () {
    var namespace = String(
      this.config.productDetailMetafieldNamespace || "custom",
    ).trim();
    return namespace || "custom";
  };

  SugarPdp.prototype.syncDesignAttemptCount = function () {
    this.designAttemptCount = core.getDesignAttemptCount(this.getProductKey());
  };

  SugarPdp.prototype.getRedesignRemaining = function () {
    return Math.max(0, this.maxDesignAttempts - this.designAttemptCount);
  };

  SugarPdp.prototype.isDesignLimitReached = function () {
    if (this.unlimitedDesignAttempts) return false;
    return this.designAttemptCount >= this.maxDesignAttempts;
  };

  SugarPdp.prototype.canGenerateDesign = function () {
    if (this.unlimitedDesignAttempts) return true;
    return core.hasDesignAttemptsRemaining(
      this.getProductKey(),
      this.maxDesignAttempts,
    );
  };

  SugarPdp.prototype.canRedesign = function () {
    return (
      this.canGenerateDesign() &&
      !!this.mockup.roomFile &&
      this.step === "result"
    );
  };

  SugarPdp.prototype.formatDesignCount = function () {
    var countTemplate = this.t("redesignCount", "{{current}} / {{max}} tasarım");
    return countTemplate
      .replace("{{current}}", String(this.designAttemptCount))
      .replace("{{max}}", String(this.maxDesignAttempts));
  };

  SugarPdp.prototype.getDesignLimitMessage = function () {
    return this.t(
      "errorDesignLimit",
      "Bu ürün için tasarım hakkın doldu.",
    ).replace("{{max}}", String(this.maxDesignAttempts));
  };

  SugarPdp.prototype.syncDesignLimitUi = function () {
    var atLimit = this.isDesignLimitReached();
    var limitMessage = this.getDesignLimitMessage();

    if (this.designBtn) {
      this.designBtn.disabled = atLimit;
      this.designBtn.title = atLimit ? limitMessage : "";
      this.designBtn.setAttribute("aria-disabled", atLimit ? "true" : "false");
    }

    if (!this.redesignWrap || !this.redesignBtn) return;

    var hasRoom = !!this.mockup.roomFile;
    var disabled = atLimit || !hasRoom;

    this.redesignBtn.disabled = disabled;
    this.redesignWrap.classList.toggle("is-disabled", disabled);
    this.redesignWrap.classList.toggle("is-limit", atLimit);

    if (this.redesignCountEl) {
      if (this.unlimitedDesignAttempts) {
        this.redesignCountEl.textContent = "";
      } else if (atLimit) {
        this.redesignCountEl.textContent = this.t(
          "redesignLimit",
          "Deneme hakkın doldu",
        );
      } else {
        this.redesignCountEl.textContent = this.formatDesignCount();
      }
    }
  };

  SugarPdp.prototype.runRedesign = function () {
    if (!this.canRedesign()) {
      if (this.isDesignLimitReached()) {
        this.showError(this.getDesignLimitMessage());
      }
      return;
    }
    this.runDesign({ isRedesign: true });
  };

  SugarPdp.prototype.formatLoadingProgressLabel = function (percent, remainingSec) {
    var progress = this.t("loadingProgress", "{{percent}}% complete").replace(
      "{{percent}}",
      String(percent),
    );
    if (remainingSec <= 0 && percent >= 88) {
      return progress + " · " + this.t("loadingAlmostDone", "Almost there…");
    }
    var remaining = this.t("loadingTimeRemaining", "About {{seconds}} sec left").replace(
      "{{seconds}}",
      String(remainingSec),
    );
    return progress + " · " + remaining;
  };

  SugarPdp.prototype.updateLoadingProgressUi = function (percent) {
    if (this.loadingBar) this.loadingBar.style.width = percent + "%";
    if (this.loadingProgressEl) {
      this.loadingProgressEl.setAttribute("aria-valuenow", String(percent));
    }
  };

  SugarPdp.prototype.startLoadingProgress = function () {
    this.stopLoadingProgress();
    var estimatedSec = Math.max(20, Number(this.config.loadingEstimateSec || 50));
    var startedAt = Date.now();
    this.updateLoadingProgressUi(0);
    if (this.loadingProgressLabel) {
      this.loadingProgressLabel.textContent = this.formatLoadingProgressLabel(
        0,
        estimatedSec,
      );
    }
    var self = this;
    this.loadingProgressTimer = window.setInterval(function () {
      var elapsedSec = (Date.now() - startedAt) / 1000;
      var ratio = Math.min(0.92, 1 - Math.exp(-elapsedSec / (estimatedSec * 0.65)));
      var percent = Math.round(ratio * 100);
      var remainingSec = Math.max(0, Math.ceil(estimatedSec - elapsedSec));
      self.updateLoadingProgressUi(percent);
      if (self.loadingProgressLabel) {
        self.loadingProgressLabel.textContent = self.formatLoadingProgressLabel(
          percent,
          remainingSec,
        );
      }
    }, 250);
  };

  SugarPdp.prototype.completeLoadingProgress = function () {
    this.updateLoadingProgressUi(100);
    if (this.loadingProgressLabel) {
      this.loadingProgressLabel.textContent = this.t("loadingComplete", "Design ready!");
    }
    this.stopLoadingProgress();
  };

  SugarPdp.prototype.stopLoadingProgress = function () {
    if (!this.loadingProgressTimer) return;
    window.clearInterval(this.loadingProgressTimer);
    this.loadingProgressTimer = null;
  };

  SugarPdp.prototype.updateReviewStep = function () {
    var self = this;
    var hasCatalog = this.allProducts().length > 0;
    if (this.productsSection) this.productsSection.hidden = !hasCatalog;
    if (this.reviewInstruction) {
      this.reviewInstruction.textContent =
        this.config.instructionTemplate ||
        this.t("reviewInstruction", "Ürünleri seç, oda fotoğrafında sürükleyerek yerleştir.");
    }
    this.renderProductStrip();
    window.setTimeout(function () {
      self.showProductPlacementTip();
    }, 120);
    this.syncDesignLimitUi();
  };

  SugarPdp.prototype.stopCameraStream = function () {
    if (!this.cameraStream) return;
    this.cameraStream.getTracks().forEach(function (track) {
      track.stop();
    });
    this.cameraStream = null;
    if (this.cameraVideo) this.cameraVideo.srcObject = null;
  };

  SugarPdp.prototype.setCameraLoading = function (loading) {
    if (this.cameraWrap) {
      this.cameraWrap.classList.toggle("is-loading", !!loading);
    }
  };

  SugarPdp.prototype.attachCameraStream = function (stream) {
    this.cameraStream = stream;
    if (!this.cameraVideo) return;
    this.cameraVideo.srcObject = stream;
    this.setCameraLoading(false);
    var playPromise = this.cameraVideo.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(function () {});
    }
  };

  SugarPdp.prototype.openCameraStep = function () {
    this.hideMessage();
    if (!core.ensureMediaDevices()) {
      this.showError(
        this.t("errorCamera", "Kamera açılamadı. Galeriden fotoğraf seçebilirsiniz."),
      );
      return;
    }

    this.setStep("camera");
    this.setCameraLoading(true);

    var constraintsList = [
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      { video: { facingMode: "user" }, audio: false },
      { video: true, audio: false },
    ];
    var self = this;

    function tryOpen(index) {
      if (index >= constraintsList.length) {
        self.stopCameraStream();
        self.setCameraLoading(false);
        self.setStep("upload");
        self.showError(
          self.t("errorCamera", "Kamera açılamadı. Galeriden fotoğraf seçebilirsiniz."),
        );
        return;
      }

      navigator.mediaDevices
        .getUserMedia(constraintsList[index])
        .then(function (stream) {
          self.attachCameraStream(stream);
        })
        .catch(function () {
          tryOpen(index + 1);
        });
    }

    tryOpen(0);
  };

  SugarPdp.prototype.captureFromCamera = function () {
    if (!this.cameraVideo || !this.cameraCanvas || !this.cameraStream) {
      this.showError(this.t("errorCamera", "Kamera açılamadı."));
      return;
    }

    var video = this.cameraVideo;
    var canvas = this.cameraCanvas;
    var width = video.videoWidth;
    var height = video.videoHeight;
    if (!width || !height) {
      this.showError(this.t("errorCamera", "Kamera açılamadı."));
      return;
    }

    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      this.showError(this.t("errorGeneric", "Something went wrong"));
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);

    var self = this;
    canvas.toBlob(
      function (blob) {
        if (!blob) {
          self.showError(self.t("errorGeneric", "Something went wrong"));
          return;
        }
        self.stopCameraStream();
        self.handleRoomFile(new File([blob], "room-camera.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  };

  SugarPdp.prototype.getToastDuration = function () {
    return Number(this.config.toastDurationMs || 3500);
  };

  SugarPdp.prototype.hideMessage = function () {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (!this.toastEl) return;
    this.toastEl.hidden = true;
    this.toastEl.classList.remove(
      "is-visible",
      "sugar-toast--success",
      "sugar-toast--error",
      "sugar-toast--info",
    );
    this.toastEl.textContent = "";
  };

  SugarPdp.prototype.getDesignImageUrl = function () {
    return (this.designResult && this.designResult.imageUrl) || "";
  };

  SugarPdp.prototype.syncDesignActions = function () {
    if (!this.designActions) return;
    var hasImage = !!this.getDesignImageUrl();
    this.designActions.hidden = !(this.step === "result" && hasImage);
  };

  SugarPdp.prototype.downloadDesignImage = async function () {
    var url = this.getDesignImageUrl();
    if (!url) return;
    var filename = "sugar-room-design-" + Date.now() + ".jpg";
    try {
      var response = await fetch(url);
      if (!response.ok) throw new Error("fetch failed");
      var blob = await response.blob();
      var objectUrl = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      this.showSuccess(this.t("designDownloadSuccess", "Design downloaded."));
    } catch {
      var fallback = document.createElement("a");
      fallback.href = url;
      fallback.download = filename;
      fallback.target = "_blank";
      fallback.rel = "noopener noreferrer";
      document.body.appendChild(fallback);
      fallback.click();
      fallback.remove();
      this.showSuccess(this.t("designDownloadSuccess", "Design downloaded."));
    }
  };

  SugarPdp.prototype.showMessage = function (message, type, duration) {
    if (!this.toastEl || !message) return;
    if (this.dialog && !this.dialog.open) this.dialog.showModal();
    var toastType =
      type === "success" || type === "error" || type === "info" ? type : "info";
    var ms = duration === undefined ? this.getToastDuration() : duration;
    var self = this;

    this.hideMessage();
    this.toastEl.textContent = message;
    this.toastEl.className = "sugar-toast sugar-toast--" + toastType;
    this.toastEl.hidden = false;
    requestAnimationFrame(function () {
      self.toastEl.classList.add("is-visible");
    });

    if (ms > 0) {
      this.toastTimer = setTimeout(function () {
        self.hideMessage();
      }, ms);
    }
  };

  SugarPdp.prototype.showSuccess = function (message, duration) {
    this.showMessage(message, "success", duration);
  };

  SugarPdp.prototype.showError = function (message, duration) {
    this.showMessage(message, "error", duration);
  };

  SugarPdp.prototype.syncDialogTypography = function () {
    if (!this.dialog || !this.root || typeof window.getComputedStyle !== "function") return;
    var rootStyle = window.getComputedStyle(this.root);
    this.dialog.style.fontSize = rootStyle.fontSize;
    this.dialog.style.fontFamily = rootStyle.fontFamily;
    this.dialog.style.lineHeight = rootStyle.lineHeight;
  };

  SugarPdp.prototype.portalDialog = function () {
    if (!this.dialog || this.dialog.dataset.sugarPortaled === "true") return;
    document.body.appendChild(this.dialog);
    this.dialog.dataset.sugarPortaled = "true";
    this.syncDialogTypography();
  };

  SugarPdp.prototype.openModal = function () {
    if (!this.dialog || this.dialog.open) return;
    this.portalDialog();
    this.syncDialogTypography();
    this.hideMessage();
    this.stopCameraStream();
    this.syncDesignAttemptCount();
    this.dialog.showModal();
    if (this.step === "loading" || this.step === "result") return;
    this.setStep("upload");
  };

  SugarPdp.prototype.closeModal = function () {
    this.hideMessage();
    this.stopCameraStream();
    if (this.dialog && this.dialog.open) this.dialog.close();
  };

  SugarPdp.prototype.handleRoomFile = function (file) {
    this.hideMessage();
    if (!file || !file.type.startsWith("image/")) {
      this.showError(this.t("errorUpload", "Please upload a valid image."));
      return;
    }
    var maxMb = Number(this.config.maxUploadSizeMb || 10);
    if (file.size > maxMb * 1024 * 1024) {
      this.showError(this.t("errorSize", "File is too large."));
      return;
    }
    this.mockup.setRoomFile(file);
    this.productTipDismissed = false;
    this.resetProductPlacementTip();
    this.resetEnabledProducts();
    this.resetProductQuantities();
    this.setStep("products");
  };

  SugarPdp.prototype.parseGenerateResponse = async function (response) {
    var contentType = String(response.headers.get("content-type") || "").toLowerCase();
    var bodyText = await response.text();
    if (contentType.indexOf("application/json") !== -1 || bodyText.trim().charAt(0) === "{") {
      try {
        return JSON.parse(bodyText);
      } catch {
        throw new Error(this.t("errorGenerateProxy", "Design service returned an invalid response."));
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

  SugarPdp.prototype.runDesign = async function (options) {
    options = options || {};
    var isRedesign = options.isRedesign === true;
    if (!this.mockup.roomFile) {
      this.showError(this.t("errorRoomRequired", "A room photo is required."));
      this.setStep("upload");
      return;
    }

    this.syncDesignAttemptCount();
    if (!this.canGenerateDesign()) {
      this.showError(this.getDesignLimitMessage());
      this.syncDesignLimitUi();
      this.setStep(isRedesign ? "result" : "products");
      return;
    }

    this.syncPrimaryToSelectedVariant();
    this.hideMessage();
    this.setStep("loading");
    this.startLoadingProgress();

    try {
      var payload = this.mockup.buildGeneratePayload();
      var base64 = await core.fileToBase64(this.mockup.roomFile);
      var formData = new FormData();
      formData.append("selections", JSON.stringify(payload.selections));
      formData.append("roomImageBase64", base64);
      formData.append("roomImageName", this.mockup.roomFile.name);
      if (payload.includeMockup) {
        var mockupBlob = await this.mockup.exportBlob();
        if (mockupBlob) {
          formData.append("mockupImage", mockupBlob, "mockup.jpg");
        }
      }

      var metafieldRefs = this.getProductDetailMetafieldRefs();
      formData.append("productDetailMetafields", JSON.stringify(metafieldRefs));
      formData.append(
        "productDetailMetafieldNamespace",
        this.getProductDetailMetafieldNamespace(),
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
      this.resultPlacements = this.mockup.getResultPlacementsSnapshot();
      this.resultSelections = {};
      this.resultQuantities = {};
      var resultImageUrl = data.imageUrl || "";
      this.compare.setImages(this.mockup.roomPreviewUrl || "", resultImageUrl);
      if (this.demoBadge) {
        var isMock = String(data.generationId || "").indexOf("mock-") === 0;
        if (isMock) this.demoBadge.removeAttribute("hidden");
        else this.demoBadge.setAttribute("hidden", "");
      }
      this.renderResultChecklist();
      await this.savedDesigns.persist(data, this.resultPlacements);
      if (!this.unlimitedDesignAttempts) {
        this.designAttemptCount = core.recordDesignAttempt(this.getProductKey());
      }
      this.syncDesignLimitUi();
      this.completeLoadingProgress();
      if (this.dialog && !this.dialog.open) this.dialog.showModal();
      this.setStep("result");
    } catch (err) {
      this.stopLoadingProgress();
      this.showError(err instanceof Error ? err.message : this.t("errorGeneric", "Something went wrong"));
      this.setStep(isRedesign ? "result" : "products");
    }
  };

  SugarPdp.prototype.notifyThemeCartUpdated = function () {
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

  SugarPdp.prototype.getDesignImageForCart = function () {
    return core.getCartSafeDesignImageUrl(this.getDesignImageUrl());
  };

  SugarPdp.prototype.addDesignToCart = function () {
    if (!this.designResult || !this.addDesignBtn) return;

    var items = [];
    var imageKey = this.config.imagePropertyKey || "_sugar_design_image";
    var genKey = this.config.generationIdPropertyKey || "_sugar_generation_id";
    var self = this;
    var cartImageUrl = this.getDesignImageForCart();
    var generationId = String(this.designResult.generationId || "");
    var imageAttached = false;

    this.getGroupedResultProducts().forEach(function (g) {
      var vid = String(g.variantId);
      if (!self.resultSelections[vid]) return;
      var qty = self.resultQuantities[vid] || 0;
      if (qty < 1) return;
      var props = {};
      if (generationId) props[genKey] = generationId;
      if (cartImageUrl && !imageAttached) {
        props[imageKey] = cartImageUrl;
        imageAttached = true;
      }
      items.push({ id: Number(g.variantId), quantity: qty, properties: props });
    });

    if (items.length === 0) {
      this.showError(this.t("errorSelectProduct", "Select at least one product."));
      return;
    }

    this.hideMessage();
    this.addDesignBtn.disabled = true;
    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: items }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            throw new Error(
              data.description || data.message || self.t("errorCart", "Sepete eklenemedi"),
            );
          }
          return data;
        });
      })
      .then(function () {
        self.addDesignBtn.disabled = false;
        var addedQty = items.reduce(function (sum, item) {
          return sum + (item.quantity || 0);
        }, 0);
        var detail = self
          .t("cartSuccessDetail", "{{count}} ürün sepetinize eklendi.")
          .replace(/\{\{count\}\}/g, String(addedQty));
        self.showSuccess(self.t("cartSuccess", "Sepete eklendi!") + " " + detail);
        self.notifyThemeCartUpdated();
      })
      .catch(function (err) {
        self.addDesignBtn.disabled = false;
        self.showError(
          err instanceof Error
            ? err.message
            : self.t("errorCartRetry", "Sepete eklenemedi. Lütfen tekrar deneyin."),
        );
      });
  };

  SugarPdp.prototype.updateAddButtonState = function () {
    if (!this.addDesignBtn) return;
    var self = this;
    var any = this.getGroupedResultProducts().some(function (g) {
      var vid = String(g.variantId);
      return self.resultSelections[vid] && (self.resultQuantities[vid] || 0) > 0;
    });
    this.addDesignBtn.disabled = !any;
  };

  SugarPdp.prototype.adjustResultQuantity = function (variantId, delta) {
    var vid = String(variantId);
    var current = this.resultQuantities[vid] || 0;
    var next = Math.min(99, Math.max(0, current + delta));
    this.resultQuantities[vid] = next;
    if (next === 0) this.resultSelections[vid] = false;
    else this.resultSelections[vid] = true;
    this.renderResultChecklist();
  };

  SugarPdp.prototype.bindEvents = function () {
    var self = this;

    this.root.querySelector("[data-sugar-open]")?.addEventListener("click", function () {
      self.openModal();
    });

    this.queryModalAll("[data-sugar-close]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.closeModal();
      });
    });

    if (this.fileGallery) {
      this.fileGallery.addEventListener("change", function () {
        if (self.fileGallery.files && self.fileGallery.files[0]) {
          self.stopCameraStream();
          self.handleRoomFile(self.fileGallery.files[0]);
          self.fileGallery.value = "";
        }
      });
    }

    this.queryModal("[data-sugar-open-gallery]")?.addEventListener("click", function (e) {
      e.preventDefault();
      self.savedDesigns.openGalleryFlow();
    });

    this.queryModal("[data-sugar-pick-new-photo]")?.addEventListener("click", function () {
      if (self.fileGallery) self.fileGallery.click();
    });

    this.queryModal("[data-sugar-pick-source-back]")?.addEventListener("click", function () {
      self.setStep("upload");
    });

    this.queryModal("[data-sugar-open-camera]")?.addEventListener("click", function (e) {
      e.preventDefault();
      self.openCameraStep();
    });

    this.queryModal("[data-sugar-camera-cancel]")?.addEventListener("click", function () {
      self.stopCameraStream();
      self.setStep("upload");
    });

    this.queryModal("[data-sugar-camera-capture]")?.addEventListener("click", function () {
      self.captureFromCamera();
    });

    this.queryModal("[data-sugar-back-upload]")?.addEventListener("click", function () {
      self.setStep("upload");
    });

    this.queryModal("[data-sugar-design]")?.addEventListener("click", function () {
      self.runDesign();
    });

    this.queryModal("[data-sugar-redo]")?.addEventListener("click", function () {
      self.hideMessage();
      self.setStep(self.mockup.roomFile ? "products" : "upload");
    });

    this.redesignBtn?.addEventListener("click", function () {
      self.runRedesign();
    });

    this.designDownloadBtn?.addEventListener("click", function () {
      self.downloadDesignImage();
    });

    this.addDesignBtn?.addEventListener("click", function () {
      self.addDesignToCart();
    });

    this.productStrip?.addEventListener("click", function (e) {
      if (e.target.closest("[data-sugar-product-qty-down]")) {
        e.preventDefault();
        e.stopPropagation();
        var downRow = e.target.closest("[data-variant-id]");
        if (downRow && downRow.dataset.variantId) {
          self.adjustProductQuantity(downRow.dataset.variantId, -1);
        }
        return;
      }
      if (e.target.closest("[data-sugar-product-qty-up]")) {
        e.preventDefault();
        e.stopPropagation();
        var upRow = e.target.closest("[data-variant-id]");
        if (upRow && upRow.dataset.variantId) {
          self.adjustProductQuantity(upRow.dataset.variantId, 1);
        }
        return;
      }

      var chip = e.target.closest(".sugar-product-chip");
      if (!chip || !chip.dataset.productId) return;
      var productId = chip.dataset.productId;
      var isPrimary = chip.dataset.primary === "true";
      if (!isPrimary && chip.classList.contains("is-disabled")) {
        self.enableProduct(productId);
        return;
      }
      if (!self.isProductEnabled(productId)) return;
      self.dismissProductPlacementTip();
      self.mockup.addFromProduct(productId);
    });

    this.checklist?.addEventListener("change", function (e) {
      var input = e.target;
      if (!input.matches("[data-sugar-product-check]")) return;
      var vid = input.dataset.variantId;
      if (!vid) return;
      var qty = self.resultQuantities[vid] || 0;
      self.resultSelections[vid] = input.checked && qty > 0;
      if (input.checked && qty < 1) {
        self.resultQuantities[vid] = 1;
        self.renderResultChecklist();
        return;
      }
      self.updateAddButtonState();
    });

    this.checklist?.addEventListener("click", function (e) {
      if (e.target.closest("[data-sugar-qty-down]")) {
        e.preventDefault();
        e.stopPropagation();
        var row = e.target.closest(".sugar-check-item");
        if (row && row.dataset.variantId) {
          self.adjustResultQuantity(row.dataset.variantId, -1);
        }
        return;
      }
      if (e.target.closest("[data-sugar-qty-up]")) {
        e.preventDefault();
        e.stopPropagation();
        var upRow = e.target.closest(".sugar-check-item");
        if (upRow && upRow.dataset.variantId) {
          self.adjustResultQuantity(upRow.dataset.variantId, 1);
        }
      }
    });

    var handleSavedDesignActivate = function (e) {
      var deleteBtn = e.target.closest("[data-sugar-delete-design]");
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        self.savedDesigns.remove(deleteBtn.getAttribute("data-sugar-delete-design"));
        return;
      }
      var card = e.target.closest(".sugar-saved-design");
      if (!card || !card.dataset.designId) return;
      self.savedDesigns.open(card.dataset.designId);
    };

    this.root.addEventListener("click", handleSavedDesignActivate);
    if (this.dialog) this.dialog.addEventListener("click", handleSavedDesignActivate);

    var handleSavedDesignKeydown = function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest(".sugar-saved-design");
      if (!card || !card.dataset.designId) return;
      e.preventDefault();
      self.savedDesigns.open(card.dataset.designId);
    };

    this.root.addEventListener("keydown", handleSavedDesignKeydown);
    if (this.dialog) this.dialog.addEventListener("keydown", handleSavedDesignKeydown);
  };

  function initAll() {
    if (!window.SugarPdpKit) return;
    document.querySelectorAll("[data-sugar-root]").forEach(function (root) {
      if (root.__sugarInitialized) return;
      root.__sugarInitialized = true;
      new SugarPdp(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
  document.addEventListener("shopify:section:load", initAll);
})();
