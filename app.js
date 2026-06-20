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
      days: form.elements.days.value,
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
      // Meta Pixel: a completed application is our one real conversion.
      // "Lead" is Meta's standard event for an interest form being submitted.
      // No personal data is passed (name/email/phone stay out of Meta) —
      // see the privacy policy. Guarded so the form still works if the pixel
      // is blocked or hasn't loaded.
      if (typeof window.fbq === "function") window.fbq("track", "Lead");
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
        days: f.days,
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
