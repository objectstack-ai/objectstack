---
"@objectstack/objectql": minor
---

fix(objectql): widen `SchemaRegistry.registerObject`'s `packageId` to optional (#12623)

**Public-API accept-set widening**, ruled by the maintainer (issue #12623 comment
5434929046, Option A) — shipped as `minor`: it is not a bug fix in behavior (the
underlying runtime path already treated a missing `packageId` as `undefined`
wherever no `tsc` program enforced the parameter's arity; see below), but it does
change the method's declared TypeScript contract, so it gets a real bump rather
than riding along as an implicit patch.

`registerObject`'s second parameter, `packageId`, was `string` (required) while its
sibling `registerItem` already declared the identical parameter `packageId?: string`
(optional) — and both feed the same downstream call,
`applyProtection(item, { packageId })`, whose own comment documents the
package-less case as intended: *"bare `registerItem(type, item)` calls without a
package context still produce a clean item."* The mismatch made a supported shape
— `registry.registerObject(schema)` with no package context, used by 82
single-argument call sites across `objectql`, `rest`, `runtime` and `plugins` — a
type error everywhere a `tsc` program actually read the call (14 sites in
`packages/rest`'s test layer, ledgered as `TS2554` against issue #5286; the other
68 sites had no gate reading them, so the error was latent rather than caught).

**FROM → TO:**

```ts
// FROM
registerObject(schema: ServiceObject, packageId: string, namespace?: string, ...): string

// TO
registerObject(schema: ServiceObject, packageId?: string, namespace?: string, ...): string
```

No caller needs to change: every existing call already supplied `packageId` (or
relied on JS's lack of arity enforcement to omit it despite the stricter type), and
the runtime behavior for both cases is unchanged — `packageId?: string` carries
**no default value**. A bare call still passes `packageId: undefined` through to
`applyProtection`, which still leaves the registered item provenance-free (no
`_packageId`, no `_provenance`), exactly as it does today for every already-passing
call site. Pinned in
`packages/objectql/src/registry-register-object-optional-package-id.test.ts`,
which asserts on the registered item's key *absence* (not merely
`=== undefined`), paired with a positive control confirming a call that *does*
pass a `packageId` still gets provenance stamped.

The exported `ObjectContributor` interface's `packageId` field widens from
`string` to `string | undefined` to match — the exact value `registerObject`'s
own parameter is called with, and the mechanically necessary consequence of the
widening above (`ObjectContributor.packageId` is that value's only home).

<!-- adr-0087: not-required (no-migration-prescription) A pure accept-set widening — no key, export or shape is removed, renamed or narrowed, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. Every existing caller keeps compiling and behaving identically; the only new capability is that a previously-latent-error call shape now type-checks. -->
