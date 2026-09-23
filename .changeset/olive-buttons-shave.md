---
'@objectstack/metadata-protocol': patch
---

`POST /api/v1/data/{object}/deleteMany` stops reporting a deletion it did not perform.

Each row of the batch answered `success: true` for every engine result that was not the
driver contract's `false`. The `false` arm — "no row matched" — has reported honestly since
#4435; the other ending had not: a row that MATCHED and was deliberately NOT removed was
counted in `succeeded` and reported as deleted, byte-identical to a real deletion.

`sys_permission_set` is the shipped case. Deleting a package-declared set is an ADR-0005
RESET: the overlay tombstones and the record re-projects to the declared body instead of
vanishing. That behaviour is unchanged and deliberate — what was wrong is the answer, and on
a security-configuration write it told an operator a permission set was gone while it was
still being enforced.

`IDataEngine.delete` declares `Promise<boolean | number>` — the driver boolean for a by-id
write, a count of rows removed otherwise — so a numeric zero is the one value that positively
means the record is still there. The per-row `success` now reads that count instead of being
a literal.

On the wire, for one row of a `deleteMany`:

- removed — `success: true`, counted in `succeeded` (unchanged);
- matched but not removed — `success: false`, counted in `failed`, and no `errors[]` entry:
  a surviving record is an outcome, not a fault, and this envelope's two per-row codes
  (`ROLLED_BACK`, `NOT_ATTEMPTED`) both describe a row that never ran;
- unknown id — `success: false` with `errors[0].code: RECORD_NOT_FOUND` (unchanged).

Because `succeeded` and `failed` partition `results`, a surviving row also makes the
request-level `success` false, and an `atomic` batch containing one now rolls back rather
than committing under a response that called every row deleted. A non-atomic batch is not
stopped by it: nothing was thrown, so the `continueOnError` stop does not apply and the
remaining ids are still attempted.

Clause-②: no
