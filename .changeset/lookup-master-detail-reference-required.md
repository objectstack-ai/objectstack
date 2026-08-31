---
"@objectstack/spec": minor
---

fix(spec): `FieldSchema` requires a non-empty `reference` on `lookup` / `master_detail` (#13632)

**BREAKING** accept-set narrowing on `FieldSchema`, shipped as `minor` under the
repo's launch-window convention for breaking changes — the same grade the nearest
tightening precedents shipped with: #11519 / #11842 (`ActionSchema` accept-set
narrowings) and #13733 (`FormViewSchema` wizard tightening), all `minor` with the
**BREAKING** header.

The key's own TSDoc has always called `reference` **required** on the two
relationship types, but the schema accepted a `lookup` / `master_detail` with the
key missing or set to `''` — a relationship that points nowhere. Nothing
downstream can act on that shape: the record picker has no object to query,
`$expand` has nothing to resolve, `deleteBehavior` has no parent to apply to, and
driver-mongodb silently skips the relationship index it would otherwise build.
Lint's `relationship/missing-reference` already grades the same hole an
error-severity finding; the publish seam was the one door left open — exactly
where AI-authored metadata that omits the key would otherwise parse cleanly and
fail far from the cause (ADR-0049 declared = enforced).

What newly gets rejected: `type: 'lookup'` or `type: 'master_detail'` with
`reference` absent or `''`. The rejection is prescriptive on the `reference`
path — it names the type, the key, the expected shape (a snake_case target
object name), and the fix. Everything else is untouched: a non-empty `reference`
round-trips byte-identically, non-relationship types never carried the
requirement, `referenceVia` stays text-only and mutually exclusive with
`reference`, and the `Field.lookup()` / `Field.masterDetail()` helpers already
take the target as their first positional argument, so helper-authored fields
cannot miss it.

The measured population of affected authored sources is zero in every in-tree
corpus (examples, reference apps, packaged metadata, seeds, structured metadata
and docs samples all declare targets; the census and its positive controls are
recorded on the PR). No key is removed or renamed, so there is no ADR-0087
registry entry — the key stays authorable with the same meaning; only the
missing/empty hole closes.
