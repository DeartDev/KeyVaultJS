/**
 * app.js
 * Controlador principal de la aplicación.
 *
 * Flujo de pantallas:
 *   auth-screen  (login/registro de cuenta) ──► login-screen (PIN maestro) ──► dashboard-screen
 *                          ▲                                                          │
 *                          └──────────────  btn-logout-account  ◄───────────────────┘
 *                                                     btn-lock ──► login-screen
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Referencias al DOM: pantallas ---
    const authScreen = document.getElementById('auth-screen');
    const loginScreen = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');

    // --- Auth (cuenta) ---
    const authForm = document.getElementById('auth-form');
    const authBtn = document.getElementById('auth-btn');
    const authEmail = document.getElementById('auth-email');
    const authPassword = document.getElementById('auth-password');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');

    // --- PIN maestro ---
    const pinForm = document.getElementById('pin-form');
    const pinBtn = document.getElementById('pin-btn');
    const masterPinInput = document.getElementById('master-pin');
    const pinTitle = document.getElementById('pin-title');
    const pinSubtitle = document.getElementById('pin-subtitle');
    const btnBackToAuth = document.getElementById('btn-back-to-auth');

    // --- Dashboard ---
    const passwordsList = document.getElementById('passwords-list');
    const btnAdd = document.getElementById('btn-add');
    const btnLock = document.getElementById('btn-lock');
    const btnLogoutAccount = document.getElementById('btn-logout-account');
    const searchInput = document.getElementById('search-input');

    // --- Modales ---
    const passwordModal = document.getElementById('password-modal');
    const passwordForm = document.getElementById('password-form');
    const btnCancelModal = document.getElementById('btn-cancel-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const toggleEntryPwd = document.getElementById('toggle-entry-pwd');
    const entryPassword = document.getElementById('entry-password');
    const modalTitle = document.getElementById('modal-title');

    const entryId = document.getElementById('entry-id');
    const entryPlatform = document.getElementById('entry-platform');
    const entryUsername = document.getElementById('entry-username');

    const confirmModal = document.getElementById('confirm-modal');
    const btnCancelDelete = document.getElementById('btn-cancel-delete');
    const btnConfirmDelete = document.getElementById('btn-confirm-delete');

    // --- Settings ---
    const btnSettings = document.getElementById('btn-settings');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const btnCancelSettings = document.getElementById('btn-cancel-settings');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const btnSettingsLogout = document.getElementById('btn-settings-logout');
    const themeSelect = document.getElementById('theme-select');
    const autolockInput = document.getElementById('autolock-input');
    const quickThemeToggleAuth = document.getElementById('quick-theme-toggle-auth');

    const toastContainer = document.getElementById('toast-container');

    // --- Estado ---
    let currentMasterPassword = null;
    let vaultData = [];
    let entryToDelete = null;
    let authMode = 'login'; // 'login' | 'register'
    let pinMode = 'unlock'; // 'unlock' | 'create' — estado explícito: antes se
                            // deducía del copy del título (frágil ante cambios).

    // --- Utilidades de UI ---
    const showToast = (message, type = 'info') => {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    };

    /**
     * H-21: borra del portapapeles la contraseña copiada pasados 30 s.
     * Es best-effort por diseño:
     *  - Solo limpia si el contenido sigue siendo el que copiamos, para no
     *    pisar algo que el usuario haya copiado después.
     *  - Escribir en el portapapeles exige que el documento tenga el foco; si
     *    la pestaña está en segundo plano, se descarta sin ruido.
     */
    let clipboardClearTimer = null;
    const CLIPBOARD_CLEAR_MS = 30000;

    const scheduleClipboardClear = (copiedValue) => {
        clearTimeout(clipboardClearTimer);
        clipboardClearTimer = setTimeout(async () => {
            if (!document.hasFocus()) return;
            try {
                const current = await navigator.clipboard.readText();
                if (current !== copiedValue) return; // el usuario copió otra cosa
                await navigator.clipboard.writeText('');
            } catch {
                // Permiso denegado o API no disponible: se deja como está.
            }
        }, CLIPBOARD_CLEAR_MS);
    };

    const showScreen = (screenId) => {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    };

    const openModal = (modal) => {
        modal.classList.add('active');
        modal.querySelector('.modal-content').scrollTop = 0;
    };
    const closeModal = (modal) => modal.classList.remove('active');

    // --- Lógica de Auth (cuenta) ---
    const setAuthMode = (mode) => {
        authMode = mode;
        if (mode === 'login') {
            tabLogin.classList.add('active');
            tabRegister.classList.remove('active');
            authTitle.textContent = 'Bienvenido';
            authSubtitle.textContent = 'Accede a tu cuenta para continuar';
            authBtn.textContent = 'Entrar';
            authPassword.placeholder = 'Contraseña de cuenta';
        } else {
            tabRegister.classList.add('active');
            tabLogin.classList.remove('active');
            authTitle.textContent = 'Crear cuenta';
            authSubtitle.textContent = 'Registra tu cuenta de usuario';
            authBtn.textContent = 'Registrarse';
            authPassword.placeholder = 'Contraseña de cuenta (mín. 12 caracteres)';
        }
    };
    tabLogin.addEventListener('click', () => setAuthMode('login'));
    tabRegister.addEventListener('click', () => setAuthMode('register'));

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = authEmail.value.trim();
        const password = authPassword.value;

        if (authMode === 'register' && password.length < 12) {
            showToast('La contraseña de cuenta debe tener al menos 12 caracteres', 'error');
            return;
        }

        authBtn.textContent = authMode === 'login' ? 'Verificando...' : 'Creando...';
        authBtn.disabled = true;

        try {
            if (authMode === 'login') {
                await AuthModule.login({ email, password });
                showToast('Sesión iniciada', 'success');
            } else {
                await AuthModule.register({ email, password });
                showToast('Cuenta creada. Define tu PIN maestro.', 'success');
            }

            authForm.reset();
            setPinMode(authMode === 'login' ? 'unlock' : 'create');
            showScreen('login-screen');
            masterPinInput.focus();
        } catch (err) {
            showToast(err.message || 'Error de autenticación', 'error');
        } finally {
            authBtn.disabled = false;
            setAuthMode(authMode); // restore button label
        }
    });

    const setPinMode = (mode) => {
        pinMode = mode;
        const creating = mode === 'create';
        pinTitle.textContent = creating ? 'Define tu PIN maestro' : 'Bóveda bloqueada';
        pinSubtitle.textContent = creating
            ? 'Este PIN cifra tu bóveda localmente. Si lo olvidas, no hay recuperación.'
            : 'Introduce tu PIN maestro para descifrar la bóveda';
        pinBtn.textContent = creating ? 'Crear bóveda' : 'Desbloquear';
    };

    btnBackToAuth.addEventListener('click', async () => {
        await AuthModule.logout();
        currentMasterPassword = null;
        vaultData = [];
        showScreen('auth-screen');
    });

    // --- Lógica de PIN maestro (descifrar bóveda) ---
    pinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pin = masterPinInput.value;
        pinBtn.textContent = 'Desbloqueando...';
        pinBtn.disabled = true;

        try {
            currentMasterPassword = pin;

            // Sincroniza desde el remoto y descifra.
            vaultData = await StorageModule.loadVault(pin);

            // Si no hay datos (vault nuevo o vacío), inicializa.
            if (!vaultData || vaultData.length === 0) {
                if (!StorageModule.hasVault()) {
                    await StorageModule.saveVault([], currentMasterPassword);
                }
                vaultData = [];
            }

            masterPinInput.value = '';
            renderPasswords();
            showScreen('dashboard-screen');
            showToast('Bóveda desbloqueada', 'success');
        } catch (err) {
            showToast(err.message || 'Error al descifrar la bóveda', 'error');
            currentMasterPassword = null;
            masterPinInput.value = '';
            masterPinInput.focus();
        } finally {
            pinBtn.textContent = pinMode === 'create' ? 'Crear bóveda' : 'Desbloquear';
            pinBtn.disabled = false;
        }
    });

    // --- Bloquear / Cerrar sesión ---
    btnLock.addEventListener('click', () => {
        currentMasterPassword = null;
        vaultData = [];
        passwordsList.innerHTML = '';
        showScreen('login-screen');
        showToast('Bóveda bloqueada', 'info');
    });

    btnLogoutAccount.addEventListener('click', async () => {
        await AuthModule.logout();
        currentMasterPassword = null;
        vaultData = [];
        passwordsList.innerHTML = '';
        setAuthMode('login');
        showScreen('auth-screen');
        showToast('Sesión cerrada', 'info');
    });

    // --- Renderizar Lista ---
    const renderPasswords = (filter = '') => {
        passwordsList.innerHTML = '';
        const filtered = vaultData.filter(item =>
            item.platform.toLowerCase().includes(filter.toLowerCase()) ||
            item.username.toLowerCase().includes(filter.toLowerCase())
        );

        if (filtered.length === 0) {
            passwordsList.innerHTML = `
                <div class="empty-state">
                    <svg class="icon" aria-hidden="true"><use href="#i-folder"></use></svg>
                    <p>No hay contraseñas${filter ? ' que coincidan' : ' guardadas'}</p>
                </div>
            `;
            return;
        }

        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'password-item glass-card';
            div.innerHTML = `
                <div class="item-info">
                    <span class="item-platform">${escapeHtml(item.platform)}</span>
                    <span class="item-username">${escapeHtml(item.username)}</span>
                </div>
                <div class="item-actions">
                    <button class="btn-icon copy-btn" data-id="${item.id}" title="Copiar Contraseña">
                        <svg class="icon" aria-hidden="true"><use href="#i-copy"></use></svg>
                    </button>
                    <button class="btn-icon edit-btn" data-id="${item.id}" title="Editar">
                        <svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg>
                    </button>
                    <button class="btn-icon btn-delete" data-id="${item.id}" title="Eliminar">
                        <svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg>
                    </button>
                </div>
            `;
            passwordsList.appendChild(div);
        });

        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                const entry = vaultData.find(i => i.id === id);
                if (!entry) return;
                navigator.clipboard.writeText(entry.password)
                    .then(() => {
                        showToast('Contraseña copiada (se borra en 30 s)', 'success');
                        scheduleClipboardClear(entry.password);
                    })
                    .catch(() => showToast('No se pudo copiar', 'error'));
            });
        });

        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditModal(btn.getAttribute('data-id'));
            });
        });

        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                entryToDelete = btn.getAttribute('data-id');
                openModal(confirmModal);
            });
        });
    };

    const escapeHtml = (str) => String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    searchInput.addEventListener('input', (e) => renderPasswords(e.target.value));

    // --- Modal Crear/Editar ---
    btnAdd.addEventListener('click', () => {
        passwordForm.reset();
        entryId.value = '';
        modalTitle.textContent = 'Nueva Contraseña';
        entryPassword.type = 'password';
        toggleEntryPwd.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-eye"></use></svg>';
        openModal(passwordModal);
    });

    [btnCancelModal, closeModalBtn].forEach(btn => {
        btn.addEventListener('click', () => closeModal(passwordModal));
    });

    toggleEntryPwd.addEventListener('click', () => {
        if (entryPassword.type === 'password') {
            entryPassword.type = 'text';
            toggleEntryPwd.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-eye-off"></use></svg>';
        } else {
            entryPassword.type = 'password';
            toggleEntryPwd.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-eye"></use></svg>';
        }
    });

    const openEditModal = (id) => {
        const item = vaultData.find(i => i.id === id);
        if (!item) return;
        entryId.value = item.id;
        entryPlatform.value = item.platform;
        entryUsername.value = item.username;
        entryPassword.value = item.password;
        entryPassword.type = 'password';
        toggleEntryPwd.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-eye"></use></svg>';
        modalTitle.textContent = 'Editar Contraseña';
        openModal(passwordModal);
    };

    const saveVaultWithConflictHandling = async () => {
        try {
            const success = await StorageModule.saveVault(vaultData, currentMasterPassword);
            return success;
        } catch (err) {
            if (err instanceof StorageModule.VaultConflictError) {
                showToast('Conflicto: la bóveda cambió en otro dispositivo. Actualizando...', 'info');
                try {
                    vaultData = await StorageModule.loadVault(currentMasterPassword);
                    renderPasswords(searchInput.value);
                    showToast('Bóveda actualizada desde el servidor. Reintenta el cambio.', 'info');
                } catch {
                    showToast('No se pudo resolver el conflicto de versión', 'error');
                }
                return false;
            }
            showToast(err.message || 'Error al guardar', 'error');
            return false;
        }
    };

    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = entryId.value;
        const newItem = {
            id: id ? id : Date.now().toString(),
            platform: entryPlatform.value.trim(),
            username: entryUsername.value.trim(),
            password: entryPassword.value,
        };

        if (id) {
            const index = vaultData.findIndex(i => i.id === id);
            if (index !== -1) vaultData[index] = newItem;
        } else {
            vaultData.push(newItem);
        }

        const ok = await saveVaultWithConflictHandling();
        if (ok) {
            showToast('Bóveda actualizada', 'success');
            closeModal(passwordModal);
            renderPasswords(searchInput.value);
        }
    });

    // --- Modal Confirmación Borrar ---
    btnCancelDelete.addEventListener('click', () => {
        entryToDelete = null;
        closeModal(confirmModal);
    });

    btnConfirmDelete.addEventListener('click', async () => {
        if (!entryToDelete) return;
        vaultData = vaultData.filter(i => i.id !== entryToDelete);
        entryToDelete = null;
        closeModal(confirmModal);

        const ok = await saveVaultWithConflictHandling();
        if (ok) {
            showToast('Credencial eliminada', 'success');
            renderPasswords(searchInput.value);
        }
    });

    // --- Generador de Contraseñas ---
    const btnGeneratePwd = document.getElementById('btn-generate-pwd');
    if (btnGeneratePwd) {
        btnGeneratePwd.addEventListener('click', () => {
            entryPassword.value = PasswordGenerator.generate(16);
            entryPassword.type = 'text';
            toggleEntryPwd.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-eye-off"></use></svg>';
        });
    }

    // --- Tema (dark/light/system) ---
    const THEME_KEY = 'pm_theme';
    const AUTOLOCK_KEY = 'pm_autolock'; // minutos, 0 = desactivado
    const DEFAULT_AUTOCKLOCK_MIN = 5;

    const resolveTheme = (pref) => {
        if (pref === 'dark' || pref === 'light') return pref;
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    };

    const applyTheme = (pref) => {
        document.documentElement.dataset.theme = resolveTheme(pref);
    };

    const getStoredTheme = () => localStorage.getItem(THEME_KEY) || 'system';
    const setStoredTheme = (pref) => localStorage.setItem(THEME_KEY, pref);

    const getAutolockMinutes = () => {
        const raw = Number(localStorage.getItem(AUTOLOCK_KEY));
        return Number.isFinite(raw) ? raw : DEFAULT_AUTOCKLOCK_MIN;
    };

    // Reaccionar al cambio de preferencia del sistema cuando el usuario está en "system".
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (getStoredTheme() === 'system') applyTheme('system');
    });

    applyTheme(getStoredTheme());

    // Toggle rápido accesible desde la pantalla de auth.
    const cycleTheme = () => {
        const order = ['system', 'dark', 'light'];
        const current = getStoredTheme();
        const next = order[(order.indexOf(current) + 1) % order.length];
        setStoredTheme(next);
        applyTheme(next);
        const label = next === 'system' ? 'Automático' : (next === 'dark' ? 'Oscuro' : 'Claro');
        showToast(`Tema: ${label}`, 'info');
        if (themeSelect) themeSelect.value = next;
    };
    if (quickThemeToggleAuth) {
        quickThemeToggleAuth.addEventListener('click', cycleTheme);
    }

    // --- Modal de Configuración ---
    const openSettings = () => {
        themeSelect.value = getStoredTheme();
        autolockInput.value = String(getAutolockMinutes());
        openModal(settingsModal);
    };

    btnSettings.addEventListener('click', openSettings);
    closeSettingsBtn.addEventListener('click', () => closeModal(settingsModal));
    btnCancelSettings.addEventListener('click', () => closeModal(settingsModal));
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeModal(settingsModal);
    });

    // Previsualización del tema al cambiar el select.
    themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));

    btnSaveSettings.addEventListener('click', () => {
        const theme = themeSelect.value;
        const autolockRaw = Number(autolockInput.value);
        const autolock = Number.isFinite(autolockRaw) && autolockRaw >= 0 && autolockRaw <= 120
            ? Math.floor(autolockRaw) : DEFAULT_AUTOCKLOCK_MIN;

        setStoredTheme(theme);
        localStorage.setItem(AUTOLOCK_KEY, String(autolock));
        applyTheme(theme);
        scheduleInactivity(); // reprograma con el nuevo límite

        closeModal(settingsModal);
        showToast('Configuración guardada', 'success');
    });

    btnSettingsLogout.addEventListener('click', async () => {
        closeModal(settingsModal);
        await btnLogoutAccount.click();
    });

    // --- Auto-bloqueo por Inactividad (configurable) ---
    let inactivityTimer;
    const getInactivityLimit = () => {
        const min = getAutolockMinutes();
        return min > 0 ? min * 60 * 1000 : 0;
    };
    const scheduleInactivity = () => {
        clearTimeout(inactivityTimer);
        const limit = getInactivityLimit();
        if (limit > 0 && currentMasterPassword) {
            inactivityTimer = setTimeout(() => {
                btnLock.click();
                showToast('Sesión cerrada por inactividad', 'info');
            }, limit);
        }
    };
    const resetTimer = scheduleInactivity;
    // keypress está deprecado y no dispara con teclas no imprimibles.
    ['click', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, resetTimer, true);
    });

    // --- Inicialización ---
    if (AuthModule.isLoggedIn()) {
        setPinMode('unlock');
        showScreen('login-screen');
    } else {
        showScreen('auth-screen');
    }
});
