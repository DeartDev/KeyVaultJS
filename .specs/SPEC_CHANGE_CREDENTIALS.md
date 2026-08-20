# Especificación — Cambio de Credenciales (Password de Cuenta + PIN Maestro)

> Estado: **Borrador** · Fecha: 2026-07-30
> Companion de `.specs/SPEC_BACKEND.md`. Define dos funcionalidades nuevas de gestión de credenciales.
> Ambas **requieren verificar la credencial actual** antes de permitir el cambio.

---

## 1. Objetivo y alcance

Permitir al usuario cambiar, desde la app:

1. **Contraseña de cuenta** (la que se usa para iniciar sesión en el backend).
2. **PIN maestro** (el que cifra/descifra la bóveda localmente).

Ambas operaciones son **destructivas si se olvidan** y deben protegerse exigiendo la credencial actual.

### Regla de oro
- **Cambio de contraseña de cuenta** → el backend verifica la contraseña actual (bcrypt).
- **Cambio de PIN maestro** → el navegador verifica el PIN actual descifrando la bóveda con él (el PIN **nunca** sale del cliente, por Zero-Knowledge).

### Fuera de alcance
- Recuperación de credenciales olvidadas (no existe por diseño Zero-Knowledge).
- 2FA (futuro).
- Revocación remota del PIN (imposible: el backend no lo conoce).

---

## 2. Dos credenciales, dos mecanismos

| Aspecto | Contraseña de cuenta | PIN maestro |
|---|---|---|
| ¿Quién la verifica? | Backend (bcrypt) | Frontend (descifrado AES-GCM) |
| ¿Viaja al servidor? | Sí (solo en el request de cambio, nunca se almacena en claro) | **No**, jamás |
| ¿Persistencia? | `users.password_hash` | No se persiste (es ephemeral en sesión) |
| Al cambiar | Re-hash bcrypt + revocación de refresh tokens | Re-cifrado del vault + nuevo blob |
| Endpoint | `POST /api/auth/change-password` (nuevo) | `PUT /api/vault` (existente) |

---

## 3. Funcionalidad A — Cambio de contraseña de cuenta

### 3.1 Endpoint

#### `POST /api/auth/change-password`

**Requiere** `Authorization: Bearer <accessToken>` (sesión activa).

**Request**
```json
{
  "currentPassword": "supersecret123",
  "newPassword": "nuevaSuperSecret456"
}
```

**Validaciones (zod)**
- `currentPassword`: string, 1–128.
- `newPassword`: string, min 12, max 128.
- `newPassword !== currentPassword` (rechazado con `400 bad_request`).

**Lógica del controlador**
1. Cargar `password_hash` del usuario autenticado (`req.user.id`).
2. `bcrypt.compare(currentPassword, hash)`:
   - Si no coincide → `401 invalid_credentials` ("Current password is incorrect").
3. `bcrypt.hash(newPassword, BCRYPT_ROUNDS)`.
4. En una transacción:
   - `UPDATE users SET password_hash = $1 WHERE id = $2`.
   - `UPDATE refresh_tokens SET revoked = true WHERE user_id = $1` (revoca **todos** los refresh tokens).
5. Emitir un **nuevo par** access + refresh (para que el cliente continúe sin re-login).
6. Devolver respuesta.

**Response `200 OK`**
```json
{
  "accessToken":  "eyJhbGci...",
  "refreshToken": "eyJhbGci..."
}
```

**Errores**
| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `bad_request` | `newPassword === currentPassword` |
| 401 | `invalid_credentials` | `currentPassword` incorrecta |
| 422 | `validation_error` | Campos inválidos (longitud, etc.) |

### 3.2 Modelo de datos
**Sin migraciones**. Se reutilizan `users.password_hash` y la tabla `refresh_tokens` existentes.

### 3.3 Seguridad
- La verificación usa `bcrypt.compare` (constante en tiempo para evitar timing-attacks).
- Tras el cambio, **todos** los refresh tokens quedan revocados → cualquier otra sesión abierta en otro dispositivo se cierra al próximo intento de refresh.
- Se entrega un par nuevo solo al cliente que hizo el cambio; los demás dispositivos deben re-loguearse con la nueva contraseña.

---

## 4. Funcionalidad B — Cambio de PIN maestro

### 4.1 Principio
El PIN maestro **no se envía al servidor**. Cambiarlo significa:

1. Verificar el PIN actual descifrando la bóveda con él.
2. Re-cifrar el contenido (mismo array de credenciales) con el nuevo PIN.
3. Subir el nuevo blob cifrado con `PUT /api/vault` (manejando el `version` como siempre).

### 4.2 Salt del vault
**Decisión**: mantener el `pm_salt` existente (no rotar).
- El salt es por-usuario y ya aleatorio; rotarlo no aporta seguridad práctica en este flujo.
- El backend ya guarda `users.vault_salt`; no requiere cambios.
- *Futuro*: si se quiere rotación de salt, se añade `POST /api/auth/rotate-vault-salt` (fuera de este spec).

### 4.3 Flujo detallado (frontend)
```
Usuario introduce PIN actual
        │
        ▼
StorageModule.loadVault(pinActual)  ──►  ¿descifra OK?
        │                                      │
       ok                                    error → "PIN actual incorrecto"
        │
        ▼
Usuario introduce PIN nuevo (+ confirmación)
        │
        ▼
Validación cliente (longitud mínima, coincidencia)
        │
        ▼
StorageModule.saveVault(vaultData, pinNuevo)
   - cifra con PIN nuevo
   - PUT /api/vault (con version actual)
   - maneja 409 (conflict) como ya hace
        │
        ▼
currentMasterPassword = pinNuevo   (actualizar en memoria)
mostrar toast "PIN maestro actualizado"
```

### 4.4 Validaciones del PIN nuevo
- Longitud mínima: configurable; propongo **mínimo 6 caracteres** (más flexible que la password de cuenta, dado que el PIN debe memorizarse fácilmente y el cifrado AES-GCM + PBKDF2 de 100k iteraciones ya lo protege contra fuerza bruta offline si el blob se filtra).
- Confirmación: el campo "repetir PIN nuevo" debe coincidir.
- El PIN nuevo **debe diferir** del actual (si no, se rechaza con mensaje y sin subir nada).

### 4.5 Edge cases
- **Conflicto de versión (`409`)**: si la bóveda cambió en otro dispositivo mientras se cambiaba el PIN, aplicar el flujo existente de `saveVaultWithConflictHandling` (pull → merge → retry). El usuario debe resolver antes de que el cambio de PIN efectivamente persista.
- **Otro dispositivo con sesión activa**: tras cambiar el PIN en A, el dispositivo B tiene el PIN viejo en memoria. Al intentar leer/escribir fallará el descifrado. **Esperado**: B debe re-bloquear y re-abrir con el nuevo PIN. No hay forma de "empujar" el cambio (Zero-Knowledge).
- **PIN actual incorrecto**: no se toca el vault ni se hace PUT. Mensaje claro.

### 4.6 Sin endpoint nuevo
Se reutiliza `PUT /api/vault`. El cambio de PIN es invisible para el backend (sigue siendo "un PUT más" con un blob distinto).

---

## 5. UX / UI

### 5.1 Acceso
Desde el **modal de Configuración** (botón engranaje), añadir dos secciones:

```
[ Configuración ]
  Tema:           [ Automático ▾ ]
  Auto-bloqueo:   [ 5 ] minutos

  ─────────────────────────────────
  [ Cambiar contraseña de cuenta  ▸ ]
  [ Cambiar PIN maestro           ▸ ]
  ─────────────────────────────────
  [ Cerrar sesión ]
```

Cada botón abre un **sub-modal** dedicado (o reutiliza el modal de password con título dinámico).

### 5.2 Modal "Cambiar contraseña de cuenta"
- Contraseña actual (type=password)
- Nueva contraseña (mín. 12)
- Repetir nueva contraseña
- Validación inline de coincidencia y longitud.
- Botón **Guardar** → llama a `POST /api/auth/change-password`. Al success, reemplaza tokens y muestra toast.

### 5.3 Modal "Cambiar PIN maestro"
- PIN actual
- PIN nuevo (mín. 6)
- Repetir PIN nuevo
- Botón **Guardar** → ejecuta el flujo del §4.3.
- **Aclaración visible**: "Si olvidas tu PIN maestro, **no podrás recuperar** tu bóveda. Guárdalo en un lugar seguro."

---

## 6. Cambios en el código

### 6.1 Backend
| Archivo | Cambio |
|---|---|
| `api/src/schemas/authSchema.js` | Añadir `changePasswordSchema` |
| `api/src/controllers/authController.js` | Añadir `changePassword` controller |
| `api/src/routes/auth.js` | Registrar `POST /api/auth/change-password` (protegido por `requireAuth`) |
| `api/src/middleware/auth.js` | (sin cambios; `requireAuth` ya existe) |

> `requireAuth` debe aplicarse a esta ruta. Actualmente `auth.js` no monta `requireAuth` globalmente; se añade por ruta.

### 6.2 Frontend
| Archivo | Cambio |
|---|---|
| `js/api.js` | Añadir `changePassword(currentPassword, newPassword)` |
| `js/storage.js` | Añadir `changeMasterPin(currentPin, newPin)` que orquesta load→save |
| `js/app.js` | Manejar los dos nuevos sub-modales + validación inline |
| `index.html` | Añadir los dos sub-modales + botones en el modal de settings |
| `css/styles.css` | (mínimo) estilos para el sub-modal/links de settings |

---

## 7. Criterios de aceptación

### Cambio de contraseña
1. Con sesión activa, puedo cambiar la contraseña introduciendo la actual y una nueva válida.
2. Si `currentPassword` es incorrecta → `401` + mensaje, sin modificar el hash.
3. Tras el cambio, recibo tokens nuevos y sigo logueado sin re-login.
4. Un refresh token emitido **antes** del cambio queda revocado (`POST /api/auth/refresh` → `401`).
5. `newPassword === currentPassword` → `400`.
6. `newPassword` con < 12 caracteres → `422`.

### Cambio de PIN
1. Con la bóveda desbloqueada, puedo cambiar el PIN introduciendo el actual.
2. Si el PIN actual es incorrecto → no se descifra, no se hace PUT, mensaje "PIN actual incorrecto".
3. Tras el cambio, el vault queda cifrado con el nuevo PIN (verificable: bloquear y desbloquear con el nuevo PIN funciona; con el viejo falla).
4. Si hay conflicto de versión (`409`), se aplica el flujo de merge existente.
5. El PIN nuevo igual al actual → rechazado en cliente, sin llamada al backend.
6. El backend **no recibe** el PIN (ni el actual ni el nuevo) en ninguna petición.

---

## 8. Pruebas sugeridas

| Caso | Tipo | Expectativa |
|---|---|---|
| Cambio OK de contraseña | Integración | 200, tokens nuevos, viejos refresh revocados |
| Contraseña actual incorrecta | Integración | 401 |
| Nueva igual a actual | Integración | 400 |
| Nueva muy corta | Integración | 422 |
| Refresh con token pre-cambio | Integración | 401 |
| Cambio de PIN con actual correcto | E2E (navegador) | PUT /api/vault con blob nuevo; re-bloqueo con PIN nuevo funciona |
| Cambio de PIN con actual incorrecto | E2E | Sin PUT; mensaje de error |
| Conflicto de versión durante cambio de PIN | E2E | Resolución vía merge existente |

---

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Usuario cambia PIN y lo olvida inmediatamente | Mensaje de advertencia visible + (futuro) sugerencia de exportar backup cifrado |
| Otra sesión abierta queda inconsistente tras cambio de PIN | Documentar: debe re-bloquear y re-abrir. No recuperable de otro modo por diseño. |
| Cambio de contraseña deja refresh tokens huérfanos | Revocación masiva en la misma transacción del UPDATE |
| Ataque de timing en verificación de contraseña actual | Usar `bcrypt.compare` (constante en tiempo) |

---

## 10. Out of scope (futuro)

- Recuperación de cuenta vía email (rompe Zero-Knowledge parcialmente; requiere diseño cuidadoso).
- Rotación de salt del vault.
- Historial de contraseñas (no reutilizar últimas N).
- 2FA / TOTP.
- Detección de compromiso (notificar al usuario sesiones activas).

---

*Spec listo para implementación en la rama `dev`. La implementación debe seguir el orden: backend (A) → frontend (A) → frontend (B), ya que B no requiere cambios de backend.*
