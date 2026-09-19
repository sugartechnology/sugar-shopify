(function (g) {
  "use strict";

  var ns = (g.SugarSa = g.SugarSa || {});
  ns.el = ns.el || {};

  ns.el.thinking = function (text) {
    var p = document.createElement("p");
    p.className = "sugar-sa-thinking";
    p.setAttribute("data-thinking", "true");
    p.textContent = text || "";
    return p;
  };

  ns.el.ensureThinking = function (thread, text) {
    if (!thread || thread.querySelector("[data-thinking]")) return;
    thread.appendChild(ns.el.thinking(text));
  };

  ns.el.removeThinking = function (thread) {
    var existing = thread && thread.querySelector("[data-thinking]");
    if (existing) existing.remove();
  };
})(typeof window !== "undefined" ? window : this);
