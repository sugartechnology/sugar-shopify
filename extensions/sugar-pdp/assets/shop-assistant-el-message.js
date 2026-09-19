(function (g) {
  "use strict";

  var ns = (g.SugarSa = g.SugarSa || {});
  ns.el = ns.el || {};

  ns.el.message = function (text, role) {
    var msg = document.createElement("div");
    msg.className = "sugar-sa-msg" + (role === "user" ? " sugar-sa-msg--user" : "");
    msg.textContent = text || "";
    return msg;
  };

  ns.el.streamMessage = function (text) {
    var msg = ns.el.message(text);
    msg.setAttribute("data-sa-stream-text", "true");
    return msg;
  };

  ns.el.appendAssistantText = function (thread, chunk) {
    if (!thread) return null;
    var last = thread.lastElementChild;
    if (last && last.getAttribute("data-sa-stream-text") === "true") {
      last.textContent += chunk || "";
      return last;
    }
    var created = ns.el.streamMessage(chunk || "");
    thread.appendChild(created);
    return created;
  };
})(typeof window !== "undefined" ? window : this);
