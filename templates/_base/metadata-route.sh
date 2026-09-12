#!/usr/bin/env bash
# Keep the GCE metadata server reachable while a Tailscale exit node is active.
#
# Tailscale installs `ip rule` priority 5270 sending ALL traffic to its own
# routing table, which sends 169.254.169.254 out through the exit node, where
# it is rejected ("open-conn-track: ... rejected due to acl"). That silently
# breaks guest-attribute status reporting and, worse, the metadata read in
# bootstrap.sh that every boot depends on to learn its template.
#
# A rule at a lower priority number wins, so metadata stays on the primary NIC
# while everything else still egresses via the exit node.
set -euo pipefail

ip rule del to 169.254.169.254/32 lookup main 2>/dev/null || true
ip rule add to 169.254.169.254/32 priority 5000 lookup main
