(function () {
  "use strict";

  var STEPS = ["studio", "upload", "loading", "result"];
  var ATTEMPT_STORAGE_KEY = "sugar_rs_design_attempts";
  var DEFAULT_PLACEMENT_SCALE = 0.28;

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

  function hasDisplayPrice(raw) {
    return normalizePriceToCents(raw) > 0;
  }

  function formatMoney(rawAmount, currency, locale) {
    if (!hasDisplayPrice(rawAmount)) return "";
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

  function priceHtml(className, rawAmount, currency, locale) {
    if (!hasDisplayPrice(rawAmount)) return "";
    return (
      '<div class="' +
      className +
      '">' +
      escapeHtml(formatMoney(rawAmount, currency, locale)) +
      "</div>"
    );
  }

  function priceParagraphHtml(className, rawAmount, currency, locale) {
    if (!hasDisplayPrice(rawAmount)) return "";
    return (
      '<p class="' +
      className +
      '">' +
      escapeHtml(formatMoney(rawAmount, currency, locale)) +
      "</p>"
    );
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

  function isRemoteImageUrl(imageUrl) {
    return /^https?:\/\//i.test(String(imageUrl || ""));
  }

  function getCartSafeDesignImageUrl(imageUrl) {
    var url = String(imageUrl || "");
    if (!isRemoteImageUrl(url)) return "";
    if (url.length > 2048) return "";
    return url;
  }

  function readAttemptStore() {
    try {
      var raw = localStorage.getItem(ATTEMPT_STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeAttemptStore(store) {
    try {
      localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* ignore */
    }
  }

  function getAttemptCount(shopKey) {
    var store = readAttemptStore();
    var n = Number(store[String(shopKey)] || 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function recordAttempt(shopKey) {
    var store = readAttemptStore();
    var key = String(shopKey);
    var next = getAttemptCount(key) + 1;
    store[key] = next;
    writeAttemptStore(store);
    return next;
  }

  function isShopifyAdminPreview() {
    try {
      return !!(window.Shopify && window.Shopify.designMode);
    } catch {
      return false;
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slugifyLabel(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normalizeTags(raw) {
    if (Array.isArray(raw)) {
      return raw
        .map(function (tag) {
          return String(tag || "").trim();
        })
        .filter(Boolean);
    }
    if (typeof raw === "string" && raw.trim()) {
      return raw
        .split(",")
        .map(function (tag) {
          return tag.trim();
        })
        .filter(Boolean);
    }
    return [];
  }

  var TYPE_TAG_KEYWORDS = [
    "sofa",
    "couch",
    "kanepe",
    "koltuk",
    "chair",
    "sandalye",
    "table",
    "masa",
    "desk",
    "bed",
    "yatak",
    "lamp",
    "light",
    "aydinlatma",
    "aydınlatma",
    "rug",
    "carpet",
    "hali",
    "halı",
    "ottoman",
    "pouf",
    "stool",
    "bench",
    "storage",
    "shelf",
    "raf",
    "cabinet",
    "dolap",
    "outdoor",
    "dis mekan",
    "dış mekan",
    "dining",
    "yemek",
    "living",
    "bedroom",
    "yatak odasi",
    "yatak odası",
  ];

  function resolveProductType(product) {
    var type = String((product && product.productType) || "").trim();
    if (type) return type;

    var tags = normalizeTags(product && product.tags);
    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      var lower = tag.toLowerCase();
      if (lower.indexOf("type:") === 0 || lower.indexOf("ürün tipi:") === 0) {
        var labeled = tag.split(":").slice(1).join(":").trim();
        if (labeled) return labeled;
      }
      for (var k = 0; k < TYPE_TAG_KEYWORDS.length; k++) {
        if (lower.indexOf(TYPE_TAG_KEYWORDS[k]) !== -1) return tag;
      }
    }
    return "";
  }

  var CATEGORY_ICON_SVGS = {
    all: "",
    outdoor:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 6v10a1 1 0 01-1 1H6a1 1 0 01-1-1V9l7-6z"/><path d="M9 20v-6h6v6"/></svg>',
    living:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11V8a2 2 0 012-2h10a2 2 0 012 2v3"/><path d="M4 13a2 2 0 012-2h12a2 2 0 012 2v3H4v-3z"/><path d="M6 16v3M18 16v3"/></svg>',
    seating:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10V7a2 2 0 012-2h5a2 2 0 012 2v3"/><path d="M4 13h14a2 2 0 012 2v2H6a2 2 0 01-2-2v-2z"/><path d="M7 17v3M17 17v3"/></svg>',
    bedroom:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18V9a2 2 0 012-2h14a2 2 0 012 2v9"/><path d="M3 14h18"/><path d="M7 12h4"/></svg>',
    dining:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="10" rx="8" ry="3"/><path d="M4 10v2c0 1.7 3.6 3 8 3s8-1.3 8-3v-2"/><path d="M12 15v5"/></svg>',
    kitchen:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v8a2 2 0 002 2h0a2 2 0 002-2V3"/><path d="M8 13v8"/><path d="M16 3v6a2 2 0 002 2h0"/><path d="M18 11v10"/></svg>',
    office:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="1"/><path d="M5 10v10M19 10v10M9 14h6"/></svg>',
    bathroom:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16v3a5 5 0 01-5 5H9a5 5 0 01-5-5v-3z"/><path d="M7 12V7a2 2 0 012-2h0"/></svg>',
    sofa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11V9a3 3 0 013-3h8a3 3 0 013 3v2"/><path d="M3 13a2 2 0 012-2h14a2 2 0 012 2v4H3v-4z"/><path d="M5 17v2M19 17v2"/></svg>',
    chair:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5h7v6H8z"/><path d="M6 11h12v2.5H6z"/><path d="M8 13.5V19M15 13.5V19M7 19h10"/></svg>',
    table:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h16"/><path d="M6 10v8M18 10v8M12 10v8"/></svg>',
    lighting:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a5.5 5.5 0 00-3.2 9.9V15h6.4v-2.1A5.5 5.5 0 0012 3z"/></svg>',
    rug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 6v12M16 6v12"/></svg>',
    storage:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 9h14M5 15h14"/></svg>',
    decor:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.8L18.5 9.5l-4.9 1.7L12 16l-1.6-4.8L5.5 9.5l4.9-1.7L12 3z"/><path d="M18 15l.7 2.1L21 18l-2.3.8L18 21l-.7-2.2L15 18l2.3-.9L18 15z"/></svg>',
    mirror:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="15" rx="5"/><path d="M9 21h6"/></svg>',
    plant:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14c3.5-.8 5.5-3.5 5.5-7.5-3.5 0-6.2 1.8-7.2 5.2"/><path d="M12 14c-3.5-.8-5.5-3.5-5.5-7.5 3.5 0 6.2 1.8 7.2 5.2"/><path d="M12 14v7M9.5 21h5"/></svg>',
    textile:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l8-3 8 3v11l-8 3-8-3V7z"/><path d="M12 4v17"/></svg>',
    kids: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M6.5 20c1.4-3.2 3.7-4.6 5.5-4.6s4.1 1.4 5.5 4.6"/></svg>',
    accessory:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5.5l.9 2.7h2.8l-2.3 1.7.9 2.7-2.3-1.7-2.3 1.7.9-2.7-2.3-1.7h2.8L12 5.5z"/><path d="M18 14.5l.6 1.7h1.8l-1.5 1.1.6 1.7-1.5-1.1-1.5 1.1.6-1.7-1.5-1.1h1.8l.6-1.7z"/></svg>',
    ottoman:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 16v3M17 16v3"/></svg>',
    bench:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16v3H4z"/><path d="M6 15v4M18 15v4M3 12V9h18v3"/></svg>',
    default:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h5"/></svg>',
  };

  var FALLBACK_ICON_KEYS = [
    "decor",
    "accessory",
    "textile",
    "storage",
    "plant",
    "mirror",
    "ottoman",
    "bench",
  ];

  function hashLabel(value) {
    var str = String(value || "");
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  function getCategoryIconKey(id, title) {
    var hay = (String(id || "") + " " + String(title || ""))
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (String(id || "") === "all" || /all products|tum urun|tum urunler|tüm ürün/.test(hay)) {
      return "all";
    }
    if (/seating|oturma grubu|oturma/.test(hay)) return "seating";
    if (/outdoor|dis mekan|bahce|bahçe|garden|patio|balkon|teras/.test(hay)) {
      return "outdoor";
    }
    if (/living|salon|lounge|sofa set/.test(hay)) return "living";
    if (/bedroom|yatak oda|sleep/.test(hay)) return "bedroom";
    if (/dining|yemek|mutfak masa/.test(hay)) return "dining";
    if (/kitchen|mutfak/.test(hay)) return "kitchen";
    if (/office|ofis|calisma|çalışma|workspace/.test(hay)) return "office";
    if (/bath|banyo/.test(hay)) return "bathroom";
    if (/sofa|couch|kanepe|koltuk|loveseat/.test(hay)) return "sofa";
    if (/chair|sandalye|armchair|berjer/.test(hay)) return "chair";
    if (/table|masa|desk|sehpa|console table/.test(hay)) return "table";
    if (/light|lamp|aydinlat|aydınlat|sconce|chandelier|aplik/.test(hay)) {
      return "lighting";
    }
    if (/rug|carpet|hali|halı|kilim/.test(hay)) return "rug";
    if (/storage|shelf|raf|cabinet|dolap|console|dresser|buffet|wardrobe|gardırop|gardirap/.test(hay)) {
      return "storage";
    }
    if (/mirror|ayna/.test(hay)) return "mirror";
    if (/plant|bitki|vazo|vase|flower/.test(hay)) return "plant";
    if (/decor|dekor|sanat|art|frame|tablo|heykel/.test(hay)) return "decor";
    if (/textile|yastik|yastık|cushion|pillow|throw|battaniye|quilt|duvet/.test(hay)) {
      return "textile";
    }
    if (/kids|cocuk|çocuk|baby|bebek/.test(hay)) return "kids";
    if (/ottoman|pouf|puf|footstool/.test(hay)) return "ottoman";
    if (/bench|bank|oturma bank/.test(hay)) return "bench";
    if (/access|aksesuar|object|obje/.test(hay)) return "accessory";
    return FALLBACK_ICON_KEYS[hashLabel(hay) % FALLBACK_ICON_KEYS.length];
  }

  function getCategoryIconSvg(id, title) {
    var key = getCategoryIconKey(id, title);
    if (key === "all") return "";
    return CATEGORY_ICON_SVGS[key] || CATEGORY_ICON_SVGS.default;
  }

  function parseNestedCategoryTitle(title) {
    var raw = String(title || "").trim();
    if (!raw) return null;
    var parts = raw
      .split(/\s*(?:>|›|»|\/|\||→)\s*/)
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
    if (parts.length < 2) return null;
    return {
      parentTitle: parts[0],
      childTitle: parts.slice(1).join(" / "),
    };
  }

  function SugarRoomStudio(root) {
    this.root = root;
    this.config = parseJson(root.dataset.sugarRsConfig, {});
    this.locale = this.config.locale || undefined;
    this.i18n =
      window.SugarRsI18n && typeof window.SugarRsI18n.resolve === "function"
        ? window.SugarRsI18n.resolve(this.locale, this.config.i18n || {})
        : this.config.i18n || {};
    this.displayMode = this.config.displayMode === "embedded" ? "embedded" : "modal";
    this.catalog = this.normalizeCatalog(parseJson(root.dataset.sugarRsCatalog, {}));
    this.maxProducts = Math.max(1, Math.min(5, Number(this.config.maxProducts || 5)));
    this.maxDesignAttempts = Math.max(1, Number(this.config.maxDesignAttempts || 3));
    this.unlimitedAttempts = true;
    this.attemptCount = 0;
    this.step = "studio";
    this.activeCategoryId = this.getDefaultCategoryId();
    this.activeSubcategoryId = null;
    this.expandedCategoryIds = {};
    this.categoryQuery = "";
    this.productQuery = "";
    this.selectedIds = [];
    this.gridPageSize = 12;
    this.gridRenderLimit = 12;
    this.roomFile = null;
    this.roomPreviewUrl = "";
    this.roomNaturalSize = null;
    this.cameraStream = null;
    this.designMode = "auto";
    this.placementsByProductId = {};
    this.selectedPlacementId = null;
    this.placementDrag = null;
    this.compareAutoplayRaf = null;
    this.compareAutoplayActive = false;
    this.compareAutoplayDir = 1;
    this.compareAutoplayValue = 0;
    this.compareAutoplayHalfDone = false;
    this.compareDragPointerId = null;
    this.compareBoundMove = null;
    this.compareBoundEnd = null;
    this.designResult = null;
    this.resultSelections = {};
    this.designCompletionCount = 0;
    this.redesignTipDismissed = false;
    this.enrichmentHandles = this.normalizeEnrichmentHandles(
      this.config.enrichmentHandles || {},
    );
    this.enrichmentPools = { accessory: [], rug: [], lighting: [] };
    this.enrichmentPoolsLoaded = false;
    this.enrichmentPoolsLoading = null;
    this.resultProductIds = null;
    this.pendingRedesignPrompt = "";
    this.pendingEnrichmentTypes = [];
    this.loadingTimer = null;
    this.toastTimer = null;
    this.boundGridScroll = null;
    this.gridObserver = null;
    this.expandAllCategoriesWithChildren();

    this.init();
  };

  SugarRoomStudio.prototype.expandAllCategoriesWithChildren = function () {
    var self = this;
    (this.catalog.categories || []).forEach(function (cat) {
      if (cat && cat.id && Array.isArray(cat.children) && cat.children.length > 0) {
        self.expandedCategoryIds[cat.id] = true;
      }
    });
  };

  SugarRoomStudio.prototype.getDefaultCategoryId = function () {
    var cats = (this.catalog && this.catalog.categories) || [];
    if (this.config.useAllProducts === true) {
      for (var i = 0; i < cats.length; i++) {
        if (cats[i] && cats[i].id === "all") return "all";
      }
    }
    return cats[0] && cats[0].id ? cats[0].id : "";
  };

  SugarRoomStudio.prototype.t = function (key, fallback) {
    var val = this.i18n[key];
    return val != null && val !== "" ? val : fallback || key;
  };

  SugarRoomStudio.prototype.tReplace = function (key, fallback, vars) {
    var text = this.t(key, fallback);
    Object.keys(vars || {}).forEach(function (k) {
      text = text.replace(new RegExp("\\{\\{" + k + "\\}\\}", "g"), String(vars[k]));
    });
    return text;
  };

  SugarRoomStudio.prototype.buildSubcategories = function (productIds, byId) {
    var typeMap = {};
    (productIds || []).forEach(function (id) {
      var product = byId[id];
      if (!product) return;
      var typeTitle = resolveProductType(product);
      if (!typeTitle) return;
      var typeId = slugifyLabel(typeTitle);
      if (!typeId) return;
      if (!typeMap[typeId]) {
        typeMap[typeId] = {
          id: typeId,
          title: typeTitle,
          productIds: [],
        };
      }
      if (typeMap[typeId].productIds.indexOf(id) === -1) {
        typeMap[typeId].productIds.push(id);
      }
    });

    return Object.keys(typeMap)
      .map(function (key) {
        var child = typeMap[key];
        return {
          id: child.id,
          title: child.title,
          productIds: child.productIds,
          count: child.productIds.length,
        };
      })
      .sort(function (a, b) {
        return String(a.title).localeCompare(String(b.title), undefined, {
          sensitivity: "base",
        });
      });
  };

  /**
   * Build left-nav category seeds from Shopify product types
   * (e.g. "Outdoor > Koltuk", "Berjer", "Depolama").
   */
  SugarRoomStudio.prototype.buildProductTypeCategorySeeds = function (productList) {
    var typeMap = {};
    (productList || []).forEach(function (product) {
      if (!product || !product.productId) return;
      var typeTitle = resolveProductType(product);
      if (!typeTitle) return;
      var typeId = "type-" + slugifyLabel(typeTitle);
      if (!typeId || typeId === "type-") return;
      if (!typeMap[typeId]) {
        typeMap[typeId] = {
          id: typeId,
          title: typeTitle,
          productIds: [],
          count: 0,
        };
      }
      if (typeMap[typeId].productIds.indexOf(product.productId) === -1) {
        typeMap[typeId].productIds.push(product.productId);
      }
    });

    return Object.keys(typeMap)
      .map(function (key) {
        var entry = typeMap[key];
        entry.count = entry.productIds.length;
        return entry;
      })
      .sort(function (a, b) {
        return String(a.title).localeCompare(String(b.title), undefined, {
          sensitivity: "base",
        });
      });
  };

  SugarRoomStudio.prototype.normalizeCatalog = function (raw) {
    var self = this;
    var products = Array.isArray(raw.products) ? raw.products : [];
    var categories = Array.isArray(raw.categories) ? raw.categories : [];
    var byId = {};
    products.forEach(function (p) {
      if (!p || !p.productId) return;
      var existing = byId[String(p.productId)];
      var tags = normalizeTags(p.tags);
      if (!tags.length && existing && existing.tags) tags = normalizeTags(existing.tags);
      byId[String(p.productId)] = {
        productId: String(p.productId),
        variantId: String(p.variantId || (existing && existing.variantId) || ""),
        title: p.title || (existing && existing.title) || "",
        handle: p.handle || (existing && existing.handle) || "",
        productType:
          String(p.productType || (existing && existing.productType) || "").trim(),
        tags: tags,
        price: p.price != null ? p.price : existing && existing.price,
        currency: p.currency || (existing && existing.currency) || "TRY",
        imageUrl: p.imageUrl || (existing && existing.imageUrl) || "",
        images: Array.isArray(p.images)
          ? p.images
          : (existing && existing.images) || [],
        categoryIds: Array.isArray(p.categoryIds)
          ? p.categoryIds.map(String)
          : [],
      };
    });

    var productList = Object.keys(byId).map(function (id) {
      return byId[id];
    });

    // Rebuild category membership from category productIds (source of truth for filtering).
    productList.forEach(function (p) {
      p.categoryIds = [];
    });

    var cats = categories
      .filter(function (c) {
        return c && c.id;
      })
      .map(function (c) {
        var ids = Array.isArray(c.productIds)
          ? c.productIds.map(String).filter(function (id) {
              return !!byId[id];
            })
          : [];
        if (String(c.id) === "all") {
          ids = productList.map(function (p) {
            return p.productId;
          });
        } else {
          ids.forEach(function (id) {
            if (byId[id].categoryIds.indexOf(String(c.id)) === -1) {
              byId[id].categoryIds.push(String(c.id));
            }
          });
        }

        // Preserve prebuilt children (e.g. Shopify sub-collections)
        var incomingChildren = Array.isArray(c.children) ? c.children : [];
        var children = incomingChildren
          .filter(function (child) {
            return child && child.id;
          })
          .map(function (child) {
            var childIds = Array.isArray(child.productIds)
              ? child.productIds.map(String).filter(function (id) {
                  return !!byId[id];
                })
              : [];
            childIds.forEach(function (id) {
              if (byId[id].categoryIds.indexOf(String(child.id)) === -1) {
                byId[id].categoryIds.push(String(child.id));
              }
              if (byId[id].categoryIds.indexOf(String(c.id)) === -1) {
                byId[id].categoryIds.push(String(c.id));
              }
            });
            return {
              id: String(child.id),
              title: child.title || String(child.id),
              productIds: childIds,
              count: childIds.length,
            };
          });

        return {
          id: String(c.id),
          title: c.title || String(c.id),
          productIds: ids,
          count: ids.length,
          children: children,
        };
      });

    if (!cats.some(function (c) {
      return c.id === "all";
    })) {
      // Only inject "All Products" when merchant enabled use_all_products
      if (self.config && self.config.useAllProducts === true) {
        var allIds = productList.map(function (p) {
          return p.productId;
        });
        cats.unshift({
          id: "all",
          title: self.t ? self.t("allProducts", "All Products") : "All Products",
          productIds: allIds,
          count: allIds.length,
          children: [],
        });
      }
    } else if (!(self.config && self.config.useAllProducts === true)) {
      // Setting off → drop accidental "all" category from Liquid/hydrate
      cats = cats.filter(function (c) {
        return c.id !== "all";
      });
    } else {
      cats = cats.map(function (c) {
        if (c.id !== "all") return c;
        var ids = productList.map(function (p) {
          return p.productId;
        });
        return {
          id: "all",
          title: c.title || "All Products",
          productIds: ids,
          count: ids.length,
          children: [],
        };
      });
    }

    // Collection-only: drop products that are not in any selected collection
    if (!(self.config && self.config.useAllProducts === true)) {
      var allowed = {};
      cats.forEach(function (c) {
        (c.productIds || []).forEach(function (id) {
          allowed[String(id)] = true;
        });
      });
      productList = productList.filter(function (p) {
        return allowed[p.productId];
      });
      byId = {};
      productList.forEach(function (p) {
        byId[p.productId] = p;
      });
      cats = cats.map(function (c) {
        var ids = (c.productIds || []).filter(function (id) {
          return !!byId[id];
        });
        var children = Array.isArray(c.children)
          ? c.children
              .filter(function (child) {
                return child && child.id;
              })
              .map(function (child) {
                var childIds = (child.productIds || []).filter(function (id) {
                  return !!byId[id];
                });
                return {
                  id: child.id,
                  title: child.title,
                  productIds: childIds,
                  count: childIds.length,
                };
              })
          : [];
        return {
          id: c.id,
          title: c.title,
          productIds: ids,
          count: ids.length,
          children: children,
        };
      });
    }

    // Product-type auto categories only when browsing the full store catalog
    if (self.config && self.config.useAllProducts === true) {
      var typeSeeds = self.buildProductTypeCategorySeeds(productList);
      var existingIds = {};
      var existingTitles = {};
      cats.forEach(function (c) {
        existingIds[c.id] = true;
        existingTitles[slugifyLabel(c.title)] = true;
      });
      typeSeeds.forEach(function (seed) {
        var titleKey = slugifyLabel(seed.title);
        if (existingIds[seed.id] || existingTitles[titleKey]) return;
        existingIds[seed.id] = true;
        existingTitles[titleKey] = true;
        seed.productIds.forEach(function (id) {
          if (byId[id] && byId[id].categoryIds.indexOf(seed.id) === -1) {
            byId[id].categoryIds.push(seed.id);
          }
        });
        cats.push(seed);
      });
    }

    // Under each collection: keep sub-collection children, also add product-type children
    cats = cats.map(function (c) {
      if (c.id === "all") return c;
      if (parseNestedCategoryTitle(c.title)) return c;

      var existingChildren = Array.isArray(c.children) ? c.children.slice() : [];
      var existingIds = {};
      var existingTitles = {};
      existingChildren.forEach(function (child) {
        if (!child || !child.id) return;
        existingIds[String(child.id)] = true;
        existingTitles[slugifyLabel(child.title)] = true;
      });

      var typeChildren = self.buildSubcategories(c.productIds, byId).filter(function (child) {
        if (slugifyLabel(child.title) === slugifyLabel(c.title)) return false;
        if (existingTitles[slugifyLabel(child.title)]) return false;
        return true;
      });
      typeChildren = typeChildren.map(function (child) {
        return {
          id: String(c.id) + "__" + child.id,
          title: child.title,
          productIds: child.productIds,
          count: child.count,
        };
      }).filter(function (child) {
        return !existingIds[child.id];
      });

      return {
        id: c.id,
        title: c.title,
        productIds: c.productIds,
        count: (c.productIds || []).length,
        children: existingChildren.concat(typeChildren),
      };
    });

    var sourceCategories = cats.map(function (c) {
      return {
        id: c.id,
        title: c.title,
        productIds: (c.productIds || []).slice(),
        count: c.count,
        children: Array.isArray(c.children)
          ? c.children.map(function (child) {
              return {
                id: child.id,
                title: child.title,
                productIds: (child.productIds || []).slice(),
                count: child.count,
              };
            })
          : [],
      };
    });

    var nestedCategories = self.nestCategories(sourceCategories, byId);

    return {
      products: productList,
      categories: nestedCategories,
      sourceCategories: sourceCategories,
      byId: byId,
    };
  };

  SugarRoomStudio.prototype.nestCategories = function (cats, byId) {
    var parents = {};
    var parentOrder = [];
    var allCat = null;
    var standalone = [];

    (cats || []).forEach(function (c) {
      if (!c || !c.id) return;
      if (c.id === "all") {
        allCat = c;
        return;
      }

      var path = parseNestedCategoryTitle(c.title);
      if (!path) {
        standalone.push(c);
        return;
      }

      var parentId = "nav-" + slugifyLabel(path.parentTitle);
      var childId = slugifyLabel(path.childTitle) || String(c.id);
      if (!parentId) {
        standalone.push(c);
        return;
      }

      if (!parents[parentId]) {
        parents[parentId] = {
          id: parentId,
          title: path.parentTitle,
          productIds: [],
          childrenMap: {},
        };
        parentOrder.push(parentId);
      }

      var parent = parents[parentId];
      (c.productIds || []).forEach(function (id) {
        if (parent.productIds.indexOf(id) === -1) parent.productIds.push(id);
        if (byId && byId[id]) {
          byId[id].categoryIds = (byId[id].categoryIds || [])
            .map(function (cid) {
              return cid === c.id ? parentId : cid;
            })
            .filter(function (cid, index, arr) {
              return arr.indexOf(cid) === index;
            });
          if (byId[id].categoryIds.indexOf(parentId) === -1) {
            byId[id].categoryIds.push(parentId);
          }
        }
      });

      if (!parent.childrenMap[childId]) {
        parent.childrenMap[childId] = {
          id: childId,
          title: path.childTitle,
          productIds: [],
          count: 0,
        };
      }
      var child = parent.childrenMap[childId];
      (c.productIds || []).forEach(function (id) {
        if (child.productIds.indexOf(id) === -1) child.productIds.push(id);
      });
      child.count = child.productIds.length;
    });

    var remainingStandalone = [];
    standalone.forEach(function (c) {
      var matchId = "nav-" + slugifyLabel(c.title);
      if (!parents[matchId]) {
        remainingStandalone.push(c);
        return;
      }
      var parent = parents[matchId];
      (c.productIds || []).forEach(function (id) {
        if (parent.productIds.indexOf(id) === -1) parent.productIds.push(id);
        if (byId && byId[id] && byId[id].categoryIds.indexOf(matchId) === -1) {
          byId[id].categoryIds.push(matchId);
        }
      });
      (c.children || []).forEach(function (ch) {
        if (!parent.childrenMap[ch.id]) {
          parent.childrenMap[ch.id] = {
            id: ch.id,
            title: ch.title,
            productIds: (ch.productIds || []).slice(),
            count: (ch.productIds || []).length,
          };
          return;
        }
        var existingChild = parent.childrenMap[ch.id];
        (ch.productIds || []).forEach(function (id) {
          if (existingChild.productIds.indexOf(id) === -1) {
            existingChild.productIds.push(id);
          }
        });
        existingChild.count = existingChild.productIds.length;
      });
    });

    function buildParent(parentId) {
      var parent = parents[parentId];
      var children = Object.keys(parent.childrenMap)
        .map(function (key) {
          return parent.childrenMap[key];
        })
        .sort(function (a, b) {
          return String(a.title).localeCompare(String(b.title), undefined, {
            sensitivity: "base",
          });
        });
      return {
        id: parent.id,
        title: parent.title,
        productIds: parent.productIds,
        count: parent.productIds.length,
        children: children,
      };
    }

    var result = [];
    var emitted = {};
    if (allCat) result.push(allCat);

    (cats || []).forEach(function (c) {
      if (!c || c.id === "all") return;
      var path = parseNestedCategoryTitle(c.title);
      if (path) {
        var parentId = "nav-" + slugifyLabel(path.parentTitle);
        if (parents[parentId] && !emitted[parentId]) {
          result.push(buildParent(parentId));
          emitted[parentId] = true;
        }
        return;
      }
      var matchId = "nav-" + slugifyLabel(c.title);
      if (parents[matchId]) {
        if (!emitted[matchId]) {
          result.push(buildParent(matchId));
          emitted[matchId] = true;
        }
        return;
      }
      if (remainingStandalone.indexOf(c) !== -1) {
        result.push(c);
      }
    });

    parentOrder.forEach(function (parentId) {
      if (!emitted[parentId]) result.push(buildParent(parentId));
    });

    return result;
  };

  SugarRoomStudio.prototype.init = function () {
    this.cacheDom();
    this.bindEvents();
    this.bindCompareImageAspect();
    this.syncAttemptCount();
    this.renderCategories();
    this.renderGrid();
    this.renderSlots();
    this.renderSelectedCount();
    this.updateContinueState();
    this.updateGenerateState();
    if (this.config.customCss) {
      var style = document.createElement("style");
      style.textContent = this.config.customCss;
      this.root.appendChild(style);
    }
    if (this.displayMode === "modal") {
      this.portalDialog();
    }
    this.hydrateCatalog();
  };

  SugarRoomStudio.prototype.mapAjaxProduct = function (raw) {
    if (!raw || !raw.id) return null;
    var variant = (raw.variants && raw.variants[0]) || {};
    var images = Array.isArray(raw.images)
      ? raw.images
          .map(function (img) {
            return img && (img.src || img);
          })
          .filter(Boolean)
          .slice(0, 3)
      : [];
    var imageUrl =
      raw.featured_image ||
      (typeof raw.image === "string" ? raw.image : raw.image && raw.image.src) ||
      images[0] ||
      "";
    return {
      productId: String(raw.id),
      variantId: String(variant.id || ""),
      title: raw.title || "",
      handle: raw.handle || "",
      productType: String(raw.product_type || raw.productType || "").trim(),
      tags: normalizeTags(raw.tags),
      price: variant.price != null ? variant.price : "0",
      currency: this.config.currency || "TRY",
      imageUrl: imageUrl,
      images: images,
      categoryIds: [],
    };
  };

  SugarRoomStudio.prototype.fetchCollectionPage = async function (handle, page) {
    var url =
      "/collections/" +
      encodeURIComponent(handle) +
      "/products.json?limit=250&page=" +
      page;
    var res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return [];
    var data = await res.json();
    return Array.isArray(data.products) ? data.products : [];
  };

  SugarRoomStudio.prototype.fetchAllCollectionProducts = async function (handle) {
    var all = [];
    var page = 1;
    while (page <= 40) {
      var batch = await this.fetchCollectionPage(handle, page);
      if (!batch.length) break;
      all = all.concat(batch);
      if (batch.length < 250) break;
      page += 1;
    }
    return all;
  };

  SugarRoomStudio.prototype.mergeProductsIntoCatalog = function (products, categoryId) {
    var self = this;
    var byId = Object.assign({}, this.catalog.byId);
    var categories = (this.catalog.sourceCategories || this.catalog.categories).slice();

    products.forEach(function (p) {
      if (!p || !p.productId) return;
      var existing = byId[p.productId];
      if (existing) {
        if (p.productType && !existing.productType) {
          existing.productType = p.productType;
        }
        if (p.tags && p.tags.length) {
          existing.tags = normalizeTags(
            (existing.tags || []).concat(p.tags),
          );
        }
        if (categoryId && categoryId !== "all") {
          if (existing.categoryIds.indexOf(categoryId) === -1) {
            existing.categoryIds.push(categoryId);
          }
        }
        return;
      }
      byId[p.productId] = p;
      if (categoryId && categoryId !== "all") {
        p.categoryIds = [categoryId];
      }
    });

    var productList = Object.keys(byId).map(function (id) {
      return byId[id];
    });

    categories = categories.map(function (c) {
      if (c.id === "all") {
        return {
          id: "all",
          title: c.title,
          productIds: productList.map(function (p) {
            return p.productId;
          }),
          count: productList.length,
          children: c.children || [],
        };
      }
      if (categoryId && c.id === categoryId) {
        var ids = productList
          .filter(function (p) {
            return p.categoryIds.indexOf(categoryId) !== -1;
          })
          .map(function (p) {
            return p.productId;
          });
        // Prefer ids from fetched products for this handle
        var fromFetch = products.map(function (p) {
          return p.productId;
        });
        var merged = {};
        ids.concat(fromFetch).forEach(function (id) {
          if (byId[id]) merged[id] = true;
        });
        var finalIds = Object.keys(merged);
        return {
          id: c.id,
          title: c.title,
          productIds: finalIds,
          count: finalIds.length,
          children: c.children || [],
        };
      }
      return c;
    });

    this.catalog = {
      products: productList,
      categories: categories,
      sourceCategories: categories,
      byId: byId,
    };
  };

  SugarRoomStudio.prototype.fetchCatalogGroups = async function () {
    var parents = Array.isArray(this.config.catalogParents)
      ? this.config.catalogParents.filter(function (p) {
          return p && (p.id || p.handle);
        })
      : [];
    if (!parents.length) return null;

    var ids = parents
      .map(function (p) {
        return String(p.id || "").trim();
      })
      .filter(Boolean);
    if (!ids.length) return null;

    var base = String(this.config.catalogUrl || "/apps/sugar/catalog").trim();
    var url =
      base +
      (base.indexOf("?") === -1 ? "?" : "&") +
      "ids=" +
      encodeURIComponent(ids.join(","));

    try {
      var res = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      var payload = await res.json();
      var groups =
        payload &&
        payload.data &&
        Array.isArray(payload.data.groups)
          ? payload.data.groups
          : null;
      return groups;
    } catch (err) {
      console.warn("[Sugar Curator] catalog groups resolve failed", err);
      return null;
    }
  };

  SugarRoomStudio.prototype.hydrateCatalog = async function () {
    var self = this;
    if (this.grid) {
      this.grid.setAttribute("aria-busy", "true");
    }

    try {
      var groups = await this.fetchCatalogGroups();
      var handles = [];
      var categories = [];

      if (this.config.useAllProducts === true) {
        handles.push("all");
      }

      if (Array.isArray(groups) && groups.length) {
        groups.forEach(function (group) {
          if (!group || !group.handle) return;
          var children = Array.isArray(group.children) ? group.children : [];
          // Always hydrate parent: may include direct products + sub-collection union
          if (handles.indexOf(group.handle) === -1) {
            handles.push(String(group.handle));
          }
          children.forEach(function (child) {
            if (child && child.handle && handles.indexOf(child.handle) === -1) {
              handles.push(String(child.handle));
            }
          });
        });
      } else {
        // Fallback: theme catalogHandles (parent list / all)
        handles = Array.isArray(this.config.catalogHandles)
          ? this.config.catalogHandles.filter(Boolean).map(String)
          : [];
      }

      if (!handles.length) return;

      var productsByHandle = {};
      for (var i = 0; i < handles.length; i++) {
        var handle = String(handles[i]);
        var rawProducts = await this.fetchAllCollectionProducts(handle);
        productsByHandle[handle] = rawProducts
          .map(function (raw) {
            return self.mapAjaxProduct(raw);
          })
          .filter(Boolean);
      }

      var byId = {};
      function upsert(list, catIds) {
        (list || []).forEach(function (p) {
          if (!p || !p.productId) return;
          var existing = byId[p.productId];
          if (existing) {
            (catIds || []).forEach(function (cid) {
              if (existing.categoryIds.indexOf(cid) === -1) {
                existing.categoryIds.push(cid);
              }
            });
            return;
          }
          p.categoryIds = (catIds || []).slice();
          byId[p.productId] = p;
        });
      }

      if (productsByHandle.all) {
        upsert(productsByHandle.all, ["all"]);
        categories.push({
          id: "all",
          title: this.t("allProducts", "All Products"),
          productIds: [],
          count: 0,
          children: [],
        });
      }

      if (Array.isArray(groups) && groups.length) {
        groups.forEach(function (group) {
          if (!group || !group.handle) return;
          var groupId = String(group.handle);
          var children = Array.isArray(group.children) ? group.children : [];
          var childCats = [];
          var union = {};

          // Parent membership = direct products + sub-collection products (Shopify union)
          var parentList = productsByHandle[groupId] || [];
          parentList.forEach(function (p) {
            if (p && p.productId) union[p.productId] = true;
          });
          upsert(parentList, [groupId]);

          children.forEach(function (child) {
            if (!child || !child.handle) return;
            var childId = String(child.handle);
            var list = productsByHandle[childId] || [];
            var ids = list.map(function (p) {
              return p.productId;
            });
            ids.forEach(function (id) {
              union[id] = true;
            });
            upsert(list, [groupId, childId]);
            childCats.push({
              id: childId,
              title: child.title || childId,
              productIds: ids,
              count: ids.length,
            });
          });

          var groupIds = Object.keys(union);
          categories.push({
            id: groupId,
            title: group.title || groupId,
            productIds: groupIds,
            count: groupIds.length,
            children: childCats,
          });
        });
      } else {
        // Legacy flat handles → merge then normalize (product-type children)
        Object.keys(productsByHandle).forEach(function (h) {
          if (h === "all") return;
          self.mergeProductsIntoCatalog(productsByHandle[h], h);
        });
        if (productsByHandle.all) {
          self.mergeProductsIntoCatalog(productsByHandle.all, "all");
        }
        self.catalog = self.normalizeCatalog({
          products: self.catalog.products,
          categories: self.catalog.sourceCategories || self.catalog.categories,
        });
        if (self.activeSubcategoryId && !self.getActiveSubcategory()) {
          self.activeSubcategoryId = null;
        }
        if (self.activeCategoryId && !self.getActiveCategory()) {
          self.activeCategoryId = self.getDefaultCategoryId();
          self.activeSubcategoryId = null;
        }
        self.expandAllCategoriesWithChildren();
        self.renderCategories();
        self.renderGrid();
        self.renderSlots();
        self.renderSelectedCount();
        self.updateContinueState();
        self.updateGenerateState();
        return;
      }

      if (categories[0] && categories[0].id === "all") {
        categories[0].productIds = Object.keys(byId);
        categories[0].count = categories[0].productIds.length;
      }

      var productList = Object.keys(byId).map(function (id) {
        return byId[id];
      });

      this.catalog = this.normalizeCatalog({
        products: productList,
        categories: categories,
      });

      if (this.activeSubcategoryId && !this.getActiveSubcategory()) {
        this.activeSubcategoryId = null;
      }
      if (this.activeCategoryId && !this.getActiveCategory()) {
        this.activeCategoryId = this.getDefaultCategoryId();
        this.activeSubcategoryId = null;
      }
      this.expandAllCategoriesWithChildren();
      this.renderCategories();
      this.renderGrid();
      this.renderSlots();
      this.renderSelectedCount();
      this.updateContinueState();
      this.updateGenerateState();
    } catch (err) {
      console.warn("[Sugar Curator] catalog hydrate failed", err);
    } finally {
      if (this.grid) this.grid.removeAttribute("aria-busy");
    }
  };

  SugarRoomStudio.prototype.cacheDom = function () {
    this.dialog = this.root.querySelector("[data-sugar-rs-dialog]");
    this.shell = this.root.querySelector("[data-sugar-rs-shell]") || this.dialog;
    this.openBtn = this.root.querySelector("[data-sugar-rs-open]");
    this.closeBtn = this.root.querySelector("[data-sugar-rs-close]");
    this.toastEl = this.root.querySelector("[data-sugar-rs-toast]");
    this.catList = this.root.querySelector("[data-sugar-rs-cat-list]");
    this.catsEl = this.root.querySelector("[data-sugar-rs-cats]");
    this.catSelectTrigger = this.root.querySelector("[data-sugar-rs-cat-select-trigger]");
    this.catSelectPanel = this.root.querySelector("[data-sugar-rs-cat-select-panel]");
    this.catSelectLabel = this.root.querySelector("[data-sugar-rs-cat-select-label]");
    this.catSearch = this.root.querySelector("[data-sugar-rs-cat-search]");
    this.productSearch = this.root.querySelector("[data-sugar-rs-product-search]");
    this.productSearchMobile = this.root.querySelector(
      "[data-sugar-rs-product-search-mobile]",
    );
    this.grid = this.root.querySelector("[data-sugar-rs-grid]");
    this.emptyEl = this.root.querySelector("[data-sugar-rs-empty]");
    this.browseTitle = this.root.querySelector("[data-sugar-rs-browse-title]");
    this.selectedCountEl = this.root.querySelector("[data-sugar-rs-selected-count]");
    this.selectedToggleBtn = this.root.querySelector("[data-sugar-rs-selected-toggle]");
    this.selectedCloseBtn = this.root.querySelector("[data-sugar-rs-selected-close]");
    this.selectedBadgeEl = this.root.querySelector("[data-sugar-rs-selected-badge]");
    this.sideEl = this.root.querySelector("[data-sugar-rs-side]");
    this.sideBackdrop = this.root.querySelector("[data-sugar-rs-side-backdrop]");
    this.slotsEl = this.root.querySelector("[data-sugar-rs-slots]");
    this.slotsTitle = this.root.querySelector("[data-sugar-rs-slots-title]");
    this.slotsHint = this.root.querySelector("[data-sugar-rs-slots-hint]");
    this.slotsTotalEl = this.root.querySelector("[data-sugar-rs-slots-total]");
    this.slotsTotalLabel = this.root.querySelector("[data-sugar-rs-slots-total-label]");
    this.slotsTotalValue = this.root.querySelector("[data-sugar-rs-slots-total-value]");
    this.roomImg = this.root.querySelector("[data-sugar-rs-room-img]");
    this.roomPreviewEl = this.root.querySelector("[data-sugar-rs-room-preview]");
    this.roomLayersEl = this.root.querySelector("[data-sugar-rs-room-layers]");
    this.roomSourcesEl = this.root.querySelector("[data-sugar-rs-room-sources]");
    this.roomGalleryBtn = this.root.querySelector("[data-sugar-rs-room-gallery-btn]");
    this.roomCameraBtn = this.root.querySelector("[data-sugar-rs-room-camera-btn]");
    this.roomCameraEl = this.root.querySelector("[data-sugar-rs-room-camera]");
    this.roomCameraWrap = this.root.querySelector("[data-sugar-rs-room-camera-wrap]");
    this.roomCameraVideo = this.root.querySelector("[data-sugar-rs-room-camera-video]");
    this.roomCameraCanvas = this.root.querySelector("[data-sugar-rs-room-camera-canvas]");
    this.roomCameraCancelBtn = this.root.querySelector("[data-sugar-rs-room-camera-cancel]");
    this.roomCameraCaptureBtn = this.root.querySelector(
      "[data-sugar-rs-room-camera-capture]",
    );
    this.photoModalEl = null;
    this.photoModalVideo = null;
    this.photoModalPreview = null;
    this.photoModalCanvas = null;
    this.photoModalStage = null;
    this.photoModalLiveActions = null;
    this.photoModalReviewActions = null;
    this.photoModalTitle = null;
    this.pendingRoomCapture = null;
    this.pendingRoomCaptureUrl = "";
    this.roomFileInput = this.root.querySelector("[data-sugar-rs-room-file]");
    this.roomActions = this.root.querySelector("[data-sugar-rs-room-actions]");
    this.changeRoomBtn = this.root.querySelector("[data-sugar-rs-change-room]");
    this.removeRoomBtn = this.root.querySelector("[data-sugar-rs-remove-room]");
    this.uploadProductsEl = this.root.querySelector("[data-sugar-rs-upload-products]");
    this.uploadProductsTitle = this.root.querySelector(
      "[data-sugar-rs-upload-products-title]",
    );
    this.manualTipEl = this.root.querySelector("[data-sugar-rs-manual-tip]");
    this.designModeEl = this.root.querySelector("[data-sugar-rs-design-mode]");
    this.clearBtn = this.root.querySelector("[data-sugar-rs-clear]");
    this.continueBtn = this.root.querySelector("[data-sugar-rs-continue]");
    this.generateBtn = this.root.querySelector("[data-sugar-rs-generate]");
    this.backStudioBtn = this.root.querySelector("[data-sugar-rs-back-studio]");
    this.backStudioResultBtn = this.root.querySelector("[data-sugar-rs-back-studio-result]");
    this.redesignBtn = this.root.querySelector("[data-sugar-rs-redesign]");
    this.redesignTipEl = this.root.querySelector("[data-sugar-rs-redesign-tip]");
    this.redesignTipTextEl = this.root.querySelector("[data-sugar-rs-redesign-tip-text]");
    this.redesignTipCloseBtn = this.root.querySelector("[data-sugar-rs-redesign-tip-close]");
    this.redesignModalEl = this.root.querySelector("[data-sugar-rs-redesign-modal]");
    this.redesignPromptEl = this.root.querySelector("[data-sugar-rs-redesign-prompt]");
    this.redesignConfirmBtn = this.root.querySelector("[data-sugar-rs-redesign-confirm]");
    this.redesignEnrichEmptyEl = this.root.querySelector("[data-sugar-rs-redesign-enrich-empty]");
    this.loadingBar = this.root.querySelector("[data-sugar-rs-loading-bar]");
    this.loadingPct = this.root.querySelector("[data-sugar-rs-loading-pct]");
    this.compareEl = this.root.querySelector("[data-sugar-rs-compare]");
    this.compareOrigin = this.root.querySelector("[data-sugar-rs-compare-origin]");
    this.compareDesign = this.root.querySelector("[data-sugar-rs-compare-design]");
    this.compareHandle = this.root.querySelector("[data-sugar-rs-compare-handle]");
    this.resultList = this.root.querySelector("[data-sugar-rs-result-list]");
    this.panelEl =
      (this.shell && this.shell.querySelector(".sugar-rs-panel")) ||
      this.root.querySelector(".sugar-rs-panel");
    this.stepperEl = this.root.querySelector("[data-sugar-rs-stepper]");
    this.stepEls = {};
    this.stepIndicators = {};
    var self = this;
    STEPS.forEach(function (step) {
      self.stepEls[step] = self.root.querySelector('[data-sugar-rs-step="' + step + '"]');
    });
    ["studio", "upload", "result"].forEach(function (step) {
      self.stepIndicators[step] = self.root.querySelector(
        '[data-sugar-rs-step-indicator="' + step + '"]',
      );
    });
  };

  SugarRoomStudio.prototype.portalDialog = function () {
    if (!this.dialog || this.dialog.parentElement === document.body) return;
    // Copy theme CSS vars onto the dialog — it leaves .sugar-rs-root when moved to body
    var rootStyle = this.root.getAttribute("style") || "";
    if (rootStyle) {
      var existing = this.dialog.getAttribute("style") || "";
      this.dialog.setAttribute("style", (existing + ";" + rootStyle).replace(/^;+/, ""));
    }
    document.body.appendChild(this.dialog);
  };

  SugarRoomStudio.prototype.bindEvents = function () {
    var self = this;

    if (this.openBtn) {
      this.openBtn.addEventListener("click", function () {
        self.open();
      });
    }
    if (this.closeBtn) {
      this.closeBtn.addEventListener("click", function () {
        self.close();
      });
    }
    if (this.dialog) {
      this.dialog.addEventListener("cancel", function (e) {
        e.preventDefault();
        self.close();
      });
      this.dialog.addEventListener("click", function (e) {
        if (e.target === self.dialog) self.close();
      });
    }

    if (this.catSearch) {
      this.catSearch.addEventListener("input", function () {
        self.categoryQuery = String(self.catSearch.value || "").trim().toLowerCase();
        self.renderCategories();
      });
    }
    if (this.productSearch) {
      this.productSearch.addEventListener("input", function () {
        self.setProductQuery(self.productSearch.value);
      });
    }
    if (this.productSearchMobile) {
      this.productSearchMobile.addEventListener("input", function () {
        self.setProductQuery(self.productSearchMobile.value);
      });
      this.productSearchMobile.addEventListener("focus", function () {
        self.setCategorySelectOpen(false);
      });
    }

    if (this.grid) {
      this.boundGridScroll = function () {
        self.onGridScroll();
      };
      this.grid.addEventListener("scroll", this.boundGridScroll, { passive: true });
    }

    if (this.roomGalleryBtn) {
      this.roomGalleryBtn.addEventListener("click", function () {
        self.openRoomGallery();
      });
    }
    if (this.roomCameraBtn) {
      this.roomCameraBtn.addEventListener("click", function () {
        self.openRoomCamera();
      });
    }
    if (this.roomCameraCancelBtn) {
      this.roomCameraCancelBtn.addEventListener("click", function () {
        self.closeRoomCamera();
      });
    }
    if (this.roomCameraCaptureBtn) {
      this.roomCameraCaptureBtn.addEventListener("click", function () {
        self.captureRoomCamera();
      });
    }
    if (this.changeRoomBtn) {
      this.changeRoomBtn.addEventListener("click", function () {
        if (self.isMobileStudioLayout()) {
          self.openPhotoModal();
          return;
        }
        self.clearRoom();
        self.openRoomGallery();
      });
    }
    if (this.removeRoomBtn) {
      this.removeRoomBtn.addEventListener("click", function () {
        self.clearRoom();
      });
    }
    if (this.roomFileInput) {
      this.roomFileInput.addEventListener("change", function () {
        var file = self.roomFileInput.files && self.roomFileInput.files[0];
        if (file) self.handleRoomFile(file);
        self.roomFileInput.value = "";
      });
    }

    if (this.clearBtn) {
      this.clearBtn.addEventListener("click", function () {
        self.clearSelection();
      });
    }
    if (this.continueBtn) {
      this.continueBtn.addEventListener("click", function () {
        self.onContinueClick();
      });
    }
    if (this.generateBtn) {
      this.generateBtn.addEventListener("click", function () {
        self.onGenerateClick();
      });
    }
    if (this.backStudioBtn) {
      this.backStudioBtn.addEventListener("click", function () {
        self.setStep("studio");
      });
    }
    if (this.backStudioResultBtn) {
      this.backStudioResultBtn.addEventListener("click", function () {
        self.setStep("studio");
      });
    }
    if (this.redesignBtn) {
      this.redesignBtn.addEventListener("click", function () {
        self.openRedesignModal();
      });
    }
    if (this.redesignTipCloseBtn) {
      this.redesignTipCloseBtn.addEventListener("click", function () {
        self.dismissRedesignTip();
      });
    }
    this.bindRedesignModal();
    this.bindCompareInteractions();
    this.bindResultListLinks();

    if (this.designModeEl) {
      this.designModeEl.querySelectorAll("[data-sugar-rs-mode]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          self.setDesignMode(btn.getAttribute("data-sugar-rs-mode"));
        });
      });
    }

    this.bindPlacementInteractions();
    this.bindMobileChrome();
  };

  SugarRoomStudio.prototype.bindMobileChrome = function () {
    var self = this;
    if (this.catSelectTrigger) {
      this.catSelectTrigger.addEventListener("click", function () {
        self.toggleCategorySelect();
      });
    }
    if (this.selectedToggleBtn) {
      this.selectedToggleBtn.addEventListener("click", function () {
        self.setSelectedSheetOpen(true);
      });
    }
    if (this.selectedCloseBtn) {
      this.selectedCloseBtn.addEventListener("click", function () {
        self.setSelectedSheetOpen(false);
      });
    }
    if (this.sideBackdrop) {
      this.sideBackdrop.addEventListener("click", function () {
        self.setSelectedSheetOpen(false);
      });
    }
    document.addEventListener("click", function (e) {
      if (!self.catsEl || !self.catsEl.classList.contains("is-select-open")) return;
      if (self.catsEl.contains(e.target)) return;
      self.setCategorySelectOpen(false);
    });
  };

  SugarRoomStudio.prototype.isMobileStudioLayout = function () {
    return typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 960px)").matches
      : false;
  };

  SugarRoomStudio.prototype.toggleCategorySelect = function () {
    var open = !(this.catsEl && this.catsEl.classList.contains("is-select-open"));
    this.setCategorySelectOpen(open);
  };

  SugarRoomStudio.prototype.setProductQuery = function (value) {
    var q = String(value || "").trim().toLowerCase();
    this.productQuery = q;
    if (this.productSearch && String(this.productSearch.value || "").trim().toLowerCase() !== q) {
      this.productSearch.value = value || "";
    }
    if (
      this.productSearchMobile &&
      String(this.productSearchMobile.value || "").trim().toLowerCase() !== q
    ) {
      this.productSearchMobile.value = value || "";
    }
    this.resetGridPagination();
    this.renderGrid();
  };

  SugarRoomStudio.prototype.setCategorySelectOpen = function (open) {
    if (!this.catsEl) return;
    this.catsEl.classList.toggle("is-select-open", !!open);
    if (this.catSelectTrigger) {
      this.catSelectTrigger.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (open && this.catSearch && this.isMobileStudioLayout()) {
      var self = this;
      window.requestAnimationFrame(function () {
        try {
          self.catSearch.focus();
        } catch (err) {}
      });
    }
  };

  SugarRoomStudio.prototype.setSelectedSheetOpen = function (open) {
    if (this.sideEl) this.sideEl.classList.toggle("is-open", !!open);
    if (this.sideBackdrop) this.sideBackdrop.hidden = !open;
    if (this.selectedToggleBtn) {
      this.selectedToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
  };

  SugarRoomStudio.prototype.updateCategorySelectLabel = function () {
    if (!this.catSelectLabel) return;
    var cat = this.getActiveCategory();
    var sub = this.getActiveSubcategory();
    var label = sub ? sub.title : cat ? cat.title : "";
    this.catSelectLabel.textContent =
      label || this.t("searchCategories", "Search categories");
  };

  SugarRoomStudio.prototype.updateSelectedBadge = function () {
    if (!this.selectedBadgeEl) return;
    var count = this.selectedIds.length;
    this.selectedBadgeEl.textContent = String(count);
    this.selectedBadgeEl.hidden = count === 0;
    if (this.selectedToggleBtn) {
      this.selectedToggleBtn.setAttribute(
        "aria-label",
        this.tReplace(
          "selectedProducts",
          "Selected products ({{count}}/{{max}})",
          { count: count, max: this.maxProducts },
        ),
      );
    }
  };

  SugarRoomStudio.prototype.open = function () {
    if (this.displayMode !== "modal" || !this.dialog) return;
    if (typeof this.dialog.showModal === "function") {
      this.dialog.showModal();
    } else {
      this.dialog.setAttribute("open", "");
    }
    this.setStep("studio");
  };

  SugarRoomStudio.prototype.close = function () {
    if (this.displayMode !== "modal" || !this.dialog) return;
    if (typeof this.dialog.close === "function") {
      this.dialog.close();
    } else {
      this.dialog.removeAttribute("open");
    }
  };

  SugarRoomStudio.prototype.setStep = function (step) {
    if (STEPS.indexOf(step) === -1) return;
    if (step !== "loading") this.stopLoadingProgress();
    if (step !== "result") this.stopCompareAutoplay();
    if (step !== "upload") this.closeRoomCamera();
    this.step = step;
    var self = this;
    STEPS.forEach(function (s) {
      if (self.stepEls[s]) {
        self.stepEls[s].classList.toggle("is-active", s === step);
      }
    });

    var indicatorStep = step === "loading" ? "result" : step;
    ["studio", "upload", "result"].forEach(function (s) {
      var el = self.stepIndicators[s];
      if (!el) return;
      var active = s === indicatorStep;
      var done =
        (s === "studio" && (indicatorStep === "upload" || indicatorStep === "result")) ||
        (s === "upload" && indicatorStep === "result");
      el.classList.toggle("is-active", active);
      el.classList.toggle("is-done", done && !active);
    });

    if (this.panelEl) {
      this.panelEl.classList.toggle(
        "is-step-result",
        step === "result" || step === "loading",
      );
    }

    this.centerActiveStepIndicator();

    if (step === "upload") {
      this.syncDesignModeUi();
      this.renderUploadProducts();
      this.renderPlacementLayers();
    }
    if (step === "result") {
      this.startCompareAutoplay();
    }
  };

  SugarRoomStudio.prototype.centerActiveStepIndicator = function () {
    var stepper = this.stepperEl;
    if (!stepper) return;
    var indicatorStep = this.step === "loading" ? "result" : this.step;
    var active =
      (this.stepIndicators && this.stepIndicators[indicatorStep]) ||
      stepper.querySelector(".sugar-rs-stepper__item.is-active");
    if (!active) return;

    var run = function () {
      try {
        var stepperRect = stepper.getBoundingClientRect();
        var activeRect = active.getBoundingClientRect();
        if (!stepperRect.width || !activeRect.width) return;
        var delta =
          activeRect.left +
          activeRect.width / 2 -
          (stepperRect.left + stepperRect.width / 2);
        if (Math.abs(delta) < 1) return;
        if (typeof stepper.scrollTo === "function") {
          stepper.scrollTo({
            left: stepper.scrollLeft + delta,
            behavior: "smooth",
          });
        } else {
          stepper.scrollLeft += delta;
        }
      } catch (err) {}
    };

    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(run);
    });
  };

  SugarRoomStudio.prototype.setComparePosition = function (pct) {
    var value = Math.max(0, Math.min(100, Number(pct) || 0));
    this.compareAutoplayValue = value;
    if (this.compareEl) {
      this.compareEl.style.setProperty("--sugar-rs-compare", value + "%");
    }
    if (this.compareHandle) {
      this.compareHandle.setAttribute("aria-valuenow", String(Math.round(value)));
    }
  };

  SugarRoomStudio.prototype.lockCompareScroll = function () {
    var result = this.compareEl && this.compareEl.closest(".sugar-rs-result");
    if (result) result.classList.add("is-compare-scroll-lock");
    if (this.panelEl) this.panelEl.classList.add("is-compare-scroll-lock");
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.classList.add("sugar-rs-compare-lock");
    }
  };

  SugarRoomStudio.prototype.unlockCompareScroll = function () {
    var result = this.compareEl && this.compareEl.closest(".sugar-rs-result");
    if (result) result.classList.remove("is-compare-scroll-lock");
    if (this.panelEl) this.panelEl.classList.remove("is-compare-scroll-lock");
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.classList.remove("sugar-rs-compare-lock");
    }
  };

  SugarRoomStudio.prototype.unbindCompareDrag = function () {
    if (!this.compareBoundMove || !this.compareBoundEnd) return;
    window.removeEventListener("pointermove", this.compareBoundMove);
    window.removeEventListener("pointerup", this.compareBoundEnd);
    window.removeEventListener("pointercancel", this.compareBoundEnd);
    window.removeEventListener("touchmove", this.compareBoundMove);
    window.removeEventListener("touchend", this.compareBoundEnd);
    window.removeEventListener("touchcancel", this.compareBoundEnd);
    this.compareBoundMove = null;
    this.compareBoundEnd = null;
  };

  SugarRoomStudio.prototype.endCompareDrag = function () {
    this.compareDragPointerId = null;
    if (this.compareEl) this.compareEl.classList.remove("is-dragging");
    this.unlockCompareScroll();
    this.unbindCompareDrag();
  };

  SugarRoomStudio.prototype.updateCompareFromClientX = function (clientX) {
    if (!this.compareEl) return;
    var rect = this.compareEl.getBoundingClientRect();
    if (!rect.width) return;
    var pct = ((clientX - rect.left) / rect.width) * 100;
    this.setComparePosition(pct);
  };

  SugarRoomStudio.prototype.clientXFromEvent = function (e) {
    if (!e) return 0;
    if (typeof e.clientX === "number") return e.clientX;
    if (e.touches && e.touches[0]) return e.touches[0].clientX;
    if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0].clientX;
    return 0;
  };

  SugarRoomStudio.prototype.startCompareDrag = function (pointerId, clientX) {
    var self = this;
    this.stopCompareAutoplay();
    this.compareDragPointerId = pointerId;
    if (this.compareEl) this.compareEl.classList.add("is-dragging");
    this.lockCompareScroll();
    this.updateCompareFromClientX(clientX);

    this.unbindCompareDrag();
    this.compareBoundMove = function (e) {
      if (
        self.compareDragPointerId !== "touch" &&
        e.pointerId != null &&
        self.compareDragPointerId !== e.pointerId
      ) {
        return;
      }
      if (e.cancelable) e.preventDefault();
      self.updateCompareFromClientX(self.clientXFromEvent(e));
    };
    this.compareBoundEnd = function (e) {
      if (
        self.compareDragPointerId !== "touch" &&
        e.pointerId != null &&
        self.compareDragPointerId !== e.pointerId
      ) {
        return;
      }
      self.endCompareDrag();
    };
    window.addEventListener("pointermove", this.compareBoundMove, { passive: false });
    window.addEventListener("pointerup", this.compareBoundEnd);
    window.addEventListener("pointercancel", this.compareBoundEnd);
    window.addEventListener("touchmove", this.compareBoundMove, { passive: false });
    window.addEventListener("touchend", this.compareBoundEnd);
    window.addEventListener("touchcancel", this.compareBoundEnd);
  };

  SugarRoomStudio.prototype.nudgeCompare = function (delta) {
    this.stopCompareAutoplay();
    var current = Number(
      (this.compareHandle && this.compareHandle.getAttribute("aria-valuenow")) ||
        this.compareAutoplayValue ||
        0,
    );
    this.setComparePosition(current + Number(delta || 0));
  };

  SugarRoomStudio.prototype.bindCompareInteractions = function () {
    var self = this;
    if (!this.compareEl || this.compareEl.__sugarCompareBound) return;
    this.compareEl.__sugarCompareBound = true;

    if (!this.compareEl.querySelector("[data-sugar-rs-compare-step]")) {
      var chevronLeft =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 6.5 9 12l5.5 5.5"/></svg>';
      var chevronRight =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 6.5 15 12l-5.5 5.5"/></svg>';
      var leftBtn = document.createElement("button");
      leftBtn.type = "button";
      leftBtn.className = "sugar-rs-compare__step sugar-rs-compare__step--left";
      leftBtn.setAttribute("data-sugar-rs-compare-step", "-12");
      leftBtn.setAttribute(
        "aria-label",
        this.t("compareShowOrigin", "Show original"),
      );
      leftBtn.innerHTML = chevronLeft;
      var rightBtn = document.createElement("button");
      rightBtn.type = "button";
      rightBtn.className = "sugar-rs-compare__step sugar-rs-compare__step--right";
      rightBtn.setAttribute("data-sugar-rs-compare-step", "12");
      rightBtn.setAttribute(
        "aria-label",
        this.t("compareShowDesign", "Show design"),
      );
      rightBtn.innerHTML = chevronRight;
      var handle = this.compareHandle || this.compareEl.querySelector("[data-sugar-rs-compare-handle]");
      if (handle) {
        this.compareEl.insertBefore(leftBtn, handle);
        this.compareEl.insertBefore(rightBtn, handle);
      } else {
        this.compareEl.appendChild(leftBtn);
        this.compareEl.appendChild(rightBtn);
      }
    }

    if (this.compareHandle) {
      if (!this.compareHandle.getAttribute("aria-label")) {
        this.compareHandle.setAttribute(
          "aria-label",
          this.t("compareAria", "Compare original room and AI design"),
        );
      }
      this.compareHandle.addEventListener(
        "pointerdown",
        function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (self.compareHandle.setPointerCapture) {
            try {
              self.compareHandle.setPointerCapture(e.pointerId);
            } catch (err) {}
          }
          self.startCompareDrag(e.pointerId, e.clientX);
        },
        { passive: false },
      );
      this.compareHandle.addEventListener(
        "touchstart",
        function (e) {
          if (self.compareDragPointerId != null) return;
          if (!e.touches || !e.touches.length) return;
          e.preventDefault();
          e.stopPropagation();
          self.startCompareDrag("touch", e.touches[0].clientX);
        },
        { passive: false },
      );
      this.compareHandle.addEventListener("keydown", function (e) {
        var step = e.shiftKey ? 10 : 4;
        var current = Number(self.compareHandle.getAttribute("aria-valuenow") || 0);
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          self.stopCompareAutoplay();
          self.setComparePosition(current - step);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          self.stopCompareAutoplay();
          self.setComparePosition(current + step);
        }
      });
    }

    this.compareEl.addEventListener(
      "pointerdown",
      function (e) {
        if (e.target.closest("[data-sugar-rs-compare-handle]")) return;
        if (e.target.closest("[data-sugar-rs-compare-step]")) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        if (self.compareEl.setPointerCapture) {
          try {
            self.compareEl.setPointerCapture(e.pointerId);
          } catch (err) {}
        }
        self.startCompareDrag(e.pointerId, e.clientX);
      },
      { passive: false },
    );

    this.compareEl.addEventListener(
      "touchstart",
      function (e) {
        if (self.compareDragPointerId != null) return;
        if (e.target.closest("[data-sugar-rs-compare-handle]")) return;
        if (e.target.closest("[data-sugar-rs-compare-step]")) return;
        if (!e.touches || !e.touches.length) return;
        e.preventDefault();
        self.startCompareDrag("touch", e.touches[0].clientX);
      },
      { passive: false },
    );

    this.compareEl.querySelectorAll("[data-sugar-rs-compare-step]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.nudgeCompare(Number(btn.getAttribute("data-sugar-rs-compare-step") || 0));
      });
      btn.addEventListener("pointerdown", function (e) {
        e.stopPropagation();
      });
      btn.addEventListener(
        "touchstart",
        function (e) {
          e.stopPropagation();
        },
        { passive: true },
      );
    });
  };

  SugarRoomStudio.prototype.startCompareAutoplay = function () {
    var self = this;
    this.stopCompareAutoplay();
    if (!this.compareEl) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      this.setComparePosition(0);
      return;
    }

    this.compareAutoplayActive = true;
    this.compareAutoplayDir = 1;
    this.compareAutoplayHalfDone = false;
    this.compareAutoplayValue = 0;
    this.setComparePosition(0);
    this.compareEl.classList.add("is-autoplaying");

    var lastTs = null;
    var speed = 22; // percent per second — ~4.5s one way

    function tick(ts) {
      if (!self.compareAutoplayActive) return;
      if (lastTs == null) lastTs = ts;
      var dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      var next = self.compareAutoplayValue + self.compareAutoplayDir * speed * dt;
      if (next >= 100) {
        next = 100;
        self.compareAutoplayDir = -1;
        self.compareAutoplayHalfDone = true;
      } else if (self.compareAutoplayHalfDone && next <= 0) {
        next = 0;
        self.setComparePosition(next);
        self.stopCompareAutoplay();
        return;
      }
      self.setComparePosition(next);
      self.compareAutoplayRaf = requestAnimationFrame(tick);
    }

    this.compareAutoplayRaf = requestAnimationFrame(tick);
  };

  SugarRoomStudio.prototype.stopCompareAutoplay = function () {
    this.compareAutoplayActive = false;
    this.compareAutoplayHalfDone = false;
    if (this.compareAutoplayRaf) {
      cancelAnimationFrame(this.compareAutoplayRaf);
      this.compareAutoplayRaf = null;
    }
    if (this.compareEl) this.compareEl.classList.remove("is-autoplaying");
  };

  SugarRoomStudio.prototype.normalizeEnrichmentHandles = function (raw) {
    var out = { accessory: [], rug: [], lighting: [] };
    ["accessory", "rug", "lighting"].forEach(function (key) {
      var list = Array.isArray(raw && raw[key]) ? raw[key] : [];
      out[key] = list
        .map(function (h) {
          return String(h || "").trim();
        })
        .filter(Boolean);
    });
    return out;
  };

  SugarRoomStudio.prototype.normalizeEnrichmentPools = function (raw) {
    var self = this;
    var pools = { accessory: [], rug: [], lighting: [] };
    ["accessory", "rug", "lighting"].forEach(function (key) {
      var list = Array.isArray(raw && raw[key]) ? raw[key] : [];
      pools[key] = list
        .map(function (item) {
          return self.normalizeProductRow(item);
        })
        .filter(Boolean);
    });
    return pools;
  };

  SugarRoomStudio.prototype.loadEnrichmentPools = function () {
    var self = this;
    if (this.enrichmentPoolsLoaded) {
      return Promise.resolve(this.enrichmentPools);
    }
    if (this.enrichmentPoolsLoading) return this.enrichmentPoolsLoading;

    this.enrichmentPoolsLoading = (async function () {
      var pools = { accessory: [], rug: [], lighting: [] };
      var types = ["accessory", "rug", "lighting"];
      for (var i = 0; i < types.length; i++) {
        var type = types[i];
        var handles = (self.enrichmentHandles && self.enrichmentHandles[type]) || [];
        var seen = {};
        var products = [];
        for (var h = 0; h < handles.length; h++) {
          var rawList = await self.fetchAllCollectionProducts(handles[h]);
          rawList.forEach(function (raw) {
            var mapped = self.mapAjaxProduct(raw);
            var normalized = self.normalizeProductRow(mapped);
            if (!normalized || seen[normalized.id]) return;
            seen[normalized.id] = true;
            products.push(normalized);
          });
        }
        pools[type] = products;
      }
      self.enrichmentPools = pools;
      self.enrichmentPoolsLoaded = true;
      self.enrichmentPoolsLoading = null;
      return pools;
    })().catch(function (err) {
      self.enrichmentPoolsLoading = null;
      console.warn("[Sugar Curator] enrichment pools failed", err);
      self.enrichmentPoolsLoaded = true;
      return self.enrichmentPools;
    });

    return this.enrichmentPoolsLoading;
  };

  SugarRoomStudio.prototype.normalizeProductRow = function (raw) {
    if (!raw || typeof raw !== "object") return null;
    var productId = String(raw.productId || raw.id || "").trim();
    var variantId = String(raw.variantId || "").trim();
    if (!productId || !variantId) return null;
    return {
      id: productId,
      productId: productId,
      variantId: variantId,
      title: String(raw.title || ""),
      handle: String(raw.handle || ""),
      productType: String(raw.productType || raw.type || ""),
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
      price: raw.price,
      currency: raw.currency,
      imageUrl: String(raw.imageUrl || ""),
      images: Array.isArray(raw.images) ? raw.images.map(String) : [],
      categoryIds: Array.isArray(raw.categoryIds) ? raw.categoryIds.map(String) : [],
    };
  };

  SugarRoomStudio.prototype.ensureProductInCatalog = function (product) {
    if (!product || !product.id) return;
    if (!this.catalog.byId[product.id]) {
      this.catalog.byId[product.id] = product;
      if (Array.isArray(this.catalog.products)) {
        this.catalog.products.push(product);
      }
    }
  };

  SugarRoomStudio.prototype.ensureRedesignModal = function () {
    if (!this.redesignModalEl) return false;
    if (this.redesignModalEl.querySelector("[data-sugar-rs-redesign-confirm]")) {
      return true;
    }
    var primaryClass = this.config.primaryButtonClasses || "";
    this.redesignModalEl.innerHTML =
      '<div class="sugar-rs-redesign-modal__backdrop" data-sugar-rs-redesign-modal-dismiss></div>' +
      '<div class="sugar-rs-redesign-modal__panel" role="dialog" aria-modal="true" aria-labelledby="sugar-rs-redesign-title">' +
      '<header class="sugar-rs-redesign-modal__head">' +
      '<h3 id="sugar-rs-redesign-title"></h3>' +
      '<button type="button" class="sugar-rs-redesign-modal__close" data-sugar-rs-redesign-modal-dismiss aria-label="">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      "</button>" +
      "</header>" +
      '<label class="sugar-rs-redesign-modal__label" for="sugar-rs-redesign-prompt"></label>' +
      '<textarea id="sugar-rs-redesign-prompt" class="sugar-rs-redesign-modal__prompt" data-sugar-rs-redesign-prompt rows="4" maxlength="600"></textarea>' +
      '<p class="sugar-rs-redesign-modal__section-title" data-sugar-rs-redesign-enrich-title></p>' +
      '<div class="sugar-rs-redesign-modal__enrich" data-sugar-rs-redesign-enrich>' +
      '<label class="sugar-rs-redesign-chip" data-sugar-rs-enrich-option="accessory" hidden>' +
      '<input type="checkbox" value="accessory" data-sugar-rs-enrich-check>' +
      '<span class="sugar-rs-redesign-chip__icon" aria-hidden="true"></span>' +
      '<span class="sugar-rs-redesign-chip__label"></span>' +
      "</label>" +
      '<label class="sugar-rs-redesign-chip" data-sugar-rs-enrich-option="rug" hidden>' +
      '<input type="checkbox" value="rug" data-sugar-rs-enrich-check>' +
      '<span class="sugar-rs-redesign-chip__icon" aria-hidden="true"></span>' +
      '<span class="sugar-rs-redesign-chip__label"></span>' +
      "</label>" +
      '<label class="sugar-rs-redesign-chip" data-sugar-rs-enrich-option="lighting" hidden>' +
      '<input type="checkbox" value="lighting" data-sugar-rs-enrich-check>' +
      '<span class="sugar-rs-redesign-chip__icon" aria-hidden="true"></span>' +
      '<span class="sugar-rs-redesign-chip__label"></span>' +
      "</label>" +
      "</div>" +
      '<p class="sugar-rs-redesign-modal__hint" data-sugar-rs-redesign-enrich-empty hidden></p>' +
      '<div class="sugar-rs-redesign-modal__actions">' +
      '<button type="button" class="sugar-rs-primary-btn ' +
      escapeHtml(primaryClass) +
      '" data-sugar-rs-redesign-confirm></button>' +
      "</div></div>";

    this.redesignPromptEl = this.redesignModalEl.querySelector("[data-sugar-rs-redesign-prompt]");
    this.redesignConfirmBtn = this.redesignModalEl.querySelector("[data-sugar-rs-redesign-confirm]");
    this.redesignEnrichEmptyEl = this.redesignModalEl.querySelector(
      "[data-sugar-rs-redesign-enrich-empty]",
    );

    var title = this.redesignModalEl.querySelector("#sugar-rs-redesign-title");
    if (title) title.textContent = this.t("redesignModalTitle", "Refine your design");
    var label = this.redesignModalEl.querySelector(".sugar-rs-redesign-modal__label");
    if (label) label.textContent = this.t("redesignPromptLabel", "What should we change?");
    if (this.redesignPromptEl) {
      this.redesignPromptEl.placeholder = this.t(
        "redesignPromptPlaceholder",
        "e.g. warmer lighting, add a rug…",
      );
    }
    var enrichTitle = this.redesignModalEl.querySelector("[data-sugar-rs-redesign-enrich-title]");
    if (enrichTitle) {
      enrichTitle.innerHTML =
        '<span class="sugar-rs-redesign-modal__section-icon" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M15 4l5 5"/><path d="M14 5l-9.5 9.5a2.1 2.1 0 000 3L7.5 20a2.1 2.1 0 003 0L20 10.5"/><path d="M5 5l.5 1.5L7 7l-1.5.5L5 9l-.5-1.5L3 7l1.5-.5L5 5z"/><path d="M18 14l.4 1.2L20 16l-1.2.4L18 18l-.4-1.6L16 16l1.6-.4L18 14z"/>' +
        "</svg></span>" +
        '<span class="sugar-rs-redesign-modal__section-text">' +
        escapeHtml(this.t("redesignEnrichTitle", "Enrichment")) +
        "</span>";
    }
    var empty = this.redesignEnrichEmptyEl;
    if (empty) {
      empty.textContent = this.t(
        "redesignEnrichEmpty",
        "No enrichment collections configured in theme settings.",
      );
    }
    var enrichIcons = {
      accessory:
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 10.5c0-2.2 1.3-4 3.5-4.5 0 0 .2 2.4 1.8 3.6 1.2.9 2.2 2.2 2.2 3.9 0 2.5-2 4.5-4.5 4.5S8 16 8 13.5c0-1.2.5-2.3 1.5-3z"/><path d="M12 3.5c1.2 1.4 1.8 2.8 1.8 4"/><path d="M10.5 21h5"/><path d="M13 18.5v2.5"/></svg>',
      rug:
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="6.5" width="17" height="11" rx="2"/><path d="M7 6.5v11M17 6.5v11"/><path d="M10.5 9.5h3M10.5 12h3M10.5 14.5h3"/></svg>',
      lighting:
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3"/><path d="M8.5 10.5c0-2.2 1.6-4 3.5-4s3.5 1.8 3.5 4c0 1.5-.7 2.5-1.5 3.4-.5.5-.8 1.1-.8 1.8v.3H10.8v-.3c0-.7-.3-1.3-.8-1.8-.8-.9-1.5-1.9-1.5-3.4z"/><path d="M10.5 16h3"/><path d="M11 18h2"/><path d="M10.5 20h3"/></svg>',
    };
    var labels = {
      accessory: this.t("enrichAccessory", "Add accessories"),
      rug: this.t("enrichRug", "Add a rug"),
      lighting: this.t("enrichLighting", "Add lighting"),
    };
    Object.keys(labels).forEach(function (key) {
      var chip = this.redesignModalEl.querySelector(
        '[data-sugar-rs-enrich-option="' + key + '"]',
      );
      if (!chip) return;
      var icon = chip.querySelector(".sugar-rs-redesign-chip__icon");
      var label = chip.querySelector(".sugar-rs-redesign-chip__label");
      if (icon) icon.innerHTML = enrichIcons[key] || "";
      if (label) label.textContent = labels[key];
    }, this);

    var closeLabel = this.t("closeAria", "Close");
    this.redesignModalEl.querySelectorAll("[data-sugar-rs-redesign-modal-dismiss]").forEach(
      function (el) {
        if (el.classList.contains("sugar-rs-redesign-modal__close")) {
          el.setAttribute("aria-label", closeLabel);
        }
      },
      this,
    );
    if (this.redesignConfirmBtn) {
      this.redesignConfirmBtn.textContent = this.t("redesignConfirm", "Generate redesign");
      this.redesignConfirmBtn.addEventListener("click", function () {
        this.confirmRedesignModal();
      }.bind(this));
    }
    this.redesignModalEl.querySelectorAll("[data-sugar-rs-redesign-modal-dismiss]").forEach(
      function (el) {
        el.addEventListener("click", function () {
          this.closeRedesignModal();
        }.bind(this));
      }.bind(this),
    );
    return true;
  };

  SugarRoomStudio.prototype.bindRedesignModal = function () {
    // Modal DOM is created lazily in ensureRedesignModal().
  };

  SugarRoomStudio.prototype.openRedesignModal = async function () {
    var self = this;
    if (!this.redesignModalEl) {
      this.runDesign({ isRedesign: true });
      return;
    }
    this.ensureRedesignModal();
    if (this.redesignPromptEl) {
      this.redesignPromptEl.value = this.pendingRedesignPrompt || "";
    }
    this.redesignModalEl.hidden = false;
    if (this.redesignPromptEl && typeof this.redesignPromptEl.focus === "function") {
      this.redesignPromptEl.focus();
    }

    await this.loadEnrichmentPools();
    var available = 0;
    ["accessory", "rug", "lighting"].forEach(function (key) {
      var opt = self.redesignModalEl.querySelector(
        '[data-sugar-rs-enrich-option="' + key + '"]',
      );
      var pool = (self.enrichmentPools && self.enrichmentPools[key]) || [];
      var has = pool.length > 0;
      if (opt) {
        opt.hidden = !has;
        var check = opt.querySelector("[data-sugar-rs-enrich-check]");
        if (check) check.checked = false;
      }
      if (has) available += 1;
    });
    if (this.redesignEnrichEmptyEl) {
      this.redesignEnrichEmptyEl.hidden = available > 0;
    }
  };

  SugarRoomStudio.prototype.closeRedesignModal = function () {
    if (this.redesignModalEl) this.redesignModalEl.hidden = true;
  };

  SugarRoomStudio.prototype.confirmRedesignModal = async function () {
    var self = this;
    await this.loadEnrichmentPools();
    var prompt = this.redesignPromptEl
      ? String(this.redesignPromptEl.value || "").trim()
      : "";
    var types = [];
    var scope = this.redesignModalEl || this.root;
    scope.querySelectorAll("[data-sugar-rs-enrich-check]").forEach(function (input) {
      if (input.checked && input.value) types.push(String(input.value));
    });
    this.pendingRedesignPrompt = prompt;
    this.pendingEnrichmentTypes = types;
    this.closeRedesignModal();
    this.runDesign({
      isRedesign: true,
      prompt: prompt,
      enrichmentTypes: types,
    });
  };

  SugarRoomStudio.prototype.scoreEnrichmentCandidate = function (candidate, selectedProducts) {
    var score = 0;
    var candTags = (candidate.tags || []).map(function (t) {
      return String(t).toLowerCase();
    });
    var candTitle = String(candidate.title || "").toLowerCase();
    var candType = String(candidate.productType || "").toLowerCase();
    (selectedProducts || []).forEach(function (p) {
      (p.tags || []).forEach(function (tag) {
        var t = String(tag).toLowerCase();
        if (!t) return;
        if (candTags.indexOf(t) !== -1) score += 3;
        if (candTitle.indexOf(t) !== -1) score += 1;
      });
      var pType = String(p.productType || "").toLowerCase();
      if (pType && candType && (candType.indexOf(pType) !== -1 || pType.indexOf(candType) !== -1)) {
        score += 2;
      }
      var words = String(p.title || "")
        .toLowerCase()
        .split(/[^a-z0-9çğıöşü]+/i)
        .filter(function (w) {
          return w.length > 3;
        });
      words.forEach(function (w) {
        if (candTitle.indexOf(w) !== -1) score += 1;
      });
    });
    return score + Math.random() * 0.25;
  };

  SugarRoomStudio.prototype.pickEnrichmentProducts = function (types) {
    var self = this;
    var selected = this.selectedIds
      .map(function (id) {
        return self.catalog.byId[id];
      })
      .filter(Boolean);
    var used = {};
    this.selectedIds.forEach(function (id) {
      used[String(id)] = true;
    });
    var picked = [];
    (types || []).forEach(function (type) {
      var pool = (self.enrichmentPools && self.enrichmentPools[type]) || [];
      var best = null;
      var bestScore = -1;
      pool.forEach(function (candidate) {
        if (!candidate || used[String(candidate.id)]) return;
        var score = self.scoreEnrichmentCandidate(candidate, selected);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      });
      if (best) {
        used[String(best.id)] = true;
        self.ensureProductInCatalog(best);
        picked.push(best);
      }
    });
    return picked;
  };

  SugarRoomStudio.prototype.dismissRedesignTip = function () {
    this.redesignTipDismissed = true;
    this.syncRedesignTip();
  };

  SugarRoomStudio.prototype.syncRedesignTip = function () {
    if (!this.redesignTipEl) return;
    if (this.redesignTipTextEl) {
      this.redesignTipTextEl.textContent = this.t(
        "redesignTip",
        "Having an issue? You can always regenerate your design.",
      );
    }
    if (this.redesignTipCloseBtn) {
      this.redesignTipCloseBtn.setAttribute(
        "aria-label",
        this.t("redesignTipClose", "Dismiss tip"),
      );
    }
    var show = this.designCompletionCount === 1 && !this.redesignTipDismissed;
    this.redesignTipEl.hidden = !show;
  };

  SugarRoomStudio.prototype.getProductUrl = function (product) {
    if (!product) return "";
    if (product.url) return String(product.url);
    var handle = product.handle ? String(product.handle).replace(/^\/+|\/+$/g, "") : "";
    if (!handle) return "";
    var root =
      (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    if (root.slice(-1) !== "/") root += "/";
    return root + "products/" + encodeURIComponent(handle);
  };

  SugarRoomStudio.prototype.getShopAttemptKey = function () {
    return String(this.config.shopDomain || "shop") + ":curator";
  };

  SugarRoomStudio.prototype.syncAttemptCount = function () {
    this.attemptCount = this.unlimitedAttempts
      ? 0
      : getAttemptCount(this.getShopAttemptKey());
  };

  SugarRoomStudio.prototype.canGenerate = function () {
    if (this.unlimitedAttempts) return true;
    return this.attemptCount < this.maxDesignAttempts;
  };

  SugarRoomStudio.prototype.getActiveCategory = function () {
    var self = this;
    return (
      this.catalog.categories.find(function (c) {
        return c.id === self.activeCategoryId;
      }) || this.catalog.categories[0]
    );
  };

  SugarRoomStudio.prototype.getActiveSubcategory = function () {
    var cat = this.getActiveCategory();
    if (!cat || !this.activeSubcategoryId || !Array.isArray(cat.children)) {
      return null;
    }
    var self = this;
    return (
      cat.children.find(function (child) {
        return child.id === self.activeSubcategoryId;
      }) || null
    );
  };

  SugarRoomStudio.prototype.resetGridPagination = function () {
    this.gridRenderLimit = this.gridPageSize;
    if (this.grid) this.grid.scrollTop = 0;
  };

  SugarRoomStudio.prototype.selectCategory = function (categoryId, subcategoryId) {
    var nextCategoryId = categoryId || "all";
    var nextSubcategoryId = subcategoryId || null;
    this.activeCategoryId = nextCategoryId;
    this.activeSubcategoryId = nextSubcategoryId;
    if (nextSubcategoryId) {
      this.expandedCategoryIds[nextCategoryId] = true;
    }
    this.resetGridPagination();
    this.renderCategories();
    this.renderGrid();
    this.updateCategorySelectLabel();
    if (this.isMobileStudioLayout()) {
      this.setCategorySelectOpen(false);
    }
  };

  SugarRoomStudio.prototype.onParentCategoryClick = function (categoryId) {
    var id = String(categoryId || "all");
    var cat = (this.catalog.categories || []).find(function (c) {
      return c.id === id;
    });
    var hasChildren = !!(cat && Array.isArray(cat.children) && cat.children.length);
    if (hasChildren) {
      var willExpand = !this.expandedCategoryIds[id];
      this.expandedCategoryIds[id] = willExpand;
      this.activeCategoryId = id;
      this.activeSubcategoryId = null;
      this.resetGridPagination();
      this.renderCategories();
      this.renderGrid();
      this.updateCategorySelectLabel();
      return;
    }
    this.selectCategory(id, null);
  };

  SugarRoomStudio.prototype.onGridScroll = function () {
    this.maybeLoadMoreProducts();
  };

  SugarRoomStudio.prototype.maybeLoadMoreProducts = function () {
    if (!this.grid) return;
    var total = this.getVisibleProducts().length;
    if (this.gridRenderLimit >= total) return;

    var remaining =
      this.grid.scrollHeight - this.grid.scrollTop - this.grid.clientHeight;
    var needsFill = this.grid.scrollHeight <= this.grid.clientHeight + 8;
    if (!needsFill && remaining > 140) return;

    this.gridRenderLimit = Math.min(
      total,
      this.gridRenderLimit + this.gridPageSize,
    );
    this.renderGrid({ preserveScroll: true });
  };

  SugarRoomStudio.prototype.bindGridInfiniteScroll = function () {
    var self = this;
    if (!this.grid) return;

    if (this.gridObserver) {
      this.gridObserver.disconnect();
      this.gridObserver = null;
    }

    var sentinel = this.grid.querySelector("[data-sugar-rs-grid-sentinel]");
    if (sentinel && typeof IntersectionObserver === "function") {
      this.gridObserver = new IntersectionObserver(
        function (entries) {
          var entry = entries && entries[0];
          if (!entry || !entry.isIntersecting) return;
          self.maybeLoadMoreProducts();
        },
        {
          root: this.grid,
          rootMargin: "120px 0px",
          threshold: 0,
        },
      );
      this.gridObserver.observe(sentinel);
    }

    // If the first page doesn't fill the viewport, keep loading until it does.
    window.requestAnimationFrame(function () {
      self.maybeLoadMoreProducts();
    });
  };

  SugarRoomStudio.prototype.categoryMatchesQuery = function (cat, query) {
    if (!query) return true;
    if (String(cat.title || "").toLowerCase().indexOf(query) !== -1) return true;
    return (cat.children || []).some(function (child) {
      return String(child.title || "").toLowerCase().indexOf(query) !== -1;
    });
  };

  SugarRoomStudio.prototype.renderCategories = function () {
    if (!this.catList) return;
    var self = this;
    var q = this.categoryQuery;
    var html = "";

    this.catalog.categories.forEach(function (cat) {
      if (!self.categoryMatchesQuery(cat, q)) return;

      var children = Array.isArray(cat.children) ? cat.children : [];
      if (q) {
        children = children.filter(function (child) {
          return (
            String(cat.title || "").toLowerCase().indexOf(q) !== -1 ||
            String(child.title || "").toLowerCase().indexOf(q) !== -1
          );
        });
      }

      var hasChildren = children.length > 0;
      var isExpanded = hasChildren && (!!self.expandedCategoryIds[cat.id] || (!!q && hasChildren));
      var parentActive =
        cat.id === self.activeCategoryId && !self.activeSubcategoryId
          ? " is-active"
          : "";
      var parentCurrent =
        cat.id === self.activeCategoryId ? " is-current" : "";

      html +=
        '<li class="sugar-rs-cat-group' +
        (isExpanded ? " is-expanded" : "") +
        (hasChildren ? " has-children" : "") +
        '">';
      var iconSvg = getCategoryIconSvg(cat.id, cat.title);
      var checkHtml =
        '<span class="sugar-rs-cat-item__check" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg>' +
        "</span>";
      html +=
        '<button type="button" class="sugar-rs-cat-item sugar-rs-cat-item--parent' +
        parentActive +
        parentCurrent +
        (hasChildren ? " has-submenu" : "") +
        (iconSvg ? "" : " no-icon") +
        '" data-cat-parent="' +
        escapeHtml(cat.id) +
        '" role="option" aria-selected="' +
        (cat.id === self.activeCategoryId && !self.activeSubcategoryId
          ? "true"
          : "false") +
        '"' +
        (hasChildren
          ? ' aria-expanded="' + (isExpanded ? "true" : "false") + '"'
          : "") +
        ">" +
        checkHtml +
        (iconSvg
          ? '<span class="sugar-rs-cat-item__icon" aria-hidden="true">' +
            iconSvg +
            "</span>"
          : "") +
        '<span class="sugar-rs-cat-item__label">' +
        escapeHtml(cat.title) +
        "</span>" +
        '<span class="sugar-rs-cat-item__count">' +
        escapeHtml(String(cat.count)) +
        "</span>" +
        (hasChildren
          ? '<span class="sugar-rs-cat-item__chevron" aria-hidden="true">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>' +
            "</span>"
          : "") +
        "</button>";

      if (hasChildren) {
        html +=
          '<ul class="sugar-rs-subcat-list" role="group"' +
          (isExpanded ? "" : " hidden") +
          ">";
        children.forEach(function (child) {
          var childActive =
            cat.id === self.activeCategoryId &&
            child.id === self.activeSubcategoryId
              ? " is-active"
              : "";
          html +=
            '<li><button type="button" class="sugar-rs-cat-item sugar-rs-cat-item--sub' +
            childActive +
            '" data-cat-id="' +
            escapeHtml(cat.id) +
            '" data-subcat-id="' +
            escapeHtml(child.id) +
            '" role="option" aria-selected="' +
            (childActive ? "true" : "false") +
            '">' +
            '<span class="sugar-rs-cat-item__check" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg>' +
            "</span>" +
            '<span class="sugar-rs-cat-item__icon" aria-hidden="true">' +
            getCategoryIconSvg(child.id, child.title) +
            "</span>" +
            '<span class="sugar-rs-cat-item__label">' +
            escapeHtml(child.title) +
            "</span>" +
            '<span class="sugar-rs-cat-item__count">' +
            escapeHtml(String(child.count)) +
            "</span>" +
            "</button></li>";
        });
        html += "</ul>";
      }

      html += "</li>";
    });

    this.catList.innerHTML = html;

    this.catList.querySelectorAll("[data-cat-parent]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.onParentCategoryClick(btn.getAttribute("data-cat-parent") || "all");
      });
    });

    this.catList.querySelectorAll("[data-subcat-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.selectCategory(
          btn.getAttribute("data-cat-id") || "all",
          btn.getAttribute("data-subcat-id"),
        );
      });
    });
  };

  SugarRoomStudio.prototype.getVisibleProducts = function () {
    var cat = this.getActiveCategory();
    var sub = this.getActiveSubcategory();
    var ids = sub ? sub.productIds : cat ? cat.productIds : [];
    var self = this;
    var q = this.productQuery;
    return ids
      .map(function (id) {
        return self.catalog.byId[id];
      })
      .filter(function (p) {
        if (!p) return false;
        if (!q) return true;
        return String(p.title || "")
          .toLowerCase()
          .indexOf(q) !== -1;
      });
  };

  SugarRoomStudio.prototype.buildProductCardHtml = function (p, atLimit) {
    var selected = this.selectedIds.indexOf(p.productId) !== -1;
    var disabled = !selected && atLimit;
    var title = String(p.title || "").trim() || "—";
    return (
      '<article class="sugar-rs-card' +
      (selected ? " is-selected" : "") +
      (disabled ? " is-disabled" : "") +
      '" data-product-id="' +
      escapeHtml(p.productId) +
      '" data-toggle-product="' +
      escapeHtml(p.productId) +
      '"' +
      (disabled ? ' aria-disabled="true"' : "") +
      ">" +
      '<div class="sugar-rs-card__media">' +
      '<span class="sugar-rs-card__check" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg>' +
      "</span>" +
      (p.imageUrl
        ? '<img src="' +
          escapeHtml(p.imageUrl) +
          '" alt="' +
          escapeHtml(title) +
          '" width="400" height="400" loading="lazy">'
        : "") +
      '<button type="button" class="sugar-rs-card__add" data-toggle-product="' +
      escapeHtml(p.productId) +
      '" aria-label="' +
      escapeHtml(
        selected
          ? this.t("removeProduct", "Remove")
          : this.t("addProduct", "Add"),
      ) +
      '"' +
      (disabled ? " disabled" : "") +
      ">" +
      (selected
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>'
        : '<span aria-hidden="true">+</span>') +
      "</button>" +
      "</div>" +
      '<div class="sugar-rs-card__meta">' +
      '<div class="sugar-rs-card__title" title="' +
      escapeHtml(title) +
      '">' +
      escapeHtml(title) +
      "</div>" +
      priceHtml(
        "sugar-rs-card__price",
        p.price,
        p.currency || this.config.currency,
        this.locale,
      ) +
      "</div></article>"
    );
  };

  SugarRoomStudio.prototype.bindGridCardEvents = function () {
    var self = this;
    if (!this.grid) return;
    this.grid.querySelectorAll("[data-toggle-product]").forEach(function (el) {
      if (el.__sugarRsBound) return;
      el.__sugarRsBound = true;
      el.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (el.getAttribute("aria-disabled") === "true" || el.disabled) return;
        self.toggleProduct(el.getAttribute("data-toggle-product"));
      });
    });
  };

  SugarRoomStudio.prototype.renderGrid = function (options) {
    options = options || {};
    if (!this.grid) return;
    var products = this.getVisibleProducts();
    var cat = this.getActiveCategory();
    var sub = this.getActiveSubcategory();
    if (this.browseTitle && cat) {
      this.browseTitle.textContent = sub ? sub.title : cat.title;
    }
    this.updateCategorySelectLabel();
    if (this.emptyEl) this.emptyEl.hidden = products.length > 0;

    if (this.catalog.products.length === 0) {
      this.grid.innerHTML = "";
      if (this.emptyEl) {
        this.emptyEl.hidden = false;
        this.emptyEl.textContent = this.t(
          "errorNoCatalog",
          "No products configured. Select collections in the theme editor.",
        );
      }
      return;
    }

    if (this.gridRenderLimit < this.gridPageSize) {
      this.gridRenderLimit = this.gridPageSize;
    }
    if (this.gridRenderLimit > products.length) {
      this.gridRenderLimit = Math.max(this.gridPageSize, products.length);
    }

    var self = this;
    var atLimit = this.selectedIds.length >= this.maxProducts;
    var visible = products.slice(0, this.gridRenderLimit);
    var scrollTop = options.preserveScroll ? this.grid.scrollTop : 0;
    var html = "";
    visible.forEach(function (p) {
      html += self.buildProductCardHtml(p, atLimit);
    });

    if (visible.length < products.length) {
      html +=
        '<div class="sugar-rs-grid__sentinel" data-sugar-rs-grid-sentinel>' +
        escapeHtml(
          this.tReplace("loadingMoreProducts", "Showing {{shown}} of {{total}}", {
            shown: visible.length,
            total: products.length,
          }),
        ) +
        "</div>";
    }

    this.grid.innerHTML = html;
    this.bindGridCardEvents();
    if (options.preserveScroll) {
      this.grid.scrollTop = scrollTop;
    }
    this.bindGridInfiniteScroll();
  };

  SugarRoomStudio.prototype.toggleProduct = function (productId) {
    var id = String(productId || "");
    if (!id || !this.catalog.byId[id]) return;
    var idx = this.selectedIds.indexOf(id);
    if (idx !== -1) {
      this.selectedIds.splice(idx, 1);
    } else {
      if (this.selectedIds.length >= this.maxProducts) {
        this.showError(
          this.tReplace("errorMaxProducts", "You can select up to {{max}} products.", {
            max: this.maxProducts,
          }),
        );
        return;
      }
      this.selectedIds.push(id);
    }
    this.renderGrid({ preserveScroll: true });
    this.renderSlots();
    this.syncPlacementsWithSelection();
    this.renderUploadProducts();
    this.renderPlacementLayers();
    this.renderSelectedCount();
    this.updateContinueState();
    this.updateGenerateState();
  };

  SugarRoomStudio.prototype.clearSelection = function () {
    this.selectedIds = [];
    this.placementsByProductId = {};
    this.selectedPlacementId = null;
    this.renderGrid();
    this.renderSlots();
    this.renderUploadProducts();
    this.renderPlacementLayers();
    this.renderSelectedCount();
    this.updateContinueState();
    this.updateGenerateState();
  };

  SugarRoomStudio.prototype.renderSelectedCount = function () {
    var count = this.selectedIds.length;
    var max = this.maxProducts;
    if (this.selectedCountEl) {
      this.selectedCountEl.textContent = this.tReplace(
        "selectedCount",
        "Selected {{count}} / {{max}}",
        { count: count, max: max },
      );
    }
    if (this.slotsTitle) {
      this.slotsTitle.textContent = this.tReplace(
        "selectedProducts",
        "Selected products ({{count}}/{{max}})",
        { count: count, max: max },
      );
    }
    if (this.slotsHint) {
      this.slotsHint.textContent = this.tReplace(
        "selectedHint",
        "Add up to {{max}} products to see them in your space.",
        { max: max },
      );
    }
    this.updateSelectedBadge();
  };

  SugarRoomStudio.prototype.getSelectedCartTotalCents = function () {
    var self = this;
    return this.selectedIds.reduce(function (sum, id) {
      var product = self.catalog.byId[id];
      if (!product) return sum;
      return sum + normalizePriceToCents(product.price);
    }, 0);
  };

  SugarRoomStudio.prototype.renderSlots = function () {
    if (!this.slotsEl) return;
    var self = this;
    var html = "";
    var currency =
      (this.selectedIds[0] &&
        this.catalog.byId[this.selectedIds[0]] &&
        this.catalog.byId[this.selectedIds[0]].currency) ||
      this.config.currency ||
      "TRY";

    for (var i = 0; i < this.maxProducts; i++) {
      var id = this.selectedIds[i];
      var product = id ? this.catalog.byId[id] : null;
      if (product) {
        html +=
          '<article class="sugar-rs-slot is-filled" data-slot-id="' +
          escapeHtml(product.productId) +
          '">' +
          '<div class="sugar-rs-slot__media">' +
          (product.imageUrl
            ? '<img src="' +
              escapeHtml(product.imageUrl) +
              '" alt="" width="160" height="160" loading="lazy">'
            : "") +
          "</div>" +
          '<div class="sugar-rs-slot__body">' +
          '<p class="sugar-rs-slot__title">' +
          escapeHtml(product.title) +
          "</p>" +
          priceParagraphHtml(
            "sugar-rs-slot__price",
            product.price,
            product.currency || currency,
            this.locale,
          ) +
          "</div>" +
          '<button type="button" class="sugar-rs-slot__remove" data-remove-slot="' +
          escapeHtml(product.productId) +
          '" aria-label="' +
          escapeHtml(this.t("removeProduct", "Remove")) +
          '">×</button>' +
          "</article>";
      } else {
        html +=
          '<div class="sugar-rs-slot sugar-rs-slot--empty" aria-hidden="true"></div>';
      }
    }
    this.slotsEl.innerHTML = html;
    this.slotsEl.querySelectorAll("[data-remove-slot]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self.toggleProduct(btn.getAttribute("data-remove-slot"));
      });
    });

    var totalCents = this.getSelectedCartTotalCents();
    if (this.slotsTotalEl) {
      var hasItems = this.selectedIds.length > 0 && totalCents > 0;
      this.slotsTotalEl.hidden = !hasItems;
      if (this.slotsTotalLabel) {
        this.slotsTotalLabel.textContent = this.t("cartTotal", "Cart total");
      }
      if (this.slotsTotalValue) {
        this.slotsTotalValue.textContent = hasItems
          ? formatMoney(totalCents, currency, this.locale)
          : "";
      }
    }
  };

  SugarRoomStudio.prototype.handleRoomFile = function (file) {
    var self = this;
    var utils = window.SugarImageUtils;
    if (!file || !(utils && utils.isLikelyImageFile(file))) {
      this.showError(this.t("errorUpload", "Please upload a valid image."));
      return Promise.resolve(false);
    }
    var maxMb = Number(this.config.maxUploadSizeMb || 10);
    if (file.size > maxMb * 1024 * 1024) {
      this.showError(this.t("errorSize", "File is too large."));
      return Promise.resolve(false);
    }

    var applyFile = function (normalized) {
      self.closeRoomCamera();
      if (self.roomPreviewUrl) URL.revokeObjectURL(self.roomPreviewUrl);
      self.roomFile = normalized;
      self.roomPreviewUrl = URL.createObjectURL(normalized);
      if (self.roomImg) {
        self.roomImg.onload = function () {
          self.syncRoomPreviewAspect();
        };
        self.roomImg.src = self.roomPreviewUrl;
        self.roomImg.hidden = false;
        if (self.roomImg.complete && self.roomImg.naturalWidth) {
          self.syncRoomPreviewAspect();
        }
      }
      if (self.roomSourcesEl) self.roomSourcesEl.hidden = true;
      if (self.roomActions) self.roomActions.hidden = false;
      if (self.roomLayersEl) self.roomLayersEl.hidden = self.designMode !== "manual";
      self.hideMessage();
      self.syncDesignModeUi();
      self.renderPlacementLayers();
      self.updateGenerateState();
      return true;
    };

    if (!utils || !utils.isHeicLike(file)) {
      return Promise.resolve(applyFile(file));
    }

    return utils
      .normalizeRoomImageFile(file, { heic2anyUrl: self.config.heic2anyUrl })
      .then(function (normalized) {
        if (normalized.size > maxMb * 1024 * 1024) {
          self.showError(self.t("errorSize", "File is too large."));
          return false;
        }
        return applyFile(normalized);
      })
      .catch(function () {
        self.showError(
          self.t(
            "errorHeic",
            "Could not convert this Apple photo (HEIC). Try exporting as JPEG or take a new photo.",
          ),
        );
        return false;
      });
  };

  SugarRoomStudio.prototype.syncRoomPreviewAspect = function () {
    var preview = this.roomPreviewEl;
    var img = this.roomImg;
    if (!preview) return;
    var w = img && !img.hidden ? Number(img.naturalWidth || 0) : 0;
    var h = img && !img.hidden ? Number(img.naturalHeight || 0) : 0;
    if (w > 0 && h > 0) {
      this.roomNaturalSize = { width: w, height: h };
      preview.style.setProperty("--sugar-rs-room-ar", w + " / " + h);
      preview.classList.add("has-image");
      this.syncCompareAspect(w, h);
    } else {
      this.roomNaturalSize = null;
      preview.style.removeProperty("--sugar-rs-room-ar");
      preview.classList.remove("has-image");
      this.syncCompareAspect(0, 0);
    }
  };

  SugarRoomStudio.prototype.syncCompareAspect = function (width, height) {
    var el = this.compareEl;
    if (!el) return;
    var w = Number(width || 0);
    var h = Number(height || 0);
    if ((!w || !h) && this.roomNaturalSize) {
      w = this.roomNaturalSize.width;
      h = this.roomNaturalSize.height;
    }
    if ((!w || !h) && this.compareOrigin && this.compareOrigin.naturalWidth) {
      w = this.compareOrigin.naturalWidth;
      h = this.compareOrigin.naturalHeight;
    }
    if (w > 0 && h > 0) {
      var ratio = w + " / " + h;
      el.style.setProperty("--sugar-rs-compare-ar", ratio);
      if (this.panelEl) {
        this.panelEl.style.setProperty("--sugar-rs-room-ar", ratio);
      }
      el.classList.add("has-aspect");
    } else {
      el.style.removeProperty("--sugar-rs-compare-ar");
      el.classList.remove("has-aspect");
    }
  };

  SugarRoomStudio.prototype.bindCompareImageAspect = function () {
    var self = this;
    var applyFromOrigin = function () {
      if (!self.compareOrigin) return;
      var w = self.compareOrigin.naturalWidth || 0;
      var h = self.compareOrigin.naturalHeight || 0;
      if (w > 0 && h > 0) self.syncCompareAspect(w, h);
    };
    if (this.compareOrigin && !this.compareOrigin.__sugarAspectBound) {
      this.compareOrigin.__sugarAspectBound = true;
      this.compareOrigin.addEventListener("load", applyFromOrigin);
    }
  };

  SugarRoomStudio.prototype.clearRoom = function () {
    this.closeRoomCamera();
    if (this.roomPreviewUrl) URL.revokeObjectURL(this.roomPreviewUrl);
    this.roomFile = null;
    this.roomPreviewUrl = "";
    this.roomNaturalSize = null;
    this.placementsByProductId = {};
    this.selectedPlacementId = null;
    if (this.roomImg) {
      this.roomImg.onload = null;
      this.roomImg.removeAttribute("src");
      this.roomImg.hidden = true;
    }
    this.syncRoomPreviewAspect();
    if (this.roomSourcesEl) this.roomSourcesEl.hidden = false;
    if (this.roomActions) this.roomActions.hidden = true;
    if (this.roomLayersEl) {
      this.roomLayersEl.innerHTML = "";
      this.roomLayersEl.hidden = true;
    }
    this.syncDesignModeUi();
    this.renderUploadProducts();
    this.updateGenerateState();
  };

  SugarRoomStudio.prototype.openRoomGallery = function () {
    this.closeRoomCamera();
    if (this.roomFileInput) this.roomFileInput.click();
  };

  SugarRoomStudio.prototype.setRoomCameraLoading = function (loading) {
    if (this.roomCameraWrap) {
      this.roomCameraWrap.classList.toggle("is-loading", !!loading);
    }
    if (this.photoModalStage) {
      this.photoModalStage.classList.toggle("is-loading", !!loading);
    }
  };

  SugarRoomStudio.prototype.stopRoomCameraStream = function () {
    if (!this.cameraStream) return;
    this.cameraStream.getTracks().forEach(function (track) {
      track.stop();
    });
    this.cameraStream = null;
    if (this.roomCameraVideo) this.roomCameraVideo.srcObject = null;
    if (this.photoModalVideo) this.photoModalVideo.srcObject = null;
  };

  SugarRoomStudio.prototype.attachRoomCameraStream = function (stream) {
    this.cameraStream = stream;
    var video = this.isPhotoModalOpen()
      ? this.photoModalVideo
      : this.roomCameraVideo;
    if (!video) return;
    video.srcObject = stream;
    this.setRoomCameraLoading(false);
    var playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(function () {});
    }
  };

  SugarRoomStudio.prototype.isPhotoModalOpen = function () {
    return !!(this.photoModalEl && !this.photoModalEl.hidden);
  };

  SugarRoomStudio.prototype.clearPendingRoomCapture = function () {
    if (this.pendingRoomCaptureUrl) {
      try {
        URL.revokeObjectURL(this.pendingRoomCaptureUrl);
      } catch (err) {}
    }
    this.pendingRoomCapture = null;
    this.pendingRoomCaptureUrl = "";
    if (this.photoModalPreview) {
      this.photoModalPreview.removeAttribute("src");
      this.photoModalPreview.hidden = true;
    }
  };

  SugarRoomStudio.prototype.ensurePhotoModal = function () {
    if (this.photoModalEl) return true;
    var host = this.panelEl || this.root;
    if (!host) return false;
    var el = document.createElement("div");
    el.className = "sugar-rs-photo-modal";
    el.setAttribute("data-sugar-rs-photo-modal", "");
    el.hidden = true;
    el.innerHTML =
      '<div class="sugar-rs-photo-modal__panel" role="dialog" aria-modal="true">' +
      '<header class="sugar-rs-photo-modal__head">' +
      '<h3 data-sugar-rs-photo-modal-title></h3>' +
      '<button type="button" class="sugar-rs-photo-modal__close" data-sugar-rs-photo-modal-close aria-label="">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      "</button></header>" +
      '<div class="sugar-rs-photo-modal__stage" data-sugar-rs-photo-modal-stage>' +
      '<video class="sugar-rs-photo-modal__video" data-sugar-rs-photo-modal-video autoplay playsinline muted webkit-playsinline></video>' +
      '<img class="sugar-rs-photo-modal__preview" data-sugar-rs-photo-modal-preview alt="" hidden>' +
      '<p class="sugar-rs-photo-modal__loading" data-sugar-rs-photo-modal-loading></p>' +
      "</div>" +
      '<canvas data-sugar-rs-photo-modal-canvas hidden></canvas>' +
      '<div class="sugar-rs-photo-modal__actions" data-sugar-rs-photo-modal-live-actions>' +
      '<button type="button" class="sugar-rs-ghost-btn" data-sugar-rs-photo-modal-cancel></button>' +
      '<button type="button" class="sugar-rs-primary-btn" data-sugar-rs-photo-modal-capture></button>' +
      "</div>" +
      '<div class="sugar-rs-photo-modal__actions" data-sugar-rs-photo-modal-review-actions hidden>' +
      '<button type="button" class="sugar-rs-ghost-btn" data-sugar-rs-photo-modal-retake></button>' +
      '<button type="button" class="sugar-rs-primary-btn" data-sugar-rs-photo-modal-approve></button>' +
      "</div></div>";
    host.appendChild(el);

    this.photoModalEl = el;
    this.photoModalVideo = el.querySelector("[data-sugar-rs-photo-modal-video]");
    this.photoModalPreview = el.querySelector("[data-sugar-rs-photo-modal-preview]");
    this.photoModalCanvas = el.querySelector("[data-sugar-rs-photo-modal-canvas]");
    this.photoModalStage = el.querySelector("[data-sugar-rs-photo-modal-stage]");
    this.photoModalLiveActions = el.querySelector(
      "[data-sugar-rs-photo-modal-live-actions]",
    );
    this.photoModalReviewActions = el.querySelector(
      "[data-sugar-rs-photo-modal-review-actions]",
    );
    this.photoModalTitle = el.querySelector("[data-sugar-rs-photo-modal-title]");
    var loading = el.querySelector("[data-sugar-rs-photo-modal-loading]");
    if (loading) loading.textContent = this.t("cameraLoading", "Opening camera…");
    if (this.photoModalTitle) {
      this.photoModalTitle.textContent = this.t("cameraLabel", "Camera");
    }
    var closeBtn = el.querySelector("[data-sugar-rs-photo-modal-close]");
    if (closeBtn) {
      closeBtn.setAttribute("aria-label", this.t("closeAria", "Close"));
      closeBtn.addEventListener("click", this.closePhotoModal.bind(this));
    }
    var cancelBtn = el.querySelector("[data-sugar-rs-photo-modal-cancel]");
    if (cancelBtn) {
      cancelBtn.textContent = this.t("cameraCancel", "Back");
      cancelBtn.addEventListener("click", this.closePhotoModal.bind(this));
    }
    var captureBtn = el.querySelector("[data-sugar-rs-photo-modal-capture]");
    if (captureBtn) {
      captureBtn.textContent = this.t("cameraCapture", "Take photo");
      captureBtn.addEventListener("click", this.captureRoomCamera.bind(this));
    }
    var retakeBtn = el.querySelector("[data-sugar-rs-photo-modal-retake]");
    if (retakeBtn) {
      retakeBtn.textContent = this.t("cameraRetake", "Retake");
      retakeBtn.addEventListener("click", this.retakePhotoModalCapture.bind(this));
    }
    var approveBtn = el.querySelector("[data-sugar-rs-photo-modal-approve]");
    if (approveBtn) {
      approveBtn.textContent = this.t("cameraApprove", "Approve");
      approveBtn.addEventListener("click", this.approvePhotoModalCapture.bind(this));
    }
    return true;
  };

  SugarRoomStudio.prototype.setPhotoModalMode = function (mode) {
    var isReview = mode === "review";
    if (this.photoModalLiveActions) this.photoModalLiveActions.hidden = isReview;
    if (this.photoModalReviewActions) this.photoModalReviewActions.hidden = !isReview;
    if (this.photoModalVideo) this.photoModalVideo.hidden = isReview;
    if (this.photoModalPreview) this.photoModalPreview.hidden = !isReview;
    if (this.photoModalTitle) {
      this.photoModalTitle.textContent = isReview
        ? this.t("cameraReviewTitle", "Review your photo")
        : this.t("cameraLabel", "Camera");
    }
  };

  SugarRoomStudio.prototype.openPhotoModal = function () {
    if (!this.ensurePhotoModal()) {
      this.openRoomCameraInline();
      return;
    }
    this.hideMessage();
    this.clearPendingRoomCapture();
    this.photoModalEl.hidden = false;
    this.setPhotoModalMode("live");
    this.startRoomCameraStream();
  };

  SugarRoomStudio.prototype.closePhotoModal = function () {
    this.stopRoomCameraStream();
    this.setRoomCameraLoading(false);
    this.clearPendingRoomCapture();
    if (this.photoModalEl) this.photoModalEl.hidden = true;
    if (this.roomSourcesEl && !this.roomFile) this.roomSourcesEl.hidden = false;
  };

  SugarRoomStudio.prototype.showPhotoModalReview = function (file) {
    if (!this.ensurePhotoModal()) return;
    this.clearPendingRoomCapture();
    this.pendingRoomCapture = file;
    this.pendingRoomCaptureUrl = URL.createObjectURL(file);
    if (this.photoModalPreview) {
      this.photoModalPreview.src = this.pendingRoomCaptureUrl;
      this.photoModalPreview.hidden = false;
    }
    this.stopRoomCameraStream();
    this.setRoomCameraLoading(false);
    this.photoModalEl.hidden = false;
    this.setPhotoModalMode("review");
  };

  SugarRoomStudio.prototype.retakePhotoModalCapture = function () {
    this.clearPendingRoomCapture();
    this.setPhotoModalMode("live");
    this.startRoomCameraStream();
  };

  SugarRoomStudio.prototype.approvePhotoModalCapture = function () {
    var file = this.pendingRoomCapture;
    if (!file) return;
    this.pendingRoomCapture = null;
    var url = this.pendingRoomCaptureUrl;
    this.pendingRoomCaptureUrl = "";
    if (this.photoModalEl) this.photoModalEl.hidden = true;
    this.stopRoomCameraStream();
    this.setRoomCameraLoading(false);
    var self = this;
    this.handleRoomFile(file).then(function () {
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch (err) {}
      }
      if (self.photoModalPreview) {
        self.photoModalPreview.removeAttribute("src");
        self.photoModalPreview.hidden = true;
      }
    });
  };

  SugarRoomStudio.prototype.startRoomCameraStream = function () {
    var self = this;
    if (!ensureMediaDevices()) {
      this.showError(
        this.t(
          "errorCamera",
          "Could not open the camera. You can choose a photo from the gallery.",
        ),
      );
      this.closePhotoModal();
      this.closeRoomCamera();
      return;
    }

    this.setRoomCameraLoading(true);
    var constraintsList = [
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      { video: { facingMode: "user" }, audio: false },
      { video: true, audio: false },
    ];

    function tryOpen(index) {
      if (index >= constraintsList.length) {
        self.stopRoomCameraStream();
        self.setRoomCameraLoading(false);
        if (self.isPhotoModalOpen()) self.closePhotoModal();
        else self.closeRoomCamera();
        self.showError(
          self.t(
            "errorCamera",
            "Could not open the camera. You can choose a photo from the gallery.",
          ),
        );
        return;
      }

      navigator.mediaDevices
        .getUserMedia(constraintsList[index])
        .then(function (stream) {
          self.attachRoomCameraStream(stream);
        })
        .catch(function () {
          tryOpen(index + 1);
        });
    }

    tryOpen(0);
  };

  SugarRoomStudio.prototype.openRoomCameraInline = function () {
    if (this.roomSourcesEl) this.roomSourcesEl.hidden = true;
    if (this.roomCameraEl) this.roomCameraEl.hidden = false;
    this.startRoomCameraStream();
  };

  SugarRoomStudio.prototype.openRoomCamera = function () {
    this.hideMessage();
    if (this.isMobileStudioLayout()) {
      this.openPhotoModal();
      return;
    }
    this.openRoomCameraInline();
  };

  SugarRoomStudio.prototype.closeRoomCamera = function () {
    if (this.isPhotoModalOpen()) {
      this.closePhotoModal();
      return;
    }
    this.stopRoomCameraStream();
    this.setRoomCameraLoading(false);
    if (this.roomCameraEl) this.roomCameraEl.hidden = true;
    if (this.roomSourcesEl && !this.roomFile) this.roomSourcesEl.hidden = false;
  };

  SugarRoomStudio.prototype.captureRoomCamera = function () {
    var useModal = this.isPhotoModalOpen();
    var video = useModal ? this.photoModalVideo : this.roomCameraVideo;
    var canvas = useModal ? this.photoModalCanvas : this.roomCameraCanvas;
    if (!video || !canvas || !this.cameraStream) {
      this.showError(
        this.t(
          "errorCamera",
          "Could not open the camera. You can choose a photo from the gallery.",
        ),
      );
      return;
    }

    var width = video.videoWidth;
    var height = video.videoHeight;
    if (!width || !height) {
      this.showError(
        this.t(
          "errorCamera",
          "Could not open the camera. You can choose a photo from the gallery.",
        ),
      );
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
        if (useModal || self.isMobileStudioLayout()) {
          self.showPhotoModalReview(file);
          return;
        }
        self.stopRoomCameraStream();
        self.handleRoomFile(file);
      },
      "image/jpeg",
      0.92,
    );
  };

  SugarRoomStudio.prototype.updateContinueState = function () {
    if (!this.continueBtn) return;
    this.continueBtn.disabled = this.selectedIds.length === 0;
  };

  SugarRoomStudio.prototype.updateGenerateState = function () {
    if (!this.generateBtn) return;
    var ready = this.selectedIds.length > 0 && !!this.roomFile && this.canGenerate();
    this.generateBtn.disabled = !ready;
  };

  SugarRoomStudio.prototype.onContinueClick = function () {
    if (this.selectedIds.length === 0) {
      this.showError(this.t("errorSelectProduct", "Select at least one product."));
      return;
    }
    this.hideMessage();
    this.setStep("upload");
  };

  SugarRoomStudio.prototype.onGenerateClick = function () {
    if (this.selectedIds.length === 0) {
      this.showError(this.t("errorSelectProduct", "Select at least one product."));
      this.setStep("studio");
      return;
    }
    if (!this.roomFile) {
      this.setStep("upload");
      this.showError(this.t("errorRoomRequired", "A room photo is required."));
      return;
    }
    this.runDesign();
  };

  SugarRoomStudio.prototype.getProductDetailMetafieldRefs = function () {
    return parseJson(this.config.productDetailMetafieldsJson, []);
  };

  SugarRoomStudio.prototype.setDesignMode = function (mode) {
    var next = mode === "manual" ? "manual" : "auto";
    if (this.designMode === next) return;
    this.designMode = next;
    if (next === "auto") {
      this.selectedPlacementId = null;
    }
    this.syncDesignModeUi();
    this.renderUploadProducts();
    this.renderPlacementLayers();
  };

  SugarRoomStudio.prototype.syncDesignModeUi = function () {
    var self = this;
    var hasPhoto = !!this.roomFile;
    if (this.designModeEl) {
      this.designModeEl.hidden = !hasPhoto;
      this.designModeEl.querySelectorAll("[data-sugar-rs-mode]").forEach(function (btn) {
        btn.classList.toggle(
          "is-active",
          btn.getAttribute("data-sugar-rs-mode") === self.designMode,
        );
      });
    }
    if (this.manualTipEl) {
      this.manualTipEl.hidden = !hasPhoto || this.designMode !== "manual";
    }
    if (this.roomLayersEl) {
      this.roomLayersEl.hidden = this.designMode !== "manual" || !hasPhoto;
    }
    if (this.roomPreviewEl) {
      this.roomPreviewEl.classList.toggle(
        "is-manual-place",
        hasPhoto && this.designMode === "manual",
      );
    }
    if (this.uploadProductsEl) {
      this.uploadProductsEl.classList.toggle("is-manual", hasPhoto && this.designMode === "manual");
    }
  };

  SugarRoomStudio.prototype.syncPlacementsWithSelection = function () {
    var self = this;
    var keep = {};
    this.selectedIds.forEach(function (id) {
      if (self.placementsByProductId[id]) keep[id] = self.placementsByProductId[id];
    });
    this.placementsByProductId = keep;
    if (this.selectedPlacementId && !keep[this.selectedPlacementId]) {
      this.selectedPlacementId = null;
    }
  };

  SugarRoomStudio.prototype.renderUploadProducts = function () {
    if (!this.uploadProductsEl) return;
    var self = this;
    var currency =
      (this.selectedIds[0] &&
        this.catalog.byId[this.selectedIds[0]] &&
        this.catalog.byId[this.selectedIds[0]].currency) ||
      this.config.currency ||
      "TRY";
    var isManual = this.designMode === "manual";

    if (this.uploadProductsTitle) {
      this.uploadProductsTitle.textContent = this.tReplace(
        "selectedProducts",
        "Selected products ({{count}}/{{max}})",
        { count: this.selectedIds.length, max: this.maxProducts },
      );
    }

    if (this.selectedIds.length === 0) {
      this.uploadProductsEl.innerHTML =
        '<p class="sugar-rs-empty" style="padding:1rem 0.25rem">' +
        escapeHtml(this.t("errorSelectProduct", "Select at least one product.")) +
        "</p>";
      return;
    }

    var html = "";
    this.selectedIds.forEach(function (id) {
      var product = self.catalog.byId[id];
      if (!product) return;
      var placed = !!self.placementsByProductId[id];
      html +=
        '<article class="sugar-rs-upload-item' +
        (isManual ? " is-draggable" : "") +
        (placed ? " is-placed" : "") +
        '" data-upload-product-id="' +
        escapeHtml(product.productId) +
        '"' +
        (isManual ? ' draggable="true"' : "") +
        ">" +
        '<div class="sugar-rs-upload-item__media">' +
        (isManual
          ? '<span class="sugar-rs-upload-item__drag" aria-hidden="true">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11M11 10.5V5.5a1.5 1.5 0 0 1 3 0V11M14 10V7.5a1.5 1.5 0 0 1 3 0V12"/><path d="M8 11l-1.2 1.6A3 3 0 0 0 7 14.2V17a3 3 0 0 0 3 3h5.5a3 3 0 0 0 2.9-2.3l.9-3.7A2 2 0 0 0 17.5 11H8z"/></svg>' +
            escapeHtml(self.t("dragLabel", "Drag")) +
            "</span>"
          : "") +
        (product.imageUrl
          ? '<img src="' +
            escapeHtml(product.imageUrl) +
            '" alt="" width="160" height="160" loading="lazy" draggable="false">'
          : "") +
        "</div>" +
        '<div class="sugar-rs-upload-item__body">' +
        '<p class="sugar-rs-upload-item__title">' +
        escapeHtml(product.title) +
        "</p>" +
        priceParagraphHtml(
          "sugar-rs-upload-item__price",
          product.price,
          product.currency || currency,
          self.locale,
        ) +
        "</div>" +
        (isManual
          ? '<div class="sugar-rs-upload-item__nudge">' +
            '<button type="button" class="sugar-rs-upload-item__nudge-btn" data-upload-nudge="' +
            escapeHtml(product.productId) +
            '" data-nudge-x="-0.06" aria-label="' +
            escapeHtml(self.t("moveLeft", "Move left")) +
            '"' +
            (placed ? "" : " disabled") +
            ">" +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M14.5 6.5 9 12l5.5 5.5"/></svg>' +
            "</button>" +
            '<button type="button" class="sugar-rs-upload-item__nudge-btn" data-upload-nudge="' +
            escapeHtml(product.productId) +
            '" data-nudge-x="0.06" aria-label="' +
            escapeHtml(self.t("moveRight", "Move right")) +
            '"' +
            (placed ? "" : " disabled") +
            ">" +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9.5 6.5 15 12l-5.5 5.5"/></svg>' +
            "</button>" +
            "</div>"
          : "") +
        "</article>";
    });
    this.uploadProductsEl.innerHTML = html;
    this.uploadProductsEl.classList.toggle("is-manual", isManual);

    if (!isManual) return;

    this.uploadProductsEl.querySelectorAll("[data-upload-product-id]").forEach(function (item) {
      var productId = item.getAttribute("data-upload-product-id");
      item.addEventListener("click", function (e) {
        if (e.target.closest("[data-upload-nudge]")) return;
        e.preventDefault();
        if (self.placementsByProductId[productId]) {
          self.selectedPlacementId = productId;
          self.renderPlacementLayers();
          self.renderUploadProducts();
        } else {
          self.placeProductAt(productId, 0.5, 0.5);
        }
        if (self.roomPreviewEl && self.isMobileStudioLayout()) {
          try {
            self.roomPreviewEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
          } catch (err) {}
        }
      });
      item.addEventListener("dragstart", function (e) {
        if (!productId || !e.dataTransfer) return;
        e.dataTransfer.setData("text/sugar-rs-product-id", productId);
        e.dataTransfer.setData("text/plain", productId);
        e.dataTransfer.effectAllowed = "copy";
        item.classList.add("is-dragging");
      });
      item.addEventListener("dragend", function () {
        item.classList.remove("is-dragging");
        if (self.roomPreviewEl) self.roomPreviewEl.classList.remove("is-drop-target");
      });
    });

    this.uploadProductsEl.querySelectorAll("[data-upload-nudge]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute("data-upload-nudge");
        if (!self.placementsByProductId[id]) {
          self.placeProductAt(id, 0.5, 0.5);
        }
        self.nudgePlacement(
          id,
          Number(btn.getAttribute("data-nudge-x") || 0),
          Number(btn.getAttribute("data-nudge-y") || 0),
        );
      });
    });
  };

  SugarRoomStudio.prototype.getPreviewDropPoint = function (clientX, clientY) {
    var el = this.roomPreviewEl;
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.min(0.96, Math.max(0.04, (clientX - rect.left) / rect.width)),
      y: Math.min(0.96, Math.max(0.04, (clientY - rect.top) / rect.height)),
    };
  };

  SugarRoomStudio.prototype.placeProductAt = function (productId, x, y) {
    var id = String(productId || "");
    if (!id || this.selectedIds.indexOf(id) === -1) return;
    if (!this.roomFile || this.designMode !== "manual") return;
    var existing = this.placementsByProductId[id] || {};
    this.placementsByProductId[id] = {
      x: x,
      y: y,
      scale: existing.scale || DEFAULT_PLACEMENT_SCALE,
    };
    this.selectedPlacementId = id;
    this.renderUploadProducts();
    this.renderPlacementLayers();
  };

  SugarRoomStudio.prototype.nudgePlacement = function (productId, dx, dy) {
    var id = String(productId || "");
    var placement = this.placementsByProductId[id];
    if (!placement) return;
    placement.x = Math.min(0.96, Math.max(0.04, Number(placement.x || 0.5) + Number(dx || 0)));
    placement.y = Math.min(0.96, Math.max(0.04, Number(placement.y || 0.5) + Number(dy || 0)));
    this.selectedPlacementId = id;
    this.renderPlacementLayers();
    this.renderUploadProducts();
  };

  SugarRoomStudio.prototype.removePlacement = function (productId) {
    var id = String(productId || "");
    if (!id || !this.placementsByProductId[id]) return;
    delete this.placementsByProductId[id];
    if (this.selectedPlacementId === id) this.selectedPlacementId = null;
    this.renderUploadProducts();
    this.renderPlacementLayers();
  };

  SugarRoomStudio.prototype.renderPlacementLayers = function () {
    if (!this.roomLayersEl) return;
    var self = this;
    var show = this.designMode === "manual" && !!this.roomFile;
    this.roomLayersEl.hidden = !show;
    if (!show) {
      this.roomLayersEl.innerHTML = "";
      return;
    }

    var html = "";
    this.selectedIds.forEach(function (id) {
      var product = self.catalog.byId[id];
      var placement = self.placementsByProductId[id];
      if (!product || !placement) return;
      var scalePct = Math.round((placement.scale || DEFAULT_PLACEMENT_SCALE) * 100);
      html +=
        '<div class="sugar-rs-place-layer' +
        (self.selectedPlacementId === id ? " is-selected" : "") +
        '" data-placement-id="' +
        escapeHtml(id) +
        '" style="left:' +
        placement.x * 100 +
        "%;top:" +
        placement.y * 100 +
        "%;width:" +
        scalePct +
        '%">' +
        (product.imageUrl
          ? '<img src="' +
            escapeHtml(product.imageUrl) +
            '" alt="" draggable="false">'
          : "") +
        '<div class="sugar-rs-place-layer__controls">' +
        '<button type="button" class="sugar-rs-place-layer__nudge" data-nudge-placement="' +
        escapeHtml(id) +
        '" data-nudge-x="-0.06" aria-label="' +
        escapeHtml(self.t("moveLeft", "Move left")) +
        '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M14.5 6.5 9 12l5.5 5.5"/></svg>' +
        "</button>" +
        '<button type="button" class="sugar-rs-place-layer__nudge" data-nudge-placement="' +
        escapeHtml(id) +
        '" data-nudge-x="0.06" aria-label="' +
        escapeHtml(self.t("moveRight", "Move right")) +
        '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9.5 6.5 15 12l-5.5 5.5"/></svg>' +
        "</button>" +
        "</div>" +
        '<button type="button" class="sugar-rs-place-layer__remove" data-remove-placement="' +
        escapeHtml(id) +
        '" aria-label="' +
        escapeHtml(self.t("removeProduct", "Remove")) +
        '">×</button>' +
        "</div>";
    });
    this.roomLayersEl.innerHTML = html;

    this.roomLayersEl.querySelectorAll("[data-remove-placement]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.removePlacement(btn.getAttribute("data-remove-placement"));
      });
    });

    this.roomLayersEl.querySelectorAll("[data-nudge-placement]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.nudgePlacement(
          btn.getAttribute("data-nudge-placement"),
          Number(btn.getAttribute("data-nudge-x") || 0),
          Number(btn.getAttribute("data-nudge-y") || 0),
        );
      });
      btn.addEventListener("pointerdown", function (e) {
        e.stopPropagation();
      });
    });
  };

  SugarRoomStudio.prototype.bindPlacementInteractions = function () {
    var self = this;
    if (!this.roomPreviewEl) return;

    this.roomPreviewEl.addEventListener("dragover", function (e) {
      if (self.designMode !== "manual" || !self.roomFile) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      self.roomPreviewEl.classList.add("is-drop-target");
    });

    this.roomPreviewEl.addEventListener("dragleave", function (e) {
      if (!self.roomPreviewEl.contains(e.relatedTarget)) {
        self.roomPreviewEl.classList.remove("is-drop-target");
      }
    });

    this.roomPreviewEl.addEventListener("drop", function (e) {
      if (self.designMode !== "manual" || !self.roomFile) return;
      e.preventDefault();
      self.roomPreviewEl.classList.remove("is-drop-target");
      var productId =
        (e.dataTransfer && e.dataTransfer.getData("text/sugar-rs-product-id")) ||
        (e.dataTransfer && e.dataTransfer.getData("text/plain")) ||
        "";
      var point = self.getPreviewDropPoint(e.clientX, e.clientY);
      if (!productId || !point) return;
      self.placeProductAt(productId, point.x, point.y);
    });

    this.roomPreviewEl.addEventListener("pointerdown", function (e) {
      if (self.designMode !== "manual" || !self.roomFile) return;
      var removeBtn = e.target.closest("[data-remove-placement]");
      if (removeBtn) return;
      if (e.target.closest("[data-nudge-placement]")) return;
      var layer = e.target.closest(".sugar-rs-place-layer");
      if (!layer || !self.roomLayersEl || !self.roomLayersEl.contains(layer)) return;
      var productId = layer.getAttribute("data-placement-id");
      if (!productId) return;
      e.preventDefault();
      self.selectedPlacementId = productId;
      self.roomLayersEl.querySelectorAll(".sugar-rs-place-layer").forEach(function (el) {
        el.classList.toggle(
          "is-selected",
          el.getAttribute("data-placement-id") === productId,
        );
      });
      layer.classList.add("is-dragging");
      self.placementDrag = { id: productId, pointerId: e.pointerId };
      try {
        layer.setPointerCapture(e.pointerId);
      } catch (err) {}
      var point = self.getPreviewDropPoint(e.clientX, e.clientY);
      if (point && self.placementsByProductId[productId]) {
        self.placementsByProductId[productId].x = point.x;
        self.placementsByProductId[productId].y = point.y;
        layer.style.left = point.x * 100 + "%";
        layer.style.top = point.y * 100 + "%";
      }
    });

    this.roomPreviewEl.addEventListener("pointermove", function (e) {
      if (!self.placementDrag || self.placementDrag.pointerId !== e.pointerId) return;
      var point = self.getPreviewDropPoint(e.clientX, e.clientY);
      if (!point) return;
      var placement = self.placementsByProductId[self.placementDrag.id];
      if (!placement) return;
      placement.x = point.x;
      placement.y = point.y;
      var layer = self.roomLayersEl
        ? self.roomLayersEl.querySelector(
            '.sugar-rs-place-layer[data-placement-id="' + self.placementDrag.id + '"]',
          )
        : null;
      if (layer) {
        layer.style.left = point.x * 100 + "%";
        layer.style.top = point.y * 100 + "%";
      }
    });

    function endDrag(e) {
      if (!self.placementDrag || self.placementDrag.pointerId !== e.pointerId) return;
      var layer = self.roomLayersEl
        ? self.roomLayersEl.querySelector(
            '.sugar-rs-place-layer[data-placement-id="' + self.placementDrag.id + '"]',
          )
        : null;
      if (layer) layer.classList.remove("is-dragging");
      self.placementDrag = null;
      self.renderUploadProducts();
    }

    this.roomPreviewEl.addEventListener("pointerup", endDrag);
    this.roomPreviewEl.addEventListener("pointercancel", endDrag);
  };

  SugarRoomStudio.prototype.buildSelections = function (extraProducts) {
    var self = this;
    var isManual = this.designMode === "manual";
    var extras = Array.isArray(extraProducts) ? extraProducts : [];
    var base = this.selectedIds
      .map(function (id, index) {
        var p = self.catalog.byId[id];
        if (!p || !p.variantId) return null;
        var placement = isManual ? self.placementsByProductId[id] : null;
        return {
          productId: p.productId,
          variantId: p.variantId,
          isPrimary: index === 0,
          quantity: 1,
          position: placement
            ? {
                x: placement.x,
                y: placement.y,
                scale: placement.scale || DEFAULT_PLACEMENT_SCALE,
              }
            : null,
        };
      })
      .filter(Boolean);

    extras.forEach(function (p) {
      if (!p || !p.variantId) return;
      var already = base.some(function (s) {
        return String(s.productId) === String(p.productId);
      });
      if (already) return;
      base.push({
        productId: p.productId,
        variantId: p.variantId,
        isPrimary: false,
        quantity: 1,
        position: null,
      });
    });
    return base;
  };

  SugarRoomStudio.prototype.requestGenerateSync = async function (formData) {
    var response = await fetch(this.config.proxyUrl || "/apps/sugar/generate", {
      method: "POST",
      body: formData,
    });
    var data = await this.parseGenerateResponse(response);
    if (!response.ok || data.status === "failed") {
      throw new Error(data.message || this.t("errorGenerate", "Could not create design."));
    }
    return data;
  };

  SugarRoomStudio.prototype.parseGenerateResponse = async function (response) {
    var contentType = String(response.headers.get("content-type") || "").toLowerCase();
    var bodyText = await response.text();
    if (contentType.indexOf("application/json") !== -1 || bodyText.trim().charAt(0) === "{") {
      try {
        return JSON.parse(bodyText);
      } catch {
        throw new Error(
          this.t("errorGenerateProxy", "Design service returned an invalid response."),
        );
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

  SugarRoomStudio.prototype.startLoadingProgress = function () {
    var self = this;
    var started = Date.now();
    var duration = 28000;
    this.stopLoadingProgress();
    this.loadingTimer = setInterval(function () {
      var pct = Math.min(92, Math.floor(((Date.now() - started) / duration) * 100));
      if (self.loadingBar) self.loadingBar.style.width = pct + "%";
      if (self.loadingPct) {
        self.loadingPct.textContent = self.tReplace(
          "loadingProgress",
          "{{percent}}% complete",
          { percent: pct },
        );
      }
    }, 200);
  };

  SugarRoomStudio.prototype.stopLoadingProgress = function () {
    if (this.loadingTimer) {
      clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
  };

  SugarRoomStudio.prototype.completeLoadingProgress = function () {
    this.stopLoadingProgress();
    if (this.loadingBar) this.loadingBar.style.width = "100%";
    if (this.loadingPct) {
      this.loadingPct.textContent = this.tReplace(
        "loadingProgress",
        "{{percent}}% complete",
        { percent: 100 },
      );
    }
  };

  SugarRoomStudio.prototype.runDesign = async function (options) {
    options = options || {};
    if (!this.roomFile) {
      this.showError(this.t("errorRoomRequired", "A room photo is required."));
      this.setStep("upload");
      return;
    }
    var enrichmentProducts = options.isRedesign
      ? this.pickEnrichmentProducts(options.enrichmentTypes || this.pendingEnrichmentTypes || [])
      : [];
    var selections = this.buildSelections(enrichmentProducts);
    if (selections.length === 0) {
      this.showError(this.t("errorSelectProduct", "Select at least one product."));
      this.setStep("studio");
      return;
    }
    this.syncAttemptCount();
    if (!this.canGenerate()) {
      this.showError(this.t("errorGenerate", "Could not create design."));
      return;
    }

    var promptText = String(
      options.prompt != null ? options.prompt : this.pendingRedesignPrompt || "",
    ).trim();
    var enrichmentTypes = options.enrichmentTypes || this.pendingEnrichmentTypes || [];
    this.resultProductIds = this.selectedIds
      .slice()
      .concat(
        enrichmentProducts.map(function (p) {
          return p.id;
        }),
      )
      .filter(function (id, idx, arr) {
        return arr.indexOf(id) === idx;
      });

    this.hideMessage();
    this.setStep("loading");
    this.startLoadingProgress();

    try {
      var base64 = await fileToBase64(this.roomFile);
      var formData = new FormData();
      formData.append("selections", JSON.stringify(selections));
      formData.append("roomImageBase64", base64);
      formData.append("roomImageName", this.roomFile.name || "room.jpg");
      if (this.roomNaturalSize && this.roomNaturalSize.width && this.roomNaturalSize.height) {
        formData.append("roomImageWidth", String(this.roomNaturalSize.width));
        formData.append("roomImageHeight", String(this.roomNaturalSize.height));
        formData.append(
          "roomImageAspectRatio",
          String(this.roomNaturalSize.width / this.roomNaturalSize.height),
        );
      }
      formData.append(
        "productDetailMetafields",
        JSON.stringify(this.getProductDetailMetafieldRefs()),
      );
      formData.append(
        "productDetailMetafieldNamespace",
        this.config.productDetailMetafieldNamespace || "custom",
      );
      if (promptText) formData.append("prompt", promptText);
      if (enrichmentTypes.length) {
        formData.append("enrichment", JSON.stringify(enrichmentTypes));
      }
      if (options.isRedesign) formData.append("isRedesign", "true");

      var generateClient = window.SugarPdpKit && window.SugarPdpKit.generate;
      var data = generateClient
        ? await generateClient.requestGenerateWithPoll({
            generateUrl: this.config.proxyUrl || "/apps/sugar/generate",
            formData: formData,
            parseResponse: this.parseGenerateResponse.bind(this),
            t: this.t.bind(this),
          })
        : await this.requestGenerateSync(formData);
      if (data.status === "failed") {
        throw new Error(data.message || this.t("errorGenerate", "Could not create design."));
      }

      this.designResult = data;
      this.resultSelections = {};
      selections.forEach(function (s) {
        this.resultSelections[String(s.variantId)] = true;
      }, this);

      if (this.compareOrigin) this.compareOrigin.src = this.roomPreviewUrl || "";
      if (this.compareDesign) this.compareDesign.src = data.imageUrl || "";
      this.syncCompareAspect(
        this.roomNaturalSize && this.roomNaturalSize.width,
        this.roomNaturalSize && this.roomNaturalSize.height,
      );
      this.setComparePosition(0);

      this.designCompletionCount += 1;
      this.syncRedesignTip();
      this.renderResultList();
      if (!this.unlimitedAttempts) {
        this.attemptCount = recordAttempt(this.getShopAttemptKey());
      }
      this.completeLoadingProgress();
      if (this.dialog && this.displayMode === "modal" && !this.dialog.open) {
        this.dialog.showModal();
      }
      this.setStep("result");
      this.updateGenerateState();
      this.pendingRedesignPrompt = "";
      this.pendingEnrichmentTypes = [];
    } catch (err) {
      this.stopLoadingProgress();
      this.showError(
        err instanceof Error ? err.message : this.t("errorGeneric", "Something went wrong"),
      );
      this.setStep(options.isRedesign ? "result" : "studio");
    }
  };

  SugarRoomStudio.prototype.bindResultListLinks = function () {
    if (!this.resultList || this.resultList.__sugarResultLinksBound) return;
    this.resultList.__sugarResultLinksBound = true;
    this.resultList.addEventListener("click", function (e) {
      var link = e.target && e.target.closest
        ? e.target.closest("a.sugar-rs-result-list__link")
        : null;
      if (!link) return;
      var href = link.getAttribute("href");
      if (!href || href === "#") return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }
      var opened = window.open(href, "_blank", "noopener,noreferrer");
      if (opened) {
        try {
          opened.opener = null;
        } catch (err) {}
      }
    });
  };

  SugarRoomStudio.prototype.renderResultList = function () {
    if (!this.resultList) return;
    var self = this;
    var ids =
      Array.isArray(this.resultProductIds) && this.resultProductIds.length
        ? this.resultProductIds
        : this.selectedIds;
    var html = "";
    ids.forEach(function (id) {
      var p = self.catalog.byId[id];
      if (!p) return;
      var url = self.getProductUrl(p);
      var inner =
        (p.imageUrl ? '<img src="' + escapeHtml(p.imageUrl) + '" alt="">' : "") +
        "<span>" +
        escapeHtml(p.title) +
        "</span>";
      if (url) {
        html +=
          '<li><a class="sugar-rs-result-list__link" href="' +
          escapeHtml(url) +
          '" target="_blank" rel="noopener noreferrer" data-sugar-rs-product-link>' +
          inner +
          "</a></li>";
      } else {
        html += "<li>" + inner + "</li>";
      }
    });
    this.resultList.innerHTML = html;
  };

  SugarRoomStudio.prototype.collectCartSectionIds = function () {
    var ids = [];
    var seen = {};
    document.querySelectorAll("[id^='shopify-section-']").forEach(function (el) {
      var id = String(el.id || "").replace(/^shopify-section-/, "");
      if (!id || seen[id]) return;
      var hay = (id + " " + (el.className || "")).toLowerCase();
      if (!/cart|header|navbar|nav-bar|announcement/.test(hay)) return;
      seen[id] = true;
      ids.push(id);
    });
    return ids;
  };

  SugarRoomStudio.prototype.applyCartSections = function (sections) {
    if (!sections || typeof sections !== "object") return;
    Object.keys(sections).forEach(function (id) {
      var html = sections[id];
      if (!html) return;
      var current = document.getElementById("shopify-section-" + id);
      if (!current) return;
      var tmp = document.createElement("div");
      tmp.innerHTML = String(html).trim();
      var incoming =
        tmp.querySelector("#shopify-section-" + id) || tmp.firstElementChild;
      if (incoming && incoming.id === current.id) {
        current.replaceWith(incoming);
      } else if (incoming) {
        current.innerHTML = incoming.innerHTML;
      } else {
        current.innerHTML = html;
      }
    });
  };

  SugarRoomStudio.prototype.dispatchCartEvents = function (cart) {
    var detail = { cart: cart, source: "sugar-curator" };
    [
      "cart:updated",
      "cart:refresh",
      "cart:change",
      "ajaxCart:updated",
      "shopify-cart:updated",
    ].forEach(function (name) {
      document.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
      document.documentElement.dispatchEvent(
        new CustomEvent(name, { bubbles: true, detail: detail }),
      );
    });
    if (
      typeof window.publish === "function" &&
      window.PUB_SUB_EVENTS &&
      window.PUB_SUB_EVENTS.cartUpdate
    ) {
      window.publish(window.PUB_SUB_EVENTS.cartUpdate, {
        source: "sugar-curator",
        cartData: cart,
      });
    }
  };

  SugarRoomStudio.prototype.notifyThemeCartUpdated = function (addResponse) {
    var self = this;
    if (addResponse && addResponse.sections) {
      this.applyCartSections(addResponse.sections);
    }
    fetch("/cart.js")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (cart) {
        if (!cart) return;
        self.dispatchCartEvents(cart);
        var sectionIds = self.collectCartSectionIds();
        if (!sectionIds.length) return null;
        var url =
          (window.Shopify && window.Shopify.routes && window.Shopify.routes.root
            ? window.Shopify.routes.root
            : "/") +
          "?sections=" +
          encodeURIComponent(sectionIds.join(","));
        return fetch(url, { headers: { Accept: "application/json" } }).then(
          function (res) {
            return res.ok ? res.json() : null;
          },
        );
      })
      .then(function (sections) {
        if (sections) self.applyCartSections(sections);
      })
      .catch(function () {});
  };

  SugarRoomStudio.prototype.addDesignToCart = function () {
    if (!this.designResult || !this.addCartBtn) return;
    var self = this;
    var imageKey = this.config.imagePropertyKey || "_sugar_design_image";
    var genKey = this.config.generationIdPropertyKey || "_sugar_generation_id";
    var cartImageUrl = getCartSafeDesignImageUrl(this.designResult.imageUrl || "");
    var generationId = String(this.designResult.generationId || "");
    var items = [];
    var imageAttached = false;

    this.selectedIds.forEach(function (id) {
      var p = self.catalog.byId[id];
      if (!p || !p.variantId) return;
      if (!self.resultSelections[String(p.variantId)]) return;
      var props = {};
      if (generationId) props[genKey] = generationId;
      if (cartImageUrl && !imageAttached) {
        props[imageKey] = cartImageUrl;
        imageAttached = true;
      }
      items.push({ id: Number(p.variantId), quantity: 1, properties: props });
    });

    if (items.length === 0) {
      this.showError(this.t("errorSelectProduct", "Select at least one product."));
      return;
    }

    this.hideMessage();
    this.addCartBtn.disabled = true;
    var sectionIds = this.collectCartSectionIds();
    var addPayload = { items: items };
    if (sectionIds.length) {
      addPayload.sections = sectionIds.join(",");
      addPayload.sections_url = window.location.pathname || "/";
    }
    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(addPayload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            throw new Error(
              data.description || data.message || self.t("errorCart", "Could not add to cart"),
            );
          }
          return data;
        });
      })
      .then(function (data) {
        self.addCartBtn.disabled = false;
        var detail = self.tReplace(
          "cartSuccessDetail",
          "{{count}} item(s) added to your cart.",
          { count: items.length },
        );
        self.showSuccess(self.t("cartSuccess", "Added to cart!") + " " + detail);
        self.notifyThemeCartUpdated(data);
      })
      .catch(function (err) {
        self.addCartBtn.disabled = false;
        self.showError(
          err instanceof Error
            ? err.message
            : self.t("errorCartRetry", "Could not add to cart. Please try again."),
        );
      });
  };

  SugarRoomStudio.prototype.showError = function (message) {
    this.showToast(message, "error");
  };

  SugarRoomStudio.prototype.showSuccess = function (message) {
    this.showToast(message, "success");
  };

  SugarRoomStudio.prototype.hideMessage = function () {
    if (!this.toastEl) return;
    this.toastEl.hidden = true;
    this.toastEl.textContent = "";
    this.toastEl.classList.remove("is-error", "is-success");
  };

  SugarRoomStudio.prototype.showToast = function (message, type) {
    if (!this.toastEl) return;
    var self = this;
    this.toastEl.hidden = false;
    this.toastEl.textContent = message;
    this.toastEl.classList.toggle("is-error", type === "error");
    this.toastEl.classList.toggle("is-success", type === "success");
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(function () {
      self.hideMessage();
    }, 4000);
  };

  function boot() {
    document.querySelectorAll("[data-sugar-rs-root]").forEach(function (root) {
      if (root.__sugarRsBooted) return;
      root.__sugarRsBooted = true;
      new SugarRoomStudio(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  document.addEventListener("shopify:section:load", boot);
})();
