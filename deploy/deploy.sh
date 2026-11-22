#!/usr/bin/env bash
# Deploys RMS on an Ubuntu server (EC2, Lightsail, any VPS) without Docker:
#   PostgreSQL            the database, installed from apt, reachable from this server only
#   Node + PM2            runs the API and the live-updates service, restarts them, starts them at boot
#   nginx                 serves the built admin and worker apps and forwards /api and /ws
# Safe to run again: it pulls the latest code, rebuilds, applies migrations and reloads.
#
#   bash deploy.sh                          first deploy, over plain http on the server's IP (to try it out)
#   bash deploy.sh --domain example.com     turn on https: admin at example.com, staff app at worker.example.com
#
# Options:  --admin-email you@example.com   login email for the platform admin (first deploy only)
#           --branch production             which branch to deploy
#           --email you@example.com         contact email for the certificate (optional)
#           --force                         skip the check that the domain already points at this server
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Rajagopal143/RMS.git}"
BRANCH="${BRANCH:-production}"
APP_DIR="${APP_DIR:-/opt/rms}"
WEB_DIR="${WEB_DIR:-/var/www/rms}"
DOMAIN=""
ADMIN_EMAIL=""
CERT_EMAIL=""
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:?--admin-email needs a value}"; shift 2 ;;
    --email) CERT_EMAIL="${2:?--email needs a value}"; shift 2 ;;
    --branch) BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ENV_FILE="$APP_DIR/.env"
ADMIN_NAME=""; WORKER_NAME=""; API_NAME=""
[ -n "$DOMAIN" ] && { ADMIN_NAME="$DOMAIN"; WORKER_NAME="worker.$DOMAIN"; API_NAME="api.$DOMAIN"; }

sudo -n true 2>/dev/null || { echo "This needs a user with sudo (the default 'ubuntu' user has it)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "Installing what the server needs"
sudo apt-get update -y -qq
sudo apt-get install -y -qq git curl ca-certificates openssl rsync nginx postgresql certbot
node_ok=0
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then node_ok=1; fi
if [ "$node_ok" = 0 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs
fi
command -v pnpm >/dev/null 2>&1 || sudo npm install -g pnpm@10.4.1 >/dev/null
command -v pm2 >/dev/null 2>&1 || sudo npm install -g pm2 >/dev/null
# Building the apps needs more memory than a small server has, so make sure there is swap.
if [ -z "$(swapon --show --noheadings)" ]; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

say "Getting the code ($BRANCH)"
sudo mkdir -p "$APP_DIR" && sudo chown "$USER":"$USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" pull --quiet --ff-only origin "$BRANCH"
elif [ -f "$APP_DIR/package.json" ]; then
  echo "Using the code already in $APP_DIR (copied here, not from git)"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

FIRST_RUN=0
if [ ! -f "$ENV_FILE" ]; then
  say "Creating secrets (kept in $ENV_FILE)"
  FIRST_RUN=1
  PGPW="$(openssl rand -hex 24)"
  ( umask 077
    cat > "$ENV_FILE" <<ENV
POSTGRES_PASSWORD=$PGPW
DATABASE_URL=postgres://rms:$PGPW@localhost:5432/rms
JWT_SECRET=$(openssl rand -hex 32)
SUPERADMIN_EMAIL=${ADMIN_EMAIL:-admin@rms.local}
SUPERADMIN_PASSWORD=$(openssl rand -hex 8)
TZ=Asia/Kolkata
ENV
  )
fi
get_env() { grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

say "Setting up the database"
sudo systemctl enable --now postgresql >/dev/null 2>&1
PGPW="$(get_env POSTGRES_PASSWORD)"
if (cd / && sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='rms'" | grep -q 1); then
  (cd / && sudo -u postgres psql -qc "ALTER ROLE rms WITH LOGIN PASSWORD '$PGPW'")
else
  (cd / && sudo -u postgres psql -qc "CREATE ROLE rms WITH LOGIN PASSWORD '$PGPW'")
fi
(cd / && sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='rms'" | grep -q 1) \
  || (cd / && sudo -u postgres createdb -O rms rms)

say "Building the apps (the first build takes a few minutes)"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1 CI=true
pnpm install --frozen-lockfile
# With a domain, the apps talk to the API at its own address (api.<domain>).
if [ -n "$API_NAME" ]; then export VITE_API_ORIGIN="https://$API_NAME"; else unset VITE_API_ORIGIN; fi
pnpm --filter admin build
pnpm --filter worker build
sudo mkdir -p "$WEB_DIR/admin" "$WEB_DIR/worker" /var/www/certbot
sudo rsync -a --delete apps/admin/dist/ "$WEB_DIR/admin/"
sudo rsync -a --delete apps/worker/dist/ "$WEB_DIR/worker/"

say "Applying database migrations"
(
  set -a; . "$ENV_FILE"; set +a
  export NODE_ENV=production
  pnpm --filter @workspace/db db:migrate
  SEED_DEMO=false pnpm --filter @workspace/db db:seed
)

say "Starting the API and live updates with PM2"
pm2 startOrReload "$APP_DIR/deploy/ecosystem.config.cjs" --update-env >/dev/null
pm2 save >/dev/null
sudo env "PATH=$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true

say "Waiting for the API to answer"
ready=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:3001/health >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "The API didn't come up. Look at the logs with:  pm2 logs rms-api --lines 80"; exit 1; }

# ---- nginx ----------------------------------------------------------------------------------
write_snippet() {
  sudo tee /etc/nginx/snippets/rms-site.conf >/dev/null <<'NGINX'
gzip on;
gzip_types text/css application/javascript application/json image/svg+xml application/manifest+json;

location /.well-known/acme-challenge/ { root /var/www/certbot; }

location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location = /health { proxy_pass http://127.0.0.1:3001; }

location /ws {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}

# Built files carry a hash in their name, so they can be kept for a year.
location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; try_files $uri =404; }
# These must always be re-checked, so an update reaches phones quickly.
location = /index.html { add_header Cache-Control "no-cache"; }
location = /sw.js { add_header Cache-Control "no-cache"; }
location = /manifest.webmanifest { add_header Cache-Control "no-cache"; }

location / { try_files $uri /index.html; }
NGINX
  # The API's own address (api.<domain>): everything goes to the services, nothing static.
  sudo tee /etc/nginx/snippets/rms-api.conf >/dev/null <<'NGINX'
location /.well-known/acme-challenge/ { root /var/www/certbot; }

location /ws {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}

location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
NGINX
}

write_http_site() { # plain http: admin on 80, worker on 8080 (or both names on 80 when a domain is set)
  if [ -n "$DOMAIN" ]; then
    sudo tee /etc/nginx/sites-available/rms >/dev/null <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $ADMIN_NAME;
    root $WEB_DIR/admin;
    include snippets/rms-site.conf;
}
server {
    listen 80;
    listen [::]:80;
    server_name $WORKER_NAME;
    root $WEB_DIR/worker;
    include snippets/rms-site.conf;
}
server {
    listen 80;
    listen [::]:80;
    server_name $API_NAME;
    include snippets/rms-api.conf;
}
NGINX
  else
    sudo tee /etc/nginx/sites-available/rms >/dev/null <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root $WEB_DIR/admin;
    include snippets/rms-site.conf;
}
server {
    listen 8080;
    listen [::]:8080;
    server_name _;
    root $WEB_DIR/worker;
    include snippets/rms-site.conf;
}
NGINX
  fi
}

write_https_site() {
  local cert="/etc/letsencrypt/live/$ADMIN_NAME"
  sudo tee /etc/nginx/sites-available/rms >/dev/null <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $ADMIN_NAME;
    ssl_certificate $cert/fullchain.pem;
    ssl_certificate_key $cert/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    root $WEB_DIR/admin;
    include snippets/rms-site.conf;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $WORKER_NAME;
    ssl_certificate $cert/fullchain.pem;
    ssl_certificate_key $cert/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    root $WEB_DIR/worker;
    include snippets/rms-site.conf;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $API_NAME;
    ssl_certificate $cert/fullchain.pem;
    ssl_certificate_key $cert/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    include snippets/rms-api.conf;
}
NGINX
}

reload_nginx() { sudo nginx -t >/dev/null && sudo systemctl reload nginx; }

say "Setting up the web server (nginx)"
write_snippet
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/rms /etc/nginx/sites-enabled/rms
IP="$(curl -fsS --max-time 8 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)"

if [ -n "$DOMAIN" ]; then
  say "Checking that $ADMIN_NAME, $WORKER_NAME and $API_NAME point at this server ($IP)"
  missing=0
  for name in "$ADMIN_NAME" "$WORKER_NAME" "$API_NAME"; do
    got="$(getent ahostsv4 "$name" 2>/dev/null | awk 'NR==1{print $1}')"
    if [ "$got" = "$IP" ]; then echo "  ok      $name -> $got"; else echo "  MISSING $name -> ${got:-nothing yet} (needs an A record for $IP)"; missing=1; fi
  done
  if [ "$missing" = 1 ] && [ "$FORCE" = 0 ]; then
    write_http_site; sudo systemctl enable --now nginx >/dev/null 2>&1; reload_nginx
    echo; echo "Add the records above at your domain provider, wait a few minutes, then run this again."
    echo "(Certificates can only be issued once the names point here. Use --force to try anyway.)"
    exit 1
  fi
  write_http_site; sudo systemctl enable --now nginx >/dev/null 2>&1; reload_nginx
  say "Getting the https certificate"
  contact=(--register-unsafely-without-email)
  [ -n "$CERT_EMAIL" ] && contact=(-m "$CERT_EMAIL")
  sudo certbot certonly --webroot -w /var/www/certbot -d "$ADMIN_NAME" -d "$WORKER_NAME" -d "$API_NAME" \
    --non-interactive --agree-tos "${contact[@]}" --keep-until-expiring --expand
  sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  printf '#!/bin/sh\nsystemctl reload nginx\n' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null
  sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
  write_https_site
else
  write_http_site
  sudo systemctl enable --now nginx >/dev/null 2>&1
fi
reload_nginx

say "Setting up the nightly database backup"
chmod +x "$APP_DIR/deploy/backup.sh"
printf '# Database backup at 02:30 India time (21:00 UTC). Keeps two weeks in %s/backups.\n0 21 * * * root %s/deploy/backup.sh\n' "$APP_DIR" "$APP_DIR" | sudo tee /etc/cron.d/rms-backup >/dev/null

say "Done"
if [ -n "$DOMAIN" ]; then
  echo "  Admin and billing:         https://$ADMIN_NAME"
  echo "  Waiters, kitchen, packing: https://$WORKER_NAME"
  echo "  API:                       https://$API_NAME"
else
  echo "  Admin and billing:         http://$IP"
  echo "  Waiters, kitchen, packing: http://$IP:8080"
  echo "  This is plain http: fine for trying it out, but passwords travel unencrypted."
  echo "  When your domain is ready:  bash $APP_DIR/deploy/deploy.sh --domain yourdomain.com"
fi
if [ "$FIRST_RUN" = 1 ]; then
  echo
  echo "  Platform admin login (shown once; it is also saved in $ENV_FILE):"
  echo "    email:    $(get_env SUPERADMIN_EMAIL)"
  echo "    password: $(get_env SUPERADMIN_PASSWORD)"
fi
