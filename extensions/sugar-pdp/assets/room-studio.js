(function () {
  "use strict";

  var STEPS = ["studio", "upload", "loading", "result"];
  var ATTEMPT_STORAGE_KEY = "sugar_rs_design_attempts";
  var DEFAULT_PLACEMENT_SCALE = 0.28;

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
    this.i18n = this.config.i18n || {};
    this.locale = this.config.locale || undefined;
    this.displayMode = this.config.displayMode === "embedded" ? "embedded" : "modal";
    this.catalog = this.normalizeCatalog(parseJson(root.dataset.sugarRsCatalog, {}));
    this.maxProducts = Math.max(1, Math.min(5, Number(this.config.maxProducts || 5)));
    this.maxDesignAttempts = Math.max(1, Number(this.config.maxDesignAttempts || 3));
    this.unlimitedAttempts = isShopifyAdminPreview();
    this.attemptCount = 0;
    this.step = "studio";
    this.activeCategoryId = "all";
    this.activeSubcategoryId = null;
    this.expandedCategoryIds = {};
    this.categoryQuery = "";
    this.productQuery = "";
    this.selectedIds = [];
    this.gridPageSize = 12;
    this.gridRenderLimit = 12;
    this.roomFile = null;
    this.roomPreviewUrl = "";
    this.designMode = "auto";
    this.placementsByProductId = {};
    this.selectedPlacementId = null;
    this.placementDrag = null;
    this.designResult = null;
    this.resultSelections = {};
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
        var children = self.buildSubcategories(ids, byId);
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
      var allIds = productList.map(function (p) {
        return p.productId;
      });
      cats.unshift({
        id: "all",
        title: "All Products",
        productIds: allIds,
        count: allIds.length,
        children: self.buildSubcategories(allIds, byId),
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
          children: self.buildSubcategories(ids, byId),
        };
      });
    }

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

  SugarRoomStudio.prototype.hydrateCatalog = async function () {
    var handles = Array.isArray(this.config.catalogHandles)
      ? this.config.catalogHandles.filter(Boolean)
      : [];
    // Always page beyond Liquid's ~50 product cap when handles are configured
    if (!handles.length) return;

    var self = this;
    if (this.grid) {
      this.grid.setAttribute("aria-busy", "true");
    }

    try {
      for (var i = 0; i < handles.length; i++) {
        var handle = String(handles[i]);
        var rawProducts = await this.fetchAllCollectionProducts(handle);
        var mapped = rawProducts
          .map(function (raw) {
            return self.mapAjaxProduct(raw);
          })
          .filter(Boolean);
        self.mergeProductsIntoCatalog(mapped, handle === "all" ? "all" : handle);
      }
      self.catalog = self.normalizeCatalog({
        products: self.catalog.products,
        categories: self.catalog.sourceCategories || self.catalog.categories,
      });
      if (self.activeSubcategoryId && !self.getActiveSubcategory()) {
        self.activeSubcategoryId = null;
      }
      if (
        self.activeCategoryId &&
        self.activeCategoryId !== "all" &&
        !self.getActiveCategory()
      ) {
        self.activeCategoryId = "all";
        self.activeSubcategoryId = null;
      }
      self.expandAllCategoriesWithChildren();
      self.renderCategories();
      self.renderGrid();
      self.renderSlots();
      self.renderSelectedCount();
      self.updateContinueState();
      self.updateGenerateState();
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
    this.catSearch = this.root.querySelector("[data-sugar-rs-cat-search]");
    this.productSearch = this.root.querySelector("[data-sugar-rs-product-search]");
    this.grid = this.root.querySelector("[data-sugar-rs-grid]");
    this.emptyEl = this.root.querySelector("[data-sugar-rs-empty]");
    this.browseTitle = this.root.querySelector("[data-sugar-rs-browse-title]");
    this.selectedCountEl = this.root.querySelector("[data-sugar-rs-selected-count]");
    this.slotsEl = this.root.querySelector("[data-sugar-rs-slots]");
    this.slotsTitle = this.root.querySelector("[data-sugar-rs-slots-title]");
    this.slotsHint = this.root.querySelector("[data-sugar-rs-slots-hint]");
    this.slotsTotalEl = this.root.querySelector("[data-sugar-rs-slots-total]");
    this.slotsTotalLabel = this.root.querySelector("[data-sugar-rs-slots-total-label]");
    this.slotsTotalValue = this.root.querySelector("[data-sugar-rs-slots-total-value]");
    this.roomImg = this.root.querySelector("[data-sugar-rs-room-img]");
    this.roomPreviewEl = this.root.querySelector("[data-sugar-rs-room-preview]");
    this.roomLayersEl = this.root.querySelector("[data-sugar-rs-room-layers]");
    this.roomUploadBtn = this.root.querySelector("[data-sugar-rs-room-upload-btn]");
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
    this.addCartBtn = this.root.querySelector("[data-sugar-rs-add-cart]");
    this.loadingBar = this.root.querySelector("[data-sugar-rs-loading-bar]");
    this.loadingPct = this.root.querySelector("[data-sugar-rs-loading-pct]");
    this.compareEl = this.root.querySelector("[data-sugar-rs-compare]");
    this.compareOrigin = this.root.querySelector("[data-sugar-rs-compare-origin]");
    this.compareDesign = this.root.querySelector("[data-sugar-rs-compare-design]");
    this.compareRange = this.root.querySelector("[data-sugar-rs-compare-range]");
    this.resultList = this.root.querySelector("[data-sugar-rs-result-list]");
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
        self.productQuery = String(self.productSearch.value || "").trim().toLowerCase();
        self.resetGridPagination();
        self.renderGrid();
      });
    }

    if (this.grid) {
      this.boundGridScroll = function () {
        self.onGridScroll();
      };
      this.grid.addEventListener("scroll", this.boundGridScroll, { passive: true });
    }

    if (this.roomUploadBtn) {
      this.roomUploadBtn.addEventListener("click", function () {
        if (self.roomFileInput) self.roomFileInput.click();
      });
    }
    if (this.changeRoomBtn) {
      this.changeRoomBtn.addEventListener("click", function () {
        if (self.roomFileInput) self.roomFileInput.click();
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
        self.runDesign({ isRedesign: true });
      });
    }
    if (this.addCartBtn) {
      this.addCartBtn.addEventListener("click", function () {
        self.addDesignToCart();
      });
    }
    if (this.compareRange && this.compareEl) {
      this.compareRange.addEventListener("input", function () {
        self.compareEl.style.setProperty(
          "--sugar-rs-compare",
          String(self.compareRange.value) + "%",
        );
      });
    }

    if (this.designModeEl) {
      this.designModeEl.querySelectorAll("[data-sugar-rs-mode]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          self.setDesignMode(btn.getAttribute("data-sugar-rs-mode"));
        });
      });
    }

    this.bindPlacementInteractions();
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

    if (step === "upload") {
      this.syncDesignModeUi();
      this.renderUploadProducts();
      this.renderPlacementLayers();
    }
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
    var price = formatMoney(p.price, p.currency || this.config.currency, this.locale);
    var title = String(p.title || "").trim() || "—";
    return (
      '<article class="sugar-rs-card' +
      (selected ? " is-selected" : "") +
      '" data-product-id="' +
      escapeHtml(p.productId) +
      '">' +
      '<div class="sugar-rs-card__media">' +
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
      (selected ? "✓" : "+") +
      "</button>" +
      "</div>" +
      '<div class="sugar-rs-card__meta">' +
      '<div class="sugar-rs-card__title">' +
      escapeHtml(title) +
      "</div>" +
      '<div class="sugar-rs-card__price">' +
      escapeHtml(price) +
      "</div>" +
      "</div></article>"
    );
  };

  SugarRoomStudio.prototype.bindGridCardEvents = function () {
    var self = this;
    if (!this.grid) return;
    this.grid.querySelectorAll("[data-toggle-product]").forEach(function (btn) {
      if (btn.__sugarRsBound) return;
      btn.__sugarRsBound = true;
      btn.addEventListener("click", function () {
        self.toggleProduct(btn.getAttribute("data-toggle-product"));
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
        var price = formatMoney(product.price, product.currency || currency, this.locale);
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
          '<p class="sugar-rs-slot__price">' +
          escapeHtml(price) +
          "</p>" +
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
      var hasItems = this.selectedIds.length > 0;
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
    if (!file || !String(file.type || "").startsWith("image/")) {
      this.showError(this.t("errorUpload", "Please upload a valid image."));
      return;
    }
    var maxMb = Number(this.config.maxUploadSizeMb || 10);
    if (file.size > maxMb * 1024 * 1024) {
      this.showError(this.t("errorSize", "File is too large."));
      return;
    }
    if (this.roomPreviewUrl) URL.revokeObjectURL(this.roomPreviewUrl);
    this.roomFile = file;
    this.roomPreviewUrl = URL.createObjectURL(file);
    if (this.roomImg) {
      this.roomImg.src = this.roomPreviewUrl;
      this.roomImg.hidden = false;
    }
    if (this.roomUploadBtn) this.roomUploadBtn.hidden = true;
    if (this.roomActions) this.roomActions.hidden = false;
    if (this.roomLayersEl) this.roomLayersEl.hidden = this.designMode !== "manual";
    this.hideMessage();
    this.renderPlacementLayers();
    this.updateGenerateState();
  };

  SugarRoomStudio.prototype.clearRoom = function () {
    if (this.roomPreviewUrl) URL.revokeObjectURL(this.roomPreviewUrl);
    this.roomFile = null;
    this.roomPreviewUrl = "";
    this.placementsByProductId = {};
    this.selectedPlacementId = null;
    if (this.roomImg) {
      this.roomImg.removeAttribute("src");
      this.roomImg.hidden = true;
    }
    if (this.roomUploadBtn) this.roomUploadBtn.hidden = false;
    if (this.roomActions) this.roomActions.hidden = true;
    if (this.roomLayersEl) {
      this.roomLayersEl.innerHTML = "";
      this.roomLayersEl.hidden = true;
    }
    this.renderUploadProducts();
    this.updateGenerateState();
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
    if (this.designModeEl) {
      this.designModeEl.querySelectorAll("[data-sugar-rs-mode]").forEach(function (btn) {
        btn.classList.toggle(
          "is-active",
          btn.getAttribute("data-sugar-rs-mode") === self.designMode,
        );
      });
    }
    if (this.manualTipEl) {
      this.manualTipEl.hidden = this.designMode !== "manual";
    }
    if (this.roomLayersEl) {
      this.roomLayersEl.hidden =
        this.designMode !== "manual" || !this.roomFile;
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
      var price = formatMoney(product.price, product.currency || currency, self.locale);
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
        (product.imageUrl
          ? '<img src="' +
            escapeHtml(product.imageUrl) +
            '" alt="" width="80" height="80" loading="lazy" draggable="false">'
          : "") +
        "</div>" +
        '<div class="sugar-rs-upload-item__body">' +
        '<p class="sugar-rs-upload-item__title">' +
        escapeHtml(product.title) +
        "</p>" +
        '<p class="sugar-rs-upload-item__price">' +
        escapeHtml(price) +
        "</p>" +
        "</div>" +
        (isManual
          ? '<span class="sugar-rs-upload-item__grip" aria-hidden="true">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="17" r="1.5"/><circle cx="15" cy="17" r="1.5"/></svg>' +
            "</span>"
          : "") +
        "</article>";
    });
    this.uploadProductsEl.innerHTML = html;

    if (!isManual) return;

    this.uploadProductsEl.querySelectorAll("[data-upload-product-id]").forEach(function (item) {
      item.addEventListener("dragstart", function (e) {
        var productId = item.getAttribute("data-upload-product-id");
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

  SugarRoomStudio.prototype.buildSelections = function () {
    var self = this;
    var isManual = this.designMode === "manual";
    return this.selectedIds
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
    var selections = this.buildSelections();
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

    this.hideMessage();
    this.setStep("loading");
    this.startLoadingProgress();

    try {
      var base64 = await fileToBase64(this.roomFile);
      var formData = new FormData();
      formData.append("selections", JSON.stringify(selections));
      formData.append("roomImageBase64", base64);
      formData.append("roomImageName", this.roomFile.name || "room.jpg");
      formData.append(
        "productDetailMetafields",
        JSON.stringify(this.getProductDetailMetafieldRefs()),
      );
      formData.append(
        "productDetailMetafieldNamespace",
        this.config.productDetailMetafieldNamespace || "custom",
      );

      var response = await fetch(this.config.proxyUrl || "/apps/sugar/generate", {
        method: "POST",
        body: formData,
      });
      var data = await this.parseGenerateResponse(response);
      if (!response.ok || data.status === "failed") {
        throw new Error(data.message || this.t("errorGenerate", "Could not create design."));
      }

      this.designResult = data;
      this.resultSelections = {};
      selections.forEach(function (s) {
        this.resultSelections[String(s.variantId)] = true;
      }, this);

      if (this.compareOrigin) this.compareOrigin.src = this.roomPreviewUrl || "";
      if (this.compareDesign) this.compareDesign.src = data.imageUrl || "";
      if (this.compareEl) this.compareEl.style.setProperty("--sugar-rs-compare", "50%");
      if (this.compareRange) this.compareRange.value = "50";

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
    } catch (err) {
      this.stopLoadingProgress();
      this.showError(
        err instanceof Error ? err.message : this.t("errorGeneric", "Something went wrong"),
      );
      this.setStep(options.isRedesign ? "result" : "studio");
    }
  };

  SugarRoomStudio.prototype.renderResultList = function () {
    if (!this.resultList) return;
    var self = this;
    var html = "";
    this.selectedIds.forEach(function (id) {
      var p = self.catalog.byId[id];
      if (!p) return;
      html +=
        "<li>" +
        (p.imageUrl ? '<img src="' + escapeHtml(p.imageUrl) + '" alt="">' : "") +
        "<span>" +
        escapeHtml(p.title) +
        "</span></li>";
    });
    this.resultList.innerHTML = html;
  };

  SugarRoomStudio.prototype.notifyThemeCartUpdated = function () {
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
    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: items }),
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
      .then(function () {
        self.addCartBtn.disabled = false;
        var detail = self.tReplace(
          "cartSuccessDetail",
          "{{count}} item(s) added to your cart.",
          { count: items.length },
        );
        self.showSuccess(self.t("cartSuccess", "Added to cart!") + " " + detail);
        self.notifyThemeCartUpdated();
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
