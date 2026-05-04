/**
 * gdrive-sync.js
 * Esqueleto para Sincronización con Google Drive.
 * Requiere configurar un CLIENT_ID de Google Cloud.
 */

const GDriveSync = (() => {
    // IMPORTANTE: Reemplazar con el Client ID real
    const CLIENT_ID = 'TU_CLIENT_ID_AQUI.apps.googleusercontent.com';

    const syncBtn = document.getElementById('btn-sync');

    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            alert('Para habilitar la sincronización con Google Drive, debes:\n1. Crear un proyecto en Google Cloud Console.\n2. Generar un Client ID para aplicación Web.\n3. Reemplazar "TU_CLIENT_ID_AQUI" en js/gdrive-sync.js.\n4. Añadir el script de Google Identity en index.html.');
        });
    }

    return {};
})();
