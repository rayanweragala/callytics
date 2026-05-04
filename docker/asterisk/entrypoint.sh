#!/usr/bin/env bash
set -euo pipefail

SIDECAR_PID=""
ASTERISK_PID=""

if [ "${TSHARK_ENABLED:-false}" = "true" ]; then
  node /usr/local/bin/capture-sidecar.js &
  SIDECAR_PID=$!
  echo "[asterisk-entrypoint] capture sidecar started (pid=${SIDECAR_PID})"
else
  echo "[asterisk-entrypoint] capture sidecar disabled (TSHARK_ENABLED=${TSHARK_ENABLED:-unset})"
fi

cleanup() {
  if [ -n "${SIDECAR_PID}" ]; then
    kill -TERM "${SIDECAR_PID}" 2>/dev/null || true
    wait "${SIDECAR_PID}" 2>/dev/null || true
    SIDECAR_PID=""
  fi

  if [ -n "${ASTERISK_PID}" ]; then
    kill -TERM "${ASTERISK_PID}" 2>/dev/null || true
    wait "${ASTERISK_PID}" 2>/dev/null || true
    ASTERISK_PID=""
  fi
}

trap cleanup SIGINT SIGTERM

asterisk -f -C /etc/asterisk/asterisk.conf &
ASTERISK_PID=$!

wait "${ASTERISK_PID}"
exit_code=$?

cleanup
exit "${exit_code}"
