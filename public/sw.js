const CACHE_NAME = "chien-luoc-trainer-v17";

const SCOPE_URL = new URL("./", self.registration.scope).href;

const PRECACHE_URLS = [
  "",
  "manifest.webmanifest",
  "images/logo-baolan.jpg",
  "images/logo-viet-vo-dao-italia.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "apple-touch-icon.png",
  ...Array.from({ length: 30 }, (_, index) => `audio/${index + 1}.mp3`),
  "audio/theme.mp3",
  "audio/fine.mp3",
].map((path) => new URL(path, SCOPE_URL).href);

async function cacheUrl(cache, url) {
  const request = new Request(url, { cache: "reload" });
  const response = await fetch(request);

  if (response.ok) {
    await cache.put(request, response);
  }
}

async function precacheApp() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(PRECACHE_URLS.map((url) => cacheUrl(cache, url)));

  const home = await cache.match(SCOPE_URL);
  if (!home) return;

  const html = await home.text();
  const pageAssets = Array.from(
    html.matchAll(/(?:src|href)="(\/[^"]+)"/g),
    (match) => match[1],
  ).filter(
    (url) =>
      url.includes("/_next/") ||
      url.includes("/assets/") ||
      url.includes("/_vinext/"),
  );

  await Promise.allSettled(
    [...new Set(pageAssets)].map((url) => cacheUrl(cache, url)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precacheApp().then(() => {
      self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key !== CACHE_NAME)
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(SCOPE_URL, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(SCOPE_URL)) ?? Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
