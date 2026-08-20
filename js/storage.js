/**
 * storage.js
 * Persistencia HÍBRIDA del vault:
 *  - Postgres (vía /api/vault) es la fuente de verdad (remoto).
 *  - localStorage queda como caché para modo offline (PWA).
 *
 * Flujo:
 *  - saveVault: cifra localmente, guarda en caché local y hace push al remoto.
 *               Si hay conflicto de versión (409), lanza VaultConflictError para que
 *               la UI decida (pull + merge + retry).
 *  - loadVault: descifra usando el PIN; primero intenta el remoto y actualiza la
 *               caché local; si no hay red, usa la caché.
 *
 * El "remote" opera con el blob opaco cifrado: el servidor nunca ve el PIN ni el
 * contenido en claro (Zero-Knowledge).
 */

const VAULT_CACHE_KEY = 'pm_vault_cache';     // blob cifrado local (caché)
const VAULT_VERSION_KEY = 'pm_vault_version'; // última versión conocida

class VaultConflictError extends Error {
    constructor(currentVersion) {
        super('Conflicto de versión: el vault fue modificado en otro dispositivo.');
        this.name = 'VaultConflictError';
        this.currentVersion = currentVersion;
    }
}

const StorageModule = (() => {
    const cacheEncryptedBlob = () => localStorage.getItem(VAULT_CACHE_KEY);
    const setCacheEncryptedBlob = (blob) => localStorage.setItem(VAULT_CACHE_KEY, blob);
    const clearCache = () => {
        localStorage.removeItem(VAULT_CACHE_KEY);
        localStorage.removeItem(VAULT_VERSION_KEY);
    };

    const getLocalVersion = () => {
        const v = localStorage.getItem(VAULT_VERSION_KEY);
        return v === null ? null : Number(v);
    };
    const setLocalVersion = (v) => {
        if (v === null || v === undefined) localStorage.removeItem(VAULT_VERSION_KEY);
        else localStorage.setItem(VAULT_VERSION_KEY, String(v));
    };

    // Cifra el array de datos con el PIN y devuelve el blob "iv:ciphertext".
    const encryptForPin = async (data, password) => {
        const jsonString = JSON.stringify(data);
        return await CryptoModule.encrypt(jsonString, password);
    };

    const decryptForPin = async (blob, password) => {
        const decryptedString = await CryptoModule.decrypt(blob, password);
        return JSON.parse(decryptedString);
    };

    // --- Save (local + remote) ---
    const saveVault = async (data, password) => {
        try {
            const encryptedBlob = await encryptForPin(data, password);
            setCacheEncryptedBlob(encryptedBlob);

            // Push remoto. Si no hay sesión, solo se guarda en local (modo offline/legacy).
            if (!ApiClient.hasSession()) {
                return true;
            }

            const expectedVersion = getLocalVersion() ?? 0;
            try {
                const result = await ApiClient.putVault(encryptedBlob, expectedVersion);
                setLocalVersion(result.version);
                return true;
            } catch (err) {
                if (err instanceof ApiError && err.status === 409) {
                    throw new VaultConflictError(err.details?.currentVersion ?? null);
                }
                // Error de red u otro: mantenemos la caché local y no abortamos.
                console.warn('saveVault: push remoto falló, se mantiene caché local.', err);
                return true;
            }
        } catch (err) {
            if (err instanceof VaultConflictError) throw err;
            console.error('Error guardando la bóveda:', err);
            return false;
        }
    };

    /**
     * Re-cifra el vault con los parámetros KDF actuales si el blob venía con
     * unos antiguos (H-10). Es transparente y best-effort: si falla (sin red,
     * conflicto de versión), el vault sigue siendo legible con su formato
     * original y se reintentará en el siguiente desbloqueo.
     */
    const reencryptIfStale = async (blob, data, password) => {
        if (!CryptoModule.needsReencryption(blob)) return;
        try {
            await saveVault(data, password);
            console.info('Vault re-cifrado con los parámetros KDF actuales.');
        } catch (err) {
            console.warn('No se pudo re-cifrar el vault todavía.', err);
        }
    };

    // --- Load (remote-first, cache fallback) ---
    const loadVault = async (password) => {
        // Intenta remoto primero si hay sesión.
        if (ApiClient.hasSession()) {
            try {
                const remote = await ApiClient.getVault();
                if (remote && remote.encryptedBlob && remote.encryptedBlob !== ':') {
                    setCacheEncryptedBlob(remote.encryptedBlob);
                    setLocalVersion(remote.version);
                    const data = await decryptForPin(remote.encryptedBlob, password);
                    await reencryptIfStale(remote.encryptedBlob, data, password);
                    return data;
                }
                // Vault remoto vacío (recién registrado): devolvemos [] sin tocar caché.
                setLocalVersion(remote?.version ?? 0);
                return [];
            } catch (err) {
                console.warn('loadVault: pull remoto falló, usando caché local.', err);
                // cae al flujo de caché
            }
        }

        const cached = cacheEncryptedBlob();
        if (!cached) return [];
        return await decryptForPin(cached, password);
    };

    const hasVault = () => {
        if (ApiClient.hasSession()) return true; // el remoto es la fuente de verdad
        return cacheEncryptedBlob() !== null;
    };

    const clearVault = () => {
        clearCache();
    };

    // Tras login/registro: sincroniza la versión local con la remota.
    const syncFromRemote = async (password) => loadVault(password);

    // Reintenta push tras resolver un conflicto.
    const forcePushFromCache = async (password) => {
        const blob = cacheEncryptedBlob();
        if (!blob) return false;
        const remote = await ApiClient.getVault();
        const expected = remote?.version ?? 0;
        const result = await ApiClient.putVault(blob, expected);
        setLocalVersion(result.version);
        return true;
    };

    return {
        saveVault,
        loadVault,
        hasVault,
        clearVault,
        syncFromRemote,
        forcePushFromCache,
        VaultConflictError,
    };
})();
