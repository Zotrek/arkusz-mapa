# Harmonogram generowania mapy (GitHub Actions)

## Problem

W repozytorium `Zotrek/arkusz-mapa` **natywny `on.schedule` w GitHub Actions nie uruchamia workflow** (0 runów z eventem `schedule`, mimo poprawnego YAML na `master`). Ręczne **Run workflow** działa.

Przyczyna po stronie GitHub (limitacja / polityka konta / brak rejestracji crona) — **nie da się naprawić samym plikiem workflow** w repo.

## Rozwiązanie: zewnętrzny cron → `workflow_dispatch`

Ten sam pipeline co ręcznie, wywołany przez API.

### 1. Token (PAT)

1. GitHub → **Settings** (profil) → **Developer settings** → **Personal access tokens**.
2. **Fine-grained** lub **classic** z uprawnieniem do repo `arkusz-mapa`:
   - classic: scope **`repo`**
   - fine-grained: **Actions: Read and write** (repozytorium `arkusz-mapa`).
3. Zapisz token — użyj go jako `GH_PAT` (nie commituj).

### 2. Skrypt lokalny / na serwerze

```bash
export GH_PAT="ghp_..."
./scripts/trigger-pages-workflow.sh
```

### 3. cron-job.org (bez własnego serwera)

Dla każdej godziny (np. **9:30** i **14:00**, strefa **Europe/Warsaw**):

| Pole | Wartość |
|------|---------|
| URL | `https://api.github.com/repos/Zotrek/arkusz-mapa/actions/workflows/arkusz-mapa-pages.yml/dispatches` |
| Method | **POST** |
| Header | `Accept: application/vnd.github+json` |
| Header | `Authorization: Bearer <TWÓJ_PAT>` |
| Header | `X-GitHub-Api-Version: 2022-11-28` |
| Body (JSON) | `{"ref":"master"}` |

### 4. Weryfikacja

Po wywołaniu: **Actions** → **arkusz-mapa — Pages** → nowy run **„Manually run”** / workflow_dispatch (wywołany przez API wygląda podobnie).

## GitHub Pages (CI)

Workflow: `.github/workflows/arkusz-mapa-pages.yml` — tylko `workflow_dispatch`.

Sekrety repo: `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` (jak dotąd).

## Co usunęliśmy

Pliki ze `schedule` w repo (smoke, cron-trigger) — nie działały w tym projekcie.

Jeśli kiedyś `schedule` zacznie działać (zmiana po stronie GitHub), można ponownie dodać `on.schedule` w workflow — wtedy wyłącz zewnętrzny cron, żeby nie dublować.

## Jeśli mapa się nie aktualizuje po uruchomieniu

**Objaw:** workflow „arkusz-mapa — Pages” kończy się zielono (build + deploy = sukces), ale na `https://zotrek.github.io/arkusz-mapa/` widać starą mapę / stary plik `mapa_*.html` daje 404.

**Przyczyna:** znany, otwarty bug GitHuba ([actions/deploy-pages#383](https://github.com/actions/deploy-pages/issues/383)). Akcja `deploy-pages` identyfikuje deployment przez SHA ostatniego commita. Ten workflow odpalany jest tylko przez `workflow_dispatch` — jeśli między uruchomieniami nie było nowego commita, kilka runów pod rząd ma identyczny SHA i GitHub czasem po cichu „gubi” nowy deployment (status API i logi mówią „sukces”, ale treść na żywo się nie zmienia). Zwykłe ponowne kliknięcie „Run workflow” **bez nowego commita** bywa niewystarczające.

**Jak naprawić:**

1. Zrób jakikolwiek nowy commit w repo (np. drobna, nieszkodliwa zmiana — nawet w komentarzu w pliku poza `src/`, `scripts/`, żeby nie odpalać dodatkowo `arkusz-mapa-ci.yml`).
2. Uruchom workflow ręcznie (Actions → „arkusz-mapa — Pages” → Run workflow).
3. Poczekaj ~1–2 min po zakończeniu joba `deploy` i sprawdź stronę w oknie incognito (żeby wykluczyć cache przeglądarki).

Więcej szczegółów i historia diagnozy: `dev_docs/lessons_learned.md` (Issue #1).
