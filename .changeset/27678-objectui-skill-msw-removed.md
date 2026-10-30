---
'@objectstack/skills': patch
'@object-ui/console': patch
---

docs(skills): the objectui data-integration guide stops teaching the MSW plugin removed in 12.0

Clause-②: no
Metadata-protocol: none

- **Before.** `skills/objectui/guides/data-integration.md` taught a frontend-first setup built on the MSW plugin package, removed in 12.0 (its last npm release is 11.0.0, so the install still succeeds and pulls an 11.x plugin into the current stack), and eval 2 of `evals/data-integration.json` rewarded that answer.
- **Now.** The section "Frontend-first development" names the two supported paths: a static scope with no backend, or the real server run locally with `os dev` behind a Vite `/api` proxy. It states that `os dev` persists to SQLite, that `--fresh` gives a throwaway database, and that the retired in-memory driver is refused. Eval 2 grades `os dev`, `proxy` and `objectstack.config`, and refuses the MSW setup. Net -35 lines in the guide.
- **Console.** `VITE_USE_MOCK_SERVER`, which no source reads, leaves `.env.development`, `.env.production` and the Vercel build command. The `mockServiceWorker.js` rewrite exclusion and the `vendor-msw` chunk row in `docs/deployment.md` go too. No runtime behaviour changes.
