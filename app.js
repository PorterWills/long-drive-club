/* Long Drive Club — front-door behaviour.
   Reveal-on-scroll, the entry sheet, the gate. No frameworks. */

(function () {
  "use strict";

  /* ---- Configuration ---------------------------------------------------
     APPS_SCRIPT_URL: the deployed Google Apps Script web app. It saves each
     application to a Google Sheet and sends the confirmation email. Apps
     Script web apps don't return CORS headers, so submissions are posted
     with mode: "no-cors" and a plain-text body (see postLead).
     GATE_HASH: SHA-256 of a developer/master password that always unlocks
     the gate, for testing. Real applicant passwords are unique per person
     and checked against the Google Sheet via the Apps Script (see the gate
     section below). To change the master password run:
       echo -n "newpassword" | shasum -a 256                               */
  var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzOFXxYWecTLBcC6T_z8KdnzHUsAT5NBAekuQnFqGrqPJpuO9C1YXih_xe43yfCMkYMDg/exec";
  var GATE_HASH = "bcfc22e504b7530e149411dfc252af18e5c000c3afd95690f23397aceaef62a4";

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

  /* ---- Hero carousel: cross-dissolve, ~6s hold, slow Ken Burns ----------
     Ten images, ordered dawn -> dusk so each blend is between near tones.
     First frame is in the HTML for instant paint; the rest load just after.
     Honours reduced motion (single still frame, no cycling, no zoom). */
  (function () {
    var stage = document.getElementById("hero-photo");
    if (!stage) return;
    var IMAGES = [
      "assets/hero-01.jpg", "assets/hero-04.jpg", "assets/hero-06.jpg", "assets/hero-07.jpg", "assets/hero-10.jpg"
    ];
    var POS = "50% 68%";          // shared focal point; tune per-image if needed
    var HOLD = 6000, FADE = 1200; // ms

    var first = stage.querySelector(".hero-slide");
    if (!first) return;
    first.style.objectPosition = POS;
    first.addEventListener("error", function () { this.dataset.broken = "1"; this.style.opacity = "0"; });
    var slides = [first];

    // Build the remaining slides; defer their loading so the first paints fast.
    for (var i = 1; i < IMAGES.length; i++) {
      var img = document.createElement("img");
      img.className = "hero-slide";
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.style.objectPosition = POS;
      img.dataset.src = IMAGES[i];
      img.addEventListener("error", function () { this.dataset.broken = "1"; this.style.opacity = "0"; });
      stage.appendChild(img);
      slides.push(img);
    }

    function ensure(s) { if (s.dataset.src) { s.src = s.dataset.src; delete s.dataset.src; } }

    if (reduced || slides.length < 2) return; // static first frame only

    function hydrate() { for (var j = 1; j < slides.length; j++) ensure(slides[j]); }
    if (document.readyState === "complete") setTimeout(hydrate, 300);
    else window.addEventListener("load", function () { setTimeout(hydrate, 300); });

    var idx = 0;
    setInterval(function () {
      var tries = 0, next = idx;
      do { next = (next + 1) % slides.length; tries++; }
      while (slides[next].dataset.broken && tries <= slides.length);
      if (next === idx) return;
      ensure(slides[next]);
      slides[next].classList.add("is-active");
      slides[idx].classList.remove("is-active");
      idx = next;
    }, HOLD + FADE);
  })();

  /* ---- First-drive stats: count up once they're in view ----------------- */
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
      total = parseInt(target, 10);
      var width = target.length;
      fmt = function (v) { return String(v).padStart(width, "0"); };
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

  var statGrid = document.querySelector(".stat-grid");
  if (statGrid && !reduced && "IntersectionObserver" in window) {
    var statIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        statIo.unobserve(entry.target);
        entry.target.querySelectorAll("[data-count]").forEach(animateCount);
      });
    }, { threshold: 0.4 });
    statIo.observe(statGrid);
  }

  /* ---- Handicap slider (field 06) --------------------------------------
     Below 0 = "<0" (better than scratch); 0.0 to 36.0 in 0.1 steps.
     Stored as a readable string: "<0", "0.0", "18.3", "36.0". */
  function formatHandicap(v) {
    return v < 0 ? "<0" : v.toFixed(1);
  }
  /* The yardage disc: a custom role="slider" handle. The LDC roundel is the
     thumb and reads the value back; drag to scratch (0) flips it to redline. */
  (function () {
    var lane = document.getElementById("hcp-lane");
    var fill = document.getElementById("hcp-fill");
    var discWrap = document.getElementById("hcp-disc-wrap");
    var discContent = document.getElementById("hcp-disc-content");
    var hidden = document.getElementById("f-handicap");
    var ticks = document.getElementById("hcp-ticks");
    if (!lane || !fill || !discWrap || !discContent || !hidden) return;

    var MIN = 0, MAX = 36, STEP = 0.1;
    var MAJORS = [0, 9, 18, 27, 36];
    var MINORS = [3, 6, 12, 15, 21, 24, 30, 33];
    var value = parseFloat(hidden.value);
    if (!isFinite(value)) value = 18;

    function clamp(v) { return Math.min(MAX, Math.max(MIN, v)); }
    function snap(v) { return clamp(Math.round(v / STEP) * STEP); }
    function posPct(v) { return (v - MIN) / (MAX - MIN) * 100; }

    /* Tachometer ticks: minor hairlines plus numbered majors. */
    if (ticks && !ticks.childNodes.length) {
      MINORS.forEach(function (m) {
        var t = document.createElement("span");
        t.className = "hcp-tick-minor";
        t.style.left = posPct(m) + "%";
        ticks.appendChild(t);
      });
      MAJORS.forEach(function (m) {
        var col = document.createElement("div");
        col.className = "hcp-tick-major" + (m === MIN ? " is-scratch" : "");
        col.style.left = posPct(m) + "%";
        col.innerHTML = '<span class="hcp-tick-mark"></span>' +
          '<span class="hcp-tick-num ldc-numeral">' + m + "</span>";
        ticks.appendChild(col);
      });
    }

    function render() {
      var pct = posPct(value);
      var scratch = value <= MIN;
      fill.style.width = pct + "%";
      discWrap.style.left = pct + "%";
      lane.classList.toggle("is-scratch", scratch);
      if (scratch) {
        discContent.innerHTML = '<span class="hcp-scratch-tri" aria-hidden="true"></span>' +
          '<span class="hcp-scratch-zero">0</span>';
      } else {
        discContent.textContent = value.toFixed(1);
      }
      lane.setAttribute("aria-valuenow", value);
      lane.setAttribute("aria-valuetext", scratch ? "Scratch or better" : value.toFixed(1) + " handicap");
      hidden.value = value.toFixed(1);
    }

    function setFromX(clientX) {
      var r = lane.getBoundingClientRect();
      var t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      value = snap(MIN + t * (MAX - MIN));
      render();
    }

    lane.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      // Pointer interaction focuses the lane via script; suppress the keyboard
      // focus ring so a mouse click doesn't draw a box around the control.
      lane.classList.add("hcp-no-ring");
      lane.focus();
      setFromX(e.clientX);
      function move(ev) { setFromX(ev.clientX); }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });

    lane.addEventListener("keydown", function (e) {
      // Genuine keyboard use: restore the focus ring.
      lane.classList.remove("hcp-no-ring");
      var v = value;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") v += e.shiftKey ? 1 : STEP;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") v -= e.shiftKey ? 1 : STEP;
      else if (e.key === "Home") v = MIN;
      else if (e.key === "End") v = MAX;
      else if (e.key === "PageUp") v += 5;
      else if (e.key === "PageDown") v -= 5;
      else return;
      e.preventDefault();
      value = snap(v);
      render();
    });

    // Clear the modality flag on blur so a later Tab back shows the ring.
    lane.addEventListener("blur", function () { lane.classList.remove("hcp-no-ring"); });

    render();
  })();

  /* ---- The entry sheet: a two-step flow --------------------------------
     Four states in sequence — step1, bridge, step2, confirmation. Step one
     saves the lead on its own submit (see saveStep1 / the backend's "step1"
     stage), so a drop-off at the bridge or step two is still a contactable,
     recoverable lead. Step two merges into that same record, keyed on email.

     CAR_ECHO: the optional silent confirmation at the top of step two that
     echoes the make from step one ("The Porsche it is."). Behind a flag so it
     can be switched off without touching the flow; ?echo=0 overrides it off. */
  var CAR_ECHO = true;
  if (/[?&]echo=0\b/.test(window.location.search)) CAR_ECHO = false;

  // Shared by the car picker (below) and the recovery prefill: lets recovered
  // make/model land in the two linked selects once they've been built.
  var carCtl = { prefill: null, apply: null };

  var step1Form = document.getElementById("step1-form");
  var step2Form = document.getElementById("step2-form");
  var step1Error = document.getElementById("step1-error");
  var step2Error = document.getElementById("step2-error");
  var step1Submit = document.getElementById("step1-submit");
  var step2Submit = document.getElementById("step2-submit");
  var liveRegion = document.getElementById("flow-live");
  var applySection = document.getElementById("apply");

  /* ---- Flow state machine ----------------------------------------------
     One state visible at a time. Transitions move focus to the new heading
     and push a short line into the polite live region so the bridge and
     confirmation are announced to screen readers, not silently swapped. */
  var FLOW_HEADS = {
    step1: "step1-head", bridge: "bridge-head",
    step2: "step2-head", confirmation: "confirm-head"
  };
  function showState(id, opts) {
    opts = opts || {};
    Object.keys(FLOW_HEADS).forEach(function (s) {
      var el = document.getElementById(s);
      if (el) el.hidden = (s !== id);
    });
    if (opts.scroll && applySection) {
      window.scrollTo({ top: applySection.offsetTop - 40, behavior: "smooth" });
    }
    if (opts.announce && liveRegion) liveRegion.textContent = opts.announce;
    if (opts.focus) {
      var head = document.getElementById(FLOW_HEADS[id]);
      if (head) { try { head.focus({ preventScroll: true }); } catch (e) { head.focus(); } }
    }
  }

  /* ---- Meta Pixel funnel events ----------------------------------------
     Silent, browser-only signals that map the steps toward applying so the
     drop-off is visible in Events Manager. No personal data is sent, and
     each step fires at most once per page load. Guarded on window.fbq so
     nothing breaks if the pixel is blocked.
       ViewContent      -> visitor scrolled far enough to see step one
       InitiateCheckout -> visitor started filling step one (first field touch)
       Lead             -> step one submitted: a real, recoverable lead exists
       CompleteRegistration -> step two merged in, the full sheet is done */
  function trackPixel(name) {
    if (typeof window.fbq === "function") window.fbq("track", name);
  }
  (function () {
    var sheet = document.getElementById("step1");
    // Step: saw the form. Fire once when step one enters the viewport.
    if (sheet && "IntersectionObserver" in window) {
      var seen = false;
      var vio = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || seen) return;
          seen = true;
          trackPixel("ViewContent");
          vio.disconnect();
        });
      }, { threshold: 0.3 });
      vio.observe(sheet);
    } else if (sheet) {
      trackPixel("ViewContent");
    }
    // Step: started the form. Fire once on the first real interaction with
    // any field inside step one.
    if (step1Form) {
      var started = false;
      step1Form.addEventListener("focusin", function () {
        if (started) return;
        started = true;
        trackPixel("InitiateCheckout");
      });
    }
  })();

  // Errors live anywhere inside #apply; the message goes in the .fe-txt span
  // so the paired icon (drawn in CSS) stays put — colour is never the only cue.
  function setFieldError(name, message) {
    var el = applySection.querySelector('[data-error-for="' + name + '"]');
    if (!el) return;
    var txt = el.querySelector(".fe-txt");
    if (txt) txt.textContent = message || ""; else el.textContent = message || "";
    el.classList.toggle("show", !!message);
    var hint = applySection.querySelector('[data-hint-for="' + name + '"]');
    if (hint) hint.style.display = message ? "none" : "";
  }

  function emailOk(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }

  /* ---- Car make/model picker (field 03) --------------------------------
     Two linked selects. Make populates from the local car-makes-models.json
     (read once, no live API at runtime); choosing a make fills and enables
     the model select. carCtl.apply lets a recovered lead drop its make/model
     back in once the list has built (see the recovery deep-link below). */
  (function () {
    var makeSel = document.getElementById("f-make");
    var modelSel = document.getElementById("f-model");
    if (!makeSel || !modelSel) return;

    function option(value, label) {
      var o = document.createElement("option");
      o.value = value;
      o.textContent = label === undefined ? value : label;
      return o;
    }

    fetch("car-makes-models.json?v=3")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var makes = data.makes || data; // tolerate old flat shape
        var popular = data.popular || [];

        function group(label, names) {
          var g = document.createElement("optgroup");
          g.label = label;
          names.forEach(function (m) { g.appendChild(option(m)); });
          return g;
        }
        if (popular.length) makeSel.appendChild(group("Popular makes", popular));
        makeSel.appendChild(group("All makes", Object.keys(makes)));

        function fillModels(make) {
          modelSel.innerHTML = "";
          modelSel.appendChild(option("", "Model"));
          var models = makes[make] || [];
          if (models.length) {
            models.forEach(function (m) { modelSel.appendChild(option(m)); });
            modelSel.disabled = false;
          } else {
            modelSel.disabled = true;
          }
        }

        makeSel.addEventListener("change", function () { fillModels(makeSel.value); });

        // Reinstate a recovered make/model in the linked selects.
        carCtl.apply = function (make, model) {
          if (!make) return;
          makeSel.value = make;
          fillModels(make);
          if (model && !modelSel.disabled) {
            var has = Array.prototype.some.call(modelSel.options, function (o) { return o.value === model; });
            if (!has) modelSel.appendChild(option(model));
            modelSel.value = model;
          }
        };
        if (carCtl.prefill) carCtl.apply(carCtl.prefill.make, carCtl.prefill.model);
      })
      .catch(function () {
        // If the list can't load, fall back to a typed make so the field
        // still works rather than leaving a dead dropdown.
        makeSel.innerHTML = "";
        var input = document.createElement("input");
        input.type = "text";
        input.id = "f-make";
        input.name = "make";
        input.placeholder = "Make and model";
        makeSel.replaceWith(input);
        modelSel.closest(".select-wrap").style.display = "none";
        // Recovery prefill into the typed fallback: make and model, joined.
        carCtl.apply = function (make, model) {
          input.value = [make, model].filter(Boolean).join(" ");
        };
        if (carCtl.prefill) carCtl.apply(carCtl.prefill.make, carCtl.prefill.model);
      });
  })();

  /* ---- "Where you're based": progressive region / overseas picker --------
     UK applicants pick a region; "Outside the UK" reveals a country select
     and an optional city. No postal address is ever collected. */
  (function () {
    var base = document.getElementById("f-base");
    var overseas = document.getElementById("base-overseas");
    var country = document.getElementById("f-country");
    var city = document.getElementById("f-city");
    if (!base || !overseas || !country) return;
    var COUNTRIES = [
      "Ireland", "France", "Germany", "Switzerland", "Monaco", "Italy", "Spain", "Portugal",
      "Netherlands", "Belgium", "Luxembourg", "Austria", "Denmark", "Sweden", "Norway", "Finland",
      "Iceland", "Poland", "Czech Republic", "Slovakia", "Hungary", "Greece", "Cyprus", "Malta",
      "Croatia", "Slovenia", "Romania", "Bulgaria", "Estonia", "Latvia", "Lithuania",
      "United States", "Canada", "Mexico", "Brazil", "Argentina", "Chile",
      "United Arab Emirates", "Qatar", "Saudi Arabia", "Bahrain", "Kuwait", "Oman", "Israel", "Turkey",
      "South Africa", "Kenya", "Nigeria", "Egypt", "Morocco",
      "Australia", "New Zealand", "Singapore", "Hong Kong", "Japan", "South Korea", "China",
      "India", "Thailand", "Malaysia", "Indonesia", "Philippines", "Vietnam",
      "Other"
    ];
    COUNTRIES.forEach(function (c) {
      var o = document.createElement("option");
      o.textContent = c;
      country.appendChild(o);
    });
    base.addEventListener("change", function () {
      var isOverseas = base.value === "Outside the UK";
      overseas.hidden = !isOverseas;
      if (!isOverseas) { country.value = ""; if (city) city.value = ""; }
    });
  })();

  // Resolve the base/city the form should record from the three controls.
  function resolveBase(form) {
    var sel = form.elements.base ? form.elements.base.value : "";
    if (sel === "Outside the UK") {
      var c = form.elements.country ? form.elements.country.value : "";
      return { base: c || "Outside the UK", city: (form.elements.city ? form.elements.city.value : "").trim() };
    }
    return { base: sel, city: "" };
  }

  // Permissive phone check: international formats welcome. We only insist on
  // enough digits to be a real number and no out-of-place characters.
  function phoneOk(v) {
    var s = String(v || "").trim();
    if (!/^[+0-9 ()\-.]+$/.test(s)) return false;
    return (s.match(/[0-9]/g) || []).length >= 7;
  }

  /* ---- The lead, kept on the device between steps -----------------------
     Step one's record lives in the database; here we keep only what step two
     needs to key the merge (email) and to recover gracefully (token), plus
     the make for the car echo. Stored in sessionStorage so a refresh of the
     bridge or step two doesn't lose the thread. */
  function storeLead(o) {
    try { sessionStorage.setItem("ldc-lead", JSON.stringify(o || {})); } catch (e) {}
  }
  function readLead() {
    try { return JSON.parse(sessionStorage.getItem("ldc-lead") || "null") || {}; } catch (e) { return {}; }
  }

  /* ---- Step one — you and the car --------------------------------------- */

  function collectStep1() {
    var make = step1Form.elements.make ? step1Form.elements.make.value : "";
    var model = step1Form.elements.model ? step1Form.elements.model.value : "";
    return {
      name: step1Form.elements.name.value,
      email: step1Form.elements.email.value,
      make: make,
      model: model,
      car: [make, model].filter(Boolean).join(" ")
    };
  }

  // Field 03 is satisfied by a make plus, when the model select offers any,
  // a model. Makes with no model list (or the typed fallback) need the make
  // alone.
  function validateCar() {
    var make = step1Form.elements.make ? step1Form.elements.make.value.trim() : "";
    if (!make) { setFieldError("car", "We'll need the car for the sheet."); return false; }
    var modelEl = document.getElementById("f-model");
    if (modelEl && modelEl.tagName === "SELECT" && !modelEl.disabled && !modelEl.value.trim()) {
      setFieldError("car", "And the model."); return false;
    }
    setFieldError("car");
    return true;
  }

  function validateField(name) {
    if (name === "name") {
      var nv = step1Form.elements.name.value;
      if (!nv.trim()) { setFieldError("name", "We'll need a name for the sheet."); return false; }
      setFieldError("name"); return true;
    }
    if (name === "email") {
      var ev = step1Form.elements.email.value;
      if (!ev.trim()) { setFieldError("email", "We'll need somewhere to write back."); return false; }
      if (!emailOk(ev)) { setFieldError("email", "That email doesn't look right."); return false; }
      setFieldError("email"); return true;
    }
    if (name === "car") return validateCar();
    return true;
  }

  // Phone moved to step two (keeping step one as light as possible), but stays
  // required — the committee reads it on every completed application.
  function validatePhone() {
    var el = step2Form.elements.phone;
    var pv = el ? el.value : "";
    if (!pv.trim()) { setFieldError("phone", "A number, in case the day moves."); return false; }
    if (!phoneOk(pv)) { setFieldError("phone", "That number doesn't look right."); return false; }
    setFieldError("phone"); return true;
  }

  // Inline validation on blur, not only on submit. Only nags a field the
  // visitor has already left, and only once it's in an error state.
  ["name", "email"].forEach(function (n) {
    var el = step1Form.elements[n];
    if (el) el.addEventListener("blur", function () { validateField(n); });
  });
  if (step2Form.elements.phone) {
    step2Form.elements.phone.addEventListener("blur", validatePhone);
  }
  // Re-check the car only to clear a standing error as the selection completes
  // — never to raise the "and the model" nag mid-pick. Submit does the asserting.
  step1Form.addEventListener("change", function (e) {
    if (!e.target || (e.target.id !== "f-make" && e.target.id !== "f-model")) return;
    var errEl = applySection.querySelector('[data-error-for="car"]');
    if (errEl && errEl.classList.contains("show")) validateCar();
  });

  step1Form.addEventListener("submit", function (e) {
    e.preventDefault();
    var ok = ["name", "email", "car"]
      .map(function (n) { return validateField(n); })
      .every(Boolean);
    if (!ok) return;

    var f = collectStep1();
    step1Error.classList.remove("show");
    step1Submit.disabled = true;
    step1Submit.setAttribute("aria-busy", "true");

    saveStep1(f).then(function () {
      // The lead now exists server-side at step1_complete: a real, recoverable
      // conversion. "Lead" is Meta's standard event for an interest form sent.
      // No personal data is passed (name and email stay out of Meta).
      trackPixel("Lead");
      storeLead({ email: f.email.trim(), name: f.name, make: f.make, model: f.model, car: f.car });
      step1Submit.disabled = false;
      step1Submit.removeAttribute("aria-busy");
      showState("bridge", {
        focus: true, scroll: true,
        announce: "Your name's down. We've got enough to write back."
      });
    }).catch(function () {
      step1Submit.disabled = false;
      step1Submit.removeAttribute("aria-busy");
      step1Error.textContent = "That didn't send. Give it another go.";
      step1Error.classList.add("show");
    });
  });

  /* ---- Bridge — both paths complete step one ---------------------------- */

  var bridgeContinue = document.getElementById("bridge-continue");
  var bridgeLater = document.getElementById("bridge-later");
  var bridgeActions = bridgeContinue ? bridgeContinue.parentNode : null;

  if (bridgeContinue) bridgeContinue.addEventListener("click", function () {
    setCarEcho();
    showState("step2", {
      focus: true, scroll: true,
      announce: "Step 2 of 2. The rest of the sheet."
    });
  });

  // The quiet alternative. The lead is already step1_complete; leaving it there
  // is what schedules the recovery email (the backend sweeps any lead that
  // sits at step1_complete past the delay). No further field, no cancel.
  if (bridgeLater) bridgeLater.addEventListener("click", function () {
    if (bridgeActions) bridgeActions.hidden = true;
    showState("bridge", {
      focus: true,
      announce: "Your name's down. We've got enough to write back. We'll write either way."
    });
  });

  /* ---- Step two — the golf and the day ---------------------------------- */

  var step2Back = document.getElementById("step2-back");
  if (step2Back) step2Back.addEventListener("click", function () {
    // Back to the bridge without wiping anything entered on step two.
    if (bridgeActions) bridgeActions.hidden = false;
    showState("bridge", {
      focus: true, scroll: true,
      announce: "Your name's down. We've got enough to write back."
    });
  });

  // Optional silent confirmation: "The Porsche it is." Only when the make is a
  // single clean token; anything awkward (multi-word makes, hyphens) is omitted.
  function setCarEcho() {
    var echo = document.getElementById("car-echo");
    if (!echo) return;
    echo.hidden = true;
    echo.textContent = "";
    if (!CAR_ECHO) return;
    var make = (readLead().make || "").trim();
    if (!make || !/^[A-Za-z0-9]+$/.test(make)) return;
    echo.textContent = "The " + make + " it is.";
    echo.hidden = false;
  }

  function collectStep2() {
    var loc = resolveBase(step2Form);
    return {
      phone: step2Form.elements.phone.value,
      work: step2Form.elements.work.value,
      handicap: formatHandicap(parseFloat(step2Form.elements.handicap_value.value)),
      base: loc.base,
      baseCity: loc.city,
      play: step2Form.elements.play.value,
      party: step2Form.elements.party.value,
      days: step2Form.elements.days.value,
      consent: step2Form.elements.consent.checked
    };
  }

  step2Form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validatePhone()) return;
    var f = collectStep2();
    var lead = readLead();

    step2Error.classList.remove("show");
    step2Submit.disabled = true;
    step2Submit.setAttribute("aria-busy", "true");

    saveStep2(f, lead).then(function () {
      // The full sheet is in. "CompleteRegistration" marks the completed flow,
      // distinct from the step-one "Lead". No personal data is passed.
      trackPixel("CompleteRegistration");
      try { sessionStorage.removeItem("ldc-lead"); } catch (err) {}
      showState("confirmation", {
        focus: true, scroll: true,
        announce: "It's with the committee. We read every sheet."
      });
    }).catch(function () {
      step2Submit.disabled = false;
      step2Submit.removeAttribute("aria-busy");
      step2Error.textContent = "That didn't send. Give it another go.";
      step2Error.classList.add("show");
    });
  });

  /* ---- Persistence ------------------------------------------------------
     Two posts to the Google Apps Script web app. Step one creates (or updates)
     the lead at status step1_complete before step two renders; step two merges
     into the same record, keyed on email, and marks it complete. Apps Script
     returns no CORS headers, so we post with mode: "no-cors" and a plain-text
     content type — anything else triggers a preflight it can't answer. The
     response is opaque, so a resolved fetch is treated as success. */
  function postLead(payload) {
    return fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
  }

  function saveStep1(f) {
    return postLead({
      stage: "step1",
      name: f.name.trim(),
      email: f.email.trim(),
      make: f.make,
      model: f.model,
      car: f.car.trim()
    });
  }

  function saveStep2(f, lead) {
    return postLead({
      stage: "step2",
      email: (lead.email || "").trim(),
      token: lead.token || "",
      phone: f.phone.trim(),
      work: f.work.trim(),
      handicap: f.handicap,
      base: f.base,
      baseCity: f.baseCity,
      play: f.play,
      party: f.party,
      days: f.days,
      consent: f.consent
    });
  }

  /* ---- Recovery deep-link -----------------------------------------------
     The recovery email links back to /?recover=TOKEN. We ask the backend for
     the step-one data behind that token (JSONP, the same CORS-free trick the
     gate uses), prefill it, and drop the visitor straight into step two with
     no re-entry of name or email. */
  function recoverLead(token) {
    return new Promise(function (resolve) {
      var cb = "ldcRecover" + Date.now() + Math.floor(Math.random() * 1000);
      var script = document.createElement("script");
      var timer = setTimeout(function () { cleanup(); resolve(null); }, 8000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[cb]; } catch (err) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cb] = function (data) { cleanup(); resolve(data && data.ok ? data : null); };
      script.onerror = function () { cleanup(); resolve(null); };
      script.src = APPS_SCRIPT_URL + "?recover=" + encodeURIComponent(token) + "&callback=" + cb;
      document.head.appendChild(script);
    });
  }

  (function () {
    var params = new URLSearchParams(window.location.search);
    var token = params.get("recover");
    if (!token) return;
    recoverLead(token).then(function (lead) {
      if (!lead) return; // token unknown or offline: leave them on step one
      if (step1Form.elements.name) step1Form.elements.name.value = lead.name || "";
      if (step1Form.elements.email) step1Form.elements.email.value = lead.email || "";
      // Phone lives in step two now; prefill it there if the lead already has one.
      if (step2Form.elements.phone) step2Form.elements.phone.value = lead.phone || "";
      // Make/model land in the linked selects once they're built.
      carCtl.prefill = { make: lead.make || "", model: lead.model || "" };
      if (carCtl.apply) carCtl.apply(lead.make || "", lead.model || "");
      storeLead({
        email: (lead.email || "").trim(), token: token,
        name: lead.name, make: lead.make, model: lead.model, car: lead.car
      });
      setCarEcho();
      showState("step2", {
        focus: true, scroll: true,
        announce: "Step 2 of 2. The rest of the sheet."
      });
    });
  })();

  /* ---- The gate ---------------------------------------------------------- */
  var lock = document.getElementById("gate-lock");
  var pwInput = document.getElementById("f-pw");
  var pwError = document.getElementById("pw-error");

  /* ---- Gate masking without a password field ----------------------------
     Safari (macOS + iOS) pops its "save password" prompt for anything it
     reads as a password field — that now includes both <input type=password>
     and a text field masked with -webkit-text-security. The gate is a single
     shared code with no username, so the prompt is pointless and confusing.
     So we keep the field an ordinary text input whose *real value is bullet
     characters*, and hold the actual code in JS. Safari sees plain text and
     never offers to save. getGateValue() returns the real code for unlock. */
  var gateValue = "";
  var jsMasking = false;
  var BULLET = "•";

  function renderGate(caret) {
    pwInput.value = new Array(gateValue.length + 1).join(BULLET);
    if (caret != null) { try { pwInput.setSelectionRange(caret, caret); } catch (e) {} }
  }
  function getGateValue() { return jsMasking ? gateValue : (pwInput ? pwInput.value : ""); }
  function gateSelection() {
    var s = pwInput.selectionStart, en = pwInput.selectionEnd;
    if (s == null) { s = en = gateValue.length; }
    return { s: s, en: en };
  }

  if (pwInput && "onbeforeinput" in pwInput) {
    jsMasking = true;
    pwInput.setAttribute("type", "text");

    pwInput.addEventListener("beforeinput", function (e) {
      var t = e.inputType || "";
      var sel = gateSelection(), caret;
      if (t === "insertFromPaste" || t === "insertFromDrop") {
        // Handled by the paste listener below; block the native insert so it
        // can't double-apply.
        e.preventDefault();
        return;
      }
      if (t.indexOf("insert") === 0) {
        var data = e.data;
        if (data == null && e.dataTransfer) data = e.dataTransfer.getData("text");
        data = data || "";
        gateValue = gateValue.slice(0, sel.s) + data + gateValue.slice(sel.en);
        caret = sel.s + data.length;
      } else if (t === "deleteContentBackward") {
        if (sel.s === sel.en && sel.s > 0) { gateValue = gateValue.slice(0, sel.s - 1) + gateValue.slice(sel.en); caret = sel.s - 1; }
        else { gateValue = gateValue.slice(0, sel.s) + gateValue.slice(sel.en); caret = sel.s; }
      } else if (t === "deleteContentForward") {
        if (sel.s === sel.en) { gateValue = gateValue.slice(0, sel.s) + gateValue.slice(sel.en + 1); caret = sel.s; }
        else { gateValue = gateValue.slice(0, sel.s) + gateValue.slice(sel.en); caret = sel.s; }
      } else if (t.indexOf("delete") === 0) {
        // Word/line deletes collapse to the current selection (good enough
        // for a short gate code).
        gateValue = gateValue.slice(0, sel.s) + gateValue.slice(sel.en); caret = sel.s;
      } else {
        return; // history (undo/redo), formatting, etc. — leave alone
      }
      e.preventDefault();
      renderGate(caret);
      pwError.classList.remove("show");
    });

    pwInput.addEventListener("paste", function (e) {
      e.preventDefault();
      var cd = e.clipboardData || window.clipboardData;
      var text = cd ? cd.getData("text") : "";
      if (text == null) text = "";
      var sel = gateSelection();
      gateValue = gateValue.slice(0, sel.s) + text + gateValue.slice(sel.en);
      renderGate(sel.s + text.length);
      pwError.classList.remove("show");
    });
  } else if (pwInput) {
    // Engines without beforeinput (old): fall back to CSS disc masking. These
    // predate the iOS heuristic that flags it, so the prompt stays away.
    pwInput.style.webkitTextSecurity = "disc";
  }

  function sha256Hex(text) {
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  // Ask the Apps Script whether a password matches an approved applicant.
  // Apps Script can't answer a normal fetch (no CORS headers), so we use
  // JSONP: load the request as a <script> whose response calls our callback
  // with { ok: true|false }. Resolves false on any error or timeout.
  function checkPasswordRemote(guess) {
    return new Promise(function (resolve) {
      var cb = "ldcGate" + Date.now() + Math.floor(Math.random() * 1000);
      var script = document.createElement("script");
      var timer = setTimeout(function () { cleanup(); resolve(false); }, 8000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[cb]; } catch (err) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cb] = function (data) { cleanup(); resolve(!!(data && data.ok)); };
      script.onerror = function () { cleanup(); resolve(false); };
      script.src = APPS_SCRIPT_URL + "?password=" + encodeURIComponent(guess) + "&callback=" + cb;
      document.head.appendChild(script);
    });
  }

  var unlockBtn = lock.querySelector('button[type="submit"]');
  var unlockLabel = unlockBtn ? unlockBtn.querySelector(".label") : null;

  lock.addEventListener("submit", function (e) {
    e.preventDefault();
    var guess = getGateValue().trim();
    if (!guess) { pwError.classList.add("show"); return; }

    pwError.classList.remove("show");
    var originalLabel = unlockLabel ? unlockLabel.textContent : "";
    if (unlockBtn) unlockBtn.disabled = true;
    if (unlockLabel) unlockLabel.textContent = "Checking…";

    function done(ok) {
      // On success the day lives on its own page ("You're in"); send them
      // there. We first drop a session marker so welcome.html knows the
      // visitor came through the gate — a shared welcome URL carries no
      // session storage, so it bounces straight back here. (Deterrent only,
      // not real security; see README.) On failure, surface the error.
      if (ok) {
        try { sessionStorage.setItem("ldc-gate", "open"); } catch (e) {}
        window.location.href = "/welcome";
        return;
      }
      if (unlockBtn) unlockBtn.disabled = false;
      if (unlockLabel) unlockLabel.textContent = originalLabel;
      pwError.classList.add("show");
    }

    // The developer/master password (GATE_HASH) unlocks instantly, offline.
    // Anything else is checked against approved applicants in the sheet.
    sha256Hex(guess.toLowerCase()).then(function (hex) {
      if (hex === GATE_HASH) { done(true); return; }
      checkPasswordRemote(guess).then(done);
    });
  });

  pwInput.addEventListener("input", function () {
    pwError.classList.remove("show");
  });

})();
