---
"@objectstack/service-package": patch
"@objectstack/rest": patch
---

fix(rest): `DELETE /api/v1/packages/:id` answers a driver fault as a 5xx, and stops swallowing coded refusals (#8275)

`packageService.delete` swallowed every throw and reported failure by returning
a bare `{ success: false }`, so the door answered
`400 PACKAGE_DELETE_FAILED`. The statement behind it is
`DELETE FROM sys_packages WHERE id = ? [AND version = ?]`, so a missing table, a
lock timeout or a foreign-key restriction — a **server** fault — was answered as
a client error: it invited the caller to fix a request that was never the
problem, and it hid a real fault from every dashboard that buckets by status.

This is the sibling of what #8016 fixed on the throw path and #8131 fixed for
`publish`. `service-package` had been left **partially converted** by #8131 —
the same service answering two different classifications for the same kind of
fault — and this closes that.

**Two changes, both small:**

- `delete`'s catch re-throws a throw that **declares its own status**, so a
  coded refusal reachable from this call path keeps the producer's status and
  code through the door's #8016 mapping (a `409 DESTRUCTIVE_CHANGE` stays a
  409) instead of being flattened into one 400. It reuses the existing
  `declaresHttpAnswer` predicate rather than declaring a second one.
- an undeclared throw stays a returned failure, and the door answers it **500**.

⛔ The discriminant is the **status** channel, never `.code`. Every SQL driver
populates a string `code` on its errors (`ERR_SQLITE_ERROR`, `SQLITE_ERROR`, the
SQLSTATE `42P01`, `ER_NO_SUCH_TABLE`), so a `.code`-reading predicate re-throws
genuine driver faults as if they were refusals — resolving them to a `500
INTERNAL_ERROR` that carries the driver's own message. Pinned per dialect in
`delete-driver-fault.test.ts`, on this seam rather than inherited from
`publish`'s suite by analogy.

**4xx is not swept**, which is the other half of the fix: the
repeated-`?version=` refusal is checked before `delete` is called at all,
`PACKAGE_DELETE_PARTIAL` keeps its 400 (per-item uninstall failures are a
different outcome), a declared 4xx thrown from below keeps its own status and
code, and a declared 5xx keeps its own too.

**No message changed, and that is deliberate.** Unlike `publish`, this path
never disclosed anything: the door builds its sentence from the request's own
`:id` and `?version=`, and the producer returns a bare flag with **no message
channel at all**. Mirroring `publish`'s `driverFault` message here for symmetry
would have *created* a channel to the wire that nothing filters — the 5xx
withhold (#8086) lives in `sendThrownError`, which a returned failure never
reaches at any status. The new suites pin that absence from both sides: the
producer's returned shape has exactly one key, and the door answers its own
sentence even when handed a producer that grows a message.

Verified against a real `node:sqlite` database running the real statements from
`index.ts` — including a genuine foreign-key restriction, the fault family only
`DELETE` can have.
