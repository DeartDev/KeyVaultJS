const CACHE_NAME = 'password-manager-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/crypto.js',
  './js/storage.js',
  './js/generator.js',
  './js/gdrive-sync.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Ignoramos errores de recursos externos en el caché inicial
      return cache.addAll(ASSETS_TO_CACHE).catch(e => console.warn("Error cacheando recurso", e));
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
