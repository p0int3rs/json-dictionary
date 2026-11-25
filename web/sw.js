'use strict';

/*
 * Çevrimdışı çalışma için service worker.
 * Önce ağ: internet varsa her zaman en güncel dosyalar gelir (güncelleme sonrası eski sürüm takılı kalmaz);
 * yoksa son indirilen kopya kullanılır. Kelimeler zaten tarayıcıda (localStorage) durur.
 */
const CACHE = 'jsondictionary-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/store.js',
  './js/quiz.js',
  './js/ai.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    // Gezinme isteği yeniden kurulamaz; adresle ve "önbelleği doğrula" seçeneğiyle iste.
    fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
      )
  );
});
