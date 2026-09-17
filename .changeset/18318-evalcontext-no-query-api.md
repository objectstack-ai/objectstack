---
'@objectstack/formula': minor
---

`EvalContext` no longer declares `api?: { exists, count, lookup }` — the kernel query API behind `os.exists` / `os.count` / `os.lookup`, which `buildScope()` never bound (#18318).

**BREAKING** for a TypeScript consumer: an `EvalContext` literal that carries `api` stops compiling. The level stays `minor` because the launch window refuses `major` outright — while it is open, breaking-ness is carried by this banner and by the ADR-0087 disposition at the foot of this changeset, not by the bump.

The member's docblock said it was "implemented opportunistically by call sites that have a query engine", and no call site ever could: `ctx.api` was read **zero** times in this package — control in the same sweep, `ctx.user`, three reads in `stdlib.ts` — so the three functions reached no evaluation scope however completely a caller populated the member. An author who wrote a predicate to the declaration got `runtime: found no matching overload for 'dyn.lookup(string, dyn)'` instead, and because an unevaluable predicate refuses the write it guards, a validation rule authored that way locked **every** write on its object. The harm came from the declaration existing, not from the implementation missing, so it is removed rather than implemented — with the reason written at the deletion site, and with no shim, alias or reserved spelling left behind.

**Migration — `api: { … }` → delete the property.** There is no replacement key and nothing to re-point: every implementation ever passed there was discarded before evaluation, so removing the property changes no result your predicates produce. TypeScript is where you will hear about it: an `EvalContext` literal carrying `api` now fails to compile, which is the whole of the break. Reading a related record's field from inside a predicate remains unexpressible in any spelling — that capability is tracked as its own card, relationship traversal (`record.crm_account.type`), and deliberately not as `os.lookup` queries; no schedule is implied by this removal.

<!-- adr-0087: not-required (runtime-interface-only packages/formula/src/types.ts#EvalContext) `EvalContext` is a published runtime TypeScript interface with no metadata surface — no Zod schema, no `packages/spec` declaration, no stored representation — so `objectstack migrate meta` has nothing to rewrite and the ledger has no channel to carry. The compiler at the consumer's own call site reaches every affected caller instead. Nothing is re-pointed either: `buildScope()` never read `ctx.api`, so the whole remedy is deleting a property that was already inert. -->

Clause-②: yes
