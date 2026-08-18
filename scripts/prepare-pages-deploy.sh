#!/usr/bin/env bash
# Unikalny SHA dla actions/deploy-pages (bug #383: pages_build_version = GITHUB_SHA).
# Nie rusza gałęzi master — nowy commit (ten sam tree) ląduje w refs/pages-builds/.
set -euo pipefail

if [[ -z "${GITHUB_OUTPUT:-}" || -z "${GITHUB_RUN_ID:-}" || -z "${GITHUB_SHA:-}" ]]; then
  echo "Ten skrypt jest do GitHub Actions (GITHUB_OUTPUT / GITHUB_RUN_ID / GITHUB_SHA)." >&2
  exit 1
fi

export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-github-actions[bot]}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-${GIT_AUTHOR_NAME}}"
export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-${GIT_AUTHOR_EMAIL}}"

UNIQUE="$(git commit-tree "HEAD^{tree}" -p HEAD -m "pages deploy ${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}")"
REF="refs/pages-builds/${GITHUB_RUN_ID}"

if ! git push origin "${UNIQUE}:${REF}"; then
  echo "Custom ref niedozwolony — fallback na tag pages-deploy/${GITHUB_RUN_ID}"
  git tag "pages-deploy/${GITHUB_RUN_ID}" "${UNIQUE}"
  git push origin "pages-deploy/${GITHUB_RUN_ID}"
fi

echo "sha=${UNIQUE}" >> "${GITHUB_OUTPUT}"
echo "Unikalny pages_build_version=${UNIQUE}"

# Zaległy deployment o ID = SHA commita blokuje kolejkę Pages (deployment_queued).
if command -v gh >/dev/null 2>&1 && [[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
  export GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN}}"
  for id in "${GITHUB_SHA}" "${UNIQUE}"; do
    gh api --method POST "repos/${GITHUB_REPOSITORY}/pages/deployments/${id}/cancel" >/dev/null 2>&1 || true
  done
  sleep 3
fi
