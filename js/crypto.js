/**
 * crypto.js
 * Módulo encargado de la criptografía usando la Web Crypto API.
 */

const CryptoModule = (() => {
    const SALT_KEY = 'pm_salt';
    const ITERATIONS = 100000;
    const ALGORITHM = 'AES-GCM';
    const KEY_LENGTH = 256;

    // Obtiene la sal almacenada o genera una nueva
    const getSalt = () => {
        let salt = localStorage.getItem(SALT_KEY);
        if (!salt) {
            const newSalt = crypto.getRandomValues(new Uint8Array(16));
            salt = btoa(String.fromCharCode(...newSalt));
            localStorage.setItem(SALT_KEY, salt);
        }
        return Uint8Array.from(atob(salt), c => c.charCodeAt(0));
    };

    // Deriva una clave a partir de una contraseña/PIN
    const deriveKey = async (password) => {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveBits', 'deriveKey']
        );

        const salt = getSalt();

        return await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: ITERATIONS,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: ALGORITHM, length: KEY_LENGTH },
            false,
            ['encrypt', 'decrypt']
        );
    };

    // Encripta un texto usando la clave derivada
    const encrypt = async (text, password) => {
        const key = await deriveKey(password);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        
        const encryptedContent = await crypto.subtle.encrypt(
            {
                name: ALGORITHM,
                iv: iv
            },
            key,
            enc.encode(text)
        );

        // Convertir el IV y el contenido cifrado a Base64 para almacenar
        const ivBase64 = btoa(String.fromCharCode(...iv));
        const encryptedBase64 = btoa(String.fromCharCode(...new Uint8Array(encryptedContent)));
        
        return `${ivBase64}:${encryptedBase64}`;
    };

    // Desencripta un texto usando la clave derivada
    const decrypt = async (encryptedData, password) => {
        try {
            const key = await deriveKey(password);
            const parts = encryptedData.split(':');
            if (parts.length !== 2) throw new Error("Formato de datos cifrados inválido");
            
            const iv = Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0));
            const encryptedContent = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));

            const decryptedContent = await crypto.subtle.decrypt(
                {
                    name: ALGORITHM,
                    iv: iv
                },
                key,
                encryptedContent
            );

            const dec = new TextDecoder();
            return dec.decode(decryptedContent);
        } catch (error) {
            console.error("Error al desencriptar:", error);
            throw new Error("Contraseña incorrecta o datos corruptos");
        }
    };

    return {
        encrypt,
        decrypt
    };
})();
