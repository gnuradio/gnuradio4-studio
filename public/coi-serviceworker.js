// Adds COOP/COEP headers client-side for static hosts that cannot set response headers
if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) =>
    event.waitUntil(self.clients.claim()),
  );
  self.addEventListener("fetch", (event) => {
    const request = event.request;
    // Only the document and (pthread) worker scripts need the headers; leave every other request alone.
    const needsHeaders =
      request.mode === "navigate" ||
      request.destination === "worker" ||
      request.destination === "sharedworker";
    if (
      !needsHeaders ||
      (request.cache === "only-if-cached" && request.mode !== "same-origin")
    ) {
      return;
    }
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (
            response.status === 0 ||
            response.status === 204 ||
            response.status === 304
          ) {
            return response;
          }
          const headers = new Headers(response.headers);
          headers.set("Cross-Origin-Embedder-Policy", "require-corp");
          headers.set("Cross-Origin-Opener-Policy", "same-origin");
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        })
        .catch((error) => {
          console.error("[coi] fetch failed", request.url, error);
          throw error;
        }),
    );
  });
} else if (
  !window.crossOriginIsolated &&
  window.isSecureContext &&
  "serviceWorker" in navigator
) {
  navigator.serviceWorker
    .register(document.currentScript.src)
    .then((registration) => {
      registration.addEventListener("updatefound", () =>
        window.location.reload(),
      );
      if (registration.active && !navigator.serviceWorker.controller) {
        window.location.reload();
      }
    })
    .catch((error) =>
      console.error("[coi] service worker registration failed", error),
    );
}
