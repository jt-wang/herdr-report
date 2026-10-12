// Network first for the page itself: the Mac is normally reachable, so fresh
// code wins; the cache only lets the app open when it isn't. The /v1 API is
// never cached. Push notifications arrive already written and encrypted by the
// Mac, so this only shows them and opens the session when tapped.
const CACHE = "herdr-report-v2";
const SHELL = ["/", "/app.css", "/js/main.js", "/js/model.js", "/js/dom.js", "/js/views.js", "/js/gestures.js", "/js/settings.js", "/js/platform.js", "/js/i18n.js",
  "/manifest.webmanifest", "/icon-192.png", "/icon-180.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/v1/")) return;
  e.respondWith(fetch(e.request)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    })
    .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/"))));
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(data.title || "会话进度", {
    body: data.body || "",
    tag: data.tag || "herdr-report",
    renotify: true,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        return c.navigate(url);
      }
    }
    return self.clients.openWindow(url);
  })());
});
