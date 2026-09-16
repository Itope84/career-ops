"use client";

import { useEffect } from "react";

// Registers /sw.js, which is what makes the app INSTALLABLE on Android —
// Chrome refuses to offer "Install app" without a registered service worker
// that has a fetch handler. The manifest and icons were already valid; this
// registration was the missing half. iOS never needed it (Add to Home Screen
// works off the manifest alone), so this only changes Android behaviour.
//
// See public/sw.js: it deliberately caches nothing but a static offline page,
// because these instances sit behind Cloudflare Access.
export function ServiceWorkerMount() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Registration is best-effort: a browser with SW disabled, a private
    // window, or an insecure origin (plain http on a LAN IP — only localhost
    // is treated as secure) all reject here. None of that should surface as an
    // error to the user; the app works exactly the same without it, it just
    // isn't installable.
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* not installable here — no behavioural impact */
      });
    };
    if (document.readyState === "complete") onLoad();
    else {
      window.addEventListener("load", onLoad);
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
