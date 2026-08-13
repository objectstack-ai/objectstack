---
'@objectstack/service-package': major
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
the wire.

Now: the driver's text goes to the log and nowhere else (it was already logged — nothing
an operator sees changes), and the caller gets a stable sentence that names what happened
without quoting the driver.

**Caller-facing 4xx messages are unchanged.** A missing manifest, an invalid manifest, and
any coded refusal thrown from below `publish` all keep their own status, code and
self-correcting message — a `409 DESTRUCTIVE_CHANGE` is still a 409.

**Breaking — `PackageService.publish` return shape.** A bare `error` string could not say
which side was at fault, so the door had one status for both and picked the wrong one. It
is replaced by a discriminated outcome:

```ts
// FROM
publish(...): Promise<{ success: boolean; error?: string }>
// TO
publish(...): Promise<{ success: boolean; driverFault?: { message: string } }>
```

**Fix:** read `result.driverFault?.message` where you read `result.error`. If you
implement `PackageService` yourself: report a broken write as
`{ success: false, driverFault: { message } }` with a message safe to show a caller, and
**throw** — rather than return — a refusal that carries its own `status`, so the door
answers it with that status and code.

<!-- adr-0087: not-required (no-migration-prescription) `PackageService` is a runtime TypeScript service interface, not authorable metadata — there is no stored shape, no spec key and nothing for `objectstack migrate meta` to rewrite. The FROM → TO above is a source-level change consumers apply by hand. -->
