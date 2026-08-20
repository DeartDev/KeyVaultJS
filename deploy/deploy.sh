#!/usr/bin/env bash
# ==========================================
# KeyVaultJS - Script de despliegue (sustituye a install.sh)
# ==========================================
# No interactivo por defecto, idempotente, con backup previo, verificación de
# puertos y rollback.
#
#   sudo bash deploy/deploy.sh --prod --domain keyvault.example.com --email admin@x.com
#        bash deploy/deploy.sh --local
#   sudo bash deploy/deploy.sh --prod --no-pull      # redeploy sin git pull
#   sudo bash deploy/deploy.sh --rollback            # volver al estado anterior
#        bash deploy/deploy.sh --check               # solo diagnóstico
# ==========================================
set -euo pipefail

# ---------- colores ----------
C_RESET="\033[0m"; C_INFO="\033[1;34m"; C_OK="\033[1;32m"
C_WARN="\033[1;33m"; C_ERR="\033[1;31m"; C_DIM="\033[2m"
log()  { echo -e "${C_INFO}[*]${C_RESET} $*"; }
ok()   { echo -e "${C_OK}[✓]${C_RESET} $*"; }
warn() { echo -e "${C_WARN}[!]${C_RESET} $*"; }
err()  { echo -e "${C_ERR}[x]${C_RESET} $*" >&2; }
die()  { err "$*"; exit 1; }

# ---------- rutas ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE_COMPOSE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
STATE_DIR="$SCRIPT_DIR/.deploy-state"
MIGRATIONS_DIR="$PROJECT_DIR/api/src/db/migrations"
WEB_PORT=8084

cd "$PROJECT_DIR"

# ---------- flags ----------
MODE=""            # prod | local
DOMAIN=""; EMAIL=""
DO_PULL=1; DO_BACKUP=1
ACTION="deploy"    # deploy | rollback | check

usage() { sed -n '2,15p' "${BASH_SOURCE[0]}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod)        MODE="prod"; shift ;;
    --local)       MODE="local"; shift ;;
    --domain)      DOMAIN="${2:?--domain necesita un valor}"; shift 2 ;;
    --email)       EMAIL="${2:?--email necesita un valor}"; shift 2 ;;
    --no-pull)     DO_PULL=0; shift ;;
    --skip-backup) DO_BACKUP=0; shift ;;
    --rollback)    ACTION="rollback"; shift ;;
    --check)       ACTION="check"; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             err "Opción desconocida: $1"; usage; exit 1 ;;
  esac
done

# El modo se puede inferir en rollback/check a partir del último despliegue.
if [[ -z "$MODE" && -f "$STATE_DIR/mode" ]]; then
  MODE="$(cat "$STATE_DIR/mode")"
fi
[[ -n "$MODE" ]] || die "Indica --prod o --local (obligatorio en el primer despliegue)."
[[ "$MODE" == "prod" || "$MODE" == "local" ]] || die "Modo inválido: $MODE"

OVERRIDE_COMPOSE="$SCRIPT_DIR/docker-compose.${MODE}.yml"
compose() { docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" -f "$OVERRIDE_COMPOSE" "$@"; }

# ==========================================
# 1. Preflight
# ==========================================
preflight() {
  log "Comprobando dependencias..."
  local need=()
  for bin in git docker openssl curl; do
    command -v "$bin" >/dev/null 2>&1 || need+=("$bin")
  done
  command -v ss >/dev/null 2>&1 || need+=("iproute2 (ss)")
  docker compose version >/dev/null 2>&1 || need+=("docker-compose-plugin")
  [[ ${#need[@]} -eq 0 ]] || die "Faltan herramientas: ${need[*]}"
  ok "git, docker, docker compose, openssl, curl y ss disponibles."

  # Guarda de H-01: sin migraciones, la API arranca sin esquema y todo da 500.
  if ! compgen -G "$MIGRATIONS_DIR/*.sql" >/dev/null; then
    die "No hay migraciones en $MIGRATIONS_DIR.
     Suele significar que .gitignore las está excluyendo del repositorio.
     Comprueba que '!api/src/db/migrations/*.sql' sigue en .gitignore y que
     el archivo está trackeado:  git ls-files api/src/db/migrations/"
  fi
  ok "Migraciones presentes ($(ls -1 "$MIGRATIONS_DIR"/*.sql | wc -l) archivo/s)."

  [[ -f "$BASE_COMPOSE" ]]     || die "Falta $BASE_COMPOSE"
  [[ -f "$OVERRIDE_COMPOSE" ]] || die "Falta $OVERRIDE_COMPOSE"

  if [[ "$MODE" == "prod" && $EUID -ne 0 ]]; then
    die "El modo --prod necesita root (Apache, cron, /var/backups). Usa sudo."
  fi
}

# ==========================================
# 2. Código
# ==========================================
update_code() {
  [[ -d "$PROJECT_DIR/.git" ]] || { warn "No es un repositorio git; se omite el pull."; return; }
  install -d -m 0755 "$STATE_DIR"
  git -C "$PROJECT_DIR" rev-parse HEAD > "$STATE_DIR/previous-commit"

  if [[ $DO_PULL -eq 0 ]]; then
    log "--no-pull: se despliega el árbol de trabajo actual."
    return
  fi
  if ! git -C "$PROJECT_DIR" diff --quiet || ! git -C "$PROJECT_DIR" diff --cached --quiet; then
    die "Hay cambios locales sin commitear. Haz commit/stash o usa --no-pull."
  fi
  log "Actualizando código (git pull --ff-only)..."
  git -C "$PROJECT_DIR" pull --ff-only
  ok "Repositorio actualizado ($(git -C "$PROJECT_DIR" rev-parse --short HEAD))."
}

# ==========================================
# 3. Secrets (.env)  -> H-06
# ==========================================
prepare_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    log "Creando .env desde .env.example con secrets generados..."
    [[ -f "$ENV_EXAMPLE" ]] || die "Falta $ENV_EXAMPLE"
    # umask antes de crear: el archivo nunca llega a existir con permisos laxos.
    (umask 077 && cp "$ENV_EXAMPLE" "$ENV_FILE")
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|"          "$ENV_FILE"
    sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -hex 32)|" "$ENV_FILE"
    sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|"   "$ENV_FILE"
    ok ".env creado."
  fi

  # Se aplica siempre, exista o no de antes: cubre .env heredados de install.sh.
  chmod 600 "$ENV_FILE"
  ok "Permisos de $ENV_FILE: $(stat -c '%a' "$ENV_FILE")"

  local val
  for var in POSTGRES_PASSWORD JWT_SECRET JWT_REFRESH_SECRET; do
    val="$(grep -E "^${var}=" "$ENV_FILE" | cut -d= -f2- || true)"
    if [[ -z "$val" || "$val" == *"change_me"* || "$val" == *"replace_with"* ]]; then
      die "La variable ${var} de $ENV_FILE está vacía o sigue con el valor de ejemplo."
    fi
  done
}

# ==========================================
# 4. Backup previo  -> H-05
# ==========================================
pre_deploy_backup() {
  [[ "$MODE" == "prod" ]] || return 0
  [[ $DO_BACKUP -eq 1 ]]  || { warn "--skip-backup: sin backup previo."; return 0; }
  if ! docker inspect -f '{{.State.Running}}' keyvault_db 2>/dev/null | grep -q true; then
    log "Primer despliegue (no hay contenedor db): sin backup previo."
    return 0
  fi
  log "Backup previo al despliegue..."
  bash "$SCRIPT_DIR/backup.sh" --tag pre-deploy
}

# ==========================================
# 5. Build & Up
# ==========================================
tag_previous_images() {
  local id
  for svc in api web; do
    id="$(docker image inspect -f '{{.Id}}' "keyvaultjs-${svc}:latest" 2>/dev/null || true)"
    [[ -n "$id" ]] && docker tag "$id" "keyvaultjs-${svc}:previous" >/dev/null
  done
}

build_and_up() {
  log "Validando la configuración de compose..."
  compose config -q || die "La configuración de compose no es válida."

  tag_previous_images
  log "Construyendo imágenes..."
  compose build --pull
  log "Levantando contenedores..."
  compose up -d --remove-orphans

  wait_for_healthy keyvault_db 120
}

# Espera vía `docker inspect`, no parseando `compose ps --format json` (H-16):
# el formato de esa salida cambió entre versiones de compose.
wait_for_healthy() {
  local name="$1" timeout="$2" deadline status
  deadline=$(( $(date +%s) + timeout ))
  log "Esperando a que $name esté healthy..."
  while true; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo missing)"
    case "$status" in
      healthy|running) ok "$name: $status"; return 0 ;;
      exited|dead)     die "$name terminó ($status). Revisa: docker logs $name" ;;
    esac
    [[ $(date +%s) -lt $deadline ]] || die "$name no llegó a healthy en ${timeout}s. Revisa: docker logs $name"
    sleep 3
  done
}

# ==========================================
# 6. Migraciones
# ==========================================
run_migrations() {
  log "Aplicando migraciones..."
  if compose exec -T api node src/utils/migrations.js up; then
    ok "Migraciones aplicadas."
    return 0
  fi
  err "Fallo al aplicar las migraciones."
  if [[ "$MODE" == "prod" && $DO_BACKUP -eq 1 ]]; then
    local last
    last="$(ls -1t /var/backups/keyvaultjs/pre-deploy-*.sql.gz 2>/dev/null | head -1 || true)"
    [[ -n "$last" ]] && err "Restaura el estado previo con:
     sudo bash deploy/backup.sh --restore $last
     sudo bash deploy/deploy.sh --rollback"
  fi
  exit 1
}

# ==========================================
# 7. Verificaciones post-despliegue  -> H-02 / H-03
# ==========================================
verify_ports() {
  local listening failed=0
  listening="$(ss -ltnH 2>/dev/null | awk '{print $4}')"

  if grep -qE '(^|[^0-9])(0\.0\.0\.0|\[?::\]?):5433$' <<<"$listening"; then
    err "PostgreSQL está publicado en todas las interfaces (:5433)."
    err "Docker escribe sus reglas directamente en iptables y puentea UFW/firewalld,"
    err "así que cerrarlo en el firewall del host NO basta. Quita 'ports' del servicio db."
    failed=1
  fi
  if [[ "$MODE" == "prod" ]] && grep -qE '(^|[^0-9])(0\.0\.0\.0|\[?::\]?):'"$WEB_PORT"'$' <<<"$listening"; then
    err "El puerto web $WEB_PORT escucha en 0.0.0.0 en producción: cualquiera puede"
    err "saltarse Apache y usar la app por HTTP sin cifrar. Usa docker-compose.prod.yml."
    failed=1
  fi
  [[ $failed -eq 0 ]] || die "Verificación de puertos fallida."

  ok "Puertos vigilados en escucha:"
  if ! grep -E ":(5433|${WEB_PORT}|80|443)\$" <<<"$listening" | sed 's/^/      /'; then
    echo "      (ninguno de los puertos vigilados está publicado)"
  fi
}

verify_health() {
  local deadline=$(( $(date +%s) + 60 ))
  log "Comprobando /api/health..."
  while [[ $(date +%s) -lt $deadline ]]; do
    if curl -sf "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then
      ok "API respondiendo en http://127.0.0.1:${WEB_PORT}/api/health"
      return 0
    fi
    sleep 3
  done
  die "La API no respondió en 60s. Revisa: docker compose logs api"
}

verify_services() {
  local bad
  bad="$(compose ps --status exited --status dead -q 2>/dev/null || true)"
  [[ -z "$bad" ]] || die "Hay servicios caídos. Revisa: docker compose logs"
  ok "Todos los servicios están en marcha."
}

# ==========================================
# 8. Apache + TLS
# ==========================================
setup_apache() {
  [[ "$MODE" == "prod" && -n "$DOMAIN" ]] || return 0
  if ! command -v apache2ctl >/dev/null 2>&1; then
    warn "apache2 no está instalado; se omite la configuración del vhost."
    warn "  apt-get install -y apache2 certbot python3-certbot-apache"
    return 0
  fi
  log "Configurando Apache para $DOMAIN..."
  bash "$SCRIPT_DIR/apache/setup-apache.sh" "$DOMAIN" "$EMAIL" \
    || warn "setup-apache.sh reportó un problema (ver arriba)."
}

# ==========================================
# 9. Operación: cron de backup y purga
# ==========================================
install_cron() {
  [[ "$MODE" == "prod" ]] || return 0
  command -v crontab >/dev/null 2>&1 || { warn "crontab no disponible; instala el cron a mano."; return 0; }

  local backup_line purge_line current
  backup_line="15 3 * * * /bin/bash $SCRIPT_DIR/backup.sh >> /var/log/keyvault-backup.log 2>&1"
  purge_line="45 3 * * * cd $PROJECT_DIR && /usr/bin/docker compose --env-file $ENV_FILE -f $BASE_COMPOSE -f $OVERRIDE_COMPOSE exec -T api node src/utils/purgeTokens.js >> /var/log/keyvault-purge.log 2>&1"

  current="$(crontab -l 2>/dev/null || true)"
  local updated="$current"
  grep -qF "$SCRIPT_DIR/backup.sh" <<<"$current"       || updated="${updated}"$'\n'"$backup_line"
  grep -qF "src/utils/purgeTokens.js" <<<"$current"    || updated="${updated}"$'\n'"$purge_line"

  if [[ "$updated" != "$current" ]]; then
    printf '%s\n' "$updated" | sed '/^$/d' | crontab -
    ok "Cron instalado: backup diario 03:15 y purga de refresh_tokens 03:45."
  else
    ok "Cron ya estaba configurado."
  fi
}

# ==========================================
# Acciones
# ==========================================
do_check() {
  preflight
  log "Estado de los contenedores:"
  compose ps
  verify_ports
  if curl -sf "http://127.0.0.1:${WEB_PORT}/api/health" 2>/dev/null; then
    echo ""; ok "API sana."
  else
    warn "La API no responde en 127.0.0.1:${WEB_PORT}."
  fi
  [[ -f "$ENV_FILE" ]] && ok "Permisos de .env: $(stat -c '%a' "$ENV_FILE")"
}

do_rollback() {
  preflight
  local prev_commit=""
  [[ -f "$STATE_DIR/previous-commit" ]] && prev_commit="$(cat "$STATE_DIR/previous-commit")"

  docker image inspect keyvaultjs-api:previous >/dev/null 2>&1 \
    || die "No hay imágenes :previous guardadas; no se puede hacer rollback automático."

  warn "Se va a volver a las imágenes anteriores del despliegue."
  [[ -n "$prev_commit" ]] && warn "Commit previo registrado: ${prev_commit:0:12}"
  log "Restaurando imágenes..."
  docker tag keyvaultjs-api:previous keyvaultjs-api:latest
  docker tag keyvaultjs-web:previous keyvaultjs-web:latest
  compose up -d --no-build --remove-orphans
  wait_for_healthy keyvault_db 120
  verify_health
  ok "Rollback de imágenes completado."
  echo ""
  echo -e "${C_DIM}Si el problema fue de esquema, restaura además el último backup:"
  echo -e "  sudo bash deploy/backup.sh --restore \$(ls -1t /var/backups/keyvaultjs/pre-deploy-*.sql.gz | head -1)"
  [[ -n "$prev_commit" ]] && echo -e "Y para volver el código:  git checkout $prev_commit${C_RESET}" || echo -e "${C_RESET}"
}

do_deploy() {
  preflight
  update_code
  prepare_env
  pre_deploy_backup
  build_and_up
  run_migrations
  verify_health
  verify_ports
  verify_services
  setup_apache
  install_cron

  install -d -m 0755 "$STATE_DIR"
  printf '%s\n' "$MODE" > "$STATE_DIR/mode"
  docker image prune -f >/dev/null 2>&1 || true

  echo ""
  ok "Despliegue de KeyVaultJS finalizado (modo: $MODE)."
  echo -e "${C_DIM}------------------------------------------------------------${C_RESET}"
  compose ps
  echo -e "${C_DIM}------------------------------------------------------------${C_RESET}"
  if [[ "$MODE" == "local" ]]; then
    echo -e "App:       ${C_INFO}http://localhost:${WEB_PORT}${C_RESET}"
  elif [[ -n "$DOMAIN" ]]; then
    echo -e "App:       ${C_INFO}https://${DOMAIN}${C_RESET}"
  else
    echo -e "App:       ${C_INFO}http://127.0.0.1:${WEB_PORT}${C_RESET} ${C_DIM}(solo loopback; configura Apache con --domain)${C_RESET}"
  fi
  echo -e "Logs:      ${C_INFO}docker compose -f $BASE_COMPOSE -f $OVERRIDE_COMPOSE logs -f${C_RESET}"
  echo -e "Parar:     ${C_INFO}docker compose -f $BASE_COMPOSE -f $OVERRIDE_COMPOSE down${C_RESET}"
  echo -e "Backup:    ${C_INFO}sudo bash deploy/backup.sh${C_RESET}"
  echo -e "Rollback:  ${C_INFO}sudo bash deploy/deploy.sh --rollback${C_RESET}"
  echo -e "Chequeo:   ${C_INFO}bash deploy/deploy.sh --check${C_RESET}"
}

case "$ACTION" in
  check)    do_check ;;
  rollback) do_rollback ;;
  deploy)   do_deploy ;;
esac
