(function (global) {
  "use strict";

  var INTRO_DELAY_MS = 350;
  var INTRO_DURATION_MS = 1300;

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
    this.introPlayed = false;
    this.introCancelled = false;
    this.introRaf = null;
    this.introTimer = null;
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
      self.cancelIntroAnimation();
      self.setPosition(this.value);
    });
    this.range.addEventListener("pointerdown", function () {
      self.cancelIntroAnimation();
      if (self.el) self.el.classList.add("is-dragging");
    });
    var endDrag = function () {
      if (self.el) self.el.classList.remove("is-dragging");
    };
    this.range.addEventListener("pointerup", endDrag);
    this.range.addEventListener("pointercancel", endDrag);
    this.range.addEventListener("blur", endDrag);
  };

  CompareSlider.prototype.cancelIntroAnimation = function () {
    this.introCancelled = true;
    if (this.introRaf) {
      cancelAnimationFrame(this.introRaf);
      this.introRaf = null;
    }
    if (this.introTimer) {
      clearTimeout(this.introTimer);
      this.introTimer = null;
    }
    if (this.el) this.el.classList.remove("is-intro-animating");
  };

  CompareSlider.prototype.easeInOutCubic = function (t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  CompareSlider.prototype.playIntroAnimation = function () {
    if (!this.el || this.el.hasAttribute("data-sugar-compare-single")) return;

    this.cancelIntroAnimation();
    this.introCancelled = false;
    this.setPosition(0);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.setPosition(100);
      return;
    }

    var self = this;
    this.introTimer = setTimeout(function () {
      self.introTimer = null;
      if (self.introCancelled || !self.el) return;

      self.el.classList.add("is-intro-animating");
      var startTs = null;

      function frame(ts) {
        if (self.introCancelled) return;
        if (!startTs) startTs = ts;
        var t = Math.min(1, (ts - startTs) / INTRO_DURATION_MS);
        self.setPosition(100 * self.easeInOutCubic(t));
        if (t < 1) {
          self.introRaf = requestAnimationFrame(frame);
        } else {
          self.introRaf = null;
          self.el.classList.remove("is-intro-animating");
        }
      }

      self.introRaf = requestAnimationFrame(frame);
    }, INTRO_DELAY_MS);
  };

  CompareSlider.prototype.setPosition = function (percent) {
    var p = Math.min(100, Math.max(0, Number(percent) || 0));
    if (this.el) this.el.style.setProperty("--compare", p + "%");
    if (this.range && String(this.range.value) !== String(Math.round(p))) {
      this.range.value = String(Math.round(p));
    }
  };

  CompareSlider.prototype.setImages = function (originUrl, designUrl) {
    if (!this.el) return;
    var hasCompare = !!(originUrl && designUrl);

    this.cancelIntroAnimation();
    this.introPlayed = false;

    if (this.preview) this.preview.classList.remove("is-loaded");

    if (hasCompare) {
      this.el.removeAttribute("data-sugar-compare-single");
      this.setPosition(0);
      this.loadImg(this.originImg, originUrl, this.t("compareOrigin", "Orijinal"));
      this.loadImg(this.designImg, designUrl, this.t("previewAlt", "AI önizleme"));
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
      if (!single && !this.introPlayed) {
        this.introPlayed = true;
        this.playIntroAnimation();
      }
    }
  };

  global.SugarPdpKit = global.SugarPdpKit || {};
  global.SugarPdpKit.CompareSlider = CompareSlider;
})(window);
