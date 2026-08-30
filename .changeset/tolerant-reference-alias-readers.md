---
"@objectstack/plugin-security": patch
"@objectstack/verify": minor
---

fix(security,verify): the last two tolerant `reference_to` readers — one made loud, one narrowed with a named reason (#13250)

`@objectstack/spec` declares `reference` as the only relationship spelling and
`FieldSchema` rejects `reference_to` / `referenceTo` (#11567, "one key, one
answer"). Three live consumers still read the rejected alias as an accepted
fallback. The lint reader was narrowed in #13322; the two remaining ones get
**different** dispositions, because their failure modes are different in kind
(maintainer ruling, 2026-08-30).

**`@objectstack/plugin-security` — the tolerance STAYS, and is now LOUD.**
`resolveCbpRelation` reads `ql.getSchema()`, i.e. the `SchemaRegistry`, and a
raw `registerObject` skips Zod by design, so the alias genuinely reaches it
(re-measured: a raw round-trip serves the field back as
`["name","type","required","reference_to"]`, canonical absent). A miss there is
not a quiet wrong answer, it is a **denial** — `resolveCbpRelation` returning
null is fail-closed, giving `RLS_DENY_FILTER` (zero rows for every non-admin
caller) on read and throwing `MasterDetailRelationMissingError` on write. So
narrowing it would take a raw-registered, alias-spelled `controlled_by_parent`
object from "access derived from its master" to "everything denied, and writes
throw": an availability outage on a population that provably exists. The alias
therefore still resolves, unchanged, and the plugin now reports it **once per
object** through its own report sink — the same `warn` channel and console
backed default as every other report site there. The message names the object,
the field, the alias key and the rename, and states that access is unaffected
so nobody goes hunting for an outage that did not happen. Nothing is reported
for the canonical spelling, or when a canonical `reference` won over a stale
alias on the same field.

The report's granularity is the cache's: it sits inside `resolveCbpRelation`'s
resolution body, which runs only on a `cbpRelCache` miss, so 25 reads of one
object produce one report — and it re-arms when `metadata.watch('*')` clears
that cache, which is exactly when a Studio / AI-authoring author is listening.

**`@objectstack/verify` — narrowed, and the finding says WHY.** `deriveCrudCases`
reads its config from `loadConfig()`, which does not validate ("the gate lives
in the loaded module"), so the alias reaches it through two unparsed doors —
a plain-object config, and the documented `defineStack(cfg, { strict: false })`
(re-measured: the same fixture is refused by the default strict parse with
*"Unrecognized key(s) on this field: `reference_to`"*, and survives both doors
verbatim). Unlike the security reader, verify's failure mode is a **report
line** rather than a refusal, so narrowing costs coverage, not availability —
and it is safe. But a verifier that silently under-verifies is the defect
#5262 was about, so the narrowing ships **with** its reason: an alias-spelled
required relation now reports

> required lookup field "company_id" spells the rejected alias `reference_to`
> instead of `reference` — `reference` is the only relationship spelling
> @objectstack/spec declares, so this app's target "company" was not derived;
> rename the key

rather than degrading to the generic "has no `reference` target", and an
optional one is skipped under `relation-rejected-reference-alias:<key>` rather
than the generic `relation-missing-reference`. Both land in the existing
free-form `CrudCase.blocked` / `skippedFields[].reason` strings — no new
exported type, no new status, no widened published surface.

No shipped metadata spells either alias: the repo-wide sweep finds the spelling
only in tests, the spec's own alias tables and other readers' documentation —
no example app or platform object uses it.

⛔ Narrowing the security reader for real remains out of scope here, and is
only honest behind a migration that sweeps stored / raw-registered metadata
first.
