#!/usr/bin/env bash
# Anuluje zaległe deploymenty środowiska github-pages (in_progress/queued),
# żeby nowy actions/deploy-pages nie dostał 400 "in progress deployment".
# Nie tworzy własnego SHA i nie woła API publikacji.
set -euo pipefail

: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_TOKEN:?}"

api() {
  local method="$1" path="$2"
  shift 2
  curl -sS -X "$method" \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -w "\nHTTP %{http_code}\n" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}${path}" \
    "$@"
}

echo "Aktywne deploymenty github-pages:"
DEPS="$(curl -sS \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${GITHUB_REPOSITORY}/deployments?environment=github-pages&per_page=15")"

echo "$DEPS" | jq -r '.[] | "\(.id) sha=\(.sha[0:12]) created=\(.created_at)"'

echo "$DEPS" | jq -r '.[].sha' | awk 'NF && !seen[$0]++' | while read -r sha; do
  echo "Cancel Pages deployment ${sha} (jeśli istnieje / w toku):"
  api POST "/pages/deployments/${sha}/cancel" || true
done

echo "Czekam 20s, aż GitHub zwolni kolejkę Pages..."
sleep 20
