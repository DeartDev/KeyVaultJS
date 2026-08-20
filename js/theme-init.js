/**
 * theme-init.js
 * Anti-FOUC: fija data-theme en <html> antes del primer render para que no
 * haya un parpadeo claro/oscuro al cargar.
 *
 * Debe cargarse SIN `defer` y antes de los estilos que dependan del tema.
 * Vive en un archivo propio (y no inline) para que la CSP pueda ser
 * `script-src 'self'` sin hashes ni 'unsafe-inline' (H-08).
 */
(function () {
    try {
        var stored = localStorage.getItem('pm_theme') || 'system';
        var theme = stored;
        if (stored === 'system') {
            theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        }
        document.documentElement.dataset.theme = theme;
    } catch (e) {
        document.documentElement.dataset.theme = 'dark';
    }
})();
