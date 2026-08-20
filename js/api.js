/**
 * api.js
 * Cliente HTTP para la API de KeyVaultJS.
 * - Inyecta el access token en cada petición.
 * - Refresca el token automáticamente al recibir 401 (una sola vez por petición).
 * - Expone métodos tipados para auth y vault.
 */

const ApiClient = (() => {
    const BASE = '/api';

    const ACCESS_KEY = 'pm_access_token';
    const REFRESH_KEY = 'pm_refresh_token';

    // --- token storage ---
    const getAccessToken = () => localStorage.getItem(ACCESS_KEY);
    const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);
    const setTokens = ({ accessToken, refreshToken }) => {
        if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
        if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    };
    const clearTokens = () => {
        localStorage.removeItem(ACCESS_KEY);
        localStorage.removeItem(REFRESH_KEY);
    };

    // --- low-level fetch with auto-refresh ---
    let refreshingPromise = null;

    const doRefresh = async () => {
        if (refreshingPromise) return refreshingPromise;
        const refreshToken = getRefreshToken();
        if (!refreshToken) throw new Error('No refresh token');

        refreshingPromise = (async () => {
            try {
                const res = await fetch(`${BASE}/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken }),
                });
                if (!res.ok) throw new Error('Refresh failed');
                const data = await res.json();
                setTokens(data);
                return data.accessToken;
            } finally {
                refreshingPromise = null;
            }
        })();
        return refreshingPromise;
    };

    // Códigos de error 401 que NO significan "la sesión caducó", sino "el dato
    // que enviaste es incorrecto". Refrescar el token o cerrar la sesión ante
    // uno de estos sería un error: p. ej. equivocarse en la contraseña actual
    // al cambiarla echaría al usuario de la aplicación.
    const CREDENTIAL_ERROR_CODES = new Set(['invalid_credentials']);

    const request = async (path, { method = 'GET', body, auth = true, _retried = false } = {}) => {
        const headers = { 'Content-Type': 'application/json' };
        if (auth) {
            const at = getAccessToken();
            if (at) headers['Authorization'] = `Bearer ${at}`;
        }

        const res = await fetch(`${BASE}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        if (res.status === 204) return null;

        // El cuerpo se lee antes de decidir qué hacer con un 401: hace falta el
        // código de error para distinguir "token inválido" de "credencial mal".
        let payload = null;
        const text = await res.text();
        if (text) {
            try { payload = JSON.parse(text); }
            catch { payload = { message: text }; }
        }

        const code = payload?.error || 'request_failed';
        const isSessionProblem = res.status === 401 && !CREDENTIAL_ERROR_CODES.has(code);

        if (isSessionProblem && auth && !_retried) {
            try {
                await doRefresh();
                return request(path, { method, body, auth, _retried: true });
            } catch (e) {
                clearTokens();
                window.dispatchEvent(new CustomEvent('auth:unauthorized'));
                throw new ApiError(401, 'unauthorized', 'Sesión expirada');
            }
        }

        if (!res.ok) {
            const message = payload?.message || `Error ${res.status}`;
            if (isSessionProblem) {
                window.dispatchEvent(new CustomEvent('auth:unauthorized'));
            }
            throw new ApiError(res.status, code, message, payload);
        }
        return payload;
    };

    // --- public API ---
    return {
        // auth
        register: (email, password, vaultSalt) =>
            request('/auth/register', { method: 'POST', auth: false, body: { email, password, vaultSalt } }),
        login: (email, password) =>
            request('/auth/login', { method: 'POST', auth: false, body: { email, password } }),
        refresh: () => doRefresh(),
        logout: () => {
            const refreshToken = getRefreshToken();
            return request('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => null);
        },
        // Cambio de contraseña de CUENTA. El PIN maestro no interviene: no viaja
        // nunca al servidor y se cambia solo en el cliente (ver StorageModule).
        changePassword: (currentPassword, newPassword) =>
            request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),

        // vault
        getVault: () => request('/vault'),
        putVault: (encryptedBlob, version) =>
            request('/vault', { method: 'PUT', body: { encryptedBlob, version } }),

        // token helpers
        setTokens,
        clearTokens,
        getAccessToken,
        getRefreshToken,
        hasSession: () => !!getAccessToken(),
    };
})();

class ApiError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
