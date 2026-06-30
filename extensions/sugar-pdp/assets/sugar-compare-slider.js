(function (global) {
  "use strict";

  function CompareSlider(root, t) {
    this.root = root;
    this.t = t || function (_k, fb) {
      return fb || "";
    };
    this.preview = root.querySelector("[data-sugar-design-preview]");
    this.el = root.querySelector("[data-sugar-compare]");
    this.originImg = root.querySelector("[data-sugar-compare-origin]");
    this.designImg = root.querySelector("[data-sugar-compare-design]");
    this.range = root.querySelector("[data-sugar-compare-range]");
  }

  CompareSlider.prototype.bind = function () {
    if (!this.range) return;
    var self = this;
    if (!this.range.getAttribute("aria-label")) {
      this.range.setAttribute(
        "aria-label",
        this.t("compareAria", "Orijinal ve AI tasarımını karşılaştır"),
      );
    }
    this.range.addEventListener("input", function () {
      self.setPosition(this.value);
    });
  };

  CompareSlider.prototype.setPosition = function (percent) {
    var p = Math.min(100, Math.max(0, Number(percent) || 0));
    if (this.el) this.el.style.setProperty("--compare", p + "%");
    if (this.range && String(this.range.value) !== String(p)) {
      this.range.value = String(p);
    }
  };

  CompareSlider.prototype.setImages = function (originUrl, designUrl) {
    if (!this.el) return;
    var hasCompare = !!(originUrl && designUrl);

    if (this.preview) this.preview.classList.remove("is-loaded");

    if (hasCompare) {
      this.el.removeAttribute("data-sugar-compare-single");
      this.loadImg(this.originImg, originUrl, this.t("compareOrigin", "Orijinal"));
      this.loadImg(this.designImg, designUrl, this.t("previewAlt", "AI önizleme"));
      this.setPosition(this.range ? this.range.value : 50);
    } else {
      this.el.setAttribute("data-sugar-compare-single", "");
      if (this.originImg) {
        this.originImg.removeAttribute("src");
        this.originImg.classList.remove("is-loaded");
      }
      if (designUrl) {
        this.loadImg(this.designImg, designUrl, this.t("previewAlt", "AI önizleme"));
      }
    }
  };

  CompareSlider.prototype.loadImg = function (img, src, alt) {
    if (!img || !src) return;
    var self = this;
    img.alt = alt || "";
    if (!img.__sugarCompareBound) {
      img.__sugarCompareBound = true;
      img.addEventListener("load", function () {
        self.onImgLoaded(img);
      });
      img.addEventListener("error", function () {
        self.onImgLoaded(img);
      });
    }
    if (img.getAttribute("src") === src && img.complete && img.naturalWidth > 0) {
      this.onImgLoaded(img);
      return;
    }
    img.classList.remove("is-loaded");
    img.src = src;
    if (img.complete && img.naturalWidth > 0) {
      this.onImgLoaded(img);
    }
  };

  CompareSlider.prototype.onImgLoaded = function (img) {
    if (!img) return;
    img.classList.add("is-loaded");
    this.syncPreviewLoaded();
  };

  CompareSlider.prototype.syncPreviewLoaded = function () {
    if (!this.preview || !this.el) return;
    var single = this.el.hasAttribute("data-sugar-compare-single");
    var designOk =
      this.designImg && this.designImg.classList.contains("is-loaded");
    var originOk =
      single ||
      (this.originImg && this.originImg.classList.contains("is-loaded"));
    if (designOk && originOk) {
      this.preview.classList.add("is-loaded");
    }
  };

  global.SugarPdpKit = global.SugarPdpKit || {};
  global.SugarPdpKit.CompareSlider = CompareSlider;
})(window);
