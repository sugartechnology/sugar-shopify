(function (global) {
  "use strict";

  function UploadHero(root, config) {
    this.rootEl = root;
    this.container = root.querySelector("[data-sugar-upload-hero]");
    this.img = root.querySelector("[data-sugar-upload-illustration]");
    this.config = config || {};
  }

  UploadHero.prototype.init = function () {
    if (!this.img || !this.container) return;

    var fit =
      this.config.uploadIllustrationFit === "contain" ? "contain" : "cover";
    if (this.rootEl) {
      this.rootEl.style.setProperty("--sugar-upload-fit", fit);
    }
    rootFitClasses(this.container, fit);

    var url =
      this.config.uploadIllustrationUrl || this.config.heroImageUrl || "";
    if (url) this.setSrc(url);
    this.bindLoad();
  };

  UploadHero.prototype.bindLoad = function () {
    if (!this.img || this.img.__sugarUploadHeroBound) return;
    this.img.__sugarUploadHeroBound = true;
    var self = this;
    this.img.addEventListener("load", function () {
      self.markLoaded();
    });
    this.img.addEventListener("error", function () {
      self.markLoaded();
    });
    if (this.img.complete && this.img.naturalWidth > 0) {
      this.markLoaded();
    }
  };

  UploadHero.prototype.setSrc = function (src) {
    if (!this.img || !src) return;
    if (
      this.img.getAttribute("src") === src &&
      this.img.complete &&
      this.img.naturalWidth > 0
    ) {
      this.markLoaded();
      return;
    }
    this.img.src = src;
    if (this.img.complete && this.img.naturalWidth > 0) {
      this.markLoaded();
    }
  };

  UploadHero.prototype.markLoaded = function () {
    if (!this.img || !this.container) return;
    this.img.classList.add("is-loaded");
    this.container.classList.add("is-loaded");
  };

  function rootFitClasses(container, fit) {
    container.classList.remove("sugar-upload-hero--cover", "sugar-upload-hero--contain");
    container.classList.add("sugar-upload-hero--" + fit);
  }

  global.SugarPdpKit = global.SugarPdpKit || {};
  global.SugarPdpKit.UploadHero = UploadHero;
})(window);
