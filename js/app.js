/**
 * app.js
 * Controlador principal de la aplicación.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Referencias al DOM ---
    const loginScreen = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');
    const loginForm = document.getElementById('login-form');
    const masterPinInput = document.getElementById('master-pin');
    
    const passwordsList = document.getElementById('passwords-list');
    const btnAdd = document.getElementById('btn-add');
    const btnLock = document.getElementById('btn-lock');
    const searchInput = document.getElementById('search-input');
    
    // Modales
    const passwordModal = document.getElementById('password-modal');
    const passwordForm = document.getElementById('password-form');
    const btnCancelModal = document.getElementById('btn-cancel-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const toggleEntryPwd = document.getElementById('toggle-entry-pwd');
    const entryPassword = document.getElementById('entry-password');
    const modalTitle = document.getElementById('modal-title');
    
    // Elementos del formulario
    const entryId = document.getElementById('entry-id');
    const entryPlatform = document.getElementById('entry-platform');
    const entryUsername = document.getElementById('entry-username');
    
    // Modal Confirmación
    const confirmModal = document.getElementById('confirm-modal');
    const btnCancelDelete = document.getElementById('btn-cancel-delete');
    const btnConfirmDelete = document.getElementById('btn-confirm-delete');
    
    const toastContainer = document.getElementById('toast-container');

    // --- Estado de la Aplicación ---
    let currentMasterPassword = null;
    let vaultData = [];
    let entryToDelete = null;

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

    const showScreen = (screenId) => {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    };

    const openModal = (modal) => {
        modal.classList.add('active');
        // Reset scroll when modal opens
        modal.querySelector('.modal-content').scrollTop = 0;
    };
    
    const closeModal = (modal) => modal.classList.remove('active');

    // --- Lógica de Negocio ---

    // Login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pin = masterPinInput.value;
        const loginBtn = document.getElementById('login-btn');
        
        try {
            loginBtn.textContent = 'Verificando...';
            loginBtn.disabled = true;

            if (!StorageModule.hasVault()) {
                // Primer uso, inicializar bóveda vacía
                currentMasterPassword = pin;
                await StorageModule.saveVault([], currentMasterPassword);
                vaultData = [];
                showToast('Bóveda inicializada con éxito', 'success');
            } else {
                // Intentar cargar y desencriptar
                vaultData = await StorageModule.loadVault(pin);
                currentMasterPassword = pin;
                showToast('Bóveda desbloqueada', 'success');
            }
            
            masterPinInput.value = '';
            renderPasswords();
            showScreen('dashboard-screen');
            
        } catch (error) {
            showToast(error.message, 'error');
            masterPinInput.value = '';
            masterPinInput.focus();
        } finally {
            loginBtn.textContent = 'Desbloquear';
            loginBtn.disabled = false;
        }
    });

    // Cerrar Sesión / Bloquear
    btnLock.addEventListener('click', () => {
        currentMasterPassword = null;
        vaultData = [];
        passwordsList.innerHTML = '';
        showScreen('login-screen');
        showToast('Bóveda bloqueada', 'info');
    });

    // Renderizar Lista
    const renderPasswords = (filter = '') => {
        passwordsList.innerHTML = '';
        
        const filtered = vaultData.filter(item => 
            item.platform.toLowerCase().includes(filter.toLowerCase()) || 
            item.username.toLowerCase().includes(filter.toLowerCase())
        );

        if (filtered.length === 0) {
            passwordsList.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-folder-open"></i>
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
                    <span class="item-platform">${item.platform}</span>
                    <span class="item-username">${item.username}</span>
                </div>
                <div class="item-actions">
                    <button class="btn-icon copy-btn" data-pwd="${item.password}" title="Copiar Contraseña">
                        <i class="fa-regular fa-copy"></i>
                    </button>
                    <button class="btn-icon edit-btn" data-id="${item.id}" title="Editar">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-icon btn-delete" data-id="${item.id}" title="Eliminar">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            passwordsList.appendChild(div);
        });

        // Eventos para los botones generados
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pwd = btn.getAttribute('data-pwd');
                navigator.clipboard.writeText(pwd).then(() => {
                    showToast('Contraseña copiada', 'success');
                }).catch(() => {
                    showToast('No se pudo copiar', 'error');
                });
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

    // Búsqueda
    searchInput.addEventListener('input', (e) => {
        renderPasswords(e.target.value);
    });

    // --- Modal Crear/Editar ---
    btnAdd.addEventListener('click', () => {
        passwordForm.reset();
        entryId.value = '';
        modalTitle.textContent = 'Nueva Contraseña';
        entryPassword.type = 'password';
        toggleEntryPwd.innerHTML = '<i class="fa-solid fa-eye"></i>';
        openModal(passwordModal);
    });

    [btnCancelModal, closeModalBtn].forEach(btn => {
        btn.addEventListener('click', () => {
            closeModal(passwordModal);
        });
    });

    toggleEntryPwd.addEventListener('click', () => {
        if (entryPassword.type === 'password') {
            entryPassword.type = 'text';
            toggleEntryPwd.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
        } else {
            entryPassword.type = 'password';
            toggleEntryPwd.innerHTML = '<i class="fa-solid fa-eye"></i>';
        }
    });

    const openEditModal = (id) => {
        const item = vaultData.find(i => i.id === id);
        if (item) {
            entryId.value = item.id;
            entryPlatform.value = item.platform;
            entryUsername.value = item.username;
            entryPassword.value = item.password;
            entryPassword.type = 'password';
            toggleEntryPwd.innerHTML = '<i class="fa-solid fa-eye"></i>';
            modalTitle.textContent = 'Editar Contraseña';
            openModal(passwordModal);
        }
    };

    // Guardar (Crear / Editar)
    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = entryId.value;
        const newItem = {
            id: id ? id : Date.now().toString(),
            platform: entryPlatform.value,
            username: entryUsername.value,
            password: entryPassword.value
        };

        if (id) {
            // Edit
            const index = vaultData.findIndex(i => i.id === id);
            if (index !== -1) vaultData[index] = newItem;
        } else {
            // Create
            vaultData.push(newItem);
        }

        const success = await StorageModule.saveVault(vaultData, currentMasterPassword);
        if (success) {
            showToast('Bóveda actualizada', 'success');
            closeModal(passwordModal);
            renderPasswords(searchInput.value);
        } else {
            showToast('Error al guardar', 'error');
        }
    });

    // --- Modal Confirmación Borrar ---
    btnCancelDelete.addEventListener('click', () => {
        entryToDelete = null;
        closeModal(confirmModal);
    });

    btnConfirmDelete.addEventListener('click', async () => {
        if (entryToDelete) {
            vaultData = vaultData.filter(i => i.id !== entryToDelete);
            const success = await StorageModule.saveVault(vaultData, currentMasterPassword);
            if (success) {
                showToast('Credencial eliminada', 'success');
                renderPasswords(searchInput.value);
            } else {
                showToast('Error al actualizar bóveda', 'error');
            }
            entryToDelete = null;
            closeModal(confirmModal);
        }
    // --- Generador de Contraseñas ---
    const btnGeneratePwd = document.getElementById('btn-generate-pwd');
    if (btnGeneratePwd) {
        btnGeneratePwd.addEventListener('click', () => {
            entryPassword.value = PasswordGenerator.generate(16);
            entryPassword.type = 'text';
            toggleEntryPwd.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
        });
    }

    // --- Auto-bloqueo por Inactividad ---
    let inactivityTimer;
    const INACTIVITY_LIMIT = 5 * 60 * 1000; // 5 minutos por defecto

    const resetTimer = () => {
        clearTimeout(inactivityTimer);
        if (currentMasterPassword) {
            inactivityTimer = setTimeout(() => {
                btnLock.click();
                showToast('Sesión cerrada por inactividad', 'info');
            }, INACTIVITY_LIMIT);
        }
    };

    // Eventos que resetean el temporizador
    ['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, resetTimer, true);
    });
});
