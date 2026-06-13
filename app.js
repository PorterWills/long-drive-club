/* Long Drive Club — front-door behaviour.
   Reveal-on-scroll, the entry sheet, the gate. No frameworks. */

(function () {
  "use strict";

  /* ---- Configuration ---------------------------------------------------
     SUPABASE_URL / SUPABASE_KEY: where applications are stored. The key is
     the public anon key; the table only accepts inserts (row-level
     security), so it is safe to ship in the page.
     WEB3FORMS_KEY: emails a copy of each application. Send-only, tied to
     the owner's inbox — safe to ship.
     GATE_HASH: SHA-256 of the password sent to chosen applicants. To change
     the password run:  echo -n "newpassword" | shasum -a 256              */
  var SUPABASE_URL = "https://zroovwyumybnvclzmxxh.supabase.co";
  var SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpyb292d3l1bXlibnZjbHpteHhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyOTc5NzgsImV4cCI6MjA5Njg3Mzk3OH0.WJFTddHRObBPIZN35mevZ1_47SgcXrUt8hRQBMTfQmU";
  var WEB3FORMS_KEY = "bd3f7e6e-7a6a-4a3e-be39-b800b1c9784a";
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

    fetch("car-makes-models.json")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        Object.keys(data).forEach(function (make) {
          makeSel.appendChild(option(make));
        });
        makeSel.addEventListener("change", function () {
          modelSel.innerHTML = "";
          modelSel.appendChild(option("", "Model"));
          var models = data[makeSel.value] || [];
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

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = {
      name: form.elements.name.value,
      email: form.elements.email.value,
      phone: form.elements.phone.value,
      work: form.elements.work.value,
      make: form.elements.make.value,
      model: form.elements.model.value,
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

  // Each application goes two places at once: the Supabase table (the
  // record) and Web3Forms (an email copy to the owner). We treat the
  // submission as successful if either lands, so a hiccup in one service
  // never loses an application.
  function saveApplication(f) {
    var days = f.days.join(", ");
    return Promise.allSettled([saveToDatabase(f), emailApplication(f, days)])
      .then(function (results) {
        var anyOk = results.some(function (r) { return r.status === "fulfilled"; });
        if (!anyOk) throw new Error("both submission channels failed");
      });
  }

  function saveToDatabase(f) {
    return fetch(SUPABASE_URL + "/rest/v1/ldc_applications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        name: f.name.trim(),
        email: f.email.trim(),
        phone: f.phone.trim(),
        work: f.work.trim() || null,
        car: f.car.trim() || null,
        make: f.make || null,
        model: f.model || null,
        play: f.play || null,
        party: f.party || null,
        days: f.days,
        consent: f.consent
      })
    }).then(function (res) {
      if (!res.ok) throw new Error("insert failed: " + res.status);
    });
  }

  function emailApplication(f, days) {
    return fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        subject: "New application — " + (f.name.trim() || "Long Drive Club"),
        from_name: "Long Drive Club",
        Name: f.name.trim(),
        Email: f.email.trim(),
        Phone: f.phone.trim(),
        "What they do": f.work.trim() || "—",
        "What they drive": f.car.trim() || "—",
        "How often they play": f.play || "—",
        "Coming alone or with someone": f.party || "—",
        "Days that interest them": days || "—",
        "Keep details for future drives": f.consent ? "Yes" : "No"
      })
    }).then(function (res) {
      if (!res.ok) throw new Error("email failed: " + res.status);
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

  lock.addEventListener("submit", function (e) {
    e.preventDefault();
    var guess = pwInput.value.trim().toLowerCase();
    sha256Hex(guess).then(function (hex) {
      if (hex === GATE_HASH) {
        lock.hidden = true;
        open.hidden = false;
      } else {
        pwError.classList.add("show");
      }
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
