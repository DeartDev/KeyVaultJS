#!/usr/bin/env bash
# ==========================================
# KeyVaultJS - Server install / update script
# ==========================================
# Pulls latest code, brings up docker compose, runs DB migrations and,
# optionally, configures an Apache reverse proxy + Let's Encrypt SSL.
#
# Designed to run from the project root on the server (e.g. /var/www/keyvaultjs):
#
#   sudo bash deploy/install.sh
#
# Idempotent: safe to re-run after each `git pull`.
# ==========================================
set -euo pipefail

# ---------- colors ----------
C_RESET="\033[0m"; C_INFO="\033[1;34m"; C_OK="\033[1;32m"
C_WARN="\033[1;33m"; C_ERR="\033[1;31m"; C_DIM="\033[2m"
log()   { echo -e "${C_INFO}[*]${C_RESET} $*"; }
ok()    { echo -e "${C_OK}[✓]${C_RESET} $*"; }
warn()  { echo -e "${C_WARN}[!]${C_RESET} $*"; }
err()   { echo -e "${C_ERR}[x]${C_RESET} $*" >&2; }
die()   { err "$*"; exit 1; }

# ---------- paths ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"

cd "$PROJECT_DIR"

# ---------- preflight ----------
log "Checking dependencies..."
need=()
command -v git            >/dev/null 2>&1 || need+=(git)
command -v docker         >/dev/null 2>&1 || need+=(docker)
if ! docker compose version >/dev/null 2>&1; then need+=("docker-compose-plugin"); fi

if [[ ${#need[@]} -gt 0 ]]; then
  err "Missing required tools: ${need[*]}"
  err "Install them and re-run. For Docker Compose plugin on Debian/Ubuntu:"
  err "   sudo apt-get update && sudo apt-get install -y ${need[*]}"
  exit 1
fi
ok "docker, docker compose, git are available."

# ---------- port sanity checks ----------
log "Checking for port conflicts on the host..."
check_port() {
  local port="$1" name="$2"
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":${port}\$"; then
    warn "Port ${port} (${name}) is already in use on the host."
    warn "If it belongs to another container or service, abort and free it first."
    read -r -p "    Continue anyway? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || die "Aborted by user."
  fi
}
check_port 8084 "web"
check_port 5433 "postgres"

# ---------- git pull ----------
if [[ -d "$PROJECT_DIR/.git" ]]; then
  log "Pulling latest changes..."
  git -C "$PROJECT_DIR" pull --ff-only
  ok "Repository up to date."
else
  warn "Not a git repository. Skipping 'git pull'."
fi

# ---------- .env ----------
generate_secret() { openssl rand -hex 32; }

if [[ ! -f "$ENV_FILE" ]]; then
  log "Creating .env from .env.example..."
  [[ -f "$ENV_EXAMPLE" ]] || die "Missing $ENV_EXAMPLE"
  cp "$ENV_EXAMPLE" "$ENV_FILE"

  # Auto-generate strong JWT secrets.
  ACCESS=$(generate_secret)
  REFRESH=$(generate_secret)
  # Escape values for sed (they are hex, so safe; still, use a delimiter unlikely to clash).
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${ACCESS}|" "$ENV_FILE"
  sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=${REFRESH}|" "$ENV_FILE"

  # Prompt for Postgres password if still default.
  CURRENT_PG="$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
  if [[ -z "$CURRENT_PG" || "$CURRENT_PG" == *"change_me"* ]]; then
    DEFAULT_PG="$(generate_secret | head -c 24)"
    read -r -s -p "    Choose a PostgreSQL password [default: generated]: " PG_PW
    echo ""
    PG_PW="${PG_PW:-$DEFAULT_PG}"
    sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PW}|" "$ENV_FILE"
  fi
  ok ".env created with fresh JWT secrets."
else
  ok ".env already exists. Leaving as-is."
fi

# Verify mandatory vars are set (compose also enforces, but fail fast with a clear msg).
for var in POSTGRES_PASSWORD JWT_SECRET JWT_REFRESH_SECRET; do
  val="$(grep -E "^${var}=" "$ENV_FILE" | cut -d= -f2-)"
  if [[ -z "$val" || "$val" == *"change_me"* || "$val" == *"replace_with"* ]]; then
    die "Variable ${var} in $ENV_FILE is empty or still set to the example value."
  fi
done

# ---------- build + up ----------
log "Building images..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build

log "Starting containers..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

log "Waiting for PostgreSQL to be healthy..."
deadline=$(( $(date +%s) + 90 ))
until docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --format json db \
        | grep -q '"Health":"healthy"' 2>/dev/null; do
  if [[ $(date +%s) -gt $deadline ]]; then
    warn "Postgres did not become healthy in 90s. Check logs:"
    warn "   docker compose -f $COMPOSE_FILE logs db"
    break
  fi
  sleep 3
done

# ---------- migrations ----------
log "Running database migrations..."
if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api node src/utils/migrations.js up; then
  ok "Migrations applied."
else
  warn "Migration step failed. You can retry manually:"
  warn "   docker compose -f $COMPOSE_FILE exec api node src/utils/migrations.js up"
fi

# ---------- smoke test ----------
log "Smoke test: /api/health"
sleep 2
if curl -sf "http://127.0.0.1:8084/api/health" >/dev/null 2>&1; then
  ok "API is responding on http://127.0.0.1:8084/api/health"
else
  warn "API health endpoint did not respond yet. Give it a few seconds and retry:"
  warn "   curl http://127.0.0.1:8084/api/health"
fi

# ---------- Apache + SSL (optional) ----------
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-<server-ip>}"

echo ""
log "Reverse proxy configuration."
echo -e "${C_DIM}Leave the domain blank to expose the app directly on http://${HOST_IP}:8084${C_RESET}"
PROMPT_DOMAIN="$(echo -e "${C_INFO}Domain e.g. keyvault.example.com${C_RESET} [blank for IP:8084]: ")"
read -r -p "$PROMPT_DOMAIN" DOMAIN
DOMAIN="${DOMAIN:-}"

if [[ -z "$DOMAIN" ]]; then
  echo ""
  ok "No domain configured."
  ok "Access the app at: ${C_INFO}http://${HOST_IP}:8084${C_RESET}"
  echo -e "${C_DIM}A sample Apache config is available at deploy/apache/keyvault.example.conf.${C_RESET}"
  echo -e "${C_DIM}To add a domain later, run: sudo bash deploy/apache/setup-apache.sh <domain> <email>${C_RESET}"
else
  if [[ $EUID -ne 0 ]]; then
    warn "Apache + SSL setup requires root. Re-run install.sh with sudo, or run:"
    warn "   sudo bash deploy/apache/setup-apache.sh ${DOMAIN} <your-email>"
  elif ! command -v apache2ctl >/dev/null 2>&1; then
    warn "apache2 is not installed on this host. Skipping vhost setup."
    warn "Install it: sudo apt-get install -y apache2 certbot python3-certbot-apache"
    warn "Then run:  sudo bash deploy/apache/setup-apache.sh ${DOMAIN} <email>"
  else
    read -r -p "$(echo -e "${C_INFO}Email for Let's Encrypt notifications, blank = no SSL${C_RESET}: ")" EMAIL
    if bash "$SCRIPT_DIR/apache/setup-apache.sh" "$DOMAIN" "${EMAIL:-}"; then
      ok "Apache configured for ${DOMAIN}."
    else
      warn "Apache setup reported a problem (see messages above). The app is still available at http://${HOST_IP}:8084."
    fi
  fi
fi

# ---------- summary ----------
echo ""
ok "KeyVaultJS deployment finished."
echo -e "${C_DIM}------------------------------------------------------------${C_RESET}"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
echo -e "${C_DIM}------------------------------------------------------------${C_RESET}"
echo -e "Logs:        ${C_INFO}docker compose -f $COMPOSE_FILE logs -f${C_RESET}"
echo -e "Stop:        ${C_INFO}docker compose -f $COMPOSE_FILE down${C_RESET}"
echo -e "Backup DB:   ${C_INFO}docker exec keyvault_db pg_dump -U keyvault keyvault > backup.sql${C_RESET}"
