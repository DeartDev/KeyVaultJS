/**
 * storage.js
 * Módulo para gestionar el almacenamiento local (localStorage).
 */

const StorageModule = (() => {
    const VAULT_KEY = 'pm_vault';

    const saveVault = async (data, password) => {
        try {
            const jsonString = JSON.stringify(data);
            const encryptedData = await CryptoModule.encrypt(jsonString, password);
            localStorage.setItem(VAULT_KEY, encryptedData);
            return true;
        } catch (error) {
            console.error("Error guardando la bóveda:", error);
            return false;
        }
    };

    const loadVault = async (password) => {
        try {
            const encryptedData = localStorage.getItem(VAULT_KEY);
            if (!encryptedData) return []; // Bóveda vacía

            const decryptedString = await CryptoModule.decrypt(encryptedData, password);
            return JSON.parse(decryptedString);
        } catch (error) {
            console.error("Error cargando la bóveda:", error);
            throw error; // Lanzar error para que la UI sepa que el PIN es incorrecto
        }
    };

    const hasVault = () => {
        return localStorage.getItem(VAULT_KEY) !== null;
    };
    
    const clearVault = () => {
        localStorage.removeItem(VAULT_KEY);
        localStorage.removeItem('pm_salt');
    };

    return {
        saveVault,
        loadVault,
        hasVault,
        clearVault
    };
})();
