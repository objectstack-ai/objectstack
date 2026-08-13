---
'@objectstack/service-package': minor
'@objectstack/rest': patch
---

Package publish: a driver fault is answered as a server error, and its driver text no longer reaches the caller

`POST /api/v1/packages/publish` answered **`400 PACKAGE_PUBLISH_FAILED`** when the
`INSERT INTO sys_packages` statement itself failed, carrying the driver's own message as
the caller-facing text. Measured on a real SQLite engine, that was literally:

```
400 {"success":false,"error":{"code":"PACKAGE_PUBLISH_FAILED",
     "message":"no such table: sys_packages"}}
400 {"success":false,"error":{"code":"PACKAGE_PUBLISH_FAILED",
     "message":"NOT NULL constraint failed: sys_packages.tenant_ref"}}
```

Two defects in one line. The **status** was a client error for a fault the client had no
part in — the mirror of the mislabelling fixed for the throw path, and it hid a real
server fault from every dashboard that buckets by status. The **message** was raw driver
text: a constraint dump naming physical tables and columns.

Fixed at the producer, which is the only place that closes it. A 5xx message withhold
already exists at this door, but it is applied when an error is *thrown*, and this
failure was *returned* — so it never met the withhold at any status. The withhold is also
a phrasing heuristic, and `no such table: sys_packages` trips none of its keywords, so
reclassifying alone would have moved the driver line from a 400 to a 500 and left it on
the wire (measured, both).

Now the driver's text goes to the log and nowhere else — it was already logged, so nothing
an operator sees changes — and the caller gets a stable sentence that names what happened
without quoting the driver.

**Caller-facing 4xx messages are unchanged.** A missing manifest, an invalid manifest, and
any coded refusal thrown from below `publish` all keep their own status, code and
self-correcting message — a `409 DESTRUCTIVE_CHANGE` is still a 409.

**BREAKING — the `PackageService.publish` return shape.** A bare `error` string could not
say which side was at fault, so the door had one status for both and picked the wrong one.
`publish` now reports a broken write as `{ success: false, driverFault: { message } }`;
the `error` field is removed. If you only *call* `publish`, read
`result.driverFault?.message` where you read `result.error`. If you *implement*
`PackageService`, report a broken write through `driverFault` with a message safe to show
a caller, and **throw** — rather than return — a refusal that carries its own `status`, so
the door answers it with that status and code.

<!-- adr-0087: not-required (no-migration-prescription) This change retires no authorable key and adds none. `PackageService` is a runtime TypeScript service interface in `packages/services/service-package`; it has no Zod schema, no `packages/spec` declaration, no metadata type and no stored representation. `packages/spec` is untouched by this PR. Nothing exists for `objectstack migrate meta` to rewrite, because nothing an author writes and nothing persisted in `sys_metadata` or `sys_packages` changes shape — the wire envelope is unchanged too (still ADR-0112 `{ success, error: { code, message } }`), and only the STATUS a driver fault selects and the TEXT the producer puts in it move. Nor is there a FROM/TO rule a ledger entry could state: the ledger's subject is metadata, and the only readers affected here are TypeScript callers of one in-process service — measured as three in-repo consumers (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/cli`), of which exactly one, `packages/rest/src/package-routes.ts`, reads the changed field. The channel that reaches an affected reader is strictly more precise than any ledger line: the compiler itself. Reading the removed field is a hard type error at the call site — verified by reinstating it, which fails as `error TS2339: Property 'error' does not exist on type 'PackagePublishResult'` — so no consumer can carry this change silently, and this changeset's CHANGELOG text carries the one-line repair for the reader who hits it. -->
