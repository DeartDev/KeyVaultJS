const CACHE_NAME = 'keyvault-v4';

// Solo assets propios: ya no hay ningún origen externo en el precache (H-07),
// así que el modo offline no depende de un CDN de terceros.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './keyvault.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/styles.css',
  './js/theme-init.js',
  './js/app.js',
  './js/api.js',
  './js/auth.js',
  './js/crypto.js',
  './js/storage.js',
  './js/generator.js',
  './js/sw-register.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // cache.addAll() es atómico: si UN recurso falla, no se cachea ninguno y
      // el precache queda vacío en silencio. Cacheamos uno a uno para que un
      // fallo aislado no invalide el resto, y lo dejamos registrado.
      const results = await Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => cache.add(url)),
      );
      const failed = ASSETS_TO_CACHE.filter((_, i) => results[i].status === 'rejected');
      if (failed.length > 0) {
        console.warn('[sw] recursos no precacheados:', failed);
      }
    }),
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

  // Nunca cachear peticiones a la API: llevan tokens y datos de sesión.
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
