---
"@objectstack/spec": minor
"@objectstack/driver-sql": patch
"@objectstack/driver-turso": patch
"@objectstack/plugin-security": patch
"@objectstack/service-analytics": patch
---

feat(spec): filter-subtree provenance — the cross-field refusal names an author's own columns again, without re-disclosing policy (#8220, A of the #7929 ruling)

#8198 (B of the 2026-08-12 #7929 ruling) made the SQL family's cross-field
`{ $field }` refusal withhold its operands from **every** caller, because the
predicate reached the driver as a bare `FilterCondition`: an administrator's
CEL sharing/permission rule and the author's own filter were indistinguishable
there. The accepted, named cost was the author's diagnostic. This change is A
— the sanctioned follow-up that pays it back behind a real mark instead of a
guess.

**The mark** (`@objectstack/spec/data`, `filter-subtree-provenance.ts`) is a
spec-declared symbol on a filter subtree: `markFilterSubtreeProvenance(subtree,
'author' | 'policy')`, read positionally by
`resolveFilterSubtreeProvenance(root, node)` (innermost mark on the ancestor
chain wins; located by object identity, never structural equality). It rides
the `where` tree by reference across the `DriverQuery` boundary — no new slot,
documented on `DriverQuery` itself — and is dropped by exactly the operations
(serialize, copy, rewrite) after which no attestation could be trusted.

**Set at both read-scope merge boundaries**: `plugin-security`'s CRUD RLS
injection marks every injected scope `'policy'` and the caller's verbatim
predicate `'author'` — the latter only under the identity vouch
`ast.where === options.where`, so a tree a sibling middleware already rewrote
is vouched for nobody. `service-analytics`' `ObjectQLStrategy.withReadScope`
marks its scope `'policy'` and the strategy-built user filter `'author'` (and
`resolveFkAttr`'s scope arm `'policy'`).

**Consumed by the SQL family** (`driver-sql`, `driver-turso`'s
`RemoteTransport`; `driver-sqlite-wasm` inherits): a refusal raised from a
subtree positively marked `'author'` carries its full diagnostic on the wire
again — both columns, the operator, the list index, the boundary reason —
same identity (`INVALID_FILTER` / 400).

**⚠️ The fail direction is closed, and it is the design**: unmarked or
ambiguous — no mark anywhere, a mark lost to serialization, a node
unreachable from the query's own `where`, conflicting aliased marks —
withholds exactly like `'policy'`. The mark is permission to reveal, never a
requirement to prove secrecy; a driver-side guess at provenance is the shape
the #7929 triage rejected.

**Two B-era pins were REWRITTEN deliberately, not weakened.** First,
`service-analytics`' `cross-field-engine-fallback.test.ts` pinned B's blanket
redaction on refusals of the caller's OWN `where` (no scope in play) — under A
that caller is the vouched author, so those cases now assert the corpus's
`diagnosticIncludes` fragments are back on the wire, while the
policy-injected-scope case gains the explicit non-disclosure assertions as its
fail-closed pair. Second, the sharper one:
`packages/runtime/src/cross-field-refusal-operand-withhold.test.ts` pinned
author-written and policy-injected refusals **byte-identical** — the strongest
available statement of "the driver cannot tell them apart", and explicitly the
assertion A was chartered to supersede. Its successor pins the three-way split
#8220's "Done means" names: policy-injected withholds (unchanged), the vouched
author's filter names its columns again (the messages now differ, by design),
and an unmarked predicate still withholds **byte-identical to the policy
case** — B's surviving half. Reading that diff as a regression is exactly what
the old pin's comment warned against; the file header carries the full
account.

Unaffected: the REST boundary's 5xx-only withhold (#5367/#5667) and every
refusal outside the cross-field family.
