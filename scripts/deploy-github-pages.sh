#!/usr/bin/env bash
# Publikacja GitHub Pages z unikalnym pages_build_version.
# actions/deploy-pages zawsze bierze GITHUB_SHA (runner nie pozwala go nadpisać),
# a POST .../cancel na to samo SHA kasuje właśnie tworzony deployment.
set -euo pipefail

need() {
  if [[ -z "${!1:-}" ]]; then
    echo "::error::Brak zmiennej $1" >&2
    exit 1
  fi
}

need GITHUB_OUTPUT
need GITHUB_RUN_ID
need GITHUB_SHA
need GITHUB_REPOSITORY
need GITHUB_TOKEN
need ACTIONS_ID_TOKEN_REQUEST_URL
need ACTIONS_ID_TOKEN_REQUEST_TOKEN

api() {
  local method="$1" path="$2"
  shift 2
  curl -fsSL -X "$method" \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}${path}" \
    "$@"
}

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
echo "Unikalny pages_build_version=${UNIQUE} (SHA commita workflow=${GITHUB_SHA})"

ARTIFACT_ID="$(
  api GET "/actions/runs/${GITHUB_RUN_ID}/artifacts?per_page=100" \
    | jq -r '[.artifacts[] | select(.name=="github-pages" and .expired==false)] | if length==1 then .[0].id else empty end'
)"
if [[ -z "${ARTIFACT_ID}" ]]; then
  echo "::error::Nie znaleziono dokładnie jednego artefaktu github-pages w tym runie." >&2
  exit 1
fi
echo "artifact_id=${ARTIFACT_ID}"

ID_TOKEN_URL="${ACTIONS_ID_TOKEN_REQUEST_URL}"
case "${ID_TOKEN_URL}" in
  *audience=*) ;;
  *) ID_TOKEN_URL="${ID_TOKEN_URL}&audience=https://github.com" ;;
esac
OIDC="$(curl -fsSL -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" "${ID_TOKEN_URL}" | jq -r '.value // empty')"
if [[ -z "${OIDC}" ]]; then
  echo "::error::Brak tokenu OIDC. Job deploy musi mieć permissions id-token: write." >&2
  exit 1
fi

PAYLOAD="$(jq -n --argjson artifact_id "${ARTIFACT_ID}" --arg sha "${UNIQUE}" --arg oidc "${OIDC}" \
  '{artifact_id:$artifact_id, pages_build_version:$sha, oidc_token:$oidc}')"
echo "Creating Pages deployment with payload:"
jq '{artifact_id, pages_build_version, oidc_token:"***"}' <<<"${PAYLOAD}"

RESP="$(api POST "/pages/deployments" -H "Content-Type: application/json" -d "${PAYLOAD}")"
PAGE_URL="$(jq -r '.page_url // empty' <<<"${RESP}")"
if [[ -z "${PAGE_URL}" ]]; then
  PAGE_URL="https://${GITHUB_REPOSITORY_OWNER}.github.io/${GITHUB_REPOSITORY#*/}/"
fi
echo "page_url=${PAGE_URL}" >> "${GITHUB_OUTPUT}"
echo "Created deployment ID ${UNIQUE}, page_url=${PAGE_URL}"

TIMEOUT_SEC=600
INTERVAL_SEC=5
START_TS="$(date +%s)"
ERROR_COUNT=0
MAX_ERRORS=10

while true; do
  sleep "${INTERVAL_SEC}"
  echo "Getting Pages deployment status..."
  if ! STATUS_JSON="$(api GET "/pages/deployments/${UNIQUE}" 2>/dev/null)"; then
    ERROR_COUNT=$((ERROR_COUNT + 1))
    echo "Nie udało się pobrać statusu (${ERROR_COUNT}/${MAX_ERRORS})"
    if (( ERROR_COUNT >= MAX_ERRORS )); then
      echo "::error::Zbyt wiele błędów statusu Pages." >&2
      api POST "/pages/deployments/${UNIQUE}/cancel" >/dev/null 2>&1 || true
      exit 1
    fi
    continue
  fi
  ERROR_COUNT=0
  STATUS="$(jq -r '.status // "unknown"' <<<"${STATUS_JSON}")"
  echo "Current status: ${STATUS}"
  case "${STATUS}" in
    succeed)
      echo "Reported success!"
      exit 0
      ;;
    deployment_failed|deployment_content_failed|deployment_cancelled|deployment_lost)
      echo "::error::Publikacja Pages: ${STATUS}" >&2
      exit 1
      ;;
  esac
  NOW_TS="$(date +%s)"
  if (( NOW_TS - START_TS >= TIMEOUT_SEC )); then
    echo "::error::Timeout publikacji Pages (${TIMEOUT_SEC}s)." >&2
    api POST "/pages/deployments/${UNIQUE}/cancel" >/dev/null 2>&1 || true
    exit 1
  fi
done
