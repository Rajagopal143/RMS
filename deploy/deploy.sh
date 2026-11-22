#!/usr/bin/env bash
# Deploys RMS on an Ubuntu server (Lightsail, EC2, any VPS). Safe to run again: it updates the app.
#
#   bash deploy.sh                          first deploy, over plain http on the server's IP (to try it out)
#   bash deploy.sh --domain example.com     turn on https: admin at example.com, staff app at worker.example.com
#
# Options:  --admin-email you@example.com   login email for the platform admin (first deploy only)
#           --branch main                   which branch to deploy
#           --force                         skip the check that the domain already points at this server
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Rajagopal143/RMS.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/rms}"
DOMAIN=""
ADMIN_EMAIL=""
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:?--admin-email needs a value}"; shift 2 ;;
    --branch) BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ENV_FILE="$APP_DIR/.env"
COMPOSE="sudo docker compose -f docker-compose.prod.yml"

sudo -n true 2>/dev/null || { echo "This needs a user with sudo (the default 'ubuntu' user on Lightsail has it)."; exit 1; }

say "Installing what the server needs"
if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sudo sh; fi
sudo systemctl enable --now docker >/dev/null 2>&1 || true
if ! command -v git >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
  sudo apt-get update -y && sudo apt-get install -y git openssl curl
fi
# Installing the apps needs more memory than a small server has, so make sure there is swap.
if [ -z "$(swapon --show --noheadings)" ]; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

say "Getting the code ($BRANCH)"
sudo mkdir -p "$APP_DIR" && sudo chown "$USER":"$USER" "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ] && [ -f "$APP_DIR/docker-compose.prod.yml" ]; then
  echo "Using the code already in $APP_DIR (copied here, not from git)"
elif [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" pull --quiet --ff-only origin "$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

set_env() { # set_env KEY VALUE
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}

FIRST_RUN=0
if [ ! -f "$ENV_FILE" ]; then
  say "Creating secrets (kept in $ENV_FILE)"
  FIRST_RUN=1
  ( umask 077
    cat > "$ENV_FILE" <<ENV
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
SUPERADMIN_EMAIL=${ADMIN_EMAIL:-admin@rms.local}
SUPERADMIN_PASSWORD=$(openssl rand -hex 8)
TZ=Asia/Kolkata
ENV
  )
fi

IP="$(curl -fsS --max-time 8 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)"

if [ -n "$DOMAIN" ]; then
  say "Checking that $DOMAIN points at this server ($IP)"
  missing=0
  for name in "$DOMAIN" "worker.$DOMAIN"; do
    got="$(getent ahostsv4 "$name" 2>/dev/null | awk 'NR==1{print $1}')"
    if [ "$got" = "$IP" ]; then echo "  ok      $name -> $got"; else echo "  MISSING $name -> ${got:-nothing yet} (needs an A record for $IP)"; missing=1; fi
  done
  if [ "$missing" = 1 ] && [ "$FORCE" = 0 ]; then
    echo; echo "Add the records above at your domain provider, wait a few minutes, then run this again."
    echo "(Certificates can only be issued once the names point here. Use --force to try anyway.)"
    exit 1
  fi
  set_env ADMIN_ADDR "$DOMAIN"
  set_env WORKER_ADDR "worker.$DOMAIN"
fi

say "Building and starting everything (the first build takes several minutes)"
$COMPOSE up -d --build

say "Waiting for the app to answer"
ready=0
for _ in $(seq 1 90); do
  if $COMPOSE exec -T web wget -qO- http://backend:3001/health >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "The app didn't come up. Look at the logs with:  cd $APP_DIR && $COMPOSE logs --tail 80"; exit 1; }

say "Setting up the nightly database backup"
chmod +x "$APP_DIR/deploy/backup.sh"
printf '# Database backup at 02:30 India time (21:00 UTC). Keeps two weeks in %s/backups.\n0 21 * * * root %s/deploy/backup.sh\n' "$APP_DIR" "$APP_DIR" | sudo tee /etc/cron.d/rms-backup >/dev/null

say "Done"
if [ -n "$DOMAIN" ]; then
  echo "  Admin and billing:        https://$DOMAIN"
  echo "  Waiters, kitchen, packing: https://worker.$DOMAIN"
else
  echo "  Admin and billing:        http://$IP"
  echo "  Waiters, kitchen, packing: http://$IP:8080"
  echo "  This is plain http: fine for trying it out, but passwords travel unencrypted."
  echo "  When your domain is ready:  bash $APP_DIR/deploy/deploy.sh --domain yourdomain.com"
fi
if [ "$FIRST_RUN" = 1 ]; then
  echo
  echo "  Platform admin login (shown once; it is also saved in $ENV_FILE):"
  echo "    email:    $(grep '^SUPERADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2-)"
  echo "    password: $(grep '^SUPERADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
fi
