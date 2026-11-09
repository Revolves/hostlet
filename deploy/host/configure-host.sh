#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sudo ./configure-host.sh DOMAIN [--replace] [--self-signed]

Creates /etc/hostlet/hostlet.env with fresh random secrets and stores the
administrator password in /etc/hostlet/initial-admin-password. Existing
configuration is preserved unless --replace is specified.
EOF
}

domain="${1:-}"
shift || true
if [[ -z "$domain" || "$domain" == "--help" || "$domain" == "-h" ]]; then
  usage
  exit 1
fi
if [[ ! "$domain" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Invalid domain." >&2
  exit 1
fi

replace=0
self_signed=0
for option in "$@"; do
  case "$option" in
    --replace) replace=1 ;;
    --self-signed) self_signed=1 ;;
    *) echo "Unknown option: $option" >&2; exit 1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi
if [[ -e /etc/hostlet/hostlet.env && "$replace" -ne 1 ]]; then
  echo "/etc/hostlet/hostlet.env already exists; pass --replace to rotate it." >&2
  exit 1
fi

install -d -o root -g hostlet -m 0750 /etc/hostlet
install -d -o root -g root -m 0755 /etc/hostlet/tls

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -e /etc/hostlet/hostlet.env ]]; then
  mv /etc/hostlet/hostlet.env "/etc/hostlet/hostlet.env.$stamp.bak"
fi

admin_password="$(openssl rand -hex 24)"
app_secret="$(openssl rand -hex 32)"
umask 077
cat > /etc/hostlet/hostlet.env <<EOF
ADMIN_PASSWORD=$admin_password
APP_SECRET=$app_secret
ADMIN_PORT=3000
PAGES_PORT=8080
BIND_ADDRESS=127.0.0.1
TRUSTED_PROXY_IPS=127.0.0.1
ADMIN_ORIGIN=https://$domain
ADMIN_ORIGINS=https://$domain
PUBLIC_BASE_URL=https://$domain
COOKIE_SECURE=true
DATA_DIR=/var/lib/hostlet
SECURITY_LOG_RETENTION_DAYS=180
MAX_UPLOAD_BYTES=52428800
PUBLIC_GITHUB_URL=https://github.com/Revolves
PUBLIC_GITHUB_LABEL=@Revolves
MULTIUSER_ENABLED=false
REGISTRATION_ENABLED=false
USERNAME_REGISTRATION_ENABLED=false
SINGLE_DOMAIN_HOSTING=false
EOF
printf '%s' "$admin_password" > /etc/hostlet/initial-admin-password
chown root:hostlet /etc/hostlet/hostlet.env
chmod 0640 /etc/hostlet/hostlet.env
chown root:root /etc/hostlet/initial-admin-password
chmod 0600 /etc/hostlet/initial-admin-password

if [[ "$self_signed" -eq 1 ]]; then
  cert_tmp="$(mktemp -d)"
  trap 'rm -rf "$cert_tmp"' EXIT
  openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
    -keyout "$cert_tmp/privkey.pem" \
    -out "$cert_tmp/fullchain.pem" \
    -subj "/CN=$domain" \
    -addext "subjectAltName=DNS:$domain,DNS:www.$domain" >/dev/null 2>&1
  install -o root -g root -m 0644 "$cert_tmp/fullchain.pem" /etc/hostlet/tls/fullchain.pem
  install -o root -g root -m 0600 "$cert_tmp/privkey.pem" /etc/hostlet/tls/privkey.pem
fi

echo "Configuration written to /etc/hostlet/hostlet.env."
echo "Initial administrator password written to /etc/hostlet/initial-admin-password."
