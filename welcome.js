/* Long Drive Club — the "You're in" page.
   Reveal-on-scroll and the reserve step. No frameworks, to match the
   front door. */

(function () {
  "use strict";

  var APPS_SCRIPT_URL = (window.LDC_CONFIG || {}).APPS_SCRIPT_URL;

  /* ---- Masthead: greet the member by name, name their car -------------
     The gate is the only place a visitor's identity is established (see
     app.js), so it drops name/make/model into sessionStorage on unlock; this
     reads it back and fills the three masthead slots. The sheet holds one
     free-text name field, not separate first/last names, so someone who only
     gave a first name is shown exactly that — never a blank. Every value is
     optional (a missing car, a missing name, or the master password with no
     sheet row at all), so the HTML already carries a sensible fallback for
     each slot; this only overwrites a slot when real data is there. */
  (function personaliseMasthead() {
    var nameEl = document.getElementById("masthead-name");
    var lineEl = document.getElementById("masthead-line");
    var metaEl = document.getElementById("masthead-meta");
    if (!nameEl && !lineEl && !metaEl) return;

    var member = {};
    try { member = JSON.parse(sessionStorage.getItem("ldc-member") || "{}") || {}; }
    catch (e) { member = {}; }

    var name = String(member.name || "").trim();
    if (nameEl && name) nameEl.textContent = name;

    var model = String(member.model || "").trim();
    if (lineEl && model) {
      lineEl.textContent = "The long way round in the " + model + ". A top 100 course at the end";
      var stop = document.createElement("span");
      stop.className = "masthead-stop";
      stop.textContent = ".";
      lineEl.appendChild(stop);
    }

    // The month/places line: the HTML default already reads right, so this
    // corrects one piece at a time and never blanks a piece the sheet didn't
    // answer — e.g. an Apps Script deployment still running the previous
    // version of doGet answers event_date but not places_target, and that
    // must keep the shipped "20 places", not drop it. Same JSONP-with-timeout
    // pattern as members.js's drive-day sync, since Apps Script can't send
    // CORS headers a normal fetch could read.
    if (metaEl && APPS_SCRIPT_URL) {
      var defaults = metaEl.textContent.split(" · ");
      var defaultMonth = defaults[0] || "";
      var defaultPlaces = defaults[1] || "";
      var cb = "__ldcmeta_" + Date.now();
      var script = document.createElement("script");
      var timer = setTimeout(cleanup, 8000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cb] = function (data) {
        cleanup();
        if (!data) return;
        var month = defaultMonth;
        if (data.event_date) {
          var t = Date.parse(data.event_date);
          if (!isNaN(t)) {
            month = new Date(t).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
          }
        }
        var places = data.places_target ? data.places_target + " places" : defaultPlaces;
        metaEl.textContent = [month, places].filter(Boolean).join(" · ");
      };
      script.onerror = cleanup;
      script.src = APPS_SCRIPT_URL + "?meta=1&callback=" + cb;
      document.head.appendChild(script);
    }
  })();

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

  /* ---- Route map: the red line draws itself in ------------------------
     Mirrors the map's static "suggested line" but animates it: casing +
     red line draw on together, a gliding roundel rides the head, and the
     START/FINISH tags fade in as it passes them. Runs once the section
     scrolls into view; reduced motion shows the finished state instantly. */
  (function () {
    var stage = document.getElementById("route-map-stage");
    if (!stage) return;
    var path = document.getElementById("route-path");
    var casing = document.getElementById("route-case");
    var ghost = document.getElementById("route-ghost");
    var marker = document.getElementById("route-marker");
    var startTag = document.getElementById("route-start");
    var finishTag = document.getElementById("route-finish");
    if (!path) return;

    var len = path.getTotalLength();
    var PACE_MS = 8000;
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var raf = null;
    var timers = [];
    var played = false;

    function clearTimers() {
      if (raf) cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      timers = [];
    }

    function setHead(l) {
      var pt = path.getPointAtLength(Math.max(0, Math.min(len, l)));
      marker.setAttribute("transform", "translate(" + pt.x + "," + pt.y + ")");
    }

    function play() {
      clearTimers();
      path.style.strokeDasharray = len;
      casing.style.strokeDasharray = len;

      startTag.classList.remove("is-shown");
      finishTag.classList.remove("is-shown");
      marker.classList.remove("is-shown");

      if (reduceMotion) {
        path.style.strokeDashoffset = 0;
        casing.style.strokeDashoffset = 0;
        setHead(len);
        marker.classList.add("is-shown");
        startTag.classList.add("is-shown");
        finishTag.classList.add("is-shown");
        return;
      }

      path.style.strokeDashoffset = len;
      casing.style.strokeDashoffset = len;
      setHead(0);

      var ease = function (x) { return 1 - Math.pow(1 - x, 2.3); };
      timers.push(setTimeout(function () { startTag.classList.add("is-shown"); }, 400));

      var start = null;
      var delay = 1050;
      function tick(now) {
        if (start === null) start = now + delay;
        var t = (now - start) / PACE_MS;
        if (t < 0) { raf = requestAnimationFrame(tick); return; }
        marker.classList.add("is-shown");
        if (t >= 1) t = 1;
        var e = ease(t);
        var off = len * (1 - e);
        path.style.strokeDashoffset = off;
        casing.style.strokeDashoffset = off;
        setHead(len * e);
        if (t < 1) {
          raf = requestAnimationFrame(tick);
        } else {
          finishTag.classList.add("is-shown");
        }
      }
      raf = requestAnimationFrame(tick);
    }

    if (ghost) ghost.style.display = "";

    if ("IntersectionObserver" in window) {
      var mapIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || played) return;
          played = true;
          mapIo.unobserve(entry.target);
          play();
        });
      }, { threshold: 0.4 });
      mapIo.observe(stage);
    } else {
      play();
    }
  })();

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
