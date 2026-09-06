---
"@objectstack/client": patch
---

The README's namespace tour documents the `ai` surface that exists, not the three methods v17 removed.

`client.ai.nlq` / `.suggest` / `.insights` were deleted in 17.0.0 (#3718) — and no server in any repo ever mounted `/api/v1/ai/{nlq,suggest,insights}`, so they 404ed for the whole life of the namespace. The README's "AI Services" example still showed all three. Because `files` ships `README.md` inside the tarball, that example is the package's npm front page: a TypeScript reader copying it gets TS2339 on three properties that are not on `client.ai`, and a JavaScript reader gets a runtime `TypeError`.

The block now shows the surface the client really exposes — `ai.chat` (with a read of `answer.content` / `answer.usage`), `ai.complete`, `ai.models`, `ai.conversations.list`, `ai.agents.chat`, `ai.pendingActions.list` — every call type-checked against the package's own published `dist/index.d.ts`. It also names the condition a reader will otherwise hit unexplained: the AI routes are served by `service-ai` (a Cloud/EE package), and an environment without it answers 501 rather than 404, with the remedy discovery reports under `services.ai`.

No behaviour changes. `patch` rather than no changeset because the README is a published file of this package, so correcting it changes what `@objectstack/client` ships; the docs site's Client SDK page already carried this correction and is untouched here.
