---
'@objectstack/spec': minor
---

feat(spec): `SharingRuleEvaluationResult` declares `grantsRefused?: number` — the optional seventh key the sharing-rule evaluate route already answers (#14969)

`minor`, derived: a new key on a published contract interface is additive public
API (semver "backwards-compatible functionality"), and not `major` because the
key is **optional** — every existing `ISharingRuleService` implementer, in-tree
and out, keeps compiling unchanged, and every consumer typed against the six
counts keeps reading them.

`POST /api/v1/sharing/rules/:idOrName/evaluate` (ledgered `sdk`,
`shares.rules.evaluate`) passes the service's return value through unfiltered,
and `@objectstack/plugin-sharing` has counted refused grants on its own subtype
since #14754 — so the wire carried `grantsRefused` while the declared client
type (`client.shares.rules.evaluate`, typed `Promise<SharingRuleEvaluationResult>`)
could not name it without a cast. The client gains the key through its spec
import with no edit of its own.

What the key means, and what its absence means: it counts the grants the
engine **refused** during the pass (`ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` on
an organization-less insert into a tenant-scoped `sys_record_share`); the pass
continues past a refusal, so `grantsRefused > 0` is not a failed pass. The key
is **absent — not `0`** — from any implementation that does not count
refusals. A consumer branching on it must read "unset" as "this implementation
does not report refusals", never as "no grant was refused"; only a present `0`
says the latter. Do not `?? 0` it.

Optional in the spec composes with the plugin-local narrowing: an
implementation that counts refusals may require the key on its own subtype
(`SharingRuleReconcilePassResult extends SharingRuleEvaluationResult`), a legal
covariant narrowing that still satisfies `ISharingRuleService`.
