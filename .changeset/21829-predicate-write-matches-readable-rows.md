---
'@objectstack/plugin-security': minor
"@objectstack/spec": patch
---

fix(plugin-security)!: a predicate-scoped update or delete matches only the rows the caller can read

Clause-②: no (narrowing)

<!-- adr-0087: registered predicate-write-unreadable-row-not-matched -->

**BREAKING**: a predicate-scoped (`multi: true`) update or delete now matches only the rows the caller can read. A row the read door would not return to the caller is not written, not counted and not refused, so a predicate that reaches only such rows answers exactly what a predicate that matches nothing answers: success, zero rows. This is the by-id write doors' rule ("hidden" and "gone" are one answer to a caller who cannot read the row) carried to the predicate door. It ships as `minor` under the launch-window convention for accept-set narrowings. No export is added or removed, and no error code is new.

**What changed.** The rows a predicate write matched came from its write scope alone. A row the caller cannot read was matched whenever that scope reached it, for example through a write-class row-level policy wider than the read policy, or on an object whose read visibility follows a parent record. A per-row gate then refused the whole write with a `403`, or the row was written and counted. Either answer told a hidden row apart from no row. The write middleware now asks the read door which rows the caller's own predicate returns, through a read in the caller's context that every data middleware's visibility applies to, and narrows the write to those rows: readable ∩ writable. A read the read door refuses (no read grant on the object) keeps the write's previous answer. A store fault on that read propagates as raised.

**What is refused or narrowed now that was not.**
- A predicate write no longer writes, counts or refuses rows its caller cannot read, including rows its write scope reaches.
- A predicate write whose predicate matches more than 10 000 rows the caller can read is refused with `400 INVALID_FILTER`, before anything is written, rather than narrowed by a cut-off list. The limit is the platform's existing row ceiling for one predicate write.

**FROM → TO.**
- A predicate update or delete reaching rows the caller cannot read: FROM a per-row gate's `403`, or those rows written and counted → TO those rows not matched; success with zero rows when no readable row matches.
- A predicate update or delete whose readable match exceeds 10 000 rows: FROM attempted → TO `400 INVALID_FILTER`, nothing written.

**If you are affected.** An operator who needs a user to change rows grants that user read access to them first. A caller that read a predicate write's `403` as "a row exists here" reads the result as the count of rows it can see. A predicate whose readable match is over the ceiling is narrowed and written in batches.

**Unchanged.**
- A caller who can read a matched row but may not write it keeps its answer.
- Writes the platform issues under the caller's context keep their previous answer, because the caller never addressed them: a cascade, a hook's own write, and the referential clear of a lookup.
- By-id writes keep their answers. System-context writes are not narrowed.
- `security/explain` takes no predicate, so it has no predicate-write verdict to change.
