---
"@objectstack/driver-sql": patch
"@objectstack/driver-turso": patch
---

fix(drivers): withhold the target field from a policy-authored `INVALID_FILTER` refusal (#8197)

`#7929`/B stopped `driver-sql` echoing the operands of a cross-field
`{ $field }` refusal, and `#8220` gave that withhold a spec-declared provenance
mark so an author-written predicate gets its diagnostic back. Neither reached
the rest of the `INVALID_FILTER` family: five other refusals still named the
refused constraint's own **target column** to every caller.

That column is not always the caller's. The security middleware ANDs an
administrator's compiled CEL rule into `opCtx.ast.where`, and on such a
predicate the target is as administrator-authored as the referent `#7929`
already withholds — the argument that ruling accepted, one step out. The most
reachable case is a permission rule over a `multiple: true` field, which lowers
to a membership test on a JSON-stored column and is refused by `#7398`'s gate
while naming the column the administrator wrote.

Measured on a real `SqlDriver` (better-sqlite3, `:memory:`) through
`driver.find`, all five answered `INVALID_FILTER` / 400 naming the target, and
the author-marked spelling was byte-identical to the unmarked one — the mark
reached these sites but was never consulted, because none of these builders
passed through the withheld-refusal carrier.

They now do. The five join the seam `#8220` already owns, with its fail
direction unchanged:

- the JSON-column operator gate (`#7398`),
- the zero-operator field constraint (`#5240`),
- the unbindable comparand (`#5041`) — which also answers a **malformed**
  `{ $field }`, one whose referent is not a string and so never reaches the
  cross-field arm,
- the `$between` arity refusal,

plus `driver-turso`'s copied `RemoteTransport.uncompilableComparand`, so one
deployment does not disclose differently depending on its connection mode.
`driver-sqlite-wasm` inherits `SqlDriver`'s compiler and needed no source
change.

**Who sees what.** A subtree positively marked `'author'` by a read-scope merge
boundary keeps the whole diagnostic, target column included. Everything else —
`'policy'`, unmarked, and ambiguous — receives the refusal's identity
(`INVALID_FILTER` / 400), which class fired, and the capability statement and
repair prescription with placeholder names; the naming half goes to the server
log. Unmarked withholds by design: the mark is permission to reveal, never a
requirement to prove secrecy, and any design where a missing mark lands on the
disclosing branch re-opens `#7929`.

**The accepted cost, stated rather than hidden.** The author-vouch surface is
two call sites, and `plugin-security`'s is conditional on `ast.where` still
being the caller's verbatim object — which fails once `plugin-sharing` has
composed (`#8430`). Until that lands, an author on an object with active
sharing rules loses the target-field name from these messages. That is
fail-closed, and it is the price of the ruling rather than a defect.

Redaction takes everything derived from the predicate — the target field, the
operator, the comparand preview, the filter path — for the reason `#7929` gave
when it withheld both operands rather than one: a comparand preview is the
administrator's literal just as surely as a column name is, and half a
redaction is none.
