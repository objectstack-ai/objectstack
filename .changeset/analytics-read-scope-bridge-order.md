---
"@objectstack/service-analytics": patch
---

fix(analytics): the read-scope auto-bridge no longer depends on plugin order (#3618)

`getReadScope` was only wired when the `security` service already existed at this
plugin's `init()`. The closure itself resolved lazily, but the ASSIGNMENT was
gated on an init-time probe — so a kernel that registers `AnalyticsServicePlugin`
before the security plugin got **no read-scope provider at all**, and every
analytics strategy ran unscoped with only a WARN to show for it.

Both sibling bridges (`executeAggregate`, `executeRawSql`) are wired
unconditionally and resolve at call time, and this one's own comment claimed the
same. Now it actually does: the probe only decides the log wording.

The CLI (`os serve`) registers security before analytics, so that path was
already correct. The exposure was for embedders composing their own kernel — and
for this repo's own `bootStack` harness, which registers analytics first, meaning
the entire dogfood/verify suite had analytics RLS silently disabled and any RLS
assertion written there passed vacuously.

Also corrects the WARN text: with no provider, scoping is absent on ALL paths and
ALL objects, not just "the raw-SQL path" and "joined objects" as it claimed.

Adds `analytics-rls.dogfood.test.ts`: an owner-scoped RLS fixture driven over real
HTTP as a real non-admin, asserting the rows a member's aggregate actually
returns. Reverting either this fix or the #3597 strategy fix turns it red.
