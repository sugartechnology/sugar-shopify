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
    this.handle = root.querySelector("[data-sugar-compare-handle]");
    this.originBtn = root.querySelector('[data-sugar-compare-show="origin"]');
    this.designBtn = root.querySelector('[data-sugar-compare-show="design"]');
    this.introPlayed = false;
    this.introCancelled = false;
    this.introRaf = null;
    this.introTimer = null;
    this.dragPointerId = null;
    this.boundDragMove = null;
    this.boundDragEnd = null;
  }

  CompareSlider.prototype.isSingle = function () {
    return !!(this.el && this.el.hasAttribute("data-sugar-compare-single"));
  };

  CompareSlider.prototype.unbindDragListeners = function () {
    if (!this.boundDragMove || !this.boundDragEnd) return;
    window.removeEventListener("pointermove", this.boundDragMove);
    window.removeEventListener("pointerup", this.boundDragEnd);
    window.removeEventListener("pointercancel", this.boundDragEnd);
    this.boundDragMove = null;
    this.boundDragEnd = null;
  };

  CompareSlider.prototype.lockPageScroll = function () {
    var body = this.root.closest(".sugar-modal__body");
    if (body) body.classList.add("is-compare-scroll-lock");
  };

  CompareSlider.prototype.unlockPageScroll = function () {
    var body = this.root.closest(".sugar-modal__body");
    if (body) body.classList.remove("is-compare-scroll-lock");
  };

  CompareSlider.prototype.endDrag = function () {
    this.dragPointerId = null;
    if (this.el) this.el.classList.remove("is-dragging");
    this.unlockPageScroll();
    this.unbindDragListeners();
  };

  CompareSlider.prototype.updateFromClientX = function (clientX) {
    if (!this.el) return;
    var rect = this.el.getBoundingClientRect();
    if (!rect.width) return;
    var pct = ((clientX - rect.left) / rect.width) * 100;
    this.setPosition(pct, { fromDrag: true });
  };

  CompareSlider.prototype.startDrag = function (pointerId, clientX) {
    if (this.isSingle()) return;
    this.cancelIntroAnimation();
    this.dragPointerId = pointerId;
    if (this.el) this.el.classList.add("is-dragging");
    this.lockPageScroll();
    this.updateFromClientX(clientX);

    var self = this;
    this.unbindDragListeners();
    this.boundDragMove = function (e) {
      if (self.dragPointerId !== e.pointerId) return;
      e.preventDefault();
      self.updateFromClientX(e.clientX);
    };
    this.boundDragEnd = function (e) {
      if (self.dragPointerId !== e.pointerId) return;
      self.endDrag();
    };
    window.addEventListener("pointermove", this.boundDragMove, { passive: false });
    window.addEventListener("pointerup", this.boundDragEnd);
    window.addEventListener("pointercancel", this.boundDragEnd);
  };

  CompareSlider.prototype.bind = function () {
    var self = this;
    if (!this.el) return;

    if (this.handle) {
      if (!this.handle.getAttribute("aria-label")) {
        this.handle.setAttribute(
          "aria-label",
          this.t("compareAria", "Compare original room and AI design"),
        );
      }
      this.handle.addEventListener("pointerdown", function (e) {
        if (self.isSingle()) return;
        e.preventDefault();
        e.stopPropagation();
        if (self.handle.setPointerCapture) {
          self.handle.setPointerCapture(e.pointerId);
        }
        self.startDrag(e.pointerId, e.clientX);
      });
      this.handle.addEventListener("keydown", function (e) {
        if (self.isSingle()) return;
        var step = e.shiftKey ? 10 : 4;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          self.cancelIntroAnimation();
          self.setPosition(Number(self.handle.getAttribute("aria-valuenow") || 0) - step);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          self.cancelIntroAnimation();
          self.setPosition(Number(self.handle.getAttribute("aria-valuenow") || 0) + step);
        }
      });
    }

    this.el.addEventListener("pointerdown", function (e) {
      if (self.isSingle()) return;
      if (e.target.closest("[data-sugar-compare-show]")) return;
      if (e.target.closest("[data-sugar-compare-handle]")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      if (self.el.setPointerCapture) {
        self.el.setPointerCapture(e.pointerId);
      }
      self.startDrag(e.pointerId, e.clientX);
    });

    if (this.originBtn) {
      this.originBtn.addEventListener("pointerdown", function (e) {
        e.stopPropagation();
      });
      this.originBtn.addEventListener("click", function (e) {
        e.preventDefault();
        if (self.isSingle()) return;
        self.cancelIntroAnimation();
        self.setPosition(0, { activeTag: "origin" });
      });
    }

    if (this.designBtn) {
      this.designBtn.addEventListener("pointerdown", function (e) {
        e.stopPropagation();
      });
      this.designBtn.addEventListener("click", function (e) {
        e.preventDefault();
        if (self.isSingle()) return;
        self.cancelIntroAnimation();
        self.setPosition(100, { activeTag: "design" });
      });
    }
  };

  CompareSlider.prototype.setActiveTag = function (mode) {
    if (this.originBtn) {
      this.originBtn.classList.toggle("is-active", mode === "origin");
    }
    if (this.designBtn) {
      this.designBtn.classList.toggle("is-active", mode === "design");
    }
  };

  CompareSlider.prototype.syncActiveTag = function (percent, options) {
    if (options && options.activeTag) {
      this.setActiveTag(options.activeTag);
      return;
    }
    if (options && options.fromDrag) {
      if (percent <= 8) this.setActiveTag("origin");
      else if (percent >= 92) this.setActiveTag("design");
      else {
        if (this.originBtn) this.originBtn.classList.remove("is-active");
        if (this.designBtn) this.designBtn.classList.remove("is-active");
      }
      return;
    }
    if (percent <= 5) this.setActiveTag("origin");
    else if (percent >= 95) this.setActiveTag("design");
    else this.setActiveTag(null);
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
    if (this.isSingle()) return;

    this.cancelIntroAnimation();
    this.introCancelled = false;
    this.setPosition(0, { activeTag: "origin" });

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.setPosition(100, { activeTag: "design" });
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
        self.setPosition(100 * self.easeInOutCubic(t), { fromDrag: true });
        if (t < 1) {
          self.introRaf = requestAnimationFrame(frame);
        } else {
          self.introRaf = null;
          self.el.classList.remove("is-intro-animating");
          self.setActiveTag("design");
        }
      }

      self.introRaf = requestAnimationFrame(frame);
    }, INTRO_DELAY_MS);
  };

  CompareSlider.prototype.setPosition = function (percent, options) {
    options = options || {};
    var p = Math.min(100, Math.max(0, Number(percent) || 0));
    var rounded = Math.round(p);
    if (this.el) this.el.style.setProperty("--compare", p + "%");
    if (this.handle) {
      this.handle.setAttribute("aria-valuenow", String(rounded));
    }
    this.syncActiveTag(p, options);
  };

  CompareSlider.prototype.setImages = function (originUrl, designUrl) {
    if (!this.el) return;
    var hasCompare = !!(originUrl && designUrl);

    this.cancelIntroAnimation();
    this.endDrag();
    this.unlockPageScroll();
    this.introPlayed = false;

    if (this.preview) this.preview.classList.remove("is-loaded");

    if (hasCompare) {
      this.el.removeAttribute("data-sugar-compare-single");
      this.setPosition(0, { activeTag: "origin" });
      this.loadImg(this.originImg, originUrl, this.t("compareOrigin", "Original"));
      this.loadImg(this.designImg, designUrl, this.t("compareDesign", "Design result"));
    } else {
      this.el.setAttribute("data-sugar-compare-single", "");
      if (this.originImg) {
        this.originImg.removeAttribute("src");
        this.originImg.classList.remove("is-loaded");
      }
      if (designUrl) {
        this.loadImg(this.designImg, designUrl, this.t("previewAlt", "AI preview"));
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
    var single = this.isSingle();
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
