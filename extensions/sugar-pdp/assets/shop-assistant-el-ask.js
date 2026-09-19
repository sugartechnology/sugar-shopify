(function (g) {
  "use strict";

  var ns = (g.SugarSa = g.SugarSa || {});
  ns.el = ns.el || {};

  function isOtherChoice(option) {
    var id = String((option && option.id) || "")
      .toLowerCase()
      .trim();
    var label = String((option && option.label) || "")
      .toLowerCase()
      .trim();
    return (
      id === "other" ||
      id === "diger" ||
      id === "diğer" ||
      label === "other" ||
      label === "diğer" ||
      label === "diger"
    );
  }

  function lockPanel(wrap) {
    wrap.setAttribute("aria-disabled", "true");
    wrap.querySelectorAll("button, input").forEach(function (node) {
      node.disabled = true;
    });
  }

  function optionRow(option, onPick) {
    var item = document.createElement("li");
    item.className = "sugar-sa-ask__item";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sugar-sa-ask__option";
    var num = document.createElement("span");
    num.className = "sugar-sa-ask__num";
    num.setAttribute("aria-hidden", "true");
    var label = document.createElement("span");
    label.className = "sugar-sa-ask__label";
    label.textContent = option.label || option.id;
    btn.appendChild(num);
    btn.appendChild(label);
    btn.addEventListener("click", function () {
      onPick({
        type: "choice",
        selected: option.id,
        label: option.label,
      });
    });
    item.appendChild(btn);
    return item;
  }

  function otherRow(i18n, onRequestSend) {
    var t = i18n || {};
    var item = document.createElement("li");
    item.className = "sugar-sa-ask__item sugar-sa-ask__item--other";
    var row = document.createElement("div");
    row.className = "sugar-sa-ask__other";
    var num = document.createElement("span");
    num.className = "sugar-sa-ask__num";
    num.setAttribute("aria-hidden", "true");
    var otherId = "sugar-sa-other-" + String(Date.now());
    var label = document.createElement("label");
    label.className = "sugar-sa-ask__other-label";
    label.setAttribute("for", otherId);
    label.textContent = t.other || "Other";
    var input = document.createElement("input");
    input.id = otherId;
    input.className = "sugar-sa-input sugar-sa-ask__other-input";
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = t.otherPlaceholder || "";
    input.setAttribute("data-sugar-sa-other", "true");
    input.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (typeof onRequestSend === "function") onRequestSend();
    });
    row.appendChild(num);
    row.appendChild(label);
    row.appendChild(input);
    item.appendChild(row);
    return item;
  }

  ns.el.lockAsk = function (wrap) {
    if (wrap) lockPanel(wrap);
  };

  ns.el.activeAsk = function (thread) {
    return thread ? thread.querySelector(".sugar-sa-ask:not([aria-disabled='true'])") : null;
  };

  ns.el.askOtherText = function (thread) {
    var ask = ns.el.activeAsk(thread);
    var input = ask && ask.querySelector("[data-sugar-sa-other]");
    return input && input.value ? input.value.trim() : "";
  };

  ns.el.ask = function (event, i18n, onChoice, onRequestSend) {
    var wrap = document.createElement("section");
    wrap.className = "sugar-sa-ask";
    wrap.setAttribute("role", "group");
    var questionText = (event && event.question) || "";
    if (questionText) wrap.setAttribute("aria-label", questionText);

    var question = document.createElement("p");
    question.className = "sugar-sa-ask__q";
    question.textContent = questionText;
    wrap.appendChild(question);

    var list = document.createElement("ol");
    list.className = "sugar-sa-ask__list";
    wrap.appendChild(list);

    function pick(payload) {
      lockPanel(wrap);
      if (typeof onChoice === "function") onChoice(payload);
    }

    ((event && event.options) || []).forEach(function (option) {
      if (isOtherChoice(option)) return;
      list.appendChild(optionRow(option, pick));
    });
    list.appendChild(otherRow(i18n, onRequestSend));
    return wrap;
  };
})(typeof window !== "undefined" ? window : this);
