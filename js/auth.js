/**
 * auth.js
 * Gestión de sesión multi-usuario.
 * - register / login / logout
 * - Mantiene el usuario actual en memoria.
 * - Emite eventos 'auth:loggedIn' y 'auth:loggedOut'.
 */

const AuthModule = (() => {
    const USER_KEY = 'pm_user';

    let currentUser = null;

    const loadStoredUser = () => {
        try {
            const raw = localStorage.getItem(USER_KEY);
            const user = raw ? JSON.parse(raw) : null;
            persistUser(user); // centraliza sincronización del salt con CryptoModule
        } catch { persistUser(null); }
    };

    const persistUser = (user) => {
        currentUser = user;
        if (user) {
            localStorage.setItem(USER_KEY, JSON.stringify(user));
            // Fuente única del salt: el backend. CryptoModule lo consume.
            if (user.vaultSalt) {
                CryptoModule.setSalt(user.vaultSalt);
            }
        } else {
            localStorage.removeItem(USER_KEY);
            CryptoModule.clearSalt();
        }
    };

    const getUser = () => currentUser;
    const isLoggedIn = () => !!currentUser && ApiClient.hasSession();

    const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

    const register = async ({ email, password }) => {
        // Generamos un salt aleatorio para derivar la clave del vault.
        // Se envía al backend (users.vault_salt) como fuente única portable.
        const saltBytes = crypto.getRandomValues(new Uint8Array(16));
        const vaultSalt = btoa(String.fromCharCode(...saltBytes));

        const data = await ApiClient.register(email, password, vaultSalt);
        ApiClient.setTokens(data);
        persistUser(data.user); // setea el salt en CryptoModule
        emit('auth:loggedIn', data.user);
        return data.user;
    };

    const login = async ({ email, password }) => {
        const data = await ApiClient.login(email, password);
        ApiClient.setTokens(data);
        persistUser(data.user);
        emit('auth:loggedIn', data.user);
        return data.user;
    };

    /**
     * Cambia la contraseña de cuenta. El backend revoca TODAS las sesiones y
     * devuelve un par nuevo para este dispositivo, así que aquí no hay que
     * cerrar sesión: basta con reemplazar los tokens.
     */
    const changePassword = async ({ currentPassword, newPassword }) => {
        const data = await ApiClient.changePassword(currentPassword, newPassword);
        ApiClient.setTokens(data);
        return true;
    };

    const logout = async () => {
        try { await ApiClient.logout(); } catch { /* ignore */ }
        ApiClient.clearTokens();
        persistUser(null);
        emit('auth:loggedOut');
    };

    // Auto-logout si la API responde 401 no recuperable.
    window.addEventListener('auth:unauthorized', () => {
        persistUser(null);
        emit('auth:loggedOut');
    });

    loadStoredUser();

    return { register, login, logout, changePassword, getUser, isLoggedIn };
})();
