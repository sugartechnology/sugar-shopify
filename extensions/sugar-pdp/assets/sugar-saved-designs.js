(function (global) {
  "use strict";

  var core = global.SugarPdpKit.core;

  function SavedDesigns(pdp) {
    this.pdp = pdp;
    this.section = pdp.root.querySelector("[data-sugar-saved-designs-page]");
    this.strip =
      this.section && this.section.querySelector("[data-sugar-saved-strip]");
  }

  SavedDesigns.prototype.t = function (key, fallback) {
    return this.pdp.t(key, fallback);
  };

  SavedDesigns.prototype.getProductKey = function () {
    return String(this.pdp.primaryProduct.productId || "");
  };

  SavedDesigns.prototype.getMax = function () {
    return Number(
      this.pdp.config.maxSavedDesignsPerProduct ||
        core.DEFAULT_MAX_SAVED_DESIGNS,
    );
  };

  SavedDesigns.prototype.load = function () {
    return core.getDesignsForProduct(this.getProductKey());
  };

  SavedDesigns.prototype.getDesignById = function (designId) {
    return this.load().find(function (item) {
      return String(item.id) === String(designId);
    });
  };

  SavedDesigns.prototype.renderPage = function () {
    var designs = this.load();
    if (this.section) {
      if (designs.length === 0) this.section.setAttribute("hidden", "");
      else this.section.removeAttribute("hidden");
    }
    if (!this.strip) return;
    var self = this;
    this.strip.innerHTML = "";
    designs.forEach(function (design) {
      self.strip.appendChild(self.createCard(design));
    });
  };

  SavedDesigns.prototype.createPickGridItem = function (design) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = "sugar-pick-grid__item";
    card.dataset.sugarPickDesign = design.id;
    card.setAttribute("aria-label", this.formatDate(design.createdAt));
    card.innerHTML =
      '<span class="sugar-pick-grid__media">' +
      '<img class="sugar-pick-grid__img" src="' +
      (design.imageUrl || design.thumbnailUrl) +
      '" alt="" loading="lazy">' +
      "</span>" +
      '<span class="sugar-pick-grid__date">' +
      this.formatDate(design.createdAt) +
      "</span>";
    return card;
  };

  SavedDesigns.prototype.renderPickSource = function () {
    var strip =
      (this.pdp.dialog &&
        this.pdp.dialog.querySelector("[data-sugar-pick-source-strip]")) ||
      this.pdp.root.querySelector("[data-sugar-pick-source-strip]");
    if (!strip) return;

    var designs = this.load();
    var self = this;
    strip.innerHTML = "";

    if (designs.length === 0) {
      strip.setAttribute("hidden", "");
      return;
    }

    strip.removeAttribute("hidden");
    designs.forEach(function (design) {
      strip.appendChild(self.createPickGridItem(design));
    });
  };

  SavedDesigns.prototype.formatDate = function (timestamp) {
    try {
      return new Intl.DateTimeFormat(this.pdp.locale || undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(timestamp));
    } catch {
      return new Date(timestamp).toLocaleString();
    }
  };

  SavedDesigns.prototype.getUsedProducts = function (design) {
    if (design.placements && design.placements.length) {
      return design.placements.map(function (p) {
        return { title: p.title || "", imageUrl: p.imageUrl || "" };
      });
    }
    return (design.products || []).map(function (p) {
      return { title: p.title || "", imageUrl: p.imageUrl || "" };
    });
  };

  SavedDesigns.prototype.createCard = function (design) {
    var card = document.createElement("div");
    card.className = "sugar-saved-design";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.dataset.designId = design.id;

    var usedProducts = this.getUsedProducts(design);
    var productsHtml = "";
    if (usedProducts.length) {
      productsHtml =
        '<div class="sugar-saved-design__products" aria-label="' +
        usedProducts.length +
        " " +
        this.t("savedDesignProductCount", "ürün") +
        '">';
      usedProducts.slice(0, 4).forEach(function (p) {
        var title = (p.title || "").replace(/"/g, "&quot;");
        productsHtml +=
          '<img class="sugar-saved-design__product" src="' +
          (p.imageUrl || "") +
          '" alt="' +
          title +
          '" title="' +
          title +
          '">';
      });
      if (usedProducts.length > 4) {
        productsHtml +=
          '<span class="sugar-saved-design__more">+' +
          (usedProducts.length - 4) +
          "</span>";
      }
      productsHtml += "</div>";
    }

    card.innerHTML =
      '<img class="sugar-saved-design__img" src="' +
      (design.thumbnailUrl || design.imageUrl) +
      '" alt="">' +
      '<span class="sugar-saved-design__date">' +
      this.formatDate(design.createdAt) +
      "</span>" +
      productsHtml +
      '<span class="sugar-saved-design__delete" role="button" tabindex="0" aria-label="' +
      this.t("savedDesignDelete", "Tasarımı sil") +
      '" data-sugar-delete-design="' +
      design.id +
      '">×</span>';
    return card;
  };

  SavedDesigns.prototype.persist = async function (data, resultPlacements) {
    var productId = this.getProductKey();
    var sourceImageUrl = (data && data.imageUrl) || "";
    if (!productId || !sourceImageUrl) return;

    var storedImageUrl = await core.resolveStoredDesignImageUrl(sourceImageUrl);
    if (!storedImageUrl) return;

    var thumbnailUrl = await core.createDesignThumbnail(sourceImageUrl);
    if (!thumbnailUrl) thumbnailUrl = storedImageUrl;

    var originPreview = this.pdp.mockup.roomPreviewUrl
      ? await core.compressDesignImage(this.pdp.mockup.roomPreviewUrl, {
          maxWidth: 1200,
          quality: 0.82,
        })
      : "";
    core.saveDesignForProduct(
      productId,
      {
        id: data.generationId || "design-" + Date.now(),
        generationId: data.generationId,
        imageUrl: storedImageUrl,
        thumbnailUrl: thumbnailUrl,
        originImageUrl: originPreview,
        status: data.status,
        variantId: this.pdp.primaryProduct.variantId,
        productTitle: this.pdp.primaryProduct.title,
        products: data.products || [],
        placements: resultPlacements || [],
      },
      this.getMax(),
    );
    this.renderPage();
  };

  SavedDesigns.prototype.open = function (designId) {
    var record = this.getDesignById(designId);
    if (!record) return;

    var priorStep = this.pdp.step;
    this.pdp.resultFromSavedDesign = true;
    this.pdp.resultReturnStep =
      priorStep === "pick-source" || this.load().length > 0
        ? "pick-source"
        : "upload";

    this.pdp.hideMessage();
    this.pdp.designResult = {
      generationId: record.generationId,
      imageUrl: record.imageUrl,
      thumbnailUrl: record.thumbnailUrl,
      status: record.status || "completed",
      products: record.products || [],
    };
    this.pdp.resultPlacements = (record.placements || []).map(function (p) {
      return Object.assign({}, p);
    });
    this.pdp.resultSelections = {};
    this.pdp.resultQuantities = {};
    this.pdp.compare.setImages(record.originImageUrl || "", record.imageUrl || "");
    if (this.pdp.demoBadge) {
      var isMock = String(record.generationId || "").indexOf("mock-") === 0;
      if (isMock) this.pdp.demoBadge.removeAttribute("hidden");
      else this.pdp.demoBadge.setAttribute("hidden", "");
    }
    if (!this.pdp.dialog.open) {
      this.pdp.stopCameraStream();
      this.pdp.dialog.showModal();
    }
    this.pdp.renderResultChecklist();
    this.pdp.setStep("result");
  };

  SavedDesigns.prototype.remove = function (designId) {
    core.removeDesignForProduct(this.getProductKey(), designId);
    this.renderPage();
    this.renderPickSource();
    if (this.pdp.step === "pick-source" && this.load().length === 0) {
      this.pdp.setStep("upload");
    }
  };

  SavedDesigns.prototype.openGalleryFlow = function () {
    if (this.load().length > 0) {
      this.renderPickSource();
      this.pdp.setStep("pick-source");
      return;
    }
    if (this.pdp.fileGallery) this.pdp.fileGallery.click();
  };

  global.SugarPdpKit = global.SugarPdpKit || {};
  global.SugarPdpKit.SavedDesigns = SavedDesigns;
})(window);
