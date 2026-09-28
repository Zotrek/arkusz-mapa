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

## Cloudflare Pages (CI)

Workflow: `.github/workflows/arkusz-mapa-pages.yml` — tylko `workflow_dispatch` (mapa **bez** kopiowania do „odebrane z harmonogramu”).

Workflow: `.github/workflows/arkusz-mapa-pages-odebrane.yml` — mapa **+** kopiowanie kwalifikujących się plomb maszynowych z harmonogramem do zakładki `odebrane z harmonogramu` w arkuszu **ewidencja odbiorów** (`COPY_ODEBRANE_Z_HARMONOGRAMU=1`). Odczyt plomb: trasówki (`GOOGLE_SHEETS_ID`).

Ten sam przebieg potem uzupełnia zakładkę `Baza cen harmonogram` w ewidencji: adres sklepu, podwykonawca (firma transportowa) i dni odbiorów. Nowy sklep dostaje puste ceny. Istniejące ceny, nazwa trasy i data obowiązywania zostają.

Publikacja: **tylko Cloudflare Pages** (`wrangler pages deploy`). Workflow **nie** pushuje do gałęzi `gh-pages` i **nie** włącza GitHub Pages.

Sekrety repo: `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `CLOUDFLARE_*`. Opcjonalnie `GOOGLE_EWIDENCJA_ODBIOROW_SHEETS_ID` (domyślnie ID ewidencji/transportów w kodzie). Service Account musi mieć **edycję** ewidencji.

### Dispatch „Pages + odebrane” (cron-job.org)

Jak w sekcji 3, ale URL:

`https://api.github.com/repos/Zotrek/arkusz-mapa/actions/workflows/arkusz-mapa-pages-odebrane.yml/dispatches`

Body: `{"ref":"master"}` — te same nagłówki `Authorization` / `Accept`.

## Co usunęliśmy

Pliki ze `schedule` w repo (smoke, cron-trigger) — nie działały w tym projekcie.

Publikacja stubu na gałąź `gh-pages` (`peaceiris/actions-gh-pages`) — wyłączona, żeby Actions nie włączały / nie odświeżały GitHub Pages.

Jeśli kiedyś `schedule` zacznie działać (zmiana po stronie GitHub), można ponownie dodać `on.schedule` w workflow — wtedy wyłącz zewnętrzny cron, żeby nie dublować.
