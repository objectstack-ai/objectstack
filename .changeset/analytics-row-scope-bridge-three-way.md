---
"@objectstack/service-analytics": minor
---

fix(service-analytics): the ROW-SCOPE bridge to the `security` service tells the same three resolutions apart as the object-level one — a broken security service refuses the query instead of running it with no row policy (#16918)

`AnalyticsServicePlugin` bridges to the `security` service twice: once for the OBJECT-level read grant (`admitObjectRead` → `canReadObject`, #16645) and once for the ROW-level read scope (`getReadScope` → `getReadFilter`, ADR-0021 D-C). The object-level bridge tells three resolutions apart — ABSENT admits, THROWING and METHOD-LESS deny at `error`. The row-scope bridge collapsed all three into one:

```ts
const trySecurity = () => {
  try {
    const svc = ctx.getService<SecurityReadFilter>('security');
    return svc && typeof svc.getReadFilter === 'function' ? svc : undefined;
  } catch { return undefined; }
};
getReadScope = (object, context) => trySecurity()?.getReadFilter(object, context);
```

A throwing resolver and a registered service without `getReadFilter` both produced `undefined` — the same value an absent security service produces, and the value `ISecurityService.getReadFilter` reserves for one meaning only: *"this caller has no row restriction on this object"*. So on a deployment whose security service was wired but broken (a boot-order fault, a mis-registered plugin, a failing dependency, a provider that is not the contract it claims to be) analytics queries ran with **no row-level policy at all**, and nothing said so. One door of the file failed closed on a throwing resolver and its neighbour failed open — and the neighbour is the one carrying row-level policy.

**What changes.** The bridge now resolves the same explicit three-way, at the same reporting level:

- **ABSENT** — no `security` service resolved: **unchanged**. No row-scope provider on this deployment, which is a legitimate configuration (a single-tenant kernel that ships no `plugin-security`, where `/data` carries no row-level policy either) and is already reported loudly at init. ⛔ Deliberately not tightened: refusing here would break every such deployment.
- **THROWING** resolver, or a registered service with **no `getReadFilter`** — the query is **REFUSED**, and the reason is reported at `error` naming the object and which of the two states it was. The refusal is a throw, which `AnalyticsService.resolveReadScopes` — fail-closed since ADR-0021 D-C — already turns into "deny the whole query rather than emit SQL with that object unscoped". A log over an `undefined` would not have been a refusal.

**This change only NARROWS what analytics serves, and only in a state where the security service is broken.** No deployment with a working `security` service, and no deployment with none, changes behaviour by so much as a byte. Nothing that was refused becomes admitted.

**No published-surface delta.** No new error code (the refusal rides the seam's existing fail-closed error), no exported symbol, no key on `AnalyticsServicePluginOptions` or any payload, and no documented envelope changes shape. Graded `minor` rather than `patch` because it is a behaviour narrowing on a published package's read path, matching how its object-level sibling was graded in the same lockstep window.

⚠️ Deliberately **not** answered here: which tenant wall the platform's is (plugin-security's posture-gated Layer 0, or driver-sql's posture-independent auto-scope) — the escalated maintainer decision of triage condition 5. Refusing to serve is neutral between them: it answers *"should we serve at all"*, never *"what shape is the wall"*.
