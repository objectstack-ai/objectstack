---
"@objectstack/formula": minor
---

`ExprSchemaHint` gains `roots` — an authoring surface naming the binding roots it mounts beyond the platform baseline, so `validateExpression` can accept them without standing down on everything else (#18554).

A page component's `visibleWhen` binds three roots at runtime, and `ExprSchemaHint` could express neither of the two shapes it needs: `scope: 'record'` refused `page.selectedProjectId != ''` — the worked example `packages/spec/src/ui/page.zod.ts`'s own `visibleWhen` describe ends with, under a sentence naming the contract-bound roots as `record`, `current_user` and page state as `page.<var>` — and prescribed `record.page`, which names nothing on any layer; `scope: 'flattened'` accepted that example and accepted a bare `status == 'done'` with it, which is the shorthand the narrowing exists to catch. Downstream the refusal is not cosmetic: an editor that lints a page block on the `record` face disables Save for the author who wrote the platform's own documented spelling.

```ts
validateExpression('predicate', "page.selectedProjectId != ''", {
  scope: 'record',
  roots: ['page'],      // what this surface mounts beyond the baseline
});                     // -> ok; `status == 'done'` at the same site is still an error
```

- **It only ever adds.** A root listed in `roots` is declared alongside `SCOPE_ROOTS`, never instead of it, so passing the key can turn a refusal into an acceptance and never the reverse — a caller adopting it cannot silently lose a check it has today, and a call site that does not pass it gets the verdict and the prescription it got before, byte for byte.
- **Declaring a root is not becoming permissive.** The bare-field shorthand, an undeclared root, and a typo of a declared root are all still hard errors at a surface that declares `page`. Trading a false refusal for a silent acceptance is the worse of the two directions, so the surface says *which* roots it binds rather than asking the validator to stop checking.
- **A mistyped root is sent to the root, not to `record.<typo>`.** When a surface has declared its roots, a namespace reference within edit distance of one of them (`pge.selectedProjectId`) is named as an unbound root and pointed at `page`. Every other shape — a bare value reference, a known field used as a JSON namespace, any site with no declared roots — keeps the existing `record.<name>` prescription, which is the right fix for the case it was written for.
- **`introspectScope` advertises what the validator accepts.** Declared roots join the roots it hands an author, from the same declaration, so a root that is accepted is never one an author has no way to discover.
- **Not a closed-set mechanism.** A surface that must *refuse* a baseline root it never mounts still says so with `collectCelRootIdentifiers`, which reads the AST and is independent of this key. The two directions stay two mechanisms.

Clause-②: yes (widening)
