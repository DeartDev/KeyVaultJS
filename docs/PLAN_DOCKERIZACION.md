# Plan de Trabajo — Dockerización + Backend + PostgreSQL (KeyVaultJS)

> Estado: **Aprobado** · Fecha: 2026-07-30
> Autor: Plan generado asistidamente a partir del análisis del repositorio actual.

---

## 1. Resumen ejecutivo

Migrar la PWA **frontend-only** actual (que persiste en `localStorage`) a una arquitectura **multi-usuario con backend Node.js + Express y PostgreSQL**, preservando el modelo **Zero-Knowledge** (el backend solo guarda el *blob cifrado*, jamás el PIN ni las contraseñas en claro).

El sistema completo se dockeriza con `docker-compose` y se provee un **script bash de despliegue** que, al ejecutarse en el servidor tras un `git pull`:

1. Levanta los contenedores.
2. Ejecuta migraciones.
3. Solicita un **dominio**: si se provee, configura un **vhost de Apache** como reverse proxy y emite certificado **SSL con Certbot**; si se deja vacío, expone el servicio por `IP:8084`.

---

## 2. Estado actual (línea base)

| Aspecto | Estado actual |
|---|---|
| Tipo de app | PWA puramente frontend (Vanilla JS + HTML + CSS) |
| Backend | **No existe** |
| Base de datos | **No existe** — persistencia en `localStorage` (`js/storage.js:13`) |
| Modelo de usuarios | Single-user (un PIN maestro por dispositivo, `js/app.js:73`) |
| Cifrado | Zero-Knowledge: AES-GCM + PBKDF2 en el navegador (`js/crypto.js`) |
| Servidor requerido | Solo servir estáticos (nginx / `python -m http.server`) |
| Sync opcional | Google Drive (`js/gdrive-sync.js`) — **se elimina** |

---

## 3. Decisiones de diseño (acordadas)

| # | Decisión | Valor |
|---|---|---|
| D1 | Stack del backend | **Node.js + Express** |
| D2 | Modelo de usuarios | **Multi-usuario con cuentas** (registro/login) |
| D3 | Preservación Zero-Knowledge | **Blob cifrado opaco** (backend no interpreta el contenido) |
| D4 | Almacenamiento cliente | **Híbrido** — Postgres como fuente de verdad + `localStorage` como caché offline |
| D5 | Puertos asignados | Web **`8084:80`**, PostgreSQL **`5433:5432`** |
| D6 | Entorno servidor | Linux con Docker + Docker Compose |
| D7 | Exposición web | **Apache (host) como reverse proxy + Certbot SSL** |
| D8 | Gestión de secretos | **`.env` + `docker-compose`** |
| D9 | Integración Google Drive | **Eliminada** (Postgres reemplaza su rol) |
| D10 | Path de despliegue | `/var/www/keyvaultjs` |

---

## 4. Arquitectura objetivo

```
┌────────────────────────────────────────────────────────────────┐
│  Servidor Linux  (/var/www/keyvaultjs)                         │
│                                                                │
│  Internet ──► Apache (host, :80 / :443)                        │
│                 │  vhost: proxy_pass http://127.0.0.1:8084/     │
│                 │  certbot: certificado Let's Encrypt          │
│                 └──► Si no hay dominio: acceso directo :8084   │
│                                                                │
│  docker compose up -d                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ web (nginx)        8084:80   ← único puerto publicado  │    │
│  │   ├─ sirve estáticos del frontend                      │    │
│  │   └─ proxy_pass /api/*  ──►  api:3000                  │    │
│  │                                                        │    │
│  │ api (node/express)  interno  :3000                    │    │
│  │   ├─ JWT auth (access + refresh)                       │    │
│  │   ├─ /api/auth/*                                       │    │
│  │   └─ /api/vault   (solo lee/escribe blob cifrado)     │    │
│  │                                                        │    │
│  │ db (postgres:16)   5433:5432  + volumen pgdata        │    │
│  └────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

**Principio clave**: el contenedor `web` es el único expuesto al host (`8084:80`). El contenedor `api` vive solo en la red interna de Docker. Esto minimiza superficie de ataque y elimina problemas de CORS (el frontend y la API comparten origen desde la perspectiva del navegador).

---

## 5. Stack tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | Vanilla JS existente + `fetch` a `/api/*` | No se añade framework |
| Backend API | Node.js 20 LTS + Express | Contenedor slim |
| Auth | JWT (access 15 min + refresh 7 días) + bcrypt | Hash de password de **cuenta**, no del PIN |
| DB | PostgreSQL 16 + driver `pg` | UUID nativo |
| Contenedores | Docker multi-stage + docker-compose v2 | |
| Proxy/SSL host | Apache2 + certbot + `python3-certbot-apache` | |
| Config | `.env` + `docker-compose` | `.env` en `.gitignore` |

> **Zero-Knowledge invariante**: la password de **cuenta** se hashea con bcrypt para autenticación. El **PIN maestro** que cifra la bóveda **nunca** viaja al servidor: se queda en el navegador, cifra el vault con AES-GCM (igual que hoy) y solo se envía el `iv:ciphertext` resultante.

---

## 6. Estructura de directorios propuesta

```
KeyVaultJS/
├── api/                              # NUEVO backend
│   ├── src/
│   │   ├── server.js
│   │   ├── config/
│   │   │   └── index.js              # lee variables de entorno
│   │   ├── db/
│   │   │   ├── pool.js
│   │   │   └── migrations/
│   │   │       └── 001_init.sql
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   └── vault.js
│   │   ├── controllers/
│   │   │   ├── authController.js
│   │   │   └── vaultController.js
│   │   ├── middleware/
│   │   │   ├── auth.js               # verify JWT
│   │   │   └── errorHandler.js
│   │   └── utils/
│   │       ├── jwt.js
│   │       └── migrations.js
│   ├── package.json
│   ├── .dockerignore
│   └── Dockerfile
├── web/                              # contenedor nginx para el frontend
│   ├── nginx.conf
│   └── Dockerfile
├── js/                               # frontend existente (modificado)
│   ├── app.js                        # + flujo auth, logout real
│   ├── storage.js                    # híbrido local + remoto
│   ├── crypto.js                     # sin cambios
│   ├── api.js                        # NUEVO: cliente fetch + JWT
│   ├── auth.js                       # NUEVO: registro/login
│   ├── generator.js                  # sin cambios
│   └── (eliminar gdrive-sync.js)
├── deploy/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml       # overrides de producción
│   ├── .env.example
│   ├── install.sh                    # script de despliegue del servidor
│   └── apache/
│       ├── keyvault.example.conf     # plantilla vhost
│       └── setup-apache.sh           # helper invocado por install.sh
├── docs/
│   ├── PLAN_DOCKERIZACION.md         # este documento
│   └── DEPLOYMENT.md                 # (existente en .docs/, mover)
└── .specs/
    ├── SPEC.md                       # (existente)
    └── SPEC_BACKEND.md               # especificación técnica del backend
```

---

## 7. Modelo de datos (PostgreSQL)

```sql
-- api/src/db/migrations/001_init.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,        -- bcrypt de la password de CUENTA
    vault_salt    TEXT NOT NULL,                 -- salt del vault (enviado por cliente, en base64)
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vaults (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_blob TEXT NOT NULL,                -- iv:ciphertext  (AES-GCM, opaco para el backend)
    version        INTEGER NOT NULL DEFAULT 1,   -- control de concurrencia optimista
    updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,            -- sha256 del refresh token
    expires_at TIMESTAMPTZ NOT NULL,
    revoked    BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash  ON refresh_tokens(token_hash);
```

---

## 8. Endpoints de la API

Base path: `/api`

| Método | Ruta | Auth | Body | Descripción |
|---|---|---|---|---|
| POST | `/api/auth/register` | — | `{ email, password, vaultSalt }` | Crear cuenta. Crea vault vacío. |
| POST | `/api/auth/login` | — | `{ email, password }` | Devuelve `{ accessToken, refreshToken }` |
| POST | `/api/auth/refresh` | refresh cookie/header | `{ refreshToken }` | Nuevo `accessToken` |
| POST | `/api/auth/logout` | JWT | `{ refreshToken }` | Revoca el refresh token |
| GET | `/api/vault` | JWT | — | `{ encryptedBlob, version }` |
| PUT | `/api/vault` | JWT | `{ encryptedBlob, version }` | Guarda. Devuelve `409` si `version` no coincide |

**Concurrencia**: `version` permite detección de conflictos. Si dos dispositivos editan offline y sincronizan, el segundo recibe `409` y debe hacer pull → merge → push de nuevo.

> El contrato completo (request/response, códigos de error, formato de tokens) está en `.specs/SPEC_BACKEND.md`.

---

## 9. Cambios en el frontend

| Archivo | Acción | Cambios |
|---|---|---|
| `js/auth.js` | **NUEVO** | Pantallas de registro/login; guardar `accessToken` en memoria, `refreshToken` en `localStorage` (o cookie httpOnly si se habilita). |
| `js/api.js` | **NUEVO** | Wrapper `fetch` con inyección automática de `Authorization: Bearer <jwt>` y refresh transparente en `401`. |
| `js/storage.js` | **Modificar** | Escribir en `localStorage` (caché offline) **y** sincronizar con `/api/vault`: push on-save + pull on-login. Resolución de conflictos por `version`. |
| `js/app.js` | **Modificar** | Flujo multi-pantalla (auth → dashboard); logout real con revocación de token. |
| `js/gdrive-sync.js` | **Eliminar** | Y limpiar referencias en `index.html`. |
| `js/crypto.js`, `js/generator.js` | Sin cambios | |
| `index.html` | **Modificar** | Quitar script de gdrive; añadir pantallas de auth; ajustar service-worker. |

**Modo offline (PWA)**: si no hay conexión, escribe en local y encola un sync que se ejecuta al recuperar red (estrategia simplest: pull → comparar `version` → push).

---

## 10. Dockerización

### 10.1 `api/Dockerfile` (resumen)

- Stage `deps`: copia `package*.json`, `npm ci --omit=dev` (o `npm ci` para build).
- Stage `build` → `prod`: multi-stage para imagen final slim basada en `node:20-alpine`, usuario no-root, `CMD ["node", "src/server.js"]`.

### 10.2 `web/Dockerfile`

- Base `nginx:1.27-alpine`.
- Copia `index.html`, `css/`, `js/`, `manifest.json`, `service-worker.js` a `/usr/share/nginx/html`.
- Copia `web/nginx.conf` a `/etc/nginx/conf.d/default.conf`.

### 10.3 `web/nginx.conf`

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Reverse proxy hacia la API (mismo origen → sin CORS)
    location /api/ {
        proxy_pass http://api:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # No cachear el service worker
    location = /service-worker.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
```

### 10.4 `deploy/docker-compose.yml` (esquema)

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER:     ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB:       ${POSTGRES_DB}
    ports:
      - "5433:5432"            # administración desde el host
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: ../api
    restart: unless-stopped
    environment:
      NODE_ENV:             production
      DATABASE_URL:         postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      JWT_SECRET:           ${JWT_SECRET}
      JWT_REFRESH_SECRET:   ${JWT_REFRESH_SECRET}
      PORT:                 3000
    depends_on:
      db:
        condition: service_healthy
    # No se publica el puerto: solo accesible vía la red interna de compose

  web:
    build:
      context: ..
      dockerfile: web/Dockerfile
    restart: unless-stopped
    ports:
      - "8084:80"
    depends_on:
      - api

volumes:
  pgdata:
```

### 10.5 `.env.example`

```env
# Postgres
POSTGRES_USER=keyvault
POSTGRES_DB=keyvault
POSTGRES_PASSWORD=cambiar_por_valor_seguro

# JWT (se generan automáticamente en install.sh con `openssl rand -hex 32`)
JWT_SECRET=generar_valor_aleatorio_1
JWT_REFRESH_SECRET=generar_valor_aleatorio_2

# App
NODE_ENV=production
```

---

## 11. Script de instalación del servidor (`deploy/install.sh`)

**Ubicación de ejecución**: dentro de `/var/www/keyvaultjs` (tras el `git pull`).

**Flujo**:

1. **Preflight**: comprobar que existen `docker`, `docker compose`, `git`. Si falta algo, abortar con mensaje claro.
2. **`git pull`** (si el repo está clonado; si no, instrucciones para clonar).
3. **`.env`**: si no existe `deploy/.env`, copiar de `.env.example` y **generar automáticamente** `JWT_SECRET` y `JWT_REFRESH_SECRET` con `openssl rand -hex 32`. Pedir interactivamente `POSTGRES_PASSWORD` si está en blanco.
4. **Build + up**: `docker compose --env-file deploy/.env -f deploy/docker-compose.yml build` y `up -d`.
5. **Migraciones**: esperar a que `db` esté healthy y ejecutar `001_init.sql` vía `docker compose exec -T db psql ...`.
6. **Dominio**:
   - Prompt: `Introduce el dominio (dejar vacío para IP:8084):`
   - **Vacío**: mostrar URL `http://<IP_DEL_SERVIDOR>:8084` y salir.
   - **Con dominio**:
     - Renderizar `deploy/apache/keyvault.example.conf` con el dominio (sed/envsubst).
     - Copiar a `/etc/apache2/sites-available/keyvault.conf`.
     - `a2ensite keyvault`, `a2dissite 000-default` (opcional), `apache2ctl configtest`.
     - `systemctl reload apache2`.
     - `certbot --apache -d $DOMAIN --non-interactive --agree-tos -m $EMAIL --redirect`.
7. **Resumen final**: estado de contenedores, URL activa.

**Idempotente**: se puede ejecutar cuantas veces se quiera en futuros pulls.

**Seguridad**: requiere `sudo` para los pasos de Apache y certbot.

### 11.1 Plantilla Apache (`deploy/apache/keyvault.example.conf`)

```apache
<VirtualHost *:80>
    ServerName ${DOMAIN}
    ServerAdmin webmaster@localhost

    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:8084/
    ProxyPassReverse / http://127.0.0.1:8084/

    ErrorLog  ${APACHE_LOG_DIR}/keyvault_error.log
    CustomLog ${APACHE_LOG_DIR}/keyvault_access.log combined
</VirtualHost>
```

Certbot añadirá automáticamente el bloque `<VirtualHost *:443>` con los certificados y la redirección HTTPS.

---

## 12. Plan de ejecución por fases

| Fase | Entregable | Criterio de verificación |
|---|---|---|
| 0 | Estructura de directorios + `.env.example` + `.dockerignore` | `tree` muestra el layout esperado |
| 1 | API Express + `pool.js` + migración `001_init.sql` + endpoints auth/vault | `curl` local desde el host |
| 2 | Refactor frontend: `js/auth.js`, `js/api.js`, `storage.js` híbrido, eliminar gdrive | Flujo manual registro → login → CRUD → logout |
| 3 | `Dockerfile` web + api, `nginx.conf`, `docker-compose.yml` | `docker compose up` local funciona en `localhost:8084` |
| 4 | `deploy/install.sh` + `apache/keyvault.example.conf` | `bash -n` (sintaxis) + dry-run con `set -x` |
| 5 | Docs: este plan + `.specs/SPEC_BACKEND.md` + actualizar `README.md` | revisión |

Cada fase es autocontenida y commiteable.

---

## 13. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Edición simultánea desde dos dispositivos | Campo `version` en `vaults`; la API devuelve `409` y el cliente hace pull → merge → push |
| Pérdida del PIN maestro | **No recuperable** (por diseño Zero-Knowledge). Documentar claramente. |
| Pérdida del volumen `pgdata` | Incluir `pgdata` en la política de backups del servidor (`pg_dump` programado) |
| Rotación de JWT comprometido | Refresh tokens con `revoked=true`, expiración corta de access (15 min) |
| Certbot falla (DNS no resuelto) | El script deja Apache sirviendo por HTTP y reporta el error para ejecutar certbot manualmente |
| Puerto `5433` ya usado en el host | Validar al inicio con `ss -ltn` y abortar con mensaje antes de levantar compose |
| Service worker cachea versión vieja del frontend | `nginx.conf` envía `Cache-Control: no-cache` para `service-worker.js` |

---

## 14. Migración de datos existentes

No existe migración automática desde `localStorage` actual. En el primer login con cuenta nueva, el vault inicia vacío. Se proveerá (futura mejora) un botón **"Importar vault local"** que tome el blob de `localStorage` y lo suba a la API en una sola operación `PUT /api/vault`.

---

## 15. Próximos pasos tras este plan

1. Implementar **Fase 1** (backend Express + migración).
2. Implementar **Fase 2** (refactor del frontend).
3. Implementar **Fase 3** (Dockerfiles + compose).
4. Implementar **Fase 4** (script de despliegue).
5. Probar end-to-end en local con `docker compose up`.
6. Probar el `install.sh` en el servidor real.

---

*Documento de planificación. La especificación técnica detallada del backend (contratos, tokens, seguridad) está en `.specs/SPEC_BACKEND.md`.*
