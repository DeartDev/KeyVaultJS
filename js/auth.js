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
            currentUser = raw ? JSON.parse(raw) : null;
        } catch { currentUser = null; }
    };

    const persistUser = (user) => {
        currentUser = user;
        if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
        else localStorage.removeItem(USER_KEY);
    };

    const getUser = () => currentUser;
    const isLoggedIn = () => !!currentUser && ApiClient.hasSession();

    const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

    const register = async ({ email, password }) => {
        // Generamos un salt aleatorio para derivar la clave del vault (igual que crypto.js).
        const saltBytes = crypto.getRandomValues(new Uint8Array(16));
        const vaultSalt = btoa(String.fromCharCode(...saltBytes));

        const data = await ApiClient.register(email, password, vaultSalt);
        ApiClient.setTokens(data);
        persistUser(data.user);
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

    return { register, login, logout, getUser, isLoggedIn };
})();
