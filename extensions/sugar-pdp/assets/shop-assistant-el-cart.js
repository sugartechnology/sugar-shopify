(function (g) {
  "use strict";

  var ns = (g.SugarSa = g.SugarSa || {});
  ns.el = ns.el || {};

  function lineCents(line) {
    var qty = Number(line && line.quantity);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    var unit = Number(line && line.priceCents);
    if (!Number.isFinite(unit) || unit < 0) unit = 0;
    return unit * qty;
  }

  ns.el.cartLineCents = lineCents;

  ns.el.selectedCartTotalCents = function (items, selected) {
    return (items || []).reduce(function (sum, line) {
      var id = String(line.variantId || "");
      if (!selected || !selected[id]) return sum;
      return sum + lineCents(line);
    }, 0);
  };

  ns.el.selectedCartItems = function (items, selected) {
    return (items || []).filter(function (line) {
      var id = String(line.variantId || "");
      return !!(selected && selected[id]);
    });
  };

  function infoBlock(line, t, formatMoney) {
    var details = document.createElement("dl");
    details.className = "sugar-sa-cart-line__info";
    function row(term, value) {
      var dt = document.createElement("dt");
      dt.textContent = term;
      var dd = document.createElement("dd");
      dd.textContent = value;
      details.appendChild(dt);
      details.appendChild(dd);
    }
    row(t.cartInfoTitle || "Product", line.title || "");
    if (line.handle) row(t.cartInfoHandle || "Handle", line.handle);
    row(t.cartInfoQty || "Qty", String(line.quantity || 1));
    row(t.cartInfoPrice || "Price", formatMoney(line.priceCents, line.currency));
    row(t.cartInfoLine || "Line", formatMoney(lineCents(line), line.currency));
    return details;
  }

  function paintTotals(nodes, event, t, selected) {
    var util = ns.util || {};
    var formatMoney = util.formatMoney || String;
    var replaceTokens = util.replaceTokens || String;
    var items = (event && event.items) || [];
    var totalCents = ns.el.selectedCartTotalCents(items, selected);
    var currency = (event && event.currency) || (items[0] && items[0].currency) || "TRY";
    if (nodes.total) {
      nodes.total.textContent = replaceTokens(t("cartTotal"), {
        amount: formatMoney(totalCents, currency),
      });
    }
    if (nodes.budget) {
      var budget = Number(event && event.budget) || 0;
      if (budget > 0) {
        nodes.budget.hidden = false;
        nodes.budget.textContent = replaceTokens(t("cartBudget"), {
          amount: formatMoney(budget, currency),
          remaining: formatMoney(Math.max(0, budget - totalCents), currency),
        });
      } else {
        nodes.budget.hidden = true;
        nodes.budget.textContent = "";
      }
    }
    if (nodes.add) nodes.add.disabled = totalCents <= 0;
    return totalCents;
  }

  function lineRow(line, selected, t, formatMoney, onChange) {
    var id = String(line.variantId || "");
    var checked = !!(selected && selected[id]);
    var item = document.createElement("article");
    item.className = "sugar-sa-cart-line" + (checked ? " is-selected" : "");
    item.setAttribute("data-variant-id", id);

    var label = document.createElement("label");
    label.className = "sugar-sa-cart-line__pick";
    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = checked;
    box.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    box.addEventListener("change", function () {
      item.classList.toggle("is-selected", box.checked);
      onChange(id, box.checked);
    });
    var img = document.createElement("img");
    img.alt = "";
    img.src = line.imageUrl || "";
    var body = document.createElement("div");
    body.className = "sugar-sa-cart-line__body";
    var title = document.createElement("p");
    title.className = "sugar-sa-cart-line__title";
    title.textContent = line.title || "";
    var meta = document.createElement("p");
    meta.className = "sugar-sa-cart-line__meta";
    meta.textContent =
      formatMoney(line.priceCents, line.currency) +
      " · " +
      (t.cartQty || "× {{qty}}").replace("{{qty}}", String(line.quantity || 1));
    body.appendChild(title);
    body.appendChild(meta);
    label.appendChild(box);
    label.appendChild(img);
    label.appendChild(body);

    var infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.className = "sugar-sa-cart-line__info-btn";
    infoBtn.setAttribute("aria-expanded", "false");
    infoBtn.textContent = t.cartInfo || "Info";
    var details = infoBlock(line, t, formatMoney);
    details.hidden = true;
    infoBtn.addEventListener("click", function () {
      var open = details.hidden;
      details.hidden = !open;
      infoBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    item.appendChild(label);
    item.appendChild(infoBtn);
    item.appendChild(details);
    return item;
  }

  function nodesOf(body) {
    return body && body.__sugarSaCartNodes;
  }

  function render(body, ctx) {
    var nodes = nodesOf(body);
    if (!nodes) return;
    body.__sugarSaCartCtx = ctx;
    var util = ns.util || {};
    var formatMoney = util.formatMoney || String;
    var event = (ctx && ctx.event) || {};
    var selected = (ctx && ctx.selected) || {};
    var t = ctx && ctx.t ? ctx.t : function (key) { return key; };
    var items = event.items || [];
    nodes.list.innerHTML = "";
    var labels = {
      cartQty: t("cartQty"),
      cartInfo: t("cartInfo"),
      cartInfoTitle: t("cartInfoTitle"),
      cartInfoHandle: t("cartInfoHandle"),
      cartInfoQty: t("cartInfoQty"),
      cartInfoPrice: t("cartInfoPrice"),
      cartInfoLine: t("cartInfoLine"),
    };
    items.forEach(function (line) {
      nodes.list.appendChild(
        lineRow(line, selected, labels, formatMoney, function (id, checked) {
          if (ctx && typeof ctx.onToggle === "function") ctx.onToggle(id, checked);
        }),
      );
    });
    if (nodes.add) {
      nodes.add.textContent = (ctx && ctx.addCartLabel) || t("cartHeading");
    }
    paintTotals(nodes, event, t, selected);
  }

  function mount(body, ctx) {
    body.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "sugar-sa-cart";
    var list = document.createElement("div");
    list.className = "sugar-sa-cart__list";
    var meta = document.createElement("div");
    meta.className = "sugar-sa-cart__meta";
    var total = document.createElement("span");
    var budget = document.createElement("span");
    meta.appendChild(total);
    meta.appendChild(budget);
    var add = document.createElement("button");
    add.type = "button";
    add.className = "sugar-sa-primary";
    add.addEventListener("click", function () {
      var latest = body.__sugarSaCartCtx;
      if (latest && typeof latest.onAddCart === "function") latest.onAddCart();
    });
    wrap.appendChild(list);
    wrap.appendChild(meta);
    wrap.appendChild(add);
    body.appendChild(wrap);
    body.__sugarSaCartNodes = { bar: wrap, list: list, total: total, budget: budget, add: add };
    render(body, ctx);
  }

  if (ns.workspace && typeof ns.workspace.register === "function") {
    ns.workspace.register({
      id: "cart",
      titleKey: "cartHeading",
      mount: mount,
      update: render,
      unmount: function (body) {
        if (body) {
          body.__sugarSaCartNodes = null;
          body.innerHTML = "";
        }
      },
    });
  }
})(typeof window !== "undefined" ? window : this);
