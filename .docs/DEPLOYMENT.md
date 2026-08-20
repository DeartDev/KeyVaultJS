# Guía de despliegue y operación

KeyVaultJS se despliega como tres contenedores (`web` nginx · `api` Node/Express ·
`db` PostgreSQL) orquestados con Docker Compose. En producción, Apache termina TLS
y hace de proxy inverso hacia el contenedor `web`, que solo escucha en loopback.

```
Internet ──► Apache :443 (TLS) ──► 127.0.0.1:8084 ──► nginx (web) ──► api:3000 ──► db:5432
                                                                       └── red interna keyvault_net
```

**El único puerto alcanzable desde fuera debe ser el de Apache (80/443).**
Ni PostgreSQL ni el contenedor `web` publican nada al exterior.

---

## 1. Ficheros de compose

La configuración está partida en una base sin puertos y dos overrides, para que
producción no pueda exponer nada por accidente:

| Archivo | Contenido |
|---------|-----------|
| `deploy/docker-compose.yml` | Base. **Ningún** `ports:`. Imágenes fijadas por digest, `no-new-privileges`, `cap_drop`, límites de memoria y healthchecks. |
| `deploy/docker-compose.local.yml` | Override de desarrollo: `web` en `8084:80` y `db` en `127.0.0.1:5433:5432` para clientes GUI. |
| `deploy/docker-compose.prod.yml` | Override de producción: `web` en `127.0.0.1:8084:80`. `db` sigue sin publicar. |

> Docker escribe sus reglas directamente en la cadena `DOCKER` de iptables y
> **puentea UFW/firewalld**: cerrar un puerto en el firewall del host NO protege
> un `ports:` publicado. La única defensa fiable es no publicarlo, o publicarlo
> en `127.0.0.1`. Por eso `deploy.sh` aborta si detecta lo contrario.

---

## 2. `deploy/deploy.sh`

Script único, **no interactivo**, idempotente y con red de seguridad.

```bash
# Producción, primera vez (configura Apache + Let's Encrypt)
sudo bash deploy/deploy.sh --prod --domain keyvault.example.com --email admin@example.com

# Producción, actualizaciones posteriores
sudo bash deploy/deploy.sh --prod

# Desarrollo local
bash deploy/deploy.sh --local

# Solo diagnóstico, sin tocar nada
bash deploy/deploy.sh --check

# Volver al despliegue anterior
sudo bash deploy/deploy.sh --rollback
```

| Flag | Efecto |
|------|--------|
| `--prod` / `--local` | Elige el override de compose. Obligatorio en el primer despliegue; después se recuerda en `deploy/.deploy-state/mode`. |
| `--domain`, `--email` | Configura Apache + certbot sin prompts. Sin `--domain` no se toca Apache. |
| `--no-pull` | Omite `git pull` (hotfix local, o CI que ya hizo checkout). |
| `--skip-backup` | Omite el backup previo. Solo para el primer despliegue. |
| `--rollback` | Restaura las imágenes `:previous` y explica cómo restaurar la base. |
| `--check` | Dependencias, estado de contenedores, puertos, salud de la API y permisos del `.env`. |

### Qué hace, en orden

1. **Preflight** — verifica `git`, `docker`, plugin `compose`, `openssl`, `curl`, `ss`;
   comprueba que **existan migraciones** en `api/src/db/migrations/` (si `.gitignore`
   volviera a excluirlas, el despliegue aborta aquí en vez de dejar la API sin esquema);
   exige root en `--prod`.
2. **Código** — `git pull --ff-only`, abortando si hay cambios sin commitear.
3. **Secrets** — crea `deploy/.env` con secrets generados (`openssl rand`) si no existe,
   aplica **siempre** `chmod 600` y aborta si alguna variable sigue con el valor de ejemplo.
4. **Backup previo** (`--prod`) — `pg_dump` comprimido a `/var/backups/keyvaultjs/pre-deploy-<ts>.sql.gz`.
5. **Build & up** — valida el compose, etiqueta las imágenes actuales como `:previous`,
   reconstruye y levanta. Espera a que `db` esté *healthy* leyendo `docker inspect`
   (no parseando la salida de `compose ps`, cuyo formato cambia entre versiones).
6. **Migraciones** — si fallan en producción, indica cómo restaurar el backup del paso 4.
7. **Verificaciones** — `/api/health` con reintentos, y **falla el despliegue** si
   PostgreSQL aparece publicado o si `web` escucha en `0.0.0.0` en modo `--prod`.
8. **Apache + TLS** — vhost, certbot y HSTS en el vhost `:443`.
9. **Operación** — instala el cron de backup diario y el de purga de `refresh_tokens`,
   y limpia imágenes huérfanas.

`deploy/install.sh` se mantiene como wrapper deprecado que redirige a `deploy.sh`.

---

## 3. Backups y restauración

```bash
sudo bash deploy/backup.sh                       # dump + rotación
sudo bash deploy/backup.sh --tag pre-migracion   # dump etiquetado
sudo bash deploy/backup.sh --restore /var/backups/keyvaultjs/daily-20260820-031500.sql.gz
```

- Destino: `/var/backups/keyvaultjs/` (`0700`), dumps a `0600`.
- Retención: 14 días (`KEYVAULT_BACKUP_RETENTION_DAYS`).
- Cron diario a las 03:15, instalado por `deploy.sh --prod`.
- La restauración pide confirmación explícita escribiendo `RESTAURAR`.

Los dumps contienen blobs cifrados y hashes bcrypt, nunca contraseñas en claro.
Aun así **trátalos como material sensible**: quien tenga un dump puede atacar
offline los PIN maestros.

> **Prueba la restauración al menos una vez.** Un backup no verificado no es un backup.

---

## 4. Desarrollo local

```bash
bash deploy/deploy.sh --local
# App:  http://localhost:8084
```

Comandos útiles:

```bash
CO="docker compose --env-file deploy/.env -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml"

$CO logs -f api                                  # logs
$CO exec api npm test                            # suite de integración
$CO exec api node src/utils/migrations.js status # estado de migraciones
$CO exec api node src/utils/purgeTokens.js       # purga manual de refresh_tokens
$CO exec db psql -U keyvault                     # consola SQL
```

### Datos de prueba

```bash
node deploy/seed-test-user.mjs --purge
```

Borra **todos** los usuarios y crea uno nuevo con la bóveda ya poblada, cifrando
en el host exactamente igual que lo haría el navegador. Solo para desarrollo.

---

## 5. Variables de entorno

`deploy/.env` (permisos `600`, nunca se commitea). Ver `deploy/.env.example`.

| Variable | Por defecto | Notas |
|----------|-------------|-------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `keyvault` / — / `keyvault` | La contraseña la genera `deploy.sh`. |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | — | 32 bytes hex. Rotarlos invalida todas las sesiones. |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `7d` | |
| `BCRYPT_ROUNDS` | `12` | |
| `VAULT_MAX_BYTES` | `1048576` | El límite del body de Express se deriva de este valor. |
| `TRUST_PROXY_HOPS` | `1` | Saltos de confianza para `X-Forwarded-For`. Necesario para el rate limit por IP. |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Ventana del rate limit de `/api/auth/*`. |
| `RATE_LIMIT_AUTH_MAX_IP` | `20` | Máximo por IP y ventana. |
| `RATE_LIMIT_AUTH_MAX_EMAIL` | `10` | Máximo de **fallos** por cuenta y ventana. |
| `REFRESH_TOKEN_PURGE_DAYS` | `30` | Retención de tokens expirados/revocados. |

**Rotación de secrets**: si el `.env` de desarrollo llegó a usarse en un servidor,
rota `JWT_SECRET`, `JWT_REFRESH_SECRET` y `POSTGRES_PASSWORD` antes del primer
despliegue real.

---

## 6. Comprobaciones post-despliegue

```bash
bash deploy/deploy.sh --check          # local
ss -ltn                                # 5433 y 8084 no deben estar en 0.0.0.0
curl -I https://tu-dominio/            # CSP + HSTS presentes
nmap -Pn -p 22,80,443,5433,8084 <ip>   # desde OTRA máquina: solo 22/80/443 abiertos
```

La respuesta del frontend debe incluir `Content-Security-Policy` sin ningún
origen externo, y ningún asset debe cargarse desde un CDN.

---

## 7. Resolución de problemas

| Síntoma | Causa habitual |
|---------|----------------|
| Todos los endpoints dan 500 | Migraciones no aplicadas. `compose exec api node src/utils/migrations.js status`. |
| `deploy.sh` aborta en preflight por migraciones | `.gitignore` volvió a excluir `*.sql` sin la excepción `!api/src/db/migrations/*.sql`. |
| La app sigue vieja tras desplegar | Service worker cacheado. El shell y el manifest se sirven con `Cache-Control: no-cache`; fuerza recarga o desregistra el SW. |
| 429 en login | Rate limit. Ajusta `RATE_LIMIT_*` o espera a que pase la ventana. |
| `token_reuse_detected` | Se reutilizó un refresh token ya rotado: todas las sesiones del usuario quedan revocadas por seguridad. Hay que volver a iniciar sesión. |
| Sesión cerrada en todos los dispositivos | Alguien cambió la contraseña de cuenta: es el comportamiento esperado. Los access tokens ya emitidos siguen valiendo hasta 15 min. |
| El PIN maestro no abre la bóveda en otro dispositivo | Se cambió el PIN en otro equipo. No hay forma de "empujar" el cambio (el servidor no conoce el PIN): hay que bloquear y volver a abrir con el nuevo. |
| El vault no descifra en otro dispositivo | El `vault_salt` vive en `users.vault_salt` y lo entrega el backend en login. Verifica que la respuesta lo incluya. |
