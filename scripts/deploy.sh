#!/usr/bin/env bash
# Workstation deploy helper. CI handles main-branch deploys; this is
# for one-offs. Firmware needs the board on USB.
#
# Usage:
#   ./scripts/deploy.sh --backend
#   ./scripts/deploy.sh --webapp
#   ./scripts/deploy.sh --firmware
#   ./scripts/deploy.sh --all        # backend + webapp (not firmware)
set -euo pipefail
cd "$(dirname "$0")/.."

do_backend=0; do_webapp=0; do_firmware=0
[[ $# -eq 0 ]] && { echo "usage: $0 [--backend] [--webapp] [--firmware] [--all]"; exit 1; }
for arg in "$@"; do
  case "$arg" in
    --backend)  do_backend=1 ;;
    --webapp)   do_webapp=1 ;;
    --firmware) do_firmware=1 ;;
    --all)      do_backend=1; do_webapp=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if [[ $do_backend -eq 1 ]]; then
  echo "── backend ──"
  pnpm --filter feedme2-backend db:migrate:remote
  pnpm --filter feedme2-backend deploy
fi
if [[ $do_webapp -eq 1 ]]; then
  echo "── webapp ──"
  pnpm --filter feedme2-webapp build
  pnpm --filter feedme2-webapp deploy
fi
if [[ $do_firmware -eq 1 ]]; then
  echo "── firmware (USB) ──"
  (cd firmware && pio run -e crowpanel -t upload)
fi
