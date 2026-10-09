/* Long Drive Club — cookie consent.
   Meta Pixel and Microsoft Clarity load only after the visitor accepts
   (UK PECR). The choice is kept in localStorage ("ldc-consent" = yes/no);
   the #cookie-reset button on /cookies clears it so the banner returns. */
(function () {
  "use strict";
  var KEY = "ldc-consent";

  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) {} }

  function loadTrackers() {
    /* Meta Pixel (vendor snippet) */
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', '1323560016550691');
    window.fbq('track', 'PageView');

    /* Microsoft Clarity (vendor snippet) */
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "xj72n90ekj");
  }

  // Withdrawing consent also removes the cookies the trackers already set.
  function clearTrackerCookies() {
    ["_fbp", "_fbc", "_clck", "_clsk"].forEach(function (n) {
      document.cookie = n + "=; Max-Age=0; path=/";
      document.cookie = n + "=; Max-Age=0; path=/; domain=." + location.hostname.replace(/^www\./, "");
    });
  }

  function showBanner() {
    var bar = document.createElement("div");
    bar.className = "cookie-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Cookie choice");
    bar.innerHTML =
      '<p class="cookie-bar-text">We use cookies to understand how people use this site. ' +
      '<a href="/cookies">Read more</a></p>' +
      '<div class="cookie-bar-actions">' +
        '<button type="button" class="btn btn--sm btn--chalk" data-choice="no">Decline</button>' +
        '<button type="button" class="btn btn--sm btn--chalk" data-choice="yes">Accept</button>' +
      "</div>";
    bar.addEventListener("click", function (e) {
      var choice = e.target.getAttribute && e.target.getAttribute("data-choice");
      if (!choice && e.target.parentNode && e.target.parentNode.getAttribute) {
        choice = e.target.parentNode.getAttribute("data-choice");
      }
      if (!choice) return;
      set(choice);
      if (choice === "yes") loadTrackers(); else clearTrackerCookies();
      bar.parentNode.removeChild(bar);
    });
    document.body.appendChild(bar);
  }

  var choice = get();
  if (choice === "yes") loadTrackers();
  else if (choice !== "no") showBanner();

  // /cookies: show the current choice and let the visitor change it.
  var reset = document.getElementById("cookie-reset");
  var status = document.getElementById("cookie-status");
  if (status) status.textContent = choice === "yes" ? "Accepted." : choice === "no" ? "Declined." : "Not made yet.";
  if (reset) {
    reset.addEventListener("click", function () {
      set(null);
      clearTrackerCookies();
      location.reload();
    });
  }
})();
