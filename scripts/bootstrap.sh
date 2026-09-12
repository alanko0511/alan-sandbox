#!/usr/bin/env bash
# GCE startup-script for sandbox VMs.
#
# Kept deliberately tiny: it fetches the templates release and hands off. All
# real work lives in templates/_base/setup.sh and templates/<name>/setup.sh so
# that iterating on a template never requires touching instance metadata.
#
# NOTE: GCE runs startup scripts on EVERY boot, not just the first one. The
# .provisioned marker is what keeps a stop/start cycle from re-running the whole
# setup (several minutes) every time the VM comes back up.
set -euo pipefail

RELEASE_URL="https://github.com/alanko0511/alan-sandbox/releases/latest/download/sandbox-templates.tar.gz"
ROOT=/opt/sandbox
MARKER="$ROOT/.provisioned"

md() {
  curl -fsS -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/$1" 2>/dev/null || true
}

# Guest attributes are how the control plane knows the difference between
# "GCE says RUNNING" and "the box is actually usable". Never fatal.
set_status() {
  curl -fsS -X PUT --data "$1" -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/guest-attributes/sandbox/status" \
    >/dev/null 2>&1 || true
}

fail() {
  set_status "failed: $1"
  echo "[sandbox] FAILED: $1" >&2
  exit 1
}
trap 'fail "unexpected error on line $LINENO"' ERR

TEMPLATE="$(md instance/attributes/sandbox-template)"
[ -n "$TEMPLATE" ] || fail "instance metadata 'sandbox-template' is missing"

if [ -f "$MARKER" ]; then
  echo "[sandbox] already provisioned; reconnecting only"
  # Tailscale state persists in /var/lib/tailscale, so it reconnects on its own.
  set_status "ready"
  exit 0
fi

set_status "provisioning"
echo "[sandbox] provisioning template=$TEMPLATE"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates tar

echo "[sandbox] fetching templates release"
rm -rf "$ROOT"
mkdir -p "$ROOT"
curl -fsSL -o /tmp/sandbox-templates.tar.gz "$RELEASE_URL"
tar -xzf /tmp/sandbox-templates.tar.gz -C "$ROOT"
rm -f /tmp/sandbox-templates.tar.gz

[ -x "$ROOT/templates/_base/setup.sh" ] || chmod +x "$ROOT/templates/_base/setup.sh"
[ -f "$ROOT/templates/$TEMPLATE/setup.sh" ] || fail "template '$TEMPLATE' has no setup.sh"

install -m 0755 "$ROOT/scripts/rerun" /usr/local/bin/sandbox-rerun

echo "[sandbox] === base setup ==="
"$ROOT/templates/_base/setup.sh"

echo "[sandbox] === template setup: $TEMPLATE ==="
chmod +x "$ROOT/templates/$TEMPLATE/setup.sh"
SANDBOX_ROOT="$ROOT" "$ROOT/templates/$TEMPLATE/setup.sh"

# Exit node goes on LAST, after every download is done. Routing apt traffic
# through the home NAS in Ottawa would slow first boot for no benefit.
echo "[sandbox] === enabling exit node ==="
"$ROOT/templates/_base/exit-node.sh"

touch "$MARKER"
set_status "ready"
echo "[sandbox] ready"
