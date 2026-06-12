/* Long Drive Club — front-door behaviour.
   Reveal-on-scroll, the entry sheet, the gate. No frameworks. */

(function () {
  "use strict";

  /* ---- Configuration ---------------------------------------------------
     SUPABASE_URL / SUPABASE_KEY: where applications are stored. The key is
     a publishable key; the table only accepts inserts (RLS), so it is safe
     to ship in the page.
     GATE_HASH: SHA-256 of the password sent to chosen applicants. To change
     the password run:  echo -n "newpassword" | shasum -a 256              */
  var SUPABASE_URL = "https://yjusavyowoobgrnzhlfr.supabase.co";
  var SUPABASE_KEY = "sb_publishable_3NPcjaSZXHksVlG5dpot1A_wr3vBWYo";
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

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = {
      name: form.elements.name.value,
      email: form.elements.email.value,
      phone: form.elements.phone.value,
      work: form.elements.work.value,
      car: form.elements.car.value,
      play: form.elements.play.value,
      party: form.elements.party.value,
      days: Array.prototype.slice.call(form.querySelectorAll('input[name="days"]:checked')).map(function (c) { return c.value; }),
      consent: form.elements.consent.checked
    };

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

  function saveApplication(f) {
    if (SUPABASE_URL.indexOf("__") === 0) {
      // No backend configured — don't pretend it sent.
      return Promise.reject(new Error("form endpoint not configured"));
    }
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
        play: f.play || null,
        party: f.party || null,
        days: f.days,
        consent: f.consent
      })
    }).then(function (res) {
      if (!res.ok) throw new Error("insert failed: " + res.status);
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

  document.getElementById("reserve-btn").addEventListener("click", function () {
    document.getElementById("reserve-row").hidden = true;
    document.getElementById("held-row").hidden = false;
  });

})();
