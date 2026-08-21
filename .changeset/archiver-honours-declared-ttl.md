---
"@objectstack/objectql": patch
---

**Behaviour change:** a `lifecycle` that declares both `ttl` and `archive` now
has its **`ttl` enforced** — the Archiver selects the rows it moves by the
declared TTL cutoff (`ttl.field` past `ttl.expireAfter`) instead of by
`created_at` age (#10347).

That pair has always parsed — ADR-0057 §3.5 is satisfied because `ttl` is a
bounding policy, and the `archive.after === retention.maxAge` refine only fires
when `retention` is present — but it did nothing: `LifecycleService.reapObject`
returns into `archiveObject` before its `ttl` branch is reachable, so no reap on
`ttl.field` ever ran and the Archiver copied and hot-deleted by `created_at` age
alone. Declared, not enforced. What the author wrote is now what executes; they
no longer have to discover that the two keys cannot usefully be written
together.

**Lifecycles that declare `archive` without `ttl` are unaffected** — they keep
selecting rows by `created_at` past `archive.after`, unchanged. Every
archive-declaring object shipped with the platform (`sys_audit_log`,
`sys_metadata_audit`) is that shape, so no bundled object changes behaviour.

Two details of the new selection, both deliberate:

- A row whose `ttl.field` is **null or absent is retained, not archived**. `$lt`
  is a positive comparison and a value that is not there satisfies none of them
  (the platform-wide null answer settled in #5298/#5299), which is also the
  right reading: a row with no expiry stamp has not been given one, and treating
  "absent" as "expired at the epoch" would archive exactly the rows whose expiry
  the author has not yet decided.
- The cold-side `archive.keep` prune is unchanged. It bounds how long **archived**
  rows survive in cold storage, not which hot rows are due, and it still measures
  from `created_at` under either policy.

If you declare `retention` beside `ttl` and `archive`, the TTL cutoff is what
selects: the age window no longer separately bounds the hot store for that
triple. Whether the Archiver should honour both windows is a separate open
question, filed as #10527 rather than decided here.
