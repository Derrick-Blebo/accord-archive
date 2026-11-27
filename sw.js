// Minimal service worker to enable PWA installability across mobile & desktop browsers.
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
    // Pass through to network so content, auth, and Supabase calls stay fresh.
});
