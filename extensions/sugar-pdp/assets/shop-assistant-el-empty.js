(function (g) {
  "use strict";

  var ns = (g.SugarSa = g.SugarSa || {});
  ns.el = ns.el || {};

  ns.el.empty = function (text) {
    var p = document.createElement("p");
    p.className = "sugar-sa-empty";
    p.textContent = text || "";
    return p;
  };

  ns.el.clearEmpty = function (thread) {
    var empty = thread && thread.querySelector(".sugar-sa-empty");
    if (empty) empty.remove();
  };
})(typeof window !== "undefined" ? window : this);
