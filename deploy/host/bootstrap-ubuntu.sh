#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.21.1}"
NODE_PREFIX="${NODE_PREFIX:-/opt/node22}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

case "$(dpkg --print-architecture)" in
  amd64) node_arch="x64" ;;
  arm64) node_arch="arm64" ;;
  *)
    echo "Unsupported architecture: $(dpkg --print-architecture)" >&2
    exit 1
    ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates certbot curl nginx openssl xz-utils

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
node_archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"

curl --fail --silent --show-error --location \
  --output "$tmp_dir/$node_archive" \
  "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}"
curl --fail --silent --show-error --location \
  --output "$tmp_dir/SHASUMS256.txt" \
  "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"

(
  cd "$tmp_dir"
  grep " ${node_archive}\$" SHASUMS256.txt | sha256sum --check --strict
)

install -d -m 0755 "$NODE_PREFIX"
tar -xJf "$tmp_dir/$node_archive" --strip-components=1 -C "$NODE_PREFIX"
ln -sfn "$NODE_PREFIX/bin/node" /usr/local/bin/node
ln -sfn "$NODE_PREFIX/bin/npm" /usr/local/bin/npm
ln -sfn "$NODE_PREFIX/bin/npx" /usr/local/bin/npx

if ! id hostlet >/dev/null 2>&1; then
  useradd --system --home /var/lib/hostlet --shell /usr/sbin/nologin hostlet
fi
install -d -o hostlet -g hostlet -m 0750 /var/lib/hostlet
install -d -o root -g hostlet -m 0750 /etc/hostlet
install -d -o root -g root -m 0755 /etc/hostlet/tls

node --version
npm --version
nginx -v
