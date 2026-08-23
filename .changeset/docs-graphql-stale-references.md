---
"@objectstack/spec": patch
---

**Docs:** removes stale GraphQL references and stale hand-typed header provenance from generated and hand-kept protocol docs (#10834, #10833).

GraphQL was retired as a product surface some time ago: `packages/spec/src/api/` has zero GraphQL sources, the `/graphql` HTTP route was removed from the dispatcher (out of the product plan, #2462 follow-on), and `graphql` was never actually a `CoreServiceName` — it only ever existed as a stray entry in this table and in metadata-protocol's discovery table (see the comment above `SERVICE_PROVIDER_TABLE` in `core-services.zod.ts`). Two places in the package still asserted otherwise:

- The generated `content/docs/references/index.mdx` API Protocol blurb read "REST/GraphQL contracts, …". The source is `CATEGORY_BLURBS.api` in `packages/spec/scripts/build-docs.ts`; fixed there and regenerated with `gen:docs` — no hand-edit to the generated `.mdx`.
- The hand-kept `packages/spec/llms.txt` (no generator; ships in the npm tarball per `files`) listed an `IGraphQLService` contract (execute, subscribe) under Service Contracts. `IGraphQLService` is declared nowhere in `packages/**/src` — verified before removal. Deleted the row rather than marking it `**DEPRECATED**` like the neighbouring `IUIService` row: that precedent fits a contract that has a replacement to point readers at; GraphQL has none — it's out of the product plan, not superseded by another contract — so a deprecation note would invent a migration path that doesn't exist.

Also dropped this file's hand-typed `Schema Count` / `Last Updated` header lines (`171 Zod schemas, 191 test files, 5,157 tests`, `2026-02-12`) rather than refreshing them. Measured against the current tree: `packages/spec` now publishes 1,585 schemas (per the freshly generated `content/docs/references/index.mdx` root index) across 418 `*.test.ts` files — both roughly an order of magnitude past what the header claimed. Since this file has no generator (confirmed by the filer) and nothing re-verifies these numbers on change, a refreshed count would start drifting again on the very next PR that touches the package; removing the assertion is more honest than restating a number this file has no mechanism to keep true. Whether `llms.txt` should be generated at all is a larger follow-up left to the PM, not decided here.

Graded rather than skipped: `llms.txt` ships in the `@objectstack/spec` npm tarball (`files`, enforced by `check:published-files`), so this prose change reaches consumers the same way the precedent in #10669 (`skill.tools` docblock) did.
