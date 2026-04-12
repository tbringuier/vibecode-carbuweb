// Self-destructing service worker: clears all caches and unregisters itself.
// Deployed to clean up clients that had the old caching SW.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
  );
});
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
