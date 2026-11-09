#!/bin/sh
set -eu

: "${RENEWED_LINEAGE:?RENEWED_LINEAGE is required}"

install -o root -g root -m 0644 \
  "$RENEWED_LINEAGE/fullchain.pem" \
  /etc/hostlet/tls/apps-fullchain.pem
install -o root -g root -m 0600 \
  "$RENEWED_LINEAGE/privkey.pem" \
  /etc/hostlet/tls/apps-privkey.pem

/usr/sbin/nginx -t
systemctl reload nginx
