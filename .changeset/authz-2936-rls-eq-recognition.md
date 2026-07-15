---
"@objectstack/plugin-security": patch
---

fix(plugin-security): #2936 — RLS field-existence / tenancy-disabled safety nets now recognize canonical `==`

`extractTargetField` (the lightweight left-hand-field parser feeding the Layer 1
**field-existence** net and the **tenancy-disabled** skip net in
`computeLayeredRlsFilter`) only matched the legacy single-`=` / `IN` shape. It
returned `null` for canonical CEL `==` (`field == …`), which is how real seeds
and business policies author equality. A `null` target field means "keep the
policy", so both safety nets were **inert** for every `==` policy: a wildcard
policy targeting a column the object lacks was NOT failed closed, and a
`==`-form `organization_id` policy on a `tenancy.enabled:false` object was NOT
skipped. The regex now recognizes `==` (listed before `=` so the ordered
alternation does not mis-match the first `=`), alongside the existing `=`/`IN`.
Recognition is only **extended** — the net semantics are unchanged, and
`!=`/`>`/`<`/`>=`/`<=` still return `null` (conservative keep), matching prior
behavior for any unmatched shape.

Behavior delta (fail-closed strengthening, same effective visibility): the
wildcard `owner_only_writes` / `owner_only_deletes` seed policies
(`created_by == current_user.id`) now correctly fail closed on an object that
lacks a `created_by` column (platform-global / system tables). Previously they
slipped the net and compiled to a phantom `{ created_by: … }` filter against a
missing column — a driver-dependent, effectively-deny result; now the net drops
the sole applicable write policy and yields the deny sentinel. A member could not
by-id write such a column-less object either way, so the visible/writable row set
is unchanged; only the mechanism is now an explicit fail-closed deny. All ordinary
tenant/business objects carry `created_by`, so they are unaffected (proven green by
the dogfood authz-conformance + RLS matrices). The tenancy-disabled skip net has no
effect on any current seed (no `==` seed policy targets `organization_id` on a
tenancy-disabled object). The tenant wall itself is Layer 0 (`tenant-layer.ts`),
which never used this parser, so tenant isolation is unaffected (ADR-0095 D1).
