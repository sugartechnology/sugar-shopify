(function (global) {
  "use strict";

  var DESIGN_STORAGE_KEY = "sugar_pdp_visitor_designs";
  var DEFAULT_MAX_SAVED_DESIGNS = 20;

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

  function getI18n(config) {
    return (config && config.i18n) || {};
  }

  function ensureMediaDevices() {
    if (typeof navigator === "undefined") return false;
    if (!navigator.mediaDevices) navigator.mediaDevices = {};
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

  function loadImageElement(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        resolve(img);
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  async function fetchImageForCanvas(url) {
    if (!url) throw new Error("missing url");
    if (url.startsWith("blob:") || url.startsWith("data:")) {
      return loadImageElement(url);
    }
    try {
      var res = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error("fetch failed");
      var blob = await res.blob();
      var objectUrl = URL.createObjectURL(blob);
      try {
        return await loadImageElement(objectUrl);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      return loadImageElement(url);
    }
  }

  function readDesignStore() {
    try {
      var raw = localStorage.getItem(DESIGN_STORAGE_KEY);
      if (!raw) return { version: 2, byProduct: {}, attemptCounts: {} };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return { version: 2, byProduct: {}, attemptCounts: {} };
      }
      if (!parsed.byProduct || typeof parsed.byProduct !== "object") {
        parsed.byProduct = {};
      }
      if (!parsed.attemptCounts || typeof parsed.attemptCounts !== "object") {
        parsed.attemptCounts = {};
      }
      parsed.version = 2;
      return parsed;
    } catch {
      return { version: 2, byProduct: {}, attemptCounts: {} };
    }
  }

  function getDesignAttemptCount(productId) {
    var store = readDesignStore();
    var count = Number(store.attemptCounts[String(productId)] || 0);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  function recordDesignAttempt(productId) {
    var store = readDesignStore();
    var key = String(productId);
    var next = getDesignAttemptCount(key) + 1;
    store.attemptCounts[key] = next;
    writeDesignStore(store);
    return next;
  }

  function hasDesignAttemptsRemaining(productId, maxCount) {
    var max = Math.max(1, Number(maxCount || 3));
    return getDesignAttemptCount(productId) < max;
  }

  function writeDesignStore(store) {
    try {
      localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* quota */
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
      placements: record.placements || [],
      originImageUrl: record.originImageUrl || "",
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

  async function compressDesignImage(imageUrl) {
    if (!imageUrl) return "";
    try {
      var img = await loadImageElement(imageUrl);
      var maxW = 420;
      var w = img.naturalWidth || maxW;
      var h = img.naturalHeight || Math.round(maxW * 0.75);
      var scale = w > maxW ? maxW / w : 1;
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.75);
    } catch {
      return imageUrl.length < 120000 ? imageUrl : "";
    }
  }

  global.SugarPdpKit = global.SugarPdpKit || {};
  global.SugarPdpKit.core = {
    DESIGN_STORAGE_KEY: DESIGN_STORAGE_KEY,
    DEFAULT_MAX_SAVED_DESIGNS: DEFAULT_MAX_SAVED_DESIGNS,
    parseJson: parseJson,
    normalizePriceToCents: normalizePriceToCents,
    formatMoney: formatMoney,
    getI18n: getI18n,
    ensureMediaDevices: ensureMediaDevices,
    fileToBase64: fileToBase64,
    loadImageElement: loadImageElement,
    fetchImageForCanvas: fetchImageForCanvas,
    getDesignsForProduct: getDesignsForProduct,
    getDesignAttemptCount: getDesignAttemptCount,
    recordDesignAttempt: recordDesignAttempt,
    hasDesignAttemptsRemaining: hasDesignAttemptsRemaining,
    saveDesignForProduct: saveDesignForProduct,
    removeDesignForProduct: removeDesignForProduct,
    compressDesignImage: compressDesignImage,
  };
})(window);
