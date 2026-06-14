/* Long Drive Club — the "You're in" page.
   Reveal-on-scroll and the reserve step. No frameworks, to match the
   front door. */

(function () {
  "use strict";

  /* ---- Reveal on scroll: restrained rise, honours reduced motion ------- */
  var rises = document.querySelectorAll(".ldc-rise");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !("IntersectionObserver" in window)) {
    rises.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var delay = parseInt(el.getAttribute("data-delay") || "0", 10);
        el.style.transitionDelay = delay ? delay + "ms" : "";
        el.classList.add("in");
        io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -40px 0px", threshold: 0.05 });
    rises.forEach(function (el) { io.observe(el); });
  }

  /* ---- Reserve flow: agree to T&Cs before the payment step -------------- */
  var modal = document.getElementById("terms-modal");
  var reserveBtn = document.getElementById("reserve-btn");
  var agreeCheck = document.getElementById("terms-agree-check");
  var continueBtn = document.getElementById("terms-continue");
  var lastFocus = null;

  function openModal() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    agreeCheck.checked = false;
    continueBtn.disabled = true;
    var body = document.getElementById("terms-modal-body");
    if (body) body.scrollTop = 0;
    // focus the dialog so Escape works and screen readers land inside it
    modal.querySelector(".modal-panel").focus();
  }
  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  if (reserveBtn && modal) {
    reserveBtn.addEventListener("click", openModal);

    agreeCheck.addEventListener("change", function () {
      continueBtn.disabled = !agreeCheck.checked;
    });

    continueBtn.addEventListener("click", function () {
      if (!agreeCheck.checked) return;
      closeModal();
      // Swap the reserve card into its held state.
      document.getElementById("reserve-copy").hidden = true;
      document.getElementById("reserve-action").hidden = true;
      document.getElementById("held-copy").hidden = false;
    });

    modal.querySelectorAll("[data-close]").forEach(function (el) {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
  }

})();
