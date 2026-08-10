---
"@objectstack/spec": minor
---

fix(spec): `FieldSchema.defaultValue` is discriminated (literal / runtime token / CEL envelope) and each shape is validated on its own terms (#7127)

`FieldSchema.defaultValue` was `z.unknown().optional()` — the same acceptance
hole #6970 closed one layer up on action params, but NARROWER: a field default
is polymorphic by design (a literal, a runtime token `NOW()` / `current_user`,
or a CEL Expression envelope `{ dialect, source }`), so the vocabulary has to
be subtracted BEFORE the literal can be judged. Running the value contract
over the whole key judges a token's spelling as data — right only by accident
(`'current_user'` passes a `user` field as a would-be record id; `'NOW()'`
passes `text` as a plain string while the engine intercepts it and stores an
ISO instant instead).

Per the maintainer's sequenced ruling (2026-08-10), this lands in two steps
inside one release:

1. a shared **discriminator** (`@objectstack/spec/data`,
   `default-value-shape.ts`): the engine's own envelope predicate verbatim,
   the token predicates, and the shared literal-vs-stored-contract core —
   one module, two consumers. The #6970 action-param gate is refactored onto
   the shared core with zero behavior change.
2. `FieldSchema.defaultValue` narrowed on top of it, in the engine's own
   discrimination order:
   - **absent** (`null`/`undefined`) → skipped; `''` is a real default
     (engine presence semantics, deliberately not the action-param rule);
   - **CEL envelope** → structural acceptance only (the result type is
     unknowable at parse time; a wrong one is an ADR-0032 runtime concern);
   - **runtime token** → per-token × per-type: `NOW()` on
     `datetime`/`date`/`time` (both resolvers and the docs already support
     all three); `current_user` on `user` or `lookup` with
     `reference: 'sys_user'` (#4560); no token on a multi-value field
     (both resolve to one scalar);
   - **literal** → the field's own stored value contract
     (ADR-0104 D1 `valueSchemaFor(def, 'stored')`) — the #6970 mechanics one
     layer down.

Rejections are prescriptive: they name the field, its type, the offending
value verbatim, why it cannot hold, and the legal alternatives — including a
suggested token for predictable near-miss spellings (`'now'`,
`'{current_user}'`), which are suggested but never silently widened into
tokens (a genuinely-intended literal must stay storable).

**Migration surface: zero.** All 371 shipped `defaultValue` declarations
across objectstack + cloud were re-censused against the implemented gate —
0 refusals (239 literals all pass their stored contracts; 131 × `NOW()` all
on `datetime`; 1 × `current_user` on `user`). The only declarations anywhere
that newly refuse are two hand-written docs samples that were already wrong
today (stored verbatim / dropped by the SQL DDL), fixed in this change.

**Stock compatibility.** As with #6970: stored metadata carrying a
nonconforming default keeps loading (the read path runs no Zod validation);
authoritative spec validation lives on the WRITE path and surfaces on reads
as the advisory `_diagnostics` envelope. Loud at authoring, non-fatal at
rest, no conversion owed — there is no mechanical rewrite for "the author
meant something else".

Also moved: `AddressSchema` is now declared in `field-value.zod.ts` (it IS
the enforced address value contract) and re-exported from `field.zod.ts`
unchanged — the move removes the one runtime ESM edge that would otherwise
have closed an evaluation cycle between the two modules.
