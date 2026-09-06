---
"@objectstack/rest": patch
---

The REST data doors' protocol requests are compiled against the declared contract again, so a field added to a data request schema reddens the build instead of going silently unsent.

No runtime behaviour changes — every door assembles and forwards exactly the object it did before. What changes is what the compiler is allowed to see. `packages/rest/src/rest-server.ts` dispatched to the protocol through two erasing forms: `p.deleteData({ … } as any)` on the argument, and the stronger `(p as any).updateData({ … })` on the protocol object itself, which erases the check on *every* member — a misspelled method name would not have errored. Across the file that was 22 dispatch sites spanning `findData` / `getData` / `createData` / `updateData` / `deleteData`, their `*Many` and batch siblings, and `getUiView`.

The casts were load-bearing rather than lazy: these call sites pass `environmentId` and `context`, and neither is a member of any data request schema. Neither should become one. `environmentId` is the transport routing key that selects the kernel *before* the protocol call and is already ruled out of the request shape; `context` is the server-derived execution context, and a caller-supplied `context` is a privilege escalation the ingress deletes unconditionally — putting it in the published request schema would re-open that door. Both are now declared on a typed envelope alongside the request type, so they stay server-side *and* compiled, and every other member of every literal is checked against the spec.

One slot stays deliberately untyped and is now named rather than diffuse: `findData`'s `query` accepts both the declared AST and an undeclared wire dialect (`$top`, `$orderby`, `filters`, …) that the protocol normalizer folds. Three server-built literals speak that dialect; the erasure there is confined to the query slot alone, and the declared-versus-shipped mismatch is filed as its own question.
