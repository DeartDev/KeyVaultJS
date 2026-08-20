/**
 * crypto.js
 * Módulo encargado de la criptografía usando la Web Crypto API.
 *
 * El SALT no se autogenera ni se guarda en localStorage: la fuente única de
 * verdad es el backend (users.vault_salt), que AuthModule carga tras
 * login/register. Así el vault es descifrable desde cualquier dispositivo que
 * use el mismo PIN + el mismo vault_salt (modo Zero-Knowledge portable).
 *
 * --- Formato del blob cifrado (H-10) ---
 *
 *   v2:<iteraciones>:<ivBase64>:<ciphertextBase64>     <- formato actual
 *   <ivBase64>:<ciphertextBase64>                      <- legado (PBKDF2 100k)
 *
 * Versionar los parámetros del KDF dentro del propio blob permite subir el
 * coste del derivado sin dejar ilegibles los vaults ya cifrados: al descifrar
 * se usan las iteraciones que declara el blob, y el siguiente guardado lo
 * re-cifra con los parámetros actuales de forma transparente.
 */

const CryptoModule = (() => {
    // OWASP recomienda >= 600 000 iteraciones para PBKDF2-HMAC-SHA256.
    const ITERATIONS = 600000;
    // Iteraciones implícitas de los blobs sin prefijo de versión.
    const LEGACY_ITERATIONS = 100000;
    const FORMAT_VERSION = 'v2';
    const ALGORITHM = 'AES-GCM';
    const KEY_LENGTH = 256;

    // Salt en memoria (base64). Lo establece AuthModule desde users.vault_salt.
    let currentSalt = null;

    const setSalt = (base64Salt) => {
        if (!base64Salt || typeof base64Salt !== 'string') {
            throw new Error('Salt inválido');
        }
        currentSalt = base64Salt;
    };

    const hasSalt = () => currentSalt !== null;

    const clearSalt = () => { currentSalt = null; };

    const getSaltBytes = () => {
        if (!currentSalt) {
            throw new Error('Salt no inicializado. Inicia sesión primero.');
        }
        return Uint8Array.from(atob(currentSalt), c => c.charCodeAt(0));
    };

    const toBase64 = (bytes) => {
        // Se trocea para no reventar la pila de argumentos con vaults grandes.
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    };

    const fromBase64 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

    // Deriva una clave a partir del PIN usando PBKDF2 + el salt sincronizado.
    const deriveKey = async (password, iterations) => {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveBits', 'deriveKey']
        );

        return await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: getSaltBytes(),
                iterations,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: ALGORITHM, length: KEY_LENGTH },
            false,
            ['encrypt', 'decrypt']
        );
    };

    /**
     * Interpreta un blob en cualquiera de los dos formatos soportados.
     * Devuelve { iterations, iv, ciphertext, legacy }.
     */
    const parseBlob = (encryptedData) => {
        if (typeof encryptedData !== 'string' || encryptedData.length === 0) {
            throw new Error('Formato de datos cifrados inválido');
        }
        const parts = encryptedData.split(':');

        if (parts.length === 4) {
            const [version, iterRaw, ivB64, ctB64] = parts;
            const iterations = Number(iterRaw);
            if (version !== FORMAT_VERSION || !Number.isInteger(iterations) || iterations <= 0) {
                throw new Error('Formato de datos cifrados no soportado');
            }
            return { iterations, iv: fromBase64(ivB64), ciphertext: fromBase64(ctB64), legacy: false };
        }

        if (parts.length === 2) {
            return {
                iterations: LEGACY_ITERATIONS,
                iv: fromBase64(parts[0]),
                ciphertext: fromBase64(parts[1]),
                legacy: true,
            };
        }

        throw new Error('Formato de datos cifrados inválido');
    };

    // Encripta un texto usando la clave derivada con los parámetros actuales.
    const encrypt = async (text, password) => {
        const key = await deriveKey(password, ITERATIONS);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();

        const encryptedContent = await crypto.subtle.encrypt(
            { name: ALGORITHM, iv },
            key,
            enc.encode(text)
        );

        return [
            FORMAT_VERSION,
            ITERATIONS,
            toBase64(iv),
            toBase64(new Uint8Array(encryptedContent)),
        ].join(':');
    };

    // Desencripta usando los parámetros KDF que declara el propio blob.
    const decrypt = async (encryptedData, password) => {
        try {
            const { iterations, iv, ciphertext } = parseBlob(encryptedData);
            const key = await deriveKey(password, iterations);

            const decryptedContent = await crypto.subtle.decrypt(
                { name: ALGORITHM, iv },
                key,
                ciphertext
            );

            return new TextDecoder().decode(decryptedContent);
        } catch (error) {
            console.error('Error al desencriptar:', error);
            throw new Error('Contraseña incorrecta o datos corruptos');
        }
    };

    /**
     * True si el blob no usa los parámetros KDF actuales. StorageModule lo
     * consulta para forzar un re-cifrado en segundo plano tras el desbloqueo.
     */
    const needsReencryption = (encryptedData) => {
        try {
            return parseBlob(encryptedData).iterations !== ITERATIONS;
        } catch {
            return false;
        }
    };

    return {
        setSalt,
        hasSalt,
        clearSalt,
        encrypt,
        decrypt,
        needsReencryption,
        ITERATIONS,
    };
})();
