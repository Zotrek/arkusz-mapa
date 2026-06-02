#!/usr/bin/env bash
# Uruchamia workflow „arkusz-mapa — Pages” (to samo co Run workflow w Actions).
# Użyj z zewnętrznego crona (cron-job.org, systemowy cron, itd.) — GitHub on.schedule
# w tym repozytorium nie odpala się; patrz docs/harmonogram-github-actions.md
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-Zotrek/arkusz-mapa}"
WORKFLOW_FILE="${WORKFLOW_FILE:-arkusz-mapa-pages.yml}"
REF="${GIT_REF:-master}"
TOKEN="${GH_PAT:-${GITHUB_TOKEN:-}}"

if [[ -z "${TOKEN}" ]]; then
  echo "Ustaw GH_PAT (PAT classic: scope repo) lub GITHUB_TOKEN." >&2
  exit 1
fi

curl -fsSL -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches" \
  -d "{\"ref\":\"${REF}\"}"

echo "OK: workflow_dispatch wysłany (${REPO}/${WORKFLOW_FILE} @ ${REF})"
