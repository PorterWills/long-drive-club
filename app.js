/* Long Drive Club — front-door behaviour.
   Reveal-on-scroll, the entry sheet, the gate. No frameworks. */

(function () {
  "use strict";

  /* ---- Configuration ---------------------------------------------------
     APPS_SCRIPT_URL: the deployed Google Apps Script web app. It saves each
     application to a Google Sheet and sends the confirmation email. Apps
     Script web apps don't return CORS headers, so submissions are posted
     with mode: "no-cors" and a plain-text body (see saveApplication).
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
  (function () {
    var slider = document.getElementById("f-handicap");
    var readout = document.getElementById("hcp-readout");
    if (!slider || !readout) return;
    var min = parseFloat(slider.min), max = parseFloat(slider.max);
    function update() {
      var v = parseFloat(slider.value);
      var label = formatHandicap(v);
      readout.textContent = label;
      slider.setAttribute("aria-valuetext", label === "<0" ? "Better than scratch" : label);
      var pct = (v - min) / (max - min) * 100;
      slider.style.setProperty("--pct", pct + "%");
    }
    slider.addEventListener("input", update);
    update();
  })();

  /* ---- The entry sheet -------------------------------------------------- */
  var form = document.getElementById("entry-form");
  var formError = document.getElementById("form-error");
  var submitBtn = document.getElementById("submit-btn");

  function setFieldError(name, message) {
    var el = form.querySelector('[data-error-for="' + name + '"]');
    var hint = form.querySelector('[data-hint-for="' + name + '"]');
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("show", !!message);
    if (hint) hint.style.display = message ? "none" : "";
  }

  function emailOk(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }

  /* ---- Car make/model picker (field 05) --------------------------------
     Two linked selects. Make populates from the local car-makes-models.json
     (read once, no live API at runtime); choosing a make fills and enables
     the model select. */
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

        makeSel.addEventListener("change", function () {
          modelSel.innerHTML = "";
          modelSel.appendChild(option("", "Model"));
          var models = makes[makeSel.value] || [];
          if (models.length) {
            models.forEach(function (m) { modelSel.appendChild(option(m)); });
            modelSel.disabled = false;
          } else {
            modelSel.disabled = true;
          }
        });
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

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var loc = resolveBase(form);
    var f = {
      name: form.elements.name.value,
      email: form.elements.email.value,
      phone: form.elements.phone.value,
      work: form.elements.work.value,
      make: form.elements.make.value,
      model: form.elements.model.value,
      handicap: formatHandicap(parseFloat(form.elements.handicap_value.value)),
      base: loc.base,
      baseCity: loc.city,
      play: form.elements.play.value,
      party: form.elements.party.value,
      days: Array.prototype.slice.call(form.querySelectorAll('input[name="days"]:checked')).map(function (c) { return c.value; }),
      consent: form.elements.consent.checked
    };
    f.car = [f.make, f.model].filter(Boolean).join(" ");

    var ok = true;
    if (!f.name.trim()) { setFieldError("name", "We'll need a name for the sheet."); ok = false; } else setFieldError("name");
    if (!f.email.trim()) { setFieldError("email", "We'll need somewhere to send the password."); ok = false; }
    else if (!emailOk(f.email)) { setFieldError("email", "That email doesn't look right."); ok = false; }
    else setFieldError("email");
    if (!f.phone.trim()) { setFieldError("phone", "A number, in case the day moves."); ok = false; } else setFieldError("phone");
    if (!ok) return;

    formError.classList.remove("show");
    submitBtn.disabled = true;
    submitBtn.setAttribute("aria-busy", "true");

    saveApplication(f).then(function () {
      showSubmitted(f.name);
    }).catch(function () {
      submitBtn.disabled = false;
      submitBtn.removeAttribute("aria-busy");
      formError.textContent = "That didn't send. Give it another go.";
      formError.classList.add("show");
    });
  });

  // Each application is posted to the Google Apps Script web app, which
  // saves it to the Sheet and sends the confirmation email. Apps Script
  // doesn't return CORS headers, so we post with mode: "no-cors" and a
  // plain-text content type — anything else triggers a preflight Apps
  // Script can't answer. The response is opaque, so a resolved fetch is
  // treated as success.
  function saveApplication(f) {
    return fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        name: f.name.trim(),
        email: f.email.trim(),
        phone: f.phone.trim(),
        work: f.work.trim(),
        car: f.car.trim(),
        make: f.make,
        model: f.model,
        handicap: f.handicap,
        base: f.base,
        baseCity: f.baseCity,
        play: f.play,
        party: f.party,
        days: f.days.join(", "),
        consent: f.consent
      })
    });
  }

  function showSubmitted(name) {
    var first = (name || "").trim().split(/\s+/)[0];
    var headline = document.getElementById("done-headline");
    if (first) headline.textContent = "You're on the list, " + first;
    document.getElementById("apply-sheet").hidden = true;
    var done = document.getElementById("apply-done");
    done.hidden = false;
    var apply = document.getElementById("apply");
    window.scrollTo({ top: apply.offsetTop - 40, behavior: "smooth" });
  }

  /* ---- The gate ---------------------------------------------------------- */
  var lock = document.getElementById("gate-lock");
  var open = document.getElementById("gate-open");
  var pwInput = document.getElementById("f-pw");
  var pwError = document.getElementById("pw-error");

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
    var guess = pwInput.value.trim();
    if (!guess) { pwError.classList.add("show"); return; }

    pwError.classList.remove("show");
    var originalLabel = unlockLabel ? unlockLabel.textContent : "";
    if (unlockBtn) unlockBtn.disabled = true;
    if (unlockLabel) unlockLabel.textContent = "Checking…";

    function done(ok) {
      if (unlockBtn) unlockBtn.disabled = false;
      if (unlockLabel) unlockLabel.textContent = originalLabel;
      if (ok) { lock.hidden = true; open.hidden = false; }
      else { pwError.classList.add("show"); }
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
      document.getElementById("reserve-row").hidden = true;
      document.getElementById("held-row").hidden = false;
    });

    modal.querySelectorAll("[data-close]").forEach(function (el) {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
  }

})();
