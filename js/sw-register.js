/**
 * sw-register.js
 * Registro del service worker. Extraído del HTML para permitir una CSP
 * estricta (`script-src 'self'`, H-08).
 */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => console.log('Service Worker registrado', reg))
            .catch(err => console.error('Error registrando Service Worker', err));
    });
}
