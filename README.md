# KeyVault — Gestor de Contraseñas

Aplicación web de gestión de contraseñas de alta seguridad, con arquitectura **multi-usuario**, **Zero-Knowledge** y **PWA offline**. Frontend en Vanilla JS + HTML + CSS, backend en Node.js/Express y PostgreSQL, todo dockerizado.

> Las contraseñas se cifran **en el navegador** con AES-GCM (256 bits) derivado del PIN maestro mediante PBKDF2. El servidor **nunca** recibe el PIN ni el contenido en claro: solo persiste un *blob opaco cifrado* por usuario.

## Características principales

- **Seguridad Zero-Knowledge**: AES-GCM + PBKDF2 vía Web Crypto API. El backend solo almacena el vault cifrado.
- **Multi-usuario con cuentas**: registro/login con JWT (access + refresh con rotación y revocación).
- **Sincronización híbrida**: PostgreSQL como fuente de verdad + `localStorage` como caché para modo offline.
- **Modo Oscuro / Claro / Automático** con persistencia y sin parpadeo (anti-FOUC).
- **Auto-bloqueo configurable**: cierre de bóveda tras N minutos de inactividad (0 = desactivado).
- **Diseño premium**: *Glassmorphism*, animaciones, totalmente responsivo, logo SVG propio con soporte de tema.
- **PWA**: instalable y funcional sin conexión; el service worker usa *stale-while-revalidate* y nunca cachea `/api/*`.
- **Generador integrado** de contraseñas fuertes.
- **Detección de conflictos**: edición desde varios dispositivos resuelta con control de versión optimista (`409 Conflict`).

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | Vanilla JS (ES6+), HTML5, CSS3 — sin framework ni bundler |
| Backend | Node.js 20 + Express 4 |
| Base de datos | PostgreSQL 16 |
| Auth | JWT (`jsonwebtoken`) + bcrypt |
| Validación | Zod |
| Logs | Pino (con redacción de secretos) |
| Contenedores | Docker multi-stage + Docker Compose |
| Proxy / SSL (producción) | Apache + Certbot |

## Estructura del proyecto

```
KeyVaultJS/
├── api/                    # Backend Node.js + Express
│   ├── src/
│   │   ├── config/         # Validación de variables de entorno (zod)
│   │   ├── controllers/    # auth + vault
│   │   ├── db/             # pool pg + migraciones SQL
│   │   ├── middleware/     # auth (JWT), errorHandler
│   │   ├── routes/         # /api/auth, /api/vault, /api/health
│   │   ├── schemas/        # validación zod
│   │   └── utils/          # jwt, password, logger, httpErrors, asyncHandler
│   ├── Dockerfile
│   └── package.json
├── web/                    # Contenedor nginx (sirve el frontend + proxy /api)
│   ├── Dockerfile
│   └── nginx.conf
├── js/                     # Frontend Vanilla JS
│   ├── app.js              # Controlador principal (auth → pin → dashboard)
│   ├── api.js              # Cliente fetch con auto-refresh de JWT
│   ├── auth.js             # Sesión multi-usuario
│   ├── crypto.js           # AES-GCM + PBKDF2 (Web Crypto API)
│   ├── storage.js          # Persistencia híbrida (remota + caché local)
│   └── generator.js        # Generador de contraseñas
├── css/styles.css          # Estilos + temas dark/light
├── deploy/
│   ├── docker-compose.yml  # db + api + web
│   ├── .env.example        # Plantilla de configuración
│   ├── install.sh          # Script de despliegue del servidor
│   └── apache/             # Plantilla vhost + setup-apache.sh (Certbot)
├── docs/                   # Plan de dockerización
└── .specs/                 # Especificación técnica (SPEC.md + SPEC_BACKEND.md)
```

## Puertos

| Servicio | Puerto (host:contenedor) |
|---|---|
| Web (nginx) | `8084:80` |
| PostgreSQL | `5433:5432` |
| API (interno, no publicado) | `3000` |

> Los puertos `8080`–`8083` y `3306`/`3308`/`3309`/`5432` están reservados por otros proyectos del entorno.

## Ejecución en local

### Requisitos
- Docker + Docker Compose v2

### Pasos
```bash
# 1. Generar configuración local con secrets aleatorios
cp deploy/.env.example deploy/.env
# Edita deploy/.env o deja que install.sh genere los JWT secrets por ti.

# 2. Levantar el stack completo
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

# 3. Aplicar migraciones de base de datos
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec api node src/utils/migrations.js up
```

Abre **http://localhost:8084**.

> Para el desarrollo del backend sin Docker, también puedes ejecutar `npm install && npm run dev` dentro de `api/` (requiere una instancia accesible de PostgreSQL vía `DATABASE_URL`).

## Despliegue en servidor (producción)

El proyecto está pensado para vivir en `/var/www/keyvaultjs` en un servidor Linux con Docker y Apache.

```bash
# En el servidor, dentro de /var/www/keyvaultjs (tras un git pull):
sudo bash deploy/install.sh
```

El script `install.sh` es **idempotente** y:
1. Verifica dependencias (`docker`, `docker compose`, `git`, `apache2`, `certbot`).
2. Hace `git pull` y comprueba conflictos de puertos (`8084`, `5433`).
3. Crea `deploy/.env` con JWT secrets generados con `openssl rand`.
4. Construye y levanta los contenedores.
5. Aplica migraciones.
6. **Pide un dominio**:
   - Si lo dejas vacío → la app queda accesible por `http://<IP>:8084`.
   - Si indicas dominio (+ email) → configura el vhost de Apache y emite certificado SSL con Certbot.

## Acceso a la base de datos (DBeaver / pgAdmin)

| Campo | Valor |
|---|---|
| Host | `localhost` (o la IP del servidor) |
| Port | `5433` |
| Database | `keyvault` |
| Username | `keyvault` |
| Password | la definida en `deploy/.env` (`POSTGRES_PASSWORD`) |

Tablas: `users`, `vaults`, `refresh_tokens`, `schema_migrations`.

## Documentación

- [`docs/PLAN_DOCKERIZACION.md`](docs/PLAN_DOCKERIZACION.md) — plan completo de dockerización y arquitectura.
- [`.specs/SPEC_BACKEND.md`](.specs/SPEC_BACKEND.md) — contrato técnico de la API (endpoints, modelo de datos, seguridad).
- [`.specs/SPEC.md`](.specs/SPEC.md) — especificación original del MVP.
- [`.docs/DEPLOYMENT.md`](.docs/DEPLOYMENT.md) — guía de despliegue legacy (frontend estático).

## Seguridad

- **PIN maestro**: nunca sale del navegador. Si se olvida, **no hay recuperación** (por diseño).
- **Password de cuenta**: hasheada con bcrypt (costo 12) solo para autenticación.
- **JWT**: access tokens cortos (15 min) + refresh tokens rotativos con revocación.
- **CORS**: no requerido en producción (frontend y API comparten origen vía nginx).
- **Headers**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cache-Control: no-store`.

## Licencia

Proyecto privado.
