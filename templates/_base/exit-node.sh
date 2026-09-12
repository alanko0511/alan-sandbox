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

# Turning on the exit node is what breaks metadata, so check it here rather than
# discovering later that status reporting has been silently failing.
if curl -fsS -m 5 -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/name" >/dev/null 2>&1; then
  echo "[exit-node] metadata server still reachable"
else
  echo "[exit-node] ERROR: metadata server unreachable with the exit node on." >&2
  echo "[exit-node] sandbox-metadata-route should have added an ip rule; check 'ip rule show'." >&2
  exit 1
fi
