---
'@objectstack/spec': patch
---

`packages/spec/src/api/odata.zod.ts` — the module docblock's `@example Programmatic Use` block is now type-checked by `check:skill-examples`: it carries an `os:check` marker and the `ODataQuery` import it needs to compile standalone (#19065).

Clause-②: no

That block ships twice — inside the tarball as `src/api/odata.zod.ts` (this package's `files[]` lists `src/**/*.zod.ts`; measured with `npm pack --dry-run`) and on the generated reference page `content/docs/references/api/odata.mdx` — and nothing compiled it. An example whose keys contradict the schema declared in the same file could therefore stay green indefinitely, which is the defect #19028 found and #19058 corrected in text only.

- **The reference page moves by exactly one line.** The marker is machinery and `build-docs.ts` drops it before rendering, so the only visible change on the page is the `import type { ODataQuery } from '@objectstack/spec/api';` line the block needs in order to stand alone.
- **No schema, no accept set and no behaviour moves.** `ODataQuerySchema` is byte-identical. Whether it should refuse undeclared keys instead of stripping them is a separate question about a published accept set and is deliberately untouched here.
- **The sibling `@example OData Query` block stays unmarked, and that is a measurement rather than an omission.** It is an HTTP request under a bare fence, not TypeScript, and the gate recognises only ts/tsx/typescript fences — a marker above it is reported as an orphan, so it would fail the gate rather than check the block.
