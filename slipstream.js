/* ============================================================================
 * LDC — "Slipstream" hero background
 * Diagonal racing-livery bands (Racing Green / Chalk / Redline) that shear and
 * drift past the camera. Vanilla JS, zero dependencies. ~3.5kb.
 *
 * USAGE
 *   <canvas id="hero-bg"></canvas>
 *   <script src="slipstream.js"></script>
 *   <script>
 *     const fx = LDCSlipstream.init(document.getElementById('hero-bg'));
 *     // later, if the hero unmounts: fx.destroy();
 *   </script>
 *
 * The canvas should be positioned behind your hero content (position:absolute;
 * inset:0; width:100%; height:100%). The module owns the canvas's pixel buffer
 * (handles devicePixelRatio + resize); style the *element* with CSS.
 *
 * Also exposes a CommonJS/ESM export and attaches to window.LDCSlipstream.
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LDCSlipstream = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Brand palette (LDC "The Livery") -----------------------------------
  var PALETTE = {
    green:   '#0E2A1C', // Racing Green — primary ground
    greenUp: '#163826', // Racing Green, one step up — the alternating band
    chalk:   '#EDE9DF', // Chalk — light accent (used at low alpha)
    redline: '#C1121F'  // Redline — the single ~3% signal band
  };

  // The livery sequence: [colorKey, widthPx, optionalAlpha].
  // Green-dominant, ONE chalk pair (low alpha) and exactly ONE redline band.
  // The redline band is always the thinnest and rationed to a single instance.
  var SEQUENCE = [
    ['green',   150],
    ['greenUp',  70],
    ['green',   110],
    ['chalk',    12, 0.10],
    ['green',    86],
    ['greenUp', 130],
    ['green',    60],
    ['redline',   9, 0.92],
    ['greenUp',  96],
    ['green',   170],
    ['chalk',    18, 0.07],
    ['greenUp',  84],
    ['green',   120],
    ['greenUp',  64]
  ];

  var DEFAULTS = {
    groundColor: PALETTE.green, // base fill behind the bands
    angleDeg: -16,              // base shear angle of the livery
    intensity: 32,              // 0 = frozen, 32 = reference, 100 ≈ 3× drift speed
    parallax: true,             // bands shift slightly with the pointer
    parallaxAmount: 22,         // px the field translates at the pointer edge
    respectReducedMotion: true, // freeze auto-drift if user prefers reduced motion
    pauseWhenOffscreen: true    // stop the rAF loop when the canvas is scrolled away
  };

  function buildLivery() {
    var stripes = [], period = 0;
    for (var i = 0; i < SEQUENCE.length; i++) {
      var s = SEQUENCE[i];
      stripes.push({
        col: PALETTE[s[0]],
        wd: s[1],
        alpha: s[2] == null ? 1 : s[2],
        soft: s[0] === 'chalk' || s[0] === 'redline' // accents get feathered edges
      });
      period += s[1];
    }
    return { stripes: stripes, period: period };
  }

  function init(canvas, options) {
    if (!canvas || !canvas.getContext) throw new Error('LDCSlipstream.init: pass a <canvas> element');
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

      // base angle drifts ±1.5° + a few degrees of pointer steer
      var angle = (opt.angleDeg + mouse.x * 4 + Math.sin(t * 0.12 * mo) * 1.5) * Math.PI / 180;
      var R = Math.hypot(W, H) * 0.7;

      // --- main livery layer: scrolls perpendicular to the band direction ----
      ctx.save();
      ctx.translate(W / 2 + (opt.parallax ? mouse.x * opt.parallaxAmount : 0),
                    H / 2 + (opt.parallax ? mouse.y * (opt.parallaxAmount * 0.64) : 0));
      ctx.rotate(angle);
      var stripes = livery.stripes, period = livery.period;
      var offset = (t * 36 * mo) % period;
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
      var gp = 240, go = (t * 120 * mo) % gp;
      ctx.globalAlpha = 0.05;
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

  return { init: init, PALETTE: PALETTE, SEQUENCE: SEQUENCE, DEFAULTS: DEFAULTS };
});
