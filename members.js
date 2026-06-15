/* Long Drive Club — Drive 01, the members' event page.
   The page is "live": it holds attention across the two-to-three-month
   wait by revealing things on their own clocks. No frameworks, to match
   the front door. Three kinds of content sit on it:
     - known now (the region, the date as a countdown)
     - counts down to a fixed reveal (course, meeting point, route)
     - grows over time (the garage, as each member pays)
   Swap the date and the roster below as detail gets confirmed; every
   clock and count re-derives from them. */

(function () {
  "use strict";

  /* ---- Tidy the access marker out of the address bar --------------------
     The guard in the head admits members arriving on members.html#access
     and remembers it for the session; strip the marker now so it doesn't
     linger in the URL or interfere with the in-page anchor nav. */
  if (location.hash.indexOf("access") !== -1 && window.history && history.replaceState) {
    history.replaceState(null, "", location.pathname + location.search);
  }

  /* ---- The moving parts ------------------------------------------------- */

  // Drive day — the fixed point everything hangs off. Shown only as a
  // countdown on the page (no calendar name yet), per the brief.
  var EVENT = new Date("2026-09-05T07:00:00");
  function minusDays(d) { return EVENT.getTime() - d * 86400000; }

  // Reveal unlocks, derived from drive day so the clocks stay consistent.
  var TARGETS = {
    event:   EVENT.getTime(),
    course:  minusDays(42), // top 100 course — name held back, ~6 weeks out
    meeting: minusDays(14), // meeting point — ~2 weeks out
    route:   minusDays(7),  // the route — ~7 days out
  };

  // The field. Twenty places. Car make + model as text, no photos. Only
  // confirmed places show, so the card never reads as a row of empty slots.
  // `PLACES_TAKEN` is how many of the roster are paid up; raise it as the
  // field fills.
  var TOTAL_PLACES = 20;
  // Real confirmed places only, in the order they paid. Add a line per new
  // member and raise PLACES_TAKEN to match. Names are stored as first name +
  // surname initial; the card never shows full names.
  var PLACES_TAKEN = 1; // Michael P — the first confirmed place
  var ROSTER = [
    { name: "Michael P", car: "BMW M2 (G82)" },
  ];

  function pad2(n) { return String(n).padStart(2, "0"); }

  // First name + surname initial only. Members don't share full names.
  function shortName(full) {
    var parts = String(full).trim().split(/\s+/);
    if (parts.length < 2) return parts[0] || "";
    return parts[0] + " " + parts[parts.length - 1][0];
  }

  /* ---- Live countdowns: the page's pulse --------------------------------
     Each [data-countdown] element renders days · hrs · min · sec to its
     target and ticks once a second. Block register for the masthead,
     inline for the sealed reveal cards. When a target passes, it reads
     "Revealed" rather than zeroes. */

  var clocks = Array.prototype.slice.call(document.querySelectorAll("[data-countdown]"));

  function unitEl(value, label) {
    var unit = document.createElement("div");
    unit.className = "cd-unit";
    var num = document.createElement("span");
    num.className = "ldc-numeral cd-num";
    num.textContent = value;
    var lab = document.createElement("span");
    lab.className = "ldc-eyebrow cd-label";
    lab.textContent = label;
    unit.appendChild(num);
    unit.appendChild(lab);
    return unit;
  }

  function renderClock(el) {
    var target = TARGETS[el.getAttribute("data-countdown")];
    if (target == null) return;
    var accent = el.getAttribute("data-accent") === "true";
    var diff = Math.max(0, target - Date.now());

    if (diff <= 0) {
      el.innerHTML = "";
      var done = document.createElement("span");
      done.className = "ldc-eyebrow cd-done";
      done.textContent = "Revealed";
      el.appendChild(done);
      el.dataset.done = "true";
      return;
    }

    var d = Math.floor(diff / 86400000);
    var h = Math.floor((diff % 86400000) / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var s = Math.floor((diff % 60000) / 1000);

    el.innerHTML = "";
    el.appendChild(unitEl(String(d), "Days"));
    el.appendChild(unitEl(pad2(h), "Hrs"));
    el.appendChild(unitEl(pad2(m), "Min"));
    el.appendChild(unitEl(pad2(s), "Sec"));
    if (accent) el.firstChild.firstChild.style.color = "var(--ldc-redline)";
  }

  function tick() {
    clocks.forEach(function (el) {
      if (el.dataset.done === "true") return;
      renderClock(el);
    });
  }
  tick();
  setInterval(tick, 1000);

  /* ---- The garage: a scorecard that grows with the field ---------------- */

  function renderGarage() {
    var taken = Math.max(0, Math.min(TOTAL_PLACES, PLACES_TAKEN));
    var open = TOTAL_PLACES - taken;

    var statTaken = document.getElementById("stat-taken");
    var statOpen = document.getElementById("stat-open");
    if (statTaken) statTaken.textContent = pad2(taken);
    if (statOpen) statOpen.textContent = pad2(open);

    var count = document.getElementById("score-count");
    if (count) count.textContent = pad2(taken) + " / " + TOTAL_PLACES;

    var footLabel = document.getElementById("score-foot-label");
    if (footLabel) footLabel.textContent = "Field " + pad2(taken) + " · Open " + pad2(open);

    var rowsHost = document.getElementById("score-rows");
    if (!rowsHost) return;
    rowsHost.innerHTML = "";

    // No places taken yet — show a quiet placeholder rather than a bare
    // card, so it reads as a board waiting to fill, not a broken one.
    if (taken === 0) {
      var empty = document.createElement("div");
      empty.className = "score-empty";
      empty.innerHTML = '<span class="ldc-body"></span>';
      empty.querySelector(".ldc-body").textContent =
        "No cars on the board yet. The first names land here as places are taken.";
      rowsHost.appendChild(empty);
      return;
    }

    ROSTER.slice(0, taken).forEach(function (entry, i) {
      var row = document.createElement("div");
      row.className = "score-row" + ((i % 2 === 1) ? " score-row--alt" : "");

      var nCell = document.createElement("div");
      nCell.className = "score-cell score-cell--num";
      nCell.innerHTML = '<span class="ldc-numeral score-n">' + pad2(i + 1) + "</span>";

      var nameCell = document.createElement("div");
      nameCell.className = "score-cell";
      nameCell.innerHTML = '<span class="score-name"></span>';
      nameCell.querySelector(".score-name").textContent = shortName(entry.name);

      var carCell = document.createElement("div");
      carCell.className = "score-cell score-cell--last";
      carCell.innerHTML = '<span class="score-car"></span>';
      carCell.querySelector(".score-car").textContent = entry.car;

      row.appendChild(nCell);
      row.appendChild(nameCell);
      row.appendChild(carCell);
      rowsHost.appendChild(row);
    });
  }
  renderGarage();

  /* ---- Hero status: places left ----------------------------------------- */

  (function renderHeroPlaces() {
    var badge = document.getElementById("hero-places");
    if (!badge) return;
    var left = Math.max(0, TOTAL_PLACES - PLACES_TAKEN);
    if (left > 0) {
      badge.textContent = left + " place" + (left === 1 ? "" : "s") + " left";
      badge.classList.add("badge--open");
    } else {
      badge.textContent = "Field full";
      badge.classList.add("badge--sold");
    }
    badge.hidden = false;
  })();

  /* ---- Day sheet: a plain expandable list ------------------------------- */

  document.querySelectorAll(".ds-toggle").forEach(function (btn) {
    var row = btn.closest(".ds-row");
    if (btn.getAttribute("aria-expanded") === "true") row.classList.add("is-open");
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      row.classList.toggle("is-open", !open);
    });
  });

  /* ---- Reveal on scroll: restrained rise, honours reduced motion -------- */

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

})();
