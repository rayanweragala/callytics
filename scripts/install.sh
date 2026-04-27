#!/usr/bin/env bash
# CALLYTICS INSTALL SCRIPT
# Run this instead of 'docker compose up' to get the full setup experience.
# Usage: bash scripts/install.sh
# This script prompts for optional features (VPN) then starts the stack.

set -euo pipefail

enable_vpn=""

for arg in "$@"; do
  case "$arg" in
    --vpn)
      enable_vpn="yes"
      ;;
    --no-vpn)
      enable_vpn="no"
      ;;
    *)
      printf 'Unknown option: %s\n' "$arg" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$enable_vpn" ]]; then
  printf 'Enable built-in WireGuard VPN?\n'
  printf 'Allows remote softphones to connect without port forwarding.\n'
  printf 'Requires UDP port 51820 forwarded on your router.\n'
  printf '[y/N]: '
  read -r answer
  case "$answer" in
    y|Y|yes|YES)
      enable_vpn="yes"
      ;;
    *)
      enable_vpn="no"
      ;;
  esac
fi

if [[ "$enable_vpn" == "yes" ]]; then
  docker compose --profile vpn up -d
else
  docker compose up -d
fi
