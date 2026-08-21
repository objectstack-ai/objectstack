---
"@objectstack/cli": patch
---

`os migrate duplicates` no longer reports a clean bill of health over a driver it
could not query (#10677). The `no_sql_seam` refusal #8928 mandated was dead code
for the memory driver, so the exact outcome the ruling exists to forbid was
reachable:

```
os migrate duplicates --database-url memory://qa
  -> exit 0   {"duplicates":[],"skipped":[],"counters":{"status":"read"}}
```

`InMemoryDriver.execute()` logs `Raw execution not supported in InMemory driver`
and returns `null` — it neither throws nor is absent. The seam resolver asks
whether the driver has the SHAPE of a seam (`typeof d.execute === 'function'`),
which that satisfies, so the `if (!exec)` guard never fired; and
`normalizeRows(null)` is `[]`, which is also what a real driver returns for a
SELECT that matched nothing. Three statements were swallowed and the report said
the install was clean.

The command now separates the two cases the guard used to conflate: **a seam
that cannot answer is absent, not empty.** It asks the resolved seam one trivial
statement before the scan starts and refuses when the answer is not a result
set, and it holds every individual probe to the same standard, so a probe that
returns no result set becomes a `skipped` entry with its reason instead of zero
findings.

```
os migrate duplicates --database-url memory://qa
  -> exit 1   {"error":"no_sql_seam","detail":"The active driver exposes no
               usable raw SQL seam — it is either absent, or present but
               returning no result set — …"}
```

Nothing here names a driver: a seam is judged by what it returns, so any host
with the same no-op shape is covered without an allowlist to maintain. No driver
package was modified.

Two behaviours are deliberately unchanged. A seam that **throws** is a driver
present and refusing loudly, and the per-probe `skipped` path already reports
that honestly — claiming it here would swallow a transient connection error as
"no seam" and would invent a refusal #8928 never mandated. And a real SQL driver
is unaffected: every shape the new check rejects is one `normalizeRows` already
flattened to `[]`, so no row that used to be reported can be lost.
