# KeyVault — Gestor de Contraseñas

Aplicación web de gestión de contraseñas de alta seguridad, con arquitectura **multi-usuario**, **Zero-Knowledge** y **PWA offline**. Frontend en Vanilla JS + HTML + CSS, backend en Node.js/Express y PostgreSQL, todo dockerizado.

> Las contraseñas se cifran **en el navegador** con AES-GCM (256 bits) derivado del PIN maestro mediante PBKDF2-SHA256 con 600 000 iteraciones (recomendación OWASP). El servidor **nunca** recibe el PIN ni el contenido en claro: solo persiste un *blob opaco cifrado* por usuario.

## Características principales

- **Seguridad Zero-Knowledge**: AES-GCM + PBKDF2 (600k iteraciones) vía Web Crypto API. El backend solo almacena el vault cifrado, con los parámetros del KDF versionados en el propio blob para poder endurecerlos sin romper vaults existentes.
- **Multi-usuario con cuentas**: registro/login con JWT (access + refresh con rotación y revocación).
- **Sincronización híbrida**: PostgreSQL como fuente de verdad + `localStorage` como caché para modo offline.
- **Modo Oscuro / Claro / Automático** con persistencia y sin parpadeo (anti-FOUC).
- **Auto-bloqueo configurable**: cierre de bóveda tras N minutos de inactividad (0 = desactivado).
- **Diseño premium**: *Glassmorphism*, animaciones, totalmente responsivo, logo SVG propio con soporte de tema.
- **PWA**: instalable y funcional sin conexión; el service worker usa *stale-while-revalidate* y nunca cachea `/api/*`.
- **Cero dependencias externas en el cliente**: iconos SVG propios en lugar de un CDN, lo que permite una CSP estricta (`default-src 'self'`) y un modo offline real.
- **Defensa ante fuerza bruta**: rate limiting en dos capas (nginx + Express) por IP y por cuenta.
- **Portapapeles efímero**: la contraseña copiada se borra automáticamente a los 30 s.
- **Generador integrado** de contraseñas fuertes.
- **Cambio de credenciales**: contraseña de cuenta (verificada por el backend, cierra el resto de sesiones) y PIN maestro (re-cifra la bóveda en el navegador; el PIN nunca sale del cliente).
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
| Rate limiting | `express-rate-limit` + `limit_req` de nginx |
| Tests | `node:test` + `fetch` (sin dependencias de test) |
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
│   ├── generator.js        # Generador de contraseñas
│   ├── theme-init.js       # Anti-FOUC (script propio, no inline: CSP estricta)
│   └── sw-register.js      # Registro del service worker
├── css/styles.css          # Estilos + temas dark/light
├── icons/                  # Iconos PWA generados desde keyvault.svg
├── deploy/
│   ├── docker-compose.yml       # Base: SIN puertos publicados
│   ├── docker-compose.local.yml # Override de desarrollo
│   ├── docker-compose.prod.yml  # Override de producción (solo loopback)
│   ├── .env.example             # Plantilla de configuración
│   ├── deploy.sh                # Despliegue no interactivo (+ rollback, --check)
│   ├── backup.sh                # pg_dump + rotación + restauración
│   ├── seed-test-user.mjs       # Datos de prueba (solo desarrollo)
│   ├── install.sh               # Wrapper deprecado -> deploy.sh
│   └── apache/                  # Plantilla vhost + setup-apache.sh (Certbot + HSTS)
├── docs/                   # Plan de dockerización y plan de mejora
└── .specs/                 # Especificación técnica (SPEC.md + SPEC_BACKEND.md)
```

## Puertos

| Servicio | Local | Producción |
|---|---|---|
| Web (nginx) | `8084:80` | `127.0.0.1:8084:80` (solo Apache lo alcanza) |
| PostgreSQL | `127.0.0.1:5433:5432` | **sin publicar** (solo red interna) |
| API (Node) | `expose 3000` | `expose 3000` |

> Docker escribe sus reglas directamente en iptables y **puentea UFW/firewalld**:
> cerrar un puerto en el firewall del host no protege un `ports:` publicado. Por eso
> la base de compose no publica nada y `deploy.sh` aborta si detecta lo contrario.
>
> Los puertos `8080`–`8083` y `3306`/`3308`/`3309`/`5432` están reservados por otros proyectos del entorno.

## Ejecución en local

### Requisitos
- Docker + Docker Compose v2

### Pasos
```bash
bash deploy/deploy.sh --local
```

Un único comando: genera `deploy/.env` con secrets aleatorios (y `chmod 600`),
construye las imágenes, levanta los contenedores, aplica las migraciones y
verifica que la API responda y que no haya puertos expuestos de más.

Abre **http://localhost:8084**.

```bash
# Suite de integración de la API (22 tests, base de datos efímera)
docker compose --env-file deploy/.env \
  -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml exec api npm test

# Datos de prueba: borra todos los usuarios y crea uno con la bóveda poblada
node deploy/seed-test-user.mjs --purge

# Diagnóstico sin tocar nada
bash deploy/deploy.sh --check
```

> Para el desarrollo del backend sin Docker, también puedes ejecutar `npm install && npm run dev` dentro de `api/` (requiere una instancia accesible de PostgreSQL vía `DATABASE_URL`).

## Despliegue en servidor (producción)

El proyecto está pensado para vivir en `/var/www/keyvaultjs` en un servidor Linux con Docker y Apache.

```bash
# Primera vez (configura Apache + Let's Encrypt + HSTS):
sudo bash deploy/deploy.sh --prod --domain keyvault.example.com --email admin@example.com

# Actualizaciones posteriores:
sudo bash deploy/deploy.sh --prod

# Si algo sale mal:
sudo bash deploy/deploy.sh --rollback
```

`deploy.sh` es **no interactivo** e idempotente:
1. Verifica dependencias y que las migraciones existan en el repositorio.
2. `git pull --ff-only` (aborta si hay cambios sin commitear).
3. Crea `deploy/.env` con secrets `openssl rand` y aplica `chmod 600`.
4. **Backup de la base antes de desplegar** (`/var/backups/keyvaultjs/`).
5. Etiqueta las imágenes actuales como `:previous`, reconstruye y levanta.
6. Aplica migraciones; si fallan, indica cómo restaurar.
7. Verifica `/api/health` y **falla si algún puerto quedó expuesto**.
8. Configura Apache + certbot + HSTS, e instala los cron de backup y de purga de tokens.

Detalle completo en [`.docs/DEPLOYMENT.md`](.docs/DEPLOYMENT.md).

## Acceso a la base de datos (DBeaver / pgAdmin)

| Campo | Valor |
|---|---|
| Host | `localhost` (solo en desarrollo; en producción PostgreSQL no se publica) |
| Port | `5433` |
| Database | `keyvault` |
| Username | `keyvault` |
| Password | la definida en `deploy/.env` (`POSTGRES_PASSWORD`) |

Tablas: `users`, `vaults`, `refresh_tokens`, `schema_migrations`.

En producción el puerto no está publicado; usa `docker compose exec db psql -U keyvault`
o abre un túnel SSH.

## Documentación

- [`docs/PLAN_DOCKERIZACION.md`](docs/PLAN_DOCKERIZACION.md) — plan completo de dockerización y arquitectura.
- [`.specs/SPEC_BACKEND.md`](.specs/SPEC_BACKEND.md) — contrato técnico de la API (endpoints, modelo de datos, seguridad).
- [`.specs/SPEC.md`](.specs/SPEC.md) — especificación original del MVP.
- [`.specs/SPEC_CHANGE_CREDENTIALS.md`](.specs/SPEC_CHANGE_CREDENTIALS.md) — cambio de contraseña de cuenta y de PIN maestro.
- [`.docs/DEPLOYMENT.md`](.docs/DEPLOYMENT.md) — guía de despliegue y operación (compose, `deploy.sh`, backups, troubleshooting).
- [`docs/PLAN_MEJORAS.md`](docs/PLAN_MEJORAS.md) — auditoría de seguridad y estado de implementación de cada hallazgo.

## Seguridad

- **PIN maestro**: nunca sale del navegador. Si se olvida, **no hay recuperación** (por diseño).
- **Password de cuenta**: hasheada con bcrypt (costo 12) solo para autenticación.
- **JWT**: access tokens cortos (15 min) + refresh tokens rotativos con revocación.
- **CORS**: no requerido en producción (frontend y API comparten origen vía nginx).
- **CSP estricta**: `default-src 'self'` sin `'unsafe-inline'` ni orígenes externos. Ningún asset viene de un CDN.
- **Headers**: `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-*` y `Cache-Control: no-store` en la API. HSTS lo emite Apache en el vhost `:443`.
- **Rate limiting**: `/api/auth/*` limitado por IP (nginx + Express) y por cuenta (solo intentos fallidos).
- **Detección de reutilización de refresh tokens**: presentar un token ya rotado revoca **todas** las sesiones del usuario.
- **Cambio de contraseña**: exige la contraseña actual y cierra todas las sesiones previas. Un access token ya emitido sigue siendo válido hasta 15 min (limitación documentada).
- **Contenedores**: usuario no-root en la API, `no-new-privileges`, `cap_drop: ALL`, límites de memoria e imágenes fijadas por digest.

## Licencia

Proyecto privado.
