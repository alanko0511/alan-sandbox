#!/usr/bin/env bash
# Base layer: everything every sandbox VM gets, regardless of template.
# Must be idempotent — sandbox-rerun re-executes this on a live VM.
set -euo pipefail

# The local account you SSH in as. It matches the MacBook username so that
# plain `ssh sb-<name>` works with no user@ prefix and herdr needs no extra
# config. Tailscale ACLs must allow SSH to this user.
SANDBOX_USER="${SANDBOX_USER:-alanko}"

md() {
  curl -fsS -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/$1" 2>/dev/null || true
}

log() { echo "[base] $*"; }

as_user() { sudo -u "$SANDBOX_USER" -H bash -lc "$1"; }

export DEBIAN_FRONTEND=noninteractive

# ------------------------------------------------- metadata route (before tailscale)
# Must be installed before the exit node goes on, and must survive reboots:
# without it the VM cannot read its own instance metadata once egress is routed
# through the exit node. See metadata-route.sh for the mechanism.
install -m 0755 "$(dirname "$0")/metadata-route.sh" /usr/local/bin/sandbox-metadata-route
cat > /etc/systemd/system/sandbox-metadata-route.service <<'UNIT'
[Unit]
Description=Keep GCE metadata reachable when a Tailscale exit node is active
# Must run AFTER tailscaled: it clears the rule when it starts, so adding it
# earlier is a no-op. Must run BEFORE the startup script, which reads metadata.
After=network-online.target tailscaled.service
Wants=network-online.target
Before=google-startup-scripts.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/sandbox-metadata-route

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable sandbox-metadata-route.service

# ---------------------------------------------------------------- user account
if ! id -u "$SANDBOX_USER" >/dev/null 2>&1; then
  log "creating user $SANDBOX_USER"
  useradd -m -s /bin/bash "$SANDBOX_USER"
fi
usermod -aG sudo "$SANDBOX_USER"
echo "$SANDBOX_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$SANDBOX_USER"
chmod 0440 "/etc/sudoers.d/90-$SANDBOX_USER"

# ------------------------------------------------------------- system packages
log "apt packages"
apt-get update -qq
apt-get install -y -qq \
  build-essential git curl wget jq unzip ripgrep tmux vim ca-certificates gnupg

# ------------------------------------------------------------------- tailscale
# Brought up early (without the exit node) so the box joins the tailnet and
# becomes SSH-able while the rest of setup is still running.
if ! command -v tailscale >/dev/null 2>&1; then
  log "installing tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi

if ! tailscale status >/dev/null 2>&1; then
  log "joining tailnet"
  PROJECT_ID="$(md project/project-id)"
  HOSTNAME_TS="$(md instance/name)"
  TOKEN="$(md instance/service-accounts/default/token | jq -r .access_token)"

  # Deliberately no `set -x` anywhere near this: serial console output is
  # readable by anyone with project access and is streamed into the web UI.
  AUTHKEY="$(curl -fsS -H "Authorization: Bearer $TOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/$PROJECT_ID/secrets/tailscale-authkey/versions/latest:access" \
    | jq -r .payload.data | base64 -d)"
  unset TOKEN

  tailscale up \
    --authkey="$AUTHKEY" \
    --ssh \
    --hostname="$HOSTNAME_TS" \
    --accept-routes \
    --accept-dns
  unset AUTHKEY
  log "tailnet joined as $HOSTNAME_TS"
else
  log "tailscale already up"
fi

# ---------------------------------------------------------------------- docker
if ! command -v docker >/dev/null 2>&1; then
  log "installing docker"
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$SANDBOX_USER"
systemctl enable --now docker

# -------------------------------------------------------------------- gh (CLI)
if ! command -v gh >/dev/null 2>&1; then
  log "installing gh"
  mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt-get update -qq
  apt-get install -y -qq gh
fi

# ------------------------------------------------------------------------ node
# nub augments the real Node rather than replacing it, so a system Node is the
# floor; nub then auto-provisions whatever a project pins in .node-version.
if ! command -v node >/dev/null 2>&1; then
  log "installing node (system floor)"
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
  apt-get install -y -qq nodejs
fi

# --------------------------------------------------------------- user toolchain
# These install per-user (~/.local, ~/.nub), so they must not run as root.
log "installing user toolchain for $SANDBOX_USER"
as_user 'command -v uv     >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh'
as_user 'command -v nub    >/dev/null || curl -fsSL https://nubjs.com/install.sh | bash'
as_user 'command -v herdr  >/dev/null || curl -fsSL https://herdr.dev/install.sh | sh'
as_user 'command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash'

log "base setup complete"
