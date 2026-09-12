#!/usr/bin/env bash
# Keep the GCE metadata server reachable while a Tailscale exit node is active.
#
# Tailscale installs `ip rule` priority 5270 sending ALL traffic to its own
# routing table, which sends 169.254.169.254 out through the exit node, where it
# is rejected ("open-conn-track: ... rejected due to acl"). That breaks
# guest-attribute status reporting and, worse, the metadata read in bootstrap.sh
# that every boot depends on to learn its template.
#
# A rule at a lower priority number wins, so metadata stays on the primary NIC
# while everything else still egresses via the exit node.
#
# Ordering is the subtle part: tailscaled CLEARS this rule when it starts, so
# adding it once before Tailscale is up does nothing. This re-adds on every
# iteration and only exits once metadata has been reachable several checks in a
# row, which rides out tailscaled reconfiguring the table underneath us.
set -uo pipefail

METADATA_IP=169.254.169.254
REQUIRED_STREAK=3
MAX_ATTEMPTS=45

ensure_rule() {
  ip rule show | grep -q "$METADATA_IP" && return 0
  ip rule add to "$METADATA_IP/32" priority 5000 lookup main 2>/dev/null || true
}

metadata_ok() {
  curl -fsS -m 3 -H "Metadata-Flavor: Google" \
    "http://$METADATA_IP/computeMetadata/v1/instance/name" >/dev/null 2>&1
}

streak=0
for _ in $(seq 1 "$MAX_ATTEMPTS"); do
  ensure_rule
  if metadata_ok; then
    streak=$((streak + 1))
    if [ "$streak" -ge "$REQUIRED_STREAK" ]; then
      echo "[metadata-route] metadata reachable and rule stable"
      exit 0
    fi
  else
    streak=0
  fi
  sleep 2
done

echo "[metadata-route] ERROR: metadata still unreachable after $MAX_ATTEMPTS attempts" >&2
ip rule show >&2
exit 1
