# Plan de Mejora — KeyVaultJS

> Estado: **Fases 0–3 implementadas** · Análisis: 2026-08-10 · Implementación: 2026-08-20 · Rama: `dev`
> Documento generado a partir de una auditoría estática del código (frontend, backend, Docker y scripts de despliegue).
>
> **Las Fases 0, 1, 2 y 3 están implementadas y verificadas** (ver §9). La Fase 4
> (`.specs/SPEC_CHANGE_CREDENTIALS.md`: cambio de contraseña de cuenta y de PIN
> maestro) queda pendiente por decisión explícita de alcance.

---

## 1. Resumen ejecutivo

KeyVaultJS es un gestor de contraseñas Zero-Knowledge (PWA + API Node/Express + PostgreSQL, dockerizado, con reverse proxy Apache + Certbot en producción). La base es sólida: cifrado AES-GCM en cliente, backend que solo almacena blobs opacos, JWT con rotación de refresh tokens, contenedor API como usuario no-root, validación con Zod, bloqueo optimista por versión del vault y escape de HTML en el render.

Sin embargo, el análisis detectó **1 hallazgo crítico que rompe el despliegue en un servidor limpio**, **2 exposiciones de puertos Docker que deben corregirse antes de producción** (punto solicitado expresamente en esta auditoría) y una serie de mejoras de seguridad y mantenimiento de prioridad media/baja.

### Tabla de hallazgos priorizados

| # | Hallazgo | Área | Prioridad | Fase | Estado |
|---|----------|------|-----------|------|--------|
| H-01 | La migración `api/src/db/migrations/001_init.sql` está **ignorada por git** (`*.sql` en `.gitignore`) → un `git pull` en servidor nuevo no la incluye y el despliegue falla | Repositorio | **P0 — Crítica** | 0 | ✅ |
| H-02 | `docker-compose.yml` publica **PostgreSQL en `5433:5432` hacia todas las interfaces** del host (Docker además puentea UFW/firewalld vía iptables) | Docker / Red | **P0 — Crítica** | 0 | ✅ |
| H-03 | `web` publica `8084:80` en `0.0.0.0`; en producción tras Apache+TLS permite saltarse el proxy y acceder por HTTP plano | Docker / Red | **P0 — Crítica** | 0 | ✅ |
| H-04 | Sin **rate limiting** en `/api/auth/*` (login/register/refresh) → fuerza bruta de contraseñas sin fricción | API / Seguridad | **P1 — Alta** | 2 | ✅ |
| H-05 | Sin **backups automatizados** de PostgreSQL (la pérdida del volumen = pérdida de todos los vaults) | Operación | **P1 — Alta** | 1 | ✅ |
| H-06 | `deploy/.env` sin permisos restrictivos garantizados (contiene secrets JWT y credenciales de DB) | Despliegue | **P1 — Alta** | 0 | ✅ |
| H-07 | Font Awesome se carga desde **CDN externo sin SRI** en una app de contraseñas (riesgo supply-chain, impide una CSP estricta y rompe el modo offline real) | Frontend | **P1 — Alta** | 2 | ✅ |
| H-08 | Sin cabeceras de seguridad en el frontend (nginx no envía **CSP, X-Frame-Options, HSTS**, etc.; solo la API tiene cabeceras) | Web / Seguridad | **P1 — Alta** | 2 | ✅ |
| H-09 | El hash bcrypt *dummy* del login es **inválido (54 chars, deben ser 53)** → `bcrypt.compare` retorna de inmediato y la mitigación de timing para emails inexistentes no funciona | API / Seguridad | **P2 — Media** | 2 | ✅ |
| H-10 | PBKDF2 con **100 000 iteraciones** (OWASP recomienda ≥600 000 para SHA-256) para derivar la clave del vault | Cripto cliente | **P2 — Media** | 3 | ✅ |
| H-11 | Sin **detección de reutilización** de refresh tokens rotados (un token robado y ya rotado debería revocar toda la familia del usuario) | API / Seguridad | **P2 — Media** | 2 | ✅ |
| H-12 | Express sin `trust proxy` → `req.ip` es la IP del contenedor nginx; inutiliza cualquier rate limit por IP y ensucia logs | API | **P2 — Media** | 2 | ✅ |
| H-13 | Tokens JWT en `localStorage` (expuestos ante XSS). Mitigable con CSP estricta (H-07/H-08); migrar refresh token a cookie `httpOnly` es la solución de fondo | Frontend / Seguridad | **P2 — Media** | 3 | ⏸️ evaluado |
| H-14 | La tabla `refresh_tokens` **crece sin límite** (no hay purga de tokens expirados/revocados) | DB / Mantenimiento | **P2 — Media** | 2 | ✅ |
| H-15 | `register` responde `409 email_taken` → **enumeración de usuarios** (aceptable en app interna; documentar decisión) | API | **P3 — Baja** | 3 | 📝 documentado |
| H-16 | El healthcheck de `install.sh` parsea `ps --format json` con `grep` (frágil entre versiones de compose) y el script es interactivo (no apto para CI/automatización) | Despliegue | **P2 — Media** | 1 | ✅ |
| H-17 | `web` no espera `service_healthy` del API (solo `depends_on` simple); `web` carece de healthcheck propio en compose | Docker | **P3 — Baja** | 1 | ✅ |
| H-18 | `express.json({ limit: '2mb' })` fijo: si se aumenta `VAULT_MAX_BYTES` por env, el límite del body no escala con él | API | **P3 — Baja** | 3 | ✅ |
| H-19 | `logoutSchema` definido pero no aplicado en la ruta `/logout` (validación manual en el controlador); código muerto menor (`void EMPTY_BLOB`, `void HttpError`) | API / Calidad | **P3 — Baja** | 3 | ✅ |
| H-20 | `vaultSalt` acepta mínimo 8 caracteres base64 (~6 bytes) aunque el cliente genera 16 bytes; endurecer el mínimo del schema | API | **P3 — Baja** | 3 | ✅ |
| H-21 | Portapapeles: la contraseña copiada permanece indefinidamente; falta limpieza best-effort (~30 s) | Frontend / UX | **P3 — Baja** | 3 | ✅ |
| H-22 | Imágenes Docker con tag flotante (`postgres:16-alpine`, `nginx:1.27-alpine`, `node:20-bookworm-slim`); sin `no-new-privileges`, `cap_drop` ni límites de recursos | Docker | **P3 — Baja** | 1 | ✅ |
| H-23 | Spec pendiente de implementar: cambio de contraseña de cuenta y de PIN maestro (`.specs/SPEC_CHANGE_CREDENTIALS.md`) | Funcionalidad | **P2 — Media** | 4 | ⏳ Fase 4 |

Leyenda de prioridad: **P0** bloquea/expone producción, corregir antes de desplegar · **P1** alta, primera iteración post-despliegue · **P2** media, planificable · **P3** baja/oportunista.

Leyenda de estado: ✅ implementado y verificado · ⏸️ evaluado y pospuesto con justificación · 📝 decisión documentada, sin cambio de código · ⏳ pendiente (fuera del alcance de esta iteración).

---

## 2. Metodología y alcance del análisis

Se revisaron los 4 planos del proyecto:

1. **Frontend PWA** (`index.html`, `js/*.js`, `service-worker.js`, `manifest.json`).
2. **Backend API** (`api/src/**`: app, config, rutas, controladores, middleware, JWT, bcrypt, pool PG, migraciones).
3. **Infraestructura Docker** (`api/Dockerfile`, `web/Dockerfile`, `web/nginx.conf`, `deploy/docker-compose.yml`).
4. **Despliegue** (`deploy/install.sh`, `deploy/apache/*`, `.gitignore`, `deploy/.env(.example)`).

### Aspectos que están bien (y deben preservarse)

- Modelo Zero-Knowledge correcto: el PIN nunca sale del cliente; el backend solo ve `iv:ciphertext` opaco validado por regex y tamaño máximo.
- AES-GCM con IV aleatorio de 12 bytes por operación; salt del vault con fuente única de verdad en `users.vault_salt` (bug multi-dispositivo ya corregido).
- Rotación de refresh tokens con revocación y almacenamiento hasheado (SHA-256) en DB; access token corto (15 m).
- Bloqueo optimista del vault (`version` + `FOR UPDATE` + manejo de 409 en UI).
- API detrás de nginx same-origin (sin CORS abierto); API **no publica puerto al host** (`expose: 3000`) — correcto.
- Contenedor API multi-stage, usuario no-root, `HEALTHCHECK` propio; secrets exigidos por compose (`:?required`).
- Validación Zod de entorno con fail-fast, redacción de campos sensibles en logs de error, `x-powered-by` deshabilitado, `Cache-Control: no-store` en API.
- `escapeHtml` en el render de la lista (mitiga XSS almacenado vía nombres de entradas).
- `install.sh` idempotente con generación automática de secrets y verificación de valores de ejemplo.

---

## 3. Hallazgos detallados

### 3.1 P0 — Críticos (bloquean o exponen producción)

#### H-01 · La migración SQL no está en el repositorio

`.gitignore` contiene `*.sql` (línea de la sección de backups) y eso **ignora también `api/src/db/migrations/001_init.sql`**. Verificado con `git check-ignore` y `git ls-files`: el único archivo trackeado en `api/src/db/` es `pool.js`.

**Consecuencia**: en un servidor limpio, tras `git clone/pull` la carpeta `migrations/` no existirá → `node src/utils/migrations.js up` fallará → la API arranca sin esquema y todos los endpoints devuelven error 500. El despliegue actual solo funciona en máquinas donde el archivo existe localmente.

**Corrección propuesta** (Fase 0): añadir excepción en `.gitignore` **debajo** de `*.sql`:

```gitignore
*.sql
!api/src/db/migrations/*.sql
```

y hacer `git add -f api/src/db/migrations/001_init.sql` una única vez. Añadir además una verificación en el script de despliegue: abortar si `api/src/db/migrations/` está vacío.

#### H-02 · PostgreSQL publicado al host en todas las interfaces

```yaml
db:
  ports:
    - "5433:5432"   # ← se publica en 0.0.0.0:5433
```

En el servidor de producción esto expone PostgreSQL a Internet. Dos agravantes:

1. **Docker inserta reglas directamente en iptables (cadena `DOCKER`), puenteando UFW/firewalld**: aunque el firewall del host "cierre" el puerto, el tráfico hacia un puerto publicado por Docker normalmente entra igual. No se puede confiar en el firewall del host para tapar un `ports:` de compose.
2. La API se conecta a `db:5432` **por la red interna** (`keyvault_net`); las migraciones se ejecutan con `docker compose exec` dentro del contenedor. **Nada necesita el puerto 5433 del host.**

**Corrección propuesta** (Fase 0): eliminar por completo la sección `ports:` del servicio `db` en producción. Para inspección puntual local existe `docker compose exec db psql -U keyvault`. Si en local se quiere un cliente gráfico, publicar solo en loopback: `127.0.0.1:5433:5432` (vía override de desarrollo, ver §5).

#### H-03 · El puerto web 8084 queda abierto al mundo en producción

```yaml
web:
  ports:
    - "8084:80"     # ← 0.0.0.0:8084
```

En producción el flujo es `Internet → Apache :443 (TLS) → 127.0.0.1:8084 → nginx`. Apache solo necesita alcanzar `127.0.0.1:8084`; publicarlo en `0.0.0.0` permite a cualquiera acceder a la app **por HTTP sin cifrar en el puerto 8084**, saltándose TLS, la redirección HTTPS y cualquier cabecera que añada Apache. Para un gestor de contraseñas (tokens y blobs viajando por HTTP plano) es inaceptable.

**Corrección propuesta** (Fase 0): en producción, enlazar solo a loopback:

```yaml
ports:
  - "127.0.0.1:8084:80"
```

En local puede mantenerse `8084:80` (o también loopback; `localhost:8084` sigue funcionando). La estrategia limpia es separar base + overrides (§5).

#### H-06 · Permisos del archivo de secrets

`deploy/.env` contiene la contraseña de PostgreSQL y ambos secrets JWT. `install.sh` lo crea con la umask por defecto (típicamente `644`, legible por cualquier usuario local del servidor). Correcciones: `chmod 600` inmediatamente tras crearlo (y en cada ejecución del script como verificación), y documentar la **rotación de los secrets actuales** antes del primer despliegue real si este `.env` de desarrollo se reutilizó en algún servidor.

### 3.2 P1 — Altos

#### H-04 · Rate limiting en autenticación

`/api/auth/login` y `/register` aceptan intentos ilimitados. Con contraseñas de mínimo 12 caracteres el riesgo baja, pero un atacante puede probar diccionarios sin fricción y además generar carga de bcrypt (coste 12) a voluntad — un vector barato de agotamiento de CPU.

**Propuesta** (dos capas, la primera es suficiente para empezar):
1. **nginx** (`web/nginx.conf`): `limit_req_zone` sobre `location /api/auth/` (p. ej. 10 req/min por IP con burst) — sin tocar código Node.
2. **Express**: `express-rate-limit` sobre el router de auth (p. ej. 20 req/15 min por IP + por email en login). Requiere H-12 (`app.set('trust proxy', 1)`) para que la IP real llegue desde `X-Forwarded-For`.

#### H-05 · Backups automatizados de la base de datos

Todo el valor del sistema vive en el volumen `keyvault_pgdata`. No hay ningún mecanismo de backup; `install.sh` solo lo menciona como comando manual en el resumen final.

**Propuesta**: script `deploy/backup.sh` (pg_dump comprimido con rotación de N días, `chmod 600`, destino fuera del árbol del proyecto p. ej. `/var/backups/keyvaultjs/`) + entrada de cron instalada por el script de despliegue (diaria). Los dumps son blobs cifrados + hashes bcrypt: aun así tratarlos como sensibles. Documentar prueba de restauración.

#### H-07 · Font Awesome desde CDN sin SRI

`index.html` y el service worker cargan `cdnjs.cloudflare.com/.../font-awesome/6.4.0/css/all.min.css`. En una app de contraseñas:

- Si el CDN se compromete, se inyecta CSS arbitrario (exfiltración parcial vía selectores/`background-image`) y es un origen que la CSP tendría que permitir.
- Sin conexión al CDN en la primera carga, la PWA queda sin iconos (el "modo offline" depende de un tercero).

**Propuesta**: self-hostear los assets (o sustituir por los SVG propios que ya usa el proyecto para el logo). Esto habilita una CSP `default-src 'self'` real (H-08) y elimina el origen externo del service worker.

#### H-08 · Cabeceras de seguridad del frontend

nginx sirve el HTML/JS sin ninguna cabecera de seguridad (las de `app.js` del API solo aplican a `/api/*`). Propuesta para `web/nginx.conf`:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data:; font-src 'self'; connect-src 'self';
  base-uri 'none'; frame-ancestors 'none'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Notas: requiere H-07 (sin CDN) y **mover los dos scripts inline de `index.html`** (anti-FOUC y registro del SW) a archivos propios o usar hashes CSP. HSTS debe emitirlo Apache (capa TLS): añadir `Strict-Transport-Security` al vhost 443 o usar `certbot --hsts` (activarlo solo cuando HTTPS esté estable).

#### H-16 · Robustez y automatización del script de despliegue

`install.sh` funciona pero tiene limitaciones para operación continua: es interactivo (pide puerto ocupado, dominio, email → no sirve en CI/cron), el healthcheck de Postgres parsea JSON con `grep` (el formato de `docker compose ps --format json` cambió entre versiones), no hay backup previo al deploy ni rollback, y no valida que la migración exista (H-01). El rediseño completo está en §6.

### 3.3 P2 — Medios

- **H-09 · Hash dummy inválido**: `'$2b$12$' + 'o'×54` — un hash bcrypt válido tiene exactamente 53 caracteres tras el prefijo (22 de salt + 31 de digest). Con hash malformado `bcrypt.compare` resuelve `false` de inmediato, por lo que el tiempo de respuesta delata si el email existe. Corrección: generar el dummy una vez al arrancar (`await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS)`) y reutilizarlo.
- **H-10 · PBKDF2 100k iteraciones**: subir a ≥600k (OWASP) o migrar a Argon2id vía WASM. Requiere versionar los parámetros KDF junto al blob (`v2:iter:iv:ciphertext` o campo `kdfParams` en el vault) y re-cifrar en el próximo desbloqueo/cambio de PIN. Coordinar con la implementación del cambio de PIN (H-23) para hacer una sola migración de formato.
- **H-11 · Detección de reutilización de refresh tokens**: hoy, usar un token ya rotado solo devuelve 401. Lo correcto: si llega un token **válido criptográficamente pero ya revocado**, asumir robo y ejecutar `revokeAllRefreshTokensForUser(sub)` (la función ya existe en `jwt.js` y no se usa).
- **H-12 · `trust proxy`**: añadir `app.set('trust proxy', 1)` (nginx ya envía `X-Forwarded-For`). Prerrequisito del rate limit por IP y de logs útiles.
- **H-13 · Tokens en `localStorage`**: mitigación a corto plazo = CSP estricta (H-07/H-08). Solución de fondo (opcional, más invasiva): refresh token en cookie `httpOnly; Secure; SameSite=Strict; Path=/api/auth` y access token solo en memoria. Se propone como mejora de Fase 3, evaluando el impacto en el flujo PWA offline.
- **H-14 · Purga de `refresh_tokens`**: `DELETE FROM refresh_tokens WHERE expires_at < now() - interval '30 days' OR (revoked AND created_at < now() - interval '30 days')` — como job diario (puede colgarse del cron de backups) o de forma oportunista en cada login.

### 3.4 P3 — Bajos

- **H-15**: la enumeración de emails en `register` es un trade-off de UX aceptado; dejar constancia en el README/spec.
- **H-17**: `web` → `depends_on: api: condition: service_healthy` (el Dockerfile del API ya tiene HEALTHCHECK) y añadir healthcheck simple al `web` (`wget -qO- http://127.0.0.1/ || exit 1`).
- **H-18**: derivar el límite de `express.json` de `VAULT_MAX_BYTES` (p. ej. `Math.ceil(VAULT_MAX_BYTES * 1.4)` por el overhead base64+JSON).
- **H-19**: aplicar `validate(logoutSchema)` en la ruta de logout; eliminar `void EMPTY_BLOB` / `void HttpError`.
- **H-20**: `vaultSalt` con mínimo 22 caracteres base64 (16 bytes reales).
- **H-21**: limpiar portapapeles ~30 s después de copiar (best-effort, solo si la pestaña sigue enfocada).
- **H-22**: fijar imágenes por digest (`postgres:16-alpine@sha256:…`), `security_opt: [no-new-privileges:true]` en los tres servicios, `cap_drop: [ALL]` donde sea viable (nginx necesita `NET_BIND_SERVICE` o usar `nginxinc/nginx-unprivileged` en puerto 8080), y límites de memoria (`mem_limit`) para evitar que un contenedor agote el host.
- Menores adicionales detectados: el listener `keypress` del auto-bloqueo está deprecado (usar `keydown`); el texto del botón del PIN se decide con `pinTitle.textContent.includes('Define')` (frágil ante cambios de copy); el `catch` del `cache.addAll` del service worker hace que un fallo parcial deje el precache incompleto silenciosamente.

---

## 4. Evaluación específica: exposición de puertos Docker en producción

Estado actual vs. estado objetivo:

| Servicio | Hoy | Objetivo producción | Objetivo local |
|----------|-----|---------------------|----------------|
| `db` (PostgreSQL) | `0.0.0.0:5433 → 5432` ❌ | **Sin `ports:`** (solo red interna `keyvault_net`) | Sin puerto; opcional `127.0.0.1:5433` para clientes GUI |
| `api` (Node) | `expose: 3000` (sin publicar) ✅ | Igual (sin cambios) | Igual |
| `web` (nginx) | `0.0.0.0:8084 → 80` ❌ | **`127.0.0.1:8084 → 80`** (solo alcanzable por Apache local) | `8084 → 80` o loopback |

Puntos clave que fundamentan el cambio:

1. **Docker puentea el firewall del host**: las reglas `DOCKER` en iptables se evalúan antes que UFW/firewalld, así que "cerrar el puerto en el firewall" no protege un `ports:` publicado. La única defensa fiable es no publicar, o publicar en `127.0.0.1`.
2. **Nadie externo necesita 5433 ni 8084**: la API llega a la DB por DNS interno de compose (`db:5432`) y Apache proxya a loopback. El único punto de entrada público en producción debe ser Apache (80/443).
3. **Verificación post-despliegue** (se integra al script de §6): `ss -ltn` no debe mostrar `0.0.0.0:8084` ni `0.0.0.0:5433`; desde una máquina externa, `nc -z <ip> 8084` y `nc -z <ip> 5433` deben fallar.

### Mecanismo propuesto: compose base + overrides

Evita mantener dos archivos completos duplicados:

```
deploy/docker-compose.yml            # base: SIN ports en db; web sin ports
deploy/docker-compose.local.yml     # override local:  web: "8084:80"  (+ db 127.0.0.1:5433 opcional)
deploy/docker-compose.prod.yml      # override prod:   web: "127.0.0.1:8084:80"
```

Uso: `docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml up -d` (el script de despliegue elige el override según el modo, ver §6). Alternativa mínima si no se quieren overrides: variable en `.env` (`WEB_BIND=127.0.0.1:8084` / `WEB_BIND=8084`) y `ports: ["${WEB_BIND}:80"]` — menos explícita, pero un solo archivo.

---

## 5. Plan por fases

### Fase 0 — Correcciones críticas pre-producción (P0) · esfuerzo ~½ día
> Objetivo: que un despliegue desde cero funcione y no exponga nada.

1. **H-01**: excepción `!api/src/db/migrations/*.sql` en `.gitignore` + `git add -f` de la migración + verificación en el repo remoto de que el archivo quedó trackeado.
2. **H-02**: eliminar `ports:` del servicio `db`.
3. **H-03**: dividir compose en base + overrides local/prod; `web` a `127.0.0.1:8084:80` en producción.
4. **H-06**: `chmod 600 deploy/.env` (en el script y manualmente en servidores existentes); rotar secrets si el `.env` de desarrollo llegó a usarse en servidor.
5. Verificación: despliegue limpio en un contenedor/VM de prueba + chequeo de puertos con `ss`/escaneo externo.

**Criterio de salida**: `git clone` + script de despliegue en máquina virgen termina con la app sana y `ss -ltn` solo muestra 8084 en `127.0.0.1` (y 80/443 de Apache).

### Fase 1 — Despliegue y operación (P1) · esfuerzo ~1–2 días
> Objetivo: despliegue no interactivo, con red de seguridad.

1. **H-16**: reescritura de `install.sh` → `deploy.sh` (diseño completo en §6).
2. **H-05**: `deploy/backup.sh` + cron diario + prueba de restauración documentada.
3. **H-17**: `condition: service_healthy` para `web → api`; healthcheck del `web`.
4. **H-22**: `no-new-privileges`, límites de memoria, pin de imágenes por digest.
5. HSTS en el vhost 443 de Apache (coordinado con H-08).

### Fase 2 — Endurecimiento de la aplicación (P1/P2) · esfuerzo ~2–3 días
> Objetivo: cerrar los vectores de ataque de red y navegador.

1. **H-12**: `trust proxy` (prerrequisito del resto).
2. **H-04**: rate limiting (nginx `limit_req` en `/api/auth/` + `express-rate-limit` por IP/email).
3. **H-07**: self-host de Font Awesome (o reemplazo por SVG propios) + actualizar service worker.
4. **H-08**: CSP y cabeceras en nginx; extraer los scripts inline de `index.html`.
5. **H-09**: hash dummy válido generado al arranque.
6. **H-11**: revocación de familia ante reutilización de refresh token.
7. **H-14**: purga periódica de `refresh_tokens`.

### Fase 3 — Robustez y deuda técnica (P2/P3) · esfuerzo ~2–3 días

1. **H-10**: subida de iteraciones PBKDF2 (≥600k) con versionado del formato del blob y re-cifrado transparente al desbloquear. *Hacerla junto con la Fase 4 para reutilizar el flujo de re-cifrado del cambio de PIN.*
2. **H-13**: evaluación (spike) de refresh token en cookie `httpOnly`; decidir e implementar si compensa frente al flujo PWA.
3. **H-18, H-19, H-20, H-21** y menores (keydown, textos del botón PIN, precache del SW).
4. **Tests automatizados**: hoy no existe ninguno. Mínimo viable: suite de integración del API (register/login/refresh/rotación/revocación/vault 409/validaciones) con `node:test` + supertest contra Postgres efímero en compose; smoke E2E de cifrado/descifrado.

### Fase 4 — Funcionalidad pendiente (P2) · esfuerzo según spec

1. **H-23**: implementar `.specs/SPEC_CHANGE_CREDENTIALS.md` (cambio de contraseña de cuenta con revocación masiva + cambio de PIN maestro con re-cifrado). El spec ya está completo y aprobado como borrador; al implementarlo, incorporar el versionado KDF de H-10 en el mismo cambio de formato de blob.
2. Futuro (fuera de alcance actual, ya identificado en el spec): export/backup cifrado del vault descargable, 2FA/TOTP, listado de sesiones activas.

---

## 6. Diseño del script de despliegue (`deploy/deploy.sh`)

Sustituye a `install.sh` (que puede mantenerse como alias/wrapper durante una versión). Principios: **no interactivo por defecto**, idempotente, con backup previo y verificación de puertos integrada.

### 6.1 Interfaz

```bash
sudo bash deploy/deploy.sh --prod [--domain keyvault.example.com --email admin@x.com]
     bash deploy/deploy.sh --local
sudo bash deploy/deploy.sh --prod --no-pull        # redeploy sin git pull
sudo bash deploy/deploy.sh --rollback              # volver al estado anterior
bash deploy/deploy.sh --check                      # solo verificaciones, sin cambios
```

| Flag | Efecto |
|------|--------|
| `--prod` / `--local` | Selecciona override de compose (`docker-compose.prod.yml` / `.local.yml`). Obligatorio uno de los dos. |
| `--domain`, `--email` | Configura Apache + certbot sin prompts. Sin `--domain` no se toca Apache. |
| `--no-pull` | Omite `git pull` (hotfix local, CI que ya hizo checkout). |
| `--skip-backup` | Omite el backup pre-deploy (solo primer despliegue). |
| `--rollback` | Restaura imágenes previas etiquetadas y el último backup si la migración falló. |
| `--check` | Modo diagnóstico: dependencias, puertos, estado de contenedores, salud del API. |

### 6.2 Flujo (pseudocódigo)

```
1  Preflight
   ├─ Verificar git, docker, docker compose plugin, openssl, curl, ss
   ├─ Verificar que api/src/db/migrations/ contiene *.sql   ← guarda de H-01
   └─ --prod: verificar ejecución como root (necesario para Apache/cron)

2  Código
   └─ git pull --ff-only   (salvo --no-pull; abortar si hay cambios locales sin commitear)

3  Secrets (.env)
   ├─ Crear desde .env.example si no existe (JWT y PG autogenerados con openssl rand)
   ├─ chmod 600 deploy/.env  (siempre, exista o no de antes)      ← H-06
   └─ Abortar si algún valor obligatorio sigue en placeholder

4  Backup pre-deploy (solo --prod, si el contenedor db ya corre)   ← H-05
   └─ pg_dump | gzip → /var/backups/keyvaultjs/pre-deploy-<ts>.sql.gz (chmod 600)

5  Build & Up
   ├─ docker compose -f base -f <override> config -q      (validación sintáctica)
   ├─ Etiquetar imágenes actuales como :previous            (para --rollback)
   ├─ build --pull  →  up -d --remove-orphans
   └─ Esperar salud del db con `docker inspect --format '{{.State.Health.Status}}'`
      (robusto entre versiones de compose)                  ← H-16

6  Migraciones
   ├─ compose exec -T api node src/utils/migrations.js up
   └─ Si falla en --prod → ofrecer restauración del backup del paso 4 y abortar

7  Verificaciones post-deploy
   ├─ curl -sf http://127.0.0.1:8084/api/health   (reintentos con backoff, hasta 60 s)
   ├─ ss -ltn: FALLAR si 5433 aparece publicado, o si 8084 escucha en 0.0.0.0 en --prod  ← H-02/H-03
   └─ docker compose ps: todos los servicios running/healthy

8  Apache + TLS (solo --prod con --domain)
   ├─ setup-apache.sh <domain> <email>   (sin prompts; ya recibe args)
   └─ Añadir/verificar HSTS en el vhost 443

9  Operación
   ├─ Instalar cron diario de backup.sh (si no existe)      ← H-05
   ├─ Instalar cron/entrada de purga de refresh_tokens      ← H-14 (cuando exista)
   ├─ docker image prune -f (solo imágenes dangling del proyecto)
   └─ Resumen final: URLs, comandos de logs/stop/backup/rollback
```

### 6.3 Archivos nuevos/modificados que produce esta fase

| Archivo | Acción |
|---------|--------|
| `deploy/deploy.sh` | Nuevo (núcleo anterior) |
| `deploy/backup.sh` | Nuevo (pg_dump + rotación N días) |
| `deploy/docker-compose.yml` | Modificado: sin `ports` en `db` y `web` |
| `deploy/docker-compose.local.yml` | Nuevo (publica `8084:80`; opcional `127.0.0.1:5433:5432`) |
| `deploy/docker-compose.prod.yml` | Nuevo (publica `127.0.0.1:8084:80`) |
| `deploy/install.sh` | Se convierte en wrapper deprecado → llama a `deploy.sh` |
| `deploy/apache/keyvault.example.conf` | Modificado: bloque HSTS/cabeceras para el vhost 443 |
| `.gitignore` | Modificado: excepción de migraciones (H-01) |
| `.docs/DEPLOYMENT.md` | Actualizado con la nueva interfaz y el procedimiento de rollback/restore |

---

## 7. Orden de ejecución recomendado y dependencias

```
Fase 0 (P0, bloqueante) ──► primer despliegue seguro en producción
        │
Fase 1 (deploy.sh + backups + hardening compose)
        │
Fase 2 (rate limit ← trust proxy · CSP ← self-host FA · dummy hash · reuse detection · purga)
        │
Fase 3 (PBKDF2 600k ─┐  · cookie httpOnly (spike) · deuda menor · tests)
                      │  (mismo cambio de formato de blob)
Fase 4 (cambio de contraseña/PIN según spec) ◄┘
```

Reglas: H-12 antes que H-04; H-07 antes que H-08; H-10 se implementa junto a H-23 para un único re-cifrado del vault. Todo pasa por la rama `dev` → pruebas locales (`--local`) → merge a `main` → `deploy.sh --prod` en servidor.

---

## 8. Criterios de aceptación globales

1. Un `git clone` + `deploy.sh --prod --domain X --email Y` en un servidor virgen deja la app operativa con TLS, sin intervención manual.
2. Escaneo externo del servidor: solo 22/80/443 abiertos; 5433 y 8084 inaccesibles desde fuera (verificado también por el propio script).
3. Backup diario presente en `/var/backups/keyvaultjs/` y restauración probada al menos una vez.
4. 20+ intentos de login fallidos consecutivos desde una IP reciben 429.
5. La respuesta del frontend incluye CSP sin orígenes externos; ningún asset se carga desde CDN.
6. Reutilizar un refresh token ya rotado revoca todas las sesiones del usuario.
7. Suite de integración del API en verde ejecutable con un comando (`npm test` en `api/`).
8. Sin regresión funcional: login multi-dispositivo, conflicto 409, modo offline y temas dark/light siguen operando.

---

## 9. Estado de implementación (2026-08-20)

Se implementaron las **Fases 0, 1, 2 y 3** en la rama `dev`. La Fase 4 queda fuera
de esta iteración.

### 9.1 Archivos nuevos

| Archivo | Propósito |
|---------|-----------|
| `deploy/docker-compose.local.yml` | Override de desarrollo (`web` 8084, `db` en loopback). |
| `deploy/docker-compose.prod.yml` | Override de producción (`web` solo en `127.0.0.1`). |
| `deploy/deploy.sh` | Despliegue no interactivo con backup previo, verificación de puertos y `--rollback`. |
| `deploy/backup.sh` | `pg_dump` comprimido, rotación por días y restauración guiada. |
| `deploy/seed-test-user.mjs` | Datos de prueba: cifra en el host igual que el navegador. Solo desarrollo. |
| `api/src/middleware/rateLimit.js` | Limitadores por IP y por cuenta para `/api/auth/*`. |
| `api/src/utils/purgeTokens.js` | Purga de `refresh_tokens` ejecutable por cron. |
| `api/test/api.test.js`, `api/test/helpers.js` | 22 tests de integración (`node:test` + `fetch`, sin dependencias nuevas). |
| `web/security-headers.conf`, `web/proxy.conf` | Includes de nginx reutilizables. |
| `js/theme-init.js`, `js/sw-register.js` | Scripts extraídos del HTML para permitir `script-src 'self'`. |
| `icons/icon-{192,512,512-maskable}.png` | Iconos PWA locales generados desde `keyvault.svg`. |

### 9.2 Decisiones y desviaciones respecto al plan original

- **H-07 — iconos**: en lugar de self-hostear Font Awesome (~1 MB de webfonts en el
  repositorio), se sustituyeron los 16 iconos por un **sprite SVG propio** embebido en
  `index.html` (~4 KB), consistente con el patrón que ya usaba el logo. Los selectores
  CSS pasaron de `i` a `.icon`, y la clase `.icon` (`1em` + `currentColor`) preserva el
  comportamiento de tamaño y color que daba el icon-font.

- **H-08 — CSP y `add_header`**: nginx **no hereda** las cabeceras del bloque padre en
  cuanto un `location` declara su propio `add_header`. Las cabeceras se movieron a
  `web/security-headers.conf` y se incluyen explícitamente en cada `location`; sin eso,
  el shell, el manifest, el service worker y los estáticos se habrían quedado sin CSP.

- **Hallazgo adicional (extensión de H-07)**: `manifest.json` cargaba su icono desde
  `cdn-icons-png.flaticon.com`. La CSP lo bloqueó al verificar en navegador. Se
  generaron iconos PNG locales (192/512/512-maskable) desde `keyvault.svg` y se
  reescribió el manifest. **No quedan orígenes externos en el cliente.**

- **Hallazgo adicional (caché)**: `index.html` y `manifest.json` se servían sin ninguna
  política de caché, así que el navegador les aplicaba heurísticas y podía seguir
  sirviendo el shell anterior tras un despliegue. Ambos se sirven ahora con
  `Cache-Control: no-cache` (revalidación con ETag, no "sin caché").

- **H-10 — formato del blob**: implementado con prefijo de versión
  `v2:<iteraciones>:<iv>:<ciphertext>`, manteniendo la lectura del formato legado
  (2 partes = PBKDF2 100k). `StorageModule` re-cifra de forma transparente al
  desbloquear cuando detecta parámetros antiguos. El regex del servidor acepta ambos
  formatos. No se requiere ninguna migración manual.

- **H-13 — tokens en `localStorage`**: **evaluado y pospuesto**. Con H-07 y H-08 ya
  aplicados (CSP `script-src 'self'`, sin CDN, sin scripts inline), la superficie de XSS
  que hacía peligroso `localStorage` está cerrada. Migrar el refresh token a cookie
  `httpOnly` obligaría a rediseñar el flujo PWA offline (el cliente ya no podría saber si
  tiene sesión sin llamar al servidor) y a introducir protección CSRF, a cambio de una
  mejora marginal sobre el estado actual. Se revisará si se relaja la CSP o se
  incorporan dependencias de terceros en el cliente.

- **H-15 — enumeración de emails**: se mantiene el `409 email_taken` como trade-off de
  UX aceptado y queda documentado aquí. En `login` sí se corrigió la fuga por tiempo
  (H-09), que era la vía silenciosa.

- **H-22 — capacidades de los contenedores**: `no-new-privileges` en los tres servicios
  y `cap_drop: [ALL]` en `api` y `web`. `web` recupera el mínimo imprescindible
  (`CHOWN`, `SETGID`, `SETUID`, `NET_BIND_SERVICE`) porque nginx arranca como root y
  baja a `nginx` para los workers. En `db` **no** se aplica `cap_drop`: el entrypoint de
  la imagen oficial de PostgreSQL necesita esas capacidades para hacer `chown` del
  directorio de datos y cambiar de usuario. Imágenes fijadas por digest.

- **Rate limiting**: se usó `express-rate-limit` (única dependencia añadida) junto con
  `limit_req` de nginx. El límite por cuenta se aplica **después** de la validación Zod,
  para que la clave sea siempre un email normalizado y no se pueda eludir con
  mayúsculas o espacios.

- **Tests**: se descartó `supertest` para no añadir dependencias ni un stage de build
  con `devDependencies`. La suite usa `node:test` + `fetch` contra la app escuchando en
  un puerto efímero, sobre una base `keyvault_test` que se crea y migra sola.

### 9.3 Verificación realizada

| Criterio de aceptación (§8) | Resultado |
|---|---|
| 1. Despliegue desde cero sin intervención manual | `deploy.sh` implementado; validado `--local` y `--check`. **Falta probarlo en un servidor virgen.** |
| 2. Puertos no expuestos | ✅ `db` solo en `127.0.0.1:5433` en local y sin publicar en prod; `deploy.sh` **aborta** si detecta exposición. Lógica de detección probada. |
| 3. Backup diario y restauración probada | ✅ `backup.sh` verificado (dump + rotación). Cron instalado por `deploy.sh --prod`. **Falta ejecutar una restauración real.** |
| 4. 20+ intentos fallidos → 429 | ✅ cubierto por test de integración. |
| 5. CSP sin orígenes externos | ✅ verificado en navegador: consola sin errores ni violaciones de CSP. |
| 6. Reutilizar un refresh token rotado revoca las sesiones | ✅ cubierto por test de integración. |
| 7. Suite de integración en verde con un comando | ✅ `npm test` — 22/22 en verde. |
| 8. Sin regresión funcional | ✅ verificado en navegador: login, desbloqueo, 20 entradas descifradas, modales, generador y temas dark/light. |

**Pendiente de validar en servidor real**: criterios 1 y 3, el escaneo externo de
puertos, y la emisión de certificado + HSTS (requieren un host con dominio público).

---

*Fases 0–3 implementadas en la rama `dev`. Siguiente paso: Fase 4 (`H-23`), que debe
reutilizar el formato de blob versionado introducido en H-10 para el re-cifrado del
cambio de PIN.*
