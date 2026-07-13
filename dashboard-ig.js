/* Instagram + Content Calendar tabs — Long Drive Club dashboard.
 *
 * Renders the two tabs dashboard.js added beside the signup view. All data
 * arrives from the Apps Script ?ig= feed (three sheet tabs: IG Post Log,
 * IG Weekly, IG Calendar) already normalised by normalize() below; nothing
 * here talks to the network. dashboard.js owns state, fetching and clicks —
 * this file only turns the model into HTML strings.
 *
 * Charts are hand-built inline SVG in the house palette: a single green for
 * every data mark (identity is carried by labels and rows, never by a colour
 * code), redline reserved for "today" and the reel tick, moss for the up
 * arrows. Every mark carries a data-tip attribute; dashboard.css styles the
 * shared tooltip div that dashboard.js positions on hover. */
(function () {
  "use strict";

  var GREEN = "var(--ldc-green)";
  var MOSS = "var(--ldc-moss)";
  var RED = "var(--ldc-redline)";
  var DIM = "var(--text-dim)";
  var DAY = 86400000;
  var MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
  var DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function toNum(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  function toDate(v) {
    if (!v) return null;
    var d = (v instanceof Date) ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function ddmm(d) { return pad(d.getDate()) + "/" + pad(d.getMonth() + 1); }
  function n0(v) { return v == null ? 0 : v; }
  function fmt(v) { return v == null ? "—" : String(Math.round(v * 10) / 10); }
  function fmtPct(v) { return v == null ? "—" : (Math.round(v * 1000) / 10) + "%"; }

  /* ---- Normalise the raw feed ------------------------------------------ */

  function normalize(payload) {
    var posts = (payload.posts || []).map(function (r) {
      var d = toDate(r.date);
      var likes = n0(toNum(r.likes)), comments = n0(toNum(r.comments)), saves = n0(toNum(r.saves));
      var views = toNum(r.views);
      var eng = likes + comments + saves;
      return {
        num: toNum(r.post), date: d, key: d ? dayKey(d) : "",
        format: String(r.format || "").trim(),
        type: String(r.content_type || "").trim(),
        subject: String(r.car_subject || "").trim(),
        cta: String(r.cta || "").trim(),
        feeling: String(r.feeling || "").trim(),
        views: views, reach: toNum(r.reach), pv: toNum(r.profile_visits),
        taps: toNum(r.link_taps), follows: toNum(r.follows),
        likes: likes, comments: comments, saves: saves,
        watch: toNum(r.watch_time_s),
        postedTime: String(r.posted_time || "").trim(),
        engagement: eng, er: views ? eng / views : null
      };
    }).filter(function (p) { return p.date; });
    posts.sort(function (a, b) { return (a.date - b.date) || ((a.num || 0) - (b.num || 0)); });

    var weekly = (payload.weekly || []).map(function (r) {
      var d = toDate(r.date);
      return { date: d, followers: toNum(r.followers), reach7: toNum(r.reach_7_days),
               pv7: toNum(r.profile_visits_7_days), taps7: toNum(r.link_taps_7_days),
               notes: String(r.notes || "") };
    }).filter(function (w) { return w.date && w.followers != null; });
    weekly.sort(function (a, b) { return a.date - b.date; });

    var calendar = (payload.calendar || []).map(function (r) {
      var d = toDate(r.date);
      return {
        date: d, key: "",
        format: String(r.format || "").trim(),
        theme: String(r.theme || "").trim(),
        peg: String(r.peg_milestone || "").trim(),
        concept: String(r.concept || "").trim(),
        asset: String(r.asset_to_produce || "").trim(),
        feeling: String(r.feeling || "").trim(),
        remark: String(r.the_remark || "").trim(),
        firstLine: String(r.caption_first_line || "").trim(),
        finalCopy: String(r.final_copy || "").replace(/\r/g, "").trim(),
        confirm: String(r.confirm_before_posting || "").trim(),
        // Per-row window override; no such sheet column yet, but if one is
        // added (Post window, HH:MM-HH:MM) this picks it up unchanged.
        postWindow: String(r.post_window || "").trim(),
        status: String(r.status || "Planned").trim()
      };
    }).filter(function (c) {
      // A dateless row is kept only when it's a held milestone post — the
      // "milestones interrupt, never own a day" rule. Anything else without
      // a date is noise.
      return c.date || c.status.toLowerCase() === "held";
    });
    calendar.sort(function (a, b) {
      var ta = a.date ? a.date.getTime() : Infinity;
      var tb = b.date ? b.date.getTime() : Infinity;
      return ta - tb;
    });
    calendar.forEach(function (c, i) { c.key = c.date ? dayKey(c.date) : "held-" + i; });

    var w = payload.windows || {};
    var windows = {
      weekday: String(w.weekday || "07:00-08:00"),
      weekend: String(w.weekend || "08:00-09:00"),
      tz: String(w.tz || "Europe/London")
    };

    return { posts: posts, weekly: weekly, calendar: calendar, windows: windows };
  }

  /* ---- Posting windows ---------------------------------------------------
     The window is config from the feed (weekday/weekend, Europe/London),
     with a per-row override hook (entry.postWindow) for when the sheet ever
     grows that column. All comparisons happen in the account's timezone so
     the state is right wherever the dashboard is opened. */

  function windowFor(model, entry, date) {
    var raw = entry && entry.postWindow;
    if (!raw) {
      var d = date || (entry && entry.date);
      if (!d) return null; // dateless held post: window is the day it slots into
      var dow = d.getDay();
      raw = (dow === 0 || dow === 6) ? model.windows.weekend : model.windows.weekday;
    }
    var m = String(raw).match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]),
             label: m[1] + ":" + m[2] + " to " + m[3] + ":" + m[4] };
  }

  // Minutes since midnight in the account's timezone, right now.
  function nowMinutes(model) {
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: model.windows.tz, hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date()).split(":");
    return Number(parts[0]) % 24 * 60 + Number(parts[1]);
  }

  function minutesLabel(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) return h + "h " + m + "m";
    if (h) return h + "h";
    return m + "m";
  }

  /* ---- Aggregation ------------------------------------------------------ */

  function sum(list, f) {
    var t = 0;
    list.forEach(function (x) { t += n0(f(x)); });
    return t;
  }
  function statsFor(list) {
    var views = sum(list, function (p) { return p.views; });
    var eng = sum(list, function (p) { return p.engagement; });
    return {
      n: list.length,
      views: views,
      reach: sum(list, function (p) { return p.reach; }),
      engagement: eng,
      pv: sum(list, function (p) { return p.pv; }),
      taps: sum(list, function (p) { return p.taps; }),
      er: views ? eng / views : null,
      avgViews: list.length ? views / list.length : null,
      avgReach: list.length ? sum(list, function (p) { return p.reach; }) / list.length : null,
      pvPerPost: list.length ? sum(list, function (p) { return p.pv; }) / list.length : null
    };
  }
  function between(posts, from, to) { // [from, to)
    return posts.filter(function (p) { return p.date >= from && p.date < to; });
  }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function groupRows(posts, keyFn) {
    var map = {}, order = [];
    posts.forEach(function (p) {
      var k = keyFn(p);
      if (!k) return;
      if (!map[k]) { map[k] = []; order.push(k); }
      map[k].push(p);
    });
    return order.map(function (k) { return { label: k, stats: statsFor(map[k]) }; });
  }

  // CTA strings vary post to post; fold them into the 4 registers that matter.
  function ctaGroup(p) {
    var c = p.cta.toLowerCase();
    if (!c || c === "none") return "None";
    if (c.indexOf("application") >= 0 || c.indexOf("request") >= 0) return "Mechanism";
    if (c.indexOf("ask") >= 0) return "Share ask";
    if (c.indexOf("link in bio") >= 0) return "Link in bio";
    return "Soft / other";
  }

  // Content types fold into the themes the calendar plans by.
  function themeGroup(p) {
    var t = p.type.toLowerCase();
    if (t.indexOf("editorial") >= 0) return "Editorial / ranked lists";
    if (t.indexOf("brand") >= 0) return "Brand announcement";
    if (t.indexOf("aerial") >= 0) return "Aerial";
    if (t.indexOf("graphic") >= 0) return "Car + graphic";
    if (t.indexOf("car on course") >= 0) return "Car on course";
    return p.type || "Other";
  }

  // What a post is called in lists: the car when there is one, the content
  // theme otherwise. "Mixed" and "None" are placeholders, never labels.
  function titleFor(p) {
    var s = p.subject;
    if (!s || s === "None" || s === "Mixed") return p.type || "Post " + p.num;
    return s;
  }
  function subLabelFor(p) {
    var s = p.subject;
    var themed = (!s || s === "None" || s === "Mixed");
    return ddmm(p.date) + " · " + (themed ? (p.feeling || "—") : p.type + (p.feeling ? " · " + p.feeling : ""));
  }

  /* ---- The signals: what the numbers actually say ------------------------
     Computed fresh from the log every render, with sample-size guards, so
     the top of the tab reads as findings rather than a wall of numbers. */
  function computeSignals(model) {
    var posts = model.posts;
    var out = [];
    var reels = posts.filter(function (p) { return p.format === "Reel"; });
    var images = posts.filter(function (p) { return p.format === "Image"; });
    var rs = statsFor(reels), is = statsFor(images), all = statsFor(posts);

    if (rs.n >= 2 && is.n >= 2 && rs.avgReach && is.avgReach && rs.avgReach / is.avgReach >= 1.5) {
      out.push({
        t: "Reels are the discovery engine",
        d: "A reel reaches " + fmt(rs.avgReach / is.avgReach) + "x the accounts an image does: " +
           fmt(rs.avgReach) + " against " + fmt(is.avgReach) + " per post. Reach comes from reels."
      });
    }
    if (all.pv > 0 && is.n >= 3) {
      var share = Math.round(is.pv / all.pv * 100);
      if (share >= 60) {
        out.push({
          t: "Images do the persuading",
          d: is.pv + " of " + all.pv + " profile visits came from images (" + share +
             "%). Reels pull strangers in. Images send them to the profile."
        });
      }
    }
    var mech = posts.filter(function (p) { return ctaGroup(p) === "Mechanism"; });
    var rest = posts.filter(function (p) { return ctaGroup(p) !== "Mechanism"; });
    var ms = statsFor(mech), os = statsFor(rest);
    if (ms.n >= 2 && ms.pvPerPost != null && os.pvPerPost != null && ms.pvPerPost >= os.pvPerPost * 1.5) {
      out.push({
        t: "Mechanism copy drives profile visits",
        d: "Posts naming the committee, the application or the 20 places average " +
           fmt(ms.pvPerPost) + " profile visits against " + fmt(os.pvPerPost) + " for everything else."
      });
    }
    var feels = groupRows(posts.filter(function (p) { return p.feeling && p.feeling.indexOf("None") !== 0; }),
      function (p) { return p.feeling; }).filter(function (r) { return r.stats.n >= 3; });
    feels.sort(function (a, b) { return (b.stats.er || 0) - (a.stats.er || 0); });
    if (feels.length) {
      out.push({
        t: feels[0].label + " earns the most engagement",
        d: fmtPct(feels[0].stats.er) + " engagement on views across " + feels[0].stats.n +
           " posts, the best of any feeling in the log."
      });
    }
    var watched = reels.filter(function (p) { return p.watch != null; });
    if (watched.length >= 2) {
      var last = watched[watched.length - 1];
      var best = Math.max.apply(null, watched.map(function (p) { return p.watch; }));
      if (last.watch <= best * 0.5) {
        out.push({
          t: "Reel hooks are losing viewers",
          d: last.watch + "s watch time on the latest reel against " + best +
             "s on the best. The strongest visual goes in the first 2 seconds."
        });
      }
    }
    return out.slice(0, 5);
  }

  /* ---- Small pieces ----------------------------------------------------- */

  function eyebrow(text, extra) {
    return '<p class="ldc-redtick" style="color:var(--text-body)' + (extra || "") + '">' + esc(text) + "</p>";
  }

  // The loud delta beside a weekly number: a filled pill, green up, red down,
  // chalk text on both — with the direction spelled out underneath, so colour
  // is never the only carrier.
  function deltaParts(cur, prev) {
    if (prev == null || cur == null) return { pill: "", sub: "no earlier window" };
    var diff = cur - prev;
    if (diff === 0) {
      return { pill: '<span class="sd-num" style="font-size:15px;color:' + DIM + '">→</span>', sub: "level with last week" };
    }
    var up = diff > 0;
    var pct = prev !== 0 ? Math.round(Math.abs(diff) / Math.abs(prev) * 100) + "%" : "+" + Math.abs(diff);
    return {
      pill: '<span class="sd-num" style="display:inline-block;padding:5px 9px 4px;border-radius:3px;font-size:14px;background:' +
        (up ? GREEN : RED) + ';color:var(--ldc-chalk)">' + (up ? "↑" : "↓") + " " + pct + "</span>",
      sub: (up ? "up from " : "down from ") + prev + " last week"
    };
  }

  function formatChip(format) {
    return '<span style="display:inline-block;padding:3px 7px;border:1px solid var(--hairline-strong);border-radius:3px;font-family:var(--font-display);font-size:9.5px;font-weight:700;letter-spacing:.14em;color:var(--text-body);white-space:nowrap">' + esc(format).toUpperCase() + "</span>";
  }

  function statusDot(entry, today) {
    var s = entry.status.toLowerCase();
    if (s === "posted" || s === "logged") return { bg: GREEN, bd: GREEN, label: entry.status };
    if (s === "ready" || s === "scheduled") return { bg: MOSS, bd: MOSS, label: entry.status };
    if (s === "held") return { bg: "transparent", bd: RED, label: "Held" };
    if (s === "skipped") return { bg: "transparent", bd: "var(--hairline-strong)", label: "Skipped" };
    if (entry.date && entry.date < today) return { bg: RED, bd: RED, label: "Planned · date passed" };
    return { bg: "transparent", bd: "var(--ldc-tarmac-dim)", label: "Planned" };
  }

  /* ---- Charts (inline SVG) ---------------------------------------------- */

  // Follower line: few points, so every point gets a dot and a direct label.
  function followerChart(weekly) {
    if (weekly.length < 1) return '<div style="font-size:13px;color:' + DIM + '">No weekly rows logged yet.</div>';
    var W = 560, H = 200, padL = 34, padR = 20, padT = 26, padB = 26;
    var xs = weekly.map(function (w) { return w.date.getTime(); });
    var ys = weekly.map(function (w) { return w.followers; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    if (x1 === x0) { x0 -= DAY; x1 += DAY; }
    var yMax = Math.max(10, Math.ceil(Math.max.apply(null, ys) * 1.2));
    var X = function (t) { return padL + (t - x0) / (x1 - x0) * (W - padL - padR); };
    var Y = function (v) { return H - padB - (v / yMax) * (H - padT - padB); };
    var path = weekly.map(function (w, i) { return (i ? "L" : "M") + X(w.date.getTime()).toFixed(1) + " " + Y(w.followers).toFixed(1); }).join(" ");
    var grid = [0, Math.round(yMax / 2), yMax].map(function (v) {
      return '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="var(--hairline)" stroke-width="1"/>' +
        '<text x="' + (padL - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--ldc-tarmac-dim)" font-family="Archivo,sans-serif">' + v + "</text>";
    }).join("");
    var dots = weekly.map(function (w) {
      var tip = ddmm(w.date) + " · " + w.followers + " followers" + (w.notes ? "|" + esc(w.notes) : "");
      return '<circle cx="' + X(w.date.getTime()).toFixed(1) + '" cy="' + Y(w.followers).toFixed(1) + '" r="4.5" fill="' + GREEN + '"/>' +
        '<text x="' + X(w.date.getTime()).toFixed(1) + '" y="' + (Y(w.followers) - 11).toFixed(1) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--ldc-tarmac)" font-family="Archivo,sans-serif">' + w.followers + "</text>" +
        '<text x="' + X(w.date.getTime()).toFixed(1) + '" y="' + (H - padB + 15) + '" text-anchor="middle" font-size="10" fill="var(--ldc-tarmac-dim)" font-family="Archivo,sans-serif">' + ddmm(w.date) + "</text>" +
        '<rect x="' + (X(w.date.getTime()) - 14).toFixed(1) + '" y="' + padT + '" width="28" height="' + (H - padT - padB) + '" fill="transparent" data-tip="' + tip + '"/>';
    }).join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:auto;display:block" role="img" aria-label="Followers by week">' +
      grid + '<path d="' + path + '" fill="none" stroke="' + GREEN + '" stroke-width="2"/>' + dots + "</svg>";
  }

  // Views per post: thin green bars, baseline-anchored, a redline tick under
  // each reel (shape, not colour, carries the format). Identity via hover.
  function viewsChart(posts) {
    if (!posts.length) return "";
    var W = 560, H = 210, padL = 34, padR = 8, padT = 14, padB = 30;
    var yMax = Math.max(10, Math.ceil(Math.max.apply(null, posts.map(function (p) { return n0(p.views); })) * 1.1));
    var innerW = W - padL - padR;
    var step = innerW / posts.length;
    var barW = Math.max(3, Math.min(14, step - 2));
    var Y = function (v) { return H - padB - (v / yMax) * (H - padT - padB); };
    var grid = [0, Math.round(yMax / 2), yMax].map(function (v) {
      return '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="var(--hairline)" stroke-width="1"/>' +
        '<text x="' + (padL - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--ldc-tarmac-dim)" font-family="Archivo,sans-serif">' + v + "</text>";
    }).join("");
    var bars = posts.map(function (p, i) {
      var x = padL + i * step + (step - barW) / 2;
      var v = n0(p.views);
      var y = Y(v), h = Math.max(1, H - padB - y);
      var tip = "Post " + p.num + " · " + ddmm(p.date) + "|" + esc(titleFor(p)) + (titleFor(p) !== p.type && p.type ? " · " + esc(p.type) : "") +
        "|" + p.format + " · " + v + " views · " + n0(p.reach) + " reach|" + p.engagement + " engagement · " + n0(p.pv) + " profile visits";
      var reelTick = p.format === "Reel"
        ? '<rect x="' + x.toFixed(1) + '" y="' + (H - padB + 4) + '" width="' + barW.toFixed(1) + '" height="3" fill="' + RED + '"/>' : "";
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + GREEN + '"/>' + reelTick +
        '<rect x="' + (padL + i * step).toFixed(1) + '" y="' + padT + '" width="' + step.toFixed(1) + '" height="' + (H - padT - padB + 8) + '" fill="transparent" data-tip="' + tip + '"/>';
    }).join("");
    var first = posts[0], last = posts[posts.length - 1];
    var xLabels = '<text x="' + padL + '" y="' + (H - 6) + '" font-size="10" fill="var(--ldc-tarmac-dim)" font-family="Archivo,sans-serif">' + ddmm(first.date) + "</text>" +
      '<text x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end" font-size="10" fill="var(--ldc-tarmac-dim)" font-family="Archivo,sans-serif">' + ddmm(last.date) + "</text>";
    return '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:auto;display:block" role="img" aria-label="Views by post">' +
      grid + bars + xLabels + "</svg>" +
      '<div style="display:flex;align-items:center;gap:7px;margin-top:8px;font-size:11.5px;color:' + DIM + '"><span style="width:12px;height:3px;background:' + RED + ';display:inline-block"></span>marks a reel</div>';
  }

  // Views against posted time: 1 dot per post with a logged Posted time, the
  // target windows shaded. Exists to TEST the window hypothesis — it draws
  // once 3 posts have times and gently nags for logs until then.
  function timeChart(posts, model) {
    var pts = [];
    posts.forEach(function (p) {
      var m = String(p.postedTime).match(/^(\d{1,2}):(\d{2})$/);
      if (m) pts.push({ p: p, mins: Number(m[1]) * 60 + Number(m[2]) });
    });
    if (pts.length < 3) {
      return '<div style="font-size:13px;color:' + DIM + ';line-height:1.6">Posted times logged: ' + pts.length +
        " of the 3 needed to draw this. The Posted time column (HH:MM) in the Post Log feeds it. " +
        "The window is a hypothesis. This chart is how it gets tested.</div>";
    }
    var W = 560, H = 200, padL = 34, padR = 16, padT = 14, padB = 30;
    var wd = windowFor(model, null, new Date(2026, 0, 5));  // any weekday
    var we = windowFor(model, null, new Date(2026, 0, 4));  // any weekend day
    var xs = pts.map(function (q) { return q.mins; });
    var x0 = Math.min.apply(null, xs.concat(wd ? [wd.start] : [])) - 45;
    var x1 = Math.max.apply(null, xs.concat(we ? [we.end] : [])) + 45;
    var yMax = Math.max(10, Math.ceil(Math.max.apply(null, pts.map(function (q) { return n0(q.p.views); })) * 1.15));
    var X = function (mins) { return padL + (mins - x0) / (x1 - x0) * (W - padL - padR); };
    var Y = function (v) { return H - padB - (v / yMax) * (H - padT - padB); };
    var hm = function (mins) { return pad(Math.floor(mins / 60)) + ":" + pad(mins % 60); };
    var band = "";
    [wd, we].forEach(function (w) {
      if (!w) return;
      band += '<rect x="' + X(w.start).toFixed(1) + '" y="' + padT + '" width="' + (X(w.end) - X(w.start)).toFixed(1) +
        '" height="' + (H - padT - padB) + '" fill="var(--ldc-chalk-down)"/>';
    });
    var grid = [0, Math.round(yMax / 2), yMax].map(function (v) {
      return '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="var(--hairline)" stroke-width="1"/>' +
        '<text x="' + (padL - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--ldc-tarmac-dim)" font-family="Archivo,sans-serif">' + v + "</text>";
    }).join("");
    var ticks = [];
    for (var t = Math.ceil(x0 / 120) * 120; t <= x1; t += 120) ticks.push(t);
    var xAxis = ticks.map(function (t2) {
      return '<text x="' + X(t2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="var(--ldc-tarmac-dim)" font-family="Archivo,sans-serif">' + hm(t2) + "</text>";
    }).join("");
    var dots = pts.map(function (q) {
      var tip = "Post " + q.p.num + " · " + ddmm(q.p.date) + " · posted " + hm(q.mins) + "|" +
        esc(titleFor(q.p)) + "|" + n0(q.p.views) + " views · " + n0(q.p.reach) + " reach";
      return '<circle cx="' + X(q.mins).toFixed(1) + '" cy="' + Y(n0(q.p.views)).toFixed(1) + '" r="5" fill="' + GREEN + '" stroke="var(--ldc-chalk)" stroke-width="2"/>' +
        '<rect x="' + (X(q.mins) - 12).toFixed(1) + '" y="' + padT + '" width="24" height="' + (H - padT - padB) + '" fill="transparent" data-tip="' + tip + '"/>';
    }).join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:auto;display:block" role="img" aria-label="Views by posted time">' +
      band + grid + dots + xAxis + "</svg>" +
      '<div style="display:flex;align-items:center;gap:7px;margin-top:8px;font-size:11.5px;color:' + DIM + '"><span style="width:12px;height:12px;background:var(--ldc-chalk-down);display:inline-block"></span>the target windows</div>';
  }

  /* ---- Insights tab ------------------------------------------------------ */

  function statCard(cur, prev, label) {
    var d = deltaParts(cur, prev);
    return '<div style="background:var(--ldc-chalk);padding:18px 22px">' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<span class="sd-num" style="font-size:30px;color:var(--text-body)">' + cur + "</span>" + d.pill +
      "</div>" +
      '<div class="sd-eyebrow" style="color:' + DIM + ';margin-top:9px;line-height:1.4;text-wrap:balance">' + esc(label) + "</div>" +
      '<div style="margin-top:7px;font-size:11.5px;color:' + DIM + '">' + esc(d.sub) + "</div>" +
    "</div>";
  }

  // One cut of the log (by format / theme / feeling). Each table shows only
  // the 2 metrics that matter for that cut — cols is [{label, fn, fmt}] and
  // the bar tracks the first column within the table.
  function tableHTML(title, note, rows, cols) {
    var barMax = 0;
    rows.forEach(function (r) { barMax = Math.max(barMax, cols[0].fn(r.stats) || 0); });
    var body = rows.map(function (r) {
      var pct = barMax ? Math.round((cols[0].fn(r.stats) || 0) / barMax * 100) : 0;
      return '<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--hairline)">' +
        '<span style="flex:1 1 120px;min-width:0;font-size:13px;color:var(--text-body)">' + esc(r.label) +
          ' <span style="color:' + DIM + ';font-size:11.5px;white-space:nowrap">· ' + r.stats.n + (r.stats.n === 1 ? " post" : " posts") + "</span></span>" +
        '<span class="igt-bar" style="flex:1 1 90px;height:14px;background:var(--ldc-chalk-down);display:flex;align-items:center"><span style="width:' + pct + '%;background:' + GREEN + ';height:100%;display:block"></span></span>' +
        cols.map(function (c, i) {
          return '<span class="' + (i ? "sd-num igt-col" : "sd-num") + '" style="flex:0 0 52px;text-align:right;font-size:' + (i ? "13px" : "15px") + '">' + c.fmt(c.fn(r.stats)) + "</span>";
        }).join("") +
      "</div>";
    }).join("");
    return '<div style="background:var(--ldc-chalk);padding:22px 24px 12px">' +
      '<div class="sd-eyebrow" style="color:' + DIM + '">' + esc(title) + "</div>" +
      '<div style="font-size:12px;color:' + DIM + ';margin-top:5px">' + esc(note) + "</div>" +
      '<div style="display:flex;gap:12px;padding:10px 0 4px;border-bottom:1px solid var(--hairline-strong)">' +
        '<span style="flex:1 1 120px"></span><span class="igt-bar" style="flex:1 1 90px"></span>' +
        cols.map(function (c, i) {
          return '<span class="sd-eyebrow' + (i ? " igt-col" : "") + '" style="flex:0 0 52px;text-align:right;font-size:9px;color:' + DIM + '">' + esc(c.label) + "</span>";
        }).join("") +
      "</div>" + body +
    "</div>";
  }

  function topList(title, list, metricFn, metricLabelFn) {
    var rows = list.length ? list.map(function (p, i) {
      var tip = "Post " + p.num + " · " + ddmm(p.date) + "|" + n0(p.views) + " views · " + n0(p.reach) + " reach|" +
        p.likes + " likes · " + p.comments + " comments · " + p.saves + " saves|" + n0(p.pv) + " profile visits · " + n0(p.taps) + " link taps";
      return '<div data-tip="' + tip + '" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--hairline)">' +
        '<span class="sd-num" style="flex:0 0 20px;font-size:14px;color:' + DIM + '">' + (i + 1) + "</span>" +
        '<span style="flex:1;min-width:0"><span style="display:block;font-size:13.5px;color:var(--text-body);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          esc(titleFor(p)) + "</span>" +
          '<span style="font-size:11.5px;color:' + DIM + '">' + esc(subLabelFor(p)) + "</span></span>" +
        formatChip(p.format) +
        '<span class="sd-num" style="flex:0 0 44px;text-align:right;font-size:17px">' + metricFn(p) + "</span>" +
        '<span class="igt-col" style="flex:0 0 52px;font-size:10.5px;color:' + DIM + '">' + metricLabelFn(p) + "</span>" +
      "</div>";
    }).join("") : '<div style="padding:18px 0;font-size:13px;color:' + DIM + '">Nothing posted in this window.</div>';
    return '<div style="flex:1 1 320px;background:var(--ldc-chalk);padding:20px 24px 10px">' +
      '<div class="sd-eyebrow" style="color:' + DIM + ';margin-bottom:6px">' + esc(title) + "</div>" + rows + "</div>";
  }

  function renderInsights(model, ui) {
    var posts = model.posts, weekly = model.weekly;
    var now = new Date();
    var today0 = startOfDay(now);
    var tomorrow = new Date(today0.getTime() + DAY);

    // Follower headline: latest weekly row against the one before it.
    var latestW = weekly[weekly.length - 1] || null;
    var prevW = weekly[weekly.length - 2] || null;
    var followers = latestW ? latestW.followers : null;

    // Rolling 7 days against the 7 before.
    var wkFrom = new Date(tomorrow.getTime() - 7 * DAY);
    var prevFrom = new Date(tomorrow.getTime() - 14 * DAY);
    var thisWk = statsFor(between(posts, wkFrom, tomorrow));
    var lastWk = statsFor(between(posts, prevFrom, wkFrom));

    // This calendar month against June (the launch month).
    var monthFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    var monthPosts = between(posts, monthFrom, tomorrow);
    var june = posts.filter(function (p) { return p.date.getFullYear() === 2026 && p.date.getMonth() === 5; });
    var mStats = statsFor(monthPosts), jStats = statsFor(june);
    var monthName = MONTHS[now.getMonth()];

    // Top content for the chosen window.
    var range = ui.range || "week";
    var rFrom = range === "day" ? today0 : range === "week" ? wkFrom : monthFrom;
    var rPosts = between(posts, rFrom, tomorrow);
    var byViews = rPosts.slice().sort(function (a, b) { return n0(b.views) - n0(a.views); }).slice(0, 5);
    var byEng = rPosts.slice().sort(function (a, b) { return (b.engagement - a.engagement) || (n0(b.views) - n0(a.views)); }).slice(0, 5);

    var chipsHTML = ["day", "week", "month"].map(function (k) {
      var on = range === k;
      var label = k === "day" ? "Today" : k === "week" ? "7 days" : "This month";
      return '<button class="sd-chip" data-igrange="' + k + '" style="display:inline-flex;cursor:pointer;font-family:var(--font-display);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:7px 13px;border-radius:3px;background:' +
        (on ? "var(--ldc-green)" : "transparent") + ";color:" + (on ? "var(--ldc-chalk)" : "var(--text-body)") + ";border:1px solid " + (on ? "transparent" : "var(--hairline-strong)") + '">' + label + "</button>";
    }).join("");

    var cards =
      statCard(thisWk.views, lastWk.views, "Views · 7 days") +
      statCard(thisWk.reach, lastWk.reach, "Reach · 7 days") +
      statCard(thisWk.pv, lastWk.pv, "Profile visits · 7 days") +
      statCard(thisWk.engagement, lastWk.engagement, "Engagement · 7 days") +
      statCard(thisWk.taps, lastWk.taps, "Link taps · 7 days") +
      statCard(thisWk.n, lastWk.n, "Posts · 7 days");

    // The header verdict: this week against last, spelled out.
    var verdictBits = [["views", thisWk.views, lastWk.views], ["reach", thisWk.reach, lastWk.reach], ["profile visits", thisWk.pv, lastWk.pv]]
      .map(function (b) {
        if (b[2] == null || b[2] === 0) return null;
        var diff = b[1] - b[2];
        if (diff === 0) return null;
        var up = diff > 0;
        var pct = Math.round(Math.abs(diff) / b[2] * 100);
        return '<span style="white-space:nowrap;color:' + (up ? MOSS : RED) + ';font-weight:700">' +
          (up ? "↑" : "↓") + " " + esc(b[0]) + " " + pct + "%</span>";
      }).filter(Boolean);
    var verdictHTML = verdictBits.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:12px;font-size:14.5px">' +
        '<span style="color:var(--ldc-chalk-dim)">This week:</span>' + verdictBits.join("") + "</div>"
      : "";

    var signals = computeSignals(model);
    var signalsHTML = signals.length ?
      '<div class="sd-pad" style="padding:28px 30px 0;display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:12px">' +
        eyebrow("The signals") +
        '<span style="font-size:12px;color:' + DIM + '">Computed from the log. Small sample, direction beats decimals.</span>' +
      "</div>" +
      '<div class="ig-wrap" style="display:flex;flex-wrap:wrap;gap:1px;background:var(--hairline);margin:16px 30px 28px;border:1px solid var(--hairline)">' +
        signals.map(function (s, i) {
          return '<div style="flex:1 1 280px;background:var(--ldc-chalk);padding:20px 24px 22px">' +
            '<div class="sd-num" style="font-size:15px;color:' + RED + '">' + pad(i + 1) + "</div>" +
            '<div class="sd-disp" style="font-size:16px;margin-top:10px">' + esc(s.t) + "</div>" +
            '<div style="font-size:13px;line-height:1.55;color:' + DIM + ';margin-top:9px">' + esc(s.d) + "</div>" +
          "</div>";
        }).join("") +
      "</div>" : "";

    var compareRows = [
      ["Posts", jStats.n, mStats.n, false],
      ["Avg views per post", jStats.avgViews, mStats.avgViews, false],
      ["Avg reach per post", jStats.avgReach, mStats.avgReach, false],
      ["ER on views", jStats.er, mStats.er, true],
      ["Profile visits per post", jStats.pvPerPost, mStats.pvPerPost, false]
    ].map(function (r) {
      var f = r[3] ? fmtPct : fmt;
      return '<div style="display:flex;align-items:center;gap:14px;padding:9px 0;border-bottom:1px solid var(--hairline)">' +
        '<span style="flex:1;font-size:13px;color:var(--text-body)">' + esc(r[0]) + "</span>" +
        '<span class="sd-num" style="flex:0 0 64px;text-align:right;font-size:16px;color:' + DIM + '">' + f(r[1]) + "</span>" +
        '<span style="flex:0 0 18px;text-align:center;color:' + DIM + '">→</span>' +
        '<span class="sd-num" style="flex:0 0 64px;text-align:right;font-size:16px">' + f(r[2]) + "</span>" +
      "</div>";
    }).join("");

    var fmtRows = groupRows(posts, function (p) { return p.format; });
    var themeRows = groupRows(posts, themeGroup);
    var feelRows = groupRows(posts, function (p) { return p.feeling.indexOf("None") === 0 ? "Announcement" : p.feeling; });
    var byViewsSort = function (a, b) { return (b.stats.avgViews || 0) - (a.stats.avgViews || 0); };
    fmtRows.sort(byViewsSort); themeRows.sort(byViewsSort);
    feelRows.sort(function (a, b) { return (b.stats.er || 0) - (a.stats.er || 0); });

    var colViews = { label: "Views", fn: function (s) { return s.avgViews; }, fmt: fmt };
    var colReach = { label: "Reach", fn: function (s) { return s.avgReach; }, fmt: fmt };
    var colVisits = { label: "Visits", fn: function (s) { return s.pvPerPost; }, fmt: fmt };
    var colER = { label: "ER", fn: function (s) { return s.er; }, fmt: fmtPct };
    var colEng = { label: "Eng", fn: function (s) { return s.n ? s.engagement / s.n : null; }, fmt: fmt };

    var all = statsFor(posts);

    return '' +
      '<div class="ldc-dark sd-pad" style="display:flex;flex-wrap:wrap;gap:18px 30px;justify-content:space-between;align-items:flex-end;padding:26px 30px 24px;background:var(--ldc-green);color:var(--ldc-chalk)">' +
        '<div><div class="sd-eyebrow" style="color:var(--ldc-chalk-dim);margin-bottom:7px">Instagram · top of funnel</div>' +
          '<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">' +
            '<span class="sd-num" style="font-size:64px">' + (followers == null ? "—" : followers) + "</span>" +
            '<span style="font-size:13px;color:var(--ldc-chalk-dim)">followers</span>' +
            (latestW && prevW ? '<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border:1px solid var(--ldc-moss);border-radius:3px;color:var(--ldc-moss);font-size:12.5px;font-weight:700">' +
              (latestW.followers >= prevW.followers ? "↑" : "↓") + " " + Math.abs(latestW.followers - prevW.followers) +
              ' <span style="font-weight:400">since ' + ddmm(prevW.date) + "</span></span>" : "") +
          "</div>" +
          (latestW ? '<div style="font-size:12px;color:var(--ldc-chalk-dim);margin-top:8px">Logged ' + ddmm(latestW.date) + " · " + all.n + " posts · " + all.views + " views · " + all.reach + " reach · " + all.pv + " profile visits all time</div>" : "") +
          verdictHTML +
        "</div>" +
        '<div style="display:flex;align-items:center;gap:16px">' +
          '<span style="font-size:12px;color:var(--ldc-chalk-dim)">From Google Sheet · ' + esc(ui.updatedLabel || "just now") + "</span>" +
          '<button class="btn btn--secondary btn--sm" data-action="refresh-ig"><span class="label">↻ Refresh</span></button>' +
        "</div>" +
      "</div>" +

      signalsHTML +

      '<div class="sd-pad" style="padding:0 30px 0">' + eyebrow("The week in numbers") + "</div>" +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(172px,1fr));gap:1px;background:var(--hairline);border-top:1px solid var(--hairline);border-bottom:1px solid var(--hairline);margin-top:14px">' + cards + "</div>" +

      '<div style="display:flex;flex-wrap:wrap;gap:1px;background:var(--hairline)">' +
        '<div style="flex:1 1 340px;background:var(--ldc-chalk);padding:24px 30px">' +
          '<div class="sd-eyebrow" style="color:' + DIM + ';margin-bottom:16px">Followers</div>' + followerChart(weekly) +
          '<div style="font-size:11.5px;color:' + DIM + ';margin-top:8px">1 row logged each Sunday in the IG Weekly tab.</div>' +
        "</div>" +
        '<div style="flex:1 1 340px;background:var(--ldc-chalk);padding:24px 30px">' +
          '<div class="sd-eyebrow" style="color:' + DIM + ';margin-bottom:16px">Views by post · all time</div>' + viewsChart(posts) +
        "</div>" +
        '<div style="flex:1 1 340px;background:var(--ldc-chalk);padding:24px 30px">' +
          '<div class="sd-eyebrow" style="color:' + DIM + ';margin-bottom:16px">Views by posted time</div>' + timeChart(posts, model) +
        "</div>" +
      "</div>" +

      '<div class="sd-pad" style="padding:26px 30px 0;display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:12px">' +
        eyebrow("Top content") +
        '<div style="display:flex;gap:9px">' + chipsHTML + "</div>" +
      "</div>" +
      '<div class="ig-wrap" style="display:flex;flex-wrap:wrap;gap:1px;background:var(--hairline);margin:16px 30px 0;border:1px solid var(--hairline)">' +
        topList("Most watched", byViews, function (p) { return n0(p.views); }, function (p) { return p.format === "Reel" && p.watch != null ? p.watch + "s watch" : "views"; }) +
        topList("Most engaged", byEng, function (p) { return p.engagement; }, function (p) { return fmtPct(p.er) + " ER"; }) +
      "</div>" +

      '<div class="sd-pad" style="padding:28px 30px 0">' + eyebrow("What is working") + "</div>" +
      '<div class="ig-wrap" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1px;background:var(--hairline);margin:16px 30px 0;border:1px solid var(--hairline)">' +
        tableHTML("By format", "Reach is discovery. Per post.", fmtRows, [colViews, colReach]) +
        tableHTML("By theme", "Profile visits show persuasion. Per post.", themeRows, [colViews, colVisits]) +
        tableHTML("By feeling", "ER is engagement on views.", feelRows, [colER, colEng]) +
      "</div>" +

      '<div class="ig-wrap" style="margin:26px 30px 40px">' +
        '<div style="max-width:560px;background:var(--ldc-chalk);padding:20px 24px;border:1px solid var(--hairline)">' +
          '<div class="sd-eyebrow" style="color:' + DIM + ';margin-bottom:12px">This month against June · per post</div>' +
          '<div style="display:flex;gap:14px;padding:0 0 6px;border-bottom:1px solid var(--hairline-strong)">' +
            '<span style="flex:1"></span>' +
            '<span class="sd-eyebrow" style="flex:0 0 64px;text-align:right;font-size:9px;color:' + DIM + '">June</span>' +
            '<span style="flex:0 0 18px"></span>' +
            '<span class="sd-eyebrow" style="flex:0 0 64px;text-align:right;font-size:9px;color:' + DIM + '">' + esc(monthName) + "</span>" +
          "</div>" + compareRows +
          '<div style="padding-top:8px;font-size:11px;color:' + DIM + '">June ' + jStats.n + " posts → " + esc(monthName) + " " + mStats.n + " posts. June's 12 in 1 day drag its averages.</div>" +
        "</div>" +
      "</div>";
  }

  /* ---- Calendar tab ------------------------------------------------------ */

  function monthKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }

  // The full-width state strip under the calendar header. A leftBorder makes
  // it read as a flag (the missed state) without shouting in red text.
  function banner(bg, fg, text, leftBorder) {
    return '<div class="sd-pad" style="padding:14px 30px;background:' + bg + ';color:' + fg +
      ';border-bottom:1px solid var(--hairline)' +
      (leftBorder ? ";border-left:5px solid " + leftBorder : "") +
      ';font-family:var(--font-display);font-size:14px;font-weight:700;letter-spacing:.03em">' +
      esc(text) + "</div>";
  }

  function planCard(model, title, entry, today, fallbackText) {
    var inner;
    if (entry) {
      var dot = statusDot(entry, today);
      var win = windowFor(model, entry);
      inner =
        '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:10px">' +
          formatChip(entry.format) +
          '<span class="sd-eyebrow" style="font-size:10px;color:' + DIM + '">' + esc(entry.theme) + "</span>" +
          '<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:' + DIM + '"><span style="width:8px;height:8px;border-radius:50%;background:' + dot.bg + ';border:1.5px solid ' + dot.bd + '"></span>' + esc(dot.label) + "</span>" +
        "</div>" +
        '<div class="sd-disp" style="font-size:17px;margin-bottom:8px">' + esc(entry.firstLine || entry.concept) + "</div>" +
        '<div style="font-size:12.5px;color:var(--text-body);margin-bottom:6px;font-weight:700">Window ' +
          (win ? esc(win.label) : "set by the day it slots into") + "</div>" +
        (entry.peg ? '<div style="font-size:12.5px;color:var(--text-body);margin-bottom:6px">Peg: ' + esc(entry.peg) + "</div>" : "") +
        '<div style="font-size:12.5px;color:' + DIM + ';margin-bottom:14px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">Asset: ' + esc(entry.asset) + "</div>" +
        '<button class="sd-chip" data-calday="' + entry.key + '" style="cursor:pointer;font-family:var(--font-display);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:8px 14px;border-radius:3px;background:var(--ldc-green);color:var(--ldc-chalk);border:none">Open the brief →</button>';
    } else {
      inner = '<div style="font-size:13.5px;color:' + DIM + ';padding:6px 0 2px">' + esc(fallbackText) + "</div>";
    }
    return '<div style="flex:1 1 300px;background:var(--ldc-chalk);padding:20px 24px 22px">' +
      '<div class="sd-eyebrow" style="color:' + DIM + ';margin-bottom:12px">' + esc(title) + "</div>" + inner + "</div>";
  }

  function renderCalendar(model, ui) {
    var today = startOfDay(new Date());
    var mk = ui.month || monthKey(today);
    var parts = mk.split("-");
    var year = Number(parts[0]), month = Number(parts[1]) - 1;

    var byDay = {};
    model.calendar.forEach(function (c) { byDay[c.key] = byDay[c.key] || {}; byDay[c.key].plan = c; });
    model.posts.forEach(function (p) {
      byDay[p.key] = byDay[p.key] || {};
      (byDay[p.key].posts = byDay[p.key].posts || []).push(p);
    });

    var todayEntry = null, nextEntry = null, heldEntries = [];
    model.calendar.forEach(function (c) {
      if (c.key === dayKey(today)) todayEntry = c;
      if (!nextEntry && c.date && c.date > today) nextEntry = c;
      if (c.status.toLowerCase() === "held") heldEntries.push(c);
    });

    // From midday, tomorrow's post becomes "schedule tonight" — the evening
    // is the standard prep moment, not the morning of.
    var now = nowMinutes(model);
    var tomorrowKey = dayKey(new Date(today.getTime() + DAY));
    var nextIsTonight = nextEntry && nextEntry.key === tomorrowKey && now >= 12 * 60;
    var nextTitle = nextEntry
      ? (nextIsTonight ? "Schedule tonight in IG · " : "Next · ") +
        DOWS[(nextEntry.date.getDay() + 6) % 7] + " " + ddmm(nextEntry.date)
      : "Next";
    var heldCards = heldEntries.map(function (h) {
      return planCard(model, "Held · on 24 hours' notice", h, today, "");
    }).join("");

    // Today's window state. Late is a fact to record, never a blocker.
    var stateHTML = "";
    if (todayEntry) {
      var win = windowFor(model, todayEntry);
      var done = ["posted", "logged"].indexOf(todayEntry.status.toLowerCase()) >= 0;
      if (done) {
        stateHTML = banner(GREEN, "var(--ldc-chalk)",
          "Posted. Log the stats and the posted time in the Post Log within 24 hours.");
      } else if (win && now < win.start) {
        stateHTML = banner("var(--ldc-chalk)", "var(--text-body)",
          "Posts today · window " + win.label + " · opens in " + minutesLabel(win.start - now));
      } else if (win && now <= win.end) {
        stateHTML = banner(RED, "var(--ldc-chalk)",
          "The window is open. Post before " + win.label.split(" to ")[1] + ".");
      } else if (win) {
        stateHTML = banner("var(--ldc-chalk)", "var(--text-body)",
          "Window missed (" + win.label + "). Post anyway, then log the actual time in the Post Log.", RED);
      }
    }

    // Build the Monday-first grid.
    var first = new Date(year, month, 1);
    var lead = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var cells = [];
    for (var i = 0; i < lead; i++) cells.push(null);
    for (var d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7) cells.push(null);

    var headHTML = DOWS.map(function (w) {
      return '<div class="sd-eyebrow" style="font-size:9.5px;color:' + DIM + ';padding:9px 10px;background:var(--ldc-chalk)">' + w + "</div>";
    }).join("");

    var cellsHTML = cells.map(function (d) {
      if (!d) return '<div class="cal-cell" style="background:var(--ldc-chalk);opacity:.45;min-height:86px;min-width:0"></div>';
      var key = dayKey(d);
      var info = byDay[key] || {};
      var isToday = key === dayKey(today);
      var clickable = info.plan || (info.posts && info.posts.length);
      var bits = '<div style="display:flex;align-items:baseline;justify-content:space-between">' +
        '<span class="sd-num" style="font-size:14px;color:' + (isToday ? RED : "var(--text-body)") + '">' + d.getDate() + "</span>" +
        (isToday ? '<span class="sd-eyebrow" style="font-size:8px;color:' + RED + '">Today</span>' : "") +
      "</div>";
      if (info.plan) {
        var dot = statusDot(info.plan, today);
        var cellWin = windowFor(model, info.plan);
        bits += '<div class="cal-plan" style="margin-top:7px">' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:' + dot.bg + ';border:1.5px solid ' + dot.bd + '" title="' + esc(dot.label) + '"></span>' +
            '<span class="sd-eyebrow cal-fmt" style="font-size:8.5px;color:var(--text-body);letter-spacing:.14em">' + esc(info.plan.format) + "</span>" +
          "</div>" +
          '<div class="cal-theme" style="font-size:11px;color:var(--text-body);margin-top:4px;line-height:1.35">' + esc(info.plan.theme) + "</div>" +
          (cellWin ? '<div class="cal-theme" style="font-size:10px;color:' + DIM + ';margin-top:3px">' + esc(cellWin.label) + "</div>" : "") +
        "</div>";
      }
      if (info.posts) {
        var v = sum(info.posts, function (p) { return p.views; });
        bits += '<div class="cal-theme" style="font-size:10.5px;color:' + DIM + ';margin-top:6px">' +
          (info.posts.length === 1 ? "posted · " + v + " views" : info.posts.length + " posted · " + v + " views") + "</div>";
      }
      return '<div class="cal-cell" ' + (clickable ? 'data-calday="' + key + '" ' : "") +
        'style="background:var(--ldc-chalk);min-height:86px;min-width:0;overflow:hidden;padding:8px 10px;position:relative;' +
        (clickable ? "cursor:pointer;" : "") + (isToday ? "box-shadow:inset 0 0 0 2px " + RED + ";" : "") + '">' + bits + "</div>";
    }).join("");

    return '' +
      '<div class="ldc-dark sd-pad" style="display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;align-items:flex-end;padding:22px 30px 20px;background:var(--ldc-green);color:var(--ldc-chalk)">' +
        '<div><div class="sd-eyebrow" style="color:var(--ldc-chalk-dim);margin-bottom:7px">Content calendar</div>' +
          '<div style="display:flex;align-items:center;gap:14px">' +
            '<button class="btn btn--secondary btn--sm" data-calnav="-1" aria-label="Earlier month"><span class="label">←</span></button>' +
            '<span class="sd-disp" style="font-size:24px;min-width:200px;text-align:center">' + MONTHS[month] + " " + year + "</span>" +
            '<button class="btn btn--secondary btn--sm" data-calnav="1" aria-label="Later month"><span class="label">→</span></button>' +
          "</div>" +
        "</div>" +
        '<div style="display:flex;align-items:center;gap:16px">' +
          '<span style="font-size:12px;color:var(--ldc-chalk-dim)">From Google Sheet · ' + esc(ui.updatedLabel || "just now") + "</span>" +
          '<button class="btn btn--secondary btn--sm" data-action="refresh-ig"><span class="label">↻ Refresh</span></button>' +
        "</div>" +
      "</div>" +

      stateHTML +

      '<div style="display:flex;flex-wrap:wrap;gap:1px;background:var(--hairline);border-bottom:1px solid var(--hairline)">' +
        planCard(model, "Today · " + DOWS[(today.getDay() + 6) % 7] + " " + ddmm(today), todayEntry, today,
          "Nothing posts today. The cadence is 3 to 4 grid posts a week on purpose.") +
        planCard(model, nextTitle, nextEntry, today, "No planned posts ahead. Time to write the next 4 weeks.") +
        heldCards +
      "</div>" +

      '<div class="sd-pad" style="padding:24px 30px 8px">' + eyebrow("The month") +
        '<div style="font-size:12px;color:' + DIM + ';margin-top:6px">A dot is a planned post. Open a day for the brief, the asset and the copy. Grey text is a logged result.</div>' +
      "</div>" +
      '<div class="sd-pad" style="padding:10px 30px 40px">' +
        '<div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;background:var(--hairline);border:1px solid var(--hairline)">' + headHTML + cellsHTML + "</div>" +
      "</div>";
  }

  /* ---- Day drawer -------------------------------------------------------- */

  function drawerBlock(label, value, pre) {
    if (!value) return "";
    return '<div style="margin-bottom:18px"><div class="sd-eyebrow" style="font-size:10px;letter-spacing:.24em;color:' + DIM + ';margin-bottom:6px">' + esc(label) + "</div>" +
      '<div style="font-size:14px;line-height:1.55;color:var(--text-body)' + (pre ? ";white-space:pre-wrap" : "") + '">' + esc(value) + "</div></div>";
  }

  function renderCalDrawer(model, key) {
    var plan = null, logged = [];
    model.calendar.forEach(function (c) { if (c.key === key) plan = c; });
    model.posts.forEach(function (p) { if (p.key === key) logged.push(p); });
    if (!plan && !logged.length) return "";

    var d = toDate(key);
    var dateLabel = d
      ? DOWS[(d.getDay() + 6) % 7] + " " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear()
      : "Held · runs when founders confirm the trigger";
    var title = plan ? plan.theme : "Posted";
    var today = startOfDay(new Date());

    var head =
      '<div class="stripe" aria-hidden="true" style="height:4px"><span></span><span></span><span></span></div>' +
      '<div class="ldc-dark" style="background:var(--ldc-green);color:var(--ldc-chalk);padding:20px 24px;display:flex;align-items:center;gap:16px">' +
        '<div style="flex:1;min-width:0"><div class="sd-eyebrow" style="color:var(--ldc-chalk-dim);margin-bottom:6px">' + esc(dateLabel) + "</div>" +
          '<div class="sd-disp" style="font-size:20px">' + esc(title) + "</div></div>" +
        '<button data-action="close" aria-label="Close" style="background:none;border:1px solid var(--hairline-strong);color:var(--ldc-chalk);width:32px;height:32px;border-radius:3px;cursor:pointer;font-size:16px;line-height:1;flex-shrink:0">✕</button>' +
      "</div>";

    var body = "";
    if (plan) {
      var dot = statusDot(plan, today);
      var win = windowFor(model, plan);
      body +=
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:20px">' +
          formatChip(plan.format) +
          (plan.feeling ? '<span style="display:inline-block;padding:3px 9px;border:1px solid var(--hairline-strong);border-radius:3px;font-size:11.5px;color:var(--text-body)">' + esc(plan.feeling) + "</span>" : "") +
          '<span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:' + DIM + '"><span style="width:8px;height:8px;border-radius:50%;background:' + dot.bg + ';border:1.5px solid ' + dot.bd + '"></span>' + esc(dot.label) + "</span>" +
        "</div>" +
        drawerBlock("Posting window", win ? win.label : "Set by the day it slots into. Weekdays " +
          model.windows.weekday.replace("-", " to ") + ", weekends " + model.windows.weekend.replace("-", " to ") + ".") +
        drawerBlock("Peg / milestone", plan.peg) +
        drawerBlock("Concept", plan.concept) +
        drawerBlock("Asset to produce", plan.asset) +
        (plan.remark ? '<div style="margin-bottom:18px"><div class="sd-eyebrow" style="font-size:10px;letter-spacing:.24em;color:' + DIM + ';margin-bottom:6px">The remark</div>' +
          '<div style="font-family:var(--font-voice);font-style:italic;font-size:16px;color:var(--text-body)">&ldquo;' + esc(plan.remark) + '&rdquo;</div></div>' : "") +
        (plan.confirm ? '<div style="margin-bottom:18px;padding:13px 15px;border-left:3px solid ' + RED + ';background:var(--ldc-chalk-down)">' +
          '<div class="sd-eyebrow" style="font-size:10px;letter-spacing:.24em;color:' + RED + ';margin-bottom:6px">Confirm before posting</div>' +
          '<div style="font-size:13.5px;line-height:1.55;color:var(--text-body)">' + esc(plan.confirm) + "</div></div>" : "");

      if (plan.finalCopy) {
        body +=
          '<div style="margin-bottom:20px"><div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px">' +
            '<div class="sd-eyebrow" style="font-size:10px;letter-spacing:.24em;color:' + DIM + '">Final copy · draft</div>' +
            '<button data-copy="' + esc(plan.finalCopy) + '" style="cursor:pointer;font-family:var(--font-display);font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:7px 13px;border-radius:3px;background:var(--ldc-green);color:var(--ldc-chalk);border:none">Copy</button>' +
          "</div>" +
          '<div style="white-space:pre-wrap;font-size:14px;line-height:1.6;color:var(--text-body);background:var(--ldc-chalk-down);padding:15px 16px">' + esc(plan.finalCopy) + "</div>" +
          '<div style="font-size:11px;color:' + DIM + ';margin-top:7px">Runs through ldc-copywriter and the confirm gate before it ships.</div></div>';
      } else {
        body += drawerBlock("Caption first line", plan.firstLine) +
          '<div style="margin-bottom:20px;font-size:12.5px;color:' + DIM + '">No final copy yet. It drafts nearer the time, through ldc-copywriter.</div>';
      }
    }

    if (logged.length) {
      body += '<p class="ldc-redtick" style="color:var(--text-body);margin:6px 0 16px">Logged result</p>';
      logged.forEach(function (p) {
        var cells = [
          ["Views", n0(p.views)], ["Reach", n0(p.reach)], ["Engagement", p.engagement],
          ["Profile visits", n0(p.pv)], ["Link taps", n0(p.taps)], ["ER on views", fmtPct(p.er)]
        ];
        if (p.watch != null) cells.push(["Watch time", p.watch + "s"]);
        body += '<div style="margin-bottom:18px">' +
          '<div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">' + formatChip(p.format) +
            '<span style="font-size:13px;color:var(--text-body)">' + esc(titleFor(p)) + "</span>" +
            '<span style="font-size:11.5px;color:' + DIM + '">Post ' + p.num + "</span></div>" +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--hairline);border:1px solid var(--hairline)">' +
            cells.map(function (c) {
              return '<div style="background:var(--ldc-chalk);padding:11px 13px"><div class="sd-eyebrow" style="font-size:9px;letter-spacing:.2em;color:' + DIM + '">' + c[0] + '</div><div class="sd-num" style="font-size:18px;margin-top:5px">' + c[1] + "</div></div>";
            }).join("") +
          "</div></div>";
      });
    }

    return head + '<div style="flex:1;overflow-y:auto;padding:24px 24px 30px">' + body + "</div>";
  }

  window.LDC_IG = {
    normalize: normalize,
    renderInsights: renderInsights,
    renderCalendar: renderCalendar,
    renderCalDrawer: renderCalDrawer,
    monthKey: monthKey
  };
})();
