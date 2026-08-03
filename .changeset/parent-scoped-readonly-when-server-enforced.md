---
"@objectstack/objectql": minor
"@objectstack/lint": minor
---

fix(objectql,lint): enforce parent-scoped `readonlyWhen` on the server (#4889)

`readonlyWhen: P\`parent.status == 'paid'\`` — the documented "once the header
invoice is Paid, its lines are frozen" lock — was enforced **only in the client
grid**. The server-side strip bound `record` and `previous` and had no `parent`
at all, so every parent-scoped predicate faulted, took the fail-open branch, and
the write landed anyway. On the reference app that meant one `PATCH` rewrote the
quantity and unit price of a settled invoice's line: HTTP 200, value persisted,
the grid still drawing the cell read-only. ADR-0057 D10 puts enforcement on the
server and makes the client courtesy; here only the courtesy layer enforced.

**`parent` is now bound on the write path.** For a detail object — one declaring
exactly one `master_detail` relationship — the engine resolves the master record
and binds it as `parent` before the strip runs, on both the single-id and the
bulk (`multi: true`) update paths. A repointing write is judged against the
master it *lands on*, not the one it leaves. The read is gated on the payload
actually touching a parent-scoped predicate (decided from the parsed CEL AST, so
a field named `parent_id` costs nothing), and the bulk path batch-reads the
distinct headers in one query rather than one per row.

**An unbindable scope no longer waives the lock.** A `readonlyWhen` that names a
root the operation could not bind now resolves to **locked** — the field is
stripped — instead of "not locked". "The platform could not check this" must not
mean "allowed" on a field the author declared frozen. This is deliberately the
narrowest possible carve-out from the fail-open policy the strip has always had:
a predicate that is merely *broken* on the record (undeclared key, `null`
ordering overload, parse error, engine throw) still fails open exactly as
before, and `requiredWhen` / option `visibleWhen` are untouched. Recorded as an
addendum to ADR-0058's D5 fail-policy matrix, alongside the same narrowing
already made for validation predicates (#4649) and hook conditions (#4775).

**And the runtime branch is a backstop, not the plan.** `objectstack compile`
now **rejects** a `parent`-scoped `readonlyWhen` on an object that declares no
`master_detail` relationship, or two of them (where the metadata does not say
which one is "the parent" and picking by declaration order would make a
data-integrity lock depend on field ordering). The common authoring mistake is
caught where it is cheap to fix, so it never reaches a runtime that has to judge
it — declared, not guessed.

No metadata changes are required: an app whose parent-scoped locks were already
correct simply starts having them enforced. If you authored one on an object
with no single master, the build now names it.
