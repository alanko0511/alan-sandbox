#!/usr/bin/env bash
# Route the VM's outbound traffic through the home NAS.
#
# Run LAST, after all package installation: with the exit node active, every
# apt/npm/docker download would otherwise hairpin through Ottawa.
set -euo pipefail

EXIT_NODE="${SANDBOX_EXIT_NODE:-ko-nas}"

echo "[exit-node] routing egress via $EXIT_NODE"
tailscale set \
  --exit-node="$EXIT_NODE" \
  --exit-node-allow-lan-access=true

# Prove it actually took effect rather than silently no-op'ing, since a typo in
# the node name is otherwise invisible until something mysteriously can't reach
# the home LAN.
sleep 3
if tailscale status --json | jq -e '.ExitNodeStatus.Online == true' >/dev/null 2>&1; then
  echo "[exit-node] active"
else
  echo "[exit-node] WARNING: exit node not reporting online; check '$EXIT_NODE' is advertising and approved" >&2
fi
