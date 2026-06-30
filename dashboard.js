/* Signup Dashboard — Long Drive Club
 *
 * A faithful static build of the Claude Design "Signup Dashboard.dc.html",
 * wired to the live Google Sheet through the Apps Script backend.
 *
 * Flow: the visitor enters the dashboard password; dashboard.js asks the
 * Apps Script web app for the data (JSONP, since Apps Script can't send CORS
 * headers). The script only returns rows when the password matches the
 * DASHBOARD_PASSWORD Script Property, so the applicant data never lives in
 * this public file. On success the rows are transformed into the same view
 * model the original design computed in renderVals(), then rendered.
 *
 * The password is held in sessionStorage for the tab's life so Refresh and a
 * page reload don't re-prompt; closing the tab clears it. */
(function () {
  "use strict";

  /* ---- Config ---------------------------------------------------------- */

  var CONFIG = {
    // The deployed Apps Script web app (same backend the entry form posts to).
    APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzOFXxYWecTLBcC6T_z8KdnzHUsAT5NBAekuQnFqGrqPJpuO9C1YXih_xe43yfCMkYMDg/exec",

    eventName: "THE FIRST DRIVE", // heading; change per event
    placesTarget: 20,             // capacity the "places filled" bar fills toward

    // Drive day and the reveal countdowns — these mirror members.js so the
    // dashboard shows the same four clocks members see. `eventDate` is editable
    // from the sheet (event_date); the reveal offsets match the members page.
    eventDate: "2026-09-05T07:00:00",
    revealOffsets: { course: 42, meeting: 14, route: 7 }, // days before drive day

    // Instagram is not in the sheet, so these are entered by hand. `change`
    // (vs last check) and `reach` are optional — leave them "" to hide them
    // and show just the follower count.
    instagram: { show: true, followers: "20", change: "", reach: "" }
  };

  var SS_KEY = "ldc-dash-pw";

  // Live overrides from the sheet's "Dashboard" tab. Anything set there wins
  // over the CONFIG defaults above, so the owners can change the follower
  // count, event name, etc. by editing a cell — no code, no redeploy.
  function applySettings(s) {
    if (!s || typeof s !== "object") return;
    var truthy = function (v) {
      var t = String(v).trim().toLowerCase();
      return t === "true" || t === "yes" || t === "y" || t === "1" || t === "on";
    };
    var nonEmpty = function (k) { return s[k] != null && String(s[k]).trim() !== ""; };
    if (nonEmpty("event_name")) CONFIG.eventName = String(s.event_name).trim();
    if (nonEmpty("places_target")) {
      var n = parseInt(s.places_target, 10);
      if (!isNaN(n) && n > 0) CONFIG.placesTarget = n;
    }
    if (nonEmpty("event_date")) {
      var ed = String(s.event_date).trim();
      if (!isNaN(Date.parse(ed))) CONFIG.eventDate = ed;
    }
    if (nonEmpty("ig_show")) CONFIG.instagram.show = truthy(s.ig_show);
    if (nonEmpty("ig_followers")) CONFIG.instagram.followers = String(s.ig_followers).trim();
    if ("ig_change" in s) CONFIG.instagram.change = s.ig_change == null ? "" : String(s.ig_change).trim();
    if ("ig_reach" in s) CONFIG.instagram.reach = s.ig_reach == null ? "" : String(s.ig_reach).trim();
  }

  /* ---- Small helpers --------------------------------------------------- */

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function pad(n) { return String(n).padStart(2, "0"); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function parseDate(v) {
    if (!v) return null;
    var d = (v instanceof Date) ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDateTime(d) {
    if (!d) return "—";
    return MONTHS[d.getMonth()] + " " + d.getDate() + ", " +
           pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function fmtDate(d) {
    if (!d) return "—";
    return MONTHS[d.getMonth()] + " " + d.getDate();
  }

  // "today" / "1d ago" / "Nd ago", relative to now.
  function agoLabel(d) {
    if (!d) return "";
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "1d ago";
    return days + "d ago";
  }

  /* ---- JSONP ----------------------------------------------------------- */

  var jsonpSeq = 0;
  function jsonp(params) {
    return new Promise(function (resolve, reject) {
      var cb = "__ldcdash_" + (++jsonpSeq) + "_" + Math.floor(Math.random() * 1e6);
      var script = document.createElement("script");
      var timer = setTimeout(function () { cleanup(); reject(new Error("timeout")); }, 15000);
      function cleanup() {
        clearTimeout(timer);
        delete window[cb];
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cb] = function (data) { cleanup(); resolve(data); };
      script.onerror = function () { cleanup(); reject(new Error("network")); };
      var qs = Object.keys(params)
        .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); })
        .join("&");
      script.src = CONFIG.APPS_SCRIPT_URL + "?" + qs + "&callback=" + cb;
      document.body.appendChild(script);
    });
  }

  function fetchData(password) {
    return jsonp({ dashboard: password });
  }

  /* ---- Stage / touch / timeline from a raw sheet row ------------------- */

  // The furthest step a row has reached. Timestamps win over the status word
  // so a row whose status still reads "complete" but which has a paid_at is
  // correctly counted as paid.
  function deriveStage(r) {
    var s = String(r.status || "").toLowerCase();
    if (s === "declined" || r.declined_at) return "declined";
    if (s === "paid" || r.paid_at) return "paid";
    if (s === "approved" || r.approved_at) return "approved";
    if (s === "complete") return "completed";
    return "signedup"; // step1_complete or anything partial
  }

  function isAlone(party) {
    var p = String(party || "").toLowerCase();
    return p === "" || p.indexOf("own") >= 0 || p.indexOf("alone") >= 0 || p.indexOf("myself") >= 0 || p.indexOf("just me") >= 0;
  }

  // Most recent contact: the pay-reminder nudges carry timestamps; the
  // form-completion recovery email only leaves a flag.
  function deriveTouch(r) {
    var n3 = parseDate(r.nudge3_at), n2 = parseDate(r.nudge2_at), n1 = parseDate(r.nudge1_at);
    if (n3) return "Nudge 3 · " + agoLabel(n3);
    if (n2) return "Nudge 2 · " + agoLabel(n2);
    if (n1) return "Nudge 1 · " + agoLabel(n1);
    if (r.recovery_sent) return "Recovery sent";
    return "—";
  }

  function buildLog(r) {
    var signup = parseDate(r.step1_at) || parseDate(r.timestamp);
    var ev = [];
    if (signup) ev.push({ d: signup, k: "signup", label: "Signed up" });
    if (r.recovery_sent) {
      // No timestamp is stored for the recovery email; anchor it just after
      // signup so it reads in the right place.
      var ra = signup ? new Date(signup.getTime() + 3600000) : null;
      ev.push({ d: ra, k: "recovery", label: "Recovery message sent", noTime: true });
    }
    var add = function (val, k, label) { var d = parseDate(val); if (d) ev.push({ d: d, k: k, label: label }); };
    add(r.completed_at, "stage", "Completed form");
    add(r.approved_at, "stage", "Approved");
    add(r.nudge1_at, "nudge", "Nudge 1 · pay reminder");
    add(r.nudge2_at, "nudge", "Nudge 2 · pay reminder");
    add(r.nudge3_at, "nudge", "Nudge 3 · hold expiring");
    add(r.paid_at, "paid", "Paid · place confirmed");
    add(r.declined_at, "declined", "Declined");
    ev.sort(function (a, b) {
      var ta = a.d ? a.d.getTime() : 0, tb = b.d ? b.d.getTime() : 0;
      return ta - tb;
    });
    return ev;
  }

  // Raw rows -> applicant objects (the shape the design's `applicants` getter
  // produced, but from real data).
  function toApplicants(rows) {
    return rows.map(function (r, i) {
      var stage = deriveStage(r);
      var cityish = r.city || r.base || "";
      var signup = parseDate(r.step1_at) || parseDate(r.timestamp);
      return {
        num: pad(i + 1),
        name: r.name || "—",
        car: r.car || (((r.make || "") + " " + (r.model || "")).trim()) || "—",
        city: cityish,
        party: r.party || "",
        partyLabel: isAlone(r.party) ? "Alone" : "+1 guest",
        stage: stage,
        ts: signup ? signup.getTime() : 0,
        hcp: r.handicap || "—",
        work: r.work || "—",
        base: r.base || "—",
        email: r.email || "—",
        phone: r.phone || "—",
        touch: deriveTouch(r),
        log: buildLog(r)
      };
    });
  }

  /* ---- View model (mirrors the design's renderVals) -------------------- */

  var green = "var(--ldc-green)";
  var moss = "var(--ldc-moss)";
  var dim = "var(--text-dim)";

  var chipMap = {
    paid:      { label: "Paid",      bg: "var(--ldc-green)", fg: "var(--ldc-chalk)",      bd: "transparent",            tick: true },
    approved:  { label: "Approved",  bg: "var(--ldc-moss)",  fg: "var(--ldc-tarmac)",     bd: "transparent",            tick: false },
    completed: { label: "Form done", bg: "transparent",      fg: "var(--ldc-tarmac)",     bd: "var(--ldc-moss)",        tick: false },
    signedup:  { label: "Signed up", bg: "transparent",      fg: "var(--ldc-tarmac-dim)", bd: "var(--hairline-strong)", tick: false },
    declined:  { label: "Declined",  bg: "transparent",      fg: "var(--ldc-tarmac-dim)", bd: "var(--hairline-strong)", tick: true }
  };
  var dotMap = {
    signup:   { bg: "var(--ldc-tarmac)",  border: "var(--ldc-tarmac)" },
    stage:    { bg: "var(--ldc-green)",   border: "var(--ldc-green)" },
    paid:     { bg: "var(--ldc-redline)", border: "var(--ldc-redline)" },
    nudge:    { bg: "var(--ldc-chalk)",   border: "var(--ldc-tarmac-dim)" },
    recovery: { bg: "var(--ldc-moss)",    border: "var(--ldc-moss)" },
    declined: { bg: "var(--ldc-chalk)",   border: "var(--ldc-redline)" }
  };
  var stageOrder = { paid: 0, approved: 1, completed: 2, signedup: 3, declined: 4 };

  function buildModel(state) {
    var target = CONFIG.placesTarget;

    var base = toApplicants(state.rows).map(function (p) {
      var c = chipMap[p.stage] || chipMap.signedup;
      var nudged = p.touch && p.touch !== "—";
      return Object.assign({}, p, {
        carCity: [p.car, p.city].filter(Boolean).join(" · "),
        status: c.label, bg: c.bg, fg: c.fg, bd: c.bd, showTick: c.tick,
        contactDot: nudged ? "var(--ldc-redline)" : "var(--hairline-strong)",
        contactColor: nudged ? "var(--text-body)" : "var(--text-dim)"
      });
    });

    var count = function (s) { return base.filter(function (p) { return p.stage === s; }).length; };
    var signedUpTotal = base.length;
    var paid = count("paid");
    var approved = count("approved");
    var awaitingApproval = count("completed");
    var formIncomplete = count("signedup");
    var declined = count("declined");
    var alone = base.filter(function (p) { return p.partyLabel === "Alone" && p.stage !== "declined"; }).length;
    var guest = base.filter(function (p) { return p.partyLabel !== "Alone" && p.stage !== "declined"; }).length;

    var placesFilled = paid;
    var pctFilled = target > 0 ? Math.round((placesFilled / target) * 100) : 0;

    var fForm = paid + approved + awaitingApproval;
    var fApproved = paid + approved;
    var denom = signedUpTotal || 1;
    var funnel = [
      { n: "1", label: "Signed up",      count: signedUpTotal, fill: green },
      { n: "2", label: "Completed form", count: fForm,         fill: green },
      { n: "3", label: "Approved",       count: fApproved,     fill: moss },
      { n: "4", label: "Paid",           count: paid,          fill: green }
    ].map(function (s) {
      return { n: s.n, label: s.label, fill: s.fill,
               pct: Math.round((s.count / denom) * 100) + "%", count: pad(s.count) };
    });

    var statCards = [
      { value: pad(paid),             label: "Paid",             color: green },
      { value: pad(approved),         label: "Approved, unpaid", color: moss },
      { value: pad(awaitingApproval), label: "Awaiting approval", color: "var(--text-body)" },
      { value: pad(formIncomplete),   label: "Form incomplete",  color: "var(--text-body)" },
      { value: pad(declined),         label: "Declined",         color: dim },
      { value: pad(alone) + " / " + pad(guest), label: "Alone / guest", color: "var(--text-body)" }
    ];

    var filterDefs = [
      { key: "all",       label: "All",       n: signedUpTotal },
      { key: "paid",      label: "Paid",      n: paid },
      { key: "approved",  label: "Approved",  n: approved },
      { key: "completed", label: "Form done", n: awaitingApproval },
      { key: "signedup",  label: "Signed up", n: formIncomplete },
      { key: "declined",  label: "Declined",  n: declined }
    ];
    var filters = filterDefs.map(function (f) {
      var on = state.filter === f.key;
      return { key: f.key, label: f.label, count: pad(f.n),
               bg: on ? "var(--ldc-green)" : "transparent",
               fg: on ? "var(--ldc-chalk)" : "var(--text-body)",
               bd: on ? "transparent" : "var(--hairline-strong)" };
    });

    var sortDefs = [
      { key: "stage",  label: "Stage" },
      { key: "name",   label: "Name" },
      { key: "recent", label: "Recent" }
    ];
    var sortOptions = sortDefs.map(function (o) {
      var on = state.sort === o.key;
      return { key: o.key, label: o.label,
               weight: on ? 700 : 500,
               color: on ? "var(--text-body)" : "var(--text-dim)",
               underline: on ? "var(--ldc-redline)" : "transparent" };
    });

    var list = state.filter === "all" ? base.slice() : base.filter(function (p) { return p.stage === state.filter; });
    if (state.sort === "name") list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (state.sort === "recent") list.sort(function (a, b) { return b.ts - a.ts; });
    else list.sort(function (a, b) { return (stageOrder[a.stage] - stageOrder[b.stage]) || (b.ts - a.ts); });

    var selRaw = base.filter(function (p) { return p.num === state.selectedId; })[0] || null;
    var selected = null;
    if (selRaw) {
      var record = [
        { label: "Stage",     value: selRaw.status },
        { label: "Party",     value: selRaw.partyLabel === "Alone" ? "Coming alone" : "Bringing a guest" },
        { label: "Car",       value: selRaw.car },
        { label: "Handicap",  value: selRaw.hcp },
        { label: "Home base", value: selRaw.base },
        { label: "Work",      value: selRaw.work },
        { label: "Email",     value: selRaw.email },
        { label: "Phone",     value: selRaw.phone },
        { label: "City",      value: selRaw.city || "—" },
        { label: "Signed up", value: selRaw.log[0] ? (selRaw.log[0].noTime ? "—" : fmtDateTime(selRaw.log[0].d)) : "—" }
      ];
      var logView = selRaw.log.map(function (e, i) {
        var d = dotMap[e.k] || dotMap.signup;
        return { t: e.noTime ? "Sent" : fmtDateTime(e.d), label: e.label,
                 dotBg: d.bg, dotBorder: d.border,
                 lineMin: i === selRaw.log.length - 1 ? "0" : "18px" };
      });
      selected = Object.assign({}, selRaw, { record: record, logView: logView });
    }

    return {
      eventName: CONFIG.eventName,
      target: pad(target),
      placesFilled: pad(placesFilled),
      placesLeft: Math.max(0, target - placesFilled),
      pctFilledStr: pctFilled + "%",
      signedUp: signedUpTotal,
      funnel: funnel, statCards: statCards, filters: filters, sortOptions: sortOptions,
      applicants: list, selected: selected
    };
  }

  /* ---- Render ---------------------------------------------------------- */

  // The four reveal clocks, derived from drive day exactly as members.js does.
  function timerTargets() {
    var ev = Date.parse(CONFIG.eventDate);
    if (isNaN(ev)) return [];
    var day = 86400000, o = CONFIG.revealOffsets;
    return [
      { label: "Drive day",         target: ev,                  accent: true },
      { label: "The course",        target: ev - o.course * day,  accent: false },
      { label: "The meeting point", target: ev - o.meeting * day, accent: false },
      { label: "The route",         target: ev - o.route * day,   accent: false }
    ];
  }

  function cdUnit(num, label, accent) {
    return '<span style="display:inline-flex;flex-direction:column;align-items:flex-start;min-width:30px">' +
      '<span class="sd-num" style="font-size:23px;color:' + (accent ? 'var(--ldc-redline)' : 'var(--text-body)') + '">' + num + '</span>' +
      '<span class="sd-eyebrow" style="font-size:9px;letter-spacing:.16em;color:var(--text-dim);margin-top:6px">' + label + '</span>' +
    '</span>';
  }

  function clockHTML(target, accent) {
    var diff = target - Date.now();
    if (diff <= 0) return '<span class="sd-eyebrow" style="color:var(--ldc-moss);letter-spacing:.2em">Revealed</span>';
    var d = Math.floor(diff / 86400000),
        h = Math.floor((diff % 86400000) / 3600000),
        m = Math.floor((diff % 3600000) / 60000),
        s = Math.floor((diff % 60000) / 1000);
    return '<span style="display:flex;align-items:flex-start;gap:13px">' +
      cdUnit(String(d), "Days", accent) + cdUnit(pad(h), "Hrs", false) +
      cdUnit(pad(m), "Min", false) + cdUnit(pad(s), "Sec", false) + '</span>';
  }

  function chipHTML(p, big) {
    var p2 = big ? "6px 12px 5px" : "6px 12px 5px";
    var tick = p.showTick ? '<span style="width:9px;height:7px;background:var(--ldc-redline);display:inline-block;flex-shrink:0"></span>' : "";
    return '<span style="display:inline-flex;align-items:center;gap:7px;padding:' + p2 +
      ';border-radius:3px;font-family:var(--font-display);font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;white-space:nowrap;background:' +
      p.bg + ';color:' + p.fg + ';border:1px solid ' + p.bd + '">' + tick + esc(p.status) + '</span>';
  }

  function rowHTML(p) {
    var dimOp = (p.stage === "declined") ? "0.55" : "1";
    return '<div class="sd-row" data-open="' + p.num + '" style="display:flex;align-items:center;gap:18px;padding:13px 0;border-bottom:1px solid var(--hairline);opacity:' + dimOp + ';cursor:pointer">' +
      '<span class="sd-col-roundel" style="flex:0 0 44px"><span class="roundel roundel--on-light" style="width:40px;height:40px;font-size:14px">' + esc(p.num) + '</span></span>' +
      '<span class="sd-col-name" style="flex:1;min-width:0">' +
        '<span class="sd-disp" style="font-size:16px;display:block">' + esc(p.name) + '</span>' +
        '<span style="font-size:12.5px;color:var(--text-dim)">' + esc(p.carCity) + '</span>' +
      '</span>' +
      '<span class="sd-col-party" style="flex:0 0 110px;font-size:12px;color:var(--text-body);letter-spacing:.04em;text-transform:uppercase">' + esc(p.partyLabel) + '</span>' +
      '<span class="sd-col-contact" style="flex:0 0 168px;display:flex;align-items:center;gap:8px">' +
        '<span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;background:' + p.contactDot + '"></span>' +
        '<span style="font-size:12.5px;color:' + p.contactColor + '">' + esc(p.touch) + '</span>' +
      '</span>' +
      '<span class="sd-col-stage" style="flex:0 0 124px">' + chipHTML(p) + '</span>' +
      '<span class="sd-col-arrow" style="flex:0 0 16px;color:var(--text-dim);font-size:15px">→</span>' +
    '</div>';
  }

  function render(vm, state) {
    var ig = CONFIG.instagram;
    var igChange = ig.change ? '<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border:1px solid var(--ldc-moss);border-radius:3px;color:var(--ldc-moss);font-size:12px;font-weight:700;letter-spacing:.04em">↑ ' + esc(ig.change) + ' <span style="font-weight:400;letter-spacing:0">since last check</span></span>' : "";
    var igReach = ig.reach ? '<span style="font-size:13px;color:var(--text-dim)">' + esc(ig.reach) + ' reach this week</span>' : "";
    var igHTML = ig.show ?
      '<div class="sd-pad" style="display:flex;flex-wrap:wrap;align-items:center;gap:14px 26px;padding:18px 30px;background:var(--ldc-chalk);border-top:1px solid var(--hairline);border-bottom:1px solid var(--hairline)">' +
        '<span class="sd-eyebrow" style="color:var(--text-dim)">Instagram · top of funnel</span>' +
        '<span style="display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 22px">' +
          '<span style="display:flex;align-items:baseline;gap:9px"><span class="sd-num" style="font-size:30px">' + esc(ig.followers) + '</span><span style="font-size:12px;color:var(--text-dim)">followers</span></span>' +
          igChange + igReach +
        '</span>' +
      '</div>' : "";

    var funnelHTML = vm.funnel.map(function (s) {
      return '<div style="display:flex;align-items:center;gap:16px;margin-bottom:15px">' +
        '<span style="flex:0 0 60px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--text-dim);font-weight:600">Step ' + s.n + '</span>' +
        '<span style="flex:0 0 130px;font-size:12.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--text-body);font-weight:600">' + esc(s.label) + '</span>' +
        '<div style="flex:1;height:22px;background:var(--ldc-chalk-down);display:flex;align-items:center"><span style="width:' + s.pct + ';background:' + s.fill + ';height:100%;display:block;transition:width .5s ease"></span></div>' +
        '<span class="sd-num" style="flex:0 0 34px;text-align:right;font-size:20px;color:' + s.fill + '">' + s.count + '</span>' +
      '</div>';
    }).join("");

    var statHTML = vm.statCards.map(function (s) {
      return '<div style="background:var(--ldc-chalk);padding:18px 22px"><div class="sd-num" style="font-size:30px;color:' + s.color + '">' + esc(s.value) + '</div><div class="sd-eyebrow" style="color:var(--text-dim);margin-top:9px;line-height:1.4;text-wrap:balance">' + esc(s.label) + '</div></div>';
    }).join("");

    var sortHTML = vm.sortOptions.map(function (o) {
      return '<button class="sd-sort" data-sort="' + o.key + '" style="background:none;border:none;cursor:pointer;font-family:var(--font-display);font-size:12px;font-weight:' + o.weight + ';letter-spacing:.06em;text-transform:uppercase;color:' + o.color + ';padding:4px 2px;border-bottom:2px solid ' + o.underline + '">' + esc(o.label) + '</button>';
    }).join("");

    var filtersHTML = vm.filters.map(function (f) {
      return '<button class="sd-chip" data-filter="' + f.key + '" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-family:var(--font-display);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:7px 13px;border-radius:3px;background:' + f.bg + ';color:' + f.fg + ';border:1px solid ' + f.bd + '">' + esc(f.label) + ' <span class="sd-num" style="font-size:12px;opacity:.7">' + f.count + '</span></button>';
    }).join("");

    var timers = timerTargets();
    var timersHTML = timers.length ?
      '<div class="sd-pad" style="padding:24px 30px 0"><p class="ldc-redtick" style="color:var(--text-body)">Counting down</p></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1px;background:var(--hairline);border-top:1px solid var(--hairline);border-bottom:1px solid var(--hairline);margin-top:14px">' +
        timers.map(function (t) {
          return '<div style="background:var(--ldc-chalk);padding:18px 22px">' +
            '<div class="sd-eyebrow" style="color:var(--text-dim);margin-bottom:14px">' + esc(t.label) + '</div>' +
            '<div class="cd" data-cd="' + t.target + '" data-accent="' + (t.accent ? '1' : '0') + '">' + clockHTML(t.target, t.accent) + '</div>' +
          '</div>';
        }).join("") +
      '</div>' : "";

    var rowsHTML = vm.applicants.length
      ? vm.applicants.map(rowHTML).join("")
      : '<div style="padding:34px 0;text-align:center;color:var(--text-dim);font-size:14px">No applicants in this view yet.</div>';

    return '' +
      '<div style="width:100%;min-height:100vh;background:var(--ldc-chalk);color:var(--ldc-tarmac)">' +
        '<div class="stripe" aria-hidden="true" style="height:4px"><span></span><span></span><span></span></div>' +

        '<div class="ldc-dark sd-pad" style="display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;align-items:flex-end;padding:22px 30px 20px;background:var(--ldc-green);color:var(--ldc-chalk)">' +
          '<div><div class="sd-eyebrow" style="color:var(--ldc-chalk-dim);margin-bottom:7px">Event signups</div><div class="sd-disp" style="font-size:27px">' + esc(vm.eventName) + '</div></div>' +
          '<div style="display:flex;align-items:center;gap:16px">' +
            '<span id="updatedLabel" style="font-size:12px;color:var(--ldc-chalk-dim)">From Google Sheet · ' + esc(state.updatedLabel) + '</span>' +
            '<button class="btn btn--secondary btn--sm" data-action="refresh"><span class="label">↻ Refresh</span></button>' +
          '</div>' +
        '</div>' +

        '<div style="display:flex;flex-wrap:wrap;gap:1px;background:var(--hairline)">' +
          '<div class="ldc-dark sd-pad" style="flex:1 1 300px;padding:28px 30px;background:var(--ldc-green);color:var(--ldc-chalk)">' +
            '<div class="sd-eyebrow" style="color:var(--ldc-chalk-dim);margin-bottom:14px">Places filled</div>' +
            '<div style="display:flex;align-items:baseline;gap:10px"><span class="sd-num" style="font-size:84px;color:var(--ldc-chalk)">' + vm.placesFilled + '</span><span class="sd-num" style="font-size:34px;color:var(--ldc-chalk-dim)">/ ' + vm.target + '</span></div>' +
            '<div style="height:14px;background:var(--ldc-tarmac);margin-top:20px;display:flex"><span style="width:' + vm.pctFilledStr + ';background:var(--ldc-chalk);display:block"></span><span style="width:3px;background:var(--ldc-redline);display:block"></span></div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:9px;font-size:12px;color:var(--ldc-chalk-dim)"><span>' + vm.pctFilledStr + ' full</span><span>' + vm.placesLeft + ' places left</span></div>' +
          '</div>' +
          '<div class="sd-pad" style="flex:2 1 420px;padding:28px 30px;background:var(--ldc-chalk)">' +
            '<div class="sd-eyebrow" style="color:var(--text-dim);margin-bottom:18px">Journey · ' + vm.signedUp + ' signed up</div>' +
            funnelHTML +
          '</div>' +
        '</div>' +

        timersHTML +

        igHTML +

        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(172px,1fr));gap:1px;background:var(--hairline);border-bottom:1px solid var(--hairline)">' + statHTML + '</div>' +

        '<div class="sd-pad" style="padding:24px 30px 0;display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:12px">' +
          '<p class="ldc-redtick" style="color:var(--text-body)">Applicants</p>' +
          '<div style="display:flex;align-items:center;gap:7px"><span class="sd-eyebrow" style="color:var(--text-dim);margin-right:4px">Sort</span>' + sortHTML + '</div>' +
        '</div>' +

        '<div class="sd-pad" style="padding:14px 30px 4px;display:flex;flex-wrap:wrap;gap:9px">' + filtersHTML + '</div>' +

        '<div class="sd-pad" style="padding:8px 30px 40px">' +
          '<div class="sd-head-row" style="display:flex;align-items:center;gap:18px;padding:0 0 9px;border-bottom:1px solid var(--hairline-strong)">' +
            '<span class="sd-col-roundel" style="flex:0 0 44px"></span>' +
            '<span class="sd-eyebrow sd-col-name" style="flex:1;color:var(--text-dim)">Name · car</span>' +
            '<span class="sd-eyebrow sd-col-party" style="flex:0 0 110px;color:var(--text-dim)">Party</span>' +
            '<span class="sd-eyebrow sd-col-contact" style="flex:0 0 168px;color:var(--text-dim)">Contact · nudges</span>' +
            '<span class="sd-eyebrow sd-col-stage" style="flex:0 0 124px;color:var(--text-dim)">Stage</span>' +
            '<span class="sd-col-arrow" style="flex:0 0 16px"></span>' +
          '</div>' +
          rowsHTML +
        '</div>' +
      '</div>';
  }

  function renderDrawer(selected) {
    if (!selected) return "";
    var recHTML = selected.record.map(function (rec) {
      return '<div style="background:var(--ldc-chalk);padding:13px 15px"><div class="sd-eyebrow" style="color:var(--text-dim);font-size:10px;letter-spacing:.24em">' + esc(rec.label) + '</div><div style="font-size:14px;color:var(--text-body);margin-top:5px;word-break:break-word">' + esc(rec.value) + '</div></div>';
    }).join("");
    var logHTML = selected.logView.map(function (e) {
      return '<div style="display:flex;gap:16px;position:relative;padding-bottom:20px">' +
        '<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">' +
          '<span style="width:13px;height:13px;border-radius:50%;background:' + e.dotBg + ';border:2px solid ' + e.dotBorder + ';box-sizing:border-box;z-index:1"></span>' +
          '<span style="flex:1;width:2px;background:var(--hairline-strong);margin-top:2px;min-height:' + e.lineMin + '"></span>' +
        '</div>' +
        '<div style="padding-bottom:2px;margin-top:-2px"><div class="sd-disp" style="font-size:14px;color:var(--text-body)">' + esc(e.label) + '</div><div style="font-size:12px;color:var(--text-dim);margin-top:3px">' + esc(e.t) + '</div></div>' +
      '</div>';
    }).join("");

    return '<div class="stripe" aria-hidden="true" style="height:4px"><span></span><span></span><span></span></div>' +
      '<div class="ldc-dark" style="background:var(--ldc-green);color:var(--ldc-chalk);padding:20px 24px;display:flex;align-items:center;gap:16px">' +
        '<span class="roundel roundel--on-dark" style="width:52px;height:52px;font-size:18px;color:var(--ldc-tarmac)">' + esc(selected.num) + '</span>' +
        '<div style="flex:1;min-width:0"><div class="sd-disp" style="font-size:20px">' + esc(selected.name) + '</div><div style="font-size:12.5px;color:var(--ldc-chalk-dim);margin-top:3px">' + esc(selected.carCity) + '</div></div>' +
        chipHTML(selected, true) +
        '<button data-action="close" aria-label="Close" style="background:none;border:1px solid var(--hairline-strong);color:var(--ldc-chalk);width:32px;height:32px;border-radius:3px;cursor:pointer;font-size:16px;line-height:1;flex-shrink:0">✕</button>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding:24px 24px 30px">' +
        '<p class="ldc-redtick" style="color:var(--text-body);margin-bottom:16px">Record</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--hairline);border:1px solid var(--hairline)">' + recHTML + '</div>' +
        '<p class="ldc-redtick" style="color:var(--text-body);margin:28px 0 18px">Timeline</p>' +
        '<div style="position:relative;padding-left:6px">' + logHTML + '</div>' +
      '</div>';
  }

  /* ---- State + wiring -------------------------------------------------- */

  var state = { rows: [], filter: "all", sort: "stage", selectedId: null,
                updatedLabel: "just now" };

  var appEl = document.getElementById("app");
  var drawerEl = document.getElementById("drawer");
  var backdropEl = document.getElementById("backdrop");

  function paint() {
    var vm = buildModel(state);
    appEl.innerHTML = render(vm, state);
    drawerEl.innerHTML = renderDrawer(vm.selected);
    var open = !!vm.selected;
    drawerEl.classList.toggle("is-open", open);
    drawerEl.setAttribute("aria-hidden", open ? "false" : "true");
    backdropEl.classList.toggle("is-open", open);
    updateClocks();
  }

  // Tick the reveal countdowns once a second by rewriting just their numbers,
  // so the rest of the dashboard (and the open drawer) is left untouched.
  function updateClocks() {
    var els = document.querySelectorAll("[data-cd]");
    for (var i = 0; i < els.length; i++) {
      els[i].innerHTML = clockHTML(Number(els[i].getAttribute("data-cd")),
                                   els[i].getAttribute("data-accent") === "1");
    }
  }
  setInterval(updateClocks, 1000);

  // Event delegation across the app + drawer.
  function onClick(e) {
    var t = e.target.closest("[data-action],[data-filter],[data-sort],[data-open]");
    if (!t) return;
    if (t.hasAttribute("data-action")) {
      var a = t.getAttribute("data-action");
      if (a === "refresh") return refresh();
      if (a === "close") return setSelected(null);
    } else if (t.hasAttribute("data-filter")) {
      state.filter = t.getAttribute("data-filter"); paint();
    } else if (t.hasAttribute("data-sort")) {
      state.sort = t.getAttribute("data-sort"); paint();
    } else if (t.hasAttribute("data-open")) {
      setSelected(t.getAttribute("data-open"));
    }
  }

  function setSelected(id) { state.selectedId = id; paint(); }

  appEl.addEventListener("click", onClick);
  drawerEl.addEventListener("click", onClick);
  backdropEl.addEventListener("click", function () { setSelected(null); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.selectedId) setSelected(null);
  });

  function refresh() {
    var pw = sessionStorage.getItem(SS_KEY);
    if (!pw) return;
    var label = document.getElementById("updatedLabel");
    if (label) label.textContent = "From Google Sheet · refreshing…";
    fetchData(pw).then(function (data) {
      if (data && data.ok) {
        state.rows = data.rows || [];
        applySettings(data.settings);
        state.updatedLabel = "just now";
        paint();
      }
    }).catch(function () {
      if (label) label.textContent = "From Google Sheet · refresh failed";
    });
  }

  /* ---- Gate ------------------------------------------------------------ */

  var gateEl = document.getElementById("gate");
  var gateForm = document.getElementById("gateForm");
  var gateInput = document.getElementById("gatePassword");
  var gateError = document.getElementById("gateError");
  var gateSubmit = document.getElementById("gateSubmit");

  function showDashboard(data) {
    state.rows = (data && data.rows) || [];
    applySettings(data && data.settings);
    state.updatedLabel = "just now";
    gateEl.hidden = true;
    appEl.hidden = false;
    paint();
  }

  function attempt(pw) {
    gateError.hidden = true;
    gateSubmit.disabled = true;
    gateSubmit.querySelector(".label").textContent = "Checking…";
    return fetchData(pw).then(function (data) {
      if (data && data.ok) {
        sessionStorage.setItem(SS_KEY, pw);
        showDashboard(data);
        return true;
      }
      throw new Error("denied");
    }).catch(function (err) {
      sessionStorage.removeItem(SS_KEY);
      gateError.textContent = (err && err.message === "denied")
        ? "That password didn't work. Try again."
        : "Couldn't reach the server. Check your connection and try again.";
      gateError.hidden = false;
      gateInput.value = "";
      gateInput.focus();
      return false;
    }).then(function (ok) {
      gateSubmit.disabled = false;
      gateSubmit.querySelector(".label").textContent = "Open";
      return ok;
    });
  }

  gateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = gateInput.value.trim();
    if (pw) attempt(pw);
  });

  // Already authenticated this tab? Skip the prompt.
  var saved = sessionStorage.getItem(SS_KEY);
  if (saved) {
    attempt(saved).then(function (ok) { if (!ok) gateInput.focus(); });
  } else {
    gateInput.focus();
  }
})();
