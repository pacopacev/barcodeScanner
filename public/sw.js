// Activate updates immediately and let this worker control existing open pages.
self.addEventListener('install', (e) => self.skipWaiting());
//self.addEventListener('activate', (e) => {e.waitUntil(clients.claim())}); //activat in initial hailh
self.addEventListener('activate', (e) => self.clients.claim());

// Deliberately do not call respondWith: requests use the network; scan retries are stored by the page.
self.addEventListener('fetch', () => {
});