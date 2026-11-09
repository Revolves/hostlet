#!/usr/bin/env bash
set -euo pipefail

apps_domain="${1:-apps.hostlet.cn}"
env_file="${HOSTLET_ENV_FILE:-/etc/hostlet/hostlet.env}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi
if [[ ! -f "${env_file}" ]]; then
  echo "Missing ${env_file}." >&2
  exit 1
fi
if [[ ! "${apps_domain}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "Usage: $0 apps.example.com" >&2
  exit 1
fi

set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "${env_file}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${env_file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${env_file}"
  fi
}

set_env MULTIUSER_ENABLED true
set_env REGISTRATION_ENABLED true
set_env USERNAME_REGISTRATION_ENABLED true
set_env COOKIE_SECURE true
set_env SINGLE_DOMAIN_HOSTING true
set_env APPS_DOMAIN "${apps_domain}"

chown root:hostlet "${env_file}"
chmod 0640 "${env_file}"

grep -E '^(MULTIUSER_ENABLED|REGISTRATION_ENABLED|USERNAME_REGISTRATION_ENABLED|COOKIE_SECURE|SINGLE_DOMAIN_HOSTING|ADMIN_ORIGIN|APPS_DOMAIN)=' "${env_file}"
systemctl restart hostlet
systemctl is-active hostlet
