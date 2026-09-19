(function (g) {
  "use strict";

  var ns = (g.SugarSa = g.SugarSa || {});
  ns.el = ns.el || {};

  var PAGE_SIZE = 8;

  function isSelected(selected, id) {
    return !!(selected && selected[id]);
  }

  function applyCardState(btn, on, suggested, t) {
    btn.classList.toggle("is-selected", on);
    btn.classList.toggle("is-recommended", !!suggested);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var mark = btn.querySelector(".sugar-sa-card__mark");
    if (mark) mark.textContent = on ? t.selected || "Selected" : t.select || "Select";
    var badge = btn.querySelector(".sugar-sa-card__suggested");
    if (badge) {
      badge.hidden = !suggested;
      badge.textContent = t.cartRecommended || t.recommended || "Suggested";
    }
  }

  function card(item, formatMoney, selected, recommended, onToggle, t) {
    var id = String((item && item.variantId) || "");
    var on = isSelected(selected, id);
    var suggested = !!(recommended && recommended[id]);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sugar-sa-card";
    btn.setAttribute("data-variant-id", id);
    var img = document.createElement("img");
    img.alt = "";
    img.src = (item && item.imageUrl) || "";
    var body = document.createElement("div");
    body.className = "sugar-sa-card__body";
    var title = document.createElement("p");
    title.className = "sugar-sa-card__title";
    title.textContent = (item && item.title) || "";
    var price = document.createElement("p");
    price.className = "sugar-sa-card__price";
    price.textContent = formatMoney(item && item.priceCents, item && item.currency);
    var chips = document.createElement("div");
    chips.className = "sugar-sa-card__chips";
    var badge = document.createElement("span");
    badge.className = "sugar-sa-card__suggested";
    var mark = document.createElement("span");
    mark.className = "sugar-sa-card__mark";
    chips.appendChild(badge);
    chips.appendChild(mark);
    body.appendChild(title);
    body.appendChild(price);
    body.appendChild(chips);
    btn.appendChild(img);
    btn.appendChild(body);
    applyCardState(btn, on, suggested, t);
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (!id || typeof onToggle !== "function") return;
      onToggle(item, !isSelected(selected, id));
    });
    return btn;
  }

  ns.el.syncProductSelection = function (root, selected, i18n, recommended) {
    var t = i18n || {};
    if (!root) return;
    root.querySelectorAll(".sugar-sa-card[data-variant-id]").forEach(function (node) {
      var id = node.getAttribute("data-variant-id") || "";
      applyCardState(node, isSelected(selected, id), !!(recommended && recommended[id]), t);
    });
  };

  ns.el.mergeProductItems = function (current, incoming) {
    var seen = {};
    var out = [];
    function add(item) {
      var id = String((item && item.variantId) || "");
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(item);
    }
    (current || []).forEach(add);
    (incoming || []).forEach(add);
    return out;
  };

  function sortRecommendedFirst(items, recommended) {
    return (items || []).slice().sort(function (a, b) {
      var ar = recommended && recommended[String((a && a.variantId) || "")] ? 0 : 1;
      var br = recommended && recommended[String((b && b.variantId) || "")] ? 0 : 1;
      return ar - br;
    });
  }

  ns.el.products = function (items, i18n, selected, onToggle, recommendedMap) {
    var util = ns.util || {};
    var formatMoney = util.formatMoney || String;
    var replaceTokens = util.replaceTokens || String;
    var t = i18n || {};
    var recommended = recommendedMap || {};
    var list = sortRecommendedFirst(items, recommended);
    var wrap = document.createElement("div");
    wrap.className = "sugar-sa-products";
    var grid = document.createElement("div");
    grid.className = "sugar-sa-products__grid";
    wrap.appendChild(grid);

    var page = 0;
    var pageCount = 1;
    var pager = document.createElement("nav");
    pager.className = "sugar-sa-pager";
    pager.setAttribute("aria-label", t.pageLabel || "Products");
    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "sugar-sa-pager__btn";
    prevBtn.textContent = t.pagePrev || "Previous";
    prevBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (page <= 0) return;
      page -= 1;
      renderPage();
    });
    var pagerStatus = document.createElement("span");
    pagerStatus.className = "sugar-sa-pager__status";
    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "sugar-sa-pager__btn";
    nextBtn.textContent = t.pageNext || "Next";
    nextBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (page >= pageCount - 1) return;
      page += 1;
      renderPage();
    });
    pager.appendChild(prevBtn);
    pager.appendChild(pagerStatus);
    pager.appendChild(nextBtn);
    wrap.appendChild(pager);

    function syncPager() {
      pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      if (page > pageCount - 1) page = pageCount - 1;
      if (page < 0) page = 0;
      pager.hidden = list.length <= PAGE_SIZE;
    }

    function renderPage() {
      syncPager();
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      var start = page * PAGE_SIZE;
      list.slice(start, start + PAGE_SIZE).forEach(function (item) {
        grid.appendChild(card(item, formatMoney, selected, recommended, onToggle, t));
      });
      pagerStatus.textContent = replaceTokens(t.pageStatus || "{{current}} / {{pages}}", {
        current: String(page + 1),
        pages: String(pageCount),
      });
      prevBtn.disabled = page <= 0;
      nextBtn.disabled = page >= pageCount - 1;
    }

    wrap.setItems = function (nextItems, opts) {
      list = sortRecommendedFirst(nextItems, recommended);
      page = opts && opts.keepPage ? page : 0;
      renderPage();
    };
    wrap.setRecommended = function (nextRecommended, opts) {
      recommended = nextRecommended || {};
      list = sortRecommendedFirst(list, recommended);
      page = opts && opts.keepPage ? page : 0;
      renderPage();
    };
    wrap.getItems = function () {
      return list.slice();
    };

    renderPage();
    return wrap;
  };
})(typeof window !== "undefined" ? window : this);
