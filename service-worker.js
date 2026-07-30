const CACHE_NAME = 'password-manager-v3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './keyvault.svg',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/auth.js',
  './js/crypto.js',
  './js/storage.js',
  './js/generator.js',
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

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca cachear peticiones a la API ni a fuentes externas de auth.
  if (url.pathname.startsWith('/api/')) {
    return event.respondWith(fetch(event.request));
  }

  // Estrategia stale-while-revalidate para assets propios.
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
