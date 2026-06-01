"use client";

import { useEffect } from "react";

// Registers the service worker that caches the app shell + static assets for
// instant repeat loads. Production-only: in dev we skip it so hot-reload and
// live edits are never served from cache.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    // Wait for load so registration doesn't compete with first paint.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
