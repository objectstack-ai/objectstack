---
"@objectstack/spec": patch
---

docs(spec): stop recommending `contributes.routes` for code-handler endpoints — redirect the author-facing materials to the imperative `http.server` mount (#10726)

`contributes.routes` (`packages/spec/src/kernel/manifest.zod.ts`) has **zero readers**
monorepo-wide: the only non-test read of `manifest.contributes` anywhere reads `kinds`, not
`routes` (`packages/objectql/src/engine.ts:4499`). An author following the shipped guidance
writes a `contributes.routes` entry, gets a clean parse, and serves nothing — ADR-0049's
silent no-op with a published recommendation attached.

Per the maintainer ruling (2026-08-22, Option B), the four author-facing materials that
recommended the key are corrected **now**, ahead of and independent of the key's removal:

- `skills/objectstack-api/SKILL.md` — the `apis:` decision table's second row now names the
  imperative `http.server` mount and states explicitly that `contributes.routes` parses and
  serves nothing.
- `packages/spec/src/api/dispatcher.zod.ts` — the HttpDispatcher protocol doc no longer
  claims it "supports dynamic route registration from plugins via contributes.routes".
- `docs/adr/0088-metadata-kind-admission-and-retirement.md` — the `router` retirement row no
  longer credits `contributes.routes` as a delivered form. The `router` KIND's retirement is
  unaffected: its delivered forms are the imperative mount and, since #5040, declarative
  `apis:`.
- `packages/spec/src/ui/app.zod.ts` — the `App.apis` removal message no longer sends
  migrators to `contributes.routes`.

The replacement recommendation was verified live on `main` before it was written, so this is
not a redirect to a second dead form: `http.server` is registered by
`packages/plugins/plugin-hono-server/src/hono-plugin.ts:271` (`providesServices` at :228) and
mounted by real in-tree consumers — `examples/app-showcase/src/system/server/recalc-endpoint.ts`
resolves it on `kernel:ready` and mounts `POST /api/v1/showcase/recalc`, and
`plugin-approvals`, `plugin-sharing`, `cloud-connection` and the CLI's `serve` all resolve the
same service.

Schema-only change to prose: no key is added, removed or re-typed here. The
`contributes.routes` tombstone itself is #10724's, which is blocked on the `cloud` census
(#10812) — this changeset carries only the doc corrections the ruling ordered not to wait.
The two `content/docs/references/**` pages are the regenerated projection of the two `.zod.ts`
edits (`pnpm --filter @objectstack/spec gen:docs`), not hand edits.
