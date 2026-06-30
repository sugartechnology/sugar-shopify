(function (global) {
  "use strict";

  var core = global.SugarPdpKit.core;
  var DEFAULT_PLACEMENT_SCALE = 0.28;
  var PLACEMENT_SCALE_MIN = 0.12;
  var PLACEMENT_SCALE_MAX = 0.55;
  var PLACEMENT_SCALE_STEP = 0.04;

  function MockupEditor(pdp) {
    this.pdp = pdp;
    this.placements = [];
    this.selectedPlacementId = null;
    this.placementDrag = null;
    this.roomFile = null;
    this.roomPreviewUrl = "";

    this.stage = pdp.root.querySelector("[data-sugar-mockup-stage]");
    this.layers = pdp.root.querySelector("[data-sugar-mockup-layers]");
    this.roomPreview = pdp.root.querySelector("[data-sugar-room-preview]");
    this.scaleBar = pdp.root.querySelector("[data-sugar-mockup-scale]");
    this.scaleDown = pdp.root.querySelector("[data-sugar-mockup-scale-down]");
    this.scaleUp = pdp.root.querySelector("[data-sugar-mockup-scale-up]");
  }

  MockupEditor.prototype.t = function (key, fallback) {
    return this.pdp.t(key, fallback);
  };

  MockupEditor.prototype.findCatalogProduct = function (productId) {
    var id = String(productId);
    if (String(this.pdp.primaryProduct.productId) === id) {
      return this.pdp.primaryProduct;
    }
    for (var i = 0; i < this.pdp.catalog.length; i++) {
      if (String(this.pdp.catalog[i].productId) === id) {
        return this.pdp.catalog[i];
      }
    }
    return null;
  };

  MockupEditor.prototype.isProductPlaced = function (productId) {
    var id = String(productId);
    for (var i = 0; i < this.placements.length; i++) {
      if (String(this.placements[i].productId) === id) return true;
    }
    return false;
  };

  MockupEditor.prototype.reset = function () {
    this.placements = [];
    this.selectedPlacementId = null;
    this.placementDrag = null;
    if (this.layers) this.layers.innerHTML = "";
    this.updateScaleControls();
  };

  MockupEditor.prototype.setRoomFile = function (file) {
    this.roomFile = file;
    if (this.roomPreviewUrl) URL.revokeObjectURL(this.roomPreviewUrl);
    this.roomPreviewUrl = URL.createObjectURL(file);
    this.reset();
    this.setRoomPreview(this.roomPreviewUrl);
  };

  MockupEditor.prototype.setRoomPreview = function (src) {
    if (!this.roomPreview || !src) return;
    var img = this.roomPreview;
    if (!img.__sugarRoomBound) {
      img.__sugarRoomBound = true;
      var self = this;
      img.addEventListener("load", function () {
        img.classList.add("is-loaded");
        var stage = img.closest("[data-sugar-mockup-stage]");
        if (stage) stage.classList.add("is-loaded");
      });
      img.addEventListener("error", function () {
        img.classList.add("is-loaded");
      });
    }
    img.classList.remove("is-loaded");
    img.src = src;
    if (img.complete && img.naturalWidth > 0) {
      img.classList.add("is-loaded");
      var container = img.closest("[data-sugar-mockup-stage]");
      if (container) container.classList.add("is-loaded");
    }
  };

  MockupEditor.prototype.addFromProduct = function (productId) {
    var product = this.findCatalogProduct(productId);
    if (!product) return;
    var id = "pl-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    var offset = this.placements.length * 0.04;
    this.placements.push({
      id: id,
      productId: String(product.productId),
      variantId: String(product.variantId),
      title: product.title || "",
      imageUrl: product.imageUrl || "",
      isPrimary: !!product.isPrimary,
      x: Math.min(0.92, Math.max(0.08, 0.5 + offset)),
      y: Math.min(0.88, Math.max(0.12, 0.52 + offset)),
      scale: DEFAULT_PLACEMENT_SCALE,
    });
    this.selectedPlacementId = id;
    this.renderLayers();
    this.pdp.renderProductStrip();
    this.updateScaleControls();
  };

  MockupEditor.prototype.remove = function (placementId) {
    this.placements = this.placements.filter(function (p) {
      return p.id !== placementId;
    });
    if (this.selectedPlacementId === placementId) {
      this.selectedPlacementId =
        this.placements.length > 0
          ? this.placements[this.placements.length - 1].id
          : null;
    }
    this.renderLayers();
    this.pdp.renderProductStrip();
    this.updateScaleControls();
  };

  MockupEditor.prototype.select = function (placementId) {
    this.selectedPlacementId = placementId;
    this.updateSelectionClasses();
  };

  MockupEditor.prototype.adjustSelectedScale = function (delta) {
    if (!this.selectedPlacementId) return;
    var placement = this.placements.find(
      function (p) {
        return p.id === this.selectedPlacementId;
      }.bind(this),
    );
    if (!placement) return;
    placement.scale = Math.min(
      PLACEMENT_SCALE_MAX,
      Math.max(
        PLACEMENT_SCALE_MIN,
        (placement.scale || DEFAULT_PLACEMENT_SCALE) + delta,
      ),
    );
    this.syncLayerScale(placement);
  };

  MockupEditor.prototype.getStageRect = function () {
    if (!this.stage) return null;
    return this.stage.getBoundingClientRect();
  };

  MockupEditor.prototype.applyPlacementToLayer = function (layer, placement) {
    layer.className =
      "sugar-mockup-layer" +
      (placement.id === this.selectedPlacementId ? " is-selected" : "");
    layer.dataset.placementId = placement.id;
    layer.style.left = placement.x * 100 + "%";
    layer.style.top = placement.y * 100 + "%";
    layer.style.width =
      (placement.scale || DEFAULT_PLACEMENT_SCALE) * 100 + "%";

    var img = layer.querySelector(".sugar-mockup-layer__img");
    if (img) {
      var nextSrc = placement.imageUrl || "";
      if (img.getAttribute("src") !== nextSrc) {
        img.src = nextSrc;
      }
    }
  };

  MockupEditor.prototype.createLayerElement = function (placement) {
    var layer = document.createElement("div");
    layer.innerHTML =
      '<img class="sugar-mockup-layer__img" crossorigin="anonymous" alt="" draggable="false">' +
      '<button type="button" class="sugar-mockup-layer__remove" data-sugar-mockup-remove aria-label="' +
      this.t("mockupRemove", "Remove") +
      '">×</button>';
    this.applyPlacementToLayer(layer, placement);
    return layer;
  };

  MockupEditor.prototype.findLayerElement = function (placementId) {
    if (!this.layers || !placementId) return null;
    return this.layers.querySelector(
      '.sugar-mockup-layer[data-placement-id="' + placementId + '"]',
    );
  };

  MockupEditor.prototype.updateSelectionClasses = function () {
    if (!this.layers) return;
    var self = this;
    this.layers.querySelectorAll(".sugar-mockup-layer").forEach(function (layer) {
      layer.classList.toggle(
        "is-selected",
        layer.dataset.placementId === self.selectedPlacementId,
      );
    });
    this.updateScaleControls();
  };

  MockupEditor.prototype.syncLayerPosition = function (placement) {
    var layer = this.findLayerElement(placement.id);
    if (!layer) return;
    layer.style.left = placement.x * 100 + "%";
    layer.style.top = placement.y * 100 + "%";
  };

  MockupEditor.prototype.syncLayerScale = function (placement) {
    var layer = this.findLayerElement(placement.id);
    if (!layer) return;
    layer.style.width =
      (placement.scale || DEFAULT_PLACEMENT_SCALE) * 100 + "%";
  };

  MockupEditor.prototype.updateFromPointer = function (placementId, clientX, clientY) {
    var rect = this.getStageRect();
    if (!rect || !rect.width || !rect.height) return;
    var placement = this.placements.find(function (p) {
      return p.id === placementId;
    });
    if (!placement) return;
    placement.x = Math.min(0.96, Math.max(0.04, (clientX - rect.left) / rect.width));
    placement.y = Math.min(0.96, Math.max(0.04, (clientY - rect.top) / rect.height));
    this.syncLayerPosition(placement);
  };

  MockupEditor.prototype.renderLayers = function () {
    if (!this.layers) return;
    var self = this;
    var existing = new Map();
    this.layers.querySelectorAll(".sugar-mockup-layer").forEach(function (layer) {
      if (layer.dataset.placementId) {
        existing.set(layer.dataset.placementId, layer);
      }
    });

    var activeIds = {};
    this.placements.forEach(function (placement) {
      activeIds[placement.id] = true;
    });

    existing.forEach(function (layer, id) {
      if (!activeIds[id]) layer.remove();
    });

    this.placements.forEach(function (placement) {
      var layer = existing.get(placement.id);
      if (!layer) {
        layer = self.createLayerElement(placement);
        self.layers.appendChild(layer);
        return;
      }
      self.applyPlacementToLayer(layer, placement);
    });
  };

  MockupEditor.prototype.updateScaleControls = function () {
    if (!this.scaleBar) return;
    this.scaleBar.hidden = !this.selectedPlacementId;
  };

  MockupEditor.prototype.syncPrimaryVariant = function (variantId, imageUrl) {
    this.placements.forEach(function (placement) {
      if (placement.isPrimary) {
        placement.variantId = String(variantId);
        if (imageUrl) placement.imageUrl = imageUrl;
      }
    });
    this.renderLayers();
  };

  MockupEditor.prototype.getSelectionsPayload = function () {
    return this.placements.map(function (placement) {
      return {
        productId: placement.productId,
        variantId: placement.variantId,
        isPrimary: !!placement.isPrimary,
        position: {
          x: placement.x,
          y: placement.y,
          scale: placement.scale || DEFAULT_PLACEMENT_SCALE,
        },
      };
    });
  };

  MockupEditor.prototype.buildGeneratePayload = function () {
    if (this.placements.length > 0) {
      return {
        selections: this.getSelectionsPayload(),
        includeMockup: true,
      };
    }

    var primary = this.pdp.primaryProduct;
    return {
      selections: [
        {
          productId: String(primary.productId || ""),
          variantId: String(primary.variantId || ""),
          isPrimary: true,
        },
      ],
      includeMockup: false,
    };
  };

  MockupEditor.prototype.getResultPlacementsSnapshot = function () {
    if (this.placements.length > 0) {
      return this.placements.map(function (placement) {
        return Object.assign({}, placement);
      });
    }

    var primary = this.pdp.primaryProduct;
    return [
      {
        id: "default-primary",
        productId: String(primary.productId || ""),
        variantId: String(primary.variantId || ""),
        title: primary.title || "",
        imageUrl: primary.imageUrl || "",
        isPrimary: true,
      },
    ];
  };

  MockupEditor.prototype.exportBlob = async function () {
    var base64 = await this.exportBase64();
    if (base64) {
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: "image/jpeg" });
    }
    if (this.roomFile) return this.roomFile;
    return null;
  };

  MockupEditor.prototype.exportBase64 = async function () {
    if (!this.roomFile || !this.roomPreviewUrl) return "";
    try {
      var roomImg = await core.loadImageElement(this.roomPreviewUrl);
      var width = roomImg.naturalWidth || roomImg.width;
      var height = roomImg.naturalHeight || roomImg.height;
      if (!width || !height) return "";

      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext("2d");
      if (!ctx) return "";

      ctx.drawImage(roomImg, 0, 0, width, height);

      for (var i = 0; i < this.placements.length; i++) {
        var placement = this.placements[i];
        if (!placement.imageUrl) continue;
        try {
          var productImg = await core.fetchImageForCanvas(placement.imageUrl);
          var drawW = width * (placement.scale || DEFAULT_PLACEMENT_SCALE);
          var aspect =
            productImg.naturalHeight && productImg.naturalWidth
              ? productImg.naturalHeight / productImg.naturalWidth
              : 1;
          var drawH = drawW * aspect;
          var centerX = width * placement.x;
          var centerY = height * placement.y;
          ctx.drawImage(
            productImg,
            centerX - drawW / 2,
            centerY - drawH / 2,
            drawW,
            drawH,
          );
        } catch {
          /* skip */
        }
      }

      return String(canvas.toDataURL("image/jpeg", 0.92).split(",")[1] || "");
    } catch {
      return "";
    }
  };

  MockupEditor.prototype.bind = function () {
    var self = this;

    this.scaleDown?.addEventListener("click", function () {
      self.adjustSelectedScale(-PLACEMENT_SCALE_STEP);
    });
    this.scaleUp?.addEventListener("click", function () {
      self.adjustSelectedScale(PLACEMENT_SCALE_STEP);
    });

    this.layers?.addEventListener("pointerdown", function (e) {
      var layer = e.target.closest(".sugar-mockup-layer");
      if (!layer || !layer.dataset.placementId) return;
      if (e.target.closest("[data-sugar-mockup-remove]")) return;
      e.preventDefault();
      self.select(layer.dataset.placementId);
      self.placementDrag = {
        id: layer.dataset.placementId,
        pointerId: e.pointerId,
      };
      layer = self.findLayerElement(layer.dataset.placementId);
      if (layer) {
        layer.classList.add("is-dragging");
        layer.setPointerCapture(e.pointerId);
      }
    });

    this.layers?.addEventListener("pointermove", function (e) {
      if (!self.placementDrag || self.placementDrag.pointerId !== e.pointerId) {
        return;
      }
      self.updateFromPointer(self.placementDrag.id, e.clientX, e.clientY);
    });

    var endDrag = function (e) {
      if (!self.placementDrag || self.placementDrag.pointerId !== e.pointerId) {
        return;
      }
      var layer = self.findLayerElement(self.placementDrag.id);
      if (layer) layer.classList.remove("is-dragging");
      self.placementDrag = null;
    };
    this.layers?.addEventListener("pointerup", endDrag);
    this.layers?.addEventListener("pointercancel", endDrag);

    this.layers?.addEventListener("click", function (e) {
      var removeBtn = e.target.closest("[data-sugar-mockup-remove]");
      if (!removeBtn) return;
      e.preventDefault();
      e.stopPropagation();
      var layer = removeBtn.closest(".sugar-mockup-layer");
      if (layer && layer.dataset.placementId) {
        self.remove(layer.dataset.placementId);
      }
    });
  };

  global.SugarPdpKit = global.SugarPdpKit || {};
  global.SugarPdpKit.MockupEditor = MockupEditor;
  global.SugarPdpKit.DEFAULT_PLACEMENT_SCALE = DEFAULT_PLACEMENT_SCALE;
})(window);
