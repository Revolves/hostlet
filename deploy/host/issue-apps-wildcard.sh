#!/usr/bin/env bash
set -euo pipefail

domain="${1:-apps.hostlet.cn}"
cert_name="${CERT_NAME:-apps.hostlet.cn}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi
if [[ ! "${domain}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "Usage: $0 apps.example.com" >&2
  exit 1
fi

echo "Requesting a wildcard certificate for *.${domain}."
echo "Certbot will print a TXT record name and value."
echo "Add it in your DNS provider, wait for propagation, then press Enter."
echo

certbot certonly \
  --manual \
  --preferred-challenges dns \
  --cert-name "${cert_name}" \
  -d "*.${domain}" \
  --agree-tos \
  --register-unsafely-without-email

lineage="/etc/letsencrypt/live/${cert_name}"
if [[ ! -r "${lineage}/fullchain.pem" || ! -r "${lineage}/privkey.pem" ]]; then
  echo "Certificate files were not created under ${lineage}." >&2
  exit 1
fi

install -d -o root -g root -m 0755 /etc/hostlet/tls
install -o root -g root -m 0644 "${lineage}/fullchain.pem" /etc/hostlet/tls/apps-fullchain.pem
install -o root -g root -m 0600 "${lineage}/privkey.pem" /etc/hostlet/tls/apps-privkey.pem

nginx -t
systemctl reload nginx

echo
echo "Wildcard certificate installed for *.${domain}."
echo "Manual certificates do not renew automatically; repeat this script or configure a DNS-01 plugin before expiry."
