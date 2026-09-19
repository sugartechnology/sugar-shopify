(function (g) {
  "use strict";

  var ns = (g.SugarSa = g.SugarSa || {});

  ns.util = {
    parseConfig: function (root) {
      try {
        return JSON.parse(root.getAttribute("data-sugar-sa-config") || "{}");
      } catch (err) {
        return {};
      }
    },
    escapeHtml: function (value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    },
    formatMoney: function (cents, currency) {
      var amount = (Number(cents) || 0) / 100;
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currency || "TRY",
        }).format(amount);
      } catch (err) {
        return amount.toFixed(2) + " " + (currency || "");
      }
    },
    replaceTokens: function (template, vars) {
      return String(template || "").replace(/\{\{(\w+)\}\}/g, function (_, key) {
        return vars[key] == null ? "" : String(vars[key]);
      });
    },
  };
})(typeof window !== "undefined" ? window : this);
