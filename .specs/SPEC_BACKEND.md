# Especificación Técnica del Backend — KeyVaultJS API

> Estado: **Borrador aprobado** · Fecha: 2026-07-30
> Companion de `docs/PLAN_DOCKERIZACION.md`. Define el contrato técnico del backend Node.js/Express + PostgreSQL.

---

## 1. Objetivo y alcance

Proveer una API REST que permita:

1. **Autenticación multi-usuario** (registro, login, refresh, logout) con JWT.
2. **Persistencia del vault cifrado** por usuario, preservando el modelo **Zero-Knowledge**.

**Fuera de alcance**: el backend **no** conoce la estructura interna del vault, no descifra, no busca dentro de él, no conoce el PIN maestro. Solo persiste un blob opaco.

---

## 2. Stack y dependencias

| Componente | Paquete / Versión |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | `express` ^4.19 |
| Driver Postgres | `pg` ^8.12 |
| Hash de password | `bcrypt` ^5.1 |
| JWT | `jsonwebtoken` ^9.0 |
| Validación | `zod` ^3.23 |
| Logger | `pino` ^9 |
| Migraciones | `node-pg-migrate` ^7 (o sql seco ejecutado por script) |
| CORS | **No requerido** (mismo origen vía nginx proxy) |
| Process manager | contenedor Docker con `restart: unless-stopped` |

---

## 3. Variables de entorno

| Variable | Obligatoria | Default | Descripción |
|---|---|---|---|
| `DATABASE_URL` | Sí | — | `postgres://user:pass@db:5432/dbname` |
| `JWT_SECRET` | Sí | — | Clave HMAC para access tokens (32+ bytes hex) |
| `JWT_REFRESH_SECRET` | Sí | — | Clave HMAC para refresh tokens (32+ bytes hex, **distinta**) |
| `JWT_ACCESS_TTL` | No | `15m` | Tiempo de vida del access token |
| `JWT_REFRESH_TTL` | No | `7d` | Tiempo de vida del refresh token |
| `BCRYPT_ROUNDS` | No | `12` | Costo del hash bcrypt |
| `PORT` | No | `3000` | Puerto de escucha (interno del contenedor) |
| `NODE_ENV` | No | `development` | `production` recomendado en servidor |

---

## 4. Modelo de datos

### 4.1 Tabla `users`

| Columna | Tipo | Restricciones | Notas |
|---|---|---|---|
| `id` | `UUID` | PK, default `gen_random_uuid()` | |
| `email` | `VARCHAR(255)` | UNIQUE NOT NULL | Normalizado a minúsculas |
| `password_hash` | `VARCHAR(255)` | NOT NULL | bcrypt de la password de **cuenta** |
| `vault_salt` | `TEXT` | NOT NULL | Salt del vault, **enviado por el cliente** (base64) |
| `created_at` | `TIMESTAMPTZ` | default `now()` | |
| `updated_at` | `TIMESTAMPTZ` | default `now()` | |

> `vault_salt` se guarda para que el cliente pueda derivar la clave correctamente al cambiar de dispositivo. **No** es sensible: el salt puede ser público sin romper el cifrado.

### 4.2 Tabla `vaults`

| Columna | Tipo | Restricciones | Notas |
|---|---|---|---|
| `user_id` | `UUID` | PK, FK → `users(id) ON DELETE CASCADE` | 1 vault por usuario |
| `encrypted_blob` | `TEXT` | NOT NULL | Formato `ivBase64:ciphertextBase64` |
| `version` | `INTEGER` | NOT NULL default 1 | Concurrencia optimista |
| `updated_at` | `TIMESTAMPTZ` | default `now()` | |

### 4.3 Tabla `refresh_tokens`

| Columna | Tipo | Restricciones | Notas |
|---|---|---|---|
| `id` | `UUID` | PK, default `gen_random_uuid()` | |
| `user_id` | `UUID` | FK → `users(id) ON DELETE CASCADE` | |
| `token_hash` | `VARCHAR(255)` | NOT NULL | sha256 hex del refresh token |
| `expires_at` | `TIMESTAMPTZ` | NOT NULL | |
| `revoked` | `BOOLEAN` | default `false` | |
| `created_at` | `TIMESTAMPTZ` | default `now()` | |

### 4.4 SQL de creación

Ver `docs/PLAN_DOCKERIZACION.md` §7 o `api/src/db/migrations/001_init.sql`.

---

## 5. Autenticación con JWT

### 5.1 Tokens

- **Access token**: JWT firmado con `JWT_SECRET`, TTL corto (`15m`). Payload:
  ```json
  { "sub": "<uuid>", "email": "...", "type": "access", "iat": ..., "exp": ... }
  ```
- **Refresh token**: JWT firmado con `JWT_REFRESH_SECRET`, TTL largo (`7d`). Payload:
  ```json
  { "sub": "<uuid>", "jid": "<uuid>", "type": "refresh", "iat": ..., "exp": ... }
  ```
  - Solo se persiste su **hash sha256** en `refresh_tokens.token_hash`.
  - Se **revoca** marcando `revoked = true`.

### 5.2 Rotación (recomendado)

Al usar un refresh token, el backend:
1. Verifica firma + expiración + no revocado.
2. Marca ese token como `revoked = true`.
3. Emite un **nuevo par** access + refresh.
4. Devuelve ambos.

### 5.3 Cabeceras

```
Authorization: Bearer <accessToken>
```

---

## 6. Contrato de endpoints

> Todas las respuestas usan `Content-Type: application/json`.
> Errores: ver §7.

### 6.1 `POST /api/auth/register`

Crea una cuenta nueva y un vault vacío.

**Request**
```json
{
  "email": "user@example.com",
  "password": "passwordDeCuenta",
  "vaultSalt": "base64SaltDe16Bytes=="
}
```

**Validaciones (zod)**
- `email`: email válido, normalizado a minúsculas.
- `password`: mínimo 12 caracteres, máx 128.
- `vaultSalt`: base64 no vacío.

**Response `201 Created`**
```json
{
  "user": { "id": "...", "email": "..." },
  "accessToken":  "eyJhbGci...",
  "refreshToken": "eyJhbGci..."
}
```

**Errores**
- `409 Conflict` — email ya registrado.

---

### 6.2 `POST /api/auth/login`

**Request**
```json
{ "email": "user@example.com", "password": "passwordDeCuenta" }
```

**Response `200 OK`**
```json
{
  "user": { "id": "...", "email": "...", "vaultSalt": "..." },
  "accessToken":  "eyJhbGci...",
  "refreshToken": "eyJhbGci..."
}
```

**Errores**
- `401 Unauthorized` — credenciales inválidas (mensaje genérico, no distinguir usuario existe/no existe).

---

### 6.3 `POST /api/auth/refresh`

**Request**
```json
{ "refreshToken": "eyJhbGci..." }
```

**Response `200 OK`**
```json
{
  "accessToken":  "eyJhbGci...",
  "refreshToken": "eyJhbGci..."     // nuevo, el anterior queda revocado
}
```

**Errores**
- `401 Unauthorized` — token inválido, expirado o revocado.

---

### 6.4 `POST /api/auth/logout`

Requiere `Authorization: Bearer <accessToken>`.

**Request**
```json
{ "refreshToken": "eyJhbGci..." }
```

**Response `204 No Content`**

Revoca el refresh token indicado (y los expirados del usuario, opcionalmente).

---

### 6.5 `GET /api/vault`

Requiere `Authorization: Bearer <accessToken>`.

**Response `200 OK`**
```json
{
  "encryptedBlob": "ivBase64:ciphertextBase64",
  "version": 3,
  "updatedAt": "2026-07-30T12:34:56.000Z"
}
```

**Errores**
- `404 Not Found` — el usuario no tiene vault todavía (no debería ocurrir si el registro lo crea vacío, pero se cubre).

---

### 6.6 `PUT /api/vault`

Requiere `Authorization: Bearer <accessToken>`.

**Request**
```json
{
  "encryptedBlob": "ivBase64:ciphertextBase64",
  "version": 3                     // versión que el cliente cree que es la actual
}
```

**Lógica de concurrencia optimista**
1. `SELECT version FROM vaults WHERE user_id = $1`
2. Si el `version` recibido **!=** el de la BD → `409 Conflict`.
3. Si coincide → `UPDATE ... SET encrypted_blob = $1, version = version + 1`.
4. **Excepción**: si no existe fila y `version === 0` → `INSERT` (permite primer upload si el registro no creó el vault).

**Response `200 OK`**
```json
{ "version": 4, "updatedAt": "2026-07-30T12:35:00.000Z" }
```

**Errores**
- `409 Conflict`
  ```json
  { "error": "version_conflict", "currentVersion": 3, "message": "El vault fue modificado en otro dispositivo. Haz pull y reintenta." }
  ```
- `413 Payload Too Large` — `encryptedBlob` > 1 MB (configurable).

---

## 7. Formato de errores estándar

Todas las respuestas de error siguen:

```json
{
  "error": "<machine_readable_code>",
  "message": "<human_readable_es>"
}
```

| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `bad_request` | Validación zod fallida |
| 401 | `unauthorized` | JWT ausente/inválido/expirado |
| 401 | `invalid_credentials` | Login fallido |
| 403 | `forbidden` | Token correcto pero sin permiso para el recurso |
| 404 | `not_found` | Recurso inexistente |
| 409 | `conflict` / `version_conflict` | Duplicado o conflicto de versión |
| 413 | `payload_too_large` | Blob > límite |
| 422 | `validation_error` | Errores de campos (detalles en `details[]`) |
| 429 | `rate_limited` | Excedido el límite (si se aplica) |
| 500 | `internal_error` | Error no esperado (log con correlation id) |

---

## 8. Seguridad

### 8.1 Invariantes Zero-Knowledge

- El backend **nunca** recibe el PIN maestro ni las contraseñas en claro del vault.
- `encrypted_blob` es opaco: nunca se deserializa, solo se persiste y se devuelve.
- `vault_salt` se guarda por conveniencia (derivación estable entre dispositivos) pero no es secreto.

### 8.2 Password de cuenta

- bcrypt con `BCRYPT_ROUNDS = 12`.
- No se persiste ni se loguea nunca en claro.
- Política mínima: 12 caracteres (validación zod).

### 8.3 JWT

- `JWT_SECRET` y `JWT_REFRESH_SECRET` **distintos**, de 32 bytes hex (`openssl rand -hex 32`).
- Access TTL `15m`; refresh TTL `7d`.
- Refresh tokens hasheados (sha256) en BD → revocación posible.
- Logout revoca; cambiar password revoca **todos** los refresh tokens del usuario.

### 8.4 Cabeceras de respuesta

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=63072000; includeSubDomains   (vía Apache en prod)
Cache-Control: no-store    (en respuestas de la API)
```

### 8.5 Rate limiting (recomendado para endurecer)

- `express-rate-limit` en `/api/auth/login` y `/api/auth/register`: 10 intentos / 10 min / IP.
- En `/api/vault`: 60 req / min / usuario.

### 8.6 Logging

- `pino` con nivel configurable por `LOG_LEVEL` (default `info`).
- **Nunca** loguear: `password`, `encryptedBlob`, `refreshToken`, `Authorization`.
- correlation id por request (`req.id`).

---

## 9. Manejo de concurrencia del vault

```
Cliente A                          Servidor                         Cliente B
   │                                  │                                  │
   │── GET /api/vault ───────────────►│                                  │
   │◄── version=3 ────────────────────│                                  │
   │                                  │◄──── GET /api/vault ─────────────│
   │                                  │──── version=3 ──────────────────►│
   │  (edita offline)                 │                                  │ (edita offline)
   │── PUT {version:3, blob:X} ──────►│                                  │
   │   version==3 → OK                │                                  │
   │◄── version=4 ────────────────────│                                  │
   │                                  │◄── PUT {version:3, blob:Y} ──────│
   │                                  │ 3 != 4 → 409 Conflict            │
   │                                  │──── 409 {currentVersion:4} ─────►│
   │                                  │                                  │ pull→merge→push
```

**Responsabilidad del cliente**: ante `409`, hacer `GET`, resolver el merge (estrategia: el usuario decide; para MVP, sobrescribir con confirmación), y reintentar `PUT` con el `version` correcto.

---

## 10. Estructura de código del backend

```
api/src/
├── server.js                  # bootstrap Express
├── app.js                     # configuración de middlewares y rutas
├── config/
│   └── index.js               # parseo y validación de env vars (zod)
├── db/
│   ├── pool.js                # pg.Pool desde DATABASE_URL
│   └── migrations/
│       └── 001_init.sql
├── routes/
│   ├── auth.js                # monta /api/auth/*
│   └── vault.js               # monta /api/vault
├── controllers/
│   ├── authController.js      # register/login/refresh/logout
│   └── vaultController.js     # get/put
├── middleware/
│   ├── auth.js                # verifyAccessToken, attach req.user
│   ├── errorHandler.js        # handler final de errores
│   └── notFound.js
├── utils/
│   ├── jwt.js                 # sign/verify access y refresh
│   ├── password.js            # bcrypt hash/compare
│   └── httpErrors.js          # clases HttpError
└── schemas/
    ├── authSchema.js          # zod: register, login, refresh
    └── vaultSchema.js         # zod: putVault
```

**Patrones**:
- Capa controller → usa `pg.Pool` directamente (sin ORM). Si crece, extraer repositorios.
- Errores lanzados como instancias de `HttpError(status, code, message)` y capturados en `errorHandler`.
- Todas las rutas bajo `/api`. Healthcheck en `GET /api/health` → `{ status:"ok", db:"up"|"down" }`.

---

## 11. Healthcheck y observabilidad

- `GET /api/health` → `200 { status:"ok", db:"up" }` o `503 { status:"degraded", db:"down" }`.
- Docker compose usa este endpoint como healthcheck del contenedor `api`:
  ```yaml
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
    interval: 30s
    timeout: 5s
    retries: 3
  ```

---

## 12. Pruebas sugeridas (no bloqueantes para el MVP)

| Capa | Tipo | Casos mínimos |
|---|---|---|
| Auth | Integración (supertest + testcontainers pg) | registro ok, email duplicado 409, login ok, login pass mala 401, refresh rota rotación, logout revoca |
| Vault | Integración | get vacío 404, put nuevo, put versión correcta, put versión stale 409, sin auth 401, payload > límite 413 |
| Seguridad | Unit | bcrypt correcto, jwt sign/verify, errores zod |

---

## 13. Criterios de aceptación del MVP

1. Un usuario puede `register` y recibir tokens.
2. Un usuario puede `login` y recibir tokens + `vaultSalt`.
3. Un usuario autenticado puede `GET /api/vault` y `PUT /api/vault`.
4. Concurrencia: dos `PUT` con misma versión → el segundo devuelve `409`.
5. `logout` revoca el refresh token; un `refresh` posterior devuelve `401`.
6. `docker compose up` levanta `db` + `api` + `web` y `https://localhost` (o `IP:8084`) sirve la app autenticando contra la API.
7. El backend nunca recibe ni loguea el PIN maestro (verificable inspeccionando logs y el payload de `/api/vault`).

---

## 14. Out of scope (futuro)

- Autenticación 2FA (TOTP).
- Compartir credenciales entre usuarios.
- Búsqueda server-side dentro del vault (rompería Zero-Knowledge; requeriría cifrado homomórfico o proxy de búsqueda).
- Rate limiting distribuido (Redis).
- End-to-end tests en navegador (Playwright).

---

*Especificación viva. Cambios posteriores deben reflejarse aquí y en `docs/PLAN_DOCKERIZACION.md`.*
