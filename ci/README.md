# CI workflow — read before enabling

`e2e.yml` in this directory is a complete, working GitHub Actions workflow. It
is **not** at `.github/workflows/e2e.yml`, so GitHub does not currently run it.

## Why it is here

The token used to push this repository is a GitHub App installation token that
lacks the `workflows` permission. GitHub rejects any push that creates or
updates a file under `.github/workflows/` with such a token:

```
! [remote rejected] (refusing to allow a GitHub App to create or update
  workflow `.github/workflows/e2e.yml` without `workflows` permission)
```

The file is therefore staged one directory away, where it can be committed
without that permission.

## To enable it

Move it into place and push with credentials that have the `workflows` scope —
a personal access token with `repo`, or a GitHub App installation granted
`workflows: write`:

```bash
mkdir -p .github/workflows
git mv ci/e2e.yml .github/workflows/e2e.yml
git commit -m "Enable the Playwright e2e workflow"
git push
```

Nothing else needs to change: the workflow's paths already assume it runs from
the repository root.

## What it does

1. Installs Python and the package with `.[api,dev]` (the FastAPI evidence API
   serves the run artifacts the UI reads).
2. Installs `web/` dependencies and the Playwright chromium browser.
3. Fetches the real OpenNeuro ds004856 metadata. This step failing is a hard
   failure by design — the suite refuses to run against generated data.
4. Runs `npm run test:e2e:ci` from `web/`.
5. Uploads the HTML report always, and traces plus screenshots on failure.

## Running it locally

```bash
cd web
npm install
npx playwright install --with-deps chromium   # once per machine
npm run test:e2e                              # runs the suite
npm run test:e2e:report                       # open the last HTML report
```

`npm run test:e2e` starts both the API and the Next.js app itself via
Playwright's `webServer`, and seeds a run first, so no manual setup is needed
beyond installing the browser.
