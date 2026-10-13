self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => {e.waitUntil(clients.claim())});
// self.addEventListener('activate', (e) => self.clients.claim());

self.addEventListener('fetch', () => {
  // Network handles everything.
  // This empty fetch handler is enough for PWA installability.
});