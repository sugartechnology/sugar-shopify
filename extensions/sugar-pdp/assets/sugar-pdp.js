(function () {
  "use strict";

  var STEPS = ["upload", "products", "loading", "result"];

  function parseJson(raw, fallback) {
    try {
      return JSON.parse(raw || "");
    } catch {
      return fallback;
    }
  }

  function formatMoney(cents, currency, locale) {
    var amount = Number(cents) / 100;
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

  function getI18n(config) {
    return config.i18n || {};
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

  function SugarPdp(root) {
    this.root = root;
    this.config = parseJson(root.dataset.sugarConfig, {});
    this.i18n = getI18n(this.config);
    this.locale = this.config.locale || undefined;
    this.primaryProduct = parseJson(root.dataset.sugarProduct, {});
    this.catalog = parseJson(root.dataset.sugarCatalog, []);
    this.variants = parseJson(root.dataset.sugarVariants, []);
    this.step = "upload";
    this.roomFile = null;
    this.roomPreviewUrl = "";
    this.selectedProductIds = new Set();
    this.designResult = null;
    this.resultSelections = {};
    this.init();
  }

  SugarPdp.prototype.init = function () {
    this.cacheDom();
    this.initPrimarySelection();
    this.renderUploadInstruction();
    this.renderProductStrip();
    this.bindEvents();
    this.bindVariantSync();
    this.mountEmbedTrigger();
    if (this.config.customCss) {
      var style = document.createElement("style");
      style.textContent = this.config.customCss;
      this.root.appendChild(style);
    }
    if (this.config.headerIconUrl && this.headerIcon) {
      this.headerIcon.innerHTML =
        '<img src="' + this.config.headerIconUrl + '" alt="">';
    }
  };

  SugarPdp.prototype.cacheDom = function () {
    this.dialog = this.root.querySelector("[data-sugar-dialog]");
    this.steps = {};
    var self = this;
    STEPS.forEach(function (step) {
      self.steps[step] = self.root.querySelector('[data-sugar-step="' + step + '"]');
    });
    this.errorEl = this.root.querySelector("[data-sugar-error]");
    this.roomPreview = this.root.querySelector("[data-sugar-room-preview]");
    this.productStrip = this.root.querySelector("[data-sugar-product-strip]");
    this.checklist = this.root.querySelector("[data-sugar-checklist]");
    this.designImage = this.root.querySelector("[data-sugar-design-image]");
    this.demoBadge = this.root.querySelector("[data-sugar-demo-badge]");
    this.addDesignBtn = this.root.querySelector("[data-sugar-add-design]");
    this.fileGallery = this.root.querySelector("[data-sugar-file-gallery]");
    this.fileCamera = this.root.querySelector("[data-sugar-file-camera]");
    this.uploadInstruction = this.root.querySelector("[data-sugar-upload-instruction]");
    this.headerIcon = this.root.querySelector("[data-sugar-header-icon]");
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

  SugarPdp.prototype.initPrimarySelection = function () {
    if (this.primaryProduct.productId) {
      this.selectedProductIds.add(String(this.primaryProduct.productId));
    }
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
    var template =
      this.config.modalDescription ||
      this.t("modalDescription", "");
    this.uploadInstruction.innerHTML = template.replace(
      /\{productTitle\}/g,
      "<strong>" + (this.primaryProduct.title || "") + "</strong>",
    );
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
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className =
        "sugar-product-chip" + (self.selectedProductIds.has(id) ? " is-selected" : "");
      chip.dataset.productId = id;
      if (product.isPrimary) chip.dataset.primary = "true";
      chip.innerHTML =
        '<img class="sugar-product-chip__img" src="' +
        (product.imageUrl || "") +
        '" alt=""><span class="sugar-product-chip__title">' +
        (product.title || "") +
        "</span>";
      self.productStrip.appendChild(chip);
    });
  };

  SugarPdp.prototype.renderResultChecklist = function () {
    if (!this.checklist || !this.designResult) return;
    this.checklist.innerHTML = "";
    var self = this;

    var designSection = document.createElement("p");
    designSection.className = "sugar-checklist__section-title";
    designSection.textContent = this.t("checklistDesign", "DESIGN");
    this.checklist.appendChild(designSection);

    var designRow = document.createElement("label");
    designRow.className = "sugar-check-item";
    designRow.innerHTML =
      '<input type="checkbox" checked disabled>' +
      '<div class="sugar-check-item__info"><p class="sugar-check-item__title">' +
      this.t("aiPreviewTitle", "AI Preview") +
      "</p>" +
      '<p class="sugar-check-item__price">' +
      this.designResult.generationId +
      "</p></div>";
    this.checklist.appendChild(designRow);

    var productsSection = document.createElement("p");
    productsSection.className = "sugar-checklist__section-title";
    productsSection.textContent = this.t("checklistProducts", "PRODUCTS");
    this.checklist.appendChild(productsSection);

    (this.designResult.products || []).forEach(function (p) {
      var vid = String(p.variantId);
      if (self.resultSelections[vid] === undefined) {
        self.resultSelections[vid] = p.selectedByDefault !== false;
      }
      var label = document.createElement("label");
      label.className = "sugar-check-item";
      label.innerHTML =
        '<input type="checkbox" data-sugar-product-check data-variant-id="' +
        vid +
        '"' +
        (self.resultSelections[vid] ? " checked" : "") +
        ">" +
        '<img class="sugar-check-item__img" src="' +
        (p.imageUrl || "") +
        '" alt="">' +
        '<div class="sugar-check-item__info"><p class="sugar-check-item__title">' +
        p.title +
        '</p><p class="sugar-check-item__price">' +
        formatMoney(p.price, p.currency, self.locale) +
        "</p></div>";
      self.checklist.appendChild(label);
    });

    this.updateAddButtonState();
  };

  SugarPdp.prototype.applyVariant = function (variantId) {
    if (!variantId || !this.variants.length) return;
    var variant = this.variants.find(function (v) {
      return String(v.variantId) === String(variantId);
    });
    if (!variant) return;
    this.primaryProduct.variantId = String(variant.variantId);
    this.primaryProduct.price = String(variant.price);
    if (variant.imageUrl) {
      this.primaryProduct.imageUrl = variant.imageUrl;
      this.primaryProduct.images = variant.images || [variant.imageUrl];
    }
    this.renderProductStrip();
    this.renderUploadInstruction();
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
    this.step = step;
    var self = this;
    STEPS.forEach(function (s) {
      if (self.steps[s]) self.steps[s].classList.toggle("is-active", s === step);
    });
  };

  SugarPdp.prototype.openModal = function () {
    if (!this.dialog || this.dialog.open) return;
    this.hideError();
    this.setStep("upload");
    this.dialog.showModal();
  };

  SugarPdp.prototype.closeModal = function () {
    if (this.dialog && this.dialog.open) this.dialog.close();
  };

  SugarPdp.prototype.showError = function (msg) {
    if (this.errorEl) {
      this.errorEl.textContent = msg;
      this.errorEl.classList.add("is-visible");
    }
  };

  SugarPdp.prototype.hideError = function () {
    if (this.errorEl) this.errorEl.classList.remove("is-visible");
  };

  SugarPdp.prototype.shouldSkipProductStep = function () {
    if (this.config.skipProductSelection) return true;
    return this.catalog.length === 0;
  };

  SugarPdp.prototype.afterRoomUpload = function () {
    if (this.shouldSkipProductStep()) this.runDesign();
    else this.setStep("products");
  };

  SugarPdp.prototype.handleRoomFile = function (file) {
    this.hideError();
    if (!file || !file.type.startsWith("image/")) {
      this.showError(this.t("errorUpload", "Please upload a valid image."));
      return;
    }
    var maxMb = Number(this.config.maxUploadSizeMb || 10);
    if (file.size > maxMb * 1024 * 1024) {
      this.showError(this.t("errorSize", "File is too large."));
      return;
    }
    this.roomFile = file;
    if (this.roomPreviewUrl) URL.revokeObjectURL(this.roomPreviewUrl);
    this.roomPreviewUrl = URL.createObjectURL(file);
    if (this.roomPreview) this.roomPreview.src = this.roomPreviewUrl;
    this.afterRoomUpload();
  };

  SugarPdp.prototype.getSelectedProductsPayload = function () {
    var payload = [];
    var self = this;
    this.allProducts().forEach(function (p) {
      var id = String(p.productId);
      if (!self.selectedProductIds.has(id)) return;
      payload.push({
        productId: id,
        variantId: String(p.variantId),
        title: p.title,
        handle: p.handle,
        price: String(p.price),
        currency: p.currency || "TRY",
        imageUrl: p.imageUrl,
        images: p.images || [p.imageUrl],
        isPrimary: !!p.isPrimary,
      });
    });
    return payload;
  };

  SugarPdp.prototype.runDesign = async function () {
    if (!this.roomFile) {
      this.showError(this.t("errorRoomRequired", "A room photo is required."));
      this.setStep("upload");
      return;
    }
    if (this.getSelectedProductsPayload().length === 0) {
      this.showError(this.t("errorSelectProduct", "Select at least one product."));
      return;
    }

    this.hideError();
    this.setStep("loading");

    try {
      var base64 = await fileToBase64(this.roomFile);
      var formData = new FormData();
      formData.append("products", JSON.stringify(this.getSelectedProductsPayload()));
      formData.append("roomImageBase64", base64);
      formData.append("roomImageName", this.roomFile.name);

      var response = await fetch(this.config.proxyUrl || "/apps/sugar/generate", {
        method: "POST",
        body: formData,
      });
      var data = await response.json();

      if (!response.ok || data.status === "failed") {
        throw new Error(data.message || this.t("errorGenerate", "Could not create design."));
      }

      this.designResult = data;
      this.resultSelections = {};
      if (this.designImage) {
        this.designImage.src = data.imageUrl || "";
        this.designImage.alt = this.t("previewAlt", "AI preview");
      }
      if (this.demoBadge) {
        var isMock = String(data.generationId || "").indexOf("mock-") === 0;
        if (isMock) this.demoBadge.removeAttribute("hidden");
        else this.demoBadge.setAttribute("hidden", "");
      }
      this.renderResultChecklist();
      this.setStep("result");
    } catch (err) {
      this.showError(err instanceof Error ? err.message : this.t("errorGeneric", "Something went wrong"));
      this.setStep(this.shouldSkipProductStep() ? "upload" : "products");
    }
  };

  SugarPdp.prototype.addDesignToCart = function () {
    if (!this.designResult || !this.addDesignBtn) return;

    var items = [];
    var imageKey = this.config.imagePropertyKey || "_sugar_design_image";
    var genKey = this.config.generationIdPropertyKey || "_sugar_generation_id";
    var self = this;

    (this.designResult.products || []).forEach(function (p) {
      var vid = String(p.variantId);
      if (!self.resultSelections[vid]) return;
      var props = {};
      props[imageKey] = self.designResult.imageUrl;
      props[genKey] = self.designResult.generationId;
      items.push({ id: Number(p.variantId), quantity: 1, properties: props });
    });

    if (items.length === 0) {
      this.showError(this.t("errorSelectProduct", "Select at least one product."));
      return;
    }

    this.addDesignBtn.disabled = true;
    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error(self.t("errorCart", "Could not add to cart"));
        window.location.href = "/cart";
      })
      .catch(function () {
        self.addDesignBtn.disabled = false;
        self.showError(self.t("errorCartRetry", "Could not add to cart. Please try again."));
      });
  };

  SugarPdp.prototype.updateAddButtonState = function () {
    if (!this.addDesignBtn) return;
    var any = Object.keys(this.resultSelections).some(
      function (k) {
        return this.resultSelections[k];
      }.bind(this),
    );
    this.addDesignBtn.disabled = !any;
  };

  SugarPdp.prototype.bindEvents = function () {
    var self = this;

    this.root.querySelector("[data-sugar-open]")?.addEventListener("click", function () {
      self.openModal();
    });

    this.root.querySelectorAll("[data-sugar-close]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.closeModal();
      });
    });

    [this.fileGallery, this.fileCamera].forEach(function (input) {
      if (!input) return;
      input.addEventListener("change", function () {
        if (input.files && input.files[0]) {
          self.handleRoomFile(input.files[0]);
          input.value = "";
        }
      });
    });

    this.root.querySelector("[data-sugar-back-upload]")?.addEventListener("click", function () {
      self.setStep("upload");
    });

    this.root.querySelector("[data-sugar-design]")?.addEventListener("click", function () {
      self.runDesign();
    });

    this.root.querySelector("[data-sugar-redo]")?.addEventListener("click", function () {
      self.setStep(self.shouldSkipProductStep() ? "upload" : "products");
    });

    this.addDesignBtn?.addEventListener("click", function () {
      self.addDesignToCart();
    });

    this.productStrip?.addEventListener("click", function (e) {
      var chip = e.target.closest(".sugar-product-chip");
      if (!chip || chip.dataset.primary === "true") return;
      var id = chip.dataset.productId;
      if (self.selectedProductIds.has(id)) self.selectedProductIds.delete(id);
      else self.selectedProductIds.add(id);
      self.renderProductStrip();
    });

    this.checklist?.addEventListener("change", function (e) {
      var input = e.target;
      if (!input.matches("[data-sugar-product-check]")) return;
      self.resultSelections[input.dataset.variantId] = input.checked;
      self.updateAddButtonState();
    });
  };

  function initAll() {
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
