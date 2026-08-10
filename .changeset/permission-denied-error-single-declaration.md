---
"@objectstack/runtime": patch
---

refactor(runtime): `PermissionDeniedError` has ONE declaration again (#7270)

`security/resolve-execution-context.ts` re-declared `PermissionDeniedError` and
`isPermissionDeniedError` character-for-character from
`@objectstack/plugin-security`'s `errors.ts`, with a doc comment asking the next
editor to keep them "structurally identical" and **nothing enforcing it**:

```ts
// runtime/src/security/resolve-execution-context.ts   ← the copy
export class PermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';
  readonly statusCode = 403;
  …
```

Two hand-maintained declarations of an ADR-0112 denial envelope, where both
fields are load-bearing. `statusCode` is what the dispatcher answers with, and
`code` is what a matcher keys on — edit one copy's `403` and every test in the
repo still passes while one dispatch path starts answering a denial with the
wrong status. A comment is not a constraint.

`@objectstack/plugin-security` is the package that *throws* these (23 call sites
across `security-plugin.ts`, `delegated-admin-gate.ts`, `predicate-guard.ts`,
`system-write-guard.ts`, `suggested-audience-bindings.ts`); the runtime only ever
*catches* them. So the plugin owns the declaration and the runtime module now
re-exports it. `@objectstack/plugin-security` was already a plain `dependencies`
entry of `@objectstack/runtime`, so this adds no dependency — and `tsup`
externalizes workspace dependencies, so the built bundle gained an
`import "@objectstack/plugin-security"` and lost the duplicated class (ESM
428.21 KB → 428.02 KB).

The symbols stay exported from `security/resolve-execution-context.ts` rather
than being deleted outright, because `http-dispatcher.ts` imports
`isPermissionDeniedError` from that module path. Nothing outside the package is
affected either way: `runtime/src/security/index.ts` never re-exported either
symbol, so neither was reachable from `@objectstack/runtime`'s public barrel.

The matcher itself is unchanged and stays **duck-typed** (`name` / `code` /
message-prefix, never `instanceof`), which is what makes the re-export safe: dual
CJS/ESM output and bundling can still hand the two sides distinct class objects,
and a denial crossing that boundary is recognized regardless. A new
`security/permission-denied-error-parity.test.ts` pins both halves — that the two
import paths reach the same declaration (the assertion that fails against the old
copy), and that an instance built from a *deliberately foreign* class of the same
shape is still matched, so the duck-typed property is held independently of
whether the two ever collapse to one class object.

No behaviour change: `name`, `code: 'PERMISSION_DENIED'` and `statusCode: 403`
are byte-identical to what the runtime copy produced.
