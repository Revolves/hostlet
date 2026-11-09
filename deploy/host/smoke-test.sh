#!/usr/bin/env bash
set -euo pipefail

domain="${1:-hostlet.cn}"
resolve_ip="${2:-127.0.0.1}"
password_file="${HOSTLET_PASSWORD_FILE:-/etc/hostlet/initial-admin-password}"

if [[ ! -r "$password_file" ]]; then
  echo "Cannot read $password_file; run this check as root." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cookie_jar="$tmp_dir/cookies.txt"
login_body="$tmp_dir/login.json"
trap 'rm -rf "$tmp_dir"' EXIT
umask 077
node --input-type=commonjs -e \
  'const fs = require("node:fs"); const password = fs.readFileSync(process.argv[1], "utf8"); process.stdout.write(JSON.stringify({ password }));' \
  "$password_file" > "$login_body"

check() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL $label: expected $expected, got $actual" >&2
    exit 1
  fi
  echo "PASS $label"
}

http_code="$(curl --silent --show-error --output /dev/null \
  --write-out '%{http_code}' \
  --resolve "$domain:80:$resolve_ip" \
  "http://$domain/")"
check "HTTP canonical redirect" "301" "$http_code"

curl_args=(
  --silent
  --show-error
  --resolve "$domain:443:$resolve_ip"
  --resolve "www.$domain:443:$resolve_ip"
)
if [[ "${HOSTLET_INSECURE:-0}" == "1" ]]; then
  curl_args+=(--insecure)
fi

https_code="$(curl "${curl_args[@]}" --output "$tmp_dir/index.html" \
  --write-out '%{http_code}' "https://$domain/")"
check "HTTPS public homepage" "200" "$https_code"
grep -qi '<title>' "$tmp_dir/index.html"
echo "PASS homepage metadata"

www_code="$(curl "${curl_args[@]}" --output /dev/null \
  --write-out '%{http_code}' "https://www.$domain/")"
check "www canonical redirect" "301" "$www_code"

health_code="$(curl "${curl_args[@]}" --output "$tmp_dir/health.json" \
  --write-out '%{http_code}' "https://$domain/api/health")"
check "management health" "200" "$health_code"
grep -q '"ok":true' "$tmp_dir/health.json"

directory_code="$(curl "${curl_args[@]}" --output "$tmp_dir/directory.json" \
  --write-out '%{http_code}' "https://$domain/api/public/apps?limit=1")"
check "public directory API" "200" "$directory_code"

unauthorized_code="$(curl "${curl_args[@]}" --output /dev/null \
  --write-out '%{http_code}' "https://$domain/api/pages")"
check "unauthenticated management API" "401" "$unauthorized_code"

origin_code="$(curl "${curl_args[@]}" --output /dev/null \
  --write-out '%{http_code}' \
  --header 'Origin: https://invalid.example' \
  --header 'Content-Type: application/json' \
  --data-binary "@$login_body" \
  "https://$domain/api/auth/login")"
check "disallowed request origin" "403" "$origin_code"

login_code="$(curl "${curl_args[@]}" --output "$tmp_dir/login.json" \
  --write-out '%{http_code}' \
  --cookie-jar "$cookie_jar" \
  --header 'Content-Type: application/json' \
  --data-binary "@$login_body" \
  "https://$domain/api/auth/login")"
check "administrator login" "200" "$login_code"
grep -q '"authenticated":true' "$tmp_dir/login.json"

session_code="$(curl "${curl_args[@]}" --output "$tmp_dir/session.json" \
  --write-out '%{http_code}' \
  --cookie "$cookie_jar" \
  "https://$domain/api/auth/me")"
check "administrator session" "200" "$session_code"
grep -q '"authenticated":true' "$tmp_dir/session.json"

pages_code="$(curl "${curl_args[@]}" --output "$tmp_dir/pages.json" \
  --write-out '%{http_code}' \
  --cookie "$cookie_jar" \
  "https://$domain/api/pages")"
check "administrator page list" "200" "$pages_code"

missing_page_code="$(curl "${curl_args[@]}" --output /dev/null \
  --write-out '%{http_code}' "https://$domain/p/hostlet-smoke-missing/")"
check "missing hosted page" "404" "$missing_page_code"

logout_code="$(curl "${curl_args[@]}" --output /dev/null \
  --write-out '%{http_code}' \
  --cookie "$cookie_jar" \
  --request POST \
  "https://$domain/api/auth/logout")"
check "administrator logout" "200" "$logout_code"

echo "All deployment smoke checks passed."
