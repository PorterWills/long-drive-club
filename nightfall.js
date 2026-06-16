/* ============================================================================
 * LDC — "Nightfall" hero background
 * Refined Slipstream: diagonal racing-livery bands that drift past the camera.
 * The alternating band goes DARKER than Racing Green (never lighter), so the
 * deep green never dilutes — chalk and a single redline are the only light.
 * Vanilla JS, zero dependencies. ~3.8kb.
 *
 * USAGE
 *   <canvas id="hero-bg"></canvas>
 *   <script src="nightfall.js"></script>
 *   <script>
 *     const fx = LDCNightfall.init(document.getElementById('hero-bg'));
 *     // later, if the hero unmounts: fx.destroy();
 *   </script>
 *
 * The canvas sits behind hero content (position:absolute; inset:0; width:100%;
 * height:100%). The module owns the canvas's pixel buffer (handles
 * devicePixelRatio + resize); style the ELEMENT with CSS.
 *
 * Also exposes a CommonJS/ESM export and attaches to window.LDCNightfall.
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LDCNightfall = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Brand palette (LDC "The Livery") -----------------------------------
  // Contrast is pushed DOWNWARD: ink / greenDeep are darker than the green
  // ground. There is intentionally NO lighter green anywhere in this effect.
  var PALETTE = {
    green:     '#0E2A1C', // Racing Green — the ground & dominant band
    greenDeep: '#081C12', // one step DOWN — darker alternating band
    ink:       '#06130C', // near-black green — deepest alternating band
    chalk:     '#EDE9DF', // Chalk — accent, low alpha only
    redline:   '#C1121F'  // Redline — a single band, the rationed ~3%
  };

  // The livery sequence: [colorKey, widthPx, optionalAlpha].
  // Green-dominant; every alternating band is darker (ink / greenDeep); one
  // low-alpha chalk band; exactly ONE redline band, always the thinnest.
  var SEQUENCE = [
    ['green',     170],
    ['ink',        80],
    ['green',     120],
    ['chalk',      10, 0.07],
    ['green',      96],
    ['greenDeep', 150],
    ['green',      70],
    ['redline',     8, 0.85],
    ['ink',       110],
    ['green',     190],
    ['greenDeep',  86],
    ['green',     130],
    ['ink',        74]
  ];

  var GHOST = { period: 300, speed: 96, alpha: 0.035 }; // faint faster chalk hairlines

  var DEFAULTS = {
    groundColor: PALETTE.green, // base fill behind the bands
    angleDeg: -16,              // base shear angle of the livery
    intensity: 32,              // 0 = frozen, 32 = reference, 100 ≈ 3× drift speed
    parallax: true,             // bands shift slightly with the pointer
    parallaxAmount: 22,         // px the field translates at the pointer edge
    respectReducedMotion: true, // freeze auto-drift if user prefers reduced motion
    pauseWhenOffscreen: true,   // stop the rAF loop when the canvas is scrolled away
    alignRedline: null          // null = off; else 0..1 — park the redline band at
                                // this horizontal fraction of the canvas (mid-height)
                                // on first paint, so it clears narrow text columns.
  };

  function buildLivery() {
    var stripes = [], period = 0, redlineLocal = null;
    for (var i = 0; i < SEQUENCE.length; i++) {
      var s = SEQUENCE[i];
      if (s[0] === 'redline') redlineLocal = period + s[1] / 2; // band centre within a period
      stripes.push({
        col: PALETTE[s[0]],
        wd: s[1],
        alpha: s[2] == null ? 1 : s[2],
        soft: s[0] === 'chalk' || s[0] === 'redline' // accents get feathered edges
      });
      period += s[1];
    }
    return { stripes: stripes, period: period, redlineLocal: redlineLocal };
  }

  function init(canvas, options) {
    if (!canvas || !canvas.getContext) throw new Error('LDCNightfall.init: pass a <canvas> element');
    var opt = {};
    for (var k in DEFAULTS) opt[k] = DEFAULTS[k];
    if (options) for (var o in options) opt[o] = options[o];

    var ctx = canvas.getContext('2d');
    var livery = buildLivery();
    var W = 0, H = 0, dpr = 1;
    var mouse = { x: 0, y: 0, tx: 0, ty: 0 }; // eased + target, normalised −1..1
    var prefersReduced = opt.respectReducedMotion &&
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var active = true, running = true, raf = 0, start = performance.now();

    function motion() { return prefersReduced ? 0 : (opt.intensity / 32); }

    function resize() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function onMove(e) {
      if (!opt.parallax) return;
      var r = canvas.getBoundingClientRect();
      mouse.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
    }
    function onLeave() { mouse.tx = 0; mouse.ty = 0; }

    function stripe(x, y, wd, ht, col, alpha, soft) {
      ctx.globalAlpha = alpha;
      if (soft) {
        var g = ctx.createLinearGradient(x, 0, x + wd, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.5, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = col;
      }
      ctx.fillRect(x - 0.5, y, wd + 1, ht); // +1 overlap avoids seams between solids
      ctx.globalAlpha = 1;
    }

    function draw(t) {
      var mo = motion();
      ctx.fillStyle = opt.groundColor;
      ctx.fillRect(0, 0, W, H);

      // base angle drifts ±1.4° on a slow sine + a few degrees of pointer steer
      var angle = (opt.angleDeg + mouse.x * 4 + Math.sin(t * 0.12 * mo) * 1.4) * Math.PI / 180;
      var R = Math.hypot(W, H) * 0.78;

      // --- main livery layer: scrolls perpendicular to the band direction ----
      ctx.save();
      ctx.translate(W / 2 + (opt.parallax ? mouse.x * opt.parallaxAmount : 0),
                    H / 2 + (opt.parallax ? mouse.y * (opt.parallaxAmount * 0.64) : 0));
      ctx.rotate(angle);
      var stripes = livery.stripes, period = livery.period;
      // Optionally park the redline band at a chosen horizontal fraction (taken at
      // mid-height) so it starts clear of a narrow text column. Derived from the
      // live geometry, so it self-adjusts to any canvas height; the slow drift
      // then carries it from there.
      var phase = 0;
      if (opt.alignRedline != null && livery.redlineLocal != null) {
        var a0 = opt.angleDeg * Math.PI / 180;
        var desired = (opt.alignRedline * W - W / 2) * Math.cos(a0);
        phase = ((livery.redlineLocal - R - desired) % period + period) % period;
      }
      var offset = (t * 30 * mo + phase) % period; // 30 px/s reference drift
      var x = -R - (offset % period);
      while (x < R) {
        for (var i = 0; i < stripes.length; i++) {
          var s = stripes[i];
          stripe(x, -R, s.wd, 2 * R, s.col, s.alpha, s.soft);
          x += s.wd;
          if (x >= R) break;
        }
      }
      ctx.restore();

      // --- speed ghost: faint, faster chalk hairlines for depth ---------------
      ctx.save();
      ctx.translate(W / 2 + (opt.parallax ? mouse.x * opt.parallaxAmount : 0), H / 2);
      ctx.rotate(angle);
      var gp = GHOST.period, go = (t * GHOST.speed * mo) % gp;
      ctx.globalAlpha = GHOST.alpha;
      ctx.fillStyle = PALETTE.chalk;
      for (var gx = -R - (gp - go); gx < R; gx += gp) ctx.fillRect(gx, -R, 2, 2 * R);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    function frame(now) {
      if (!running) return;
      if (active) {
        mouse.x += (mouse.tx - mouse.x) * 0.06; // ease the pointer
        mouse.y += (mouse.ty - mouse.y) * 0.06;
        draw((now - start) / 1000);
      }
      raf = requestAnimationFrame(frame);
    }

    // ---- wiring -------------------------------------------------------------
    var ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    var io = null;
    if (opt.pauseWhenOffscreen && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) { active = es[0].isIntersecting; }, { threshold: 0.01 });
      io.observe(canvas);
    }

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(frame);

    return {
      /** Live-update any option, e.g. fx.set({ intensity: 60 }). */
      set: function (patch) { for (var p in patch) opt[p] = patch[p]; },
      /** Tear down listeners + rAF. Call when the hero unmounts. */
      destroy: function () {
        running = false;
        cancelAnimationFrame(raf);
        ro.disconnect();
        if (io) io.disconnect();
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerleave', onLeave);
      }
    };
  }

  return { init: init, PALETTE: PALETTE, SEQUENCE: SEQUENCE, GHOST: GHOST, DEFAULTS: DEFAULTS };
});
