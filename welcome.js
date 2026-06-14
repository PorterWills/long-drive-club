/* Long Drive Club — the "You're in" page.
   Reveal-on-scroll and the reserve step. No frameworks, to match the
   front door. */

(function () {
  "use strict";

  /* ---- Reveal on scroll: restrained rise, honours reduced motion ------- */
  var rises = document.querySelectorAll(".ldc-rise");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Numerals: count up once they're in view --------------------------
     Same device as the home page (app.js): an eased count-up triggered when
     the numeral scrolls into view. Handles MM:SS times and an optional
     symbol prefix (e.g. the £ on the price); padding matches the target so
     the width stays steady while it climbs. */
  function animateCount(el) {
    var target = el.getAttribute("data-count");
    var total, fmt;
    if (target.indexOf(":") >= 0) {
      var parts = target.split(":");
      total = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      fmt = function (v) {
        var h = Math.floor(v / 60), m = v % 60;
        return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
      };
    } else {
      var parsed = target.match(/^(\D*)(\d+)(\D*)$/);
      var prefix = parsed ? parsed[1] : "";
      var digits = parsed ? parsed[2] : target;
      var suffix = parsed ? parsed[3] : "";
      total = parseInt(digits, 10);
      var width = digits.length;
      fmt = function (v) { return prefix + String(v).padStart(width, "0") + suffix; };
    }
    var duration = 1100;
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(Math.round(total * eased));
      if (t < 1) requestAnimationFrame(frame);
      else el.textContent = target;
    }
    requestAnimationFrame(frame);
  }

  var numerals = document.querySelectorAll("[data-count]");
  if (numerals.length && !reduced && "IntersectionObserver" in window) {
    var countIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        countIo.unobserve(entry.target);
        animateCount(entry.target);
      });
    }, { threshold: 0.6 });
    numerals.forEach(function (el) { countIo.observe(el); });
  }
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

  /* ---- Where the reservation goes after the T&Cs ------------------------
     Set STRIPE_PAYMENT_URL to the Stripe Payment Link (or Checkout URL)
     when payment is ready. Once it's set, agreeing to the T&Cs sends the
     user straight to Stripe. While it's empty, the card advances to a
     placeholder payment step so the whole journey can be tested end to end
     bar the final hop. */
  var STRIPE_PAYMENT_URL = "";

  /* ---- Reserve flow: agree to T&Cs before the payment step --------------
     The Reserve button opens the T&Cs; agreeing is what kicks off payment. */
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
      // T&Cs agreed: this is the hand-off to payment. When Stripe is wired,
      // go straight there; until then, show the placeholder payment step.
      if (STRIPE_PAYMENT_URL) { window.location.href = STRIPE_PAYMENT_URL; return; }
      document.getElementById("reserve-copy").hidden = true;
      document.getElementById("reserve-action").hidden = true;
      document.getElementById("payment-next").hidden = false;
    });

    modal.querySelectorAll("[data-close]").forEach(function (el) {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
  }

})();
