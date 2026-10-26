---
'@objectstack/cli': patch
---

feat(cli): `objectstack build` lowers a hook handler that reads `ctx.provenance` instead of bundling it

Clause-②: no
Metadata-protocol: none

The sandboxed hook body now carries `ctx.provenance` (see the `@objectstack/runtime` entry), so the lowerer no longer refuses a handler that reads it. Such a handler ships as a metadata-only body, and `os lint` no longer reports `hook-body/bundled-fallback` for that read. The CLI's published type surface does not change: `dist/index.d.ts`, `dist/hook-body.d.ts` and `dist/console.d.ts` are byte-identical before and after. Nothing to migrate: a handler that read `ctx.provenance` was bundled before and runs in-process, where it behaves the same. Rebuilding turns it into a body.
