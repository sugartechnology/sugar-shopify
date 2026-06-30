(function () {
  "use strict";

  var STEPS = ["upload", "pick-source", "camera", "products", "loading", "result"];
  var DESIGN_STORAGE_KEY = "sugar_pdp_visitor_designs";
  var DEFAULT_MAX_SAVED_DESIGNS = 20;

  function readDesignStore() {
    try {
      var raw = localStorage.getItem(DESIGN_STORAGE_KEY);
      if (!raw) return { version: 1, byProduct: {} };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return { version: 1, byProduct: {} };
      }
      if (!parsed.byProduct || typeof parsed.byProduct !== "object") {
        parsed.byProduct = {};
      }
      return parsed;
    } catch {
      return { version: 1, byProduct: {} };
    }
  }

  function writeDesignStore(store) {
    try {
      localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* quota exceeded — ignore */
    }
  }

  function getDesignsForProduct(productId) {
    var store = readDesignStore();
    var list = store.byProduct[String(productId)] || [];
    return list.slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function saveDesignForProduct(productId, record, maxCount) {
    var store = readDesignStore();
    var key = String(productId);
    var list = store.byProduct[key] || [];
    var id = String(record.id || record.generationId || Date.now());
    list = list.filter(function (item) {
      return String(item.id) !== id;
    });
    list.unshift({
      id: id,
      generationId: record.generationId || id,
      imageUrl: record.imageUrl || "",
      thumbnailUrl: record.thumbnailUrl || record.imageUrl || "",
      status: record.status || "completed",
      createdAt: record.createdAt || Date.now(),
      productId: String(productId),
      variantId: String(record.variantId || ""),
      productTitle: record.productTitle || "",
      products: record.products || [],
    });
    list = list.slice(0, maxCount || DEFAULT_MAX_SAVED_DESIGNS);
    store.byProduct[key] = list;
    writeDesignStore(store);
    return list;
  }

  function removeDesignForProduct(productId, designId) {
    var store = readDesignStore();
    var key = String(productId);
    var list = store.byProduct[key] || [];
    list = list.filter(function (item) {
      return String(item.id) !== String(designId);
    });
    if (list.length) store.byProduct[key] = list;
    else delete store.byProduct[key];
    writeDesignStore(store);
    return list;
  }

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

  function ensureMediaDevices() {
    if (typeof navigator === "undefined") return false;
    if (!navigator.mediaDevices) {
      navigator.mediaDevices = {};
    }
    if (!navigator.mediaDevices.getUserMedia) {
      var legacy =
        navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia;
      if (!legacy) return false;
      navigator.mediaDevices.getUserMedia = function (constraints) {
        return new Promise(function (resolve, reject) {
          legacy.call(navigator, constraints, resolve, reject);
        });
      };
    }
    return true;
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
    this.cameraStream = null;
    this.toastTimer = null;
    this.init();
  }

  SugarPdp.prototype.init = function () {
    this.cacheDom();
    this.initPrimarySelection();
    this.renderUploadInstruction();
    this.renderProductStrip();
    this.renderSavedDesigns();
    this.bindEvents();
    this.bindVariantSync();
    this.mountEmbedTrigger();
    this.applyBrandingAssets();
    this.initMediaReveal();
    if (this.config.customCss) {
      var style = document.createElement("style");
      style.textContent = this.config.customCss;
      this.root.appendChild(style);
    }
  };

  SugarPdp.prototype.cacheDom = function () {
    this.dialog = this.root.querySelector("[data-sugar-dialog]");
    this.steps = {};
    var self = this;
    STEPS.forEach(function (step) {
      self.steps[step] = self.root.querySelector('[data-sugar-step="' + step + '"]');
    });
    this.toastEl = this.root.querySelector("[data-sugar-toast]");
    this.roomPreview = this.root.querySelector("[data-sugar-room-preview]");
    this.productStrip = this.root.querySelector("[data-sugar-product-strip]");
    this.checklist = this.root.querySelector("[data-sugar-checklist]");
    this.designImage = this.root.querySelector("[data-sugar-design-image]");
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
    this.uploadIllustration = this.root.querySelector("[data-sugar-upload-illustration]");
  };

  SugarPdp.prototype.getMediaContainer = function (img) {
    if (!img) return null;
    return img.closest("[data-sugar-upload-hero], .sugar-design-preview");
  };

  SugarPdp.prototype.markMediaLoaded = function (img) {
    if (!img) return;
    var container = this.getMediaContainer(img);
    img.classList.add("is-loaded");
    if (container) container.classList.add("is-loaded");
  };

  SugarPdp.prototype.markMediaLoading = function (img) {
    if (!img) return;
    var container = this.getMediaContainer(img);
    img.classList.remove("is-loaded");
    if (container) container.classList.remove("is-loaded");
  };

  SugarPdp.prototype.bindMediaReveal = function (img) {
    if (!img || img.__sugarRevealBound) return;
    img.__sugarRevealBound = true;
    var self = this;
    img.addEventListener("load", function () {
      self.markMediaLoaded(img);
    });
    img.addEventListener("error", function () {
      self.markMediaLoaded(img);
    });
    if (img.complete && img.naturalWidth > 0) {
      this.markMediaLoaded(img);
    } else {
      this.markMediaLoading(img);
    }
  };

  SugarPdp.prototype.initMediaReveal = function () {
    var self = this;
    [this.uploadIllustration, this.roomPreview, this.designImage].forEach(function (img) {
      if (img) self.bindMediaReveal(img);
    });
  };

  SugarPdp.prototype.setMediaSrc = function (img, src) {
    if (!img || !src) return;
    this.markMediaLoading(img);
    img.src = src;
    if (img.complete && img.naturalWidth > 0) {
      this.markMediaLoaded(img);
    }
  };

  SugarPdp.prototype.animateModalHeight = function (startHeight) {
    var modal = this.root.querySelector(".sugar-modal");
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
    var illustrationUrl =
      this.config.uploadIllustrationUrl || this.config.heroImageUrl || "";
    var illustrationFit = this.config.uploadIllustrationFit === "contain" ? "contain" : "cover";
    this.root.style.setProperty("--sugar-upload-fit", illustrationFit);
    if (this.uploadIllustration) {
      var hero = this.uploadIllustration.closest("[data-sugar-upload-hero]");
      if (hero) {
        hero.classList.remove("sugar-upload-hero--cover", "sugar-upload-hero--contain");
        hero.classList.add("sugar-upload-hero--" + illustrationFit);
      }
    }
    if (illustrationUrl && this.uploadIllustration) {
      this.setMediaSrc(this.uploadIllustration, illustrationUrl);
    }
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
    if (variant.imageUrl) {
      this.primaryProduct.imageUrl = variant.imageUrl;
    }
    this.renderProductStrip();
    this.renderUploadInstruction();
  };

  SugarPdp.prototype.syncPrimaryToSelectedVariant = function () {
    var variantId = this.getSelectedVariantId();
    if (variantId) this.applyVariant(variantId);
  };

  SugarPdp.prototype.initPrimarySelection = function () {
    if (this.primaryProduct.productId) {
      this.selectedProductIds.add(String(this.primaryProduct.productId));
    }
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

  SugarPdp.prototype.getProductDesignKey = function () {
    return String(this.primaryProduct.productId || "");
  };

  SugarPdp.prototype.getMaxSavedDesigns = function () {
    return Number(this.config.maxSavedDesignsPerProduct || DEFAULT_MAX_SAVED_DESIGNS);
  };

  SugarPdp.prototype.loadProductDesigns = function () {
    return getDesignsForProduct(this.getProductDesignKey());
  };

  SugarPdp.prototype.persistCurrentDesign = function (data) {
    var productId = this.getProductDesignKey();
    if (!productId || !data || !data.imageUrl) return;
    saveDesignForProduct(
      productId,
      {
        id: data.generationId || "design-" + Date.now(),
        generationId: data.generationId,
        imageUrl: data.imageUrl,
        thumbnailUrl: data.thumbnailUrl,
        status: data.status,
        variantId: this.primaryProduct.variantId,
        productTitle: this.primaryProduct.title,
        products: data.products || [],
      },
      this.getMaxSavedDesigns(),
    );
    this.renderSavedDesigns();
  };

  SugarPdp.prototype.formatSavedDesignDate = function (timestamp) {
    try {
      return new Intl.DateTimeFormat(this.locale || undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(timestamp));
    } catch {
      return new Date(timestamp).toLocaleString();
    }
  };

  SugarPdp.prototype.createSavedDesignCard = function (design) {
    var card = document.createElement("div");
    card.className = "sugar-saved-design";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.dataset.designId = design.id;
    card.innerHTML =
      '<img class="sugar-saved-design__img" src="' +
      (design.thumbnailUrl || design.imageUrl) +
      '" alt="">' +
      '<span class="sugar-saved-design__date">' +
      this.formatSavedDesignDate(design.createdAt) +
      "</span>" +
      '<span class="sugar-saved-design__delete" role="button" tabindex="0" aria-label="' +
      this.t("savedDesignDelete", "Tasarımı sil") +
      '" data-sugar-delete-design="' +
      design.id +
      '">×</span>';
    return card;
  };

  SugarPdp.prototype.renderSavedDesigns = function () {
    var designs = this.loadProductDesigns();
    var section = this.root.querySelector("[data-sugar-saved-designs-page]");
    var strip = section && section.querySelector("[data-sugar-saved-strip]");
    var self = this;

    if (section) {
      section.hidden = designs.length === 0;
    }
    if (!strip) return;

    strip.innerHTML = "";
    designs.forEach(function (design) {
      strip.appendChild(self.createSavedDesignCard(design));
    });
  };

  SugarPdp.prototype.renderPickSourceDesigns = function () {
    var strip = this.root.querySelector("[data-sugar-pick-source-strip]");
    if (!strip) return;
    var self = this;
    strip.innerHTML = "";
    this.loadProductDesigns().forEach(function (design) {
      strip.appendChild(self.createSavedDesignCard(design));
    });
  };

  SugarPdp.prototype.openGalleryPicker = function () {
    if (this.fileGallery) {
      this.fileGallery.click();
    }
  };

  SugarPdp.prototype.openGalleryFlow = function () {
    if (this.loadProductDesigns().length > 0) {
      this.renderPickSourceDesigns();
      this.setStep("pick-source");
      return;
    }
    this.openGalleryPicker();
  };

  SugarPdp.prototype.openSavedDesign = function (designId) {
    var designs = this.loadProductDesigns();
    var record = designs.find(function (item) {
      return String(item.id) === String(designId);
    });
    if (!record) return;

    this.hideMessage();
    this.designResult = {
      generationId: record.generationId,
      imageUrl: record.imageUrl,
      thumbnailUrl: record.thumbnailUrl,
      status: record.status || "completed",
      products: record.products || [],
    };
    this.resultSelections = {};
    if (this.designImage) {
      this.setMediaSrc(this.designImage, record.imageUrl || "");
      this.designImage.alt = this.t("previewAlt", "AI preview");
    }
    if (this.demoBadge) {
      var isMock = String(record.generationId || "").indexOf("mock-") === 0;
      if (isMock) this.demoBadge.removeAttribute("hidden");
      else this.demoBadge.setAttribute("hidden", "");
    }
    if (!this.dialog.open) {
      this.stopCameraStream();
      this.dialog.showModal();
    }
    this.renderResultChecklist();
    this.setStep("result");
  };

  SugarPdp.prototype.deleteSavedDesign = function (designId) {
    removeDesignForProduct(this.getProductDesignKey(), designId);
    this.renderSavedDesigns();
    this.renderPickSourceDesigns();
    if (this.step === "pick-source" && this.loadProductDesigns().length === 0) {
      this.setStep("upload");
    }
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
    if (step !== "camera") {
      this.stopCameraStream();
    }
    var modal = this.root.querySelector(".sugar-modal");
    var canAnimate = !!(modal && this.dialog && this.dialog.open);
    var startHeight = canAnimate ? modal.getBoundingClientRect().height : 0;
    this.step = step;
    var self = this;
    STEPS.forEach(function (s) {
      if (self.steps[s]) self.steps[s].classList.toggle("is-active", s === step);
    });
    if (step === "products") {
      this.updateReviewStep();
    }
    if (canAnimate) {
      this.animateModalHeight(startHeight);
    }
  };

  SugarPdp.prototype.updateReviewStep = function () {
    var skipProducts = this.shouldSkipProductStep();
    if (this.productsSection) {
      this.productsSection.hidden = skipProducts;
    }
    if (this.reviewInstruction) {
      this.reviewInstruction.textContent = skipProducts
        ? this.t(
            "reviewInstructionOnly",
            "Oda fotoğrafınızı kontrol edin, ardından tasarlayın.",
          )
        : this.config.instructionTemplate ||
          this.t(
            "reviewInstruction",
            "Oda fotoğrafınızı ve seçili ürünleri kontrol edin, ardından tasarlayın.",
          );
    }
  };

  SugarPdp.prototype.stopCameraStream = function () {
    if (!this.cameraStream) return;
    this.cameraStream.getTracks().forEach(function (track) {
      track.stop();
    });
    this.cameraStream = null;
    if (this.cameraVideo) {
      this.cameraVideo.srcObject = null;
    }
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
    if (!ensureMediaDevices()) {
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
        var file = new File([blob], "room-camera.jpg", { type: "image/jpeg" });
        self.stopCameraStream();
        self.handleRoomFile(file);
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

  SugarPdp.prototype.showMessage = function (message, type, duration) {
    if (!this.toastEl || !message) return;
    if (this.dialog && !this.dialog.open) {
      this.dialog.showModal();
    }
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

  SugarPdp.prototype.showInfo = function (message, duration) {
    this.showMessage(message, "info", duration);
  };

  SugarPdp.prototype.openModal = function () {
    if (!this.dialog || this.dialog.open) return;
    this.hideMessage();
    this.stopCameraStream();
    this.dialog.showModal();
    this.setStep("upload");
  };

  SugarPdp.prototype.closeModal = function () {
    this.hideMessage();
    this.stopCameraStream();
    if (this.dialog && this.dialog.open) this.dialog.close();
  };

  SugarPdp.prototype.shouldSkipProductStep = function () {
    if (this.config.skipProductSelection) return true;
    return this.catalog.length === 0;
  };

  SugarPdp.prototype.afterRoomUpload = function () {
    this.setStep("products");
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
    this.roomFile = file;
    if (this.roomPreviewUrl) URL.revokeObjectURL(this.roomPreviewUrl);
    this.roomPreviewUrl = URL.createObjectURL(file);
    if (this.roomPreview) {
      this.setMediaSrc(this.roomPreview, this.roomPreviewUrl);
    }
    this.afterRoomUpload();
  };

  SugarPdp.prototype.getSelectedSelectionsPayload = function () {
    var payload = [];
    var self = this;
    this.allProducts().forEach(function (p) {
      var id = String(p.productId);
      if (!self.selectedProductIds.has(id)) return;
      payload.push({
        productId: id,
        variantId: String(p.variantId),
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
    if (this.getSelectedSelectionsPayload().length === 0) {
      this.showError(this.t("errorSelectProduct", "Select at least one product."));
      this.setStep("products");
      return;
    }

    this.syncPrimaryToSelectedVariant();
    this.hideMessage();
    this.setStep("loading");

    try {
      var base64 = await fileToBase64(this.roomFile);
      var formData = new FormData();
      formData.append("selections", JSON.stringify(this.getSelectedSelectionsPayload()));
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
        this.setMediaSrc(this.designImage, data.imageUrl || "");
        this.designImage.alt = this.t("previewAlt", "AI preview");
      }
      if (this.demoBadge) {
        var isMock = String(data.generationId || "").indexOf("mock-") === 0;
        if (isMock) this.demoBadge.removeAttribute("hidden");
        else this.demoBadge.setAttribute("hidden", "");
      }
      this.renderResultChecklist();
      this.persistCurrentDesign(data);
      this.setStep("result");
    } catch (err) {
      this.showError(err instanceof Error ? err.message : this.t("errorGeneric", "Something went wrong"));
      this.setStep("products");
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
        var detail = self
          .t("cartSuccessDetail", "{{count}} ürün sepetinize eklendi.")
          .replace(/\{\{count\}\}/g, String(items.length));
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

    if (this.fileGallery) {
      this.fileGallery.addEventListener("change", function () {
        if (self.fileGallery.files && self.fileGallery.files[0]) {
          self.stopCameraStream();
          self.handleRoomFile(self.fileGallery.files[0]);
          self.fileGallery.value = "";
        }
      });
    }

    this.root.querySelector("[data-sugar-open-gallery]")?.addEventListener("click", function (e) {
      e.preventDefault();
      self.openGalleryFlow();
    });

    this.root.querySelector("[data-sugar-pick-new-photo]")?.addEventListener("click", function () {
      self.openGalleryPicker();
    });

    this.root.querySelector("[data-sugar-pick-source-back]")?.addEventListener("click", function () {
      self.setStep("upload");
    });

    this.root.querySelector("[data-sugar-open-camera]")?.addEventListener("click", function (e) {
      e.preventDefault();
      self.openCameraStep();
    });

    this.root.querySelector("[data-sugar-camera-cancel]")?.addEventListener("click", function () {
      self.stopCameraStream();
      self.setStep("upload");
    });

    this.root.querySelector("[data-sugar-camera-capture]")?.addEventListener("click", function () {
      self.captureFromCamera();
    });

    this.root.querySelector("[data-sugar-back-upload]")?.addEventListener("click", function () {
      self.setStep("upload");
    });

    this.root.querySelector("[data-sugar-design]")?.addEventListener("click", function () {
      self.runDesign();
    });

    this.root.querySelector("[data-sugar-redo]")?.addEventListener("click", function () {
      self.hideMessage();
      self.setStep(self.roomFile ? "products" : "upload");
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

    this.root.addEventListener("click", function (e) {
      var deleteBtn = e.target.closest("[data-sugar-delete-design]");
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        self.deleteSavedDesign(deleteBtn.getAttribute("data-sugar-delete-design"));
        return;
      }
      var card = e.target.closest(".sugar-saved-design");
      if (!card || !card.dataset.designId) return;
      self.openSavedDesign(card.dataset.designId);
    });

    this.root.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest(".sugar-saved-design");
      if (!card || !card.dataset.designId) return;
      e.preventDefault();
      self.openSavedDesign(card.dataset.designId);
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
